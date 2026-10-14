/* ─────────────────────────────────────────────────────────────
 * Notifications service — transactional email logging.
 *
 * Extracted verbatim from `src/lib/api.ts` (Phase 5B / Group B).
 * Behaviour is unchanged: without a configured provider the message is
 * queued, never marked as sent.
 * ───────────────────────────────────────────────────────────── */

import type { EmailLog } from "../types"

import { getDb, mutate, nowIso, uid } from "../data/db"

import {
  fail,
  guard,
  ok,
  type Actor,
  type ErrorCode,
  type Result,
} from "../shared/result"

import { writeAudit } from "./audit"

/* ── Transactional email ──────────────────────────────── */

export interface EmailInput {
  recipient: string

  recipient_name?: string

  template: string

  subject: string

  related_type?: EmailLog["related_type"]

  related_id?: string
}

/**
 * Records an outgoing message. Without a configured provider the
 * message is queued, never marked as sent — the admin panel must not
 * claim a delivery that did not happen.
 */

export function dispatchEmail(input: EmailInput): EmailLog {
  const provider = getDb().settings.email_provider

  return mutate((db) => {
    const log: EmailLog = {
      email_log_id: uid("eml"),

      recipient: input.recipient,

      recipient_name: input.recipient_name,

      template: input.template,

      subject: input.subject,

      status: "QUEUED",

      sent_at: nowIso(),

      related_type: input.related_type,

      related_id: input.related_id,

      failure_reason: provider
        ? undefined
        : "לא הוגדר ספק שליחת מיילים — ההודעה ממתינה בתור.",
    }

    db.email_logs = [log, ...db.email_logs]

    return log
  })
}

export function listEmailLogs(actor: Actor | null) {
  const denied = guard(actor, "emails")

  if (denied) return denied

  return ok(getDb().email_logs)
}

export function resendEmail(
  actor: Actor | null,
  emailLogId: string,
): Result<EmailLog> {
  const denied = guard(actor, "resend_email")

  if (denied) return denied

  const db = getDb()

  const existing = db.email_logs.find((e) => e.email_log_id === emailLogId)

  if (!existing) return fail("NOT_FOUND", "המייל לא נמצא.")

  const provider = db.settings.email_provider

  const updated = mutate((d) => {
    const next: EmailLog = {
      ...existing,

      status: "QUEUED",

      sent_at: nowIso(),

      failure_reason: provider
        ? undefined
        : "לא הוגדר ספק שליחת מיילים — ההודעה ממתינה בתור.",
    }

    d.email_logs = d.email_logs.map((e) =>
      e.email_log_id === emailLogId ? next : e,
    )

    return next
  })

  writeAudit(actor, {
    category: "EMAIL_RESEND",

    action: "שליחת מייל מחדש",

    target_type: "EMAIL",

    target_id: emailLogId,

    target_label: existing.recipient,

    details: existing.subject,
  })

  return ok(updated)
}
