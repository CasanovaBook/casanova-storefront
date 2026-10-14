/* ─────────────────────────────────────────────────────────────
 * CRM service — leads, tasks and notes.
 *
 * Extracted verbatim from `src/lib/api.ts` (Phase 5B / Group B,
 * increment 2). Behaviour is unchanged: same permission guard, same
 * validation, same Hebrew messages, same audit events, same mutation
 * semantics. Uses the shared Result contract and the extracted audit
 * service rather than `api.ts`.
 * ───────────────────────────────────────────────────────────── */

import type {
  CrmLead,
  CrmNote,
  CrmTask,
  LeadStage,
  NoteCategory,
} from "../types"

import { getDb, mutate, nowIso, uid } from "../data/db"

import { fail, guard, ok, type Actor, type Result } from "../shared/result"

import { isEmail } from "../lib/auth"

import { writeAudit } from "./audit"

export function listLeads(): CrmLead[] {
  return getDb().crm_leads
}

export function listCrmTasks(): CrmTask[] {
  return getDb().crm_tasks
}

export function listCrmNotes(): CrmNote[] {
  return getDb().crm_notes
}

export function saveLead(
  actor: Actor | null,

  data: Omit<CrmLead, "lead_id" | "created_at" | "notes_count"> & {
    lead_id?: string
  },

  id?: string,
): Result<CrmLead> {
  const denied = guard(actor, "crm")

  if (denied) return denied

  if (!data.full_name.trim() || !isEmail(data.email))
    return fail("VALIDATION", "שם מלא וכתובת מייל תקינה הם שדות חובה.")

  const saved = mutate((db) => {
    if (id) {
      const next = {
        ...db.crm_leads.find((l) => l.lead_id === id) as CrmLead,
        ...data,
        lead_id: id,
      }

      db.crm_leads = db.crm_leads.map((l) => (l.lead_id === id ? next : l))

      return next
    }

    const created: CrmLead = {
      ...data,
      lead_id: uid("lead"),
      notes_count: 0,
      created_at: nowIso(),
    }

    db.crm_leads = [created, ...db.crm_leads]

    return created
  })

  return ok(saved)
}

export function setLeadStage(
  actor: Actor | null,
  leadId: string,
  stage: LeadStage,
): Result {
  const denied = guard(actor, "crm")

  if (denied) return denied

  const lead = getDb().crm_leads.find((l) => l.lead_id === leadId)

  if (!lead) return fail("NOT_FOUND", "הליד לא נמצא.")

  mutate((db) => {
    db.crm_leads = db.crm_leads.map((l) =>
      l.lead_id === leadId ? { ...l, stage, last_contact_at: nowIso() } : l,
    )
  })

  writeAudit(actor, {
    category: "OTHER",

    action: "עדכון שלב ליד",

    target_type: "LEAD",

    target_id: leadId,

    target_label: lead.full_name,

    details: `${lead.stage} → ${stage}`,
  })

  return ok(undefined)
}

export function addLeadNote(
  actor: Actor | null,

  leadId: string,

  content: string,

  category: NoteCategory = "GENERAL",
): Result<CrmNote> {
  const denied = guard(actor, "crm")

  if (denied) return denied

  if (!content.trim()) return fail("VALIDATION", "תוכן ההערה חובה.")

  const lead = getDb().crm_leads.find((l) => l.lead_id === leadId)

  if (!lead) return fail("NOT_FOUND", "הליד לא נמצא.")

  const note = mutate((db) => {
    const created: CrmNote = {
      note_id: uid("cnote"),

      lead_id: leadId,

      category,

      content: content.trim(),

      created_at: nowIso(),

      author: actor?.name ?? "מערכת",
    }

    db.crm_notes = [created, ...db.crm_notes]

    db.crm_leads = db.crm_leads.map((l) =>
      l.lead_id === leadId
        ? {
            ...l,
            notes_count: l.notes_count + 1,
            last_contact_at: created.created_at,
          }
        : l,
    )

    return created
  })

  return ok(note)
}

export function deleteLead(actor: Actor | null, leadId: string): Result {
  const denied = guard(actor, "crm")

  if (denied) return denied

  mutate((db) => {
    db.crm_leads = db.crm_leads.filter((l) => l.lead_id !== leadId)

    db.crm_notes = db.crm_notes.filter((n) => n.lead_id !== leadId)

    db.crm_tasks = db.crm_tasks.filter((t) => t.lead_id !== leadId)
  })

  return ok(undefined)
}

export function saveTask(
  actor: Actor | null,

  data: Omit<CrmTask, "task_id"> & { task_id?: string },

  id?: string,
): Result<CrmTask> {
  const denied = guard(actor, "crm")

  if (denied) return denied

  if (!data.title.trim()) return fail("VALIDATION", "כותרת המשימה חובה.")

  const saved = mutate((db) => {
    if (id) {
      const next = {
        ...db.crm_tasks.find((t) => t.task_id === id) as CrmTask,
        ...data,
        task_id: id,
      }

      db.crm_tasks = db.crm_tasks.map((t) => (t.task_id === id ? next : t))

      return next
    }

    const created: CrmTask = { ...data, task_id: uid("task") }

    db.crm_tasks = [created, ...db.crm_tasks]

    return created
  })

  return ok(saved)
}

export function toggleTask(actor: Actor | null, taskId: string): Result {
  const denied = guard(actor, "crm")

  if (denied) return denied

  mutate((db) => {
    db.crm_tasks = db.crm_tasks.map((t) =>
      t.task_id === taskId ? { ...t, done: !t.done } : t,
    )
  })

  return ok(undefined)
}

export function deleteTask(actor: Actor | null, taskId: string): Result {
  const denied = guard(actor, "crm")

  if (denied) return denied

  mutate((db) => {
    db.crm_tasks = db.crm_tasks.filter((t) => t.task_id !== taskId)
  })

  return ok(undefined)
}
