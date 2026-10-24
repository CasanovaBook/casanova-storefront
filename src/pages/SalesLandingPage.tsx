import { useEffect, useMemo, useRef, useState, type RefObject } from "react"

import { Link, useNavigate } from "react-router"

import { useApp } from "../context/AppContext"

import { useCms } from "../context/CmsContext"

import { fmt, useContent } from "../content/useContent"

import { Rich, SmartLink } from "../content/render"

import type { Product } from "../types"

import { effectivePrice, isOnSale } from "../types"

import Icon from "../components/icons"

import ThemeToggle from "../components/ThemeToggle"
import AccessibilityFooterLink from "../components/accessibility/AccessibilityFooterLink"

import { loadContent } from "../content/store"

import { getDb, mutate } from "../data/db"

import { isSupabaseConfigured } from "../integrations/supabase/supabase"

import portraitImg from "../assets/casanova-portrait.webp"

import {
  BUNDLED_PRODUCT,
  SALES_SETTINGS_DEFAULTS,
} from "../lib/sales-content"

const EXIT_SEEN_KEY = "casanova_exit_seen_v2"

const NAV_LINKS = [
  { label: "על הספר", href: "#about" },
  { label: "מה בפנים", href: "#inside" },
  { label: "רכישה", href: "#purchase" },
  { label: "שאלות נפוצות", href: "#faq" },
]

const CURRENCY_SYMBOLS: Record<string, string> = {
  ILS: "₪",
  USD: "$",
  EUR: "€",
  GBP: "£",
}

const SCHEMA_ID = "casanova-landing-schema"

function currencySymbol(currency: string): string {
  return CURRENCY_SYMBOLS[currency] ?? currency
}

function formatNumber(value: number): string {
  return value.toLocaleString("he-IL", { maximumFractionDigits: 2 })
}

interface LandingAccount {
  ready: boolean
  signedIn: boolean
  href: string
  label: string
  memberLabel: string
  guestLabel: string
  displayName: string
  initial: string
  email: string
}

function AccountIndicator({ account }: { account: LandingAccount }) {
  if (!account.ready) {
    return (
      <span
        className="cv-auth-indicator cv-auth-indicator--pending"
        aria-hidden="true"
      >
        <span className="cv-auth-icon">
          <Icon name="user" size={16} />
        </span>
      </span>
    )
  }

  if (!account.signedIn) {
    return (
      <Link
        to={account.href}
        className="cv-auth-indicator cv-auth-indicator--guest"
        aria-label={account.guestLabel}
      >
        <span className="cv-auth-icon" aria-hidden="true">
          <Icon name="user" size={16} />
        </span>
        <span className="cv-auth-indicator-label">{account.guestLabel}</span>
      </Link>
    )
  }

  return (
    <Link
      to={account.href}
      className="cv-auth-indicator cv-auth-indicator--member"
      aria-label={`${account.memberLabel} — ${account.displayName} (מחובר)`}
      title={
        account.email
          ? `${account.displayName} · ${account.email}`
          : account.displayName
      }
    >
      <span className="cv-auth-avatar" aria-hidden="true">
        {account.initial}
        <span className="cv-auth-status" />
      </span>
      <span className="cv-auth-indicator-label">{account.memberLabel}</span>
    </Link>
  )
}

function Price({
  value,
  currency,
  className,
}: {
  value: number
  currency: string
  className?: string
}) {
  return (
    <span dir="ltr" className={className}>
      {currencySymbol(currency)}
      {formatNumber(value)}
    </span>
  )
}

function useSalesProduct(): Product {
  const { productBySlug } = useCms()

  const real = productBySlug("hya-kvdm")

  return useMemo(() => {
    if (!real) return BUNDLED_PRODUCT

    return {
      ...real,
      image_url: real.image_url || BUNDLED_PRODUCT.image_url,
      cover_colors: real.cover_colors ?? BUNDLED_PRODUCT.cover_colors,
      short_description:
        real.short_description || BUNDLED_PRODUCT.short_description,
    }
  }, [real])
}

/* The checkout resolves products by id against the hosted catalogue. On an
 * install without Supabase the local document is the catalogue, so the
 * bundled row has to exist there before the first purchase click. With
 * Supabase configured the bundled row is display copy only. */
function selectProduct(
  product: Product,
  setSelectedProduct: (product: Product | null) => void,
) {
  if (!isSupabaseConfigured) {
    const exists = getDb().products.some(
      (p) => p.product_id === product.product_id,
    )

    if (!exists) {
      mutate((db) => {
        db.products = [...db.products, product]
      })
    }
  }

  setSelectedProduct(product)
}

function setMetaContent(selector: string, content: string): () => void {
  const element = document.head.querySelector<HTMLMetaElement>(selector)

  if (!element) return () => {}

  const previous = element.getAttribute("content")

  element.setAttribute("content", content)

  return () => {
    if (previous === null) element.removeAttribute("content")
    else element.setAttribute("content", previous)
  }
}

