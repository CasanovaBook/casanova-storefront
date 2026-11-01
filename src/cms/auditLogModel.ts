/**
 * Audit-log presentation model.
 *
 * Rows written before structured diffs carry legacy payloads: a plain array
 * of content keys, or a bare patch object of new values. Some rows predate
 * the budget-safe writer entirely and contain JSON that was sliced mid-string
 * and cannot be parsed. This module classifies every shape so the UI can
 * render a real diff when it exists and degrade honestly when it does not.
 */

import type { AuditDetail } from "@/maestro/core/types"
import type { IconName } from "@/components/icons"
import { formatIsraelDateParts } from "@/lib/datetime"

export interface ParsedNone {
  shape: "none"
}

export interface ParsedEnvelope {
  shape: "envelope"
  detail: AuditDetail
}

export interface ParsedKeyList {
  shape: "keylist"
  keys: string[]
}

export interface ParsedPatch {
  shape: "patch"
  fields: {
    key: string
    value: string
  }[]
}

export interface ParsedText {
  shape: "text"
  raw: string
}

export type ParsedDetail =
  | ParsedNone
  | ParsedEnvelope
  | ParsedKeyList
  | ParsedPatch
  | ParsedText

export function parseAuditDetail(detail?: string | null): ParsedDetail {
  if (!detail) return { shape: "none" }

  let parsed: unknown
  try {
    parsed = JSON.parse(detail)
  } catch {
    return { shape: "text", raw: detail }
  }

  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const obj = parsed as Partial<AuditDetail>
    if (
      obj.v === 1 &&
      Array.isArray(obj.changes) &&
      (obj.kind === "record" || obj.kind === "content")
    ) {
      return { shape: "envelope", detail: obj as AuditDetail }
    }
    const fields = Object.entries(parsed as Record<string, unknown>).map(
      ([key, value]) => ({
        key,
        value:
          typeof value === "object" && value !== null
            ? JSON.stringify(value)
            : String(value ?? ""),
      }),
    )
    return fields.length
      ? { shape: "patch", fields }
      : { shape: "text", raw: detail }
  }

  if (Array.isArray(parsed) && parsed.every((k) => typeof k === "string")) {
    return { shape: "keylist", keys: parsed as string[] }
  }

  return { shape: "text", raw: detail }
}

/** One-line summary for the table's פרטים cell - never raw JSON noise. */
export function describeDetail(detail?: string | null): string {
  const parsed = parseAuditDetail(detail)
  switch (parsed.shape) {
    case "none":
      return "ללא פרטים"
    case "envelope": {
      const content = parsed.detail.kind === "content"
      const shown = parsed.detail.changes.length
      const total = parsed.detail.total ?? shown
      if (total > shown)
        return `${shown} ${content ? "מפתחות" : "שדות"} מתוך ${total}`
      if (total === 1) return content ? "מפתח אחד" : "שדה אחד"
      return `${total} ${content ? "מפתחות" : "שדות"}`
    }
    case "keylist":
      return parsed.keys.length === 1
        ? "מפתח אחד"
        : `${parsed.keys.length} מפתחות`
    case "patch":
      return parsed.fields.length === 1
        ? "שדה אחד"
        : `${parsed.fields.length} שדות`
    case "text":
      return parsed.raw.length > 90 ? `${parsed.raw.slice(0, 90)}…` : parsed.raw
  }
}

const CONTENT_KEY_PATTERN = /^[a-z0-9_-]+(\.[a-z0-9_-]+)+$/i

export function isContentKey(id?: string | null): boolean {
  return Boolean(id && CONTENT_KEY_PATTERN.test(id))
}

/** The writer labels multi-key rows "N keys"; render that as a Hebrew label. */
export function bulkKeysLabel(id?: string | null): string | null {
  const match = /^(\d+) keys$/.exec(id ?? "")
  return match ? `${match[1]} מפתחות` : null
}

export const ENTITY_LABELS: Record<string, string> = {
  content: "תוכן",
  products: "מוצרים",
  categories: "קטגוריות",
  cms_sections: "סקשנים",
  cms_pages: "דפים",
  cms_categories: "קטגוריות דפים",
  testimonials: "המלצות",
  faqs: "שאלות",
  coupons: "קופונים",
  orders: "הזמנות",
  users: "משתמשים",
  settings: "הגדרות",
  media: "מדיה",
  audit: "יומן",
}

export const ACTION_LABELS: Record<string, string> = {
  create: "יצירה",
  update: "עדכון",
  delete: "מחיקה",
  upsert: "שמירה",
  reset: "איפוס",
  import: "ייבוא",
  list: "קריאה",
  get: "קריאה",
}

export const ACTION_BADGE: Record<string, string> = {
  create: "app-badge--success",
  update: "app-badge--accent",
  delete: "app-badge--danger",
  upsert: "app-badge--accent",
  reset: "app-badge--warning",
  import: "app-badge--warning",
}

export const ACTION_ICON: Record<string, IconName> = {
  create: "checkCircle",
  update: "pen",
  delete: "trash",
  upsert: "layers",
  reset: "refresh",
  import: "upload",
}

export const DEFAULT_ACTION_ICON: IconName = "list"

export type DatePreset = "all" | "today" | "7d" | "custom"

/**
 * Day-granularity windowing over Israel-time dates. Comparing the `ymd`
 * strings lexicographically is exact for YYYY-MM-DD and sidesteps every
 * offset/DST calculation - the zone conversion already happened inside
 * `formatIsraelDateParts`.
 */
export function inDateWindow(
  created_at: string,
  preset: DatePreset,
  from: string,
  to: string,
): boolean {
  if (preset === "all") return true

  const parts = formatIsraelDateParts(created_at)
  if (!parts) return false

  if (preset === "today") {
    return (
      parts.ymd === (formatIsraelDateParts(new Date().toISOString())?.ymd ?? "")
    )
  }

  if (preset === "7d") {
    const cutoff =
      formatIsraelDateParts(new Date(Date.now() - 6 * 86_400_000).toISOString())
        ?.ymd ?? ""
    return parts.ymd >= cutoff
  }

  if (from && parts.ymd < from) return false
  if (to && parts.ymd > to) return false
  return true
}
