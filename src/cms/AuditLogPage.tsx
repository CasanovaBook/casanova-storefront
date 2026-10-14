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

const ACTION_COLORS: Record<string, { bg: string; fg: string }> = {
  create: { bg: "rgba(34,197,94,0.12)", fg: "var(--color-success)" },
  update: { bg: "rgba(227,174,60,0.12)", fg: "var(--color-primary)" },
  delete: { bg: "rgba(239,68,68,0.12)", fg: "var(--color-danger)" },
};

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

const inputStyle: React.CSSProperties = {
  background: "var(--color-secondary)",
  border: "1px solid var(--color-border)",
  color: "var(--color-foreground)",
  borderRadius: "var(--radius)",
};

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

  return (
    <div dir="rtl">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Icon name="list" size={24} />
          <h1 className="text-2xl font-bold" style={{ color: "var(--color-foreground)" }}>יומן שינויים</h1>
        </div>
        <button
          onClick={fetchAudit}
          className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-all hover:opacity-80"
          style={{ border: "1px solid var(--color-border)", color: "var(--color-muted-foreground)" }}
        >
          <Icon name="refresh" size={14} />
          רענון
        </button>
      </div>

      {/* Filters */}
      <div className="mb-4 flex gap-3 flex-wrap">
        <input
          type="text"
          value={filter}
          onChange={(e) => { setFilter(e.target.value); setPage(0); }}
          placeholder="חיפוש לפי אימייל, מפתח או פרטים…"
          className="flex-1 min-w-[200px] px-3 py-1.5 text-sm"
          style={inputStyle}
          dir="rtl"
        />
        <select
          value={entityFilter}
          onChange={(e) => { setEntityFilter(e.target.value); setPage(0); }}
          className="rounded-lg px-3 py-1.5 text-sm"
          style={inputStyle}
        >
          <option value="">כל הסוגים</option>
          {uniqueEntities.map((ent) => (
            <option key={ent} value={ent}>{ENTITY_LABELS[ent] ?? ent}</option>
          ))}
        </select>
      </div>

      {/* Stats */}
      <p className="mb-3 text-xs" style={{ color: "var(--color-muted-foreground)", opacity: 0.6 }}>
        {filtered.length} רשומות {entityFilter ? `ב-${ENTITY_LABELS[entityFilter] ?? entityFilter}` : ""}
      </p>

      {/* Table */}
      {loading ? (
        <p className="text-sm" style={{ color: "var(--color-muted-foreground)" }}>טוען…</p>
      ) : !paged.length ? (
        <p className="text-sm" style={{ color: "var(--color-muted-foreground)" }}>אין רשומות להצגה.</p>
      ) : (
        <div className="overflow-auto rounded-xl" style={{ border: "1px solid var(--color-border)" }}>
          <table className="w-full text-sm">
            <thead style={{ background: "var(--color-card)" }}>
              <tr>
                {["זמן", "פעולה", "סוג", "מזהה", "מבצע", "פרטים"].map((h) => (
                  <th
                    key={h}
                    className="px-3 py-2.5 text-right text-xs font-medium"
                    style={{ color: "var(--color-muted-foreground)", borderBottom: "1px solid var(--color-border)" }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {paged.map((entry, i) => {
                const colors = ACTION_COLORS[entry.action] ?? { bg: "var(--color-muted)", fg: "var(--color-muted-foreground)" };
                return (
                  <tr
                    key={i}
                    className="transition-colors"
                    style={{ borderBottom: "1px solid var(--color-border)" }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "var(--color-secondary)")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                  >
                    <td className="px-3 py-2 whitespace-nowrap text-xs" style={{ color: "var(--color-muted-foreground)" }}>
                      {timeAgo(entry.created_at)}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className="rounded-full px-2 py-0.5 text-xs font-medium"
                        style={{ background: colors.bg, color: colors.fg }}
                      >
                        {ACTION_LABELS[entry.action] ?? entry.action}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-sm" style={{ color: "var(--color-foreground)" }}>
                      {ENTITY_LABELS[entry.entity] ?? entry.entity}
                    </td>
                    <td className="px-3 py-2 text-xs font-mono" dir="ltr" style={{ color: "var(--color-muted-foreground)", opacity: 0.6 }}>
                      {entry.entity_id}
                    </td>
                    <td className="px-3 py-2 text-xs" style={{ color: "var(--color-muted-foreground)" }}>
                      {entry.actor_email}
                    </td>
                    <td className="px-3 py-2 text-xs max-w-[200px] truncate" style={{ color: "var(--color-muted-foreground)", opacity: 0.6 }}>
                      {entry.detail}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-center gap-2">
          <button
            onClick={() => setPage(Math.max(0, page - 1))}
            disabled={page === 0}
            className="rounded-lg px-3 py-1.5 text-sm transition-all disabled:opacity-30"
            style={{ border: "1px solid var(--color-border)", color: "var(--color-muted-foreground)" }}
          >
            הקודם
          </button>
          <span className="text-sm" style={{ color: "var(--color-muted-foreground)" }}>
            עמוד {page + 1} מתוך {totalPages}
          </span>
          <button
            onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
            disabled={page >= totalPages - 1}
            className="rounded-lg px-3 py-1.5 text-sm transition-all disabled:opacity-30"
            style={{ border: "1px solid var(--color-border)", color: "var(--color-muted-foreground)" }}
          >
            הבא
          </button>
        </div>
      )}
    </div>
  );
}
