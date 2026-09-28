/**
 * Maestro Admin — dashboard page.
 *
 * Shows connector info, content statistics, quick links and recent audit entries.
 * Styled to match the Casanova admin design system.
 */

import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { maestro } from "@/maestro";
import { FIELDS, GROUPS, fieldsOfGroup } from "@/content/registry";
import { getSaved, loadContent } from "@/content/store";
import type { AuditEntry } from "@/maestro/core/types";
import Icon from "@/components/icons";

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
  return `לפני ${days} ימים`;
}

const cardStyle: React.CSSProperties = {
  background: "var(--color-card)",
  border: "1px solid var(--color-border)",
  borderRadius: "var(--radius-lg)",
};

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

  return (
    <div dir="rtl">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center"
            style={{ background: "linear-gradient(135deg, rgba(227,174,60,0.2), rgba(227,174,60,0.05))" }}
          >
            <Icon name="layers" size={20} />
          </div>
          <div>
            <h1 className="text-2xl font-bold" style={{ color: "var(--color-foreground)" }}>
              Maestro CMS
            </h1>
            <p className="text-xs" style={{ color: "var(--color-muted-foreground)" }}>
              ניהול תוכן האתר
            </p>
          </div>
        </div>
        <button
          onClick={() => navigate("/HOWAMANTREATSYOU/content")}
          className="rounded-xl px-5 py-2.5 text-sm font-bold transition-all hover:opacity-90"
          style={{ background: "var(--color-primary)", color: "var(--color-primary-foreground)" }}
        >
          <span className="flex items-center gap-2">
            <Icon name="pen" size={14} />
            עריכת תוכן
          </span>
        </button>
      </div>

      {/* Top stats */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4 mb-6">
        <div className="p-4" style={cardStyle}>
          <div className="flex items-center gap-2 mb-2">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: "rgba(227,174,60,0.1)" }}>
              <Icon name="zap" size={14} />
            </div>
            <h3 className="text-xs font-medium" style={{ color: "var(--color-muted-foreground)" }}>Connector</h3>
          </div>
          <p className="text-lg font-bold" style={{ color: "var(--color-foreground)" }}>{connectorName || "…"}</p>
          <p className="text-xs mt-1" style={{ color: shared ? "var(--color-success)" : "var(--color-muted-foreground)", opacity: shared ? 1 : 0.6 }}>
            {shared ? "Supabase · מחובר" : "מקומי (localStorage)"}
          </p>
        </div>

        <div className="p-4" style={cardStyle}>
          <div className="flex items-center gap-2 mb-2">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: healthy === true ? "rgba(34,197,94,0.1)" : "rgba(239,68,68,0.1)" }}>
              <Icon name="shield" size={14} />
            </div>
            <h3 className="text-xs font-medium" style={{ color: "var(--color-muted-foreground)" }}>מצב מערכת</h3>
          </div>
          <p
            className="text-lg font-bold"
            style={{ color: healthy === true ? "var(--color-success)" : healthy === false ? "var(--color-danger)" : "var(--color-muted-foreground)" }}
          >
            {healthy === true ? "תקין ✓" : healthy === false ? "שגיאה ✗" : "בודק…"}
          </p>
        </div>

        <div className="p-4" style={cardStyle}>
          <div className="flex items-center gap-2 mb-2">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: "rgba(227,174,60,0.1)" }}>
              <Icon name="pen" size={14} />
            </div>
            <h3 className="text-xs font-medium" style={{ color: "var(--color-muted-foreground)" }}>שדות שנערכו</h3>
          </div>
          <p className="text-lg font-bold" style={{ color: "var(--color-primary)" }}>{savedCount}</p>
          <div className="mt-1.5 flex items-center gap-2">
            <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: "var(--color-secondary)" }}>
              <div className="h-full rounded-full transition-all" style={{ width: `${editPct}%`, background: "var(--color-primary)" }} />
            </div>
            <span className="text-xs" style={{ color: "var(--color-muted-foreground)" }}>{editPct}%</span>
          </div>
        </div>

        <div className="p-4" style={cardStyle}>
          <div className="flex items-center gap-2 mb-2">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: "rgba(227,174,60,0.1)" }}>
              <Icon name="layers" size={14} />
            </div>
            <h3 className="text-xs font-medium" style={{ color: "var(--color-muted-foreground)" }}>קבוצות תוכן</h3>
          </div>
          <p className="text-lg font-bold" style={{ color: "var(--color-foreground)" }}>{editableGroups.length}</p>
          <p className="text-xs mt-1" style={{ color: "var(--color-muted-foreground)", opacity: 0.6 }}>
            {GROUPS.filter((g) => g.section === "pages").length} עמודים · {GROUPS.filter((g) => g.section === "legal").length} משפטי
          </p>
        </div>
      </div>

      {/* Group cards — direct edit links */}
      <div className="mb-6">
        <h2 className="mb-3 text-base font-bold flex items-center gap-2 px-1" style={{ color: "var(--color-foreground)" }}>
          <Icon name="grid" size={16} />
          עריכה לפי עמוד
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {groupStats.map((g) => {
            const pct = g.total > 0 ? Math.round((g.modified / g.total) * 100) : 0;
            return (
              <button
                key={g.id}
                onClick={() => navigate(`/HOWAMANTREATSYOU/content`, { state: { group: g.id } })}
                className="p-4 text-right transition-all hover:scale-[1.01] hover:shadow-lg"
                style={{ ...cardStyle, cursor: "pointer" }}
              >
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-bold" style={{ color: "var(--color-foreground)" }}>{g.label}</span>
                  <Icon name="arrowLeft" size={14} />
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: "var(--color-secondary)" }}>
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${pct}%`,
                        background: pct > 0 ? "var(--color-primary)" : "var(--color-border)",
                      }}
                    />
                  </div>
                  <span className="text-xs font-medium flex-shrink-0" style={{ color: pct > 0 ? "var(--color-primary)" : "var(--color-muted-foreground)" }}>
                    {g.modified}/{g.total}
                  </span>
                </div>
                {g.path && (
                  <p className="mt-2 text-xs font-mono" dir="ltr" style={{ color: "var(--color-muted-foreground)", opacity: 0.5 }}>
                    {g.path}
                  </p>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Quick links + Recent activity */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <div className="p-5" style={cardStyle}>
          <h2 className="mb-4 text-base font-bold flex items-center gap-2" style={{ color: "var(--color-foreground)" }}>
            <Icon name="link" size={16} />
            קישורים מהירים
          </h2>
          <div className="grid grid-cols-2 gap-2">
            {[
              { href: "/HOWAMANTREATSYOU/content", label: "עריכת תוכן", icon: "layers" as const, desc: "שנה טקסטים ותמונות" },
              { href: "/HOWAMANTREATSYOU/products", label: "ניהול מוצרים", icon: "target" as const, desc: "מוצרים ומחירים" },
              { href: "/HOWAMANTREATSYOU/pages", label: "עמודים", icon: "bookOpen" as const, desc: "עמודים וקטגוריות" },
              { href: "/HOWAMANTREATSYOU/backup", label: "גיבוי", icon: "box" as const, desc: "ייצוא וייבוא" },
              { href: "/HOWAMANTREATSYOU/audit", label: "יומן שינויים", icon: "list" as const, desc: "היסטוריית עריכות" },
              { href: "/HOWAMANTREATSYOU/media", label: "ספריית מדיה", icon: "inbox" as const, desc: "תמונות וקבצים" },
            ].map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="flex flex-col gap-1 rounded-xl p-3 text-right transition-all hover:scale-[1.02]"
                style={{ background: "var(--color-secondary)", border: "1px solid var(--color-border)" }}
              >
                <span className="flex items-center gap-1.5 text-sm font-bold" style={{ color: "var(--color-primary)" }}>
                  <Icon name={link.icon} size={14} />
                  {link.label}
                </span>
                <span className="text-xs" style={{ color: "var(--color-muted-foreground)", opacity: 0.7 }}>{link.desc}</span>
              </a>
            ))}
          </div>
        </div>

        <div className="p-5" style={cardStyle}>
          <h2 className="mb-4 text-base font-bold flex items-center gap-2" style={{ color: "var(--color-foreground)" }}>
            <Icon name="clock" size={16} />
            פעילות אחרונה
          </h2>
          {!recentAudit.length ? (
            <div className="text-center py-8">
              <Icon name="inbox" size={32} />
              <p className="mt-2 text-sm" style={{ color: "var(--color-muted-foreground)" }}>אין פעילות עדיין.</p>
              <p className="text-xs mt-1" style={{ color: "var(--color-muted-foreground)", opacity: 0.6 }}>
                עריכות שאתה מבצע יופיעו כאן.
              </p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {recentAudit.slice(0, 8).map((entry, i) => {
                const colors = ACTION_COLORS[entry.action] ?? { bg: "var(--color-muted)", fg: "var(--color-muted-foreground)" };
                return (
                  <div key={i} className="flex items-center gap-2.5 text-sm">
                    <span
                      className="rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap"
                      style={{ background: colors.bg, color: colors.fg }}
                    >
                      {ACTION_LABELS[entry.action] ?? entry.action}
                    </span>
                    <span className="font-medium" style={{ color: "var(--color-foreground)" }}>
                      {ENTITY_LABELS[entry.entity] ?? entry.entity}
                    </span>
                    <span className="text-xs truncate flex-1 font-mono" dir="ltr" style={{ color: "var(--color-muted-foreground)", opacity: 0.5 }}>
                      {entry.entity_id}
                    </span>
                    <span className="text-xs whitespace-nowrap" style={{ color: "var(--color-muted-foreground)", opacity: 0.5 }}>
                      {timeAgo(entry.created_at)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
