/* ─────────────────────────────────────────────────────────────
 * Catalogue & CMS content context.
 *
 * A read-through facade over the store plus the catalogue service.
 * The CMS content it exposes stays derived from the persisted
 * database, so a product created in the CMS appears on the storefront
 * in the same render without any code change, and nothing is ever
 * silently re-seeded. The storefront catalogue is the one thing it
 * holds itself, because that is fetched from Supabase rather than
 * read synchronously out of the local document.
 *
 * Every mutation forwards the signed-in actor to the service layer,
 * which is where the permission check actually happens.
 *
 * The local document remains the fallback whenever Supabase is
 * unconfigured or unreachable, and `catalogSource` names whichever
 * source answered — a stale local catalogue can never pass itself off
 * as live data without the state saying so.
 * ───────────────────────────────────────────────────────────── */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"

import type {
  Category,
  CmsBackup,
  CmsSection,
  Coupon,
  FaqItem,
  PlatformSettings,
  Product,
  Testimonial,
} from "../types"

import { useStore } from "../lib/store"

import { isSupabaseConfigured } from "../lib/supabase"

import {
  deleteCategoryFromDb,
  deleteProductFromDb,
  fetchAllProductsFromDb,
  fetchCategoriesFromDb,
  fetchPublicProductsFromDb,
  moveProductInDb,
  saveCategoryToDb,
  saveProductToDb,
  setProductStatusInDb,
} from "../lib/supabase-catalog"

import {
  mirrorRemoteCatalogCategories,
  mirrorRemoteCatalogProducts,
} from "../lib/api-support"

import {
  archiveProduct,
  createProduct,
  deleteCategory,
  deleteCoupon,
  deleteFaq,
  deleteProduct as deleteProductRequest,
  deleteSection,
  deleteTestimonial,
  exportCmsBackup,
  fail,
  findCoupon as findCouponRequest,
  listPublicProducts,
  moveProduct,
  moveSection,
  resolveProducts,
  restoreCmsBackup,
  saveCategory,
  saveCoupon,
  saveFaq,
  saveSection,
  saveTestimonial,
  setProductStatus,
  toggleSection,
  updateProduct,
  type Result,
} from "../lib/api"

import { uniqueSlug } from "../lib/db"

import { useApp } from "./AppContext"

/**
 * Which catalogue the storefront is reading right now.
 *
 * `"supabase"` — the hosted Postgres catalogue answered. An empty
 * answer is still an answer: it means the storefront has nothing to
 * show, not that the local document should be put back on screen.
 *
 * `"local"` — Supabase is unconfigured or was unreachable, so the
 * browser-local document is the only catalogue that exists.
 *
 * Exposed as state, never inferred, so a screen can say which one it
 * drew from without re-deriving the fallback rule itself.
 */

export type CatalogSource = "supabase" | "local"

interface CmsContextValue {
  settings: PlatformSettings

  categories: Category[]

  products: Product[]

  /**
   * Every hosted product, for the access screens. The storefront lists above
   * are narrowed to ACTIVE + PUBLIC; this one is not, because an entitlement
   * can point at a draft, unlisted or hidden title. Falls back to the local
   * document when Supabase is unconfigured or the read is refused.
   */
  adminProducts: Product[]

  sections: CmsSection[]

  testimonials: Testimonial[]

  faqs: FaqItem[]

  coupons: Coupon[]

  /* Storefront views */

  activeSections: CmsSection[]

  /** Published + publicly visible, ordered by the admin-defined position. */

  publishedProducts: Product[]

  featuredProducts: Product[]

  books: Product[]

  /* Catalogue provenance. The storefront-facing lists above are read
   * from Supabase when it is configured, so these three say whether
   * that read is still in flight, whether it failed, and which
   * catalogue the rows on screen actually came from. */

  catalogSource: CatalogSource

  catalogLoading: boolean

  catalogError: string | null

  /** Re-runs the Supabase read; for the admin's benefit and for tests. */
  refreshCatalog: () => void

  /** Categories for the storefront filters — same source as the products shown. */
  storefrontCategories: Category[]

  productById: (id: string | undefined) => Product | undefined

  productBySlug: (slug: string) => Product | undefined

  categoryName: (id: string) => string

  findCoupon: (code: string) => Coupon | undefined

  relatedProducts: (product: Product) => Product[]

  upsellProducts: (product: Product) => Product[]

  crossSellProducts: (product: Product) => Product[]

  bundleProducts: (product: Product) => Product[]

  /* Sections */

  saveSection: (
    data: Omit<CmsSection, "section_id" | "display_order" | "updated_at">,
    id?: string,
  ) => Result<CmsSection>

