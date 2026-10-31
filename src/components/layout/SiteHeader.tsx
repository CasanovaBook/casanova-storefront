import { useEffect, useRef, useState } from "react"
import { Link, useLocation, useNavigate } from "react-router"
import { useApp } from "../../context/AppContext"
import { useContent } from "../../content/useContent"
import { MARKETING_NAV_LINKS, type MarketingNavLink } from "../../content/site-nav"
import Icon from "../icons"
import ThemeToggle from "../ThemeToggle"
import logoImg from "../../assets/casanova-portrait.webp"

/**
 * The one public navigation header.
 *
 * The landing page's marketing menu is the single source of truth: the same
 * four section links (and the same mobile drawer) render on the landing page,
 * the store, support, checkout and every legal page. Only the account block
 * changes with the session, and the primary CTA may change label/action on
 * the landing page (buy) versus the rest of the site (store).
 */
export default function SiteHeader({
  ctaLabel,
  onCta,
}: {
  ctaLabel?: string
  onCta?: () => void
}) {
  const { authReady, isAuthenticated, isAdmin, user, logout } = useApp()
  const c = useContent()
  const navigate = useNavigate()
  const location = useLocation()

  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const menuButtonRef = useRef<HTMLButtonElement | null>(null)

  const brand = c("global.brand") || "Casanova"
  const logoSrc = c("global.logo") || logoImg
  const loginLabel = c("ui.nav.login") || "התחברות"
  const logoutLabel = c("ui.nav.logout") || "התנתקות"
  const adminLabel = c("ui.nav.admin") || "ניהול"
  const libraryLabel = c("ui.nav.library") || "הספרייה שלי"
  const primaryLabel = ctaLabel || c("ui.nav.cta") || "קבלו גישה"
  const memberLabel = isAdmin ? adminLabel : libraryLabel
  const memberHref = isAdmin ? "/admin" : "/dashboard"
  const displayName =
    user?.first_name?.trim() || user?.email?.split("@")[0] || "משתמש"
  const initial = (user?.first_name?.trim() || user?.email || "?")
    .trim()
    .charAt(0)
    .toLocaleUpperCase()

  useEffect(() => {
    setMenuOpen(false)
  }, [location.pathname])

  useEffect(() => {
    if (!menuOpen) return

    const panel = menuRef.current
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"

    const focusable = () =>
      Array.from(
        panel?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((element) => element.getAttribute("aria-hidden") !== "true")

    focusable()[0]?.focus()

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault()
        setMenuOpen(false)
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
      menuButtonRef.current?.focus()
    }
  }, [menuOpen])

  const handleLogout = () => {
    setMenuOpen(false)
    logout()
    navigate("/")
  }

  /* On the landing page a section link scrolls in place; everywhere else it
   * navigates to the landing page and lets the browser perform the hash jump. */
  const onNavClick = (
    event: React.MouseEvent<HTMLAnchorElement>,
    link: MarketingNavLink,
  ) => {
    if (location.pathname !== "/") return
    const target = document.getElementById(link.hash)
    if (!target) return

    event.preventDefault()
    if (window.location.hash !== `#${link.hash}`) {
      window.history.replaceState(null, "", link.href)
    }

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    target.scrollIntoView({
      behavior: reduce ? "auto" : "smooth",
      block: "start",
    })
  }

  const isNavActive = (link: MarketingNavLink) =>
    location.pathname === "/" && location.hash === `#${link.hash}`

  const primaryCta = (className: string) =>
    onCta ? (
      <button
        type="button"
        className={className}
        onClick={() => {
          setMenuOpen(false)
          onCta()
        }}
      >
        {primaryLabel}
        <Icon name="arrowLeft" size={15} />
      </button>
    ) : (
      <Link to="/store" className={className} onClick={() => setMenuOpen(false)}>
        {primaryLabel}
        <Icon name="arrowLeft" size={15} />
      </Link>
    )

  const account =
    !authReady ? null : isAuthenticated ? (
      <>
        <Link
          to={memberHref}
          className="site-member-link"
          aria-label={`${memberLabel} - ${displayName} (מחובר)`}
          title={user?.email ? `${displayName} · ${user.email}` : displayName}
        >
          <span className="site-member-avatar" aria-hidden="true">
            {initial}
            <span className="site-member-dot" />
          </span>
          <span className="site-member-label">{memberLabel}</span>
        </Link>
        <button type="button" onClick={handleLogout} className="site-account-link">
          {logoutLabel}
        </button>
      </>
    ) : (
      <>
        <Link to="/login" className="site-account-link">
          {loginLabel}
        </Link>
        {primaryCta("app-btn")}
      </>
    )

  const mobileAccount =
    !authReady ? null : isAuthenticated ? (
      <>
        <Link
          to={memberHref}
          className="app-btn app-btn-secondary"
          onClick={() => setMenuOpen(false)}
        >
          {memberLabel}
        </Link>
        <button type="button" onClick={handleLogout} className="app-btn app-btn-ghost">
          {logoutLabel}
        </button>
      </>
    ) : (
      <>
        {primaryCta("app-btn")}
        <Link
          to="/login"
          className="app-btn app-btn-secondary"
          onClick={() => setMenuOpen(false)}
        >
          {loginLabel}
        </Link>
      </>
    )

  return (
    <>
      <header className="site-header">
        <div className="site-container site-header-inner">
          <Link to="/" className="site-brand" aria-label={`${brand} - דף הבית`}>
            <img src={logoSrc} alt="" />
            <span className="site-brand-word" dir="ltr" lang="en">
              {brand}
            </span>
          </Link>

          <nav className="site-nav" aria-label="ניווט ראשי">
            {MARKETING_NAV_LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="site-nav-link"
                aria-current={isNavActive(link) ? "page" : undefined}
                onClick={(event) => onNavClick(event, link)}
              >
                {link.label}
              </a>
            ))}
          </nav>

          <div className="site-header-actions">
            <span className="site-header-theme">
              <ThemeToggle />
            </span>
            <div className="hidden md:flex items-center gap-2">{account}</div>
            <button
              ref={menuButtonRef}
              type="button"
              className="site-menu-btn"
              onClick={() => setMenuOpen(true)}
              aria-expanded={menuOpen}
              aria-controls="site-mobile-menu"
              aria-label="פתיחת תפריט"
            >
              <Icon name="menu" size={18} />
            </button>
          </div>
        </div>
      </header>

      {menuOpen && (
        <div
          ref={menuRef}
          id="site-mobile-menu"
          className="site-mobile-panel"
          role="dialog"
          aria-modal="true"
          aria-labelledby="site-mobile-title"
        >
          <h2 id="site-mobile-title" className="sr-only">
            ניווט
          </h2>

          <div className="site-mobile-head">
            <span className="site-brand-word" dir="ltr" lang="en">
              {brand}
            </span>
            <button
              type="button"
              className="site-mobile-close"
              onClick={() => setMenuOpen(false)}
              aria-label="סגירת התפריט"
            >
              <Icon name="x" size={18} />
            </button>
          </div>

          <nav className="site-mobile-nav" aria-label="ניווט ראשי">
            {MARKETING_NAV_LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="site-mobile-link"
                onClick={(event) => {
                  onNavClick(event, link)
                  setMenuOpen(false)
                }}
              >
                {link.label}
                <Icon name="arrowLeft" size={15} />
              </a>
            ))}
          </nav>

          <div className="site-mobile-actions">{mobileAccount}</div>

          <p className="site-mobile-note">CASANOVA · תוכן למבוגרים · 18+</p>
        </div>
      )}
    </>
  )
}