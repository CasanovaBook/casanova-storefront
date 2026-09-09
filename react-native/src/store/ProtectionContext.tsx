/* ─────────────────────────────────────────────────────────────
 * Protection context — one shield for the whole app.
 *
 * The screen shield is mounted above the navigator rather than inside
 * the reader screen, for two reasons:
 *
 *  - A per-screen shield leaves the transitions unprotected. An iOS
 *    swipe-back or an Android shared-element animation shows the reader
 *    for a frame or two outside the screen that owns the shield, which
 *    is exactly the frame a screen recording captures.
 *
 *  - Only one thing can own `FLAG_SECURE` at a time. Two nested
 *    providers would fight over it, and the loser's `disable()` on
 *    unmount would switch protection off while the other still believes
 *    it is on.
 *
 * What this context adds is policy. The CMS decides whether screenshots
 * and recording are blocked at all, and that decision is applied here,
 * so the reader screen only has to read the resulting state and report
 * against its own product and session.
 * ───────────────────────────────────────────────────────────── */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"

import type { DrmPolicy, SecurityEventType } from "../net/types"

import { RESTRICTIVE_POLICY } from "../net/types"

import {
  ShieldOverlay,
  useScreenShield,
  type ScreenShieldState,
} from "../drm/ScreenShield"

/** The subset of `security_events` the shield itself can raise. */

export type ShieldEventType = "SCREENSHOT_BLOCKED" | "RECORDING_DETECTED" | "MIRROR_DETECTED" | "VISIBILITY_HIDDEN"

export type ProtectionReporter = (
  type: SecurityEventType,
  detail?: string,
) => void

export interface ProtectionState
  extends ScreenShieldState {

  /** The policy currently in force. Starts restrictive and is replaced by
   *  the one the server returns for this device session. */

  /** Send a protection event to `security_events` through the attached
   *  reporter, which is normally the open reader. */

  /** Called by the reader on mount and cleared on unmount. */
  policy: DrmPolicy

  setPolicy: (policy: DrmPolicy) => void

  report: ProtectionReporter

  attachReporter: (fn: ProtectionReporter | null) => void
}

const ProtectionContext = createContext<ProtectionState | null>(null)

export function ProtectionProvider({ children }: { children: ReactNode }) {
  const [policy, setPolicyState] = useState<DrmPolicy>(RESTRICTIVE_POLICY)

  /* A ref rather than state: attaching a reporter must not re-render the
   * shield, because re-rendering re-runs its effect and a capture event
   * arriving in that window would be dropped. */

  const reporterRef = useRef<ProtectionReporter | null>(null)

  const attachReporter = useCallback((fn: ProtectionReporter | null) => {
    reporterRef.current = fn
  }, [])

  const report = useCallback<ProtectionReporter>((type, detail) => {
    reporterRef.current?.(type, detail)
  }, [])

  const setPolicy = useCallback((next: DrmPolicy) => setPolicyState(next), [])

  /* The shield is on whenever the policy asks for any capture protection.
   * Both flags map to the same OS-level switch — FLAG_SECURE and the iOS
   * capture notifications do not distinguish a still shot from a
   * recording — so a policy that blocks one and not the other is applied
   * as "block both". That is the only reading which does not silently
   * widen the hole the administrator thought they were closing. */

  const active = policy.block_screenshots || policy.block_screen_recording

  const onEvent = useCallback(
    (type: ShieldEventType, detail?: string) => {
      reporterRef.current?.(type, detail)
    },

    [],
  )

  const shield = useScreenShield({
    active,
    hideOnBlur: policy.hide_content_on_blur,
    onEvent,
  })

  /* A shield that was asked to enable and did not is reported once, as a
   * device-level event rather than a product-level one: no reader is open
   * yet, and the CMS still needs to know a phone is running unprotected. */

  const reportedFailure = useRef(false)

  useEffect(() => {
    if (!active || !shield.shieldFailed || reportedFailure.current) return

    reportedFailure.current = true

    report("DEVICE_COMPROMISED", "screen shield failed to install")
  }, [active, shield.shieldFailed, report])

  const value = useMemo<ProtectionState>(
    () => ({ ...shield, policy, setPolicy, report, attachReporter }),

    [shield, policy, setPolicy, report, attachReporter],
  )

  return (
    <ProtectionContext.Provider value={value}>
      {children}
      {shield.shouldConceal && (
        <ShieldOverlay
          title="התוכן מוגן"
          message={
            shield.captured
              ? "זוהתה הקלטת מסך — התוכן הוסתר להגנה על זכויות היוצרים."
              : shield.mirrored
                ? "זוהה שיקוף מסך או חיבור לתצוגה חיצונית — נתקו את השיקוף כדי להמשיך לקרוא."
                : "התוכן מוסתר בזמן שהאפליקציה ברקע."
          }
        />
      )}
    </ProtectionContext.Provider>
  )
}

export function useProtection(): ProtectionState {
  const context = useContext(ProtectionContext)

  if (!context)
    throw new Error("useProtection must be used inside <ProtectionProvider>")

  return context
}
