import { useMemo, useState } from "react"
import { Link, useLocation, useNavigate } from "react-router"
import { useApp } from "../context/AppContext"
import { useCms } from "../context/CmsContext"
import { useContent } from "../content/useContent"
import { Rich } from "../content/render"
import type { Product, ProductType } from "../types"
import { effectivePrice, isOnSale } from "../types"
import Icon from "../components/icons"
import CmsHint from "../components/CmsHint"
import PageHeader from "../components/ui/PageHeader"
import EmptyState from "../components/ui/EmptyState"
import Alert from "../components/ui/Alert"
import Spinner from "../components/ui/Spinner"

const TYPE_LABEL: Record<ProductType, string> = {
  EBOOK: "ספר דיגיטלי",
  BUNDLE: "חבילה",
  SUBSCRIPTION: "מנוי",
  DIGITAL_PRODUCT: "מוצר דיגיטלי",
  PHYSICAL_PRODUCT: "מוצר פיזי",
  COURSE: "קורס",
  PREMIUM_ACCESS: "גישה מורחבת",
}

const FALLBACK_COVER: [string, string] = ["#1A1A2E", "#2A2A3E"]

function ProductTypeIcon({ type }: { type: ProductType }) {
  if (type === "BUNDLE") return <Icon name="flame" size={12} />
  if (type === "SUBSCRIPTION") return <Icon name="infinity" size={12} />
  return null
}

function ProductCover({ product }: { product: Product }) {
  const [from, to] = product.cover_colors ?? FALLBACK_COVER
  const soldOut = product.availability === "OUT_OF_STOCK"
  const { hasAccess } = useApp()
  const owned = hasAccess(product.product_id)

  return (
    <div
      className="relative aspect-[2/3] w-24 shrink-0 overflow-hidden rounded-[var(--radius-md)] border shadow-lg sm:w-28"
      style={{
        borderColor: "var(--color-border)",
        background: `linear-gradient(160deg, ${from}, ${to})`,
      }}
    >
      {product.image_url ? (
        <img
          src={product.image_url}
          alt={`עטיפת ${product.name}`}
          loading="lazy"
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : (
        <div
          className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-2 text-center text-white/75"
          aria-hidden="true"
        >
          <Icon name="bookOpen" size={24} />
          <span className="text-[9px] font-semibold tracking-[0.18em]">
            CASANOVA
          </span>
        </div>
      )}

      {/* Spine on the reading edge (the right in RTL). */}
      <div
        className="absolute inset-y-0 start-0 w-1.5"
        style={{ background: "rgba(0,0,0,0.28)" }}
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "linear-gradient(115deg, transparent 40%, rgba(255,255,255,0.12) 50%, transparent 60%)",
        }}
        aria-hidden="true"
      />

      {isOnSale(product) && (
        <span
          className="app-badge absolute start-2 top-2"
          style={{
            background: "var(--color-primary)",
            borderColor: "transparent",
            color: "var(--color-primary-foreground)",
          }}
        >
          מבצע
        </span>
      )}

      {soldOut && !owned && (
        <div
          className="absolute inset-0 flex items-center justify-center p-2 text-center text-[11px] font-bold text-white"
          style={{ background: "rgba(0,0,0,0.64)" }}
          aria-hidden="true"
        >
          אזל מהמלאי
        </div>
      )}
    </div>
  )
}

