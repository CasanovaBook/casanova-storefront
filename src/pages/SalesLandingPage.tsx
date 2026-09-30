/* ────────────────────────────────────────────────────────────
 * Sales landing page — "היא קודם" · served at /
 *
 * A single-product long-form sales letter. No catalogue, no nav,
 * no distractions. The page reads every slot from the CMS first
 * (active sections with page === 'SALES') and falls back to the
 * bundled launch copy in `src/lib/sales-content.ts` when the CMS
 * has nothing for that slot — so the page renders complete copy
 * for any visitor even on a fresh install, and an administrator
 * can override any slot from /admin/cms/content-editor.
 *
 * The sticky mobile CTA bar and the exit-intent popup are
 * conversion chrome: they live in code because they are UI
 * behaviour, not copy, but their labels come from settings (with
 * bundled defaults) so they too are editable from /admin/settings.
 * ───────────────────────────────────────────────────────────── */

import { useEffect, useState } from "react"

import { Link, useNavigate } from "react-router"

import { useApp } from "../context/AppContext"

import { useCms } from "../context/CmsContext"

import { useContent } from "../content/useContent"

import type { Product } from "../types"

import { effectivePrice, isOnSale } from "../types"

import Icon from "../components/icons"

import ThemeToggle from "../components/ThemeToggle"

import { loadContent } from "../content/store"

import logoImg from "../../images/main_photo.jpg"

import { getDb, mutate } from "../lib/db"

import {
  BUNDLED_PRODUCT,
  SALES_DEFAULTS,
  SALES_FAQ_DEFAULTS,
  SALES_SETTINGS_DEFAULTS,
  SALES_TESTIMONIAL_DEFAULTS,
  type SalesSlot,
} from "../lib/sales-content"

import type { SectionType } from "../types"

const EXIT_SEEN_KEY = "casanova_exit_seen_v1"

/* The sales page can render its offer from BUNDLED_PRODUCT when the
 * catalogue has no `hya-kvdm` row. Checkout, however, resolves the
 * purchase strictly from the localStorage DB — an in-memory object is
 * invisible to it, which is exactly why an unseeded click used to bounce
 * back with "המוצר לא נמצא.". This helper closes the gap the module
 * comment in sales-content.ts promised: on the first CTA click it upserts
 * the bundled product into the DB, then hands the (now real) product to
 * the shared selection so checkout can find it. */

function seedAndSelect(
  product: Product,
  setSelectedProduct: (p: Product | null) => void,
) {
  const exists = getDb().products.some(
    (p) => p.product_id === product.product_id,
  )

  if (!exists) {
    mutate((db) => {
      db.products = [...db.products, product]
    })
  }

  setSelectedProduct(product)
}

/** Maps a sales slot name to the SectionType that backs it in the CMS.
 *  Slots that share a SectionType (e.g. PROOF_STRIP, AGITATION, BRAND
 *  all use TEXT) are distinguished by their position in the sales page
 *  render order, not by a separate CMS type. */

const SLOT_TYPE: Record<SalesSlot, SectionType> = {
  HERO: "HERO",

  PROOF_STRIP: "TEXT",

  AGITATION: "TEXT",

  MECHANISM: "STEPS",

  FEATURES: "FEATURES",

  AUDIENCE: "AUDIENCE",

  BRAND: "TEXT",

  SOCIAL: "TESTIMONIALS",

  OFFER: "OFFER",

  FAQ: "FAQ",

  FINAL_CTA: "CTA",
}

/* ── Slot resolver ─────────────────────────────────────── */

function useSalesSlot(slot: SalesSlot) {
  const { activeSections } = useCms()

  const bundled = SALES_DEFAULTS[slot]

  const sectionType = SLOT_TYPE[slot]

  // CMS wins when an active SALES section of this type exists whose

  // title matches the bundled default's title — that is how we tell

  // apart multiple CMS sections that share a SectionType (e.g. three

  // TEXT blocks for PROOF_STRIP, AGITATION and BRAND). A CMS section

  // with a different title is treated as a different slot entirely.

  const cms = activeSections.find(
    (s) =>
      s.page === "SALES" &&
      s.type === sectionType &&
      s.active &&
      s.title.trim() === bundled.title.trim(),
  )

  return cms ?? bundled ?? null
}

function useSalesFaqs() {
  const { faqs } = useCms()

  const cms = faqs.filter((f) => f.active)

  return cms.length > 0 ? cms : SALES_FAQ_DEFAULTS
}

