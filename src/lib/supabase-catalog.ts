/* ─────────────────────────────────────────────────────────────
 * Supabase Catalog Data Service — Public Read Path.
 *
 * Implements direct Supabase PostgreSQL queries for `categories`
 * and `products` tables.
 *
 * Adheres strictly to the Result + Actor-first pattern and strips
 * protected content URLs (`content_url`) so anonymous and public
 * clients can never bypass content access grant policies.
 * ───────────────────────────────────────────────────────────── */

import type {
  Category,
  Product,
  ProductType,
  ProductStatus,
  ProductVisibility,
  ProductAvailability,
} from "../types"
import { ok, fail, type ErrorCode, type Result } from "./api"
import { supabase, isSupabaseConfigured } from "./supabase"

export interface DbBookRow {
  product_id: string
  author_name?: string | null
  isbn?: string | null
  publisher?: string | null
  language?: string | null
  publication_date?: string | null
  total_pages?: number | null
}

export interface DbCategoryRelationRow {
  category_id: string
}

export interface DbRelationRow {
  target_product_id: string
  relation_type: "BUNDLE_ITEM" | "RELATED" | "UPSELL" | "CROSS_SELL"
}

/**
 * The columns and joins every product read shares.
 *
 * Kept in one place so the public catalogue, the slug lookup and the admin
 * read cannot drift: a field added for the storefront must also reach the
 * admin screens, which map through the same `mapDbProductToEntity`.
 *
 * The columns are named rather than `*` on purpose. Migration 0025 revoked
 * `content_url` and `content_asset_id` from `anon` and `authenticated` at the
 * column level, so a request that asks for them is refused by Postgres rather
 * than answered and then hidden here. A `select=*` would ask for both and
 * fail the whole read. The reader never needed either: it resolves the file
 * through the `get-content-url` edge function, which checks the entitlement
 * first. An administrator reads `content_url` through `admin_list_products()`.
 */
const PRODUCT_SELECT = `
      product_id, name, subtitle, slug, sku, description, short_description,
      product_type, price, sale_price, currency, image_url, cover_colors,
      rating, reviews_count, tags, metadata,
      seo_title, seo_description, seo_keywords,
      status, visibility, availability, inventory, featured, position,
      created_at, updated_at, archived_at,
      book:books(*),
      categories:product_categories(category_id),
      images:product_images(image_url, sort_order),
      media_links:product_media_links(media_link_id, label, url, platform, sort_order),
      relations:product_relations!product_relations_source_product_id_fkey(target_product_id, relation_type)
    `

export interface DbProductRow {
  product_id: string
  name: string
  subtitle?: string | null
  slug: string
  sku?: string | null
  description: string
  short_description: string
  product_type: ProductType
  price: number | string
  sale_price?: number | string | null
  currency: string
  image_url?: string | null
  cover_colors?: [string, string] | null
  content_url?: string | null
  rating?: number | string | null
  reviews_count: number
  tags?: string[] | null
  metadata?: Record<string, string> | null
  seo_title?: string | null
  seo_description?: string | null
  seo_keywords?: string | null
  status: ProductStatus
  visibility: ProductVisibility
  availability: ProductAvailability
  inventory?: number | null
  featured: boolean
  position: number
  created_at: string
  updated_at: string
  archived_at?: string | null
  book?: DbBookRow | null
  categories?: DbCategoryRelationRow[] | null
  images?: { image_url?: string | null; sort_order?: number | null }[] | null
  media_links?: {
    media_link_id: string
    label: string
    url: string
    platform: string
    sort_order?: number | null
  }[] | null
  relations?: DbRelationRow[] | null
}

/**
 * Maps raw database product join rows to the application Product entity shape.
 * Always strips content_url for public safety.
 */
