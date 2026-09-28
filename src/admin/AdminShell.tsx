/**
 * Maestro Admin — shell layout.
 *
 * Reuses the Casanova SideNav so the CMS panel looks and feels like
 * the rest of the admin. Same dark theme, same gold accents, same
 * responsive drawer on mobile.
 */

import { Outlet, useNavigate } from "react-router";
import { useApp } from "@/context/AppContext";
import { ROLE_LABEL } from "@/lib/permissions";
import { AdminAuthGate } from "./auth";
import SideNav, { type SideNavItem } from "@/components/layout/SideNav";
import Icon from "@/components/icons";
import ThemeToggle from "@/components/ThemeToggle";
import { Toaster } from "./toast";

const NAV_ITEMS: SideNavItem[] = [
  { path: "/HOWAMANTREATSYOU", label: "לוח בקרה", icon: "grid" },
  { path: "/HOWAMANTREATSYOU/content", label: "עריכת תוכן", icon: "layers" },
  { path: "/HOWAMANTREATSYOU/pages", label: "עמודים וקטגוריות", icon: "bookOpen" },
  { path: "/HOWAMANTREATSYOU/backup", label: "גיבוי ושחזור", icon: "box" },
  { path: "/HOWAMANTREATSYOU/audit", label: "יומן שינויים", icon: "list" },
  { path: "/HOWAMANTREATSYOU/products", label: "מוצרים", icon: "target" },
  { path: "/HOWAMANTREATSYOU/media", label: "מדיה", icon: "inbox" },
  { path: "/HOWAMANTREATSYOU/settings", label: "הגדרות", icon: "settings" },
];

export function AdminShell() {
  return (
    <AdminAuthGate>
      <MaestroLayout />
    </AdminAuthGate>
  );
}

function MaestroLayout() {
  const { user, logout } = useApp();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate("/");
  };

  return (
    <div
      className="min-h-screen flex flex-col lg:flex-row"
      style={{ background: "var(--color-background)" }}
    >
      <Toaster />
      <SideNav
        items={NAV_ITEMS}
        secondaryItems={[
          { path: "/admin", label: "חזרה לניהול", icon: "arrowRight" },
        ]}
        chip={
          <span
            className="inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-0.5 rounded-full"
            style={{ background: "rgba(227,174,60,0.15)", color: "var(--color-primary)" }}
          >
            <Icon name="layers" size={12} /> Maestro CMS
          </span>
        }
        footer={
          <>
            <div className="flex items-center gap-3 mb-3 px-3">
              <div
                className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold shadow-md flex-shrink-0"
                style={{
                  background: "linear-gradient(135deg, var(--color-primary), var(--color-accent))",
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
                >
                  {ROLE_LABEL[user?.admin_role ?? "SUPER_ADMIN"]}
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
  );
}
