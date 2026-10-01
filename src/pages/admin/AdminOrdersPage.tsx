import { useMemo, useState } from "react"
import { useAdmin } from "../../context/AdminContext"
import { useCms } from "../../context/CmsContext"
import { can } from "../../lib/permissions"
import { formatIsraelDateTime } from "../../lib/datetime"
import { maskCard, SECURITY_NOTE } from "../../lib/sensitive"
import type { Order, PaymentStatus } from "../../types"
import AccessDenied from "../../components/AccessDenied"
import Modal from "../../components/Modal"
import Icon from "../../components/icons"

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

const AMBER = "#F59E0B"

function paymentColor(payment: PaymentStatus): string {
  switch (payment) {
    case "PAID":
      return "var(--color-success)"
    case "FAILED":
      return "var(--color-danger)"
    case "PENDING":
      return AMBER
    default:
      return "var(--color-muted-foreground)"
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
    color?: string
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
      color: paymentColor(order.payment_status),
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
      <div className="grid grid-cols-2 gap-3 mb-5">
        {details.map(({ label, value, mono, color }) => (
          <div
            key={label}
            className="p-3 rounded-md"
            style={{ background: "var(--color-secondary)" }}
          >
            <p
              className="text-xs mb-0.5"
              style={{ color: "var(--color-muted-foreground)" }}
            >
              {label}
            </p>
            <p
              className={`text-sm font-medium truncate ${
                mono ? "font-mono" : ""
              }`}
              dir={mono ? "ltr" : undefined}
              style={{ color }}
              title={value}
            >
              {value}
            </p>
          </div>
        ))}
      </div>

      {/* Payment details — masked by policy */}
      <div
        className="p-3 rounded-md mb-5"
        style={{ background: "var(--color-secondary)" }}
      >
        <p
          className="text-xs mb-2 flex items-center gap-1.5"
          style={{ color: "var(--color-muted-foreground)" }}
        >
          <Icon name="card" size={12} /> פרטי תשלום
        </p>
        <div className="text-sm space-y-1">
          <p className="font-mono" dir="ltr">
            {order.card_last4
              ? maskCard(order.card_last4)
              : "לא נשמרו פרטי כרטיס"}
          </p>
          <p className="text-xs" style={{ color: "var(--color-muted-foreground)" }}>
            {order.payment_provider
              ? `ספק סליקה: ${order.payment_provider}`
              : "ספק סליקה: לא נרשם"}
          </p>
          {order.transaction_reference && (
            <p
              className="text-xs font-mono"
              dir="ltr"
              style={{ color: "var(--color-muted-foreground)" }}
            >
              {order.transaction_reference}
            </p>
          )}
        </div>
        <p
          className="text-[10px] mt-2 flex items-start gap-1"
          style={{ color: "var(--color-muted-foreground)" }}
        >
          <Icon name="shield" size={11} className="flex-shrink-0 mt-px" />
          {SECURITY_NOTE}
        </p>
      </div>

      {/* Items — purchase-time snapshot, never the live catalogue price */}
      <h4
        className="text-xs font-semibold tracking-wide mb-3"
        style={{ color: "var(--color-muted-foreground)" }}
      >
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
              <p
                className="text-xs"
                style={{ color: "var(--color-muted-foreground)" }}
              >
                כמות: {item.quantity} · ₪{item.unit_price.toLocaleString()}{" "}
                ליחידה
                {item.discount_amount > 0
                  ? ` · הנחה ₪${item.discount_amount.toLocaleString()}`
                  : ""}
              </p>
              <p
                className="text-[10px] font-mono mt-0.5"
                dir="ltr"
                style={{ color: "var(--color-muted-foreground)" }}
              >
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
        className="flex items-center justify-between gap-3 p-3 rounded-md mb-5 border"
        style={{ borderColor: "var(--color-border)" }}
      >
        <div className="min-w-0">
          <p
            className="text-xs mb-0.5"
            style={{ color: "var(--color-muted-foreground)" }}
          >
            חשבונית
          </p>
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
            <p
              className="text-sm"
              style={{
                color: captured ? AMBER : "var(--color-muted-foreground)",
              }}
            >
              לא הונפקה
            </p>
          )}
        </div>
        {!invoice && captured && canFinance && (
          <button
            onClick={() => run(issueInvoice(order.order_id))}
            className="text-xs px-3 py-1.5 rounded-full flex-shrink-0"
            style={{
              background: "var(--color-primary)",
              color: "var(--color-primary-foreground)",
            }}
          >
            הנפקת חשבונית
          </button>
        )}
      </div>

      {error && (
        <p className="text-xs mb-4" style={{ color: "var(--color-danger)" }}>
          {error}
        </p>
      )}

      {/* Confirm payment — the only path that marks an order paid */}
      {canMarkPaid &&
        !isSettled(order) &&
        order.payment_status !== "CANCELLED" &&
        (showConfirmPayment ? (
          <div
            className="mb-4 p-4 rounded-md border"
            style={{
              borderColor: "rgba(34,197,94,0.3)",
              background: "rgba(34,197,94,0.05)",
            }}
          >
            <p
              className="text-sm font-semibold mb-3"
              style={{ color: "var(--color-success)" }}
            >
              אישור קבלת תשלום
            </p>
            <div className="grid grid-cols-3 gap-3 mb-3">
              <input
                className={fieldClass}
                style={inputStyle}
                placeholder="ספק תשלומים"
                value={provider}
                onChange={(e) => setProvider(e.target.value)}
              />
              <input
                className={fieldClass}
                style={inputStyle}
                dir="ltr"
                placeholder="מזהה עסקה"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
              />
              <input
                className={fieldClass}
                style={inputStyle}
                dir="ltr"
                maxLength={4}
                placeholder="4 ספרות אחרונות"
                value={last4}
                onChange={(e) => setLast4(e.target.value.replace(/\D/g, ""))}
              />
            </div>
            <div className="flex gap-2">
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
                className="flex-1 py-2 rounded-full text-sm font-medium"
                style={{
                  background: "var(--color-success)",
                  color: "#04160A",
                }}
              >
                אישור התשלום
              </button>
              <button
                onClick={() => setShowConfirmPayment(false)}
                className="flex-1 py-2 rounded-full text-sm font-medium border"
                style={{
                  borderColor: "var(--color-border)",
                  color: "var(--color-foreground)",
                }}
              >
                ביטול
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setShowConfirmPayment(true)}
            className="w-full py-2 rounded-full text-sm font-medium border transition-colors hover:bg-white/5 mb-3"
            style={{
              borderColor: "rgba(34,197,94,0.3)",
              color: "var(--color-success)",
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
          <label
            className="text-xs block mb-1.5"
            style={{ color: "var(--color-muted-foreground)" }}
          >
            סיבת כישלון
          </label>
          <input
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
            className="w-full mt-2 py-2 rounded-full text-xs font-medium border disabled:opacity-40"
            style={{
              borderColor: "rgba(239,68,68,0.3)",
              color: "var(--color-danger)",
            }}
          >
            סימון התשלום כנכשל
          </button>
        </div>
      )}

      <button
        onClick={onClose}
        className="w-full py-2 rounded-full text-sm font-medium border transition-colors hover:bg-white/5"
        style={{
          borderColor: "var(--color-border)",
          color: "var(--color-foreground)",
        }}
      >
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

  const filterButton = (
    value: string,
    current: string,
    set: (v: string) => void,
    label: string,
  ) => (
    <button
      key={value}
      onClick={() => set(value)}
      className="px-3 py-2 rounded-full text-xs font-medium border transition-all"
      style={{
        background: current === value ? "var(--color-primary)" : "transparent",
        color:
          current === value
            ? "var(--color-primary-foreground)"
            : "var(--color-muted-foreground)",
        borderColor:
          current === value ? "var(--color-primary)" : "var(--color-border)",
      }}
    >
      {label}
    </button>
  )

  return (
    <div className="max-w-6xl mx-auto page-enter">
      <div className="mb-8">
        <h1 className="font-display text-4xl font-semibold mb-1">הזמנות</h1>
        <p style={{ color: "var(--color-muted-foreground)" }}>
          {orders.length} הזמנות · {paidCount} שולמו · ₪
          {Math.round(lifetime.net).toLocaleString()} הכנסות מאושרות ·{" "}
          {invoices.length} חשבוניות הונפקו
        </p>
      </div>

      {/* Filters */}
      <div className="card-glow p-4 mb-4 space-y-3">
        <div className="flex items-center gap-3 flex-wrap">
          <input
            className="flex-1 min-w-48 px-4 py-2.5 rounded-lg border text-sm outline-none"
            style={inputStyle}
            placeholder="חיפוש לפי שם, אימייל, מספר הזמנה או מוצר..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <label
            className="flex items-center gap-2 text-xs"
            style={{ color: "var(--color-muted-foreground)" }}
          >
            מתאריך
            <input
              type="date"
              className="px-3 py-2 rounded-lg border text-xs outline-none"
              style={inputStyle}
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
            />
          </label>
          <label
            className="flex items-center gap-2 text-xs"
            style={{ color: "var(--color-muted-foreground)" }}
          >
            עד תאריך
            <input
              type="date"
              className="px-3 py-2 rounded-lg border text-xs outline-none"
              style={inputStyle}
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
            />
          </label>
          <select
            className="px-3 py-2 rounded-lg border text-xs outline-none"
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

        <div className="flex gap-2 flex-wrap items-center">
          <span
            className="text-xs"
            style={{ color: "var(--color-muted-foreground)" }}
          >
            סטטוס תשלום:
          </span>
          {filterButton(
            "ALL",
            paymentStatusFilter,
            setPaymentStatusFilter,
            "הכול",
          )}
          {PAYMENT_FILTERS.map((s) =>
            filterButton(
              s,
              paymentStatusFilter,
              setPaymentStatusFilter,
              PAYMENT_LABEL[s],
            ),
          )}
        </div>
      </div>

      <div
        className="rounded-lg border overflow-x-auto"
        style={{ borderColor: "var(--color-border)" }}
      >
        <table className="w-full text-sm">
          <thead>
            <tr style={{ background: "var(--color-secondary)" }}>
              {["לקוח", "מוצר", "סכום", "תאריך", "תשלום", "חשבונית", ""].map(
                (col, i) => (
                  <th
                    key={`${col}-${i}`}
                    className="text-right px-4 py-3 text-xs tracking-wide whitespace-nowrap"
                    style={{
                      color: "var(--color-muted-foreground)",
                      borderBottom: "1px solid var(--color-border)",
                    }}
                  >
                    {col}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {filtered.map((order, i) => {
              const invoice = invoices.find(
                (inv) => inv.order_id === order.order_id,
              )
              const captured = isCaptured(order)
              return (
                <tr
                  key={order.order_id}
                  style={{
                    background:
                      i % 2 === 0
                        ? "var(--color-card)"
                        : "var(--color-background)",
                    borderBottom: "1px solid var(--color-border)",
                  }}
                >
                  <td className="px-4 py-3">
                    <p className="font-medium whitespace-nowrap">
                      {order.customer_first_name} {order.customer_last_name}
                    </p>
                    <p
                      className="text-xs"
                      dir="ltr"
                      style={{ color: "var(--color-muted-foreground)" }}
                    >
                      {order.customer_email}
                    </p>
                    <p
                      className="text-[10px] font-mono"
                      dir="ltr"
                      style={{ color: "var(--color-muted-foreground)" }}
                    >
                      {order.order_number}
                    </p>
                  </td>
                  <td className="px-4 py-3">
                    {order.items.map((item) => (
                      <p
                        key={item.order_item_id}
                        className="text-sm truncate"
                        title={item.product_name}
                      >
                        {item.product_name}
                        {item.quantity > 1 ? ` ×${item.quantity}` : ""}
                      </p>
                    ))}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <p className="font-semibold">
                      ₪{order.total_amount.toLocaleString()}
                    </p>
                    {order.discount_amount > 0 && (
                      <p
                        className="text-[10px]"
                        style={{ color: "var(--color-muted-foreground)" }}
                      >
                        הנחה ₪{order.discount_amount.toLocaleString()}
                      </p>
                    )}
                  </td>
                  <td
                    className="px-4 py-3 text-xs whitespace-nowrap"
                    style={{ color: "var(--color-muted-foreground)" }}
                  >
                    {formatIsraelDateTime(order.created_at) || "—"}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <span
                      className="text-xs font-medium inline-flex items-center gap-1.5"
                      style={{ color: paymentColor(order.payment_status) }}
                    >
                      <span
                        className="w-1.5 h-1.5 rounded-full"
                        style={{ background: "currentColor" }}
                      />
                      {PAYMENT_LABEL[order.payment_status]}
                    </span>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {invoice ? (
                      <>
                        <span
                          className="text-xs font-medium"
                          style={{ color: "var(--color-success)" }}
                        >
                          הונפקה
                        </span>
                        <p
                          className="text-[10px] font-mono"
                          dir="ltr"
                          style={{ color: "var(--color-muted-foreground)" }}
                        >
                          {invoice.invoice_number}
                        </p>
                      </>
                    ) : (
                      <span
                        className="text-xs"
                        style={{
                          color: captured
                            ? AMBER
                            : "var(--color-muted-foreground)",
                        }}
                      >
                        לא הונפקה
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => setSelectedId(order.order_id)}
                      className="text-xs px-3 py-1 rounded-full border transition-colors hover:bg-white/5 whitespace-nowrap"
                      style={{
                        borderColor: "var(--color-border)",
                        color: "var(--color-foreground)",
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

        {filtered.length === 0 && (
          <div
            className="text-center py-12 text-sm"
            style={{ color: "var(--color-muted-foreground)" }}
          >
            {orders.length === 0
              ? "אין עדיין הזמנות."
              : "לא נמצאו הזמנות התואמות את הסינון."}
          </div>
        )}
      </div>

      {selected && (
        <OrderDetailModal
          order={selected}
          onClose={() => setSelectedId(null)}
        />
      )}
    </div>
  )
}
