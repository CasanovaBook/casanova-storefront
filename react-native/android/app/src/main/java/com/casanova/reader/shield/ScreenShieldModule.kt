package com.casanova.reader.shield

import android.app.Activity
import android.content.Context
import android.hardware.display.DisplayManager
import android.os.Build
import android.view.Display
import android.view.WindowManager
import com.casanova.reader.BuildConfig
import com.casanova.reader.MainActivity
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.io.File
import java.io.FileInputStream
import java.security.MessageDigest
import java.util.concurrent.atomic.AtomicInteger
import java.util.function.Consumer

/**
 * The Android half of the DRM contract in `src/drm/ScreenShield.tsx`.
 *
 * Android is the platform where capture can actually be *prevented* rather
 * than detected. Everything here follows from `WindowManager.FLAG_SECURE`:
 * the window is left out of the framebuffer that screenshots, screen
 * recordings, `adb shell screencap` and the recent-apps thumbnail all read
 * from, so a capture of the reader produces black. That is why this module
 * contains no attempt to hide content in response to a capture — by the time
 * a capture could be observed, the pixels in it are already useless.
 *
 * What the module adds on top of the flag, which `MainActivity` sets before
 * the first frame:
 *
 *  - A way for JavaScript to *release* the flag, because
 *    `drm_policies.block_screenshots` is a decision the CMS makes and an
 *    administrator who turns it off should see the effect.
 *  - Re-assertion around Activity recreation, which would otherwise drop it.
 *  - Screenshot attribution on API 34+, so the publisher learns that somebody
 *    tried even though the attempt produced nothing.
 *  - External-display detection, so mirroring is reported to `security_events`
 *    rather than happening silently.
 *  - Device integrity, root and emulator detection.
 *  - Two file-vault helpers: SHA-256 verification of a downloaded grant, and
 *    a backup-exclusion call that is a no-op here for the reason given below.
 *
 * Threading: React Native invokes `@ReactMethod`s on the native-modules queue,
 * which is a background thread. File work stays there; anything touching a
 * window is dispatched with `UiThreadUtil.runOnUiThread`.
 */
class ScreenShieldModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext), LifecycleEventListener {

    override fun getName(): String = MODULE_NAME

    /** Counts listeners so `removeListeners` can stop emitting when nothing is
     *  subscribed. Emitting into an empty bridge is cheap but not free, and on
     *  a display that flickers this fires often. */
    private val listenerCount = AtomicInteger(0)

    private var displayListener: DisplayManager.DisplayListener? = null

    /** API 34+ only. Held so it can be unregistered with the same instance the
     *  Activity was given — passing a different Consumer to
     *  `unregisterScreenCaptureCallback` silently does nothing. */
    private var screenCaptureCallback: Consumer<Int>? = null

    private var lastMirrored: Boolean? = null

    /* ── Lifecycle ─────────────────────────────────────── */

    override fun initialize() {
        super.initialize()
        reactContext.addLifecycleEventListener(this)
    }

    override fun onHostResume() {
        registerOsObservers()
    }

    override fun onHostPause() {
        /* Unregistered rather than left running: a paused app is exactly when
         * a display listener would fire for a change that concerns some other
         * window, and acting on it would conceal content for a reason that has
         * nothing to do with this app. */
        unregisterOsObservers()
    }

    override fun onHostDestroy() {
        unregisterOsObservers()
        reactContext.removeLifecycleEventListener(this)
    }

    override fun invalidate() {
        unregisterOsObservers()
        super.invalidate()
    }

