/* ─────────────────────────────────────────────────────────────
 * Content-protection service layer.
 *
 * Owns three things the reader and the CMS both depend on:
 *   1. the copy-protection policy (what deterrents are in force),
 *   2. the device registry (how many devices one account may read on),
 *   3. the protection-event log (what the deterrents actually caught).
 *
 * Two different kinds of caller use this module, so two different
 * checks appear below. Policy administration and reading the event log
 * are staff operations and go through `guard(actor, 'security')`.
 * Registering a device and reporting a blocked capture are customer
 * operations — they require an authenticated principal but no admin
 * role, and they are the only writes here a customer can reach.
 *
 * Honest limits, stated once so nobody over-trusts the result:
 * a browser cannot prevent a photograph of a screen, and a fingerprint
 * computed in that same browser can be forged. What this layer
 * delivers is attribution (every capture carries the buyer's identity)
 * and a practical cap on spreading one purchase across devices. Real
 * device identity and real key exchange need a native reader plus a
 * backend that signs per-session content keys.
 * ───────────────────────────────────────────────────────────── */

import type {
  ContentGrant,
  ContentGrantScope,
  DevicePlatform,
  DeviceSession,
  DrmPolicy,
  DrmScope,
  SecurityEvent,
  SecurityEventType,
  UserProduct,
} from "../types"

import {
  CONTENT_GRANT_LIMIT,
  SECURITY_EVENT_LIMIT,
  defaultDrmPolicy,
  getDb,
  mutate,
  nowIso,
  uid,
} from "./db"

import {
  fail,
  guard,
  ok,
  writeAudit,
  type Actor,
  type Failure,
  type Result,
} from "./api"

import { fetchSignedContentUrl } from "./content-storage"

import { isSupabaseConfigured } from "./supabase"

/* ── Policy resolution ────────────────────────────────── */

/**
 * Picks the governing policy out of a set.
 *
 * Exported separately from `activeDrmPolicy` so React can resolve the
 * policy from a store snapshot and re-render when an administrator edits
 * it, instead of reading the database once at mount.
 */

export function resolveDrmPolicy(
  policies: DrmPolicy[],
  scope: DrmScope = "WEB",
): DrmPolicy {
  const active = policies.filter((p) => p.active)

  return (
    active.find((p) => p.applies_to === scope) ??
    active.find((p) => p.applies_to === "ALL") ??
    defaultDrmPolicy()
  )
}

/**
 * The policy in force for a given client.
 *
 * Resolution is most-specific-first: an active policy scoped exactly to
 * the client wins over one scoped to `ALL`. When every policy has been
 * deactivated the built-in defaults are returned rather than "no
 * protection" — switching protection off is done by editing the flags on
 * an active policy, which is a deliberate, audited act. The CMS says so
 * out loud so nobody discovers it by accident.
 */

export function activeDrmPolicy(scope: DrmScope = "WEB"): DrmPolicy {
  return resolveDrmPolicy(getDb().drm_policies, scope)
}

export function listDrmPolicies(actor: Actor | null): Result<DrmPolicy[]> {
  const denied = guard(actor, "security")

  if (denied) return denied

  return ok(getDb().drm_policies)
}

export type DrmPolicyInput = Omit<DrmPolicy, "policy_id" | "created_at" | "updated_at">

/** Clamps numeric policy fields into the range the schema allows. */

function normalizePolicy(data: DrmPolicyInput): DrmPolicyInput {
  const allowOffline = Boolean(data.allow_offline)

  return {
    ...data,

    policy_name: data.policy_name.trim(),

    watermark_template: data.watermark_template.trim() || "{name} · {email}",

    watermark_opacity: Math.min(
      0.4,
      Math.max(0.01, Number(data.watermark_opacity) || 0.07),
    ),

    max_devices_per_user: Math.min(
      50,
      Math.max(1, Math.floor(data.max_devices_per_user) || 1),
    ),

    session_timeout_minutes: Math.min(
      43_200,
      Math.max(1, Math.floor(data.session_timeout_minutes) || 1),
    ),

    block_download: Boolean(data.block_download),

    block_rooted_devices: Boolean(data.block_rooted_devices),

    allow_offline: allowOffline,

    /* chk_drm_offline_needs_ttl in schema.sql rejects an offline policy with
     * no TTL, so the client refuses it first rather than failing on save. */

    offline_ttl_hours: allowOffline
      ? Math.min(
          720,
          Math.max(1, Math.floor(Number(data.offline_ttl_hours) || 0)),
        )
      : null,
  }
}

