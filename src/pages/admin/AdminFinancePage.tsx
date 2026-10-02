import { Link } from "react-router"
import { useAdmin } from "../../context/AdminContext"
import { can } from "../../lib/permissions"
import { formatIsraelDateTime } from "../../lib/datetime"
import { SECURITY_NOTE } from "../../lib/sensitive"
import type { InquiryStatus } from "../../types"
import AccessDenied from "../../components/AccessDenied"
import Icon, { type IconName } from "../../components/icons"

/**
 * Finance dashboard for a one-time digital-book purchase model.
 *
 * Source of truth — read-only derivation from existing tables:
 *  - Successful purchases / revenue  → orders.payment_status = 'PAID'
 *  - Failed purchases                → orders.payment_status = 'FAILED'
 *  - Open refund tickets             → inquiries.topic = 'REFUND'
 *                                        AND inquiries.status NOT IN ('RESOLVED','CLOSED')
 *
 * No subscription, coupon, invoice-drafting, or refund-request UI lives here.
 */

const OPEN_STATUSES: ReadonlySet<InquiryStatus> = new Set([
  "NEW",
  "OPEN",
  "IN_PROGRESS",
  "WAITING_FOR_CUSTOMER",
])

function StatCard({
  label,
  value,
  icon,
}: {
  label: string
  value: string | number
  icon: IconName
}) {
  return (
    <div className="card-glow p-5">
      <div
        className="w-9 h-9 rounded-lg flex items-center justify-center mb-3"
        style={{
          background: "rgba(212,160,48,0.12)",
          color: "var(--color-primary)",
        }}
      >
        <Icon name={icon} size={17} />
      </div>
      <p
        className="text-xs tracking-wider mb-1"
        style={{ color: "var(--color-muted-foreground)" }}
      >
        {label}
      </p>
      <p className="font-display text-3xl font-semibold mb-0" style={{ color: "var(--color-foreground)" }}>
        {value}
      </p>
    </div>
  )
}

export default function AdminFinancePage() {
  const { adminRole, orders, inquiries } = useAdmin()

  if (!can(adminRole, "finance")) {
    return <AccessDenied page="finance" />
  }

  /* ---- Derived metrics (computed on read — no stored totals to drift) ---- */

  const paidOrders = orders.filter((o) => o.payment_status === "PAID")
  const failedOrders = orders.filter((o) => o.payment_status === "FAILED")
  const totalRevenue = paidOrders.reduce(
    (sum, o) => sum + (o.total_amount ?? 0),
    0,
  )

  const refundTicketsOpen = inquiries.filter(
    (i) => i.topic === "REFUND" && OPEN_STATUSES.has(i.status),
  )

  /* ---- Sorted detail lists (most recent first) ---- */

  const recentFailed = [...failedOrders]
    .sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    )
    .slice(0, 10)

  const recentOpenRefunds = [...refundTicketsOpen]
    .sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    )
    .slice(0, 10)

  return (
    <div className="max-w-6xl mx-auto page-enter">
      <div className="mb-8 flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-4xl font-semibold mb-1">כספים</h1>
          <p style={{ color: "var(--color-muted-foreground)" }}>
            תמונת מצב כספית לרכישות חד-פעמיים של הספר הדיגיטלי.
          </p>
        </div>
        {can(adminRole, "orders") && (
          <Link
            to="/admin/orders"
            className="text-xs hover:opacity-70"
            style={{ color: "var(--color-primary)" }}
          >
            ← לכל ההזמנות
          </Link>
        )}
      </div>

      {/* ---- Four summary metrics ---- */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard
          icon="card"
          label="סה״מ רכישות מוצלחות"
          value={paidOrders.length}
        />
        <StatCard
          icon="money"
          label="סה״כ הכנסות"
          value={`₪${totalRevenue.toLocaleString()}`}
        />
        <StatCard
          icon="alertTriangle"
          label="רכישות שנכשלו"
          value={failedOrders.length}
        />
        <StatCard
          icon="refresh"
          label="בקשות החזר פתוחות"
          value={refundTicketsOpen.length}
        />
      </div>

      {/* ---- Detail tables ---- */}
      <div className="grid lg:grid-cols-2 gap-6">
        {/* Failed purchases */}
        <div className="card-glow overflow-hidden">
          <div
            className="flex items-center justify-between px-5 py-4 border-b"
            style={{ borderColor: "var(--color-border)" }}
          >
            <h2 className="font-semibold text-sm">רכישות שנכשלו</h2>
          </div>
          {recentFailed.length === 0 ? (
            <p
              className="px-5 py-8 text-sm text-center"
              style={{ color: "var(--color-muted-foreground)" }}
            >
              אין רכישות נכשלות.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className="text-right">מספר הזמנה</th>
                    <th className="text-right">לקוח</th>
                    <th className="text-right">סכום</th>
                    <th className="text-right">תאריך</th>
                  </tr>
                </thead>
                <tbody>
                  {recentFailed.map((order) => (
                    <tr key={order.order_id}>
                      <td
                        className="font-mono text-xs"
                        dir="ltr"
                        style={{ color: "var(--color-muted-foreground)" }}
                      >
                        {order.order_number}
                      </td>
                      <td>
                        {order.customer_first_name} {order.customer_last_name}
                      </td>
                      <td>₪{(order.total_amount ?? 0).toLocaleString()}</td>
                      <td>
                        {formatIsraelDateTime(order.created_at) || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Open refund tickets */}
        <div className="card-glow overflow-hidden">
          <div
            className="flex items-center justify-between px-5 py-4 border-b"
            style={{ borderColor: "var(--color-border)" }}
          >
            <h2 className="font-semibold text-sm">בקשות החזר פתוחות</h2>
            {can(adminRole, "support") && (
              <Link
                to="/admin/support"
                className="text-xs hover:opacity-70"
                style={{ color: "var(--color-primary)" }}
              >
                ← לכל הפניות
              </Link>
            )}
          </div>
          {refundTicketsOpen.length === 0 ? (
            <p
              className="px-5 py-8 text-sm text-center"
              style={{ color: "var(--color-muted-foreground)" }}
            >
              אין בקשות החזר פתוחות.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className="text-right">כרטיס תמיכה</th>
                    <th className="text-right">נושא</th>
                    <th className="text-right">לקוח</th>
                    <th className="text-right">תאריך</th>
                  </tr>
                </thead>
                <tbody>
                  {recentOpenRefunds.map((ticket) => (
                    <tr key={ticket.inquiry_id}>
                      <td
                        className="font-mono text-xs"
                        dir="ltr"
                        style={{ color: "var(--color-muted-foreground)" }}
                      >
                        {ticket.ticket_number}
                      </td>
                      <td>{ticket.subject}</td>
                      <td>{ticket.customer_name}</td>
                      <td>
                        {formatIsraelDateTime(ticket.created_at) || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <p
        className="mt-6 text-xs flex items-start gap-1.5"
        style={{ color: "var(--color-muted-foreground)" }}
      >
        <Icon name="shield" size={12} />
        {SECURITY_NOTE}
      </p>
    </div>
  )
}
