import { useState } from "react"

import { Link } from "react-router"

import { useAdmin } from "../../context/AdminContext"

import { can } from "../../lib/permissions"

import type { SystemAlert } from "../../types"

import AccessDenied from "../../components/AccessDenied"

import Alert from "../../components/ui/Alert"

import EmptyState from "../../components/ui/EmptyState"

import PageHeader from "../../components/ui/PageHeader"

import Icon from "../../components/icons"

const SEVERITY_META: Record<
  SystemAlert["severity"],
  { label: string; color: string; badge: string }
> = {
  CRITICAL: {
    label: "קריטי",
    color: "var(--color-danger)",
    badge: "app-badge--danger",
  },

  HIGH: {
    label: "גבוה",
    color: "var(--color-primary)",
    badge: "app-badge--warning",
  },

  MEDIUM: {
    label: "בינוני",
    color: "var(--color-foreground)",
    badge: "app-badge--neutral",
  },

  LOW: {
    label: "נמוך",
    color: "var(--color-muted-foreground)",
    badge: "app-badge--neutral",
  },
}

const TYPE_LINK: Record<
  SystemAlert["related_type"],
  {
    href: string
    label: string
  }
> = {
  ORDER: { href: "/admin/orders", label: "מעבר להזמנות" },

  USER: { href: "/admin/users", label: "מעבר למשתמשים" },

  EMAIL: { href: "/admin/emails", label: "מעבר למיילים" },

  INVOICE: { href: "/admin/orders", label: "הנפקה מתוך ההזמנה" },

  ACCESS: { href: "/admin/access", label: "מעבר להרשאות גישה" },

  SUBSCRIPTION: { href: "/admin/finance", label: "מעבר למנויים" },

  REFUND: { href: "/admin/finance", label: "טיפול בהחזר" },

  INQUIRY: { href: "/admin/support", label: "מעבר לפניות לקוחות" },

  SETTINGS: { href: "/admin/settings", label: "מעבר להגדרות המערכת" },
}

export default function AdminAlertsPage() {
  const { alerts, openAlerts, dismissedAlerts, dismissAlert, adminRole } =
    useAdmin()

  const [showDismissed, setShowDismissed] = useState(false)

  const [feedback, setFeedback] = useState("")

  if (!can(adminRole, "alerts")) return <AccessDenied page="התראות ותקלות" />

  const visible = showDismissed ? alerts : openAlerts

  const countBySeverity = (sev: SystemAlert["severity"]) =>
    openAlerts.filter((a) => a.severity === sev).length

  const handleDismiss = (alertId: string) => {
    const result = dismissAlert(alertId)

    setFeedback(result.ok ? "" : result.error)
  }

  return (
    <div className="page-enter">
      <PageHeader
        eyebrow="בקרה"
        title="התראות ותקלות"
        description="המערכת סורקת באופן שוטף אי־התאמות: תשלום ללא גישה, חשבונית חסרה, מיילים שנכשלו, מנויים בפיגור ועוד."
        actions={
          dismissedAlerts.length > 0 ? (
            <button
              type="button"
              onClick={() => setShowDismissed((v) => !v)}
              className="app-btn-secondary"
              aria-pressed={showDismissed}
            >
              <Icon name={showDismissed ? "eye" : "list"} size={14} />
              {showDismissed
                ? "הצגת פתוחות בלבד"
                : `הצגת הכול (${dismissedAlerts.length} טופלו)`}
            </button>
          ) : undefined
        }
      />

      {feedback && (
        <div className="mb-4">
          <Alert tone="error">
            <div className="flex items-start justify-between gap-3">
              <span>{feedback}</span>
              <button
                type="button"
                onClick={() => setFeedback("")}
                aria-label="סגירת הודעה"
                className="app-icon-btn"
                style={{ width: "1.75rem", height: "1.75rem", minHeight: "1.75rem" }}
              >
                <Icon name="x" size={13} />
              </button>
            </div>
          </Alert>
        </div>
      )}

      <section aria-label="סיכום התראות לפי חומרה" className="mb-6">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {(Object.keys(SEVERITY_META) as SystemAlert["severity"][]).map(
            (sev) => {
              const meta = SEVERITY_META[sev]

              return (
                <div key={sev} className="app-surface p-4">
                  <p
                    className="font-display text-3xl font-semibold leading-none tabular-nums"
                    style={{ color: meta.color }}
                  >
                    {countBySeverity(sev)}
                  </p>
                  <span className={`app-badge ${meta.badge} mt-3`}>
                    {meta.label}
                  </span>
                </div>
              )
            },
          )}
        </div>
      </section>

      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
        <h2 className="app-section-title">
          {showDismissed
            ? `כל ההתראות (${alerts.length})`
            : `התראות פתוחות (${openAlerts.length})`}
        </h2>
      </div>

      {visible.length === 0 ? (
        <EmptyState
          icon="checkCircle"
          title="הכול תקין"
          description="אין תקלות פתוחות הדורשות טיפול."
        />
      ) : (
        <div className="space-y-3">
          {visible.map((alert) => {
            const meta = SEVERITY_META[alert.severity]

            const dismissed = dismissedAlerts.includes(alert.alert_id)

            const link = TYPE_LINK[alert.related_type]

            return (
              <article
                key={alert.alert_id}
                className="app-surface p-4 sm:p-5"
                style={{ borderInlineStart: `3px solid ${meta.color}` }}
              >
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`app-badge ${meta.badge}`}>
                        {meta.label}
                      </span>
                      <span className="app-badge app-badge--neutral">
                        {alert.related_type}
                      </span>
                      <span
                        className="font-mono text-[10px] app-muted"
                        dir="ltr"
                        style={{ overflowWrap: "anywhere" }}
                      >
                        {alert.related_id}
                      </span>
                      {dismissed && (
                        <span className="app-badge app-badge--success">
                          טופל
                        </span>
                      )}
                    </div>
                    <h3 className="font-semibold text-sm mt-2.5">
                      {alert.title}
                    </h3>
                    <p className="text-sm app-muted mt-1 leading-relaxed">
                      {alert.description}
                    </p>
                    <p className="text-xs app-muted mt-2">
                      זוהה בתאריך:{" "}
                      {new Date(alert.created_at).toLocaleString("he-IL")}
                    </p>
                  </div>

                  {!dismissed && (
                    <div className="flex flex-wrap gap-2 sm:flex-col sm:flex-none flex-shrink-0">
                      <Link
                        to={link.href}
                        className="app-btn-secondary flex-1 sm:flex-none"
                        style={{
                          minHeight: "2.35rem",
                          padding: "0.45rem 0.95rem",
                          fontSize: "0.78rem",
                        }}
                      >
                        {link.label}
                      </Link>
                      <button
                        type="button"
                        onClick={() => handleDismiss(alert.alert_id)}
                        className="app-btn-secondary flex-1 sm:flex-none"
                        style={{
                          minHeight: "2.35rem",
                          padding: "0.45rem 0.95rem",
                          fontSize: "0.78rem",
                          color: "var(--color-success)",
                          borderColor:
                            "color-mix(in srgb, var(--color-success) 40%, var(--color-border))",
                        }}
                      >
                        סומן כטופל
                      </button>
                    </div>
                  )}
                </div>
              </article>
            )
          })}
        </div>
      )}
    </div>
  )
}
