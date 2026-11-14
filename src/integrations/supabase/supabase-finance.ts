/* ─────────────────────────────────────────────────────────────
 * Supabase finance service - hosted invoices, refunds, payments and
 * audit entries.
 *
 * These are the read/write paths the admin finance, orders and audit
 * screens need after the local-store fallback is removed. Reads are
 * RLS-scoped (0039 adds staff SELECT policies); writes go through the
 * SECURITY DEFINER RPCs in 0039, never through raw table updates.
 *
 * Every function resolves. A failed read returns a Result failure so a
 * screen can show an error instead of presenting an empty list as a
 * real answer.
 * ───────────────────────────────────────────────────────────── */

import type {
  AuditCategory,
  AuditLogEntry,
  Invoice,
  Payment,
  Refund,
  RefundRequestStatus,
} from "../../types"
import { fail, ok, type ErrorCode, type Result } from "../../shared/result"
import { isSupabaseConfigured, requireSupabase } from "./supabase"

const PAYMENT_COLUMNS =
  "payment_id, order_id, provider, status, amount, currency, transaction_reference, card_last4, failure_reason, created_at"

const INVOICE_COLUMNS =
  "invoice_id, order_id, invoice_number, amount, currency, issued_at, status"

const REFUND_COLUMNS =
  "refund_id, order_id, payment_id, original_amount, amount, currency, reason, status, provider, provider_refund_id, requested_at, reviewed_at, reviewed_by, review_note, processed_at, initiated_by_id"

const AUDIT_COLUMNS =
  "audit_id, actor_id, actor_name, actor_role, category, action, target_type, target_id, target_label, details, created_at"

interface PaymentRow {
  payment_id?: unknown
  order_id?: unknown
  provider?: unknown
  status?: unknown
  amount?: unknown
  currency?: unknown
  transaction_reference?: unknown
  card_last4?: unknown
  failure_reason?: unknown
  created_at?: unknown
}

interface InvoiceRow {
  invoice_id?: unknown
  order_id?: unknown
  invoice_number?: unknown
  amount?: unknown
  currency?: unknown
  issued_at?: unknown
  status?: unknown
}

interface RefundRow {
  refund_id?: unknown
  order_id?: unknown
  payment_id?: unknown
  original_amount?: unknown
  amount?: unknown
  currency?: unknown
  reason?: unknown
  status?: unknown
  provider?: unknown
  provider_refund_id?: unknown
  requested_at?: unknown
  reviewed_at?: unknown
  reviewed_by?: unknown
  review_note?: unknown
  processed_at?: unknown
  initiated_by_id?: unknown
}

interface AuditRow {
  audit_id?: unknown
  actor_id?: unknown
  actor_name?: unknown
  actor_role?: unknown
  category?: unknown
  action?: unknown
  target_type?: unknown
  target_id?: unknown
  target_label?: unknown
  details?: unknown
  created_at?: unknown
}

const str = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value : fallback

const num = (value: unknown, fallback = 0): number => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

const firstRow = <T>(data: unknown): T | null => {
  if (Array.isArray(data)) return (data[0] as T) ?? null
  if (data && typeof data === "object") return data as T
  return null
}

const REFUND_STATUSES: RefundRequestStatus[] = [
  "REQUESTED",
  "PENDING",
  "APPROVED",
  "REJECTED",
  "PROCESSING",
  "REFUNDED",
  "FAILED",
]

const PAYMENT_STATUSES: Payment["status"][] = [
  "PENDING",
  "AUTHORIZED",
  "CAPTURED",
  "FAILED",
  "CANCELLED",
]

const AUDIT_CATEGORIES: AuditCategory[] = [
  "PRICE_CHANGE",
  "REFUND",
  "ACCESS_CHANGE",
  "USER_BLOCK",
  "CONTENT_SWAP",
  "PRODUCT_CREATE",
  "PRODUCT_UPDATE",
  "PRODUCT_DELETE",
  "ORDER_CHANGE",
  "ROLE_CHANGE",
  "EMAIL_RESEND",
  "COUPON_CHANGE",
  "INQUIRY",
  "SETTINGS",
  "SECURITY",
  "AUTH",
  "OTHER",
]

const asRefundStatus = (value: unknown): RefundRequestStatus =>
  REFUND_STATUSES.includes(value as RefundRequestStatus)
    ? (value as RefundRequestStatus)
    : "REQUESTED"

const asPaymentStatus = (value: unknown): Payment["status"] =>
  PAYMENT_STATUSES.includes(value as Payment["status"])
    ? (value as Payment["status"])
    : "PENDING"

const asAuditCategory = (value: unknown): AuditCategory =>
  AUDIT_CATEGORIES.includes(value as AuditCategory)
    ? (value as AuditCategory)
    : "OTHER"

