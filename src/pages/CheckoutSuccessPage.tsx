import { useEffect } from "react"
import { Link, useNavigate } from "react-router"
import { useApp } from "../context/AppContext"
import { useCms } from "../context/CmsContext"
import Icon, { type IconName } from "../components/icons"

/**
 * Reflects the order exactly as it was recorded. The copy changes with the
 * real payment status — a pending order is never presented as a completed
 * charge, and access is only promised once it has actually been granted.
 */
export default function CheckoutSuccessPage() {
  const { lastOrder, isAuthenticated } = useApp()
  const { settings } = useCms()
  const navigate = useNavigate()

  useEffect(() => {
    if (!lastOrder) navigate("/store", { replace: true })
  }, [lastOrder, navigate])

  if (!lastOrder) return null

  const order = lastOrder
  const paid = order.payment_status === "PAID"
  const failed =
    order.payment_status === "FAILED" || order.order_status === "FAILED"
  // An auto-approved checkout signs the buyer in, so they can jump straight
  // into the book instead of being sent to the login screen.
  const singleProductId =
    order.items.length === 1 ? order.items[0].product_id : null
  const canReadNow = paid && isAuthenticated

  const accent = failed
    ? "var(--color-danger)"
    : paid
      ? "var(--color-success)"
      : "var(--color-primary)"
  const accentSoft = failed
    ? "rgba(239,68,68,0.12)"
    : paid
      ? "rgba(34,197,94,0.12)"
      : "rgba(227,174,60,0.12)"
  const accentBorder = failed
    ? "rgba(239,68,68,0.35)"
    : paid
      ? "rgba(34,197,94,0.35)"
      : "rgba(227,174,60,0.3)"

  const heading = failed
    ? "ההזמנה נכשלה"
    : paid
      ? "התשלום אושר"
      : "ההזמנה התקבלה"
  const intro = failed
    ? "לא הצלחנו לרשום את התשלום עבור ההזמנה. הצוות עודכן וייצור איתך קשר."
    : paid
      ? "תודה שרכשת. הגישה שלך למוצר נפתחה."
      : "תודה. ההזמנה נרשמה במערכת והיא ממתינה לאישור תשלום. נעדכן אותך ברגע שהתשלום יאושר והגישה תיפתח."

  const steps: { step: string, icon: IconName, title: string, desc: string }[] =
    failed
      ? [
          {
            step: "1",
            icon: "message",
            title: "פנייה לצוות",
            desc: "אם ההזמנה נרשמה בטעות או שתרצה לנסות שוב, פנה אלינו בדף התמיכה.",
          },
        ]
      : [
          {
            step: "1",
            icon: "receipt",
            title: paid ? "חשבונית" : "אישור הזמנה",
            desc: settings.email_provider
              ? `המסמך נשלח אל ${order.customer_email}.`
              : `המסמך נשמר בתור השליחות ויועבר אל ${order.customer_email} לאחר חיבור ספק מיילים.`,
          },
          {
            step: "2",
            icon: "mail",
            title: "הגדרת סיסמה",
            desc: 'החשבון נוצר עם כתובת המייל שמילאת. השתמש ב"שכחת סיסמה?" כדי להגדיר סיסמה ולהתחבר.',
          },
          {
            step: "3",
            icon: "bookOpen",
            title: paid ? "התחילו לקרוא" : "פתיחת הגישה",
            desc: paid
              ? `המוצר "${order.items[0]?.product_name ?? ""}" כבר מחכה בספרייה שלך.`
              : "מיד לאחר אישור התשלום ייפתחו המוצרים בספרייה שלך אוטומטית.",
          },
        ]

  return (
    <div
      className="min-h-screen flex items-center justify-center px-6 relative overflow-hidden"
      style={{ background: "var(--color-background)" }}
    >
      {/* Ambient glow */}
      <div
        className="absolute w-[480px] h-[480px] rounded-full pointer-events-none"
        style={{
          background: `radial-gradient(circle, ${accentSoft} 0%, transparent 70%)`,
          top: "-120px",
          left: "50%",
          transform: "translateX(-50%)",
        }}
      />

      <div className="max-w-lg w-full text-center page-enter relative">
        <div
          className="w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6 glow-pulse"
          style={{
            background: accentSoft,
            color: accent,
            border: `1px solid ${accentBorder}`,
            boxShadow: `0 0 40px ${accentSoft}`,
          }}
        >
          <Icon
            name={failed ? "x" : paid ? "checkCircle" : "clock"}
            size={36}
          />
        </div>

        <h1 className="font-display text-4xl font-semibold mb-3 flex items-center justify-center gap-3">
          {heading}{" "}
          {paid && (
            <Icon
              name="sparkles"
              size={26}
              style={{ color: "var(--color-primary)" }}
            />
          )}
        </h1>
        <p className="mb-2" style={{ color: "var(--color-muted-foreground)" }}>
          {intro}
        </p>
        <p
          className="text-sm mb-6 font-mono"
          style={{ color: "var(--color-muted-foreground)" }}
        >
          מספר הזמנה: <span dir="ltr">{order.order_number}</span>
        </p>

        {/* Order summary — read straight from the recorded order */}
        <div
          className="rounded-2xl border p-5 mb-6 text-right text-sm"
          style={{
            background: "var(--color-card)",
            borderColor: "var(--color-border)",
            color: "var(--color-foreground)",
          }}
        >
          <div className="space-y-2 mb-3">
            {order.items.map((item) => (
              <div
                key={item.order_item_id}
                className="flex justify-between gap-3"
              >
                <span style={{ color: "var(--color-muted-foreground)" }}>
                  {item.product_name} × {item.quantity}
                </span>
                <span>₪{item.line_total.toLocaleString()}</span>
              </div>
            ))}
          </div>
          {order.discount_amount > 0 && (
            <div
              className="flex justify-between gap-3 pb-2 mb-2 border-b"
              style={{
                borderColor: "var(--color-border)",
                color: "var(--color-success)",
              }}
            >
              <span>
                הנחה{order.coupon_code ? ` · ${order.coupon_code}` : ""}
              </span>
              <span>-₪{order.discount_amount.toLocaleString()}</span>
            </div>
          )}
          <div className="flex justify-between gap-3 font-bold text-base">
            <span>סה״כ</span>
            <span style={{ color: "var(--color-primary)" }}>
              ₪{order.total_amount.toLocaleString()}
            </span>
          </div>
          <p
            className="text-xs mt-3"
            style={{ color: "var(--color-muted-foreground)" }}
          >
            סטטוס תשלום: {paid ? "שולם" : failed ? "נכשל" : "ממתין לאישור"}
            {order.payment_provider ? ` · ספק: ${order.payment_provider}` : ""}
          </p>
        </div>

        <div className="card-glow p-6 mb-8 text-right">
          <h2
            className="font-semibold mb-4 text-sm tracking-wide"
            style={{ color: "var(--color-muted-foreground)" }}
          >
            מה קורה עכשיו?
          </h2>
          <div className="space-y-4">
            {steps.map(({ step, icon, title, desc }) => (
              <div key={step} className="flex gap-4">
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
                  style={{
                    background: accentSoft,
                    border: `1px solid ${accentBorder}`,
                    color: "var(--color-primary)",
                  }}
                >
                  <Icon name={icon} size={15} />
                </div>
                <div>
                  <p className="font-medium text-sm mb-0.5">{title}</p>
                  <p
                    className="text-sm"
                    style={{ color: "var(--color-muted-foreground)" }}
                  >
                    {desc}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-center gap-3 justify-center">
          {canReadNow ? (
            <Link
              to={
                singleProductId
                  ? `/read/${singleProductId}`
                  : "/dashboard/library"
              }
              className="btn-gradient w-full sm:w-auto px-8 py-3 rounded-full font-semibold text-center"
            >
              {singleProductId ? "התחילו לקרוא עכשיו" : "לספרייה שלי"}
            </Link>
          ) : (
            <Link
              to="/login"
              className="btn-gradient w-full sm:w-auto px-8 py-3 rounded-full font-semibold text-center"
            >
              התחברות לספרייה שלי
            </Link>
          )}
          <Link
            to="/support"
            className="w-full sm:w-auto px-8 py-3 rounded-full font-semibold text-center border transition-colors hover:bg-white/5"
            style={{
              borderColor: "var(--color-border)",
              color: "var(--color-foreground)",
            }}
          >
            יש שאלה לגבי ההזמנה?
          </Link>
        </div>
      </div>
    </div>
  )
}
