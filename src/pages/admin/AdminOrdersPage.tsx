import { useMemo, useState } from "react"
import { Link } from "react-router"
import { useAdmin } from "../../context/AdminContext"
import { useCms } from "../../context/CmsContext"
import { can } from "../../lib/permissions"
import { formatIsraelDateTime } from "../../lib/datetime"
import { maskCard, SECURITY_NOTE } from "../../lib/sensitive"
import type { Order, PaymentStatus } from "../../types"
import AccessDenied from "../../components/AccessDenied"
import Modal from "../../components/Modal"
import Icon from "../../components/icons"
import PageHeader from "../../components/ui/PageHeader"
import EmptyState from "../../components/ui/EmptyState"
import Alert from "../../components/ui/Alert"

/* ── Payment & invoice ──────────────────────────────────────
 * The order model is deliberately minimal: a purchase attempt is
 * PENDING until a payment is confirmed, then PAID or FAILED. Nothing
 * else is a state an admin can set — a digital book has no fulfillment,
 * shipping or processing steps.
 *
 * The extra labels below are not selectable states. They only keep a
 * row written before this simplification (a refund or a cancellation)
 * readable instead of forcing it into one of the three live states.
 * ─────────────────────────────────────────────────────────── */

const PAYMENT_LABEL: Record<PaymentStatus, string> = {
  PENDING: "ממתין",
  PAID: "שולם",
  FAILED: "נכשל",
  PARTIALLY_REFUNDED: "הוחזר חלקית",
  REFUNDED: "הוחזר",
  CANCELLED: "בוטל",
}

/** The only three states an admin filters by and acts on. */
const PAYMENT_FILTERS: PaymentStatus[] = ["PENDING", "PAID", "FAILED"]

function paymentBadge(payment: PaymentStatus): string {
  switch (payment) {
    case "PAID":
      return "app-badge--success"
    case "FAILED":
      return "app-badge--danger"
    case "PENDING":
      return "app-badge--warning"
    default:
      return "app-badge--neutral"
  }
}

/**
 * Money for this order was actually captured, so an invoice can be
 * issued for it. A legacy partially refunded row still had money
 * captured, so it stays in this group.
 */
function isCaptured(order: Order): boolean {
  return (
    order.payment_status === "PAID" ||
    order.payment_status === "PARTIALLY_REFUNDED"
  )
}

/** The payment already reached an end state and must not be marked again. */
function isSettled(order: Order): boolean {
  return isCaptured(order) || order.payment_status === "REFUNDED"
}

const inputStyle = {
  background: "var(--color-secondary)",
  borderColor: "var(--color-border)",
  color: "var(--color-foreground)",
} as const

const fieldClass = "w-full text-sm rounded-lg px-3 py-2 border outline-none"

