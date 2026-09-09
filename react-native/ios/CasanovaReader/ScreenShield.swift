/*  ScreenShield.swift — the iOS half of the DRM contract declared in
 *  `src/drm/ScreenShield.tsx`.
 *
 *  Read this before changing it, because the difference between this file and
 *  `ScreenShieldModule.kt` is not an implementation detail, it is the whole
 *  design.
 *
 *  iOS does not allow an app to prevent a screenshot. There is no equivalent of
 *  Android's FLAG_SECURE for the still-capture path, and any library claiming
 *  otherwise is doing one of the three things below. What iOS does allow:
 *
 *   1. Keep content out of the app-switcher snapshot, reliably. On
 *      `willResignActive` an opaque black view is placed over the window by
 *      native code. This is not a React render and does not wait for the bridge:
 *      the notification and the view insertion happen in the same run-loop turn
 *      in which the system takes the snapshot, so the switcher never shows a
 *      page. `PrivacyCover` below explains why this is the primary mechanism
 *      rather than the usual secure-text-field trick.
 *
 *   2. Detect an *active* capture and conceal within a frame.
 *      `UIScreen.isCaptured` is true while a screen recording, AirPlay or a
 *      cable mirror is running, and `capturedDidChangeNotification` fires when
 *      it starts. The JavaScript layer paints an opaque view over everything on
 *      that event. The recording therefore contains the book up to the moment it
 *      began and black afterwards — a mitigation with a hole at the front, which
 *      is why the reader says so out loud in its protection sheet instead of
 *      letting the customer believe the hole is not there.
 *
 *   3. Attribute a screenshot after the fact.
 *      `userDidTakeScreenshotNotification` fires once the image is already in
 *      the camera roll. Nothing can be undone. The value is that
 *      `security_events` records who did it, on which device, during which
 *      session — which is what a publisher actually needs when a page turns up
 *      somewhere it should not.
 *
 *  Plus one thing that is not capture-related at all: `restrictDocumentInteraction`
 *  removes PDFKit's text selection, because Copy is a way to lift passages out
 *  of a book that has nothing to do with cameras.
 */

import CryptoKit
import Foundation
import PDFKit
import UIKit

/* RCTEventEmitter, RCTPromiseResolveBlock and RCTPromiseRejectBlock arrive
 * through `CasanovaReader-Bridging-Header.h`. */

@objc(ScreenShield)
class ScreenShield: RCTEventEmitter {

    /* ── State ─────────────────────────────────────────── */

    /**
     * The opaque view placed over the window while the app is not active.
     *
     * This is the primary switcher protection, and it is primary because it is
     * the only mechanism here that uses nothing but public API and can be
     * reasoned about: a view with `isOpaque = true` and a black background,
     * added to the window before the snapshot is taken, is what the snapshot
     * contains. There is no version of iOS on which that stops being true.
     *
     * Note that it appears during deactivation and is removed on
     * `didBecomeActive`, so the customer never sees it. That means it does not
     * conflict with `drm_policies.hide_content_on_blur` being false: that policy
     * governs what the reader shows when the customer comes *back*, and by then
     * the cover is gone and the JavaScript side has made its own decision.
     */
    private var privacyCover: UIView?

    /** Retained for as long as its layer sits in the window's layer tree.
     *  Letting this deallocate silently re-enables switcher snapshots, which is
     *  the kind of regression nobody notices until a leak happens. */
    private var secureField: UITextField?

    /** The canvas layer lifted out of `secureField` into the window. Kept so
     *  `disable()` removes exactly what was added. */
    private var secureLayer: CALayer?

    private var notificationObservers: [NSObjectProtocol] = []

    private var observersInstalled = false

    private var shieldActive = false

    /** Whether the JavaScript side is currently subscribed.
     *
     *  Named `jsIsListening` rather than `hasListeners`: `RCTEventEmitter` has
     *  an ivar of that name declared inside its @implementation block, which is
     *  invisible to Swift. Declaring a Swift property with the same name would
     *  look like it worked and then diverge from the superclass's own
     *  bookkeeping the first time React Native changed it. */
    private var jsIsListening = false

