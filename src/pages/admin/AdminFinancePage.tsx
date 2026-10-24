import { Link } from "react-router"
import { useAdmin } from "../../context/AdminContext"
import { can } from "../../lib/permissions"
import { formatIsraelDateTime } from "../../lib/datetime"
import { SECURITY_NOTE } from "../../lib/sensitive"
import type { InquiryStatus } from "../../types"
import AccessDenied from "../../components/AccessDenied"
import Icon, { type IconName } from "../../components/icons"
import PageHeader from "../../components/ui/PageHeader"

/**
 * Finance dashboard for a one-time digital-book purchase model.
 *
 * Source of truth - read-only derivation from existing tables:
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
    <div className="app-surface p-4 sm:p-5 min-w-0">
      <div
        className="w-9 h-9 rounded-lg flex items-center justify-center mb-3"
        style={{
          background:
            "color-mix(in srgb, var(--color-primary) 12%, transparent)",
          color: "var(--color-primary)",
        }}
        aria-hidden="true"
      >
        <Icon name={icon} size={17} />
      </div>
      <p className="text-xs font-semibold app-muted mb-1">{label}</p>
      <p className="font-display text-2xl sm:text-3xl font-semibold">
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

  /* ---- Derived metrics (computed on read - no stored totals to drift) ---- */

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
    <div className="page-enter">
      <PageHeader
        eyebrow="ניהול · כספים"
        title="כספים"
        description="תמונת מצב כספית לרכישות חד-פעמיים של הספר הדיגיטלי."
        breadcrumbs={[{ label: "ניהול", to: "/admin" }, { label: "כספים" }]}
        actions={
          can(adminRole, "orders") ? (
            <Link to="/admin/orders" className="app-btn-secondary">
              <Icon name="receipt" size={15} />
              לכל ההזמנות
            </Link>
          ) : undefined
        }
      />

      {/* ---- Four summary metrics ---- */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-8">
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
      <div className="space-y-6">
        {/* Failed purchases */}
        <section
          className="app-surface"
          aria-labelledby="failed-purchases-title"
        >
          <div className="app-surface-head">
            <h2 id="failed-purchases-title" className="app-section-title">
              רכישות שנכשלו
            </h2>
            <span className="app-badge app-badge--neutral">
              {failedOrders.length}
            </span>
          </div>
          {recentFailed.length === 0 ? (
            <div className="app-surface-body flex items-center justify-center gap-2 py-6 text-sm app-muted">
              <Icon
                name="checkCircle"
                size={16}
                style={{ color: "var(--color-success)" }}
              />
              אין רכישות נכשלות.
            </div>
          ) : (
            <div className="app-table-wrap" style={{ border: 0, borderRadius: 0 }}>
              <table className="app-table">
                <thead>
                  <tr>
                    <th scope="col">מספר הזמנה</th>
                    <th scope="col">לקוח</th>
                    <th scope="col">סכום</th>
                    <th scope="col">תאריך</th>
                  </tr>
                </thead>
                <tbody>
                  {recentFailed.map((order) => (
                    <tr key={order.order_id}>
                      <td
                        className="font-mono text-xs app-muted whitespace-nowrap"
                        dir="ltr"
                      >
                        {order.order_number}
                      </td>
                      <td>
                        {order.customer_first_name} {order.customer_last_name}
                      </td>
                      <td className="whitespace-nowrap">
                        ₪{(order.total_amount ?? 0).toLocaleString()}
                      </td>
                      <td className="text-xs whitespace-nowrap app-muted">
                        {formatIsraelDateTime(order.created_at) || "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Open refund tickets */}
        <section
          className="app-surface"
          aria-labelledby="open-refunds-title"
        >
          <div className="app-surface-head">
            <h2 id="open-refunds-title" className="app-section-title">
              בקשות החזר פתוחות
            </h2>
            <div className="flex items-center gap-3">
              <span className="app-badge app-badge--neutral">
                {refundTicketsOpen.length}
              </span>
              {can(adminRole, "support") && (
                <Link to="/admin/support" className="app-btn-ghost">
                  לכל הפניות ←
                </Link>
              )}
            </div>
          </div>
          {recentOpenRefunds.length === 0 ? (
            <div className="app-surface-body flex items-center justify-center gap-2 py-6 text-sm app-muted">
              <Icon
                name="checkCircle"
                size={16}
                style={{ color: "var(--color-success)" }}
              />
              אין בקשות החזר פתוחות.
            </div>
          ) : (
            <div className="app-table-wrap" style={{ border: 0, borderRadius: 0 }}>
              <table className="app-table">
                <thead>
                  <tr>
                    <th scope="col">כרטיס תמיכה</th>
                    <th scope="col">נושא</th>
                    <th scope="col">לקוח</th>
                    <th scope="col">תאריך</th>
                  </tr>
                </thead>
                <tbody>
                  {recentOpenRefunds.map((ticket) => (
                    <tr key={ticket.inquiry_id}>
                      <td
                        className="font-mono text-xs app-muted whitespace-nowrap"
                        dir="ltr"
                      >
                        {ticket.ticket_number}
                      </td>
                      <td className="truncate max-w-[18rem]" title={ticket.subject}>
                        {ticket.subject}
                      </td>
                      <td className="whitespace-nowrap">{ticket.customer_name}</td>
                      <td className="text-xs whitespace-nowrap app-muted">
                        {formatIsraelDateTime(ticket.created_at) || "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      <p className="mt-6 text-xs flex items-start gap-1.5 app-muted">
        <Icon name="shield" size={12} className="flex-shrink-0 mt-0.5" />
        {SECURITY_NOTE}
      </p>
    </div>
  )
}
