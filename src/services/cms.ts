/* ─────────────────────────────────────────────────────────────
 * CMS service - editable content sections, testimonials, FAQs, and
 * catalog/content backup & restore.
 *
 * Extracted verbatim from `src/lib/api.ts` (Phase 5B / Group B).
 * Behaviour is unchanged: same guard, same validation messages, same
 * ordering/mutation semantics, same backup scope (content + catalog only,
 * never orders/customers).
 * ───────────────────────────────────────────────────────────── */

import type {
  CmsBackup,
  CmsSection,
  FaqItem,
  Testimonial,
} from "../types"

import { getDb, mutate, nowIso, uid } from "../data/db"

import { fail, guard, ok, type Actor, type Result } from "../shared/result"

import { writeAudit } from "./audit"

/* ── CMS content ──────────────────────────────────────── */

export function listSections(): CmsSection[] {
  return [...getDb().sections].sort((a, b) => a.display_order - b.display_order)
}

export function saveSection(
  actor: Actor | null,

  data: Omit<CmsSection, "section_id" | "display_order" | "updated_at">,

  id?: string,
): Result<CmsSection> {
  const denied = guard(actor, "cms")

  if (denied) return denied

  if (!data.title.trim()) return fail("VALIDATION", "כותרת הסקטור חובה.")

  const saved = mutate((db) => {
    if (id) {
      const next = {
        ...db.sections.find((s) => s.section_id === id) as CmsSection,
        ...data,
        updated_at: nowIso(),
      }

      db.sections = db.sections.map((s) => (s.section_id === id ? next : s))

      return next
    }

    const nextOrder =
      db.sections.reduce((max, s) => Math.max(max, s.display_order), 0) + 1

    const created: CmsSection = {
      ...data,
      section_id: uid("sec"),
      display_order: nextOrder,
      updated_at: nowIso(),
    }

    db.sections = [...db.sections, created]

    return created
  })

  return ok(saved)
}

export function deleteSection(actor: Actor | null, id: string): Result {
  const denied = guard(actor, "cms")

  if (denied) return denied

  mutate((db) => {
    db.sections = db.sections.filter((s) => s.section_id !== id)
  })

  return ok(undefined)
}

export function toggleSection(actor: Actor | null, id: string): Result {
  const denied = guard(actor, "cms")

  if (denied) return denied

  mutate((db) => {
    db.sections = db.sections.map((s) =>
      s.section_id === id
        ? { ...s, active: !s.active, updated_at: nowIso() }
        : s,
    )
  })

  return ok(undefined)
}

export function moveSection(
  actor: Actor | null,
  id: string,
  direction: -1 | 1,
): Result {
  const denied = guard(actor, "cms")

  if (denied) return denied

  const sorted = listSections()

  const idx = sorted.findIndex((s) => s.section_id === id)

  const swap = idx + direction

  if (idx < 0 || swap < 0 || swap >= sorted.length) return ok(undefined)

  const aOrder = sorted[idx].display_order

  const bOrder = sorted[swap].display_order

  mutate((db) => {
    db.sections = db.sections.map((s) =>
      s.section_id === sorted[idx].section_id
        ? {
            ...s,
            display_order: bOrder === aOrder ? aOrder + direction : bOrder,
          }
        : s.section_id === sorted[swap].section_id
          ? { ...s, display_order: aOrder }
          : s,
    )
  })

  return ok(undefined)
}

export function listTestimonials(): Testimonial[] {
  return [...getDb().testimonials].sort(
    (a, b) => a.display_order - b.display_order,
  )
}

export function saveTestimonial(
  actor: Actor | null,

  data: Omit<Testimonial, "testimonial_id" | "display_order">,

  id?: string,
): Result<Testimonial> {
  const denied = guard(actor, "cms")

  if (denied) return denied

  if (!data.quote.trim() || !data.name.trim())
    return fail("VALIDATION", "ציטוט ושם הם שדות חובה.")

  const saved = mutate((db) => {
    if (id) {
      const next = {
        ...db.testimonials.find((t) => t.testimonial_id === id) as Testimonial,
        ...data,
      }

      db.testimonials = db.testimonials.map((t) =>
        t.testimonial_id === id ? next : t,
      )

      return next
    }

    const nextOrder =
      db.testimonials.reduce((max, t) => Math.max(max, t.display_order), 0) + 1

    const created = {
      ...data,
      testimonial_id: uid("tst"),
      display_order: nextOrder,
    }

    db.testimonials = [...db.testimonials, created]

    return created
  })

  return ok(saved)
}

export function deleteTestimonial(actor: Actor | null, id: string): Result {
  const denied = guard(actor, "cms")

  if (denied) return denied

  mutate((db) => {
    db.testimonials = db.testimonials.filter((t) => t.testimonial_id !== id)
  })

  return ok(undefined)
}

export function listFaqs(): FaqItem[] {
  return [...getDb().faqs].sort((a, b) => a.display_order - b.display_order)
}

export function saveFaq(
  actor: Actor | null,

  data: Omit<FaqItem, "faq_id" | "display_order">,

  id?: string,
): Result<FaqItem> {
  const denied = guard(actor, "cms")

  if (denied) return denied

  if (!data.question.trim()) return fail("VALIDATION", "שאלה חובה.")

  const saved = mutate((db) => {
    if (id) {
      const next = {
        ...db.faqs.find((f) => f.faq_id === id) as FaqItem,
        ...data,
      }

      db.faqs = db.faqs.map((f) => (f.faq_id === id ? next : f))

      return next
    }

    const nextOrder =
      db.faqs.reduce((max, f) => Math.max(max, f.display_order), 0) + 1

    const created = { ...data, faq_id: uid("faq"), display_order: nextOrder }

    db.faqs = [...db.faqs, created]

    return created
  })

  return ok(saved)
}

export function deleteFaq(actor: Actor | null, id: string): Result {
  const denied = guard(actor, "cms")

  if (denied) return denied

  mutate((db) => {
    db.faqs = db.faqs.filter((f) => f.faq_id !== id)
  })

  return ok(undefined)
}

/* ── CMS backup / restore ─────────────────────────────── */

export function exportCmsBackup(actor: Actor | null): Result<CmsBackup> {
  const denied = guard(actor, "cms")

  if (denied) return denied

  const db = getDb()

  return ok({
    backed_up_at: nowIso(),

    sections: db.sections,

    products: db.products,

    categories: db.categories,

    testimonials: db.testimonials,

    faqs: db.faqs,
  })
}

/** Restores catalog and content only. Orders, refunds and customers are never touched. */

export function restoreCmsBackup(
  actor: Actor | null,
  backup: Partial<CmsBackup>,
): Result {
  const denied = guard(actor, "cms")

  if (denied) return denied

  if (!backup || typeof backup !== "object")
    return fail("VALIDATION", "קובץ הגיבוי אינו תקין.")

  mutate((db) => {
    if (Array.isArray(backup.sections)) db.sections = backup.sections

    if (Array.isArray(backup.products)) db.products = backup.products

    if (Array.isArray(backup.categories)) db.categories = backup.categories

    if (Array.isArray(backup.testimonials))
      db.testimonials = backup.testimonials

    if (Array.isArray(backup.faqs)) db.faqs = backup.faqs
  })

  writeAudit(actor, {
    category: "OTHER",

    action: "שחזור גיבוי CMS",

    target_type: "CMS",

    target_id: "backup",

    target_label: backup.backed_up_at ?? "-",

    details: "התוכן והקטלוג שוחזרו מקובץ גיבוי",
  })

  return ok(undefined)
}
