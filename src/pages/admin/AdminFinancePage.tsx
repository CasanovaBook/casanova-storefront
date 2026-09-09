import { useState } from "react"

import { useAdmin } from "../../context/AdminContext"

import { useCms } from "../../context/CmsContext"

import { can } from "../../lib/permissions"

import type { RefundRequestStatus } from "../../types"

import AccessDenied from "../../components/AccessDenied"

import Icon from "../../components/icons"

type Tab = "invoices" | "refunds" | "subscriptions" | "coupons"

const SUB_STATUS_LABEL: Record<string, {
  text: string
  color: string
  bg: string
}> = {
  ACTIVE: {
    text: "פעיל",
    color: "var(--color-success)",
    bg: "rgba(34,197,94,0.12)",
  },

  PAST_DUE: {
    text: "בפיגור",
    color: "var(--color-danger)",
    bg: "rgba(239,68,68,0.12)",
  },

  CANCELLED: { text: "בוטל", color: "#6B7280", bg: "rgba(107,114,128,0.12)" },

  TRIALING: { text: "ניסיון", color: "#38BDF8", bg: "rgba(56,189,248,0.12)" },
}

/** Full refund lifecycle — only REFUNDED means money actually went back. */

const REFUND_STEP: Record<RefundRequestStatus, { text: string, color: string }> =
  {
    REQUESTED: { text: "התקבלה בקשה", color: "#60A5FA" },

    PENDING: { text: "ממתין להחלטה", color: "#F59E0B" },

    APPROVED: { text: "אושר", color: "#38BDF8" },

    REJECTED: { text: "נדחה", color: "var(--color-danger)" },

    PROCESSING: { text: "בטיפול מול הספק", color: "#F59E0B" },

    REFUNDED: { text: "הוחזר בפועל", color: "var(--color-success)" },

    FAILED: { text: "נכשל", color: "var(--color-danger)" },
  }

const FALLBACK_COVER: [string, string] = ["#1A1A2E", "#2A2A3E"]

