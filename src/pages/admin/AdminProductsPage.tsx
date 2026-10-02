/* ─────────────────────────────────────────────────────────────
 * CMS — catalogue management, authoritative over the hosted catalogue.
 *
 * The list and every save on this page work against the real catalogue:
 * `public.products` / `public.categories` in Supabase when it is
 * configured, and the local document only on an install where it is not.
 * Writes go through the admin RPCs in migrations/0022_admin_product_writes.sql,
 * which re-check `is_admin()` server-side — the buttons below are hidden
 * purely as a convenience. After a successful save the catalogue is
 * re-read, so the storefront, the reader and this list all show what the
 * database now holds.
 *
 * Nothing is synthesised: the list renders the persisted catalogue and
 * shows an empty state when it is empty.
 * ───────────────────────────────────────────────────────────── */

import { useMemo, useRef, useState, type ReactNode } from "react"
import { useCms } from "../../context/CmsContext"
import { useAdmin } from "../../context/AdminContext"
import { can } from "../../lib/permissions"
import { readAssetFile, type Result } from "../../lib/api"
import {
  createContentUploadUrl,
  uploadBookFile,
} from "../../lib/content-storage"
import { isSupabaseConfigured } from "../../lib/supabase"
import { isUuid } from "../../lib/supabase-entitlements"
import { uid } from "../../lib/db"
import type {
  BookMetadata,
  ContentFile,
  MediaLink,
  Product,
  ProductAvailability,
  ProductStatus,
  ProductType,
  ProductVisibility,
  SeoFields,
} from "../../types"
import type { IconName } from "../../components/icons"
import { detectPlatform, toEmbedUrl, PLATFORM_LABEL } from "../../lib/media"
import AccessDenied from "../../components/AccessDenied"
import Modal from "../../components/Modal"
import Icon from "../../components/icons"

const STATUS_LABEL: Record<ProductStatus, string> = {
  ACTIVE: "פעיל",
  INACTIVE: "לא פעיל",
  DRAFT: "טיוטה",
  ARCHIVED: "בארכיון",
}

const TYPE_LABEL: Record<ProductType, string> = {
  EBOOK: "ספר דיגיטלי",
  BUNDLE: "חבילה",
  SUBSCRIPTION: "מנוי",
  DIGITAL_PRODUCT: "מוצר דיגיטלי",
  PHYSICAL_PRODUCT: "מוצר פיזי",
  COURSE: "קורס",
  PREMIUM_ACCESS: "גישה לפרימיום",
}

const VISIBILITY_LABEL: Record<ProductVisibility, string> = {
  PUBLIC: "ציבורי",
  UNLISTED: "מוסתר מהרשימה (קישור בלבד)",
  HIDDEN: "חסוי",
}

const AVAILABILITY_LABEL: Record<ProductAvailability, string> = {
  AVAILABLE: "זמין",
  OUT_OF_STOCK: "אזל מהמלאי",
  PREORDER: "הזמנה מוקדמת",
}

/** Currency codes the storefront formatter understands. */
const CURRENCY_SYMBOL: Record<string, string> = {
  ILS: "₪",
  USD: "$",
  EUR: "€",
  GBP: "£",
}

const FALLBACK_COVER: [string, string] = ["#1A1A2E", "#2A2A3E"]

const inputStyle = {
  background: "var(--color-secondary)",
  borderColor: "var(--color-border)",
  color: "var(--color-foreground)",
} as const

const inputClass = "w-full px-4 py-2.5 rounded-lg border text-sm outline-none"

function StatusBadge({ status }: { status: ProductStatus }) {
  const styles: Record<string, { bg: string, color: string }> = {
    ACTIVE: { bg: "rgba(34,197,94,0.1)", color: "var(--color-success)" },
    INACTIVE: { bg: "rgba(239,68,68,0.1)", color: "var(--color-danger)" },
    DRAFT: { bg: "rgba(245,158,11,0.1)", color: "#F59E0B" },
    ARCHIVED: { bg: "rgba(107,114,128,0.1)", color: "#6B7280" },
  }
  const s = styles[status] ?? styles.ACTIVE
  return (
    <span
      className="text-xs px-2 py-0.5 rounded-full whitespace-nowrap"
      style={{ background: s.bg, color: s.color }}
    >
      {STATUS_LABEL[status] ?? status}
    </span>
  )
}

/** Cover art, falling back to the stored gradient when no image was uploaded. */
function ProductThumb({
  product,
  className,
}: {
  product: Product
  className: string
}) {
  const [from, to] = product.cover_colors ?? FALLBACK_COVER
  if (product.image_url) {
    return (
      <img
        src={product.image_url}
        alt={product.name}
        className={`${className} object-cover`}
      />
    )
  }
  return (
    <div
      className={className}
      style={{ background: `linear-gradient(160deg, ${from}, ${to})` }}
    />
  )
}

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: ReactNode
}) {
  return (
    <div>
      <label
        className="block text-xs font-medium mb-1.5"
        style={{ color: "var(--color-muted-foreground)" }}
      >
        {label}
      </label>
      {children}
      {hint && (
        <p
          className="text-[11px] mt-1 leading-relaxed"
          style={{ color: "var(--color-muted-foreground)" }}
        >
          {hint}
        </p>
      )}
    </div>
  )
}

function Panel({
  icon,
  title,
  children,
}: {
  icon: IconName
  title: string
  children: ReactNode
}) {
  return (
    <div
      className="rounded-lg border p-4"
      style={{ borderColor: "var(--color-border)" }}
    >
      <p
        className="text-xs font-medium mb-3 flex items-center gap-1.5"
        style={{ color: "var(--color-muted-foreground)" }}
      >
        <Icon name={icon} size={13} />
        {title}
      </p>
      {children}
    </div>
  )
}

/** Multi-select over the catalogue, used for bundles / related / upsell / cross-sell. */
function ProductPicker({
  options,
  selected,
  onToggle,
  emptyText,
}: {
  options: Product[]
  selected: string[]
  onToggle: (id: string) => void
  emptyText: string
}) {
  if (options.length === 0) {
    return (
      <p className="text-xs" style={{ color: "var(--color-muted-foreground)" }}>
        {emptyText}
      </p>
    )
  }
  return (
    <div className="grid grid-cols-2 gap-2">
      {options.map((p) => (
        <label
          key={p.product_id}
          className="flex items-center gap-2 text-xs p-2 rounded-lg border cursor-pointer"
          style={{
            borderColor: selected.includes(p.product_id)
              ? "var(--color-primary)"
              : "var(--color-border)",
          }}
        >
          <input
            type="checkbox"
            checked={selected.includes(p.product_id)}
            onChange={() => onToggle(p.product_id)}
          />
          <span className="truncate">{p.name}</span>
        </label>
      ))}
    </div>
  )
}

/* ── Product editor ─────────────────────────────────────── */

interface ProductModalProps {
  product: Product | null
  allProducts: Product[]
  canEditContent: boolean
  canEditPrice: boolean
  maxUploadBytes: number
  defaultCurrency: string
  categories: { category_id: string, name: string }[]
  onClose: () => void
  onSave: (patch: Partial<Product>) => Promise<Result<Product>>
}

