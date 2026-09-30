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
  { path: "/admin/cms/content-editor", label: "CMS — עריכת תוכן", icon: "layers", perm: "cms" },
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
  { path: "/admin/crm", label: "CRM ולקוחות", icon: "target", perm: "crm" },
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

  /* Add Maestro CMS link prominently for users with cms:edit_live permission. */
  if (can(adminRole, "cms:edit_live")) {
    const cmsIndex = visibleNav.findIndex((item) => item.path === "/admin/cms/content-editor");
    const maestroItem: SideNavItem = { path: "/admin/cms/content-editor", label: "Maestro CMS", icon: "sparkles" };
    if (cmsIndex >= 0) {
      visibleNav.splice(cmsIndex + 1, 0, maestroItem);
    } else {
      visibleNav.push(maestroItem);
    }
  }

  const secondaryItems: SideNavItem[] = [
    { path: "/dashboard", label: "לתצוגת לקוח", icon: "arrowRight" },
  ]

  const handleLogout = () => {
    logout()
    navigate("/")
  }

  return (
    <div
      className="min-h-screen flex flex-col lg:flex-row"
      style={{ background: "var(--color-background)" }}
    >
      <SideNav
        items={visibleNav}
        secondaryItems={secondaryItems}
        chip={
          <span
            className="inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-0.5 rounded-full"
            style={{ background: "rgba(239,68,68,0.15)", color: "#F87171" }}
          >
            <Icon name="zap" size={12} /> אזור ניהול
          </span>
        }
        footer={
          <>
            <div className="flex items-center gap-3 mb-3 px-3">
              <div
                className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold shadow-md flex-shrink-0"
                style={{
                  background: "linear-gradient(135deg, #EF4444, #B91C1C)",
                  color: "#fff",
                }}
              >
                {user?.first_name.charAt(0)}
              </div>
              <div className="flex-1 min-w-0">
                <p
                  className="text-xs font-bold truncate"
                  style={{ color: "var(--color-foreground)" }}
                >
                  {user?.first_name} {user?.last_name}
                </p>
                <p
                  className="text-xs truncate"
                  style={{ color: "var(--color-muted-foreground)" }}
                >
                  {ROLE_LABEL[adminRole ?? "SUPER_ADMIN"]}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <ThemeToggle />
              <button
                onClick={handleLogout}
                className="tap-target flex-1 flex items-center gap-2 text-right text-xs px-3 py-2 rounded-lg transition-colors hover:bg-white/5"
                style={{ color: "var(--color-muted-foreground)" }}
              >
                <Icon name="logout" size={14} /> התנתקות
              </button>
            </div>
          </>
        }
      />

      <div className="flex-1 min-w-0 lg:mr-60">
        <main className="min-h-screen p-4 sm:p-6 lg:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
