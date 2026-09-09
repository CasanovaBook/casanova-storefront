import { useState } from "react"

import { useAdmin } from "../../context/AdminContext"

import { can } from "../../lib/permissions"

import type { EmailStatus } from "../../types"

import AccessDenied from "../../components/AccessDenied"

import Icon from "../../components/icons"

const STATUS_LABEL: Record<EmailStatus, string> = {
  QUEUED: "בתור",

  SENT: "נשלח",

  DELIVERED: "התקבל",

  FAILED: "נכשל",
}

export default function AdminEmailsPage() {
  const { emailLogs, adminRole, resendEmail } = useAdmin()

  const [statusFilter, setStatusFilter] = useState<"ALL" | EmailStatus>("ALL")

  const [search, setSearch] = useState("")

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

  return (
    <div className="max-w-5xl mx-auto page-enter">
      <div className="mb-8">
        <h1 className="font-display text-4xl font-semibold mb-1">מיילים</h1>
        <p style={{ color: "var(--color-muted-foreground)" }}>
          {emailLogs.length} רשומות ביומן ·{" "}
          {failedCount > 0
            ? `${failedCount} נכשלו ודורשים טיפול`
            : "אין כשלי שליחה"}
          {queuedCount > 0 ? ` · ${queuedCount} ממתינות בתור` : ""}
        </p>
      </div>

      {queuedCount > 0 && (
        <p
          className="text-xs px-4 py-2.5 rounded-lg mb-4"
          style={{ background: "rgba(245,158,11,0.1)", color: "#F59E0B" }}
        >
          לא מוגדר ספק דואר בהגדרות המערכת, לכן הודעות נרשמות בתור בלבד ואינן
          נמסרות בפועל.
        </p>
      )}

      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <input
          className="flex-1 min-w-48 px-4 py-2.5 rounded-lg border text-sm outline-none"
          style={{
            background: "var(--color-secondary)",
            borderColor: "var(--color-border)",
            color: "var(--color-foreground)",
          }}
          placeholder="חיפוש לפי נמען או נושא..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="flex gap-2">
          {([
            { value: "ALL", label: "הכול" },

            { value: "QUEUED", label: "בתור" },

            { value: "SENT", label: "נשלח" },

            { value: "DELIVERED", label: "התקבל" },

            { value: "FAILED", label: "נכשל" },
          ] as const).map((s) => (
            <button
              key={s.value}
              onClick={() => setStatusFilter(s.value)}
              className="px-3 py-2 rounded-full text-xs font-medium border transition-all"
              style={{
                background:
                  statusFilter === s.value
                    ? "var(--color-primary)"
                    : "transparent",

                color:
                  statusFilter === s.value
                    ? "var(--color-primary-foreground)"
                    : "var(--color-muted-foreground)",

                borderColor:
                  statusFilter === s.value
                    ? "var(--color-primary)"
                    : "var(--color-border)",
              }}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div
        className="rounded-lg border overflow-hidden"
        style={{ borderColor: "var(--color-border)" }}
      >
        <table className="w-full text-sm">
          <thead>
            <tr style={{ background: "var(--color-secondary)" }}>
              {["נמען", "נושא", "תבנית", "תאריך", "סטטוס", "פעולות"].map(
                (col) => (
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
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {filtered.map((e, i) => (
              <tr
                key={e.email_log_id}
                style={{
                  background:
                    i % 2 === 0
                      ? "var(--color-card)"
                      : "var(--color-background)",

                  borderBottom: "1px solid var(--color-border)",
                }}
              >
                <td className="px-5 py-3">
                  <p className="text-xs" dir="ltr">
                    {e.recipient}
                  </p>
                  {e.recipient_name && (
                    <p
                      className="text-xs"
                      style={{ color: "var(--color-muted-foreground)" }}
                    >
                      {e.recipient_name}
                    </p>
                  )}
                </td>
                <td className="px-5 py-3 text-sm">{e.subject}</td>
                <td
                  className="px-5 py-3 text-xs"
                  style={{ color: "var(--color-muted-foreground)" }}
                >
                  {e.template}
                </td>
                <td
                  className="px-5 py-3 text-xs"
                  style={{ color: "var(--color-muted-foreground)" }}
                >
                  {new Date(e.sent_at).toLocaleString("he-IL", {
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </td>
                <td className="px-5 py-3">
                  <span
                    className="text-xs font-bold"
                    style={{
                      color:
                        e.status === "FAILED"
                          ? "var(--color-danger)"
                          : e.status === "QUEUED"
                            ? "#F59E0B"
                            : "var(--color-success)",
                    }}
                  >
                    {STATUS_LABEL[e.status] ?? e.status}
                  </span>
                  {e.failure_reason && (
                    <p
                      className="text-xs mt-0.5"
                      style={{ color: "var(--color-muted-foreground)" }}
                    >
                      {e.failure_reason}
                    </p>
                  )}
                </td>
                <td className="px-5 py-3">
                  {(e.status === "FAILED" || e.status === "QUEUED") &&
                    canResend && (
                      <button
                        onClick={() => resendEmail(e.email_log_id)}
                        className="text-xs px-3 py-1 rounded-full border flex items-center gap-1.5 transition-colors hover:bg-white/5"
                        style={{
                          borderColor: "var(--color-border)",
                          color: "var(--color-foreground)",
                        }}
                      >
                        <Icon name="refresh" size={12} /> שליחה מחדש
                      </button>
                    )}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td
                  colSpan={6}
                  className="text-center py-12"
                  style={{ color: "var(--color-muted-foreground)" }}
                >
                  {emailLogs.length === 0
                    ? "אין רשומות מייל עדיין."
                    : "לא נמצאו מיילים התואמים את הסינון."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
