/**
 * Maestro Admin — audit log viewer.
 *
 * Fetches audit entries from the Maestro connector and displays them in a
 * filterable table. Shows who changed what, when.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { maestro } from "@/maestro";
import type { AuditEntry } from "@/maestro/core/types";
import Icon from "@/components/icons";
import PageHeader from "@/components/ui/PageHeader";
import EmptyState from "@/components/ui/EmptyState";
import Spinner from "@/components/ui/Spinner";

const ENTITY_LABELS: Record<string, string> = {
  content: "תוכן",
  products: "מוצרים",
  categories: "קטגוריות",
  cms_sections: "סקשנים",
  testimonials: "המלצות",
  faqs: "שאלות",
  coupons: "קופונים",
  orders: "הזמנות",
  users: "משתמשים",
  settings: "הגדרות",
  media: "מדיה",
};

const ACTION_LABELS: Record<string, string> = {
  create: "יצירה",
  update: "עדכון",
  delete: "מחיקה",
  list: "קריאה",
  get: "קריאה",
};

const ACTION_BADGE: Record<string, string> = {
  create: "app-badge--success",
  update: "app-badge--accent",
  delete: "app-badge--danger",
};

const COLUMNS = ["זמן", "פעולה", "סוג", "מזהה", "מבצע", "פרטים"];

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = now - then;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "עכשיו";
  if (mins < 60) return `לפני ${mins} דק'`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `לפני ${hours} שעות`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `לפני ${days} ימים`;
  return new Date(dateStr).toLocaleDateString("he-IL");
}

export function AuditLogPage() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [entityFilter, setEntityFilter] = useState("");
  const [page, setPage] = useState(0);
  const perPage = 25;

  const fetchAudit = useCallback(async () => {
    setLoading(true);
    try {
      const res = await maestro.audit.list({ limit: 200, orderBy: "created_at", orderDir: "desc" });
      setEntries(res.data ?? []);
    } catch {
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAudit();
  }, [fetchAudit]);

  const filtered = useMemo(() => {
    let list = entries;
    if (entityFilter) {
      list = list.filter((e) => e.entity === entityFilter);
    }
    if (filter) {
      const q = filter.toLowerCase();
      list = list.filter(
        (e) =>
          e.actor_email?.toLowerCase().includes(q) ||
          e.entity_id?.toLowerCase().includes(q) ||
          e.detail?.toLowerCase().includes(q),
      );
    }
    return list;
  }, [entries, filter, entityFilter]);

  const paged = filtered.slice(page * perPage, (page + 1) * perPage);
  const totalPages = Math.ceil(filtered.length / perPage);

  const uniqueEntities = useMemo(
    () => [...new Set(entries.map((e) => e.entity))].sort(),
    [entries],
  );

  const hasActiveFilters = Boolean(filter || entityFilter);

  const resetFilters = () => {
    setFilter("");
    setEntityFilter("");
    setPage(0);
  };

  return (
    <div dir="rtl">
      <PageHeader
        eyebrow="Maestro CMS"
        title="יומן שינויים"
        description="מעקב אחר מי שינה מה ומתי — רשומות קריאה מתוך יומן הביקורת של המערכת."
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
      <section className="app-surface mb-4" aria-labelledby="audit-filters-title">
        <div className="app-surface-head">
          <h2 id="audit-filters-title" className="app-section-title flex items-center gap-2">
            <Icon name="search" size={16} />
            סינון
          </h2>
          <p className="text-xs app-muted" role="status" aria-live="polite">
            {filtered.length} רשומות
            {entityFilter ? ` ב${ENTITY_LABELS[entityFilter] ?? entityFilter}` : ""}
          </p>
        </div>
        <div className="app-surface-body">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="relative flex-1 min-w-0">
              <span
                className="absolute start-3 top-1/2 -translate-y-1/2 pointer-events-none app-muted"
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
                  setFilter(e.target.value);
                  setPage(0);
                }}
                placeholder="חיפוש לפי אימייל, מפתח או פרטים…"
                className="w-full ps-9 pe-3"
                dir="rtl"
              />
            </div>
            <div className="sm:w-56">
              <label htmlFor="audit-entity" className="sr-only">
                סינון לפי סוג ישות
              </label>
              <select
                id="audit-entity"
                value={entityFilter}
                onChange={(e) => {
                  setEntityFilter(e.target.value);
                  setPage(0);
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
            {hasActiveFilters && (
              <button type="button" onClick={resetFilters} className="app-btn-ghost">
                <Icon name="x" size={14} />
                ניקוי סינון
              </button>
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
          title={entries.length ? "לא נמצאו רשומות מתאימות" : "אין רשומות להצגה"}
          description={
            entries.length
              ? "שנו את מונח החיפוש או נקו את הסינון כדי לראות את כל הרשומות."
              : "רשומות ביקורת יופיעו כאן לאחר ביצוע פעולות עריכה במערכת."
          }
          actions={
            hasActiveFilters ? (
              <button type="button" onClick={resetFilters} className="app-btn-secondary">
                ניקוי סינון
              </button>
            ) : undefined
          }
        />
      ) : (
        <>
          <p className="mb-3 text-xs app-muted">
            מציג {page * perPage + 1}–{Math.min((page + 1) * perPage, filtered.length)} מתוך {filtered.length}
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
                {paged.map((entry, i) => (
                  <tr key={`${entry.created_at}-${i}`}>
                    <td className="whitespace-nowrap text-xs app-muted">
                      <time dateTime={entry.created_at} title={new Date(entry.created_at).toLocaleString("he-IL")}>
                        {timeAgo(entry.created_at)}
                      </time>
                    </td>
                    <td>
                      <span className={`app-badge ${ACTION_BADGE[entry.action] ?? "app-badge--neutral"}`}>
                        {ACTION_LABELS[entry.action] ?? entry.action}
                      </span>
                    </td>
                    <td className="text-sm whitespace-nowrap">
                      {ENTITY_LABELS[entry.entity] ?? entry.entity}
                    </td>
                    <td className="text-xs font-mono max-w-[14rem] truncate" dir="ltr" title={entry.entity_id ?? undefined}>
                      {entry.entity_id}
                    </td>
                    <td className="text-xs max-w-[14rem] truncate" dir="ltr" title={entry.actor_email ?? undefined}>
                      {entry.actor_email}
                    </td>
                    <td className="text-xs app-muted max-w-[18rem] truncate" title={entry.detail ?? undefined}>
                      {entry.detail}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <nav className="mt-4 flex items-center justify-center gap-2 flex-wrap" aria-label="עימוד יומן השינויים">
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
    </div>
  );
}