function policyProblem(data: DrmPolicyInput, ignoreId?: string): string | null {
  if (!data.policy_name) return "שם המדיניות חובה."

  const db = getDb()

  if (
    db.drm_policies.some(
      (p) => p.policy_name === data.policy_name && p.policy_id !== ignoreId,
    )
  ) {
    return `כבר קיימת מדיניות בשם "${data.policy_name}".`
  }

  if (data.watermark_enabled && !data.watermark_template) {
    return "יש להגדיר טקסט חותמת כאשר סימון מזהה מופעל."
  }

  if (data.allow_offline && !(Number(data.offline_ttl_hours) > 0)) {
    return "קריאה לא מקוונת מחייבת הגדרת משך שמירה בשעות. עותק בלי תפוגה הוא הורדה לצמיתות."
  }

  if (
    !data.active &&
    db.drm_policies.filter((p) => p.active && p.policy_id !== ignoreId)
      .length === 0
  ) {
    return "זו המדיניות הפעילה האחרונה. ניתן לערוך אותה או לכבות בתוכה דגלים בודדים, אך לא להשאיר את המערכת ללא מדיניות מוגדרת."
  }

  return null
}

export function saveDrmPolicy(
  actor: Actor | null,
  data: DrmPolicyInput,
  id?: string,
): Result<DrmPolicy> {
  const denied = guard(actor, "manage_drm")

  if (denied) return denied

  const next = normalizePolicy(data)

  const problem = policyProblem(next, id)

  if (problem) return fail("VALIDATION", problem)

  const saved = mutate((db) => {
    if (id) {
      const current = db.drm_policies.find((p) => p.policy_id === id)

      if (!current) return null

      const updated: DrmPolicy = { ...current, ...next, updated_at: nowIso() }

      db.drm_policies = db.drm_policies.map((p) =>
        p.policy_id === id ? updated : p,
      )

      return updated
    }

    const created: DrmPolicy = {
      ...next,

      policy_id: uid("drp"),

      created_at: nowIso(),

      updated_at: nowIso(),
    }

    db.drm_policies = [...db.drm_policies, created]

    return created
  })

  if (!saved) return fail("NOT_FOUND", "המדיניות לא נמצאה.")

  writeAudit(actor, {
    category: "SECURITY",

    action: id ? "עדכון מדיניות הגנת תוכן" : "יצירת מדיניות הגנת תוכן",

    target_type: "DRM_POLICY",

    target_id: saved.policy_id,

    target_label: saved.policy_name,

    details: describePolicy(saved),
  })

  return ok(saved)
}

export function deleteDrmPolicy(actor: Actor | null, id: string): Result {
  const denied = guard(actor, "manage_drm")

  if (denied) return denied

  const db = getDb()

  const target = db.drm_policies.find((p) => p.policy_id === id)

  if (!target) return fail("NOT_FOUND", "המדיניות לא נמצאה.")

  if (target.active && db.drm_policies.filter((p) => p.active).length === 1) {
    return fail(
      "CONFLICT",
      "לא ניתן למחוק את המדיניות הפעילה היחידה. יש לכבות אותה או למחוק מדיניות אחרת.",
    )
  }

  mutate((draft) => {
    draft.drm_policies = draft.drm_policies.filter((p) => p.policy_id !== id)
  })

  writeAudit(actor, {
    category: "SECURITY",

    action: "מחיקת מדיניות הגנת תוכן",

    target_type: "DRM_POLICY",

    target_id: id,

    target_label: target.policy_name,

    details: describePolicy(target),
  })

  return ok(undefined)
}

/** Human-readable summary of a policy, used in the audit trail. */

function describePolicy(p: DrmPolicy): string {
  const on: string[] = []

  if (p.block_screenshots) on.push("חסימת צילום מסך")

  if (p.block_screen_recording) on.push("חסימת הקלטת מסך")

  if (p.hide_content_on_blur) on.push("הסתרה באיבוד מיקוד")

  if (p.block_copy) on.push("חסימת העתקה")

  if (p.block_print) on.push("חסימת הדפסה")

  if (p.block_download) on.push("חסימת הורדה ושיתוף")

  if (p.block_rooted_devices) on.push("חסימת מכשירים פרוצים")

  if (p.allow_offline) on.push(`קריאה לא מקוונת (${p.offline_ttl_hours} שע׳)`)

  if (p.watermark_enabled)
    on.push(`חותמת מזהה (${Math.round(p.watermark_opacity * 100)}%)`)

  return [
    `היקף: ${SCOPE_LABEL[p.applies_to]}`,

    on.length > 0 ? on.join(", ") : "ללא אמצעי הגנה פעילים",

    `מכשירים לכל משתמש: ${p.max_devices_per_user}`,

    `פג תוקף בחוסר פעילות: ${p.session_timeout_minutes} דק׳`,

    p.active ? "פעילה" : "כבויה",
  ].join(" · ")
}

export const SCOPE_LABEL: Record<DrmScope, string> = {
  WEB: "דפדפן",

  MOBILE: "אפליקציה ניידת",

  ALL: "כל הפלטפורמות",
}

