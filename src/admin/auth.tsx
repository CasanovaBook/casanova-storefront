/**
 * Maestro Admin — authentication gate.
 *
 * Uses the Casanova admin session directly (SSO). No separate Maestro login.
 * Any admin with cms:edit_live permission can access the CMS editor.
 */

import { useEffect, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { useApp } from "@/context/AppContext";
import { can, ROLE_LABEL } from "@/lib/permissions";
import Icon from "@/components/icons";

/** Shown when a logged-in Casanova user doesn't have cms:edit_live permission. */
function AccessDenied() {
  const { user, logout } = useApp();

  return (
    <div
      className="flex min-h-screen items-center justify-center"
      dir="rtl"
      style={{ background: "var(--color-background)" }}
    >
      <div
        className="w-full max-w-sm rounded-2xl p-8 text-center shadow-lg"
        style={{ background: "var(--color-card)", border: "1px solid var(--color-border)" }}
      >
        <div
          className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full"
          style={{ background: "rgba(239,68,68,0.12)", color: "var(--color-danger)" }}
        >
          <Icon name="lock" size={28} />
        </div>
        <h2 className="mb-2 text-xl font-bold" style={{ color: "var(--color-foreground)" }}>
          אין הרשאה לגישה
        </h2>
        <p className="mb-4 text-sm" style={{ color: "var(--color-muted-foreground)" }}>
          עריכת תוכן האתר ב־Maestro מוגבלת למנהלי המערכת בלבד.
        </p>
        <p className="mb-6 text-xs" style={{ color: "var(--color-muted-foreground)", opacity: 0.6 }}>
          מחובר כ-{user?.first_name} {user?.last_name} ({user?.email})
        </p>
        <button
          onClick={() => {
            logout();
            window.location.href = "/login";
          }}
          className="rounded-full px-6 py-2 text-sm font-medium transition-colors"
          style={{
            border: "1px solid var(--color-border)",
            color: "var(--color-muted-foreground)",
            background: "var(--color-secondary)",
          }}
        >
          התנתקות
        </button>
      </div>
    </div>
  );
}

export function AdminAuthGate({ children }: { children: ReactNode }) {
  const { user, isAuthenticated, authReady, isAdmin, adminRole, logout } = useApp();
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

  return (
    <div>
      <div
        className="flex items-center justify-between px-4 py-2 text-sm"
        style={{
          background: "var(--color-card)",
          borderBottom: "1px solid var(--color-border)",
        }}
      >
        <span className="flex items-center gap-2" style={{ color: "var(--color-muted-foreground)" }}>
          <Icon name="sparkles" size={14} />
          מחובר כ-<strong style={{ color: "var(--color-foreground)" }}>{user?.email}</strong>
          {adminRole && (
            <span
              className="rounded-full px-2 py-0.5 text-xs font-bold"
              style={{ background: "rgba(227,174,60,0.15)", color: "var(--color-primary)" }}
            >
              {ROLE_LABEL[adminRole]}
            </span>
          )}
        </span>
        <button
          onClick={() => {
            logout();
            window.location.href = "/";
          }}
          className="flex items-center gap-1 text-xs transition-opacity hover:opacity-70"
          style={{ color: "var(--color-danger)" }}
        >
          <Icon name="logout" size={12} />
          התנתק
        </button>
      </div>
      {children}
    </div>
  );
}
