import { useEffect, useState, type ReactNode } from "react"

import { Link, useLocation } from "react-router"

import Icon, { type IconName } from "../icons"

import logoImg from "../../../images/main_photo.jpg"

/**
 * Shared side navigation for the signed-in shells.
 *
 * Both the customer dashboard and the admin panel used to hardcode a
 * permanently fixed 240px column, which left no room for content on a
 * phone and made neither usable by touch. This component renders the
 * same navigation three ways instead:
 *
 *   • `lg` and up — a static column, with the content offset to match;
 *   • below `lg` — a compact top bar with a menu button that slides the
 *     column in over a scrim;
 *   • either way — targets at least 44px tall and an active-route cue
 *     that does not depend on hover.
 *
 * The drawer closes itself on navigation and on Escape, and body scroll
 * is locked while it is open so the page behind cannot drift.
 */

export interface SideNavItem {
  path: string

  label: string

  icon: IconName

  /** Unresolved count shown as a badge; omitted or zero renders nothing. */

  badge?: number
}

interface SideNavProps {
  items: SideNavItem[]

  /** Rendered below a divider — cross-context links such as "לתצוגת לקוח". */

  secondaryItems?: SideNavItem[]

  /** Small status chip under the wordmark, e.g. the admin-zone marker. */

  chip?: ReactNode

  /** Account block and theme control, rendered in the panel footer. */

  footer: ReactNode
}

export default function SideNav({
  items,
  secondaryItems,
  chip,
  footer,
}: SideNavProps) {
  const [open, setOpen] = useState(false)

  const location = useLocation()

  // Navigating from the drawer must not leave it covering the new screen.

  useEffect(() => {
    setOpen(false)
  }, [location.pathname])

  useEffect(() => {
    if (!open) return

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false)
    }

    window.addEventListener("keydown", onKey)

    const previousOverflow = document.body.style.overflow

    document.body.style.overflow = "hidden"

    return () => {
      window.removeEventListener("keydown", onKey)

      document.body.style.overflow = previousOverflow
    }
  }, [open])

  const renderLink = (item: SideNavItem) => {
    const active = location.pathname === item.path

    return (
      <Link
        key={item.path}
        to={item.path}
        aria-current={active ? "page" : undefined}
        className="tap-target flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium transition-all"
        style={{
          background: active
            ? "linear-gradient(90deg, rgba(212,160,48,0.16), rgba(212,160,48,0.05))"
            : "transparent",

          color: active
            ? "var(--color-primary)"
            : "var(--color-muted-foreground)",

          boxShadow: active ? "inset 2px 0 0 var(--color-primary)" : "none",
        }}
      >
        <Icon name={item.icon} size={18} className="flex-shrink-0" />
        <span className="flex-1 truncate">{item.label}</span>
        {item.badge !== undefined && item.badge > 0 && (
          <span
            className="min-w-5 h-5 px-1.5 rounded-full text-[10px] font-bold flex items-center justify-center"
            style={{ background: "#EF4444", color: "#fff" }}
          >
            {item.badge}
          </span>
        )}
      </Link>
    )
  }

  const brand = (
    <Link to="/" className="flex items-center gap-2.5">
      <img
        src={logoImg}
        alt="Casanova"
        className="w-8 h-8 rounded-lg object-cover"
      />
      <span
        dir="ltr"
        className="font-display text-lg font-bold tracking-wide"
        style={{ color: "var(--color-primary)" }}
      >
        Casanova
      </span>
    </Link>
  )

  return (
    <>
      {/* Compact top bar — the only navigation affordance below `lg`. */}
      <div
        className="safe-top lg:hidden sticky top-0 z-40 flex items-center gap-3 px-4 h-14 border-b"
        style={{
          background: "var(--color-card)",
          borderColor: "var(--color-border)",
        }}
      >
        <button
          onClick={() => setOpen(true)}
          className="tap-target flex items-center justify-center rounded-lg border"
          style={{
            borderColor: "var(--color-border)",
            color: "var(--color-foreground)",
          }}
          aria-label="פתיחת תפריט ניווט"
          aria-expanded={open}
        >
          <Icon name="menu" size={18} />
        </button>
        {brand}
      </div>

      {/* Scrim — tap to dismiss. Hidden at `lg`, where the panel is static. */}
      {open && (
        <div
          className="drawer-scrim fixed inset-0 z-40 lg:hidden"
          onClick={() => setOpen(false)}
          aria-hidden="true"
        />
      )}

      <aside
        data-open={open}
        className="drawer-panel safe-bottom fixed top-0 right-0 h-full w-60 max-w-[85vw] border-l flex flex-col z-50"
        style={{
          background: "var(--color-card)",
          borderColor: "var(--color-border)",
        }}
        aria-label="ניווט ראשי"
      >
        <div
          className="p-6 border-b flex items-start justify-between gap-2"
          style={{ borderColor: "var(--color-border)" }}
        >
          <div className="min-w-0">
            {brand}
            {chip && <div className="mt-2">{chip}</div>}
          </div>
          <button
            onClick={() => setOpen(false)}
            className="tap-target flex items-center justify-center rounded-lg lg:hidden"
            style={{ color: "var(--color-muted-foreground)" }}
            aria-label="סגירת תפריט"
          >
            <Icon name="x" size={17} />
          </button>
        </div>

        <nav className="flex-1 p-4 space-y-1.5 overflow-y-auto overscroll-contain">
          {items.map((item) => renderLink(item))}

          {secondaryItems && secondaryItems.length > 0 && (
            <div
              className="pt-4 border-t mt-4"
              style={{ borderColor: "var(--color-border)" }}
            >
              {secondaryItems.map((item) => renderLink(item))}
            </div>
          )}
        </nav>

        <div
          className="p-4 border-t"
          style={{ borderColor: "var(--color-border)" }}
        >
          {footer}
        </div>
      </aside>
    </>
  )
}