export function mapDbProductToEntity(row: DbProductRow): Product {
  const bundle_item_ids: string[] = []
  const related_product_ids: string[] = []
  const upsell_ids: string[] = []
  const cross_sell_ids: string[] = []

  if (Array.isArray(row.relations)) {
    for (const rel of row.relations) {
      if (rel.relation_type === "BUNDLE_ITEM")
        bundle_item_ids.push(rel.target_product_id)
      else if (rel.relation_type === "RELATED")
        related_product_ids.push(rel.target_product_id)
      else if (rel.relation_type === "UPSELL")
        upsell_ids.push(rel.target_product_id)
      else if (rel.relation_type === "CROSS_SELL")
        cross_sell_ids.push(rel.target_product_id)
    }
  }

  const category_ids = Array.isArray(row.categories)
    ? row.categories.map((c) => c.category_id)
    : []

  const book = row.book
    ? {
        author_name: row.book.author_name ?? undefined,
        isbn: row.book.isbn ?? undefined,
        publisher: row.book.publisher ?? undefined,
        language: row.book.language ?? undefined,
        publication_date: row.book.publication_date ?? undefined,
        total_pages: row.book.total_pages ?? undefined,
      }
    : undefined

  /* The panel's non-column fields (which Storage object backs the book, the
   * uploaded file's display metadata) travel inside `metadata`, the one JSONB
   * bag the products table already has. Reading them back here keeps the
   * admin editor showing what it saved without widening the table. */
  const rawMeta = (row.metadata ?? {}) as Record<string, unknown>

  const storagePath =
    typeof rawMeta.storage_path === "string" ? rawMeta.storage_path : undefined

  const storageBucket =
    typeof rawMeta.storage_bucket === "string" ? rawMeta.storage_bucket : undefined

  const contentFile =
    typeof rawMeta.content_file_name === "string"
      ? {
          file_name: rawMeta.content_file_name,
          file_size_kb: Number(rawMeta.content_file_size_kb) || 0,
          mime_type:
            typeof rawMeta.content_file_mime === "string"
              ? rawMeta.content_file_mime
              : "application/pdf",
          version: Number(rawMeta.content_file_version) || 0,
          uploaded_at:
            typeof rawMeta.content_file_uploaded_at === "string"
              ? rawMeta.content_file_uploaded_at
              : row.updated_at,
          storage_bucket: storageBucket,
          storage_path: storagePath,
        }
      : undefined

  const images = Array.isArray(row.images)
    ? [...row.images]
        .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
        .map((img) => img.image_url)
        .filter((url): url is string => Boolean(url))
    : []

  const media_links = Array.isArray(row.media_links)
    ? [...row.media_links]
        .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
        .map((ml) => ({
          media_link_id: ml.media_link_id,
          label: ml.label,
          url: ml.url,
          platform: ml.platform as "YOUTUBE" | "VIMEO" | "WEB",
        }))
    : []

  const seo =
    row.seo_title || row.seo_description || row.seo_keywords
      ? {
          title: row.seo_title ?? undefined,
          description: row.seo_description ?? undefined,
          keywords: row.seo_keywords ?? undefined,
        }
      : undefined

  return {
    product_id: row.product_id,
    name: row.name,
    subtitle: row.subtitle ?? undefined,
    slug: row.slug,
    sku: row.sku ?? undefined,
    description: row.description || "",
    short_description: row.short_description || "",
    product_type: row.product_type,
    price: Number(row.price),
    sale_price:
      row.sale_price !== null && row.sale_price !== undefined
        ? Number(row.sale_price)
        : undefined,
    currency: row.currency || "ILS",
    image_url: row.image_url ?? undefined,
    cover_colors:
      Array.isArray(row.cover_colors) && row.cover_colors.length >= 2
        ? [row.cover_colors[0], row.cover_colors[1]]
        : undefined,
    category_ids: category_ids.length > 0 ? category_ids : undefined,
    tags: Array.isArray(row.tags) ? row.tags : [],
    status: row.status,
    visibility: row.visibility,
    availability: row.availability,
    inventory: row.inventory ?? null,
    featured: Boolean(row.featured),
    position: row.position || 0,
    rating:
      row.rating !== null && row.rating !== undefined
        ? Number(row.rating)
        : undefined,
    reviews_count: Number(row.reviews_count) || 0,
    book,
    seo,
    metadata: row.metadata || {},
    images: images.length > 0 ? images : undefined,
    media_links: media_links.length > 0 ? media_links : undefined,
    content_file: contentFile,
    storage_path: storagePath,
    storage_bucket: storageBucket,
    bundle_item_ids: bundle_item_ids.length > 0 ? bundle_item_ids : undefined,
    related_product_ids:
      related_product_ids.length > 0 ? related_product_ids : undefined,
    upsell_ids: upsell_ids.length > 0 ? upsell_ids : undefined,
    cross_sell_ids: cross_sell_ids.length > 0 ? cross_sell_ids : undefined,
    created_at: row.created_at,
    updated_at: row.updated_at,
    archived_at: row.archived_at ?? undefined,
    // Content URL is stripped on public reads — protected books require signed access grants
    content_url: undefined,
  }
}

