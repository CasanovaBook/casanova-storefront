/**
 * Maestro Admin — Products page.
 *
 * Full product management: create, edit, duplicate, archive, delete.
 * Slide-over detail panel with tabbed editing (content, pricing, media, SEO).
 * Quick actions on cards, bulk operations, toast notifications.
 *
 * Reads/writes via maestro.products CRUD API.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { maestro } from "@/maestro";
import Icon from "@/components/icons";
import { toast } from "./toast";
import type { GenericRecord } from "@/maestro/connectors/MaestroConnector";

/* ── label maps ─────────────────────────────────────────────────────── */

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: "פעיל",
  INACTIVE: "לא פעיל",
  DRAFT: "טיוטה",
  ARCHIVED: "בארכיון",
};

const STATUS_COLOR: Record<string, { bg: string; fg: string }> = {
  ACTIVE: { bg: "rgba(34,197,94,0.12)", fg: "var(--color-success)" },
  INACTIVE: { bg: "rgba(107,114,128,0.15)", fg: "var(--color-muted-foreground)" },
  DRAFT: { bg: "rgba(227,174,60,0.12)", fg: "var(--color-primary)" },
  ARCHIVED: { bg: "rgba(239,68,68,0.10)", fg: "var(--color-danger)" },
};

const TYPE_LABEL: Record<string, string> = {
  EBOOK: "ספר דיגיטלי",
  BUNDLE: "חבילה",
  SUBSCRIPTION: "מנוי",
  DIGITAL_PRODUCT: "מוצר דיגיטלי",
  PHYSICAL_PRODUCT: "מוצר פיזי",
  COURSE: "קורס",
  PREMIUM_ACCESS: "גישה לפרימיום",
};

const TYPE_OPTIONS = Object.entries(TYPE_LABEL);

const AVAILABILITY_LABEL: Record<string, string> = {
  AVAILABLE: "זמין",
  OUT_OF_STOCK: "אזל מהמלאי",
  PREORDER: "הזמנה מוקדמת",
};

const CURRENCY_SYMBOL: Record<string, string> = {
  ILS: "₪", USD: "$", EUR: "€", GBP: "£",
};

const VISIBILITY_LABEL: Record<string, string> = {
  PUBLIC: "ציבורי",
  UNLISTED: "מוסתר (קישור בלבד)",
  HIDDEN: "חסוי",
};

/* ── styles ──────────────────────────────────────────────────────────── */

const cardStyle: React.CSSProperties = {
  background: "var(--color-card)",
  border: "1px solid var(--color-border)",
  borderRadius: "var(--radius-lg)",
};

const inputStyle: React.CSSProperties = {
  background: "var(--color-secondary)",
  border: "1px solid var(--color-border)",
  borderRadius: "var(--radius-md)",
  color: "var(--color-foreground)",
  padding: "8px 12px",
  fontSize: 14,
  outline: "none",
  width: "100%",
};

const selectStyle: React.CSSProperties = {
  ...inputStyle,
  width: "auto",
  minWidth: 130,
  cursor: "pointer",
};

const btnPrimary: React.CSSProperties = {
  background: "var(--color-primary)",
  color: "#000",
  border: "none",
  borderRadius: "var(--radius-md)",
  padding: "8px 18px",
  fontWeight: 600,
  fontSize: 14,
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
};

const btnGhost: React.CSSProperties = {
  background: "transparent",
  color: "var(--color-muted-foreground)",
  border: "1px solid var(--color-border)",
  borderRadius: "var(--radius-md)",
  padding: "8px 14px",
  fontWeight: 500,
  fontSize: 13,
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
};

const btnDanger: React.CSSProperties = {
  ...btnGhost,
  color: "var(--color-danger)",
  borderColor: "rgba(239,68,68,0.3)",
};

const fieldLabel: React.CSSProperties = {
  display: "block",
  fontSize: 12,
  fontWeight: 500,
  marginBottom: 4,
  color: "var(--color-muted-foreground)",
};

/* ── helpers ─────────────────────────────────────────────────────────── */

function formatPrice(price: number, currency: string) {
  const sym = CURRENCY_SYMBOL[currency] || currency;
  return `${sym}${price.toFixed(2)}`;
}

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

function pid(r: GenericRecord): string {
  return (r.product_id as string) || r.id;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .trim();
}

/* ── types ───────────────────────────────────────────────────────────── */

type ProductRecord = GenericRecord & {
  product_id?: string;
  name: string;
  slug?: string;
  subtitle?: string;
  description?: string;
  short_description?: string;
  product_type?: string;
  price?: number;
  sale_price?: number | null;
  currency?: string;
  image_url?: string;
  status?: string;
  visibility?: string;
  availability?: string;
  featured?: boolean;
  position?: number;
  tags?: string[];
  inventory?: number | null;
  sku?: string;
  seo_title?: string;
  seo_description?: string;
};

type DetailTab = "content" | "pricing" | "media" | "seo";

/* ── component ───────────────────────────────────────────────────────── */

