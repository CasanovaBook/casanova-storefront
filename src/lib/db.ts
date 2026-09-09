/* ─────────────────────────────────────────────────────────────
 * Persistence driver — the single storage boundary of the app.
 *
 * Everything the platform knows lives in one versioned database
 * document. Nothing is seeded: a fresh install is genuinely empty
 * and every screen renders an empty state until real records are
 * created through the CMS or the storefront.
 *
 * The driver is deliberately the only module that touches
 * `localStorage`. `src/lib/api.ts` is the service layer on top of it
 * and is shaped like the REST surface it will eventually call, so
 * moving to a real HTTP backend means replacing this file's
 * `readDocument` / `writeDocument` pair with fetch calls — no page or
 * context has to change.
 * ───────────────────────────────────────────────────────────── */

import type {
  AdminSubscription,
  AuditLogEntry,
  Category,
  CmsSection,
  CmsSectionItem,
  ContentGrant,
  Coupon,
  CrmLead,
  CrmNote,
  CrmTask,
  DeviceSession,
  DrmPolicy,
  EmailLog,
  FaqItem,
  Inquiry,
  InquiryNote,
  Invoice,
  Order,
  PasswordReset,
  Payment,
  PlatformSettings,
  Product,
  ReadingProgress,
  Refund,
  SecurityEvent,
  StoredUser,
  Testimonial,
  UserProduct,
} from "../types"

export const DB_KEY = "casanova_db_v1"

const DB_VERSION = 1

/**
 * Upper bound on the protection-event log.
 *
 * Events are raised by client code a visitor controls, so the
 * collection has to be bounded or a single open reader tab could grow
 * it until the storage quota fails and real writes start being lost.
 * Oldest entries are dropped first.
 */

export const SECURITY_EVENT_LIMIT = 400

/** Upper bound on minted content grants; oldest settled rows go first. */

export const CONTENT_GRANT_LIMIT = 200

/** Storage keys used by previous prototype builds. Cleared on first run. */

const LEGACY_KEYS = ["eliteread_cms_v2", "eliteread_admin_v2", "rp_user"]

export interface Database {
  version: number

  settings: PlatformSettings

  users: StoredUser[]

  categories: Category[]

  products: Product[]

  orders: Order[]

  payments: Payment[]

  refunds: Refund[]

  invoices: Invoice[]

  user_products: UserProduct[]

  reading_progress: ReadingProgress[]

  password_resets: PasswordReset[]

  subscriptions: AdminSubscription[]

  inquiries: Inquiry[]

  inquiry_notes: InquiryNote[]

  crm_leads: CrmLead[]

  crm_tasks: CrmTask[]

  crm_notes: CrmNote[]

  email_logs: EmailLog[]

  audit_log: AuditLogEntry[]

  coupons: Coupon[]

  sections: CmsSection[]

  testimonials: Testimonial[]

  faqs: FaqItem[]

  drm_policies: DrmPolicy[]

  device_sessions: DeviceSession[]

  security_events: SecurityEvent[]

  /**
   * Short-lived permissions to fetch a protected file, mirroring
   * content_access_grants in schema.sql. Bounded like security_events:
   * a reader left open mints one per session, so without a cap the
   * collection grows forever in a store that has a quota.
   */

  content_grants: ContentGrant[]

  dismissed_alerts: string[]

  /** Per-entity counters backing human-readable references. */

  sequences: Record<string, number>
}

/**
 * The copy-protection policy a fresh install starts with.
 *
 * This is configuration, not content: like `defaultSettings()` it exists
 * so the platform is protected by default instead of relying on an
 * administrator remembering to switch DRM on before the first sale. It
 * carries no catalogue, customer or revenue data of any kind.
 */

export function defaultDrmPolicy(): DrmPolicy {
  const at = new Date(0).toISOString()

  return {
    policy_id: "drp_default",

    policy_name: "מדיניות ברירת מחדל",

    applies_to: "ALL",

    block_screenshots: true,

    block_screen_recording: true,

    hide_content_on_blur: true,

    block_copy: true,

    block_print: true,

    block_download: true,

    allow_offline: false,

    offline_ttl_hours: null,

    block_rooted_devices: true,

    watermark_enabled: true,

    watermark_template: "{name} · {email}",

    watermark_opacity: 0.07,

    max_devices_per_user: 3,

    session_timeout_minutes: 120,

    active: true,

    created_at: at,

    updated_at: at,
  }
}

