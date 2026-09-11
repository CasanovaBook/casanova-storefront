import { useEffect, useMemo, useState } from "react"
import { Link, useNavigate } from "react-router"
import { useApp } from "../context/AppContext"
import { useCms } from "../context/CmsContext"
import type { CheckoutFormData, Product } from "../types"
import { effectivePrice, isOnSale } from "../types"
import Icon from "../components/icons"

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
  const { selectedProduct, placeOrder, user } = useApp()
  const cms = useCms()

  const product = selectedProduct

  const [form, setForm] = useState<CheckoutFormData>({
    first_name: user?.first_name ?? "",
    last_name: user?.last_name ?? "",
    email: user?.email ?? "",
    phone: user?.phone ?? "",
    coupon_code: "",
  })
  const [phonePrefix, setPhonePrefix] = useState("050")
  const [phoneNumber, setPhoneNumber] = useState("")

  // Initialize phone prefix and number from existing phone if available
  useEffect(() => {
    if (user?.phone) {
      const cleaned = user.phone.replace(/\D/g, "")
      if (cleaned.length >= 10 && cleaned.startsWith("972")) {
        // Format: 972501234567 -> prefix: 050, number: 1234567
        // After removing country code "972", we have "501234567" (9 digits)
        // Prefix is "050" (add back the leading 0), number is "1234567"
        const withoutCountry = cleaned.slice(3)
        const prefix = "0" + withoutCountry.slice(0, 2)
        const number = withoutCountry.slice(2)
        setPhonePrefix(prefix)
        setPhoneNumber(number)
      } else if (cleaned.length >= 10 && cleaned.startsWith("0")) {
        // Format: 0501234567 -> prefix: 050, number: 1234567
        // Prefix is first 3 chars "050", number is remaining 7 chars "1234567"
        const prefix = cleaned.slice(0, 3)
        const number = cleaned.slice(3)
        setPhonePrefix(prefix)
        setPhoneNumber(number)
      }
    }
  }, [user?.phone])

  // Update form.phone whenever prefix or number changes
  useEffect(() => {
    // phonePrefix already includes the leading "0" (e.g., "050")
    // phoneNumber is 7 digits (e.g., "1234567")
    // Full phone: "050" + "1234567" = "0501234567" (10 digits)
    const fullPhone =
      phonePrefix && phoneNumber ? `${phonePrefix}${phoneNumber}` : ""
    setForm((prev) => ({ ...prev, phone: fullPhone }))
  }, [phonePrefix, phoneNumber])
  const [errors, setErrors] = useState<Partial<CheckoutFormData>>({})
  const [couponApplied, setCouponApplied] = useState(false)
  const [couponDiscount, setCouponDiscount] = useState(0)
  const [couponError, setCouponError] = useState("")
  const [isProcessing, setIsProcessing] = useState(false)
  const [submitError, setSubmitError] = useState("")
  const [step, setStep] = useState<"details" | "review">("details")
  const [confirmEmail, setConfirmEmail] = useState(user?.email ?? "")
  const [confirmEmailError, setConfirmEmailError] = useState("")
  // 18+ gate: the content is adult, so the buyer must explicitly confirm
  // legal age before the order can proceed past the details step.
  const [ageConfirmed, setAgeConfirmed] = useState(false)
  const [ageError, setAgeError] = useState("")

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [step])

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
  const finalPrice = Math.max(
    0,
    Math.round((subtotal - couponDiscount) * 100) / 100,
  )

  const validate = (): boolean => {
    const newErrors: Partial<CheckoutFormData> = {}
    if (!form.first_name.trim()) newErrors.first_name = "שדה חובה"
    if (!form.last_name.trim()) newErrors.last_name = "שדה חובה"
    if (!form.email.trim() || /[^\x20-\x7E]/.test(form.email))
      newErrors.email = "כתובת המייל חייבת להיות באנגלית בלבד"
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email))
      newErrors.email = "נדרשת כתובת מייל תקינה"
    // Email confirmation: must match exactly so receipts/access never go to the wrong address
    if (!confirmEmail.trim()) {
      setConfirmEmailError("יש לאמת את כתובת המייל")
    } else if (
      confirmEmail.trim().toLowerCase() !== form.email.trim().toLowerCase()
    ) {
      setConfirmEmailError(
        "כתובות המייל אינן תואמות — יש להקליד שוב את אותה כתובת",
      )
    } else {
      setConfirmEmailError("")
    }
    if (!form.phone.trim() || phoneNumber.length === 0) {
      newErrors.phone = "שדה חובה"
    } else if (phoneNumber.length < 7) {
      newErrors.phone = `מספר הטלפון חייב להכיל בדיוק 7 ספרות (הוקלדו ${phoneNumber.length} ספרות)`
    } else if (phoneNumber.length !== 7) {
      newErrors.phone = "מספר הטלפון חייב להכיל בדיוק 7 ספרות"
    } else if (!/^\d{7}$/.test(phoneNumber)) {
      newErrors.phone = "מספר הטלפון יכול להכיל רק ספרות"
    } else {
      // Additional validation: ensure the full phone format is correct (0XX-XXXXXXX)
      const digits = form.phone.replace(/\D/g, "")
      if (digits.length !== 10 || !digits.startsWith("0")) {
        newErrors.phone = "פורמט מספר טלפון לא תקין"
      }
    }
    setAgeError(ageConfirmed ? "" : "יש לאשר שאתה בן 18 ומעלה כדי להמשיך.")
    setErrors(newErrors)
    return (
      Object.keys(newErrors).length === 0 &&
      confirmEmail.trim().toLowerCase() === form.email.trim().toLowerCase() &&
      confirmEmail.trim().length > 0 &&
      ageConfirmed
    )
  }

  const applyCoupon = () => {
    const code = form.coupon_code.trim().toUpperCase()
    const coupon = cms.findCoupon(code)
    if (!coupon) {
      setCouponError("קוד קופון לא תקין או שפג תוקפו.")
      setCouponApplied(false)
      setCouponDiscount(0)
      return
    }
    if (subtotal < coupon.minimum_order) {
      setCouponError(
        `הקופון תקף להזמנות בסכום של ₪${coupon.minimum_order.toLocaleString()} ומעלה.`,
      )
      setCouponApplied(false)
      setCouponDiscount(0)
      return
    }
    const discount =
      coupon.discount_type === "PERCENTAGE"
        ? Math.round(subtotal * (coupon.discount_value / 100) * 100) / 100
        : Math.min(coupon.discount_value, subtotal)
    setCouponApplied(true)
    setCouponDiscount(discount)
    setCouponError("")
  }

  const handleDetailsNext = () => {
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
      phone: form.phone.trim() || undefined,
      coupon_code: couponApplied
        ? form.coupon_code.trim().toUpperCase()
        : undefined,
    })
    setIsProcessing(false)
    if (!result.ok) {
      setSubmitError(result.error)
      setStep("details")
      return
    }
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
                  משמשים ליצירת החשבון ולשליחת הקבלה.
                </p>

                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label
                        className="block text-xs font-bold mb-1.5"
                        style={{ color: "var(--color-muted-foreground)" }}
                      >
                        שם פרטי
                      </label>
                      <input
                        className={inputClass}
                        style={inputStyle}
                        value={form.first_name}
                        onChange={(e) =>
                          setForm({ ...form, first_name: e.target.value })
                        }
                      />
                      {errors.first_name && (
                        <p
                          className="text-xs mt-1"
                          style={{ color: "var(--color-danger)" }}
                        >
                          {errors.first_name}
                        </p>
                      )}
                    </div>
                    <div>
                      <label
                        className="block text-xs font-bold mb-1.5"
                        style={{ color: "var(--color-muted-foreground)" }}
                      >
                        שם משפחה
                      </label>
                      <input
                        className={inputClass}
                        style={inputStyle}
                        value={form.last_name}
                        onChange={(e) =>
                          setForm({ ...form, last_name: e.target.value })
                        }
                      />
                      {errors.last_name && (
                        <p
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
                      className="block text-xs font-bold mb-1.5"
                      style={{ color: "var(--color-muted-foreground)" }}
                    >
                      כתובת מייל
                    </label>
                    <input
                      type="email"
                      dir="ltr"
                      className={`${inputClass} text-left`}
                      style={inputStyle}
                      value={form.email}
                      onChange={(e) => handleEmailChange(e.target.value)}
                      placeholder="you@example.com"
                    />
                    {errors.email && (
                      <p
                        className="text-xs mt-1"
                        style={{ color: "var(--color-danger)" }}
                      >
                        {errors.email}
                      </p>
                    )}
                    <p
                      className="text-xs mt-1"
                      style={{ color: "var(--color-muted-foreground)" }}
                    >
                      החשבון שלך ייווצר עם הכתובת הזו.
                    </p>
                  </div>

                  <div>
                    <label
                      className="block text-xs font-bold mb-1.5"
                      style={{ color: "var(--color-muted-foreground)" }}
                    >
                      אימות כתובת מייל{" "}
                      <span style={{ color: "var(--color-danger)" }}>*</span>
                    </label>
                    <input
                      type="email"
                      dir="ltr"
                      className={`${inputClass} text-left`}
                      style={inputStyle}
                      value={confirmEmail}
                      onChange={(e) => handleConfirmEmailChange(e.target.value)}
                      onPaste={(e) => e.preventDefault()}
                      placeholder="הקלד שוב את כתובת המייל"
                    />
                    {confirmEmailError ? (
                      <p
                        className="text-xs mt-1"
                        style={{ color: "var(--color-danger)" }}
                      >
                        {confirmEmailError}
                      </p>
                    ) : confirmEmail.trim() &&
                      confirmEmail.trim().toLowerCase() ===
                        form.email.trim().toLowerCase() ? (
                      <p
                        className="text-xs mt-1 flex items-center gap-1"
                        style={{ color: "var(--color-success)" }}
                      >
                        <Icon name="checkCircle" size={13} /> הכתובות תואמות —
                        הקבלה והגישה יישלחו לכתובת זו.
                      </p>
                    ) : null}
                  </div>

                  <div>
                    <label
                      className="block text-xs font-bold mb-1.5"
                      style={{ color: "var(--color-muted-foreground)" }}
                    >
                      מספר טלפון
                    </label>
                    <div className="flex gap-2" dir="rtl">
                      {/* Phone number input - on the right side (RTL) */}
                      <input
                        type="tel"
                        dir="ltr"
                        className={`${inputClass} text-left flex-1`}
                        style={inputStyle}
                        value={phoneNumber}
                        onChange={(e) => {
                          // Only allow digits and limit to exactly 7 characters
                          const value = e.target.value
                            .replace(/[^\d]/g, "")
                            .slice(0, 7)
                          setPhoneNumber(value)
                        }}
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
                        maxLength={7}
                        inputMode="numeric"
                        pattern="[0-9]*"
                      />
                      {/* Phone prefix dropdown - on the left side (RTL) */}
                      <select
                        value={phonePrefix}
                        onChange={(e) => setPhonePrefix(e.target.value)}
                        className={`${inputClass} text-center flex-shrink-0`}
                        style={{ ...inputStyle, width: "80px" }}
                        dir="ltr"
                      >
                        <option value="050">050</option>
                        <option value="051">051</option>
                        <option value="052">052</option>
                        <option value="053">053</option>
                        <option value="054">054</option>
                        <option value="055">055</option>
                        <option value="058">058</option>
                      </select>
                    </div>
                    {errors.phone && (
                      <p
                        className="text-xs mt-1"
                        style={{ color: "var(--color-danger)" }}
                      >
                        {errors.phone}
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

                  <div>
                    <label
                      className="block text-xs font-bold mb-1.5"
                      style={{ color: "var(--color-muted-foreground)" }}
                    >
                      קוד קופון (אופציונלי)
                    </label>
                    <div className="flex gap-2">
                      <input
                        dir="ltr"
                        className={`${inputClass} flex-1 text-left`}
                        style={inputStyle}
                        value={form.coupon_code}
                        onChange={(e) =>
                          setForm({ ...form, coupon_code: e.target.value })
                        }
                        placeholder="WELCOME20"
                        disabled={couponApplied}
                      />
                      <button
                        onClick={applyCoupon}
                        disabled={couponApplied || !form.coupon_code.trim()}
                        className="px-5 py-2.5 rounded-xl text-sm font-bold border transition-colors hover:bg-white/5 disabled:opacity-40"
                        style={{
                          borderColor: "var(--color-border)",
                          color: "var(--color-foreground)",
                        }}
                      >
                        הפעלה
                      </button>
                    </div>
                    {couponApplied && (
                      <p
                        className="text-xs mt-1 flex items-center gap-1"
                        style={{ color: "var(--color-success)" }}
                      >
                        <Icon name="checkCircle" size={13} /> הקופון הופעל —
                        הנחה של ₪{couponDiscount.toLocaleString()}
                      </p>
                    )}
                    {couponError && (
                      <p
                        className="text-xs mt-1"
                        style={{ color: "var(--color-danger)" }}
                      >
                        {couponError}
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
                      {form.phone}
                    </p>
                    {couponApplied && (
                      <p>קופון: {form.coupon_code.trim().toUpperCase()}</p>
                    )}
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
                {couponApplied && (
                  <div
                    className="flex justify-between"
                    style={{ color: "var(--color-success)" }}
                  >
                    <span>הנחת קופון</span>
                    <span>-₪{couponDiscount.toLocaleString()}</span>
                  </div>
                )}
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
                  "החשבון נוצר אוטומטית לפי כתובת המייל",
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
