import { Outlet, useNavigate } from "react-router"
import { useApp } from "../../context/AppContext"
import { useAdmin } from "../../context/AdminContext"
import { can, ROLE_LABEL, type AdminPermission } from "../../lib/permissions"
import { useEffect } from "react"
import Icon, { type IconName } from "../icons"
import ThemeToggle from "../ThemeToggle"
import SideNav, { type SideNavItem } from "./SideNav"

const navItems: {
  path: string
  label: string
  icon: IconName
  perm: AdminPermission
}[] = [
  { path: "/admin", label: "לוח בקרה", icon: "grid", perm: "dashboard" },
  { path: "/admin/users", label: "משתמשים", icon: "users", perm: "users" },
  { path: "/admin/access", label: "הרשאות גישה", icon: "key", perm: "access" },
  { path: "/admin/orders", label: "הזמנות", icon: "receipt", perm: "orders" },
  {
    path: "/admin/finance",
    label: "כספים וחשבוניות",
    icon: "money",
    perm: "finance",
  },
  {
    path: "/admin/products",
    label: "מוצרים ותוכן",
    icon: "box",
    perm: "products",
  },
  { path: "/admin/emails", label: "מיילים", icon: "mail", perm: "emails" },
  {
    path: "/admin/alerts",
    label: "התראות ותקלות",
    icon: "zap",
    perm: "alerts",
  },
  {
    path: "/admin/support",
    label: "פניות לקוחות",
    icon: "message",
    perm: "support",
  },
  { path: "/admin/audit", label: "יומן פעולות", icon: "list", perm: "audit" },
  {
    path: "/admin/security",
    label: "הגנת תוכן ואבטחה",
    icon: "shield",
    perm: "security",
  },
  {
    path: "/admin/settings",
    label: "הגדרות מערכת",
    icon: "settings",
    perm: "settings",
  },
]

/** Statuses that still need somebody to act on them. */
const OPEN_INQUIRY_STATUSES = [
  "NEW",
  "OPEN",
  "IN_PROGRESS",
  "WAITING_FOR_CUSTOMER",
] as const

export default function AdminLayout() {
  const { isAuthenticated, isAdmin, user, logout, bootstrapRequired, authReady } = useApp()
  const { adminRole, openAlerts, inquiries } = useAdmin()
  const navigate = useNavigate()

  useEffect(() => {
    document.documentElement.dataset.appShell = "true"
    return () => { delete document.documentElement.dataset.appShell }
  }, [])

  useEffect(() => {
    if (bootstrapRequired) {
      navigate("/setup", { replace: true })
      return
    }
    /* Wait for the first session lookup; see the note on `authReady`. */
    if (!authReady) return
    if (!isAuthenticated) {
      navigate("/login", { replace: true })
      return
    }
    if (!isAdmin) {
      navigate("/dashboard", { replace: true })
    }
  }, [bootstrapRequired, authReady, isAuthenticated, isAdmin, navigate])

  if (bootstrapRequired || !authReady || !isAuthenticated || !isAdmin) return null

  const openInquiries = inquiries.filter((i) =>
    (OPEN_INQUIRY_STATUSES as readonly string[]).includes(i.status),
  ).length

  /* Filtering the navigation is presentation only. Every page behind these
   * links re-checks the same permission, and the service layer checks it
   * again on each write, so a hand-edited URL cannot reach data the role
   * is not allowed to see. */
  const visibleNav: SideNavItem[] = navItems
    .filter((item) => can(adminRole, item.perm))
    .map((item) => ({
      path: item.path,
      label: item.label,
      icon: item.icon,
      badge:
        item.path === "/admin/alerts"
          ? openAlerts.length
          : item.path === "/admin/support"
            ? openInquiries
            : undefined,
    }))

  /* Maestro CMS is the single navigation entry to the content editor,
   * shown prominently for users with cms:edit_live permission. The path is
   * the editor's own index route, so the click lands directly in the CMS
   * shell (the /admin/cms redirect is left only for old bookmarks). */
  if (can(adminRole, "cms:edit_live")) {
    visibleNav.push({
      path: "/admin/cms/content-editor",
      label: "Maestro CMS",
      icon: "sparkles",
      variant: "cms",
      tag: "CMS",
    })
  }

  const secondaryItems: SideNavItem[] = [
    { path: "/dashboard", label: "לתצוגת לקוח", icon: "arrowRight" },
  ]

  const handleLogout = () => {
    logout()
    navigate("/")
  }

  return (
    <div className="app-shell flex flex-col lg:flex-row">
      <a href="#main" className="skip-link">
        דלג לתוכן הראשי
      </a>
      <SideNav
        items={visibleNav}
        secondaryItems={secondaryItems}
        chip={
          <span className="app-badge app-badge--danger">
            <Icon name="shield" size={11} /> אזור ניהול
          </span>
        }
        footer={
          <>
            <div className="app-nav-user">
              <div className="app-nav-avatar">
                {user?.first_name.charAt(0) || user?.email.charAt(0) || "?"}
              </div>
              <div className="min-w-0">
                <p className="app-nav-name">
                  {user?.first_name} {user?.last_name}
                </p>
                <p className="app-nav-meta">
                  {ROLE_LABEL[adminRole ?? "SUPER_ADMIN"]}
                </p>
              </div>
            </div>
            <div className="app-nav-actions">
              <span className="cv-theme-toggle">
                <ThemeToggle />
              </span>
              <button
                onClick={handleLogout}
                className="app-nav-logout"
              >
                <Icon name="logout" size={14} /> התנתקות
              </button>
            </div>
          </>
        }
      />

      <div className="app-content">
        <main id="main" className="app-main">
          <div className="app-page">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}