  deleteSection: (id: string) => Result

  toggleSection: (id: string) => Result

  moveSection: (id: string, dir: -1 | 1) => Result

  /* Products. Every mutation resolves: with Supabase configured it writes the
   * hosted catalogue through the admin RPCs (and re-reads it); without it, it
   * writes the local document exactly as before. */

  saveProduct: (data: Partial<Product>, id?: string) => Promise<Result<Product>>

  archiveProduct: (id: string) => Promise<Result<Product>>

  deleteProduct: (id: string) => Promise<Result>

  setProductStatus: (
    id: string,
    status: Product["status"],
  ) => Promise<Result<Product>>

  moveProduct: (id: string, dir: -1 | 1) => Promise<Result>

  /* Categories */

  saveCategory: (
    data: { name: string, slug?: string, description?: string },
    id?: string,
  ) => Promise<Result<Category>>

  deleteCategory: (id: string) => Promise<Result>

  /* Testimonials */

  saveTestimonial: (
    data: Omit<Testimonial, "testimonial_id" | "display_order">,
    id?: string,
  ) => Result<Testimonial>

  deleteTestimonial: (id: string) => Result

  /* FAQs */

  saveFaq: (
    data: Omit<FaqItem, "faq_id" | "display_order">,
    id?: string,
  ) => Result<FaqItem>

  deleteFaq: (id: string) => Result

  /* Coupons */

  saveCoupon: (
    data: Omit<Coupon, "coupon_id" | "times_used">,
    id?: string,
  ) => Result<Coupon>

  deleteCoupon: (id: string) => Result

  /* Backup */

  exportBackup: () => Result<CmsBackup>

  restoreBackup: (backup: Partial<CmsBackup>) => Result
}

const CmsContext = createContext<CmsContextValue | null>(null)

