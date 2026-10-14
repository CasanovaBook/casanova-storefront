/* ─────────────────────────────────────────────────────────────
 * Catalog service — categories and products.
 *
 * Extracted verbatim from `src/lib/api.ts` (Phase 5B / Group B).
 * Behaviour is unchanged: same permission guards, same validation
 * messages (Hebrew), same slug generation, same audit events, same
 * snapshot-on-update, same delete-referenced checks.
 * ───────────────────────────────────────────────────────────── */

import type { Category, Product, ProductStatus } from "../types"

import { snapshotProduct } from "../types"

import { getDb, mutate, nowIso, uid, uniqueSlug } from "../data/db"

import { fail, guard, ok, type Actor, type Result } from "../shared/result"

import { writeAudit } from "./audit"

/* ── Categories ───────────────────────────────────────── */

export function listCategories(): Category[] {
  return [...getDb().categories].sort(
    (a, b) => a.display_order - b.display_order,
  )
}

export function saveCategory(
  actor: Actor | null,

  data: { name: string, slug?: string, description?: string },

  id?: string,
): Result<Category> {
  const denied = guard(actor, "products")

  if (denied) return denied

  const name = data.name.trim()

  if (!name) return fail("VALIDATION", "שם הקטגוריה חובה.")

  const db = getDb()

  const taken = db.categories
    .filter((c) => c.category_id !== id)
    .map((c) => c.slug)

  const slug = uniqueSlug(data.slug || name, taken, "category")

  if (db.categories.some((c) => c.slug === slug && c.category_id !== id)) {
    return fail("CONFLICT", "קטגוריה עם מזהה URL זה כבר קיימת.")
  }

  const saved = mutate((d) => {
    if (id) {
      const idx = d.categories.findIndex((c) => c.category_id === id)

      if (idx < 0) return null

      const next = {
        ...d.categories[idx],
        name,
        slug,
        description: data.description,
      }

      d.categories = d.categories.map((c) => (c.category_id === id ? next : c))

      return next
    }

    const nextOrder =
      d.categories.reduce((max, c) => Math.max(max, c.display_order), 0) + 1

    const created: Category = {
      category_id: uid("cat"),

      name,

      slug,

      description: data.description,

      display_order: nextOrder,

      created_at: nowIso(),
    }

    d.categories = [...d.categories, created]

    return created
  })

  if (!saved) return fail("NOT_FOUND", "הקטגוריה לא נמצאה.")

  return ok(saved)
}

export function deleteCategory(
  actor: Actor | null,
  categoryId: string,
): Result {
  const denied = guard(actor, "products")

  if (denied) return denied

  const category = getDb().categories.find((c) => c.category_id === categoryId)

  if (!category) return fail("NOT_FOUND", "הקטגוריה לא נמצאה.")

  mutate((db) => {
    db.categories = db.categories.filter((c) => c.category_id !== categoryId)

    db.products = db.products.map((p) =>
      p.category_ids?.includes(categoryId)
        ? {
            ...p,
            category_ids: p.category_ids.filter((c) => c !== categoryId),
            updated_at: nowIso(),
          }
        : p,
    )
  })

  writeAudit(actor, {
    category: "PRODUCT_UPDATE",

    action: "מחיקת קטגוריה",

    target_type: "CATEGORY",

    target_id: categoryId,

    target_label: category.name,

    details: "הקטגוריה הוסרה מכל המוצרים ששויכו אליה",
  })

  return ok(undefined)
}

/* ── Products ─────────────────────────────────────────── */

export type ProductDraft = Omit<Product, "product_id" | "created_at" | "updated_at" | "archived_at"> & {
  slug?: string
}

export function listProducts(): Product[] {
  return getDb().products
}

export function getProduct(productId: string): Product | undefined {
  return getDb().products.find((p) => p.product_id === productId)
}

export function getProductBySlug(slug: string): Product | undefined {
  return getDb().products.find((p) => p.slug === slug)
}

/**
 * Catalog view for the storefront: published, publicly visible, ordered.
 *
 * `content_url` is stripped here on purpose. This is the payload an
 * anonymous visitor receives, so anything in it is public by definition —
 * and the address of a protected PDF is the shortest possible route from
 * "browse the catalogue" to "download the book". Readers get the location
 * through issueContentGrant(), which checks the entitlement and the device
 * session first. v_storefront_catalog in schema.sql drops the same two
 * columns for the same reason.
 */

export function listPublicProducts(): Product[] {
  return getDb()

    .products.filter((p) => p.status === "ACTIVE" && p.visibility === "PUBLIC")

    .sort(
      (a, b) =>
        (a.position || 0) - (b.position || 0) ||
        b.created_at.localeCompare(a.created_at),
    )

    .map((p) => (p.content_url ? { ...p, content_url: undefined } : p))
}

