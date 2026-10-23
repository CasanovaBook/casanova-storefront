/**
 * Maestro Admin — authentication gate.
 *
 * Uses the Casanova admin session directly (SSO). No separate Maestro login.
 * Any admin with cms:edit_live permission can access the CMS editor.
 */

import { useEffect, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { useApp } from "@/context/AppContext";
import { can } from "@/lib/permissions";
import EmptyState from "@/components/ui/EmptyState";

/** Shown when a logged-in Casanova user doesn't have cms:edit_live permission. */
function AccessDenied() {
  const { user, logout } = useApp();

  return (
    <div
      className="app-shell flex min-h-screen items-center justify-center p-4"
      dir="rtl"
    >
      <div className="app-page app-page--narrow">
        <EmptyState
          icon="lock"
          title="אין הרשאה לגישה"
          description={
            <>
              עריכת תוכן האתר ב־Maestro מוגבלת למנהלי המערכת בלבד.
              {user?.email ? (
                <span className="mt-2 block text-xs" dir="ltr">
                  {user.email}
                </span>
              ) : null}
            </>
          }
          actions={
            <button
              type="button"
              onClick={() => {
                logout();
                window.location.href = "/login";
              }}
              className="app-btn-secondary"
            >
              התנתקות
            </button>
          }
        />
      </div>
    </div>
  );
}

export function AdminAuthGate({ children }: { children: ReactNode }) {
  const { user, isAuthenticated, authReady, isAdmin, adminRole } = useApp();
  const navigate = useNavigate();

  /* Wait for the first session lookup; see the note on `authReady`. */
  useEffect(() => {
    if (authReady && !isAuthenticated) {
      navigate("/login", { replace: true });
    }
  }, [authReady, isAuthenticated, navigate]);

  if (!authReady || !isAuthenticated) {
    return null;
  }

  /* Second authorization layer: the router gate already refused entry
   * before this component loaded (platform ADMIN role + cms:edit_live).
   * Re-checking here keeps the editor safe even if someone renders it
   * under a different route later. */
  const hasAccess = isAdmin && user?.role === "ADMIN" && can(adminRole, "cms:edit_live");
  if (!hasAccess) {
    return <AccessDenied />;
  }

  return <>{children}</>;
}
