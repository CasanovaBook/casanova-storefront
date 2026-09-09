/* ─────────────────────────────────────────────────────────────
 * ScreenShield — capture protection for the native reader.
 *
 * WHAT EACH PLATFORM CAN ACTUALLY DO
 *
 * Android has a real answer. `WindowManager.LayoutParams.FLAG_SECURE`
 * makes the window invisible to every capture path the OS owns:
 * screenshots are refused with "Can't take screenshot due to security
 * policy", screen recording produces a black frame, the recents
 * thumbnail is blank, and Miracast/Chromecast mirroring is refused.
 * There is nothing for JavaScript to detect, because nothing gets
 * through. This module still reports events on Android so the reader
 * can tell "protection is on" from "protection failed to install" —
 * a device where FLAG_SECURE did not take is a device that must not be
 * shown the file.
 *
 * iOS has no blocking API. Apple deliberately does not let an app
 * prevent a screenshot. The accepted pattern, and what this implements,
 * is detection plus immediate concealment:
 *   - `UIScreen.capturedDidChangeNotification` fires the instant a
 *     recording or mirroring session starts, and the overlay covers the
 *     content before the next frame is composited.
 *   - `UIScreen.connectDidChangeNotification` catches AirPlay and
 *     wired mirroring specifically, which is reported separately
 *     because `MIRROR_DETECTED` is a different security event from
 *     `RECORDING_DETECTED`.
 *   - `userDidTakeScreenshotNotification` cannot stop the capture, so
 *     it is used for attribution: the event is written to
 *     `security_events` with the account, the product and the device
 *     session attached.
 *   - A hidden `UITextField` with `isSecureTextEntry = true` is placed
 *     in the window's layer tree. iOS excludes secure-entry layers from
 *     the app-switcher snapshot, which stops the book appearing in the
 *     multitasking card.
 *
 * The honest summary: on Android capture is prevented, on iOS it is
 * detected and the content is gone from the frame that got captured.
 * Both write the same audit trail, which is what makes a leak traceable
 * either way.
 * ───────────────────────────────────────────────────────────── */

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"

import {
  AppState,
  NativeEventEmitter,
  NativeModules,
  Platform,
  StyleSheet,
  Text,
  View,
  type AppStateStatus,
  type EmitterSubscription,
} from "react-native"

import type { DeviceIntegrity } from "../net/types"

import { colors, fontSize, spacing } from "../theme"

/* ── Native module contract ───────────────────────────── */

/**
 * Implemented by `android/.../shield/ScreenShieldModule.kt` and
 * `ios/CasanovaReader/ScreenShield.swift`. Both are in this repository;
 * neither is optional, and `supported === false` is treated by the
 * reader as a hard failure rather than as "protection off".
 */

export interface ScreenShieldNative {
  /** Turn capture protection on for the current window. */

  enable(): Promise<boolean>

  /** Turn it off. Called on unmount and on logout. */

  disable(): Promise<void>

  /** Whether the OS reports the screen as being captured right now. */

  isCaptured(): Promise<boolean>

  /** Whether an external display / AirPlay / cast session is attached. */

  isMirrored(): Promise<boolean>

  /** Whether the protection layer is actually installed and active. */

  isShieldActive(): Promise<boolean>

  /** Root / jailbreak / emulator verdict. See `probeIntegrity`. */

  deviceIntegrity(): Promise<DeviceIntegrity>

  /* ── File-vault helpers ─────────────────────────────────
   * Implemented here rather than in a second module because they are
   * the same concern: keeping protected bytes out of reach. Used by
   * `SecureFileVault`. */

  /** iOS: set `NSURLIsExcludedFromBackupKey` on a path so a Finder or
   *  iTunes restore onto another phone does not carry the book with it.
   *  Android: resolves false and does nothing, because the vault is in
   *  internal storage and `allowBackup` is already false. */

  excludeFromBackup(path: string): Promise<boolean>

  /** SHA-256 of a file, matched against the grant's `checksum`. Resolves
   *  an empty string when hashing is unavailable, which the vault treats
   *  as "skip the check" rather than as a mismatch. */

  sha256File(path: string): Promise<string>