/**
 * Fetches all categories ordered by display_order.
 */
export async function fetchCategoriesFromDb(): Promise<Result<Category[]>> {
  if (!isSupabaseConfigured || !supabase) {
    return fail("PROVIDER_NOT_CONFIGURED", "Supabase is not configured.")
  }

  const { data, error } = await supabase
    .from("categories")
    .select("category_id, name, slug, description, display_order, created_at")
    .order("display_order", { ascending: true })

  if (error) {
    return fail("STORAGE", error.message)
  }

  const categories: Category[] = (data || []).map((row) => ({
    category_id: row.category_id,
    name: row.name,
    slug: row.slug,
    description: row.description ?? undefined,
    display_order: Number(row.display_order) || 0,
    created_at: row.created_at,
  }))

  return ok(categories)
}

/**
 * Fetches public, active products for the storefront.
 */
export async function fetchPublicProductsFromDb(): Promise<Result<Product[]>> {
  if (!isSupabaseConfigured || !supabase) {
    return fail("PROVIDER_NOT_CONFIGURED", "Supabase is not configured.")
  }

  const { data, error } = await supabase
    .from("products")
    .select(PRODUCT_SELECT)
    .eq("status", "ACTIVE")
    .eq("visibility", "PUBLIC")
    .order("position", { ascending: true })
    .order("created_at", { ascending: false })

  if (error) {
    return fail("STORAGE", error.message)
  }

  const products = (data as unknown as DbProductRow[] || []).map(
    mapDbProductToEntity,
  )
  return ok(products)
}

/**
 * Fetches an individual product by slug from the database (public view).
 */
export async function fetchProductBySlugFromDb(
  slug: string,
): Promise<Result<Product>> {
  if (!isSupabaseConfigured || !supabase) {
    return fail("PROVIDER_NOT_CONFIGURED", "Supabase is not configured.")
  }

  const { data, error } = await supabase
    .from("products")
    .select(PRODUCT_SELECT)
    .eq("slug", slug)
    .eq("status", "ACTIVE")
    .eq("visibility", "PUBLIC")
    .maybeSingle()

  if (error) {
    return fail("STORAGE", error.message)
  }

  if (!data) {
    return fail("NOT_FOUND", "המוצר לא נמצא.")
  }

  return ok(mapDbProductToEntity(data as unknown as DbProductRow))
}

/**
 * Fetches one product by its real UUID (used by checkout).
 *
 * Deliberately unfiltered by status: checkout has to be able to tell
 * "this product does not exist" from "this product is not on sale", and a
 * read that only returned sellable rows would report both as NOT_FOUND.
 * RLS still decides what the caller may see.
 */
export async function fetchProductByIdFromDb(
  productId: string,
): Promise<Result<Product>> {
  if (!isSupabaseConfigured || !supabase) {
    return fail("PROVIDER_NOT_CONFIGURED", "Supabase is not configured.")
  }

  const { data, error } = await supabase
    .from("products")
    .select(PRODUCT_SELECT)
    .eq("product_id", productId)
    .maybeSingle()

  if (error) {
    return fail("STORAGE", error.message)
  }

  if (!data) {
    return fail("NOT_FOUND", "המוצר לא נמצא.")
  }

  return ok(mapDbProductToEntity(data as unknown as DbProductRow))
}