function BookCard({ product }: { product: Product }) {
  const { hasAccess, setSelectedProduct } = useApp()
  const { categoryName } = useCms()
  const navigate = useNavigate()

  const owned = hasAccess(product.product_id)
  const onSale = isOnSale(product)
  const soldOut = product.availability === "OUT_OF_STOCK"
  const preorder = product.availability === "PREORDER" && !soldOut
  const placeholderDescription = /^(.*\s)?תיאור (קצרצר|מלא)$/
  const shortDescription = product.short_description?.trim() ?? ""
  const description = placeholderDescription.test(shortDescription)
    ? placeholderDescription.test(product.description?.trim() ?? "")
      ? ""
      : product.description.trim()
    : shortDescription || product.description?.trim() || ""
  const category = product.category_ids?.length
    ? categoryName(product.category_ids[0])
    : ""

  const handleAction = () => {
    if (owned) {
      navigate(`/read/${product.product_id}`)
      return
    }
    if (soldOut) return
    setSelectedProduct(product)
    navigate("/checkout")
  }

  const ctaLabel = owned
    ? "לקריאה"
    : soldOut
      ? "אזל מהמלאי"
      : preorder
        ? "הזמנה מראש"
        : "רכישת גישה"

  const ctaAriaLabel = owned
    ? `קריאה — ${product.name}`
    : soldOut
      ? `אזל מהמלאי — ${product.name}`
      : preorder
        ? `הזמנה מראש — ${product.name}`
        : `רכישת גישה — ${product.name}`

  return (
    <article className="app-surface flex h-full flex-col overflow-hidden">
      <div className="flex flex-1 gap-4 p-4 sm:p-5">
        <ProductCover product={product} />

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            <span className="app-badge app-badge--neutral">
              <ProductTypeIcon type={product.product_type} />
              {TYPE_LABEL[product.product_type]}
            </span>
            {owned && (
              <span className="app-badge app-badge--success">
                <Icon name="check" size={11} /> ברשותכם
              </span>
            )}
            {!owned && soldOut && (
              <span className="app-badge app-badge--danger">אזל מהמלאי</span>
            )}
            {!owned && preorder && (
              <span className="app-badge app-badge--warning">הזמנה מראש</span>
            )}
          </div>

          <h3 className="line-clamp-2 font-display text-lg font-semibold leading-snug text-balance">
            {product.name}
          </h3>

          {product.book?.author_name && (
            <p className="mt-1 text-xs app-muted">
              מאת {product.book.author_name}
            </p>
          )}

          {category && <p className="mt-1 text-xs app-muted">{category}</p>}

          {description && (
            <p className="mt-2 line-clamp-3 text-sm leading-relaxed app-muted">
              {description}
            </p>
          )}
        </div>
      </div>

      <div
        className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3 sm:px-5"
        style={{ borderColor: "var(--color-border)" }}
      >
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          {onSale && (
            <s
              className="text-xs app-muted"
              aria-label={`מחיר קודם: ₪${product.price.toLocaleString()}`}
            >
              <span dir="ltr">₪{product.price.toLocaleString()}</span>
            </s>
          )}
          <span
            className="font-display text-lg font-semibold"
            style={{ color: "var(--color-primary)" }}
          >
            <span dir="ltr">₪{effectivePrice(product).toLocaleString()}</span>
          </span>
          {product.product_type === "SUBSCRIPTION" && (
            <span className="text-xs app-muted">לחודש</span>
          )}
        </div>

        <button
          type="button"
          onClick={handleAction}
          disabled={!owned && soldOut}
          aria-label={ctaAriaLabel}
          className={owned ? "app-btn-secondary" : "app-btn"}
        >
          {owned ? (
            <>
              <Icon name="bookOpen" size={14} />
              {ctaLabel}
            </>
          ) : soldOut ? (
            ctaLabel
          ) : (
            <>
              {ctaLabel}
              {!soldOut && <Icon name="arrowLeft" size={14} />}
            </>
          )}
        </button>
      </div>
    </article>
  )
}