/* ── Device registry ──────────────────────────────────── */

/** Coarse, stable browser characteristics — the honest ceiling for a client-only fingerprint. */

function deviceTraits(): string {
  const nav = typeof navigator === "undefined" ? undefined : navigator

  const screen_ = typeof screen === "undefined" ? undefined : screen

  let zone = ""

  try {
    zone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? ""
  } catch {
    zone = ""
  }

  return [
    nav?.userAgent ?? "",

    nav?.language ?? "",

    nav?.platform ?? "",

    screen_ ? `${screen_.width}x${screen_.height}x${screen_.colorDepth}` : "",

    zone,
  ].join("|")
}

/** FNV-1a — enough to turn the trait string into a short stable key. */

function digest(input: string): string {
  let hash = 0x811c9dc5

  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i)

    hash = Math.imul(hash, 0x01000193) >>> 0
  }

  return hash.toString(16).padStart(8, "0")
}

/**
 * Identifies this browser profile.
 *
 * Derived from browser characteristics rather than from a random id kept
 * in storage, so clearing site data does not mint a fresh device slot.
 * The flip side is that two genuinely identical setups on one account
 * share a slot; that is the lenient direction to err in, since the
 * alternative locks a paying reader out of a book they bought.
 */

export function deviceFingerprint(): string {
  return digest(deviceTraits())
}

export function currentPlatform(): DevicePlatform {
  if (typeof navigator === "undefined") return "WEB"

  const ua = navigator.userAgent

  if (/android/i.test(ua)) return "ANDROID"

  if (/iphone|ipad|ipod/i.test(ua)) return "IOS"

  return "WEB"
}

/** Short human label for the device list in the CMS. */

export function describeDevice(): string {
  if (typeof navigator === "undefined") return "מכשיר לא מזוהה"

  const ua = navigator.userAgent

  const browser = /edg\//i.test(ua)
    ? "Edge"
    : /opr\/|opera/i.test(ua)
      ? "Opera"
      : /chrome|crios/i.test(ua)
        ? "Chrome"
        : /safari/i.test(ua)
          ? "Safari"
          : /firefox|fxios/i.test(ua)
            ? "Firefox"
            : "דפדפן"

  const os = /windows/i.test(ua)
    ? "Windows"
    : /android/i.test(ua)
      ? "Android"
      : /iphone|ipad|ipod/i.test(ua)
        ? "iOS"
        : /mac os x|macintosh/i.test(ua)
          ? "macOS"
          : /linux/i.test(ua)
            ? "Linux"
            : ""

  const touch =
    typeof navigator !== "undefined" && navigator.maxTouchPoints > 0
      ? " · מסך מגע"
      : ""

  return `${browser}${os ? ` · ${os}` : ""}${touch}`
}

function requireActor(actor: Actor | null): Failure | null {
  if (!actor)
    return fail("UNAUTHENTICATED", "יש להתחבר לחשבון כדי לפתוח תוכן מוגן.")

  return null
}

/** A session still counts against the cap while it is neither revoked nor closed. */

export function isSessionOpen(session: DeviceSession): boolean {
  return !session.revoked && !session.ended_at
}

export function isSessionExpired(
  session: DeviceSession,
  policy: DrmPolicy,
): boolean {
  if (!isSessionOpen(session)) return true

  const idleMs = Date.now() - new Date(session.last_seen_at).getTime()

  return idleMs > policy.session_timeout_minutes * 60_000
}

/**
 * Claims a device slot for the signed-in reader.
 *
 * Returns the existing session when this browser already holds one, so
 * re-opening a book never consumes a second slot. Fails with CONFLICT
 * once the policy's device cap is reached, and records the attempt —
 * a reader bumping into the cap repeatedly is exactly the pattern
 * support needs to see.
 */