function useLandingMeta({
  title,
  description,
  image,
  productName,
  price,
  currency,
  availability,
}: {
  title: string
  description: string
  image: string
  productName: string
  price: number
  currency: string
  availability: Product["availability"]
}) {
  useEffect(() => {
    const previousTitle = document.title

    const absoluteImage = image
      ? new URL(image, window.location.origin).href
      : ""

    const restores = [
      setMetaContent('meta[name="description"]', description),
      setMetaContent('meta[property="og:url"]', `${window.location.origin}/`),
      setMetaContent('meta[property="og:title"]', title),
      setMetaContent('meta[property="og:description"]', description),
      setMetaContent('meta[property="og:image"]', absoluteImage),
      setMetaContent('meta[name="twitter:title"]', title),
      setMetaContent('meta[name="twitter:description"]', description),
      setMetaContent('meta[name="twitter:image"]', absoluteImage),
    ]

    document.title = title

    const schema = document.createElement("script")

    schema.id = SCHEMA_ID
    schema.type = "application/ld+json"
    schema.textContent = JSON.stringify({
      "@context": "https://schema.org",
      "@type": "Book",
      name: productName,
      inLanguage: "he",
      bookFormat: "https://schema.org/EBook",
      description,
      image: absoluteImage || undefined,
      url: `${window.location.origin}/`,
      offers: {
        "@type": "Offer",
        price,
        priceCurrency: currency,
        availability:
          availability === "OUT_OF_STOCK"
            ? "https://schema.org/OutOfStock"
            : availability === "PREORDER"
              ? "https://schema.org/PreOrder"
              : "https://schema.org/InStock",
        seller: {
          "@type": "Organization",
          name: "CASANOVA",
        },
      },
    })

    document.head.appendChild(schema)

    return () => {
      document.title = previousTitle
      restores.forEach((restore) => restore())
      schema.remove()
    }
  }, [
    title,
    description,
    image,
    productName,
    price,
    currency,
    availability,
  ])
}

function useDialogFocus<T extends HTMLElement>(
  open: boolean,
  ref: RefObject<T | null>,
  onClose: () => void,
) {
  const closeRef = useRef(onClose)

  closeRef.current = onClose

  useEffect(() => {
    if (!open) return

    const node = ref.current

    if (!node) return

    const previousFocus = document.activeElement as HTMLElement | null
    const previousOverflow = document.body.style.overflow

    document.body.style.overflow = "hidden"

    const focusable = () =>
      Array.from(
        node.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => element.getAttribute("aria-hidden") !== "true")

    focusable()[0]?.focus()

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault()
        closeRef.current()
        return
      }

      if (event.key !== "Tab") return

      const items = focusable()

      if (items.length === 0) return

      const first = items[0]
      const last = items[items.length - 1]

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener("keydown", onKeyDown)

    return () => {
      document.removeEventListener("keydown", onKeyDown)
      document.body.style.overflow = previousOverflow

      if (previousFocus?.isConnected) {
        try {
          previousFocus.focus()
        } catch {
          /* the opener may have unmounted after navigation */
        }
      }
    }
  }, [open, ref])
}

function useExitIntent(onExit: () => void) {
  const handler = useRef(onExit)

  handler.current = onExit

  useEffect(() => {
    try {
      if (sessionStorage.getItem(EXIT_SEEN_KEY)) return
    } catch {
      return
    }

    let armed = false

    const onEnter = () => {
      if (!armed) return

      try {
        sessionStorage.setItem(EXIT_SEEN_KEY, "1")
      } catch {
        /* storage can be blocked; the dialog still opens once per mount */
      }

      handler.current()
    }

    const onMove = (event: MouseEvent) => {
      if (event.clientY <= 8) armed = true
    }

    document.addEventListener("mouseenter", onEnter)
    document.addEventListener("mousemove", onMove, { passive: true })

    return () => {
      document.removeEventListener("mouseenter", onEnter)
      document.removeEventListener("mousemove", onMove)
    }
  }, [])
}

function scrollToSection(id: string) {
  const target = document.getElementById(id)

  if (!target) return

  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches

  target.scrollIntoView({
    behavior: reduce ? "auto" : "smooth",
    block: "start",
  })
}

function CoverArt({ product }: { product: Product }) {
  const bundledCover = product.image_url === "/covers/hi-kodem-cover.png"

  if (!product.image_url) {
    return (
      <div className="cv-book-fallback" aria-label={`עטיפת הספר ${product.name}`}>
        <span dir="ltr">CASANOVA</span>
        <span>{product.name}</span>
      </div>
    )
  }

  return (
    <picture>
      {bundledCover && (
        <source
          type="image/webp"
          srcSet="/covers/hi-kodem-cover-640.webp 640w, /covers/hi-kodem-cover-1024.webp 1024w"
          sizes="(max-width: 900px) 68vw, 370px"
        />
      )}
      <img
        src={product.image_url}
        alt={`עטיפת הספר ״${product.name}״`}
        width={1024}
        height={1536}
        loading="eager"
        fetchPriority="high"
        decoding="async"
      />
    </picture>
  )
}

