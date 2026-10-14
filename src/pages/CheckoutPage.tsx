import { useEffect, useMemo, useState } from "react"
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

function BookCoverMini({ product }: { product: Product }) {
  const [from, to] = product.cover_colors ?? FALLBACK_COVER
  if (product.image_url) {
    return (
      <img
        src={product.image_url}
        alt={product.name}
        className="w-12 h-16 rounded-lg flex-shrink-0 shadow-lg object-cover"
      />
    )
  }
  return (
    <div
      className="w-12 h-16 rounded-lg flex-shrink-0 shadow-lg"
      style={{ background: `linear-gradient(160deg, ${from}, ${to})` }}
    />
  )
}

export default function CheckoutPage() {
  const navigate = useNavigate()
  const { selectedProduct, setSelectedProduct, placeOrder, user, resendConfirmation } =
    useApp()
  const cms = useCms()

  const product = selectedProduct

  const [resending, setResending] = useState(false)
  const [resendMessage, setResendMessage] = useState<string | null>(null)
  const [cooldown, setCooldown] = useState(0)

  useEffect(() => {
    if (cooldown <= 0) return
    const timer = setInterval(() => setCooldown((c) => c - 1), 1000)
    return () => clearInterval(timer)
  }, [cooldown])

  const handleResend = async (emailToResend: string) => {
    if (cooldown > 0 || resending) return
    setResending(true)
    setResendMessage(null)
    const res = await resendConfirmation(emailToResend)
    setResending(false)
    if (res.ok) {
      setResendMessage("קישור אימות חדש נשלח בהצלחה לתיבת הדואר שלך!")
      setCooldown(60)
    } else {
      setResendMessage(res.error || "שליחת האימייל נכשלה.")
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
   * the address away from the verified one — the single case where a typo
   * would send a receipt somewhere the store cannot verify. Requiring the
   * double entry when nothing was changed asked every customer to retype an
   * address they had just confirmed by email. */
  const typedEmail = form.email.trim().toLowerCase()

  const accountEmail = (user?.email ?? "").trim().toLowerCase()

  /* A signed-out visitor has no verified address to deviate from, and cannot
   * reach the review step at all, so the confirmation field would only be
   * noise there. It answers to an account or not at all. */
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
            : "כתובות המייל אינן תואמות — יש להקליד שוב את אותה כתובת")
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
    if (!user) {
      setSubmitError("יש להתחבר או להירשם לחשבון כדי להמשיך לרכישה.")
      return
    }
    /* The verified-address gate is a hosted-backend rule. Without Supabase
     * there is nothing that can confirm an address — no mail is sent and no
     * `email_confirmed_at` is ever written — so requiring it here demanded the
     * customer satisfy a condition the product could not offer them, and the
     * screen refused with a message pointing at an email that never arrives.
     * (docs/PRODUCTION_PLAN.md B2 gates real purchases on real verification,
     * and the local driver is not a real purchase path.) */
    if (isSupabaseConfigured && !user.email_confirmed_at) {
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
   * charge succeeded — the resulting order status is shown as-is. */
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
    })
    setIsProcessing(false)
    if (!result.ok) {
      setSubmitError(result.error)
      setStep("details")
      return
    }
    /* The purchase is recorded, so there is nothing left to resume — and a
     * leftover intent would offer this book again on the next visit. */
    clearCheckoutIntent()
    navigate("/checkout/success")
  }

  const providerConfigured = Boolean(cms.settings.payment_provider)

  const inputClass =
    "w-full px-4 py-2.5 rounded-xl border text-sm outline-none transition-all focus:border-[rgba(212,160,48,0.6)]"
  const inputStyle = useMemo(
    () => ({
      background: "var(--color-secondary)",
      borderColor: "var(--color-border)",
      color: "var(--color-foreground)",
    }),
    [],
  )

  if (!product) {
    /* Only a purchase that is actually being resumed holds the screen here;
     * a visitor who arrived with nothing selected gets the honest empty
     * state at once rather than a spinner that leads nowhere. */
    if (restorePending) {
      return (
        <div
          className="min-h-screen flex items-center justify-center px-6"
          style={{ background: "var(--color-background)" }}
          role="status"
          aria-live="polite"
        >
          <span
            className="w-6 h-6 rounded-full border-2 animate-spin"
            style={{
              borderColor: "var(--color-border)",
              borderTopColor: "var(--color-primary)",
            }}
          />
          <span className="sr-only">מאמת את ההזמנה…</span>
        </div>
      )
    }

    return (
      <div
        className="min-h-screen flex items-center justify-center px-6"
        style={{ background: "var(--color-background)" }}
      >
        <div
          className="max-w-md w-full rounded-2xl border p-10 text-center"
          style={{
            background: "var(--color-card)",
            borderColor: "var(--color-border)",
            color: "var(--color-foreground)",
          }}
        >
          <span
            className="w-14 h-14 rounded-full mx-auto mb-4 flex items-center justify-center"
            style={{
              background: "rgba(212,160,48,0.12)",
              color: "var(--color-primary)",
            }}
          >
            <Icon name="cart" size={24} />
          </span>
          <h1 className="font-display text-2xl font-bold mb-2">לא נבחר מוצר</h1>
          <p
            className="text-sm mb-6"
            style={{ color: "var(--color-muted-foreground)" }}
          >
            כדי להשלים רכישה יש לבחור תחילה מוצר מתוך החנות.
          </p>
          <button
            onClick={() => navigate("/store")}
            className="btn-gradient px-8 py-3 rounded-full font-bold text-sm"
          >
            לחנות
          </button>
        </div>
      </div>
    )
  }

  return (
    <div
      className="min-h-screen"
      style={{ background: "var(--color-background)" }}
    >
      <div className="max-w-5xl mx-auto px-6 py-16">
        <div className="mb-8">
          <button
            onClick={() => navigate(-1)}
            className="text-sm flex items-center gap-2 transition-opacity hover:opacity-70"
            style={{ color: "var(--color-muted-foreground)" }}
          >
            → חזרה
          </button>
        </div>

        <div className="grid md:grid-cols-[1fr_380px] gap-10">
          {/* Form */}
          <div>
            {/* Progress steps */}
            <div className="flex items-center gap-3 mb-8">
              {["פרטים", "אישור הזמנה"].map((label, i) => {
                const active =
                  (i === 0 && step === "details") ||
                  (i === 1 && step === "review")
                const done = i === 0 && step === "review"
                return (
                  <div key={label} className="flex items-center gap-3">
                    <div className="flex items-center gap-2">
                      <div
                        className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shadow-md"
                        style={{
                          background: done
                            ? "var(--color-success)"
                            : active
                              ? "linear-gradient(135deg, #E7B94C, #B8862A)"
                              : "var(--color-muted)",
                          color:
                            done || active
                              ? "#000"
                              : "var(--color-muted-foreground)",
                        }}
                      >
                        {done ? <Icon name="check" size={14} /> : i + 1}
                      </div>
                      <span
                        className="text-sm font-bold"
                        style={{
                          color: active
                            ? "var(--color-foreground)"
                            : "var(--color-muted-foreground)",
                        }}
                      >
                        {label}
                      </span>
                    </div>
                    {i < 1 && (
                      <div
                        className="w-8 h-px"
                        style={{ background: "var(--color-border)" }}
                      />
                    )}
                  </div>
                )
              })}
            </div>

            {step === "details" && (
              <div className="page-enter">
                <h1 className="font-display text-3xl font-bold mb-1">
                  הפרטים שלך
                </h1>
                <p
                  className="text-sm mb-8"
                  style={{ color: "var(--color-muted-foreground)" }}
                >
                  {isSupabaseConfigured
                    ? "הפרטים מאשרים את ההזמנה ואת שליחת הקבלה."
                    : "משמשים ליצירת החשבון ולשליחת הקבלה."}
                </p>

                {/* Verified-User Gate Banner */}
                {!user ? (
                  <div
                    className="p-5 rounded-2xl mb-8 border flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4"
                    style={{
                      background: "rgba(212,160,48,0.06)",
                      borderColor: "rgba(212,160,48,0.3)",
                    }}
                  >
                    <div className="space-y-1">
                      <h3
                        className="font-semibold text-sm"
                        style={{ color: "var(--color-primary)" }}
                      >
                        חשבון משתמש נדרש לרכישה
                      </h3>
                      <p
                        className="text-xs"
                        style={{ color: "var(--color-muted-foreground)" }}
                      >
                        כדי להעניק לך גישה מיידית לספר בספרייה הדיגיטלית, יש להתחבר או להירשם.
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => navigate("/login?redirect=/checkout")}
                        className="px-4 py-2 rounded-lg text-xs font-semibold border transition-all"
                        style={{
                          borderColor: "var(--color-primary)",
                          color: "var(--color-primary)",
                        }}
                      >
                        התחברות
                      </button>
                      <button
                        type="button"
                        onClick={() => navigate("/register?redirect=/checkout")}
                        className="btn-gradient px-4 py-2 rounded-lg text-xs font-semibold"
                      >
                        יצירת חשבון
                      </button>
                    </div>
                  </div>
                ) : isSupabaseConfigured && !user.email_confirmed_at ? (
                  <div
                    className="p-5 rounded-2xl mb-8 border space-y-3"
                    style={{
                      background: "rgba(239,68,68,0.06)",
                      borderColor: "rgba(239,68,68,0.3)",
                    }}
                  >
                    <div className="flex items-start gap-3">
                      <Icon
                        name="alertTriangle"
                        size={18}
                        className="shrink-0 text-red-500 mt-0.5"
                      />
                      <div>
                        <h3 className="font-semibold text-sm text-red-500">
                          נדרש אימות כתובת אימייל
                        </h3>
                        <p
                          className="text-xs mt-0.5"
                          style={{ color: "var(--color-muted-foreground)" }}
                        >
                          החשבון שלך ({user.email}) טרם אומת. יש ללחוץ על קישור האימות שנשלח לתיבת המייל שלך לפני שתוכל לבצע רכישה.
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        disabled={cooldown > 0 || resending}
                        onClick={() => handleResend(user.email)}
                        className="px-3.5 py-1.5 rounded-lg border text-xs font-medium transition-all disabled:opacity-50"
                        style={{
                          borderColor: "var(--color-border)",
                          color: "var(--color-foreground)",
                        }}
                      >
                        {resending
                          ? "שולח..."
                          : cooldown > 0
                          ? `שליחה חוזרת בעוד ${cooldown} שניות`
                          : "שלח שוב אימייל אימות"}
                      </button>
                      {resendMessage && (
                        <span
                          className="text-xs"
                          style={{ color: "var(--color-primary)" }}
                        >
                          {resendMessage}
                        </span>
                      )}
                    </div>
                  </div>
                ) : null}

                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label
                        htmlFor="checkout-first-name"
                        className="block text-xs font-bold mb-1.5"
                        style={{ color: "var(--color-muted-foreground)" }}
                      >
                        שם פרטי{required}
                      </label>
                      <input
                        id="checkout-first-name"
                        className={inputClass}
                        style={inputStyle}
                        value={form.first_name}
                        aria-invalid={errors.first_name ? true : undefined}
                        aria-describedby={
                          errors.first_name ? "checkout-first-name-error" : undefined
                        }
                        onChange={(e) =>
                          setForm({ ...form, first_name: e.target.value })
                        }
                      />
                      {errors.first_name && (
                        <p
                          id="checkout-first-name-error"
                          role="alert"
                          className="text-xs mt-1"
                          style={{ color: "var(--color-danger)" }}
                        >
                          {errors.first_name}
                        </p>
                      )}
                    </div>
                    <div>
                      <label
                        htmlFor="checkout-last-name"
                        className="block text-xs font-bold mb-1.5"
                        style={{ color: "var(--color-muted-foreground)" }}
                      >
                        שם משפחה{required}
                      </label>
                      <input
                        id="checkout-last-name"
                        className={inputClass}
                        style={inputStyle}
                        value={form.last_name}
                        aria-invalid={errors.last_name ? true : undefined}
                        aria-describedby={
                          errors.last_name ? "checkout-last-name-error" : undefined
                        }
                        onChange={(e) =>
                          setForm({ ...form, last_name: e.target.value })
                        }
                      />
                      {errors.last_name && (
                        <p
                          id="checkout-last-name-error"
                          role="alert"
                          className="text-xs mt-1"
                          style={{ color: "var(--color-danger)" }}
                        >
                          {errors.last_name}
                        </p>
                      )}
                    </div>
                  </div>

                  <div>
                    <label
                      htmlFor="checkout-email"
                      className="block text-xs font-bold mb-1.5"
                      style={{ color: "var(--color-muted-foreground)" }}
                    >
                      כתובת מייל{required}
                    </label>
                    <input
                      id="checkout-email"
                      type="email"
                      dir="ltr"
                      className={`${inputClass} text-left`}
                      style={inputStyle}
                      value={form.email}
                      aria-invalid={errors.email ? true : undefined}
                      aria-describedby={
                        errors.email ? "checkout-email-error checkout-email-hint" : "checkout-email-hint"
                      }
                      onChange={(e) => handleEmailChange(e.target.value)}
                      placeholder="you@example.com"
                    />
                    {errors.email && (
                      <p
                        id="checkout-email-error"
                        role="alert"
                        className="text-xs mt-1"
                        style={{ color: "var(--color-danger)" }}
                      >
                        {errors.email}
                      </p>
                    )}
                    <p
                      id="checkout-email-hint"
                      className="text-xs mt-1"
                      style={{ color: "var(--color-muted-foreground)" }}
                    >
                      {/* "החשבון שלך ייווצר עם הכתובת הזו" described a guest
                       * checkout that the hosted flow does not have: a
                       * purchase is only allowed for a signed-in, verified
                       * account, so this address is not creating anything. */}
                      {isSupabaseConfigured
                        ? "כתובת החשבון המאומת. אליה תישלח הקבלה."
                        : "החשבון ייווצר עם הכתובת הזו אם עדיין אין לך אחד."}
                    </p>
                  </div>

                  {/* Only shown when the address above was edited away from
                   * the verified one — see needsEmailConfirmation. */}
                  {needsEmailConfirmation && (
                    <div>
                      <label
                        htmlFor="checkout-confirm-email"
                        className="block text-xs font-bold mb-1.5"
                        style={{ color: "var(--color-muted-foreground)" }}
                      >
                        אימות כתובת מייל{required}
                      </label>
                      <input
                        id="checkout-confirm-email"
                        type="email"
                        dir="ltr"
                        className={`${inputClass} text-left`}
                        style={inputStyle}
                        value={confirmEmail}
                        aria-invalid={confirmEmailError ? true : undefined}
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
                          className="text-xs mt-1"
                          style={{ color: "var(--color-danger)" }}
                        >
                          {confirmEmailError}
                        </p>
                      ) : confirmEmail.trim() &&
                        confirmEmail.trim().toLowerCase() === typedEmail ? (
                        <p
                          id="checkout-confirm-email-status"
                          className="text-xs mt-1 flex items-center gap-1"
                          style={{ color: "var(--color-success)" }}
                        >
                          <Icon name="checkCircle" size={13} /> הכתובות תואמות —
                          הקבלה והגישה יישלחו לכתובת זו.
                        </p>
                      ) : (
                        <p
                          id="checkout-confirm-email-status"
                          className="text-xs mt-1"
                          style={{ color: "var(--color-muted-foreground)" }}
                        >
                          כתובת זו שונה מהכתובת המאומתת של החשבון. אימות בהקלדה
                          שוב שומר שהקבלה לא תישלח לכתובת שגויה.
                        </p>
                      )}
                    </div>
                  )}

                  <div>
                    <label
                      htmlFor="checkout-phone"
                      className="block text-xs font-bold mb-1.5"
                      style={{ color: "var(--color-muted-foreground)" }}
                    >
                      מספר טלפון{required}
                    </label>
                    <div className="flex gap-2" dir="rtl">
                      {/* Phone number input - on the right side (RTL) */}
                      <input
                        id="checkout-phone"
                        type="tel"
                        dir="ltr"
                        aria-invalid={errors.phone ? true : undefined}
                        aria-describedby={
                          errors.phone
                            ? "checkout-phone-error"
                            : "checkout-phone-hint"
                        }
                        className={`${inputClass} text-left flex-1`}
                        style={inputStyle}
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
                        className={`${inputClass} text-center flex-shrink-0`}
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
                    {errors.phone ? (
                      <p
                        id="checkout-phone-error"
                        role="alert"
                        className="text-xs mt-1"
                        style={{ color: "var(--color-danger)" }}
                      >
                        {errors.phone}
                      </p>
                    ) : (
                      <p
                        id="checkout-phone-hint"
                        className="text-xs mt-1"
                        style={{ color: "var(--color-muted-foreground)" }}
                      >
                        חובה לרכישה — לצורכי יצירת קשר על ההזמנה.
                      </p>
                    )}
                  </div>

                  <div>
                    <label
                      className="flex items-start gap-3 cursor-pointer rounded-xl border p-4 transition-colors"
                      style={{
                        borderColor: ageError
                          ? "rgba(239,68,68,0.4)"
                          : "var(--color-border)",
                        background: "var(--color-secondary)",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={ageConfirmed}
                        onChange={(e) => {
                          setAgeConfirmed(e.target.checked)
                          if (e.target.checked) setAgeError("")
                        }}
                        className="mt-0.5 w-4 h-4 flex-shrink-0 accent-[#D4A030]"
                      />
                      <span
                        className="text-sm leading-relaxed"
                        style={{ color: "var(--color-foreground)" }}
                      >
                        אני מאשר כי אני בן 18 ומעלה וכי אני רשאי על פי דין
                        לצפות ולרכוש תוכן המיועד למבוגרים. קראתי את{" "}
                        <Link
                          to="/terms-and-conditions"
                          className="underline font-medium transition-opacity hover:opacity-70"
                          style={{ color: "var(--color-primary)" }}
                        >
                          תנאי השימוש
                        </Link>{" "}
                        ואני מסכים להם.
                      </span>
                    </label>
                    {ageError && (
                      <p
                        className="text-xs mt-1"
                        style={{ color: "var(--color-danger)" }}
                      >
                        {ageError}
                      </p>
                    )}
                  </div>
                </div>

                {submitError && (
                  <div
                    className="mt-6 px-4 py-3 rounded-xl border text-sm"
                    style={{
                      background: "rgba(239,68,68,0.08)",
                      borderColor: "rgba(239,68,68,0.3)",
                      color: "var(--color-danger)",
                    }}
                  >
                    {submitError}
                  </div>
                )}

                <button
                  onClick={handleDetailsNext}
                  className="btn-gradient mt-8 w-full py-3.5 rounded-full font-bold"
                >
                  המשך לאישור ההזמנה
                </button>
              </div>
            )}

            {step === "review" && (
              <div className="page-enter">
                <h1 className="font-display text-3xl font-bold mb-1">
                  אישור ההזמנה
                </h1>
                <p
                  className="text-sm mb-8"
                  style={{ color: "var(--color-muted-foreground)" }}
                >
                  בדוק את הפרטים לפני שליחת ההזמנה.
                </p>

                <div
                  className="p-5 rounded-xl border mb-4"
                  style={{
                    background: "var(--color-secondary)",
                    borderColor: "var(--color-border)",
                  }}
                >
                  <h2
                    className="text-xs font-bold mb-3"
                    style={{ color: "var(--color-muted-foreground)" }}
                  >
                    פרטי הלקוח
                  </h2>
                  <div className="grid sm:grid-cols-2 gap-2 text-sm">
                    <p>
                      {form.first_name} {form.last_name}
                    </p>
                    <p dir="ltr" className="text-left">
                      {form.email}
                    </p>
                    <p dir="ltr" className="text-left">
                      {phone}
                    </p>
                  </div>
                  <button
                    onClick={() => setStep("details")}
                    className="mt-4 text-xs font-bold transition-opacity hover:opacity-70"
                    style={{ color: "var(--color-primary)" }}
                  >
                    עריכת הפרטים
                  </button>
                </div>

                {/* Payment handling — stated truthfully, never simulated */}
                <div
                  className="p-4 rounded-xl border flex items-start gap-3 mb-4"
                  style={{
                    background: providerConfigured
                      ? "rgba(212,160,48,0.06)"
                      : "rgba(34,197,94,0.08)",
                    borderColor: providerConfigured
                      ? "rgba(212,160,48,0.3)"
                      : "rgba(34,197,94,0.3)",
                  }}
                >
                  <Icon
                    name={providerConfigured ? "lock" : "checkCircle"}
                    size={16}
                    style={{
                      color: providerConfigured
                        ? "var(--color-primary)"
                        : "var(--color-success)",
                    }}
                  />
                  <div
                    className="text-sm"
                    style={{ color: "var(--color-muted-foreground)" }}
                  >
                    {providerConfigured ? (
                      <>
                        התשלום יועבר דרך הספק {cms.settings.payment_provider}.
                      </>
                    ) : (
                      <>
                        <strong style={{ color: "var(--color-foreground)" }}>
                          הרכישה מאושרת מיידית.
                        </strong>{" "}
                        כיוון שטרם הוגדר ספק תשלומים, ההזמנה תאושר אוטומטית עם
                        השליחה — החשבון ייפתח, הגישה למוצר תינתן מיד ותוכלו
                        להתחיל לקרוא ללא המתנה.
                      </>
                    )}
                  </div>
                </div>

                {submitError && (
                  <div
                    className="mb-4 px-4 py-3 rounded-xl border text-sm"
                    style={{
                      background: "rgba(239,68,68,0.08)",
                      borderColor: "rgba(239,68,68,0.3)",
                      color: "var(--color-danger)",
                    }}
                  >
                    {submitError}
                  </div>
                )}

                <button
                  onClick={handleSubmitOrder}
                  disabled={isProcessing}
                  className="btn-gradient mt-4 w-full py-3.5 rounded-full font-bold disabled:opacity-60 flex items-center justify-center gap-2"
                >
                  {isProcessing ? (
                    <>
                      <div className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                      שולח הזמנה...
                    </>
                  ) : (
                    `שליחת הזמנה · ₪${finalPrice.toLocaleString()}`
                  )}
                </button>

                <button
                  onClick={() => setStep("details")}
                  disabled={isProcessing}
                  className="mt-3 w-full text-sm transition-opacity hover:opacity-70 disabled:opacity-30"
                  style={{ color: "var(--color-muted-foreground)" }}
                >
                  → חזרה לפרטים
                </button>
              </div>
            )}
          </div>

          {/* Order summary */}
          <div>
            <div className="card-glow rounded-2xl p-6 sticky top-24">
              <h2
                className="font-bold mb-4 text-sm"
                style={{ color: "var(--color-muted-foreground)" }}
              >
                סיכום הזמנה
              </h2>

              <div
                className="flex gap-4 mb-6 pb-6 border-b"
                style={{ borderColor: "var(--color-border)" }}
              >
                <BookCoverMini product={product} />
                <div>
                  <p className="font-bold text-sm leading-snug mb-1">
                    {product.name}
                  </p>
                  {product.book?.author_name && (
                    <p
                      className="text-xs"
                      style={{ color: "var(--color-muted-foreground)" }}
                    >
                      מאת {product.book.author_name}
                    </p>
                  )}
                  <p
                    className="text-xs mt-1"
                    style={{ color: "var(--color-muted-foreground)" }}
                  >
                    גישה מיידית עם אישור התשלום
                  </p>
                </div>
              </div>

              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span style={{ color: "var(--color-muted-foreground)" }}>
                    סכום ביניים
                  </span>
                  <span className="flex items-baseline gap-2">
                    {isOnSale(product) && (
                      <span
                        className="text-xs line-through"
                        style={{ color: "var(--color-muted-foreground)" }}
                      >
                        ₪{product.price.toLocaleString()}
                      </span>
                    )}
                    ₪{subtotal.toLocaleString()}
                  </span>
                </div>
                <div
                  className="border-t pt-2 flex justify-between font-bold text-base"
                  style={{ borderColor: "var(--color-border)" }}
                >
                  <span>סה״כ לתשלום</span>
                  <span style={{ color: "var(--color-primary)" }}>
                    ₪{finalPrice.toLocaleString()}
                  </span>
                </div>
              </div>

              <div
                className="mt-6 pt-4 border-t space-y-2 text-xs"
                style={{
                  borderColor: "var(--color-border)",
                  color: "var(--color-muted-foreground)",
                }}
              >
                {[
                  isSupabaseConfigured
                    ? "ההזמנה נרשמת לחשבון המאומת שלך"
                    : "החשבון נוצר אוטומטית לפי כתובת המייל",
                  "ההזמנה נשמרת במערכת עם מספר הזמנה למעקב",
                ].map((item) => (
                  <div key={item} className="flex items-center gap-2">
                    <Icon
                      name="checkCircle"
                      size={14}
                      style={{ color: "var(--color-success)" }}
                    />{" "}
                    {item}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