  /**
   * Reduces what a reader can lift out of an open document.
   *
   * iOS renders PDFs through PDFKit, whose view supports long-press text
   * selection and the Copy/Share menu that comes with it — a way to
   * extract passages that has nothing to do with screenshots. This walks
   * the window hierarchy, finds the document view and disables its
   * long-press recognisers, which removes selection while leaving scroll
   * and pinch-zoom alone.
   *
   * Android's `PdfRenderer` has no selectable text layer at all, so the
   * implementation resolves true without doing anything.
   *
   * This is a mitigation, not a guarantee: it is why the reader tells the
   * user, in the protection sheet, that a determined person on iOS can
   * still transcribe what they can see. Pretending otherwise would be
   * worse than saying so.
   */

  restrictDocumentInteraction(): Promise<boolean>

  /* Required by NativeEventEmitter on Android. */

  addListener(eventName: string): void

  removeListeners(count: number): void
}

interface CaptureEvent {
  captured: boolean
}

interface MirrorEvent {
  mirrored: boolean
}

interface ScreenshotEvent {
  /** Which capture path fired. Used only as event metadata. */

  kind?: "screenshot" | "recording" | "mirror"
}

const Native: ScreenShieldNative | undefined =
  NativeModules.ScreenShield as ScreenShieldNative | undefined ?? undefined

/** True when the native shield is present in the binary at all. */

export const SCREEN_SHIELD_AVAILABLE = Boolean(Native)

/**
 * Reads the device integrity verdict once and caches it.
 *
 * Caching matters: the check walks the filesystem for `su` binaries and
 * reads build properties, and doing that on every render of every screen
 * is wasted work. A device does not become un-rooted while the app runs.
 *
 * The verdict is self-reported and therefore spoofable, which is why the
 * server also decides. `drm_policies.block_rooted_devices` is enforced
 * when a grant is minted, not when this function returns.
 */

let cachedIntegrity: DeviceIntegrity | null = null

export async function probeIntegrity(): Promise<DeviceIntegrity> {
  if (cachedIntegrity) return cachedIntegrity

  if (!Native) {
    /* No native module means no attestation, which is not the same as a
     * trusted device. `ATTESTATION_FAILED` is the honest verdict and it
     * is the one the server refuses. */

    cachedIntegrity = "ATTESTATION_FAILED"

    return cachedIntegrity
  }

  try {
    cachedIntegrity = await Native.deviceIntegrity()
  } catch {
    cachedIntegrity = "ATTESTATION_FAILED"
  }

  return cachedIntegrity
}

export const COMPROMISED_INTEGRITY: readonly DeviceIntegrity[] = [
  "ROOTED",

  "JAILBROKEN",

  "ATTESTATION_FAILED",

  "EMULATOR",
]

export function isCompromised(integrity: DeviceIntegrity): boolean {
  return COMPROMISED_INTEGRITY.includes(integrity)
}

/**
 * Called by the reader once the document view exists.
 *
 * Safe to call repeatedly and safe to call when the native module is
 * missing: it resolves false rather than throwing, because a screen that
 * crashes on a protection helper is a screen that shows no book at all.
 */

export async function restrictDocumentInteraction(): Promise<boolean> {
  if (!Native) return false

  try {
    return await Native.restrictDocumentInteraction()
  } catch {
    return false
  }
}

/* ── Hook ─────────────────────────────────────────────── */

export interface ScreenShieldOptions {
  /** Whether protection should be on. Pass false on public screens so
   *  the marketing pages can be screenshotted — refusing that would be
   *  a defect, not a feature. */

  active?: boolean

  /** Hide content when the app leaves the foreground. Driven by
   *  `drm_policies.hide_content_on_blur`. */

  hideOnBlur?: boolean

  /** Called for every protection event so the caller can report it to
   *  `security_events` with its own session and product context. */

  onEvent?: (
    type: "SCREENSHOT_BLOCKED" | "RECORDING_DETECTED" | "MIRROR_DETECTED" | "VISIBILITY_HIDDEN",
    detail?: string,
  ) => void
}

export interface ScreenShieldState {
  /** The native module is linked into this build. */

  supported: boolean

  /** Protection was requested and `enable()` confirmed it took. */

  protected: boolean

  /** `enable()` was called and did NOT confirm. Content must not render. */

  shieldFailed: boolean

  captured: boolean

  mirrored: boolean

  backgrounded: boolean

  integrity: DeviceIntegrity

  /** Derived: true whenever the overlay should be covering the content. */

  shouldConceal: boolean
}

