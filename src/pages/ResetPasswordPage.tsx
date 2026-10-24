/* ─────────────────────────────────────────────────────────────
 * Reset Password - the customer-facing entry point of the admin
 * reset flow.
 *
 * Reached from the admin-minted link /reset-password?r=<seal-id>.
 * The page redeems the id through the redeem-password-reset Edge
 * Function and follows the returned Supabase action link in the
 * customer's own browser, which lands on /setup-password with an
 * active recovery session. The raw link is never rendered, stored
 * or logged - the page discards it on redirect.
 *
 * There is deliberately no session pre-check here: redeem is
 * single-use, so a replay (browser-back after completing the flow)
 * simply receives 410 and lands on the invalid screen, and a
 * signed-in admin testing a customer's link gets exactly the same
 * recovery behaviour the old raw action link had.
 * ───────────────────────────────────────────────────────────── */

import { useEffect, useState } from "react"
import { Link, useSearchParams } from "react-router"
import {
  isSupabaseConfigured,
  requireSupabase,
} from "../integrations/supabase/supabase"
import Alert from "../components/ui/Alert"
import Spinner from "../components/ui/Spinner"
import AuthShell from "../components/layout/AuthShell"

type RedeemState = "redeeming" | "redirecting" | "invalid" | "error"

/** admin-password-reset mints 32 lowercase hex chars (UUID without dashes).
 *  Anything else can never be a valid seal, so the page refuses it locally -
 *  no network call, and a tampered or truncated link lands on the same
 *  friendly screen as an expired one. */
const SEAL_ID_PATTERN = /^[0-9a-f]{32}$/

export default function ResetPasswordPage() {
  const [params] = useSearchParams()
  const sealId = params.get("r") ?? ""

  const [state, setState] = useState<RedeemState>("redeeming")
  const [error, setError] = useState("")
  /* Bumped by the retry button; re-runs the redeem effect. */
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false

    /* No id, a malformed id, or the local driver without a hosted backend -
     * the branded flow only exists where the Edge Functions do. */
    if (!sealId || !SEAL_ID_PATTERN.test(sealId) || !isSupabaseConfigured) {
      setState("invalid")
      return
    }

    redeem()

    return () => {
      cancelled = true
    }

    async function redeem() {
      setState("redeeming")
      setError("")

      try {
        const { data, error: fnError } =
          await requireSupabase().functions.invoke<{
            action_link?: string
          }>("redeem-password-reset", { body: { id: sealId } })

        if (cancelled) return

        const status = (fnError as { context?: Response } | null)?.context
          ?.status

        if (!fnError && data?.action_link) {
          setState("redirecting")
          /* Full navigation, not a client-side route: the action link is
           * on the Supabase domain and bounces straight back to
           * /setup-password with the recovery session established. */
          window.location.assign(data.action_link)
          return
        }

        if (status === 410) {
          setState("invalid")
          return
        }

        setState("error")
        setError(
          status === 400
            ? "קישור האיפוס אינו תקין."
            : "לא ניתן לאמת את קישור האיפוס. נסו שוב או בקשו קישור חדש.",
        )
      } catch {
        if (!cancelled) {
          setState("error")
          setError("לא ניתן לאמת את קישור האיפוס. בדקו את החיבור ונסו שוב.")
        }
      }
    }
  }, [sealId, attempt])

  if (state === "invalid") {
    return (
      <AuthShell
        eyebrow="איפוס סיסמה"
        title="הקישור אינו תקין או שפג תוקפו"
        description="קישורי איפוס תקפים ל־10 דקות ולשימוש אחד בלבד. בקשו מהמנהל קישור חדש."
      >
        <div className="flex flex-col gap-2.5 sm:flex-row">
          <Link to="/forgot-password" className="app-btn flex-1">
            בקש קישור חדש
          </Link>
          <Link to="/login" className="app-btn-secondary flex-1">
            התחברות
          </Link>
        </div>
      </AuthShell>
    )
  }

  const busy = state === "redeeming" || state === "redirecting"

  return (
    <AuthShell
      eyebrow="איפוס סיסמה"
      title={
        state === "error"
          ? "משהו השתבש"
          : state === "redirecting"
            ? "מאומת - ממשיכים…"
            : "מאמת קישור איפוס…"
      }
      description={
        state === "error" ? undefined : "רגע אחד, מכין את מסך הסיסמה החדשה."
      }
    >
      {state === "error" ? (
        <div className="space-y-4">
          <Alert tone="error">{error}</Alert>
          <div className="flex flex-col gap-2.5 sm:flex-row">
            <button
              type="button"
              onClick={() => setAttempt((n) => n + 1)}
              className="app-btn flex-1 cursor-pointer"
            >
              נסו שוב
            </button>
            <Link to="/login" className="app-btn-secondary flex-1">
              התחברות
            </Link>
          </div>
        </div>
      ) : (
        busy && (
          <Spinner
            label={
              state === "redirecting"
                ? "מעביר אותך למסך הסיסמה…"
                : "מאמת קישור איפוס…"
            }
          />
        )
      )}
    </AuthShell>
  )
}
