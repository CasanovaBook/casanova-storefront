/* ─────────────────────────────────────────────────────────────
 * Password reset request.
 *
 * Calls the service layer, which records a real single-use token and
 * queues the outgoing message. The response deliberately does not say
 * whether the address exists, so this screen cannot be used to
 * enumerate accounts — and when no mail provider is configured it says
 * so plainly instead of implying a delivery that never happened.
 * ───────────────────────────────────────────────────────────── */

import { useState } from "react"
import { Link } from "react-router"
import { getSettings, requestPasswordReset } from "../lib/api"
import Icon from "../components/icons"
import ThemeToggle from "../components/ThemeToggle"
import logoImg from "../../images/main_photo.jpg"

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("")
  const [submitted, setSubmitted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  /* Read once at submit time — the provider may be configured mid-session. */
  const [delivered, setDelivered] = useState(true)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    setBusy(true)
    const result = await requestPasswordReset(email.trim())
    setBusy(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setDelivered(Boolean(getSettings().email_provider))
    setSubmitted(true)
  }

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
          right: "-120px",
        }}
      />
      <div className="absolute top-5 left-5 z-10">
        <ThemeToggle />
      </div>

      <div className="w-full max-w-sm page-enter relative">
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

          {!submitted ? (
            <>
              <div
                className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4"
                style={{
                  background: "rgba(227,174,60,0.12)",
                  border: "1px solid rgba(227,174,60,0.3)",
                  color: "var(--color-primary)",
                }}
              >
                <Icon name="key" size={28} />
              </div>
              <h1 className="font-display text-3xl font-semibold mb-2">
                איפוס סיסמה
              </h1>
              <p
                className="text-sm"
                style={{ color: "var(--color-muted-foreground)" }}
              >
                הזן את כתובת המייל של החשבון. נשלח לך קישור איפוס מאובטח.
              </p>
            </>
          ) : (
            <>
              <div
                className="w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-4 glow-pulse"
                style={{
                  background: "rgba(212,160,48,0.1)",
                  color: "var(--color-primary)",
                  border: "1px solid rgba(212,160,48,0.3)",
                  boxShadow: "0 0 40px rgba(212,160,48,0.2)",
                }}
              >
                <Icon name="mail" size={32} />
              </div>
              <h1 className="font-display text-3xl font-semibold mb-2">
                הבקשה נרשמה
              </h1>
              <p
                className="text-sm"
                style={{ color: "var(--color-muted-foreground)" }}
              >
                אם קיים חשבון עבור <strong dir="ltr">{email}</strong>, קישור
                איפוס נרשם עבורו. מטעמי אבטחה איננו מודיעים האם הכתובת קיימת
                במערכת.
              </p>
              {!delivered && (
                <p
                  className="text-xs px-3 py-2.5 rounded-lg mt-5 flex items-start gap-2 text-right"
                  style={{
                    background: "rgba(245,158,11,0.1)",
                    color: "#F59E0B",
                  }}
                >
                  <Icon
                    name="mail"
                    size={14}
                    className="flex-shrink-0 mt-0.5"
                  />
                  <span>
                    לא מוגדר כרגע ספק שליחת מיילים, ולכן הקישור נשמר בתור בלבד
                    ולא נמסר בפועל. מנהל מערכת יכול להנפיק קישור איפוס ישירות
                    מניהול המשתמשים באזור הניהול ולהעביר אותו לבעל החשבון.
                  </span>
                </p>
              )}
            </>
          )}
        </div>

        {!submitted ? (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label
                className="block text-xs font-medium mb-1.5"
                style={{ color: "var(--color-muted-foreground)" }}
              >
                כתובת מייל
              </label>
              <input
                type="email"
                dir="ltr"
                className="w-full px-4 py-3 rounded-lg border text-sm outline-none text-left"
                style={{
                  background: "var(--color-secondary)",
                  borderColor: "var(--color-border)",
                  color: "var(--color-foreground)",
                }}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
              />
            </div>

            {error && (
              <p
                className="text-xs px-3 py-2.5 rounded-lg"
                style={{
                  background: "rgba(239,68,68,0.1)",
                  color: "var(--color-danger)",
                }}
              >
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={busy}
              className="btn-gradient w-full py-3 rounded-full font-semibold text-sm disabled:opacity-40"
            >
              {busy ? "שולח…" : "שליחת קישור איפוס"}
            </button>
          </form>
        ) : (
          <Link
            to="/login"
            className="block w-full py-3 rounded-full font-semibold text-sm text-center border transition-colors hover:bg-white/5"
            style={{
              borderColor: "var(--color-border)",
              color: "var(--color-foreground)",
            }}
          >
            חזרה להתחברות
          </Link>
        )}

        {!submitted && (
          <p
            className="text-center text-sm mt-6"
            style={{ color: "var(--color-muted-foreground)" }}
          >
            נזכרת בסיסמה?{" "}
            <Link
              to="/login"
              className="font-medium hover:opacity-70"
              style={{ color: "var(--color-primary)" }}
            >
              התחבר
            </Link>
          </p>
        )}
      </div>
    </div>
  )
}
