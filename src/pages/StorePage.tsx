import { useMemo, useState } from "react"
import { useNavigate } from "react-router"
import { useApp } from "../context/AppContext"
import { useCms } from "../context/CmsContext"
import type { Product, ProductType } from "../types"
import { effectivePrice, isOnSale } from "../types"
import Icon from "../components/icons"
import CmsHint from "../components/CmsHint"

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

function BookCard({ product }: { product: Product }) {
  const { hasAccess, setSelectedProduct } = useApp()
  const { categoryName } = useCms()
  const navigate = useNavigate()
  const owned = hasAccess(product.product_id)
  const [from, to] = product.cover_colors ?? FALLBACK_COVER
  const onSale = isOnSale(product)
  const soldOut = product.availability === "OUT_OF_STOCK"

  const handleAction = () => {
    if (owned) {
      navigate(`/read/${product.product_id}`)
      return
    }
    if (soldOut) return
    setSelectedProduct(product)
    navigate("/checkout")
  }

  return (
    <div className="card-glow flex flex-col p-5">
      <div
        className="w-full h-32 rounded-md mb-4 relative overflow-hidden shadow-lg"
        style={{
          background: product.image_url
            ? undefined
            : `linear-gradient(160deg, ${from}, ${to})`,
        }}
      >
        {product.image_url && (
          <img
            src={product.image_url}
            alt={product.name}
            className="absolute inset-0 w-full h-full object-cover"
          />
        )}
        {/* Spine highlight */}
        <div
          className="absolute top-0 bottom-0 right-0 w-2"
          style={{ background: "rgba(0,0,0,0.25)" }}
        />
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              "linear-gradient(115deg, transparent 40%, rgba(255,255,255,0.12) 50%, transparent 60%)",
          }}
        />
        {product.product_type === "BUNDLE" && (
          <div
            className="absolute top-2 left-2 flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-semibold"
            style={{
              background: "var(--color-primary)",
              color: "var(--color-primary-foreground)",
            }}
          >
            <Icon name="flame" size={12} /> חבילה
          </div>
        )}
        {product.product_type === "SUBSCRIPTION" && (
          <div
            className="absolute top-2 left-2 flex items-center gap-1 text-xs px-2 py-0.5 rounded-full"
            style={{ background: "rgba(255,255,255,0.2)", color: "#fff" }}
          >
            <Icon name="infinity" size={12} /> מנוי
          </div>
        )}
        {soldOut && (
          <div
            className="absolute inset-0 flex items-center justify-center text-xs font-bold"
            style={{ background: "rgba(0,0,0,0.6)", color: "#fff" }}
          >
            אזל מהמלאי
          </div>
        )}
      </div>

      <div
        className="text-xs mb-1"
        style={{ color: "var(--color-muted-foreground)" }}
      >
        {TYPE_LABEL[product.product_type]}
        {product.category_ids?.length
          ? ` · ${categoryName(product.category_ids[0])}`
          : ""}
      </div>
      <h3 className="font-display font-semibold mb-1 leading-snug">
        {product.name}
      </h3>
      {product.book?.author_name && (
        <p
          className="text-xs mb-3"
          style={{ color: "var(--color-muted-foreground)" }}
        >
          מאת {product.book.author_name}
        </p>
      )}
      <p
        className="text-xs leading-relaxed mb-4 flex-1"
        style={{ color: "var(--color-muted-foreground)" }}
      >
        {product.short_description || product.description}
      </p>

      <div className="flex items-center justify-between mt-auto">
        <div>
          {onSale && (
            <span
              className="text-xs line-through ml-1"
              style={{ color: "var(--color-muted-foreground)" }}
            >
              ₪{product.price.toLocaleString()}
            </span>
          )}
          <span
            className="font-display font-semibold"
            style={{ color: "var(--color-primary)" }}
          >
            ₪{effectivePrice(product).toLocaleString()}
            {product.product_type === "SUBSCRIPTION" && "/חודש"}
          </span>
        </div>
        <button
          onClick={handleAction}
          disabled={!owned && soldOut}
          className={
            owned
              ? "flex items-center gap-1.5 px-4 py-1.5 rounded-full text-sm font-semibold"
              : "btn-gradient px-4 py-1.5 rounded-full text-sm font-semibold disabled:opacity-50"
          }
          style={
            owned
              ? {
                  background: "rgba(34,197,94,0.15)",
                  color: "var(--color-success)",
                }
              : undefined
          }
        >
          {owned ? (
            <>
              <Icon name="check" size={14} /> ברשותכם
            </>
          ) : product.availability === "PREORDER" ? (
            "הזמנה מראש"
          ) : (
            "רכישת גישה"
          )}
        </button>
      </div>
    </div>
  )
}

