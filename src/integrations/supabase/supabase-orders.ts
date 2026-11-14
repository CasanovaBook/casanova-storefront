/* ─────────────────────────────────────────────────────────────
 * Supabase orders service - the hosted read side of the admin
 * orders screen.
 *
 * Purchases are written server-side by `create_storefront_order` /
 * `create_guest_storefront_order`, so `public.orders` (and its lines in
 * `public.order_items`) is the source of truth for what was sold. The
 * browser used to read the local document only, which meant an order
 * placed on another device was invisible and the dashboard reported
 * zero orders and zero revenue.
 *
 * The read is gated by the live RLS policies: an admin JWT sees the
 * whole table, any other caller only its own rows. Nothing is written
 * back from here.
 *
 * Every function resolves; none ever rejects. A failed read returns
 * `Result` failure so the panel can say so instead of rendering the
 * failure as "no orders".
 * ───────────────────────────────────────────────────────────── */

import type {
  Order,
  OrderItem,
  OrderStatus,
  PaymentStatus,
  RefundStatus,
} from "../../types"
import { fail, ok, type Result } from "../../shared/result"
import { isSupabaseConfigured, requireSupabase } from "./supabase"

/** Every order column the admin list and dashboard consume. */
const ORDER_COLUMNS = [
  "order_id",
  "order_number",
  "user_id",
  "order_status",
  "payment_status",
  "subtotal",
  "discount_amount",
  "total_amount",
  "currency",
  "coupon_code",
  "customer_first_name",
  "customer_last_name",
  "customer_email",
  "customer_phone",
  "created_at",
  "paid_at",
].join(", ")

/** Purchase-time snapshot, never a live product join. */
const ITEM_COLUMNS = [
  "order_item_id",
  "order_id",
  "product_id",
  "product_name",
  "quantity",
  "unit_price",
  "discount_amount",
  "line_total",
].join(", ")

interface OrderRow {
  order_id?: unknown
  order_number?: unknown
  user_id?: unknown
  order_status?: unknown
  payment_status?: unknown
  subtotal?: unknown
  discount_amount?: unknown
  total_amount?: unknown
  currency?: unknown
  coupon_code?: unknown
  customer_first_name?: unknown
  customer_last_name?: unknown
  customer_email?: unknown
  customer_phone?: unknown
  created_at?: unknown
  paid_at?: unknown
}

interface OrderItemRow {
  order_item_id?: unknown
  order_id?: unknown
  product_id?: unknown
  product_name?: unknown
  quantity?: unknown
  unit_price?: unknown
  discount_amount?: unknown
  line_total?: unknown
}

const str = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value : fallback

const num = (value: unknown, fallback = 0): number => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

const ORDER_STATUSES: OrderStatus[] = [
  "PENDING",
  "PAID",
  "CANCELLED",
  "REFUNDED",
  "FAILED",
]

const PAYMENT_STATUSES: PaymentStatus[] = [
  "PENDING",
  "PAID",
  "FAILED",
  "PARTIALLY_REFUNDED",
  "REFUNDED",
  "CANCELLED",
]

function asOrderStatus(value: unknown): OrderStatus {
  return ORDER_STATUSES.includes(value as OrderStatus)
    ? (value as OrderStatus)
    : "PENDING"
}

function asPaymentStatus(value: unknown): PaymentStatus {
  return PAYMENT_STATUSES.includes(value as PaymentStatus)
    ? (value as PaymentStatus)
    : "PENDING"
}

/**
 * `orders` deliberately stores no refund roll-up (schema.sql derives it in
 * `v_order_refunds`). The payment status is authoritative for whether money
 * came back, so it carries the display status until the refunds read is
 * wired into this panel.
 */
function refundStatusFor(payment: PaymentStatus): RefundStatus {
  if (payment === "REFUNDED") return "FULL"
  if (payment === "PARTIALLY_REFUNDED") return "PARTIAL"
  return "NONE"
}

function toOrderItem(row: OrderItemRow): OrderItem {
  return {
    order_item_id: str(row.order_item_id),
    order_id: str(row.order_id),
    product_id: str(row.product_id),
    product_name: str(row.product_name),
    quantity: num(row.quantity, 1),
    unit_price: num(row.unit_price),
    discount_amount: num(row.discount_amount),
    line_total: num(row.line_total),
  }
}

function toOrder(row: OrderRow, items: OrderItem[]): Order {
  const payment = asPaymentStatus(row.payment_status)

  return {
    order_id: str(row.order_id),
    order_number: str(row.order_number),
    user_id: str(row.user_id),
    order_status: asOrderStatus(row.order_status),
    payment_status: payment,
    refund_status: refundStatusFor(payment),
    refunded_amount: 0,
    subtotal: num(row.subtotal),
    discount_amount: num(row.discount_amount),
    total_amount: num(row.total_amount),
    currency: str(row.currency, "ILS"),
    coupon_code: str(row.coupon_code) || undefined,
    customer_first_name: str(row.customer_first_name),
    customer_last_name: str(row.customer_last_name),
    customer_email: str(row.customer_email),
    customer_phone: str(row.customer_phone) || undefined,
    created_at: str(row.created_at),
    paid_at: str(row.paid_at) || undefined,
    items,
  }
}

/**
 * Reads every order the caller's JWT may see, newest first, with the
 * purchase-time lines attached.
 *
 * The orders read is the one that matters: a refusal there returns a
 * failure, never an empty list that the panel would present as "no
 * orders". The lines are a second read because a missing `order_items`
 * policy must not hide otherwise-readable orders; a failure there is
 * logged and the order still renders, with an empty line list rather than
 * invented product names.
 */
export async function fetchAllOrders(): Promise<Result<Order[]>> {
  if (!isSupabaseConfigured) {
    return fail(
      "PROVIDER_NOT_CONFIGURED",
      "שרת Supabase אינו מוגדר, ולכן לא ניתן לטעון הזמנות.",
    )
  }

  try {
    const client = requireSupabase()

    const { data, error } = await client
      .from("orders")
      .select(ORDER_COLUMNS)
      .order("created_at", { ascending: false })

    if (error) {
      return fail(
        "STORAGE",
        `לא ניתן לטעון את ההזמנות מהשרת: ${error.message}`,
      )
    }

    const rows = (data ?? []) as OrderRow[]
    if (rows.length === 0) return ok([])

    const orderIds = rows.map((row) => str(row.order_id)).filter(Boolean)
    const itemsByOrder = new Map<string, OrderItem[]>()

    const { data: itemData, error: itemError } = await client
      .from("order_items")
      .select(ITEM_COLUMNS)
      .in("order_id", orderIds)

    if (itemError) {
      /* Non-fatal: the order totals and statuses come from `orders` itself.
       * Surfaced in the console instead of being mistaken for an order with
       * no lines. */
      console.warn(
        "[supabase-orders] order items read refused:",
        itemError.message,
      )
    } else {
      for (const raw of (itemData ?? []) as OrderItemRow[]) {
        const item = toOrderItem(raw)
        const list = itemsByOrder.get(item.order_id) ?? []
        list.push(item)
        itemsByOrder.set(item.order_id, list)
      }
    }

    return ok(
      rows.map((row) =>
        toOrder(row, itemsByOrder.get(str(row.order_id)) ?? []),
      ),
    )
  } catch (err) {
    return fail(
      "STORAGE",
      err instanceof Error
        ? `לא ניתן לטעון את ההזמנות מהשרת: ${err.message}`
        : "שגיאת רשת בלתי צפויה בזמן טעינת ההזמנות.",
    )
  }
}
