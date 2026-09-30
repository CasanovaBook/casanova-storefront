/* ─────────────────────────────────────────────────────────────
 * Supabase entitlements service — the server side of content access.
 *
 * `public.user_products` is the source of truth for "may this account
 * open this product?" (see the product brief, §11). The browser cannot
 * write it: RLS is row-level, so a policy wide enough for an admin to
 * grant someone else's access would also let a client forge one. Every
 * admin write therefore goes through the SECURITY DEFINER functions in
 * migrations/0015_admin_grant_access.sql, which check `is_admin()`
 * themselves. The browser only ever holds the caller's JWT.
 *
 * Reads are gated by the live RLS policies: a customer may read their
 * own rows, and this module never asks for anyone else's on the
 * customer path.
 *
 * Every function here resolves; none ever rejects. Callers in React
 * effects and click handlers should not have to defend against a thrown
 * network error, and the app's `Result` shape already carries failure.
 * ───────────────────────────────────────────────────────────── */

import type {
  AccessStatus,
  ProductSnapshot,
  ProductType,
  UserProduct,
} from "../types"
import { fail, ok, type ErrorCode, type Result } from "./api"
import { isSupabaseConfigured, requireSupabase } from "./supabase"

/** Columns this app reads back. `product_snapshot` is the JSONB snapshot. */
const ENTITLEMENT_COLUMNS =
  "user_product_id, user_id, product_id, product_snapshot, source_order_id, access_status, granted_at, expires_at"

/** The `public.user_products` row as it arrives over the wire. */
interface UserProductRow {
  user_product_id: string
  user_id: string
  product_id: string
  product_snapshot?: unknown
  source_order_id?: string | null
  access_status?: string | null
  granted_at: string
  expires_at?: string | null
}

/** A strict UUID test. Postgres casts RPC arguments, so a legacy `up_…`
 *  id or a local `ord_…` reference must never be sent as one. */
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/

export function isUuid(value: string | undefined | null): value is string {
  return typeof value === "string" && UUID_RE.test(value)
}

/**
 * Maps the JSONB snapshot onto the app's `ProductSnapshot`.
 *
 * Defensive on purpose: the row is written by the database, but an older
 * grant (or one written before a catalogue field existed) can lack a key.
 * Absent or null fields become `undefined`, which is what the optional
 * fields in the type mean and what the library/reader render against.
 */
function toSnapshot(raw: unknown): ProductSnapshot {
  const s = (raw ?? {}) as Record<string, unknown>
  const cover = Array.isArray(s.cover_colors) && s.cover_colors.length >= 2
    ? ([String(s.cover_colors[0]), String(s.cover_colors[1])] as [string, string])
    : undefined

  return {
    product_id: typeof s.product_id === "string" ? s.product_id : "",
    name: typeof s.name === "string" ? s.name : "",
    slug: typeof s.slug === "string" ? s.slug : "",
    product_type: (typeof s.product_type === "string"
      ? s.product_type
      : "EBOOK") as ProductType,
    cover_colors: cover,
    image_url: typeof s.image_url === "string" ? s.image_url : undefined,
    author_name: typeof s.author_name === "string" ? s.author_name : undefined,
    total_pages:
      typeof s.total_pages === "number" ? s.total_pages : undefined,
  }
}

/** Maps a `public.user_products` row onto the app's `UserProduct`. */
export function toUserProduct(row: UserProductRow): UserProduct {
  return {
    user_product_id: row.user_product_id,
    user_id: row.user_id,
    product_id: row.product_id,
    product_snapshot: toSnapshot(row.product_snapshot),
    source_order_id: row.source_order_id ?? undefined,
    access_status: (row.access_status || "ACTIVE") as AccessStatus,
    granted_at: row.granted_at,
    expires_at: row.expires_at ?? undefined,
  }
}