export default function AdminFinancePage() {
  const {
    orders,
    users,
    invoices,
    refunds,
    subscriptions,
    adminRole,
    cancelSubscription,
    lifetime,
  } = useAdmin()

  const { coupons, products } = useCms()

  const [tab, setTab] = useState<Tab>("invoices")

  const [refundFilter, setRefundFilter] = useState<"ALL" | RefundRequestStatus>(
    "ALL",
  )

  if (!can(adminRole, "finance")) return <AccessDenied page="כספים וחשבוניות" />

  const canManage = can(adminRole, "finance")

  // Only refunds the payment system confirmed reduce the reported totals.

  const totalInvoiced = invoices.reduce((s, inv) => s + inv.amount, 0)

  const totalRefunded = refunds
    .filter((r) => r.status === "REFUNDED")
    .reduce((s, r) => s + r.amount, 0)

  const pendingRefunds = refunds.filter(
    (r) =>
      r.status !== "REFUNDED" &&
      r.status !== "REJECTED" &&
      r.status !== "FAILED",
  )

  const activeSubs = subscriptions.filter((s) => s.status === "ACTIVE").length

  const visibleRefunds = refunds.filter(
    (r) => refundFilter === "ALL" || r.status === refundFilter,
  )

  const tabs: { id: Tab, label: string }[] = [
    { id: "invoices", label: `חשבוניות (${invoices.length})` },

    { id: "refunds", label: `החזרים (${refunds.length})` },

    { id: "subscriptions", label: `מנויים (${subscriptions.length})` },

    { id: "coupons", label: `קופונים (${coupons.length})` },
  ]

  return (
    <div className="max-w-5xl mx-auto page-enter">
      <div className="mb-8">
        <h1 className="font-display text-4xl font-semibold mb-1">
          כספים וחשבוניות
        </h1>
        <p style={{ color: "var(--color-muted-foreground)" }}>
          חשבוניות, החזרים כספיים, מנויים וקופונים — כל הכסף במקום אחד.
        </p>
      </div>

      {/* Summary strip — every figure derived from the recorded transactions */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {[
          {
            label: "הכנסות מאושרות (כל הזמנים)",
            value: `₪${Math.round(lifetime.net).toLocaleString()}`,
            color: "var(--color-primary)",
          },

          {
            label: "נטו אחרי החזרים",
            value: `₪${Math.round(lifetime.net - lifetime.refunded).toLocaleString()}`,
            color: "var(--color-success)",
          },

          {
            label: "הונפק בחשבוניות",
            value: `₪${Math.round(totalInvoiced).toLocaleString()}`,
            color: "var(--color-foreground)",
          },

          {
            label: "הוחזר בפועל ללקוחות",
            value: `₪${Math.round(totalRefunded).toLocaleString()}`,
            color: "var(--color-danger)",
          },
        ].map((s) => (
          <div key={s.label} className="card-glow p-4">
            <p
              className="text-xs mb-1"
              style={{ color: "var(--color-muted-foreground)" }}
            >
              {s.label}
            </p>
            <p
              className="font-display text-2xl font-semibold"
              style={{ color: s.color }}
            >
              {s.value}
            </p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
        {[
          {
            label: "מנויים פעילים",
            value: String(activeSubs),
            color: "var(--color-success)",
          },

          {
            label: "קופונים פעילים",
            value: String(coupons.filter((c) => c.status === "ACTIVE").length),
            color: "var(--color-foreground)",
          },

          {
            label: "בקשות החזר פתוחות",
            value: String(pendingRefunds.length),
            color:
              pendingRefunds.length > 0
                ? "#F59E0B"
                : "var(--color-muted-foreground)",
          },
        ].map((s) => (
          <div key={s.label} className="card-glow p-4">
            <p
              className="text-xs mb-1"
              style={{ color: "var(--color-muted-foreground)" }}
            >
              {s.label}
            </p>
            <p
              className="font-display text-2xl font-semibold"
              style={{ color: s.color }}
            >
              {s.value}
            </p>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-6 flex-wrap">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className="px-4 py-2 rounded-full text-xs font-medium border transition-all"
            style={{
              background: tab === t.id ? "var(--color-primary)" : "transparent",

              color:
                tab === t.id
                  ? "var(--color-primary-foreground)"
                  : "var(--color-muted-foreground)",

              borderColor:
                tab === t.id ? "var(--color-primary)" : "var(--color-border)",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Invoices */}
      {tab === "invoices" && (
        <div
          className="rounded-lg border overflow-hidden"
          style={{ borderColor: "var(--color-border)" }}
        >
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: "var(--color-secondary)" }}>
                {[
                  "מספר חשבונית",
                  "הזמנה",
                  "לקוח",
                  "סכום",
                  "תאריך הנפקה",
                  "סטטוס",
                ].map((col) => (
                  <th
                    key={col}
                    className="text-right px-5 py-3 text-xs tracking-wide"
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
              {invoices.map((inv, i) => {
                const order = orders.find((o) => o.order_id === inv.order_id)

                return (
                  <tr
                    key={inv.invoice_id}
                    style={{
                      background:
                        i % 2 === 0
                          ? "var(--color-card)"
                          : "var(--color-background)",
                      borderBottom: "1px solid var(--color-border)",
                    }}
                  >
                    <td className="px-5 py-3 font-mono text-xs" dir="ltr">
                      {inv.invoice_number}
                    </td>
                    <td
                      className="px-5 py-3 font-mono text-xs"
                      dir="ltr"
                      style={{ color: "var(--color-muted-foreground)" }}
                    >
                      {inv.order_id}
                    </td>
                    <td className="px-5 py-3">
                      {order
                        ? `${order.customer_first_name} ${order.customer_last_name}`
                        : "—"}
                    </td>
                    <td className="px-5 py-3 font-semibold">
                      ₪{inv.amount.toLocaleString()}
                    </td>
                    <td
                      className="px-5 py-3 text-xs"
                      style={{ color: "var(--color-muted-foreground)" }}
                    >
                      {new Date(inv.issued_at).toLocaleDateString("he-IL")}
                    </td>
                    <td
                      className="px-5 py-3 text-xs"
                      style={{ color: "var(--color-success)" }}
                    >
                      הונפקה
                    </td>
                  </tr>
                )
              })}
              {invoices.length === 0 && (
                <tr>
                  <td
                    colSpan={6}
                    className="text-center py-10"
                    style={{ color: "var(--color-muted-foreground)" }}
                  >
                    אין חשבוניות.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Refunds */}
      {tab === "refunds" && (
        <div className="space-y-3">
          <div className="flex gap-2 flex-wrap">
            {([
              "ALL",
              "REQUESTED",
              "PENDING",
              "APPROVED",
              "PROCESSING",
              "REFUNDED",
              "REJECTED",
              "FAILED",
            ] as const).map((s) => (
              <button
                key={s}
                onClick={() => setRefundFilter(s)}
                className="px-3 py-1.5 rounded-full text-xs font-medium border transition-all"
                style={{
                  background:
                    refundFilter === s ? "var(--color-primary)" : "transparent",

                  color:
                    refundFilter === s
                      ? "var(--color-primary-foreground)"
                      : "var(--color-muted-foreground)",

                  borderColor:
                    refundFilter === s
                      ? "var(--color-primary)"
                      : "var(--color-border)",
                }}
              >
                {s === "ALL" ? "הכול" : REFUND_STEP[s].text}
              </button>
            ))}
          </div>

          {refunds.length === 0 ? (
            <div
              className="card-glow p-10 text-center text-sm"
              style={{ color: "var(--color-muted-foreground)" }}
            >
              לא נמצאו החזרים.
            </div>
          ) : visibleRefunds.length === 0 ? (
            <div
              className="card-glow p-10 text-center text-sm"
              style={{ color: "var(--color-muted-foreground)" }}
            >
              אין החזרים בסטטוס שנבחר.
            </div>
          ) : (
            visibleRefunds.map((r) => {
              const order = orders.find((o) => o.order_id === r.order_id)

              const st = REFUND_STEP[r.status]

              return (
                <div
                  key={r.refund_id}
                  className="card-glow p-4 flex items-center justify-between gap-4 flex-wrap"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {order
                        ? `${order.customer_first_name} ${order.customer_last_name}`
                        : "לקוח לא מזוהה"}
                      <span
                        className="font-mono text-xs mr-2"
                        dir="ltr"
                        style={{ color: "var(--color-muted-foreground)" }}
                      >
                        {order?.order_number ?? r.order_id}
                      </span>
                    </p>
                    <p
                      className="text-xs mt-0.5"
                      style={{ color: "var(--color-muted-foreground)" }}
                    >
                      {r.reason} · יזם/ה: {r.initiated_by} ·{" "}
                      {new Date(r.requested_at).toLocaleDateString("he-IL")}
                      {r.processed_at
                        ? ` · הושלם ${new Date(r.processed_at).toLocaleDateString("he-IL")}`
                        : ""}
                    </p>
                    <p
                      className="text-[10px] mt-0.5"
                      style={{ color: "var(--color-muted-foreground)" }}
                    >
                      סכום מקורי: ₪{r.original_amount.toLocaleString()}
                      {r.provider ? ` · ספק: ${r.provider}` : ""}
                      {r.provider_refund_id
                        ? ` · מזהה החזר: ${r.provider_refund_id}`
                        : ""}
                      {order?.transaction_reference
                        ? ` · אסמכתת עסקה: ${order.transaction_reference}`
                        : ""}
                    </p>
                  </div>
                  <div className="text-left flex-shrink-0">
                    <p
                      className="font-semibold"
                      style={{
                        color:
                          r.status === "REFUNDED"
                            ? "var(--color-danger)"
                            : "var(--color-foreground)",
                      }}
                    >
                      −₪{r.amount.toLocaleString()}
                    </p>
                    <p className="text-xs" style={{ color: st.color }}>
                      {st.text}
                    </p>
                  </div>
                </div>
              )
            })
          )}

          <p
            className="text-xs flex items-start gap-1.5"
            style={{ color: "var(--color-muted-foreground)" }}
          >
            <Icon name="shield" size={12} className="flex-shrink-0 mt-0.5" />
            החזר מסומן כ"הוחזר בפועל" רק לאחר אישור ספק התשלומים. ניהול מעגל
            החיים המלא מתבצע במסך ההזמנות.
          </p>
        </div>
      )}

      {/* Subscriptions */}
      {tab === "subscriptions" && (
        <div className="space-y-3">
          {subscriptions.length === 0 && (
            <div
              className="card-glow p-10 text-center text-sm"
              style={{ color: "var(--color-muted-foreground)" }}
            >
              אין מנויים.
            </div>
          )}
          {subscriptions.map((sub) => {
            const owner = users.find((u) => u.user_id === sub.user_id)

            const product = products.find(
              (p) => p.product_id === sub.product_id,
            )

            const st = SUB_STATUS_LABEL[sub.status] ?? {
              text: sub.status,
              color: "var(--color-muted-foreground)",
              bg: "var(--color-secondary)",
            }

            const [from, to] = product?.cover_colors ?? FALLBACK_COVER

            return (
              <div key={sub.subscription_id} className="card-glow p-4">
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <div className="flex items-center gap-3 min-w-0">
                    {product?.image_url ? (
                      <img
                        src={product.image_url}
                        alt={product.name}
                        className="w-7 h-10 rounded flex-shrink-0 object-cover"
                      />
                    ) : product ? (
                      <div
                        className="w-7 h-10 rounded flex-shrink-0"
                        style={{
                          background: `linear-gradient(160deg, ${from}, ${to})`,
                        }}
                      />
                    ) : null}
                    <div className="min-w-0">
                      <p className="text-sm font-semibold">
                        {product?.name ?? sub.product_id}
                      </p>
                      <p
                        className="text-xs"
                        style={{ color: "var(--color-muted-foreground)" }}
                      >
                        {owner
                          ? `${owner.first_name} ${owner.last_name}`
                          : sub.user_id}{" "}
                        ·{" "}
                        {sub.billing_interval === "MONTHLY"
                          ? "חיוב חודשי"
                          : "חיוב שנתי"}{" "}
                        · החל מ־
                        {new Date(sub.start_date).toLocaleDateString("he-IL")}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <span
                      className="text-xs font-bold px-3 py-1 rounded-full"
                      style={{ background: st.bg, color: st.color }}
                    >
                      {st.text}
                    </span>
                    {sub.status !== "CANCELLED" ? (
                      <>
                        <span
                          className="text-xs"
                          style={{ color: "var(--color-muted-foreground)" }}
                        >
                          חיוב הבא:{" "}
                          {new Date(sub.next_billing_date).toLocaleDateString(
                            "he-IL",
                          )}
                        </span>
                        {canManage && (
                          <button
                            onClick={() =>
                              cancelSubscription(sub.subscription_id)
                            }
                            className="text-xs px-3 py-1.5 rounded-full border"
                            style={{
                              borderColor: "rgba(239,68,68,0.3)",
                              color: "var(--color-danger)",
                            }}
                          >
                            ביטול מנוי
                          </button>
                        )}
                      </>
                    ) : (
                      <span
                        className="text-xs"
                        style={{ color: "var(--color-muted-foreground)" }}
                      >
                        בוטל{" "}
                        {sub.cancelled_at
                          ? new Date(sub.cancelled_at).toLocaleDateString(
                              "he-IL",
                            )
                          : ""}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Coupons */}
      {tab === "coupons" && (
        <div
          className="rounded-lg border overflow-hidden"
          style={{ borderColor: "var(--color-border)" }}
        >
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: "var(--color-secondary)" }}>
                {[
                  "קוד",
                  "סוג הנחה",
                  "ערך",
                  "מינימום הזמנה",
                  "שימושים",
                  "תוקף",
                  "סטטוס",
                ].map((col) => (
                  <th
                    key={col}
                    className="text-right px-5 py-3 text-xs tracking-wide"
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
              {coupons.map((c, i) => (
                <tr
                  key={c.coupon_id}
                  style={{
                    background:
                      i % 2 === 0
                        ? "var(--color-card)"
                        : "var(--color-background)",
                    borderBottom: "1px solid var(--color-border)",
                  }}
                >
                  <td className="px-5 py-3 font-mono font-bold" dir="ltr">
                    {c.code}
                  </td>
                  <td className="px-5 py-3 text-xs">
                    {c.discount_type === "PERCENTAGE" ? "אחוזים" : "סכום קבוע"}
                  </td>
                  <td className="px-5 py-3 font-semibold">
                    {c.discount_type === "PERCENTAGE"
                      ? `${c.discount_value}%`
                      : `₪${c.discount_value.toLocaleString()}`}
                  </td>
                  <td className="px-5 py-3 text-xs">
                    ₪{c.minimum_order.toLocaleString()}
                  </td>
                  <td className="px-5 py-3 text-xs">
                    {c.times_used}
                    {c.usage_limit ? ` / ${c.usage_limit}` : ""}
                  </td>
                  <td
                    className="px-5 py-3 text-xs"
                    style={{ color: "var(--color-muted-foreground)" }}
                  >
                    {c.expires_at
                      ? new Date(c.expires_at).toLocaleDateString("he-IL")
                      : "ללא תוקף"}
                  </td>
                  <td className="px-5 py-3">
                    <span
                      className="text-xs"
                      style={{
                        color:
                          c.status === "ACTIVE"
                            ? "var(--color-success)"
                            : "var(--color-muted-foreground)",
                      }}
                    >
                      {c.status === "ACTIVE" ? "פעיל" : "לא פעיל"}
                    </span>
                  </td>
                </tr>
              ))}
              {coupons.length === 0 && (
                <tr>
                  <td
                    colSpan={7}
                    className="text-center py-10"
                    style={{ color: "var(--color-muted-foreground)" }}
                  >
                    אין קופונים. ניתן ליצור קופונים במסך ה־CMS.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <p
        className="mt-6 text-xs flex items-center gap-1.5"
        style={{ color: "var(--color-muted-foreground)" }}
      >
        <Icon name="shield" size={12} />
        פרטי כרטיסי אשראי מלאים, CVV ומפתחות סליקה אינם נגישים במערכת הניהול —
        רק אסמכתאות עסקה ו־4 ספרות אחרונות.
      </p>
    </div>
  )
}
