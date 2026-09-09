/* ─────────────────────────────────────────────────────────────
 * Service layer — orders, payments, refunds, invoices, subscriptions.
 *
 * Two rules shape this module:
 *
 *  1. Money is never invented. With a payment gateway configured an order
 *     only counts as paid when the provider confirms it (`markOrderPaid`,
 *     the hook a gateway webhook calls). While NO gateway is connected
 *     there is nothing to wait for, so `checkout` auto-approves: the order
 *     becomes PAID and access is granted immediately.
 *  2. A refund is never marked as returned unless the payment system
 *     confirms it. Recording, approving and rejecting requests always
 *     works; `executeRefund` / `confirmRefund` are refused until a
 *     provider that supports programmatic refunds is configured.
 * ───────────────────────────────────────────────────────────── */

import type {
  Invoice,
  Order,
  OrderItem,
  Payment,
  Product,
  Refund,
  RefundRequestStatus,
  User,
} from "../types"

import { effectivePrice } from "../types"

import { getDb, mutate, nextSequence, nowIso, uid, type Database } from "./db"

import { normalizeEmail, isEmail, toPublicUser } from "./auth"

import {
  dispatchEmail,
  fail,
  findCoupon,
  findOrCreateCustomer,
  guard,
  ok,
  redeemCoupon,
  writeAudit,
  type Actor,
  type Result,
} from "./api"

import { grantAccessForOrder } from "./api-support"

/* ── Reads ────────────────────────────────────────────── */

export function listOrders(actor: Actor | null): Result<Order[]> {
  const denied = guard(actor, "orders")

  if (denied) return denied

  return ok(
    [...getDb().orders].sort((a, b) =>
      b.created_at.localeCompare(a.created_at),
    ),
  )
}

export function getOrder(actor: Actor | null, orderId: string): Result<Order> {
  const denied = guard(actor, "orders")

  if (denied) return denied

  const order = getDb().orders.find((o) => o.order_id === orderId)

  if (!order) return fail("NOT_FOUND", "ההזמנה לא נמצאה.")

  return ok(order)
}

/** A customer may only ever see their own orders. */

export function listOrdersForUser(actor: Actor | null): Order[] {
  if (!actor) return []

  return getDb()

    .orders.filter((o) => o.user_id === actor.user_id)

    .sort((a, b) => b.created_at.localeCompare(a.created_at))
}

export function listPayments(actor: Actor | null): Result<Payment[]> {
  const denied = guard(actor, "finance")

  if (denied) return denied

  return ok(getDb().payments)
}

/* ── Checkout ─────────────────────────────────────────── */

export interface CheckoutInput {
  product_id: string

  first_name: string

  last_name: string

  email: string

  phone?: string

  coupon_code?: string

  card_last4?: string
}

export interface CheckoutOutcome {
  order: Order

  /** True once money is captured — either auto-approved (no gateway connected)
   *  or confirmed by a provider. False only while an order awaits confirmation. */

  payment_confirmed: boolean

  /** True when checkout finalized the order itself because no payment gateway
   *  is connected: the order is PAID and the customer's access was granted. */

  auto_approved: boolean

  /** The account the order belongs to (created on the fly for a guest), so the
   *  caller can sign a first-time buyer straight in and let them read at once. */

  customer: User
}