export function defaultSettings(): PlatformSettings {
  return {
    brand_name: "Casanova",

    default_currency: "ILS",

    invoice_prefix: "INV",

    order_prefix: "CNV",

    inquiry_prefix: "INQ",

    payment_provider: null,

    email_provider: null,

    refund_execution_enabled: false,

    max_upload_bytes: 10_485_760,

    mobile_app_enabled: true,

    mobile_min_build: 0,

    /* The site-copy fields (tagline, trust_badges, catalogue_*, pricing_*,
     * footer_text) are deliberately absent rather than defaulted. A fresh
     * install therefore carries no marketing copy at all, and nothing
     * invented can reach a visitor before an editor writes it in the CMS. */

    updated_at: new Date(0).toISOString(),
  }
}

/** An empty database. No demo records of any kind. */

export function emptyDatabase(): Database {
  return {
    version: DB_VERSION,

    settings: defaultSettings(),

    users: [],

    categories: [],

    products: [],

    orders: [],

    payments: [],

    refunds: [],

    invoices: [],

    user_products: [],

    reading_progress: [],

    password_resets: [],

    subscriptions: [],

    inquiries: [],

    inquiry_notes: [],

    crm_leads: [],

    crm_tasks: [],

    crm_notes: [],

    email_logs: [],

    audit_log: [],

    coupons: [],

    sections: [],

    testimonials: [],

    faqs: [],

    drm_policies: [defaultDrmPolicy()],

    device_sessions: [],

    security_events: [],

    content_grants: [],

    dismissed_alerts: [],

    sequences: {},
  }
}

/* ── Storage transport ─────────────────────────────────── */

/**
 * Fills protection fields a document written by an older build lacks.
 *
 * This is not cosmetic. A policy row persisted before `block_download`
 * existed would arrive with the field `undefined`, which is falsy, which
 * every reader would treat as "downloads are allowed" — an upgrade would
 * silently switch off a protection nobody chose to switch off. Missing
 * deterrents therefore default to the strictest value, and a missing
 * offline setting defaults to off.
 */

function withProtectionDefaults(policies: unknown[]): DrmPolicy[] {
  const baseline = defaultDrmPolicy()

  return policies.map((raw) => {
    const p = raw as Partial<DrmPolicy>

    return {
      ...baseline,

      ...p,

      block_download: p.block_download ?? true,

      allow_offline: p.allow_offline ?? false,

      offline_ttl_hours: p.allow_offline ? (p.offline_ttl_hours ?? null) : null,

      block_rooted_devices: p.block_rooted_devices ?? true,
    } as DrmPolicy
  })
}

/** Same rule for the device registry: an unknown verdict stays unknown. */

function withSessionDefaults(sessions: unknown[]): DeviceSession[] {
  return sessions.map((raw) => {
    const s = raw as Partial<DeviceSession>

    return {
      ...s,

      device_integrity: s.device_integrity ?? "UNKNOWN",

      revoked: s.revoked ?? false,

      secure_flag_active: s.secure_flag_active ?? true,
    } as DeviceSession
  })
}

/**
 * Fills section fields added after the first schema version.
 *
 * `page` defaults to 'HOME' so legacy rows (written before the sales
 * page existed) keep publishing to the storefront landing. `items`
 * defaults to an empty array and every item is guaranteed an `item_id`
 * so the admin repeater can address them without defensive null checks.
 */

function withSectionDefaults(sections: unknown[]): CmsSection[] {
  return sections.map((raw) => {
    const s = raw as Partial<CmsSection>

    const items: CmsSectionItem[] = (s.items ?? []).map((it) => {
      const i = it as Partial<CmsSectionItem>

      return {
        item_id: i.item_id ?? uid("it"),

        title: i.title ?? "",

        content: i.content ?? "",

        group: i.group,
      }
    })

    return {
      ...s,

      page: s.page ?? "HOME",

      items,
    } as CmsSection
  })
}