export function toPayment(row: PaymentRow): Payment {
  return {
    payment_id: str(row.payment_id),
    order_id: str(row.order_id),
    provider: str(row.provider),
    status: asPaymentStatus(row.status),
    amount: num(row.amount),
    currency: str(row.currency, "ILS"),
    transaction_reference: str(row.transaction_reference) || undefined,
    card_last4: str(row.card_last4) || undefined,
    failure_reason: str(row.failure_reason) || undefined,
    created_at: str(row.created_at),
  }
}

export function toInvoice(row: InvoiceRow): Invoice {
  return {
    invoice_id: str(row.invoice_id),
    order_id: str(row.order_id),
    invoice_number: str(row.invoice_number),
    amount: num(row.amount),
    currency: str(row.currency, "ILS"),
    issued_at: str(row.issued_at),
    status: str(row.status, "ISSUED"),
  }
}

export function toRefund(row: RefundRow): Refund {
  return {
    refund_id: str(row.refund_id),
    order_id: str(row.order_id),
    payment_id: str(row.payment_id) || undefined,
    original_amount: num(row.original_amount),
    amount: num(row.amount),
    currency: str(row.currency, "ILS"),
    reason: str(row.reason),
    status: asRefundStatus(row.status),
    provider: str(row.provider) || undefined,
    provider_refund_id: str(row.provider_refund_id) || undefined,
    requested_at: str(row.requested_at),
    reviewed_at: str(row.reviewed_at) || undefined,
    reviewed_by: str(row.reviewed_by) || undefined,
    review_note: str(row.review_note) || undefined,
    processed_at: str(row.processed_at) || undefined,
    initiated_by: str(row.initiated_by_id) || "system",
    initiated_by_id: str(row.initiated_by_id) || undefined,
  }
}

/* ── Reads ─────────────────────────────────────────────── */

async function readRows<T>(
  table: string,
  columns: string,
  orderBy: string,
): Promise<Result<T[]>> {
  if (!isSupabaseConfigured) {
    return fail("PROVIDER_NOT_CONFIGURED", "שרת Supabase אינו מוגדר.")
  }

  try {
    const { data, error } = await requireSupabase()
      .from(table)
      .select(columns)
      .order(orderBy, { ascending: false })

    if (error) {
      return fail(
        "STORAGE",
        `לא ניתן לטעון נתונים משרת הנתונים (${table}): ${error.message}`,
      )
    }

    return ok((data ?? []) as T[])
  } catch (err) {
    return fail(
      "STORAGE",
      err instanceof Error
        ? `שגיאת רשת בזמן טעינת ${table}: ${err.message}`
        : `שגיאת רשת בלתי צפויה בזמן טעינת ${table}.`,
    )
  }
}

export async function fetchAllInvoices(): Promise<Result<Invoice[]>> {
  const result = await readRows<InvoiceRow>(
    "invoices",
    INVOICE_COLUMNS,
    "issued_at",
  )
  return result.ok ? ok(result.data.map(toInvoice)) : result
}

export async function fetchAllRefunds(): Promise<Result<Refund[]>> {
  const result = await readRows<RefundRow>("refunds", REFUND_COLUMNS, "requested_at")
  return result.ok ? ok(result.data.map(toRefund)) : result
}

export async function fetchAllPayments(): Promise<Result<Payment[]>> {
  const result = await readRows<PaymentRow>(
    "payments",
    PAYMENT_COLUMNS,
    "created_at",
  )
  return result.ok ? ok(result.data.map(toPayment)) : result
}

export async function fetchAuditLog(): Promise<Result<AuditLogEntry[]>> {
  const result = await readRows<AuditRow>("audit_logs", AUDIT_COLUMNS, "created_at")

  if (!result.ok) return result

  return ok(
    result.data.map((row) => ({
      audit_id: str(row.audit_id),
      actor_id: str(row.actor_id),
      actor_name: str(row.actor_name, "מערכת"),
      actor_role: str(row.actor_role, "SYSTEM"),
      category: asAuditCategory(row.category),
      action: str(row.action),
      target_type: str(row.target_type),
      target_id: str(row.target_id),
      target_label: str(row.target_label),
      details: str(row.details),
      created_at: str(row.created_at),
    })),
  )
}

/* ── Writes ────────────────────────────────────────────── */

