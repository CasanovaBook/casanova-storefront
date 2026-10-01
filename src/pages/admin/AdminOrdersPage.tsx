import { useMemo, useState } from "react"
import { useAdmin } from "../../context/AdminContext"
import { useCms } from "../../context/CmsContext"
import { can } from "../../lib/permissions"
import { maskCard, SECURITY_NOTE } from "../../lib/sensitive"
import type {
  Order,
  PaymentStatus,
  Refund,
  RefundRequestStatus,
} from "../../types"
import AccessDenied from "../../components/AccessDenied"
import Modal from "../../components/Modal"
import Icon from "../../components/icons"

const ORDER_STATUS_LABEL: Record<string, string> = {
  PAID: "שולם",
  PENDING: "ממתין",
  FAILED: "נכשל",
  REFUNDED: "הוחזר",
  CANCELLED: "בוטל",
}

const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = {
  PENDING: "ממתין לאישור",
  PAID: "שולם",
  FAILED: "נכשל",
  PARTIALLY_REFUNDED: "הוחזר חלקית",
  REFUNDED: "הוחזר במלואו",
  CANCELLED: "בוטל",
}

const REFUND_STATUS_LABEL: Record<string, string> = {
  NONE: "ללא החזר",
  REQUESTED: "התקבלה בקשה",
  PARTIAL: "החזר חלקי",
  FULL: "החזר מלא",
}

const REFUND_STEP_LABEL: Record<RefundRequestStatus, {
  text: string
  color: string
}> = {
  REQUESTED: { text: "התקבלה בקשה", color: "#60A5FA" },
  PENDING: { text: "ממתין להחלטה", color: "#F59E0B" },
  APPROVED: { text: "אושר", color: "var(--color-success)" },
  REJECTED: { text: "נדחה", color: "var(--color-danger)" },
  PROCESSING: { text: "בטיפול מול הספק", color: "#F59E0B" },
  REFUNDED: { text: "הוחזר בפועל", color: "var(--color-success)" },
  FAILED: { text: "נכשל", color: "var(--color-danger)" },
}

function statusColor(payment: PaymentStatus): string {
  switch (payment) {
    case "PAID":
      return "var(--color-success)"
    case "PARTIALLY_REFUNDED":
    case "REFUNDED":
      return "#6B7280"
    case "FAILED":
      return "var(--color-danger)"
    case "CANCELLED":
      return "#6B7280"
    default:
      return "#F59E0B"
  }
}

const inputStyle = {
  background: "var(--color-secondary)",
  borderColor: "var(--color-border)",
  color: "var(--color-foreground)",
} as const

const fieldClass = "w-full text-sm rounded-lg px-3 py-2 border outline-none"

/* ── Refund lifecycle ──────────────────────────────────────
 * A refund only ever reaches REFUNDED when the payment system
 * confirmed it. Each step is an explicit admin action, and the
 * execute/confirm steps are refused outright while no provider
 * integration is configured. */
