/* ─────────────────────────────────────────────────────────────
 * Catalogue & CMS content context.
 *
 * A read-through facade over the store plus the catalogue service.
 * It owns no state of its own: everything it exposes is derived from
 * the persisted database, so a product created in the CMS appears on
 * the storefront in the same render without any code change, and
 * nothing is ever silently re-seeded.
 *
 * Every mutation forwards the signed-in actor to the service layer,
 * which is where the permission check actually happens.
 * ───────────────────────────────────────────────────────────── */

import { createContext, useContext, useMemo, type ReactNode } from "react"

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

      publishedProducts: published,

      featuredProducts: published.filter((p) => p.featured),

      books: published.filter(
        (p) => p.product_type === "EBOOK" || p.product_type === "BUNDLE",
      ),

      productById: (id) => (id ? byId.get(id) : undefined),

      productBySlug: (slug) => db.products.find((p) => p.slug === slug),

      categoryName: (id) =>
        categories.find((c) => c.category_id === id)?.name ?? "",

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
  }, [db, actor, byId, categories, sections, testimonials, faqs, published])

  return <CmsContext.Provider value={value}>{children}</CmsContext.Provider>
}

export function useCms() {
  const ctx = useContext(CmsContext)

  if (!ctx) throw new Error("useCms must be used inside CmsProvider")

  return ctx
}
