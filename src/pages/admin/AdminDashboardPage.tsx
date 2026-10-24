import { useState } from "react"
import { Link } from "react-router"
import { useAdmin } from "../../context/AdminContext"
import { formatIsraelDateTime } from "../../lib/datetime"
import { can } from "../../lib/permissions"
import { RANGE_LABEL, type RangePreset } from "../../lib/analytics"
import type { SystemAlert } from "../../types"
import Icon, { type IconName } from "../../components/icons"
import PageHeader from "../../components/ui/PageHeader"
import Alert from "../../components/ui/Alert"

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
      className="app-surface p-4 sm:p-5 min-w-0"
      style={
        accent
          ? {
              background:
                "color-mix(in srgb, var(--color-primary) 5%, var(--color-card))",
              borderColor:
                "color-mix(in srgb, var(--color-primary) 30%, var(--color-border))",
            }
          : undefined
      }
    >
      <div className="flex items-center justify-between gap-2 mb-3">
        <span
          className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{
            background:
              "color-mix(in srgb, var(--color-primary) 12%, transparent)",
            color: "var(--color-primary)",
          }}
          aria-hidden="true"
        >
          <Icon name={icon} size={17} />
        </span>
        {accent && (
          <span className="app-badge app-badge--accent">נטו</span>
        )}
      </div>
      <p className="text-xs font-semibold app-muted mb-1">{label}</p>
      <p
        className="font-display text-2xl sm:text-3xl font-semibold mb-0.5"
        style={{
          color: accent ? "var(--color-primary)" : "var(--color-foreground)",
        }}
      >
        {value}
      </p>
      {sub && (
        <p className="text-xs app-muted leading-relaxed">{sub}</p>
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
      <p className="px-5 py-8 text-sm text-center app-muted">
        אין נתוני הכנסה זמינים לטווח שנבחר.
      </p>
    )
  }
  const max = Math.max(...series.map((d) => d.revenue), 1)
  return (
    <div className="p-5">
      <div className="flex items-end gap-1 h-32" role="img" aria-label="הכנסות לפי יום בטווח שנבחר">
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
                    ? "linear-gradient(180deg, var(--color-primary), color-mix(in srgb, var(--color-primary) 55%, var(--color-foreground)))"
                    : "var(--color-secondary)",
              }}
              title={`${d.label} - ₪${d.revenue.toLocaleString()} · ${d.orders} הזמנות`}
            />
          </div>
        ))}
      </div>
      <div className="flex justify-between mt-2 text-[10px] app-muted">
        <span>{series[0].label}</span>
        <span>{series[series.length - 1].label}</span>
      </div>
    </div>
  )
}

const SEVERITY_BADGE: Record<SystemAlert["severity"], string> = {
  CRITICAL: "app-badge--danger",
  HIGH: "app-badge--warning",
  MEDIUM: "app-badge--neutral",
  LOW: "app-badge--neutral",
}

const SEVERITY_LABEL: Record<SystemAlert["severity"], string> = {
  CRITICAL: "קריטי",
  HIGH: "גבוה",
  MEDIUM: "בינוני",
  LOW: "נמוך",
}

const ORDER_STATUS_BADGE: Record<string, string> = {
  PAID: "app-badge--success",
  PENDING: "app-badge--warning",
  FAILED: "app-badge--danger",
  REFUNDED: "app-badge--neutral",
  CANCELLED: "app-badge--neutral",
}

const ORDER_STATUS_LABEL: Record<string, string> = {
  PAID: "שולם",
  PENDING: "ממתין",
  FAILED: "נכשל",
  REFUNDED: "הוחזר",
  CANCELLED: "בוטל",
}

/**
 * Avatar initial / display name for a user row.
 *
 * Mirrors the helpers in AdminUsersPage, and for the same reason: a
 * Supabase-backed account may carry no first name, and `charAt` on an
 * empty string would leave the avatar blank. Both pages must render a
 * user identically, so the fallback is not cosmetic.
 */
function initialOf(u: { first_name: string, email: string }): string {
  return u.first_name.charAt(0) || u.email.charAt(0) || "?"
}

