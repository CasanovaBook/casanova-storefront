/* ─────────────────────────────────────────────────────────────
 * Alerts service - dismissal bookkeeping for derived system alerts.
 *
 * Extracted verbatim from `src/lib/api.ts` (Phase 5B / Group B).
 * Behaviour is unchanged.
 * ───────────────────────────────────────────────────────────── */

import { getDb, mutate } from "../data/db"

import { guard, ok, type Actor, type Result } from "../shared/result"

/* ── Alerts bookkeeping ───────────────────────────────── */

export function listDismissedAlerts(): string[] {
  return getDb().dismissed_alerts
}

export function dismissAlert(actor: Actor | null, alertId: string): Result {
  const denied = guard(actor, "alerts")

  if (denied) return denied

  mutate((db) => {
    if (!db.dismissed_alerts.includes(alertId))
      db.dismissed_alerts = [...db.dismissed_alerts, alertId]
  })

  return ok(undefined)
}

export function reinstateAlert(actor: Actor | null, alertId: string): Result {
  const denied = guard(actor, "alerts")

  if (denied) return denied

  mutate((db) => {
    db.dismissed_alerts = db.dismissed_alerts.filter((a) => a !== alertId)
  })

  return ok(undefined)
}
