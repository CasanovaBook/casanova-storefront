/* ─────────────────────────────────────────────────────────────
 * Revenue analytics.
 *
 * Every figure here is derived on demand from the order and refund
 * records. Nothing is pre-computed, cached in a record or duplicated
 * into a "totals" row, so historical revenue can never drift away
 * from the transactions that produced it — and it never depends on a
 * product's *current* price, only on the price stored on the order
 * line at purchase time.
 * ───────────────────────────────────────────────────────────── */

import type { Order, Product, Refund } from "../types"

export type RangePreset = "TODAY" | "WEEK" | "MONTH" | "QUARTER" | "YEAR" | "ALL" | "CUSTOM"

export interface DateRange {
  /** Inclusive lower bound; `null` means unbounded. */

  from: Date | null

  /** Inclusive upper bound; `null` means unbounded. */

  to: Date | null
}

export const RANGE_LABEL: Record<RangePreset, string> = {
  TODAY: "היום",

  WEEK: "7 ימים אחרונים",

  MONTH: "30 ימים אחרונים",

  QUARTER: "90 ימים אחרונים",

  YEAR: "12 חודשים אחרונים",

  ALL: "כל הזמנים",

  CUSTOM: "טווח מותאם",
}

function startOfDay(d: Date): Date {
  const x = new Date(d)

  x.setHours(0, 0, 0, 0)

  return x
}

export function presetRange(
  preset: RangePreset,
  custom?: { from?: string, to?: string },
): DateRange {
  const now = new Date()

  const days = (n: number) => {
    const from = startOfDay(now)

    from.setDate(from.getDate() - (n - 1))

    return from
  }

  switch (preset) {
    case "TODAY":
      return { from: startOfDay(now), to: null }

    case "WEEK":
      return { from: days(7), to: null }

    case "MONTH":
      return { from: days(30), to: null }

    case "QUARTER":
      return { from: days(90), to: null }

    case "YEAR": {
      const from = startOfDay(now)

      from.setFullYear(from.getFullYear() - 1)

      return { from, to: null }
    }

    case "CUSTOM": {
      const from = custom?.from ? startOfDay(new Date(custom.from)) : null

      const to = custom?.to ? endOfDay(new Date(custom.to)) : null

      return { from, to }
    }

    case "ALL":

    default:
      return { from: null, to: null }
  }
}

function endOfDay(d: Date): Date {
  const x = new Date(d)

  x.setHours(23, 59, 59, 999)

  return x
}

export function inRange(iso: string | undefined, range: DateRange): boolean {
  if (!iso) return false

  const t = new Date(iso).getTime()

  if (Number.isNaN(t)) return false

  if (range.from && t < range.from.getTime()) return false

  if (range.to && t > range.to.getTime()) return false

  return true
}

export interface ProductRevenue {
  product_id: string

  name: string

  product_type: Product["product_type"]

  units: number

  gross: number

  net: number

  orders: number
}

export interface DayRevenue {
  /** yyyy-mm-dd */

  date: string

  label: string

  revenue: number

  orders: number
}

export interface RevenueSummary {
  /** Sum of order subtotals before discounts, for paid orders in range. */

  gross: number

  discounts: number

  /** What customers actually paid. */

  net: number

  /** Money confirmed returned by the payment system in range. */

  refunded: number

  net_after_refunds: number

  order_count: number

  paid_order_count: number

  pending_order_count: number

  failed_order_count: number

  aov: number

  customer_count: number

  units_sold: number

  refund_request_count: number

  by_product: ProductRevenue[]

  by_book: ProductRevenue[]

  by_day: DayRevenue[]

  has_data: boolean
}

const EMPTY_SUMMARY: RevenueSummary = {
  gross: 0,

  discounts: 0,

  net: 0,

  refunded: 0,

  net_after_refunds: 0,

  order_count: 0,

  paid_order_count: 0,

  pending_order_count: 0,

  failed_order_count: 0,

  aov: 0,

  customer_count: 0,

  units_sold: 0,

  refund_request_count: 0,

  by_product: [],

  by_book: [],

  by_day: [],

  has_data: false,
}

/** An order counts towards revenue only once money actually moved. */

export function isRevenueBearing(order: Order): boolean {
  return (
    order.payment_status === "PAID" ||
    order.payment_status === "PARTIALLY_REFUNDED" ||
    order.payment_status === "REFUNDED"
  )
}

/** Date used to bucket an order into a period. */

export function orderRevenueDate(order: Order): string {
  return order.paid_at ?? order.created_at
}