export function registerDeviceSession(
  actor: Actor | null,
): Result<DeviceSession> {
  const denied = requireActor(actor)

  if (denied) return denied

  const user = actor as Actor

  const policy = activeDrmPolicy()

  const fingerprint = deviceFingerprint()

  const db = getDb()

  const existing = db.device_sessions.find(
    (s) =>
      s.user_id === user.user_id &&
      s.device_fingerprint === fingerprint &&
      isSessionOpen(s),
  )

  /* Returning the row untouched, rather than through touchSession, matters
   * twice over.
   *
   * It keeps this function read-only when the reader already holds a slot.
   * mutate() notifies every store subscriber, so a caller that registers
   * inside an effect keyed on an identity the store can rebuild will
   * re-render, re-run the effect and loop. The reader's heartbeat owns
   * last_seen_at; claiming a slot has no business refreshing it.
   *
   * It also stops a mount from silently reviving a session that idled past
   * session_timeout_minutes. That one is meant to stay locked until the
   * reader presses resume, which calls refreshDeviceSession explicitly. */

  if (existing) return ok(existing)

  const open = db.device_sessions.filter(
    (s) => s.user_id === user.user_id && isSessionOpen(s),
  )

  if (open.length >= policy.max_devices_per_user) {
    recordEvent({
      user_id: user.user_id,

      event_type: "DEVICE_LIMIT_EXCEEDED",

      product_id: undefined,

      session_id: undefined,

      metadata: {
        open_sessions: open.length,
        limit: policy.max_devices_per_user,
      },
    })

    return fail(
      "CONFLICT",

      `המכשיר הזה לא נרשם: ההגדרה מגבילה קריאה ל־${policy.max_devices_per_user} מכשירים בו־זמנית, וכולם כבר תפוסים. ניתן לשחרר מכשיר מתוך הספרייה או לפנות לתמיכה.`,
    )
  }

  const created = mutate((draft) => {
    const at = nowIso()

    const session: DeviceSession = {
      session_id: uid("dvs"),

      user_id: user.user_id,

      device_fingerprint: fingerprint,

      platform: currentPlatform(),

      device_name: describeDevice(),

      /* The browser has no integrity verdict to give. A native client reports
       * one at registration, which is where block_rooted_devices bites. */

      device_integrity: "UNKNOWN",

      secure_flag_active: true,

      started_at: at,

      last_seen_at: at,

      revoked: false,
    }

    draft.device_sessions = [...draft.device_sessions, session]

    return session
  })

  return ok(created)
}

/**
 * Marks the session as seen again. Called on reader activity so an idle
 * session ages out on `session_timeout_minutes` while an active one does
 * not. Returns a failure when the session was revoked or closed, which is
 * how the reader learns it has to stop.
 */

export function refreshDeviceSession(
  actor: Actor | null,
  sessionId: string,
): Result<DeviceSession> {
  const denied = requireActor(actor)

  if (denied) return denied

  const db = getDb()

  const session = db.device_sessions.find((s) => s.session_id === sessionId)

  if (!session) return fail("NOT_FOUND", "ההתקשרות לא נמצאה.")

  if (session.user_id !== (actor as Actor).user_id) {
    return fail("FORBIDDEN", "ניתן לרענן התקשרות של החשבון המחובר בלבד.")
  }

  if (session.revoked)
    return fail("FORBIDDEN", "הגישה ממכשיר זה נחסמה על ידי מנהל.")

  if (session.ended_at)
    return fail("CONFLICT", "ההתקשרות הזו הסתיימה. יש לפתוח את הספר מחדש.")

  return ok(touchSession(sessionId))
}

function touchSession(sessionId: string): DeviceSession {
  return mutate((draft) => {
    const at = nowIso()

    let touched: DeviceSession | undefined

    draft.device_sessions = draft.device_sessions.map((s) => {
      if (s.session_id !== sessionId) return s

      touched = { ...s, last_seen_at: at }

      return touched
    })

    return touched as DeviceSession
  })
}

/**
 * Releases this browser's slot. A customer may always free their own
 * device; freeing somebody else's is a staff action.
 */

export function endDeviceSession(
  actor: Actor | null,
  sessionId: string,
): Result {
  const denied = requireActor(actor)

  if (denied) return denied

  const db = getDb()

  const session = db.device_sessions.find((s) => s.session_id === sessionId)

  if (!session) return fail("NOT_FOUND", "ההתקשרות לא נמצאה.")

  if (session.user_id !== (actor as Actor).user_id) {
    const staffDenied = guard(actor, "security")

    if (staffDenied) return staffDenied
  }

  mutate((draft) => {
    draft.device_sessions = draft.device_sessions.map((s) =>
      s.session_id === sessionId ? { ...s, ended_at: nowIso() } : s,
    )
  })

  return ok(undefined)
}

/**
 * Staff revocation: closes the slot, records why the reader stopped, and
 * kills every content grant issued to that device.
 *
 * The cascade matters more than it looks. A grant is a live address to a
 * protected file; revoking the device without revoking the grant would
 * leave a phone that was just cut off able to fetch the book until the
 * grant expired on its own. schema.sql enforces the same rule with
 * trg_device_session_revokes_grants, so the two clients cannot drift.
 */

