/* ─────────────────────────────────────────────────────────────
 * Service layer — customers, entitlements and support inquiries.
 * ───────────────────────────────────────────────────────────── */

import type {
  AdminRole,
  AuditCategory,
  Inquiry,
  InquiryNote,
  InquiryStatus,
  InquiryTopic,
  Order,
  Product,
  ReadingProgress,
  Refund,
  User,
  UserProduct,
} from "../types"

import { snapshotProduct } from "../types"

import { getDb, mutate, nextSequence, nowIso, uid } from "./db"

import { toPublicUser, isEmail, normalizeEmail } from "./auth"

import { revokeGrantsForEntitlement } from "./api-security"

import { isSupabaseConfigured } from "./supabase"

import { updateAccountStatus } from "./supabase-auth"

import {
  adminGrantAccess,
  adminRemoveAccess,
  adminSetAccessStatus,
  isUuid,
} from "./supabase-entitlements"

import {
  createInquiryNoteRemote,
  createMyInquiry,
  fetchMyInquiries,
  replyToMyInquiry,
  updateInquiryRemote,
} from "./supabase-inquiries"

import {
  dispatchEmail,
  fail,
  guard,
  ok,
  writeAudit,
  type Actor,
  type Result,
} from "./api"

/* ── Support inquiries ────────────────────────────────── */

export interface InquiryInput {
  customer_name: string

  customer_email: string

  customer_phone?: string

  subject: string

  message: string

  topic?: InquiryTopic

  related_order_id?: string

  /** `WEBSITE` for the public form, `CMS` when an admin logs a phone call. */

  source?: Inquiry["source"]
}

export const INQUIRY_STATUS_LABEL: Record<InquiryStatus, string> = {
  NEW: "חדש",

  OPEN: "פתוח",

  IN_PROGRESS: "בטיפול",

  WAITING_FOR_CUSTOMER: "ממתין ללקוח",

  RESOLVED: "נפתר",

  CLOSED: "סגור",
}

export const INQUIRY_TOPIC_LABEL: Record<InquiryTopic, string> = {
  GENERAL: "פנייה כללית",

  ORDER: "הזמנה",

  REFUND: "החזר כספי",

  ACCESS: "גישה לספר",

  BILLING: "חיוב וחשבוניות",

  TECHNICAL: "תקלה טכנית",
}

/**
 * Public submission from the website. Matches the sender to an existing
 * customer account and to one of their orders when the reference is
 * supplied, so the CMS can show the relationship without duplicating data.
 */

export async function createInquiry(
  actor: Actor | null,
  input: InquiryInput,
): Promise<Result<Inquiry>> {
  /* The authenticated account is the authoritative sender: for a signed-in
   * customer the stored profile supplies the name and address, and the
   * submitted values are ignored — a crafted request cannot open a ticket
   * under someone else's identity. `CMS` submissions are the deliberate
   * exception: an admin logging a phone call enters the caller's details
   * by hand. */
  const isCustomerSubmission = actor !== null && input.source !== "CMS"

  const account = isCustomerSubmission
    ? getDb().users.find((u) => u.user_id === actor?.user_id)
    : undefined

  const email = normalizeEmail(
    isCustomerSubmission
      ? (account?.email ?? input.customer_email)
      : input.customer_email,
  )

  const name = isCustomerSubmission
    ? `${account?.first_name ?? ""} ${account?.last_name ?? ""}`.trim() ||
      account?.email ||
      actor?.name ||
      email
    : input.customer_name.trim()

  const subject = input.subject.trim()

  const message = input.message.trim()

  if (!name) return fail("VALIDATION", "יש למלא שם מלא.")

  if (!isEmail(email)) return fail("VALIDATION", "כתובת המייל אינה תקינה.")

  if (!subject) return fail("VALIDATION", "יש למלא נושא.")

  if (message.length < 10)
    return fail("VALIDATION", "ההודעה קצרה מדי — יש לתאר את הפנייה בפירוט.")

  const db = getDb()

  const matchedUser = db.users.find((u) => u.email === email)

  const relatedOrderId =
    input.related_order_id &&
    db.orders.some((o) => o.order_id === input.related_order_id)
      ? input.related_order_id
      : undefined

  /* Authenticated website submissions persist to `public.inquiries` — the
   * shared queue the admin dashboard reads — through the create_my_inquiry
   * RPC, which stamps the identity from the JWT and profile server-side.
   * The local document stays the fallback for an unconfigured install,
   * anonymous visitors and admin-logged phone tickets. */
  if (isSupabaseConfigured && isCustomerSubmission) {
    const remote = await createMyInquiry({
      subject,

      message,

      topic: input.topic ?? (relatedOrderId ? "ORDER" : "GENERAL"),

      customer_phone: input.customer_phone?.trim() || undefined,

      /* The hosted orders table does not hold this browser's `ord_…` rows,
       * so only a real uuid may be forwarded (same guard as
       * adminGrantAccess). */
      related_order_id:
        relatedOrderId && isUuid(relatedOrderId) ? relatedOrderId : undefined,
    })

    if (!remote.ok) return remote

    upsertRemoteInquiries([remote.data])

    dispatchEmail({
      recipient: remote.data.customer_email,

      recipient_name: remote.data.customer_name,

      template: "INQUIRY_RECEIVED",

      subject: `קיבלנו את פנייתך — ${remote.data.ticket_number}`,

      related_type: "INQUIRY",

      related_id: remote.data.inquiry_id,
    })

    return remote
  }

  const inquiry = mutate((d) => {
    const year = new Date().getFullYear()

    const seq = nextSequence(d, "inquiry")

    const created: Inquiry = {
      inquiry_id: uid("inq"),

      ticket_number: `${d.settings.inquiry_prefix}-${year}-${String(seq).padStart(4, "0")}`,

      customer_name: name,

      customer_email: email,

      customer_phone: input.customer_phone?.trim() || undefined,

      subject,

      message,

      topic: input.topic ?? (relatedOrderId ? "ORDER" : "GENERAL"),

      status: "NEW",

      user_id: matchedUser?.user_id,

      related_order_id: relatedOrderId,

      source: input.source ?? "WEBSITE",

      created_at: nowIso(),

      updated_at: nowIso(),
    }

    d.inquiries = [created, ...d.inquiries]

    return created
  })

  dispatchEmail({
    recipient: inquiry.customer_email,

    recipient_name: inquiry.customer_name,

    template: "INQUIRY_RECEIVED",

    subject: `קיבלנו את פנייתך — ${inquiry.ticket_number}`,

    related_type: "INQUIRY",

    related_id: inquiry.inquiry_id,
  })

  return ok(inquiry)
}

