import { useState } from "react"
import { Link, useNavigate } from "react-router"
import { useApp } from "../context/AppContext"
import { useCms } from "../context/CmsContext"
import type { CmsSection, Product } from "../types"
import { effectivePrice, FREEFORM_SECTION_TYPES, isOnSale } from "../types"
import { toEmbedUrl } from "../lib/media"
import Icon from "../components/icons"
import CmsHint from "../components/CmsHint"
import logoImg from "../../images/main_photo.jpg"

/** Neutral gradient used when a product has neither a cover image nor colours. */
const FALLBACK_COVER: [string, string] = ["#1A1A2E", "#2A2A3E"]

function BookCover({
  product,
  size = "md",
}: {
  product: Product
  size?: "sm" | "md" | "lg"
}) {
  const dims =
    size === "lg" ? "w-44 h-64" : size === "md" ? "w-32 h-48" : "w-20 h-28"
  const [from, to] = product.cover_colors ?? FALLBACK_COVER
  if (product.image_url) {
    return (
      <div
        className={`${dims} rounded-xl flex-shrink-0 relative overflow-hidden shadow-2xl`}
      >
        <img
          src={product.image_url}
          alt={product.name}
          className="absolute inset-0 w-full h-full object-cover"
        />
      </div>
    )
  }
  return (
    <div
      className={`${dims} rounded-xl flex flex-col justify-end p-3 flex-shrink-0 relative overflow-hidden`}
      style={{
        background: `linear-gradient(160deg, ${from}, ${to})`,
        boxShadow: `0 24px 60px ${to}66, inset 0 1px 0 rgba(255,255,255,0.15)`,
      }}
    >
      {/* Spine highlight */}
      <div
        className="absolute top-0 right-0 bottom-0 w-1.5"
        style={{ background: "rgba(255,255,255,0.12)" }}
      />
      {/* Sheen */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "linear-gradient(115deg, rgba(255,255,255,0.12) 0%, transparent 35%)",
        }}
      />
      <div
        className="text-xs font-display font-bold leading-tight"
        style={{ color: "rgba(255,255,255,0.95)" }}
      >
        {product.name}
      </div>
      {product.book?.author_name && (
        <div
          className="text-xs mt-1 opacity-70"
          style={{ color: "rgba(255,255,255,0.75)" }}
        >
          {product.book.author_name}
        </div>
      )}
    </div>
  )
}

function StarRating({ rating }: { rating: number }) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <Icon
          key={i}
          name="star"
          size={12}
          style={{
            color:
              i <= Math.round(rating)
                ? "var(--color-primary)"
                : "var(--color-border)",
            fill: i <= Math.round(rating) ? "currentColor" : "none",
          }}
        />
      ))}
    </div>
  )
}

/* Testimonials & FAQ are managed in the CMS (admin → CMS) and rendered from the CmsContext store. */

/**
 * A section heading together with the gold rule that introduces it.
 *
 * The two are bound on purpose. On a site nobody has configured yet the
 * heading is simply absent, and a divider left hanging above nothing reads
 * as a rendering bug rather than as missing content — so with no title and no
 * blurb the pair disappears entirely for a visitor, and an administrator gets
 * the dashed hint in place of the heading, rule and all.
 */
function SectionTitle({
  title,
  blurb,
  hint,
}: {
  title?: string
  blurb?: string
  hint: string
}) {
  const { isAdmin } = useApp()
  const text = title?.trim()
  const body = blurb?.trim()
  if (!text && !body && !isAdmin) return null
  return (
    <div className="mb-12">
      {(text || isAdmin) && <span className="gold-rule mb-4" />}
      {text ? (
        <h2 className="font-display text-4xl font-bold whitespace-pre-line">
          {text}
        </h2>
      ) : (
        <CmsHint what={hint} />
      )}
      {body && (
        <p
          className="mt-3 whitespace-pre-line"
          style={{ color: "var(--color-muted-foreground)" }}
        >
          {body}
        </p>
      )}
    </div>
  )
}