export function revokeDeviceSession(
  actor: Actor | null,
  sessionId: string,
  reason?: string,
): Result<DeviceSession> {
  const denied = guard(actor, "manage_drm")

  if (denied) return denied

  const db = getDb()

  const session = db.device_sessions.find((s) => s.session_id === sessionId)

  if (!session) return fail("NOT_FOUND", "ההתקשרות לא נמצאה.")

  const revoked = mutate((draft) => {
    const at = nowIso()

    let next: DeviceSession | undefined

    draft.device_sessions = draft.device_sessions.map((s) => {
      if (s.session_id !== sessionId) return s

      next = {
        ...s,

        revoked: true,

        ended_at: at,

        secure_flag_active: false,

        revoked_at: at,

        revoked_by: (actor as Actor).user_id,

        revoke_reason: reason?.trim() || undefined,
      }

      return next
    })

    draft.content_grants = draft.content_grants.map((g) =>
      g.session_id === sessionId && !g.revoked_at
        ? {
            ...g,
            revoked_at: at,
            revoked_by: (actor as Actor).user_id,
            revoke_reason: reason?.trim() || "ההתקשרות ממכשיר זה נחסמה",
          }
        : g,
    )

    return next as DeviceSession
  })

  recordEvent({
    user_id: session.user_id,

    session_id: sessionId,

    event_type: "SESSION_REVOKED",

    metadata: { device: session.device_name, reason: reason ?? "" },
  })

  writeAudit(actor, {
    category: "SECURITY",

    action: "חסימת גישה ממכשיר",

    target_type: "DEVICE_SESSION",

    target_id: sessionId,

    target_label: session.device_name,

    details: reason?.trim() ? `סיבה: ${reason.trim()}` : "לא צוינה סיבה",
  })

  return ok(revoked)
}

/**
 * Lists device sessions. Staff with the `security` permission may ask
 * for another account's sessions; anyone else — including an
 * authenticated customer — only ever receives their own, so the
 * library's "מכשירים מחוברים" panel cannot be turned into a way to
 * enumerate who else is reading what.
 */

export function listDeviceSessions(
  actor: Actor | null,
  userId?: string,
): Result<DeviceSession[]> {
  const denied = requireActor(actor)

  if (denied) return denied

  const self = (actor as Actor).user_id

  const db = getDb()

  if (userId === undefined || userId === self) {
    return ok(db.device_sessions.filter((s) => s.user_id === self))
  }

  const staffDenied = guard(actor, "security")

  if (staffDenied) return staffDenied

  return ok(db.device_sessions.filter((s) => s.user_id === userId))
}

/* ── Protection events ────────────────────────────────── */

/**
 * Repeated identical reports from the same session are collapsed for
 * this long. Without it, holding Ctrl+C on a protected page would write
 * hundreds of rows and push real events out of the bounded log.
 */

const DEDUPE_WINDOW_MS = 20_000

const lastReported = new Map<string, number>()

export interface SecurityEventInput {
  user_id?: string

  session_id?: string

  product_id?: string

  event_type: SecurityEventType

  metadata?: Record<string, string | number | boolean>
}

/**
 * Records a protection event. Never throws and never blocks the reader:
 * logging a deterrent must not become the reason somebody cannot read a
 * book they paid for.
 */

export function recordEvent(input: SecurityEventInput): void {
  const key = `${input.user_id ?? "anon"}:${input.event_type}:${input.product_id ?? ""}`

  const now = Date.now()

  const previous = lastReported.get(key)

  if (previous !== undefined && now - previous < DEDUPE_WINDOW_MS) return

  lastReported.set(key, now)

  try {
    mutate((db) => {
      const event: SecurityEvent = {
        event_id: uid("sec"),

        user_id: input.user_id,

        session_id: input.session_id,

        product_id: input.product_id,

        event_type: input.event_type,

        platform: currentPlatform(),

        metadata: input.metadata ?? {},

        user_agent:
          typeof navigator === "undefined"
            ? undefined
            : navigator.userAgent.slice(0, 300),

        created_at: nowIso(),
      }

      // Newest first, hard-capped: the log is a diagnostic feed, not an archive.

      db.security_events = [event, ...db.security_events].slice(
        0,
        SECURITY_EVENT_LIMIT,
      )
    })
  } catch {
    /* A full store must never break reading. */
  }
}

export interface SecurityEventFilter {
  event_type?: SecurityEventType

  user_id?: string
}

export function listSecurityEvents(
  actor: Actor | null,
  filter: SecurityEventFilter = {},
): Result<SecurityEvent[]> {
  const denied = guard(actor, "security")

  if (denied) return denied

  let events = getDb().security_events

  if (filter.event_type)
    events = events.filter((e) => e.event_type === filter.event_type)

  if (filter.user_id)
    events = events.filter((e) => e.user_id === filter.user_id)

  return ok(events)
}

