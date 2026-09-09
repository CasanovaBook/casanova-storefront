import { useState } from "react"

import { Link } from "react-router"

import { useAdmin } from "../../context/AdminContext"

import { can } from "../../lib/permissions"

import type { SystemAlert } from "../../types"

import AccessDenied from "../../components/AccessDenied"

import Icon from "../../components/icons"

const SEVERITY_META: Record<SystemAlert["severity"], {
  label: string
  color: string
  bg: string
}> = {
  CRITICAL: { label: "קריטי", color: "#EF4444", bg: "rgba(239,68,68,0.12)" },

  HIGH: { label: "גבוה", color: "#F59E0B", bg: "rgba(245,158,11,0.12)" },

  MEDIUM: { label: "בינוני", color: "#38BDF8", bg: "rgba(56,189,248,0.12)" },

  LOW: { label: "נמוך", color: "#6B7280", bg: "rgba(107,114,128,0.12)" },
}

const TYPE_LINK: Record<SystemAlert["related_type"], {
  href: string
  label: string
}> = {
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

  if (!can(adminRole, "alerts")) return <AccessDenied page="התראות ותקלות" />

  const visible = showDismissed ? alerts : openAlerts

  const countBySeverity = (sev: SystemAlert["severity"]) =>
    openAlerts.filter((a) => a.severity === sev).length

  return (
    <div className="max-w-4xl mx-auto page-enter">
      <div className="mb-8">
        <h1 className="font-display text-4xl font-semibold mb-1">
          התראות ותקלות
        </h1>
        <p style={{ color: "var(--color-muted-foreground)" }}>
          המערכת סורקת באופן שוטף אי־התאמות: תשלום ללא גישה, חשבונית חסרה,
          מיילים שנכשלו, מנויים בפיגור ועוד.
        </p>
      </div>

      {/* Severity summary */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        {(Object.keys(SEVERITY_META) as SystemAlert["severity"][]).map(
          (sev) => (
            <div key={sev} className="card-glow p-4 text-center">
              <p
                className="font-display text-3xl font-semibold mb-1"
                style={{ color: SEVERITY_META[sev].color }}
              >
                {countBySeverity(sev)}
              </p>
              <p
                className="text-xs"
                style={{ color: "var(--color-muted-foreground)" }}
              >
                {SEVERITY_META[sev].label}
              </p>
            </div>
          ),
        )}
      </div>

      <div className="flex items-center justify-between mb-4">
        <p className="text-sm font-semibold">
          {showDismissed
            ? `כל ההתראות (${alerts.length})`
            : `התראות פתוחות (${openAlerts.length})`}
        </p>
        {dismissedAlerts.length > 0 && (
          <button
            onClick={() => setShowDismissed((v) => !v)}
            className="text-xs px-3 py-1.5 rounded-full border"
            style={{
              borderColor: "var(--color-border)",
              color: "var(--color-muted-foreground)",
            }}
          >
            {showDismissed
              ? "הצגת פתוחות בלבד"
              : `הצגת הכול (${dismissedAlerts.length} טופלו)`}
          </button>
        )}
      </div>

      <div className="space-y-3">
        {visible.length === 0 && (
          <div className="card-glow p-12 text-center">
            <span
              className="w-12 h-12 rounded-full inline-flex items-center justify-center mb-3"
              style={{
                background: "rgba(34,197,94,0.15)",
                color: "var(--color-success)",
              }}
            >
              <Icon name="checkCircle" size={22} />
            </span>
            <p className="font-semibold">הכול תקין</p>
            <p
              className="text-sm mt-1"
              style={{ color: "var(--color-muted-foreground)" }}
            >
              אין תקלות פתוחות הדורשות טיפול.
            </p>
          </div>
        )}
        {visible.map((alert) => {
          const meta = SEVERITY_META[alert.severity]

          const dismissed = dismissedAlerts.includes(alert.alert_id)

          const link = TYPE_LINK[alert.related_type]

          return (
            <div
              key={alert.alert_id}
              className="card-glow p-5"
              style={{
                borderRight: `3px solid ${meta.color}`,
                opacity: dismissed ? 0.55 : 1,
              }}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                    <span
                      className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                      style={{ background: meta.bg, color: meta.color }}
                    >
                      {meta.label}
                    </span>
                    <span
                      className="text-[10px] px-2 py-0.5 rounded-full"
                      style={{
                        background: "var(--color-secondary)",
                        color: "var(--color-muted-foreground)",
                      }}
                    >
                      {alert.related_type} ·{" "}
                      <span className="font-mono" dir="ltr">
                        {alert.related_id}
                      </span>
                    </span>
                    {dismissed && (
                      <span
                        className="text-[10px]"
                        style={{ color: "var(--color-muted-foreground)" }}
                      >
                        טופל ✓
                      </span>
                    )}
                  </div>
                  <h3 className="font-semibold text-sm mb-1">{alert.title}</h3>
                  <p
                    className="text-sm"
                    style={{ color: "var(--color-muted-foreground)" }}
                  >
                    {alert.description}
                  </p>
                  <p
                    className="text-xs mt-2"
                    style={{ color: "var(--color-muted-foreground)" }}
                  >
                    זוהה בתאריך:{" "}
                    {new Date(alert.created_at).toLocaleString("he-IL")}
                  </p>
                </div>
                {!dismissed && (
                  <div className="flex flex-col gap-2 flex-shrink-0">
                    <Link
                      to={link.href}
                      className="text-xs px-3 py-1.5 rounded-full border text-center"
                      style={{
                        borderColor: "var(--color-border)",
                        color: "var(--color-foreground)",
                      }}
                    >
                      {link.label}
                    </Link>
                    <button
                      onClick={() => dismissAlert(alert.alert_id)}
                      className="text-xs px-3 py-1.5 rounded-full border"
                      style={{
                        borderColor: "rgba(34,197,94,0.3)",
                        color: "var(--color-success)",
                      }}
                    >
                      סומן כטופל
                    </button>
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
