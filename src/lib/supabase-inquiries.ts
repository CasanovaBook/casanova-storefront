/* ─────────────────────────────────────────────────────────────
 * Supabase support-inquiries service — the server side of the
 * customer↔admin ticket flow.
 *
 * `public.inquiries` is the shared queue both interfaces read (the local
 * document remains a mirror/fallback). Customers create tickets through
 * `create_my_inquiry`, a SECURITY DEFINER function that stamps the sender
 * from the JWT — so a crafted request cannot choose its own identity —
 * and read only their own rows through the live RLS policies. Staff read
 * the whole queue and move tickets through their lifecycle under
 * `is_admin()`.
 *
 * Every function here resolves; none ever rejects. Callers in React
 * effects and click handlers should not have to defend against a thrown
 * network error, and the app's `Result` shape already carries failure.
 * ───────────────────────────────────────────────────────────── */

import type { Inquiry, InquiryStatus, InquiryTopic } from "../types"

import { fail, ok, type ErrorCode, type Result } from "./api"

import { isSupabaseConfigured, requireSupabase } from "./supabase"

/** Columns this app reads back. */
const INQUIRY_COLUMNS =
  "inquiry_id, ticket_number, customer_name, customer_email, customer_phone, subject, message, topic, status, source, user_id, related_order_id, assigned_to, created_at, updated_at, resolved_at"

/** The `public.inquiries` row as it arrives over the wire. */
interface InquiryRow {
  inquiry_id: string
  ticket_number: string
  customer_name: string
  customer_email: string
  customer_phone?: string | null
  subject: string
  message: string
  topic?: string | null
  status?: string | null
  source?: string | null
  user_id?: string | null
  related_order_id?: string | null
  assigned_to?: string | null
  created_at: string
  updated_at: string
  resolved_at?: string | null
}

/** Maps a `public.inquiries` row onto the app's `Inquiry`. */
export function toInquiry(row: InquiryRow): Inquiry {
  return {
    inquiry_id: row.inquiry_id,
    ticket_number: row.ticket_number,
    customer_name: row.customer_name,
    customer_email: row.customer_email,
    customer_phone: row.customer_phone ?? undefined,
    subject: row.subject,
    message: row.message,
    topic: (row.topic || "GENERAL") as InquiryTopic,
    status: (row.status || "NEW") as InquiryStatus,
    user_id: row.user_id ?? undefined,
    related_order_id: row.related_order_id ?? undefined,
    assigned_to: row.assigned_to ?? undefined,
    source: (row.source || "WEBSITE") as Inquiry["source"],
    created_at: row.created_at,
    updated_at: row.updated_at,
    resolved_at: row.resolved_at ?? undefined,
  }
}

/** Pulls a single row out of a PostgREST response, which may be an object
 *  or a one-element array depending on how the composite is serialised. */
function firstRow(data: unknown): InquiryRow | null {
  if (Array.isArray(data)) return (data[0] as InquiryRow) ?? null
  if (data && typeof data === "object") return data as InquiryRow
  return null
}

/** Resolves an RPC refusal token into the wording an Israeli customer or
 *  admin can read. Tokens are the exact strings `create_my_inquiry` raises
 *  (migration 0018), mirroring the STATUS_REFUSALS pattern in
 *  supabase-auth. Returns null for anything unmapped so the caller can
 *  keep the transport message visible for diagnosis. */
function describeInquiryRefusal(
  code: string,
  message: string,
): { error: string; code: ErrorCode } | null {
  if (message.includes("unauthenticated"))
    return {
      code: "UNAUTHENTICATED",
      error: "יש להתחבר לחשבון כדי לשלוח פנייה.",
    }

  if (message.includes("profile_missing"))
    return {
      code: "NOT_FOUND",
      error: "לא נמצא פרופיל עבור החשבון המחובר. נסו להתחבר מחדש.",
    }

  if (message.includes("validation_subject"))
    return { code: "VALIDATION", error: "יש למלא נושא." }

  if (message.includes("validation_message"))
    return {
      code: "VALIDATION",
      error: "ההודעה קצרה מדי — יש לתאר את הפנייה בפירוט.",
    }

  if (
    code === "42501" ||
    message.toLowerCase().includes("row-level security")
  )
    return { code: "FORBIDDEN", error: "אין הרשאה לבצע את הפעולה." }

  return null
}

/**
 * Reads the signed-in customer's own tickets, newest first.
 *
 * Scoped server-side by the RLS policy (`user_id = auth.uid()`), and
 * filtered again client-side — a read answered wider than one account's
 * rows (a missing or loosened policy) must never be mirrored into a
 * customer's document.
 *
 * Returns `null` when the read itself fails (network down, RLS refused,
 * Supabase unconfigured) so the caller can leave its cache untouched; an
 * empty array is a real "no tickets" answer.
 */
export async function fetchMyInquiries(
  userId: string,
): Promise<Inquiry[] | null> {
  if (!isSupabaseConfigured) return null

  try {
    const { data, error } = await requireSupabase()
      .from("inquiries")
      .select(INQUIRY_COLUMNS)
      .eq("user_id", userId)
      .order("created_at", { ascending: false })

    if (error) {
      console.warn(
        "[supabase-inquiries] own-tickets read refused:",
        error.message,
      )
      return null
    }

    return ((data ?? []) as InquiryRow[])
      .map(toInquiry)
      .filter((inquiry) => inquiry.user_id === userId)
  } catch (err) {
    console.warn(
      "[supabase-inquiries] own-tickets read failed:",
      err instanceof Error ? err.message : err,
    )
    return null
  }
}