export function listInquiries(actor: Actor | null): Result<Inquiry[]> {
  const denied = guard(actor, "support")

  if (denied) return denied

  return ok(getDb().inquiries)
}

/**
 * Customer-scoped read: returns only the inquiries belonging to the
 * signed-in account, matched by user id or by the address they wrote in.
 */

export function listMyInquiries(actor: Actor | null): Inquiry[] {
  if (!actor) return []

  const db = getDb()

  const stored = db.users.find((u) => u.user_id === actor.user_id)

  return db.inquiries

    .filter(
      (i) =>
        i.user_id === actor.user_id ||
        (stored && i.customer_email === stored.email),
    )

    .sort((a, b) => b.created_at.localeCompare(a.created_at))
}

export function getInquiry(
  actor: Actor | null,
  inquiryId: string,
): Result<Inquiry> {
  const denied = guard(actor, "support")

  if (denied) return denied

  const inquiry = getDb().inquiries.find((i) => i.inquiry_id === inquiryId)

  if (!inquiry) return fail("NOT_FOUND", "הפנייה לא נמצאה.")

  return ok(inquiry)
}

export function listInquiryNotes(inquiryId: string): InquiryNote[] {
  return getDb()

    .inquiry_notes.filter((n) => n.inquiry_id === inquiryId)

    .sort((a, b) => a.created_at.localeCompare(b.created_at))
}

export async function updateInquiry(
  actor: Actor | null,

  inquiryId: string,

  patch: Partial<Pick<Inquiry, "status" | "assigned_to" | "related_order_id" | "topic" | "subject">>,
): Promise<Result<Inquiry>> {
  const denied = guard(actor, "manage_support")

  if (denied) return denied

  const existing = getDb().inquiries.find((i) => i.inquiry_id === inquiryId)

  if (!existing) return fail("NOT_FOUND", "הפנייה לא נמצאה.")

  const nextStatus: InquiryStatus = patch.status ?? existing.status

  /* The resolution moment. Against Supabase this value is only carried for
   * the pre-0020 case and for the offline driver: migration 0020 stamps
   * `resolved_at` from the server clock on the status transition and
   * overrides whatever the browser sent, so the stored moment is the
   * database's. Re-entering a resolved status reuses the stored value here
   * (the server keeps the same rule), and leaving those statuses clears it. */
  const resolvedAt =
    nextStatus === "RESOLVED" || nextStatus === "CLOSED"
      ? (existing.resolved_at ?? nowIso())
      : undefined

  /* A remote-owned ticket (uuid id) is updated in Postgres, and the row
   * that lands there — not the patch — becomes the local record. The
   * realtime event this write produces carries the same change to the
   * customer's open page. */
  if (isSupabaseConfigured && isUuid(inquiryId)) {
    if (patch.assigned_to !== undefined && !isUuid(patch.assigned_to)) {
      return fail("VALIDATION", "ניתן לשייך פנייה בשרת רק לנציג הרשום בשרת.")
    }

    if (
      "related_order_id" in patch &&
      patch.related_order_id !== undefined &&
      !isUuid(patch.related_order_id)
    ) {
      return fail("VALIDATION", "ניתן לשייך פנייה בשרת רק להזמנה הרשומה בשרת.")
    }

    const remote = await updateInquiryRemote(inquiryId, {
      status: patch.status,

      assigned_to: patch.assigned_to,

      related_order_id:
        "related_order_id" in patch
          ? (patch.related_order_id ?? null)
          : undefined,

      topic: patch.topic,

      subject: patch.subject,

      resolved_at:
        patch.status !== undefined ? (resolvedAt ?? null) : undefined,
    })

    if (!remote.ok) return remote

    upsertRemoteInquiries([remote.data])

    if (patch.status && patch.status !== existing.status) {
      writeAudit(actor, {
        category: "INQUIRY",

        action: "עדכון סטטוס פנייה",

        target_type: "INQUIRY",

        target_id: inquiryId,

        target_label: `${remote.data.ticket_number} · ${remote.data.customer_name}`,

        details: `${INQUIRY_STATUS_LABEL[existing.status]} → ${INQUIRY_STATUS_LABEL[patch.status]}`,
      })
    }

    return ok(remote.data)
  }

  const assigneeName = patch.assigned_to
    ? getDb().users.find((u) => u.user_id === patch.assigned_to)
    : undefined

  const updated = mutate((db) => {
    const next: Inquiry = {
      ...existing,

      ...patch,

      assigned_to: patch.assigned_to ?? existing.assigned_to,

      assigned_to_name:
        patch.assigned_to === undefined
          ? existing.assigned_to_name
          : assigneeName
            ? `${assigneeName.first_name} ${assigneeName.last_name}`
            : undefined,

      resolved_at: resolvedAt,

      updated_at: nowIso(),
    }

    db.inquiries = db.inquiries.map((i) =>
      i.inquiry_id === inquiryId ? next : i,
    )

    return next
  })

  if (patch.status && patch.status !== existing.status) {
    writeAudit(actor, {
      category: "INQUIRY",

      action: "עדכון סטטוס פנייה",

      target_type: "INQUIRY",

      target_id: inquiryId,

      target_label: `${updated.ticket_number} · ${updated.customer_name}`,

      details: `${INQUIRY_STATUS_LABEL[existing.status]} → ${INQUIRY_STATUS_LABEL[patch.status]}`,
    })
  }

  return ok(updated)
}

