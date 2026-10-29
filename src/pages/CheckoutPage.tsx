import { useEffect, useRef, useState } from "react"
import { Link, useNavigate } from "react-router"
import { useApp } from "../context/AppContext"
import { useCms } from "../context/CmsContext"
import type { CheckoutFormData, Product } from "../types"
import { effectivePrice, isOnSale } from "../types"
import {
  PHONE_NUMBER_DIGITS,
  PHONE_PREFIXES,
  emailProblem,
  joinPhone,
  parsePhoneParts,
  phoneProblem,
  type PhoneParts,
} from "../lib/auth"
import {
  clearCheckoutIntent,
  rememberProductId,
  rememberedProductId,
} from "../lib/checkout-intent"
import { isSupabaseConfigured } from "../integrations/supabase/supabase"
import Icon from "../components/icons"
import PageHeader from "../components/ui/PageHeader"
import EmptyState from "../components/ui/EmptyState"
import Alert from "../components/ui/Alert"
import Spinner from "../components/ui/Spinner"
import TurnstileWidget from "../components/TurnstileWidget"

/* The red star already used for the confirmation field: every field the
 * customer cannot submit without carries it, on both screens that collect
 * customer details. "חובה" that only appears in an error message after a
 * failed submit is not an indicator. */
const required = (
  <span style={{ color: "var(--color-danger)" }} aria-hidden="true">
    {" *"}
  </span>
)

const FALLBACK_COVER: [string, string] = ["#1A1A2E", "#2A2A3E"]

const fieldClass = "px-3.5 py-2.5 text-sm outline-none"

const fieldStyle = {
  background: "var(--color-card)",
  borderColor: "var(--color-border)",
  color: "var(--color-foreground)",
} as const

const invalidFieldStyle = {
  ...fieldStyle,
  borderColor: "var(--color-danger)",
} as const

function BookCoverMini({ product }: { product: Product }) {
  const [from, to] = product.cover_colors ?? FALLBACK_COVER
  if (product.image_url) {
    return (
      <img
        src={product.image_url}
        alt=""
        className="h-20 w-14 flex-shrink-0 rounded-md object-cover shadow-lg"
      />
    )
  }
  return (
    <div
      className="h-20 w-14 flex-shrink-0 rounded-md shadow-lg"
      style={{ background: `linear-gradient(160deg, ${from}, ${to})` }}
      aria-hidden="true"
    />
  )
}

function CheckoutHeader() {
  return (
    <PageHeader
      eyebrow="CASANOVA · רכישה"
      title="השלמת רכישה"
      description="שני שלבים קצרים: פרטי הלקוח, ואז אישור ההזמנה."
      breadcrumbs={[
        { label: "דף הבית", to: "/" },
        { label: "חנות הספרים", to: "/store" },
        { label: "השלמת רכישה" },
      ]}
    />
  )
}

