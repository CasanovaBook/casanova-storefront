import { useState } from "react"

import { useAdmin } from "../../context/AdminContext"

import { can } from "../../lib/permissions"

import type { EmailStatus } from "../../types"

import AccessDenied from "../../components/AccessDenied"

import Alert from "../../components/ui/Alert"

import EmptyState from "../../components/ui/EmptyState"

import PageHeader from "../../components/ui/PageHeader"

import Icon from "../../components/icons"

const STATUS_LABEL: Record<EmailStatus, string> = {
  QUEUED: "בתור",

  SENT: "נשלח",

  DELIVERED: "התקבל",

  FAILED: "נכשל",
}

const STATUS_BADGE: Record<EmailStatus, string> = {
  QUEUED: "app-badge--warning",
  SENT: "app-badge--accent",
  DELIVERED: "app-badge--success",
  FAILED: "app-badge--danger",
}

const STATUS_FILTERS = [
  { value: "ALL", label: "הכול" },

  { value: "QUEUED", label: "בתור" },

  { value: "SENT", label: "נשלח" },

  { value: "DELIVERED", label: "התקבל" },

  { value: "FAILED", label: "נכשל" },
] as const

const compactButtonStyle = {
  minHeight: "2.1rem",
  padding: "0.3rem 0.7rem",
  fontSize: "0.72rem",
  gap: "0.35rem",
} as const

