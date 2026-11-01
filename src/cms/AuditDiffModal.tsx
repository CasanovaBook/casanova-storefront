/**
 * Before/after diff dialog for one audit row.
 *
 * Structured rows render each changed key as a stacked pair: the previous
 * value in muted red, the saved value in green. Rows written before the
 * structured format existed degrade to key chips / new-values-only, and rows
 * whose JSON was sliced by the old writer fall back to the raw text - the
 * dialog never shows a broken parse.
 */

import type { AuditChange, AuditEntry } from "@/maestro/core/types"
import Modal from "@/components/Modal"
import Alert from "@/components/ui/Alert"
import { formatIsraelClockTimeFull } from "@/lib/datetime"
import { ACTION_LABELS, ENTITY_LABELS, parseAuditDetail } from "./auditLogModel"

function KeyChips({ keys }: { keys: string[] }) {
  return (
    <div className="app-audit-keylist">
      {keys.map((key) => (
        <span
          key={key}
          dir="ltr"
          title={key}
          className="app-badge app-badge--neutral app-badge--wrap font-mono"
        >
          {key}
        </span>
      ))}
    </div>
  )
}

function ChangeRow({ change }: { change: AuditChange }) {
  const cutTitle = change.cut
    ? "אחד הערכים קוצה כדי לעמוד בתק היומן"
    : undefined
  return (
    <li
      className="rounded-[var(--radius-md)] border p-3"
      style={{
        borderColor: "var(--color-border)",
        background: "var(--color-card)",
      }}
    >
      <p
        dir="ltr"
        className="mb-2 text-left font-mono text-xs app-muted"
        title={change.key}
      >
        {change.key}
      </p>
      <div className="space-y-1.5">
        <p
          className="app-audit-diff-before rounded px-2.5 py-1.5"
          title={cutTitle}
        >
          <span className="me-2 text-[10px] font-semibold uppercase tracking-wide opacity-70">
            לפני
          </span>
          <span dir="auto" className="break-all font-mono text-xs">
            {change.before ?? "—"}
          </span>
        </p>
        <p
          className="app-audit-diff-after rounded px-2.5 py-1.5"
          title={cutTitle}
        >
          <span className="me-2 text-[10px] font-semibold uppercase tracking-wide opacity-70">
            אחרי
          </span>
          <span dir="auto" className="break-all font-mono text-xs">
            {change.after ?? "—"}
          </span>
        </p>
      </div>
    </li>
  )
}

export function AuditDiffModal({
  entry,
  onClose,
}: {
  entry: AuditEntry
  onClose: () => void
}) {
  const parsed = parseAuditDetail(entry.detail)

  return (
    <Modal
      onClose={onClose}
      size="3xl"
      align="start"
      title="שינויים"
      subtitle={`${ENTITY_LABELS[entry.entity] ?? entry.entity} · ${
        ACTION_LABELS[entry.action] ?? entry.action
      } · ${formatIsraelClockTimeFull(entry.created_at)} · ${entry.actor_email}`}
      ariaLabel={`פירוט שינויים עבור ${entry.entity_id ?? entry.entity}`}
    >
      <div className="space-y-4">
        {parsed.shape === "envelope" && (
          <>
            {parsed.detail.truncated && (
              <Alert tone="warning">
                חלק מפירוטי השינויים קוצו כדי לעמוד בתק היומן; המפתחות שלא נכנסו
                מופיעים ברשימה למטה.
              </Alert>
            )}
            {parsed.detail.keys && parsed.detail.keys.length > 0 && (
              <div>
                <p className="app-label mb-2">מפתחות נוספים שנפגעו</p>
                <KeyChips keys={parsed.detail.keys} />
              </div>
            )}
            {parsed.detail.changes.length > 0 ? (
              <ul className="space-y-3">
                {parsed.detail.changes.map((change) => (
                  <ChangeRow key={change.key} change={change} />
                ))}
              </ul>
            ) : (
              <p className="text-sm app-muted">
                הרשומה שמרה את המפתחות בלבד, בלי פירוט ערכים.
              </p>
            )}
          </>
        )}

        {parsed.shape === "keylist" && (
          <>
            <p className="text-xs app-muted">
              רשומה ישנה - ערכי לפני/אחרי לא נשמרו בזמן הכתיבה. אלה המפתחות
              שנרשמו כשנויים:
            </p>
            <KeyChips keys={parsed.keys} />
          </>
        )}

        {parsed.shape === "patch" && (
          <>
            <p className="text-xs app-muted">
              רשומה ישנה - נשמרו הערכים החדשים בלבד, ללא הערך הקודם:
            </p>
            <ul className="space-y-3">
              {parsed.fields.map((field) => (
                <ChangeRow
                  key={field.key}
                  change={{ key: field.key, before: null, after: field.value }}
                />
              ))}
            </ul>
          </>
        )}

        {parsed.shape === "text" && (
          <pre
            dir="auto"
            className="whitespace-pre-wrap break-all rounded-[var(--radius-md)] bg-[var(--color-secondary)] p-3 font-mono text-xs"
          >
            {parsed.raw}
          </pre>
        )}

        {parsed.shape === "none" && (
          <p className="text-sm app-muted">לרשומה זו לא נשמרו פרטי שינויים.</p>
        )}
      </div>
    </Modal>
  )
}