/**
 * Reads the signed-in customer's own entitlements.
 *
 * This is the missing half of the library: purchases and grants live in
 * Supabase, but the web app only ever read its local document, so a
 * paying customer's books were invisible. Scoped to one `user_id`, which
 * the RLS policy on `public.user_products` also enforces.
 *
 * Returns an empty array when Supabase is unconfigured or the read is
 * refused. Callers must treat that as "no remote data", never as "this
 * account owns nothing" — the local document is still merged in.
 */
export async function fetchMyEntitlements(
  userId: string,
): Promise<UserProduct[]> {
  if (!isSupabaseConfigured) return []

  try {
    const { data, error } = await requireSupabase()
      .from("user_products")
      .select(ENTITLEMENT_COLUMNS)
      .eq("user_id", userId)

    if (error) {
      console.warn(
        "[supabase-entitlements] own entitlements refused:",
        error.message,
      )
      return []
    }

    return ((data ?? []) as UserProductRow[]).map(toUserProduct)
  } catch (err) {
    console.warn("[supabase-entitlements] own entitlements failed:", err)
    return []
  }
}

/**
 * Admin-only: every entitlement, for the access screens.
 *
 * Gated by the admin read policy on `public.user_products`. A refused
 * read returns an empty array rather than throwing, so the panel falls
 * back to whatever it already has instead of blanking the screen.
 */
export async function fetchAllEntitlements(): Promise<UserProduct[]> {
  if (!isSupabaseConfigured) return []

  try {
    const { data, error } = await requireSupabase()
      .from("user_products")
      .select(ENTITLEMENT_COLUMNS)

    if (error) {
      console.warn(
        "[supabase-entitlements] entitlements list refused:",
        error.message,
      )
      return []
    }

    return ((data ?? []) as UserProductRow[]).map(toUserProduct)
  } catch (err) {
    console.warn("[supabase-entitlements] entitlements list failed:", err)
    return []
  }
}

/**
 * Refusals raised by the access RPCs.
 *
 * Each is a bare `snake_case` token passed to `RAISE EXCEPTION` (see
 * migration 0015), not a sentence. Translating them here is what keeps a
 * machine token off a Hebrew screen and, more importantly, keeps a
 * deliberate refusal from being reported as a missing user.
 */
const ACCESS_REFUSALS: Record<string, { error: string; code: ErrorCode }> = {
  admin_required: {
    error: "אין הרשאה לשנות גישה. נדרשת הרשאת מנהל.",
    code: "FORBIDDEN",
  },
  user_not_found: {
    error: "המשתמש לא נמצא.",
    code: "NOT_FOUND",
  },
  product_not_found: {
    error: "המוצר לא נמצא.",
    code: "NOT_FOUND",
  },
  access_not_found: {
    error: "הרשאת הגישה לא נמצאה.",
    code: "NOT_FOUND",
  },
  invalid_status: {
    error: "סטטוס הגישה המבוקש אינו תקין.",
    code: "VALIDATION",
  },
  invalid_expiry: {
    error: "תאריך התוקף המבוקש אינו תקין.",
    code: "VALIDATION",
  },
}

/** Resolves a refused RPC to wording an admin can read, or `null` when the
 *  error is not one the functions raise on purpose. */
function describeAccessRefusal(
  code: string,
  message: string,
): { error: string; code: ErrorCode } | null {
  for (const token of Object.keys(ACCESS_REFUSALS)) {
    if (message.includes(token)) return ACCESS_REFUSALS[token]
  }

  if (code === "42501") return ACCESS_REFUSALS.admin_required
  if (code === "P0002") {
    return { error: "המשתמש או הרשאת הגישה לא נמצאו.", code: "NOT_FOUND" }
  }
  if (code === "22023") return ACCESS_REFUSALS.invalid_status

  /* P0001 is the generic SQLSTATE of `RAISE EXCEPTION`; an unmapped token
   * must not reach the admin as-is. */
  if (code === "P0001") {
    console.warn("[supabase-entitlements] unmapped RPC refusal:", message)
    return {
      error: "הפעולה נדחתה על ידי המערכת. יש לרענן את הרשימה ולנסות שוב.",
      code: "VALIDATION",
    }
  }

  return null
}