/**
 * Admin-only: the whole catalogue, without the storefront's ACTIVE + PUBLIC
 * filter.
 *
 * The public list is deliberately narrowed to what a visitor may buy. An
 * administrator granting access works against the entire catalogue instead,
 * because a title can be DRAFT, INACTIVE, UNLISTED or HIDDEN and still be
 * exactly the book an entitlement has to point at — and because the hosted
 * store's books are private by default, reading only the public rows left
 * the grant picker empty.
 *
 * It goes through `admin_list_products()` rather than an unfiltered
 * `select()`. Migration 0025 replaced the policies on `public.products` with
 * ones that show the published set to every caller including staff, so a
 * plain table read can no longer reach a draft — and would reach it for
 * anyone whose token happened to satisfy a looser policy. The function is
 * SECURITY DEFINER and checks the `products` permission in the same
 * ROLE_PERMISSIONS matrix the panel's buttons are hidden by, so this read
 * is authorised where it happens rather than where it is called.
 *
 * A refused read returns the error so the caller can fall back to the local
 * document rather than presenting an empty catalogue as fact.
 */
export async function fetchAllProductsFromDb(): Promise<Result<Product[]>> {
  if (!isSupabaseConfigured || !supabase) {
    return fail("PROVIDER_NOT_CONFIGURED", "Supabase is not configured.")
  }

  const { data, error } = await supabase.rpc("admin_list_products")

  if (error) {
    const refused = describeProductRefusal(error.code ?? "", error.message ?? "")
    if (refused) return fail(refused.code, refused.error)
    return fail("STORAGE", error.message)
  }

  /* The function returns jsonb rows whose keys are the columns the mapper
   * already reads, so they go through `mapDbProductToEntity` unchanged. */
  const rows = Array.isArray(data) ? (data as DbProductRow[]) : []
  return ok(rows.map(mapDbProductToEntity))
}

/* ─────────────────────────────────────────────────────────────
 * Admin write path — the only client code that mutates `products`.
 *
 * Each function calls a SECURITY DEFINER function from
 * migrations/0022_admin_product_writes.sql, which re-checks `is_admin()`
 * server-side. The browser never holds a key that can write the catalogue
 * directly, so the RLS policies are untouched: writes widened by a policy
 * can be exercised by anyone who can send a request, writes behind a
 * function that asks `is_admin()` cannot.
 *
 * Every function resolves; none rejects. Callers are React click handlers
 * and should not have to catch a dropped request.
 * ───────────────────────────────────────────────────────────── */