export function listFeaturedProducts(): Product[] {
  return listPublicProducts().filter((p) => p.featured)
}

export function resolveProducts(ids: string[] | undefined): Product[] {
  if (!ids || ids.length === 0) return []

  const all = getDb().products

  return ids
    .map((id) => all.find((p) => p.product_id === id))
    .filter((p): p is Product => Boolean(p))
}

function validateProductDraft(data: Partial<Product>): string | null {
  if (data.name !== undefined && !data.name.trim()) return "שם המוצר חובה."

  if (data.price !== undefined && (Number.isNaN(data.price) || data.price < 0))
    return "המחיר חייב להיות מספר חיובי."

  if (
    data.sale_price !== undefined &&
    data.sale_price !== null &&
    data.price !== undefined &&
    data.sale_price >= data.price
  ) {
    return "מחיר המבצע חייב להיות נמוך מהמחיר הרגיל."
  }

  if (
    data.inventory !== undefined &&
    data.inventory !== null &&
    data.inventory < 0
  ) {
    return "מלאי לא יכול להיות שלילי."
  }

  return null
}

export function createProduct(
  actor: Actor | null,
  data: Partial<Product>,
): Result<Product> {
  const denied = guard(actor, "products")

  if (denied) return denied

  const problem = validateProductDraft(data)

  if (problem) return fail("VALIDATION", problem)

  if (!data.name?.trim()) return fail("VALIDATION", "שם המוצר חובה.")

  const db = getDb()

  const slug = uniqueSlug(
    data.slug || data.name,
    db.products.map((p) => p.slug),
    "product",
  )

  const maxPosition = db.products.reduce(
    (max, p) => Math.max(max, p.position || 0),
    0,
  )

  const settings = db.settings

  const created = mutate((d) => {
    const product: Product = {
      name: data.name!.trim(),

      description: "",

      short_description: "",

      product_type: "EBOOK",

      price: 0,

      currency: settings.default_currency,

      status: "DRAFT",

      visibility: "PUBLIC",

      availability: "AVAILABLE",

      inventory: null,

      featured: false,

      position: maxPosition + 1,

      ...data,

      // Honour a caller-supplied id so the product editor can upload a

      // content file to Supabase Storage (keyed by product_id) *before*

      // the first save. Falls back to a fresh id for every other caller.

      product_id: data.product_id?.trim() || uid("prd"),

      slug,

      created_at: nowIso(),

      updated_at: nowIso(),
    }

    d.products = [...d.products, product]

    return product
  })

  writeAudit(actor, {
    category: "PRODUCT_CREATE",

    action: "יצירת מוצר חדש",

    target_type: "PRODUCT",

    target_id: created.product_id,

    target_label: created.name,

    details: `${created.product_type} · ₪${created.price.toLocaleString()} · סטטוס ${created.status}`,
  })

  return ok(created)
}

export function updateProduct(
  actor: Actor | null,
  productId: string,
  patch: Partial<Product>,
): Result<Product> {
  const denied = guard(actor, "products")

  if (denied) return denied

  const db = getDb()

  const existing = db.products.find((p) => p.product_id === productId)

  if (!existing) return fail("NOT_FOUND", "המוצר לא נמצא.")

  const merged = { ...existing, ...patch } as Product

  const problem = validateProductDraft(merged)

  if (problem) return fail("VALIDATION", problem)

  const priceChanged =
    patch.price !== undefined || patch.sale_price !== undefined

  if (priceChanged) {
    const priceDenied = guard(actor, "edit_price")

    if (priceDenied) return priceDenied
  }

  const contentChanged =
    patch.content_url !== undefined ||
    patch.content_file !== undefined ||
    patch.image_url !== undefined

  if (contentChanged) {
    const contentDenied = guard(actor, "edit_content")

    if (contentDenied) return contentDenied
  }

  let slug = existing.slug

  if (patch.slug !== undefined && patch.slug !== existing.slug) {
    const taken = db.products
      .filter((p) => p.product_id !== productId)
      .map((p) => p.slug)

    slug = uniqueSlug(patch.slug || existing.name, taken, "product")
  }

  const updated = mutate((d) => {
    const next: Product = {
      ...existing,
      ...patch,
      slug,
      product_id: productId,
      updated_at: nowIso(),
    }

    d.products = d.products.map((p) => (p.product_id === productId ? next : p))

    // Access grants keep their own snapshot; refresh it so libraries stay readable.

    d.user_products = d.user_products.map((up) =>
      up.product_id === productId
        ? { ...up, product_snapshot: snapshotProduct(next) }
        : up,
    )

    return next
  })

  if (
    priceChanged &&
    (existing.price !== updated.price ||
      existing.sale_price !== updated.sale_price)
  ) {
    writeAudit(actor, {
      category: "PRICE_CHANGE",

      action: "שינוי מחיר",

      target_type: "PRODUCT",

      target_id: productId,

      target_label: updated.name,

      details:
        `₪${existing.price.toLocaleString()} → ₪${updated.price.toLocaleString()}` +
        (updated.sale_price !== undefined
          ? ` · מבצע ₪${updated.sale_price.toLocaleString()}`
          : ""),
    })
  } else if (contentChanged) {
    writeAudit(actor, {
      category: "CONTENT_SWAP",

      action: "עדכון קובץ תוכן / תמונה",

      target_type: "PRODUCT",

      target_id: productId,

      target_label: updated.name,

      details: updated.content_file?.file_name ?? updated.content_url ?? "—",
    })
  } else {
    writeAudit(actor, {
      category: "PRODUCT_UPDATE",

      action: "עדכון מוצר",

      target_type: "PRODUCT",

      target_id: productId,

      target_label: updated.name,

      details: Object.keys(patch).join(", "),
    })
  }

  return ok(updated)
}