function RefundRow({ refund }: { refund: Refund }) {
  const { adminRole, reviewRefund, executeRefund, confirmRefund, failRefund } =
    useAdmin()
  const { settings } = useCms()
  const [providerRefundId, setProviderRefundId] = useState("")
  const [note, setNote] = useState("")
  const [error, setError] = useState("")
  const [mode, setMode] = useState<"idle" | "confirm" | "fail">("idle")

  const st = REFUND_STEP_LABEL[refund.status]
  const canReview = can(adminRole, "refund")
  const canExecute = can(adminRole, "execute_refund")

  const run = (result: { ok: boolean, error?: string }) => {
    if (!result.ok) {
      setError(result.error ?? "הפעולה נכשלה.")
      return
    }
    setError("")
    setMode("idle")
    setNote("")
    setProviderRefundId("")
  }

  return (
    <div
      className="p-3 rounded-md border"
      style={{
        borderColor: "var(--color-border)",
        background: "var(--color-background)",
      }}
    >
      <div className="flex items-center justify-between mb-1.5 gap-3">
        <span className="text-xs font-mono" dir="ltr">
          {refund.refund_id}
        </span>
        <span
          className="text-xs font-bold flex-shrink-0"
          style={{ color: st.color }}
        >
          {st.text}
        </span>
      </div>
      <div className="flex items-center justify-between text-sm mb-1">
        <span style={{ color: "var(--color-muted-foreground)" }}>
          מתוך ₪{refund.original_amount.toLocaleString()} · התבקש{" "}
          {new Date(refund.requested_at).toLocaleDateString("he-IL")}
          {refund.processed_at
            ? ` · הושלם ${new Date(refund.processed_at).toLocaleDateString("he-IL")}`
            : ""}
        </span>
        <span className="font-semibold">₪{refund.amount.toLocaleString()}</span>
      </div>
      <p
        className="text-xs mb-1"
        style={{ color: "var(--color-muted-foreground)" }}
      >
        סיבה: {refund.reason} · יזם: {refund.initiated_by}
      </p>
      {refund.review_note && (
        <p
          className="text-xs mb-1"
          style={{ color: "var(--color-muted-foreground)" }}
        >
          הערת בדיקה: {refund.review_note}
        </p>
      )}
      {refund.provider_refund_id && (
        <p
          className="text-xs font-mono mb-1"
          dir="ltr"
          style={{ color: "var(--color-success)" }}
        >
          {refund.provider_refund_id}
        </p>
      )}

      {error && (
        <p className="text-xs mt-2" style={{ color: "var(--color-danger)" }}>
          {error}
        </p>
      )}

      <div className="flex gap-2 mt-2 flex-wrap">
        {(refund.status === "REQUESTED" || refund.status === "PENDING") &&
          canReview && (
            <>
              <button
                onClick={() =>
                  run(
                    reviewRefund(
                      refund.refund_id,
                      "APPROVED",
                      note.trim() || undefined,
                    ),
                  )
                }
                className="text-xs px-3 py-1.5 rounded-full border"
                style={{
                  borderColor: "rgba(34,197,94,0.3)",
                  color: "var(--color-success)",
                }}
              >
                אישור הבקשה
              </button>
              <button
                onClick={() =>
                  run(
                    reviewRefund(
                      refund.refund_id,
                      "REJECTED",
                      note.trim() || "נדחה",
                    ),
                  )
                }
                className="text-xs px-3 py-1.5 rounded-full border"
                style={{
                  borderColor: "rgba(239,68,68,0.3)",
                  color: "var(--color-danger)",
                }}
              >
                דחייה
              </button>
            </>
          )}
        {refund.status === "APPROVED" && canExecute && (
          <button
            onClick={() => run(executeRefund(refund.refund_id))}
            className="text-xs px-3 py-1.5 rounded-full border"
            style={{ borderColor: "rgba(245,158,11,0.35)", color: "#F59E0B" }}
          >
            שליחה לספק התשלומים
          </button>
        )}
        {(refund.status === "PROCESSING" || refund.status === "APPROVED") &&
          canExecute && (
            <>
              <button
                onClick={() => setMode(mode === "confirm" ? "idle" : "confirm")}
                className="text-xs px-3 py-1.5 rounded-full border"
                style={{
                  borderColor: "rgba(34,197,94,0.3)",
                  color: "var(--color-success)",
                }}
              >
                אישור שההחזר התקבל
              </button>
              <button
                onClick={() => setMode(mode === "fail" ? "idle" : "fail")}
                className="text-xs px-3 py-1.5 rounded-full border"
                style={{
                  borderColor: "rgba(239,68,68,0.3)",
                  color: "var(--color-danger)",
                }}
              >
                סימון כושל
              </button>
            </>
          )}
      </div>

      {mode === "confirm" && (
        <div className="mt-3 space-y-2">
          <input
            className={fieldClass}
            style={inputStyle}
            dir="ltr"
            placeholder="מזהה ההחזר שהתקבל מספק התשלומים"
            value={providerRefundId}
            onChange={(e) => setProviderRefundId(e.target.value)}
          />
          {!settings.refund_execution_enabled && (
            <p className="text-xs" style={{ color: "#F59E0B" }}>
              ביצוע החזרים מול ספק התשלומים כבוי בהגדרות המערכת, לכן האישור
              יידחה עד להפעלתו.
            </p>
          )}
          <button
            onClick={() =>
              run(confirmRefund(refund.refund_id, providerRefundId.trim()))
            }
            disabled={!providerRefundId.trim()}
            className="text-xs px-3 py-1.5 rounded-full disabled:opacity-40"
            style={{ background: "var(--color-success)", color: "#04160A" }}
          >
            שמירת אישור ההחזר
          </button>
        </div>
      )}

      {mode === "fail" && (
        <div className="mt-3 space-y-2">
          <input
            className={fieldClass}
            style={inputStyle}
            placeholder="סיבת הכישלון כפי שהתקבלה מהספק"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <button
            onClick={() =>
              run(failRefund(refund.refund_id, note.trim() || "ההחזר נכשל"))
            }
            disabled={!note.trim()}
            className="text-xs px-3 py-1.5 rounded-full disabled:opacity-40"
            style={{ background: "var(--color-danger)", color: "#fff" }}
          >
            סימון ככושל
          </button>
        </div>
      )}

      {(refund.status === "REQUESTED" || refund.status === "PENDING") &&
        canReview && (
          <input
            className={`${fieldClass} mt-2`}
            style={inputStyle}
            placeholder="הערת בדיקה (אופציונלי)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        )}
    </div>
  )
}

function OrderDetailModal({
  order,
  onClose,
}: {
  order: Order
  onClose: () => void
}) {
  const {
    invoices,
    refunds,
    adminRole,
    requestRefund,
    refundableAmount,
    issueInvoice,
    markOrderPaid,
    markOrderFailed,
    cancelOrder,
  } = useAdmin()
  const { settings } = useCms()

  const [showRefund, setShowRefund] = useState(false)
  const [refundAmount, setRefundAmount] = useState("")
  const [refundReason, setRefundReason] = useState("")
  const [showConfirmPayment, setShowConfirmPayment] = useState(false)
  const [provider, setProvider] = useState(settings.payment_provider ?? "")
  const [reference, setReference] = useState("")
  const [last4, setLast4] = useState("")
  const [failureReason, setFailureReason] = useState("")
  const [error, setError] = useState("")

  const invoice = invoices.find((inv) => inv.order_id === order.order_id)
  const orderRefunds = useMemo(
    () =>
      refunds
        .filter((r) => r.order_id === order.order_id)
        .slice()
        .sort(
          (a, b) =>
            new Date(b.requested_at).getTime() -
            new Date(a.requested_at).getTime(),
        ),
    [refunds, order.order_id],
  )
  const available = refundableAmount(order)
  const canRefund = can(adminRole, "refund")
  const canFinance = can(adminRole, "finance")
  const canMarkPaid = can(adminRole, "mark_paid")
  const isPaid =
    order.payment_status === "PAID" ||
    order.payment_status === "PARTIALLY_REFUNDED"

  const run = (result: { ok: boolean, error?: string }) => {
    if (!result.ok) {
      setError(result.error ?? "הפעולה נכשלה.")
      return false
    }
    setError("")
    return true
  }

  const handleRequestRefund = () => {
    const amount = Number(refundAmount)
    if (!Number.isFinite(amount) || amount <= 0 || !refundReason.trim()) return
    if (run(requestRefund(order.order_id, amount, refundReason.trim()))) {
      setShowRefund(false)
      setRefundReason("")
      setRefundAmount("")
    }
  }

  const details: {
    label: string
    value: string
    mono?: boolean
    color?: string
  }[] = [
    { label: "מספר הזמנה", value: order.order_number, mono: true },
    { label: "מזהה פנימי", value: order.order_id, mono: true },
    {
      label: "לקוח",
      value: `${order.customer_first_name} ${order.customer_last_name}`,
    },
    { label: "אימייל", value: order.customer_email, mono: true },
    { label: "טלפון", value: order.customer_phone ?? "—", mono: true },
    {
      label: "תאריך רכישה",
      value: new Date(order.created_at).toLocaleString("he-IL"),
    },
    {
      label: "סטטוס הזמנה",
      value: ORDER_STATUS_LABEL[order.order_status] ?? order.order_status,
      color: statusColor(order.payment_status),
    },
    {
      label: "סטטוס תשלום",
      value: PAYMENT_STATUS_LABEL[order.payment_status],
      color: statusColor(order.payment_status),
    },
    {
      label: "סטטוס החזר",
      value: REFUND_STATUS_LABEL[order.refund_status] ?? order.refund_status,
    },
    {
      label: "סכום שהוחזר",
      value: `₪${order.refunded_amount.toLocaleString()}`,
    },
    { label: "ספק תשלומים", value: order.payment_provider ?? "לא נרשם" },
    {
      label: "מזהה עסקה",
      value: order.transaction_reference ?? "—",
      mono: true,
    },
    {
      label: "שולם בתאריך",
      value: order.paid_at
        ? new Date(order.paid_at).toLocaleString("he-IL")
        : "טרם שולם",
    },
    { label: "קופון", value: order.coupon_code ?? "—", mono: true },
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
            <p
              className="text-xs"
              style={{ color: "var(--color-muted-foreground)" }}
            >
              {order.payment_provider
                ? `ספק סליקה: ${order.payment_provider}`
                : "ספק סליקה: לא נרשם"}
            </p>
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
        <div className="space-y-2 mb-4">
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

        {/* Totals */}
        <div
          className="p-3 rounded-md border mb-5 text-sm space-y-1"
          style={{ borderColor: "var(--color-border)" }}
        >
          <div
            className="flex justify-between"
            style={{ color: "var(--color-muted-foreground)" }}
          >
            <span>סיכום ביניים</span>
            <span>₪{order.subtotal.toLocaleString()}</span>
          </div>
          <div
            className="flex justify-between"
            style={{ color: "var(--color-muted-foreground)" }}
          >
            <span>הנחות</span>
            <span>−₪{order.discount_amount.toLocaleString()}</span>
          </div>
          <div
            className="flex justify-between font-semibold pt-1"
            style={{ borderTop: "1px solid var(--color-border)" }}
          >
            <span>סה״כ לתשלום</span>
            <span>₪{order.total_amount.toLocaleString()}</span>
          </div>
        </div>

        {/* Invoice */}
        <div
          className="flex items-center justify-between p-3 rounded-md mb-5 border"
          style={{ borderColor: "var(--color-border)" }}
        >
          <div>
            <p
              className="text-xs mb-0.5"
              style={{ color: "var(--color-muted-foreground)" }}
            >
              חשבונית
            </p>
            {invoice ? (
              <p className="text-sm font-mono" dir="ltr">
                {invoice.invoice_number} · ₪{invoice.amount.toLocaleString()} ·{" "}
                {invoice.status}
              </p>
            ) : (
              <p
                className="text-sm"
                style={{
                  color: isPaid
                    ? "var(--color-danger)"
                    : "var(--color-muted-foreground)",
                }}
              >
                {isPaid ? "לא הונפקה — דורש טיפול" : "טרם שולמה, אין חשבונית"}
              </p>
            )}
          </div>
          {!invoice && isPaid && canFinance && (
            <button
              onClick={() => run(issueInvoice(order.order_id))}
              className="text-xs px-3 py-1.5 rounded-full"
              style={{
                background: "var(--color-primary)",
                color: "var(--color-primary-foreground)",
              }}
            >
              הנפקת חשבונית
            </button>
          )}
        </div>

        {/* Refunds */}
        <h4
          className="text-xs font-semibold tracking-wide mb-2"
          style={{ color: "var(--color-muted-foreground)" }}
        >
          החזרים ({orderRefunds.length})
        </h4>
        {orderRefunds.length === 0 ? (
          <p
            className="text-sm mb-4"
            style={{ color: "var(--color-muted-foreground)" }}
          >
            לא נמצאו החזרים להזמנה זו.
          </p>
        ) : (
          <div className="space-y-2 mb-4">
            {orderRefunds.map((r) => (
              <RefundRow key={r.refund_id} refund={r} />
            ))}
          </div>
        )}

        {error && (
          <p className="text-xs mb-4" style={{ color: "var(--color-danger)" }}>
            {error}
          </p>
        )}

        {/* Request a refund — records the request, never moves money */}
        {canRefund &&
          isPaid &&
          available > 0 &&
          (showRefund ? (
            <div
              className="mb-4 p-4 rounded-md border"
              style={{
                borderColor: "rgba(239,68,68,0.3)",
                background: "rgba(239,68,68,0.05)",
              }}
            >
              <p
                className="text-sm font-semibold mb-3"
                style={{ color: "var(--color-danger)" }}
              >
                בקשת החזר כספי · יתרה להחזר ₪{available.toLocaleString()}
              </p>
              <div className="grid grid-cols-2 gap-3 mb-3">
                <div>
                  <label
                    className="text-xs block mb-1"
                    style={{ color: "var(--color-muted-foreground)" }}
                  >
                    סכום להחזר
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={available}
                    step="0.01"
                    className={fieldClass}
                    style={inputStyle}
                    value={refundAmount}
                    placeholder={String(available)}
                    onChange={(e) => setRefundAmount(e.target.value)}
                  />
                </div>
                <div>
                  <label
                    className="text-xs block mb-1"
                    style={{ color: "var(--color-muted-foreground)" }}
                  >
                    סיבת ההחזר
                  </label>
                  <input
                    className={fieldClass}
                    style={inputStyle}
                    placeholder="לדוגמה: בקשת לקוח"
                    value={refundReason}
                    onChange={(e) => setRefundReason(e.target.value)}
                  />
                </div>
              </div>
              <p
                className="text-xs mb-3"
                style={{ color: "var(--color-muted-foreground)" }}
              >
                שמירת הבקשה אינה מעבירה כסף. ההחזר יבוצע בפועל רק לאחר אישורו
                ואישור ספק התשלומים.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={handleRequestRefund}
                  disabled={
                    !refundReason.trim() ||
                    !Number(refundAmount) ||
                    Number(refundAmount) > available
                  }
                  className="flex-1 py-2 rounded-full text-sm font-medium disabled:opacity-40"
                  style={{ background: "var(--color-danger)", color: "#fff" }}
                >
                  שמירת בקשת ההחזר
                </button>
                <button
                  onClick={() => setShowRefund(false)}
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
              onClick={() => {
                setShowRefund(true)
                setRefundAmount(String(available))
              }}
              className="w-full py-2 rounded-full text-sm font-medium border transition-colors hover:bg-red-500/10 mb-3"
              style={{
                borderColor: "rgba(239,68,68,0.3)",
                color: "var(--color-danger)",
              }}
            >
              בקשת החזר כספי
            </button>
          ))}

        {/* Confirm payment — the only path that marks an order paid */}
        {canMarkPaid &&
          !isPaid &&
          order.order_status !== "CANCELLED" &&
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

        {/* Failure / cancellation */}
        {canMarkPaid && order.payment_status === "PENDING" && (
          <div
            className="mb-4 p-3 rounded-md border"
            style={{ borderColor: "var(--color-border)" }}
          >
            <label
              className="text-xs block mb-1.5"
              style={{ color: "var(--color-muted-foreground)" }}
            >
              סיבת כישלון / ביטול
            </label>
            <input
              className={fieldClass}
              style={inputStyle}
              value={failureReason}
              onChange={(e) => setFailureReason(e.target.value)}
              placeholder="לדוגמה: הכרטיס נדחה על ידי הספק"
            />
            <div className="flex gap-2 mt-2">
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
                className="flex-1 py-2 rounded-full text-xs font-medium border disabled:opacity-40"
                style={{
                  borderColor: "rgba(239,68,68,0.3)",
                  color: "var(--color-danger)",
                }}
              >
                סימון התשלום כנכשל
              </button>
              <button
                onClick={() =>
                  run(
                    cancelOrder(
                      order.order_id,
                      failureReason.trim() || undefined,
                    ),
                  )
                }
                className="flex-1 py-2 rounded-full text-xs font-medium border"
                style={{
                  borderColor: "var(--color-border)",
                  color: "var(--color-muted-foreground)",
                }}
              >
                ביטול ההזמנה
              </button>
            </div>
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
  const { orders, invoices, refunds, adminRole, lifetime } = useAdmin()
  const { products } = useCms()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [orderStatusFilter, setOrderStatusFilter] = useState("ALL")
  const [paymentStatusFilter, setPaymentStatusFilter] = useState("ALL")
  const [refundStatusFilter, setRefundStatusFilter] = useState("ALL")
  const [productFilter, setProductFilter] = useState("ALL")
  const [fromDate, setFromDate] = useState("")
  const [toDate, setToDate] = useState("")
  const [search, setSearch] = useState("")

  if (!can(adminRole, "orders")) return <AccessDenied page="הזמנות" />

  const selected = orders.find((o) => o.order_id === selectedId) ?? null

  const productIdsInOrders = useMemo(() => {
    const ids = new Map<string, string>()
    orders.forEach((o) =>
      o.items.forEach((it) => ids.set(it.product_id, it.product_name)),
    )
    return [...ids.entries()]
  }, [orders])

  const from = fromDate ? new Date(`${fromDate}T00:00:00`).getTime() : null
  const to = toDate ? new Date(`${toDate}T23:59:59.999`).getTime() : null

  const filtered = orders.filter((o) => {
    const created = new Date(o.created_at).getTime()
    if (from !== null && created < from) return false
    if (to !== null && created > to) return false
    if (orderStatusFilter !== "ALL" && o.order_status !== orderStatusFilter)
      return false
    if (
      paymentStatusFilter !== "ALL" &&
      o.payment_status !== paymentStatusFilter
    )
      return false
    if (refundStatusFilter !== "ALL" && o.refund_status !== refundStatusFilter)
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

  const paidCount = orders.filter(
    (o) =>
      o.payment_status !== "PENDING" &&
      o.payment_status !== "FAILED" &&
      o.payment_status !== "CANCELLED",
  ).length
  const openRefundRequests = refunds.filter(
    (r) =>
      r.status === "REQUESTED" ||
      r.status === "PENDING" ||
      r.status === "APPROVED" ||
      r.status === "PROCESSING",
  ).length

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
          {openRefundRequests > 0
            ? ` · ${openRefundRequests} בקשות החזר ממתינות`
            : ""}
        </p>
      </div>

      {/* Filters */}
      <div className="card-glow p-4 mb-4 space-y-3">
        <div className="flex items-center gap-3 flex-wrap">
          <input
            className="flex-1 min-w-48 px-4 py-2.5 rounded-lg border text-sm outline-none"
            style={inputStyle}
            placeholder="חיפוש לפי שם, אימייל, מספר הזמנה, מזהה עסקה או מוצר..."
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

        <div className="flex gap-4 flex-wrap">
          <div className="flex gap-2 flex-wrap items-center">
            <span
              className="text-xs"
              style={{ color: "var(--color-muted-foreground)" }}
            >
              סטטוס הזמנה:
            </span>
            {filterButton(
              "ALL",
              orderStatusFilter,
              setOrderStatusFilter,
              "הכול",
            )}
            {([
              "PENDING",
              "PAID",
              "FAILED",
              "REFUNDED",
              "CANCELLED",
            ] as const).map((s) =>
              filterButton(
                s,
                orderStatusFilter,
                setOrderStatusFilter,
                ORDER_STATUS_LABEL[s],
              ),
            )}
          </div>
        </div>

        <div className="flex gap-4 flex-wrap">
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
            {(Object.keys(PAYMENT_STATUS_LABEL) as PaymentStatus[]).map((s) =>
              filterButton(
                s,
                paymentStatusFilter,
                setPaymentStatusFilter,
                PAYMENT_STATUS_LABEL[s],
              ),
            )}
          </div>
        </div>

        <div className="flex gap-2 flex-wrap items-center">
          <span
            className="text-xs"
            style={{ color: "var(--color-muted-foreground)" }}
          >
            סטטוס החזר:
          </span>
          {filterButton(
            "ALL",
            refundStatusFilter,
            setRefundStatusFilter,
            "הכול",
          )}
          {(["NONE", "REQUESTED", "PARTIAL", "FULL"] as const).map((s) =>
            filterButton(
              s,
              refundStatusFilter,
              setRefundStatusFilter,
              REFUND_STATUS_LABEL[s],
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
              {[
                "מספר הזמנה",
                "לקוח",
                "פריטים",
                "סיכום",
                "סה״כ",
                "תשלום",
                "החזר",
                "חשבונית",
                "תאריך",
                "",
              ].map((col, i) => (
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
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((order, i) => {
              const hasInvoice = invoices.some(
                (inv) => inv.order_id === order.order_id,
              )
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
                  <td
                    className="px-4 py-3 font-mono text-xs whitespace-nowrap"
                    dir="ltr"
                    style={{ color: "var(--color-muted-foreground)" }}
                  >
                    {order.order_number}
                  </td>
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
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-xs">
                      {order.items
                        .map((it) => `${it.product_name} ×${it.quantity}`)
                        .join(", ")}
                    </span>
                  </td>
                  <td
                    className="px-4 py-3 text-xs whitespace-nowrap"
                    style={{ color: "var(--color-muted-foreground)" }}
                  >
                    ₪{order.subtotal.toLocaleString()}
                    {order.discount_amount > 0
                      ? ` − ₪${order.discount_amount.toLocaleString()}`
                      : ""}
                  </td>
                  <td className="px-4 py-3 font-semibold whitespace-nowrap">
                    ₪{order.total_amount.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <span
                      className="text-xs"
                      style={{ color: statusColor(order.payment_status) }}
                    >
                      {PAYMENT_STATUS_LABEL[order.payment_status]}
                    </span>
                    <p
                      className="text-[10px]"
                      style={{ color: "var(--color-muted-foreground)" }}
                    >
                      {ORDER_STATUS_LABEL[order.order_status] ??
                        order.order_status}
                      {order.payment_provider
                        ? ` · ${order.payment_provider}`
                        : ""}
                    </p>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <span
                      className="text-xs"
                      style={{
                        color:
                          order.refund_status === "NONE"
                            ? "var(--color-muted-foreground)"
                            : "var(--color-danger)",
                      }}
                    >
                      {REFUND_STATUS_LABEL[order.refund_status] ??
                        order.refund_status}
                    </span>
                    {order.refunded_amount > 0 && (
                      <p
                        className="text-[10px]"
                        style={{ color: "var(--color-muted-foreground)" }}
                      >
                        ₪{order.refunded_amount.toLocaleString()}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <span
                      className="text-xs"
                      style={{
                        color: hasInvoice
                          ? "var(--color-success)"
                          : order.payment_status === "PAID"
                            ? "var(--color-danger)"
                            : "var(--color-muted-foreground)",
                      }}
                    >
                      {hasInvoice
                        ? "הונפקה"
                        : order.payment_status === "PAID"
                          ? "חסרה"
                          : "—"}
                    </span>
                  </td>
                  <td
                    className="px-4 py-3 text-xs whitespace-nowrap"
                    style={{ color: "var(--color-muted-foreground)" }}
                  >
                    {new Date(order.created_at).toLocaleDateString("he-IL", {
                      day: "numeric",
                      month: "short",
                      year: "2-digit",
                    })}
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