function OrderDetailModal({
  order,
  onClose,
}: {
  order: Order
  onClose: () => void
}) {
  const { invoices, adminRole, issueInvoice, markOrderPaid, markOrderFailed } =
    useAdmin()
  const { settings } = useCms()

  const [showConfirmPayment, setShowConfirmPayment] = useState(false)
  const [provider, setProvider] = useState(settings.payment_provider ?? "")
  const [reference, setReference] = useState("")
  const [last4, setLast4] = useState("")
  const [failureReason, setFailureReason] = useState("")
  const [error, setError] = useState("")

  const invoice = invoices.find((inv) => inv.order_id === order.order_id)
  const captured = isCaptured(order)
  const canFinance = can(adminRole, "finance")
  const canMarkPaid = can(adminRole, "mark_paid")

  const run = (result: { ok: boolean; error?: string }) => {
    if (!result.ok) {
      setError(result.error ?? "הפעולה נכשלה.")
      return false
    }
    setError("")
    return true
  }

  const details: {
    label: string
    value: string
    mono?: boolean
    badge?: string
  }[] = [
    { label: "מספר הזמנה", value: order.order_number, mono: true },
    {
      label: "לקוח",
      value: `${order.customer_first_name} ${order.customer_last_name}`,
    },
    { label: "אימייל", value: order.customer_email, mono: true },
    { label: "טלפון", value: order.customer_phone ?? "—", mono: true },
    {
      label: "תאריך רכישה",
      value: formatIsraelDateTime(order.created_at) || "—",
    },
    {
      label: "סטטוס תשלום",
      value: PAYMENT_LABEL[order.payment_status],
      badge: paymentBadge(order.payment_status),
    },
    { label: "סכום", value: `₪${order.total_amount.toLocaleString()}` },
    {
      label: "שולם בתאריך",
      value: order.paid_at
        ? formatIsraelDateTime(order.paid_at) || "—"
        : "טרם שולם",
    },
  ]

  return (
    <Modal size="2xl" title="פרטי הזמנה" onClose={onClose}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-5">
        {details.map(({ label, value, mono, badge }) => (
          <div
            key={label}
            className="p-3 rounded-md min-w-0"
            style={{ background: "var(--color-muted)" }}
          >
            <p className="text-xs mb-0.5 app-muted">{label}</p>
            {badge ? (
              <span className={`app-badge ${badge}`}>{value}</span>
            ) : (
              <p
                className={`text-sm font-medium truncate ${
                  mono ? "font-mono" : ""
                }`}
                dir={mono ? "ltr" : undefined}
                title={value}
              >
                {value}
              </p>
            )}
          </div>
        ))}
      </div>

      {/* Payment details — masked by policy */}
      <div
        className="p-3 rounded-md mb-5"
        style={{ background: "var(--color-muted)" }}
      >
        <p className="text-xs mb-2 flex items-center gap-1.5 app-muted">
          <Icon name="card" size={12} /> פרטי תשלום
        </p>
        <div className="text-sm space-y-1">
          <p className="font-mono" dir="ltr">
            {order.card_last4
              ? maskCard(order.card_last4)
              : "לא נשמרו פרטי כרטיס"}
          </p>
          <p className="text-xs app-muted">
            {order.payment_provider
              ? `ספק סליקה: ${order.payment_provider}`
              : "ספק סליקה: לא נרשם"}
          </p>
          {order.transaction_reference && (
            <p className="text-xs font-mono app-muted" dir="ltr">
              {order.transaction_reference}
            </p>
          )}
        </div>
        <p className="text-[10px] mt-2 flex items-start gap-1 app-muted">
          <Icon name="shield" size={11} className="flex-shrink-0 mt-px" />
          {SECURITY_NOTE}
        </p>
      </div>

      {/* Items — purchase-time snapshot, never the live catalogue price */}
      <h4 className="text-xs font-semibold tracking-wide mb-3 app-muted">
        פריטי ההזמנה ({order.items.length})
      </h4>
      <div className="space-y-2 mb-5">
        {order.items.map((item) => (
          <div
            key={item.order_item_id}
            className="flex items-center justify-between p-3 rounded-md border gap-3"
            style={{ borderColor: "var(--color-border)" }}
          >
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">
                {item.product_name}
              </p>
              <p className="text-xs app-muted">
                כמות: {item.quantity} · ₪{item.unit_price.toLocaleString()}{" "}
                ליחידה
                {item.discount_amount > 0
                  ? ` · הנחה ₪${item.discount_amount.toLocaleString()}`
                  : ""}
              </p>
              <p className="text-[10px] font-mono mt-0.5 app-muted" dir="ltr">
                {item.product_id}
              </p>
            </div>
            <p className="font-semibold text-sm flex-shrink-0">
              ₪{item.line_total.toLocaleString()}
            </p>
          </div>
        ))}
      </div>

      {/* Invoice — only ever shows as issued when an invoice row really exists */}
      <div
        className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 rounded-md mb-5 border"
        style={{ borderColor: "var(--color-border)" }}
      >
        <div className="min-w-0">
          <p className="text-xs mb-0.5 app-muted">חשבונית</p>
          {invoice ? (
            <>
              <p
                className="text-sm font-mono truncate"
                dir="ltr"
                title={invoice.invoice_number}
              >
                {invoice.invoice_number} · ₪{invoice.amount.toLocaleString()}
              </p>
              <p className="text-xs" style={{ color: "var(--color-success)" }}>
                הונפקה {formatIsraelDateTime(invoice.issued_at)}
              </p>
            </>
          ) : (
            <span
              className={`app-badge ${
                captured ? "app-badge--warning" : "app-badge--neutral"
              }`}
            >
              לא הונפקה
            </span>
          )}
        </div>
        {!invoice && captured && canFinance && (
          <button
            onClick={() => run(issueInvoice(order.order_id))}
            className="app-btn flex-shrink-0"
            style={{
              minHeight: "2.2rem",
              padding: "0.35rem 0.9rem",
              fontSize: "0.75rem",
            }}
          >
            הנפקת חשבונית
          </button>
        )}
      </div>

      {error && (
        <div className="mb-4">
          <Alert tone="error">{error}</Alert>
        </div>
      )}

      {/* Confirm payment — the only path that marks an order paid */}
      {canMarkPaid &&
        !isSettled(order) &&
        order.payment_status !== "CANCELLED" &&
        (showConfirmPayment ? (
          <div
            className="mb-4 p-4 rounded-md border"
            style={{
              borderColor:
                "color-mix(in srgb, var(--color-success) 32%, var(--color-border))",
              background:
                "color-mix(in srgb, var(--color-success) 6%, var(--color-card))",
            }}
          >
            <p
              className="text-sm font-semibold mb-3"
              style={{ color: "var(--color-success)" }}
            >
              אישור קבלת תשלום
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
              <input
                className={fieldClass}
                style={inputStyle}
                placeholder="ספק תשלומים"
                aria-label="ספק תשלומים"
                value={provider}
                onChange={(e) => setProvider(e.target.value)}
              />
              <input
                className={fieldClass}
                style={inputStyle}
                dir="ltr"
                placeholder="מזהה עסקה"
                aria-label="מזהה עסקה"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
              />
              <input
                className={fieldClass}
                style={inputStyle}
                dir="ltr"
                maxLength={4}
                placeholder="4 ספרות אחרונות"
                aria-label="ארבע ספרות אחרונות של הכרטיס"
                value={last4}
                onChange={(e) => setLast4(e.target.value.replace(/\D/g, ""))}
              />
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <button
                onClick={() => {
                  if (
                    run(
                      markOrderPaid(order.order_id, {
                        provider: provider.trim() || undefined,
                        transaction_reference: reference.trim() || undefined,
                        card_last4: last4.trim() || undefined,
                      }),
                    )
                  ) {
                    setShowConfirmPayment(false)
                    setReference("")
                    setLast4("")
                  }
                }}
                className="app-btn flex-1"
                style={{
                  background: "var(--color-success)",
                  color: "var(--color-card)",
                }}
              >
                אישור התשלום
              </button>
              <button
                onClick={() => setShowConfirmPayment(false)}
                className="app-btn-secondary flex-1"
              >
                ביטול
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setShowConfirmPayment(true)}
            className="app-btn-secondary w-full mb-3"
            style={{
              color: "var(--color-success)",
              borderColor:
                "color-mix(in srgb, var(--color-success) 35%, var(--color-border))",
            }}
          >
            אישור קבלת תשלום
          </button>
        ))}

      {/* Failure — a pending payment can be closed as failed */}
      {canMarkPaid && order.payment_status === "PENDING" && (
        <div
          className="mb-4 p-3 rounded-md border"
          style={{ borderColor: "var(--color-border)" }}
        >
          <label htmlFor="failure-reason" className="app-label block mb-1.5">
            סיבת כישלון
          </label>
          <input
            id="failure-reason"
            className={fieldClass}
            style={inputStyle}
            value={failureReason}
            onChange={(e) => setFailureReason(e.target.value)}
            placeholder="לדוגמה: הכרטיס נדחה על ידי הספק"
          />
          <button
            onClick={() =>
              run(
                markOrderFailed(
                  order.order_id,
                  failureReason.trim() || "התשלום נכשל",
                ),
              )
            }
            disabled={!failureReason.trim()}
            className="app-btn-danger w-full mt-2"
          >
            סימון התשלום כנכשל
          </button>
        </div>
      )}

      <button onClick={onClose} className="app-btn-secondary w-full">
        סגירה
      </button>
    </Modal>
  )
}

