import { useEffect, useState } from "react"
import { Outlet, Link, useLocation, useNavigate } from "react-router"
import { useApp } from "../../context/AppContext"
import { useCms } from "../../context/CmsContext"
import { useContent } from "../../content/useContent"
import Icon from "../icons"
import ThemeToggle from "../ThemeToggle"
import AccessibilityMenu from "../AccessibilityMenu"
import { loadContent } from "../../content/store"
import useFavicon from "../useFavicon"
import logoImg from "../../../images/main_photo.jpg"

/**
 * Public shell: header, navigation and the routed page.
 *
 * All visible text is editable through Maestro CMS:
 *  - Brand name: global.brand
 *  - Navigation: global.nav (list of label+link)
 *  - Account actions: nav.login, nav.logout, etc.
 *  - Footer: global.footerTagline, global.footerCopyright
 */
export default function PublicRoot() {
  const { isAuthenticated, isAdmin, user, logout } = useApp()
  const { publishedProducts, activeSections, faqs } = useCms()
  const c = useContent()
  useFavicon()
  const navigate = useNavigate()
  const location = useLocation()
  const [menuOpen, setMenuOpen] = useState(false)

  // Load content from the database on every public page load so the site
  // always renders the latest Maestro CMS edits (not just the localStorage cache).
  // Re-load on every route change so edits made in Maestro appear immediately
  // when the user navigates to a different page.
  useEffect(() => {
    loadContent().catch(() => {})
  }, [location.pathname])

  // A menu left open must not follow the visitor to the next screen.
  useEffect(() => {
    setMenuOpen(false)
  }, [location.pathname])

  const hasCatalog = publishedProducts.length > 0
  const hasPricing =
    publishedProducts.some((p) => p.product_type === "BUNDLE") &&
    publishedProducts.some((p) => p.product_type === "SUBSCRIPTION")
  const hasFaq =
    activeSections.some((s) => s.type === "FAQ") && faqs.some((f) => f.active)

  // Editable nav from the content store; falls back to the registry defaults.
  const navItems = c.list<{ label: string; to: string }>("global.nav")
  const brand = c("global.brand") || "Casanova"
  const logoSrc = c("global.logo") || logoImg

  const anchors = [
    { href: "#catalog", label: "קטלוג", show: hasCatalog },
    { href: "#pricing", label: "מחירים", show: hasPricing },
    { href: "#faq", label: "שאלות נפוצות", show: hasFaq },
  ].filter((item) => item.show)

  const onLanding = location.pathname === "/"
  const sectionHref = (hash: string) => (onLanding ? hash : `/${hash}`)

  const handleLogout = () => {
    logout()
    navigate("/")
  }

  // Editable account action labels
  const loginLabel = c("ui.nav.login") || "התחברות"
  const logoutLabel = c("ui.nav.logout") || "התנתקות"
  const adminLabel = c("ui.nav.admin") || "ניהול"
  const libraryLabel = c("ui.nav.library") || "הספרייה שלי"
  const ctaLabel = c("ui.nav.cta") || "קבלו גישה"
  const greetingPrefix = c("ui.nav.greeting") || "שלום"

  const accountActions = isAuthenticated ? (
    <>
      <Link
        to={isAdmin ? "/admin" : "/dashboard"}
        className="tap-target text-sm font-medium px-4 py-2 rounded-full border transition-colors hover:bg-white/5"
        style={{
          borderColor: "var(--color-border)",
          color: "var(--color-foreground)",
        }}
      >
        {isAdmin ? adminLabel : libraryLabel}
      </Link>
      <button
        onClick={handleLogout}
        className="tap-target text-sm font-medium transition-opacity hover:opacity-70 px-2"
        style={{ color: "var(--color-muted-foreground)" }}
      >
        {logoutLabel}
      </button>
    </>
  ) : (
    <>
      <Link
        to="/login"
        className="tap-target inline-flex items-center justify-center text-sm font-medium transition-opacity hover:opacity-70 px-2 py-2"
        style={{ color: "var(--color-muted-foreground)" }}
      >
        {loginLabel}
      </Link>
      <Link
        to="/checkout"
        className="btn-gradient tap-target inline-flex items-center justify-center text-sm font-bold px-5 py-2 rounded-full"
      >
        {ctaLabel}
      </Link>
    </>
  )


  // Editable footer text
  const footerTagline = c("global.footerTagline") || "כל הספרים שלכם, במקום אחד."
  const footerCopyright = c("global.footerCopyright") || `© ${new Date().getFullYear()} Casanova. כל הזכויות שמורות.`

  return (
    <div
      className="min-h-full flex flex-col"
      style={{ background: "var(--color-background)" }}
    >
      <a href="#main" className="skip-link">דלג לתוכן הראשי</a>
      <header
        className="safe-top fixed left-0 right-0 z-50 glass border-b transition-all top-0"
        style={{ borderColor: "rgba(30,30,46,0.8)" }}
      >
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-3">
          <Link to="/" className="flex items-center gap-2.5 group min-w-0">
            <img
              src={logoSrc}
              alt={brand}
              className="w-8 h-8 rounded-lg object-cover shadow-lg flex-shrink-0"
            />
            <span
              dir="ltr"
              className="font-display text-xl font-bold tracking-wide truncate"
              style={{ color: "var(--color-primary)" }}
            >
              {brand}
            </span>
          </Link>

          <nav className="hidden md:flex items-center gap-8">
            {anchors.map((item) => (
              <a
                key={item.href}
                href={sectionHref(item.href)}
                className="text-sm font-medium transition-colors hover:opacity-80"
                style={{ color: "var(--color-muted-foreground)" }}
              >
                {item.label}
              </a>
            ))}
            {/* Editable nav links from the content store */}
            {navItems.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className="text-sm font-medium transition-colors hover:opacity-80"
                style={{ color: "var(--color-muted-foreground)" }}
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-2 sm:gap-3">
            {/* Debug: always-visible accessibility trigger for local preview */}
            <button
              onClick={() => window.dispatchEvent(new CustomEvent('open-accessibility-debug'))}
              className="tap-target px-3 py-2 rounded-lg border"
              style={{ marginLeft: 6 }}
            >
              נגישות
            </button>
            {isAuthenticated && (
              <span
                className="text-sm hidden lg:block"
                style={{ color: "var(--color-muted-foreground)" }}
              >
                {greetingPrefix}, {user?.first_name}
              </span>
            )}
            <div className="hidden md:flex items-center gap-3">
              <ThemeToggle />
              <AccessibilityMenu />
              {accountActions}
            </div>
            <div className="md:hidden flex items-center gap-1">
              <ThemeToggle />
              <AccessibilityMenu />
              <button
                onClick={() => setMenuOpen((open) => !open)}
                className="tap-target flex items-center justify-center rounded-lg border"
                style={{
                  borderColor: "var(--color-border)",
                  color: "var(--color-foreground)",
                }}
                aria-label={menuOpen ? "סגירת תפריט" : "פתיחת תפריט"}
                aria-expanded={menuOpen}
              >
                <Icon name={menuOpen ? "x" : "menu"} size={18} />
              </button>
            </div>
          </div>
        </div>

        {/* Mobile menu */}
        {menuOpen && (
          <div
            className="md:hidden border-t px-4 py-3 space-y-1"
            style={{
              borderColor: "var(--color-border)",
              background: "var(--color-card)",
            }}
          >
            {anchors.map((item) => (
              <a
                key={item.href}
                href={sectionHref(item.href)}
                className="tap-target block px-3 py-2.5 rounded-lg text-sm font-medium"
                style={{ color: "var(--color-muted-foreground)" }}
              >
                {item.label}
              </a>
            ))}
            {navItems.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className="tap-target block px-3 py-2.5 rounded-lg text-sm font-medium"
                style={{ color: "var(--color-muted-foreground)" }}
              >
                {item.label}
              </Link>
            ))}
            <div
              className="pt-2 mt-2 border-t flex items-center gap-3"
              style={{ borderColor: "var(--color-border)" }}
            >
              {accountActions}
            </div>
          </div>
        )}
      </header>

      <main id="main" className="flex-1 pt-16">
        <Outlet />
      </main>

      {/* ── FOOTER ────────────────────────────────────────────── */}
      <footer
        className="border-t py-8"
        style={{ borderColor: "var(--color-border)" }}
      >
        <p
          className="max-w-6xl mx-auto px-6 pb-5 text-sm text-center whitespace-pre-line"
          style={{ color: "var(--color-muted-foreground)" }}
        >
          {footerTagline}
        </p>
        <div
          className="max-w-6xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-4 text-sm"
          style={{ color: "var(--color-muted-foreground)" }}
        >
          <div className="flex items-center gap-2">
            <img
              src={logoSrc}
              alt={brand}
              className="w-6 h-6 rounded object-cover"
            />
            <span
              className="font-display font-bold tracking-wide"
              style={{ color: "var(--color-primary)" }}
            >
              {brand}
            </span>
          </div>
          <div className="flex gap-6">
            {navItems.map((item) => (
              <Link key={item.to} to={item.to} className="hover:opacity-80 transition-opacity">
                {item.label}
              </Link>
            ))}
            <Link to="/login" className="hover:opacity-80 transition-opacity">
              {loginLabel}
            </Link>
          </div>
          <p>{footerCopyright}</p>
        </div>
      </footer>
    </div>
  )
}
