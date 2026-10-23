import { useEffect } from "react"
import { Link, useNavigate } from "react-router"
import { useApp } from "../context/AppContext"
import { useCms } from "../context/CmsContext"
import Icon, { type IconName } from "../components/icons"
import PageHeader from "../components/ui/PageHeader"

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
  /* A zero-total order is a free sample: nothing was charged and no payment
   * was captured, so it must not be presented as "payment approved". Access
   * is still granted, and the read-now path stays the same. */
  const isFree = order.total_amount === 0
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
    ? "rgba(167,70,54,0.12)"
    : paid
      ? "rgba(79,122,79,0.12)"
      : "rgba(222,154,96,0.12)"
  const accentBorder = failed
    ? "rgba(167,70,54,0.35)"
    : paid
      ? "rgba(79,122,79,0.35)"
      : "rgba(222,154,96,0.3)"

  const heading = failed
    ? "ההזמנה נכשלה"
    : paid
      ? isFree
        ? "הגישה נפתחה"
        : "התשלום אושר"
      : "ההזמנה התקבלה"
  const intro = failed
    ? "לא הצלחנו לרשום את התשלום עבור ההזמנה. הצוות עודכן וייצור איתך קשר."
    : paid
      ? isFree
        ? "תודה. הספר החינמי נפתח בספרייה שלך — לא בוצע חיוב."
        : "תודה שרכשת. הגישה שלך למוצר נפתחה."
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

  const statusIcon: IconName = failed
    ? "x"
    : paid
      ? "checkCircle"
      : "clock"

  const statusBadgeClass = failed
    ? "app-badge--danger"
    : paid
      ? "app-badge--success"
      : "app-badge--warning"

  const statusBadgeLabel = failed
    ? "ההזמנה נכשלה"
    : paid
      ? isFree
        ? "ללא חיוב"
        : "שולם"
      : "ממתין לאישור"

  const paymentLabel = paid ? "שולם" : failed ? "נכשל" : "ממתין לאישור"

  return (
    <div className="page-enter px-5 py-10 sm:px-8 md:py-14 lg:px-12">
      <div className="app-page app-page--content">
        <PageHeader
          eyebrow="CASANOVA · אישור הזמנה"
          title={heading}
          description={intro}
          breadcrumbs={[
            { label: "דף הבית", to: "/" },
            { label: "חנות הספרים", to: "/store" },
            { label: "אישור הזמנה" },
          ]}
          actions={
            <span className={`app-badge ${statusBadgeClass}`}>
              <Icon name={statusIcon} size={12} aria-hidden="true" />
              {statusBadgeLabel}
            </span>
          }
        />

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] lg:items-start">
          {/* Order summary — read straight from the recorded order */}
          <section
            className="app-surface"
            aria-labelledby="checkout-success-order-title"
          >
            <div className="app-surface-head">
              <div className="min-w-0">
                <h2
                  id="checkout-success-order-title"
                  className="app-section-title"
                >
                  פרטי ההזמנה
                </h2>
                <p className="app-hint mt-1">
                  מספר הזמנה:{" "}
                  <span dir="ltr" className="font-mono">
                    {order.order_number}
                  </span>
                </p>
              </div>
              <span
                className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full"
                style={{
                  background: accentSoft,
                  color: accent,
                  border: `1px solid ${accentBorder}`,
                }}
                aria-hidden="true"
              >
                <Icon name={statusIcon} size={20} />
              </span>
            </div>

            <div className="app-surface-body">
              <ul className="space-y-3">
                {order.items.map((item) => (
                  <li
                    key={item.order_item_id}
                    className="flex items-start justify-between gap-4 border-b pb-3 last:border-b-0 last:pb-0"
                    style={{ borderColor: "var(--color-border)" }}
                  >
                    <div className="min-w-0">
                      <p className="break-words text-sm font-medium">
                        {item.product_name}
                      </p>
                      <p className="app-hint mt-0.5">
                        כמות: {item.quantity}
                      </p>
                    </div>
                    <span
                      dir="ltr"
                      className="flex-shrink-0 text-sm"
                    >
                      ₪{item.line_total.toLocaleString()}
                    </span>
                  </li>
                ))}
              </ul>

              <div
                className="mt-4 flex items-center justify-between gap-3 border-t pt-4"
                style={{ borderColor: "var(--color-border)" }}
              >
                <span className="font-semibold">סה״כ</span>
                <span
                  className="font-display text-lg font-semibold"
                  style={{ color: "var(--color-primary)" }}
                >
                  <span dir="ltr">
                    ₪{order.total_amount.toLocaleString()}
                  </span>
                </span>
              </div>

              <dl
                className="mt-4 grid gap-1.5 border-t pt-4 text-xs"
                style={{
                  borderColor: "var(--color-border)",
                  color: "var(--color-muted-foreground)",
                }}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <dt>סטטוס תשלום</dt>
                  <dd style={{ color: accent }}>{paymentLabel}</dd>
                </div>
                {order.payment_provider && (
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <dt>ספק תשלום</dt>
                    <dd dir="ltr" className="text-start">
                      {order.payment_provider}
                    </dd>
                  </div>
                )}
              </dl>
            </div>
          </section>

          <section
            className="app-surface"
            aria-labelledby="checkout-success-next-title"
          >
            <div className="app-surface-head">
              <h2
                id="checkout-success-next-title"
                className="app-section-title"
              >
                מה קורה עכשיו?
              </h2>
            </div>
            <div className="app-surface-body">
              <ol className="space-y-5">
                {steps.map(({ step, icon, title, desc }) => (
                  <li key={step} className="flex gap-3">
                    <span
                      className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full"
                      style={{
                        background: accentSoft,
                        border: `1px solid ${accentBorder}`,
                        color: accent,
                      }}
                      aria-hidden="true"
                    >
                      <Icon name={icon} size={15} />
                    </span>
                    <div className="min-w-0">
                      <h3 className="text-sm font-medium">
                        <span className="sr-only">שלב {step}. </span>
                        {title}
                      </h3>
                      <p className="app-hint mt-0.5">{desc}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          </section>
        </div>

        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          {canReadNow ? (
            <Link
              to={
                singleProductId
                  ? `/read/${singleProductId}`
                  : "/dashboard/library"
              }
              className="app-btn w-full sm:w-auto"
            >
              <Icon name="bookOpen" size={15} aria-hidden="true" />
              {singleProductId ? "התחילו לקרוא עכשיו" : "לספרייה שלי"}
            </Link>
          ) : (
            <Link to="/login" className="app-btn w-full sm:w-auto">
              התחברות לספרייה שלי
            </Link>
          )}
          <Link
            to="/support"
            className="app-btn-secondary w-full sm:w-auto"
          >
            <Icon name="message" size={15} aria-hidden="true" />
            יש שאלה לגבי ההזמנה?
          </Link>
        </div>
      </div>
    </div>
  )
}