export const SECURITY_EVENT_LABEL: Record<SecurityEventType, string> = {
  SCREENSHOT_BLOCKED: "צילום מסך נחסם",

  RECORDING_DETECTED: "הקלטת מסך זוהתה",

  COPY_BLOCKED: "העתקה נחסמה",

  PRINT_BLOCKED: "הדפסה נחסמה",

  CONTEXT_MENU_BLOCKED: "תפריט לחיצה ימנית נחסם",

  SOURCE_VIEW_BLOCKED: "צפייה בקוד המקור של הדף נחסמה",

  VISIBILITY_HIDDEN: "התוכן הוסתר (חלון לא פעיל)",

  SESSION_REVOKED: "גישה ממכשיר נחסמה",

  DEVICE_LIMIT_EXCEEDED: "חריגה ממגבלת מכשירים",

  DOWNLOAD_BLOCKED: "הורדת קובץ התוכן נחסמה",

  SHARE_BLOCKED: "שיתוף הקובץ נחסם",

  MIRROR_DETECTED: "שיקוף מסך זוהה",

  DEVICE_COMPROMISED: "מכשיר פרוץ או מדומה זוהה",

  GRANT_REPLAY_BLOCKED: "שימוש חוזר בקישור תוכן חד־פעמי נחסם",

  OFFLINE_EXPIRED: "עותק לא מקוון נמחק בתום התוקף",
}

/** Events that suggest deliberate circumvention rather than an accidental keystroke. */

export const HIGH_SIGNAL_EVENTS: SecurityEventType[] = [
  "DEVICE_LIMIT_EXCEEDED",

  "SESSION_REVOKED",

  "SCREENSHOT_BLOCKED",

  "RECORDING_DETECTED",

  /* Nobody reaches for view-source inside a reader by accident, and what it
   * exposes is the content file's own URL — so this is a probe, not a stray
   * keystroke like a blocked Ctrl+C. */

  "SOURCE_VIEW_BLOCKED",

  /* Asking for the bytes rather than for the page is the same intent, on a
   * device where it happens to be possible. */

  "DOWNLOAD_BLOCKED",

  "SHARE_BLOCKED",

  "GRANT_REPLAY_BLOCKED",

  "DEVICE_COMPROMISED",

  "MIRROR_DETECTED",
]

/* ── Watermark rendering ──────────────────────────────── */

/**
 * Builds the identity stamp shown over protected content.
 *
 * Substituted from the signed-in account at render time, so the mark on
 * a leaked capture belongs to whoever was logged in when it was taken.
 * The email is included on purpose: it is the part that makes a
 * redistributed screenshot traceable.
 */

export function renderWatermark(
  template: string,
  user: { name: string, email: string },
): string {
  return template

    .replace(/\{name\}/g, user.name)

    .replace(/\{email\}/g, user.email)

    .replace(/\{date\}/g, new Date().toLocaleDateString("he-IL"))

    .trim()
}

/* ── Content grants ───────────────────────────────── */

/**
 * The one rule both clients obey: nobody is ever handed the permanent
 * address of a protected file. They ask for a grant, bound to their
 * account, their entitlement and their device session, with an expiry
 * and a use budget. The reader renders from the grant and from nothing
 * else, so revoking the device or the entitlement in the CMS also kills
 * the URL already on screen.
 *
 * This mirrors content_access_grants in schema.sql and
 * consume_content_grant(); the browser implementation keeps the token
 * itself because here the browser is the only party that needs it, where
 * the server stores nothing but its digest.
 */

/**
 * How long a streaming grant stays valid. Deliberately shorter than the
 * session timeout: the page in front of the reader should keep working
 * through a long read, but a URL copied out of the DOM should be useless
 * by the time anybody tries it.
 */

const STREAM_GRANT_MINUTES = 30

/** Page reloads and re-renders inside one sitting. Not unlimited. */

const STREAM_GRANT_USES = 200

function randomToken(): string {
  const bytes = new Uint8Array(24)

  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(bytes)
  } else {
    for (let i = 0; i < bytes.length; i += 1)
      bytes[i] = Math.floor(Math.random() * 256)
  }

  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")
}

export interface ContentGrantRequest {
  productId: string

  /** Required for OFFLINE_CACHE: a copy on disk must belong to a revocable slot. */

  sessionId?: string

  scope?: ContentGrantScope
}

function entitlementFor(
  userId: string,
  productId: string,
): UserProduct | undefined {
  return getDb().user_products.find(
    (up) =>
      up.user_id === userId &&
      up.product_id === productId &&
      up.access_status === "ACTIVE" &&
      (!up.expires_at || new Date(up.expires_at).getTime() > Date.now()),
  )
}

/** Verdicts that mean the platform's own protection cannot be trusted. */

const COMPROMISED_INTEGRITY = [
  "ROOTED",
  "JAILBROKEN",
  "ATTESTATION_FAILED",
  "EMULATOR",
]

export function isDeviceCompromised(session: DeviceSession): boolean {
  return COMPROMISED_INTEGRITY.includes(session.device_integrity)
}