    private var lastCaptured: Bool?
    private var lastMirrored: Bool?

    /* ── RCTEventEmitter plumbing ──────────────────────── */

    override static func requiresMainQueueSetup() -> Bool {
        /* Everything here touches UIWindow and UIScreen. Setting up on a
         * background queue would race the first frame, and losing that race
         * means losing the content. */
        true
    }

    override func supportedEvents() -> [String] {
        ["onCaptureChanged", "onMirrorChanged", "onScreenshotTaken"]
    }

    /**
     * Observer installation is deliberately NOT tied to these two callbacks.
     *
     * `RCTEventEmitter` calls them when JavaScript adds and removes its
     * listeners, which in this app happens whenever `useScreenShield` remounts.
     * Tearing the OS observers down at those moments is exactly wrong: a capture
     * that begins while the bridge is briefly listener-free would go unreported,
     * and the point of the shield is that it does not depend on React's render
     * cycle being in a good state.
     *
     * Observers follow `enable()` and `disable()`, which follow the policy. Only
     * the `jsIsListening` bookkeeping lives here, so that emitting with nobody
     * subscribed is a no-op rather than the "unsupported top level event"
     * warning `RCTEventEmitter` produces.
     */
    override func startObserving() {
        jsIsListening = true
    }

    override func stopObserving() {
        jsIsListening = false
    }

    override func invalidate() {
        removeObservers()
        removePrivacyCover()
        removeSwitcherProtection()
        shieldActive = false
        super.invalidate()
    }

    /* ── Capture protection ────────────────────────────── */

