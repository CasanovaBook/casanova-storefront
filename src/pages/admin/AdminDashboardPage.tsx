import { useState } from "react"
import { Link } from "react-router"
import { useAdmin } from "../../context/AdminContext"
import { can } from "../../lib/permissions"
import { RANGE_LABEL, type RangePreset } from "../../lib/analytics"
import type { SystemAlert } from "../../types"
import Icon, { type IconName } from "../../components/icons"

function StatCard({
  label,
  value,
  sub,
  accent,
  icon,
}: {
  label: string
  value: string | number
  sub?: string
  accent?: boolean
  icon: IconName
}) {
  return (
    <div
      className="card-glow p-5"
      style={
        accent
          ? {
              background: "rgba(212,160,48,0.07)",
              borderColor: "rgba(212,160,48,0.3)",
            }
          : undefined
      }
    >
      <div
        className="w-9 h-9 rounded-lg flex items-center justify-center mb-3"
        style={{
          background: "rgba(227,174,60,0.12)",
          color: "var(--color-primary)",
        }}
      >
        <Icon name={icon} size={17} />
      </div>
      <p
        className="text-xs tracking-wider mb-1"
        style={{ color: "var(--color-muted-foreground)" }}
      >
        {label}
      </p>
      <p
        className="font-display text-3xl font-semibold mb-0.5"
        style={{
          color: accent ? "var(--color-primary)" : "var(--color-foreground)",
        }}
      >
        {value}
      </p>
      {sub && (
        <p
          className="text-xs"
          style={{ color: "var(--color-muted-foreground)" }}
        >
          {sub}
        </p>
      )}
    </div>
  )
}

/**
 * Revenue over time, drawn from the day buckets the analytics layer derives
 * from paid orders. When there is no data the chart says so instead of
 * rendering an empty axis that implies zero sales were measured.
 */
function RevenueChart({
  series,
}: {
  series: { label: string, revenue: number, orders: number }[]
}) {
  if (series.length === 0) {
    return (
      <p
        className="px-5 py-8 text-sm text-center"
        style={{ color: "var(--color-muted-foreground)" }}
      >
        אין נתוני הכנסה זמינים לטווח שנבחר.
      </p>
    )
  }
  const max = Math.max(...series.map((d) => d.revenue), 1)
  return (
    <div className="p-5">
      <div className="flex items-end gap-1 h-32">
        {series.map((d, i) => (
          <div
            key={`${d.label}-${i}`}
            className="flex-1 flex flex-col items-center justify-end gap-1 min-w-0"
          >
            <div
              className="w-full rounded-t transition-all"
              style={{
                height: `${Math.max((d.revenue / max) * 100, d.revenue > 0 ? 3 : 0)}%`,
                background:
                  d.revenue > 0
                    ? "linear-gradient(180deg, #E7B94C, #B8862A)"
                    : "var(--color-secondary)",
              }}
              title={`${d.label} — ₪${d.revenue.toLocaleString()} · ${d.orders} הזמנות`}
            />
          </div>
        ))}
      </div>
      <div
        className="flex justify-between mt-2 text-[10px]"
        style={{ color: "var(--color-muted-foreground)" }}
      >
        <span>{series[0].label}</span>
        <span>{series[series.length - 1].label}</span>
      </div>
    </div>
  )
}

const SEVERITY_COLOR: Record<SystemAlert["severity"], string> = {
  CRITICAL: "#EF4444",
  HIGH: "#F59E0B",
  MEDIUM: "#38BDF8",
  LOW: "#6B7280",
}

const SEVERITY_LABEL: Record<SystemAlert["severity"], string> = {
  CRITICAL: "קריטי",
  HIGH: "גבוה",
  MEDIUM: "בינוני",
  LOW: "נמוך",
}

const ORDER_STATUS_COLOR: Record<string, string> = {
  PAID: "var(--color-success)",
  PENDING: "#F59E0B",
  FAILED: "var(--color-danger)",
  REFUNDED: "#6B7280",
  CANCELLED: "#6B7280",
}

