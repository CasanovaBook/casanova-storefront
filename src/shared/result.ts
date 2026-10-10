/* ─────────────────────────────────────────────────────────────
 * Shared application contract — the Result / ErrorCode / Actor / guard
 * vocabulary used across the service and infrastructure layers.
 *
 * Extracted verbatim from `src/lib/api.ts` (Phase 5B / Group A) so that
 * infrastructure modules (`supabase-*`, `content-storage`) can depend on
 * this small contract instead of importing the large `api.ts` service
 * module. Behaviour is intentionally unchanged: same codes, same
 * messages, same guard logic — this is a structural move only.
 * ───────────────────────────────────────────────────────────── */

import type { AdminRole, Role } from "../types"

import { can, ROLE_LABEL, type AdminPermission } from "../lib/permissions"

/* ── Result plumbing ──────────────────────────────────── */

export type ErrorCode = "UNAUTHENTICATED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION" | "CONFLICT" | "PROVIDER_NOT_CONFIGURED" | "STORAGE" | "ADMIN_PROTECTED"

export type Result<T = undefined> = { ok: true, data: T } | Failure

/** The failure branch on its own, so guards can return it for any `Result<T>`. */

export interface Failure {
  ok: false

  error: string

  code: ErrorCode
}

export function ok<T>(data: T): Result<T> {
  return { ok: true, data }
}

export function fail(code: ErrorCode, error: string): Failure {
  return { ok: false, code, error }
}

/* ── Principal ────────────────────────────────────────── */

export interface Actor {
  user_id: string

  name: string

  role: Role

  admin_role?: AdminRole
}

/** Shared by the sibling service modules so every write enforces the same policy. */

export function guard(
  actor: Actor | null,
  permission: AdminPermission,
): Failure | null {
  if (!actor)
    return fail("UNAUTHENTICATED", "יש להתחבר לחשבון מנהל כדי לבצע פעולה זו.")

  if (actor.role !== "ADMIN")
    return fail("FORBIDDEN", "הפעולה זמינה למנהלים בלבד.")

  if (!can(actor.admin_role, permission)) {
    const label = actor.admin_role ? ROLE_LABEL[actor.admin_role] : "לא מוגדר"

    return fail("FORBIDDEN", `לתפקיד "${label}" אין הרשאה לבצע פעולה זו.`)
  }

  return null
}
