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
import { rememberReturnPath, safeInternalPath } from "../lib/checkout-intent"
import { isSupabaseConfigured } from "../integrations/supabase/supabase"
import Icon from "../components/icons"
import Alert from "../components/ui/Alert"
import AuthShell from "../components/layout/AuthShell"
import TurnstileWidget from "../components/TurnstileWidget"
import { LOGIN_MESSAGES } from "../shared/auth-login"

/** Marks a field the customer cannot submit without. The same red star the
 *  checkout screen already uses, so "required" is not a guess on either side. */
const requiredMark = (
  <span style={{ color: "var(--color-danger)" }} aria-hidden="true">
    {" *"}
  </span>
)

export default function LoginPage() {
  const { login, register, resendConfirmation, bootstrapRequired, theme } =
    useApp()
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
  const [captchaRequired, setCaptchaRequired] = useState(false)
  const [turnstileToken, setTurnstileToken] = useState("")
  const [captchaReset, setCaptchaReset] = useState(0)
  const [rateLimited, setRateLimited] = useState(false)

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
      setResendMessage(
        res.error || "שליחת האימייל נכשלה. אנא נסה שוב מאוחר יותר.",
      )
    }
  }

  useEffect(() => {
    setError("")
    setUnconfirmedEmail(null)
    setResendMessage(null)
    setCaptchaRequired(false)
    setTurnstileToken("")
    setCaptchaReset(0)
    setRateLimited(false)
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
    setRateLimited(false)

    if (mode === "login" && captchaRequired && !turnstileToken) {
      setError("יש להשלים את אימות האבטחה לפני ההתחברות.")
      return
    }

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
        ? await login(
            email.trim(),
            password,
            captchaRequired ? turnstileToken : undefined,
          )
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
      navigate(
        redirect || (result.user?.role === "ADMIN" ? "/admin" : "/dashboard"),
        {
          replace: true,
        },
      )
      return
    }

    if (
      mode === "login" &&
      (result.status === 429 || result.code === "RATE_LIMITED")
    ) {
      setRateLimited(true)
      setError("")
      setUnconfirmedEmail(null)
      return
    }

    if (
      mode === "login" &&
      (result.status === 403 ||
        result.code === "CAPTCHA_REQUIRED" ||
        result.code === "CAPTCHA_FAILED")
    ) {
      setCaptchaRequired(true)
      setTurnstileToken("")
      setCaptchaReset((value) => value + 1)
      setError(
        result.code === "CAPTCHA_FAILED"
          ? LOGIN_MESSAGES.CAPTCHA_FAILED
          : "",
      )
      return
    }

    if (mode === "login" && result.code === "CAPTCHA_UNAVAILABLE") {
      setCaptchaRequired(true)
      setTurnstileToken("")
      setCaptchaReset((value) => value + 1)
      setError(LOGIN_MESSAGES.CAPTCHA_UNAVAILABLE)
      return
    }

    if (mode === "login" && result.captchaRequired) {
      /* The third failure turns the widget on for the next attempt. The
       * current error stays the generic credential message. */
      setCaptchaRequired(true)
      setTurnstileToken("")
      setCaptchaReset((value) => value + 1)
    }

    if (
      mode === "login" &&
      (result.isUnconfirmed || result.code === "EMAIL_UNCONFIRMED")
    ) {
      setUnconfirmedEmail(email.trim())
      setError(result.error ?? LOGIN_MESSAGES.EMAIL_UNCONFIRMED)
      return
    }

    if (
      mode === "login" &&
      (result.status === 400 ||
        result.status === 401 ||
        result.code === "INVALID_CREDENTIALS")
    ) {
      setError(LOGIN_MESSAGES.INVALID_CREDENTIALS)
      return
    }

    setError(result.error ?? "הפעולה נכשלה.")
  }

  if (registeredEmail) {
    return (
      <AuthShell
        eyebrow="אימות כתובת"
        title="בדקו את תיבת הדואר שלכם!"
        description={
          <>
            שלחנו קישור אימות לכתובת:
            <br />
            <strong
              dir="ltr"
              className="inline-block break-all"
              style={{ color: "var(--color-foreground)" }}
            >
              {registeredEmail}
            </strong>
          </>
        }
      >
        <div className="space-y-4">
          <p className="app-hint" style={{ fontSize: "0.82rem" }}>
            יש ללחוץ על הקישור במייל כדי להפעיל את החשבון ולהתחבר.
            {/* Naming the destination is what tells the customer the purchase
             * they started has not been forgotten on this side of the mail. */}
            {redirect === "/checkout" &&
              " לאחר האימות נחזיר אותך להשלמת הרכישה."}
          </p>

          {resendMessage && <Alert tone="info">{resendMessage}</Alert>}

          <div className="space-y-2.5">
            <button
              type="button"
              disabled={cooldown > 0 || resending}
              onClick={() => handleResend(registeredEmail)}
              className="app-btn-secondary w-full"
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
                navigate(
                  redirect
                    ? `/login?redirect=${encodeURIComponent(redirect)}`
                    : "/login",
                )
              }}
              className="app-btn-ghost w-full"
            >
              חזרה למסך ההתחברות
            </button>
          </div>
        </div>
      </AuthShell>
    )
  }

  /* The one message a password field can explain itself with while the
   * customer is still typing, wired to the input so a screen reader reads it
   * as the field's description. There is deliberately no standing hint under
   * the field: the rules are the form's business until a customer breaks one,
   * and then they are stated in full. */
  const passwordDescribedBy = passwordCharWarning
    ? "auth-password-warning"
    : undefined

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
    <AuthShell
      eyebrow={mode === "login" ? "כניסה לחשבון" : "חשבון חדש"}
      title={
        mode === "login"
          ? c("ui.auth.loginTitle") || "התחברות"
          : c("ui.auth.registerTitle") || "יצירת חשבון"
      }
      description={
        mode === "login"
          ? c("ui.auth.loginSubtitle") || "גישה לספרייה, לרכישות ולמשך הקריאה שלכם."
          : c("ui.auth.registerSubtitle") ||
            "החשבון ישמש אותך לרכישה, לספרייה ולמעקב אחרי ההזמנות."
      }
      wide={mode === "register"}
      footer={
        <div className="space-y-3">
          <p className="m-0 text-center text-sm">
            {mode === "login" ? (
              <>
                {c("ui.auth.noAccount") || "אין לכם חשבון?"}{" "}
                <Link to="/register">
                  {c("ui.auth.noAccountLink") || "צרו חשבון חדש"}
                </Link>
              </>
            ) : (
              <>
                {c("ui.auth.hasAccount") || "כבר יש לכם חשבון?"}{" "}
                <Link to="/login">
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
          <div className="flex items-start justify-center gap-1.5 text-center">
            <Icon name="bag" size={13} className="mt-0.5 shrink-0" />
            <p className="m-0 text-xs">
              {browseNotice.lead} <Link to="/store">{browseNotice.link}</Link>{" "}
              {browseNotice.tail}
            </p>
          </div>
        </div>
      }
    >
      {/* The browser's own validation bubbles are English, unstyled and
       * fire before anything here — on a Hebrew form whose every message is
       * already written in Hebrew. `noValidate` hands the answering to
       * `emailProblem` / `passwordProblem`, while the `required` attributes
       * stay for assistive technology and for the field semantics. */}
      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        {mode === "register" && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="app-field">
              <label htmlFor="auth-first-name" className="app-label">
                {c("ui.auth.firstName") || "שם פרטי"}
                {requiredMark}
              </label>
              <input
                id="auth-first-name"
                type="text"
                className="w-full px-4 py-3"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                autoComplete="given-name"
                required
              />
            </div>
            <div className="app-field">
              <label htmlFor="auth-last-name" className="app-label">
                {c("ui.auth.lastName") || "שם משפחה"}
                {requiredMark}
              </label>
              <input
                id="auth-last-name"
                type="text"
                className="w-full px-4 py-3"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                autoComplete="family-name"
                required
              />
            </div>
          </div>
        )}

        <div className="app-field">
          <label htmlFor="auth-email" className="app-label">
            {c("ui.auth.emailLabel") || "אימייל"}
            {requiredMark}
          </label>
          <input
            id="auth-email"
            type="email"
            dir="ltr"
            aria-invalid={emailHebrewWarning ? true : undefined}
            aria-describedby={
              emailHebrewWarning ? "auth-email-warning" : undefined
            }
            className="w-full px-4 py-3 text-left"
            style={
              emailHebrewWarning
                ? { borderColor: "var(--color-danger)" }
                : undefined
            }
            value={email}
            onChange={handleEmailChange}
            placeholder="you@example.com"
            autoComplete="email"
            required
          />
          {emailHebrewWarning && (
            <div
              id="auth-email-warning"
              role="status"
              className="app-alert app-alert--warning"
            >
              <Icon
                name="alertTriangle"
                size={17}
                style={{
                  flexShrink: 0,
                  marginTop: 2,
                  color: "var(--color-primary)",
                }}
              />
              <span className="text-xs">
                כתובת האימייל חייבת להכיל אותיות באנגלית בלבד (ללא אותיות
                בעברית)
              </span>
            </div>
          )}
        </div>

        <div className="app-field">
          <div className="flex items-center justify-between gap-3">
            <label htmlFor="auth-password" className="app-label">
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
              className="w-full py-3 ps-4 pe-12 text-left"
              style={
                passwordCharWarning
                  ? { borderColor: "var(--color-danger)" }
                  : undefined
              }
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
              className="app-icon-btn absolute end-1 top-1/2 -translate-y-1/2"
              style={{
                color: showPassword
                  ? "var(--color-primary)"
                  : "var(--color-muted-foreground)",
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
              role="status"
              className="app-alert app-alert--warning"
            >
              <Icon
                name="alertTriangle"
                size={17}
                style={{
                  flexShrink: 0,
                  marginTop: 2,
                  color: "var(--color-primary)",
                }}
              />
              <span className="text-xs">{PASSWORD_CHAR_RULE}</span>
            </div>
          )}
        </div>

        {/* Confirmation of a typed credential is already the rule on the
         * first-run setup screen and on password recovery; registration is
         * where the credential is invented, so it asks the same question. */}
        {mode === "register" && (
          <div className="app-field">
            <label htmlFor="auth-confirm-password" className="app-label">
              {c("ui.auth.confirmPassword") || "אימות סיסמה"}
              {requiredMark}
            </label>
            <div dir="ltr" className="relative">
              <input
                id="auth-confirm-password"
                type={showConfirmPassword ? "text" : "password"}
                dir="ltr"
                className="w-full py-3 ps-4 pe-12 text-left"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="new-password"
                required
              />
              <button
                type="button"
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                className="app-icon-btn absolute end-1 top-1/2 -translate-y-1/2"
                style={{
                  color: showConfirmPassword
                    ? "var(--color-primary)"
                    : "var(--color-muted-foreground)",
                }}
                aria-pressed={showConfirmPassword}
                aria-label={
                  showConfirmPassword
                    ? "הסתרת אימות הסיסמה"
                    : "הצגת אימות הסיסמה"
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
          <div className="app-field">
            <label htmlFor="auth-phone" className="app-label">
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
                className="w-full min-w-0 flex-1 px-4 py-3 text-left"
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
                className="w-20 shrink-0 px-2 text-center"
                dir="ltr"
              >
                {PHONE_PREFIXES.map((prefix) => (
                  <option key={prefix} value={prefix}>
                    {prefix}
                  </option>
                ))}
              </select>
            </div>
            <p id="auth-phone-hint" className="app-hint">
              {c("ui.auth.phoneHint") ||
                "אפשר להוסיף מספר טלפון בהמשך. בעת ביצוע הזמנה, נבקש מספר טלפון לצורכי תיאום ועדכוני משלוח."}
            </p>
          </div>
        )}

        {mode === "login" && captchaRequired && (
          <div className="app-field">
            <p className="app-hint">
              לאחר מספר ניסיונות כושלים, יש להשלים את אימות האבטחה כדי להמשיך.
            </p>
            <TurnstileWidget
              siteKey={import.meta.env.VITE_TURNSTILE_SITE_KEY}
              theme={theme}
              onToken={(token) => setTurnstileToken(token)}
              onExpire={() => setTurnstileToken("")}
              onError={() => setError(LOGIN_MESSAGES.CAPTCHA_UNAVAILABLE)}
              resetSignal={captchaReset}
            />
          </div>
        )}

        {(rateLimited ||
          error ||
          unconfirmedEmail ||
          resendMessage) && (
          <div className="space-y-2">
            {rateLimited ? (
              <Alert tone="warning">{LOGIN_MESSAGES.RATE_LIMITED}</Alert>
            ) : error ? (
              <Alert tone="error">{error}</Alert>
            ) : null}
            {unconfirmedEmail && (
              <button
                type="button"
                disabled={cooldown > 0 || resending}
                onClick={() => handleResend(unconfirmedEmail)}
                className="app-btn-secondary w-full text-xs"
              >
                <Icon name="mail" size={14} />
                {resending
                  ? "שולח אימייל אימות..."
                  : cooldown > 0
                    ? `שליחה חוזרת בעוד ${cooldown} שניות`
                    : "שלח לי שוב אימייל אימות"}
              </button>
            )}
            {resendMessage && <Alert tone="info">{resendMessage}</Alert>}
          </div>
        )}

        {/* Terms and Conditions link - only shown in register mode */}
        {mode === "register" && (
          <p
            className="text-center text-xs"
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
            {c("ui.auth.andPrivacy") || "ול"}{" "}
            <Link
              to="/privacy-policy"
              className="underline transition-opacity hover:opacity-70"
              style={{ color: "var(--color-primary)" }}
            >
              {c("ui.auth.privacyLink") || "מדיניות הפרטיות"}
            </Link>{" "}
            {c("ui.auth.termsSuffix") || "שלנו."}
          </p>
        )}

        <button
          type="submit"
          disabled={
            isLoading ||
            (mode === "login" && captchaRequired && !turnstileToken)
          }
          aria-busy={isLoading || undefined}
          className="app-btn w-full"
        >
          {isLoading ? (
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
              {mode === "login"
                ? c("ui.auth.loggingIn") || "מתחבר..."
                : c("ui.auth.creatingAccount") || "יוצר חשבון..."}
            </>
          ) : mode === "login" ? (
            c("ui.auth.login") || "התחברות"
          ) : (
            c("ui.auth.register") || "יצירת חשבון"
          )}
        </button>
      </form>
    </AuthShell>
  )
}
