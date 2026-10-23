/**
 * Maestro Admin — shell layout.
 *
 * Reuses the Casanova SideNav so the CMS panel looks and feels like
 * the rest of the admin. Same dark theme, same gold accents, same
 * responsive drawer on mobile.
 */

import { useEffect } from "react";
import { Outlet, useNavigate } from "react-router";
import { useApp } from "@/context/AppContext";
import { ROLE_LABEL } from "@/lib/permissions";
import { AdminAuthGate } from "./auth";
import SideNav, { type SideNavItem } from "@/components/layout/SideNav";
import Icon from "@/components/icons";
import ThemeToggle from "@/components/ThemeToggle";
import { Toaster } from "./toast";

const NAV_ITEMS: SideNavItem[] = [
  { path: "/admin/cms/content-editor", label: "לוח בקרה", icon: "grid" },
  { path: "/admin/cms/content-editor/content", label: "עריכת תוכן", icon: "layers" },
  { path: "/admin/cms/content-editor/pages", label: "עמודים וקטגוריות", icon: "bookOpen" },
  { path: "/admin/cms/content-editor/backup", label: "גיבוי ושחזור", icon: "box" },
  { path: "/admin/cms/content-editor/audit", label: "יומן שינויים", icon: "list" },
  { path: "/admin/cms/content-editor/products", label: "מוצרים", icon: "target" },
  { path: "/admin/cms/content-editor/media", label: "מדיה", icon: "inbox" },
  { path: "/admin/cms/content-editor/settings", label: "הגדרות", icon: "settings" },
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

  useEffect(() => {
    document.documentElement.dataset.appShell = "true";
    return () => { delete document.documentElement.dataset.appShell; };
  }, []);

  const handleLogout = () => {
    logout();
    navigate("/");
  };

  return (
    <div className="app-shell flex flex-col lg:flex-row">
      <Toaster />
      <a href="#main" className="skip-link">
        דלג לתוכן הראשי
      </a>
      <SideNav
        items={NAV_ITEMS}
        brandHref="/admin/cms/content-editor"
        accent="cms"
        navLabel="מצב עריכת תוכן"
        secondaryItems={[
          { path: "/admin", label: "חזרה לניהול", icon: "arrowRight" },
        ]}
        chip={
          <span className="app-badge app-badge--accent">
            <Icon name="layers" size={11} /> Maestro CMS
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
                  {ROLE_LABEL[user?.admin_role ?? "SUPER_ADMIN"]}
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
  );
}