export async function checkout(
  input: CheckoutInput,
): Promise<Result<CheckoutOutcome>> {
  const db = getDb()

  const product = db.products.find((p) => p.product_id === input.product_id)

  if (!product) return fail("NOT_FOUND", "המוצר לא נמצא.")

  if (product.status !== "ACTIVE" || product.visibility === "HIDDEN") {
    return fail("CONFLICT", "המוצר אינו זמין לרכישה כרגע.")
  }

  if (product.availability === "OUT_OF_STOCK")
    return fail("CONFLICT", "המוצר אזל מהמלאי.")

  if (!input.first_name.trim() || !input.last_name.trim())
    return fail("VALIDATION", "יש למלא שם מלא.")

  const email = normalizeEmail(input.email)

  if (!isEmail(email)) return fail("VALIDATION", "כתובת המייל אינה תקינה.")

  const unitPrice = effectivePrice(product)

  const subtotal = unitPrice

  const couponCode = input.coupon_code?.trim().toUpperCase() || undefined

  const coupon = couponCode ? findCoupon(couponCode) : undefined

  let discount = 0

  if (couponCode && !coupon)
    return fail("VALIDATION", "קוד הקופון אינו תקף או שפג תוקפו.")

  if (coupon) {
    if (subtotal < coupon.minimum_order) {
      return fail(
        "VALIDATION",
        `הקופון תקף להזמנות החל מ־₪${coupon.minimum_order.toLocaleString()}.`,
      )
    }

    discount =
      coupon.discount_type === "PERCENTAGE"
        ? Math.round(subtotal * (coupon.discount_value / 100) * 100) / 100
        : Math.min(coupon.discount_value, subtotal)
  }

  const total = Math.max(0, Math.round((subtotal - discount) * 100) / 100)

  const customer = await findOrCreateCustomer({
    first_name: input.first_name.trim(),

    last_name: input.last_name.trim(),

    email,

    phone: input.phone?.trim() || undefined,
  })

  if (!customer.ok) return customer

  const provider = db.settings.payment_provider

  const stockBefore = product.inventory

  const order = mutate((d) => {
    const year = new Date().getFullYear()

    const orderId = uid("ord")

    const orderNumber = `${d.settings.order_prefix}-${year}-${String(nextSequence(d, "order")).padStart(4, "0")}`

    const item: OrderItem = {
      order_item_id: uid("oit"),

      order_id: orderId,

      product_id: product.product_id,

      // Purchase-time snapshot: later edits or archival of the product

      // can never rewrite what this customer actually bought.

      product_name: product.name,

      quantity: 1,

      unit_price: unitPrice,

      discount_amount: discount,

      line_total: total,
    }

    const created: Order = {
      order_id: orderId,

      order_number: orderNumber,

      user_id: customer.data.user_id,

      order_status: "PENDING",

      payment_status: "PENDING",

      refund_status: "NONE",

      refunded_amount: 0,

      subtotal,

      discount_amount: discount,

      total_amount: total,

      currency: product.currency,

      coupon_code: coupon ? coupon.code : undefined,

      payment_provider: provider ?? "MANUAL",

      card_last4: input.card_last4?.replace(/\D/g, "").slice(-4) || undefined,

      customer_first_name: input.first_name.trim(),

      customer_last_name: input.last_name.trim(),

      customer_email: email,

      customer_phone: input.phone?.trim() || undefined,

      created_at: nowIso(),

      items: [item],
    }

    const payment: Payment = {
      payment_id: uid("pay"),

      order_id: orderId,

      provider: provider ?? "MANUAL",

      status: "PENDING",

      amount: total,

      currency: product.currency,

      card_last4: created.card_last4,

      created_at: nowIso(),
    }

    d.orders = [created, ...d.orders]

    d.payments = [payment, ...d.payments]

    if (typeof stockBefore === "number") {
      d.products = d.products.map((p) =>
        p.product_id === product.product_id
          ? { ...p, inventory: Math.max(0, stockBefore - 1) }
          : p,
      )
    }

    return created
  })

  if (coupon) redeemCoupon(coupon.code)

  dispatchEmail({
    recipient: order.customer_email,

    recipient_name: `${order.customer_first_name} ${order.customer_last_name}`,

    template: "ORDER_RECEIVED",

    subject: `ההזמנה ${order.order_number} התקבלה`,

    related_type: "ORDER",

    related_id: order.order_id,
  })

  const customerUser = toPublicUser(customer.data)

  // No payment gateway is connected, so there is no money to capture and

  // nothing to wait for: every checkout is approved on the spot. The order

  // becomes PAID and the customer's access is granted immediately. Once

  // settings.payment_provider is set this branch is skipped and the order

  // stays PENDING for the gateway webhook / an admin to confirm.

  if (!provider) {
    const paid = applyPaidState(order, {
      transaction_reference: `AUTO-${order.order_number}`,
    })

    grantAccessForOrder(paid, db.products)

    dispatchEmail({
      recipient: paid.customer_email,

      recipient_name: `${paid.customer_first_name} ${paid.customer_last_name}`,

      template: "ORDER_PAID",

      subject: `התשלום עבור הזמנה ${paid.order_number} אושר — הגישה נפתחה`,

      related_type: "ORDER",

      related_id: paid.order_id,
    })

    return ok({
      order: paid,
      payment_confirmed: true,
      auto_approved: true,
      customer: customerUser,
    })
  }

  return ok({
    order,
    payment_confirmed: Boolean(provider),
    auto_approved: false,
    customer: customerUser,
  })
}