function MobileMenu({
  open,
  onClose,
  onBuy,
  buyLabel,
  account,
  price,
  currency,
  productName,
}: {
  open: boolean
  onClose: () => void
  onBuy: () => void
  buyLabel: string
  account: LandingAccount
  price: number
  currency: string
  productName: string
}) {
  const panelRef = useRef<HTMLDivElement | null>(null)

  useDialogFocus(open, panelRef, onClose)

  if (!open) return null

  const navigateTo = (event: React.MouseEvent<HTMLAnchorElement>, href: string) => {
    event.preventDefault()
    onClose()

    window.setTimeout(() => {
      if (window.location.hash !== href) {
        window.history.replaceState(null, "", href)
      }

      scrollToSection(href.replace("#", ""))
    }, 80)
  }

  return (
    <div
      ref={panelRef}
      id="cv-mobile-menu"
      className="cv-mobile-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="cv-mobile-menu-title"
    >
      <h2 id="cv-mobile-menu-title" className="sr-only">
        ניווט
      </h2>

      <div className="cv-mobile-head">
        <span className="cv-brand-word" dir="ltr" lang="en">
          CASANOVA
        </span>
        <button
          type="button"
          className="cv-mobile-close"
          onClick={onClose}
          aria-label="סגירת התפריט"
        >
          <Icon name="x" size={18} />
        </button>
      </div>

      <nav className="cv-mobile-links" aria-label="ניווט ראשי">
        {NAV_LINKS.map((link, index) => (
          <a
            key={link.href}
            href={link.href}
            className="cv-mobile-link"
            onClick={(event) => navigateTo(event, link.href)}
          >
            {link.label}
            <span aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
          </a>
        ))}
      </nav>

      <div className="cv-mobile-actions">
        <div className="cv-mobile-account">
          {!account.ready ? null : account.signedIn ? (
            <Link
              to={account.href}
              className="cv-mobile-account-card"
              onClick={onClose}
            >
              <span className="cv-auth-avatar" aria-hidden="true">
                {account.initial}
                <span className="cv-auth-status" />
              </span>
              <span className="cv-mobile-account-copy">
                <span className="cv-mobile-account-name">
                  {account.displayName}
                </span>
                {account.email && (
                  <span className="cv-mobile-account-email" dir="ltr">
                    {account.email}
                  </span>
                )}
                <span className="cv-mobile-account-state">
                  <span className="cv-auth-dot" aria-hidden="true" />
                  מחובר
                </span>
              </span>
              <Icon name="arrowLeft" size={16} />
            </Link>
          ) : (
            <Link
              to={account.href}
              className="cv-mobile-account-card cv-mobile-account-card--guest"
              onClick={onClose}
            >
              <span className="cv-auth-icon" aria-hidden="true">
                <Icon name="user" size={18} />
              </span>
              <span>{account.guestLabel}</span>
              <Icon name="arrowLeft" size={16} />
            </Link>
          )}
        </div>

        <button type="button" className="cv-btn cv-btn--camel" onClick={onBuy}>
          {buyLabel}
          <span className="cv-btn-price" dir="ltr">
            {currencySymbol(currency)}
            {formatNumber(price)}
          </span>
          <Icon name="arrowLeft" size={16} />
        </button>
      </div>

      <p className="cv-mobile-note">
        {productName} · ספר דיגיטלי למבוגרים · 18+
      </p>
    </div>
  )
}

function StickyCta({
  product,
  label,
  onBuy,
}: {
  product: Product
  label: string
  onBuy: () => void
}) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > 560)

    onScroll()
    window.addEventListener("scroll", onScroll, { passive: true })

    return () => window.removeEventListener("scroll", onScroll)
  }, [])

  if (!visible) return null

  const price = effectivePrice(product)

  return (
    <div className="cv-sticky">
      <div className="cv-sticky-inner">
        <div className="cv-sticky-meta">
          <p className="cv-sticky-name">{product.name} · ספר דיגיטלי</p>
          <p className="cv-sticky-price">
            <Price value={price} currency={product.currency} />
          </p>
        </div>
        <button type="button" className="cv-btn cv-btn--camel" onClick={onBuy}>
          {label}
          <Icon name="arrowLeft" size={15} />
        </button>
      </div>
    </div>
  )
}