/**
 * Mints a grant for one entitled product.
 *
 * Reuses a live STREAM grant for the same account, product and device
 * instead of minting a second one, for the same reason
 * registerDeviceSession returns an existing slot: re-opening a book must
 * not consume anything, and an effect that re-runs must not grow the
 * collection.
 */

export async function issueContentGrant(
  actor: Actor | null,

  input: ContentGrantRequest,
): Promise<Result<ContentGrant>> {
  const denied = requireActor(actor)

  if (denied) return denied

  const user = actor as Actor

  const scope: ContentGrantScope = input.scope ?? "STREAM"

  const db = getDb()

  const platform = currentPlatform()

  const policy = activeDrmPolicy(platform === "WEB" ? "WEB" : "MOBILE")

  const entitlement = entitlementFor(user.user_id, input.productId)

  if (!entitlement) {
    return fail(
      "FORBIDDEN",
      "אין לך גישה פעילה לתוכן הזה. ייתכן שפג התוקף או שהגישה נשללה.",
    )
  }

  const product = db.products.find((p) => p.product_id === input.productId)

  /* A Supabase-hosted file has no permanent address on the product; it is
   * identified by its storage path and resolved to a signed URL below. A
   * legacy/local file still carries its own content_url. Either is enough;
   * neither means nothing was ever attached.
   *
   * When Supabase is configured the catalogue the storefront sells from
   * lives there, so the local document frequently does not hold the row at
   * all — a purchased book would be declared "no file attached" before the
   * server was even asked. The product id is all `get-content-url` needs
   * (it derives the object key server-side), so a hosted deployment asks
   * for a signed URL whenever there is no legacy address to fall back on. */

  const storagePath = product?.storage_path?.trim()

  const legacyUrl = product?.content_url?.trim()

  const hosted =
    Boolean(storagePath) || (isSupabaseConfigured && !legacyUrl)

  if (!storagePath && !legacyUrl && !isSupabaseConfigured) {
    return fail("NOT_FOUND", "לתוכן הזה לא הוצמד קובץ. יש לפנות לתמיכה.")
  }

  if (policy.block_rooted_devices && input.sessionId) {
    const device = db.device_sessions.find(
      (s) => s.session_id === input.sessionId,
    )

    if (device && isDeviceCompromised(device)) {
      recordEvent({
        user_id: user.user_id,

        session_id: device.session_id,

        product_id: input.productId,

        event_type: "DEVICE_COMPROMISED",

        metadata: { integrity: device.device_integrity, scope },
      })

      return fail(
        "FORBIDDEN",
        "המכשיר הזה זוהה כפרוץ או כמדומה, וההגנה על התוכן אינה תקפה בו. ניתן לקרוא ממכשיר אחר.",
      )
    }
  }

  if (scope === "OFFLINE_CACHE") {
    if (!policy.allow_offline) {
      return fail(
        "FORBIDDEN",
        "מדיניות ההגנה אינה מאפשרת שמירת עותק לקריאה לא מקוונת.",
      )
    }

    const device = db.device_sessions.find(
      (s) => s.session_id === input.sessionId,
    )

    if (!device || !isSessionOpen(device) || device.user_id !== user.user_id) {
      return fail("FORBIDDEN", "עותק לא מקוון מחייב מכשיר רשום ופעיל.")
    }
  }

  const reusable = db.content_grants.find(
    (g) =>
      g.user_id === user.user_id &&
      g.product_id === input.productId &&
      g.scope === "STREAM" &&
      scope === "STREAM" &&
      (g.session_id ?? null) === (input.sessionId ?? null) &&
      !g.revoked_at &&
      new Date(g.expires_at).getTime() > Date.now() &&
      g.use_count < g.max_uses,
  )

  if (reusable) return ok(reusable)

  const stored = db.users.find((u) => u.user_id === user.user_id)

  const product_asset = product?.content_file

  const ttlMinutes =
    scope === "OFFLINE_CACHE"
      ? (policy.offline_ttl_hours ?? 0) * 60
      : Math.min(STREAM_GRANT_MINUTES, policy.session_timeout_minutes)

  /* Resolve the address the reader will load. For a Storage-hosted file this
   * is the one network call per grant: it asks the get-content-url function
   * for a short-lived signed URL (TTL 30 min, ≥ this grant's own TTL, so the
   * URL stays valid for as long as the grant that carries it is reused).
   * Legacy/local files keep their stored address and make no call at all. */

  let contentUrl = legacyUrl ?? ""

  if (hosted) {
    const signed = await fetchSignedContentUrl(input.productId)

    if (!signed.ok) return fail(signed.code, signed.error)

    contentUrl = signed.data.signedUrl
  }

  const created = mutate((draft) => {
    const at = Date.now()

    const grant: ContentGrant = {
      grant_id: uid("cag"),

      user_id: user.user_id,

      user_product_id: entitlement.user_product_id,

      product_id: input.productId,

      session_id: input.sessionId,

      asset_id: undefined,

      platform,

      scope,

      token: randomToken(),

      content_url: contentUrl,

      /* Frozen here, not resolved at render time: the stamp on a leaked
       * page has to keep naming the account it was issued to. */

      watermark_text: policy.watermark_enabled
        ? renderWatermark(policy.watermark_template, {
            name: user.name,

            email: stored?.email ?? "",
          })
        : undefined,

      checksum: undefined,

      file_size_bytes: product_asset
        ? product_asset.file_size_kb * 1024
        : undefined,

      max_uses: scope === "OFFLINE_CACHE" ? 1 : STREAM_GRANT_USES,

      use_count: 0,

      expires_at: new Date(at + ttlMinutes * 60_000).toISOString(),

      created_at: nowIso(),
    }

    // Newest first and hard-capped, like the protection-event log.

    draft.content_grants = [grant, ...draft.content_grants].slice(
      0,
      CONTENT_GRANT_LIMIT,
    )

    return grant
  })

  return ok(created)
}