/* ── Order lifecycle ──────────────────────────────────── */

function issueInvoiceDraft(db: Database, order: Order): Invoice {
  const year = new Date(order.paid_at ?? order.created_at).getFullYear()

  const invoice: Invoice = {
    invoice_id: uid("inv"),

    order_id: order.order_id,

    invoice_number: `${db.settings.invoice_prefix}-${year}-${String(nextSequence(db, "invoice")).padStart(4, "0")}`,

    amount: order.total_amount,

    currency: order.currency,

    issued_at: nowIso(),

    status: "ISSUED",
  }

  db.invoices = [...db.invoices, invoice]

  return invoice
}

export interface ConfirmPaymentInput {
  provider?: string

  transaction_reference?: string

  card_last4?: string

  note?: string
}

/**
 * Flips an existing order to PAID, captures its pending payment and issues an
 * invoice draft. Shared by the admin `markOrderPaid` action and by checkout's
 * auto-approval path; callers add the audit trail and email with the right
 * actor and template.
 */

function applyPaidState(order: Order, patch: Partial<Order> = {}): Order {
  return mutate((d) => {
    const next: Order = {
      ...order,

      order_status: "PAID",

      payment_status: "PAID",

      paid_at: nowIso(),

      ...patch,
    }

    d.orders = d.orders.map((o) => (o.order_id === order.order_id ? next : o))

    d.payments = d.payments.map((p) =>
      p.order_id === order.order_id && p.status === "PENDING"
        ? {
            ...p,

            status: "CAPTURED",

            provider: next.payment_provider ?? p.provider,

            transaction_reference: next.transaction_reference,

            card_last4: next.card_last4,
          }
        : p,
    )

    if (!d.invoices.some((inv) => inv.order_id === order.order_id))
      issueInvoiceDraft(d, next)

    return next
  })
}

/**
 * Confirms that money for an order was actually captured. This is the
 * single place an admin marks an order PAID, and the hook a gateway
 * webhook will call.
 */

export function markOrderPaid(
  actor: Actor | null,
  orderId: string,
  input: ConfirmPaymentInput = {},
): Result<Order> {
  const denied = guard(actor, "mark_paid")

  if (denied) return denied

  const db = getDb()

  const order = db.orders.find((o) => o.order_id === orderId)

  if (!order) return fail("NOT_FOUND", "ההזמנה לא נמצאה.")

  if (order.payment_status === "PAID")
    return fail("CONFLICT", "ההזמנה כבר סומנה כשולמה.")

  if (order.order_status === "CANCELLED")
    return fail("CONFLICT", "לא ניתן לאשר תשלום עבור הזמנה שבוטלה.")

  const updated = applyPaidState(order, {
    payment_provider: input.provider ?? order.payment_provider,

    transaction_reference:
      input.transaction_reference ?? order.transaction_reference,

    card_last4: input.card_last4 ?? order.card_last4,
  })

  grantAccessForOrder(updated, db.products)

  dispatchEmail({
    recipient: updated.customer_email,

    recipient_name: `${updated.customer_first_name} ${updated.customer_last_name}`,

    template: "ORDER_PAID",

    subject: `התשלום עבור הזמנה ${updated.order_number} אושר — הגישה נפתחה`,

    related_type: "ORDER",

    related_id: updated.order_id,
  })

  writeAudit(actor, {
    category: "ORDER_CHANGE",

    action: "אישור תשלום",

    target_type: "ORDER",

    target_id: orderId,

    target_label: `${updated.order_number} · ${updated.customer_first_name} ${updated.customer_last_name}`,

    details:
      `₪${updated.total_amount.toLocaleString()} · ${updated.payment_provider ?? "—"}` +
      (input.transaction_reference ? ` · ${input.transaction_reference}` : "") +
      (input.note ? ` · ${input.note}` : ""),
  })

  return ok(updated)
}