/** Refusals raised by the product RPCs, translated once. */
const PRODUCT_REFUSALS: Record<string, { error: string; code: ErrorCode }> = {
  admin_required: {
    error: "אין הרשאה לשנות את הקטלוג. נדרשת הרשאת מנהל.",
    code: "FORBIDDEN",
  },
  name_required: { error: "שם המוצר חובה.", code: "VALIDATION" },
  slug_required: { error: "כתובת ה-URL (slug) של המוצר חובה.", code: "VALIDATION" },
  invalid_price: { error: "המחיר חייב להיות מספר חיובי.", code: "VALIDATION" },
  invalid_sale_price: {
    error: "מחיר המבצע חייב להיות נמוך מהמחיר הרגיל.",
    code: "VALIDATION",
  },
  invalid_product_type: { error: "סוג המוצר אינו תקין.", code: "VALIDATION" },
  invalid_status: { error: "סטטוס המוצר אינו תקין.", code: "VALIDATION" },
  invalid_visibility: { error: "נראות המוצר אינה תקינה.", code: "VALIDATION" },
  invalid_availability: { error: "זמינות המוצר אינה תקינה.", code: "VALIDATION" },
  invalid_direction: { error: "כיוון המיקום אינו תקין.", code: "VALIDATION" },
  slug_taken: {
    error: "מוצר עם כתובת URL זו כבר קיים. יש לבחור כתובת אחרת.",
    code: "CONFLICT",
  },
  isbn_taken: {
    error: "ISBN זה כבר משויך למוצר אחר.",
    code: "CONFLICT",
  },
  category_slug_taken: {
    error: "קטגוריה עם מזהה URL זה כבר קיימת.",
    code: "CONFLICT",
  },
  product_not_found: { error: "המוצר לא נמצא.", code: "NOT_FOUND" },
  category_not_found: { error: "הקטגוריה לא נמצאה.", code: "NOT_FOUND" },
  product_has_orders: {
    error:
      "לא ניתן למחוק מוצר שמופיע בהזמנות קיימות — יש להעביר אותו לארכיון כדי לשמור על שלמות הנתונים ההיסטוריים.",
    code: "CONFLICT",
  },
  product_has_grants: {
    error:
      "לא ניתן למחוק מוצר שקיימות עבורו הרשאות גישה של לקוחות — יש להעביר אותו לארכיון.",
    code: "CONFLICT",
  },
  product_has_subscriptions: {
    error:
      "לא ניתן למחוק מוצר שיש לו מנויים פעילים — יש להעביר אותו לארכיון.",
    code: "CONFLICT",
  },

  /* Migration 0024 enforces the ROLE_PERMISSIONS matrix inside the
   * catalogue functions, so a refusal here means the server declined on
   * the account's role rather than on the shape of the payload. The
   * message carries the permission name; the wording is generic on
   * purpose — an admin does not need the server to enumerate the matrix
   * back at them, and the panel has already hidden what they may not do. */
  permission_denied: {
    error: "לתפקיד הזה אין הרשאה לבצע את הפעולה הזו.",
    code: "FORBIDDEN",
  },
}

/** Resolves a refused RPC to wording an admin can read, or `null` when the
 *  error is not one the functions raise on purpose. */
function describeProductRefusal(
  code: string,
  message: string,
): { error: string; code: ErrorCode } | null {
  for (const token of Object.keys(PRODUCT_REFUSALS)) {
    if (message.includes(token)) return PRODUCT_REFUSALS[token]
  }

  if (code === "42501") return PRODUCT_REFUSALS.admin_required
  if (code === "P0002") {
    return { error: "המוצר או הקטגוריה לא נמצאו.", code: "NOT_FOUND" }
  }
  if (code === "22023") {
    return { error: "אחד השדות שהוזנו אינו תקין.", code: "VALIDATION" }
  }
  if (code === "23505") return PRODUCT_REFUSALS.slug_taken

  /* A referential-integrity refusal the functions did not name — a
   * product still held by a table this migration does not check, for
   * instance — would otherwise surface as a raw Postgres sentence. */
  if (code === "23503") {
    return {
      error:
        "לא ניתן למחוק מוצר שיש לו היסטוריה במערכת — יש להעביר אותו לארכיון.",
      code: "CONFLICT",
    }
  }

  if (code === "P0001") {
    console.warn("[supabase-catalog] unmapped RPC refusal:", message)
    return {
      error: "הפעולה נדחתה על ידי המערכת. יש לרענן את הרשימה ולנסות שוב.",
      code: "VALIDATION",
    }
  }

  return null
}

/** Pulls a single row out of an RPC response, which may be an object or a
 *  one-element array depending on how PostgREST serialises the composite. */
function firstRow(data: unknown): Record<string, unknown> | null {
  if (Array.isArray(data)) return (data[0] as Record<string, unknown>) ?? null
  if (data && typeof data === "object") return data as Record<string, unknown>
  return null
}