export function MaestroProductsPage() {
  const [products, setProducts] = useState<ProductRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Detail panel
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailProduct, setDetailProduct] = useState<ProductRecord | null>(null);
  const [detailTab, setDetailTab] = useState<DetailTab>("content");
  const [detailDraft, setDetailDraft] = useState<Partial<ProductRecord>>({});
  const [detailSaving, setDetailSaving] = useState(false);
  const [isNew, setIsNew] = useState(false);

  // Bulk
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Create dialog
  const [showCreate, setShowCreate] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createType, setCreateType] = useState("EBOOK");

  /* ── load ─────────────────────────────────────────────────────── */

  const load = useCallback(async () => {
    try {
      const res = await maestro.products.list({ orderBy: "created_at", orderDir: "desc" });
      if (res.error) {
        setError(res.error.message);
      } else {
        setProducts((res.data ?? []) as ProductRecord[]);
        setError(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "שגיאה בטעינת מוצרים");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    pollRef.current = setInterval(load, 8000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [load]);

  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key && (e.key.includes("product") || e.key.includes("maestro"))) load();
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, [load]);

  /* ── filter ───────────────────────────────────────────────────── */

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p) => {
      if (statusFilter && p.status !== statusFilter) return false;
      if (typeFilter && p.product_type !== typeFilter) return false;
      if (!q) return true;
      const hay = `${p.name} ${p.subtitle ?? ""} ${p.short_description ?? ""} ${(p.tags ?? []).join(" ")}`.toLowerCase();
      return hay.includes(q);
    });
  }, [products, search, statusFilter, typeFilter]);

  /* ── stats ────────────────────────────────────────────────────── */

  const stats = useMemo(() => {
    const total = products.length;
    const active = products.filter((p) => p.status === "ACTIVE").length;
    const draft = products.filter((p) => p.status === "DRAFT").length;
    const featured = products.filter((p) => p.featured).length;
    const revenue = products.reduce((sum, p) => sum + ((p.price ?? 0) * (p.status === "ACTIVE" ? 1 : 0)), 0);
    return { total, active, draft, featured, revenue };
  }, [products]);

  /* ── quick actions ────────────────────────────────────────────── */

  async function quickUpdate(id: string, patch: Partial<ProductRecord>) {
    const res = await maestro.products.update(id, patch as Partial<GenericRecord>);
    if (res.error) {
      toast.error(res.error.message);
    } else {
      await load();
    }
  }

  async function toggleStatus(p: ProductRecord) {
    const next = p.status === "ACTIVE" ? "DRAFT" : "ACTIVE";
    await quickUpdate(pid(p), { status: next });
    toast.success(next === "ACTIVE" ? `פורסם: ${p.name}` : `הוסתר: ${p.name}`);
  }

  async function toggleFeatured(p: ProductRecord) {
    await quickUpdate(pid(p), { featured: !p.featured });
    toast.success(p.featured ? "הוסר מהמוצרים המודגשים" : "מודגש עכשיו");
  }

  async function deleteProduct(p: ProductRecord) {
    if (!confirm(`למחוק את "${p.name}"? פעולה זו בלתי הפיכה.`)) return;
    const res = await maestro.products.delete(pid(p));
    if (res.error) {
      toast.error(res.error.message);
    } else {
      toast.success(`נמחק: ${p.name}`);
      await load();
      if (detailProduct && pid(detailProduct) === pid(p)) {
        setDetailOpen(false);
        setDetailProduct(null);
      }
    }
  }

  async function duplicateProduct(p: ProductRecord) {
    const copy: Record<string, unknown> = {
      name: `${p.name} (עותק)`,
      slug: `${p.slug ?? slugify(p.name)}-copy`,
      product_type: p.product_type ?? "EBOOK",
      price: p.price ?? 0,
      sale_price: p.sale_price ?? null,
      currency: p.currency ?? "ILS",
      status: "DRAFT",
      visibility: "UNLISTED",
      availability: p.availability ?? "AVAILABLE",
      featured: false,
      image_url: p.image_url ?? null,
      subtitle: p.subtitle ?? "",
      description: p.description ?? "",
      short_description: p.short_description ?? "",
      tags: p.tags ?? [],
      inventory: p.inventory ?? null,
      position: (p.position ?? 0) + 1,
    };
    const res = await maestro.products.create(copy as Parameters<typeof maestro.products.create>[0]);
    if (res.error) {
      toast.error(res.error.message);
    } else {
      toast.success(`שוכפל: ${p.name}`);
      await load();
    }
  }

  /* ── create ───────────────────────────────────────────────────── */

  async function handleCreate() {
    if (!createName.trim()) return;
    setSaving(true);
    try {
      const res = await maestro.products.create({
        name: createName.trim(),
        slug: slugify(createName),
        product_type: createType,
        price: 0,
        currency: "ILS",
        status: "DRAFT",
        visibility: "UNLISTED",
        availability: "AVAILABLE",
        featured: false,
      } as Parameters<typeof maestro.products.create>[0]);
      if (res.error) {
        toast.error(res.error.message);
      } else {
        toast.success(`נוצר: ${createName}`);
        setShowCreate(false);
        setCreateName("");
        setCreateType("EBOOK");
        await load();
        // Open the new product for editing
        if (res.data) {
          const newP = res.data as unknown as ProductRecord;
          openDetail(newP);
        }
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "שגיאה ביצירה");
    } finally {
      setSaving(false);
    }
  }

  /* ── detail panel ─────────────────────────────────────────────── */

  function openDetail(p: ProductRecord) {
    setDetailProduct(p);
    setDetailDraft({ ...p });
    setDetailTab("content");
    setIsNew(false);
    setDetailOpen(true);
  }

  function closeDetail() {
    setDetailOpen(false);
    setDetailProduct(null);
    setDetailDraft({});
  }

  async function saveDetail() {
    if (!detailProduct) return;
    setDetailSaving(true);
    try {
      const patch: Record<string, unknown> = {};
      const fields = [
        "name", "slug", "subtitle", "short_description", "description",
        "status", "visibility", "availability", "featured",
        "price", "sale_price", "currency", "inventory", "position",
        "product_type", "image_url", "sku", "tags",
        "seo_title", "seo_description",
      ] as const;
      for (const f of fields) {
        if (detailDraft[f] !== undefined) patch[f] = detailDraft[f];
      }
      const res = await maestro.products.update(pid(detailProduct), patch as Partial<GenericRecord>);
      if (res.error) {
        toast.error(res.error.message);
      } else {
        toast.success("נשמר בהצלחה");
        await load();
        // Update the detail product with fresh data
        const fresh = products.find((p) => pid(p) === pid(detailProduct));
        if (fresh) setDetailProduct(fresh);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "שגיאה בשמירה");
    } finally {
      setDetailSaving(false);
    }
  }

  /* ── bulk actions ─────────────────────────────────────────────── */

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function selectAll() {
    if (selected.size === filtered.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map((p) => pid(p))));
    }
  }

  async function bulkStatus(status: string) {
    if (selected.size === 0) return;
    setSaving(true);
    try {
      for (const id of selected) {
        await maestro.products.update(id, { status } as Partial<GenericRecord>);
      }
      toast.success(`עודכנו ${selected.size} מוצרים`);
      setSelected(new Set());
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "שגיאה");
    } finally {
      setSaving(false);
    }
  }

  /* ── tag editing helper ───────────────────────────────────────── */

  function updateTags(tagStr: string) {
    const tags = tagStr.split(",").map((t) => t.trim()).filter(Boolean);
    setDetailDraft((d) => ({ ...d, tags }));
  }

  /* ── render ───────────────────────────────────────────────────── */

  return (
    <div dir="rtl">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center"
            style={{ background: "linear-gradient(135deg, rgba(227,174,60,0.2), rgba(227,174,60,0.05))" }}
          >
            <Icon name="target" size={20} />
          </div>
          <div>
            <h1 className="text-2xl font-bold" style={{ color: "var(--color-foreground)" }}>
              ניהול מוצרים
            </h1>
            <p className="text-xs" style={{ color: "var(--color-muted-foreground)" }}>
              יצירה, עריכה וניהול קטלוג המוצרים
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => load()} style={btnGhost} disabled={loading}>
            <Icon name="refresh" size={14} />
            רענון
          </button>
          <button
            onClick={() => setShowCreate(true)}
            className="rounded-xl px-5 py-2.5 text-sm font-bold transition-all hover:opacity-90"
            style={{ background: "var(--color-primary)", color: "var(--color-primary-foreground)" }}
          >
            <span className="flex items-center gap-2">
              <span className="text-lg leading-none">+</span>
              מוצר חדש
            </span>
          </button>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 gap-3 mb-5 md:grid-cols-5">
        {[
          { label: "סה״כ", value: stats.total, icon: "box" as const, color: "var(--color-foreground)" },
          { label: "פעילים", value: stats.active, icon: "check" as const, color: "var(--color-success)" },
          { label: "טיוטות", value: stats.draft, icon: "pen" as const, color: "var(--color-primary)" },
          { label: "מודגשים", value: stats.featured, icon: "star" as const, color: "var(--color-primary)" },
          { label: "שווי כולל", value: formatPrice(stats.revenue, "ILS"), icon: "money" as const, color: "var(--color-success)" },
        ].map((s) => (
          <div key={s.label} className="p-3" style={cardStyle}>
            <div className="flex items-center gap-2 mb-1">
              <Icon name={s.icon} size={14} />
              <span className="text-xs font-medium" style={{ color: "var(--color-muted-foreground)" }}>{s.label}</span>
            </div>
            <p className="text-lg font-bold" style={{ color: s.color }}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Search & filters */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative flex-1" style={{ minWidth: 200 }}>
          <span className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: "var(--color-muted-foreground)" }}>
            <Icon name="search" size={16} />
          </span>
          <input
            type="text"
            placeholder="חיפוש לפי שם, תיאור, תגית…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ ...inputStyle, paddingRight: 36 }}
          />
        </div>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={selectStyle}>
          <option value="">כל הסטטוסים</option>
          {Object.entries(STATUS_LABEL).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} style={selectStyle}>
          <option value="">כל הסוגים</option>
          {TYPE_OPTIONS.map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
      </div>

      {/* Bulk actions bar */}
      {selected.size > 0 && (
        <div
          className="flex items-center gap-3 mb-4 px-4 py-2.5 rounded-xl"
          style={{ background: "rgba(227,174,60,0.08)", border: "1px solid rgba(227,174,60,0.2)" }}
        >
          <span className="text-sm font-bold" style={{ color: "var(--color-primary)" }}>
            {selected.size} נבחרו
          </span>
          <div className="flex items-center gap-2 mr-auto">
            <button onClick={() => bulkStatus("ACTIVE")} style={{ ...btnGhost, fontSize: 12, padding: "4px 10px" }} disabled={saving}>
              <Icon name="check" size={12} /> פרסם
            </button>
            <button onClick={() => bulkStatus("DRAFT")} style={{ ...btnGhost, fontSize: 12, padding: "4px 10px" }} disabled={saving}>
              <Icon name="eyeOff" size={12} /> הסתר
            </button>
            <button onClick={() => bulkStatus("ARCHIVED")} style={{ ...btnDanger, fontSize: 12, padding: "4px 10px" }} disabled={saving}>
              <Icon name="box" size={12} /> ארכיון
            </button>
            <button onClick={() => setSelected(new Set())} style={{ ...btnGhost, fontSize: 12, padding: "4px 10px" }}>
              <Icon name="x" size={12} /> נקה
            </button>
          </div>
        </div>
      )}

      {/* Error banner */}
      {error && (
        <div
          className="mb-4 flex items-center gap-2 rounded-lg px-4 py-3 text-sm"
          style={{ background: "rgba(239,68,68,0.10)", color: "var(--color-danger)", border: "1px solid rgba(239,68,68,0.2)" }}
        >
          <Icon name="alertTriangle" size={16} />
          {error}
          <button onClick={() => setError(null)} className="mr-auto" style={{ background: "none", border: "none", cursor: "pointer", color: "inherit" }}>
            <Icon name="x" size={14} />
          </button>
        </div>
      )}

      {/* Loading state */}
      {loading && !products.length && (
        <div className="py-16 text-center" style={{ color: "var(--color-muted-foreground)" }}>
          <Icon name="refresh" size={24} />
          <p className="mt-2 text-sm">טוען מוצרים…</p>
        </div>
      )}

      {/* Empty state */}
      {!loading && !filtered.length && (
        <div className="py-16 text-center" style={cardStyle}>
          <Icon name="inbox" size={32} />
          <p className="mt-3 text-lg font-semibold" style={{ color: "var(--color-foreground)" }}>
            {products.length ? "אין תוצאות לחיפוש זה" : "אין מוצרים עדיין"}
          </p>
          <p className="mt-1 text-sm" style={{ color: "var(--color-muted-foreground)" }}>
            {products.length
              ? "נסה לשנות את הסינון או מונח החיפוש"
              : 'לחץ על "מוצר חדש" כדי להתחיל'}
          </p>
          {!products.length && (
            <button onClick={() => setShowCreate(true)} className="mt-4" style={btnPrimary}>
              <span className="text-lg leading-none">+</span> צור מוצר ראשון
            </button>
          )}
        </div>
      )}

      {/* Product list */}
      {filtered.length > 0 && (
        <div className="space-y-2">
          {/* Select all */}
          <div className="flex items-center gap-2 px-2">
            <label className="flex items-center gap-2 cursor-pointer text-xs" style={{ color: "var(--color-muted-foreground)" }}>
              <input
                type="checkbox"
                checked={selected.size === filtered.length && filtered.length > 0}
                onChange={selectAll}
                style={{ accentColor: "var(--color-primary)" }}
              />
              בחר הכל ({filtered.length})
            </label>
          </div>

          {filtered.map((p) => {
            const id = pid(p);
            const statusColors = STATUS_COLOR[p.status ?? "DRAFT"] ?? STATUS_COLOR.DRAFT;
            const price = typeof p.price === "number" ? p.price : 0;
            const salePrice = typeof p.sale_price === "number" ? p.sale_price : null;
            const currency = (p.currency as string) || "ILS";
            const img = p.image_url as string | undefined;

            return (
              <div
                key={id}
                className="flex items-center gap-3 p-3 transition-all hover:border-opacity-60 group"
                style={{ ...cardStyle, borderColor: selected.has(id) ? "var(--color-primary)" : "var(--color-border)" }}
              >
                {/* Checkbox */}
                <input
                  type="checkbox"
                  checked={selected.has(id)}
                  onChange={() => toggleSelect(id)}
                  className="shrink-0"
                  style={{ accentColor: "var(--color-primary)" }}
                />

                {/* Cover image */}
                <div
                  className="shrink-0 flex items-center justify-center overflow-hidden cursor-pointer"
                  style={{
                    width: 56,
                    height: 72,
                    borderRadius: "var(--radius-md)",
                    background: img ? "transparent" : "var(--color-secondary)",
                  }}
                  onClick={() => openDetail(p)}
                >
                  {img ? (
                    <img src={img} alt={p.name} className="w-full h-full object-cover" style={{ borderRadius: "var(--radius-md)" }} />
                  ) : (
                    <Icon name="book" size={20} />
                  )}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0 cursor-pointer" onClick={() => openDetail(p)}>
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-bold truncate" style={{ color: "var(--color-foreground)" }}>
                      {p.name}
                    </h3>
                    {p.featured && (
                      <span className="rounded-full px-1.5 py-0.5 text-[10px] font-medium" style={{ background: "rgba(227,174,60,0.12)", color: "var(--color-primary)" }}>
                        מודגש
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1 text-xs" style={{ color: "var(--color-muted-foreground)" }}>
                    {p.product_type && (
                      <span>{TYPE_LABEL[p.product_type] ?? p.product_type}</span>
                    )}
                    <span className="font-mono" dir="ltr">
                      {salePrice !== null && salePrice < price ? (
                        <>
                          <span style={{ textDecoration: "line-through", opacity: 0.5 }}>{formatPrice(price, currency)}</span>
                          {" "}
                          <span style={{ color: "var(--color-primary)", fontWeight: 600 }}>{formatPrice(salePrice, currency)}</span>
                        </>
                      ) : (
                        <span style={{ color: "var(--color-foreground)", fontWeight: 600 }}>{formatPrice(price, currency)}</span>
                      )}
                    </span>
                    {p.availability && p.availability !== "AVAILABLE" && (
                      <span style={{ color: "var(--color-danger)" }}>{AVAILABILITY_LABEL[p.availability]}</span>
                    )}
                    {p.tags && p.tags.length > 0 && (
                      <span className="truncate">
                        {p.tags.slice(0, 2).map((t) => `#${t}`).join(" ")}
                        {p.tags.length > 2 && ` +${p.tags.length - 2}`}
                      </span>
                    )}
                  </div>
                </div>

                {/* Status badge */}
                <span
                  className="shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold cursor-pointer"
                  style={{ background: statusColors.bg, color: statusColors.fg }}
                  onClick={() => toggleStatus(p)}
                  title="לחץ לשינוי סטטוס"
                >
                  {STATUS_LABEL[p.status ?? "DRAFT"] ?? p.status}
                </span>

                {/* Quick actions (visible on hover) */}
                <div className="shrink-0 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => toggleFeatured(p)}
                    className="p-1.5 rounded-lg transition-colors hover:bg-white/5"
                    style={{ color: p.featured ? "var(--color-primary)" : "var(--color-muted-foreground)" }}
                    title={p.featured ? "הסר הדגשה" : "הדגש"}
                  >
                    <Icon name="star" size={14} />
                  </button>
                  <button
                    onClick={() => duplicateProduct(p)}
                    className="p-1.5 rounded-lg transition-colors hover:bg-white/5"
                    style={{ color: "var(--color-muted-foreground)" }}
                    title="שכפל"
                  >
                    <Icon name="layers" size={14} />
                  </button>
                  <button
                    onClick={() => deleteProduct(p)}
                    className="p-1.5 rounded-lg transition-colors hover:bg-white/5"
                    style={{ color: "var(--color-muted-foreground)" }}
                    title="מחק"
                  >
                    <Icon name="x" size={14} />
                  </button>
                </div>

                {/* Edit button */}
                <button
                  onClick={() => openDetail(p)}
                  className="shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium transition-all hover:opacity-80"
                  style={{ background: "var(--color-secondary)", color: "var(--color-primary)" }}
                >
                  עריכה
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Sync indicator */}
      <div className="mt-6 flex items-center justify-center gap-2 text-xs" style={{ color: "var(--color-muted-foreground)", opacity: 0.5 }}>
        <span className="inline-block w-2 h-2 rounded-full" style={{ background: "var(--color-success)" }} />
        מחובר ישירות ל-CRM — נתונים משותפים דרך מסד הנתונים
      </div>

      {/* ── Create Dialog ──────────────────────────────────────────── */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto overscroll-contain p-4" style={{ background: "rgba(0,0,0,0.6)" }}>
          <div className="w-full max-w-md p-6 my-auto" style={{ ...cardStyle, background: "var(--color-card)" }}>
            <div className="flex items-center gap-2 mb-5">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "rgba(227,174,60,0.15)" }}>
                <span className="text-lg font-bold" style={{ color: "var(--color-primary)" }}>+</span>
              </div>
              <h2 className="text-lg font-bold" style={{ color: "var(--color-foreground)" }}>מוצר חדש</h2>
              <button onClick={() => setShowCreate(false)} className="mr-auto p-1" style={{ color: "var(--color-muted-foreground)" }}>
                <Icon name="x" size={16} />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label style={fieldLabel}>שם המוצר</label>
                <input
                  value={createName}
                  onChange={(e) => setCreateName(e.target.value)}
                  placeholder="לדוגמה: היא קודם - מהדורה שנייה"
                  style={inputStyle}
                  autoFocus
                  onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                />
              </div>
              <div>
                <label style={fieldLabel}>סוג מוצר</label>
                <select value={createType} onChange={(e) => setCreateType(e.target.value)} style={{ ...inputStyle, cursor: "pointer" }}>
                  {TYPE_OPTIONS.map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex items-center gap-3 mt-6 pt-4" style={{ borderTop: "1px solid var(--color-border)" }}>
              <button onClick={handleCreate} disabled={saving || !createName.trim()} style={{ ...btnPrimary, opacity: saving || !createName.trim() ? 0.5 : 1 }}>
                {saving ? "יוצר…" : "צור מוצר"}
              </button>
              <button onClick={() => setShowCreate(false)} style={btnGhost}>ביטול</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Detail Panel (Slide-over) ──────────────────────────────── */}
      {detailOpen && detailProduct && (
        <DetailPanel
          product={detailProduct}
          draft={detailDraft}
          setDraft={setDetailDraft}
          tab={detailTab}
          setTab={setDetailTab}
          saving={detailSaving}
          onSave={saveDetail}
          onClose={closeDetail}
          onDelete={() => deleteProduct(detailProduct)}
          onDuplicate={() => duplicateProduct(detailProduct)}
          isNew={isNew}
          updateTags={updateTags}
        />
      )}
    </div>
  );
}

/* ── Detail Panel ────────────────────────────────────────────────────── */

function DetailPanel({
  product,
  draft,
  setDraft,
  tab,
  setTab,
  saving,
  onSave,
  onClose,
  onDelete,
  onDuplicate,
  updateTags,
}: {
  product: ProductRecord;
  draft: Partial<ProductRecord>;
  setDraft: React.Dispatch<React.SetStateAction<Partial<ProductRecord>>>;
  tab: DetailTab;
  setTab: (t: DetailTab) => void;
  saving: boolean;
  onSave: () => void;
  onClose: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  isNew: boolean;
  updateTags: (s: string) => void;
}) {
  const tabs: { id: DetailTab; label: string; icon: Parameters<typeof Icon>[0]["name"] }[] = [
    { id: "content", label: "תוכן", icon: "pen" },
    { id: "pricing", label: "מחיר ומלאי", icon: "money" },
    { id: "media", label: "מדיה", icon: "eye" },
    { id: "seo", label: "SEO", icon: "search" },
  ];

  const statusColors = STATUS_COLOR[draft.status ?? "DRAFT"] ?? STATUS_COLOR.DRAFT;

  return (
    <div className="fixed inset-0 z-50 flex" dir="rtl">
      {/* Backdrop */}
      <div className="absolute inset-0" style={{ background: "rgba(0,0,0,0.5)" }} onClick={onClose} />

      {/* Panel */}
      <div
        className="relative mr-auto h-full w-full max-w-2xl overflow-y-auto shadow-2xl"
        style={{ background: "var(--color-background)", borderRight: "1px solid var(--color-border)" }}
      >
        {/* Header */}
        <div
          className="sticky top-0 z-10 flex items-center gap-3 px-6 py-4"
          style={{ background: "var(--color-card)", borderBottom: "1px solid var(--color-border)" }}
        >
          <h2 className="text-lg font-bold truncate flex-1" style={{ color: "var(--color-foreground)" }}>
            {draft.name || product.name}
          </h2>
          <span className="shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold" style={{ background: statusColors.bg, color: statusColors.fg }}>
            {STATUS_LABEL[draft.status ?? "DRAFT"] ?? draft.status}
          </span>
          <button onClick={onClose} className="p-1.5 rounded-lg transition-colors hover:bg-white/5" style={{ color: "var(--color-muted-foreground)" }}>
            <Icon name="x" size={18} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 px-6 py-3" style={{ borderBottom: "1px solid var(--color-border)" }}>
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all"
              style={{
                background: tab === t.id ? "rgba(227,174,60,0.1)" : "transparent",
                color: tab === t.id ? "var(--color-primary)" : "var(--color-muted-foreground)",
              }}
            >
              <Icon name={t.icon} size={14} />
              {t.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="p-6 space-y-5">
          {tab === "content" && (
            <ContentTab draft={draft} setDraft={setDraft} updateTags={updateTags} />
          )}
          {tab === "pricing" && (
            <PricingTab draft={draft} setDraft={setDraft} />
          )}
          {tab === "media" && (
            <MediaTab draft={draft} setDraft={setDraft} />
          )}
          {tab === "seo" && (
            <SeoTab draft={draft} setDraft={setDraft} />
          )}
        </div>

        {/* Footer actions */}
        <div
          className="sticky bottom-0 flex items-center gap-3 px-6 py-4 flex-wrap"
          style={{ background: "var(--color-card)", borderTop: "1px solid var(--color-border)" }}
        >
          <button onClick={onSave} disabled={saving} style={{ ...btnPrimary, opacity: saving ? 0.6 : 1 }}>
            {saving && <span className="w-3.5 h-3.5 rounded-full border-2 border-current border-t-transparent animate-spin" />}
            {saving ? "שומר…" : "שמירה"}
          </button>
          <button onClick={onClose} style={btnGhost}>ביטול</button>
          <div className="mr-auto flex items-center gap-2">
            <button onClick={onDuplicate} style={{ ...btnGhost, fontSize: 12 }}>
              <Icon name="layers" size={12} /> שכפל
            </button>
            <button onClick={onDelete} style={{ ...btnDanger, fontSize: 12 }}>
              <Icon name="x" size={12} /> מחק
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Tab: Content ────────────────────────────────────────────────────── */

function ContentTab({
  draft,
  setDraft,
  updateTags,
}: {
  draft: Partial<ProductRecord>;
  setDraft: React.Dispatch<React.SetStateAction<Partial<ProductRecord>>>;
  updateTags: (s: string) => void;
}) {
  return (
    <div className="space-y-4">
      <div>
        <label style={fieldLabel}>שם המוצר</label>
        <input
          value={(draft.name as string) ?? ""}
          onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
          style={inputStyle}
        />
      </div>

      <div>
        <label style={fieldLabel}>Slug (כתובת URL)</label>
        <input
          value={(draft.slug as string) ?? ""}
          onChange={(e) => setDraft((d) => ({ ...d, slug: e.target.value }))}
          style={{ ...inputStyle, direction: "ltr", textAlign: "left", fontFamily: "monospace" }}
          placeholder="my-product-name"
        />
      </div>

      <div>
        <label style={fieldLabel}>כותרת משנה</label>
        <input
          value={(draft.subtitle as string) ?? ""}
          onChange={(e) => setDraft((d) => ({ ...d, subtitle: e.target.value }))}
          style={inputStyle}
        />
      </div>

      <div>
        <label style={fieldLabel}>תיאור קצר</label>
        <textarea
          value={(draft.short_description as string) ?? ""}
          onChange={(e) => setDraft((d) => ({ ...d, short_description: e.target.value }))}
          rows={2}
          style={{ ...inputStyle, resize: "vertical" }}
        />
      </div>

      <div>
        <label style={fieldLabel}>תיאור מלא</label>
        <textarea
          value={(draft.description as string) ?? ""}
          onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
          rows={5}
          style={{ ...inputStyle, resize: "vertical" }}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label style={fieldLabel}>סוג מוצר</label>
          <select
            value={(draft.product_type as string) ?? "EBOOK"}
            onChange={(e) => setDraft((d) => ({ ...d, product_type: e.target.value }))}
            style={{ ...inputStyle, cursor: "pointer" }}
          >
            {TYPE_OPTIONS.map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </div>
        <div>
          <label style={fieldLabel}>מק״ט (SKU)</label>
          <input
            value={(draft.sku as string) ?? ""}
            onChange={(e) => setDraft((d) => ({ ...d, sku: e.target.value }))}
            style={{ ...inputStyle, direction: "ltr", textAlign: "left", fontFamily: "monospace" }}
          />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div>
          <label style={fieldLabel}>סטטוס</label>
          <select
            value={(draft.status as string) ?? "DRAFT"}
            onChange={(e) => setDraft((d) => ({ ...d, status: e.target.value }))}
            style={{ ...inputStyle, cursor: "pointer" }}
          >
            {Object.entries(STATUS_LABEL).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </div>
        <div>
          <label style={fieldLabel}>נראות</label>
          <select
            value={(draft.visibility as string) ?? "PUBLIC"}
            onChange={(e) => setDraft((d) => ({ ...d, visibility: e.target.value }))}
            style={{ ...inputStyle, cursor: "pointer" }}
          >
            {Object.entries(VISIBILITY_LABEL).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </div>
        <div>
          <label style={fieldLabel}>זמינות</label>
          <select
            value={(draft.availability as string) ?? "AVAILABLE"}
            onChange={(e) => setDraft((d) => ({ ...d, availability: e.target.value }))}
            style={{ ...inputStyle, cursor: "pointer" }}
          >
            {Object.entries(AVAILABILITY_LABEL).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label style={fieldLabel}>תגיות (מופרד בפסיק)</label>
        <input
          value={(draft.tags ?? []).join(", ")}
          onChange={(e) => updateTags(e.target.value)}
          style={inputStyle}
          placeholder="ספר, דיגיטלי, bestseller"
        />
        {(draft.tags ?? []).length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {(draft.tags ?? []).map((t, i) => (
              <span
                key={i}
                className="rounded-full px-2 py-0.5 text-xs"
                style={{ background: "var(--color-secondary)", color: "var(--color-foreground)" }}
              >
                #{t}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center gap-4">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={draft.featured ?? false}
            onChange={(e) => setDraft((d) => ({ ...d, featured: e.target.checked }))}
            style={{ accentColor: "var(--color-primary)" }}
          />
          <span className="text-sm flex items-center gap-1" style={{ color: "var(--color-foreground)" }}>
            <Icon name="star" size={14} /> מוצר מודגש
          </span>
        </label>
      </div>
    </div>
  );
}

/* ── Tab: Pricing ────────────────────────────────────────────────────── */

function PricingTab({
  draft,
  setDraft,
}: {
  draft: Partial<ProductRecord>;
  setDraft: React.Dispatch<React.SetStateAction<Partial<ProductRecord>>>;
}) {
  const price = typeof draft.price === "number" ? draft.price : 0;
  const salePrice = typeof draft.sale_price === "number" ? draft.sale_price : null;
  const discount = salePrice !== null && salePrice < price && price > 0
    ? Math.round(((price - salePrice) / price) * 100)
    : 0;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label style={fieldLabel}>מחיר (₪)</label>
          <input
            type="number"
            min={0}
            step={0.01}
            value={price}
            onChange={(e) => setDraft((d) => ({ ...d, price: parseFloat(e.target.value) || 0 }))}
            style={{ ...inputStyle, direction: "ltr", textAlign: "right", fontSize: 18, fontWeight: 600 }}
          />
        </div>
        <div>
          <label style={fieldLabel}>מחיר מבצע (₪)</label>
          <input
            type="number"
            min={0}
            step={0.01}
            value={salePrice ?? ""}
            onChange={(e) => setDraft((d) => ({ ...d, sale_price: e.target.value ? parseFloat(e.target.value) : null }))}
            placeholder="ללא"
            style={{ ...inputStyle, direction: "ltr", textAlign: "right", fontSize: 18, fontWeight: 600 }}
          />
        </div>
      </div>

      {discount > 0 && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ background: "rgba(34,197,94,0.08)" }}>
          <Icon name="tag" size={14} />
          <span className="text-sm font-bold" style={{ color: "var(--color-success)" }}>
            הנחה {discount}% — חיסכון {formatPrice(price - salePrice!, draft.currency ?? "ILS")}
          </span>
        </div>
      )}

      <div>
        <label style={fieldLabel}>מטבע</label>
        <select
          value={(draft.currency as string) ?? "ILS"}
          onChange={(e) => setDraft((d) => ({ ...d, currency: e.target.value }))}
          style={{ ...inputStyle, cursor: "pointer", width: "auto" }}
        >
          <option value="ILS">₪ שקל</option>
          <option value="USD">$ דולר</option>
          <option value="EUR">€ אירו</option>
          <option value="GBP">£ ליש״ט</option>
        </select>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label style={fieldLabel}>מלאי (ריק = ללא הגבלה)</label>
          <input
            type="number"
            min={0}
            value={draft.inventory !== null && draft.inventory !== undefined ? draft.inventory : ""}
            onChange={(e) => setDraft((d) => ({ ...d, inventory: e.target.value ? parseInt(e.target.value) : null }))}
            placeholder="ללא הגבלה"
            style={{ ...inputStyle, direction: "ltr", textAlign: "right" }}
          />
        </div>
        <div>
          <label style={fieldLabel}>מיקום בתצוגה</label>
          <input
            type="number"
            min={0}
            value={typeof draft.position === "number" ? draft.position : 0}
            onChange={(e) => setDraft((d) => ({ ...d, position: parseInt(e.target.value) || 0 }))}
            style={{ ...inputStyle, direction: "ltr", textAlign: "right" }}
          />
        </div>
      </div>

      {/* Price summary */}
      <div className="p-4 rounded-xl" style={{ background: "var(--color-secondary)", border: "1px solid var(--color-border)" }}>
        <h4 className="text-xs font-bold mb-3" style={{ color: "var(--color-muted-foreground)" }}>סיכום מחיר</h4>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span style={{ color: "var(--color-muted-foreground)" }}>מחיר מחירון</span>
            <span className="font-mono font-bold" dir="ltr" style={{ color: "var(--color-foreground)" }}>{formatPrice(price, draft.currency ?? "ILS")}</span>
          </div>
          {salePrice !== null && salePrice < price && (
            <>
              <div className="flex justify-between">
                <span style={{ color: "var(--color-muted-foreground)" }}>מחיר מבצע</span>
                <span className="font-mono font-bold" dir="ltr" style={{ color: "var(--color-primary)" }}>{formatPrice(salePrice, draft.currency ?? "ILS")}</span>
              </div>
              <div className="flex justify-between pt-2" style={{ borderTop: "1px solid var(--color-border)" }}>
                <span style={{ color: "var(--color-muted-foreground)" }}>חיסכון ללקוח</span>
                <span className="font-mono font-bold" dir="ltr" style={{ color: "var(--color-success)" }}>{formatPrice(price - salePrice, draft.currency ?? "ILS")} ({discount}%)</span>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Tab: Media ──────────────────────────────────────────────────────── */

function MediaTab({
  draft,
  setDraft,
}: {
  draft: Partial<ProductRecord>;
  setDraft: React.Dispatch<React.SetStateAction<Partial<ProductRecord>>>;
}) {
  const imgUrl = (draft.image_url as string) ?? "";

  return (
    <div className="space-y-5">
      <div>
        <label style={fieldLabel}>כתובת תמונה (URL)</label>
        <input
          value={imgUrl}
          onChange={(e) => setDraft((d) => ({ ...d, image_url: e.target.value }))}
          placeholder="https://example.com/image.jpg"
          style={{ ...inputStyle, direction: "ltr", textAlign: "left", fontFamily: "monospace", fontSize: 13 }}
        />
      </div>

      {/* Image preview */}
      <div
        className="flex items-center justify-center overflow-hidden rounded-xl"
        style={{
          width: "100%",
          height: 280,
          background: imgUrl ? "transparent" : "var(--color-secondary)",
          border: "1px solid var(--color-border)",
        }}
      >
        {imgUrl ? (
          <img
            src={imgUrl}
            alt={draft.name ?? ""}
            className="w-full h-full object-contain"
            onError={(e) => { (e.target as HTMLImageElement).style.opacity = "0.2"; }}
          />
        ) : (
          <div className="text-center" style={{ color: "var(--color-muted-foreground)" }}>
            <Icon name="inbox" size={32} />
            <p className="mt-2 text-sm">אין תמונה</p>
          </div>
        )}
      </div>

      {imgUrl && (
        <button
          onClick={() => setDraft((d) => ({ ...d, image_url: "" }))}
          style={{ ...btnDanger, fontSize: 12 }}
        >
          <Icon name="x" size={12} /> הסר תמונה
        </button>
      )}
    </div>
  );
}

/* ── Tab: SEO ────────────────────────────────────────────────────────── */

function SeoTab({
  draft,
  setDraft,
}: {
  draft: Partial<ProductRecord>;
  setDraft: React.Dispatch<React.SetStateAction<Partial<ProductRecord>>>;
}) {
  const seoTitle = (draft.seo_title as string) ?? (draft.name as string) ?? "";
  const seoDesc = (draft.seo_description as string) ?? (draft.short_description as string) ?? "";

  return (
    <div className="space-y-5">
      <div>
        <label style={fieldLabel}>כותרת SEO</label>
        <input
          value={seoTitle}
          onChange={(e) => setDraft((d) => ({ ...d, seo_title: e.target.value }))}
          style={inputStyle}
        />
        <p className="mt-1 text-xs" style={{ color: seoTitle.length > 60 ? "var(--color-danger)" : "var(--color-muted-foreground)" }}>
          {seoTitle.length}/60 תווים מומלצים
        </p>
      </div>

      <div>
        <label style={fieldLabel}>תיאור SEO</label>
        <textarea
          value={seoDesc}
          onChange={(e) => setDraft((d) => ({ ...d, seo_description: e.target.value }))}
          rows={3}
          style={{ ...inputStyle, resize: "vertical" }}
        />
        <p className="mt-1 text-xs" style={{ color: seoDesc.length > 160 ? "var(--color-danger)" : "var(--color-muted-foreground)" }}>
          {seoDesc.length}/160 תווים מומלצים
        </p>
      </div>

      {/* Google preview */}
      <div className="p-4 rounded-xl" style={{ background: "#fff", border: "1px solid var(--color-border)" }}>
        <p className="text-xs mb-2 font-medium" style={{ color: "#5f6368" }}>תצוגה מקדימה — Google</p>
        <p className="text-lg leading-tight truncate" style={{ color: "#1a0dab" }}>{seoTitle || "שם המוצר"}</p>
        <p className="text-sm truncate" style={{ color: "#006621" }}>
          casanova.co.il/product/{draft.slug ?? "slug"}
        </p>
        <p className="text-sm leading-snug line-clamp-2 mt-1" style={{ color: "#545454" }}>
          {seoDesc || "תיאור המוצר יופיע כאן…"}
        </p>
      </div>
    </div>
  );
}