function readDocument(): Database {
  const base = emptyDatabase()

  try {
    const raw = localStorage.getItem(DB_KEY)

    if (!raw) return base

    const parsed = JSON.parse(raw) as Partial<Database>

    // Merge key-by-key so a document written by an older build can never

    // silently inject records that no longer exist in the schema, and a

    // missing collection can never fall back to fabricated content.

    const merged = { ...base } as Database

    ;(Object.keys(base) as (keyof Database)[]).forEach((key) => {
      const value = parsed[key]

      if (value === undefined || value === null) return

      if (key === "settings") {
        merged.settings = {
          ...base.settings,
          ...value as Partial<PlatformSettings>,
        }
      } else if (key === "sequences") {
        merged.sequences = { ...value as Record<string, number> }
      } else if (key === "drm_policies" && Array.isArray(value)) {
        merged.drm_policies = withProtectionDefaults(value)
      } else if (key === "device_sessions" && Array.isArray(value)) {
        merged.device_sessions = withSessionDefaults(value)
      } else if (key === "sections" && Array.isArray(value)) {
        merged.sections = withSectionDefaults(value)
      } else if (Array.isArray(value)) {
        (merged[key] as unknown[]) = (value as unknown[])
      }
    })

    merged.version = DB_VERSION

    return merged
  } catch {
    return base
  }
}

function writeDocument(db: Database): void {
  try {
    localStorage.setItem(DB_KEY, JSON.stringify(db))
  } catch (err) {
    // Quota exceeded is a real operational failure (large data-URL assets);

    // surface it instead of pretending the write succeeded.

    console.error("[db] persistence failed", err)

    throw new Error("STORAGE_QUOTA_EXCEEDED")
  }
}

/* ── Reactive store ────────────────────────────────────── */

type Listener = (db: Database) => void

let cache: Database | null = null

const listeners = new Set<Listener>()

let legacyCleared = false

function ensureLoaded(): Database {
  if (!legacyCleared) {
    legacyCleared = true

    LEGACY_KEYS.forEach((k) => localStorage.removeItem(k))
  }

  if (!cache) cache = readDocument()

  return cache
}

export function getDb(): Database {
  return ensureLoaded()
}

/** Runs a mutation, persists it and notifies subscribers. */

export function mutate<T>(fn: (draft: Database) => T): T {
  const db = ensureLoaded()

  const next: Database = { ...db }

  const result = fn(next)

  cache = next

  writeDocument(next)

  listeners.forEach((l) => l(next))

  return result
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener)

  return () => listeners.delete(listener)
}

/** Keeps multiple open tabs on the same document. */

export function initCrossTabSync(): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key !== DB_KEY) return

    cache = readDocument()

    listeners.forEach((l) => l(cache as Database))
  }

  window.addEventListener("storage", onStorage)

  return () => window.removeEventListener("storage", onStorage)
}

/** Wipes every record. Used by the CMS "clear all data" action. */

export function resetDatabase(): void {
  cache = emptyDatabase()

  writeDocument(cache)

  listeners.forEach((l) => l(cache as Database))
}

/* ── Identifiers & sequences ───────────────────────────── */

export function uid(prefix: string): string {
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10)

  return `${prefix}_${Date.now().toString(36)}${rand}`
}

/**
 * Monotonic per-entity counter backing human-readable references such
 * as `CNV-2026-0001`. Increments must happen inside `mutate()`.
 */

export function nextSequence(db: Database, key: string): number {
  const current = db.sequences[key] ?? 0

  const next = current + 1

  db.sequences = { ...db.sequences, [key]: next }

  return next
}

export function nowIso(): string {
  return new Date().toISOString()
}

export function slugify(input: string): string {
  return input

    .trim()

    .toLowerCase()

    .replace(/[\u0590-\u05FF]/g, (ch) => HEBREW_SLUG[ch] ?? ch)

    .replace(/[^a-z0-9]+/g, "-")

    .replace(/^-+|-+$/g, "")

    .slice(0, 60)
}

/** Minimal Hebrew transliteration so book slugs stay URL-safe. */

const HEBREW_SLUG: Record<string, string> = {
  א: "a",
  ב: "b",
  ג: "g",
  ד: "d",
  ה: "h",
  ו: "v",
  ז: "z",
  ח: "ch",
  ט: "t",

  י: "y",
  כ: "k",
  ך: "k",
  ל: "l",
  מ: "m",
  ם: "m",
  נ: "n",
  ן: "n",
  ס: "s",

  ע: "e",
  פ: "p",
  ף: "p",
  צ: "ts",
  ץ: "ts",
  ק: "k",
  ר: "r",
  ש: "sh",
  ת: "t",

  "׳": "",
  "״": "",
}

/** Produces a slug that is not yet taken within a collection. */

export function uniqueSlug(
  base: string,
  taken: string[],
  fallbackPrefix = "item",
): string {
  const root = slugify(base) || `${fallbackPrefix}-${Date.now().toString(36)}`

  if (!taken.includes(root)) return root

  let n = 2

  while (taken.includes(`${root}-${n}`)) n += 1

  return `${root}-${n}`
}