export default function LandingPage() {
  const navigate = useNavigate()
  const { setSelectedProduct, hasAccess, isAuthenticated, isAdmin } = useApp()
  const cms = useCms()
  const [openFaq, setOpenFaq] = useState<number | null>(null)

  const products = cms.publishedProducts
  const featuredBook =
    products.find((p) => p.product_type === "EBOOK") ?? products[0]
  const ebookProducts = products.filter((p) => p.product_type === "EBOOK")
  const bundle = products.find((p) => p.product_type === "BUNDLE")
  const subscription = products.find((p) => p.product_type === "SUBSCRIPTION")

  /* CMS-driven content. HERO, TESTIMONIALS, FAQ and CTA each own one
   * fixed slot on the page. The rest are free-form blocks rendered as an
   * ordered stream, which is how an editor composes the middle of the
   * page — how many blocks, in what order, with what wording — without
   * anybody touching code. SALES sections are excluded — they belong to
   * the dedicated sales landing at /hi-kodem. */
  const homeSections = cms.activeSections.filter((s) => s.page !== "SALES")
  const heroSection = homeSections.find((s) => s.type === "HERO")
  const testimonialsSection = homeSections.find(
    (s) => s.type === "TESTIMONIALS",
  )
  const faqSection = homeSections.find((s) => s.type === "FAQ")
  const ctaSection = homeSections.find((s) => s.type === "CTA")
  const freeform = homeSections.filter((s) =>
    FREEFORM_SECTION_TYPES.includes(s.type),
  )
  const testimonials = [...cms.testimonials]
    .filter((t) => t.active)
    .sort((a, b) => a.display_order - b.display_order)
  const faqs = [...cms.faqs]
    .filter((f) => f.active)
    .sort((a, b) => a.display_order - b.display_order)

  /* Only real, derivable figures are shown. Anything the database cannot
   * substantiate (reader counts, satisfaction percentages) is left out
   * rather than invented. */
  const rated = products.filter(
    (p) => typeof p.rating === "number" && (p.reviews_count ?? 0) > 0,
  )
  const averageRating =
    rated.length > 0
      ? Math.round(
          (rated.reduce((sum, p) => sum + (p.rating ?? 0), 0) / rated.length) *
            10,
        ) / 10
      : null
  const totalReviews = rated.reduce((sum, p) => sum + (p.reviews_count ?? 0), 0)
  const proofPoints = [
    {
      value: String(products.length),
      label: products.length === 1 ? "כותר בקטלוג" : "כותרים בקטלוג",
      star: false,
    },
    ...(averageRating !== null
      ? [
          {
            value: String(averageRating),
            label: `דירוג ממוצע · ${totalReviews.toLocaleString()} ביקורות`,
            star: true,
          },
        ]
      : []),
    { value: String(cms.categories.length), label: "קטגוריות", star: false },
  ]

  /* Site copy comes from settings and from CMS blocks; nothing below has a
   * written-in-code fallback. An empty field renders nothing at all to a
   * visitor and an outlined hint naming the field to an administrator.
   *
   * This page used to bail out here whenever the catalogue was empty, which
   * made the site impossible to build through the CMS: there was nothing left
   * to build it with, because the one screen that exposes the content was the
   * screen refusing to render. An empty database now produces an empty page,
   * and every slot on it is reachable from the admin. */
  const settings = cms.settings
  const trustBadges = (settings.trust_badges ?? [])
    .map((b) => b.trim())
    .filter(Boolean)

  /* The editor owns the whole headline. Line one is set plain and any further
   * lines pick up the gold gradient, so a two-line title reads the way the old
   * hardcoded one did — without half of it being written in code. */
  const heroLines = (heroSection?.title ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
  const heroLead = heroLines[0] ?? ""
  const heroAccent = heroLines.slice(1)

  /* Subscription bullets come from the product's own description, one per
   * line — an editable field that already exists in the product form, rather
   * than a list of features invented here that no editor could ever reach. */
  const subscriptionBullets = (subscription?.description ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)

  const handleBuy = (product: Product) => {
    setSelectedProduct(product)
    navigate("/checkout")
  }

  const formatPrice = (price: number) => `₪${price.toLocaleString()}`

  /* One free-form CMS block. A block whose media is missing renders
   * nothing rather than an empty frame: the editor switched it on but
   * there is nothing to show yet, and an empty box reads as a bug. */
  const renderBlock = (s: CmsSection) => {
    if (s.type === "TEXT") {
      return (
        <section key={s.section_id} className="max-w-3xl mx-auto px-6 py-20">
          <span className="gold-rule mb-4" />
          <h2 className="font-display text-3xl md:text-4xl font-bold mb-4">
            {s.title}
          </h2>
          {s.content && (
            <p
              className="text-base leading-relaxed whitespace-pre-line"
              style={{ color: "var(--color-muted-foreground)" }}
            >
              {s.content}
            </p>
          )}
        </section>
      )
    }

    if (s.type === "VIDEO") {
      const embed = s.media_url ? toEmbedUrl(s.media_url) : null
      if (!embed) return null
      return (
        <section key={s.section_id} className="max-w-5xl mx-auto px-6 py-20">
          <div className="mb-10">
            <span className="gold-rule mb-4" />
            <h2 className="font-display text-3xl md:text-4xl font-bold">
              {s.title}
            </h2>
            {s.content && (
              <p
                className="mt-3"
                style={{ color: "var(--color-muted-foreground)" }}
              >
                {s.content}
              </p>
            )}
          </div>
          <div
            className="rounded-2xl overflow-hidden border"
            style={{
              borderColor: "rgba(212,160,48,0.3)",
              boxShadow: "0 24px 60px rgba(0,0,0,0.25)",
            }}
          >
            <div className="relative w-full" style={{ paddingTop: "56.25%" }}>
              <iframe
                src={embed}
                title={s.title}
                className="absolute inset-0 w-full h-full"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            </div>
          </div>
        </section>
      )
    }

    if (s.type === "GALLERY") {
      /* Sections saved before `media_urls` existed may still carry one
       * image in `media_url`; honouring it beats dropping it. */
      const images = (
        s.media_urls?.length ? s.media_urls : s.media_url ? [s.media_url] : []
      )
        .map((u) => u.trim())
        .filter(Boolean)
      if (images.length === 0) return null
      return (
        <section key={s.section_id} className="max-w-6xl mx-auto px-6 py-20">
          <div className="mb-10">
            <span className="gold-rule mb-4" />
            <h2 className="font-display text-3xl md:text-4xl font-bold">
              {s.title}
            </h2>
            {s.content && (
              <p
                className="mt-3"
                style={{ color: "var(--color-muted-foreground)" }}
              >
                {s.content}
              </p>
            )}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {images.map((src, i) => (
              <figure
                key={`${src}-${i}`}
                className="m-0 rounded-xl overflow-hidden border"
                style={{ borderColor: "var(--color-border)" }}
              >
                <img
                  src={src}
                  alt={`${s.title} ${i + 1}`}
                  loading="lazy"
                  className="w-full h-44 md:h-56 object-cover block"
                />
              </figure>
            ))}
          </div>
        </section>
      )
    }

    if (s.type !== "PRODUCTS") return null
    /* Which products appear is decided in the products tab, not here:
     * this block controls the heading and the copy around a row of the
     * published catalogue. */
    const row = products.slice(0, 4)
    if (row.length === 0) return null
    return (
      <section key={s.section_id} className="max-w-6xl mx-auto px-6 py-20">
        <div className="mb-10">
          <span className="gold-rule mb-4" />
          <h2 className="font-display text-3xl md:text-4xl font-bold">
            {s.title}
          </h2>
          {s.content && (
            <p
              className="mt-3"
              style={{ color: "var(--color-muted-foreground)" }}
            >
              {s.content}
            </p>
          )}
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-5">
          {row.map((product) => {
            const owned = isAuthenticated && hasAccess(product.product_id)
            return (
              <div
                key={product.product_id}
                className="card-glow p-4 flex flex-col gap-3"
              >
                <BookCover product={product} size="sm" />
                <h3 className="font-display text-base font-bold leading-tight line-clamp-2">
                  {product.name}
                </h3>
                <p
                  className="text-xs leading-relaxed line-clamp-2 flex-1"
                  style={{ color: "var(--color-muted-foreground)" }}
                >
                  {product.short_description}
                </p>
                <div className="flex items-center justify-between gap-2">
                  <span
                    className="font-display text-lg font-bold"
                    style={{ color: "var(--color-primary)" }}
                  >
                    {formatPrice(effectivePrice(product))}
                  </span>
                  {owned ? (
                    <button
                      onClick={() => navigate(`/read/${product.product_id}`)}
                      className="tap-target text-xs font-bold px-3 py-1.5 rounded-full border-2"
                      style={{
                        borderColor: "var(--color-success)",
                        color: "var(--color-success)",
                      }}
                    >
                      קראו
                    </button>
                  ) : (
                    <button
                      onClick={() => handleBuy(product)}
                      className="btn-gradient tap-target text-xs font-bold px-3 py-1.5 rounded-full"
                    >
                      רכישה
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </section>
    )
  }

  return (
    <div style={{ color: "var(--color-foreground)" }}>
      {/* ── HERO ───────────────────────────────────────────────── */}
      <section
        className="relative min-h-screen flex items-center overflow-hidden"
        style={{
          background:
            "radial-gradient(ellipse 80% 60% at 50% -10%, rgba(227,174,60,0.16), transparent), linear-gradient(135deg, var(--color-background) 0%, var(--color-card) 50%, var(--color-background) 100%)",
        }}
      >
        {/* subtle grid texture */}
        <div
          className="absolute inset-0 opacity-5"
          style={{
            backgroundImage:
              "linear-gradient(rgba(212,160,48,0.3) 1px, transparent 1px), linear-gradient(90deg, rgba(212,160,48,0.3) 1px, transparent 1px)",
            backgroundSize: "60px 60px",
          }}
        />

        {/* glow halos */}
        <div
          className="absolute top-1/4 left-1/4 w-96 h-96 rounded-full blur-3xl pointer-events-none glow-pulse"
          style={{ background: "var(--color-primary)" }}
        />
        <div
          className="absolute bottom-0 right-0 w-80 h-80 rounded-full blur-3xl pointer-events-none"
          style={{ background: "#4A148C", opacity: 0.08 }}
        />

        <div className="relative max-w-6xl mx-auto px-6 py-32 grid md:grid-cols-2 gap-16 items-center">
          <div className="page-enter">
            {settings.tagline?.trim() ? (
              <div
                className="inline-flex items-center gap-2 mb-6 px-4 py-1.5 rounded-full border text-xs font-bold"
                style={{
                  borderColor: "rgba(212,160,48,0.3)",
                  color: "var(--color-primary)",
                  background: "rgba(212,160,48,0.07)",
                }}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
                {settings.tagline.trim()}
              </div>
            ) : (
              <CmsHint what="תוכן חסר: סיסמת המותג — הוסיפו אותה ב״הגדרות מערכת ← תוכן האתר״." />
            )}

            {heroLines.length > 0 ? (
              <h1 className="font-display text-5xl md:text-6xl font-bold leading-[1.15] mb-6 whitespace-pre-line">
                {heroLead}
                {heroAccent.length > 0 && (
                  <>
                    <br />
                    <span
                      style={{
                        background:
                          "linear-gradient(90deg, #E7B94C, #D4A030 60%, #B8862A)",
                        WebkitBackgroundClip: "text",
                        WebkitTextFillColor: "transparent",
                      }}
                    >
                      {heroAccent.join("\n")}
                    </span>
                  </>
                )}
              </h1>
            ) : (
              <CmsHint what="תוכן חסר: כותרת ראשית — הפעילו בלוק HERO ב־CMS וכתבו אותה שם, שורה לכל שורה." />
            )}

            {heroSection?.content && (
              <p
                className="text-lg leading-relaxed mb-8 max-w-md whitespace-pre-line"
                style={{ color: "var(--color-muted-foreground)" }}
              >
                {heroSection.content}
              </p>
            )}

            {/* Collapsed when it would hold nothing. On an unconfigured site
                neither button has a reason to exist, and an empty flex row
                still contributes its mb-10 to the hero's layout. */}
            {(featuredBook || ebookProducts.length > 0) && (
              <div className="flex flex-wrap items-center gap-4 mb-10">
                {featuredBook && (
                  <button
                    onClick={() => handleBuy(featuredBook)}
                    className="btn-gradient px-8 py-3.5 rounded-full font-bold text-sm"
                  >
                    התחילו לקרוא — {formatPrice(effectivePrice(featuredBook))}
                  </button>
                )}
                {ebookProducts.length > 0 && (
                  <a
                    href="#catalog"
                    className="px-8 py-3.5 rounded-full font-bold text-sm border transition-all hover:bg-white/5 hover:border-white/30"
                    style={{
                      borderColor: "var(--color-border)",
                      color: "var(--color-foreground)",
                    }}
                  >
                    עיינו בקטלוג
                  </a>
                )}
              </div>
            )}

            {trustBadges.length > 0 && (
              <div
                className="flex flex-wrap items-center gap-6 text-sm"
                style={{ color: "var(--color-muted-foreground)" }}
              >
                {trustBadges.map((item) => (
                  <div key={item} className="flex items-center gap-2">
                    <Icon
                      name="checkCircle"
                      size={15}
                      style={{ color: "var(--color-success)" }}
                    />{" "}
                    {item}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Book stack visual — rendered only when there is a book to stack. */}
          {featuredBook && (
            <div className="hidden md:flex justify-center items-center relative">
              <div className="relative">
                {products[1] && (
                  <div className="absolute -right-10 top-8 opacity-50 float-slower">
                    <BookCover product={products[1]} size="md" />
                  </div>
                )}
                {products[2] && (
                  <div className="absolute -left-10 top-12 opacity-50 float-slow">
                    <BookCover product={products[2]} size="md" />
                  </div>
                )}
                <div className="relative z-10 float-slow">
                  <BookCover product={featuredBook} size="lg" />
                </div>
              </div>

              {/* floating badge */}
              <div
                className="absolute -bottom-4 -left-4 px-5 py-3.5 rounded-2xl border glass shadow-2xl float-slower"
                style={{ borderColor: "rgba(212,160,48,0.3)" }}
              >
                <p
                  className="text-xs mb-1"
                  style={{ color: "var(--color-muted-foreground)" }}
                >
                  כותרים זמינים כעת
                </p>
                <p
                  className="font-display text-2xl font-bold"
                  style={{ color: "var(--color-primary)" }}
                >
                  {products.length}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* scroll indicator */}
        <div
          className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 opacity-40"
          style={{ color: "var(--color-muted-foreground)" }}
        >
          <div className="w-px h-8" style={{ background: "currentColor" }} />
          <span className="text-xs font-bold">גללו למטה</span>
        </div>
      </section>

      {/* ── CATALOG FACTS (derived from the live catalogue) ────── */}
      {/* Suppressed outright on an empty catalogue: a strip announcing "0
          titles" is not a fact worth stating, it is a billboard saying the
          shop has nothing in it. */}
      {products.length > 0 && (
        <div
          className="border-y"
          style={{
            borderColor: "var(--color-border)",
            background: "var(--color-card)",
          }}
        >
          <div className="max-w-6xl mx-auto px-6 py-6 flex flex-wrap items-center justify-between gap-6 text-sm">
            {proofPoints.map(({ value, label, star }) => (
              <div key={label} className="flex items-center gap-4">
                <span
                  className="flex items-center gap-1.5 font-display text-2xl font-bold"
                  style={{ color: "var(--color-primary)" }}
                >
                  {value}
                  {star && (
                    <Icon
                      name="star"
                      size={16}
                      style={{ fill: "currentColor" }}
                    />
                  )}
                </span>
                <span style={{ color: "var(--color-muted-foreground)" }}>
                  {label}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── CATALOG ───────────────────────────────────────────── */}
      {/* Hidden rather than rendered empty: with no e-books, and no visitor
          able to see the hint that explains their absence, the section would
          collapse to its own py-24 padding and leave an unexplained gap in
          the middle of the page. */}
      {(ebookProducts.length > 0 || isAdmin) && (
        <section id="catalog" className="max-w-6xl mx-auto px-6 py-24">
          <SectionTitle
            title={settings.catalogue_title}
            blurb={settings.catalogue_blurb}
            hint="תוכן חסר: כותרת אזור הקטלוג — הוסיפו אותה ב״הגדרות מערכת ← תוכן האתר״."
          />

          <div className="grid md:grid-cols-2 gap-6">
            {ebookProducts.length === 0 && (
              <div className="md:col-span-2">
                <CmsHint what="אין מוצרים מסוג ספר דיגיטלי — הוסיפו מוצר בניהול המוצרים ופרסמו אותו, והוא יופיע כאן." />
              </div>
            )}
            {ebookProducts.map((product) => {
              const owned = isAuthenticated && hasAccess(product.product_id)
              const onSale = isOnSale(product)
              return (
                <div
                  key={product.product_id}
                  className="card-glow flex gap-5 p-5 group"
                >
                  <BookCover product={product} size="md" />
                  <div className="flex flex-col justify-between py-1 min-w-0">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span
                          className="text-xs font-bold px-2 py-0.5 rounded-full"
                          style={{
                            background: "rgba(212,160,48,0.1)",
                            color: "var(--color-primary)",
                          }}
                        >
                          ספר דיגיטלי
                        </span>
                        {onSale && (
                          <span
                            className="text-xs font-bold px-2 py-0.5 rounded-full"
                            style={{
                              background: "rgba(239,68,68,0.12)",
                              color: "var(--color-danger)",
                            }}
                          >
                            מבצע
                          </span>
                        )}
                      </div>
                      <h3 className="font-display text-xl font-bold mb-1 leading-tight">
                        {product.name}
                      </h3>
                      {product.book?.author_name && (
                        <p
                          className="text-sm mb-2"
                          style={{ color: "var(--color-muted-foreground)" }}
                        >
                          מאת {product.book.author_name}
                        </p>
                      )}
                      {typeof product.rating === "number" &&
                        (product.reviews_count ?? 0) > 0 && (
                          <div className="flex items-center gap-2 mb-3">
                            <StarRating rating={product.rating} />
                            <span
                              className="text-xs"
                              style={{ color: "var(--color-muted-foreground)" }}
                            >
                              ({product.reviews_count?.toLocaleString()}{" "}
                              ביקורות)
                            </span>
                          </div>
                        )}
                      <p
                        className="text-sm leading-relaxed line-clamp-2"
                        style={{ color: "var(--color-muted-foreground)" }}
                      >
                        {product.short_description}
                      </p>
                    </div>

                    <div className="flex items-center justify-between mt-4">
                      <span className="flex items-baseline gap-2">
                        <span
                          className="font-display text-xl font-bold"
                          style={{ color: "var(--color-foreground)" }}
                        >
                          {formatPrice(effectivePrice(product))}
                        </span>
                        {onSale && (
                          <span
                            className="text-sm line-through"
                            style={{ color: "var(--color-muted-foreground)" }}
                          >
                            {formatPrice(product.price)}
                          </span>
                        )}
                      </span>
                      {owned ? (
                        <button
                          onClick={() =>
                            navigate(`/read/${product.product_id}`)
                          }
                          className="px-5 py-2 rounded-full text-sm font-bold border-2"
                          style={{
                            borderColor: "var(--color-success)",
                            color: "var(--color-success)",
                          }}
                        >
                          קראו עכשיו
                        </button>
                      ) : (
                        <button
                          onClick={() => handleBuy(product)}
                          className="btn-gradient px-5 py-2 rounded-full text-sm font-bold"
                        >
                          קבלו גישה
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* ── FREE-FORM CMS BLOCKS ─────────────────────────────────────── */}
      {freeform.map(renderBlock)}

      {/* ── BUNDLE + SUBSCRIPTION ─────────────────────────────── */}
      {bundle && subscription && (
        <section
          id="pricing"
          className="border-y py-24"
          style={{
            borderColor: "var(--color-border)",
            background: "var(--color-card)",
          }}
        >
          <div className="max-w-6xl mx-auto px-6">
            <SectionTitle
              title={settings.pricing_title}
              blurb={settings.pricing_blurb}
              hint="תוכן חסר: כותרת בלוק החבילות — הוסיפו אותה ב״הגדרות מערכת ← תוכן האתר״."
            />

            <div className="grid md:grid-cols-2 gap-6">
              {/* Bundle */}
              <div
                className="p-8 rounded-2xl border relative overflow-hidden"
                style={{
                  background:
                    "linear-gradient(160deg, var(--color-secondary), var(--color-card))",
                  borderColor: "rgba(212,160,48,0.4)",
                  boxShadow: "0 12px 48px rgba(212,160,48,0.12)",
                }}
              >
                {/* The ribbon reads the bundle's own subtitle, an existing
                  editable field on the product form. Left blank, no ribbon
                  shows: the platform will not claim this is the best value on
                  offer unless somebody with the authority to say so did. */}
                {bundle.subtitle?.trim() && (
                  <div
                    className="absolute top-5 left-5 flex items-center gap-1.5 text-xs font-bold px-3 py-1 rounded-full shadow-lg"
                    style={{
                      background: "linear-gradient(135deg, #E7B94C, #B8862A)",
                      color: "var(--color-primary-foreground)",
                    }}
                  >
                    <Icon name="flame" size={13} /> {bundle.subtitle.trim()}
                  </div>
                )}

                <div className="flex gap-3 mb-6 mt-4">
                  {ebookProducts.slice(0, 3).map((p) => (
                    <BookCover key={p.product_id} product={p} size="sm" />
                  ))}
                </div>

                <h3 className="font-display text-2xl font-bold mb-2">
                  {bundle.name}
                </h3>
                <p
                  className="text-sm mb-6"
                  style={{ color: "var(--color-muted-foreground)" }}
                >
                  {bundle.short_description}
                </p>

                <div className="flex items-baseline gap-3 mb-6">
                  <span
                    className="font-display text-3xl font-bold"
                    style={{ color: "var(--color-primary)" }}
                  >
                    {formatPrice(effectivePrice(bundle))}
                  </span>
                  {isOnSale(bundle) && (
                    <span
                      className="text-lg line-through"
                      style={{ color: "var(--color-muted-foreground)" }}
                    >
                      {formatPrice(bundle.price)}
                    </span>
                  )}
                </div>

                <button
                  onClick={() => handleBuy(bundle)}
                  className="btn-gradient w-full py-3.5 rounded-full font-bold"
                >
                  קבלו את החבילה
                </button>
              </div>

              {/* Subscription */}
              <div className="card-glow p-8 rounded-2xl">
                <div
                  className="w-12 h-12 rounded-xl mb-6 flex items-center justify-center shadow-inner"
                  style={{
                    background: "rgba(212,160,48,0.1)",
                    color: "var(--color-primary)",
                  }}
                >
                  <Icon name="infinity" size={22} />
                </div>

                <h3 className="font-display text-2xl font-bold mb-2">
                  {subscription.name}
                </h3>
                <p
                  className="text-sm mb-6"
                  style={{ color: "var(--color-muted-foreground)" }}
                >
                  {subscription.short_description}
                </p>

                <div className="flex items-baseline gap-2 mb-6">
                  <span className="font-display text-3xl font-bold">
                    {formatPrice(effectivePrice(subscription))}
                  </span>
                  <span style={{ color: "var(--color-muted-foreground)" }}>
                    / לחודש
                  </span>
                </div>

                {subscriptionBullets.length > 0 && (
                  <ul
                    className="space-y-2 mb-6 text-sm"
                    style={{ color: "var(--color-muted-foreground)" }}
                  >
                    {subscriptionBullets.map((item) => (
                      <li key={item} className="flex items-center gap-2">
                        <Icon
                          name="checkCircle"
                          size={15}
                          style={{ color: "var(--color-success)" }}
                        />{" "}
                        {item}
                      </li>
                    ))}
                  </ul>
                )}

                <button
                  onClick={() => handleBuy(subscription)}
                  className="w-full py-3.5 rounded-full font-bold border-2 transition-all hover:bg-white/5 hover:border-white/30"
                  style={{
                    borderColor: "var(--color-border)",
                    color: "var(--color-foreground)",
                  }}
                >
                  התחילו מנוי
                </button>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* ── TESTIMONIALS (CMS) ────────────────────────────────── */}
      {/* Gated on isAdmin, not left to CmsHint alone. CmsHint returns null
          for a visitor, but this wrapper carries py-12 of its own — without
          the guard every visitor gets a 96px band of empty space where an
          explanation only an administrator can read used to be. */}
      {isAdmin && testimonialsSection && testimonials.length === 0 && (
        <div className="max-w-6xl mx-auto px-6 py-12">
          <CmsHint what="בלוק ההמלצות פעיל אך ריק — הוסיפו המלצות ב־CMS, או כבו את הבלוק כדי שלא יתפוס מקום." />
        </div>
      )}
      {testimonialsSection && testimonials.length > 0 && (
        <section className="max-w-6xl mx-auto px-6 py-24">
          <SectionTitle
            title={testimonialsSection.title}
            blurb={testimonialsSection.content}
            hint="תוכן חסר: כותרת בלוק ההמלצות — כתבו אותה ב־CMS."
          />

          <div className="grid md:grid-cols-3 gap-6">
            {testimonials.map((t) => (
              <div key={t.testimonial_id} className="card-glow p-6 rounded-2xl">
                <div className="flex gap-0.5 mb-4">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <Icon
                      key={i}
                      name="star"
                      size={14}
                      style={{
                        color: "var(--color-primary)",
                        fill: "currentColor",
                      }}
                    />
                  ))}
                </div>
                <p
                  className="text-sm leading-relaxed mb-5 font-display"
                  style={{ color: "var(--color-foreground)" }}
                >
                  ״{t.quote}״
                </p>
                <div className="flex items-center gap-3">
                  <div
                    className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold shadow-md"
                    style={{
                      background: "rgba(212,160,48,0.15)",
                      color: "var(--color-primary)",
                    }}
                  >
                    {t.avatar}
                  </div>
                  <div>
                    <p className="text-sm font-bold">{t.name}</p>
                    <p
                      className="text-xs"
                      style={{ color: "var(--color-muted-foreground)" }}
                    >
                      {t.title}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── FAQ (CMS) ─────────────────────────────────────────── */}
      {isAdmin && faqSection && faqs.length === 0 && (
        <div className="max-w-3xl mx-auto px-6 py-12">
          <CmsHint what="בלוק השאלות הנפוצות פעיל אך ריק — הוסיפו שאלות ב־CMS, או כבו את הבלוק." />
        </div>
      )}
      {faqSection && faqs.length > 0 && (
        <section
          id="faq"
          className="border-t py-24"
          style={{ borderColor: "var(--color-border)" }}
        >
          <div className="max-w-3xl mx-auto px-6">
            <SectionTitle
              title={faqSection.title}
              blurb={faqSection.content}
              hint="תוכן חסר: כותרת בלוק השאלות הנפוצות — כתבו אותה ב־CMS."
            />

            <div className="space-y-3">
              {faqs.map((item, i) => (
                <div
                  key={item.faq_id}
                  className="border rounded-2xl overflow-hidden transition-all"
                  style={{
                    borderColor:
                      openFaq === i
                        ? "rgba(212,160,48,0.4)"
                        : "var(--color-border)",
                    background:
                      openFaq === i ? "var(--color-card)" : "transparent",
                  }}
                >
                  <button
                    className="w-full flex items-center justify-between px-5 py-4 text-right transition-colors hover:bg-white/3"
                    onClick={() => setOpenFaq(openFaq === i ? null : i)}
                  >
                    <span className="font-bold text-sm">{item.question}</span>
                    <span
                      className="mr-4 text-lg flex-shrink-0 transition-transform"
                      style={{
                        color: "var(--color-primary)",
                        transform:
                          openFaq === i ? "rotate(45deg)" : "rotate(0)",
                      }}
                    >
                      +
                    </span>
                  </button>
                  {openFaq === i && (
                    <div
                      className="px-5 pb-4 text-sm leading-relaxed"
                      style={{ color: "var(--color-muted-foreground)" }}
                    >
                      {item.answer}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ── FINAL CTA ─────────────────────────────────────────── */}
      {/* Rendered only when an editor switched a CTA block on. It used to
          fall back to the brand wordmark as a headline, which is not copy:
          it is a company name doing an impression of a call to action. */}
      {ctaSection ? (
        <section
          className="py-24 text-center relative overflow-hidden"
          style={{
            background:
              "radial-gradient(ellipse 60% 80% at 50% 120%, rgba(212,160,48,0.15), transparent), var(--color-card)",
          }}
        >
          <div className="max-w-2xl mx-auto px-6 relative">
            {ctaSection.title && (
              <h2 className="font-display text-4xl md:text-5xl font-bold mb-4 leading-tight whitespace-pre-line">
                {ctaSection.title}
              </h2>
            )}
            {ctaSection.content && (
              <p
                className="mb-8 whitespace-pre-line"
                style={{ color: "var(--color-muted-foreground)" }}
              >
                {ctaSection.content}
              </p>
            )}
            <div className="flex flex-col items-center gap-5">
              {featuredBook && (
                <button
                  onClick={() => handleBuy(featuredBook)}
                  className="btn-gradient px-12 py-4 rounded-full font-bold text-lg"
                >
                  קבלו גישה עכשיו
                </button>
              )}
              <Link
                to="/support"
                className="text-sm transition-opacity hover:opacity-70"
                style={{ color: "var(--color-primary)" }}
              >
                יש שאלה? דברו איתנו.
              </Link>
            </div>
          </div>
        </section>
      ) : isAdmin ? (
        <div className="max-w-2xl mx-auto px-6 py-12">
          <CmsHint what="לא הוגדר בלוק CTA — הפעילו אותו ב־CMS כדי לסיים את העמוד בקריאה לפעולה." />
        </div>
      ) : null}

      {/* ── FOOTER ────────────────────────────────────────────── */}
      <footer
        className="border-t py-8"
        style={{ borderColor: "var(--color-border)" }}
      >
        {settings.footer_text?.trim() && (
          <p
            className="max-w-6xl mx-auto px-6 pb-5 text-sm text-center whitespace-pre-line"
            style={{ color: "var(--color-muted-foreground)" }}
          >
            {settings.footer_text.trim()}
          </p>
        )}
        <div
          className="max-w-6xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-4 text-sm"
          style={{ color: "var(--color-muted-foreground)" }}
        >
          {/* The wordmark reads brand_name rather than a name typed into the
              layout: renaming the business in settings should rename it here
              too, and the alt text has to follow or it describes the wrong
              logo to a screen reader. */}
          <div className="flex items-center gap-2">
            <img
              src={logoImg}
              alt={settings.brand_name}
              className="w-6 h-6 rounded object-cover"
            />
            <span
              className="font-display font-bold tracking-wide"
              style={{ color: "var(--color-primary)" }}
            >
              {settings.brand_name}
            </span>
          </div>
          <div className="flex gap-6">
            <Link to="/store" className="hover:opacity-80 transition-opacity">
              החנות
            </Link>
            <Link to="/support" className="hover:opacity-80 transition-opacity">
              תמיכה
            </Link>
            <Link to="/login" className="hover:opacity-80 transition-opacity">
              התחברות
            </Link>
          </div>
          <p>
            &copy; {new Date().getFullYear()} {settings.brand_name}. כל הזכויות
            שמורות.
          </p>
        </div>
      </footer>
    </div>
  )
}