    private fun registerOsObservers() {
        val activity = currentActivity ?: return

        if (displayListener == null) {
            val manager = displayManager()
            val listener = object : DisplayManager.DisplayListener {
                override fun onDisplayAdded(displayId: Int) = publishDisplays()
                override fun onDisplayRemoved(displayId: Int) = publishDisplays()
                override fun onDisplayChanged(displayId: Int) = publishDisplays()
            }
            displayListener = listener
            manager.registerDisplayListener(listener, null)
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE && screenCaptureCallback == null) {
            try {
                val callback = Consumer<Int> { publishScreenshotTaken() }
                screenCaptureCallback = callback
                activity.registerScreenCaptureCallback(activity.mainExecutor, callback)
            } catch (e: Throwable) {
                /* An OEM that removed the API, or a security exception from a
                 * locked-down build. Attribution is a nice-to-have; failing to
                 * register it must not fail the reader. */
                screenCaptureCallback = null
            }
        }

        /* Seed the JS side with the real state rather than letting it keep the
         * `false` it was constructed with — the app may have been resumed into
         * a state where a display was already attached. */
        publishDisplays(force = true)
    }

    private fun unregisterOsObservers() {
        displayListener?.let { displayManager().unregisterDisplayListener(it) }
        displayListener = null

        val callback = screenCaptureCallback
        if (callback != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            try {
                currentActivity?.unregisterScreenCaptureCallback(callback)
            } catch (e: Throwable) {
                /* Already gone. */
            }
        }
        screenCaptureCallback = null
    }

    /* ── Capture protection ────────────────────────────── */

    @ReactMethod
    fun enable(promise: Promise) {
        UiThreadUtil.runOnUiThread {
            val window = currentActivity?.window
            if (window == null) {
                /* Rejecting rather than resolving false: both fail closed in
                 * the JS layer, but a rejection carries the reason into the
                 * log, and "no activity" and "the flag did not take" are
                 * different problems to chase. */
                promise.reject(
                    "E_NO_ACTIVITY",
                    "Cannot protect the window: no Activity is attached"
                )
                return@runOnUiThread
            }
            window.setFlags(SECURE_FLAG, SECURE_FLAG)
            MainActivity.isShieldSuppressedByPolicy = false
            promise.resolve(isFlagSet(window))
        }
    }

    @ReactMethod
    fun disable(promise: Promise) {
        UiThreadUtil.runOnUiThread {
            val window = currentActivity?.window
            if (window == null) {
                promise.resolve(null)
                return@runOnUiThread
            }
            window.clearFlags(SECURE_FLAG)
            /* Tells MainActivity not to put the flag back on the next focus
             * change. Without this, releasing protection would last exactly as
             * long as the next window recreation. */
            MainActivity.isShieldSuppressedByPolicy = true
            promise.resolve(null)
        }
    }

    @ReactMethod
    fun isShieldActive(promise: Promise) {
        UiThreadUtil.runOnUiThread {
            val window = currentActivity?.window
            promise.resolve(window != null && isFlagSet(window))
        }
    }

    /**
     * Always resolves false on Android, and that is the correct answer rather
     * than a missing implementation.
     *
     * The iOS side uses this to decide whether to cover the screen with an
     * opaque view, because on iOS the screenshot has already been taken by the
     * time it can be observed and the only remaining defence is to stop the
     * *recording* from getting the next frame. On Android FLAG_SECURE has
     * already removed this window from every capture surface, so there is no
     * frame to conceal — covering the screen would hide the book from the
     * legitimate reader while adding nothing against anyone else.
     *
     * `onCaptureChanged` is therefore never emitted here either, which is why
     * the JS comment says Android does not fire it.
     */
    @ReactMethod
    fun isCaptured(promise: Promise) {
        promise.resolve(false)
    }

    /**
     * True when any display other than the built-in one is attached: HDMI,
     * Miracast, Chromecast, a desktop-mode dock, or the virtual display a
     * MediaProjection session creates.
     *
     * FLAG_SECURE covers all of them, so this is not the protection — it is
     * the signal that lets the CMS see that a book was read on a second
     * screen, and that lets the app tell the customer why the overlay appeared
     * (`shouldConceal` in the JS includes `mirrored`, deliberately: reading a
     * purchased book on a projector is a different act from reading it on a
     * phone and the publisher gets to decide whether to allow it).
     *
     * The check is by display count, not by display type, because
     * `Display.getType()` is not public API. The consequence is that an OEM
     * which reports a phantom secondary display would conceal the reader for
     * no reason; that is why the display name and state are included in the
     * emitted event, so the report in `security_events` identifies the device
     * and the display rather than leaving an unexplained blank screen.
     */
    @ReactMethod
    fun isMirrored(promise: Promise) {
        promise.resolve(externalDisplays().isNotEmpty())
    }