function useSalesTestimonials() {
  const { testimonials } = useCms()

  const cms = testimonials.filter((t) => t.active)

  return cms.length > 0 ? cms : SALES_TESTIMONIAL_DEFAULTS
}

function useSalesProduct(): Product {
  const { productBySlug } = useCms()

  const real = productBySlug("hya-kvdm")

  if (!real) return BUNDLED_PRODUCT

  return {
    ...BUNDLED_PRODUCT,

    ...real,

    /* The sales landing page owns its own launch pricing and visuals —
     * the catalogue row supplies identity (name, slug, content_url) but
     * the price, sale_price and cover come from the bundled launch copy
     * so that the strikethrough (₪99 → ₪89) always renders correctly
     * regardless of what an administrator typed into the product form. */

    price: BUNDLED_PRODUCT.price,

    sale_price: BUNDLED_PRODUCT.sale_price,

    image_url: real.image_url || BUNDLED_PRODUCT.image_url,

    cover_colors: real.cover_colors ?? BUNDLED_PRODUCT.cover_colors,

    short_description:
      real.short_description || BUNDLED_PRODUCT.short_description,
  }
}

function useSalesSettings() {
  const { settings } = useCms()
  const c = useContent()

  return {
    sticky_cta:
      c("sales.stickyCta") || settings.sales_sticky_cta || SALES_SETTINGS_DEFAULTS.sales_sticky_cta,

    exit_title:
      settings.sales_exit_title || SALES_SETTINGS_DEFAULTS.sales_exit_title,

    exit_body:
      settings.sales_exit_body || SALES_SETTINGS_DEFAULTS.sales_exit_body,

    exit_cta:
      c("sales.offer.cta") || settings.sales_exit_cta || SALES_SETTINGS_DEFAULTS.sales_exit_cta,
  }
}

/* ── Section helpers ──────────────────────────────────── */

function GoldRule() {
  return <span className="gold-rule mb-4" />
}

function SectionHeading({ title, blurb }: { title?: string, blurb?: string }) {
  if (!title?.trim()) return null

  return (
    <div className="mb-10 md:mb-14">
      <GoldRule />
      <h2 className="font-display text-3xl md:text-4xl lg:text-5xl font-bold leading-tight whitespace-pre-line">
        {title}
      </h2>
      {blurb?.trim() && (
        <p
          className="mt-4 text-base md:text-lg leading-relaxed whitespace-pre-line"
          style={{ color: "var(--color-muted-foreground)" }}
        >
          {blurb}
        </p>
      )}
    </div>
  )
}

/* ─ Hero (A) ──────────────────────────────────────────── */