export function useScreenShield({
  active = true,

  hideOnBlur = true,

  onEvent,
}: ScreenShieldOptions = {}): ScreenShieldState {
  const [protectedNow, setProtectedNow] = useState(false)

  const [shieldFailed, setShieldFailed] = useState(false)

  const [captured, setCaptured] = useState(false)

  const [mirrored, setMirrored] = useState(false)

  const [backgrounded, setBackgrounded] = useState(
    () => AppState.currentState !== "active",
  )

  const [integrity, setIntegrity] = useState<DeviceIntegrity>("UNKNOWN")

  /* The reporting callback is held in a ref so that a screen passing an
   * inline arrow function does not tear down and rebuild the native
   * listeners on every render. Rebuilding them repeatedly can drop the
   * event that matters — the one fired at the moment of capture. */

  const onEventRef = useRef(onEvent)

  useEffect(() => {
    onEventRef.current = onEvent
  }, [onEvent])

  /* Integrity probe: once, as early as possible. */

  useEffect(() => {
    let cancelled = false

    probeIntegrity().then((value) => {
      if (!cancelled) setIntegrity(value)
    })

    return () => {
      cancelled = true
    }
  }, [])

  /* Enable / disable the native protection for as long as this screen
   * wants it. `enable()` resolves with a boolean rather than void: the
   * module reports whether the flag actually took, and a false answer is
   * the difference between "protected" and "we tried". */

  useEffect(() => {
    if (!Native) {
      setShieldFailed(true)

      return
    }

    let cancelled = false

    if (active) {
      Native.enable()

        .then((confirmed) => {
          if (cancelled) return

          setProtectedNow(confirmed)

          setShieldFailed(!confirmed)
        })

        .catch(() => {
          if (!cancelled) {
            setProtectedNow(false)

            setShieldFailed(true)
          }
        })

      /* Seed the live flags from the OS rather than assuming false, so a
       * screen mounted mid-recording starts concealed instead of
       * revealing content until the next notification arrives. */

      Native.isCaptured()
        .then((v) => !cancelled && setCaptured(v))
        .catch(() => undefined)

      Native.isMirrored()
        .then((v) => !cancelled && setMirrored(v))
        .catch(() => undefined)
    } else {
      setProtectedNow(false)

      setShieldFailed(false)
    }

    return () => {
      cancelled = true

      if (active) Native?.disable().catch(() => undefined)
    }
  }, [active])

  /* Live notifications from the native side. */

  useEffect(() => {
    if (!Native) return

    const emitter = new NativeEventEmitter(NativeModules.ScreenShield)

    const subscriptions: EmitterSubscription[] = [
      emitter.addListener("onCaptureChanged", (event: CaptureEvent) => {
        const next = Boolean(event?.captured)

        setCaptured(next)

        if (next)
          onEventRef.current?.(
            "RECORDING_DETECTED",
            "הקלטת מסך או לכידה זוהתה על ידי מערכת ההפעלה",
          )
      }),

      emitter.addListener("onMirrorChanged", (event: MirrorEvent) => {
        const next = Boolean(event?.mirrored)

        setMirrored(next)

        if (next)
          onEventRef.current?.(
            "MIRROR_DETECTED",
            "שיקוף מסך או חיבור לתצוגה חיצונית זוהה",
          )
      }),

      emitter.addListener("onScreenshotTaken", (event: ScreenshotEvent) => {
        /* Attribution, not defence, and the two platforms arrive at it from
         * opposite directions.
         *
         * iOS: the shot already exists before `userDidTakeScreenshotNotification`
         * fires, so nothing can be done about it. Recording the attempt is the
         * only useful response.
         *
         * Android: from API 34 `Activity.registerScreenCaptureCallback` reports
         * a screenshot of this window. FLAG_SECURE has already emptied it, so
         * again there is nothing to prevent — but the CMS gets to see that a
         * customer tried, on which device, during which session. Below API 34
         * there is no callback and no permission-free substitute, so the event
         * simply never arrives; the absence of a row means "not observable",
         * never "not attempted". */

        onEventRef.current?.("SCREENSHOT_BLOCKED", event?.kind ?? "screenshot")
      }),
    ]

    return () => subscriptions.forEach((sub) => sub.remove())
  }, [])

  /* Foreground / background. */

  useEffect(() => {
    const subscription = AppState.addEventListener(
      "change",
      (state: AppStateStatus) => {
        const next = state !== "active"

        setBackgrounded(next)

        if (next && hideOnBlur)
          onEventRef.current?.("VISIBILITY_HIDDEN", "האפליקציה עברה לרקע")
      },
    )

    return () => subscription.remove()
  }, [hideOnBlur])

  const shouldConceal =
    active && (captured || mirrored || (hideOnBlur && backgrounded))

  return useMemo(
    () => ({
      supported: Boolean(Native),

      protected: active && protectedNow,

      shieldFailed: active && shieldFailed,

      captured,

      mirrored,

      backgrounded,

      integrity,

      shouldConceal,
    }),

    [
      active,
      protectedNow,
      shieldFailed,
      captured,
      mirrored,
      backgrounded,
      integrity,
      shouldConceal,
    ],
  )
}

