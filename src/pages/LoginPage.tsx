import { useEffect, useState } from "react"
import { Link, useLocation, useNavigate } from "react-router"
import { useApp } from "../context/AppContext"
import { useContent } from "../content/useContent"
import { passwordProblem } from "../lib/auth"
import Icon from "../components/icons"
import AccessibilityFooterLink from "../components/accessibility/AccessibilityFooterLink"
import logoImg from "../../images/main_photo.jpg"

// Function to detect Hebrew characters
function hasHebrewChars(text: string): boolean {
  return /[\u0590-\u05FF]/.test(text)
}

export default function LoginPage() {
  const { login, register, resendConfirmation, bootstrapRequired } = useApp()
  const c = useContent()
  const navigate = useNavigate()
  const location = useLocation()
  const mode = location.pathname === "/register" ? "register" : "login"

  const [firstName, setFirstName] = useState("")
  const [lastName, setLastName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [hebrewWarning, setHebrewWarning] = useState(false)
  const [emailHebrewWarning, setEmailHebrewWarning] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  // Email verification UX state
  const [registeredEmail, setRegisteredEmail] = useState<string | null>(null)
  const [unconfirmedEmail, setUnconfirmedEmail] = useState<string | null>(null)
  const [resending, setResending] = useState(false)
  const [resendMessage, setResendMessage] = useState<string | null>(null)
  const [cooldown, setCooldown] = useState(0)

  useEffect(() => {
    if (cooldown <= 0) return
    const timer = setInterval(() => {
      setCooldown((c) => c - 1)
    }, 1000)
    return () => clearInterval(timer)
  }, [cooldown])

  const handleResend = async (targetEmail: string) => {
    if (cooldown > 0 || resending) return
    setResending(true)
    setResendMessage(null)
    const res = await resendConfirmation(targetEmail)
    setResending(false)
    if (res.ok) {
      setResendMessage("קישור אימות חדש נשלח בהצלחה לתיבת הדואר שלך!")
      setCooldown(60)
    } else {
      setResendMessage(res.error || "שליחת האימייל נכשלה. אנא נסה שוב מאוחר יותר.")
    }
  }

  useEffect(() => {
    setError("")
    setUnconfirmedEmail(null)
    setResendMessage(null)
  }, [mode])

  // Check for Hebrew characters in email
  const handleEmailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newEmail = e.target.value
    setEmail(newEmail)
    setEmailHebrewWarning(hasHebrewChars(newEmail))
    if (
      error ===
        "כתובת האימייל אינה יכולה להכיל אותיות בעברית. יש להזין כתובת באנגלית בלבד." &&
      !hasHebrewChars(newEmail)
    ) {
      setError("")
    }
  }

  // Check for Hebrew characters in password
  const handlePasswordChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newPassword = e.target.value
    setPassword(newPassword)
    setHebrewWarning(hasHebrewChars(newPassword))
  }

  // A fresh installation has no accounts at all, so nobody can sign in
  // until the first administrator is created.
  useEffect(() => {
    if (bootstrapRequired) navigate("/setup", { replace: true })
  }, [bootstrapRequired, navigate])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    setUnconfirmedEmail(null)
    setResendMessage(null)

    // Disallow Hebrew in email
    if (hasHebrewChars(email)) {
      setError(
        "כתובת האימייל אינה יכולה להכיל אותיות בעברית. יש להזין כתובת באנגלית בלבד.",
      )
      return
    }

    // Validate email contains @ symbol
    if (!email.includes("@")) {
      setError("כתובת האימייל חייבת להכיל את הסימן @")
      return
    }

    if (mode === "register") {
      const problem = passwordProblem(password)
      if (problem) {
        setError(problem)
        return
      }
    }
    setIsLoading(true)
    const result =
      mode === "login"
        ? await login(email.trim(), password)
        : await register({
            first_name: firstName.trim(),
            last_name: lastName.trim(),
            email: email.trim(),
            password,
          })
    setIsLoading(false)
    if (result.ok) {
      if (mode === "register" && result.needsEmailConfirmation) {
        setRegisteredEmail(email.trim())
        return
      }
      const searchParams = new URLSearchParams(location.search)
      const redirect = searchParams.get("redirect")
      navigate(redirect || (result.user?.role === "ADMIN" ? "/admin" : "/dashboard"), {
        replace: true,
      })
    } else {
      if (mode === "login" && result.isUnconfirmed) {
        setUnconfirmedEmail(email.trim())
      }
      setError(result.error ?? "הפעולה נכשלה.")
    }
  }

  if (registeredEmail) {
    return (
      <div
        className="min-h-screen flex items-center justify-center px-6 relative overflow-hidden"
        style={{ background: "var(--color-background)" }}
      >
        <main id="main" className="w-full max-w-sm page-enter text-center">
          <div
            className="w-20 h-20 rounded-2xl flex items-center justify-center mx-auto mb-6 glow-pulse"
            style={{
              background: "rgba(212,160,48,0.12)",
              border: "1px solid rgba(212,160,48,0.35)",
              color: "var(--color-primary)",
            }}
          >
            <Icon name="mail" size={40} />
          </div>
          <h1 className="font-display text-2xl font-semibold mb-2">
            בדקו את תיבת הדואר שלכם!
          </h1>
          <p
            className="text-sm mb-4"
            style={{ color: "var(--color-muted-foreground)" }}
          >
            שלחנו קישור אימות לכתובת:
            <br />
            <strong className="text-foreground mt-1 inline-block" dir="ltr">
              {registeredEmail}
            </strong>
          </p>
          <p
            className="text-xs mb-6"
            style={{ color: "var(--color-muted-foreground)" }}
          >
            יש ללחוץ על הקישור במייל כדי להפעיל את החשבון ולהתחבר.
          </p>

          {resendMessage && (
            <div
              className="p-3 rounded-lg text-xs mb-4 text-center"
              style={{
                background: "rgba(212,160,48,0.08)",
                border: "1px solid rgba(212,160,48,0.25)",
                color: "var(--color-primary)",
              }}
            >
              {resendMessage}
            </div>
          )}

          <div className="space-y-3">
            <button
              type="button"
              disabled={cooldown > 0 || resending}
              onClick={() => handleResend(registeredEmail)}
              className="w-full py-2.5 rounded-lg border text-sm font-medium transition-all disabled:opacity-50"
              style={{
                borderColor: "var(--color-border)",
                color: "var(--color-foreground)",
              }}
            >
              {resending
                ? "שולח..."
                : cooldown > 0
                ? `שליחה חוזרת בעוד ${cooldown} שניות`
                : "לא קיבלתם? שלחו שוב אימייל אימות"}
            </button>

            <button
              type="button"
              onClick={() => {
                setRegisteredEmail(null)
                navigate("/login")
              }}
              className="w-full py-2.5 rounded-lg text-sm transition-opacity hover:opacity-80"
              style={{ color: "var(--color-primary)" }}
            >
              חזרה למסך ההתחברות
            </button>
          </div>
        </main>
      </div>
    )
  }

  const inputClass =
    "w-full px-4 py-3 rounded-lg border text-sm outline-none transition-all"
  const inputStyle = {
    background: "var(--color-secondary)",
    borderColor: "var(--color-border)",
    color: "var(--color-foreground)",
  }

  /* Every message a password field can explain itself with, wired to the input
   * so a screen reader reads it as the field's description. */
  const passwordDescribedBy =
    [
      hebrewWarning ? "auth-password-warning" : null,
      mode === "register" ? "auth-password-hint" : null,
    ]
      .filter(Boolean)
      .join(" ") || undefined

  return (
    <div
      className="min-h-screen flex items-center justify-center px-6 relative overflow-hidden"
      style={{ background: "var(--color-background)" }}
    >
      {/* Ambient glows */}
      <div
        className="absolute w-[500px] h-[500px] rounded-full pointer-events-none"
        style={{
          background:
            "radial-gradient(circle, rgba(212,160,48,0.09) 0%, transparent 70%)",
          top: "-140px",
          right: "-120px",
        }}
      />
      <div
        className="absolute w-[400px] h-[400px] rounded-full pointer-events-none"
        style={{
          background:
            "radial-gradient(circle, rgba(212,160,48,0.06) 0%, transparent 70%)",
          bottom: "-100px",
          left: "-100px",
        }}
      />

      <main id="main" className="w-full max-w-sm page-enter relative">
        <div className="text-center mb-8">
          <Link to="/" className="inline-flex items-center gap-2 mb-6">
            <img
              src={logoImg}
              alt=""
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
          <h1 className="font-display text-3xl font-semibold mb-2">
            {mode === "login" ? (c("ui.auth.loginTitle") || "התחברות") : (c("ui.auth.registerTitle") || "יצירת חשבון")}
          </h1>
          <p
            className="text-sm"
            style={{ color: "var(--color-muted-foreground)" }}
          >
            {mode === "login"
              ? (c("ui.auth.loginSubtitle") || "גש לספרייה ולהתקדמות הקריאה שלך.")
              : (c("ui.auth.registerSubtitle") || "החשבון ישמש אותך לרכישה, לספרייה ולמעקב אחרי ההזמנות.")}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === "register" && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label
                  htmlFor="auth-first-name"
                  className="block text-xs font-medium mb-1.5"
                  style={{ color: "var(--color-muted-foreground)" }}
                >
                  {c("ui.auth.firstName") || "שם פרטי"}
                </label>
                <input
                  id="auth-first-name"
                  type="text"
                  className={inputClass}
                  style={inputStyle}
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  autoComplete="given-name"
                  required
                />
              </div>
              <div>
                <label
                  htmlFor="auth-last-name"
                  className="block text-xs font-medium mb-1.5"
                  style={{ color: "var(--color-muted-foreground)" }}
                >
                  {c("ui.auth.lastName") || "שם משפחה"}
                </label>
                <input
                  id="auth-last-name"
                  type="text"
                  className={inputClass}
                  style={inputStyle}
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  autoComplete="family-name"
                  required
                />
              </div>
            </div>
          )}

          <div>
            <label
              htmlFor="auth-email"
              className="block text-xs font-medium mb-1.5"
              style={{ color: "var(--color-muted-foreground)" }}
            >
              {c("ui.auth.emailLabel") || "אימייל"}
            </label>
            <input
              id="auth-email"
              type="email"
              dir="ltr"
              aria-invalid={emailHebrewWarning ? true : undefined}
              aria-describedby={emailHebrewWarning ? "auth-email-warning" : undefined}
              className={
                inputClass +
                " text-left" +
                (emailHebrewWarning ? " border-amber-500/60" : "")
              }
              style={inputStyle}
              value={email}
              onChange={handleEmailChange}
              placeholder="you@example.com"
              autoComplete="email"
              required
            />
            {emailHebrewWarning && (
              <div
                id="auth-email-warning"
                className="flex items-center gap-2 mt-1.5 px-3 py-2 rounded-md"
                style={{
                  background: "rgba(245,158,11,0.1)",
                  borderColor: "rgba(245,158,11,0.3)",
                  border: "1px solid rgba(245,158,11,0.3)",
                }}
              >
                <Icon
                  name="alert-triangle"
                  className="w-4 h-4 flex-shrink-0"
                  style={{ color: "rgb(245,158,11)" }}
                />
                <span className="text-xs" style={{ color: "rgb(245,158,11)" }}>
                  כתובת האימייל חייבת להכיל אותיות באנגלית בלבד (ללא אותיות
                  בעברית)
                </span>
              </div>
            )}
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label
                htmlFor="auth-password"
                className="text-xs font-medium"
                style={{ color: "var(--color-muted-foreground)" }}
              >
                {c("ui.auth.passwordLabel") || "סיסמה"}
              </label>
              {mode === "login" && (
                <Link
                  to="/forgot-password"
                  className="text-xs transition-opacity hover:opacity-70"
                  style={{ color: "var(--color-primary)" }}
                >
                  {c("ui.auth.forgotPassword") || "שכחת סיסמה?"}
                </Link>
              )}
            </div>
            {/* The password value is entered as LTR text, so the whole field
             * (input + trailing visibility toggle) is laid out LTR. Keeping the
             * wrapper dir="ltr" lets the input's `pe-*` reserve and the button's
             * `end-*` inset resolve to the same physical side, so the toggle can
             * never drift onto the text even if the surrounding page is RTL. */}
            <div dir="ltr" className="relative">
              <input
                id="auth-password"
                type={showPassword ? "text" : "password"}
                dir="ltr"
                aria-describedby={passwordDescribedBy}
                aria-invalid={hebrewWarning ? true : undefined}
                className={inputClass + " text-left pe-14"}
                style={inputStyle}
                value={password}
                onChange={handlePasswordChange}
                placeholder="••••••••"
                autoComplete={
                  mode === "login" ? "current-password" : "new-password"
                }
                required
              />
              {/* Reachable from the keyboard: it used to be pulled out of the
               * tab order, which left a functional control mouse-only. */}
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="tap-target absolute end-3 top-1/2 transform -translate-y-1/2 inline-flex items-center justify-center transition-colors hover:opacity-100"
                style={{
                  color: showPassword
                    ? "#FFFFFF"
                    : "var(--color-muted-foreground)",
                  opacity: showPassword ? 1 : 0.5,
                }}
                aria-pressed={showPassword}
                aria-label={showPassword ? "הסתרת הסיסמה" : "הצגת הסיסמה"}
                title={showPassword ? "הסתר סיסמה" : "הצג סיסמה"}
              >
                <Icon name="eye" size={16} />
              </button>
            </div>
            {hebrewWarning && (
              <div
                id="auth-password-warning"
                className="flex items-center gap-2 mt-1.5 px-3 py-2 rounded-md"
                style={{
                  background: "rgba(245,158,11,0.1)",
                  borderColor: "rgba(245,158,11,0.3)",
                }}
              >
                <Icon
                  name="alert-triangle"
                  className="w-4 h-4"
                  style={{ color: "rgb(245,158,11)" }}
                />
                <span className="text-xs" style={{ color: "rgb(245,158,11)" }}>
                  הסיסמה חייבת להכיל רק אותיות אנגליות וספרות
                </span>
              </div>
            )}
            {mode === "register" && (
              <p
                id="auth-password-hint"
                className="text-[11px] mt-1.5"
                style={{ color: "var(--color-muted-foreground)" }}
              >
                {c("ui.auth.passwordHint") || "8 תווים לפחות, כולל אותיות וספרה אחת."}
              </p>
            )}
          </div>

          {error && (
            <div className="space-y-2">
              <div
                role="alert"
                className="px-4 py-3 rounded-lg border text-sm"
                style={{
                  background: "rgba(239,68,68,0.08)",
                  borderColor: "rgba(239,68,68,0.3)",
                  color: "var(--color-danger)",
                }}
              >
                {error}
              </div>
              {unconfirmedEmail && (
                <button
                  type="button"
                  disabled={cooldown > 0 || resending}
                  onClick={() => handleResend(unconfirmedEmail)}
                  className="w-full py-2.5 rounded-lg border text-xs font-medium transition-all disabled:opacity-50 flex items-center justify-center gap-1.5"
                  style={{
                    borderColor: "var(--color-border)",
                    color: "var(--color-primary)",
                  }}
                >
                  <Icon name="mail" size={14} />
                  {resending
                    ? "שולח אימייל אימות..."
                    : cooldown > 0
                    ? `שליחה חוזרת בעוד ${cooldown} שניות`
                    : "שלח לי שוב אימייל אימות"}
                </button>
              )}
              {resendMessage && (
                <div
                  className="p-2.5 rounded-lg text-xs text-center"
                  style={{
                    background: "rgba(212,160,48,0.08)",
                    border: "1px solid rgba(212,160,48,0.25)",
                    color: "var(--color-primary)",
                  }}
                >
                  {resendMessage}
                </div>
              )}
            </div>
          )}

          {/* Terms and Conditions link - only shown in register mode */}
          {mode === "register" && (
            <p
              className="text-xs text-center mt-4"
              style={{ color: "var(--color-muted-foreground)" }}
            >
              {c("ui.auth.termsAgree") || "על ידי יצירת חשבון, אתה מסכים ל"}{" "}
              <Link
                to="/terms-and-conditions"
                className="underline transition-opacity hover:opacity-70"
                style={{ color: "var(--color-primary)" }}
              >
                {c("ui.auth.termsLink") || "תנאי השימוש"}
              </Link>{" "}
              {c("ui.auth.termsSuffix") || "שלנו."}
            </p>
          )}

          <button
            type="submit"
            disabled={isLoading}
            className="btn-gradient w-full py-3 rounded-full font-semibold text-sm disabled:opacity-60 flex items-center justify-center gap-2 mt-2"
          >
            {isLoading ? (
              <>
                <div className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                {mode === "login" ? (c("ui.auth.loggingIn") || "מתחבר...") : (c("ui.auth.creatingAccount") || "יוצר חשבון...")}
              </>
            ) : mode === "login" ? (
              (c("ui.auth.login") || "התחברות")
            ) : (
              (c("ui.auth.register") || "יצירת חשבון")
            )}
          </button>
        </form>

        <p
          className="text-center text-sm mt-6"
          style={{ color: "var(--color-muted-foreground)" }}
        >
          {mode === "login" ? (
            <>
              {c("ui.auth.noAccount") || "אין לכם חשבון?"}{" "}
              <Link
                to="/register"
                className="font-medium transition-opacity hover:opacity-70"
                style={{ color: "var(--color-primary)" }}
              >
                {c("ui.auth.noAccountLink") || "צרו חשבון חדש"}
              </Link>
            </>
          ) : (
            <>
              {c("ui.auth.hasAccount") || "כבר יש לכם חשבון?"}{" "}
              <Link
                to="/login"
                className="font-medium transition-opacity hover:opacity-70"
                style={{ color: "var(--color-primary)" }}
              >
                {c("ui.auth.haveAccountLink") || "התחברות"}
              </Link>
            </>
          )}
        </p>

        <p
          className="text-center text-xs mt-2 flex items-center justify-center gap-1.5"
          style={{ color: "var(--color-muted-foreground)" }}
        >
          <Icon name="bag" size={13} />
          {c("ui.auth.guestCheckout") || "ניתן גם לרכוש ישירות מ־"}
          <Link
            to="/store"
            className="transition-opacity hover:opacity-70"
            style={{ color: "var(--color-primary)" }}
          >
            {c("ui.auth.guestCheckoutStore") || "החנות"}
          </Link>
          {c("ui.auth.guestCheckoutSuffix") || "— החשבון ייווצר אוטומטית."}
        </p>

        {/* The auth screens have no site footer; this is their way into the
         * accessibility settings, and their way back if the floating button
         * was hidden on another page. */}
        <div className="text-center mt-6 text-xs">
          <AccessibilityFooterLink />
        </div>
      </main>
    </div>
  )
}