    /* ── Device integrity ──────────────────────────────── */

    /**
     * Self-reported heuristics. There is no way to make a root check
     * trustworthy from inside the app being run on the rooted device: whatever
     * it looks for can be hidden by the same root that is being detected.
     *
     * That is why the value is treated as a claim. It is sent to the server in
     * `X-Casanova-Device-Model`-adjacent headers and stored on
     * `device_sessions.device_integrity`, and the decision that actually
     * refuses to hand over a book is made there, by
     * `drm_policies.block_rooted_devices`. A hardened deployment adds Play
     * Integrity on top of this; the verdict type already has a value for the
     * attestation being unavailable, which is what an absent Play Services
     * produces.
     */
    @ReactMethod
    fun deviceIntegrity(promise: Promise) {
        /* Runs on the native-modules thread: the checks stat a dozen files and
         * read system properties, which is not work for the UI thread. */
        promise.resolve(detectIntegrity())
    }

    private fun detectIntegrity(): String {
        if (detectEmulator()) {
            /* Relaxed in debug builds only, and only for emulation.
             *
             * Without this the app cannot be developed at all: every Android
             * emulator reports EMULATOR, and `block_rooted_devices` in the
             * restrictive default policy would refuse to open a book before
             * the reader could be tested. Root detection is deliberately NOT
             * relaxed here, because the block-on-root path is the one that
             * needs exercising on a real device anyway.
             *
             * A release build reports EMULATOR and the reader refuses. The
             * distinction is `BuildConfig.DEBUG`, which is a property of the
             * signed binary and not of anything a user can change at runtime.
             */
            return if (BuildConfig.DEBUG) INTEGRITY_UNKNOWN else INTEGRITY_EMULATOR
        }
        if (detectRoot()) return INTEGRITY_ROOTED

        /* `TRUSTED`, and what that word is allowed to mean here has to be
         * stated plainly: no local indicator of compromise was found. It is
         * not an attestation, and it cannot be one, because nothing in this
         * build talks to a hardware-backed service that could vouch for it.
         *
         * The tempting alternative — reporting `ATTESTATION_FAILED` until Play
         * Integrity is wired up — must not be used. That value is in
         * `COMPROMISED_INTEGRITY` on the JavaScript side, so returning it would
         * make `drm_policies.block_rooted_devices` refuse to open a book on
         * every unmodified Android phone in existence. A DRM client that blocks
         * its entire legitimate audience protects nothing; it just gets
         * uninstalled.
         *
         * The absence of real attestation is a server-side decision, not a
         * client-side one: an operator who requires hardware proof adds the
         * Play Integrity API, verifies the token where the grant is minted, and
         * lets `issueContentGrant` refuse what this module would have approved.
         * `ATTESTATION_FAILED` stays in the shared type for that build, and is
         * produced today only by the JavaScript layer when this module is
         * missing from the binary altogether — a genuinely broken install,
         * which is the case where blocking is correct.
         */
        return INTEGRITY_TRUSTED
    }

    private fun detectEmulator(): Boolean {
        val hardware = Build.HARDWARE.lowercase()
        val product = Build.PRODUCT.lowercase()
        val manufacturer = Build.MANUFACTURER.lowercase()
        val brand = Build.BRAND.lowercase()
        val device = Build.DEVICE.lowercase()
        val model = Build.MODEL.lowercase()
        val fingerprint = Build.FINGERPRINT.lowercase()

        if (hardware in EMULATOR_HARDWARE) return true
        if (EMULATOR_PRODUCT_TOKENS.any { product.contains(it) }) return true
        if (manufacturer.contains("genymotion")) return true
        if (brand.startsWith("generic") && device.startsWith("generic")) return true
        if (fingerprint.startsWith("generic") || fingerprint.startsWith("unknown")) return true
        if (fingerprint.contains("vbox") || fingerprint.contains("test-keys")) return true
        if (model.contains("google_sdk") || model.contains("droid4x") || model.contains("emulator")) return true
        if (systemProperty("ro.kernel.qemu") == "1") return true

        /* BlueStacks, NoxPlayer, LDPlayer and the rest announce themselves
         * through properties that change between releases, so the file check
         * matters as much as the string check. */
        return EMULATOR_FILES.any { File(it).exists() }
    }

