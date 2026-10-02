/* ─────────────────────────────────────────────────────────────
 * Supabase checkout service — the server-side half of a purchase.
 *
 * The browser cannot write `public.orders` or `public.user_products`
 * (RLS is row-level; a policy wide enough for a customer to insert
 * their own entitlement would let any client forge one), so a hosted
 * checkout goes through `public.create_storefront_order`
 * (migrations/0023_storefront_checkout_grant.sql). That one
 * transaction re-derives the price from `public.products`, records
 * the order, its line item and a captured manual payment, and writes
 * the buyer's `user_products` row — which is exactly what the
 * `get-content-url` edge function checks before it will sign the
 * book file. Without it a completed purchase produced a local order
 * that the reader could not open.
 *
 * The buyer is always `auth.uid()`: the caller cannot name another
 * account, and the price never comes from the request.
 *
 * Every function resolves; none rejects.
 * ───────────────────────────────────────────────────────────── */

import type {
  AccessStatus,
  AdminRole,
  Order,
  OrderItem,
  OrderStatus,
  PaymentStatus,
  Product,
  Role,
  User,
} from "../types"
import { fail, ok, type ErrorCode, type Result } from "./api"
import { isSupabaseConfigured, requireSupabase } from "./supabase"

export interface StorefrontCheckoutInput {
  product_id: string
  first_name: string
  last_name: string
  email: string
  phone?: string
  coupon_code?: string
  /** Client-evaluated coupon discount. The server clamps it to the subtotal. */
  discount: number
}

export interface StorefrontCheckoutResult {
  /** The order as Postgres stored it, mapped onto the app's Order shape. */
  order: Order
  /** The entitlement the server created (its real UUID). */
  user_product_id: string
  granted_at: string
  customer: User
}

/** Refusals raised by `create_storefront_order`, translated once. */
const CHECKOUT_REFUSALS: Record<string, { error: string; code: ErrorCode }> = {
  auth_required: {
    error: "יש להתחבר לחשבון כדי להשלים רכישה.",
    code: "UNAUTHENTICATED",
  },
  user_not_found: { error: "המשתמש לא נמצא.", code: "NOT_FOUND" },
  account_suspended: {
    error: "החשבון מושעה ולא ניתן להשלים רכישה. יש לפנות לתמיכה.",
    code: "FORBIDDEN",
  },
  product_not_found: { error: "המוצר לא נמצא.", code: "NOT_FOUND" },
  product_unavailable: {
    error: "המוצר אינו זמין לרכישה כרגע.",
    code: "CONFLICT",
  },
  name_required: { error: "יש למלא שם מלא.", code: "VALIDATION" },
  gateway_configured: {
    error:
      "סליקת התשלומים מוגדרת בשרת, ולכן ההזמנה ממתינה לאישור התשלום. הגישה תיפתח לאחר אישור.",
    code: "CONFLICT",
  },
}

function describeCheckoutRefusal(
  code: string,
  message: string,
): { error: string; code: ErrorCode } | null {
  for (const token of Object.keys(CHECKOUT_REFUSALS)) {
    if (message.includes(token)) return CHECKOUT_REFUSALS[token]
  }

  if (code === "42501") return CHECKOUT_REFUSALS.auth_required
  if (code === "P0002") return CHECKOUT_REFUSALS.product_not_found
  if (code === "22023") return CHECKOUT_REFUSALS.name_required

  /* Verbatim on purpose: "function … does not exist" is the one clue that
   * migration 0023 has not been applied yet. */
  return null
}

interface RpcRow {
  order?: Record<string, unknown>
  item?: Record<string, unknown>
  entitlement?: Record<string, unknown>
  customer?: Record<string, unknown>
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) return (value[0] as Record<string, unknown>) ?? null
  if (value && typeof value === "object") return value as Record<string, unknown>
  return null
}

const num = (value: unknown, fallback = 0) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

const str = (value: unknown, fallback = "") =>
  typeof value === "string" ? value : fallback

