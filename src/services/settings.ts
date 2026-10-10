/* ─────────────────────────────────────────────────────────────
 * Settings service — platform configuration read/write.
 *
 * Extracted verbatim from `src/lib/api.ts` (Phase 5B / Group B).
 * Behaviour is unchanged.
 * ───────────────────────────────────────────────────────────── */

import type { PlatformSettings } from "../types"

import { getDb, mutate, nowIso } from "../data/db"

import { guard, ok, type Actor, type Result } from "../shared/result"

import { writeAudit } from "./audit"

/* ── Platform settings ────────────────────────────────── */

export function getSettings(): PlatformSettings {
  return getDb().settings
}

export function updateSettings(
  actor: Actor | null,
  patch: Partial<PlatformSettings>,
): Result<PlatformSettings> {
  const denied = guard(actor, "settings")

  if (denied) return denied

  const next = mutate((db) => {
    db.settings = {
      ...db.settings,
      ...patch,
      updated_at: nowIso(),
      updated_by: actor?.name,
    }

    return db.settings
  })

  const changed = Object.keys(patch).filter(
    (k) => k !== "updated_at" && k !== "updated_by",
  )

  writeAudit(actor, {
    category: "SETTINGS",

    action: "עדכון הגדרות פלטפורמה",

    target_type: "SETTINGS",

    target_id: "platform",

    target_label: "הגדרות",

    details: changed.join(", ") || "—",
  })

  return ok(next)
}