export async function linkInquiryToOrder(
  actor: Actor | null,
  inquiryId: string,
  orderId: string | null,
): Promise<Result<Inquiry>> {
  const denied = guard(actor, "manage_support")

  if (denied) return denied

  if (orderId && !getDb().orders.some((o) => o.order_id === orderId)) {
    return fail("NOT_FOUND", "ההזמנה לא נמצאה.")
  }

  return updateInquiry(actor, inquiryId, {
    related_order_id: orderId ?? undefined,
  })
}

export async function addInquiryNote(
  actor: Actor | null,

  inquiryId: string,

  content: string,

  internal = true,
): Promise<Result<InquiryNote>> {
  const denied = guard(actor, "support")

  if (denied) return denied

  if (!content.trim()) return fail("VALIDATION", "תוכן ההערה חובה.")

  const inquiry = getDb().inquiries.find((i) => i.inquiry_id === inquiryId)

  if (!inquiry) return fail("NOT_FOUND", "הפנייה לא נמצאה.")

  const trimmed = content.trim()

  /* A server-owned ticket keeps its whole conversation in Postgres: the
   * reply has to land there or the customer will never see it, so a
   * refused write is surfaced instead of being parked in this browser —
   * which is exactly how a "תגובה ללקוח" used to disappear. */
  if (isSupabaseConfigured && isUuid(inquiryId)) {
    const authorId = actor?.user_id ?? ""

    if (!isUuid(authorId))
      return fail(
        "VALIDATION",
        "ניתן להוסיף הודעה לפנייה בשרת רק מחשבון הרשום בשרת.",
      )

    const remote = await createInquiryNoteRemote({
      inquiry_id: inquiryId,

      author_id: authorId,

      content: trimmed,

      internal,
    })

    if (!remote.ok) return remote

    /* The freshness stamp and the NEW→OPEN transition belong to the ticket,
     * not the note, so they are pushed too — otherwise the next sync would
     * revert them. */
    const bump = await updateInquiryRemote(inquiryId, {
      status: inquiry.status === "NEW" ? "OPEN" : inquiry.status,
    })

    if (!bump.ok) {
      console.warn("[support] ticket freshness bump failed:", bump.error)
    } else {
      upsertRemoteInquiries([bump.data])
    }

    upsertRemoteInquiryNotes([remote.data])

    return remote
  }

  const note = mutate((db) => {
    const created: InquiryNote = {
      note_id: uid("inote"),

      inquiry_id: inquiryId,

      author_id: actor?.user_id ?? "system",

      author_name: actor?.name ?? "מערכת",

      content: trimmed,

      internal,

      created_at: nowIso(),
    }

    db.inquiry_notes = [...db.inquiry_notes, created]

    db.inquiries = db.inquiries.map((i) =>
      i.inquiry_id === inquiryId
        ? {
            ...i,
            updated_at: created.created_at,
            status: i.status === "NEW" ? "OPEN" : i.status,
          }
        : i,
    )

    return created
  })

  /* Local-only ticket: the conversation stays in this browser's document,
   * as it always has for the offline driver and for tickets logged from a
   * phone call. */
  return ok(note)
}

/**
 * How many messages a customer may send in a row before the support team
 * answers. Kept next to the rule it describes so the wording and the check
 * cannot drift apart; the database enforces the same number in
 * `reply_to_my_inquiry` (migration 0021).
 */
export const CUSTOMER_CONSECUTIVE_REPLY_LIMIT = 2

/**
 * What the customer reads when they are out of turn. Worded here (and
 * mirrored by the `reply_limit` token mapping in supabase-inquiries) so the
 * explanation the composer shows and the one a refused request returns are
 * the same sentence.
 */
export const CUSTOMER_REPLY_LIMIT_MESSAGE = `ניתן לשלוח עד ${CUSTOMER_CONSECUTIVE_REPLY_LIMIT} הודעות ברצף. לאחר תגובת האדמין ניתן לשלוח הודעה נוספת.`

/**
 * Whether the owner of this ticket may send another message yet.
 *
 * Mirrors the rule the database enforces (see the constant above) so the
 * customer's composer can explain itself BEFORE a send is refused — but it is
 * only a mirror: `reply_to_my_inquiry` re-derives the same thing server-side
 * and refuses the write, so a disabled button is never what stops the third
 * message.
 *
 * The count is read from the stored conversation, not from this browser
 * session, and only customer-visible messages take part: an internal staff
 * annotation is invisible to the customer, so it neither consumes their turn
 * nor restarts it. Every author is backend data — the session's user id, or
 * the ticket's owner as the database recorded it — so nothing here guesses
 * who wrote what.
 */
export function customerReplyAllowed(
  inquiry: Inquiry,
  customerId?: string | null,
): boolean {
  /* The customer's own side of the thread: the signed-in account when the
   * caller has one (the composer, a reply being sent), otherwise the ticket's
   * recorded owner. The fallback matters for a ticket that reached this
   * browser by email match rather than by `user_id`. */
  const customer = customerId ?? inquiry.user_id

  if (!customer) return true

  const visible = getDb()
    .inquiry_notes.filter(
      (n) => n.inquiry_id === inquiry.inquiry_id && !n.internal,
    )
    .sort((a, b) => a.created_at.localeCompare(b.created_at))

  let consecutive = 0

  for (let i = visible.length - 1; i >= 0; i -= 1) {
    if (visible[i].author_id !== customer) break
    consecutive += 1
  }

  return consecutive < CUSTOMER_CONSECUTIVE_REPLY_LIMIT
}