export function markOrderFailed(
  actor: Actor | null,
  orderId: string,
  reason: string,
): Result<Order> {
  const denied = guard(actor, "mark_paid")

  if (denied) return denied

  const order = getDb().orders.find((o) => o.order_id === orderId)

  if (!order) return fail("NOT_FOUND", "ההזמנה לא נמצאה.")

  if (order.payment_status === "PAID")
    return fail(
      "CONFLICT",
      "לא ניתן לסמן הזמנה ששולמה ככושלת — יש להשתמש בהחזר כספי.",
    )

  const updated = mutate((d) => {
    const next: Order = {
      ...order,
      order_status: "FAILED",
      payment_status: "FAILED",
    }

    d.orders = d.orders.map((o) => (o.order_id === orderId ? next : o))

    d.payments = d.payments.map((p) =>
      p.order_id === orderId && p.status === "PENDING"
        ? { ...p, status: "FAILED", failure_reason: reason }
        : p,
    )

    return next
  })

  writeAudit(actor, {
    category: "ORDER_CHANGE",

    action: "סימון תשלום ככושל",

    target_type: "ORDER",

    target_id: orderId,

    target_label: order.order_number,

    details: reason,
  })

  return ok(updated)
}

export function cancelOrder(
  actor: Actor | null,
  orderId: string,
  reason?: string,
): Result<Order> {
  const denied = guard(actor, "edit_order")

  if (denied) return denied

  const order = getDb().orders.find((o) => o.order_id === orderId)

  if (!order) return fail("NOT_FOUND", "ההזמנה לא נמצאה.")

  if (order.payment_status === "PAID")
    return fail("CONFLICT", "הזמנה ששולמה לא ניתנת לביטול — יש לבצע החזר כספי.")

  const updated = mutate((d) => {
    const next: Order = {
      ...order,
      order_status: "CANCELLED",
      payment_status: "CANCELLED",
    }

    d.orders = d.orders.map((o) => (o.order_id === orderId ? next : o))

    return next
  })

  writeAudit(actor, {
    category: "ORDER_CHANGE",

    action: "ביטול הזמנה",

    target_type: "ORDER",

    target_id: orderId,

    target_label: order.order_number,

    details: reason ?? "—",
  })

  return ok(updated)
}

/* ── Invoices ─────────────────────────────────────────── */

export function listInvoices(actor: Actor | null): Result<Invoice[]> {
  const denied = guard(actor, "finance")

  if (denied) return denied

  return ok(getDb().invoices)
}

export function issueInvoice(
  actor: Actor | null,
  orderId: string,
): Result<Invoice> {
  const denied = guard(actor, "finance")

  if (denied) return denied

  const db = getDb()

  const order = db.orders.find((o) => o.order_id === orderId)

  if (!order) return fail("NOT_FOUND", "ההזמנה לא נמצאה.")

  const existing = db.invoices.find((inv) => inv.order_id === orderId)

  if (existing)
    return fail(
      "CONFLICT",
      `כבר הונפקה חשבונית ${existing.invoice_number} להזמנה זו.`,
    )

  const invoice = mutate((d) => issueInvoiceDraft(d, order))

  writeAudit(actor, {
    category: "OTHER",

    action: "הנפקת חשבונית",

    target_type: "INVOICE",

    target_id: orderId,

    target_label: `${order.order_number} · ${order.customer_email}`,

    details: invoice.invoice_number,
  })

  return ok(invoice)
}