function ExitDialog({
  title,
  body,
  cta,
  dismiss,
  secondary,
  price,
  currency,
  onBuy,
}: {
  title: string
  body: string
  cta: string
  dismiss: string
  secondary: string
  price: number
  currency: string
  onBuy: () => void
}) {
  const [open, setOpen] = useState(false)
  const dialogRef = useRef<HTMLDivElement | null>(null)

  useExitIntent(() => setOpen(true))
  useDialogFocus(open, dialogRef, () => setOpen(false))

  if (!open) return null

  const handleInside = () => {
    setOpen(false)
    window.setTimeout(() => scrollToSection("inside"), 80)
  }

  return (
    <div
      className="cv-modal-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) setOpen(false)
      }}
    >
      <div
        ref={dialogRef}
        className="cv-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cv-exit-title"
        aria-describedby="cv-exit-body"
        tabIndex={-1}
      >
        <button
          type="button"
          className="cv-modal-close"
          onClick={() => setOpen(false)}
          aria-label={dismiss}
        >
          <Icon name="x" size={16} />
        </button>

        <p className="cv-modal-eyebrow" dir="ltr" lang="en">
          CASANOVA
        </p>
        <h2 id="cv-exit-title" className="cv-modal-title">
          {title}
        </h2>
        <p id="cv-exit-body" className="cv-modal-body">
          {body}
        </p>

        <div className="cv-modal-actions">
          <button type="button" className="cv-btn cv-btn--camel" onClick={onBuy}>
            {cta}
            <span className="cv-btn-price" dir="ltr">
              {currencySymbol(currency)}
              {formatNumber(price)}
            </span>
            <Icon name="arrowLeft" size={16} />
          </button>
          <button
            type="button"
            className="cv-btn cv-btn--outline-ink"
            onClick={handleInside}
          >
            {secondary}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function SalesLandingPage() {
  const navigate = useNavigate()

  const { setSelectedProduct, authReady, isAuthenticated, user } = useApp()
  const cms = useCms()
  const c = useContent()

  const product = useSalesProduct()
  const price = effectivePrice(product)
  const onSale = isOnSale(product)

  const [menuOpen, setMenuOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const [openFaq, setOpenFaq] = useState(0)

  useEffect(() => {
    loadContent().catch(() => {})
  }, [])

  /* The floating accessibility control is global. On this page only, it
   * moves clear of the mobile reading column and the sticky purchase bar;
   * the reader and dashboard keep their own placement. */
  useEffect(() => {
    document.documentElement.dataset.cvLanding = "true"

    return () => {
      delete document.documentElement.dataset.cvLanding
    }
  }, [])

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 16)

    onScroll()
    window.addEventListener("scroll", onScroll, { passive: true })

    return () => window.removeEventListener("scroll", onScroll)
  }, [])

  const heroEyebrow = c("sales.hero.eyebrow")
  const heroHeadline = c("sales.hero.headline")
  const heroDescription = c("sales.hero.description")
  const buyLabel = c("sales.hero.buyCta") || "לרכישת הספר"
  const secondaryLabel = c("sales.hero.secondaryCta") || "מה יש בפנים"
  const secondaryLink = c("sales.hero.secondaryLink") || "#inside"
  const heroFacts = c.strings("sales.hero.facts")

  const benefits = c.list<{ title: string; content: string }>(
    "sales.benefits.items",
  )

  const aboutEyebrow = c("sales.about.eyebrow")
  const aboutTitle = c("sales.about.title")
  const aboutBody = c("sales.about.body")
  const aboutBody2 = c("sales.about.body2")
  const aboutQuote = c("sales.about.quote")
  const aboutQuoteCaption = c("sales.about.quoteCaption")
  const aboutThemes = c.list<{ title: string; content: string }>(
    "sales.about.themes",
  )

  const quoteEyebrow = c("sales.quote.eyebrow")
  const quoteText = c("sales.quote.text")

  const insideEyebrow = c("sales.inside.eyebrow")
  const insideTitle = c("sales.inside.title")
  const insideBody = c("sales.inside.body")
  const insideNote = c("sales.inside.note")
  const insideTopics = c.list<{ title: string; content: string }>(
    "sales.features.items",
  )
  const audienceTitle = c("sales.audience.title")
  const audience = c.list<{ title: string }>("sales.audience.yes")

  const offerEyebrow = c("sales.offer.eyebrow")
  const offerTitle = c("sales.offer.title")
  const offerContent = c("sales.offer.content")
  const offerCta = c("sales.offer.cta") || "לרכישת הספר"
  const offerSubtext = c("sales.offer.subtext")
  const offerNote = c("sales.offer.note")
  const offerDetails = c.strings("sales.offer.details")
  const priceLabel = onSale
    ? c("sales.offer.saleLabel") || "מחיר מוזל"
    : c("sales.offer.priceLabel") || "מחיר"

  const faqTitle = c("sales.faq.title")
  const faqIntro = c("sales.faq.intro")
  const faqSupportText = c("sales.faq.supportText")
  const faqSupportCta = c("sales.faq.supportCta")

  const footerCopyright = c("sales.footer.copyright")
  const footerAge = c("sales.footer.age")
  const footerPowered = c("sales.footer.powered")
  const memberLabel = c("sales.header.dashboard") || "האזור שלי"
  const guestLabel = c("sales.header.login") || "התחברות"
  const displayName =
    user?.first_name?.trim() || user?.email?.split("@")[0] || "משתמש"
  const initial = (user?.first_name?.trim() || user?.email || "?")
    .trim()
    .charAt(0)
    .toLocaleUpperCase()

  const account: LandingAccount = {
    ready: authReady,
    signedIn: isAuthenticated,
    href: isAuthenticated ? "/dashboard" : "/login",
    label: isAuthenticated ? memberLabel : guestLabel,
    memberLabel,
    guestLabel,
    displayName,
    initial,
    email: user?.email ?? "",
  }

  const stickyLabel =
    cms.settings.sales_sticky_cta?.trim() ||
    c("sales.stickyCta") ||
    SALES_SETTINGS_DEFAULTS.sales_sticky_cta

  const exitTitle =
    cms.settings.sales_exit_title?.trim() ||
    c("sales.exit.title") ||
    SALES_SETTINGS_DEFAULTS.sales_exit_title

  const exitBody =
    cms.settings.sales_exit_body?.trim() ||
    c("sales.exit.body") ||
    SALES_SETTINGS_DEFAULTS.sales_exit_body

  const exitCta =
    cms.settings.sales_exit_cta?.trim() ||
    c("sales.exit.cta") ||
    SALES_SETTINGS_DEFAULTS.sales_exit_cta

  const cmsFaqs = [...cms.faqs]
    .filter((faq) => faq.active)
    .sort((a, b) => a.display_order - b.display_order)

  const testimonials = [...cms.testimonials]
    .filter((testimonial) => testimonial.active)
    .sort((a, b) => a.display_order - b.display_order)

  const priceVars = { price }

  const faqs =
    cmsFaqs.length > 0
      ? cmsFaqs.map((faq) => ({
          id: faq.faq_id,
          question: fmt(faq.question, priceVars),
          answer: fmt(faq.answer ?? "", priceVars),
        }))
      : c
          .list<{ question: string; answer: string }>("sales.faq.items")
          .map((faq, index) => ({
            id: `faq-${index}`,
            question: fmt(faq.question, priceVars),
            answer: fmt(faq.answer, priceVars),
          }))

  const detailRows = offerDetails.map((line) => {
    const separator = line.indexOf(":")

    return separator >= 0
      ? {
          label: line.slice(0, separator).trim(),
          value: line.slice(separator + 1).trim(),
        }
      : { label: line.trim(), value: "" }
  })

  const seoTitle =
    c("sales.seo.title") ||
    "CASANOVA | ספר דיגיטלי על מיניות, משיכה ואינטימיות"

  const seoDescription =
    c("sales.seo.description") ||
    "הכירו את CASANOVA — המדריך הדיגיטלי ״היא קודם״ על תשוקה, משיכה ואינטימיות."

  const seoImage = c("sales.seo.image") || "/covers/hi-kodem-cover-1024.webp"

  useLandingMeta({
    title: seoTitle,
    description: seoDescription,
    image: seoImage,
    productName: product.name,
    price,
    currency: product.currency,
    availability: product.availability,
  })

  const handleBuy = () => {
    selectProduct(product, setSelectedProduct)
    navigate("/checkout")
  }

  const handleMobileBuy = () => {
    setMenuOpen(false)
    handleBuy()
  }

  return (
    <div className="cv-page" id="top">
      <a href="#main" className="skip-link">
        דלג לתוכן הראשי
      </a>

      <header className="cv-header" data-scrolled={scrolled}>
        <div className="cv-shell cv-header-inner">
          <Link to="/" className="cv-brand" aria-label="CASANOVA — דף הבית">
            <span className="cv-brand-word" dir="ltr" lang="en">
              CASANOVA
            </span>
          </Link>

          <nav className="cv-nav" aria-label="ניווט ראשי">
            {NAV_LINKS.map((link) => (
              <a key={link.href} href={link.href} className="cv-nav-link">
                {link.label}
              </a>
            ))}
          </nav>

          <div className="cv-header-actions">
            <AccountIndicator account={account} />

            <span className="cv-theme-toggle">
              <ThemeToggle />
            </span>

            <button
              type="button"
              className="cv-btn cv-btn--camel cv-btn--sm cv-header-cta"
              onClick={handleBuy}
            >
              {c("sales.header.cta") || "רכישת הספר"}
              <Icon name="arrowLeft" size={15} />
            </button>

            <button
              type="button"
              className="cv-menu-btn"
              onClick={(event) => {
                event.currentTarget.focus()
                setMenuOpen(true)
              }}
              aria-expanded={menuOpen}
              aria-controls="cv-mobile-menu"
              aria-label="פתיחת התפריט"
            >
              <Icon name="menu" size={18} />
            </button>
          </div>
        </div>
      </header>

      <main id="main">
        <section className="cv-hero">
          <div className="cv-grain" aria-hidden="true" />

          <div className="cv-shell cv-hero-grid">
            <div className="cv-hero-copy">
              {heroEyebrow && (
                <p className="cv-eyebrow cv-eyebrow--dark">{heroEyebrow}</p>
              )}

              <h1
                className="cv-hero-title"
                aria-label={`CASANOVA — ${product.name}`}
              >
                <span className="cv-brand-display" dir="ltr" lang="en">
                  CASANOVA
                </span>
                <span className="cv-hero-bookline" aria-hidden="true">
                  <span>{product.name}</span>
                  <span className="cv-hero-book-meta">מהדורה דיגיטלית</span>
                </span>
              </h1>

              {heroHeadline && (
                <p className="cv-hero-headline">
                  <Rich text={heroHeadline} />
                </p>
              )}

              {heroDescription && (
                <p className="cv-hero-desc">{heroDescription}</p>
              )}

              <div className="cv-hero-ctas">
                <button
                  type="button"
                  className="cv-btn cv-btn--camel"
                  onClick={handleBuy}
                >
                  {buyLabel}
                  <span className="cv-btn-price" dir="ltr">
                    {currencySymbol(product.currency)}
                    {formatNumber(price)}
                  </span>
                  <Icon name="arrowLeft" size={16} />
                </button>

                <SmartLink
                  to={secondaryLink}
                  className="cv-btn cv-btn--ghost-dark"
                >
                  {secondaryLabel}
                  <Icon name="chevronDown" size={16} />
                </SmartLink>
              </div>

              {heroFacts.length > 0 && (
                <ul className="cv-facts">
                  {heroFacts.map((fact) => (
                    <li key={fact}>{fact}</li>
                  ))}
                </ul>
              )}
            </div>

            <div className="cv-hero-visual">
              <div className="cv-book-halo" aria-hidden="true" />
              <div className="cv-book">
                <CoverArt product={product} />
              </div>
              <p className="cv-book-caption">
                <span>{product.name}</span>
                <span aria-hidden="true">·</span>
                <span>18+</span>
              </p>
            </div>
          </div>
        </section>

        {benefits.length > 0 && (
          <section className="cv-strip" aria-label="מידע על הספר והקריאה">
            <div className="cv-shell cv-strip-grid">
              {benefits.map((benefit, index) => (
                <div key={benefit.title} className="cv-strip-item">
                  <span className="cv-strip-icon" aria-hidden="true">
                    {index === 0 ? (
                      <Icon name="bookOpen" size={18} />
                    ) : index === 1 ? (
                      <Icon name="library" size={18} />
                    ) : (
                      <span className="cv-age-mark">18+</span>
                    )}
                  </span>
                  <div>
                    <p className="cv-strip-title">{benefit.title}</p>
                    {benefit.content && (
                      <p className="cv-strip-text">{benefit.content}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        <section id="about" className="cv-section cv-cream">
          <div className="cv-shell cv-about-grid">
            <div className="cv-about-copy">
              {aboutEyebrow && <p className="cv-eyebrow">{aboutEyebrow}</p>}

              {aboutTitle && (
                <h2 className="cv-h2">
                  <Rich text={aboutTitle} />
                </h2>
              )}

              {aboutBody && <p className="cv-body">{aboutBody}</p>}
              {aboutBody2 && <p className="cv-body">{aboutBody2}</p>}

              {aboutThemes.length > 0 && (
                <ol className="cv-principles">
                  {aboutThemes.map((theme, index) => (
                    <li key={theme.title}>
                      <span className="cv-principles-num" aria-hidden="true">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <div>
                        <h3 className="cv-principles-title">{theme.title}</h3>
                        {theme.content && (
                          <p className="cv-principles-text">{theme.content}</p>
                        )}
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </div>

            <div className="cv-about-visual">
              <figure className="cv-about-frame">
                <div className="cv-about-accent" aria-hidden="true" />
                <div className="cv-about-photo">
                  <img
                    src={portraitImg}
                    alt="איור CASANOVA — דיוקן בסגנון קלאסי"
                    width={900}
                    height={900}
                    loading="lazy"
                    decoding="async"
                  />
                </div>
              </figure>

              {aboutQuote && (
                <blockquote className="cv-about-quote">
                  ״{aboutQuote}״
                  {aboutQuoteCaption && (
                    <span className="cv-about-quote-cite">
                      {aboutQuoteCaption}
                    </span>
                  )}
                </blockquote>
              )}
            </div>
          </div>
        </section>

        {quoteText && (
          <section className="cv-quote-band cv-dark">
            <div className="cv-grain" aria-hidden="true" />
            <div className="cv-shell cv-quote-inner">
              {quoteEyebrow && (
                <p className="cv-eyebrow cv-eyebrow--dark">{quoteEyebrow}</p>
              )}
              <blockquote className="cv-quote">
                <Rich text={quoteText} />
              </blockquote>
            </div>
          </section>
        )}

        <section id="inside" className="cv-section cv-paper">
          <div
            className="cv-shell cv-inside-grid"
            style={
              insideTopics.length === 0
                ? { gridTemplateColumns: "minmax(0, 1fr)" }
                : undefined
            }
          >
            <div className="cv-inside-copy">
              {insideEyebrow && <p className="cv-eyebrow">{insideEyebrow}</p>}

              {insideTitle && (
                <h2 className="cv-h2">
                  <Rich text={insideTitle} />
                </h2>
              )}

              {insideBody && <p className="cv-body">{insideBody}</p>}

              {audience.length > 0 && (
                <div className="cv-audience">
                  {audienceTitle && (
                    <h3 className="cv-audience-title">{audienceTitle}</h3>
                  )}
                  <ul>
                    {audience.map((item) => (
                      <li key={item.title}>{item.title}</li>
                    ))}
                  </ul>
                </div>
              )}

              {insideNote && <p className="cv-note">{insideNote}</p>}

              <button
                type="button"
                className="cv-btn cv-btn--outline-ink"
                onClick={handleBuy}
              >
                {offerCta}
                <span className="cv-btn-price" dir="ltr">
                  {currencySymbol(product.currency)}
                  {formatNumber(price)}
                </span>
                <Icon name="arrowLeft" size={16} />
              </button>
            </div>

            {insideTopics.length > 0 && (
              <div className="cv-toc-wrap">
                <div className="cv-toc">
                  <div className="cv-toc-head">
                    <span>נושאי הספר</span>
                    <span dir="ltr" lang="en">
                      CASANOVA
                    </span>
                  </div>

                  <ol className="cv-toc-list">
                    {insideTopics.map((topic, index) => (
                      <li key={topic.title} className="cv-toc-item">
                        <span className="cv-toc-num" aria-hidden="true">
                          {String(index + 1).padStart(2, "0")}
                        </span>
                        <div>
                          <h3 className="cv-toc-title">{topic.title}</h3>
                          {topic.content && (
                            <p className="cv-toc-text">{topic.content}</p>
                          )}
                        </div>
                      </li>
                    ))}
                  </ol>

                  <div className="cv-toc-foot">
                    <span>{product.name}</span>
                    <span>18+</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>

        {testimonials.length > 0 && (
          <section className="cv-section cv-cream cv-testimonials">
            <div className="cv-shell">
              <p className="cv-eyebrow">קוראים</p>
              <h2 className="cv-h2">
                מה מספרים <em>קוראים.</em>
              </h2>

              <div className="cv-testimonial-grid">
                {testimonials.map((testimonial) => (
                  <figure
                    key={testimonial.testimonial_id}
                    className="cv-testimonial"
                  >
                    <blockquote>״{testimonial.quote}״</blockquote>
                    <figcaption>
                      {testimonial.name}
                      {testimonial.title ? ` · ${testimonial.title}` : ""}
                    </figcaption>
                  </figure>
                ))}
              </div>
            </div>
          </section>
        )}

        <section id="purchase" className="cv-section cv-purchase cv-dark">
          <div className="cv-grain" aria-hidden="true" />

          <div className="cv-shell cv-purchase-grid">
            <div className="cv-purchase-copy">
              {offerEyebrow && (
                <p className="cv-eyebrow cv-eyebrow--dark">{offerEyebrow}</p>
              )}

              {offerTitle && (
                <h2 className="cv-h2">
                  <Rich text={offerTitle} />
                </h2>
              )}

              {offerContent && (
                <p className="cv-body cv-body--dark">{offerContent}</p>
              )}

              <div className="cv-price-block">
                <span className="cv-price-label">{priceLabel}</span>
                <span className="cv-price-now">
                  <Price value={price} currency={product.currency} />
                </span>
                {onSale && (
                  <span className="cv-price-was">
                    במקום{" "}
                    <s dir="ltr">
                      {currencySymbol(product.currency)}
                      {formatNumber(product.price)}
                    </s>
                  </span>
                )}
              </div>

              <button
                type="button"
                className="cv-btn cv-btn--camel cv-btn--lg"
                onClick={handleBuy}
              >
                {offerCta}
                <span className="cv-btn-price" dir="ltr">
                  {currencySymbol(product.currency)}
                  {formatNumber(price)}
                </span>
                <Icon name="arrowLeft" size={17} />
              </button>

              {offerSubtext && <p className="cv-fine">{offerSubtext}</p>}
            </div>

            <aside className="cv-purchase-card">
              <div className="cv-purchase-card-head">
                <span className="cv-purchase-card-icon" aria-hidden="true">
                  <Icon name="bookOpen" size={20} />
                </span>
                <div>
                  <p className="cv-purchase-card-name">{product.name}</p>
                  <p className="cv-purchase-card-sub">מהדורה דיגיטלית · 18+</p>
                </div>
              </div>

              {detailRows.length > 0 && (
                <dl className="cv-purchase-details">
                  {detailRows.map((row) => (
                    <div key={row.label}>
                      <dt>{row.label}</dt>
                      {row.value && <dd>{row.value}</dd>}
                    </div>
                  ))}
                </dl>
              )}

              <div className="cv-purchase-card-foot">
                <span>רכישה חד־פעמית</span>
                <span>גישה אישית</span>
              </div>
            </aside>
          </div>

          {(offerNote || offerSubtext) && (
            <div className="cv-shell cv-purchase-legal">
              {offerNote && <p>{offerNote}</p>}
              <div>
                <Link to="/cancellation-and-refund-policy">
                  ביטול והחזרים
                </Link>
                <Link to="/terms-and-conditions">תנאי שימוש</Link>
                <Link to="/privacy-policy">מדיניות פרטיות</Link>
              </div>
            </div>
          )}
        </section>

        {faqs.length > 0 && (
          <section id="faq" className="cv-section cv-cream">
            <div className="cv-shell cv-faq-grid">
              <div className="cv-faq-head">
                <p className="cv-eyebrow">שאלות</p>

                {faqTitle && (
                  <h2 className="cv-h2">
                    <Rich text={faqTitle} />
                  </h2>
                )}

                {faqIntro && <p className="cv-body">{faqIntro}</p>}

                {faqSupportText && (
                  <p className="cv-support">
                    {faqSupportText}{" "}
                    <Link to="/support">
                      {faqSupportCta || "לעמוד התמיכה"}
                    </Link>
                  </p>
                )}
              </div>

              <div className="cv-faq-list">
                {faqs.map((faq, index) => {
                  const isOpen = openFaq === index
                  const triggerId = `cv-faq-trigger-${index}`
                  const panelId = `cv-faq-panel-${index}`

                  return (
                    <div key={faq.id} className="cv-faq-item">
                      <h3>
                        <button
                          type="button"
                          id={triggerId}
                          className="cv-faq-trigger"
                          aria-expanded={isOpen}
                          aria-controls={panelId}
                          onClick={() =>
                            setOpenFaq(isOpen ? -1 : index)
                          }
                        >
                          <span>{faq.question}</span>
                          <span className="cv-faq-plus" aria-hidden="true" />
                        </button>
                      </h3>

                      <div
                        id={panelId}
                        role="region"
                        aria-labelledby={triggerId}
                        className="cv-faq-answer"
                        hidden={!isOpen}
                      >
                        <p>{faq.answer}</p>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </section>
        )}
      </main>

      <footer className="cv-footer">
        <div className="cv-shell">
          <div className="cv-footer-top">
            <div>
              <span className="cv-brand-word" dir="ltr" lang="en">
                CASANOVA
              </span>
              <p className="cv-footer-tagline">
                {product.name} · ספר דיגיטלי למבוגרים
              </p>
            </div>

            <div>
              <nav className="cv-footer-nav" aria-label="ניווט בפוטר">
                {NAV_LINKS.map((link) => (
                  <a key={link.href} href={link.href}>
                    {link.label}
                  </a>
                ))}
                <Link to={account.href}>{account.label}</Link>
              </nav>

              <div className="cv-footer-legal">
                <Link to="/terms-and-conditions">תנאי שימוש</Link>
                <Link to="/privacy-policy">מדיניות פרטיות</Link>
                <Link to="/cancellation-and-refund-policy">
                  ביטול והחזרים
                </Link>
                <Link to="/accessibility-statement">הצהרת נגישות</Link>
                <Link to="/support">תמיכה</Link>
              </div>
            </div>
          </div>

          <div className="cv-footer-bottom">
            <div className="cv-footer-utility">
              <AccessibilityFooterLink />
            </div>

            {footerCopyright && (
              <p>{fmt(footerCopyright, { year: new Date().getFullYear() })}</p>
            )}

            {footerAge && <span className="cv-footer-age">{footerAge}</span>}

            {footerPowered && (
              <a
                href="https://www.phantomthirdlabs.com/"
                target="_blank"
                rel="noopener noreferrer"
              >
                {footerPowered}
              </a>
            )}
          </div>
        </div>
      </footer>

      <MobileMenu
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        onBuy={handleMobileBuy}
        buyLabel={buyLabel}
        account={account}
        price={price}
        currency={product.currency}
        productName={product.name}
      />

      {!menuOpen && (
        <StickyCta
          product={product}
          label={fmt(stickyLabel, { price })}
          onBuy={handleBuy}
        />
      )}

      <ExitDialog
        title={fmt(exitTitle, { price })}
        body={fmt(exitBody, { price })}
        cta={exitCta}
        dismiss={c("sales.exit.dismiss") || "לא עכשיו"}
        secondary={secondaryLabel}
        price={price}
        currency={product.currency}
        onBuy={handleBuy}
      />
    </div>
  )
}
