import { useEffect } from "react"
import { Outlet, Link, useLocation } from "react-router"
import { fmt, useContent } from "../../content/useContent"
import { MARKETING_NAV_LINKS } from "../../content/site-nav"
import AccessibilityFooterLink from "../accessibility/AccessibilityFooterLink"
import AnnouncementBanner from "../AnnouncementBanner"
import { loadContent } from "../../content/store"
import { openConsentPreferences } from "../../lib/consent"
import useFavicon from "../useFavicon"
import SiteHeader from "./SiteHeader"

/**
 * Public storefront shell.
 *
 * The approved homepage runs without this shell; every other public route
 * (store, checkout, support, legal pages, recovery) shares it. Dark chrome
 * and a cream content canvas carry the same brand as the homepage without
 * turning informational pages into marketing posters.
 */
export default function PublicRoot() {
  const c = useContent()
  useFavicon()
  const location = useLocation()

  useEffect(() => {
    loadContent().catch(() => {})
  }, [location.pathname])

  useEffect(() => {
    document.documentElement.dataset.appShell = "true"
    return () => {
      delete document.documentElement.dataset.appShell
    }
  }, [])

  const brand = c("global.brand") || "Casanova"
  const loginLabel = c("ui.nav.login") || "התחברות"
  const footerTagline =
    c("global.footerTagline") || "כל הספרים שלכם, במקום אחד."
  const footerCopyright = fmt(
    c("global.footerCopyright") ||
      `© ${new Date().getFullYear()} Casanova. כל הזכויות שמורות.`,
    { year: new Date().getFullYear() },
  )

  return (
    <div className="public-shell">
      <a href="#main" className="skip-link">
        דלג לתוכן הראשי
      </a>

      <AnnouncementBanner />

      <SiteHeader />

      <main id="main" className="public-main app-main">
        <Outlet />
      </main>

      <footer className="site-footer">
        <div className="site-container">
          <div className="site-footer-top">
            <div className="site-footer-brand">
              <span className="site-brand-word" dir="ltr" lang="en">
                {brand}
              </span>
              <p className="site-footer-tagline">{footerTagline}</p>
            </div>

            <nav className="site-footer-nav" aria-label="ניווט בפוטר">
              <h2 className="site-footer-heading">ניווט</h2>
              {MARKETING_NAV_LINKS.map((link) => (
                <a key={link.href} href={link.href}>
                  {link.label}
                </a>
              ))}
              <Link to="/login">{loginLabel}</Link>
            </nav>

            <nav className="site-footer-legal" aria-label="מידע ותקנון">
              <h2 className="site-footer-heading">מידע ותקנון</h2>
              <Link to="/terms-and-conditions">תנאי שימוש</Link>
              <Link to="/privacy-policy">מדיניות פרטיות</Link>
              <button
                type="button"
                className="footer-cookie-settings"
                onClick={openConsentPreferences}
              >
                הגדרות עוגיות
              </button>
              <Link to="/cancellation-and-refund-policy">
                ביטול והחזרים
              </Link>
              <Link to="/accessibility-statement">הצהרת נגישות</Link>
            </nav>
          </div>

          <div className="site-footer-bottom">
            <div className="site-footer-bottom-group">
              <p>{footerCopyright}</p>
              <div className="site-footer-utility">
                <AccessibilityFooterLink />
              </div>
            </div>

            <div className="site-footer-bottom-group">
              <span className="site-footer-age">תוכן למבוגרים · 18+</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}