export default function StorePage() {
  const {
    publishedProducts,
    storefrontCategories,
    catalogLoading,
    catalogError,
    catalogSource,
  } = useCms()
  const c = useContent()
  const location = useLocation()
  const inDashboard = location.pathname.startsWith("/dashboard")

  const [query, setQuery] = useState("")
  const [categoryId, setCategoryId] = useState("ALL")
  const [typeFilter, setTypeFilter] = useState<ProductType | "ALL">("ALL")

  const typesInCatalog = useMemo(
    () => [...new Set(publishedProducts.map((p) => p.product_type))] as ProductType[],
    [publishedProducts],
  )

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return publishedProducts.filter((p) => {
      if (categoryId !== "ALL" && !(p.category_ids ?? []).includes(categoryId))
        return false
      if (typeFilter !== "ALL" && p.product_type !== typeFilter) return false
      if (!q) return true
      return (
        p.name.toLowerCase().includes(q) ||
        (p.book?.author_name ?? "").toLowerCase().includes(q) ||
        p.short_description.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q) ||
        (p.tags ?? []).some((t) => t.toLowerCase().includes(q)) ||
        (p.sku ?? "").toLowerCase().includes(q)
      )
    })
  }, [publishedProducts, query, categoryId, typeFilter])

  const ebooks = filtered.filter((p) => p.product_type === "EBOOK")
  const offers = filtered.filter((p) => p.product_type !== "EBOOK")
  const filtering =
    Boolean(query.trim()) || categoryId !== "ALL" || typeFilter !== "ALL"

  const clearFilters = () => {
    setQuery("")
    setCategoryId("ALL")
    setTypeFilter("ALL")
  }

  const heroTitle = c("store.hero.title") || "חנות הספרים"
  const plainTitle = heroTitle.replace(/\*/g, "").replace(/[.\s]+$/u, "")
  const supportPath = inDashboard ? "/dashboard/support" : "/support"

  return (
    <div
      className={
        inDashboard
          ? "page-enter"
          : "page-enter px-5 py-10 sm:px-8 md:py-14 lg:px-12"
      }
    >
      <div className="app-page app-page--content">
        <PageHeader
          eyebrow="CASANOVA · חנות"
          title={<Rich text={heroTitle} />}
          metaTitle={plainTitle}
          description={
            c("store.hero.lede") ||
            "כל הכותרים שפורסמו ב־CMS מוצגים כאן אוטומטית."
          }
          breadcrumbs={
            inDashboard
              ? [
                  { label: "לוח אישי", to: "/dashboard" },
                  { label: plainTitle },
                ]
              : [
                  { label: "דף הבית", to: "/" },
                  { label: plainTitle },
                ]
          }
          actions={
            <div className="flex flex-wrap items-center justify-end gap-2">
              {!catalogLoading && publishedProducts.length > 0 && (
                <span className="app-badge app-badge--neutral">
                  {publishedProducts.length === 1
                    ? "כותר אחד"
                    : `${publishedProducts.length} כותרים`}
                </span>
              )}
              <Link to={supportPath} className="app-btn-secondary">
                <Icon name="message" size={15} />
                תמיכה
              </Link>
            </div>
          }
        />

        {/* Search and filters. Every option is derived from the catalogue
         * itself, and every control has a visible label in addition to its
         * accessible name. */}
        <section
          className="app-surface mb-8"
          aria-labelledby="store-filter-title"
        >
          <div className="app-surface-head">
            <div>
              <h2 id="store-filter-title" className="app-section-title">
                חיפוש וסינון
              </h2>
              <p className="app-hint mt-1">
                מצאו כותר לפי שם, מחבר, קטגוריה או סוג מוצר.
              </p>
            </div>
            {filtering && (
              <button
                type="button"
                onClick={clearFilters}
                className="app-btn-ghost"
              >
                <Icon name="x" size={14} />
                איפוס הסינון
              </button>
            )}
          </div>

          <div className="app-surface-body grid gap-4 md:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)]">
            <div className="app-field">
              <label htmlFor="store-search" className="app-label">
                חיפוש
              </label>
              <div className="relative">
                <span
                  className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 app-muted"
                  aria-hidden="true"
                >
                  <Icon name="search" size={15} />
                </span>
                <input
                  id="store-search"
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="שם, מחבר, תג או מק״ט"
                  className="w-full ps-9"
                  aria-controls="store-catalogue"
                />
              </div>
            </div>

            <div className="app-field">
              <label htmlFor="store-category" className="app-label">
                קטגוריה
              </label>
              <select
                id="store-category"
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                className="w-full"
                aria-controls="store-catalogue"
              >
                <option value="ALL">כל הקטגוריות</option>
                {storefrontCategories.map((category) => (
                  <option key={category.category_id} value={category.category_id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="app-field">
              <label htmlFor="store-type" className="app-label">
                סוג מוצר
              </label>
              <select
                id="store-type"
                value={typeFilter}
                onChange={(e) =>
                  setTypeFilter(e.target.value as ProductType | "ALL")
                }
                className="w-full"
                aria-controls="store-catalogue"
              >
                <option value="ALL">כל הסוגים</option>
                {typesInCatalog.map((type) => (
                  <option key={type} value={type}>
                    {TYPE_LABEL[type]}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </section>

        <div id="store-catalogue">
          {catalogError && !catalogLoading && (
            <div className="mb-6">
              <Alert tone="warning" title="הקטלוג לא עודכן מהשרת">
                לא הצלחנו לרענן את הקטלוג. מוצג הקטלוג השמור במכשיר, אם קיים.
              </Alert>
            </div>
          )}

          {catalogLoading ? (
            <div className="app-surface">
              <Spinner label="טוען את הקטלוג…" />
            </div>
          ) : publishedProducts.length === 0 ? (
            <div>
              <EmptyState
                icon="box"
                title={c("store.empty.title") || "טרם נוצרו מוצרים"}
                description={
                  c("store.empty.text") ||
                  "אין כרגע מוצרים שפורסמו בחנות. לאחר שיוגדרו מוצרים ב־CMS הם יופיעו כאן אוטומטית."
                }
              />
              {/* An empty storefront has two very different causes, and only
               * an administrator can act on either. Say which one it is
               * instead of leaving the page to be misread as a bug. */}
              {catalogSource === "supabase" ? (
                <div className="mt-4">
                  <CmsHint what="הקטלוג נקרא כעת מ־Supabase ואין בו מוצרים מפורסמים. מוצר שנוצר בממשק הניהול נשמר עדיין במסמך המקומי, ולכן אינו מופיע כאן עד להשלמת מעבר כתיבת הקטלוג." />
                </div>
              ) : null}
            </div>
          ) : filtered.length === 0 ? (
            <EmptyState
              icon="search"
              title="לא נמצאו תוצאות"
              description="אין מוצרים התואמים את החיפוש או הסינון שבחרתם."
              actions={
                <button
                  type="button"
                  onClick={clearFilters}
                  className="app-btn-secondary"
                >
                  ניקוי הסינון
                </button>
              }
            />
          ) : (
            <>
              <div className="mb-5 flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm app-muted">
                  {filtering
                    ? `${filtered.length === 1 ? "תוצאה אחת" : `${filtered.length} תוצאות`} מתוך ${
                        publishedProducts.length === 1
                          ? "כותר אחד"
                          : `${publishedProducts.length} כותרים`
                      }`
                    : publishedProducts.length === 1
                      ? "כותר אחד בקטלוג"
                      : `${publishedProducts.length} כותרים בקטלוג`}
                </p>
              </div>

              <div className="space-y-10">
                {ebooks.length > 0 && (
                  <section aria-labelledby="store-ebooks-title">
                    <div className="mb-4 flex items-center justify-between gap-3">
                      <h2
                        id="store-ebooks-title"
                        className="flex items-center gap-2 font-display text-xl font-semibold"
                      >
                        <Icon
                          name="book"
                          size={17}
                          style={{ color: "var(--color-primary)" }}
                        />
                        ספרים דיגיטליים
                      </h2>
                      <span className="app-badge app-badge--neutral">
                        {ebooks.length}
                      </span>
                    </div>
                    <div className="grid gap-4 md:grid-cols-2">
                      {ebooks.map((product) => (
                        <BookCard key={product.product_id} product={product} />
                      ))}
                    </div>
                  </section>
                )}

                {offers.length > 0 && (
                  <section aria-labelledby="store-offers-title">
                    <div className="mb-4 flex items-center justify-between gap-3">
                      <h2
                        id="store-offers-title"
                        className="flex items-center gap-2 font-display text-xl font-semibold"
                      >
                        <Icon
                          name="gift"
                          size={17}
                          style={{ color: "var(--color-primary)" }}
                        />
                        חבילות, מנויים ומוצרים נוספים
                      </h2>
                      <span className="app-badge app-badge--neutral">
                        {offers.length}
                      </span>
                    </div>
                    <div className="grid gap-4 md:grid-cols-2">
                      {offers.map((product) => (
                        <BookCard key={product.product_id} product={product} />
                      ))}
                    </div>
                  </section>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