export function computeRevenue(
  orders: Order[],

  refunds: Refund[],

  products: Product[],

  range: DateRange,
): RevenueSummary {
  const scoped = orders.filter((o) => inRange(orderRevenueDate(o), range))

  if (scoped.length === 0 && refunds.length === 0) return { ...EMPTY_SUMMARY }

  const paid = scoped.filter(isRevenueBearing)

  const gross = paid.reduce((sum, o) => sum + o.subtotal, 0)

  const discounts = paid.reduce((sum, o) => sum + o.discount_amount, 0)

  const net = paid.reduce((sum, o) => sum + o.total_amount, 0)

  // Only refunds the payment system confirmed are subtracted. Requests that

  // are still pending, rejected or failed never reduce reported revenue.

  const confirmedRefunds = refunds.filter(
    (r) =>
      r.status === "REFUNDED" &&
      inRange(r.processed_at ?? r.requested_at, range),
  )

  const refunded = confirmedRefunds.reduce((sum, r) => sum + r.amount, 0)

  const customers = new Set(
    paid.map((o) => o.user_id || o.customer_email.toLowerCase()),
  )

  const productType = new Map(
    products.map((p) => [p.product_id, p.product_type]),
  )

  const productName = new Map(products.map((p) => [p.product_id, p.name]))

  const agg = new Map<string, ProductRevenue>()

  let units = 0

  paid.forEach((o) => {
    o.items.forEach((item) => {
      units += item.quantity

      const existing =
        agg.get(item.product_id) ??
        {
          product_id: item.product_id,

          // Falls back to the purchase-time name so deleted products still report correctly.

          name: productName.get(item.product_id) ?? item.product_name,

          product_type: productType.get(item.product_id) ?? "DIGITAL_PRODUCT",

          units: 0,

          gross: 0,

          net: 0,

          orders: 0,
        } as ProductRevenue

      existing.units += item.quantity

      existing.gross += item.unit_price * item.quantity

      existing.net += item.line_total

      existing.orders += 1

      agg.set(item.product_id, existing)
    })
  })

  const byProduct = [...agg.values()].sort((a, b) => b.net - a.net)

  const byDay = bucketByDay(paid, range)

  const refundRequestsInRange = refunds.filter((r) =>
    inRange(r.requested_at, range),
  )

  return {
    gross,

    discounts,

    net,

    refunded,

    net_after_refunds: net - refunded,

    order_count: scoped.length,

    paid_order_count: paid.length,

    pending_order_count: scoped.filter((o) => o.payment_status === "PENDING")
      .length,

    failed_order_count: scoped.filter(
      (o) => o.payment_status === "FAILED" || o.order_status === "FAILED",
    ).length,

    aov: paid.length > 0 ? net / paid.length : 0,

    customer_count: customers.size,

    units_sold: units,

    refund_request_count: refundRequestsInRange.length,

    by_product: byProduct,

    by_book: byProduct.filter((p) => p.product_type === "EBOOK"),

    by_day: byDay,

    has_data: paid.length > 0 || refundRequestsInRange.length > 0,
  }
}

/** Builds a contiguous day series so charts never imply data that is absent. */

function bucketByDay(paid: Order[], range: DateRange): DayRevenue[] {
  if (paid.length === 0) return []

  const stamps = paid.map((o) =>
    startOfDay(new Date(orderRevenueDate(o))).getTime(),
  )

  const from = range.from
    ? startOfDay(range.from).getTime()
    : Math.min(...stamps)

  const lastStamp = Math.max(...stamps)

  const to =
    range.to && range.to.getTime() < lastStamp
      ? startOfDay(range.to).getTime()
      : lastStamp

  const dayMs = 86_400_000

  const span = Math.round((to - from) / dayMs) + 1

  // Cap the series so an "all time" range with one old order stays readable.

  const maxPoints = 60

  const step = span > maxPoints ? Math.ceil(span / maxPoints) : 1

  const buckets = new Map<number, { revenue: number, orders: number }>()

  paid.forEach((o) => {
    const key = startOfDay(new Date(orderRevenueDate(o))).getTime()

    const entry = buckets.get(key) ?? { revenue: 0, orders: 0 }

    entry.revenue += o.total_amount

    entry.orders += 1

    buckets.set(key, entry)
  })

  const out: DayRevenue[] = []

  for (let t = from; t <= to; t += step * dayMs) {
    let revenue = 0

    let orders = 0

    for (let s = 0; s < step; s += 1) {
      const entry = buckets.get(t + s * dayMs)

      if (entry) {
        revenue += entry.revenue

        orders += entry.orders
      }
    }

    const d = new Date(t)

    out.push({
      date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,

      label: d.toLocaleDateString("he-IL", { day: "numeric", month: "short" }),

      revenue,

      orders,
    })
  }

  return out
}

/** Lifetime totals, independent of any period filter. */

export function lifetimeTotals(
  orders: Order[],
  refunds: Refund[],
): { gross: number, net: number, refunded: number } {
  const paid = orders.filter(isRevenueBearing)

  const refunded = refunds
    .filter((r) => r.status === "REFUNDED")
    .reduce((s, r) => s + r.amount, 0)

  return {
    gross: paid.reduce((s, o) => s + o.subtotal, 0),

    net: paid.reduce((s, o) => s + o.total_amount, 0),

    refunded,
  }
}