const MESSAGES: Record<string, string> = {
  order_not_found: "ההזמנה לא נמצאה.",
  order_already_paid: "ההזמנה כבר סומנה כשולמה.",
  order_cancelled: "לא ניתן לאשר תשלום עבור הזמנה שבוטלה.",
  order_paid_cannot_cancel:
    "הזמנה ששולמה לא ניתנת לביטול - יש לבצע החזר כספי.",
  order_not_paid: "ניתן להנפיק חשבונית רק עבור הזמנה ששולמה.",
  invoice_exists: "כבר הונפקה חשבונית להזמנה זו.",
  refund_not_found: "בקשת ההחזר לא נמצאה.",
  refund_status_invalid: "לא ניתן לבצע את הפעולה בסטטוס הנוכחי של ההחזר.",
  refund_exceeds_balance: "הסכום המבוקש חורג מהיתרה להחזר.",
  refund_execution_disabled:
    "ביצוע החזר בפועל דורש חיבור לספק תשלומים. הכסף לא הוחזר.",
  refund_amount_invalid: "סכום ההחזר חייב להיות חיובי.",
  refund_reason_required: "יש לציין סיבה.",
  refund_provider_reference_required:
    "יש להזין את מזהה ההחזר שהתקבל מספק התשלומים.",
  refund_already_refunded: "החזר שכבר בוצע לא ניתן לסימון ככושל.",
  refund_decision_invalid: "החלטת ההחזר אינה חוקית.",
  permission_denied: "אין הרשאה לבצע את הפעולה.",
  admin_required: "הפעולה זמינה למנהלים בלבד.",
}

function mapRpcError(
  message: string | undefined,
  code: string | undefined,
): { code: ErrorCode; error: string } {
  const text = message ?? ""
  const token = Object.keys(MESSAGES).find((key) => text.includes(key))

  if (token) {
    const errorCode: ErrorCode =
      token === "permission_denied" || token === "admin_required"
        ? "FORBIDDEN"
        : token.startsWith("refund_execution")
          ? "PROVIDER_NOT_CONFIGURED"
          : token.endsWith("not_found")
            ? "NOT_FOUND"
            : token.includes("invalid") ||
                token.includes("required") ||
                token.includes("exceeds") ||
                token === "order_not_paid"
              ? "VALIDATION"
              : "CONFLICT"

    return { code: errorCode, error: MESSAGES[token] }
  }

  if (code === "42501") return { code: "FORBIDDEN", error: MESSAGES.permission_denied }
  if (code === "P0002") return { code: "NOT_FOUND", error: "הרשומה לא נמצאה." }
  if (code === "0A000")
    return { code: "PROVIDER_NOT_CONFIGURED", error: MESSAGES.refund_execution_disabled }

  return {
    code: "STORAGE",
    error: text || "הפעולה נכשלה בשרת.",
  }
}

type RpcCall = {
  name: string
  args: Record<string, unknown>
}

async function callRpc<T>(
  call: RpcCall,
  map: (row: Record<string, unknown>) => T,
): Promise<Result<T>> {
  if (!isSupabaseConfigured) {
    return fail("PROVIDER_NOT_CONFIGURED", "שרת Supabase אינו מוגדר.")
  }

  try {
    const { data, error } = await requireSupabase().rpc(
      call.name,
      call.args,
    )

    if (error) {
      const mapped = mapRpcError(error.message, error.code)
      return fail(mapped.code, mapped.error)
    }

    const row = firstRow<Record<string, unknown>>(data)
    if (!row) {
      return fail("STORAGE", "השרת לא החזיר את הרשומה לאחר הפעולה.")
    }

    return ok(map(row))
  } catch (err) {
    return fail(
      "STORAGE",
      err instanceof Error ? err.message : "שגיאת רשת בלתי צפויה.",
    )
  }
}

export async function issueInvoiceRemote(
  orderId: string,
): Promise<Result<Invoice>> {
  return callRpc(
    { name: "admin_issue_invoice", args: { p_order_id: orderId } },
    (row) => toInvoice(row as InvoiceRow),
  )
}

export async function requestRefundRemote(
  orderId: string,
  amount: number,
  reason: string,
): Promise<Result<Refund>> {
  return callRpc(
    {
      name: "admin_request_refund",
      args: { p_order_id: orderId, p_amount: amount, p_reason: reason },
    },
    (row) => toRefund(row as RefundRow),
  )
}

export async function reviewRefundRemote(
  refundId: string,
  decision: "APPROVED" | "REJECTED",
  note?: string,
): Promise<Result<Refund>> {
  return callRpc(
    {
      name: "admin_review_refund",
      args: {
        p_refund_id: refundId,
        p_decision: decision,
        p_note: note ?? null,
      },
    },
    (row) => toRefund(row as RefundRow),
  )
}

export async function executeRefundRemote(
  refundId: string,
): Promise<Result<Refund>> {
  return callRpc(
    { name: "admin_execute_refund", args: { p_refund_id: refundId } },
    (row) => toRefund(row as RefundRow),
  )
}

export async function confirmRefundRemote(
  refundId: string,
  providerRefundId: string,
): Promise<Result<Refund>> {
  return callRpc(
    {
      name: "admin_confirm_refund",
      args: {
        p_refund_id: refundId,
        p_provider_refund_id: providerRefundId,
      },
    },
    (row) => toRefund(row as RefundRow),
  )
}

export async function failRefundRemote(
  refundId: string,
  note: string,
): Promise<Result<Refund>> {
  return callRpc(
    {
      name: "admin_fail_refund",
      args: { p_refund_id: refundId, p_note: note },
    },
    (row) => toRefund(row as RefundRow),
  )
}