/**
 * Reads the staff queue: every ticket the caller's JWT may see.
 *
 * RLS does the scoping — for an admin that is the whole table, for any
 * other signed-in account only its own rows, so the caller decides what
 * this fetch means. Returns `null` on a failed read, never on an empty
 * queue.
 */
export async function fetchAllInquiries(): Promise<Inquiry[] | null> {
  if (!isSupabaseConfigured) return null

  try {
    const { data, error } = await requireSupabase()
      .from("inquiries")
      .select(INQUIRY_COLUMNS)
      .order("created_at", { ascending: false })

    if (error) {
      console.warn(
        "[supabase-inquiries] queue read refused:",
        error.message,
      )
      return null
    }

    return ((data ?? []) as InquiryRow[]).map(toInquiry)
  } catch (err) {
    console.warn(
      "[supabase-inquiries] queue read failed:",
      err instanceof Error ? err.message : err,
    )
    return null
  }
}

export interface CreateMyInquiryInput {
  subject: string
  message: string
  topic?: InquiryTopic
  customer_phone?: string
  related_order_id?: string
}

/**
 * Creates a ticket for the signed-in account via the `create_my_inquiry`
 * RPC (migration 0018). The database stamps the identity from the JWT and
 * the `public.users` profile, so the caller never supplies — and cannot
 * influence — the name or address the ticket carries.
 *
 * The returned row is what the database stored, ticket number included.
 */
export async function createMyInquiry(
  input: CreateMyInquiryInput,
): Promise<Result<Inquiry>> {
  if (!isSupabaseConfigured) {
    return fail("PROVIDER_NOT_CONFIGURED", "שרת Supabase אינו מוגדר.")
  }

  try {
    const { data, error } = await requireSupabase().rpc("create_my_inquiry", {
      p_subject: input.subject,
      p_message: input.message,
      p_topic: input.topic ?? "GENERAL",
      p_customer_phone: input.customer_phone ?? null,
      p_related_order_id: input.related_order_id ?? null,
    })

    if (error) {
      const refused = describeInquiryRefusal(
        error.code ?? "",
        error.message ?? "",
      )

      if (refused) return fail(refused.code, refused.error)

      /* Surfaced verbatim on purpose: this is where "function
       * create_my_inquiry does not exist" appears when migration 0018 has
       * not been applied yet, and masking that would hide the one clue
       * that explains why submissions still fail. */
      return fail("STORAGE", error.message)
    }

    const row = firstRow(data)
    if (!row) return fail("STORAGE", "שמירת הפנייה לא הושלמה בשרת.")

    return ok(toInquiry(row))
  } catch (err) {
    return fail(
      "STORAGE",
      err instanceof Error ? err.message : "שגיאת רשת בלתי צפויה.",
    )
  }
}

export interface UpdateInquiryPatch {
  status?: InquiryStatus
  assigned_to?: string
  related_order_id?: string | null
  topic?: InquiryTopic
  subject?: string
  resolved_at?: string | null
}

/**
 * Staff-only: moves a remote ticket through its lifecycle. The UPDATE
 * lands in Postgres, so the `chk_inquiry_resolution` constraint and the
 * assignee-is-staff trigger still apply, and the realtime event it
 * produces is what pushes the change to every open interface.
 */
export async function updateInquiryRemote(
  inquiryId: string,
  patch: UpdateInquiryPatch,
): Promise<Result<Inquiry>> {
  if (!isSupabaseConfigured) {
    return fail("PROVIDER_NOT_CONFIGURED", "שרת Supabase אינו מוגדר.")
  }

  try {
    /* Only the keys the caller actually sent are written: a status-only
     * click must not clear an unrelated column. */
    const payload: Record<string, unknown> = {}

    if (patch.status !== undefined) {
      payload.status = patch.status

      /* resolved_at accompanies a status change only when the caller sent
       * one: a note-driven freshness bump (status unchanged) must leave a
       * resolved ticket's resolved_at intact — chk_inquiry_resolution
       * refuses a RESOLVED row without it. */
      if (patch.resolved_at !== undefined)
        payload.resolved_at = patch.resolved_at
    }

    if (patch.assigned_to !== undefined) payload.assigned_to = patch.assigned_to
    if (patch.related_order_id !== undefined)
      payload.related_order_id = patch.related_order_id
    if (patch.topic !== undefined) payload.topic = patch.topic
    if (patch.subject !== undefined) payload.subject = patch.subject

    const { data, error } = await requireSupabase()
      .from("inquiries")
      .update(payload)
      .eq("inquiry_id", inquiryId)
      .select(INQUIRY_COLUMNS)
      .single()

    if (error) {
      const refused = describeInquiryRefusal(
        error.code ?? "",
        error.message ?? "",
      )

      if (refused) return fail(refused.code, refused.error)

      if (error.code === "PGRST116")
        return fail("NOT_FOUND", "הפנייה לא נמצאה.")

      return fail("STORAGE", error.message)
    }

    if (!data) return fail("STORAGE", "העדכון לא הושלם בשרת.")

    return ok(toInquiry(data as InquiryRow))
  } catch (err) {
    return fail(
      "STORAGE",
      err instanceof Error ? err.message : "שגיאת רשת בלתי צפויה.",
    )
  }
}