/**
 * Customer reply on one of their own tickets.
 *
 * Reads exactly like the admin's note path, but scoped to the customer's
 * own side of the conversation: for a server-owned ticket it goes through
 * `reply_to_my_inquiry`, whose DATABASE-side checks are what prove the
 * caller owns the ticket and force the note to be customer-visible. There
 * is no INSERT policy for customers on `inquiry_notes`, so a crafted
 * request cannot post into somebody else's ticket nor write an internal
 * annotation.
 */
export async function replyToInquiry(
  actor: Actor | null,
  inquiryId: string,
  content: string,
): Promise<Result<InquiryNote>> {
  if (!actor) return fail("UNAUTHENTICATED", "יש להתחבר כדי להשיב לפנייה.")

  const trimmed = content.trim()

  if (!trimmed) return fail("VALIDATION", "יש לכתוב הודעה.")

  const inquiry = getDb().inquiries.find((i) => i.inquiry_id === inquiryId)

  if (!inquiry) return fail("NOT_FOUND", "הפנייה לא נמצאה.")

  /* The same two-in-a-row ceiling the database enforces (migration 0021),
   * checked here so the local driver behaves identically and so the caller
   * gets the wording before a round trip. The server check is the one that
   * cannot be bypassed. */
  if (!customerReplyAllowed(inquiry, actor.user_id))
    return fail("CONFLICT", CUSTOMER_REPLY_LIMIT_MESSAGE)

  if (isSupabaseConfigured && isUuid(inquiryId)) {
    const remote = await replyToMyInquiry(inquiryId, trimmed)

    if (!remote.ok) return remote

    upsertRemoteInquiryNotes([remote.data])

    /* The reply can move a waiting ticket back to OPEN, so the ticket is
     * re-read rather than patched locally: the status shown to the customer
     * stays the backend's, never a guess. */
    mirrorRemoteInquiries(await fetchMyInquiries(actor.user_id), actor.user_id)

    return remote
  }

  /* Local-only ticket (offline driver, or a ticket pre-dating Supabase): the
   * same ownership rule the RPC enforces, applied to the local document. */
  const account = getDb().users.find((u) => u.user_id === actor.user_id)

  const mine =
    inquiry.user_id === actor.user_id ||
    (account !== undefined && inquiry.customer_email === account.email)

  if (!mine)
    return fail("FORBIDDEN", "ניתן להשיב רק לפניות שנפתחו מהחשבון שלך.")

  const note = mutate((db) => {
    const created: InquiryNote = {
      note_id: uid("inote"),

      inquiry_id: inquiryId,

      author_id: actor.user_id,

      author_name: actor.name,

      content: trimmed,

      internal: false,

      created_at: nowIso(),
    }

    db.inquiry_notes = [...db.inquiry_notes, created]

    db.inquiries = db.inquiries.map((i) =>
      i.inquiry_id === inquiryId
        ? {
            ...i,
            updated_at: created.created_at,
            status: i.status === "NEW" ? "OPEN" : i.status,
          }
        : i,
    )

    return created
  })

  return ok(note)
}

/* ── Support ticket mirror ───────────────────────────── */

/**
 * Merges server-held tickets into the local document without pruning —
 * used for the single row a create/update just returned, so the change
 * shows immediately even before the next full read (or realtime event).
 */
export function upsertRemoteInquiries(rows: Inquiry[]): void {
  if (rows.length === 0) return

  const current = getDb().inquiries

  const changed = rows.some((row) => {
    const existing = current.find((i) => i.inquiry_id === row.inquiry_id)
    return !existing || JSON.stringify(existing) !== JSON.stringify(row)
  })

  if (!changed) return

  mutate((db) => {
    const byId = new Map(db.inquiries.map((i) => [i.inquiry_id, i]))
    for (const row of rows) byId.set(row.inquiry_id, row)
    db.inquiries = [...byId.values()].sort((a, b) =>
      b.created_at.localeCompare(a.created_at),
    )
  })
}

/**
 * Caches an authoritative RLS-scoped read of support tickets.
 *
 * `ownerId` is the account the read covers, or `null` for the staff-wide
 * queue. Server-owned rows (uuid ids) are replaced by what the server now
 * holds, and rows the read no longer covers are REMOVED — a ticket the
 * backend no longer lists must not live on in the browser. Local-only rows
 * (the `inq_…` ids the offline driver, anonymous visitors and admin-logged
 * phone tickets mint) are preserved, and a null read (failed fetch)
 * touches nothing.
 */
export function mirrorRemoteInquiries(
  remote: Inquiry[] | null,
  ownerId: string | null,
): void {
  if (remote === null) return

  const current = getDb().inquiries

  const isRemoteOwned = (i: Inquiry) => isUuid(i.inquiry_id)
  const inScope = (i: Inquiry) =>
    isRemoteOwned(i) && (ownerId === null || i.user_id === ownerId)

  const remoteIds = new Set(remote.map((r) => r.inquiry_id))
  const survivors = current.filter(
    (i) => !inScope(i) || remoteIds.has(i.inquiry_id),
  )

  const changed =
    survivors.length !== current.length ||
    remote.some((row) => {
      const existing = current.find((i) => i.inquiry_id === row.inquiry_id)
      return !existing || JSON.stringify(existing) !== JSON.stringify(row)
    })

  if (!changed) return

  mutate((db) => {
    const byId = new Map(survivors.map((i) => [i.inquiry_id, i]))
    for (const row of remote) byId.set(row.inquiry_id, row)
    db.inquiries = [...byId.values()].sort((a, b) =>
      b.created_at.localeCompare(a.created_at),
    )
  })
}

/**
 * Merges server-held conversation messages into the local document.
 *
 * Append-only, and deliberately so: nothing in the product deletes a note
 * (there is no DELETE policy anywhere), so a merge can never lose one.
 * That also means a customer's browser, which only ever reads the public
 * half of its own conversations, can never prune an internal annotation
 * belonging to a staff session sharing the same document — each side keeps
 * what it may read, and neither side loses what the other holds.
 */
