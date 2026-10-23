/**
 * Maestro Admin — Pages & Categories management.
 *
 * Staff can create new content pages, write Markdown content, assign
 * them to categories, set SEO fields and control visibility. Categories
 * are managed inline from a sidebar panel.
 *
 * Data flows through `maestro.cms_pages` and `maestro.cms_categories`
 * — the same collections the public site reads, so a published page
 * appears at /pages/<slug> immediately.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { maestro } from "@/maestro";
import Icon from "@/components/icons";
import type { GenericRecord } from "@/maestro/connectors/MaestroConnector";
import PageHeader from "@/components/ui/PageHeader";
import EmptyState from "@/components/ui/EmptyState";
import Spinner from "@/components/ui/Spinner";
import Alert from "@/components/ui/Alert";

/* ── types ───────────────────────────────────────────────────────────── */

interface CmsPage extends GenericRecord {
  title: string;
  slug: string;
  content: string;
  excerpt: string;
  category_id: string | null;
  cover_image: string;
  seo_title: string | null;
  seo_description: string | null;
  status: "ACTIVE" | "INACTIVE" | "DRAFT" | "ARCHIVED";
  visibility: "PUBLIC" | "UNLISTED" | "HIDDEN";
  display_order: number;
}

interface CmsCategory extends GenericRecord {
  name: string;
  slug: string;
  description: string;
  display_order: number;
}

/* ── constants ───────────────────────────────────────────────────────── */

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: "פעיל", INACTIVE: "לא פעיל", DRAFT: "טיוטה", ARCHIVED: "בארכיון",
};

const STATUS_BADGE: Record<string, string> = {
  ACTIVE: "app-badge--success",
  INACTIVE: "app-badge--neutral",
  DRAFT: "app-badge--accent",
  ARCHIVED: "app-badge--danger",
};

const VISIBILITY_LABEL: Record<string, string> = {
  PUBLIC: "ציבורי", UNLISTED: "מוסתר", HIDDEN: "חסוי",
};

function slugify(s: string) {
  return s.toLowerCase().replace(/[^\w\u0590-\u05FF]+/g, "-").replace(/^-|-$/g, "") || "page";
}

function timeAgo(d: string) {
  const diff = Date.now() - new Date(d).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "עכשיו";
  if (m < 60) return `לפני ${m} דק'`;
  const h = Math.floor(m / 60);
  if (h < 24) return `לפני ${h} שעות`;
  return `לפני ${Math.floor(h / 24)} ימים`;
}

/* ── component ───────────────────────────────────────────────────────── */

