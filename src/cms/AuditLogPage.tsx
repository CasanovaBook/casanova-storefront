/**
 * Maestro Admin - audit log viewer.
 *
 * Fetches audit entries from the Maestro connector and displays them in a
 * filterable table: who changed what, exactly when (Israel wall clock, to
 * the minute with seconds in the tooltip), and - for rows written with the
 * structured journal - the before/after values behind each change.
 */

import { useCallback, useEffect, useMemo, useState } from "react"
import { maestro } from "@/maestro"
import type { AuditEntry } from "@/maestro/core/types"
import Icon from "@/components/icons"
import PageHeader from "@/components/ui/PageHeader"
import EmptyState from "@/components/ui/EmptyState"
import Spinner from "@/components/ui/Spinner"
import {
  formatIsraelClockTime,
  formatIsraelClockTimeFull,
} from "@/lib/datetime"
import {
  ACTION_BADGE,
  ACTION_ICON,
  ACTION_LABELS,
  DEFAULT_ACTION_ICON,
  ENTITY_LABELS,
  bulkKeysLabel,
  describeDetail,
  inDateWindow,
  isContentKey,
  parseAuditDetail,
  type DatePreset,
} from "./auditLogModel"
import { AuditDiffModal } from "./AuditDiffModal"

const COLUMNS = ["זמן", "פעולה", "סוג", "מזהה", "מבצע", "פרטים", "שינויים"]

const PRESET_LABELS: Record<DatePreset, string> = {
  all: "כל התקופות",
  today: "היום",
  "7d": "7 ימים אחרונים",
  custom: "טווח תאריכים",
}