export function upsertRemoteInquiryNotes(rows: InquiryNote[]): void {
  if (rows.length === 0) return

  const current = getDb().inquiry_notes

  const changed = rows.some((row) => {
    const existing = current.find((n) => n.note_id === row.note_id)

    return (
      !existing ||
      existing.content !== row.content ||
      existing.internal !== row.internal ||
      existing.author_id !== row.author_id
    )
  })

  if (!changed) return

  mutate((db) => {
    const byId = new Map(db.inquiry_notes.map((n) => [n.note_id, n]))
    for (const row of rows) byId.set(row.note_id, row)
    db.inquiry_notes = [...byId.values()]
  })
}

/* ── Customers ────────────────────────────────────────── */

export interface CustomerProfile {
  user: User

  orders: Order[]

  order_count: number

  paid_order_count: number

  total_spend: number

  refunded_total: number

  refunds: Refund[]

  entitlements: UserProduct[]

  inquiries: Inquiry[]

  last_purchase_at?: string

  first_order_at?: string
}

export function listUsers(actor: Actor | null): Result<User[]> {
  const denied = guard(actor, "users")

  if (denied) return denied

  return ok(getDb().users.map(toPublicUser))
}

/** Internal read used by services; never returns credential material. */

export function findUser(userId: string): User | undefined {
  const stored = getDb().users.find((u) => u.user_id === userId)

  return stored ? toPublicUser(stored) : undefined
}

export function findUserByEmail(email: string): User | undefined {
  const stored = getDb().users.find((u) => u.email === normalizeEmail(email))

  return stored ? toPublicUser(stored) : undefined
}

export function getCustomerProfile(
  actor: Actor | null,
  userId: string,
): Result<CustomerProfile> {
  const denied = guard(actor, "users")

  if (denied) return denied

  const db = getDb()

  const stored = db.users.find((u) => u.user_id === userId)

  if (!stored) return fail("NOT_FOUND", "הלקוח לא נמצא.")

  const orders = db.orders

    .filter((o) => o.user_id === userId || o.customer_email === stored.email)

    .sort((a, b) => b.created_at.localeCompare(a.created_at))

  const paid = orders.filter(
    (o) =>
      o.payment_status === "PAID" ||
      o.payment_status === "REFUNDED" ||
      o.payment_status === "PARTIALLY_REFUNDED",
  )

  const orderIds = new Set(orders.map((o) => o.order_id))

  return ok({
    user: toPublicUser(stored),

    orders,

    order_count: orders.length,

    paid_order_count: paid.length,

    total_spend: paid.reduce((sum, o) => sum + o.total_amount, 0),

    refunded_total: db.refunds

      .filter((r) => orderIds.has(r.order_id) && r.status === "REFUNDED")

      .reduce((sum, r) => sum + r.amount, 0),

    refunds: db.refunds.filter((r) => orderIds.has(r.order_id)),

    entitlements: db.user_products.filter((up) => up.user_id === userId),

    inquiries: db.inquiries.filter(
      (i) => i.user_id === userId || i.customer_email === stored.email,
    ),

    last_purchase_at: paid[0]?.paid_at ?? paid[0]?.created_at,

    first_order_at:
      orders.length > 0 ? orders[orders.length - 1].created_at : undefined,
  })
}

export function updateUser(
  actor: Actor | null,

  userId: string,

  patch: Partial<Pick<User, "first_name" | "last_name" | "email" | "phone" | "admin_role" | "role">>,

  auditAction?: string,

  auditCategory?: AuditCategory,
): Result<User> {
  const denied = guard(actor, "users")

  if (denied) return denied

  if (patch.admin_role !== undefined || patch.role !== undefined) {
    const roleDenied = guard(actor, "manage_roles")

    if (roleDenied) return roleDenied
  }

  const db = getDb()

  const existing = db.users.find((u) => u.user_id === userId)

  if (!existing) return fail("NOT_FOUND", "המשתמש לא נמצא.")

  if (patch.email) {
    const email = normalizeEmail(patch.email)

    if (!isEmail(email)) return fail("VALIDATION", "כתובת המייל אינה תקינה.")

    if (db.users.some((u) => u.email === email && u.user_id !== userId)) {
      return fail("CONFLICT", "כתובת מייל זו כבר משויכת לחשבון אחר.")
    }

    patch = { ...patch, email }
  }

  const updated = mutate((d) => {
    d.users = d.users.map((u) =>
      u.user_id === userId ? { ...u, ...patch, updated_at: nowIso() } : u,
    )

    return d.users.find((u) => u.user_id === userId)!
  })

  if (auditAction) {
    writeAudit(actor, {
      category: auditCategory ?? "OTHER",

      action: auditAction,

      target_type: "USER",

      target_id: userId,

      target_label: `${existing.first_name} ${existing.last_name}`,

      details: Object.keys(patch).join(", ") || auditAction,
    })
  }

  return ok(toPublicUser(updated))
}

/** Audit wording for a status change, shared by the local and the Supabase
 * write paths so the log reads identically whichever store served it. */
function statusActionLabel(status: User["account_status"]): string {
  if (status === "ACTIVE") return "הפעלת חשבון"

  if (status === "SUSPENDED") return "השעיית חשבון"

  return "סגירת חשבון"
}