    @objc func enable(
        _ resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else {
                resolve(false)
                return
            }
            self.installObservers()
            self.installSwitcherProtection()
            self.shieldActive = true

            /* Publish the state the OS is already in rather than waiting for a
             * change: a reader opened mid-recording must start concealed rather
             * than spend one frame revealed. */
            self.publishCaptured(force: true)
            self.publishMirrored(force: true)

            /* What "protected" means on iOS, stated precisely: the window can
             * be covered before a snapshot, and active capture can be detected
             * and reacted to. If neither is available — no key window yet, which
             * can happen if `enable()` is somehow called before the scene
             * connects — the honest answer is false, and the JavaScript layer
             * turns that into `shieldFailed` and refuses to render the book. */
            resolve(self.canProtectSwitcher())
        }
    }

    @objc func disable(
        _ resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else {
                resolve(nil)
                return
            }
            self.removeObservers()
            self.removePrivacyCover()
            self.removeSwitcherProtection()
            self.shieldActive = false
            resolve(nil)
        }
    }

    @objc func isShieldActive(
        _ resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else {
                resolve(false)
                return
            }
            /* Derived from whether the protection can currently be installed,
             * not from the `shieldActive` flag: the flag says what was asked
             * for, this says what is possible right now, and the two disagree
             * whenever the window has been replaced underneath us by a scene
             * reconnect. */
            resolve(self.shieldActive && self.canProtectSwitcher())
        }
    }

    @objc func isCaptured(
        _ resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        DispatchQueue.main.async {
            resolve(ScreenShield.currentScreen()?.isCaptured ?? false)
        }
    }

    /**
     * True when an external display is attached or the built-in screen is being
     * mirrored.
     *
     * `screens.count > 1` covers AirPlay and the cable; `mirroredScreen != nil`
     * covers the case where the external display reports itself as a mirror of
     * the built-in one rather than as an additional screen. Both are checked
     * because an extended second display puts a book in front of an audience
     * just as effectively as a mirrored one does.
     */
    @objc func isMirrored(
        _ resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        DispatchQueue.main.async {
            resolve(ScreenShield.detectMirroring())
        }
    }

    /* ── Privacy cover ─────────────────────────────────── */

    /**
     * True when the cover is installed or can be installed on demand.
     *
     * The secure-entry layer is NOT part of this answer. That layer is a
     * best-effort extra — it depends on the internal structure of
     * `UITextField.layer.sublayers`, which is not public API and has changed
     * shape between iOS releases. Making `enable()`'s return value depend on it
     * would mean an iOS update could stop the reader from opening books at all,
     * on every device, with no code change on our side. The cover uses nothing
     * but `UIView`, so the guarantee it provides is one that can actually be
     * promised.
     */
    private func canProtectSwitcher() -> Bool {
        if privacyCover != nil { return true }
        return ScreenShield.keyWindow() != nil
    }

    private func installPrivacyCover() {
        if privacyCover != nil { return }
        guard let window = ScreenShield.keyWindow() else { return }

        let cover = UIView(frame: window.bounds)
        cover.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        cover.backgroundColor = UIColor.black
        /* Opaque and black, matching `colors.shield` in `src/theme.ts`. Not the
         * app background: a cover that is even slightly translucent, or that
         * carries the brand colour, lets the compositor show what is underneath
         * it in the snapshot. */
        cover.isOpaque = true
        cover.isUserInteractionEnabled = false
        cover.isAccessibilityElement = false
        cover.accessibilityElementsHidden = true
        cover.tag = Self.PRIVACY_COVER_TAG

        /* `addSubview` puts it last in the window's subview order, which is
         * above the React root view and above anything presented modally from
         * it. A React Native Modal lives in the same window, so it is covered
         * too — and a modal open at the moment of deactivation is exactly the
         * case where the reader is most likely to be showing a page. */
        window.addSubview(cover)
        privacyCover = cover
    }

    private func removePrivacyCover() {
        privacyCover?.removeFromSuperview()
        privacyCover = nil
    }

    /* ── Secure-entry layer (best effort) ──────────────── */

    /**
     * Attempts to make the window itself non-snapshotable.
     *
     * The technique: a `UITextField` with `isSecureTextEntry = true` owns a
     * canvas layer that iOS excludes from snapshots, and a window containing
     * that layer in its tree is excluded too. This is the same mechanism the
     * system uses to keep passwords out of the switcher.
     *
     * It is kept alongside the privacy cover rather than instead of it because
     * it covers one case the cover does not: if the app is terminated by the
     * system while backgrounded, the snapshot already taken is what the switcher
     * shows, and the cover was removed on the last activation. A window marked
     * non-snapshotable has no such snapshot to show.
     *
     * Failure is not an error and is not reported upward, for the reason given
     * at `canProtectSwitcher()`.
     */
    private func installSwitcherProtection() {
        if secureLayer?.superlayer != nil { return }
        guard let window = ScreenShield.keyWindow() else { return }

        let field = UITextField(frame: CGRect(x: 0, y: 0, width: 1, height: 1))
        field.isSecureTextEntry = true
        field.isUserInteractionEnabled = false
        field.isAccessibilityElement = false
        field.alpha = 0.01

        /* The canvas layer only exists once the field has been laid out inside a
         * real hierarchy, so the field has to be added before the layer can be
         * lifted out. Positioned off the top-left corner at one point square so
         * that no part of it can overlap the reader even if the layer lift
         * fails and it stays where it is. */
        window.addSubview(field)
        field.center = CGPoint(x: -100, y: -100)
        window.layoutIfNeeded()

        guard let candidate = field.layer.sublayers?.first else {
            /* Nothing to lift. The field is removed so the window is not left
             * holding a view that does nothing. */
            field.removeFromSuperview()
            return
        }

        candidate.frame = CGRect(x: 0, y: 0, width: 1, height: 1)
        /* Not resized with the window and not given a zPosition. The exclusion
         * depends on the layer being present in the window's tree, not on its
         * geometry, and both of those settings are ways this could end up
         * drawing over the page. */
        window.layer.addSublayer(candidate)

        secureField = field
        secureLayer = candidate
    }

    private func removeSwitcherProtection() {
        secureLayer?.removeFromSuperlayer()
        secureLayer = nil
        secureField?.removeFromSuperview()
        secureField = nil
    }

    /* ── Observers ─────────────────────────────────────── */

    private func installObservers() {
        guard !observersInstalled else { return }
        observersInstalled = true

        let centre = NotificationCenter.default

        notificationObservers.append(
            centre.addObserver(
                forName: UIApplication.willResignActiveNotification,
                object: nil,
                queue: .main
            ) { [weak self] _ in
                self?.installPrivacyCover()
            }
        )

        notificationObservers.append(
            centre.addObserver(
                forName: UIApplication.didBecomeActiveNotification,
                object: nil,
                queue: .main
            ) { [weak self] _ in
                self?.removePrivacyCover()
            }
        )

        notificationObservers.append(
            centre.addObserver(
                forName: UIScreen.capturedDidChangeNotification,
                object: nil,
                queue: .main
            ) { [weak self] _ in
                self?.publishCaptured()
            }
        )

        notificationObservers.append(
            centre.addObserver(
                forName: UIScreen.connectDidChangeNotification,
                object: nil,
                queue: .main
            ) { [weak self] _ in
                self?.publishMirrored()
            }
        )

        notificationObservers.append(
            centre.addObserver(
                forName: UIScreen.disconnectDidChangeNotification,
                object: nil,
                queue: .main
            ) { [weak self] _ in
                self?.publishMirrored()
            }
        )

        notificationObservers.append(
            centre.addObserver(
                forName: UIApplication.userDidTakeScreenshotNotification,
                object: nil,
                queue: .main
            ) { [weak self] _ in
                self?.publishScreenshotTaken()
            }
        )
    }

    private func removeObservers() {
        let centre = NotificationCenter.default
        notificationObservers.forEach { centre.removeObserver($0) }
        notificationObservers.removeAll()
        observersInstalled = false
    }

    private func publishCaptured(force: Bool = false) {
        guard jsIsListening else { return }
        let captured = ScreenShield.currentScreen()?.isCaptured ?? false
        if !force && captured == lastCaptured { return }
        lastCaptured = captured
        sendEvent(withName: "onCaptureChanged", body: ["captured": captured])
    }

    private func publishMirrored(force: Bool = false) {
        guard jsIsListening else { return }
        let mirrored = ScreenShield.detectMirroring()
        if !force && mirrored == lastMirrored { return }
        lastMirrored = mirrored

        var body: [String: Any] = ["mirrored": mirrored]
        if mirrored {
            /* Recorded so a row in `security_events` can distinguish AirPlay
             * from a cable from an extended display without needing the device
             * in hand. */
            body["detail"] = UIScreen.screens.map { screen in
                "\(Int(screen.bounds.width))x\(Int(screen.bounds.height))"
                    + (screen.mirroredScreen != nil ? " mirrored" : " extended")
            }.joined(separator: "; ")
        }
        sendEvent(withName: "onMirrorChanged", body: body)
    }

    private func publishScreenshotTaken() {
        guard jsIsListening else { return }
        sendEvent(withName: "onScreenshotTaken", body: ["kind": "screenshot"])
    }

    /* ── Device integrity ──────────────────────────────── */

    /**
     * Jailbreak and simulator detection.
     *
     * Like its Android counterpart this is a claim, not a proof: the checks run
     * inside the process being attacked, so anything they look for can be hidden
     * from them. What they are good for is catching unmodified tooling — Cydia,
     * Sileo, Zebra, checkra1n, palera1n, a `DYLD_INSERT_LIBRARIES` tweak — and
     * for putting a verdict on `device_sessions.device_integrity`, where a
     * pattern across many sessions is visible even when any single one is not.
     *
     * The decision that actually refuses to hand over a book is the server's,
     * through `drm_policies.block_rooted_devices`.
     */
    @objc func deviceIntegrity(
        _ resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        #if targetEnvironment(simulator)
        /* Same rule as the Android module: a debug build on a simulator is a
         * developer, not a pirate, and refusing to open a book would make the
         * reader impossible to develop. A release build reports EMULATOR and the
         * reader refuses. `DEBUG` is a build-configuration flag, so nothing the
         * device does at runtime can flip it. */
        resolve(ScreenShield.DEBUG_BUILD ? "UNKNOWN" : "EMULATOR")
        #else
        /* The file, environment and dyld checks are safe on the thread React
         * Native called from, which is a background queue. */
        if ScreenShield.detectJailbreakOffMainThread() {
            resolve("JAILBROKEN")
            return
        }
        /* `canOpenURL` is a UIKit call and is not safe off the main thread.
         * Dispatching asynchronously rather than synchronously because a sync
         * hop to main from a queue that main might be waiting on is a deadlock,
         * and a promise resolving a few milliseconds later costs nothing. */
        DispatchQueue.main.async {
            if ScreenShield.detectJailbreakStoreSchemes() {
                resolve("JAILBROKEN")
                return
            }
            /* `TRUSTED` means "no local indicator of compromise", and nothing
             * stronger. See the matching note in `ScreenShieldModule.kt` for why
             * the alternative — reporting ATTESTATION_FAILED until App Attest or
             * DeviceCheck is wired up — must not be used: that value is in the
             * JavaScript `COMPROMISED_INTEGRITY` list, so returning it would
             * block every unmodified iPhone that ever installs the app. */
            resolve("TRUSTED")
        }
        #endif
    }

    /** Decided at compile time, so it cannot be influenced at runtime. */
    private static let DEBUG_BUILD: Bool = {
        #if DEBUG
        return true
        #else
        return false
        #endif
    }()

    private static func detectJailbreakOffMainThread() -> Bool {
        /* Injected libraries first: a tweak that is not loaded is a tweak that
         * is not doing anything, so this is the check with the fewest false
         * positives and the highest value. */
        if ProcessInfo.processInfo.environment["DYLD_INSERT_LIBRARIES"] != nil {
            return true
        }

        let imageCount = Int(_dyld_image_count())
        for index in 0..<imageCount {
            guard let name = _dyld_get_image_name(UInt32(index)) else { continue }
            let lowered = String(cString: name).lowercased()
            if SUBSTRATE_LIBRARIES.contains(where: { lowered.contains($0) }) {
                return true
            }
        }

        if JAILBREAK_PATHS.contains(where: { FileManager.default.fileExists(atPath: $0) }) {
            return true
        }

        /* Writing outside the sandbox. On a stock device the root of the data
         * volume is read-only for third-party processes, so this throws; on a
         * jailbroken one it succeeds. The probe file is removed either way, and
         * the failure is the expected result rather than an error condition. */
        let probe = "/private/casanova-integrity-probe"
        do {
            try "x".write(toFile: probe, atomically: true, encoding: .utf8)
            try? FileManager.default.removeItem(atPath: probe)
            return true
        } catch {
            return false
        }
    }

    /**
     * Must run on the main thread.
     *
     * Requires `LSApplicationQueriesSchemes` in Info.plist, which is declared
     * there. Without that declaration `canOpenURL` returns false on a
     * jailbroken device too, and this check silently stops working — the kind
     * of failure that looks like a clean result.
     */
    private static func detectJailbreakStoreSchemes() -> Bool {
        for scheme in ["cydia", "sileo", "zbra", "undecimus", "filza"] {
            guard let url = URL(string: "\(scheme)://package/id") else { continue }
            if UIApplication.shared.canOpenURL(url) {
                return true
            }
        }
        return false
    }

    /* ── File vault helpers ────────────────────────────── */

    /**
     * Sets `NSURLIsExcludedFromBackupKey`.
     *
     * Without it an iCloud or Finder backup carries the vault to whatever device
     * the customer restores onto — a device whose session was never authorised
     * to hold that copy, and which the server has no record of. Android needs no
     * equivalent because `allowBackup="false"` there is per app and is set in the
     * manifest.
     *
     * Resolves false rather than rejecting when the file is gone or the
     * attribute cannot be set: the vault treats false as "the exclusion did not
     * take" and destroys the copy, which is the right response either way.
     */
    @objc func excludeFromBackup(
        _ path: String,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        guard FileManager.default.fileExists(atPath: path) else {
            resolve(false)
            return
        }
        do {
            var values = URLResourceValues()
            values.isExcludedFromBackup = true
            var target = URL(fileURLWithPath: path)
            try target.setResourceValues(values)
            resolve(true)
        } catch {
            resolve(false)
        }
    }

    /**
     * SHA-256 of a file, lowercase hex.
     *
     * `SecureFileVault.fetchToVault` compares it against the `checksum` on the
     * redeemed grant. Without it a truncated download — a captive-portal
     * interstitial, a proxy that closes early, a disk that silently stops
     * writing — would be handed to the renderer as though it were the book, and
     * the renderer would either fail or, worse, draw the pages it did receive
     * and report success.
     *
     * Streamed in 64 KiB chunks rather than read whole, because holding a
     * book-length PDF twice in memory on an older device is how a reader gets
     * killed by the jetsam limit and the customer sees a crash with no reason.
     */
    @objc func sha256File(
        _ path: String,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        guard FileManager.default.fileExists(atPath: path),
              let stream = InputStream(fileAtPath: path) else {
            /* Empty string means "skip the check" to the vault. A rejection
             * would be treated as a mismatch and destroy a file that is
             * probably fine. */
            resolve("")
            return
        }

        var hasher = SHA256()
        stream.open()
        defer { stream.close() }

        let bufferSize = 65_536
        let buffer = UnsafeMutablePointer<UInt8>.allocate(capacity: bufferSize)
        defer { buffer.deallocate() }

        while stream.hasBytesAvailable {
            let read = stream.read(buffer, maxLength: bufferSize)
            if read < 0 {
                resolve("")
                return
            }
            if read == 0 { break }
            hasher.update(bufferPointer: UnsafeBufferPointer(start: buffer, count: read))
        }

        resolve(hasher.finalize().map { String(format: "%02x", $0) }.joined())
    }

    /**
     * Best-effort removal of text selection from an open PDF.
     *
     * PDFKit renders selectable text, and selection brings a Copy item and — on
     * iOS 16+ — an edit menu carrying Share. That is a way to lift passages out
     * of a book which has nothing to do with cameras, so the reader removes it.
     *
     * How: walk the key window's hierarchy and, for every view whose class or
     * any of its superclasses has "pdf" in the name, disable its long-press
     * recognisers. Scoped by class name rather than applied to the whole window,
     * because disabling long-press everywhere would also kill the press-and-hold
     * affordances the app itself uses.
     *
     * Honest limits, and the reason the reader tells the customer this is a
     * mitigation rather than a guarantee:
     *  - Scrolling and pinch-zoom are untouched. They are pan and pinch
     *    recognisers, not long-press, and removing them would make the book
     *    unreadable.
     *  - `react-native-pdf` renders pages through its own container rather than
     *    always through `PDFView`, so on some versions there is no selection to
     *    remove and this resolves true without finding anything. That is the
     *    desired outcome, not a failure.
     *  - Nothing here stops someone transcribing what they can see, or
     *    photographing the screen with a second device. No software does. That
     *    is what the identity watermark is for: it makes the photograph point
     *    back at the account it came from.
     */
    @objc func restrictDocumentInteraction(
        _ resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        DispatchQueue.main.async {
            guard let window = ScreenShield.keyWindow() else {
                resolve(false)
                return
            }

            var pending: [UIView] = [window]
            while let view = pending.popLast() {
                pending.append(contentsOf: view.subviews)
                guard ScreenShield.isPdfView(view) else { continue }
                for recogniser in view.gestureRecognisers ?? []
                where recogniser is UILongPressGestureRecognizer {
                    recogniser.isEnabled = false
                }
            }

            resolve(true)
        }
    }

    private static func isPdfView(_ view: UIView) -> Bool {
        if view is PDFView { return true }
        /* A class-name walk rather than one `NSStringFromClass` check, because
         * `react-native-pdf` subclasses its container and the subclass name does
         * not necessarily contain "pdf" even when its parent's does. */
        var current: AnyClass? = type(of: view)
        while let type = current {
            if NSStringFromClass(type).lowercased().contains("pdf") { return true }
            current = class_getSuperclass(type)
        }
        return false
    }

    /* ── Window and screen helpers ─────────────────────── */

    /**
     * The key window of the foreground active scene.
     *
     * `UIApplication.shared.keyWindow` is deprecated since iOS 13 and returns
     * nil on a scene-based app, which is what a React Native 0.79 app is. The
     * scene walk is also what makes this correct on an iPad with more than one
     * window: the shield belongs to the window the customer is looking at.
     *
     * Falls back to any connected scene rather than returning nil when nothing
     * is foreground-active, because `willResignActive` is exactly the moment at
     * which the active scene has already stopped being active — and that is the
     * callback that needs a window in order to install the cover.
     */
    private static func keyWindow() -> UIWindow? {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        let active = scenes.filter { $0.activationState == .foregroundActive }
        let pool = active.isEmpty ? scenes : active
        let windows = pool.flatMap { $0.windows }
        return windows.first(where: { $0.isKeyWindow }) ?? windows.first
    }

    private static func currentScreen() -> UIScreen? {
        let scene = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .first { $0.activationState == .foregroundActive }
        if let screen = scene?.screen { return screen }
        /* Deprecated on iOS 16 but still the only way to reach a screen when no
         * scene is foreground-active, which is precisely when a switcher
         * snapshot is taken. */
        return UIScreen.main
    }

    private static func detectMirroring() -> Bool {
        let screens = UIScreen.screens
        if screens.count > 1 { return true }
        return screens.contains { $0.mirroredScreen != nil }
    }

    /* ── Constants ─────────────────────────────────────── */

    /** Lets a stale cover be found and removed if this module is ever torn down
     *  without `removePrivacyCover()` running — an app killed mid-transition,
     *  for instance. A tagged view in the window is findable; an untagged one is
     *  indistinguishable from React's own. */
    private static let PRIVACY_COVER_TAG = 0x43_41_53_4E

    private static let SUBSTRATE_LIBRARIES = [
        "mobilesubstrate",
        "substrateloader",
        "substitute-loader",
        "cycript",
        "cydiasubstrate",
        "libhooker",
        "ellekit",
        "substrate",
        "sslkillswitch",
        "shadow",
        "libertylite",
    ]

    /**
     * Every entry here must be an artefact of jailbreak tooling.
     *
     * Paths that belong to a stock Darwin base system are deliberately absent,
     * `/bin/sh` in particular. Apple ships it, so whether `fileExists` reports it
     * depends on the iOS release and on what the app sandbox allows `stat()` to
     * see outside the container — neither of which this app controls. The cost of
     * getting that wrong is not symmetric: a false positive makes
     * `block_rooted_devices` refuse to open a book for a paying customer on an
     * unmodified iPhone, while a false negative leaves one detection technique
     * unused out of the twenty-eight below plus the dyld, environment, sandbox
     * and URL-scheme checks. `/bin/bash` stays because Apple has never shipped it
     * on iOS; it is a jailbreak artefact there even though it is not one on
     * macOS. The same reasoning removed `cancro`, `intel` and `lineage` from the
     * Android emulator lists in `ScreenShieldModule.kt`.
     */
    private static let JAILBREAK_PATHS = [
        "/Applications/Cydia.app",
        "/Applications/Sileo.app",
        "/Applications/Zebra.app",
        "/Applications/blackra1n.app",
        "/Applications/SBSettings.app",
        "/Applications/WinterBoard.app",
        "/Applications/IntelliScreen.app",
        "/Applications/Filza.app",
        "/Library/MobileSubstrate/MobileSubstrate.dylib",
        "/Library/MobileSubstrate/DynamicLibraries",
        "/usr/lib/substitute-inserter.dylib",
        "/usr/lib/libhooker.dylib",
        "/usr/lib/TweakInject",
        "/usr/libexec/ssh-keysign",
        "/usr/sbin/sshd",
        "/usr/bin/ssh",
        "/bin/bash",
        "/etc/apt",
        "/etc/ssh/sshd_config",
        "/private/var/lib/apt",
        "/private/var/lib/cydia",
        "/private/var/stash",
        "/private/var/tmp/cydia.log",
        "/var/cache/apt",
        "/var/log/syslog",
        "/var/jb",
        "/var/containers/Bundle/tweaksupport",
    ]
}