async function callProductRpc(
  fn: string,
  args: Record<string, unknown>,
): Promise<Result<Record<string, unknown> | null>> {
  if (!isSupabaseConfigured || !supabase) {
    return fail("PROVIDER_NOT_CONFIGURED", "שרת Supabase אינו מוגדר.")
  }

  try {
    const { data, error } = await supabase.rpc(fn, args)

    if (error) {
      const refused = describeProductRefusal(
        error.code ?? "",
        error.message ?? "",
      )
      if (refused) return fail(refused.code, refused.error)

      /* Verbatim on purpose: this is where "function … does not exist"
       * appears when 0022 has not been applied yet, and masking it would
       * hide the one clue that explains why saving still fails. */
      return fail("STORAGE", error.message)
    }

    return ok(firstRow(data))
  } catch (err) {
    return fail(
      "STORAGE",
      err instanceof Error ? err.message : "שגיאת רשת בלתי צפויה.",
    )
  }
}

const hasOwn = (obj: object, key: string) =>
  Object.prototype.hasOwnProperty.call(obj, key)

/**
 * Builds the JSON payload `admin_save_product` expects.
 *
 * Three states have to survive the trip, because the RPC reads *presence*
 * as the instruction:
 *
 *   absent   leave the column alone  — `diffPatch` dropped the key
 *   null     clear the column        — the editor emptied the field
 *   value    write it                 — the editor changed it
 *
 * The middle state is the one that needs work. A cleared field arrives
 * from the panel as `undefined`, and `JSON.stringify` omits a key whose
 * value is `undefined`, so it left as "absent" and the database kept the
 * old value — the sale price an editor had just deleted stayed on sale.
 * `put` and `putList` below do the one conversion that turns those three
 * into three distinct keys; nothing downstream has to know.
 *
 * The panel's extra fields (Storage pointer, uploaded file metadata) ride
 * inside `metadata`, the one JSONB bag the products table already has, and
 * are merged over whatever the row already carried so an unrelated edit
 * never drops them.
 */
export function toProductPayload(
  patch: Partial<Product>,
  existing?: Product | null,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {}

  /* A column the editor emptied arrives as `undefined`, and `JSON.stringify`
   * drops any key whose value is `undefined`. Forwarded as-is, clearing a
   * sale price, a SKU or a subtitle therefore reached the server as "leave
   * it alone" and silently kept the old value. The RPC reads *presence* as
   * the instruction, so the two forms have to be made distinct here, once:
   * an absent key means untouched, an explicit null clears.
   *
   * A collection is different: clearing it is an empty list, not a null,
   * because the function deletes the rows and re-inserts from the array. */
  const put = (key: string, value: unknown) => {
    if (!hasOwn(patch, key)) return
    payload[key] = value === undefined ? null : value
  }

  const putList = (key: string, value: unknown) => {
    if (!hasOwn(patch, key)) return
    payload[key] = value === undefined || value === null ? [] : value
  }

  put("product_id", patch.product_id)
  put("name", patch.name)
  put("subtitle", patch.subtitle)
  put("slug", patch.slug)
  put("sku", patch.sku)
  put("description", patch.description)
  put("short_description", patch.short_description)
  put("product_type", patch.product_type)
  put("price", patch.price)
  put("sale_price", patch.sale_price)
  put("currency", patch.currency)
  put("image_url", patch.image_url)
  put("content_url", patch.content_url)
  put("status", patch.status)
  put("visibility", patch.visibility)
  put("availability", patch.availability)
  put("inventory", patch.inventory)
  put("featured", patch.featured)
  put("position", patch.position)
  put("book", patch.book)

  /* Collections: an emptied one is sent as `[]`, which the function reads
   * as "replace the set with nothing". Sending null here would delete the
   * rows and skip the re-insert, which is the same outcome today, but `[]`
   * is the honest statement of intent and survives the next edit to the
   * function. */
  putList("cover_colors", patch.cover_colors)
  putList("tags", patch.tags)
  putList("images", patch.images)
  putList("media_links", patch.media_links)
  putList("category_ids", patch.category_ids)
  putList("related_product_ids", patch.related_product_ids)
  putList("upsell_ids", patch.upsell_ids)
  putList("cross_sell_ids", patch.cross_sell_ids)
  putList("bundle_item_ids", patch.bundle_item_ids)

  if (hasOwn(patch, "seo")) {
    payload.seo_title = patch.seo?.title ?? null
    payload.seo_description = patch.seo?.description ?? null
    payload.seo_keywords = patch.seo?.keywords ?? null
  }

  const meta: Record<string, unknown> = { ...(existing?.metadata ?? {}) }
  const setMeta = (key: string, value: unknown) => {
    if (value === undefined || value === null || value === "") delete meta[key]
    else meta[key] = value
  }

  if (
    hasOwn(patch, "content_file") ||
    hasOwn(patch, "storage_path") ||
    hasOwn(patch, "storage_bucket")
  ) {
    const file = patch.content_file
    setMeta("storage_path", patch.storage_path ?? file?.storage_path)
    setMeta("storage_bucket", patch.storage_bucket ?? file?.storage_bucket)
    setMeta("content_file_name", file?.file_name)
    setMeta("content_file_size_kb", file?.file_size_kb)
    setMeta("content_file_mime", file?.mime_type)
    setMeta("content_file_version", file?.version)
    setMeta("content_file_uploaded_at", file?.uploaded_at)
    payload.metadata = meta
  }

  if (hasOwn(patch, "metadata")) {
    payload.metadata = { ...meta, ...(patch.metadata ?? {}) }
  }

  return payload
}