    private fun detectRoot(): Boolean {
        if (Build.TAGS != null && Build.TAGS!!.contains("test-keys")) return true

        val flavor = systemProperty("ro.build.flavor")
        if (flavor.contains("-userdebug") || flavor.contains("-test-keys")) return true
        if (systemProperty("ro.debuggable") == "1") return true
        if (systemProperty("ro.secure") == "0") return true
        /* A retail ("user") build ships with ADB authorisation enforced. One
         * that does not has had its properties rewritten, which no unmodified
         * device does. */
        if (systemProperty("ro.build.type") == "user" && systemProperty("ro.adb.secure") == "0") return true

        if (ROOT_FILES.any { File(it).exists() }) return true

        /* Package check last: it needs the PackageManager and is the slowest of
         * the three, and the file check catches the overwhelming majority. */
        return ROOT_PACKAGES.any { isPackageInstalled(it) }
    }

    private fun isPackageInstalled(pkg: String): Boolean = try {
        reactContext.packageManager.getPackageInfo(pkg, 0)
        true
    } catch (e: Throwable) {
        false
    }

    private fun systemProperty(key: String): String = try {
        /* `android.os.SystemProperties` is not public API, so it is reached by
         * reflection. When the call fails the honest answer is an empty string,
         * which none of the callers match against. */
        val clazz = Class.forName("android.os.SystemProperties")
        val get = clazz.getMethod("get", String::class.java, String::class.java)
        (get.invoke(null, key, "") as? String) ?: ""
    } catch (e: Throwable) {
        ""
    }

    /* ── File vault helpers ────────────────────────────── */

    /**
     * Resolves false and does nothing.
     *
     * Not a stub that was never finished. Android's backup story is decided in
     * the manifest, per app rather than per file: `android:allowBackup="false"`
     * plus `res/xml/data_extraction_rules.xml`, which excludes every domain
     * from both cloud backup and device-to-device transfer. There is no
     * per-path equivalent of iOS's `NSURLIsExcludedFromBackupKey`, and a file
     * written into `getFilesDir()` is not reachable by any other app or by a
     * backup that the manifest has already refused.
     *
     * The JS vault calls this unconditionally and ignores a false answer, so
     * the two platforms can share one code path.
     */
    @ReactMethod
    fun excludeFromBackup(path: String, promise: Promise) {
        promise.resolve(false)
    }

    /**
     * SHA-256 of a file, lowercase hex.
     *
     * Compared by `SecureFileVault.fetchToVault` against the `checksum` on the
     * redeemed grant. Without it, a truncated download — a captive portal
     * interstitial, a proxy that closes early, a full disk that silently stops
     * writing — would be handed to the PDF renderer as though it were the book.
     * The renderer would then either fail or, worse, render the pages it did
     * receive and report success.
     *
     * Resolves an empty string rather than rejecting when hashing is
     * unavailable, because the vault treats empty as "skip the check" and a
     * rejection would be treated as a mismatch and destroy a file that is
     * probably fine.
     */
    @ReactMethod
    fun sha256File(path: String, promise: Promise) {
        val file = File(path)
        if (!file.exists() || !file.isFile) {
            promise.resolve("")
            return
        }
        try {
            val digest = MessageDigest.getInstance("SHA-256")
            FileInputStream(file).use { input ->
                val buffer = ByteArray(HASH_BUFFER_BYTES)
                while (true) {
                    val read = input.read(buffer)
                    if (read <= 0) break
                    digest.update(buffer, 0, read)
                }
            }
            promise.resolve(digest.digest().joinToString("") { "%02x".format(it) })
        } catch (e: Throwable) {
            promise.resolve("")
        }
    }

