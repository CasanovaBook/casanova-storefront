/* ─────────────────────────────────────────────────────────────
 * Reset Password — the customer-facing entry point of the admin
 * reset flow.
 *
 * Reached from the admin-minted link /reset-password?r=<seal-id>.
 * The page redeems the id through the redeem-password-reset Edge
 * Function and follows the returned Supabase action link in the
 * customer's own browser, which lands on /setup-password with an
 * active recovery session. The raw link is never rendered, stored
 * or logged — the page discards it on redirect.
 *
 * There is deliberately no session pre-check here: redeem is
 * single-use, so a replay (browser-back after completing the flow)
 * simply receives 410 and lands on the invalid screen, and a
 * signed-in admin testing a customer's link gets exactly the same
 * recovery behaviour the old raw action link had.
 * ───────────────────────────────────────────────────────────── */

import { useEffect, useState } from "react"
import { Link, useSearchParams } from "react-router"
import { isSupabaseConfigured, requireSupabase } from "../lib/supabase"
import Icon from "../components/icons"
import ThemeToggle from "../components/ThemeToggle"
import logoImg from "../../images/main_photo.jpg"

type RedeemState = "redeeming" | "redirecting" | "invalid" | "error"

/** admin-password-reset mints 32 lowercase hex chars (UUID without dashes).
 *  Anything else can never be a valid seal, so the page refuses it locally —
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

    /* No id, a malformed id, or the local driver without a hosted backend —
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
      <div
        className="min-h-screen flex items-center justify-center px-6"
        style={{ background: "var(--color-background)" }}
      >
        <div className="w-full max-w-sm text-center page-enter">
          <div
            className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4"
            style={{
              background: "rgba(239,68,68,0.12)",
              border: "1px solid rgba(239,68,68,0.3)",
              color: "var(--color-danger)",
            }}
          >
            <Icon name="lock" size={28} />
          </div>
          <h1 className="font-display text-2xl font-semibold mb-2">
            הקישור אינו תקין או שפג תוקפו
          </h1>
          <p
            className="text-sm mb-6"
            style={{ color: "var(--color-muted-foreground)" }}
          >
            קישורי איפוס תקפים ל־10 דקות ולשימוש אחד בלבד. בקשו מהמנהל קישור
            חדש.
          </p>
          <div className="flex gap-3 justify-center">
            <Link
              to="/forgot-password"
              className="btn-gradient px-5 py-2.5 rounded-full font-semibold text-sm"
            >
              בקש קישור חדש
            </Link>
            <Link
              to="/login"
              className="px-5 py-2.5 rounded-full border text-sm"
              style={{
                borderColor: "var(--color-border)",
                color: "var(--color-foreground)",
              }}
            >
              התחברות
            </Link>
          </div>
        </div>
      </div>
    )
  }

  const busy = state === "redeeming" || state === "redirecting"

  return (
    <div
      className="min-h-screen flex items-center justify-center px-6 relative overflow-hidden"
      style={{ background: "var(--color-background)" }}
    >
      <div
        className="absolute w-[500px] h-[500px] rounded-full pointer-events-none"
        style={{
          background:
            "radial-gradient(circle, rgba(212,160,48,0.08) 0%, transparent 70%)",
          top: "-140px",
          left: "50%",
          transform: "translateX(-50%)",
        }}
      />
      <div className="absolute top-5 left-5 z-10">
        <ThemeToggle />
      </div>

      <div className="w-full max-w-sm text-center page-enter relative">
        <div className="text-center mb-8">
          <Link to="/" className="inline-flex items-center gap-2 mb-6">
            <img
              src={logoImg}
              alt="Casanova"
              className="w-9 h-9 rounded-lg object-cover"
            />
            <span
              dir="ltr"
              className="font-display text-xl font-semibold tracking-wide"
              style={{ color: "var(--color-primary)" }}
            >
              Casanova
            </span>
          </Link>
        </div>

        <div
          className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4"
          style={{
            background: "rgba(227,174,60,0.12)",
            border: "1px solid rgba(227,174,60,0.3)",
            color: "var(--color-primary)",
          }}
        >
          <Icon name="lock" size={28} />
        </div>

        {state === "error" ? (
          <>
            <h1 className="font-display text-2xl font-semibold mb-2">
              משהו השתבש
            </h1>
            <p
              className="text-sm mb-6"
              style={{ color: "var(--color-muted-foreground)" }}
            >
              {error}
            </p>
            <div className="flex gap-3 justify-center">
              <button
                type="button"
                onClick={() => setAttempt((n) => n + 1)}
                className="btn-gradient px-5 py-2.5 rounded-full font-semibold text-sm cursor-pointer"
              >
                נסו שוב
              </button>
              <Link
                to="/login"
                className="px-5 py-2.5 rounded-full border text-sm"
                style={{
                  borderColor: "var(--color-border)",
                  color: "var(--color-foreground)",
                }}
              >
                התחברות
              </Link>
            </div>
          </>
        ) : (
          <>
            <h1 className="font-display text-2xl font-semibold mb-2">
              {state === "redirecting"
                ? "מאומת — ממשיכים…"
                : "מאמת קישור איפוס…"}
            </h1>
            <p
              className="text-sm"
              style={{ color: "var(--color-muted-foreground)" }}
            >
              רגע אחד, מכין את מסך הסיסמה החדשה.
            </p>
            {busy && (
              <span
                className="inline-block w-8 h-8 rounded-full border-2 animate-spin mt-6"
                style={{
                  borderColor: "var(--color-border)",
                  borderTopColor: "var(--color-primary)",
                }}
                role="status"
                aria-live="polite"
              />
            )}
          </>
        )}
      </div>
    </div>
  )
}
