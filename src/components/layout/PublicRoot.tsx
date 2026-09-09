import { useEffect, useState } from "react"
import { Outlet, Link, useLocation, useNavigate } from "react-router"
import { useApp } from "../../context/AppContext"
import { useCms } from "../../context/CmsContext"
import Icon from "../icons"
import ThemeToggle from "../ThemeToggle"
import logoImg from "../../../images/main_photo.jpg"

/**
 * Public shell: header, navigation and the routed page.
 *
 * The navigation is derived from what the CMS actually publishes rather
 * than hardcoded, so a link never points at an anchor the landing page
 * decided not to render. Sections that are switched off — or that have no
 * content yet — simply drop out of the menu.
 */
export default function PublicRoot() {
  const { isAuthenticated, isAdmin, user, logout } = useApp()
  const { publishedProducts, activeSections, faqs } = useCms()
  const navigate = useNavigate()
  const location = useLocation()
  const [menuOpen, setMenuOpen] = useState(false)

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

  const anchors = [
    { href: "#catalog", label: "קטלוג", show: hasCatalog },
    { href: "#pricing", label: "מחירים", show: hasPricing },
    { href: "#faq", label: "שאלות נפוצות", show: hasFaq },
  ].filter((item) => item.show)

  /* The section anchors only exist on the landing page. Anywhere else a bare
   * href="#catalog" just appends a hash to the current URL and scrolls
   * nowhere, so off-landing these become real navigations to the landing
   * page, where the browser resolves the fragment natively. LandingPage ships
   * in the initial bundle, so that reload costs nothing worth avoiding. */
  const onLanding = location.pathname === "/"
  const sectionHref = (hash: string) => (onLanding ? hash : `/${hash}`)

  const handleLogout = () => {
    logout()
    navigate("/")
  }

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
        {isAdmin ? "ניהול" : "הספרייה שלי"}
      </Link>
      <button
        onClick={handleLogout}
        className="tap-target text-sm font-medium transition-opacity hover:opacity-70 px-2"
        style={{ color: "var(--color-muted-foreground)" }}
      >
        התנתקות
      </button>
    </>
  ) : (
    <>
      <Link
        to="/login"
        className="tap-target inline-flex items-center justify-center text-sm font-medium transition-opacity hover:opacity-70 px-2 py-2"
        style={{ color: "var(--color-muted-foreground)" }}
      >
        התחברות
      </Link>
      <Link
        to="/checkout"
        className="btn-gradient tap-target inline-flex items-center justify-center text-sm font-bold px-5 py-2 rounded-full"
      >
        קבלו גישה
      </Link>
    </>
  )

  return (
    <div
      className="min-h-full flex flex-col"
      style={{ background: "var(--color-background)" }}
    >
      <header
        className="safe-top fixed top-0 left-0 right-0 z-50 glass border-b"
        style={{ borderColor: "rgba(30,30,46,0.8)" }}
      >
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-3">
          <Link to="/" className="flex items-center gap-2.5 group min-w-0">
            <img
              src={logoImg}
              alt="Casanova"
              className="w-8 h-8 rounded-lg object-cover shadow-lg flex-shrink-0"
            />
            <span
              dir="ltr"
              className="font-display text-xl font-bold tracking-wide truncate"
              style={{ color: "var(--color-primary)" }}
            >
              Casanova
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
            <Link
              to="/store"
              className="text-sm font-medium transition-colors hover:opacity-80"
              style={{ color: "var(--color-muted-foreground)" }}
            >
              החנות
            </Link>
            <Link
              to="/support"
              className="text-sm font-medium transition-colors hover:opacity-80"
              style={{ color: "var(--color-muted-foreground)" }}
            >
              תמיכה
            </Link>
          </nav>

          <div className="flex items-center gap-2 sm:gap-3">
            {isAuthenticated && (
              <span
                className="text-sm hidden lg:block"
                style={{ color: "var(--color-muted-foreground)" }}
              >
                שלום, {user?.first_name}
              </span>
            )}
            <div className="hidden md:flex items-center gap-3">
              <ThemeToggle />
              {accountActions}
            </div>
            <div className="md:hidden flex items-center gap-1">
              <ThemeToggle />
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

        {/* Mobile menu — the only way to reach the anchors and the account
         * actions on a narrow screen, where the inline nav is hidden. */}
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
            <Link
              to="/store"
              className="tap-target block px-3 py-2.5 rounded-lg text-sm font-medium"
              style={{ color: "var(--color-muted-foreground)" }}
            >
              החנות
            </Link>
            <Link
              to="/support"
              className="tap-target block px-3 py-2.5 rounded-lg text-sm font-medium"
              style={{ color: "var(--color-muted-foreground)" }}
            >
              תמיכה
            </Link>
            <div
              className="pt-2 mt-2 border-t flex items-center gap-3"
              style={{ borderColor: "var(--color-border)" }}
            >
              {accountActions}
            </div>
          </div>
        )}
      </header>

      <main className="flex-1 pt-16">
        <Outlet />
      </main>
    </div>
  )
}