function toOrder(row: RpcRow, product: Product): Order {
  const o = row.order ?? {}
  const i = row.item ?? {}
  const orderId = str(o.order_id)
  const orderNumber = str(o.order_number)

  const item: OrderItem = {
    order_item_id: str(i.order_item_id),
    order_id: orderId,
    product_id: str(i.product_id, product.product_id),
    product_name: str(i.product_name, product.name),
    quantity: num(i.quantity, 1),
    unit_price: num(i.unit_price, product.price),
    discount_amount: num(i.discount_amount, 0),
    line_total: num(i.line_total, product.price),
  }

  return {
    order_id: orderId,
    order_number: orderNumber,
    user_id: str(o.user_id),
    order_status: (str(o.order_status, "PAID") as OrderStatus) || "PAID",
    payment_status: (str(o.payment_status, "PAID") as PaymentStatus) || "PAID",
    refund_status: "NONE",
    refunded_amount: 0,
    subtotal: num(o.subtotal, product.price),
    discount_amount: num(o.discount_amount, 0),
    total_amount: num(o.total_amount, product.price),
    currency: str(o.currency, product.currency),
    coupon_code: str(o.coupon_code) || undefined,
    payment_provider: "MANUAL",
    card_last4: undefined,
    customer_first_name: str(o.customer_first_name),
    customer_last_name: str(o.customer_last_name),
    customer_email: str(o.customer_email),
    customer_phone: str(o.customer_phone) || undefined,
    created_at: str(o.created_at),
    paid_at: str(o.paid_at) || undefined,
    items: [item],
  }
}

function toCustomer(row: RpcRow): User {
  const c = row.customer ?? {}
  return {
    user_id: str(c.user_id),
    first_name: str(c.first_name),
    last_name: str(c.last_name),
    email: str(c.email),
    phone: str(c.phone) || undefined,
    role: (str(c.role, "CUSTOMER") as Role) || "CUSTOMER",
    admin_role: (str(c.admin_role) as AdminRole) || undefined,
    account_status: "ACTIVE",
    created_at: "",
    updated_at: "",
  }
}

/**
 * Creates the order and the entitlement on the server, priced from
 * `public.products`, for the signed-in account.
 *
 * `product` is the catalogue row checkout already resolved; it is passed
 * through only so the returned order can be mapped with sane fallbacks —
 * the amounts stored in Postgres come from the product row the function
 * read itself, never from this client.
 */
export async function createStorefrontOrder(
  input: StorefrontCheckoutInput,
  product: Product,
): Promise<Result<StorefrontCheckoutResult>> {
  if (!isSupabaseConfigured) {
    return fail("PROVIDER_NOT_CONFIGURED", "שרת Supabase אינו מוגדר.")
  }

  try {
    const { data, error } = await requireSupabase().rpc(
      "create_storefront_order",
      {
        p_product_id: input.product_id,
        p_first_name: input.first_name,
        p_last_name: input.last_name,
        p_email: input.email,
        p_phone: input.phone ?? null,
        p_coupon_code: input.coupon_code ?? null,
        p_discount: input.discount,
      },
    )

    if (error) {
      const refused = describeCheckoutRefusal(
        error.code ?? "",
        error.message ?? "",
      )
      if (refused) return fail(refused.code, refused.error)
      return fail("STORAGE", error.message)
    }

    const row = asRecord(data) as RpcRow | null
    if (!row?.order) {
      return fail("STORAGE", "ההזמנה לא נוצרה בשרת.")
    }

    const entitlement = row.entitlement ?? {}

    return ok({
      order: toOrder(row, product),
      user_product_id: str(entitlement.user_product_id),
      granted_at: str(entitlement.granted_at),
      customer: toCustomer(row),
    })
  } catch (err) {
    return fail(
      "STORAGE",
      err instanceof Error ? err.message : "שגיאת רשת בלתי צפויה.",
    )
  }
}

/** The status a freshly created entitlement carries, re-exported so callers
 *  do not have to re-derive it. */
export const STOREFRONT_ENTITLEMENT_STATUS: AccessStatus = "ACTIVE"