const ORDER_STATUS_LABEL: Record<string, string> = {
  PAID: "שולם",
  PENDING: "ממתין",
  FAILED: "נכשל",
  REFUNDED: "הוחזר",
  CANCELLED: "בוטל",
}

const RANGE_OPTIONS: RangePreset[] = [
  "TODAY",
  "WEEK",
  "MONTH",
  "QUARTER",
  "YEAR",
  "ALL",
]

export default function AdminDashboardPage() {
  const {
    users,
    orders,
    userProducts,
    subscriptions,
    openAlerts,
    adminRole,
    revenueFor,
    lifetime,
  } = useAdmin()
  const [preset, setPreset] = useState<RangePreset>("MONTH")

  /* Every figure below is derived on read from the order and refund records
   * for the selected period — no stored totals that could drift. */
  const rev = revenueFor(preset)

  const activeSubs = subscriptions.filter((s) => s.status === "ACTIVE")
  const pastDueSubs = subscriptions.filter((s) => s.status === "PAST_DUE")
  const activeAccessCount = userProducts.filter(
    (up) => up.access_status === "ACTIVE",
  ).length

  const topProducts = rev.by_product.slice(0, 5)
  const maxRevenue = topProducts[0]?.net ?? 1

  const recentOrders = [...orders]
    .sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    )
    .slice(0, 5)

  const recentUsers = [...users]
    .sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    )
    .slice(0, 4)

  const quickActions = ([
    {
      icon: "key",
      label: "הרשאות גישה",
      href: "/admin/access",
      perm: "access",
    },
    {
      icon: "box",
      label: "ניהול מוצרים ותוכן",
      href: "/admin/products",
      perm: "products",
    },
    {
      icon: "receipt",
      label: "הצגת כל ההזמנות",
      href: "/admin/orders",
      perm: "orders",
    },
    {
      icon: "money",
      label: "כספים וחשבוניות",
      href: "/admin/finance",
      perm: "finance",
    },
    {
      icon: "users",
      label: "ניהול משתמשים",
      href: "/admin/users",
      perm: "users",
    },
    {
      icon: "message",
      label: "פניות לקוחות",
      href: "/admin/support",
      perm: "support",
    },
    {
      icon: "layers",
      label: "CMS — סקטורים ותוכן",
      href: "/admin/cms",
      perm: "cms",
    },
  ] as {
    icon: IconName
    label: string
    href: string
    perm: Parameters<typeof can>[1]
  }[]).filter((a) => can(adminRole, a.perm))

  return (
    <div className="max-w-6xl mx-auto page-enter">
      <div className="mb-8 flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-4xl font-semibold mb-1">לוח בקרה</h1>
          <p style={{ color: "var(--color-muted-foreground)" }}>
            תמונת מצב מלאה של המערכת —{" "}
            {new Date().toLocaleDateString("he-IL", {
              weekday: "long",
              day: "numeric",
              month: "long",
              year: "numeric",
            })}
          </p>
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {RANGE_OPTIONS.map((p) => (
            <button
              key={p}
              onClick={() => setPreset(p)}
              className="px-3 py-1.5 rounded-full text-xs font-medium border transition-all"
              style={{
                background:
                  preset === p ? "var(--color-primary)" : "transparent",
                color:
                  preset === p
                    ? "var(--color-primary-foreground)"
                    : "var(--color-muted-foreground)",
                borderColor:
                  preset === p ? "var(--color-primary)" : "var(--color-border)",
              }}
            >
              {RANGE_LABEL[p]}
            </button>
          ))}
        </div>
      </div>

      {/* Key metrics — derived from transactions in the selected period */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
        <StatCard
          icon="money"
          label="הכנסה נטו"
          value={`₪${Math.round(rev.net_after_refunds).toLocaleString()}`}
          sub={
            rev.refunded > 0
              ? `אחר ניכוי ₪${Math.round(rev.refunded).toLocaleString()} החזרים`
              : "ללא החזרים בטווח"
          }
          accent
        />
        <StatCard
          icon="trendUp"
          label="מכירות ברוטו"
          value={`₪${Math.round(rev.gross).toLocaleString()}`}
          sub={`הנחות ₪${Math.round(rev.discounts).toLocaleString()}`}
        />
        <StatCard
          icon="receipt"
          label="הזמנות ששולמו"
          value={rev.paid_order_count}
          sub={`${rev.order_count} סה״כ בטווח`}
        />
        <StatCard
          icon="card"
          label="ממוצע הזמנה"
          value={`₪${Math.round(rev.aov).toLocaleString()}`}
          sub={`${rev.units_sold} יחידות נמכרו`}
        />
        <StatCard
          icon="users"
          label="לקוחות שרכשו"
          value={rev.customer_count}
          sub="ייחודיים בטווח"
        />
        <StatCard
          icon="refresh"
          label="החזרים"
          value={rev.refund_request_count}
          sub={
            rev.refunded > 0
              ? `₪${Math.round(rev.refunded).toLocaleString()} הוחזרו בפועל`
              : "אף החזר לא בוצע בפועל"
          }
        />
      </div>

      {!rev.has_data && (
        <div
          className="card-glow p-6 mb-6 text-center text-sm"
          style={{ color: "var(--color-muted-foreground)" }}
        >
          אין נתוני הכנסה זמינים לטווח {RANGE_LABEL[preset]}. סכומי כל הזמנים: ₪
          {Math.round(lifetime.net).toLocaleString()} ברוטו מתוכם ₪
          {Math.round(lifetime.refunded).toLocaleString()} הוחזרו.
        </div>
      )}

      {/* Revenue over time */}
      {can(adminRole, "finance") && (
        <div className="card-glow mb-6 overflow-hidden">
          <div
            className="px-5 py-4 border-b"
            style={{ borderColor: "var(--color-border)" }}
          >
            <h2 className="font-semibold text-sm">
              הכנסות לאורך זמן · {RANGE_LABEL[preset]}
            </h2>
          </div>
          <RevenueChart series={rev.by_day} />
        </div>
      )}

      {/* Issues requiring attention */}
      <div
        className="card-glow mb-8 overflow-hidden"
        style={
          openAlerts.length > 0
            ? { borderColor: "rgba(239,68,68,0.35)" }
            : undefined
        }
      >
        <div
          className="flex items-center justify-between px-5 py-4 border-b"
          style={{ borderColor: "var(--color-border)" }}
        >
          <h2 className="font-semibold text-sm flex items-center gap-2">
            <Icon
              name="zap"
              size={15}
              className="flex-shrink-0"
              style={{
                color:
                  openAlerts.length > 0 ? "#EF4444" : "var(--color-success)",
              }}
            />
            תקלות שדורשות טיפול ({openAlerts.length})
          </h2>
          {can(adminRole, "alerts") && (
            <Link
              to="/admin/alerts"
              className="text-xs hover:opacity-70"
              style={{ color: "var(--color-primary)" }}
            >
              לכל ההתראות ←
            </Link>
          )}
        </div>
        {openAlerts.length === 0 ? (
          <p
            className="px-5 py-6 text-sm text-center"
            style={{ color: "var(--color-muted-foreground)" }}
          >
            הכול תקין — אין תקלות פתוחות כרגע.
          </p>
        ) : (
          <div
            className="divide-y"
            style={{ borderColor: "var(--color-border)" }}
          >
            {openAlerts.slice(0, 5).map((alert) => (
              <div
                key={alert.alert_id}
                className="flex items-center gap-3 px-5 py-3"
              >
                <span
                  className="text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0"
                  style={{
                    background: `${SEVERITY_COLOR[alert.severity]}22`,
                    color: SEVERITY_COLOR[alert.severity],
                  }}
                >
                  {SEVERITY_LABEL[alert.severity]}
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{alert.title}</p>
                  <p
                    className="text-xs truncate"
                    style={{ color: "var(--color-muted-foreground)" }}
                  >
                    {alert.description}
                  </p>
                </div>
              </div>
            ))}
            {openAlerts.length > 5 && (
              <p
                className="px-5 py-2.5 text-xs text-center"
                style={{ color: "var(--color-muted-foreground)" }}
              >
                + {openAlerts.length - 5} תקלות נוספות
              </p>
            )}
          </div>
        )}
      </div>

      <div className="grid md:grid-cols-[1fr_320px] gap-6">
        <div className="space-y-6">
          {/* Top products */}
          <div className="card-glow overflow-hidden">
            <div
              className="px-5 py-4 border-b"
              style={{ borderColor: "var(--color-border)" }}
            >
              <h2 className="font-semibold text-sm">
                מוצרים מובילים · {RANGE_LABEL[preset]}
              </h2>
            </div>
            {topProducts.length === 0 ? (
              <p
                className="px-5 py-6 text-sm text-center"
                style={{ color: "var(--color-muted-foreground)" }}
              >
                אין מכירות בטווח שנבחר.
              </p>
            ) : (
              <div className="p-5 space-y-4">
                {topProducts.map((p, i) => (
                  <div key={p.product_id} className="flex items-center gap-3">
                    <span
                      className="text-xs font-bold w-4 text-center flex-shrink-0"
                      style={{ color: "var(--color-muted-foreground)" }}
                    >
                      {i + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-sm font-medium truncate">{p.name}</p>
                        <p
                          className="text-xs font-semibold flex-shrink-0"
                          style={{ color: "var(--color-primary)" }}
                        >
                          ₪{Math.round(p.net).toLocaleString()} · {p.units} יח׳
                        </p>
                      </div>
                      <div
                        className="h-1.5 rounded-full overflow-hidden"
                        style={{ background: "var(--color-secondary)" }}
                      >
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${(p.net / maxRevenue) * 100}%`,
                            background:
                              "linear-gradient(90deg, #E7B94C, #B8862A)",
                          }}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Recent orders */}
          <div className="card-glow overflow-hidden">
            <div
              className="flex items-center justify-between px-5 py-4 border-b"
              style={{ borderColor: "var(--color-border)" }}
            >
              <h2 className="font-semibold text-sm">הזמנות אחרונות</h2>
              {can(adminRole, "orders") && (
                <Link
                  to="/admin/orders"
                  className="text-xs hover:opacity-70"
                  style={{ color: "var(--color-primary)" }}
                >
                  להצגת הכול ←
                </Link>
              )}
            </div>
            {recentOrders.length === 0 ? (
              <p
                className="px-5 py-6 text-sm text-center"
                style={{ color: "var(--color-muted-foreground)" }}
              >
                אין עדיין הזמנות.
              </p>
            ) : (
              <div
                className="divide-y"
                style={{ borderColor: "var(--color-border)" }}
              >
                {recentOrders.map((order) => (
                  <div
                    key={order.order_id}
                    className="flex items-center justify-between px-5 py-3"
                  >
                    <div>
                      <p className="text-sm font-medium">
                        {order.customer_first_name} {order.customer_last_name}
                      </p>
                      <p
                        className="text-xs font-mono"
                        dir="ltr"
                        style={{ color: "var(--color-muted-foreground)" }}
                      >
                        {order.order_number}
                      </p>
                    </div>
                    <div className="text-left">
                      <p className="text-sm font-semibold">
                        ₪{order.total_amount.toLocaleString()}
                      </p>
                      <span
                        className="text-xs"
                        style={{
                          color: ORDER_STATUS_COLOR[order.order_status],
                        }}
                      >
                        {ORDER_STATUS_LABEL[order.order_status] ??
                          order.order_status}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div>
          {/* Recent users */}
          <div className="card-glow mb-4 overflow-hidden">
            <div
              className="flex items-center justify-between px-5 py-4 border-b"
              style={{ borderColor: "var(--color-border)" }}
            >
              <h2 className="font-semibold text-sm">משתמשים אחרונים</h2>
              {can(adminRole, "users") && (
                <Link
                  to="/admin/users"
                  className="text-xs hover:opacity-70"
                  style={{ color: "var(--color-primary)" }}
                >
                  להצגת הכול ←
                </Link>
              )}
            </div>
            {recentUsers.length === 0 ? (
              <p
                className="px-5 py-6 text-sm text-center"
                style={{ color: "var(--color-muted-foreground)" }}
              >
                אין עדיין משתמשים רשומים.
              </p>
            ) : (
              <div
                className="divide-y"
                style={{ borderColor: "var(--color-border)" }}
              >
                {recentUsers.map((u) => (
                  <div
                    key={u.user_id}
                    className="flex items-center gap-3 px-5 py-3"
                  >
                    <div
                      className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                      style={{
                        background: "rgba(212,160,48,0.12)",
                        color: "var(--color-primary)",
                      }}
                    >
                      {u.first_name.charAt(0)}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">
                        {u.first_name} {u.last_name}
                      </p>
                      <p
                        className="text-xs truncate"
                        dir="ltr"
                        style={{ color: "var(--color-muted-foreground)" }}
                      >
                        {u.email}
                      </p>
                    </div>
                    <span
                      className="text-xs mr-auto flex-shrink-0"
                      style={{
                        color:
                          u.account_status === "ACTIVE"
                            ? "var(--color-success)"
                            : "var(--color-danger)",
                      }}
                    >
                      {u.account_status === "ACTIVE" ? "פעיל" : "מושעה"}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Subscriptions snapshot */}
          <div className="card-glow mb-4 p-5">
            <h2 className="font-semibold text-sm mb-3">מנויים</h2>
            <div className="space-y-2 text-sm">
              {([
                {
                  label: "פעילים",
                  value: activeSubs.length,
                  color: "var(--color-success)",
                },
                {
                  label: "בפיגור תשלום",
                  value: pastDueSubs.length,
                  color:
                    pastDueSubs.length > 0
                      ? "var(--color-danger)"
                      : "var(--color-muted-foreground)",
                },
                {
                  label: "מבוטלים",
                  value: subscriptions.filter((s) => s.status === "CANCELLED")
                    .length,
                  color: "var(--color-muted-foreground)",
                },
                {
                  label: "הרשאות גישה פעילות",
                  value: activeAccessCount,
                  color: "var(--color-muted-foreground)",
                },
              ] as const).map((row) => (
                <div
                  key={row.label}
                  className="flex items-center justify-between"
                >
                  <span style={{ color: "var(--color-muted-foreground)" }}>
                    {row.label}
                  </span>
                  <span className="font-semibold" style={{ color: row.color }}>
                    {row.value}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Quick actions */}
          {quickActions.length > 0 && (
            <div className="card-glow p-5">
              <h2 className="font-semibold text-sm mb-4">פעולות מהירות</h2>
              <div className="space-y-2">
                {quickActions.map(({ icon, label, href }) => (
                  <Link
                    key={href}
                    to={href}
                    className="flex items-center justify-between text-sm px-3 py-2 rounded-lg border transition-colors hover:bg-white/5"
                    style={{
                      borderColor: "var(--color-border)",
                      color: "var(--color-foreground)",
                    }}
                  >
                    <span className="flex items-center gap-2.5">
                      <span
                        className="w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0"
                        style={{
                          background: "rgba(227,174,60,0.12)",
                          color: "var(--color-primary)",
                        }}
                      >
                        <Icon name={icon} size={14} />
                      </span>
                      {label}
                    </span>
                    <span style={{ color: "var(--color-muted-foreground)" }}>
                      ←
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