    /**
     * Resolves true without doing anything.
     *
     * The iOS implementation of this walks the window hierarchy to disable
     * PDFKit's long-press recognisers, because PDFKit renders selectable text
     * and selection comes with a Copy menu. Android's `react-native-pdf` uses
     * pdfium through a plain bitmap-backed view: pages are rasterised, there is
     * no text layer, and there is nothing to select. The Copy/Share problem
     * does not exist on this platform, so there is nothing to disable.
     *
     * Returning true rather than false matters — the reader uses the answer to
     * decide whether to warn the customer that text can still be lifted. On
     * Android it cannot, and saying so is more useful than a warning that does
     * not apply.
     */
    @ReactMethod
    fun restrictDocumentInteraction(promise: Promise) {
        promise.resolve(true)
    }

    /* ── Events ────────────────────────────────────────── */

    /**
     * Required by NativeEventEmitter.
     *
     * Without these two methods the emitter logs "sending `addListener` event
     * to a module that does not support it" on every subscription, and on some
     * React Native versions it throws instead of warning.
     */
    @ReactMethod
    fun addListener(eventName: String) {
        listenerCount.incrementAndGet()
        /* Subscribing is the moment to publish the current state: the JS layer
         * seeds from `isCaptured()`/`isMirrored()`, but a display attached
         * between the seed and the subscription would otherwise go unreported
         * until the next change. */
        publishDisplays(force = true)
    }

    @ReactMethod
    fun removeListeners(count: Int) {
        listenerCount.updateAndGet { current -> (current - count).coerceAtLeast(0) }
    }

    private fun publishDisplays(force: Boolean = false) {
        if (listenerCount.get() <= 0) return
        val external = externalDisplays()
        val mirrored = external.isNotEmpty()
        if (!force && mirrored == lastMirrored) return
        lastMirrored = mirrored

        val payload = Arguments.createMap().apply {
            putBoolean("mirrored", mirrored)
            if (mirrored) {
                /* Recorded so a false positive is diagnosable from the
                 * `security_events` row alone, without needing the device in
                 * hand. */
                putString(
                    "detail",
                    external.joinToString("; ") { "${it.displayName}#${it.displayId}:${it.state}" }
                )
            }
        }
        emit("onMirrorChanged", payload)
    }

    private fun publishScreenshotTaken() {
        if (listenerCount.get() <= 0) return
        val payload = Arguments.createMap().apply {
            putString("kind", "screenshot")
        }
        emit("onScreenshotTaken", payload)
    }

    private fun emit(eventName: String, payload: WritableMap) {
        if (!reactContext.hasActiveReactInstance()) return
        try {
            reactContext
                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                .emit(eventName, payload)
        } catch (e: Throwable) {
            /* The bridge can tear down between the check and the emit during a
             * reload. Dropping the event is right: the alternative is crashing
             * an app that is protecting a book. */
        }
    }

    /* ── Helpers ───────────────────────────────────────── */

    private fun displayManager(): DisplayManager =
        reactContext.getSystemService(Context.DISPLAY_SERVICE) as DisplayManager

    private fun externalDisplays(): List<Display> =
        displayManager().displays.filter { it.displayId != Display.DEFAULT_DISPLAY }

    private fun isFlagSet(window: android.view.Window): Boolean =
        (window.attributes.flags and SECURE_FLAG) == SECURE_FLAG