/** Admin-only: inserts or updates one catalogue row (and its joins). */
export async function saveProductToDb(
  patch: Partial<Product>,
  existing?: Product | null,
): Promise<Result<Product>> {
  const result = await callProductRpc("admin_save_product", {
    p_product: toProductPayload(patch, existing),
  })

  if (!result.ok) return result
  if (!result.data) {
    return fail("STORAGE", "השמירה לא הושלמה בשרת.")
  }

  return ok(mapDbProductToEntity(result.data as unknown as DbProductRow))
}

/** Admin-only: publish / unpublish / draft / archive. */
export async function setProductStatusInDb(
  productId: string,
  status: ProductStatus,
): Promise<Result<Product>> {
  const result = await callProductRpc("admin_set_product_status", {
    p_product_id: productId,
    p_status: status,
  })

  if (!result.ok) return result
  if (!result.data) {
    return fail("STORAGE", "הפעולה לא הושלמה בשרת.")
  }

  return ok(mapDbProductToEntity(result.data as unknown as DbProductRow))
}

/** Admin-only: hard delete, refused while the product has history. */
export async function deleteProductFromDb(productId: string): Promise<Result> {
  const result = await callProductRpc("admin_delete_product", {
    p_product_id: productId,
  })

  return result.ok ? ok(undefined) : result
}

/** Admin-only: swap display position with the neighbour. */
export async function moveProductInDb(
  productId: string,
  direction: -1 | 1,
): Promise<Result> {
  const result = await callProductRpc("admin_move_product", {
    p_product_id: productId,
    p_direction: direction,
  })

  return result.ok ? ok(undefined) : result
}

/** Admin-only: inserts or updates one storefront category. */
export async function saveCategoryToDb(payload: Record<string, unknown>): Promise<
  Result<Category>
> {
  const result = await callProductRpc("admin_save_category", {
    p_category: payload,
  })

  if (!result.ok) return result
  if (!result.data) {
    return fail("STORAGE", "השמירה לא הושלמה בשרת.")
  }

  const row = result.data
  return ok({
    category_id: String(row.category_id),
    name: String(row.name),
    slug: String(row.slug),
    description: (row.description as string | null) ?? undefined,
    display_order: Number(row.display_order) || 0,
    created_at: String(row.created_at ?? ""),
  })
}

/** Admin-only: deletes a category (product links cascade). */
export async function deleteCategoryFromDb(
  categoryId: string,
): Promise<Result> {
  const result = await callProductRpc("admin_delete_category", {
    p_category_id: categoryId,
  })

  return result.ok ? ok(undefined) : result
}