export function setProductStatus(
  actor: Actor | null,
  productId: string,
  status: ProductStatus,
): Result<Product> {
  const denied = guard(actor, "products")

  if (denied) return denied

  const existing = getProduct(productId)

  if (!existing) return fail("NOT_FOUND", "המוצר לא נמצא.")

  const updated = mutate((db) => {
    const next: Product = {
      ...existing,

      status,

      archived_at: status === "ARCHIVED" ? nowIso() : undefined,

      updated_at: nowIso(),
    }

    db.products = db.products.map((p) =>
      p.product_id === productId ? next : p,
    )

    return next
  })

  writeAudit(actor, {
    category: "PRODUCT_UPDATE",

    action:
      status === "ARCHIVED"
        ? "העברה לארכיון"
        : status === "ACTIVE"
          ? "פרסום מוצר"
          : "שינוי סטטוס מוצר",

    target_type: "PRODUCT",

    target_id: productId,

    target_label: existing.name,

    details: `${existing.status} → ${status}`,
  })

  return ok(updated)
}

export function archiveProduct(
  actor: Actor | null,
  productId: string,
): Result<Product> {
  return setProductStatus(actor, productId, "ARCHIVED")
}

/** Reorders within the catalog grid. */

export function moveProduct(
  actor: Actor | null,
  productId: string,
  direction: -1 | 1,
): Result {
  const denied = guard(actor, "products")

  if (denied) return denied

  const sorted = [...getDb().products].sort(
    (a, b) => (a.position || 0) - (b.position || 0),
  )

  const idx = sorted.findIndex((p) => p.product_id === productId)

  const swap = idx + direction

  if (idx < 0 || swap < 0 || swap >= sorted.length) return ok(undefined)

  const a = sorted[idx].position || 0

  const b = sorted[swap].position || 0

  mutate((db) => {
    db.products = db.products.map((p) => {
      if (p.product_id === sorted[idx].product_id)
        return {
          ...p,
          position: b === a ? idx + direction : b,
          updated_at: nowIso(),
        }

      if (p.product_id === sorted[swap].product_id)
        return { ...p, position: a, updated_at: nowIso() }

      return p
    })
  })

  return ok(undefined)
}

/**
 * Hard deletion. Refused whenever the product is referenced by financial
 * or entitlement history — archiving is the correct action there, so
 * historical orders can never be corrupted.
 */

export function deleteProduct(actor: Actor | null, productId: string): Result {
  const denied = guard(actor, "delete_product")

  if (denied) return denied

  const db = getDb()

  const existing = db.products.find((p) => p.product_id === productId)

  if (!existing) return fail("NOT_FOUND", "המוצר לא נמצא.")

  const referencedByOrders = db.orders.some((o) =>
    o.items.some((i) => i.product_id === productId),
  )

  const referencedByGrants = db.user_products.some(
    (up) => up.product_id === productId,
  )

  if (referencedByOrders || referencedByGrants) {
    return fail(
      "CONFLICT",

      referencedByOrders
        ? "לא ניתן למחוק מוצר שמופיע בהזמנות קיימות — יש להעביר אותו לארכיון כדי לשמור על שלמות הנתונים ההיסטוריים."
        : "לא ניתן למחוק מוצר שקיימות עבורו הרשאות גישה של לקוחות — יש להעביר אותו לארכיון.",
    )
  }

  mutate((d) => {
    d.products = d.products.filter((p) => p.product_id !== productId)
  })

  writeAudit(actor, {
    category: "PRODUCT_DELETE",

    action: "מחיקת מוצר",

    target_type: "PRODUCT",

    target_id: productId,

    target_label: existing.name,

    details: "נמחק לצמיתות (ללא היסטוריית הזמנות או גישה)",
  })

  return ok(undefined)
}
