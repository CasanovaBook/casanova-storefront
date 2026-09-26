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
import { ok, fail, type Result } from "./api"
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
    .select(`
      *,
      book:books(*),
      categories:product_categories(category_id),
      relations:product_relations!product_relations_source_product_id_fkey(target_product_id, relation_type)
    `)
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
    .select(`
      *,
      book:books(*),
      categories:product_categories(category_id),
      relations:product_relations!product_relations_source_product_id_fkey(target_product_id, relation_type)
    `)
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