export async function setUserStatus(
  actor: Actor | null,

  userId: string,

  status: User["account_status"],
): Promise<Result<User>> {
  const denied = guard(actor, "block_user")

  if (denied) return denied

  /* Supabase owns authenticated accounts; `db.users` only ever holds records
   * this browser created. Resolving the customer locally is what made every
   * ban report "המשתמש לא נמצא." for an account that had in fact registered —
   * the same read/write split that once hid those users from the admin list.
   */
  if (isSupabaseConfigured) {
    const remote = await updateAccountStatus(userId, status)

    if (!remote.ok) {
      /* Each refusal keeps its own code all the way to the dialog. Flattening
       * them into NOT_FOUND is what turned a deliberate refusal into a
       * "missing user" message, and the dialog needs ADMIN_PROTECTED to know
       * it must answer with an explanation popup instead of the red line. */
      if (remote.code === "ADMIN_PROTECTED") {
        return fail("ADMIN_PROTECTED", remote.error)
      }

      if (remote.code === "FORBIDDEN") return fail("FORBIDDEN", remote.error)

      if (remote.code === "NOT_FOUND") return fail("NOT_FOUND", remote.error)

      /* Anything else — an unmapped migration token included — is a refusal
       * from the server, never a claim that the account is absent. */
      return fail("VALIDATION", remote.error)
    }

    writeAudit(actor, {
      category: "USER_BLOCK",

      action: statusActionLabel(status),

      target_type: "USER",

      target_id: userId,

      target_label: `${remote.data.first_name} ${remote.data.last_name}`,

      details: status,
    })

    return ok(remote.data)
  }

  const existing = getDb().users.find((u) => u.user_id === userId)

  if (!existing) return fail("NOT_FOUND", "המשתמש לא נמצא.")

  /* The local store mirrors the Supabase rule: staff rows are never a valid
   * target for suspension. Without Supabase in play this is an offline-only
   * browser, but the same click must carry the same code so the dialog answers
   * with the same popup everywhere. */
  if (existing.role === "ADMIN" && status !== "ACTIVE") {
    return fail("ADMIN_PROTECTED", "לא ניתן להשהות או לסגור חשבון מנהל.")
  }

  const updated = mutate((db) => {
    db.users = db.users.map((u) =>
      u.user_id === userId
        ? { ...u, account_status: status, updated_at: nowIso() }
        : u,
    )

    return db.users.find((u) => u.user_id === userId)!
  })

  writeAudit(actor, {
    category: "USER_BLOCK",

    action: statusActionLabel(status),

    target_type: "USER",

    target_id: userId,

    target_label: `${existing.first_name} ${existing.last_name}`,

    details: `${existing.account_status} → ${status}`,
  })

  return ok(toPublicUser(updated))
}

export function setUserAdminRole(
  actor: Actor | null,
  userId: string,
  adminRole: AdminRole,
): Result<User> {
  return updateUser(
    actor,
    userId,
    { admin_role: adminRole },
    "שינוי תפקיד מנהל",
    "ROLE_CHANGE",
  )
}

/* ── Entitlements ─────────────────────────────────────── */

export function listUserProducts(): UserProduct[] {
  return getDb().user_products
}

/**
 * Caches the signed-in account's own Supabase entitlements in the local
 * document.
 *
 * The reader and the library read entitlements from the store, so a book
 * bought or granted on the server has to be visible there before it can
 * be opened. Callers pass only the signed-in user's own rows — this is a
 * cache of one account's access, never a copy of anyone else's.
 *
 * Merge is by `user_id` + `product_id`. Rows that came from Supabase are
 * replaced by what the server now holds and — crucially — rows the
 * server no longer holds are REMOVED: otherwise הסרה מלאה deleted the
 * row in Postgres while `hasAccess` went on reading a stale local copy
 * forever, and the customer kept a book the database said they did not
 * own. Pruning is safe precisely because the input is an authoritative
 * RLS-scoped read of every row the account has.
 *
 * Local-only rows are preserved. They carry a local `up_…` id (Supabase
 * rows always carry a uuid), which is also what keeps a non-Supabase
 * install working: there `fetchMyEntitlements` resolves to null — as it
 * does on any failed read — and null is treated as "no data, touch
 * nothing", so the document is never wiped on a hiccup.
 */
export function mirrorRemoteEntitlements(remote: UserProduct[] | null): void {
  /* null = the fetch itself failed (network/refused). Cache must not
   * prune on absent data — only on a successful read that proves the
   * rows are gone. */
  if (remote === null) return

  const keyOf = (up: UserProduct) => `${up.user_id}:${up.product_id}`
  const isLocalOnly = (up: UserProduct) => !isUuid(up.user_product_id)

  const current = getDb().user_products

  /* Which local rows would survive this mirror? Local-only rows always;
   * remote-owned rows only if the server still lists them. */
  const remoteKeys = new Set(remote.map(keyOf))
  const survivors = current.filter(
    (up) => isLocalOnly(up) || remoteKeys.has(keyOf(up)),
  )

  const changed =
    survivors.length !== current.length ||
    remote.some((row) => {
      const existing = current.find((up) => keyOf(up) === keyOf(row))

      return !existing || JSON.stringify(existing) !== JSON.stringify(row)
    })

  if (!changed) return

  mutate((db) => {
    /* Build the next document from the union, not by mapping over the
     * existing rows: a row the server added (החזרת הרשאה after הסרה
     * מלאה) has no existing counterpart, and mapping over what is
     * already here would drop it — the mirror could then never re-add
     * an entitlement the admin had removed and re-granted. */
    const next = new Map<string, UserProduct>()

    db.user_products.forEach((up) => {
      if (isLocalOnly(up) || remoteKeys.has(keyOf(up)))
        next.set(keyOf(up), up)
    })

    /* Fresh server state wins where a row exists in both; local-only
     * rows keep their place; remote-owned rows the server no longer
     * lists were never copied into `next`, which is the prune. */
    remote.forEach((row) => next.set(keyOf(row), row))

    db.user_products = [...next.values()]
  })
}

export function listReadingProgress(): ReadingProgress[] {
  return getDb().reading_progress
}

/** Grants access for every product covered by an order, expanding bundles. */

