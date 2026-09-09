import { Outlet, useNavigate } from "react-router"
import { useApp } from "../../context/AppContext"
import { useEffect } from "react"
import Icon from "../icons"
import ThemeToggle from "../ThemeToggle"
import SideNav from "./SideNav"

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
  const { isAuthenticated, user, logout } = useApp()
  const navigate = useNavigate()

  useEffect(() => {
    if (!isAuthenticated) navigate("/login", { replace: true })
  }, [isAuthenticated, navigate])

  if (!isAuthenticated) return null

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
        items={navItems}
        secondaryItems={[
          { path: "/support", label: "תמיכה ופניות", icon: "message" },
        ]}
        footer={
          <>
            <div className="flex items-center gap-3 mb-3 px-3">
              <div
                className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold shadow-md flex-shrink-0"
                style={{
                  background: "linear-gradient(135deg, #E7B94C, #B8862A)",
                  color: "var(--color-primary-foreground)",
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
                  dir="ltr"
                >
                  {user?.email}
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

      {/* Main content */}
      <div className="flex-1 min-w-0 lg:mr-60">
        <main className="min-h-screen p-4 sm:p-6 lg:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