export default function AdminEmailsPage() {
  const { emailLogs, adminRole, resendEmail } = useAdmin()

  const [statusFilter, setStatusFilter] = useState<"ALL" | EmailStatus>("ALL")

  const [search, setSearch] = useState("")

  const [feedback, setFeedback] = useState<{
    kind: "ok" | "error"
    text: string
  } | null>(null)

  if (!can(adminRole, "emails")) return <AccessDenied page="מיילים" />

  const canResend = can(adminRole, "resend_email")

  const filtered = emailLogs

    .filter((e) => {
      const matchStatus = statusFilter === "ALL" || e.status === statusFilter

      const matchSearch = `${e.recipient} ${e.subject}`
        .toLowerCase()
        .includes(search.toLowerCase())

      return matchStatus && matchSearch
    })

    .sort(
      (a, b) => new Date(b.sent_at).getTime() - new Date(a.sent_at).getTime(),
    )

  const failedCount = emailLogs.filter((e) => e.status === "FAILED").length

  const queuedCount = emailLogs.filter((e) => e.status === "QUEUED").length

  const clearFilters = () => {
    setSearch("")
    setStatusFilter("ALL")
  }

  const sendAgain = (emailLogId: string) => {
    const result = resendEmail(emailLogId)

    setFeedback(
      result.ok
        ? { kind: "ok", text: "ההודעה הוחזרה לתור השליחה." }
        : { kind: "error", text: result.error },
    )
  }

  return (
    <div className="page-enter">
      <PageHeader
        eyebrow="תפעול"
        title="מיילים"
        description={
          <>
            {emailLogs.length} רשומות ביומן ·{" "}
            {failedCount > 0
              ? `${failedCount} נכשלו ודורשים טיפול`
              : "אין כשלי שליחה"}
            {queuedCount > 0 ? ` · ${queuedCount} ממתינות בתור` : ""}
          </>
        }
      />

      {queuedCount > 0 && (
        <div className="mb-4">
          <Alert tone="warning">
            לא מוגדר ספק דואר בהגדרות המערכת, לכן הודעות נרשמות בתור בלבד ואינן
            נמסרות בפועל.
          </Alert>
        </div>
      )}

      {feedback && (
        <div className="mb-4">
          <Alert tone={feedback.kind === "ok" ? "success" : "error"}>
            <div className="flex items-start justify-between gap-3">
              <span>{feedback.text}</span>
              <button
                type="button"
                onClick={() => setFeedback(null)}
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

      <section
        className="app-surface app-surface--flat mb-4"
        aria-label="סינון יומן המיילים"
      >
        <div className="app-surface-body">
          <div className="app-field mb-4">
            <label className="app-label" htmlFor="email-search">
              חיפוש
            </label>
            <div className="relative">
              <Icon
                name="search"
                size={15}
                className="app-muted pointer-events-none absolute top-1/2 -translate-y-1/2"
                style={{ insetInlineEnd: "0.9rem" }}
              />
              <input
                id="email-search"
                className="w-full px-4"
                style={{ paddingInlineEnd: "2.5rem" }}
                placeholder="חיפוש לפי נמען או נושא..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>

          <div
            className="app-tabs"
            role="group"
            aria-label="סינון לפי סטטוס שליחה"
          >
            {STATUS_FILTERS.map((s) => (
              <button
                key={s.value}
                type="button"
                onClick={() => setStatusFilter(s.value)}
                className="app-tab"
                data-active={statusFilter === s.value}
                aria-pressed={statusFilter === s.value}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      </section>

      {filtered.length === 0 ? (
        emailLogs.length === 0 ? (
          <EmptyState
            icon="mail"
            title="אין רשומות מייל עדיין"
            description="כל הודעה שהמערכת מפיקה תירשם ביומן הזה עם סטטוס המסירה שלה."
          />
        ) : (
          <EmptyState
            icon="search"
            title="לא נמצאו מיילים"
            description="לא נמצאו מיילים התואמים את הסינון."
            actions={
              <button
                type="button"
                onClick={clearFilters}
                className="app-btn-secondary"
              >
                ניקוי הסינון
              </button>
            }
          />
        )
      ) : (
        <div className="app-table-wrap">
          <table className="app-table" style={{ minWidth: "52rem" }}>
            <caption className="sr-only">
              יומן מיילים - נמען, נושא, תבנית, תאריך, סטטוס ופעולות
            </caption>
            <thead>
              <tr>
                <th scope="col">נמען</th>
                <th scope="col">נושא</th>
                <th scope="col">תבנית</th>
                <th scope="col">תאריך</th>
                <th scope="col">סטטוס</th>
                <th scope="col" style={{ textAlign: "left" }}>
                  פעולות
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((e) => (
                <tr key={e.email_log_id}>
                  <td style={{ overflowWrap: "anywhere" }}>
                    <p className="text-xs font-mono" dir="ltr">
                      {e.recipient}
                    </p>
                    {e.recipient_name && (
                      <p className="text-xs app-muted mt-0.5">
                        {e.recipient_name}
                      </p>
                    )}
                  </td>
                  <td
                    className="text-sm font-medium"
                    style={{ minWidth: "14rem", overflowWrap: "anywhere" }}
                  >
                    {e.subject}
                  </td>
                  <td className="text-xs app-muted whitespace-nowrap">
                    {e.template}
                  </td>
                  <td className="text-xs app-muted whitespace-nowrap">
                    {new Date(e.sent_at).toLocaleString("he-IL", {
                      day: "numeric",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </td>
                  <td>
                    <span
                      className={`app-badge ${STATUS_BADGE[e.status] ?? "app-badge--neutral"}`}
                    >
                      {STATUS_LABEL[e.status] ?? e.status}
                    </span>
                    {e.failure_reason && (
                      <p
                        className="text-xs app-muted mt-1"
                        style={{ maxWidth: "16rem", overflowWrap: "anywhere" }}
                      >
                        {e.failure_reason}
                      </p>
                    )}
                  </td>
                  <td>
                    {(e.status === "FAILED" || e.status === "QUEUED") &&
                      canResend && (
                        <button
                          type="button"
                          onClick={() => sendAgain(e.email_log_id)}
                          aria-label={`שליחה מחדש של ${e.subject} אל ${e.recipient}`}
                          className="app-btn-secondary whitespace-nowrap"
                          style={compactButtonStyle}
                        >
                          <Icon name="refresh" size={12} /> שליחה מחדש
                        </button>
                      )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
