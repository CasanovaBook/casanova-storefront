import type { AdminRole } from "../types"

/**
 * Role-Based Access Control for the Casanova admin panel.
 *
 * `can(role, permission)` is used in two places on purpose:
 *   1. by the layout and pages, to avoid rendering actions a role may not run;
 *   2. by every mutating function in `src/lib/api.ts`, which refuses the
 *      operation regardless of what the UI showed.
 *
 * Hiding a button is cosmetic — the service layer check is the one that
 * actually enforces the policy. When this app moves to a real backend the
 * same permission strings become the server-side authorization claims.
 */

export type AdminPermission = /* Pages / nav */

"dashboard" | "products" | "cms" | "users" | "access" | "orders" | "finance" | "emails" | "alerts" | "audit" | "crm" | "support" | "settings" | "security" | /* Sensitive actions */

"refund" | "execute_refund" | "mark_paid" | "edit_order" | "grant_access" | "edit_price" | "edit_content" | "delete_product" | "block_user" | "resend_email" | "manage_roles" | "manage_support" | "manage_drm" | /* Maestro CMS */

"cms:edit_live"

export const ADMIN_ROLES: AdminRole[] = [
  "SUPER_ADMIN",
  "SUPPORT",
  "FINANCE",
  "CONTENT",
  "MARKETING",
]

export const ROLE_LABEL: Record<AdminRole, string> = {
  SUPER_ADMIN: "סופר אדמין",

  SUPPORT: "תמיכה",

  FINANCE: "כספים",

  CONTENT: "מנהל תוכן",

  MARKETING: "שיווק",
}

export const ROLE_DESCRIPTION: Record<AdminRole, string> = {
  SUPER_ADMIN: "גישה מלאה לכל המערכות והפעולות, כולל הגנת תוכן ואבטחת מידע.",

  SUPPORT: "פניות לקוחות, משתמשים, הרשאות גישה, הזמנות, מיילים והתראות.",

  FINANCE: "הזמנות, תשלומים, חשבוניות, החזרים, קופונים ומנויים.",

  CONTENT: "ניהול מוצרים, ספרים, תוכן, קבצים ותמונות.",

  MARKETING: "CMS, קמפיינים, קופונים, מיילים ו־CRM.",
}

const SUPER: AdminPermission[] = [
  "dashboard",

  "products",

  "cms",

  "users",

  "access",

  "orders",

  "finance",

  "emails",

  "alerts",

  "audit",

  "crm",

  "support",

  "settings",

  "security",

  "refund",

  "execute_refund",

  "mark_paid",

  "edit_order",

  "grant_access",

  "edit_price",

  "edit_content",

  "delete_product",

  "block_user",

  "resend_email",

  "manage_roles",

  "manage_support",

  "manage_drm",

  "cms:edit_live",
]

export const ROLE_PERMISSIONS: Record<AdminRole, AdminPermission[]> = {
  SUPER_ADMIN: SUPER,

  SUPPORT: [
    "dashboard",

    "users",

    "access",

    "orders",

    "emails",

    "alerts",

    "crm",

    "support",

    "manage_support",

    "grant_access",

    "block_user",

    "resend_email",

    "cms:edit_live",
  ],

  FINANCE: [
    "dashboard",

    "orders",

    "finance",

    "alerts",

    "support",

    "refund",

    "execute_refund",

    "mark_paid",

    "edit_order",

    "edit_price",

    "cms:edit_live",
  ],

  CONTENT: ["dashboard", "products", "cms", "edit_price", "edit_content", "cms:edit_live"],

  MARKETING: [
    "dashboard",
    "cms",
    "crm",
    "finance",
    "emails",
    "resend_email",
    "support",
    "cms:edit_live",
  ],
}

export function can(
  role: AdminRole | undefined,
  permission: AdminPermission,
): boolean {
  if (!role) return false

  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false
}

export function permissionsFor(role: AdminRole): AdminPermission[] {
  return ROLE_PERMISSIONS[role] ?? []
}