export function AuditLogPage() {
  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState("")
  const [entityFilter, setEntityFilter] = useState("")
  const [actorFilter, setActorFilter] = useState("")
  const [actionFilter, setActionFilter] = useState("")
  const [preset, setPreset] = useState<DatePreset>("all")
  const [fromDate, setFromDate] = useState("")
  const [toDate, setToDate] = useState("")
  const [page, setPage] = useState(0)
  const [diffFor, setDiffFor] = useState<AuditEntry | null>(null)
  const perPage = 25

  const fetchAudit = useCallback(async () => {
    setLoading(true)
    try {
      const res = await maestro.audit.list({
        limit: 500,
        orderBy: "created_at",
        orderDir: "desc",
      })
      setEntries(res.data ?? [])
    } catch {
      setEntries([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchAudit()
  }, [fetchAudit])

  const uniqueEntities = useMemo(
    () => [...new Set(entries.map((e) => e.entity))].sort(),
    [entries],
  )

  const uniqueActors = useMemo(
    () =>
      [...new Set(entries.map((e) => e.actor_email).filter(Boolean))].sort(),
    [entries],
  )

  const uniqueActions = useMemo(
    () => [...new Set(entries.map((e) => e.action))].sort(),
    [entries],
  )

  const filtered = useMemo(() => {
    let list = entries
    if (entityFilter) {
      list = list.filter((e) => e.entity === entityFilter)
    }
    if (actorFilter) {
      list = list.filter((e) => e.actor_email === actorFilter)
    }
    if (actionFilter) {
      list = list.filter((e) => e.action === actionFilter)
    }
    if (preset !== "all") {
      list = list.filter((e) =>
        inDateWindow(e.created_at, preset, fromDate, toDate),
      )
    }
    if (filter) {
      const q = filter.toLowerCase()
      list = list.filter(
        (e) =>
          e.actor_email?.toLowerCase().includes(q) ||
          e.entity_id?.toLowerCase().includes(q) ||
          e.detail?.toLowerCase().includes(q),
      )
    }
    return list
  }, [
    entries,
    entityFilter,
    actorFilter,
    actionFilter,
    preset,
    fromDate,
    toDate,
    filter,
  ])

  const paged = filtered.slice(page * perPage, (page + 1) * perPage)
  const totalPages = Math.ceil(filtered.length / perPage)

  const hasActiveFilters = Boolean(
    filter ||
      entityFilter ||
      actorFilter ||
      actionFilter ||
      preset !== "all" ||
      fromDate ||
      toDate,
  )

  const resetFilters = () => {
    setFilter("")
    setEntityFilter("")
    setActorFilter("")
    setActionFilter("")
    setPreset("all")
    setFromDate("")
    setToDate("")
    setPage(0)
  }

  return (
    <div dir="rtl">
      <PageHeader
        eyebrow="Maestro CMS"
        title="יומן שינויים"
        description="מעקב אחר מי שינה מה ומתי - רשומות ביקורת עם שעה מדויקת, סינון מתקדם ותצוגת לפני/אחרי לשינויים."
        actions={
          <button
            type="button"
            onClick={fetchAudit}
            className="app-btn-secondary"
            disabled={loading}
          >
            <Icon name="refresh" size={14} />
            רענון
          </button>
        }
      />

      {/* Filters */}
      <section
        className="app-surface mb-4"
        aria-labelledby="audit-filters-title"
      >
        <div className="app-surface-head">
          <h2
            id="audit-filters-title"
            className="app-section-title flex items-center gap-2"
          >
            <Icon name="search" size={16} />
            סינון
          </h2>
          <p className="text-xs app-muted" role="status" aria-live="polite">
            {filtered.length} רשומות
            {entityFilter
              ? ` ב${ENTITY_LABELS[entityFilter] ?? entityFilter}`
              : ""}
          </p>
        </div>
        <div className="app-surface-body">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
            <div className="relative min-w-0 md:col-span-4">
              <span
                className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 app-muted"
                aria-hidden="true"
              >
                <Icon name="search" size={16} />
              </span>
              <label htmlFor="audit-search" className="sr-only">
                חיפוש ביומן השינויים
              </label>
              <input
                id="audit-search"
                type="search"
                value={filter}
                onChange={(e) => {
                  setFilter(e.target.value)
                  setPage(0)
                }}
                placeholder="חיפוש לפי אימייל, מפתח או פרטים…"
                className="w-full ps-9 pe-3"
                dir="rtl"
              />
            </div>
            <div className="md:col-span-2">
              <label htmlFor="audit-entity" className="sr-only">
                סינון לפי סוג ישות
              </label>
              <select
                id="audit-entity"
                value={entityFilter}
                onChange={(e) => {
                  setEntityFilter(e.target.value)
                  setPage(0)
                }}
                className="w-full px-3"
              >
                <option value="">כל הסוגים</option>
                {uniqueEntities.map((ent) => (
                  <option key={ent} value={ent}>
                    {ENTITY_LABELS[ent] ?? ent}
                  </option>
                ))}
              </select>
            </div>
            <div className="md:col-span-2">
              <label htmlFor="audit-actor" className="sr-only">
                סינון לפי מבצע
              </label>
              <select
                id="audit-actor"
                value={actorFilter}
                onChange={(e) => {
                  setActorFilter(e.target.value)
                  setPage(0)
                }}
                className="w-full px-3"
              >
                <option value="">כל המבצעים</option>
                {uniqueActors.map((email) => (
                  <option key={email} value={email} dir="ltr">
                    {email}
                  </option>
                ))}
              </select>
            </div>
            <div className="md:col-span-2">
              <label htmlFor="audit-action" className="sr-only">
                סינון לפי סוג פעולה
              </label>
              <select
                id="audit-action"
                value={actionFilter}
                onChange={(e) => {
                  setActionFilter(e.target.value)
                  setPage(0)
                }}
                className="w-full px-3"
              >
                <option value="">כל הפעולות</option>
                {uniqueActions.map((action) => (
                  <option key={action} value={action}>
                    {ACTION_LABELS[action] ?? action}
                  </option>
                ))}
              </select>
            </div>
            <div className="md:col-span-2">
              <label htmlFor="audit-preset" className="sr-only">
                סינון לפי טווח תאריכים
              </label>
              <select
                id="audit-preset"
                value={preset}
                onChange={(e) => {
                  setPreset(e.target.value as DatePreset)
                  setPage(0)
                }}
                className="w-full px-3"
              >
                {(Object.keys(PRESET_LABELS) as DatePreset[]).map((key) => (
                  <option key={key} value={key}>
                    {PRESET_LABELS[key]}
                  </option>
                ))}
              </select>
            </div>
            {preset === "custom" && (
              <>
                <div className="md:col-span-4">
                  <label htmlFor="audit-from" className="app-label mb-1 block">
                    מתאריך
                  </label>
                  <input
                    id="audit-from"
                    type="date"
                    dir="ltr"
                    value={fromDate}
                    max={toDate || undefined}
                    onChange={(e) => {
                      setFromDate(e.target.value)
                      setPage(0)
                    }}
                    className="w-full px-3"
                  />
                </div>
                <div className="md:col-span-4">
                  <label htmlFor="audit-to" className="app-label mb-1 block">
                    עד תאריך
                  </label>
                  <input
                    id="audit-to"
                    type="date"
                    dir="ltr"
                    value={toDate}
                    min={fromDate || undefined}
                    onChange={(e) => {
                      setToDate(e.target.value)
                      setPage(0)
                    }}
                    className="w-full px-3"
                  />
                </div>
              </>
            )}
            {hasActiveFilters && (
              <div className="md:col-span-2">
                <button
                  type="button"
                  onClick={resetFilters}
                  className="app-btn-ghost w-full"
                >
                  <Icon name="x" size={14} />
                  ניקוי סינון
                </button>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Table */}
      {loading ? (
        <Spinner label="טוען את יומן השינויים…" />
      ) : !filtered.length ? (
        <EmptyState
          icon="list"
          title={
            entries.length ? "לא נמצאו רשומות מתאימות" : "אין רשומות להצגה"
          }
          description={
            entries.length
              ? "שנו את מונח החיפוש או נקו את הסינון כדי לראות את כל הרשומות."
              : "רשומות ביקורת יופיעו כאן לאחר ביצוע פעולות עריכה במערכת."
          }
          actions={
            hasActiveFilters ? (
              <button
                type="button"
                onClick={resetFilters}
                className="app-btn-secondary"
              >
                ניקוי סינון
              </button>
            ) : undefined
          }
        />
      ) : (
        <>
          <p className="mb-3 text-xs app-muted">
            מציג {page * perPage + 1}-
            {Math.min((page + 1) * perPage, filtered.length)} מתוך{" "}
            {filtered.length}
          </p>
          <div className="app-table-wrap">
            <table className="app-table" aria-label="יומן שינויים">
              <thead>
                <tr>
                  {COLUMNS.map((h) => (
                    <th key={h} scope="col">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {paged.map((entry, i) => {
                  const shape = parseAuditDetail(entry.detail).shape
                  const bulk = bulkKeysLabel(entry.entity_id)
                  return (
                    <tr key={`${entry.created_at}-${i}`}>
                      <td className="whitespace-nowrap text-xs app-muted">
                        <time
                          dateTime={entry.created_at}
                          title={formatIsraelClockTimeFull(entry.created_at)}
                        >
                          {formatIsraelClockTime(entry.created_at) || "-"}
                        </time>
                      </td>
                      <td>
                        <span
                          className={`app-badge flex w-fit items-center gap-1.5 ${
                            ACTION_BADGE[entry.action] ?? "app-badge--neutral"
                          }`}
                        >
                          <Icon
                            name={
                              ACTION_ICON[entry.action] ?? DEFAULT_ACTION_ICON
                            }
                            size={12}
                            aria-hidden="true"
                          />
                          {ACTION_LABELS[entry.action] ?? entry.action}
                        </span>
                      </td>
                      <td className="text-sm whitespace-nowrap">
                        {ENTITY_LABELS[entry.entity] ?? entry.entity}
                      </td>
                      <td className="max-w-[16rem]">
                        {isContentKey(entry.entity_id) ? (
                          <span
                            dir="ltr"
                            title={entry.entity_id}
                            className="app-badge app-badge--neutral app-badge--wrap font-mono"
                          >
                            {entry.entity_id}
                          </span>
                        ) : bulk ? (
                          <span className="app-badge app-badge--neutral">
                            {bulk}
                          </span>
                        ) : (
                          <span
                            className="block max-w-[14rem] truncate text-xs font-mono"
                            dir="ltr"
                            title={entry.entity_id ?? undefined}
                          >
                            {entry.entity_id}
                          </span>
                        )}
                      </td>
                      <td
                        className="text-xs max-w-[14rem] truncate"
                        dir="ltr"
                        title={entry.actor_email ?? undefined}
                      >
                        {entry.actor_email}
                      </td>
                      <td
                        className="text-xs app-muted max-w-[14rem] truncate"
                        title={entry.detail ?? undefined}
                      >
                        {describeDetail(entry.detail)}
                      </td>
                      <td>
                        {shape !== "none" && (
                          <button
                            type="button"
                            onClick={() => setDiffFor(entry)}
                            aria-haspopup="dialog"
                            aria-label={`הצגת שינויים עבור ${entry.entity_id || entry.entity}`}
                            className="app-btn-ghost whitespace-nowrap"
                          >
                            <Icon name="eye" size={13} />
                            הצג שינויים
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <nav
          className="mt-4 flex items-center justify-center gap-2 flex-wrap"
          aria-label="עימוד יומן השינויים"
        >
          <button
            type="button"
            onClick={() => setPage(Math.max(0, page - 1))}
            disabled={page === 0}
            className="app-btn-secondary"
          >
            הקודם
          </button>
          <span className="text-sm app-muted" aria-live="polite">
            עמוד {page + 1} מתוך {totalPages}
          </span>
          <button
            type="button"
            onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
            disabled={page >= totalPages - 1}
            className="app-btn-secondary"
          >
            הבא
          </button>
        </nav>
      )}

      {diffFor && (
        <AuditDiffModal entry={diffFor} onClose={() => setDiffFor(null)} />
      )}
    </div>
  )
}