export default function CheckoutPage() {
  const navigate = useNavigate()
  const { selectedProduct, setSelectedProduct, placeOrder, user, resendConfirmation, authReady, theme } =
    useApp()
  const cms = useCms()

  const product = selectedProduct

  /* One key per checkout attempt: a retry after a lost response returns the
   * order that was already recorded instead of charging twice. */
  const idempotencyKey = useRef(crypto.randomUUID())

  const [resending, setResending] = useState(false)
  const [resendMessage, setResendMessage] = useState<string | null>(null)
  const [cooldown, setCooldown] = useState(0)
  const [captchaToken, setCaptchaToken] = useState("")
  const [captchaReset, setCaptchaReset] = useState(0)

  const captchaSiteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY
  const captchaEnabled = isSupabaseConfigured && Boolean(captchaSiteKey)

  const resetCaptcha = () => {
    setCaptchaToken("")
    setCaptchaReset((value) => value + 1)
  }

  useEffect(() => {
    if (cooldown <= 0) return
    const timer = setInterval(() => setCooldown((c) => c - 1), 1000)
    return () => clearInterval(timer)
  }, [cooldown])

  const handleResend = async (emailToResend: string) => {
    if (cooldown > 0 || resending) return
    if (captchaEnabled && !captchaToken) {
      setResendMessage("יש להשלים את אימות האבטחה לפני שליחת אימייל אימות.")
      return
    }
    setResending(true)
    setResendMessage(null)
    try {
      const res = await resendConfirmation(
        emailToResend,
        captchaEnabled ? captchaToken : undefined,
      )
      if (res.ok) {
        setResendMessage("קישור אימות חדש נשלח בהצלחה לתיבת הדואר שלך!")
        setCooldown(60)
      } else {
        setResendMessage(res.error || "שליחת האימייל נכשלה.")
      }
    } catch {
      setResendMessage("שליחת האימייל נכשלה. אנא נסה שוב מאוחר יותר.")
    } finally {
      setResending(false)
      resetCaptcha()
    }
  }

  const [form, setForm] = useState<Omit<CheckoutFormData, "phone">>({
    first_name: user?.first_name ?? "",
    last_name: user?.last_name ?? "",
    email: user?.email ?? "",
  })

  // Synchronize form with logged-in user
  useEffect(() => {
    if (user) {
      setForm((prev) => ({
        ...prev,
        first_name: prev.first_name || user.first_name || "",
        last_name: prev.last_name || user.last_name || "",
        email: prev.email || user.email || "",
      }))
    }
  }, [user])

  /* The number is two controls, not one free-text box, because the store
   * sells Israeli mobile numbers and a flat field cannot tell a missing
   * digit from a country code. The parsing and the rule live in `lib/auth`
   * beside the register screen's copy of the same control, so both accept
   * exactly the same numbers. */
  const [phoneParts, setPhoneParts] = useState<PhoneParts>(() =>
    parsePhoneParts(user?.phone),
  )

  const phone = joinPhone(phoneParts)

  // Prefill the number from the account, but never over what is being typed
  useEffect(() => {
    if (!user?.phone) return

    setPhoneParts((prev) => (prev.number ? prev : parsePhoneParts(user.phone)))
  }, [user?.phone])

  const [errors, setErrors] = useState<Partial<CheckoutFormData>>({})
  const [isProcessing, setIsProcessing] = useState(false)
  const [submitError, setSubmitError] = useState("")
  const [step, setStep] = useState<"details" | "review">("details")
  const [confirmEmail, setConfirmEmail] = useState("")
  const [confirmEmailError, setConfirmEmailError] = useState("")
  // 18+ gate: the content is adult, so the buyer must explicitly confirm
  // legal age before the order can proceed past the details step.
  const [ageConfirmed, setAgeConfirmed] = useState(false)
  const [ageError, setAgeError] = useState("")

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [step])

  /* A purchase interrupted by the sign-up-then-verify trip comes back to
   * /checkout as a fresh document: the chosen product lived in React state,
   * so the funnel ended on "לא נבחר מוצר" after the customer had already gone
   * and confirmed their address. The id is written down while a purchase is
   * live and read back here from the catalogue, so the order resumes where it
   * stopped instead of starting over. */
  useEffect(() => {
    if (product) rememberProductId(product.product_id)
  }, [product?.product_id])

  const [restorePending, setRestorePending] = useState(
    () => !product && rememberedProductId() !== null,
  )

  useEffect(() => {
    if (product || !restorePending) return

    /* The hosted catalogue is still in flight; a lookup before it answers
     * would report the book as gone. */
    if (cms.catalogLoading) return

    const stored = rememberedProductId()

    if (stored) {
      const match = cms.publishedProducts.find(
        (p) => p.product_id === stored,
      )

      if (match) setSelectedProduct(match)
    }

    setRestorePending(false)
  }, [
    product,
    restorePending,
    cms.catalogLoading,
    cms.publishedProducts,
    setSelectedProduct,
  ])

  // Only ASCII / English characters are allowed in the email address
  const handleEmailChange = (value: string) => {
    const englishOnly = value.replace(/[^\x20-\x7E]/g, "")
    setForm({ ...form, email: englishOnly })
  }

  const handleConfirmEmailChange = (value: string) => {
    const englishOnly = value.replace(/[^\x20-\x7E]/g, "")
    setConfirmEmail(englishOnly)
    // Live feedback once both fields have content
    if (form.email.trim() && englishOnly.trim()) {
      setConfirmEmailError(
        englishOnly.trim().toLowerCase() === form.email.trim().toLowerCase()
          ? ""
          : "הכתובות אינן תואמות",
      )
    } else {
      setConfirmEmailError("")
    }
  }

  const unitPrice = product ? effectivePrice(product) : 0
  const subtotal = unitPrice
  const finalPrice = subtotal

  /* The address printed on the account is the one Supabase verified, so a
   * purchase under it has already proven the thing a typed twice would only
   * re-prove. The confirmation field therefore appears when the buyer edits
   * the address away from the verified one - the single case where a typo
   * would send a receipt somewhere the store cannot verify. Requiring the
   * double entry when nothing was changed asked every customer to retype an
   * address they had just confirmed by email. */
  const typedEmail = form.email.trim().toLowerCase()

  const accountEmail = (user?.email ?? "").trim().toLowerCase()

  /* A signed-out visitor has no account email to compare against. Guest
   * checkout creates the account from the address they type, so the second
   * field stays hidden for them. */
  const needsEmailConfirmation =
    accountEmail.length > 0 &&
    typedEmail.length > 0 &&
    typedEmail !== accountEmail

  const validate = (): boolean => {
    const newErrors: Partial<CheckoutFormData> = {}

    if (!form.first_name.trim()) newErrors.first_name = "שדה חובה"
    if (!form.last_name.trim()) newErrors.last_name = "שדה חובה"

    const emailIssue = emailProblem(form.email)

    if (emailIssue) newErrors.email = emailIssue

    const phoneIssue = phoneProblem(phoneParts, true)

    if (phoneIssue) newErrors.phone = phoneIssue

    let confirmIssue = ""

    if (needsEmailConfirmation) {
      const value = confirmEmail.trim()

      if (!value) confirmIssue = "יש לאמת את כתובת המייל"
      else {
        const issue = emailProblem(value)

        confirmIssue =
          issue ??
          (value.toLowerCase() === typedEmail
            ? ""
            : "כתובות המייל אינן תואמות - יש להקליד שוב את אותה כתובת")
      }
    }

    setConfirmEmailError(confirmIssue)
    setAgeError(ageConfirmed ? "" : "יש לאשר שאתה בן 18 ומעלה כדי להמשיך.")
    setErrors(newErrors)

    return (
      Object.keys(newErrors).length === 0 && !confirmIssue && ageConfirmed
    )
  }

  const handleDetailsNext = () => {
    /* The verified-address gate still applies to a signed-in account. A guest
     * has no account to verify and proceeds straight to review. */
    if (user && isSupabaseConfigured && !user.email_confirmed_at) {
      setSubmitError("יש לאמת את כתובת האימייל שלך לפני ביצוע רכישה.")
      return
    }
    if (validate()) {
      setSubmitError("")
      setStep("review")
    }
  }

  /* No payment gateway is connected in this deployment, so checkout records
   * the order and the store confirms the payment. The page never claims a
   * charge succeeded - the resulting order status is shown as-is. */
  const handleSubmitOrder = async () => {
    if (!product) return
    if (!validate()) {
      setStep("details")
      return
    }
    setIsProcessing(true)
    setSubmitError("")
    const result = await placeOrder({
      product_id: product.product_id,
      first_name: form.first_name.trim(),
      last_name: form.last_name.trim(),
      email: form.email.trim(),
      phone: phone || undefined,
      idempotency_key: idempotencyKey.current,
    })
    setIsProcessing(false)
    if (!result.ok) {
      setSubmitError(result.error)
      setStep("details")
      return
    }
    /* The purchase is recorded, so there is nothing left to resume - and a
     * leftover intent would offer this book again on the next visit. */
    clearCheckoutIntent()
    navigate("/checkout/success")
  }

  const providerConfigured = Boolean(cms.settings.payment_provider)

  if (!product) {
    /* Only a purchase that is actually being resumed holds the screen here;
     * a visitor who arrived with nothing selected gets the honest empty
     * state at once rather than a spinner that leads nowhere. */
    if (restorePending) {
      return (
        <div className="page-enter px-5 py-10 sm:px-8 md:py-14 lg:px-12">
          <div className="app-page app-page--content">
            <CheckoutHeader />
            <div className="app-surface" role="status" aria-live="polite">
              <Spinner label="מאמת את ההזמנה…" />
            </div>
          </div>
        </div>
      )
    }

    return (
      <div className="page-enter px-5 py-10 sm:px-8 md:py-14 lg:px-12">
        <div className="app-page app-page--content">
          <CheckoutHeader />
          <EmptyState
            icon="cart"
            title="לא נבחר מוצר"
            description="כדי להשלים רכישה יש לבחור תחילה מוצר מתוך החנות."
            actions={
              <button
                type="button"
                onClick={() => navigate("/store")}
                className="app-btn"
              >
                לחנות הספרים
              </button>
            }
          />
        </div>
      </div>
    )
  }

  return (
    <div className="page-enter px-5 py-10 sm:px-8 md:py-14 lg:px-12">
      <div className="app-page app-page--content">
        <CheckoutHeader />

        {/* Progress steps */}
        <ol
          className="mb-6 flex flex-wrap items-center gap-3"
          aria-label="שלבי הרכישה"
        >
          <li
            className="flex items-center gap-2"
            aria-current={step === "details" ? "step" : undefined}
          >
            <span
              className="flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold shadow-md"
              style={{
                background:
                  step === "review"
                    ? "var(--color-success)"
                    : step === "details"
                      ? "linear-gradient(135deg, #DE9A60, #96552D)"
                      : "var(--color-muted)",
                color:
                  step === "review"
                    ? "#fff"
                    : step === "details"
                      ? "var(--color-primary-foreground)"
                      : "var(--color-muted-foreground)",
              }}
              aria-hidden="true"
            >
              {step === "review" ? <Icon name="check" size={14} /> : 1}
            </span>
            <span
              className="text-sm font-semibold"
              style={{
                color:
                  step === "details"
                    ? "var(--color-foreground)"
                    : "var(--color-muted-foreground)",
              }}
            >
              פרטים
            </span>
            {step === "review" && <span className="sr-only">הושלם</span>}
          </li>

          <li
            className="h-px w-8"
            style={{ background: "var(--color-border)" }}
            aria-hidden="true"
          />

          <li
            className="flex items-center gap-2"
            aria-current={step === "review" ? "step" : undefined}
          >
            <span
              className="flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold shadow-md"
              style={{
                background:
                  step === "review"
                    ? "linear-gradient(135deg, #DE9A60, #96552D)"
                    : "var(--color-muted)",
                color:
                  step === "review"
                    ? "var(--color-primary-foreground)"
                    : "var(--color-muted-foreground)",
              }}
              aria-hidden="true"
            >
              2
            </span>
            <span
              className="text-sm font-semibold"
              style={{
                color:
                  step === "review"
                    ? "var(--color-foreground)"
                    : "var(--color-muted-foreground)",
              }}
            >
              אישור הזמנה
            </span>
          </li>
        </ol>

        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_23rem] lg:items-start lg:gap-10">
          <div className="min-w-0">
            {step === "details" && (
              <section
                className="app-surface page-enter"
                aria-labelledby="checkout-details-title"
              >
                <div className="app-surface-head">
                  <div>
                    <h2 id="checkout-details-title" className="app-section-title">
                      הפרטים שלך
                    </h2>
                    <p className="app-hint mt-1">
                      {user
                        ? "הפרטים מאשרים את ההזמנה ואת שליחת הקבלה."
                        : isSupabaseConfigured
                          ? "הרכישה תקושר לחשבון של כתובת המייל, והקבלה תישלח אליה."
                          : "משמשים ליצירת החשבון ולשליחת הקבלה."}
                    </p>
                  </div>
                  <span className="app-badge app-badge--neutral">
                    שלב 1 מתוך 2
                  </span>
                </div>

                <div className="app-surface-body">
                  {/* A signed-in account whose address is unverified still has
                   * to confirm it. Guests proceed without an account. */}
                  {user && isSupabaseConfigured && !user.email_confirmed_at ? (
                    <div className="mb-5">
                      <Alert
                        tone="error"
                        title="נדרש אימות כתובת אימייל"
                      >
                        <p>
                          החשבון שלך ({user.email}) טרם אומת. יש ללחוץ על קישור
                          האימות שנשלח לתיבת המייל שלך לפני שתוכל לבצע רכישה.
                        </p>
                        {captchaEnabled && (
                          <div className="mt-3">
                            <p className="app-hint">
                              אימות אבטחה נדרש לפני שליחת אימייל אימות נוסף.
                            </p>
                            <TurnstileWidget
                              siteKey={captchaSiteKey}
                              theme={theme}
                              onToken={(token) => setCaptchaToken(token)}
                              onExpire={() => setCaptchaToken("")}
                              onError={() =>
                                setResendMessage(
                                  "אימות האבטחה אינו זמין כרגע. אנא נסה שוב בעוד רגע.",
                                )
                              }
                              resetSignal={captchaReset}
                            />
                          </div>
                        )}
                        <div className="mt-3 flex flex-wrap items-center gap-3">
                          <button
                            type="button"
                            disabled={
                              cooldown > 0 ||
                              resending ||
                              (captchaEnabled && !captchaToken)
                            }
                            onClick={() => handleResend(user.email)}
                            className="app-btn-secondary"
                          >
                            {resending
                              ? "שולח..."
                              : cooldown > 0
                                ? `שליחה חוזרת בעוד ${cooldown} שניות`
                                : "שלח שוב אימייל אימות"}
                          </button>
                          {resendMessage && (
                            <span
                              className="app-hint"
                              role="status"
                              style={{ color: "var(--color-primary)" }}
                            >
                              {resendMessage}
                            </span>
                          )}
                        </div>
                      </Alert>
                    </div>
                  ) : null}

                  <div className="space-y-5">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="app-field">
                        <label
                          htmlFor="checkout-first-name"
                          className="app-label"
                        >
                          שם פרטי{required}
                        </label>
                        <input
                          id="checkout-first-name"
                          className={`${fieldClass} w-full`}
                          style={
                            errors.first_name
                              ? invalidFieldStyle
                              : fieldStyle
                          }
                          value={form.first_name}
                          autoComplete="given-name"
                          aria-required="true"
                          aria-invalid={errors.first_name ? true : undefined}
                          aria-describedby={
                            errors.first_name
                              ? "checkout-first-name-error"
                              : undefined
                          }
                          onChange={(e) =>
                            setForm({ ...form, first_name: e.target.value })
                          }
                        />
                        {errors.first_name && (
                          <p
                            id="checkout-first-name-error"
                            role="alert"
                            className="app-error"
                          >
                            {errors.first_name}
                          </p>
                        )}
                      </div>

                      <div className="app-field">
                        <label
                          htmlFor="checkout-last-name"
                          className="app-label"
                        >
                          שם משפחה{required}
                        </label>
                        <input
                          id="checkout-last-name"
                          className={`${fieldClass} w-full`}
                          style={
                            errors.last_name ? invalidFieldStyle : fieldStyle
                          }
                          value={form.last_name}
                          autoComplete="family-name"
                          aria-required="true"
                          aria-invalid={errors.last_name ? true : undefined}
                          aria-describedby={
                            errors.last_name
                              ? "checkout-last-name-error"
                              : undefined
                          }
                          onChange={(e) =>
                            setForm({ ...form, last_name: e.target.value })
                          }
                        />
                        {errors.last_name && (
                          <p
                            id="checkout-last-name-error"
                            role="alert"
                            className="app-error"
                          >
                            {errors.last_name}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="app-field">
                      <label htmlFor="checkout-email" className="app-label">
                        כתובת מייל{required}
                      </label>
                      <input
                        id="checkout-email"
                        type="email"
                        dir="ltr"
                        className={`${fieldClass} w-full text-start`}
                        style={
                          errors.email ? invalidFieldStyle : fieldStyle
                        }
                        value={form.email}
                        autoComplete="email"
                        aria-required="true"
                        aria-invalid={errors.email ? true : undefined}
                        aria-describedby={
                          errors.email
                            ? "checkout-email-error checkout-email-hint"
                            : "checkout-email-hint"
                        }
                        onChange={(e) => handleEmailChange(e.target.value)}
                        placeholder="you@example.com"
                      />
                      {errors.email && (
                        <p
                          id="checkout-email-error"
                          role="alert"
                          className="app-error"
                        >
                          {errors.email}
                        </p>
                      )}
                      <p id="checkout-email-hint" className="app-hint">
                        {isSupabaseConfigured
                          ? user
                            ? "כתובת החשבון. אליה יישלח אישור ההזמנה."
                            : "הרכישה תקושר לכתובת הזו, ואליה יישלח קישור להגדרת סיסמה."
                          : "החשבון ייווצר עם הכתובת הזו אם עדיין אין לך אחד."}
                      </p>
                    </div>

                    {/* Only shown when the address above was edited away from
                     * the verified one - see needsEmailConfirmation. */}
                    {needsEmailConfirmation && (
                      <div className="app-field">
                        <label
                          htmlFor="checkout-confirm-email"
                          className="app-label"
                        >
                          אימות כתובת מייל{required}
                        </label>
                        <input
                          id="checkout-confirm-email"
                          type="email"
                          dir="ltr"
                          className={`${fieldClass} w-full text-start`}
                          style={
                            confirmEmailError
                              ? invalidFieldStyle
                              : fieldStyle
                          }
                          value={confirmEmail}
                          aria-required="true"
                          autoComplete="off"
                          aria-invalid={
                            confirmEmailError ? true : undefined
                          }
                          aria-describedby={
                            confirmEmailError
                              ? "checkout-confirm-email-error"
                              : "checkout-confirm-email-status"
                          }
                          onChange={(e) =>
                            handleConfirmEmailChange(e.target.value)
                          }
                          /* Typing, not pasting, is the point of a field that
                           * exists to catch a mistyped address. It only appears
                           * in the one case where that risk is real. */
                          onPaste={(e) => e.preventDefault()}
                          placeholder="הקלד שוב את כתובת המייל"
                        />
                        {confirmEmailError ? (
                          <p
                            id="checkout-confirm-email-error"
                            role="alert"
                            className="app-error"
                          >
                            {confirmEmailError}
                          </p>
                        ) : confirmEmail.trim() &&
                          confirmEmail.trim().toLowerCase() === typedEmail ? (
                          <p
                            id="checkout-confirm-email-status"
                            className="flex items-center gap-1 text-xs"
                            style={{ color: "var(--color-success)" }}
                          >
                            <Icon
                              name="checkCircle"
                              size={13}
                              aria-hidden="true"
                            />
                            הכתובות תואמות - הקבלה והגישה יישלחו לכתובת זו.
                          </p>
                        ) : (
                          <p
                            id="checkout-confirm-email-status"
                            className="app-hint"
                          >
                            כתובת זו שונה מהכתובת המאומתת של החשבון. אימות
                            בהקלדה שוב שומר שהקבלה לא תישלח לכתובת שגויה.
                          </p>
                        )}
                      </div>
                    )}

                    <div className="app-field">
                      <label htmlFor="checkout-phone" className="app-label">
                        מספר טלפון{required}
                      </label>
                      <div className="flex gap-2" dir="rtl">
                        {/* Phone number input - on the right side (RTL) */}
                        <input
                          id="checkout-phone"
                          type="tel"
                          dir="ltr"
                          aria-required="true"
                          aria-invalid={errors.phone ? true : undefined}
                          aria-describedby={
                            errors.phone
                              ? "checkout-phone-error"
                              : "checkout-phone-hint"
                          }
                          className={`${fieldClass} min-w-0 flex-1 text-start`}
                          style={
                            errors.phone ? invalidFieldStyle : fieldStyle
                          }
                          value={phoneParts.number}
                          onChange={(e) =>
                            setPhoneParts((prev) => ({
                              ...prev,
                              number: e.target.value
                                .replace(/[^\d]/g, "")
                                .slice(0, PHONE_NUMBER_DIGITS),
                            }))
                          }
                          onKeyPress={(e) => {
                            // Block non-numeric characters
                            if (
                              !/[0-9]/.test(e.key) &&
                              ![
                                "Backspace",
                                "Delete",
                                "Tab",
                                "Escape",
                                "Enter",
                              ].includes(e.key)
                            ) {
                              e.preventDefault()
                            }
                          }}
                          placeholder="1234567"
                          autoComplete="tel-national"
                          maxLength={PHONE_NUMBER_DIGITS}
                          inputMode="numeric"
                          pattern="[0-9]*"
                        />
                        {/* Phone prefix dropdown - on the left side (RTL) */}
                        <select
                          aria-label="קידומת הטלפון"
                          value={phoneParts.prefix}
                          onChange={(e) =>
                            setPhoneParts((prev) => ({
                              ...prev,
                              prefix: e.target.value,
                            }))
                          }
                          className={`${fieldClass} w-20 shrink-0 text-center`}
                          style={fieldStyle}
                          dir="ltr"
                        >
                          {PHONE_PREFIXES.map((prefix) => (
                            <option key={prefix} value={prefix}>
                              {prefix}
                            </option>
                          ))}
                        </select>
                      </div>
                      {errors.phone ? (
                        <p
                          id="checkout-phone-error"
                          role="alert"
                          className="app-error"
                        >
                          {errors.phone}
                        </p>
                      ) : (
                        <p id="checkout-phone-hint" className="app-hint">
                          חובה לרכישה - לצורכי יצירת קשר על ההזמנה.
                        </p>
                      )}
                    </div>

                    <div>
                      <label
                        htmlFor="checkout-age-confirm"
                        className="flex cursor-pointer items-start gap-3 rounded-[var(--radius-md)] border p-4 transition-colors"
                        style={{
                          borderColor: ageError
                            ? "rgba(167,70,54,0.4)"
                            : "var(--color-border)",
                          background: "var(--color-secondary)",
                        }}
                      >
                        <input
                          id="checkout-age-confirm"
                          type="checkbox"
                          checked={ageConfirmed}
                          aria-required="true"
                          aria-invalid={ageError ? true : undefined}
                          aria-describedby={
                            ageError ? "checkout-age-error" : undefined
                          }
                          onChange={(e) => {
                            setAgeConfirmed(e.target.checked)
                            if (e.target.checked) setAgeError("")
                          }}
                          className="mt-0.5 h-4 w-4 flex-shrink-0"
                        />
                        <span className="text-sm leading-relaxed">
                          אני מאשר כי אני בן 18 ומעלה וכי אני רשאי על פי דין
                          לצפות ולרכוש תוכן המיועד למבוגרים. קראתי את{" "}
                          <Link
                            to="/terms-and-conditions"
                            className="font-medium underline transition-opacity hover:opacity-70"
                            style={{ color: "var(--color-primary)" }}
                          >
                            תנאי השימוש
                          </Link>{" "}
                          ואת{" "}
                          <Link
                            to="/privacy-policy"
                            className="font-medium underline transition-opacity hover:opacity-70"
                            style={{ color: "var(--color-primary)" }}
                          >
                            מדיניות הפרטיות
                          </Link>{" "}
                          ואני מסכים להם.
                        </span>
                      </label>
                      {ageError && (
                        <p
                          id="checkout-age-error"
                          role="alert"
                          className="app-error mt-1"
                        >
                          {ageError}
                        </p>
                      )}
                    </div>
                  </div>

                  {submitError && (
                    <div className="mt-5">
                      <Alert tone="error">{submitError}</Alert>
                    </div>
                  )}

                  <p className="app-hint mt-5">{required} שדות חובה</p>

                  <button
                    type="button"
                    onClick={handleDetailsNext}
                    disabled={isSupabaseConfigured && !authReady}
                    aria-busy={isSupabaseConfigured && !authReady}
                    className="app-btn mt-5 w-full py-3.5"
                  >
                    {isSupabaseConfigured && !authReady
                      ? "מאמת את החיבור..."
                      : "המשך לאישור ההזמנה"}
                    <Icon name="arrowLeft" size={16} aria-hidden="true" />
                  </button>
                </div>
              </section>
            )}

            {step === "review" && (
              <section
                className="app-surface page-enter"
                aria-labelledby="checkout-review-title"
              >
                <div className="app-surface-head">
                  <div>
                    <h2 id="checkout-review-title" className="app-section-title">
                      אישור ההזמנה
                    </h2>
                    <p className="app-hint mt-1">
                      בדקו את הפרטים לפני שליחת ההזמנה.
                    </p>
                  </div>
                  <span className="app-badge app-badge--neutral">
                    שלב 2 מתוך 2
                  </span>
                </div>

                <div className="app-surface-body">
                  <div
                    className="mb-3 rounded-[var(--radius-md)] border px-4 py-3"
                    style={{
                      background: "var(--color-secondary)",
                      borderColor: "var(--color-border)",
                    }}
                  >
                    <div className="mb-2 flex flex-wrap items-center justify-start gap-x-3 gap-y-1">
                      <button
                        type="button"
                        onClick={() => setStep("details")}
                        className="shrink-0 text-xs font-semibold underline underline-offset-4 transition-opacity hover:opacity-70"
                        style={{ color: "var(--color-primary)" }}
                      >
                        עריכת הפרטים
                      </button>
                      <h3 className="app-label">פרטי הלקוח</h3>
                    </div>
                    <dl className="divide-y divide-white/10 text-sm">
                      <div className="py-2 first:pt-0 last:pb-0">
                        <dt
                          className="text-[11px] font-medium"
                          style={{ color: "var(--color-muted-foreground)" }}
                        >
                          שם מלא
                        </dt>
                        <dd
                          className="mt-0.5 break-words font-medium"
                          style={{ color: "var(--color-foreground)" }}
                        >
                          {form.first_name} {form.last_name}
                        </dd>
                      </div>
                      <div className="py-2 first:pt-0 last:pb-0">
                        <dt
                          className="text-[11px] font-medium"
                          style={{ color: "var(--color-muted-foreground)" }}
                        >
                          בדיקת מייל
                        </dt>
                        <dd
                          className="mt-0.5 break-all font-medium"
                          style={{ color: "var(--color-foreground)" }}
                        >
                          <span dir="ltr">{form.email}</span>
                        </dd>
                      </div>
                      <div className="py-2 first:pt-0 last:pb-0">
                        <dt
                          className="text-[11px] font-medium"
                          style={{ color: "var(--color-muted-foreground)" }}
                        >
                          בדיקת מספר טלפון נייד
                        </dt>
                        <dd
                          className="mt-0.5 font-medium"
                          style={{ color: "var(--color-foreground)" }}
                        >
                          <span dir="ltr">{phone}</span>
                        </dd>
                      </div>
                    </dl>
                  </div>

                  {/* Payment handling - stated truthfully, never simulated */}
                  <div
                    className={`app-alert ${providerConfigured ? "" : "app-alert--success"}`}
                  >
                    <Icon
                      name={providerConfigured ? "lock" : "checkCircle"}
                      size={17}
                      style={{
                        flexShrink: 0,
                        marginTop: 2,
                        color: providerConfigured
                          ? "var(--color-primary)"
                          : "var(--color-success)",
                      }}
                      aria-hidden="true"
                    />
                    <div className="text-sm">
                      {providerConfigured ? (
                        <>
                          התשלום יועבר דרך הספק{" "}
                          {cms.settings.payment_provider}.
                        </>
                      ) : (
                        <>
                          <strong style={{ color: "var(--color-foreground)" }}>
                            הרכישה מאושרת מיידית.
                          </strong>{" "}
                          כיוון שטרם הוגדר ספק תשלומים, ההזמנה תאושר אוטומטית
                          עם השליחה - החשבון ייפתח, הגישה למוצר תינתן מיד
                          ותוכלו להתחיל לקרוא ללא המתנה.
                        </>
                      )}
                    </div>
                  </div>

                  {submitError && (
                    <div className="mt-4">
                      <Alert tone="error">{submitError}</Alert>
                    </div>
                  )}

                  {!user && (
                    <p className="app-hint mt-4">
                      {isSupabaseConfigured
                        ? "הרכישה תקושר לחשבון של כתובת המייל; יישלח קישור להגדרת סיסמה."
                        : "החשבון ייווצר אוטומטית עם כתובת המייל."}
                    </p>
                  )}

                  <button
                    type="button"
                    onClick={handleSubmitOrder}
                    disabled={isProcessing}
                    aria-busy={isProcessing}
                    className="app-btn mt-5 flex w-full items-center justify-center gap-2 py-3.5"
                  >
                    {isProcessing ? (
                      <>
                        <span
                          className="app-spinner"
                          style={{
                            width: "1rem",
                            height: "1rem",
                            borderColor: "rgba(20,17,14,0.3)",
                            borderTopColor: "var(--color-primary-foreground)",
                          }}
                          aria-hidden="true"
                        />
                        שולח הזמנה...
                      </>
                    ) : (
                      <>
                        שליחת הזמנה ·{" "}
                        <span dir="ltr">₪{finalPrice.toLocaleString()}</span>
                        <Icon name="arrowLeft" size={16} aria-hidden="true" />
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => setStep("details")}
                    disabled={isProcessing}
                    className="app-btn-ghost mt-2 w-full"
                  >
                    <Icon name="arrowRight" size={15} aria-hidden="true" />
                    חזרה לפרטים
                  </button>
                </div>
              </section>
            )}
          </div>

          {/* Order summary */}
          <aside className="min-w-0">
            <div className="app-surface lg:sticky lg:top-24">
              <div className="app-surface-head">
                <h2
                  id="checkout-summary-title"
                  className="app-section-title"
                >
                  סיכום הזמנה
                </h2>
                <span className="app-badge app-badge--neutral">מוצר אחד</span>
              </div>

              <div className="app-surface-body">
                <div
                  className="mb-5 flex gap-4 border-b pb-5"
                  style={{ borderColor: "var(--color-border)" }}
                >
                  <BookCoverMini product={product} />
                  <div className="min-w-0">
                    <p className="mb-1 font-display text-base font-semibold leading-snug">
                      {product.name}
                    </p>
                    {product.book?.author_name && (
                      <p className="text-xs app-muted">
                        מאת {product.book.author_name}
                      </p>
                    )}
                    <p className="app-hint mt-1.5">
                      {providerConfigured
                        ? "הגישה תיפתח לאחר אישור התשלום."
                        : "ההזמנה תאושר עם השליחה."}
                    </p>
                  </div>
                </div>

                <div className="space-y-2 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <span className="app-muted">סכום ביניים</span>
                    <span className="flex items-baseline gap-2">
                      {isOnSale(product) && (
                        <s
                          className="text-xs app-muted"
                          aria-label={`מחיר קודם: ₪${product.price.toLocaleString()}`}
                        >
                          <span dir="ltr">
                            ₪{product.price.toLocaleString()}
                          </span>
                        </s>
                      )}
                      <span dir="ltr">₪{subtotal.toLocaleString()}</span>
                    </span>
                  </div>
                  <div
                    className="flex items-center justify-between gap-3 border-t pt-2 text-base font-semibold"
                    style={{ borderColor: "var(--color-border)" }}
                  >
                    <span>סה״כ לתשלום</span>
                    <span
                      className="font-display text-lg"
                      style={{ color: "var(--color-primary)" }}
                    >
                      <span dir="ltr">₪{finalPrice.toLocaleString()}</span>
                    </span>
                  </div>
                </div>

                <div
                  className="mt-5 space-y-2 border-t pt-4 text-xs"
                  style={{
                    borderColor: "var(--color-border)",
                    color: "var(--color-muted-foreground)",
                  }}
                >
                  {[
                    user
                      ? "ההזמנה נרשמת לחשבון שלך"
                      : isSupabaseConfigured
                        ? "הרכישה תקושר לחשבון לפי כתובת המייל"
                        : "החשבון נוצר אוטומטית לפי כתובת המייל",
                    "ההזמנה נשמרת במערכת עם מספר הזמנה למעקב",
                  ].map((item) => (
                    <div key={item} className="flex items-start gap-2">
                      <Icon
                        name="checkCircle"
                        size={14}
                        style={{
                          color: "var(--color-success)",
                          flexShrink: 0,
                          marginTop: 2,
                        }}
                        aria-hidden="true"
                      />
                      <span>{item}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  )
}
