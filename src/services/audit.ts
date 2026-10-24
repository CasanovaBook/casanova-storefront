/* ─────────────────────────────────────────────────────────────
 * Audit service - the admin activity log.
 *
 * Extracted verbatim from `src/lib/api.ts` (Phase 5B / Group B). This is
 * a foundational service: many other service modules call `writeAudit`
 * after a mutation. Behaviour is unchanged.
 * ───────────────────────────────────────────────────────────── */

import type { AuditCategory } from "../types"

import { getDb, mutate, nowIso, uid } from "../data/db"

import { guard, ok, type Actor } from "../shared/result"

/* ── Audit ────────────────────────────────────────────── */

export interface AuditInput {
  category: AuditCategory

  action: string

  target_type: string

  target_id: string

  target_label: string

  details: string
}

/**
 * Writes an audit entry. Called from inside already-authorized service
 * functions, so it performs no permission check of its own.
 */

export function writeAudit(actor: Actor | null, entry: AuditInput): void {
  mutate((db) => {
    db.audit_log = [
      {
        audit_id: uid("aud"),

        actor_id: actor?.user_id ?? "system",

        actor_name: actor?.name ?? "מערכת",

        actor_role: actor?.admin_role ?? actor?.role ?? "SYSTEM",

        category: entry.category,

        action: entry.action,

        target_type: entry.target_type,

        target_id: entry.target_id,

        target_label: entry.target_label,

        details: entry.details,

        created_at: nowIso(),
      },

      ...db.audit_log,
    ]
  })
}

export function listAudit(actor: Actor | null) {
  const denied = guard(actor, "audit")

  if (denied) return denied

  return ok(getDb().audit_log)
}
