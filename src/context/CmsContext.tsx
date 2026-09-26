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
  fetchCategoriesFromDb,
  fetchPublicProductsFromDb,
} from "../lib/supabase-catalog"

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

  /* Products */

  saveProduct: (data: Partial<Product>, id?: string) => Result<Product>

  archiveProduct: (id: string) => Result<Product>

  deleteProduct: (id: string) => Result

  setProductStatus: (id: string, status: Product["status"]) => Result<Product>

  moveProduct: (id: string, dir: -1 | 1) => Result

  /* Categories */

  saveCategory: (
    data: { name: string, slug?: string, description?: string },
    id?: string,
  ) => Result<Category>

  deleteCategory: (id: string) => Result

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
   * Read from Supabase Postgres, which is where the storefront
   * contract now lives. `categories` and `products` below
   * deliberately stay bound to the local document: the admin
   * panel still writes there, so pointing the editor's own
   * lists at a table it cannot write to would hand it a screen
   * whose saves go nowhere.
   *
   * A read that fails falls back to the local document and says
   * so through `catalogError` and `catalogSource`. A read that
   * succeeds and happens to be empty does not fall back: an
   * empty hosted catalogue is a real answer, and quietly filling
   * it in from local rows is exactly the confusion this state
   * exists to prevent. */
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

      /* The sales landing asks for one hardcoded slug. It is served
       * from the storefront catalogue first and from the local
       * document second, so a title that exists only locally still
       * reaches a paid-traffic page instead of degrading to the
       * bundled placeholder. The lists above never mix sources. */
      productBySlug: (slug) =>
        catalogProducts.find((p) => p.slug === slug) ??
        db.products.find((p) => p.slug === slug),

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

      saveProduct: (data, id) =>
        id ? updateProduct(actor, id, data) : createProduct(actor, data),

      archiveProduct: (id) => archiveProduct(actor, id),

      deleteProduct: (id) => deleteProductRequest(actor, id),

      setProductStatus: (id, status) => setProductStatus(actor, id, status),

      moveProduct: (id, dir) => moveProduct(actor, id, dir),

      saveCategory: (data, id) => saveCategory(actor, data, id),

      deleteCategory: (id) => deleteCategory(actor, id),

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
    refreshCatalog,
  ])

  return <CmsContext.Provider value={value}>{children}</CmsContext.Provider>
}

export function useCms() {
  const ctx = useContext(CmsContext)

  if (!ctx) throw new Error("useCms must be used inside CmsProvider")

  return ctx
}
