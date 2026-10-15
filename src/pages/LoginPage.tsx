import { useEffect, useState } from "react"
import { Link, useLocation, useNavigate } from "react-router"
import { useApp } from "../context/AppContext"
import { useContent } from "../content/useContent"
import {
  PASSWORD_CHAR_RULE,
  PHONE_NUMBER_DIGITS,
  PHONE_PREFIXES,
  emailProblem,
  hasHebrewChars,
  hasInvalidPasswordChars,
  joinPhone,
  passwordProblem,
  phoneProblem,
  type PhoneParts,
} from "../lib/auth"
import {
  rememberReturnPath,
  safeInternalPath,
} from "../lib/checkout-intent"
import { isSupabaseConfigured } from "../integrations/supabase/supabase"
import Icon from "../components/icons"
import AccessibilityFooterLink from "../components/accessibility/AccessibilityFooterLink"
import logoImg from "../assets/main_photo.jpg"

/** Marks a field the customer cannot submit without. The same red star the
 *  checkout screen already uses, so "required" is not a guess on either side. */
const requiredMark = (
  <span style={{ color: "var(--color-danger)" }} aria-hidden="true">
    {" *"}
  </span>
)

export default function LoginPage() {
  const { login, register, resendConfirmation, bootstrapRequired } = useApp()
  const c = useContent()
  const navigate = useNavigate()
  const location = useLocation()
  const mode = location.pathname === "/register" ? "register" : "login"

  /* Where a finished sign-in goes. Sanitized because the value arrives from
   * a query string anybody can write, and it is used for a navigation. */
  const redirect = safeInternalPath(
    new URLSearchParams(location.search).get("redirect"),
  )

  const [firstName, setFirstName] = useState("")
  const [lastName, setLastName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [phoneParts, setPhoneParts] = useState<PhoneParts>({
    prefix: PHONE_PREFIXES[0],
    number: "",
  })
  const [error, setError] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [passwordCharWarning, setPasswordCharWarning] = useState(false)
  const [emailHebrewWarning, setEmailHebrewWarning] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)

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

  // Warn while the password still matches the rule shown under the field
  const handlePasswordChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newPassword = e.target.value
    setPassword(newPassword)
    setPasswordCharWarning(hasInvalidPasswordChars(newPassword))
  }

  /**
   * The phone is optional here and mandatory at checkout, and that split is
   * the business rule, not an oversight: `docs/PRODUCT_BRIEF.md` §5 lists the
   * number among what a purchase must collect, while §7 identifies an account
   * by email alone and `users.phone` is nullable. Offering the field at
   * registration is still worth it — `signUpWithEmail` already forwards it into
   * the account metadata and `buildAppUser` already reads it back — so a
   * customer who gives the number once is not asked for it again at checkout,
   * and the support form (which prefills from `user.phone`) finally has it.
   */
  const handlePhoneDigitChange = (value: string) => {
    setPhoneParts((prev) => ({
      ...prev,
      number: value.replace(/[^\d]/g, "").slice(0, PHONE_NUMBER_DIGITS),
    }))
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

    /* One validator for both screens and both modes. It is the rule the
     * service layer applies too, so nothing is accepted here only to be
     * refused when the order is placed. */
    const emailIssue = emailProblem(email)

    if (emailIssue) {
      setError(emailIssue)
      return
    }

    if (mode === "register") {
      const problem = passwordProblem(password)

      if (problem) {
        setError(problem)
        return
      }

      /* Password confirmation is the convention on every other screen that
       * sets a password (first-run setup, recovery). Registration creates the
       * credential the customer will live with, so it asks for it too. */
      if (password !== confirmPassword) {
        setError("הסיסמאות אינן תואמות.")
        return
      }

      const phoneIssue = phoneProblem(phoneParts, false)

      if (phoneIssue) {
        setError(phoneIssue)
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
            phone: joinPhone(phoneParts) || undefined,
          })
    setIsLoading(false)
    if (result.ok) {
      if (mode === "register" && result.needsEmailConfirmation) {
        /* The verification link is a trip out of this document. Whatever the
         * customer was heading for is written down now, so the confirmation
         * screen can finish the journey instead of dropping them in the
         * library mid-purchase. */
        if (redirect) rememberReturnPath(redirect)

        setRegisteredEmail(email.trim())
        return
      }
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
            {/* Naming the destination is what tells the customer the purchase
             * they started has not been forgotten on this side of the mail. */}
            {redirect === "/checkout" &&
              " לאחר האימות נחזיר אותך להשלמת הרכישה."}
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
                navigate(redirect ? `/login?redirect=${encodeURIComponent(redirect)}` : "/login")
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
      passwordCharWarning ? "auth-password-warning" : null,
      mode === "register" ? "auth-password-hint" : null,
    ]
      .filter(Boolean)
      .join(" ") || undefined

  /* The line under the form that tells a visitor what an account is actually
   * for. Which sentence is true depends on whether a real auth backend can
   * confirm an address here at all, but both are read the same way: three
   * pieces of one flowing sentence, the middle one being the link. */
  const browseNotice = isSupabaseConfigured
    ? {
        lead: c("ui.auth.browseNoticeLead") || "אפשר לעיין",
        link: c("ui.auth.browseNoticeStore") || "בחנות",
        tail:
          c("ui.auth.browseNoticeTail") ||
          "ולצפות בספרים ללא חשבון. כדי להשלים רכישה, יש ליצור חשבון ולאמת את כתובת האימייל.",
      }
    : {
        lead: c("ui.auth.guestCheckout") || "ניתן גם לרכוש ישירות מ־",
        link: c("ui.auth.guestCheckoutStore") || "החנות",
        tail: c("ui.auth.guestCheckoutSuffix") || "— החשבון ייווצר אוטומטית.",
      }

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

        {/* The browser's own validation bubbles are English, unstyled and
         * fire before anything here — on a Hebrew form whose every message is
         * already written in Hebrew. `noValidate` hands the answering to
         * `emailProblem` / `passwordProblem`, while the `required` attributes
         * stay for assistive technology and for the field semantics. */}
        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          {mode === "register" && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label
                  htmlFor="auth-first-name"
                  className="block text-xs font-medium mb-1.5"
                  style={{ color: "var(--color-muted-foreground)" }}
                >
                  {c("ui.auth.firstName") || "שם פרטי"}
                  {requiredMark}
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
                  {requiredMark}
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
              {requiredMark}
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
                {requiredMark}
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
                aria-invalid={passwordCharWarning ? true : undefined}
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
            {passwordCharWarning && (
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
                  {PASSWORD_CHAR_RULE}
                </span>
              </div>
            )}
            {mode === "register" && (
              <p
                id="auth-password-hint"
                className="text-[11px] mt-1.5"
                style={{ color: "var(--color-muted-foreground)" }}
              >
                {c("ui.auth.passwordHint") ||
                  "8 עד 72 תווים — תווים באנגלית בלבד, עם אות אחת וספרה אחת."}
              </p>
            )}
          </div>

          {/* Confirmation of a typed credential is already the rule on the
           * first-run setup screen and on password recovery; registration is
           * where the credential is invented, so it asks the same question. */}
          {mode === "register" && (
            <div>
              <label
                htmlFor="auth-confirm-password"
                className="block text-xs font-medium mb-1.5"
                style={{ color: "var(--color-muted-foreground)" }}
              >
                {c("ui.auth.confirmPassword") || "אימות סיסמה"}
                {requiredMark}
              </label>
              <div dir="ltr" className="relative">
                <input
                  id="auth-confirm-password"
                  type={showConfirmPassword ? "text" : "password"}
                  dir="ltr"
                  className={inputClass + " text-left pe-14"}
                  style={inputStyle}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="new-password"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="tap-target absolute end-3 top-1/2 transform -translate-y-1/2 inline-flex items-center justify-center transition-colors hover:opacity-100"
                  style={{
                    color: showConfirmPassword
                      ? "#FFFFFF"
                      : "var(--color-muted-foreground)",
                    opacity: showConfirmPassword ? 1 : 0.5,
                  }}
                  aria-pressed={showConfirmPassword}
                  aria-label={
                    showConfirmPassword ? "הסתרת אימות הסיסמה" : "הצגת אימות הסיסמה"
                  }
                  title={
                    showConfirmPassword ? "הסתר אימות סיסמה" : "הצג אימות סיסמה"
                  }
                >
                  <Icon name="eye" size={16} />
                </button>
              </div>
            </div>
          )}

          {mode === "register" && (
            <div>
              <label
                htmlFor="auth-phone"
                className="block text-xs font-medium mb-1.5"
                style={{ color: "var(--color-muted-foreground)" }}
              >
                {c("ui.auth.phoneLabel") || "מספר טלפון (לא חובה)"}
              </label>
              {/* The same two controls the checkout screen uses, so the number
               * is entered, stored and validated identically on both sides. */}
              <div className="flex gap-2" dir="rtl">
                <input
                  id="auth-phone"
                  type="tel"
                  dir="ltr"
                  aria-describedby="auth-phone-hint"
                  className={inputClass + " text-left flex-1"}
                  style={inputStyle}
                  value={phoneParts.number}
                  onChange={(e) => handlePhoneDigitChange(e.target.value)}
                  placeholder="1234567"
                  autoComplete="tel-national"
                  maxLength={PHONE_NUMBER_DIGITS}
                  inputMode="numeric"
                  pattern="[0-9]*"
                />
                <select
                  aria-label="קידומת הטלפון"
                  value={phoneParts.prefix}
                  onChange={(e) =>
                    setPhoneParts((prev) => ({
                      ...prev,
                      prefix: e.target.value,
                    }))
                  }
                  className={inputClass + " text-center flex-shrink-0"}
                  style={{ ...inputStyle, width: "80px" }}
                  dir="ltr"
                >
                  {PHONE_PREFIXES.map((prefix) => (
                    <option key={prefix} value={prefix}>
                      {prefix}
                    </option>
                  ))}
                </select>
              </div>
              <p
                id="auth-phone-hint"
                className="text-[11px] mt-1.5"
                style={{ color: "var(--color-muted-foreground)" }}
              >
                {c("ui.auth.phoneHint") ||
                  "אפשר להוסיף מספר טלפון בהמשך. בעת ביצוע הזמנה, נבקש מספר טלפון לצורכי תיאום ועדכוני משלוח."}
              </p>
            </div>
          )}

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

        {/* The bag icon and the sentence are the two flex children; the
         * sentence itself lives in one <p>, so it wraps as prose. It used to
         * sit as three bare text runs beside the icon, which made the browser
         * lay every fragment out on its own line and broke the Hebrew into
         * pieces on screen. */}
        <div
          className="mt-2 flex items-start justify-center gap-1.5 text-center"
          style={{ color: "var(--color-muted-foreground)" }}
        >
          <Icon name="bag" size={13} className="mt-0.5 shrink-0" />
          <p className="text-xs">
            {browseNotice.lead}{" "}
            <Link
              to="/store"
              className="transition-opacity hover:opacity-70"
              style={{ color: "var(--color-primary)" }}
            >
              {browseNotice.link}
            </Link>{" "}
            {browseNotice.tail}
          </p>
        </div>

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