/* ── Provider and overlay ─────────────────────────────── */

const ShieldContext = createContext<ScreenShieldState>({
  supported: SCREEN_SHIELD_AVAILABLE,

  protected: false,

  shieldFailed: false,

  captured: false,

  mirrored: false,

  backgrounded: false,

  integrity: "UNKNOWN",

  shouldConceal: false,
})

export function useScreenShieldContext(): ScreenShieldState {
  return useContext(ShieldContext)
}

/**
 * Wraps the authenticated part of the app.
 *
 * Mounted above the navigator rather than inside one screen so that the
 * overlay covers navigation chrome too: a back-swipe animation that
 * reveals the reader for one frame defeats the purpose.
 */

export function ScreenShieldProvider({
  active = true,

  hideOnBlur = true,

  onEvent,

  children,
}: ScreenShieldOptions & { children: ReactNode }) {
  const state = useScreenShield({ active, hideOnBlur, onEvent })

  return (
    <ShieldContext.Provider value={state}>
      {children}
      {state.shouldConceal && (
        <ShieldOverlay
          title="התוכן מוגן"
          message={
            state.captured
              ? "זוהתה הקלטת מסך — התוכן הוסתר להגנה על זכויות היוצרים."
              : state.mirrored
                ? "זוהה שיקוף מסך או חיבור לתצוגה חיצונית — נתקו את השיקוף כדי להמשיך לקרוא."
                : "התוכן מוסתר בזמן שהאפליקציה ברקע."
          }
        />
      )}
    </ShieldContext.Provider>
  )
}

/**
 * The full-screen cover.
 *
 * `pointerEvents="none"` is deliberate: the overlay must not swallow
 * touches, because the reader underneath stays mounted and has to
 * respond the moment the capture stops. An opaque view that also blocks
 * input would leave the app unusable after a false positive.
 */

export function ShieldOverlay({
  title,
  message,
}: {
  title: string
  message: string
}) {
  return (
    <View style={styles.overlay} pointerEvents="none">
      <Text style={styles.overlayTitle}>{title}</Text>
      <Text style={styles.overlayMessage}>{message}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,

    zIndex: 9999,

    elevation: 9999,

    /* Fully opaque. Any alpha at all lets the captured frame show the
     * page underneath, which is the whole thing this exists to prevent. */

    backgroundColor: colors.shield,

    alignItems: "center",

    justifyContent: "center",

    paddingHorizontal: spacing.xxl,
  },

  overlayTitle: {
    color: colors.primary,

    fontSize: fontSize.xl,

    fontWeight: "700",

    marginBottom: spacing.sm,

    textAlign: "center",
  },

  overlayMessage: {
    color: colors.muted,

    fontSize: fontSize.sm,

    lineHeight: 22,

    textAlign: "center",
  },
})

/** Convenience for screens that only need to know "may I render?". */

export function useConcealment(active = true): boolean {
  const state = useScreenShieldContext()

  return active && state.shouldConceal
}

/** Platform note surfaced in the reader's protection sheet, so the
 *  difference between Android and iOS is documented for the user
 *  instead of being discovered by them. */

export const PLATFORM_PROTECTION_NOTE =
  Platform.OS === "android"
    ? "באנדרואיד צילום מסך והקלטת מסך נחסמים על ידי מערכת ההפעלה."
    : "ב־iOS צילום מסך אינו ניתן לחסימה על ידי אפליקציה. התוכן מוסתר מיד עם זיהוי ההקלטה, וכל צילום מתועד ומשויך לחשבון שלכם."

export default ScreenShieldProvider
