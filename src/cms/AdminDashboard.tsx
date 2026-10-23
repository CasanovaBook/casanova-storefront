/**
 * Maestro Admin — dashboard page.
 *
 * Shows connector info, content statistics, quick links and recent audit entries.
 * Styled to match the Casanova admin design system.
 */

import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import { maestro } from "@/maestro";
import { FIELDS, GROUPS, fieldsOfGroup } from "@/content/registry";
import { getSaved, loadContent } from "@/content/store";
import type { AuditEntry } from "@/maestro/core/types";
import Icon from "@/components/icons";
import PageHeader from "@/components/ui/PageHeader";

const ENTITY_LABELS: Record<string, string> = {
  content: "תוכן",
  products: "מוצרים",
  orders: "הזמנות",
  users: "משתמשים",
  settings: "הגדרות",
  media: "מדיה",
};

const ACTION_LABELS: Record<string, string> = {
  create: "יצירה",
  update: "עדכון",
  delete: "מחיקה",
};

const ACTION_BADGE: Record<string, string> = {
  create: "app-badge--success",
  update: "app-badge--accent",
  delete: "app-badge--danger",
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
  return `לפני ${days} ימים`;
}

export function AdminDashboard() {
  const navigate = useNavigate();
  const [connectorName, setConnectorName] = useState("");
  const [shared, setShared] = useState(false);
  const [healthy, setHealthy] = useState<boolean | null>(null);
  const [recentAudit, setRecentAudit] = useState<AuditEntry[]>([]);

  useEffect(() => {
    const info = maestro.connector;
    setConnectorName(info.name);
    setShared(info.shared);
    maestro.health().then((res) => {
      setHealthy(res.data?.ok ?? false);
    });
    maestro.audit.list({ limit: 10, orderBy: "created_at", orderDir: "desc" }).then((res) => {
      setRecentAudit(res.data ?? []);
    });
    loadContent().catch(() => {});
  }, []);

  const saved = getSaved();
  const savedCount = Object.keys(saved).length;
  const totalFields = FIELDS.length;
  const editPct = totalFields > 0 ? Math.round((savedCount / totalFields) * 100) : 0;

  const editableGroups = GROUPS.filter((g) => g.section === "pages" || g.section === "legal" || g.section === "global");

  const groupStats = editableGroups.map((g) => {
    const fields = fieldsOfGroup(g.id);
    const modified = fields.filter((f) => f.key in saved).length;
    return { ...g, total: fields.length, modified };
  });

  const pageGroupCount = GROUPS.filter((g) => g.section === "pages").length;
  const legalGroupCount = GROUPS.filter((g) => g.section === "legal").length;

  const quickLinks = [
    { href: "/admin/cms/content-editor/content", label: "עריכת תוכן", icon: "layers" as const, desc: "שנה טקסטים ותמונות" },
    { href: "/admin/cms/content-editor/products", label: "ניהול מוצרים", icon: "target" as const, desc: "מוצרים ומחירים" },
    { href: "/admin/cms/content-editor/pages", label: "עמודים", icon: "bookOpen" as const, desc: "עמודים וקטגוריות" },
    { href: "/admin/cms/content-editor/backup", label: "גיבוי", icon: "box" as const, desc: "ייצוא וייבוא" },
    { href: "/admin/cms/content-editor/audit", label: "יומן שינויים", icon: "list" as const, desc: "היסטוריית עריכות" },
    { href: "/admin/cms/content-editor/media", label: "ספריית מדיה", icon: "inbox" as const, desc: "תמונות וקבצים" },
  ];

  return (
    <div dir="rtl">
      <PageHeader
        eyebrow="Maestro CMS"
        title="לוח בקרה"
        description="ניהול תוכן האתר, מעקב אחר מצב המערכת וגישה מהירה למסכי העריכה."
        actions={
          <Link to="/admin/cms/content-editor/content" className="app-btn">
            <Icon name="pen" size={14} />
            עריכת תוכן
          </Link>
        }
      />

      {/* Top stats */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4 mb-6">
        <div className="app-surface p-4">
          <div className="flex items-center gap-2 mb-2">
            <span
              className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
              style={{ background: "color-mix(in srgb, var(--color-primary) 12%, transparent)", color: "var(--color-primary)" }}
              aria-hidden="true"
            >
              <Icon name="zap" size={14} />
            </span>
            <h2 className="text-xs font-medium app-muted">Connector</h2>
          </div>
          <p className="text-lg font-semibold truncate" title={connectorName || undefined}>
            {connectorName || "…"}
          </p>
          <p
            className="text-xs mt-1"
            style={{ color: shared ? "var(--color-success)" : "var(--color-muted-foreground)" }}
          >
            {shared ? "Supabase · מחובר" : "מקומי (localStorage)"}
          </p>
        </div>

        <div className="app-surface p-4">
          <div className="flex items-center gap-2 mb-2">
            <span
              className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
              style={{
                background:
                  healthy === true
                    ? "color-mix(in srgb, var(--color-success) 12%, transparent)"
                    : "color-mix(in srgb, var(--color-danger) 12%, transparent)",
                color: healthy === true ? "var(--color-success)" : "var(--color-danger)",
              }}
              aria-hidden="true"
            >
              <Icon name="shield" size={14} />
            </span>
            <h2 className="text-xs font-medium app-muted">מצב מערכת</h2>
          </div>
          <p
            className="text-lg font-semibold"
            style={{
              color:
                healthy === true
                  ? "var(--color-success)"
                  : healthy === false
                    ? "var(--color-danger)"
                    : "var(--color-muted-foreground)",
            }}
          >
            {healthy === true ? "תקין" : healthy === false ? "שגיאה" : "בודק…"}
          </p>
          <p className="text-xs mt-1 app-muted">
            {healthy === true ? "החיבור למסד הנתונים פעיל" : healthy === false ? "לא ניתן לאמת את החיבור" : "בודק את החיבור…"}
          </p>
        </div>

        <div className="app-surface p-4">
          <div className="flex items-center gap-2 mb-2">
            <span
              className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
              style={{ background: "color-mix(in srgb, var(--color-primary) 12%, transparent)", color: "var(--color-primary)" }}
              aria-hidden="true"
            >
              <Icon name="pen" size={14} />
            </span>
            <h2 className="text-xs font-medium app-muted">שדות שנערכו</h2>
          </div>
          <p className="text-lg font-semibold" style={{ color: "var(--color-primary)" }}>
            {savedCount}
          </p>
          <div className="mt-2 flex items-center gap-2">
            <div
              className="flex-1 h-1.5 rounded-full overflow-hidden"
              style={{ background: "var(--color-muted)" }}
              role="progressbar"
              aria-valuenow={editPct}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`${editPct}% מהשדות נערכו`}
            >
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${editPct}%`, background: "var(--color-primary)" }}
              />
            </div>
            <span className="text-xs app-muted">{editPct}%</span>
          </div>
        </div>

        <div className="app-surface p-4">
          <div className="flex items-center gap-2 mb-2">
            <span
              className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
              style={{ background: "color-mix(in srgb, var(--color-primary) 12%, transparent)", color: "var(--color-primary)" }}
              aria-hidden="true"
            >
              <Icon name="layers" size={14} />
            </span>
            <h2 className="text-xs font-medium app-muted">קבוצות תוכן</h2>
          </div>
          <p className="text-lg font-semibold">{editableGroups.length}</p>
          <p className="text-xs mt-1 app-muted">
            {pageGroupCount} עמודים · {legalGroupCount} משפטי
          </p>
        </div>
      </div>

      {/* Group cards — direct edit links */}
      <section className="mb-6" aria-labelledby="dashboard-groups-title">
        <h2
          id="dashboard-groups-title"
          className="mb-3 flex items-center gap-2 px-1 font-display text-lg font-semibold"
        >
          <Icon name="grid" size={16} />
          עריכה לפי עמוד
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {groupStats.map((g) => {
            const pct = g.total > 0 ? Math.round((g.modified / g.total) * 100) : 0;
            return (
              <button
                key={g.id}
                type="button"
                onClick={() => navigate(`/admin/cms/content-editor/content`, { state: { group: g.id } })}
                className="app-surface p-4 text-start transition-colors hover:border-[var(--color-primary)]"
              >
                <div className="flex items-center justify-between gap-2 mb-3">
                  <span className="text-sm font-semibold min-w-0 truncate">{g.label}</span>
                  <Icon name="arrowLeft" size={14} className="flex-shrink-0 app-muted" />
                </div>
                <div className="flex items-center gap-3">
                  <div
                    className="flex-1 h-2 rounded-full overflow-hidden"
                    style={{ background: "var(--color-muted)" }}
                    role="progressbar"
                    aria-valuenow={pct}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`${g.label}: ${g.modified} מתוך ${g.total} שדות שונו`}
                  >
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${pct}%`,
                        background: pct > 0 ? "var(--color-primary)" : "var(--color-border)",
                      }}
                    />
                  </div>
                  <span
                    className="text-xs font-medium flex-shrink-0"
                    style={{ color: pct > 0 ? "var(--color-primary)" : "var(--color-muted-foreground)" }}
                  >
                    {g.modified}/{g.total}
                  </span>
                </div>
                {g.path && (
                  <p
                    className="mt-2 text-xs font-mono text-start truncate"
                    dir="ltr"
                    style={{ color: "var(--color-muted-foreground)" }}
                  >
                    {g.path}
                  </p>
                )}
              </button>
            );
          })}
        </div>
      </section>

      {/* Quick links + Recent activity */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section className="app-surface" aria-labelledby="dashboard-links-title">
          <div className="app-surface-head">
            <h2 id="dashboard-links-title" className="app-section-title flex items-center gap-2">
              <Icon name="link" size={16} />
              קישורים מהירים
            </h2>
          </div>
          <div className="app-surface-body">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {quickLinks.map((link) => (
                <Link
                  key={link.href}
                  to={link.href}
                  className="flex flex-col gap-1 rounded-lg p-3 text-start transition-colors hover:border-[var(--color-primary)]"
                  style={{ background: "var(--color-secondary)", border: "1px solid var(--color-border)" }}
                >
                  <span className="flex items-center gap-1.5 text-sm font-semibold" style={{ color: "var(--color-primary)" }}>
                    <Icon name={link.icon} size={14} className="flex-shrink-0" />
                    {link.label}
                  </span>
                  <span className="text-xs app-muted">{link.desc}</span>
                </Link>
              ))}
            </div>
          </div>
        </section>

        <section className="app-surface" aria-labelledby="dashboard-activity-title">
          <div className="app-surface-head">
            <h2 id="dashboard-activity-title" className="app-section-title flex items-center gap-2">
              <Icon name="clock" size={16} />
              פעילות אחרונה
            </h2>
          </div>
          <div className="app-surface-body">
            {!recentAudit.length ? (
              <div className="py-8 text-center">
                <span
                  className="inline-flex h-11 w-11 items-center justify-center rounded-full"
                  style={{ background: "var(--color-secondary)", color: "var(--color-muted-foreground)" }}
                  aria-hidden="true"
                >
                  <Icon name="inbox" size={20} />
                </span>
                <p className="mt-3 text-sm font-medium">אין פעילות עדיין</p>
                <p className="mt-1 text-xs app-muted">עריכות שתבצעו יופיעו כאן.</p>
              </div>
            ) : (
              <ul className="space-y-2.5">
                {recentAudit.slice(0, 8).map((entry, i) => (
                  <li key={`${entry.created_at}-${i}`} className="flex items-center gap-2.5 text-sm min-w-0">
                    <span className={`app-badge flex-shrink-0 ${ACTION_BADGE[entry.action] ?? "app-badge--neutral"}`}>
                      {ACTION_LABELS[entry.action] ?? entry.action}
                    </span>
                    <span className="font-medium flex-shrink-0">
                      {ENTITY_LABELS[entry.entity] ?? entry.entity}
                    </span>
                    <span
                      className="text-xs truncate flex-1 min-w-0 font-mono text-start"
                      dir="ltr"
                      style={{ color: "var(--color-muted-foreground)" }}
                    >
                      {entry.entity_id}
                    </span>
                    <span className="text-xs whitespace-nowrap flex-shrink-0 app-muted">
                      {timeAgo(entry.created_at)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
