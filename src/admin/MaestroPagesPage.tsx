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

const STATUS_COLOR: Record<string, { bg: string; fg: string }> = {
  ACTIVE: { bg: "rgba(34,197,94,0.12)", fg: "var(--color-success)" },
  INACTIVE: { bg: "rgba(107,114,128,0.15)", fg: "var(--color-muted-foreground)" },
  DRAFT: { bg: "rgba(227,174,60,0.12)", fg: "var(--color-primary)" },
  ARCHIVED: { bg: "rgba(239,68,68,0.10)", fg: "var(--color-danger)" },
};

const VISIBILITY_LABEL: Record<string, string> = {
  PUBLIC: "ציבורי", UNLISTED: "מוסתר", HIDDEN: "חסוי",
};

/* ── styles ──────────────────────────────────────────────────────────── */

const card: React.CSSProperties = {
  background: "var(--color-card)",
  border: "1px solid var(--color-border)",
  borderRadius: "var(--radius-lg)",
};

const inp: React.CSSProperties = {
  background: "var(--color-secondary)",
  border: "1px solid var(--color-border)",
  borderRadius: "var(--radius-md)",
  color: "var(--color-foreground)",
  padding: "8px 12px",
  fontSize: 14,
  outline: "none",
  width: "100%",
};

const btnPrimary: React.CSSProperties = {
  background: "var(--color-primary)", color: "#000", border: "none",
  borderRadius: "var(--radius-md)", padding: "8px 18px", fontWeight: 600,
  fontSize: 14, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6,
};