export default function StorePage() {
  const { publishedProducts, storefrontCategories, catalogLoading, catalogSource } =
    useCms()
  const [query, setQuery] = useState("")
  const [categoryId, setCategoryId] = useState("ALL")
  const [typeFilter, setTypeFilter] = useState<ProductType | "ALL">("ALL")

  const typesInCatalog = useMemo(
    () =>
      [
        ...new Set(publishedProducts.map((p) => p.product_type)),
      ] as ProductType[],
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

  const controlClass = "px-3 py-2 rounded-lg border text-sm outline-none"
  const controlStyle = {
    background: "var(--color-secondary)",
    borderColor: "var(--color-border)",
    color: "var(--color-foreground)",
  }

  return (
    /* Carries its own padding so it sits correctly in either shell: the
     * public layout gives it none, the dashboard layout already does. */
    <div className="max-w-4xl mx-auto px-6 py-10 md:py-12 page-enter">
      <div className="mb-8">
        <h1 className="font-display text-4xl font-semibold mb-2">החנות</h1>
        <p style={{ color: "var(--color-muted-foreground)" }}>
          כל הכותרים שפורסמו ב־CMS מוצגים כאן אוטומטית.
        </p>
      </div>

      {/* Search & filters — all options come from the catalogue itself */}
      <div className="flex flex-wrap items-center gap-3 mb-8">
        <div className="relative flex-1 min-w-56">
          <span
            className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none"
            style={{ color: "var(--color-muted-foreground)" }}
          >
            <Icon name="search" size={15} />
          </span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="חיפוש לפי שם, מחבר, תג או מק״ט"
            className={controlClass + " w-full pr-9"}
            style={controlStyle}
          />
        </div>
        <select
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          className={controlClass}
          style={controlStyle}
        >
          <option value="ALL">כל הקטגוריות</option>
          {storefrontCategories.map((c) => (
            <option key={c.category_id} value={c.category_id}>
              {c.name}
            </option>
          ))}
        </select>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as ProductType | "ALL")}
          className={controlClass}
          style={controlStyle}
        >
          <option value="ALL">כל הסוגים</option>
          {typesInCatalog.map((t) => (
            <option key={t} value={t}>
              {TYPE_LABEL[t]}
            </option>
          ))}
        </select>
      </div>

      {/* While the hosted catalogue is in flight, "no products have been
       * published" is not yet a fact worth stating — the read may be about to
       * fill the grid. */}
      {catalogLoading ? (
        <div
          className="rounded-2xl border p-12 flex flex-col items-center gap-3"
          style={{
            background: "var(--color-card)",
            borderColor: "var(--color-border)",
          }}
          role="status"
          aria-live="polite"
        >
          <span
            className="w-6 h-6 rounded-full border-2 animate-spin"
            style={{
              borderColor: "var(--color-border)",
              borderTopColor: "var(--color-primary)",
            }}
          />
          <span
            className="text-xs"
            style={{ color: "var(--color-muted-foreground)" }}
          >
            טוען…
          </span>
        </div>
      ) : publishedProducts.length === 0 ? (
        <div
          className="rounded-2xl border p-12 text-center"
          style={{
            background: "var(--color-card)",
            borderColor: "var(--color-border)",
          }}
        >
          <span
            className="w-14 h-14 rounded-full mx-auto mb-4 flex items-center justify-center"
            style={{
              background: "rgba(212,160,48,0.12)",
              color: "var(--color-primary)",
            }}
          >
            <Icon name="box" size={24} />
          </span>
          <h2 className="font-display text-xl font-bold mb-2">
            טרם נוצרו מוצרים
          </h2>
          <p
            className="text-sm"
            style={{ color: "var(--color-muted-foreground)" }}
          >
            אין כרגע מוצרים שפורסמו בחנות. לאחר שיוגדרו מוצרים ב־CMS הם יופיעו
            כאן אוטומטית.
          </p>
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
        <div
          className="rounded-2xl border p-10 text-center"
          style={{
            background: "var(--color-card)",
            borderColor: "var(--color-border)",
          }}
        >
          <h2 className="font-display text-lg font-bold mb-2">
            לא נמצאו תוצאות
          </h2>
          <p
            className="text-sm"
            style={{ color: "var(--color-muted-foreground)" }}
          >
            אין מוצרים התואמים את החיפוש או הסינון שבחרתם.
          </p>
        </div>
      ) : (
        <>
          {/* E-books */}
          <div className="mb-10">
            <h2
              className="text-sm font-semibold tracking-wide mb-4 flex items-center gap-2"
              style={{ color: "var(--color-muted-foreground)" }}
            >
              <Icon name="book" size={15} /> ספרים דיגיטליים
              <span className="text-xs">({ebooks.length})</span>
            </h2>
            {ebooks.length === 0 ? (
              <p
                className="text-sm"
                style={{ color: "var(--color-muted-foreground)" }}
              >
                {filtering
                  ? "אין ספרים דיגיטליים בתוצאות הסינון."
                  : "לא הוגדרו עדיין ספרים דיגיטליים."}
              </p>
            ) : (
              <div className="grid md:grid-cols-2 gap-4">
                {ebooks.map((p) => (
                  <BookCard key={p.product_id} product={p} />
                ))}
              </div>
            )}
          </div>

          {/* Everything else */}
          {offers.length > 0 && (
            <div>
              <h2
                className="text-sm font-semibold tracking-wide mb-4 flex items-center gap-2"
                style={{ color: "var(--color-muted-foreground)" }}
              >
                <Icon name="gift" size={15} /> חבילות, מנויים ומוצרים נוספים
                <span className="text-xs">({offers.length})</span>
              </h2>
              <div className="grid md:grid-cols-2 gap-4">
                {offers.map((p) => (
                  <BookCard key={p.product_id} product={p} />
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
