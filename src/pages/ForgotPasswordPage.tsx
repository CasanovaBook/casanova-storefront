/* ─────────────────────────────────────────────────────────────
 * Password reset request.
 *
 * Calls the service layer, which records a real single-use token and
 * queues the outgoing message. The response deliberately does not say
 * whether the address exists, so this screen cannot be used to
 * enumerate accounts - and when no mail provider is configured it says
 * so plainly instead of implying a delivery that never happened.
 * ───────────────────────────────────────────────────────────── */

import { useEffect, useState } from "react"
import { Link } from "react-router"
import { getSettings, requestPasswordReset } from "../lib/api"
import { isSupabaseConfigured } from "../integrations/supabase/supabase"
import { requestPasswordReset as requestSupabaseReset } from "../integrations/supabase/supabase-auth"
import Alert from "../components/ui/Alert"
import AuthShell from "../components/layout/AuthShell"
import TurnstileWidget from "../components/TurnstileWidget"
import { useApp } from "../context/AppContext"

export default function ForgotPasswordPage() {
  const { theme } = useApp()
  const [email, setEmail] = useState("")
  const [submitted, setSubmitted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  /* Read once at submit time - the provider may be configured mid-session. */
  const [delivered, setDelivered] = useState(true)

  const [captchaToken, setCaptchaToken] = useState("")
  const [captchaReset, setCaptchaReset] = useState(0)
  const [cooldown, setCooldown] = useState(0)

  const captchaSiteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY
  const captchaEnabled = isSupabaseConfigured && Boolean(captchaSiteKey)
  const coolingDown = cooldown > 0

  useEffect(() => {
    if (!coolingDown || submitted) return
    const timer = setInterval(() => {
      setCooldown((value) => Math.max(0, value - 1))
    }, 1000)
    return () => clearInterval(timer)
  }, [coolingDown, submitted])

  const resetCaptcha = () => {
    setCaptchaToken("")
    setCaptchaReset((value) => value + 1)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (captchaEnabled && !captchaToken) {
      setError("יש להשלים את אימות האבטחה לפני שליחת הבקשה.")
      return
    }

    setError("")
    setBusy(true)
    setCooldown(60)

    try {
      if (isSupabaseConfigured) {
        const result = await requestSupabaseReset(email.trim(), {
          captchaToken: captchaEnabled ? captchaToken : undefined,
        })
        if (!result.ok) {
          setError(result.error)
          return
        }
        setDelivered(true)
        setSubmitted(true)
        return
      }

      const result = await requestPasswordReset(email.trim())
      if (!result.ok) {
        setError(result.error)
        return
      }
      setDelivered(Boolean(getSettings().email_provider))
      setSubmitted(true)
    } finally {
      setBusy(false)
      resetCaptcha()
    }
  }

  return (
    <AuthShell
      eyebrow="שחזור גישה"
      title={submitted ? "בדוק את תיבת הדואר הנכנס שלך" : "איפוס סיסמה"}
      description={
        submitted
          ? "שלחנו אליך קישור לאיפוס סיסמה. אם כתובת המייל הזו רשומה במערכת, תמצא בהודעה הוראות מהירות לבחירת סיסמה חדשה (כדאי לבדוק גם בתיקיית הספאם)."
          : "הזן את כתובת המייל של החשבון. נשלח לך קישור איפוס מאובטח."
      }
      footer={
        !submitted ? (
          <p className="m-0 text-center">
            נזכרת בסיסמה? <Link to="/login">התחבר</Link>
          </p>
        ) : undefined
      }
    >
      {!submitted ? (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="app-field">
            <label htmlFor="forgot-email" className="app-label">
              כתובת מייל
            </label>
            <input
              id="forgot-email"
              type="email"
              dir="ltr"
              className="w-full px-4 py-3 text-left"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
            />
          </div>

          {error && <Alert tone="error">{error}</Alert>}

          {captchaEnabled && (
            <div className="app-field">
              <p className="app-hint">
                אימות אבטחה נדרש לפני שליחת הבקשה.
              </p>
              <TurnstileWidget
                siteKey={captchaSiteKey}
                theme={theme}
                onToken={(token) => setCaptchaToken(token)}
                onExpire={() => setCaptchaToken("")}
                onError={() => {
                  setCaptchaToken("")
                  setError(
                    "אימות האבטחה אינו זמין כרגע. אנא נסה שוב בעוד רגע.",
                  )
                }}
                resetSignal={captchaReset}
              />
            </div>
          )}

          <button
            type="submit"
            disabled={
              busy || coolingDown || (captchaEnabled && !captchaToken)
            }
            aria-busy={busy || undefined}
            className="app-btn w-full"
          >
            {busy ? (
              <>
                <span
                  className="app-spinner"
                  aria-hidden="true"
                  style={{
                    width: "1rem",
                    height: "1rem",
                    borderColor:
                      "color-mix(in srgb, var(--color-primary-foreground) 35%, transparent)",
                    borderTopColor: "var(--color-primary-foreground)",
                  }}
                />
                שולח…
              </>
            ) : coolingDown ? (
              `נסה שוב בעוד ${cooldown} שניות`
            ) : (
              "שליחת קישור איפוס"
            )}
          </button>
        </form>
      ) : (
        <div className="space-y-4">
          {!delivered && (
            <Alert tone="warning">
              לא מוגדר כרגע ספק שליחת מיילים, ולכן הקישור נשמר בתור בלבד ולא
              נמסר בפועל. מנהל מערכת יכול להנפיק קישור איפוס ישירות מניהול
              המשתמשים באזור הניהול ולהעביר אותו לבעל החשבון.
            </Alert>
          )}

          <Link to="/login" className="app-btn w-full">
            חזרה להתחברות
          </Link>
        </div>
      )}
    </AuthShell>
  )
}