export function CmsProvider({ children }: { children: ReactNode }) {
  const db = useStore()

  const { actor } = useApp()

  /* ── Storefront catalogue ────────────────────────────────
   * Read from Supabase Postgres, which is the catalogue the
   * storefront, the reader and /admin/products all work against.
   * The local document is the cache the synchronous consumers read
   * and the whole catalogue only on an install where Supabase is
   * unconfigured — see the mirror effect below.
   *
   * A read that fails falls back to the cached local rows and says so
   * through `catalogError` and `catalogSource`. A read that succeeds and
   * happens to be empty does not fall back: an empty hosted catalogue is
   * a real answer, and quietly filling it in from local rows is exactly
   * the confusion this state exists to prevent. */
  const [remoteCatalog, setRemoteCatalog] = useState<{
    categories: Category[]
    products: Product[]
  } | null>(null)

  const [catalogLoading, setCatalogLoading] = useState(isSupabaseConfigured)

  const [catalogError, setCatalogError] = useState<string | null>(null)

  /** Bumped by `refreshCatalog` to re-run the read. */
  const [catalogNonce, setCatalogNonce] = useState(0)

  const refreshCatalog = useCallback(() => setCatalogNonce((n) => n + 1), [])

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setRemoteCatalog(null)

      setCatalogLoading(false)

      setCatalogError(null)

      return
    }

    let cancelled = false

    setCatalogLoading(true)

    void (async () => {
      const [categoriesResult, productsResult] = await Promise.all([
        fetchCategoriesFromDb(),

        fetchPublicProductsFromDb(),
      ])

      // A response that arrives after unmount must not set state.
      if (cancelled) return

      if (!categoriesResult.ok) {
        setRemoteCatalog(null)

        setCatalogError(categoriesResult.error)
      } else if (!productsResult.ok) {
        setRemoteCatalog(null)

        setCatalogError(productsResult.error)
      } else {
        setRemoteCatalog({
          categories: categoriesResult.data,

          products: productsResult.data,
        })

        setCatalogError(null)
      }

      setCatalogLoading(false)
    })()

    return () => {
      cancelled = true
    }
  }, [catalogNonce])

  /* ── Admin catalogue ─────────────────────────────────────
   *
   * The storefront list is narrowed to ACTIVE + PUBLIC. The access screens
   * need the opposite: every product an entitlement could point at. Read
   * only for an administrator, so a customer's browser never asks for the
   * whole catalogue. */
  const [remoteAdminProducts, setRemoteAdminProducts] = useState<Product[] | null>(
    null,
  )

  useEffect(() => {
    if (!isSupabaseConfigured || actor?.role !== "ADMIN") {
      setRemoteAdminProducts(null)

      return
    }

    let cancelled = false

    void (async () => {
      const result = await fetchAllProductsFromDb()

      if (cancelled) return

      setRemoteAdminProducts(result.ok ? result.data : null)
    })()

    return () => {
      cancelled = true
    }
  }, [actor?.role, catalogNonce])

  /* ── Cache mirror ───────────────────────────────────────
   *
   * The local document is the cache every synchronous consumer reads (cart
   * lines, the reader's product lookup, the editor's pickers), so the rows a
   * hosted read returned are mirrored into it. The admin's full-catalogue
   * read wins when it exists: it is a superset of the public list. A failed
   * read mirrors nothing — neither effect runs on an error, because both
   * sources stay null and pruning on a dropped request would blank the
   * catalogue. */
  useEffect(() => {
    if (!isSupabaseConfigured) return
    const source = remoteAdminProducts ?? remoteCatalog?.products ?? null
    if (source) mirrorRemoteCatalogProducts(source)
  }, [remoteCatalog, remoteAdminProducts])

  useEffect(() => {
    if (!isSupabaseConfigured || !remoteCatalog) return
    mirrorRemoteCatalogCategories(remoteCatalog.categories)
  }, [remoteCatalog])

  const byId = useMemo(
    () => new Map(db.products.map((p) => [p.product_id, p])),
    [db.products],
  )

  const sections = useMemo(
    () => [...db.sections].sort((a, b) => a.display_order - b.display_order),

    [db.sections],
  )

  const testimonials = useMemo(
    () =>
      [...db.testimonials].sort((a, b) => a.display_order - b.display_order),

    [db.testimonials],
  )

  const faqs = useMemo(
    () => [...db.faqs].sort((a, b) => a.display_order - b.display_order),
    [db.faqs],
  )

  const categories = useMemo(
    () => [...db.categories].sort((a, b) => a.display_order - b.display_order),

    [db.categories],
  )

  const published = useMemo(() => listPublicProducts(), [db.products])

  /** The products a visitor sees: the hosted catalogue once it has answered. */
  const catalogProducts = remoteCatalog ? remoteCatalog.products : published

  /* The admin screens read the same rows the service layer writes. A refused
   * or unconfigured read falls back to the mirrored local rows rather than
   * showing an empty screen. */
  const adminProducts =
    remoteAdminProducts !== null ? remoteAdminProducts : db.products

  const catalogCategories = remoteCatalog ? remoteCatalog.categories : categories

  const catalogSource: CatalogSource = remoteCatalog ? "supabase" : "local"

  /* A hosted catalogue that answers with nothing while the local
   * document still holds rows is the one failure that looks exactly
   * like success, so it is reported instead of swallowed. It stays a
   * report: the local rows are not substituted in. */
  useEffect(() => {
    if (!import.meta.env.DEV) return

    if (catalogLoading || catalogError || !remoteCatalog) return

    if (remoteCatalog.products.length > 0) return

    if (published.length === 0 && categories.length === 0) return

    console.warn(
      "[cms] Supabase answered with an empty catalogue " +
        `(${remoteCatalog.products.length} products, ${remoteCatalog.categories.length} categories) ` +
        `while the local document holds ${published.length} published products and ` +
        `${categories.length} categories. The storefront renders the hosted answer, so it ` +
        "will look empty until those tables are seeded.",
    )
  }, [catalogLoading, catalogError, remoteCatalog, published, categories])

  const value = useMemo<CmsContextValue>(() => {
    const lookup = (ids: string[] | undefined): Product[] =>
      resolveProducts(ids).filter((p) => p.status !== "ARCHIVED")

    return {
      settings: db.settings,

      categories,

      products: db.products,

      adminProducts,

      sections,

      testimonials,

      faqs,

      coupons: db.coupons,

      activeSections: sections.filter((s) => s.active),

      publishedProducts: catalogProducts,

      featuredProducts: catalogProducts.filter((p) => p.featured),

      books: catalogProducts.filter(
        (p) => p.product_type === "EBOOK" || p.product_type === "BUNDLE",
      ),

      catalogSource,

      catalogLoading,

      catalogError,

      refreshCatalog,

      storefrontCategories: catalogCategories,

      productById: (id) => (id ? byId.get(id) : undefined),

      /* The sales landing asks for one hardcoded slug. It is served from the
       * storefront catalogue first. The local document is only a second
       * source on an install with no hosted catalogue: with Supabase
       * configured a local-only title is exactly the parallel product this
       * page must not sell, so there the lookup answers from the hosted rows
       * alone (and an empty result correctly degrades to the bundled copy). */
      productBySlug: (slug) =>
        catalogProducts.find((p) => p.slug === slug) ??
        (isSupabaseConfigured
          ? undefined
          : db.products.find((p) => p.slug === slug)),

      categoryName: (id) =>
        catalogCategories.find((c) => c.category_id === id)?.name ?? "",

      findCoupon: findCouponRequest,

      relatedProducts: (product) => lookup(product.related_product_ids),

      upsellProducts: (product) => lookup(product.upsell_ids),

      crossSellProducts: (product) => lookup(product.cross_sell_ids),

      bundleProducts: (product) => lookup(product.bundle_item_ids),

      saveSection: (data, id) => saveSection(actor, data, id),

      deleteSection: (id) => deleteSection(actor, id),

      toggleSection: (id) => toggleSection(actor, id),

      moveSection: (id, dir) => moveSection(actor, id, dir),

      /* Hosted catalogue: the write goes to Supabase through the
       * admin RPCs and the catalogue is re-read afterwards, so every screen
       * (storefront, reader, admin) is serving what the database now holds.
       * Without Supabase the local document is the catalogue, exactly as
       * before. */
      saveProduct: async (data, id) => {
        if (!isSupabaseConfigured) {
          return id ? updateProduct(actor, id, data) : createProduct(actor, data)
        }

        /* Prefer the hosted read over the local mirror when resolving the row
         * being edited: the payload merges Storage metadata over what the row
         * already holds, and the hosted list is the fresher of the two. */
        const existing = id
          ? ((remoteAdminProducts ?? db.products).find(
              (p) => p.product_id === id,
            ) ?? null)
          : null

        const result = await saveProductToDb(
          { ...data, product_id: id ?? data.product_id },
          existing,
        )

        if (result.ok) refreshCatalog()

        return result
      },

      archiveProduct: async (id) => {
        if (!isSupabaseConfigured) return archiveProduct(actor, id)

        const result = await setProductStatusInDb(id, "ARCHIVED")
        if (result.ok) refreshCatalog()
        return result
      },

      deleteProduct: async (id) => {
        if (!isSupabaseConfigured) return deleteProductRequest(actor, id)

        const result = await deleteProductFromDb(id)
        if (result.ok) refreshCatalog()
        return result
      },

      setProductStatus: async (id, status) => {
        if (!isSupabaseConfigured) return setProductStatus(actor, id, status)

        const result = await setProductStatusInDb(id, status)
        if (result.ok) refreshCatalog()
        return result
      },

      moveProduct: async (id, dir) => {
        if (!isSupabaseConfigured) return moveProduct(actor, id, dir)

        const result = await moveProductInDb(id, dir)
        if (result.ok) refreshCatalog()
        return result
      },

      saveCategory: async (data, id) => {
        if (!isSupabaseConfigured) return saveCategory(actor, data, id)

        const existing = id
          ? (db.categories.find((c) => c.category_id === id) ?? null)
          : null

        const name = data.name.trim()
        if (!name) return fail("VALIDATION", "שם הקטגוריה חובה.")

        const taken = db.categories
          .filter((c) => c.category_id !== id)
          .map((c) => c.slug)

        const result = await saveCategoryToDb({
          category_id: id ?? undefined,
          name,
          slug: uniqueSlug(data.slug || name, taken, "category"),
          description: data.description,
          display_order: existing?.display_order,
        })

        if (result.ok) refreshCatalog()

        return result
      },

      deleteCategory: async (id) => {
        if (!isSupabaseConfigured) return deleteCategory(actor, id)

        const result = await deleteCategoryFromDb(id)
        if (result.ok) refreshCatalog()
        return result
      },

      saveTestimonial: (data, id) => saveTestimonial(actor, data, id),

      deleteTestimonial: (id) => deleteTestimonial(actor, id),

      saveFaq: (data, id) => saveFaq(actor, data, id),

      deleteFaq: (id) => deleteFaq(actor, id),

      saveCoupon: (data, id) => saveCoupon(actor, data, id),

      deleteCoupon: (id) => deleteCoupon(actor, id),

      exportBackup: () => exportCmsBackup(actor),

      restoreBackup: (backup) => restoreCmsBackup(actor, backup),
    }
  }, [
    db,
    actor,
    byId,
    categories,
    sections,
    testimonials,
    faqs,
    catalogProducts,
    catalogCategories,
    catalogSource,
    catalogLoading,
    catalogError,
    adminProducts,
    refreshCatalog,
  ])

  return <CmsContext.Provider value={value}>{children}</CmsContext.Provider>
}

export function useCms() {
  const ctx = useContext(CmsContext)

  if (!ctx) throw new Error("useCms must be used inside CmsProvider")

  return ctx
}
