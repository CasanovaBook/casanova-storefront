import { useEffect, useRef, useState, type ReactNode } from "react"
import { Link, useLocation } from "react-router"
import Icon, { type IconName } from "../icons"
import AccessibilityFooterLink from "../accessibility/AccessibilityFooterLink"
import logoImg from "../../assets/casanova-portrait.webp"
import { useContent } from "../../content/useContent"

export interface SideNavItem {
  path: string
  label: string
  icon: IconName
  badge?: number
  variant?: "default" | "cms"
  tag?: string
}

interface SideNavProps {
  items: SideNavItem[]
  secondaryItems?: SideNavItem[]
  chip?: ReactNode
  footer: ReactNode
  brandHref?: string
  accent?: "cms"
  navLabel?: string
}

/**
 * Shared navigation rail for the customer and admin shells.
 *
 * The rail is a fixed dark surface in both themes; only content surfaces
 * follow the cream/dark theme switch. On mobile it becomes a modal drawer
 * with a focus trap, Escape dismissal and a scrim. The closed drawer is
 * made non-focusable with visibility, not just translated off-screen.
 */
export default function SideNav({
  items,
  secondaryItems,
  chip,
  footer,
  brandHref = "/",
  accent,
  navLabel,
}: SideNavProps) {
  const isCmsMode = accent === "cms"
  const [open, setOpen] = useState(false)
  const location = useLocation()
  const panelRef = useRef<HTMLElement | null>(null)
  const menuButtonRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    setOpen(false)
  }, [location.pathname])

  useEffect(() => {
    if (!open) return

    const panel = panelRef.current
    if (!panel) return

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"

    const focusable = () =>
      Array.from(
        panel.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => element.getAttribute("aria-hidden") !== "true")

    const closeButton = panel.querySelector<HTMLElement>(".app-nav-close")
    ;(closeButton ?? focusable()[0])?.focus()

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault()
        setOpen(false)
        return
      }

      if (event.key !== "Tab") return

      const itemsInPanel = focusable()
      if (itemsInPanel.length === 0) return

      const first = itemsInPanel[0]
      const last = itemsInPanel[itemsInPanel.length - 1]

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
  }, [open])

  const renderLink = (item: SideNavItem) => {
    const active = location.pathname === item.path
    const cms = item.variant === "cms"

    return (
      <Link
        key={item.path}
        to={item.path}
        aria-current={active ? "page" : undefined}
        className={`app-nav-link${active ? " is-active" : ""}${cms ? " is-cms" : ""}`}
      >
        <Icon name={item.icon} size={17} />
        <span className="app-nav-link-label">{item.label}</span>
        {item.tag && <span className="app-nav-tag">{item.tag}</span>}
        {item.badge !== undefined && item.badge > 0 && (
          <span className="app-nav-badge">{item.badge}</span>
        )}
      </Link>
    )
  }

  const c = useContent()
  const brandName = c("global.brand") || "Casanova"
  const logoSrc = c("global.logo") || logoImg

  const brand = (
    <Link to={brandHref} className="app-nav-brand">
      <img src={logoSrc} alt="" />
      <span dir="ltr" lang="en">
        {brandName}
      </span>
    </Link>
  )

  return (
    <>
      <div className="app-mobile-topbar">
        {brand}
        <button
          ref={menuButtonRef}
          type="button"
          className="app-mobile-menu-btn"
          onClick={() => setOpen(true)}
          aria-label="פתיחת תפריט ניווט"
          aria-expanded={open}
          aria-controls="app-side-nav"
        >
          <Icon name="menu" size={18} />
        </button>
      </div>

      {open && (
        <div
          className="app-drawer-scrim"
          onClick={() => setOpen(false)}
          aria-hidden="true"
        />
      )}

      <aside
        ref={panelRef}
        id="app-side-nav"
        data-open={open}
        className={`app-sidebar drawer-panel${isCmsMode ? " is-cms" : ""}`}
        aria-label="ניווט ראשי"
        role={open ? "dialog" : undefined}
        aria-modal={open ? true : undefined}
      >
        <div className="app-nav-brand-row">
          <div className="min-w-0">
            {brand}
            {chip && <div className="mt-2">{chip}</div>}
          </div>
          <button
            type="button"
            className="app-nav-close"
            onClick={() => setOpen(false)}
            aria-label="סגירת תפריט"
          >
            <Icon name="x" size={17} />
          </button>
        </div>

        <nav className="app-nav-list" aria-label="ניווט ראשי">
          {navLabel && <p className="app-nav-label">{navLabel}</p>}
          {items.map(renderLink)}

          {secondaryItems && secondaryItems.length > 0 && (
            <div className="app-nav-secondary">
              {secondaryItems.map(renderLink)}
            </div>
          )}
        </nav>

        <div className="app-nav-footer">
          {footer}
          <div className="app-nav-a11y">
            <AccessibilityFooterLink className="text-xs" />
          </div>
        </div>
      </aside>
    </>
  )
}