export default function AdminOrdersPage() {
  const { orders, invoices, adminRole, lifetime } = useAdmin()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [paymentStatusFilter, setPaymentStatusFilter] = useState("ALL")
  const [productFilter, setProductFilter] = useState("ALL")
  const [fromDate, setFromDate] = useState("")
  const [toDate, setToDate] = useState("")
  const [search, setSearch] = useState("")

  const productIdsInOrders = useMemo(() => {
    const ids = new Map<string, string>()
    orders.forEach((o) =>
      o.items.forEach((it) => ids.set(it.product_id, it.product_name)),
    )
    return [...ids.entries()]
  }, [orders])

  if (!can(adminRole, "orders")) return <AccessDenied page="הזמנות" />

  const selected = orders.find((o) => o.order_id === selectedId) ?? null

  const from = fromDate ? new Date(`${fromDate}T00:00:00`).getTime() : null
  const to = toDate ? new Date(`${toDate}T23:59:59.999`).getTime() : null

  const filtered = orders.filter((o) => {
    const created = new Date(o.created_at).getTime()
    if (from !== null && created < from) return false
    if (to !== null && created > to) return false
    if (
      paymentStatusFilter !== "ALL" &&
      o.payment_status !== paymentStatusFilter
    )
      return false
    if (
      productFilter !== "ALL" &&
      !o.items.some((it) => it.product_id === productFilter)
    )
      return false
    const haystack =
      `${o.customer_first_name} ${o.customer_last_name} ${o.customer_email} ${o.order_number} ${o.order_id} ${o.transaction_reference ?? ""} ${o.items.map((i) => i.product_name).join(" ")}`.toLowerCase()
    return haystack.includes(search.trim().toLowerCase())
  })

  const paidCount = orders.filter((o) => isCaptured(o)).length

  const clearFilters = () => {
    setSearch("")
    setPaymentStatusFilter("ALL")
    setProductFilter("ALL")
    setFromDate("")
    setToDate("")
  }

  return (
    <div className="page-enter">
      <PageHeader
        eyebrow="ניהול · מכירות"
        title="הזמנות"
        description={`${orders.length} הזמנות · ${paidCount} שולמו · ₪${Math.round(
          lifetime.net,
        ).toLocaleString()} הכנסות מאושרות · ${
          invoices.length
        } חשבוניות הונפקו`}
        breadcrumbs={[{ label: "ניהול", to: "/admin" }, { label: "הזמנות" }]}
        actions={
          can(adminRole, "finance") ? (
            <Link to="/admin/finance" className="app-btn-secondary">
              <Icon name="money" size={15} />
              כספים וחשבוניות
            </Link>
          ) : undefined
        }
      />

      {/* Filters */}
      <section className="app-surface mb-4" aria-label="סינון הזמנות">
        <div className="app-surface-body space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 lg:items-end">
            <div className="app-field lg:col-span-4">
              <label htmlFor="orders-search" className="app-label">
                חיפוש
              </label>
              <input
                id="orders-search"
                type="search"
                className="w-full px-4 py-2.5 rounded-lg border text-sm outline-none"
                style={inputStyle}
                placeholder="חיפוש לפי שם, אימייל, מספר הזמנה או מוצר..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="app-field lg:col-span-2">
              <label htmlFor="orders-from" className="app-label">
                מתאריך
              </label>
              <input
                id="orders-from"
                type="date"
                className="w-full px-3 py-2 rounded-lg border text-xs outline-none"
                style={inputStyle}
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
              />
            </div>
            <div className="app-field lg:col-span-2">
              <label htmlFor="orders-to" className="app-label">
                עד תאריך
              </label>
              <input
                id="orders-to"
                type="date"
                className="w-full px-3 py-2 rounded-lg border text-xs outline-none"
                style={inputStyle}
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
              />
            </div>
            <div className="app-field lg:col-span-4">
              <label htmlFor="orders-product" className="app-label">
                מוצר
              </label>
              <select
                id="orders-product"
                className="w-full px-3 py-2 rounded-lg border text-xs outline-none"
                style={inputStyle}
                value={productFilter}
                onChange={(e) => setProductFilter(e.target.value)}
              >
                <option value="ALL">כל המוצרים</option>
                {productIdsInOrders.map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <span className="app-label block mb-1.5">סטטוס תשלום</span>
            <div
              className="app-tabs"
              role="group"
              aria-label="סינון לפי סטטוס תשלום"
              style={{ borderBottom: 0 }}
            >
              <button
                type="button"
                onClick={() => setPaymentStatusFilter("ALL")}
                className="app-tab"
                data-active={paymentStatusFilter === "ALL"}
                aria-pressed={paymentStatusFilter === "ALL"}
              >
                הכול
              </button>
              {PAYMENT_FILTERS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setPaymentStatusFilter(s)}
                  className="app-tab"
                  data-active={paymentStatusFilter === s}
                  aria-pressed={paymentStatusFilter === s}
                >
                  {PAYMENT_LABEL[s]}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      {orders.length === 0 ? (
        <EmptyState
          icon="receipt"
          title="אין עדיין הזמנות."
          description="הזמנות שיושלמו בקופה יופיעו כאן עם סטטוס התשלום והחשבונית."
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon="search"
          title="לא נמצאו הזמנות התואמות את הסינון."
          description="נסו לשנות את טווח התאריכים, המוצר או סטטוס התשלום."
          actions={
            <button
              type="button"
              className="app-btn-secondary"
              onClick={clearFilters}
            >
              ניקוי סינון
            </button>
          }
        />
      ) : (
        <div className="app-table-wrap">
          <table className="app-table" style={{ minWidth: "64rem" }}>
            <thead>
              <tr>
                {["לקוח", "מוצר", "סכום", "תאריך", "תשלום", "חשבונית", "פעולות"].map(
                  (col) => (
                    <th key={col} scope="col">
                      {col}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {filtered.map((order) => {
                const invoice = invoices.find(
                  (inv) => inv.order_id === order.order_id,
                )
                const captured = isCaptured(order)
                return (
                  <tr key={order.order_id}>
                    <td>
                      <p className="font-medium whitespace-nowrap">
                        {order.customer_first_name} {order.customer_last_name}
                      </p>
                      <p className="text-xs app-muted">
                        <span dir="ltr">{order.customer_email}</span>
                      </p>
                      <p
                        className="text-[10px] font-mono app-muted"
                        dir="ltr"
                      >
                        {order.order_number}
                      </p>
                    </td>
                    <td>
                      {order.items.map((item) => (
                        <p
                          key={item.order_item_id}
                          className="text-sm truncate max-w-[16rem]"
                          title={item.product_name}
                        >
                          {item.product_name}
                          {item.quantity > 1 ? ` ×${item.quantity}` : ""}
                        </p>
                      ))}
                    </td>
                    <td className="whitespace-nowrap">
                      <p className="font-semibold">
                        ₪{order.total_amount.toLocaleString()}
                      </p>
                      {order.discount_amount > 0 && (
                        <p className="text-[10px] app-muted">
                          הנחה ₪{order.discount_amount.toLocaleString()}
                        </p>
                      )}
                    </td>
                    <td className="text-xs whitespace-nowrap app-muted">
                      {formatIsraelDateTime(order.created_at) || "—"}
                    </td>
                    <td className="whitespace-nowrap">
                      <span
                        className={`app-badge ${paymentBadge(
                          order.payment_status,
                        )}`}
                      >
                        {PAYMENT_LABEL[order.payment_status]}
                      </span>
                    </td>
                    <td className="whitespace-nowrap">
                      {invoice ? (
                        <>
                          <span className="app-badge app-badge--success">
                            הונפקה
                          </span>
                          <p
                            className="text-[10px] font-mono app-muted mt-1"
                            dir="ltr"
                          >
                            {invoice.invoice_number}
                          </p>
                        </>
                      ) : (
                        <span
                          className={`app-badge ${
                            captured
                              ? "app-badge--warning"
                              : "app-badge--neutral"
                          }`}
                        >
                          לא הונפקה
                        </span>
                      )}
                    </td>
                    <td>
                      <button
                        type="button"
                        onClick={() => setSelectedId(order.order_id)}
                        aria-label={`צפייה בהזמנה ${order.order_number}`}
                        className="app-btn-secondary whitespace-nowrap"
                        style={{
                          minHeight: "2.2rem",
                          padding: "0.35rem 0.9rem",
                          fontSize: "0.75rem",
                        }}
                      >
                        צפייה
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {selected && (
        <OrderDetailModal
          order={selected}
          onClose={() => setSelectedId(null)}
        />
      )}
    </div>
  )
}