function nameOf(u: { first_name: string, last_name: string, email: string }): string {
  const full = `${u.first_name} ${u.last_name}`.trim()
  return full || u.email
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
   * for the selected period - no stored totals that could drift. */
  const rev = revenueFor(preset)

  const activeSubs = subscriptions.filter((s) => s.status === "ACTIVE")
  const pastDueSubs = subscriptions.filter((s) => s.status === "PAST_DUE")
  const activeAccessCount = userProducts.filter(
    (up) => up.access_status === "ACTIVE",
  ).length

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
  ] as {
    icon: IconName
    label: string
    href: string
    perm: Parameters<typeof can>[1]
  }[]).filter((a) => can(adminRole, a.perm))

  return (
    <div className="page-enter">
      <PageHeader
        eyebrow="ניהול · תמונת מצב"
        title="לוח בקרה"
        description={`תמונת מצב מלאה של המערכת - ${new Date().toLocaleDateString(
          "he-IL",
          {
            weekday: "long",
            day: "numeric",
            month: "long",
            year: "numeric",
          },
        )}`}
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs app-muted">טווח:</span>
            <div
              role="group"
              aria-label="טווח תאריכים"
              className="flex flex-wrap gap-1.5"
            >
              {RANGE_OPTIONS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPreset(p)}
                  aria-pressed={preset === p}
                  className={preset === p ? "app-btn" : "app-btn-secondary"}
                  style={{
                    minHeight: "2.2rem",
                    padding: "0.35rem 0.8rem",
                    fontSize: "0.75rem",
                  }}
                >
                  {RANGE_LABEL[p]}
                </button>
              ))}
            </div>
          </div>
        }
      />

      {/* Key metrics - derived from transactions in the selected period */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4 mb-6">
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
        <div className="mb-6">
          <Alert tone="warning">
            אין נתוני הכנסה זמינים לטווח {RANGE_LABEL[preset]}. סכומי כל הזמנים:
            ₪{Math.round(lifetime.net).toLocaleString()} ברוטו מתוכם ₪
            {Math.round(lifetime.refunded).toLocaleString()} הוחזרו.
          </Alert>
        </div>
      )}

      {/* Revenue over time */}
      {can(adminRole, "finance") && (
        <section className="app-surface mb-6" aria-labelledby="revenue-title">
          <div className="app-surface-head">
            <h2 id="revenue-title" className="app-section-title">
              הכנסות לאורך זמן · {RANGE_LABEL[preset]}
            </h2>
          </div>
          <RevenueChart series={rev.by_day} />
        </section>
      )}

      {/* Issues requiring attention */}
      <section
        className="app-surface mb-6"
        aria-labelledby="alerts-title"
        style={
          openAlerts.length > 0
            ? {
                borderColor:
                  "color-mix(in srgb, var(--color-danger) 35%, var(--color-border))",
              }
            : undefined
        }
      >
        <div className="app-surface-head">
          <h2
            id="alerts-title"
            className="app-section-title flex items-center gap-2"
          >
            <Icon
              name="zap"
              size={15}
              className="flex-shrink-0"
              style={{
                color:
                  openAlerts.length > 0
                    ? "var(--color-danger)"
                    : "var(--color-success)",
              }}
            />
            תקלות שדורשות טיפול ({openAlerts.length})
          </h2>
          {can(adminRole, "alerts") && (
            <Link
              to="/admin/alerts"
              className="app-btn-ghost"
              style={{ minHeight: "2.2rem", padding: "0.35rem 0.8rem" }}
            >
              לכל ההתראות ←
            </Link>
          )}
        </div>
        {openAlerts.length === 0 ? (
          <div className="app-surface-body flex items-center justify-center gap-2 py-6 text-sm app-muted">
            <Icon
              name="checkCircle"
              size={16}
              style={{ color: "var(--color-success)" }}
            />
            הכול תקין - אין תקלות פתוחות כרגע.
          </div>
        ) : (
          <div className="divide-y" style={{ borderColor: "var(--color-border)" }}>
            {openAlerts.slice(0, 5).map((alert) => (
              <div
                key={alert.alert_id}
                className="flex items-center gap-3 px-5 py-3"
              >
                <span
                  className={`app-badge ${SEVERITY_BADGE[alert.severity]} flex-shrink-0`}
                >
                  {SEVERITY_LABEL[alert.severity]}
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{alert.title}</p>
                  <p className="text-xs app-muted truncate">
                    {alert.description}
                  </p>
                </div>
              </div>
            ))}
            {openAlerts.length > 5 && (
              <p className="px-5 py-2.5 text-xs text-center app-muted">
                + {openAlerts.length - 5} תקלות נוספות
              </p>
            )}
          </div>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-6 min-w-0">
          {/* Recent orders */}
          <section className="app-surface" aria-labelledby="recent-orders-title">
            <div className="app-surface-head">
              <h2 id="recent-orders-title" className="app-section-title">
                הזמנות אחרונות
              </h2>
              {can(adminRole, "orders") && (
                <Link
                  to="/admin/orders"
                  className="app-btn-ghost"
                  style={{ minHeight: "2.2rem", padding: "0.35rem 0.8rem" }}
                >
                  להצגת הכול ←
                </Link>
              )}
            </div>
            {recentOrders.length === 0 ? (
              <p className="px-5 py-6 text-sm text-center app-muted">
                אין עדיין הזמנות.
              </p>
            ) : (
              <div className="divide-y" style={{ borderColor: "var(--color-border)" }}>
                {recentOrders.map((order) => (
                  <div
                    key={order.order_id}
                    className="flex items-center justify-between gap-3 px-5 py-3"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">
                        {order.customer_first_name} {order.customer_last_name}
                      </p>
                      <p className="text-xs font-mono app-muted" dir="ltr">
                        {order.order_number}
                      </p>
                    </div>
                    <div className="text-left flex-shrink-0">
                      <p className="text-sm font-semibold">
                        ₪{order.total_amount.toLocaleString()}
                      </p>
                      <span
                        className={`app-badge ${
                          ORDER_STATUS_BADGE[order.order_status] ??
                          "app-badge--neutral"
                        }`}
                      >
                        {ORDER_STATUS_LABEL[order.order_status] ??
                          order.order_status}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        <div className="space-y-4 min-w-0">
          {/* Recent users */}
          <section className="app-surface" aria-labelledby="recent-users-title">
            <div className="app-surface-head">
              <h2 id="recent-users-title" className="app-section-title">
                משתמשים אחרונים
              </h2>
              {can(adminRole, "users") && (
                <Link
                  to="/admin/users"
                  className="app-btn-ghost"
                  style={{ minHeight: "2.2rem", padding: "0.35rem 0.8rem" }}
                >
                  להצגת הכול ←
                </Link>
              )}
            </div>
            {recentUsers.length === 0 ? (
              <p className="px-5 py-6 text-sm text-center app-muted">
                אין עדיין משתמשים רשומים.
              </p>
            ) : (
              <div className="divide-y" style={{ borderColor: "var(--color-border)" }}>
                {recentUsers.map((u) => (
                  <div
                    key={u.user_id}
                    className="flex items-center gap-3 px-5 py-3"
                  >
                    <div
                      className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                      style={{
                        background:
                          "color-mix(in srgb, var(--color-primary) 12%, transparent)",
                        color: "var(--color-primary)",
                      }}
                    >
                      {initialOf(u)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">
                        {nameOf(u)}
                      </p>
                      <p className="text-xs truncate app-muted" dir="ltr">
                        {u.email}
                      </p>
                      <p className="text-xs truncate app-muted">
                        התחברות אחרונה:{" "}
                        {formatIsraelDateTime(u.last_login_at) || "מעולם"}
                      </p>
                    </div>
                    <span
                      className={`app-badge ${
                        u.account_status === "ACTIVE"
                          ? "app-badge--success"
                          : "app-badge--danger"
                      } flex-shrink-0`}
                    >
                      {u.account_status === "ACTIVE" ? "פעיל" : "מושעה"}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Subscriptions snapshot */}
          <section className="app-surface" aria-labelledby="subscriptions-title">
            <div className="app-surface-head">
              <h2 id="subscriptions-title" className="app-section-title">
                מנויים
              </h2>
            </div>
            <div className="app-surface-body space-y-2 text-sm">
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
                  className="flex items-center justify-between gap-3"
                >
                  <span className="app-muted">{row.label}</span>
                  <span className="font-semibold" style={{ color: row.color }}>
                    {row.value}
                  </span>
                </div>
              ))}
            </div>
          </section>

          {/* Quick actions */}
          {quickActions.length > 0 && (
            <section className="app-surface" aria-labelledby="quick-actions-title">
              <div className="app-surface-head">
                <h2 id="quick-actions-title" className="app-section-title">
                  פעולות מהירות
                </h2>
              </div>
              <div className="app-surface-body space-y-2">
                {quickActions.map(({ icon, label, href }) => (
                  <Link
                    key={href}
                    to={href}
                    className="flex items-center justify-between gap-2 text-sm px-3 py-2 rounded-lg border transition-colors hover:bg-[var(--color-muted)] focus-visible:outline-2 focus-visible:outline-[var(--color-primary)]"
                    style={{
                      borderColor: "var(--color-border)",
                      color: "var(--color-foreground)",
                    }}
                  >
                    <span className="flex items-center gap-2.5 min-w-0">
                      <span
                        className="w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0"
                        style={{
                          background:
                            "color-mix(in srgb, var(--color-primary) 12%, transparent)",
                          color: "var(--color-primary)",
                        }}
                      >
                        <Icon name={icon} size={14} />
                      </span>
                      <span className="truncate">{label}</span>
                    </span>
                    <span className="app-muted flex-shrink-0" aria-hidden="true">
                      ←
                    </span>
                  </Link>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  )
}
