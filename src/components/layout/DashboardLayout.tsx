import { Outlet, useNavigate } from "react-router"
import { useApp } from "../../context/AppContext"
import { useEffect } from "react"
import Icon from "../icons"
import ThemeToggle from "../ThemeToggle"
import SideNav from "./SideNav"
import { loadContent } from "../../content/store"

const navItems = [
  { path: "/dashboard", label: "סקירה כללית", icon: "home" as const },
  {
    path: "/dashboard/library",
    label: "הספרייה שלי",
    icon: "library" as const,
  },
  { path: "/dashboard/store", label: "החנות", icon: "bag" as const },
]

export default function DashboardLayout() {
  const { isAuthenticated, authReady, user, logout } = useApp()
  const navigate = useNavigate()

  /* `authReady` gates the check. Redirecting while the first session lookup
   * is still in flight bounced a just-verified user straight to /login. */
  useEffect(() => {
    if (authReady && !isAuthenticated) navigate("/login", { replace: true })
  }, [authReady, isAuthenticated, navigate])

  // Load fresh content from the database for logged-in users.
  useEffect(() => {
    loadContent().catch(() => {})
  }, [])

  useEffect(() => {
    document.documentElement.dataset.appShell = "true"
    return () => { delete document.documentElement.dataset.appShell }
  }, [])

  if (!authReady || !isAuthenticated) return null

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
        items={navItems}
        secondaryItems={[
          /* Dashboard-scoped so navigation stays inside this layout -
           * /support (public) unmounts the sidebar along with it. */
          { path: "/dashboard/support", label: "תמיכה ופניות", icon: "message" },
        ]}
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
                <p className="app-nav-meta" dir="ltr">
                  {user?.email}
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
          <div className="app-page app-page--content">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}