/**
 * Spends one use of a grant and returns the file location.
 *
 * Re-checks the entitlement on every call rather than trusting the row
 * that was minted earlier — access may have been revoked in the CMS in
 * between, and consume_content_grant() in schema.sql refuses for exactly
 * the same reasons. A rejection is recorded as a replay attempt: a
 * reader whose page simply stopped refreshing would never tell support
 * that somebody is probing single-use URLs.
 */

export function consumeContentGrant(
  token: string,
  productId?: string,
): Result<ContentGrant> {
  const db = getDb()

  const grant = db.content_grants.find((g) => g.token === token)

  const reject = (reason: string, message: string): Failure => {
    if (grant) {
      recordEvent({
        user_id: grant.user_id,

        session_id: grant.session_id,

        product_id: grant.product_id,

        event_type: "GRANT_REPLAY_BLOCKED",

        metadata: { reason },
      })
    }

    return fail("FORBIDDEN", message)
  }

  if (!grant)
    return reject("unknown", "הקישור לתוכן אינו תקף. יש לפתוח את הספר מחדש.")

  if (productId && grant.product_id !== productId) {
    return reject(
      "product_mismatch",
      "הקישור לתוכן אינו תקף. יש לפתוח את הספר מחדש.",
    )
  }

  if (grant.revoked_at) {
    return reject("revoked", grant.revoke_reason || "הגישה לתוכן זה נחסמה.")
  }

  if (new Date(grant.expires_at).getTime() <= Date.now()) {
    return reject("expired", "תוקף הקישור פג. יש לפתוח את הספר מחדש.")
  }

  if (grant.use_count >= grant.max_uses) {
    return reject(
      "exhausted",
      "מיצית את מספר השימושים בקישור הזה. יש לפתוח את הספר מחדש.",
    )
  }

  const session = grant.session_id
    ? db.device_sessions.find((s) => s.session_id === grant.session_id)
    : undefined

  if (grant.session_id && (!session || session.revoked)) {
    return reject(
      "session_revoked",
      session?.revoke_reason || "הגישה ממכשיר זה נחסמה.",
    )
  }

  if (!entitlementFor(grant.user_id, grant.product_id)) {
    return reject("entitlement_lost", "אין לך עוד גישה פעילה לתוכן הזה.")
  }

  const consumed = mutate((draft) => {
    const at = nowIso()

    let next: ContentGrant | undefined

    draft.content_grants = draft.content_grants.map((g) => {
      if (g.grant_id !== grant.grant_id) return g

      next = {
        ...g,
        use_count: g.use_count + 1,
        first_used_at: g.first_used_at ?? at,
        last_used_at: at,
      }

      return next
    })

    return next as ContentGrant
  })

  return ok(consumed)
}

/**
 * Kills every grant that still points at a product whose entitlement was
 * revoked or expired. Called by the access service so the CMS promise
 * "revoking access stops the reader" is literally true for a URL already
 * on a screen, not only for the next request.
 */

export function revokeGrantsForEntitlement(
  userProductId: string,
  reason: string,
): void {
  mutate((draft) => {
    const at = nowIso()

    draft.content_grants = draft.content_grants.map((g) =>
      g.user_product_id === userProductId && !g.revoked_at
        ? { ...g, revoked_at: at, revoke_reason: reason }
        : g,
    )
  })
}

/** Staff view of who is holding a file right now. */

export function listContentGrants(actor: Actor | null): Result<ContentGrant[]> {
  const denied = guard(actor, "security")

  if (denied) return denied

  return ok(getDb().content_grants)
}

export function isGrantLive(grant: ContentGrant): boolean {
  return (
    !grant.revoked_at &&
    new Date(grant.expires_at).getTime() > Date.now() &&
    grant.use_count < grant.max_uses
  )
}
