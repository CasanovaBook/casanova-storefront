import { useEffect, useRef, useState } from "react"
import { Outlet, Link, useLocation, useNavigate } from "react-router"
import { useApp } from "../../context/AppContext"
import { fmt, useContent } from "../../content/useContent"
import { SmartLink } from "../../content/render"
import Icon from "../icons"
import AccessibilityFooterLink from "../accessibility/AccessibilityFooterLink"
import { loadContent } from "../../content/store"
import useFavicon from "../useFavicon"
import logoImg from "../../assets/casanova-portrait.webp"

/**
 * Public storefront shell.
 *
 * The approved homepage runs without this shell; every other public route
 * (store, checkout, support, legal pages, recovery) shares it. Dark chrome
 * and a cream content canvas carry the same brand as the homepage without
 * turning informational pages into marketing posters.
 */
export default function PublicRoot() {
  const { isAuthenticated, isAdmin, user, logout } = useApp()
  const c = useContent()
  useFavicon()
  const navigate = useNavigate()
  const location = useLocation()
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const menuButtonRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    loadContent().catch(() => {})
  }, [location.pathname])

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

  const navItems = c
    .list<{ label: string; to: string }>("global.nav")
    .filter((item) => item.label.trim() && item.to.trim())
  const brand = c("global.brand") || "Casanova"
  const logoSrc = c("global.logo") || logoImg

  const loginLabel = c("ui.nav.login") || "התחברות"
  const logoutLabel = c("ui.nav.logout") || "התנתקות"
  const adminLabel = c("ui.nav.admin") || "ניהול"
  const libraryLabel = c("ui.nav.library") || "הספרייה שלי"
  const ctaLabel = c("ui.nav.cta") || "קבלו גישה"
  const greetingPrefix = c("ui.nav.greeting") || "שלום"

  useEffect(() => {
    document.documentElement.dataset.appShell = "true"
    return () => { delete document.documentElement.dataset.appShell }
  }, [])

  const footerTagline =
    c("global.footerTagline") || "כל הספרים שלכם, במקום אחד."
  const footerCopyright = fmt(
    c("global.footerCopyright") ||
      `© ${new Date().getFullYear()} Casanova. כל הזכויות שמורות.`,
    { year: new Date().getFullYear() },
  )

  const showStoreCta = !["/store", "/checkout", "/checkout/success"].includes(
    location.pathname,
  )

  const handleLogout = () => {
    setMenuOpen(false)
    logout()
    navigate("/")
  }

  const isNavActive = (to: string) => {
    const [path, hash] = to.split("#")
    if (hash) {
      return location.pathname === path && location.hash === `#${hash}`
    }
    return location.pathname === path
  }

  const desktopAccount = isAuthenticated ? (
    <>
      <Link
        to={isAdmin ? "/admin" : "/dashboard"}
        className="site-account-link"
      >
        {isAdmin ? adminLabel : libraryLabel}
      </Link>
      <button
        type="button"
        onClick={handleLogout}
        className="site-account-link"
      >
        {logoutLabel}
      </button>
    </>
  ) : (
    <>
      <Link to="/login" className="site-account-link">
        {loginLabel}
      </Link>
      {showStoreCta && (
        <Link to="/store" className="app-btn">
          {ctaLabel}
        </Link>
      )}
    </>
  )

  const mobileAccount = isAuthenticated ? (
    <>
      <Link
        to={isAdmin ? "/admin" : "/dashboard"}
        className="app-btn app-btn-secondary"
        onClick={() => setMenuOpen(false)}
      >
        {isAdmin ? adminLabel : libraryLabel}
      </Link>
      <button
        type="button"
        onClick={handleLogout}
        className="app-btn app-btn-ghost"
      >
        {logoutLabel}
      </button>
    </>
  ) : (
    <>
      {showStoreCta ? (
        <Link
          to="/store"
          className="app-btn"
          onClick={() => setMenuOpen(false)}
        >
          {ctaLabel}
        </Link>
      ) : null}
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
    <div className="public-shell">
      <a href="#main" className="skip-link">
        דלג לתוכן הראשי
      </a>

      <header className="site-header">
        <div className="site-container site-header-inner">
          <Link to="/" className="site-brand" aria-label={`${brand} — דף הבית`}>
            <img src={logoSrc} alt="" />
            <span className="site-brand-word" dir="ltr" lang="en">
              {brand}
            </span>
          </Link>

          <nav className="site-nav" aria-label="ניווט ראשי">
            {navItems.map((item) => (
              <SmartLink
                key={`${item.label}-${item.to}`}
                to={item.to}
                className="site-nav-link"
                aria-current={isNavActive(item.to) ? "page" : undefined}
              >
                {item.label}
              </SmartLink>
            ))}
          </nav>

          <div className="site-header-actions">
            {isAuthenticated && (
              <span className="site-account-link">
                {greetingPrefix}, {user?.first_name}
              </span>
            )}
            <div className="hidden md:flex items-center gap-2">
              {desktopAccount}
            </div>
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
            {navItems.map((item) => (
              <SmartLink
                key={`${item.label}-${item.to}`}
                to={item.to}
                className="site-mobile-link"
                onClick={() => setMenuOpen(false)}
              >
                {item.label}
                <Icon name="arrowLeft" size={15} />
              </SmartLink>
            ))}
          </nav>

          <div className="site-mobile-actions">{mobileAccount}</div>

          <p className="site-mobile-note">CASANOVA · תוכן למבוגרים · 18+</p>
        </div>
      )}

      <main id="main" className="public-main app-main">
        <Outlet />
      </main>

      <footer className="site-footer">
        <div className="site-container">
          <div className="site-footer-top">
            <div>
              <span className="site-brand-word" dir="ltr" lang="en">
                {brand}
              </span>
              <p className="site-footer-tagline">{footerTagline}</p>
            </div>

            <div>
              <nav className="site-footer-nav" aria-label="ניווט בפוטר">
                {navItems.map((item) => (
                  <SmartLink key={`${item.label}-${item.to}`} to={item.to}>
                    {item.label}
                  </SmartLink>
                ))}
                <Link to="/login">{loginLabel}</Link>
              </nav>

              <div className="site-footer-legal">
                <Link to="/terms-and-conditions">תנאי שימוש</Link>
                <Link to="/privacy-policy">מדיניות פרטיות</Link>
                <Link to="/cancellation-and-refund-policy">
                  ביטול והחזרים
                </Link>
                <Link to="/accessibility-statement">הצהרת נגישות</Link>
              </div>
            </div>
          </div>

          <div className="site-footer-bottom">
            <div className="site-footer-utility">
              <AccessibilityFooterLink />
            </div>
            <p>{footerCopyright}</p>
            <span style={{ color: "#de9a60" }}>תוכן למבוגרים · 18+</span>
          </div>
        </div>
      </footer>
    </div>
  )
}