export function grantAccessForOrder(order: Order, products: Product[]): void {
  const targets: Product[] = []

  order.items.forEach((item) => {
    const product = products.find((p) => p.product_id === item.product_id)

    if (!product) return

    targets.push(product)

    if (product.product_type === "BUNDLE") {
      ;(product.bundle_item_ids ?? []).forEach((childId) => {
        const child = products.find((p) => p.product_id === childId)

        if (child) targets.push(child)
      })
    }
  })

  mutate((db) => {
    targets.forEach((product) => {
      const existing = db.user_products.find(
        (up) =>
          up.user_id === order.user_id && up.product_id === product.product_id,
      )

      if (existing) {
        db.user_products = db.user_products.map((up) =>
          up.user_product_id === existing.user_product_id
            ? {
                ...up,
                access_status: "ACTIVE",
                source_order_id: up.source_order_id ?? order.order_id,
              }
            : up,
        )

        return
      }

      db.user_products = [
        ...db.user_products,

        {
          user_product_id: uid("up"),

          user_id: order.user_id,

          product_id: product.product_id,

          product_snapshot: snapshotProduct(product),

          source_order_id: order.order_id,

          access_status: "ACTIVE",

          granted_at: nowIso(),
        },
      ]
    })
  })
}

/**
 * Grants one account access to one product.
 *
 * Supabase owns authenticated accounts and the entitlement table, so for
 * a real account (`public.users.user_id`, a uuid) the write goes through
 * the admin-guarded `admin_grant_access` function. Resolving the customer
 * in `db.users` first is what made every manual grant to a registered
 * user fail with "המשתמש לא נמצא." — the same read/write split already
 * repaired for `setUserStatus`. Only the local, non-Supabase install
 * still resolves and writes locally, where the id is genuinely local.
 */
export async function grantAccess(
  actor: Actor | null,

  userId: string,

  productId: string,

  sourceOrderId?: string,
): Promise<Result<UserProduct>> {
  const denied = guard(actor, "grant_access")

  if (denied) return denied

  /* A uuid target can only be a Supabase account: the admin list sourced
   * it from `public.users`. The entitlement is created server-side, where
   * the snapshot is captured from the catalogue and `is_admin()` is the
   * real gate. */
  if (isSupabaseConfigured && isUuid(userId)) {
    /* The entitlement's FK points at a real catalogue row, so a product id
     * that is not a uuid cannot be one. Reported clearly rather than
     * letting Postgres fail the cast with an opaque message. */
    if (!isUuid(productId)) {
      return fail(
        "VALIDATION",
        "המוצר שנבחר אינו קיים בקטלוג השרת. יש לרענן את הקטלוג ולנסות שוב.",
      )
    }

    const remote = await adminGrantAccess(userId, productId, sourceOrderId)

    if (!remote.ok) return remote

    writeAudit(actor, {
      category: "ACCESS_CHANGE",

      action: "פתיחת גישה למוצר",

      target_type: "ACCESS",

      target_id: productId,

      target_label: remote.data.product_snapshot.name || productId,

      details: sourceOrderId
        ? `הוענק מתוך הזמנה ${sourceOrderId}`
        : "הוענק ידנית על ידי מנהל",
    })

    return remote
  }

  const db = getDb()

  const product = db.products.find((p) => p.product_id === productId)

  if (!product) return fail("NOT_FOUND", "המוצר לא נמצא.")

  const user = db.users.find((u) => u.user_id === userId)

  if (!user) return fail("NOT_FOUND", "המשתמש לא נמצא.")

  const grant = mutate((d) => {
    const existing = d.user_products.find(
      (up) => up.user_id === userId && up.product_id === productId,
    )

    if (existing) {
      const next: UserProduct = {
        ...existing,

        access_status: "ACTIVE",

        product_snapshot: snapshotProduct(product),

        source_order_id: existing.source_order_id ?? sourceOrderId,
      }

      d.user_products = d.user_products.map((up) =>
        up.user_product_id === existing.user_product_id ? next : up,
      )

      return next
    }

    const created: UserProduct = {
      user_product_id: uid("up"),

      user_id: userId,

      product_id: productId,

      product_snapshot: snapshotProduct(product),

      source_order_id: sourceOrderId,

      access_status: "ACTIVE",

      granted_at: nowIso(),
    }

    d.user_products = [...d.user_products, created]

    return created
  })

  writeAudit(actor, {
    category: "ACCESS_CHANGE",

    action: "פתיחת גישה למוצר",

    target_type: "ACCESS",

    target_id: productId,

    target_label: `${user.first_name} ${user.last_name} · ${product.name}`,

    details: sourceOrderId
      ? `הוענק מתוך הזמנה ${sourceOrderId}`
      : "הוענק ידנית על ידי מנהל",
  })

  return ok(grant)
}

/**
 * Changes the status of an existing entitlement.
 *
 * A uuid entitlement id belongs to Supabase; the write goes through
 * `admin_set_access_status`, which also cascades the change to every
 * content grant already minted for the row. A local row keeps the local
 * behaviour below.
 */
export async function setAccessStatus(
  actor: Actor | null,

  userProductId: string,

  status: UserProduct["access_status"],

  actionLabel?: string,
): Promise<Result> {
  const denied = guard(actor, "grant_access")

  if (denied) return denied

  if (isSupabaseConfigured && isUuid(userProductId)) {
    const remote = await adminSetAccessStatus(userProductId, status)

    if (!remote.ok) return remote

    writeAudit(actor, {
      category: "ACCESS_CHANGE",

      action: actionLabel ?? "שינוי הרשאת גישה",

      target_type: "ACCESS",

      target_id: userProductId,

      target_label: remote.data.product_snapshot.name || remote.data.user_id,

      details: status,
    })

    return ok(undefined)
  }

  const db = getDb()

  const target = db.user_products.find(
    (up) => up.user_product_id === userProductId,
  )

  if (!target) return fail("NOT_FOUND", "הרשאת הגישה לא נמצאה.")

  mutate((d) => {
    d.user_products = d.user_products.map((up) =>
      up.user_product_id === userProductId
        ? { ...up, access_status: status }
        : up,
    )
  })

  /* A status that is not ACTIVE means the customer may not open the file, so
   * every grant already minted for this entitlement has to die with it — one
   * may be sitting in a reader tab or on a phone right now. The SQL schema
   * does the same through trg_user_product_revokes_grants. */

  if (status !== "ACTIVE") {
    revokeGrantsForEntitlement(
      userProductId,
      `הגישה שונתה ל${status} על ידי ${actor?.name ?? "מנהל"}`,
    )
  }

  const owner = db.users.find((u) => u.user_id === target.user_id)

  writeAudit(actor, {
    category: "ACCESS_CHANGE",

    action: actionLabel ?? "שינוי הרשאת גישה",

    target_type: "ACCESS",

    target_id: userProductId,

    target_label: `${
      owner ? `${owner.first_name} ${owner.last_name}` : target.user_id
    } · ${target.product_snapshot.name}`,

    details: `${target.access_status} → ${status}`,
  })

  return ok(undefined)
}