export function invoiceForOrder(orderId: string): Invoice | undefined {
  return getDb().invoices.find((inv) => inv.order_id === orderId)
}

/* ── Refunds ──────────────────────────────────────────── */

export const REFUND_STATUS_LABEL: Record<RefundRequestStatus, string> = {
  REQUESTED: "התקבלה בקשה",

  PENDING: "ממתין",

  APPROVED: "אושר",

  REJECTED: "נדחה",

  PROCESSING: "בביצוע",

  REFUNDED: "הוחזר",

  FAILED: "נכשל",
}

export function listRefunds(actor: Actor | null): Result<Refund[]> {
  const denied = guard(actor, "finance")

  if (denied) return denied

  return ok(
    [...getDb().refunds].sort((a, b) =>
      b.requested_at.localeCompare(a.requested_at),
    ),
  )
}

/** Amount still available to refund on an order. */

export function refundableAmount(order: Order): number {
  const confirmed = getDb()

    .refunds.filter(
      (r) =>
        r.order_id === order.order_id &&
        (r.status === "REFUNDED" || r.status === "PROCESSING"),
    )

    .reduce((sum, r) => sum + r.amount, 0)

  return Math.max(0, Math.round((order.total_amount - confirmed) * 100) / 100)
}

/** Step 1: record a request. No money moves and the order stays paid. */

export function requestRefund(
  actor: Actor | null,
  orderId: string,
  amount: number,
  reason: string,
): Result<Refund> {
  const denied = guard(actor, "refund")

  if (denied) return denied

  const db = getDb()

  const order = db.orders.find((o) => o.order_id === orderId)

  if (!order) return fail("NOT_FOUND", "ההזמנה לא נמצאה.")

  if (
    order.payment_status !== "PAID" &&
    order.payment_status !== "PARTIALLY_REFUNDED"
  ) {
    return fail("CONFLICT", "ניתן לבקש החזר רק עבור הזמנה שהתשלום בה אושר.")
  }

  if (!Number.isFinite(amount) || amount <= 0)
    return fail("VALIDATION", "סכום ההחזר חייב להיות חיובי.")

  const available = refundableAmount(order)

  if (amount > available) {
    return fail(
      "VALIDATION",
      `הסכום המבוקש חורג מהיתרה להחזר (₪${available.toLocaleString()}).`,
    )
  }

  if (!reason.trim()) return fail("VALIDATION", "יש לציין סיבה להחזר.")

  const payment = db.payments.find(
    (p) => p.order_id === orderId && p.status === "CAPTURED",
  )

  const refund = mutate((d) => {
    const created: Refund = {
      refund_id: uid("ref"),

      order_id: orderId,

      payment_id: payment?.payment_id,

      original_amount: order.total_amount,

      amount,

      currency: order.currency,

      reason: reason.trim(),

      status: "REQUESTED",

      provider: order.payment_provider,

      requested_at: nowIso(),

      initiated_by: actor?.name ?? "מערכת",

      initiated_by_id: actor?.user_id,
    }

    d.refunds = [created, ...d.refunds]

    if (order.refund_status === "NONE") {
      d.orders = d.orders.map((o) =>
        o.order_id === orderId ? { ...o, refund_status: "REQUESTED" } : o,
      )
    }

    return created
  })

  writeAudit(actor, {
    category: "REFUND",

    action: "רישום בקשת החזר כספי",

    target_type: "ORDER",

    target_id: orderId,

    target_label: `${order.order_number} · ${order.customer_first_name} ${order.customer_last_name}`,

    details: `₪${amount.toLocaleString()} מתוך ₪${order.total_amount.toLocaleString()} · ${reason.trim()}`,
  })

  return ok(refund)
}