export function MaestroPagesPage() {
  const [pages, setPages] = useState<CmsPage[]>([]);
  const [categories, setCategories] = useState<CmsCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeCat, setActiveCat] = useState<string | null>(null); // null = all
  const [editingPage, setEditingPage] = useState<CmsPage | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [showCatManager, setShowCatManager] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /* ── load ─────────────────────────────────────────────────────── */

  const load = useCallback(async () => {
    try {
      const [pRes, cRes] = await Promise.all([
        maestro.cms_pages.list({ orderBy: "display_order", orderDir: "asc" }),
        maestro.cms_categories.list({ orderBy: "display_order", orderDir: "asc" }),
      ]);
      if (pRes.data) setPages(pRes.data as CmsPage[]);
      if (cRes.data) setCategories(cRes.data as CmsCategory[]);
      if (pRes.error) setError(pRes.error.message);
    } catch (e) {
      setError(e instanceof Error ? e.message : "שגיאה");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    pollRef.current = setInterval(load, 10000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [load]);

  /* ── filtered pages ───────────────────────────────────────────── */

  const filtered = useMemo(() => {
    if (!activeCat) return pages;
    return pages.filter((p) => p.category_id === activeCat);
  }, [pages, activeCat]);

  const catMap = useMemo(() => {
    const m = new Map<string, CmsCategory>();
    for (const c of categories) m.set(c.id, c);
    return m;
  }, [categories]);

  const catPageCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of pages) {
      const cid = p.category_id ?? "__none__";
      m.set(cid, (m.get(cid) ?? 0) + 1);
    }
    return m;
  }, [pages]);

  /* ── page CRUD ────────────────────────────────────────────────── */

  function createPage() {
    const blank: CmsPage = {
      id: "", title: "", slug: "", content: "", excerpt: "",
      category_id: activeCat ?? null, cover_image: "",
      seo_title: null, seo_description: null,
      status: "DRAFT", visibility: "PUBLIC", display_order: 0,
      created_at: "", updated_at: "",
    };
    setEditingPage(blank);
    setIsNew(true);
  }

  async function savePage(page: CmsPage) {
    setSaving(true);
    try {
      const data = {
        title: page.title,
        slug: page.slug || slugify(page.title),
        content: page.content,
        excerpt: page.excerpt,
        category_id: page.category_id || null,
        cover_image: page.cover_image,
        seo_title: page.seo_title || null,
        seo_description: page.seo_description || null,
        status: page.status,
        visibility: page.visibility,
        display_order: page.display_order,
      };
      if (isNew) {
        const res = await maestro.cms_pages.create(data as unknown as Partial<GenericRecord>);
        if (res.error) { setError(res.error.message); setSaving(false); return; }
      } else {
        const res = await maestro.cms_pages.update(page.id, data as Partial<GenericRecord>);
        if (res.error) { setError(res.error.message); setSaving(false); return; }
      }
      await load();
      setEditingPage(null);
      setIsNew(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "שגיאה בשמירה");
    } finally {
      setSaving(false);
    }
  }

  async function deletePage(id: string) {
    if (!confirm("למחוק עמוד זה?")) return;
    const res = await maestro.cms_pages.delete(id);
    if (res.error) { setError(res.error.message); return; }
    await load();
  }

  /* ── category CRUD ────────────────────────────────────────────── */

  async function saveCategory(cat: Partial<CmsCategory> & { id?: string }) {
    try {
      if (cat.id && categories.some((c) => c.id === cat.id)) {
        const res = await maestro.cms_categories.update(cat.id, cat as Partial<GenericRecord>);
        if (res.error) { setError(res.error.message); return; }
      } else {
        const res = await maestro.cms_categories.create({
          name: cat.name ?? "", slug: cat.slug ?? slugify(cat.name ?? ""),
          description: cat.description ?? "", display_order: cat.display_order ?? 0,
        } as unknown as Partial<GenericRecord>);
        if (res.error) { setError(res.error.message); return; }
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "שגיאה");
    }
  }

  async function deleteCategory(id: string) {
    if (!confirm("למחוק קטגוריה זו? העמודים שבה ינותקו.")) return;
    const res = await maestro.cms_categories.delete(id);
    if (res.error) { setError(res.error.message); return; }
    if (activeCat === id) setActiveCat(null);
    await load();
  }

  /* ── render ───────────────────────────────────────────────────── */

  if (editingPage) {
    return (
      <PageEditor
        page={editingPage}
        categories={categories}
        isNew={isNew}
        saving={saving}
        error={error}
        onSave={savePage}
        onCancel={() => { setEditingPage(null); setIsNew(false); }}
        onClearError={() => setError(null)}
      />
    );
  }

  return (
    <div dir="rtl">
      <PageHeader
        eyebrow="Maestro CMS · תוכן"
        title="עמודים וקטגוריות"
        description="יצירה ועריכה של עמודי תוכן וקטגוריות. עמודים פעילים מתפרסמים מיד בכתובת /pages/<slug>."
        actions={
          <>
            <button
              type="button"
              onClick={() => setShowCatManager(!showCatManager)}
              className="app-btn-secondary"
              aria-expanded={showCatManager}
            >
              <Icon name="tag" size={14} />
              {showCatManager ? "הסתרת קטגוריות" : "ניהול קטגוריות"}
            </button>
            <button type="button" onClick={createPage} className="app-btn">
              <Icon name="pen" size={14} />
              עמוד חדש
            </button>
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="app-badge app-badge--neutral">{pages.length} עמודים</span>
        <span className="app-badge app-badge--neutral">{categories.length} קטגוריות</span>
      </div>

      {error && (
        <div className="app-alert app-alert--error mb-4" role="alert">
          <Icon name="alertTriangle" size={17} className="app-muted flex-shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1">{error}</div>
          <button
            type="button"
            onClick={() => setError(null)}
            className="app-icon-btn -m-2 flex-shrink-0"
            aria-label="סגירת הודעת השגיאה"
          >
            <Icon name="x" size={14} />
          </button>
        </div>
      )}

      {/* Category manager */}
      {showCatManager && (
        <CategoryManager
          categories={categories}
          pageCounts={catPageCount}
          onSave={saveCategory}
          onDelete={deleteCategory}
          onClose={() => setShowCatManager(false)}
        />
      )}

      {/* Category sidebar pills */}
      <div className="flex flex-wrap gap-2 mb-5" role="group" aria-label="סינון עמודים לפי קטגוריה">
        <button
          type="button"
          onClick={() => setActiveCat(null)}
          className={`app-badge ${!activeCat ? "app-badge--accent" : "app-badge--neutral"}`}
          style={{ cursor: "pointer", minHeight: "2rem" }}
          aria-pressed={!activeCat}
        >
          הכל ({pages.length})
        </button>
        {categories.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => setActiveCat(c.id)}
            className={`app-badge ${activeCat === c.id ? "app-badge--accent" : "app-badge--neutral"}`}
            style={{ cursor: "pointer", minHeight: "2rem" }}
            aria-pressed={activeCat === c.id}
          >
            {c.name} ({catPageCount.get(c.id) ?? 0})
          </button>
        ))}
        <button
          type="button"
          onClick={() => setActiveCat("__none__")}
          className={`app-badge ${activeCat === "__none__" ? "app-badge--accent" : "app-badge--neutral"}`}
          style={{ cursor: "pointer", minHeight: "2rem" }}
          aria-pressed={activeCat === "__none__"}
        >
          ללא קטגוריה ({catPageCount.get("__none__") ?? 0})
        </button>
      </div>

      {/* Pages list */}
      {loading && !pages.length ? (
        <Spinner label="טוען עמודים…" />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon="bookOpen"
          title={pages.length ? "אין עמודים בקטגוריה זו" : "אין עמודים עדיין"}
          description={
            pages.length
              ? "בחרו קטגוריה אחרת או צרו עמוד חדש שיופיע כאן."
              : "צרו את העמוד הראשון כדי להתחיל לפרסם תוכן באתר."
          }
          actions={
            <button type="button" onClick={createPage} className="app-btn">
              <Icon name="pen" size={14} />
              עמוד חדש
            </button>
          }
        />
      ) : (
        <div className="space-y-3">
          {filtered.map((p) => {
            const sc = STATUS_BADGE[p.status] ?? STATUS_BADGE.DRAFT;
            const cat = p.category_id ? catMap.get(p.category_id) : null;
            return (
              <article key={p.id} className="app-surface p-3 sm:p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                  {/* Cover */}
                  <div
                    className="shrink-0 flex items-center justify-center overflow-hidden self-start"
                    style={{
                      width: 64,
                      height: 80,
                      borderRadius: "var(--radius-md)",
                      background: p.cover_image ? "transparent" : "var(--color-secondary)",
                    }}
                  >
                    {p.cover_image ? (
                      <img
                        src={p.cover_image}
                        alt={p.title}
                        className="w-full h-full object-cover"
                        style={{ borderRadius: "var(--radius-md)" }}
                      />
                    ) : (
                      <Icon name="bookOpen" size={20} />
                    )}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <h3 className="text-base font-semibold min-w-0 break-words">{p.title || "ללא כותרת"}</h3>
                      <span className={`app-badge ${sc}`}>
                        {STATUS_LABEL[p.status] ?? p.status}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-xs app-muted">
                      {p.slug && (
                        <span className="flex items-center gap-1 font-mono min-w-0 max-w-full" dir="ltr">
                          <Icon name="link" size={12} className="flex-shrink-0" />
                          <span className="truncate">/pages/{p.slug}</span>
                        </span>
                      )}
                      {cat && (
                        <span className="flex items-center gap-1">
                          <Icon name="tag" size={12} className="flex-shrink-0" />
                          {cat.name}
                        </span>
                      )}
                      {p.visibility !== "PUBLIC" && (
                        <span className="flex items-center gap-1">
                          <Icon name="eyeOff" size={12} className="flex-shrink-0" />
                          {VISIBILITY_LABEL[p.visibility]}
                        </span>
                      )}
                      {p.updated_at && (
                        <span className="flex items-center gap-1">
                          <Icon name="clock" size={12} className="flex-shrink-0" />
                          <time dateTime={p.updated_at}>{timeAgo(p.updated_at)}</time>
                        </span>
                      )}
                    </div>
                    {p.excerpt && (
                      <p className="mt-2 text-xs app-muted line-clamp-2">{p.excerpt}</p>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="shrink-0 flex flex-wrap items-center gap-2 sm:self-center">
                    <button
                      type="button"
                      onClick={() => { setEditingPage(p); setIsNew(false); }}
                      className="app-btn-secondary"
                    >
                      <Icon name="pen" size={14} />
                      עריכה
                    </button>
                    <button
                      type="button"
                      onClick={() => deletePage(p.id)}
                      className="app-btn-ghost"
                      style={{ color: "var(--color-danger)" }}
                      aria-label={`מחיקת העמוד ${p.title || "ללא כותרת"}`}
                    >
                      <Icon name="x" size={14} />
                      מחיקה
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* Sync indicator */}
      <div className="mt-6 flex items-center justify-center gap-2 text-xs app-muted text-center">
        <span className="inline-block w-2 h-2 rounded-full flex-shrink-0" style={{ background: "var(--color-success)" }} />
        עמודים מתפרסמים ב-/pages/&lt;slug&gt; — נתונים משותפים דרך מסד הנתונים
      </div>
    </div>
  );
}

/* ── PageEditor ──────────────────────────────────────────────────────── */

function PageEditor({
  page, categories, isNew, saving, error, onSave, onCancel, onClearError,
}: {
  page: CmsPage;
  categories: CmsCategory[];
  isNew: boolean;
  saving: boolean;
  error: string | null;
  onSave: (p: CmsPage) => void;
  onCancel: () => void;
  onClearError: () => void;
}) {
  const [draft, setDraft] = useState<CmsPage>({ ...page });
  const [tab, setTab] = useState<"content" | "seo" | "settings">("content");
  const autoSlug = useRef(isNew);

  // Auto-generate slug from title for new pages
  useEffect(() => {
    if (autoSlug.current && !draft.id) {
      setDraft((d) => ({ ...d, slug: slugify(d.title) }));
    }
  }, [draft.title]);

  const tabs = [
    ["content", "תוכן", "pen"],
    ["seo", "SEO", "search"],
    ["settings", "הגדרות", "settings"],
  ] as const;

  return (
    <div dir="rtl">
      <PageHeader
        eyebrow="Maestro CMS · עמודים"
        title={isNew ? "עמוד חדש" : "עריכת עמוד"}
        description={isNew ? "הגדירו כותרת, תוכן, SEO ונראות. העמוד יישמר בסטטוס שנבחר." : "עדכנו את תוכן העמוד, הגדרות ה-SEO והנראות שלו."}
        actions={
          <>
            <button type="button" onClick={onCancel} className="app-btn-ghost">
              <Icon name="arrowRight" size={14} />
              חזרה לרשימה
            </button>
            <button
              type="button"
              onClick={() => onSave(draft)}
              disabled={saving || !draft.title.trim()}
              className="app-btn"
            >
              <Icon name={saving ? "refresh" : "check"} size={14} />
              {saving ? "שומר…" : "שמירה ופרסום"}
            </button>
          </>
        }
      />

      {error && (
        <div className="app-alert app-alert--error mb-4" role="alert">
          <Icon name="alertTriangle" size={17} className="app-muted flex-shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1">{error}</div>
          <button
            type="button"
            onClick={onClearError}
            className="app-icon-btn -m-2 flex-shrink-0"
            aria-label="סגירת הודעת השגיאה"
          >
            <Icon name="x" size={14} />
          </button>
        </div>
      )}

      {/* Title + slug row */}
      <div className="grid grid-cols-1 gap-4 mb-4 md:grid-cols-3">
        <div className="app-field md:col-span-2">
          <label htmlFor="page-title" className="app-label">כותרת העמוד</label>
          <input
            id="page-title"
            value={draft.title}
            onChange={(e) => { autoSlug.current = true; setDraft({ ...draft, title: e.target.value }); }}
            placeholder="שם העמוד"
            className="w-full px-3"
          />
        </div>
        <div className="app-field">
          <label htmlFor="page-slug" className="app-label">נתיב (Slug)</label>
          <input
            id="page-slug"
            value={draft.slug}
            onChange={(e) => { autoSlug.current = false; setDraft({ ...draft, slug: e.target.value }); }}
            placeholder="my-page"
            dir="ltr"
            className="w-full px-3 font-mono"
          />
        </div>
      </div>

      {/* Tabs */}
      <div className="app-tabs mb-4" role="tablist" aria-label="אזורי עריכת העמוד">
        {tabs.map(([key, label, icon]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className="app-tab flex items-center gap-1.5"
          >
            <Icon name={icon} size={14} />
            {label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="app-surface">
        <div className="app-surface-body">
          {tab === "content" && (
            <div className="space-y-4">
              <div className="app-field">
                <label htmlFor="page-excerpt" className="app-label">תקציר</label>
                <textarea
                  id="page-excerpt"
                  value={draft.excerpt}
                  onChange={(e) => setDraft({ ...draft, excerpt: e.target.value })}
                  rows={2}
                  placeholder="תיאור קצר של העמוד…"
                  className="w-full px-3 py-2"
                  style={{ resize: "vertical" }}
                />
              </div>
              <div className="app-field">
                <label htmlFor="page-content" className="app-label">תוכן העמוד (Markdown)</label>
                <p className="app-hint">
                  ## כותרות, פסקאות, - רשימות, **מודגש**, [קישורים](/path), ![](image-url)
                </p>
                <textarea
                  id="page-content"
                  value={draft.content}
                  onChange={(e) => setDraft({ ...draft, content: e.target.value })}
                  rows={18}
                  placeholder="כתבו את תוכן העמוד כאן…"
                  className="w-full px-3 py-2 font-mono"
                  style={{ fontSize: 13, resize: "vertical", lineHeight: 1.6 }}
                />
              </div>
              {/* Preview */}
              {draft.content && (
                <div>
                  <p className="app-label mb-2">תצוגה מקדימה</p>
                  <div
                    className="rounded-lg p-4"
                    style={{ background: "var(--color-secondary)", border: "1px solid var(--color-border)" }}
                  >
                    <MarkdownPreview content={draft.content} />
                  </div>
                </div>
              )}
            </div>
          )}

          {tab === "seo" && (
            <div className="space-y-4">
              <div className="app-field">
                <label htmlFor="page-seo-title" className="app-label">כותרת בגוגל (Title)</label>
                <input
                  id="page-seo-title"
                  value={draft.seo_title ?? ""}
                  onChange={(e) => setDraft({ ...draft, seo_title: e.target.value })}
                  placeholder={draft.title || "כותרת העמוד"}
                  className="w-full px-3"
                />
                <p className="app-hint">{(draft.seo_title ?? "").length}/60 תווים</p>
              </div>
              <div className="app-field">
                <label htmlFor="page-seo-desc" className="app-label">תיאור בגוגל (Description)</label>
                <textarea
                  id="page-seo-desc"
                  value={draft.seo_description ?? ""}
                  onChange={(e) => setDraft({ ...draft, seo_description: e.target.value })}
                  rows={3}
                  placeholder="תיאור שיופיע בתוצאות החיפוש"
                  className="w-full px-3 py-2"
                  style={{ resize: "vertical" }}
                />
                <p className="app-hint">{(draft.seo_description ?? "").length}/160 תווים</p>
              </div>
              {/* Google preview */}
              <div
                className="rounded-lg p-4"
                dir="ltr"
                style={{ background: "var(--color-secondary)", border: "1px solid var(--color-border)" }}
                aria-label="תצוגה מקדימה של תוצאת החיפוש בגוגל"
              >
                <p className="text-xs" style={{ color: "var(--color-success)" }}>
                  {window.location.origin}/pages/{draft.slug || "slug"}
                </p>
                <p className="mt-0.5 text-base truncate font-medium" style={{ color: "#8ab4f8" }}>
                  {draft.seo_title || draft.title || "ללא כותרת"}
                </p>
                <p className="mt-0.5 text-xs line-clamp-2 app-muted">
                  {draft.seo_description || draft.excerpt || "ללא תיאור"}
                </p>
              </div>
            </div>
          )}

          {tab === "settings" && (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="app-field">
                <label htmlFor="page-category" className="app-label">קטגוריה</label>
                <select
                  id="page-category"
                  value={draft.category_id ?? ""}
                  onChange={(e) => setDraft({ ...draft, category_id: e.target.value || null })}
                  className="w-full px-3"
                  style={{ cursor: "pointer" }}
                >
                  <option value="">ללא קטגוריה</option>
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div className="app-field">
                <label htmlFor="page-status" className="app-label">סטטוס</label>
                <select
                  id="page-status"
                  value={draft.status}
                  onChange={(e) => setDraft({ ...draft, status: e.target.value as CmsPage["status"] })}
                  className="w-full px-3"
                  style={{ cursor: "pointer" }}
                >
                  {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div className="app-field">
                <label htmlFor="page-visibility" className="app-label">נראות</label>
                <select
                  id="page-visibility"
                  value={draft.visibility}
                  onChange={(e) => setDraft({ ...draft, visibility: e.target.value as CmsPage["visibility"] })}
                  className="w-full px-3"
                  style={{ cursor: "pointer" }}
                >
                  {Object.entries(VISIBILITY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div className="app-field">
                <label htmlFor="page-order" className="app-label">סדר תצוגה</label>
                <input
                  id="page-order"
                  type="number"
                  min={0}
                  value={draft.display_order}
                  onChange={(e) => setDraft({ ...draft, display_order: parseInt(e.target.value) || 0 })}
                  className="w-full px-3"
                  dir="ltr"
                />
              </div>
              <div className="app-field md:col-span-2">
                <label htmlFor="page-cover" className="app-label">תמונת cover (URL)</label>
                <input
                  id="page-cover"
                  value={draft.cover_image}
                  onChange={(e) => setDraft({ ...draft, cover_image: e.target.value })}
                  placeholder="https://…"
                  dir="ltr"
                  className="w-full px-3 font-mono"
                  style={{ fontSize: 13 }}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── CategoryManager ─────────────────────────────────────────────────── */

function CategoryManager({
  categories, pageCounts, onSave, onDelete, onClose,
}: {
  categories: CmsCategory[];
  pageCounts: Map<string, number>;
  onSave: (cat: Partial<CmsCategory> & { id?: string }) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  async function handleAdd() {
    if (!newName.trim()) return;
    await onSave({ name: newName.trim(), slug: slugify(newName.trim()), description: newDesc.trim() });
    setNewName("");
    setNewDesc("");
  }

  return (
    <section
      className="app-surface mb-5"
      style={{ borderColor: "var(--color-primary)" }}
      aria-labelledby="category-manager-title"
    >
      <div className="app-surface-head">
        <h2 id="category-manager-title" className="app-section-title flex items-center gap-2" style={{ color: "var(--color-primary)" }}>
          <Icon name="tag" size={16} /> ניהול קטגוריות
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="app-icon-btn"
          aria-label="סגירת ניהול הקטגוריות"
        >
          <Icon name="x" size={16} />
        </button>
      </div>
      <div className="app-surface-body">
        {/* Existing categories */}
        <div className="space-y-2 mb-4">
          {categories.map((c) => (
            <div key={c.id} className="flex flex-wrap items-center gap-2 rounded-lg px-3 py-2" style={{ background: "var(--color-secondary)" }}>
              {editId === c.id ? (
                <>
                  <label htmlFor={`category-name-${c.id}`} className="sr-only">שם הקטגוריה</label>
                  <input
                    id={`category-name-${c.id}`}
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="flex-1 min-w-0 px-2 py-1"
                    style={{ fontSize: 13 }}
                  />
                  <button
                    type="button"
                    onClick={async () => { await onSave({ id: c.id, name: editName, slug: slugify(editName) }); setEditId(null); }}
                    className="app-btn"
                    style={{ minHeight: "2.25rem", padding: "0.35rem 0.9rem" }}
                    aria-label={`שמירת שם הקטגוריה ${c.name}`}
                  >
                    <Icon name="check" size={12} /> שמירה
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditId(null)}
                    className="app-btn-secondary"
                    style={{ minHeight: "2.25rem", padding: "0.35rem 0.9rem" }}
                  >
                    ביטול
                  </button>
                </>
              ) : (
                <>
                  <Icon name="tag" size={14} className="flex-shrink-0" />
                  <span className="text-sm font-medium flex-1 min-w-0 break-words">{c.name}</span>
                  <span className="text-xs app-muted whitespace-nowrap">
                    {pageCounts.get(c.id) ?? 0} עמודים
                  </span>
                  <button
                    type="button"
                    onClick={() => { setEditId(c.id); setEditName(c.name); }}
                    className="app-icon-btn"
                    style={{ width: "2.25rem", height: "2.25rem" }}
                    aria-label={`עריכת הקטגוריה ${c.name}`}
                  >
                    <Icon name="pen" size={12} />
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(c.id)}
                    className="app-icon-btn"
                    style={{ width: "2.25rem", height: "2.25rem", color: "var(--color-danger)" }}
                    aria-label={`מחיקת הקטגוריה ${c.name}`}
                  >
                    <Icon name="x" size={12} />
                  </button>
                </>
              )}
            </div>
          ))}
          {!categories.length && (
            <p className="text-sm text-center py-2 app-muted">אין קטגוריות עדיין</p>
          )}
        </div>

        {/* Add new */}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="app-field flex-1 min-w-0">
            <label htmlFor="new-category-name" className="app-label">שם קטגוריה חדשה</label>
            <input
              id="new-category-name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="לדוגמה: מדריכים"
              className="w-full px-3"
              style={{ fontSize: 13 }}
              onKeyDown={(e) => e.key === "Enter" && handleAdd()}
            />
          </div>
          <button type="button" onClick={handleAdd} disabled={!newName.trim()} className="app-btn">
            <Icon name="check" size={12} /> הוספה
          </button>
        </div>
      </div>
    </section>
  );
}

/* ── MarkdownPreview (lightweight) ───────────────────────────────────── */

function MarkdownPreview({ content }: { content: string }) {
  const html = useMemo(() => {
    return content
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/^### (.+)$/gm, "<h3>$1</h3>")
      .replace(/^## (.+)$/gm, "<h2>$1</h2>")
      .replace(/^# (.+)$/gm, "<h1>$1</h1>")
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.+?)\*/g, "<em>$1</em>")
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" style="color:var(--color-primary)">$1</a>')
      .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" style="max-width:100%;border-radius:8px;margin:8px 0" />')
      .replace(/^- (.+)$/gm, "<li>$1</li>")
      .replace(/(<li>.*<\/li>)/s, "<ul>$1</ul>")
      .replace(/\n\n/g, "</p><p>")
      .replace(/^(?!<[hulo])(.+)$/gm, (m) => m.startsWith("<") ? m : `<p>${m}</p>`);
  }, [content]);

  return (
    <div
      className="text-sm leading-relaxed [&_h1]:font-display [&_h1]:text-xl [&_h1]:font-semibold [&_h1]:mt-3 [&_h2]:font-display [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:mt-3 [&_h3]:font-semibold [&_h3]:mt-2 [&_p]:my-2 [&_ul]:list-disc [&_ul]:ps-5 [&_ul]:my-2 [&_a]:underline"
      style={{ color: "var(--color-foreground)" }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