/** Removes an entitlement outright; Supabase rows go through the admin RPC. */
export async function removeAccess(
  actor: Actor | null,
  userProductId: string,
): Promise<Result> {
  const denied = guard(actor, "grant_access")

  if (denied) return denied

  if (isSupabaseConfigured && isUuid(userProductId)) {
    const remote = await adminRemoveAccess(userProductId)

    if (!remote.ok) return remote

    writeAudit(actor, {
      category: "ACCESS_CHANGE",

      action: "הסרת גישה לצמיתות",

      target_type: "ACCESS",

      target_id: userProductId,

      target_label: userProductId,

      details: "הרשאת הגישה נמחקה לחלוטין",
    })

    return ok(undefined)
  }

  const db = getDb()

  const target = db.user_products.find(
    (up) => up.user_product_id === userProductId,
  )

  if (!target) return fail("NOT_FOUND", "הרשאת הגישה לא נמצאה.")

  mutate((d) => {
    d.user_products = d.user_products.filter(
      (up) => up.user_product_id !== userProductId,
    )
  })

  /* Deleting the entitlement row removes the thing the grants point at, but
   * not the grants themselves — they are kept, marked revoked, so the audit
   * trail still shows which file was in whose hands when access was pulled. */

  revokeGrantsForEntitlement(
    userProductId,
    `הגישה הוסרה לצמיתות על ידי ${actor?.name ?? "מנהל"}`,
  )

  const owner = db.users.find((u) => u.user_id === target.user_id)

  writeAudit(actor, {
    category: "ACCESS_CHANGE",

    action: "הסרת גישה לצמיתות",

    target_type: "ACCESS",

    target_id: userProductId,

    target_label: `${
      owner ? `${owner.first_name} ${owner.last_name}` : target.user_id
    } · ${target.product_snapshot.name}`,

    details: "הרשאת הגישה נמחקה לחלוטין",
  })

  return ok(undefined)
}

/** How often a reader's `last_activity_at` stamp may be rewritten. */

const ACTIVITY_STAMP_MS = 60_000

/** Customer-scoped: a reader can only ever write progress for their own account. */

export function saveReadingProgress(
  actor: Actor | null,

  productId: string,

  page: number,

  totalPages: number,
): Result<ReadingProgress> {
  if (!actor)
    return fail("UNAUTHENTICATED", "יש להתחבר כדי לשמור התקדמות קריאה.")

  const db = getDb()

  const entitled = db.user_products.some(
    (up) =>
      up.user_id === actor.user_id &&
      up.product_id === productId &&
      up.access_status === "ACTIVE",
  )

  if (!entitled) return fail("FORBIDDEN", "אין לך גישה פעילה למוצר זה.")

  const safeTotal = Math.max(1, totalPages)

  const percent = Math.round((page / safeTotal) * 100 * 10) / 10

  const at = nowIso()

  const existing = db.reading_progress.find(
    (rp) => rp.user_id === actor.user_id && rp.product_id === productId,
  )

  const progressChanged =
    !existing ||
    existing.current_page !== page ||
    existing.progress_percent !== percent

  /* `last_activity_at` is the admin-facing "last seen" stamp, so minute
   * resolution is more than enough for it. */

  const me = db.users.find((u) => u.user_id === actor.user_id)

  const stampActivity =
    !me?.last_activity_at ||
    Date.now() - new Date(me.last_activity_at).getTime() > ACTIVITY_STAMP_MS

  if (existing && !progressChanged && !stampActivity) return ok(existing)

  /* One conditional write, where this used to be two unconditional ones.
   *
   * mutate() replaces the whole document object and notifies every store
   * subscriber synchronously, so a write here is never local: it re-renders
   * AppContext, which rebuilds `user` and `actor`, which rebuilds every
   * callback keyed on them — including the one the reader's "save on page
   * change" effect depends on. Saving progress therefore re-ran the effect
   * that saved it, and React bailed out with "maximum update depth
   * exceeded" before the book ever reached the screen. Writing only what
   * actually changed breaks that cycle at its source. */

  const saved = mutate((d) => {
    let row: ReadingProgress

    if (existing) {
      row = progressChanged
        ? {
            ...existing,
            current_page: page,
            progress_percent: percent,
            last_read_at: at,
          }
        : existing

      if (progressChanged) {
        d.reading_progress = d.reading_progress.map((rp) =>
          rp.progress_id === existing.progress_id ? row : rp,
        )
      }
    } else {
      row = {
        progress_id: uid("rp"),

        user_id: actor.user_id,

        product_id: productId,

        current_page: page,

        progress_percent: percent,

        last_read_at: at,
      }

      d.reading_progress = [...d.reading_progress, row]
    }

    if (stampActivity) {
      d.users = d.users.map((u) =>
        u.user_id === actor.user_id ? { ...u, last_activity_at: at } : u,
      )
    }

    return row
  })

  return ok(saved)
}
