/**
 * Maestro Admin — backup, import & export.
 *
 * Export all saved content as a JSON file.
 * Import content from a JSON file (validates keys against the registry).
 * Reset all content to registry defaults (deletes from Maestro).
 */

import { useCallback, useRef, useState } from "react";
import { FIELDS, FIELD_MAP } from "@/content/registry";
import { getSaved, loadContent, applySaved } from "@/content/store";
import { maestro } from "@/maestro";
import { useApp } from "@/context/AppContext";
import { can } from "@/lib/permissions";
import Icon from "@/components/icons";

const cardStyle: React.CSSProperties = {
  background: "var(--color-card)",
  border: "1px solid var(--color-border)",
  borderRadius: "var(--radius-lg)",
};

export function BackupPage() {
  const { adminRole } = useApp();
  const canPublish = can(adminRole, "cms:edit_live");
  const fileRef = useRef<HTMLInputElement>(null);
  const [importResult, setImportResult] = useState<{ ok: number; skipped: string[]; error?: string } | null>(null);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  const saved = getSaved();
  const savedCount = Object.keys(saved).length;
  const totalFields = FIELDS.length;

  const handleExport = useCallback(async () => {
    setExporting(true);
    try {
      await loadContent();
      const data = getSaved();
      const json = JSON.stringify(data, null, 2);
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `maestro-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }, []);

  const handleImport = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      setImporting(true);
      setImportResult(null);
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        if (typeof data !== "object" || data === null || Array.isArray(data)) {
          setImportResult({ ok: 0, skipped: [], error: "הקובץ אינו JSON תקין" });
          return;
        }

        const valid: Record<string, unknown> = {};
        const skipped: string[] = [];
        for (const [key, value] of Object.entries(data)) {
          if (FIELD_MAP[key]) {
            valid[key] = value;
          } else {
            skipped.push(key);
          }
        }

        if (!Object.keys(valid).length) {
          setImportResult({ ok: 0, skipped, error: "אף מפתח לא תואם לרישום" });
          return;
        }

        const res = await maestro.content.saveMany(valid);
        if (res.error) {
          setImportResult({ ok: 0, skipped, error: res.error.message });
          return;
        }

        applySaved(valid);
        setImportResult({ ok: Object.keys(valid).length, skipped });
      } catch {
        setImportResult({ ok: 0, skipped: [], error: "שגיאה בפרסור הקובץ" });
      } finally {
        setImporting(false);
        if (fileRef.current) fileRef.current.value = "";
      }
    },
    [],
  );

  const handleResetAll = useCallback(async () => {
    if (!confirmReset) {
      setConfirmReset(true);
      return;
    }
    setResetting(true);
    try {
      const keys = Object.keys(getSaved());
      if (!keys.length) return;
      const res = await maestro.content.reset(keys);
      if (res.error) {
        alert(`שגיאה: ${res.error.message}`);
        return;
      }
      applySaved({}, keys);
      setConfirmReset(false);
    } finally {
      setResetting(false);
    }
  }, [confirmReset]);

  const btnBase = "rounded-lg px-4 py-2 text-sm font-medium transition-all";

  return (
    <div dir="rtl">
      <div className="mb-6 flex items-center gap-3">
        <Icon name="box" size={24} />
        <h1 className="text-2xl font-bold" style={{ color: "var(--color-foreground)" }}>גיבוי ושחזור</h1>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {/* Stats */}
        <div className="p-4" style={cardStyle}>
          <h3 className="mb-3 text-sm font-medium flex items-center gap-2" style={{ color: "var(--color-muted-foreground)" }}>
            <Icon name="chart" size={14} />
            מצב נוכחי
          </h3>
          <div className="space-y-2">
            {[
              { label: "שדות ברישום", value: totalFields },
              { label: "שדות שנערכו", value: savedCount, accent: true },
              { label: "ברירות מחדל", value: totalFields - savedCount },
            ].map((row) => (
              <div key={row.label} className="flex justify-between text-sm">
                <span style={{ color: "var(--color-muted-foreground)" }}>{row.label}</span>
                <span className="font-bold" style={{ color: row.accent ? "var(--color-primary)" : "var(--color-foreground)" }}>
                  {row.value}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Export */}
        <div className="p-4" style={cardStyle}>
          <h3 className="mb-2 text-sm font-medium flex items-center gap-2" style={{ color: "var(--color-muted-foreground)" }}>
            <Icon name="download" size={14} />
            ייצוא
          </h3>
          <p className="mb-3 text-xs" style={{ color: "var(--color-muted-foreground)", opacity: 0.6 }}>
            הורדת כל התוכן כקובץ JSON. מתאים לגיבוי או להעברה בין סביבות.
          </p>
          <button
            onClick={handleExport}
            disabled={exporting || !savedCount}
            className={btnBase}
            style={{ background: "var(--color-primary)", color: "var(--color-primary-foreground)", opacity: exporting || !savedCount ? 0.5 : 1 }}
          >
            {exporting ? "מייצא…" : `ייצוא ${savedCount} שדות`}
          </button>
        </div>

        {/* Import */}
        <div className="p-4" style={cardStyle}>
          <h3 className="mb-2 text-sm font-medium flex items-center gap-2" style={{ color: "var(--color-muted-foreground)" }}>
            <Icon name="upload" size={14} />
            ייבוא
          </h3>
          <p className="mb-3 text-xs" style={{ color: "var(--color-muted-foreground)", opacity: 0.6 }}>
            ייבוא תוכן מקובץ JSON. מפתחות לא מוכרים ידולגו.
            {canPublish ? "" : " (צריך הרשאת פרסום)"}
          </p>
          <label
            className="inline-block cursor-pointer rounded-lg px-4 py-2 text-sm font-medium transition-all hover:opacity-80"
            style={{ background: "var(--color-success)", color: "#fff", opacity: importing || !canPublish ? 0.5 : 1 }}
          >
            {importing ? "מייבא…" : "בחר קובץ JSON"}
            <input
              ref={fileRef}
              type="file"
              accept=".json,application/json"
              onChange={handleImport}
              disabled={importing || !canPublish}
              className="hidden"
            />
          </label>
          {importResult && (
            <div
              className="mt-3 rounded-lg p-2.5 text-sm"
              style={{
                background: importResult.error ? "rgba(239,68,68,0.1)" : "rgba(34,197,94,0.1)",
                color: importResult.error ? "var(--color-danger)" : "var(--color-success)",
              }}
            >
              {importResult.error && <p>{importResult.error}</p>}
              {importResult.ok > 0 && <p>יובאו {importResult.ok} שדות בהצלחה.</p>}
              {importResult.skipped.length > 0 && (
                <p className="text-xs mt-1" style={{ color: "var(--color-muted-foreground)" }}>
                  דילוג על {importResult.skipped.length} מפתחות לא מוכרים
                </p>
              )}
            </div>
          )}
        </div>

        {/* Reset */}
        <div className="p-4" style={{ ...cardStyle, borderColor: "rgba(239,68,68,0.2)" }}>
          <h3 className="mb-2 text-sm font-medium flex items-center gap-2" style={{ color: "var(--color-danger)" }}>
            <Icon name="alertTriangle" size={14} />
            איפוס כללי
          </h3>
          <p className="mb-3 text-xs" style={{ color: "var(--color-muted-foreground)", opacity: 0.6 }}>
            מחיקת כל התוכן שנערך ושחזור ברירות המחדל. פעולה בלתי הפיכה.
          </p>
          <button
            onClick={handleResetAll}
            disabled={resetting || !savedCount || !canPublish}
            className={btnBase}
            style={{
              background: confirmReset ? "var(--color-danger)" : "rgba(239,68,68,0.8)",
              color: "#fff",
              opacity: resetting || !savedCount || !canPublish ? 0.5 : 1,
              animation: confirmReset ? "pulse 2s infinite" : "none",
            }}
          >
            {confirmReset ? "לחץ שוב לאישור" : resetting ? "מאפס…" : "איפוס הכל"}
          </button>
          {confirmReset && (
            <button
              onClick={() => setConfirmReset(false)}
              className="mr-2 rounded-lg px-3 py-2 text-sm transition-all hover:opacity-80"
              style={{ border: "1px solid var(--color-border)", color: "var(--color-muted-foreground)" }}
            >
              ביטול
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