export function reviewRefund(
  actor: Actor | null,

  refundId: string,

  decision: "APPROVED" | "REJECTED",

  note?: string,
): Result<Refund> {
  const denied = guard(actor, "refund")

  if (denied) return denied

  const refund = getDb().refunds.find((r) => r.refund_id === refundId)

  if (!refund) return fail("NOT_FOUND", "בקשת ההחזר לא נמצאה.")

  if (
    refund.status !== "REQUESTED" &&
    refund.status !== "PENDING" &&
    refund.status !== "FAILED"
  ) {
    return fail(
      "CONFLICT",
      `לא ניתן לקבל החלטה על בקשה בסטטוס "${REFUND_STATUS_LABEL[refund.status]}".`,
    )
  }

  const updated = mutate((db) => {
    const next: Refund = {
      ...refund,

      status: decision,

      reviewed_at: nowIso(),

      reviewed_by: actor?.name,

      review_note: note?.trim() || undefined,
    }

    db.refunds = db.refunds.map((r) => (r.refund_id === refundId ? next : r))

    return next
  })

  writeAudit(actor, {
    category: "REFUND",

    action: decision === "APPROVED" ? "אישור בקשת החזר" : "דחיית בקשת החזר",

    target_type: "REFUND",

    target_id: refundId,

    target_label: refund.order_id,

    details: `₪${refund.amount.toLocaleString()}${note ? ` · ${note}` : ""}`,
  })

  return ok(updated)
}

/**
 * Step 2: actually return the money. Refused unless a payment provider
 * that supports programmatic refunds is configured — recording a request
 * is never the same as refunding it.
 */

export function executeRefund(
  actor: Actor | null,
  refundId: string,
): Result<Refund> {
  const denied = guard(actor, "execute_refund")

  if (denied) return denied

  const db = getDb()

  if (!db.settings.refund_execution_enabled || !db.settings.payment_provider) {
    return fail(
      "PROVIDER_NOT_CONFIGURED",

      "ביצוע החזר בפועל דורש חיבור לספק תשלומים שתומך בהחזרים. כרגע ניתן לרשום, לאשר או לדחות בקשות בלבד — הכסף לא הוחזר.",
    )
  }

  const refund = db.refunds.find((r) => r.refund_id === refundId)

  if (!refund) return fail("NOT_FOUND", "בקשת ההחזר לא נמצאה.")

  if (refund.status !== "APPROVED") {
    return fail("CONFLICT", "ניתן להוציא לפועל רק בקשה שאושרה.")
  }

  const updated = mutate((d) => {
    const next: Refund = {
      ...refund,
      status: "PROCESSING",
      provider: d.settings.payment_provider ?? refund.provider,
    }

    d.refunds = d.refunds.map((r) => (r.refund_id === refundId ? next : r))

    return next
  })

  writeAudit(actor, {
    category: "REFUND",

    action: "שליחת החזר לספק התשלומים",

    target_type: "REFUND",

    target_id: refundId,

    target_label: refund.order_id,

    details: `₪${refund.amount.toLocaleString()} · ${updated.provider}`,
  })

  return ok(updated)
}

/**
 * Step 3: the provider confirmed the money moved. Only here does the
 * order become refunded and only here is revenue reduced.
 */