function ProductModal({
  product,
  allProducts,
  canEditContent,
  canEditPrice,
  maxUploadBytes,
  defaultCurrency,
  categories,
  onClose,
  onSave,
}: ProductModalProps) {
  const contentInputRef = useRef<HTMLInputElement>(null)
  const coverInputRef = useRef<HTMLInputElement>(null)

  const [form, setForm] = useState({
    name: product?.name ?? "",
    subtitle: product?.subtitle ?? "",
    slug: product?.slug ?? "",
    sku: product?.sku ?? "",
    short_description: product?.short_description ?? "",
    description: product?.description ?? "",
    product_type: (product?.product_type ?? "EBOOK") as ProductType,
    status: (product?.status ?? "DRAFT") as ProductStatus,
    visibility: (product?.visibility ?? "PUBLIC") as ProductVisibility,
    availability: (product?.availability ?? "AVAILABLE") as ProductAvailability,
    price: product ? String(product.price) : "",
    sale_price:
      product?.sale_price !== undefined && product?.sale_price !== null
        ? String(product.sale_price)
        : "",
    currency: product?.currency ?? defaultCurrency,
    inventory:
      product?.inventory === null || product?.inventory === undefined
        ? ""
        : String(product.inventory),
    position: String(product?.position ?? 0),
  })
  const [featured, setFeatured] = useState(product?.featured ?? false)
  const [tagsText, setTagsText] = useState((product?.tags ?? []).join(", "))
  const [categoryIds, setCategoryIds] = useState<string[]>(
    product?.category_ids ?? [],
  )
  const [coverColors, setCoverColors] = useState<[string, string]>(
    product?.cover_colors ?? FALLBACK_COVER,
  )
  const [imageUrl, setImageUrl] = useState(product?.image_url ?? "")
  const [images, setImages] = useState<string[]>(product?.images ?? [])
  const [imageDraft, setImageDraft] = useState("")
  const [contentUrl, setContentUrl] = useState(product?.content_url ?? "")
  const [contentFile, setContentFile] = useState<ContentFile | undefined>(
    product?.content_file,
  )
  /* A brand-new product has no id until it is saved, but a Supabase
   * Storage upload is keyed by product_id. Pre-generate a stable id so the
   * file can be uploaded before the first save; createProduct honours it. */
  const [presetId] = useState(() =>
    isSupabaseConfigured && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : uid("prd"),
  )
  const contentProductId = product?.product_id ?? presetId
  const [storageBucket, setStorageBucket] = useState<string | undefined>(
    product?.storage_bucket,
  )
  const [storagePath, setStoragePath] = useState<string | undefined>(
    product?.storage_path,
  )
  const [mediaLinks, setMediaLinks] = useState<MediaLink[]>(
    product?.media_links ?? [],
  )
  const [linkDraft, setLinkDraft] = useState({ label: "", url: "" })
  const [relatedIds, setRelatedIds] = useState<string[]>(
    product?.related_product_ids ?? [],
  )
  const [upsellIds, setUpsellIds] = useState<string[]>(
    product?.upsell_ids ?? [],
  )
  const [crossSellIds, setCrossSellIds] = useState<string[]>(
    product?.cross_sell_ids ?? [],
  )
  const [bundleIds, setBundleIds] = useState<string[]>(
    product?.bundle_item_ids ?? [],
  )
  const [book, setBook] = useState({
    author_name: product?.book?.author_name ?? "",
    isbn: product?.book?.isbn ?? "",
    publisher: product?.book?.publisher ?? "",
    language: product?.book?.language ?? "",
    publication_date: product?.book?.publication_date ?? "",
    total_pages: product?.book?.total_pages
      ? String(product.book.total_pages)
      : "",
  })
  const [seo, setSeo] = useState({
    title: product?.seo?.title ?? "",
    description: product?.seo?.description ?? "",
    keywords: product?.seo?.keywords ?? "",
  })
  const [saveError, setSaveError] = useState("")
  const [uploadBusy, setUploadBusy] = useState(false)

  const pickers = allProducts.filter(
    (p) => p.product_id !== product?.product_id,
  )
  const isBook = form.product_type === "EBOOK"
  const symbol = CURRENCY_SYMBOL[form.currency] ?? form.currency

  const toggleId = (list: string[], id: string) =>
    list.includes(id) ? list.filter((x) => x !== id) : [...list, id]

  /**
   * Content files go to the private Supabase Storage bucket when Supabase
   * is configured: the CMS asks create-upload-url for a signed upload URL
   * (the object path is derived server-side from the product id), pushes the
   * bytes, and stores only the bucket/path on the product — never a permanent
   * public URL. When Supabase is not configured it falls back to the legacy
   * behaviour of inlining a small file as a data URL, so the editor still
   * works before the backend is wired up.
   */
  const pickContent = async (file: File) => {
    setUploadBusy(true)
    setSaveError("")

    if (isSupabaseConfigured) {
      const target = await createContentUploadUrl(contentProductId, {
        mimeType: file.type || "application/pdf",
        fileSize: file.size,
      })
      if (!target.ok) {
        setUploadBusy(false)
        setSaveError(target.error)
        return
      }
      const uploaded = await uploadBookFile(target.data, file)
      setUploadBusy(false)
      if (!uploaded.ok) {
        setSaveError(uploaded.error)
        return
      }
      setStorageBucket(target.data.bucket)
      setStoragePath(target.data.path)
      // A Storage-hosted file has no permanent address; drop any legacy URL
      // so the reader resolves the signed URL from storage_path instead.
      setContentUrl("")
      setContentFile({
        file_name: file.name,
        file_size_kb: Math.round(file.size / 1024),
        mime_type: file.type || "application/pdf",
        version: target.data.version ?? (contentFile?.version ?? 0) + 1,
        uploaded_at: new Date().toISOString(),
        storage_bucket: target.data.bucket,
        storage_path: target.data.path,
      })
      return
    }

    const result = await readAssetFile(file)
    setUploadBusy(false)
    if (!result.ok) {
      setSaveError(result.error)
      return
    }
    setStorageBucket(undefined)
    setStoragePath(undefined)
    setContentUrl(result.data.url)
    setContentFile({
      file_name: result.data.file_name,
      file_size_kb: result.data.file_size_kb,
      mime_type: result.data.mime_type,
      version: (contentFile?.version ?? 0) + 1,
      uploaded_at: new Date().toISOString(),
    })
  }

  const pickCover = async (file: File) => {
    setUploadBusy(true)
    const result = await readAssetFile(file)
    setUploadBusy(false)
    if (!result.ok) {
      setSaveError(result.error)
      return
    }
    setSaveError("")
    setImageUrl(result.data.url)
  }

  const addLink = () => {
    if (!linkDraft.url.trim()) return
    setMediaLinks((prev) => [
      ...prev,
      {
        media_link_id: `ml_${Date.now().toString(36)}`,
        label: linkDraft.label.trim() || "צפייה חיה",
        url: linkDraft.url.trim(),
        platform: detectPlatform(linkDraft.url),
      },
    ])
    setLinkDraft({ label: "", url: "" })
  }

  const handleSubmit = async () => {
    setSaveError("")
    const price = Number(form.price)
    const saleRaw = form.sale_price.trim()
    const sale = saleRaw === "" ? undefined : Number(saleRaw)
    const inventoryRaw = form.inventory.trim()
    const inventory =
      inventoryRaw === "" ? null : Math.round(Number(inventoryRaw))
    const pagesRaw = book.total_pages.trim()

    if (!form.name.trim()) return setSaveError("שם המוצר חובה.")
    if (form.price.trim() === "" || Number.isNaN(price) || price < 0) {
      return setSaveError("המחיר חייב להיות מספר חיובי.")
    }
    if (sale !== undefined && (Number.isNaN(sale) || sale >= price)) {
      return setSaveError("מחיר המבצע חייב להיות נמוך מהמחיר הרגיל.")
    }
    if (inventory !== null && (Number.isNaN(inventory) || inventory < 0)) {
      return setSaveError("מלאי לא יכול להיות שלילי.")
    }
    if (
      !canEditPrice &&
      product &&
      (price !== product.price || sale !== product.sale_price)
    ) {
      return setSaveError("אין לך הרשאה לשנות מחירים.")
    }
    if (
      !canEditContent &&
      product &&
      (contentUrl !== (product.content_url ?? "") ||
        imageUrl !== (product.image_url ?? ""))
    ) {
      return setSaveError("אין לך הרשאה לשנות קבצי תוכן או תמונות.")
    }

    const bookDraft: BookMetadata = {
      author_name: book.author_name.trim() || undefined,
      isbn: book.isbn.trim() || undefined,
      publisher: book.publisher.trim() || undefined,
      language: book.language.trim() || undefined,
      publication_date: book.publication_date || undefined,
      total_pages:
        pagesRaw === "" || Number.isNaN(Number(pagesRaw))
          ? undefined
          : Math.round(Number(pagesRaw)),
    }
    const seoDraft: SeoFields = {
      title: seo.title.trim() || undefined,
      description: seo.description.trim() || undefined,
      keywords: seo.keywords.trim() || undefined,
    }
    const tags = tagsText
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean)

    const next: Record<string, unknown> = {
      name: form.name.trim(),
      subtitle: form.subtitle.trim() || undefined,
      slug: form.slug.trim() || undefined,
      sku: form.sku.trim() || undefined,
      short_description: form.short_description.trim(),
      description: form.description,
      product_type: form.product_type,
      status: form.status,
      visibility: form.visibility,
      availability: form.availability,
      price,
      sale_price: sale,
      currency: form.currency,
      inventory,
      featured,
      position: Number(form.position) || 0,
      tags: tags.length > 0 ? tags : undefined,
      category_ids: categoryIds.length > 0 ? categoryIds : undefined,
      cover_colors: coverColors,
      image_url: imageUrl.trim() || undefined,
      images: images.length > 0 ? images : undefined,
      product_id: contentProductId,
      content_url: contentUrl.trim() || undefined,
      content_file: contentFile,
      storage_bucket: storagePath ? storageBucket : undefined,
      storage_path: storagePath || undefined,
      media_links: mediaLinks.length > 0 ? mediaLinks : undefined,
      related_product_ids: relatedIds.length > 0 ? relatedIds : undefined,
      upsell_ids: upsellIds.length > 0 ? upsellIds : undefined,
      cross_sell_ids: crossSellIds.length > 0 ? crossSellIds : undefined,
      bundle_item_ids:
        form.product_type === "BUNDLE" && bundleIds.length > 0
          ? bundleIds.filter((id) => id !== product?.product_id)
          : undefined,
      book: isBook ? bookDraft : undefined,
      seo: seoDraft,
    }

    const result = await onSave(diffPatch(product, next))
    if (!result.ok) {
      setSaveError(result.error)
      return
    }
    onClose()
    return undefined
  }

  const maxKb = Math.round(maxUploadBytes / 1024).toLocaleString()

  return (
    <Modal
      size="3xl"
      title={product ? "עריכת מוצר" : "מוצר חדש"}
      onClose={onClose}
    >

        {saveError && (
          <p
            className="text-xs px-3 py-2 rounded-lg mb-4"
            style={{
              background: "rgba(239,68,68,0.1)",
              color: "var(--color-danger)",
            }}
          >
            {saveError}
          </p>
        )}

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="שם המוצר / כותרת הספר">
              <input
                className={inputClass}
                style={inputStyle}
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </Field>
            <Field label="כותרת משנה">
              <input
                className={inputClass}
                style={inputStyle}
                value={form.subtitle}
                onChange={(e) => setForm({ ...form, subtitle: e.target.value })}
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field
              label="כתובת URL (slug)"
              hint="נותר ריק — תיווצר אוטומטית משם המוצר."
            >
              <input
                dir="ltr"
                className={inputClass}
                style={inputStyle}
                placeholder="my-book-title"
                value={form.slug}
                onChange={(e) => setForm({ ...form, slug: e.target.value })}
              />
            </Field>
            <Field label='מק"ט (SKU)'>
              <input
                dir="ltr"
                className={inputClass}
                style={inputStyle}
                value={form.sku}
                onChange={(e) => setForm({ ...form, sku: e.target.value })}
              />
            </Field>
          </div>

          <Field label="תיאור קצר" hint="מופיע בכרטיסי הקטלוג ובתוצאות החיפוש.">
            <input
              className={inputClass}
              style={inputStyle}
              value={form.short_description}
              onChange={(e) =>
                setForm({ ...form, short_description: e.target.value })
              }
            />
          </Field>

          <Field label="תיאור מלא">
            <textarea
              className="w-full px-4 py-2.5 rounded-lg border text-sm outline-none min-h-24 resize-y"
              style={inputStyle}
              value={form.description}
              onChange={(e) =>
                setForm({ ...form, description: e.target.value })
              }
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="סוג מוצר">
              <select
                className={inputClass}
                style={inputStyle}
                value={form.product_type}
                onChange={(e) =>
                  setForm({
                    ...form,
                    product_type: e.target.value as ProductType,
                  })
                }
              >
                {(Object.keys(TYPE_LABEL) as ProductType[]).map((t) => (
                  <option key={t} value={t}>
                    {TYPE_LABEL[t]}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label="סטטוס"
              hint="פעיל = מפורסם בחנות. טיוטה ולא-פעיל מוסתרים מהציבור."
            >
              <select
                className={inputClass}
                style={inputStyle}
                value={form.status}
                onChange={(e) =>
                  setForm({ ...form, status: e.target.value as ProductStatus })
                }
              >
                {(Object.keys(STATUS_LABEL) as ProductStatus[]).map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABEL[s]}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="נראות">
              <select
                className={inputClass}
                style={inputStyle}
                value={form.visibility}
                onChange={(e) =>
                  setForm({
                    ...form,
                    visibility: e.target.value as ProductVisibility,
                  })
                }
              >
                {(Object.keys(VISIBILITY_LABEL) as ProductVisibility[]).map(
                  (v) => (
                    <option key={v} value={v}>
                      {VISIBILITY_LABEL[v]}
                    </option>
                  ),
                )}
              </select>
            </Field>
            <Field label="זמינות">
              <select
                className={inputClass}
                style={inputStyle}
                value={form.availability}
                onChange={(e) =>
                  setForm({
                    ...form,
                    availability: e.target.value as ProductAvailability,
                  })
                }
              >
                {(Object.keys(AVAILABILITY_LABEL) as ProductAvailability[]).map(
                  (a) => (
                    <option key={a} value={a}>
                      {AVAILABILITY_LABEL[a]}
                    </option>
                  ),
                )}
              </select>
            </Field>
          </div>

          <div className="grid grid-cols-4 gap-3">
            <Field label={`מחיר (${symbol})`}>
              <input
                dir="ltr"
                type="number"
                min="0"
                step="1"
                className={inputClass}
                style={inputStyle}
                disabled={!canEditPrice && Boolean(product)}
                value={form.price}
                onChange={(e) => setForm({ ...form, price: e.target.value })}
              />
            </Field>
            <Field label={`מחיר מבצע (${symbol})`}>
              <input
                dir="ltr"
                type="number"
                min="0"
                step="1"
                className={inputClass}
                style={inputStyle}
                disabled={!canEditPrice && Boolean(product)}
                value={form.sale_price}
                onChange={(e) =>
                  setForm({ ...form, sale_price: e.target.value })
                }
              />
            </Field>
            <Field label="מטבע">
              <select
                className={inputClass}
                style={inputStyle}
                value={form.currency}
                onChange={(e) => setForm({ ...form, currency: e.target.value })}
              >
                {Object.keys(CURRENCY_SYMBOL).map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="מלאי" hint="ריק = ללא הגבלה.">
              <input
                dir="ltr"
                type="number"
                min="0"
                step="1"
                className={inputClass}
                style={inputStyle}
                value={form.inventory}
                onChange={(e) =>
                  setForm({ ...form, inventory: e.target.value })
                }
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="מיקום בתצוגה" hint="קובע את סדר המוצרים בקטלוג.">
              <input
                dir="ltr"
                type="number"
                step="1"
                className={inputClass}
                style={inputStyle}
                value={form.position}
                onChange={(e) => setForm({ ...form, position: e.target.value })}
              />
            </Field>
            <div className="flex items-end pb-2">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={featured}
                  onChange={() => setFeatured((v) => !v)}
                />
                מוצר מומלץ (מופיע בקדמת דף הבית)
              </label>
            </div>
          </div>

          <Field
            label="תגיות"
            hint="מופרדות בפסיקים. משמשות לחיפוש ולסינון בחנות."
          >
            <input
              className={inputClass}
              style={inputStyle}
              value={tagsText}
              onChange={(e) => setTagsText(e.target.value)}
            />
          </Field>

          <Panel icon="grid" title="קטגוריות">
            {categories.length === 0 ? (
              <p
                className="text-xs"
                style={{ color: "var(--color-muted-foreground)" }}
              >
                לא הוגדרו קטגוריות — יש ליצור אותן בלוח הקטגוריות שבעמוד זה.
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {categories.map((c) => (
                  <label
                    key={c.category_id}
                    className="flex items-center gap-2 text-xs p-2 rounded-lg border cursor-pointer"
                    style={{
                      borderColor: categoryIds.includes(c.category_id)
                        ? "var(--color-primary)"
                        : "var(--color-border)",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={categoryIds.includes(c.category_id)}
                      onChange={() =>
                        setCategoryIds((prev) => toggleId(prev, c.category_id))
                      }
                    />
                    {c.name}
                  </label>
                ))}
              </div>
            )}
          </Panel>

          {isBook && (
            <Panel icon="bookOpen" title="פרטי הספר">
              <div className="grid grid-cols-2 gap-3">
                <Field label="שם המחבר/ת">
                  <input
                    className={inputClass}
                    style={inputStyle}
                    value={book.author_name}
                    onChange={(e) =>
                      setBook({ ...book, author_name: e.target.value })
                    }
                  />
                </Field>
                <Field label="מספר עמודים" hint="משמש למעקב התקדמות הקריאה.">
                  <input
                    dir="ltr"
                    type="number"
                    min="0"
                    step="1"
                    className={inputClass}
                    style={inputStyle}
                    value={book.total_pages}
                    onChange={(e) =>
                      setBook({ ...book, total_pages: e.target.value })
                    }
                  />
                </Field>
                <Field label='מסת"ב (ISBN)'>
                  <input
                    dir="ltr"
                    className={inputClass}
                    style={inputStyle}
                    value={book.isbn}
                    onChange={(e) => setBook({ ...book, isbn: e.target.value })}
                  />
                </Field>
                <Field label="הוצאה לאור">
                  <input
                    className={inputClass}
                    style={inputStyle}
                    value={book.publisher}
                    onChange={(e) =>
                      setBook({ ...book, publisher: e.target.value })
                    }
                  />
                </Field>
                <Field label="שפה">
                  <input
                    className={inputClass}
                    style={inputStyle}
                    placeholder="עברית"
                    value={book.language}
                    onChange={(e) =>
                      setBook({ ...book, language: e.target.value })
                    }
                  />
                </Field>
                <Field label="תאריך פרסום">
                  <input
                    dir="ltr"
                    type="date"
                    className={inputClass}
                    style={inputStyle}
                    value={book.publication_date}
                    onChange={(e) =>
                      setBook({ ...book, publication_date: e.target.value })
                    }
                  />
                </Field>
              </div>
            </Panel>
          )}

          {canEditContent && (
            <Panel icon="upload" title="עטיפה ותמונות">
              <div className="flex gap-4">
                <ProductThumb
                  product={
                    {
                      ...product,
                      name: form.name,
                      image_url: imageUrl || undefined,
                      cover_colors: coverColors,
                    } as Product
                  }
                  className="w-20 h-28 rounded-md flex-shrink-0"
                />
                <div className="flex-1 space-y-3">
                  <Field
                    label="צבעי עטיפה"
                    hint="משמשים כרקע כל עוד לא הועלתה תמונה."
                  >
                    <div className="flex gap-2" dir="ltr">
                      <input
                        type="color"
                        value={coverColors[0]}
                        onChange={(e) =>
                          setCoverColors([e.target.value, coverColors[1]])
                        }
                        className="w-12 h-9 rounded border cursor-pointer"
                        style={{
                          borderColor: "var(--color-border)",
                          background: "var(--color-secondary)",
                        }}
                      />
                      <input
                        type="color"
                        value={coverColors[1]}
                        onChange={(e) =>
                          setCoverColors([coverColors[0], e.target.value])
                        }
                        className="w-12 h-9 rounded border cursor-pointer"
                        style={{
                          borderColor: "var(--color-border)",
                          background: "var(--color-secondary)",
                        }}
                      />
                    </div>
                  </Field>
                  <div className="grid grid-cols-[1fr_auto] gap-2">
                    <input
                      dir="ltr"
                      className="px-3 py-2 rounded-lg border text-xs outline-none"
                      style={inputStyle}
                      placeholder="https://.../cover.jpg"
                      value={imageUrl.startsWith("data:") ? "" : imageUrl}
                      onChange={(e) => setImageUrl(e.target.value)}
                    />
                    <button
                      type="button"
                      onClick={() => coverInputRef.current?.click()}
                      disabled={uploadBusy}
                      className="px-3 py-2 rounded-lg border text-xs whitespace-nowrap disabled:opacity-40"
                      style={{
                        borderColor: "var(--color-border)",
                        color: "var(--color-primary)",
                      }}
                    >
                      העלאת קובץ
                    </button>
                  </div>
                  {imageUrl.startsWith("data:") && (
                    <p
                      className="text-[11px]"
                      style={{ color: "var(--color-muted-foreground)" }}
                    >
                      הועלתה תמונה מקומית (
                      {Math.round(imageUrl.length / 1024).toLocaleString()}KB).
                      <button
                        type="button"
                        className="underline mr-1"
                        onClick={() => setImageUrl("")}
                      >
                        הסרה
                      </button>
                    </p>
                  )}
                  <input
                    ref={coverInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0]
                      if (f) void pickCover(f)
                      e.target.value = ""
                    }}
                  />
                </div>
              </div>

              <div className="mt-4">
                <p
                  className="text-[11px] mb-2"
                  style={{ color: "var(--color-muted-foreground)" }}
                >
                  תמונות נוספות
                </p>
                {images.length > 0 && (
                  <ul className="space-y-2 mb-3">
                    {images.map((url) => (
                      <li
                        key={url}
                        className="flex items-center gap-2 text-xs p-2 rounded-lg"
                        style={{ background: "var(--color-secondary)" }}
                      >
                        <span className="flex-1 truncate" dir="ltr">
                          {url.startsWith("data:")
                            ? "תמונה שהועלתה מקומית"
                            : url}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            setImages((prev) => prev.filter((u) => u !== url))
                          }
                          style={{ color: "var(--color-danger)" }}
                        >
                          <Icon name="x" size={12} />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="grid grid-cols-[1fr_auto] gap-2">
                  <input
                    dir="ltr"
                    className="px-3 py-2 rounded-lg border text-xs outline-none"
                    style={inputStyle}
                    placeholder="https://.../image.jpg"
                    value={imageDraft}
                    onChange={(e) => setImageDraft(e.target.value)}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (!imageDraft.trim()) return
                      setImages((prev) => [...prev, imageDraft.trim()])
                      setImageDraft("")
                    }}
                    disabled={!imageDraft.trim()}
                    className="px-3 py-2 rounded-lg border text-xs disabled:opacity-40"
                    style={{
                      borderColor: "var(--color-border)",
                      color: "var(--color-primary)",
                    }}
                  >
                    + הוספה
                  </button>
                </div>
              </div>
            </Panel>
          )}

          {canEditContent && (
            <Panel icon="bookOpen" title="קובץ תוכן (PDF / EPUB)">
              {contentFile ? (
                <div
                  className="flex items-center justify-between gap-3 p-3 rounded-lg mb-3"
                  style={{ background: "var(--color-secondary)" }}
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate" dir="ltr">
                      {contentFile.file_name}
                    </p>
                    <p
                      className="text-xs"
                      style={{ color: "var(--color-muted-foreground)" }}
                    >
                      גרסה {contentFile.version} ·{" "}
                      {(contentFile.file_size_kb / 1024).toFixed(1)} MB · הועלה{" "}
                      {new Date(contentFile.uploaded_at).toLocaleDateString(
                        "he-IL",
                      )}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => contentInputRef.current?.click()}
                    className="text-xs px-3 py-1.5 rounded-full border flex-shrink-0"
                    style={{
                      borderColor: "rgba(239,68,68,0.3)",
                      color: "var(--color-danger)",
                    }}
                  >
                    החלפת קובץ
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => contentInputRef.current?.click()}
                  disabled={uploadBusy}
                  className="w-full flex flex-col items-center gap-2 p-5 rounded-lg border border-dashed transition-colors hover:bg-white/5 mb-3 disabled:opacity-40"
                  style={{
                    borderColor: "var(--color-border)",
                    color: "var(--color-muted-foreground)",
                  }}
                >
                  <Icon name="upload" size={20} />
                  <span className="text-xs">העלאת קובץ תוכן חדש</span>
                </button>
              )}
              <input
                ref={contentInputRef}
                type="file"
                accept=".pdf,.epub,application/pdf,application/epub+zip"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) void pickContent(f)
                  e.target.value = ""
                }}
              />
              <Field
                label="או כתובת הקובץ"
                hint={`קבצים מקומיים מוגבלים ל-${maxKb}KB. קובץ גדול יותר יש לאחסן בשרת הקבצים ולהדביק כאן את הכתובת (למשל /books/my-book.pdf).`}
              >
                <input
                  dir="ltr"
                  className={inputClass}
                  style={inputStyle}
                  placeholder="/books/my-book.pdf"
                  value={contentUrl.startsWith("data:") ? "" : contentUrl}
                  onChange={(e) => setContentUrl(e.target.value)}
                />
              </Field>
              {contentUrl.startsWith("data:") && (
                <p
                  className="text-[11px] mt-1"
                  style={{ color: "var(--color-muted-foreground)" }}
                >
                  קובץ התוכן שמור כעת מקומית בדפדפן (
                  {Math.round(contentUrl.length / 1024).toLocaleString()}KB).
                </p>
              )}
              {storagePath && (
                <p
                  className="text-[11px] mt-2"
                  style={{ color: "var(--color-muted-foreground)" }}
                  dir="ltr"
                >
                  מאוחסן ב־Supabase Storage: {storageBucket}/{storagePath}
                </p>
              )}
              {!contentUrl && !storagePath && (
                <p
                  className="text-[11px] mt-2"
                  style={{ color: "var(--color-danger)" }}
                >
                  ללא קובץ תוכן הקוראים יראו הודעה שהתוכן טרם הועלה — לא יומצא
                  טקסט במקומו.
                </p>
              )}
            </Panel>
          )}

          <Panel
            icon="video"
            title="קישורים לצפייה חיה (YouTube / Vimeo / פלטפורמות אחרות)"
          >
            {mediaLinks.length > 0 && (
              <ul className="space-y-2 mb-3">
                {mediaLinks.map((link) => {
                  const embed = toEmbedUrl(link.url)
                  return (
                    <li
                      key={link.media_link_id}
                      className="rounded-lg border overflow-hidden"
                      style={{ borderColor: "var(--color-border)" }}
                    >
                      <div
                        className="flex items-center justify-between gap-2 px-3 py-2"
                        style={{ background: "var(--color-secondary)" }}
                      >
                        <span className="text-xs font-medium flex items-center gap-1.5">
                          <Icon
                            name={embed ? "video" : "link"}
                            size={12}
                            style={{ color: "var(--color-primary)" }}
                          />
                          {link.label}
                          <span
                            style={{ color: "var(--color-muted-foreground)" }}
                          >
                            · {PLATFORM_LABEL[link.platform]}
                          </span>
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            setMediaLinks((prev) =>
                              prev.filter(
                                (l) => l.media_link_id !== link.media_link_id,
                              ),
                            )
                          }
                          style={{ color: "var(--color-danger)" }}
                          title="הסרת קישור"
                        >
                          <Icon name="x" size={13} />
                        </button>
                      </div>
                      {embed && (
                        <iframe
                          src={embed}
                          title={link.label}
                          className="w-full aspect-video block"
                          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                          allowFullScreen
                          style={{ border: 0 }}
                        />
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
            <div className="grid grid-cols-[1fr_1fr_auto] gap-2">
              <input
                className="px-3 py-2 rounded-lg border text-xs outline-none"
                style={inputStyle}
                placeholder="כותרת הקישור"
                value={linkDraft.label}
                onChange={(e) =>
                  setLinkDraft({ ...linkDraft, label: e.target.value })
                }
              />
              <input
                dir="ltr"
                className="px-3 py-2 rounded-lg border text-xs outline-none"
                style={inputStyle}
                placeholder="https://youtube.com/watch?v=..."
                value={linkDraft.url}
                onChange={(e) =>
                  setLinkDraft({ ...linkDraft, url: e.target.value })
                }
              />
              <button
                type="button"
                onClick={addLink}
                disabled={!linkDraft.url.trim()}
                className="px-3 py-2 rounded-lg border text-xs transition-colors hover:bg-white/5 disabled:opacity-40"
                style={{
                  borderColor: "var(--color-border)",
                  color: "var(--color-primary)",
                }}
              >
                + הוספה
              </button>
            </div>
          </Panel>

          <Panel icon="search" title="שדות SEO">
            <div className="space-y-3">
              <Field label="כותרת SEO">
                <input
                  className={inputClass}
                  style={inputStyle}
                  value={seo.title}
                  onChange={(e) => setSeo({ ...seo, title: e.target.value })}
                />
              </Field>
              <Field label="תיאור SEO">
                <textarea
                  className="w-full px-4 py-2.5 rounded-lg border text-sm outline-none min-h-16 resize-y"
                  style={inputStyle}
                  value={seo.description}
                  onChange={(e) =>
                    setSeo({ ...seo, description: e.target.value })
                  }
                />
              </Field>
              <Field label="מילות מפתח" hint="מופרדות בפסיקים.">
                <input
                  className={inputClass}
                  style={inputStyle}
                  value={seo.keywords}
                  onChange={(e) => setSeo({ ...seo, keywords: e.target.value })}
                />
              </Field>
            </div>
          </Panel>

          {form.product_type === "BUNDLE" && (
            <Panel icon="gift" title="מוצרים כלולים בחבילה">
              <ProductPicker
                options={pickers}
                selected={bundleIds}
                onToggle={(id) => setBundleIds((prev) => toggleId(prev, id))}
                emptyText="אין עדיין מוצרים אחרים בקטלוג שאפשר לכלול בחבילה."
              />
            </Panel>
          )}

          <Panel icon="sparkles" title="מוצרים נלווים (מוצגים בדף המוצר)">
            <ProductPicker
              options={pickers}
              selected={relatedIds}
              onToggle={(id) => setRelatedIds((prev) => toggleId(prev, id))}
              emptyText="אין עדיין מוצרים אחרים בקטלוג."
            />
          </Panel>

          <div className="grid grid-cols-2 gap-3">
            <Panel icon="trendUp" title="Upsell — שדרוג בעגלה">
              <ProductPicker
                options={pickers}
                selected={upsellIds}
                onToggle={(id) => setUpsellIds((prev) => toggleId(prev, id))}
                emptyText="אין עדיין מוצרים אחרים בקטלוג."
              />
            </Panel>
            <Panel icon="bag" title="Cross-sell — הצעה משלימה">
              <ProductPicker
                options={pickers}
                selected={crossSellIds}
                onToggle={(id) => setCrossSellIds((prev) => toggleId(prev, id))}
                emptyText="אין עדיין מוצרים אחרים בקטלוג."
              />
            </Panel>
          </div>
        </div>

        <div className="flex gap-3 mt-6">
          <button
            type="button"
            disabled={uploadBusy}
            onClick={handleSubmit}
            className="btn-gradient flex-1 py-2.5 rounded-full font-semibold text-sm disabled:opacity-40"
          >
            {uploadBusy
              ? "מעלה קובץ…"
              : product
                ? "שמירת שינויים"
                : "יצירת המוצר"}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2.5 rounded-full border text-sm transition-colors hover:bg-white/5"
            style={{
              borderColor: "var(--color-border)",
              color: "var(--color-foreground)",
            }}
          >
            ביטול
          </button>
        </div>
      </Modal>
  )
}

/* ── Categories ─────────────────────────────────────────── */

function CategoryModal({
  onClose,
  onNotice,
}: {
  onClose: () => void
  onNotice: (message: string) => void
}) {
  const { categories, saveCategory, deleteCategory } = useCms()
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [error, setError] = useState("")

  const add = async () => {
    if (!name.trim()) return setError("שם הקטגוריה חובה.")
    const result = await saveCategory({
      name: name.trim(),
      description: description.trim() || undefined,
    })
    if (!result.ok) {
      setError(result.error)
      return
    }
    setError("")
    setName("")
    setDescription("")
  }

  return (
    <Modal size="lg" title="קטגוריות" onClose={onClose}>

        {error && (
          <p
            className="text-xs px-3 py-2 rounded-lg mb-4"
            style={{
              background: "rgba(239,68,68,0.1)",
              color: "var(--color-danger)",
            }}
          >
            {error}
          </p>
        )}

        <div className="space-y-3 mb-5">
          <input
            className={inputClass}
            style={inputStyle}
            placeholder="שם הקטגוריה"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <input
            className={inputClass}
            style={inputStyle}
            placeholder="תיאור (אופציונלי)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <button
            onClick={() => void add()}
            className="btn-gradient w-full py-2.5 rounded-full font-semibold text-sm"
          >
            + הוספת קטגוריה
          </button>
        </div>

        {categories.length === 0 ? (
          <p
            className="text-sm text-center py-6"
            style={{ color: "var(--color-muted-foreground)" }}
          >
            לא הוגדרו עדיין קטגוריות.
          </p>
        ) : (
          <ul className="space-y-2">
            {categories.map((c) => (
              <li
                key={c.category_id}
                className="flex items-center gap-3 p-3 rounded-lg border"
                style={{ borderColor: "var(--color-border)" }}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{c.name}</p>
                  <p
                    className="text-xs truncate"
                    dir="ltr"
                    style={{ color: "var(--color-muted-foreground)" }}
                  >
                    /{c.slug}
                  </p>
                </div>
                <button
                  onClick={() => {
                    void deleteCategory(c.category_id).then((result) => {
                      if (!result.ok) onNotice(result.error)
                    })
                  }}
                  className="text-xs px-3 py-1 rounded-full border"
                  style={{
                    borderColor: "rgba(239,68,68,0.3)",
                    color: "var(--color-danger)",
                  }}
                >
                  מחיקה
                </button>
              </li>
            ))}
          </ul>
        )}
    </Modal>
  )
}

/* ── Patch diffing ──────────────────────────────────────── */

/**
 * Sends only the fields that actually changed. The service layer
 * authorises price edits and content edits under separate permissions,
 * so forwarding an unchanged price would lock content editors out of
 * every save.
 */
function diffPatch(
  existing: Product | null,
  next: Record<string, unknown>,
): Partial<Product> {
  if (!existing) return next as Partial<Product>
  const patch: Record<string, unknown> = {}
  Object.entries(next).forEach(([key, value]) => {
    const before = JSON.stringify(
      (existing as unknown as Record<string, unknown>)[key] ?? null,
    )
    const after = JSON.stringify(value ?? null)
    if (before !== after) patch[key] = value
  })
  return patch as Partial<Product>
}

/* ── Page ───────────────────────────────────────────────── */

export default function AdminProductsPage() {
  const {
    adminProducts: products,
    categories,
    settings,
    catalogLoading,
    catalogSource,
    saveProduct,
    deleteProduct,
    setProductStatus,
    moveProduct,
  } = useCms()
  const { adminRole } = useAdmin()
  const [editing, setEditing] = useState<Product | null | undefined>(undefined)
  const [showCategories, setShowCategories] = useState(false)
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState<"ALL" | ProductStatus>("ALL")
  const [typeFilter, setTypeFilter] = useState<"ALL" | ProductType>("ALL")
  const [notice, setNotice] = useState("")

  const canEditContent = can(adminRole, "edit_content")
  const canEditPrice = can(adminRole, "edit_price")
  const canDelete = can(adminRole, "delete_product")

  const sorted = useMemo(
    () => [...products].sort((a, b) => (a.position || 0) - (b.position || 0)),
    [products],
  )

  /* Which catalogue the list is showing. `supabase` means every row came
   * from the hosted tables this page also writes; `local` means Supabase is
   * unconfigured or its read was refused, and the document on screen is
   * browser-local. Shown so an empty or stale list can never pass itself off
   * as the live catalogue. */
  const usingHostedCatalogue =
    isSupabaseConfigured &&
    (catalogSource === "supabase" ||
      products.some((p) => isUuid(p.product_id)))

  const query = search.trim().toLowerCase()
  const filtered = sorted.filter((p) => {
    if (statusFilter !== "ALL" && p.status !== statusFilter) return false
    if (typeFilter !== "ALL" && p.product_type !== typeFilter) return false
    if (!query) return true
    return (
      p.name.toLowerCase().includes(query) ||
      (p.subtitle ?? "").toLowerCase().includes(query) ||
      (p.sku ?? "").toLowerCase().includes(query) ||
      p.slug.toLowerCase().includes(query) ||
      (p.book?.author_name ?? "").toLowerCase().includes(query) ||
      (p.tags ?? []).some((t) => t.toLowerCase().includes(query)) ||
      TYPE_LABEL[p.product_type].includes(query)
    )
  })

  if (!can(adminRole, "products")) return <AccessDenied page="מוצרים ותוכן" />

  const run = async (
    result: Promise<Result<unknown>>,
    successMessage?: string,
  ) => {
    const settled = await result
    if (!settled.ok) {
      setNotice(settled.error)
      return
    }
    setNotice(successMessage ?? "")
  }

  const handleSave = async (patch: Partial<Product>): Promise<Result<Product>> => {
    if (editing && Object.keys(patch).length === 0) {
      setEditing(undefined)
      return { ok: true, data: editing } as Result<Product>
    }
    const result = await saveProduct(patch, editing?.product_id)
    if (result.ok) setEditing(undefined)
    return result
  }

  const toggleFeatured = (product: Product) => {
    void run(saveProduct({ featured: !product.featured }, product.product_id))
  }

  return (
    <div className="max-w-6xl mx-auto page-enter">
      <div className="flex items-center justify-between mb-8 gap-4">
        <div>
          <h1 className="font-display text-4xl font-semibold mb-1">
            מוצרים ותוכן
          </h1>
          <p style={{ color: "var(--color-muted-foreground)" }}>
            {products.length} מוצרים בקטלוג ·{" "}
            {usingHostedCatalogue
              ? "נטען מהקטלוג שבשרת"
              : catalogLoading
                ? "טוען את הקטלוג..."
                : "קטלוג מקומי — Supabase אינו מחובר"}{" "}
            · ניהול מחירים, קבצי תוכן, עטיפות, קטגוריות וחבילות
          </p>
        </div>
        <div className="flex gap-2 flex-shrink-0">
          <button
            onClick={() => setShowCategories(true)}
            className="px-5 py-2.5 rounded-full border text-sm transition-colors hover:bg-white/5"
            style={{
              borderColor: "var(--color-border)",
              color: "var(--color-foreground)",
            }}
          >
            קטגוריות
          </button>
          <button
            onClick={() => setEditing(null)}
            className="btn-gradient px-5 py-2.5 rounded-full font-semibold text-sm"
          >
            + מוצר חדש
          </button>
        </div>
      </div>

      {notice && (
        <p
          className="text-xs px-4 py-2.5 rounded-lg mb-4 flex items-center justify-between gap-3"
          style={{
            background: "rgba(239,68,68,0.1)",
            color: "var(--color-danger)",
          }}
        >
          {notice}
          <button onClick={() => setNotice("")}>
            <Icon name="x" size={13} />
          </button>
        </p>
      )}

      <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_auto] gap-2 mb-4">
        <input
          className={`${inputClass} max-w-sm`}
          style={inputStyle}
          placeholder={'חיפוש לפי שם, מחבר, מק"ט, תגית או slug...'}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className="px-4 py-2.5 rounded-lg border text-sm outline-none"
          style={inputStyle}
          value={statusFilter}
          onChange={(e) =>
            setStatusFilter(e.target.value as "ALL" | ProductStatus)
          }
        >
          <option value="ALL">כל הסטטוסים</option>
          {(Object.keys(STATUS_LABEL) as ProductStatus[]).map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
        <select
          className="px-4 py-2.5 rounded-lg border text-sm outline-none"
          style={inputStyle}
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as "ALL" | ProductType)}
        >
          <option value="ALL">כל הסוגים</option>
          {(Object.keys(TYPE_LABEL) as ProductType[]).map((t) => (
            <option key={t} value={t}>
              {TYPE_LABEL[t]}
            </option>
          ))}
        </select>
      </div>

      {products.length === 0 ? (
        <div
          className="rounded-lg border border-dashed p-12 text-center"
          style={{ borderColor: "var(--color-border)" }}
        >
          <Icon
            name="box"
            size={28}
            style={{ color: "var(--color-muted-foreground)" }}
          />
          <p className="mt-3 font-medium">טרם נוצרו מוצרים.</p>
          <p
            className="text-sm mt-1 mb-5"
            style={{ color: "var(--color-muted-foreground)" }}
          >
            כל ספר או מוצר חדש שייצרו כאן יופיע מיד בחנות, בחיפוש ובקופה — ללא
            שינוי קוד.
          </p>
          <button
            onClick={() => setEditing(null)}
            className="btn-gradient px-6 py-2.5 rounded-full font-semibold text-sm"
          >
            + יצירת המוצר הראשון
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <div
          className="rounded-lg border p-10 text-center"
          style={{ borderColor: "var(--color-border)" }}
        >
          <p
            className="text-sm"
            style={{ color: "var(--color-muted-foreground)" }}
          >
            לא נמצאו מוצרים התואמים את הסינון.
          </p>
        </div>
      ) : (
        <div
          className="rounded-lg border overflow-x-auto"
          style={{ borderColor: "var(--color-border)" }}
        >
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: "var(--color-secondary)" }}>
                {[
                  "",
                  "מוצר",
                  "סוג",
                  "מחיר",
                  "מלאי",
                  "תוכן",
                  "סטטוס",
                  "פעולות",
                ].map((col) => (
                  <th
                    key={col || "order"}
                    className="text-right px-4 py-3 text-xs tracking-wide whitespace-nowrap"
                    style={{
                      color: "var(--color-muted-foreground)",
                      borderBottom: "1px solid var(--color-border)",
                    }}
                  >
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((product, i) => (
                <tr
                  key={product.product_id}
                  style={{
                    background:
                      i % 2 === 0
                        ? "var(--color-card)"
                        : "var(--color-background)",
                    borderBottom: "1px solid var(--color-border)",
                  }}
                >
                  <td className="px-3 py-3">
                    <div className="flex flex-col gap-1">
                      <button
                        title="הזזה למעלה"
                        onClick={() =>
                          void run(moveProduct(product.product_id, -1))
                        }
                        style={{ color: "var(--color-muted-foreground)" }}
                      >
                        <Icon
                          name="chevronDown"
                          size={14}
                          style={{ transform: "rotate(180deg)" }}
                        />
                      </button>
                      <button
                        title="הזזה למטה"
                        onClick={() =>
                          void run(moveProduct(product.product_id, 1))
                        }
                        style={{ color: "var(--color-muted-foreground)" }}
                      >
                        <Icon name="chevronDown" size={14} />
                      </button>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <ProductThumb
                        product={product}
                        className="w-8 h-11 rounded flex-shrink-0"
                      />
                      <div className="min-w-0">
                        <p className="font-medium flex items-center gap-1.5">
                          <span className="truncate">{product.name}</span>
                          {product.featured && (
                            <Icon
                              name="star"
                              size={12}
                              style={{ color: "var(--color-primary)" }}
                            />
                          )}
                        </p>
                        <p
                          className="text-xs truncate"
                          style={{ color: "var(--color-muted-foreground)" }}
                        >
                          {[
                            product.book?.author_name,
                            product.sku,
                            `/${product.slug}`,
                          ]
                            .filter(Boolean)
                            .join(" · ") || "—"}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <span
                      className="text-xs"
                      style={{ color: "var(--color-muted-foreground)" }}
                    >
                      {TYPE_LABEL[product.product_type] ?? product.product_type}
                    </span>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {product.sale_price !== undefined &&
                    product.sale_price !== null ? (
                      <span>
                        <span
                          className="font-semibold"
                          style={{ color: "var(--color-primary)" }}
                        >
                          {CURRENCY_SYMBOL[product.currency] ?? ""}
                          {product.sale_price.toLocaleString()}
                        </span>
                        <span
                          className="text-xs line-through mr-1.5"
                          style={{ color: "var(--color-muted-foreground)" }}
                        >
                          {CURRENCY_SYMBOL[product.currency] ?? ""}
                          {product.price.toLocaleString()}
                        </span>
                      </span>
                    ) : (
                      <span className="font-semibold">
                        {CURRENCY_SYMBOL[product.currency] ?? ""}
                        {product.price.toLocaleString()}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <span
                      className="text-xs"
                      style={{ color: "var(--color-muted-foreground)" }}
                    >
                      {product.inventory === null ||
                      product.inventory === undefined
                        ? "ללא הגבלה"
                        : `${product.inventory} יחידות`}
                      {" · "}
                      {AVAILABILITY_LABEL[product.availability]}
                    </span>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {product.content_url || product.content_file ? (
                      <span
                        className="inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-full"
                        style={{
                          background: "rgba(34,197,94,0.1)",
                          color: "var(--color-success)",
                        }}
                        title={
                          product.content_file?.file_name ?? product.content_url
                        }
                      >
                        <Icon name="bookOpen" size={12} />
                        {product.content_file
                          ? `גרסה ${product.content_file.version}`
                          : "מקושר"}
                      </span>
                    ) : (
                      <span
                        className="text-xs"
                        style={{ color: "var(--color-danger)" }}
                      >
                        לא הועלה
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={product.status} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1.5 flex-wrap">
                      <button
                        onClick={() => setEditing(product)}
                        className="text-xs px-3 py-1 rounded-full border transition-colors hover:bg-white/5"
                        style={{
                          borderColor: "var(--color-border)",
                          color: "var(--color-foreground)",
                        }}
                      >
                        עריכה
                      </button>
                      {product.status !== "ARCHIVED" && (
                        <button
                          onClick={() =>
                            void run(
                              setProductStatus(
                                product.product_id,
                                product.status === "ACTIVE"
                                  ? "INACTIVE"
                                  : "ACTIVE",
                              ),
                              product.status === "ACTIVE"
                                ? "המוצר הוסר מהפרסום."
                                : "המוצר פורסם.",
                            )
                          }
                          className="text-xs px-3 py-1 rounded-full border transition-colors hover:bg-white/5"
                          style={{
                            borderColor: "var(--color-border)",
                            color: "var(--color-foreground)",
                          }}
                        >
                          {product.status === "ACTIVE"
                            ? "הסרה מפרסום"
                            : "פרסום"}
                        </button>
                      )}
                      <button
                        onClick={() => toggleFeatured(product)}
                        title="החלפת מצב מומלץ"
                        className="text-xs px-2 py-1 rounded-full border transition-colors hover:bg-white/5"
                        style={{
                          borderColor: "var(--color-border)",
                          color: product.featured
                            ? "var(--color-primary)"
                            : "var(--color-muted-foreground)",
                        }}
                      >
                        <Icon name="star" size={12} />
                      </button>
                      {product.status !== "ARCHIVED" && (
                        <button
                          onClick={() =>
                            window.confirm(
                              `להעביר את "${product.name}" לארכיון? המוצר יוסר מהחנות אך היסטוריית ההזמנות תישמר.`,
                            ) &&
                            void run(
                              setProductStatus(product.product_id, "ARCHIVED"),
                              "המוצר הועבר לארכיון.",
                            )
                          }
                          className="text-xs px-3 py-1 rounded-full border transition-colors hover:bg-white/5"
                          style={{
                            borderColor: "var(--color-border)",
                            color: "var(--color-muted-foreground)",
                          }}
                        >
                          ארכיון
                        </button>
                      )}
                      {canDelete && (
                        <button
                          onClick={() =>
                            window.confirm(
                              `למחוק לצמיתות את "${product.name}"? פעולה זו אינה הפיכה.`,
                            ) &&
                            void run(
                              deleteProduct(product.product_id),
                              "המוצר נמחק.",
                            )
                          }
                          className="text-xs px-3 py-1 rounded-full border transition-colors hover:bg-red-500/10"
                          style={{
                            borderColor: "rgba(239,68,68,0.3)",
                            color: "var(--color-danger)",
                          }}
                        >
                          מחיקה
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing !== undefined && (
        <ProductModal
          product={editing}
          allProducts={products}
          canEditContent={canEditContent}
          canEditPrice={canEditPrice}
          maxUploadBytes={settings.max_upload_bytes}
          defaultCurrency={settings.default_currency}
          categories={categories}
          onClose={() => setEditing(undefined)}
          onSave={handleSave}
        />
      )}

      {showCategories && (
        <CategoryModal
          onClose={() => setShowCategories(false)}
          onNotice={(m) => setNotice(m)}
        />
      )}
    </div>
  )
}
