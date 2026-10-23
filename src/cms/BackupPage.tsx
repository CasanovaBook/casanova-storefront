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
import PageHeader from "@/components/ui/PageHeader";
import Alert from "@/components/ui/Alert";

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

  const statRows = [
    { label: "שדות ברישום", value: totalFields },
    { label: "שדות שנערכו", value: savedCount, accent: true },
    { label: "ברירות מחדל", value: totalFields - savedCount },
  ];

  return (
    <div dir="rtl">
      <PageHeader
        eyebrow="Maestro CMS"
        title="גיבוי ושחזור"
        description="ייצוא וייבוא של תוכן האתר כקובץ JSON, ואיפוס מבוקר של כל השדות שנערכו."
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-6">
        {/* Stats */}
        <section className="app-surface" aria-labelledby="backup-status-title">
          <div className="app-surface-head">
            <h2 id="backup-status-title" className="app-section-title flex items-center gap-2">
              <Icon name="chart" size={16} />
              מצב נוכחי
            </h2>
            <span className="app-badge app-badge--neutral">{savedCount} שדות שנערכו</span>
          </div>
          <div className="app-surface-body">
            <dl className="space-y-2.5">
              {statRows.map((row) => (
                <div key={row.label} className="flex items-center justify-between gap-3 text-sm">
                  <dt className="app-muted">{row.label}</dt>
                  <dd
                    className="font-semibold"
                    style={{ color: row.accent ? "var(--color-primary)" : "var(--color-foreground)" }}
                  >
                    {row.value}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {/* Export */}
        <section className="app-surface" aria-labelledby="backup-export-title">
          <div className="app-surface-head">
            <h2 id="backup-export-title" className="app-section-title flex items-center gap-2">
              <Icon name="download" size={16} />
              ייצוא
            </h2>
          </div>
          <div className="app-surface-body">
            <p className="text-sm app-muted mb-4">
              הורדת כל התוכן כקובץ JSON. מתאים לגיבוי או להעברה בין סביבות.
            </p>
            <button
              type="button"
              onClick={handleExport}
              disabled={exporting || !savedCount}
              className="app-btn"
            >
              <Icon name="download" size={14} />
              {exporting ? "מייצא…" : `ייצוא ${savedCount} שדות`}
            </button>
            {!savedCount && (
              <p className="app-hint mt-2">אין תוכן שנערך לייצוא — כל השדות כבר בברירת המחדל.</p>
            )}
          </div>
        </section>

        {/* Import */}
        <section className="app-surface" aria-labelledby="backup-import-title">
          <div className="app-surface-head">
            <h2 id="backup-import-title" className="app-section-title flex items-center gap-2">
              <Icon name="upload" size={16} />
              ייבוא
            </h2>
            {!canPublish && <span className="app-badge app-badge--warning">נדרשת הרשאת פרסום</span>}
          </div>
          <div className="app-surface-body">
            <p className="text-sm app-muted mb-4">
              ייבוא תוכן מקובץ JSON. מפתחות לא מוכרים ידולגו.
            </p>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={importing || !canPublish}
              className="app-btn-secondary"
            >
              <Icon name="upload" size={14} />
              {importing ? "מייבא…" : "בחירת קובץ JSON"}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".json,application/json"
              onChange={handleImport}
              disabled={importing || !canPublish}
              className="hidden"
              aria-label="קובץ JSON לייבוא"
            />
            {!canPublish && (
              <p className="app-hint mt-2">ייבוא מחייב הרשאת פרסום (cms:edit_live).</p>
            )}

            {importResult && (
              <div className="mt-4">
                {importResult.error ? (
                  <Alert tone="error" title="הייבוא נכשל">
                    {importResult.error}
                    {importResult.skipped.length > 0 && (
                      <p className="mt-1 text-xs">
                        דילוג על {importResult.skipped.length} מפתחות לא מוכרים
                      </p>
                    )}
                  </Alert>
                ) : (
                  <Alert tone="success" title="הייבוא הושלם">
                    יובאו {importResult.ok} שדות בהצלחה.
                    {importResult.skipped.length > 0 && (
                      <p className="mt-1 text-xs">
                        דילוג על {importResult.skipped.length} מפתחות לא מוכרים
                      </p>
                    )}
                  </Alert>
                )}
              </div>
            )}
          </div>
        </section>

        {/* Reset */}
        <section
          className="app-surface"
          aria-labelledby="backup-reset-title"
          style={{ borderColor: "color-mix(in srgb, var(--color-danger) 30%, var(--color-border))" }}
        >
          <div className="app-surface-head">
            <h2
              id="backup-reset-title"
              className="app-section-title flex items-center gap-2"
              style={{ color: "var(--color-danger)" }}
            >
              <Icon name="alertTriangle" size={16} />
              איפוס כללי
            </h2>
            <span className="app-badge app-badge--danger">פעולה בלתי הפיכה</span>
          </div>
          <div className="app-surface-body">
            <p className="text-sm app-muted mb-4">
              מחיקת כל התוכן שנערך ושחזור ברירות המחדל.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleResetAll}
                disabled={resetting || !savedCount || !canPublish}
                className="app-btn-danger"
              >
                <Icon name="refresh" size={14} />
                {confirmReset ? "לחצו שוב לאישור" : resetting ? "מאפס…" : "איפוס הכל"}
              </button>
              {confirmReset && (
                <button
                  type="button"
                  onClick={() => setConfirmReset(false)}
                  className="app-btn-secondary"
                >
                  ביטול
                </button>
              )}
            </div>
            {confirmReset && (
              <div className="mt-3">
                <Alert tone="warning" title="נדרש אישור נוסף">
                  לחיצה נוספת תמחק את כל {savedCount} השדות שנערכו. אין דרך לשחזר פעולה זו.
                </Alert>
              </div>
            )}
            {!canPublish && (
              <p className="app-hint mt-2">איפוס מחייב הרשאת פרסום (cms:edit_live).</p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