function HeroSection({ product, c }: { product: Product, c: ReturnType<typeof useContent> }) {
  const navigate = useNavigate()

  const { setSelectedProduct } = useApp()

  const section = useSalesSlot("HERO")

  const titleText = c("sales.hero.title") || section?.title || ""
  const lines = titleText
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)

  const lead = lines[0] ?? ""

  const accent = lines.slice(1)

  const trust = c.strings("sales.hero.trust").length > 0
    ? c.strings("sales.hero.trust")
    : ["גישה מיידית", "תשלום מאובטח"]

  const handleBuy = () => {
    seedAndSelect(product, setSelectedProduct)

    navigate("/checkout")
  }

  return (
    <section
      className="hero-shell relative flex items-center overflow-hidden"
      style={{
        background:
          "radial-gradient(ellipse 80% 60% at 50% -10%, rgba(227,174,60,0.14), transparent), linear-gradient(135deg, #0B0D16 0%, #1A0E14 50%, #0B0D16 100%)",
      }}
    >
      <div
        className="absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(212,160,48,0.4) 1px, transparent 1px), linear-gradient(90deg, rgba(212,160,48,0.4) 1px, transparent 1px)",

          backgroundSize: "60px 60px",
        }}
      />
      <div
        className="absolute top-1/4 right-1/4 w-96 h-96 rounded-full blur-3xl pointer-events-none glow-pulse"
        style={{ background: "#4A0E1C", opacity: 0.35 }}
      />
      <div
        className="absolute bottom-0 left-0 w-80 h-80 rounded-full blur-3xl pointer-events-none"
        style={{ background: "var(--color-primary)", opacity: 0.08 }}
      />

      <div className="relative max-w-6xl mx-auto px-6 py-32 grid md:grid-cols-2 gap-16 items-center">
        <div className="page-enter">
          <div
            className="inline-flex items-center gap-2 mb-6 px-4 py-1.5 rounded-full border text-xs font-bold tracking-wide"
            style={{
              borderColor: "rgba(212,160,48,0.3)",

              color: "var(--color-primary)",

              background: "rgba(212,160,48,0.07)",
            }}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
            {c("sales.hero.eyebrow") || "Casanova · מדריך לגבר"}
          </div>

          {lead && (
            <h1 className="font-display text-5xl md:text-6xl lg:text-7xl font-bold leading-[1.1] mb-6 whitespace-pre-line text-white">
              {lead}
              {accent.length > 0 && (
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
                    {accent.join("\n")}
                  </span>
                </>
              )}
            </h1>
          )}

          {(c("sales.hero.lede") || section?.content) && (
            <p
              dir="rtl"
              className="text-lg md:text-xl leading-relaxed mb-8 max-w-lg whitespace-pre-line text-right"
              style={{ color: "var(--color-muted-foreground)" }}
            >
              {c("sales.hero.lede") || section.content}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-4 mb-8">
            <button
              onClick={handleBuy}
              className="btn-gradient px-8 py-4 rounded-full font-bold text-base"
            >
              {c("sales.hero.cta") || "כן. אני רוצה את הספר"}
            </button>
          </div>

          <div
            className="flex flex-wrap items-center gap-6 text-sm"
            style={{ color: "var(--color-muted-foreground)" }}
          >
            {trust.map((item) => (
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
        </div>

        <div className="hidden md:flex justify-center items-center relative">
          <div className="relative">
            <div className="relative z-10 float-slow">
              {/* The cover is the hero's visual anchor, so it grows with the
                  display instead of shrinking relative to a widened shell. */}
              <div className="w-56 h-80 3xl:w-64 3xl:h-[22rem] 4xl:w-72 4xl:h-[26rem] rounded-xl flex-shrink-0 relative overflow-hidden shadow-2xl">
                {product.image_url ? (
                  <img
                    src={product.image_url}
                    alt={product.name}
                    className="absolute inset-0 w-full h-full object-cover"
                  />
                ) : (
                  <div
                    className="absolute inset-0"
                    style={{
                      background: `linear-gradient(160deg, ${product.cover_colors?.[0] ?? "#1A1A2E"}, ${product.cover_colors?.[1] ?? "#2A2A3E"})`,
                    }}
                  />
                )}
              </div>
            </div>
            <div
              className="absolute -bottom-4 -right-4 px-5 py-3.5 rounded-2xl border glass shadow-2xl float-slower"
              style={{ borderColor: "rgba(212,160,48,0.3)" }}
            >
              <p
                className="text-xs mb-1"
                style={{ color: "var(--color-muted-foreground)" }}
              >
                {c("sales.hero.priceLabel") || "מחיר השקה"}
              </p>
              <p
                className="font-display text-2xl font-bold"
                style={{ color: "var(--color-primary)" }}
              >
                ₪{effectivePrice(product)}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div
        className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 opacity-40"
        style={{ color: "var(--color-muted-foreground)" }}
      >
        <div className="w-px h-8" style={{ background: "currentColor" }} />
        <span className="text-xs font-bold">{c("sales.hero.scroll") || "גללו למטה"}</span>
      </div>
    </section>
  )
}

/* ── Proof strip (B) ───────────────────────────────────── */

function ProofStrip({ c }: { c: ReturnType<typeof useContent> }) {
  const section = useSalesSlot("PROOF_STRIP")

  const title = c("sales.proof.title") || section?.title || ""
  const content = c("sales.proof.content") || section?.content || ""
  const regItems = c.list<{ title: string }>("sales.proof.items")
  const items = regItems.length > 0 ? regItems.map((it, i) => ({ item_id: String(i), title: it.title, content: "", group: undefined })) : (section?.items ?? [])

  if (!title && !content && items.length === 0) return null

  return (
    <div
      className="border-y"
      style={{
        borderColor: "var(--color-border)",
        background: "var(--color-card)",
      }}
    >
      <div className="max-w-6xl mx-auto px-6 py-8 text-center">
        {title && (
          <p className="text-lg md:text-xl font-display font-bold mb-2">
            {title}
          </p>
        )}
        {content && (
          <p
            className="text-base mb-6"
            style={{ color: "var(--color-muted-foreground)" }}
          >
            {content}
          </p>
        )}
        {items.length > 0 && (
          <div
            className="flex flex-wrap items-center justify-center gap-8 md:gap-12 text-sm"
            style={{ color: "var(--color-muted-foreground)" }}
          >
            {items.map((it) => (
              <div key={it.item_id} className="flex items-center gap-2">
                <Icon
                  name="checkCircle"
                  size={16}
                  style={{ color: "var(--color-success)" }}
                />
                <span className="font-medium">{it.title}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/* ─ Agitation (C) ─────────────────────────────────────── */

function AgitationSection({ c }: { c: ReturnType<typeof useContent> }) {
  const section = useSalesSlot("AGITATION")
  const title = c("sales.agitation.title") || section?.title || ""
  const content = c("sales.agitation.content") || section?.content || ""

  if (!title && !content) return null

  return (
    <section className="max-w-3xl mx-auto px-6 py-20 md:py-28">
      <SectionHeading title={title} />
      {content && (
        <div
          className="space-y-5 text-base md:text-lg leading-relaxed whitespace-pre-line"
          style={{ color: "var(--color-muted-foreground)" }}
        >
          {content}
        </div>
      )}
    </section>
  )
}

/* ── Mechanism (D) ─────────────────────────────────────── */

function MechanismSection({ c }: { c: ReturnType<typeof useContent> }) {
  const section = useSalesSlot("MECHANISM")
  const title = c("sales.mechanism.title") || section?.title || ""
  const content = c("sales.mechanism.content") || section?.content || ""
  const regSteps = c.list<{ title: string; content: string }>("sales.mechanism.steps")
  const steps = regSteps.length > 0
    ? regSteps.map((s, i) => ({ item_id: String(i), title: s.title, content: s.content, group: undefined }))
    : (section?.items ?? [])

  if (!title && !content && steps.length === 0) return null

  return (
    <section
      className="border-y py-20 md:py-28"
      style={{
        borderColor: "var(--color-border)",
        background: "var(--color-card)",
      }}
    >
      <div className="max-w-4xl mx-auto px-6">
        <SectionHeading title={title} blurb={content} />
        {steps.length > 0 && (
          <ol className="space-y-5">
            {steps.map((step, idx) => (
              <li key={step.item_id} className="flex gap-5 items-start">
                <span
                  className="w-10 h-10 rounded-full flex-shrink-0 flex items-center justify-center font-display font-bold text-lg"
                  style={{
                    background: "rgba(212,160,48,0.12)",
                    color: "var(--color-primary)",
                  }}
                >
                  {idx + 1}
                </span>
                <div>
                  <p className="font-display text-lg font-bold mb-1">
                    {step.title}
                  </p>
                  {step.content && (
                    <p
                      className="text-sm"
                      style={{ color: "var(--color-muted-foreground)" }}
                    >
                      {step.content}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  )
}

/*  Features / benefit cards (E) ──────────────────────── */

function FeaturesSection({ c }: { c: ReturnType<typeof useContent> }) {
  const section = useSalesSlot("FEATURES")
  const title = c("sales.features.title") || section?.title || ""
  const regItems = c.list<{ title: string; content: string }>("sales.features.items")
  const items = regItems.length > 0
    ? regItems.map((it, i) => ({ item_id: String(i), title: it.title, content: it.content, group: undefined }))
    : (section?.items ?? [])

  if (!title && items.length === 0) return null

  return (
    <section className="max-w-6xl mx-auto px-6 py-20 md:py-28">
      <SectionHeading title={title} />
      {items.length > 0 && (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
          {items.map((it) => (
            <div key={it.item_id} className="card-glow p-6 rounded-2xl">
              <h3 className="font-display text-lg font-bold mb-2">
                {it.title}
              </h3>
              {it.content && (
                <p
                  className="text-sm leading-relaxed"
                  style={{ color: "var(--color-muted-foreground)" }}
                >
                  {it.content}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

/* ── Audience (F) ──────────────────────────────────────── */

function AudienceSection({ c }: { c: ReturnType<typeof useContent> }) {
  const section = useSalesSlot("AUDIENCE")
  const title = c("sales.audience.title") || section?.title || ""
  const regYes = c.list<{ title: string }>("sales.audience.yes")
  const regNo = c.list<{ title: string }>("sales.audience.no")
  const items = section?.items ?? []
  const yes = regYes.length > 0
    ? regYes.map((it, i) => ({ item_id: `y${i}`, title: it.title, content: "", group: "PRIMARY" as const }))
    : items.filter((it) => it.group !== "SECONDARY")
  const no = regNo.length > 0
    ? regNo.map((it, i) => ({ item_id: `n${i}`, title: it.title, content: "", group: "SECONDARY" as const }))
    : items.filter((it) => it.group === "SECONDARY")

  if (!title && yes.length === 0 && no.length === 0) return null

  return (
    <section className="max-w-5xl mx-auto px-6 py-20 md:py-28">
      <SectionHeading title={title} />
      <div className="grid md:grid-cols-2 gap-6">
        {yes.length > 0 && (
          <div
            className="p-6 rounded-2xl border"
            style={{
              borderColor: "rgba(34,197,94,0.3)",
              background: "rgba(34,197,94,0.04)",
            }}
          >
            <h3
              className="font-display text-lg font-bold mb-4 flex items-center gap-2"
              style={{ color: "var(--color-success)" }}
            >
              <Icon name="checkCircle" size={18} /> {c("sales.audience.yesTitle") || "למי כן"}
            </h3>
            <ul className="space-y-3">
              {yes.map((it) => (
                <li key={it.item_id} className="flex items-start gap-3 text-sm">
                  <span
                    className="w-1.5 h-1.5 rounded-full mt-2 flex-shrink-0"
                    style={{ background: "var(--color-success)" }}
                  />
                  <span>{it.title}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {no.length > 0 && (
          <div
            className="p-6 rounded-2xl border"
            style={{
              borderColor: "rgba(239,68,68,0.25)",
              background: "rgba(239,68,68,0.04)",
            }}
          >
            <h3
              className="font-display text-lg font-bold mb-4 flex items-center gap-2"
              style={{ color: "var(--color-danger)" }}
            >
              <Icon name="x" size={18} /> {c("sales.audience.noTitle") || "למי לא"}
            </h3>
            <ul className="space-y-3">
              {no.map((it) => (
                <li key={it.item_id} className="flex items-start gap-3 text-sm">
                  <span
                    className="w-1.5 h-1.5 rounded-full mt-2 flex-shrink-0"
                    style={{ background: "var(--color-danger)" }}
                  />
                  <span>{it.title}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  )
}

/* ─ Brand story (G) ───────────────────────────────────── */

function BrandSection({ c }: { c: ReturnType<typeof useContent> }) {
  const section = useSalesSlot("BRAND")
  const title = c("sales.brand.title") || section?.title || ""
  const content = c("sales.brand.content") || section?.content || ""

  if (!title && !content) return null

  return (
    <section
      className="border-y py-20 md:py-28"
      style={{
        borderColor: "var(--color-border)",
        background: "var(--color-card)",
      }}
    >
      <div className="max-w-3xl mx-auto px-6">
        <SectionHeading title={title} />
        {content && (
          <p
            className="text-base md:text-lg leading-relaxed whitespace-pre-line"
            style={{ color: "var(--color-muted-foreground)" }}
          >
            {content}
          </p>
        )}
      </div>
    </section>
  )
}

/* ─ Social proof (H) ──────────────────────────────────── */

function SocialSection({ c }: { c: ReturnType<typeof useContent> }) {
  const section = useSalesSlot("SOCIAL")
  const title = c("sales.social.title") || section?.title || ""
  const content = c("sales.social.content") || section?.content || ""

  // Read testimonials from content store first, fall back to CMS/bundled
  const regTestimonials = c.list<{ quote: string; name: string; title: string }>("sales.social.testimonials")
  const cmsTestimonials = useSalesTestimonials()
  const testimonials = regTestimonials.length > 0
    ? regTestimonials.map((t, i) => ({ testimonial_id: String(i), quote: t.quote, name: t.name, title: t.title, avatar: t.name.charAt(0), active: true, display_order: i }))
    : cmsTestimonials

  if (!title && testimonials.length === 0) return null

  return (
    <section className="max-w-6xl mx-auto px-6 py-20 md:py-28">
      <SectionHeading title={title} blurb={content} />
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
            <p className="text-sm leading-relaxed mb-5 font-display">
              {t.quote}
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
  )
}

/* ─ Offer / price block (I) ───────────────────────────── */

function OfferSection({ product, c }: { product: Product, c: ReturnType<typeof useContent> }) {
  const navigate = useNavigate()

  const { setSelectedProduct } = useApp()

  const section = useSalesSlot("OFFER")
  const offerTitle = c("sales.offer.title") || section?.title || ""
  const offerContent = c("sales.offer.content") || section?.content || ""
  const regBonuses = c.list<{ title: string; content: string }>("sales.offer.bonuses")
  const bonuses = regBonuses.length > 0
    ? regBonuses.map((b, i) => ({ item_id: String(i), title: b.title, content: b.content, group: undefined }))
    : (section?.items ?? [])

  const wasPrice = product.price

  const nowPrice = effectivePrice(product)

  const onSale = isOnSale(product)

  const handleBuy = () => {
    seedAndSelect(product, setSelectedProduct)

    navigate("/checkout")
  }

  return (
    <section
      className="py-20 md:py-28 relative overflow-hidden"
      style={{
        background:
          "radial-gradient(ellipse 60% 80% at 50% 120%, rgba(212,160,48,0.15), transparent), var(--color-card)",
      }}
    >
      <div className="max-w-3xl mx-auto px-6 text-center relative">
        <SectionHeading title={offerTitle} blurb={offerContent} />
        <div className="mb-8">
          {onSale && (
            <p
              className="text-lg line-through mb-2"
              style={{ color: "var(--color-muted-foreground)" }}
            >
              {wasPrice.toLocaleString()}
            </p>
          )}
          <p
            className="font-display text-6xl md:text-7xl font-bold"
            style={{ color: "var(--color-primary)" }}
          >
            ₪{nowPrice.toLocaleString()}
          </p>
          {onSale && (
            <p
              className="text-sm mt-2 font-bold"
              style={{ color: "var(--color-success)" }}
            >
              {c("sales.offer.priceLabel") || "מחיר השקה"}
            </p>
          )}
        </div>
        <button
          onClick={handleBuy}
          className="btn-gradient px-12 py-4 rounded-full font-bold text-lg mb-8"
        >
          {c("sales.offer.cta") || "לקחת את הספר עכשיו"} — ₪{nowPrice}
        </button>
        <p
          className="text-sm mb-10"
          style={{ color: "var(--color-muted-foreground)" }}
        >
          {c("sales.offer.subtext") || "תשלום מאובטח · הורדה מיידית · אפשר לקרוא הערב"}
        </p>
        {bonuses.length > 0 && (
          <div
            className="max-w-lg mx-auto text-right p-6 rounded-2xl border"
            style={{
              borderColor: "rgba(212,160,48,0.3)",
              background: "rgba(212,160,48,0.04)",
            }}
          >
            <p
              className="text-xs font-bold mb-3 tracking-wide"
              style={{ color: "var(--color-primary)" }}
            >
              {c("sales.offer.bonusesLabel") || "בונוסים כלולים"}
            </p>
            <ul className="space-y-2">
              {bonuses.map((b) => (
                <li key={b.item_id} className="flex items-start gap-3 text-sm">
                  <Icon
                    name="gift"
                    size={16}
                    style={{ color: "var(--color-primary)", flexShrink: 0 }}
                  />
                  <div>
                    <p className="font-medium">{b.title}</p>
                    {b.content && (
                      <p
                        className="text-xs mt-0.5"
                        style={{ color: "var(--color-muted-foreground)" }}
                      >
                        {b.content}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  )
}

/* ── Guarantee (J) ─────────────────────────────────────── */

/* ── FAQ (K) ───────────────────────────────────────────── */

function FaqSection({ c }: { c: ReturnType<typeof useContent> }) {
  const section = useSalesSlot("FAQ")
  const title = c("sales.faq.title") || section?.title || ""

  // Read FAQs from content store first, fall back to CMS/bundled
  const regFaqs = c.list<{ question: string; answer: string }>("sales.faq.items")
  const cmsFaqs = useSalesFaqs()
  const faqs = regFaqs.length > 0
    ? regFaqs.map((f, i) => ({ faq_id: String(i), question: f.question, answer: f.answer, active: true, display_order: i }))
    : cmsFaqs

  const [open, setOpen] = useState<number | null>(null)

  if (!title && faqs.length === 0) return null

  return (
    <section
      className="border-t py-20 md:py-28"
      style={{ borderColor: "var(--color-border)" }}
    >
      <div className="max-w-3xl mx-auto px-6">
        <SectionHeading title={title} />
        <div className="space-y-3">
          {faqs.map((item, i) => (
            <div
              key={item.faq_id}
              className="border rounded-2xl overflow-hidden transition-all"
              style={{
                borderColor:
                  open === i ? "rgba(212,160,48,0.4)" : "var(--color-border)",

                background: open === i ? "var(--color-card)" : "transparent",
              }}
            >
              <button
                className="w-full flex items-center justify-between px-5 py-4 text-right transition-colors hover:bg-white/3"
                onClick={() => setOpen(open === i ? null : i)}
              >
                <span className="font-bold text-sm">{item.question}</span>
                <span
                  className="mr-4 text-lg flex-shrink-0 transition-transform"
                  style={{
                    color: "var(--color-primary)",
                    transform: open === i ? "rotate(45deg)" : "rotate(0)",
                  }}
                >
                  +
                </span>
              </button>
              {open === i && (
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
  )
}

/* ── Final CTA (L) ─────────────────────────────────────── */

function FinalCtaSection({ product, c }: { product: Product, c: ReturnType<typeof useContent> }) {
  const navigate = useNavigate()

  const { setSelectedProduct } = useApp()

  const section = useSalesSlot("FINAL_CTA")
  const title = c("sales.final.title") || section?.title || ""
  const content = c("sales.final.content") || section?.content || ""

  const handleBuy = () => {
    seedAndSelect(product, setSelectedProduct)

    navigate("/checkout")
  }

  return (
    <section
      className="py-24 md:py-32 text-center relative overflow-hidden"
      style={{
        background:
          "radial-gradient(ellipse 60% 80% at 50% 120%, rgba(212,160,48,0.18), transparent), linear-gradient(180deg, var(--color-background) 0%, #1A0E14 100%)",
      }}
    >
      <div className="max-w-3xl mx-auto px-6 relative">
        {title && (
          <h2 className="font-display text-4xl md:text-5xl lg:text-6xl font-bold mb-6 leading-tight whitespace-pre-line">
            {title}
          </h2>
        )}
        <button
          onClick={handleBuy}
          className="btn-gradient px-12 py-4 rounded-full font-bold text-lg mb-6"
        >
          {c("sales.final.cta") || "כן. אני רוצה את הספר"}
        </button>
        {content && (
          <p
            className="text-sm"
            style={{ color: "var(--color-muted-foreground)" }}
          >
            {content}
          </p>
        )}
      </div>
    </section>
  )
}

/* ── Sticky mobile CTA bar ────────────────────────────── */

function StickyCta({ product, c }: { product: Product, c: ReturnType<typeof useContent> }) {
  const navigate = useNavigate()

  const { setSelectedProduct } = useApp()

  const settings = useSalesSettings()

  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > 600)

    window.addEventListener("scroll", onScroll, { passive: true })

    return () => window.removeEventListener("scroll", onScroll)
  }, [])

  const handleBuy = () => {
    seedAndSelect(product, setSelectedProduct)

    navigate("/checkout")
  }

  if (!visible) return null

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-40 md:hidden safe-bottom"
      style={{
        background: "rgba(11,13,22,0.95)",
        backdropFilter: "blur(12px)",
        borderTop: "1px solid rgba(212,160,48,0.3)",
      }}
    >
      <div className="px-4 py-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-bold truncate">{product.name}</p>
          <p
            className="font-display text-lg font-bold"
            style={{ color: "var(--color-primary)" }}
          >
            ₪{effectivePrice(product)}
          </p>
        </div>
        <button
          onClick={handleBuy}
          className="btn-gradient px-6 py-3 rounded-full font-bold text-sm flex-shrink-0"
        >
          {c("sales.stickyCta") || settings.sticky_cta}
        </button>
      </div>
    </div>
  )
}

/* ── Exit-intent popup (once per session) ──────────────── */

function ExitPopup({ product, c }: { product: Product, c: ReturnType<typeof useContent> }) {
  const navigate = useNavigate()

  const { setSelectedProduct } = useApp()

  const settings = useSalesSettings()

  const [show, setShow] = useState(false)

  useEffect(() => {
    if (sessionStorage.getItem(EXIT_SEEN_KEY)) return

    let armed = false

    const onEnter = () => {
      if (armed) {
        setShow(true)

        sessionStorage.setItem(EXIT_SEEN_KEY, "1")
      }
    }

    const onMove = (e: MouseEvent) => {
      if (e.clientY <= 10) armed = true
    }

    document.addEventListener("mouseenter", onEnter)

    document.addEventListener("mousemove", onMove)

    return () => {
      document.removeEventListener("mouseenter", onEnter)

      document.removeEventListener("mousemove", onMove)
    }
  }, [])

  if (!show) return null

  const handleBuy = () => {
    seedAndSelect(product, setSelectedProduct)

    navigate("/checkout")
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.7)" }}
      onClick={() => setShow(false)}
    >
      <div
        className="card-glow w-full max-w-md p-8 text-center"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="font-display text-3xl font-bold mb-3">
          {c("sales.exit.title") || settings.exit_title}
        </h3>
        <p
          className="text-base mb-6"
          style={{ color: "var(--color-muted-foreground)" }}
        >
          {c("sales.exit.body") || settings.exit_body}
        </p>
        <button
          onClick={handleBuy}
          className="btn-gradient w-full py-3.5 rounded-full font-bold mb-3"
        >
          {c("sales.exit.cta") || settings.exit_cta} — ₪{effectivePrice(product)}
        </button>
        <button
          onClick={() => setShow(false)}
          className="text-sm transition-opacity hover:opacity-70"
          style={{ color: "var(--color-muted-foreground)" }}
        >
          {c("sales.exit.dismiss") || "לא, תודה"}
        </button>
      </div>
    </div>
  )
}

/* ── Page ──────────────────────────────────────────────── */

export default function SalesLandingPage() {
  const product = useSalesProduct()
  const c = useContent()

  // The sales page is a standalone route (NOT nested under PublicRoot),
  // so it must load content from the database on its own.
  // Without this, only the localStorage cache and registry defaults are used,
  // and edits made in Maestro CMS never appear on the live page.
  useEffect(() => {
    loadContent().catch(() => {})
  }, [])

  const brand = c("global.brand") || "Casanova"
  const logoSrc = c("global.logo") || logoImg

  return (
    <div
      className="min-h-screen"
      style={{
        background: "var(--color-background)",
        color: "var(--color-foreground)",
      }}
    >
      <header
        className="fixed left-0 right-0 z-30 glass border-b top-0"
        style={{ borderColor: "rgba(30,30,46,0.8)" }}
      >
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <img
              src={logoSrc}
              alt={brand}
              className="w-7 h-7 rounded-lg object-cover shadow-lg flex-shrink-0"
            />
            <span
              dir="ltr"
              className="font-display text-lg font-bold tracking-wide"
              style={{ color: "var(--color-primary)" }}
            >
              {brand}
            </span>
            <span
              className="text-xs"
              style={{ color: "var(--color-foreground)" }}
            >
              {c("sales.header.tagline") || "· היא קודם"}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Link
              to="/login"
              className="btn-gradient tap-target inline-flex items-center justify-center text-sm font-bold px-5 py-2 rounded-full"
            >
              {c("sales.header.login") || "לאזור האישי"}
            </Link>
          </div>
        </div>
      </header>

      <main className="pt-14">
        <HeroSection product={product} c={c} />
        <ProofStrip c={c} />
        <AgitationSection c={c} />
        <MechanismSection c={c} />
        <FeaturesSection c={c} />
        <AudienceSection c={c} />
        <BrandSection c={c} />
        <SocialSection c={c} />
        <OfferSection product={product} c={c} />
        <FaqSection c={c} />
        <FinalCtaSection product={product} c={c} />
      </main>

      <footer
        className="border-t py-8"
        style={{ borderColor: "var(--color-border)" }}
      >
        <div
          className="max-w-6xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-4 text-sm"
          style={{ color: "var(--color-muted-foreground)" }}
        >
          <span
            className="flex items-center gap-2 font-display font-bold tracking-wide"
            style={{ color: "var(--color-primary)" }}
          >
            <img
              src={logoSrc}
              alt={brand}
              className="w-6 h-6 rounded-lg object-cover flex-shrink-0"
            />
            {brand}
          </span>
          <p>{c("sales.footer.copyright") || `© ${new Date().getFullYear()} Casanova. כל הזכויות שמורות.`}</p>
          <a
            href="https://www.phantomthirdlabs.com/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs tracking-widest uppercase transition-opacity hover:opacity-70"
            style={{ color: "var(--color-muted-foreground)" }}
          >
            {c("sales.footer.powered") || "Powered by Phantom Third Labs"}
          </a>
        </div>
      </footer>

      <StickyCta product={product} c={c} />
      <ExitPopup product={product} c={c} />
    </div>
  )
}