export function confirmRefund(
  actor: Actor | null,
  refundId: string,
  providerRefundId: string,
): Result<Refund> {
  const denied = guard(actor, "execute_refund")

  if (denied) return denied

  const db = getDb()

  if (!db.settings.refund_execution_enabled) {
    return fail(
      "PROVIDER_NOT_CONFIGURED",
      "לא ניתן לאשר החזר כהושלם ללא אינטגרציה מול ספק התשלומים.",
    )
  }

  if (!providerRefundId.trim())
    return fail("VALIDATION", "יש להזין את מזהה ההחזר שהתקבל מספק התשלומים.")

  const refund = db.refunds.find((r) => r.refund_id === refundId)

  if (!refund) return fail("NOT_FOUND", "בקשת ההחזר לא נמצאה.")

  if (refund.status !== "PROCESSING" && refund.status !== "APPROVED") {
    return fail("CONFLICT", "לא ניתן לאשר החזר שלא נשלח לספק.")
  }

  const updated = mutate((d) => {
    const next: Refund = {
      ...refund,

      status: "REFUNDED",

      provider_refund_id: providerRefundId.trim(),

      processed_at: nowIso(),

      reviewed_at: refund.reviewed_at ?? nowIso(),

      reviewed_by: refund.reviewed_by ?? actor?.name,
    }

    d.refunds = d.refunds.map((r) => (r.refund_id === refundId ? next : r))

    d.orders = d.orders.map((o) => {
      if (o.order_id !== refund.order_id) return o

      const refunded =
        Math.round((o.refunded_amount + refund.amount) * 100) / 100

      const full = refunded >= o.total_amount

      return {
        ...o,

        refunded_amount: refunded,

        refund_status: full ? "FULL" : "PARTIAL",

        payment_status: full ? "REFUNDED" : "PARTIALLY_REFUNDED",

        order_status: full ? "REFUNDED" : o.order_status,
      }
    })

    return next
  })

  const order = getDb().orders.find((o) => o.order_id === refund.order_id)

  if (order) {
    dispatchEmail({
      recipient: order.customer_email,

      recipient_name: `${order.customer_first_name} ${order.customer_last_name}`,

      template: "REFUND_COMPLETED",

      subject: `ההחזר הכספי עבור הזמנה ${order.order_number} בוצע`,

      related_type: "REFUND",

      related_id: refund.refund_id,
    })
  }

  writeAudit(actor, {
    category: "REFUND",

    action: "החזר כספי אושר על ידי ספק התשלומים",

    target_type: "REFUND",

    target_id: refundId,

    target_label: order?.order_number ?? refund.order_id,

    details: `₪${refund.amount.toLocaleString()} · מזהה ספק ${updated.provider_refund_id}`,
  })

  return ok(updated)
}

export function failRefund(
  actor: Actor | null,
  refundId: string,
  note: string,
): Result<Refund> {
  const denied = guard(actor, "refund")

  if (denied) return denied

  const refund = getDb().refunds.find((r) => r.refund_id === refundId)

  if (!refund) return fail("NOT_FOUND", "בקשת ההחזר לא נמצאה.")

  if (refund.status === "REFUNDED")
    return fail("CONFLICT", "החזר שכבר בוצע לא ניתן לסימון ככושל.")

  if (!note.trim()) return fail("VALIDATION", "יש לתעד את סיבת הכישלון.")

  const updated = mutate((db) => {
    const next: Refund = {
      ...refund,
      status: "FAILED",
      review_note: note.trim(),
      reviewed_at: nowIso(),
      reviewed_by: actor?.name,
    }

    db.refunds = db.refunds.map((r) => (r.refund_id === refundId ? next : r))

    return next
  })

  writeAudit(actor, {
    category: "REFUND",

    action: "החזר כספי נכשל",

    target_type: "REFUND",

    target_id: refundId,

    target_label: refund.order_id,

    details: note.trim(),
  })

  return ok(updated)
}

/* ── Subscriptions ────────────────────────────────────── */

export function listSubscriptions(actor: Actor | null) {
  const denied = guard(actor, "finance")

  if (denied) return denied

  return ok(getDb().subscriptions)
}

export function cancelSubscription(
  actor: Actor | null,
  subscriptionId: string,
): Result {
  const denied = guard(actor, "finance")

  if (denied) return denied

  const sub = getDb().subscriptions.find(
    (s) => s.subscription_id === subscriptionId,
  )

  if (!sub) return fail("NOT_FOUND", "המנוי לא נמצא.")

  mutate((db) => {
    db.subscriptions = db.subscriptions.map((s) =>
      s.subscription_id === subscriptionId
        ? { ...s, status: "CANCELLED", cancelled_at: nowIso() }
        : s,
    )
  })

  writeAudit(actor, {
    category: "OTHER",

    action: "ביטול מנוי",

    target_type: "SUBSCRIPTION",

    target_id: subscriptionId,

    target_label: sub.user_id,

    details: "המנוי בוטל על ידי מנהל",
  })

  return ok(undefined)
}

/* ── Catalog helper re-export used by the orders UI ───── */

export function productLookup(): Map<string, Product> {
  return new Map(getDb().products.map((p) => [p.product_id, p]))
}

export { effectivePrice }