/** Pulls a single row out of an RPC's response, which may be an object or a
 *  one-element array depending on how PostgREST serialises the composite. */
function firstRow(data: unknown): UserProductRow | null {
  if (Array.isArray(data)) return (data[0] as UserProductRow) ?? null
  if (data && typeof data === "object") return data as UserProductRow
  return null
}

/**
 * Normalises one RPC call into the app's `Result`.
 *
 * `rpc` is typed loosely on purpose: the functions return a composite row,
 * and PostgREST may hand it back as that row or wrapped in an array. The
 * thrown-error branch exists because a network failure rejects rather
 * than answering with `{ error }`, and a caller in a click handler must
 * not have to catch it.
 */
async function callAccessRpc(
  fn: string,
  args: Record<string, unknown>,
): Promise<Result<UserProductRow>> {
  try {
    const { data, error } = await requireSupabase().rpc(fn, args)

    if (error) {
      const refused = describeAccessRefusal(error.code ?? "", error.message ?? "")
      if (refused) return fail(refused.code, refused.error)

      /* Surfaced verbatim on purpose: this is where "function …
       * does not exist" appears when migration 0015 has not been applied
       * yet, and masking that would hide the one clue that explains why
       * the button still fails. */
      return fail("STORAGE", error.message)
    }

    const row = firstRow(data)
    if (!row) return fail("STORAGE", "הפעולה לא הושלמה בשרת.")

    return ok(row)
  } catch (err) {
    return fail(
      "STORAGE",
      err instanceof Error ? err.message : "שגיאת רשת בלתי צפויה.",
    )
  }
}

/**
 * Admin-only: grants one account access to one product.
 *
 * The return value is the row as the database stored it — including the
 * snapshot built server-side — so the caller renders what actually
 * landed rather than what it asked for.
 */
export async function adminGrantAccess(
  userId: string,
  productId: string,
  sourceOrderId?: string,
): Promise<Result<UserProduct>> {
  if (!isSupabaseConfigured) {
    return fail("PROVIDER_NOT_CONFIGURED", "שרת Supabase אינו מוגדר.")
  }

  const args: Record<string, unknown> = {
    p_user_id: userId,
    p_product_id: productId,
  }

  /* Only a real order uuid may be forwarded: Postgres casts the argument,
   * and the panel's order picker is fed by the local store, whose ids are
   * `ord_…`. A local reference is provenance we cannot verify, so it is
   * dropped instead of failing the grant. */
  if (isUuid(sourceOrderId)) args.p_source_order_id = sourceOrderId

  const result = await callAccessRpc("admin_grant_access", args)

  return result.ok ? ok(toUserProduct(result.data)) : result
}

/** Admin-only: changes the status of an existing entitlement. */
export async function adminSetAccessStatus(
  userProductId: string,
  status: AccessStatus,
): Promise<Result<UserProduct>> {
  if (!isSupabaseConfigured) {
    return fail("PROVIDER_NOT_CONFIGURED", "שרת Supabase אינו מוגדר.")
  }

  const result = await callAccessRpc("admin_set_access_status", {
    p_user_product_id: userProductId,
    p_status: status,
  })

  return result.ok ? ok(toUserProduct(result.data)) : result
}

/** Admin-only: removes an entitlement outright. */
export async function adminRemoveAccess(
  userProductId: string,
): Promise<Result> {
  if (!isSupabaseConfigured) {
    return fail("PROVIDER_NOT_CONFIGURED", "שרת Supabase אינו מוגדר.")
  }

  try {
    const { error } = await requireSupabase().rpc("admin_remove_access", {
      p_user_product_id: userProductId,
    })

    if (error) {
      const refused = describeAccessRefusal(error.code ?? "", error.message ?? "")
      if (refused) return fail(refused.code, refused.error)
      return fail("STORAGE", error.message)
    }

    return ok(undefined)
  } catch (err) {
    return fail(
      "STORAGE",
      err instanceof Error ? err.message : "שגיאת רשת בלתי צפויה.",
    )
  }
}