    companion object {
        const val MODULE_NAME = "ScreenShield"

        private const val SECURE_FLAG = WindowManager.LayoutParams.FLAG_SECURE
        private const val HASH_BUFFER_BYTES = 64 * 1024

        /** Kept in step with `DeviceIntegrity` in `src/net/types.ts`. A typo
         *  here is not a compile error — it is a value the server has never
         *  seen, and the CHECK constraint on `device_sessions.device_integrity`
         *  rejects the row.
         *
         *  `ATTESTATION_FAILED` is in that type but is not produced here; see
         *  the note at the end of `detectIntegrity()`. `JAILBROKEN` is the iOS
         *  spelling of the same verdict. */
        private const val INTEGRITY_UNKNOWN = "UNKNOWN"
        private const val INTEGRITY_TRUSTED = "TRUSTED"
        private const val INTEGRITY_ROOTED = "ROOTED"
        private const val INTEGRITY_EMULATOR = "EMULATOR"

        /** Only hardware a virtual machine reports. `cancro` (Xiaomi Mi 3/4) and
         *  `intel` (ASUS Zenfone) are real devices that a broader list would
         *  refuse to open a book on, which is the failure mode worth avoiding
         *  most: a false positive here is indistinguishable, to the customer,
         *  from the app being broken. */
        private val EMULATOR_HARDWARE = setOf(
            "goldfish", "ranchu", "vbox86", "ttVM_x86", "nox", "andy"
        )

        /** Substrings matched against `Build.PRODUCT`. `lineage` is absent on
         *  purpose: LineageOS runs on real hardware and is a custom ROM, not a
         *  virtual machine. If the operator wants to refuse custom ROMs that is
         *  a `block_rooted_devices` decision, and most Lineage installs are
         *  caught by the root checks anyway. */
        private val EMULATOR_PRODUCT_TOKENS = listOf(
            "sdk", "google_sdk", "emulator", "android_sdk", "sdk_google",
            "sdk_x86", "sdk_gphone", "vbox86p", "nox", "bluestacks",
            "droid4x", "ldplayer", "memu"
        )

        /** Character devices and fstab entries a hypervisor has to expose.
         *  Other apps' `/data/data` directories are deliberately not listed:
         *  SELinux makes `File.exists()` return false for them unconditionally,
         *  so they would only ever produce a false negative and give a reader
         *  of this list confidence that does not exist. */
        private val EMULATOR_FILES = listOf(
            "/dev/socket/genyd", "/dev/socket/baseband_genyd",
            "/fstab.goldfish", "/fstab.ranchu",
            "/sys/bus/platform/drivers/goldfish_pipe",
            "/system/lib/libc_malloc_debug_qemu.so",
            "/dev/qemu_pipe", "/dev/goldfish_pipe", "/dev/socket/qemud"
        )

        /** Paths where a `su` binary or a root manager leaves something behind.
         *  Includes the Magisk locations, which do not use the word "su" and
         *  are missed by the classic list. `/system/xbin/which` is absent from
         *  the classic list's usual companion entries because it is a normal
         *  POSIX utility present on some unmodified builds. */
        private val ROOT_FILES = listOf(
            "/system/app/Superuser.apk",
            "/system/app/SuperSU.apk",
            "/system/xbin/su", "/system/bin/su", "/sbin/su",
            "/system/sd/xbin/su", "/system/bin/failsafe/su",
            "/system/xbin/daemonsu", "/system/xbin/su-binary",
            "/data/local/su", "/data/local/bin/su", "/data/local/xbin/su",
            "/su/bin/su", "/cache/su", "/system/etc/.has_su_daemon",
            "/system/etc/init.d/99SuperSUDaemon",
            "/data/adb/magisk", "/data/adb/magisk.db", "/sbin/.magisk",
            "/data/adb/modules", "/cache/.supersu", "/data/.supersu",
            "/system/bin/.ext/.su"
        )

        /** Installed-package indicators. Checked last because it goes through
         *  the PackageManager, and a rooted device can hide a package from it
         *  far more easily than it can hide a file from a `stat`. */
        private val ROOT_PACKAGES = listOf(
            "com.topjohnwu.magisk",
            "eu.chainfire.supersu",
            "com.noshufou.android.su",
            "com.noshufou.android.su.elite",
            "com.thirdparty.superuser",
            "com.yellowes.su",
            "com.koushikdutta.superuser",
            "com.zachspong.temprootremovejb",
            "com.amphoras.hidemyroot",
            "com.amphoras.hidemyrootadfree",
            "com.formyhm.hideroot",
            "com.formyhm.hiderootPremium",
            "com.devadvance.rootcloak",
            "com.devadvance.rootcloakplus",
            "de.robv.android.xposed.installer",
            "com.saurik.substrate",
            "com.kingouser.com"
        )
    }
}