const btnGhost: React.CSSProperties = {
  background: "transparent", color: "var(--color-muted-foreground)",
  border: "1px solid var(--color-border)", borderRadius: "var(--radius-md)",
  padding: "8px 14px", fontWeight: 500, fontSize: 13, cursor: "pointer",
  display: "inline-flex", alignItems: "center", gap: 6,
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
      {/* Header */}
      <div className="mb-6 flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Icon name="layers" size={24} />
          <h1 className="text-2xl font-bold" style={{ color: "var(--color-foreground)" }}>עמודים וקטגוריות</h1>
          <span className="rounded-full px-2.5 py-0.5 text-xs font-semibold"
            style={{ background: "rgba(227,174,60,0.12)", color: "var(--color-primary)" }}>
            {pages.length} עמודים
          </span>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowCatManager(!showCatManager)} style={btnGhost}>
            <Icon name="tag" size={14} />
            {showCatManager ? "הסתר קטגוריות" : "ניהול קטגוריות"}
          </button>
          <button onClick={createPage} style={btnPrimary}>
            <Icon name="pen" size={14} />
            עמוד חדש
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 flex items-center gap-2 rounded-lg px-4 py-3 text-sm"
          style={{ background: "rgba(239,68,68,0.10)", color: "var(--color-danger)", border: "1px solid rgba(239,68,68,0.2)" }}>
          <Icon name="alertTriangle" size={16} />
          {error}
          <button onClick={() => setError(null)} className="mr-auto" style={{ background: "none", border: "none", cursor: "pointer", color: "inherit" }}>
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
      <div className="flex flex-wrap gap-2 mb-5">
        <button
          onClick={() => setActiveCat(null)}
          className="rounded-full px-3 py-1.5 text-sm font-medium transition-all"
          style={{
            background: !activeCat ? "var(--color-primary)" : "var(--color-secondary)",
            color: !activeCat ? "#000" : "var(--color-muted-foreground)",
          }}
        >
          הכל ({pages.length})
        </button>
        {categories.map((c) => (
          <button
            key={c.id}
            onClick={() => setActiveCat(c.id)}
            className="rounded-full px-3 py-1.5 text-sm font-medium transition-all"
            style={{
              background: activeCat === c.id ? "var(--color-primary)" : "var(--color-secondary)",
              color: activeCat === c.id ? "#000" : "var(--color-muted-foreground)",
            }}
          >
            {c.name} ({catPageCount.get(c.id) ?? 0})
          </button>
        ))}
        <button
          onClick={() => setActiveCat("__none__")}
          className="rounded-full px-3 py-1.5 text-sm font-medium transition-all"
          style={{
            background: activeCat === "__none__" ? "var(--color-primary)" : "var(--color-secondary)",
            color: activeCat === "__none__" ? "#000" : "var(--color-muted-foreground)",
          }}
        >
          ללא קטגוריה ({catPageCount.get("__none__") ?? 0})
        </button>
      </div>

      {/* Pages list */}
      {loading && !pages.length ? (
        <div className="py-16 text-center" style={{ color: "var(--color-muted-foreground)" }}>
          <Icon name="refresh" size={24} />
          <p className="mt-2 text-sm">טוען עמודים…</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-16 text-center" style={card}>
          <Icon name="inbox" size={32} />
          <p className="mt-3 text-lg font-semibold" style={{ color: "var(--color-foreground)" }}>
            {pages.length ? "אין עמודים בקטגוריה זו" : "אין עמודים עדיין"}
          </p>
          <p className="mt-1 text-sm" style={{ color: "var(--color-muted-foreground)" }}>
            לחצו על "עמוד חדש" כדי ליצור את העמוד הראשון
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((p) => {
            const sc = STATUS_COLOR[p.status] ?? STATUS_COLOR.DRAFT;
            const cat = p.category_id ? catMap.get(p.category_id) : null;
            return (
              <div key={p.id} className="flex items-stretch gap-4 p-4 transition-all hover:border-opacity-60" style={card}>
                {/* Cover */}
                <div className="shrink-0 flex items-center justify-center overflow-hidden"
                  style={{ width: 64, height: 80, borderRadius: "var(--radius-md)", background: p.cover_image ? "transparent" : "var(--color-secondary)" }}>
                  {p.cover_image ? (
                    <img src={p.cover_image} alt={p.title} className="w-full h-full object-cover" style={{ borderRadius: "var(--radius-md)" }} />
                  ) : (
                    <Icon name="bookOpen" size={20} />
                  )}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="text-base font-bold truncate" style={{ color: "var(--color-foreground)" }}>{p.title || "ללא כותרת"}</h3>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="rounded-full px-2 py-0.5 text-xs font-semibold" style={{ background: sc.bg, color: sc.fg }}>
                        {STATUS_LABEL[p.status] ?? p.status}
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-xs" style={{ color: "var(--color-muted-foreground)" }}>
                    {p.slug && (
                      <span className="flex items-center gap-1 font-mono" dir="ltr">
                        <Icon name="link" size={12} />
                        /pages/{p.slug}
                      </span>
                    )}
                    {cat && (
                      <span className="flex items-center gap-1">
                        <Icon name="tag" size={12} />
                        {cat.name}
                      </span>
                    )}
                    {p.visibility !== "PUBLIC" && (
                      <span className="flex items-center gap-1">
                        <Icon name="eyeOff" size={12} />
                        {VISIBILITY_LABEL[p.visibility]}
                      </span>
                    )}
                    {p.updated_at && (
                      <span className="flex items-center gap-1"><Icon name="clock" size={12} />{timeAgo(p.updated_at)}</span>
                    )}
                  </div>
                  {p.excerpt && (
                    <p className="mt-2 text-xs line-clamp-2" style={{ color: "var(--color-muted-foreground)", opacity: 0.7 }}>{p.excerpt}</p>
                  )}
                </div>

                {/* Actions */}
                <div className="shrink-0 self-center flex gap-2">
                  <button onClick={() => { setEditingPage(p); setIsNew(false); }}
                    className="rounded-lg px-3 py-2 text-sm font-medium transition-all hover:opacity-80"
                    style={{ background: "var(--color-secondary)", color: "var(--color-primary)" }}>
                    <Icon name="pen" size={14} /> עריכה
                  </button>
                  <button onClick={() => deletePage(p.id)}
                    className="rounded-lg px-2 py-2 text-sm transition-all hover:opacity-70"
                    style={{ background: "rgba(239,68,68,0.08)", color: "var(--color-danger)" }}>
                    <Icon name="x" size={14} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Sync indicator */}
      <div className="mt-6 flex items-center justify-center gap-2 text-xs" style={{ color: "var(--color-muted-foreground)", opacity: 0.5 }}>
        <span className="inline-block w-2 h-2 rounded-full" style={{ background: "var(--color-success)" }} />
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

  const fieldStyle: React.CSSProperties = { ...inp, fontSize: 13, padding: "6px 10px" };

  return (
    <div dir="rtl">
      {/* Header */}
      <div className="mb-5 flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <button onClick={onCancel} style={btnGhost}><Icon name="arrowRight" size={14} /> חזרה</button>
          <h1 className="text-xl font-bold" style={{ color: "var(--color-foreground)" }}>
            {isNew ? "עמוד חדש" : "עריכת עמוד"}
          </h1>
        </div>
        <button onClick={() => onSave(draft)} disabled={saving || !draft.title.trim()}
          style={{ ...btnPrimary, opacity: saving || !draft.title.trim() ? 0.5 : 1 }}>
          {saving ? <Icon name="refresh" size={14} /> : <Icon name="check" size={14} />}
          {saving ? "שומר…" : "שמירה ופרסום"}
        </button>
      </div>

      {error && (
        <div className="mb-4 flex items-center gap-2 rounded-lg px-4 py-3 text-sm"
          style={{ background: "rgba(239,68,68,0.10)", color: "var(--color-danger)", border: "1px solid rgba(239,68,68,0.2)" }}>
          <Icon name="alertTriangle" size={16} />{error}
          <button
            onClick={onClearError}
            className="mr-auto"
            style={{ background: "none", border: "none", cursor: "pointer", color: "inherit" }}
            aria-label="סגירת הודעת השגיאה"
          >
            <Icon name="x" size={14} />
          </button>
        </div>
      )}

      {/* Title + slug row */}
      <div className="grid grid-cols-1 gap-3 mb-4 md:grid-cols-3">
        <div className="md:col-span-2">
          <label className="block text-xs font-medium mb-1" style={{ color: "var(--color-muted-foreground)" }}>כותרת העמוד</label>
          <input value={draft.title} onChange={(e) => { autoSlug.current = true; setDraft({ ...draft, title: e.target.value }); }}
            placeholder="שם העמוד" style={inp} />
        </div>
        <div>
          <label className="block text-xs font-medium mb-1" style={{ color: "var(--color-muted-foreground)" }}>נתיב (Slug)</label>
          <input value={draft.slug} onChange={(e) => { autoSlug.current = false; setDraft({ ...draft, slug: e.target.value }); }}
            placeholder="my-page" dir="ltr" style={{ ...inp, textAlign: "right" }} />
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4">
        {([["content", "תוכן", "pen" as const], ["seo", "SEO", "search" as const], ["settings", "הגדרות", "settings" as const]] as const).map(([key, label, icon]) => (
          <button key={key} onClick={() => setTab(key)}
            className="rounded-lg px-4 py-2 text-sm font-medium transition-all flex items-center gap-1.5"
            style={{
              background: tab === key ? "var(--color-primary)" : "var(--color-secondary)",
              color: tab === key ? "#000" : "var(--color-muted-foreground)",
            }}>
            <Icon name={icon} size={14} />{label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="p-5" style={card}>
        {tab === "content" && (
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: "var(--color-muted-foreground)" }}>תקציר</label>
              <textarea value={draft.excerpt} onChange={(e) => setDraft({ ...draft, excerpt: e.target.value })}
                rows={2} placeholder="תיאור קצר של העמוד…" style={{ ...fieldStyle, resize: "vertical" }} />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: "var(--color-muted-foreground)" }}>
                תוכן העמוד (Markdown)
              </label>
              <p className="text-xs mb-2" style={{ color: "var(--color-muted-foreground)", opacity: 0.6 }}>
                ## כותרות, פסקאות, - רשימות, **מודגש**, [קישורים](/path), ![](image-url)
              </p>
              <textarea value={draft.content} onChange={(e) => setDraft({ ...draft, content: e.target.value })}
                rows={18} placeholder="כתבו את תוכן העמוד כאן…"
                style={{ ...fieldStyle, fontFamily: "monospace", fontSize: 13, resize: "vertical", lineHeight: 1.6 }} />
            </div>
            {/* Preview */}
            {draft.content && (
              <div>
                <label className="block text-xs font-medium mb-2" style={{ color: "var(--color-muted-foreground)" }}>תצוגה מקדימה</label>
                <div className="rounded-lg p-4 prose-preview" style={{ background: "var(--color-secondary)", border: "1px solid var(--color-border)" }}>
                  <MarkdownPreview content={draft.content} />
                </div>
              </div>
            )}
          </div>
        )}

        {tab === "seo" && (
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: "var(--color-muted-foreground)" }}>כותרת בגוגל (Title)</label>
              <input value={draft.seo_title ?? ""} onChange={(e) => setDraft({ ...draft, seo_title: e.target.value })}
                placeholder={draft.title || "כותרת העמוד"} style={fieldStyle} />
              <p className="text-xs mt-1" style={{ color: "var(--color-muted-foreground)", opacity: 0.5 }}>
                {(draft.seo_title ?? "").length}/60 תווים
              </p>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: "var(--color-muted-foreground)" }}>תיאור בגוגל (Description)</label>
              <textarea value={draft.seo_description ?? ""} onChange={(e) => setDraft({ ...draft, seo_description: e.target.value })}
                rows={3} placeholder="תיאור שיופיע בתוצאות החיפוש" style={{ ...fieldStyle, resize: "vertical" }} />
              <p className="text-xs mt-1" style={{ color: "var(--color-muted-foreground)", opacity: 0.5 }}>
                {(draft.seo_description ?? "").length}/160 תווים
              </p>
            </div>
            {/* Google preview */}
            <div className="rounded-lg p-4" dir="ltr" style={{ background: "var(--color-secondary)", border: "1px solid var(--color-border)" }}>
              <p className="text-xs" style={{ color: "var(--color-success)" }}>
                {window.location.origin}/pages/{draft.slug || "slug"}
              </p>
              <p className="mt-0.5 text-base truncate font-medium" style={{ color: "#8ab4f8" }}>
                {draft.seo_title || draft.title || "ללא כותרת"}
              </p>
              <p className="mt-0.5 text-xs line-clamp-2" style={{ color: "var(--color-muted-foreground)" }}>
                {draft.seo_description || draft.excerpt || "ללא תיאור"}
              </p>
            </div>
          </div>
        )}

        {tab === "settings" && (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: "var(--color-muted-foreground)" }}>קטגוריה</label>
              <select value={draft.category_id ?? ""} onChange={(e) => setDraft({ ...draft, category_id: e.target.value || null })}
                style={{ ...fieldStyle, cursor: "pointer" }}>
                <option value="">ללא קטגוריה</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: "var(--color-muted-foreground)" }}>סטטוס</label>
              <select value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value as CmsPage["status"] })}
                style={{ ...fieldStyle, cursor: "pointer" }}>
                {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: "var(--color-muted-foreground)" }}>נראות</label>
              <select value={draft.visibility} onChange={(e) => setDraft({ ...draft, visibility: e.target.value as CmsPage["visibility"] })}
                style={{ ...fieldStyle, cursor: "pointer" }}>
                {Object.entries(VISIBILITY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: "var(--color-muted-foreground)" }}>סדר תצוגה</label>
              <input type="number" min={0} value={draft.display_order}
                onChange={(e) => setDraft({ ...draft, display_order: parseInt(e.target.value) || 0 })}
                style={{ ...fieldStyle, direction: "ltr", textAlign: "right" }} />
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs font-medium mb-1" style={{ color: "var(--color-muted-foreground)" }}>תמונת cover (URL)</label>
              <input value={draft.cover_image} onChange={(e) => setDraft({ ...draft, cover_image: e.target.value })}
                placeholder="https://…" dir="ltr" style={{ ...fieldStyle, textAlign: "right" }} />
            </div>
          </div>
        )}
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
    <div className="mb-5 p-4" style={{ ...card, borderColor: "var(--color-primary)", borderWidth: 1 }}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-base font-bold flex items-center gap-2" style={{ color: "var(--color-primary)" }}>
          <Icon name="tag" size={16} /> ניהול קטגוריות
        </h3>
        <button
          onClick={onClose}
          style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-muted-foreground)" }}
          aria-label="סגירת ניהול הקטגוריות"
        >
          <Icon name="x" size={16} />
        </button>
      </div>

      {/* Existing categories */}
      <div className="space-y-2 mb-4">
        {categories.map((c) => (
          <div key={c.id} className="flex items-center gap-2 rounded-lg px-3 py-2" style={{ background: "var(--color-secondary)" }}>
            {editId === c.id ? (
              <>
                <input value={editName} onChange={(e) => setEditName(e.target.value)}
                  style={{ ...inp, padding: "4px 8px", fontSize: 13, flex: 1 }} />
                <button onClick={async () => { await onSave({ id: c.id, name: editName, slug: slugify(editName) }); setEditId(null); }}
                  style={{ background: "var(--color-primary)", color: "#000", border: "none", borderRadius: "var(--radius)", padding: "4px 10px", fontSize: 12, cursor: "pointer" }}>
                  <Icon name="check" size={12} />
                </button>
                <button onClick={() => setEditId(null)}
                  style={{ background: "transparent", border: "1px solid var(--color-border)", borderRadius: "var(--radius)", padding: "4px 10px", fontSize: 12, cursor: "pointer", color: "var(--color-muted-foreground)" }}>
                  ביטול
                </button>
              </>
            ) : (
              <>
                <Icon name="tag" size={14} />
                <span className="text-sm font-medium flex-1" style={{ color: "var(--color-foreground)" }}>{c.name}</span>
                <span className="text-xs" style={{ color: "var(--color-muted-foreground)" }}>
                  {pageCounts.get(c.id) ?? 0} עמודים
                </span>
                <button onClick={() => { setEditId(c.id); setEditName(c.name); }}
                  style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-primary)", padding: 2 }}>
                  <Icon name="pen" size={12} />
                </button>
                <button onClick={() => onDelete(c.id)}
                  style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-danger)", padding: 2 }}>
                  <Icon name="x" size={12} />
                </button>
              </>
            )}
          </div>
        ))}
        {!categories.length && (
          <p className="text-sm text-center py-2" style={{ color: "var(--color-muted-foreground)" }}>אין קטגוריות עדיין</p>
        )}
      </div>

      {/* Add new */}
      <div className="flex gap-2 items-end">
        <div className="flex-1">
          <label className="block text-xs mb-1" style={{ color: "var(--color-muted-foreground)" }}>שם קטגוריה חדשה</label>
          <input value={newName} onChange={(e) => setNewName(e.target.value)}
            placeholder="לדוגמה: מדריכים" style={{ ...inp, fontSize: 13, padding: "6px 10px" }}
            onKeyDown={(e) => e.key === "Enter" && handleAdd()} />
        </div>
        <button onClick={handleAdd} disabled={!newName.trim()}
          style={{ ...btnPrimary, opacity: !newName.trim() ? 0.5 : 1, padding: "6px 14px", fontSize: 13 }}>
          <Icon name="check" size={12} /> הוספה
        </button>
      </div>
    </div>
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
    <div className="text-sm leading-relaxed" style={{ color: "var(--color-foreground)" }}
      dangerouslySetInnerHTML={{ __html: html }} />
  );
}
