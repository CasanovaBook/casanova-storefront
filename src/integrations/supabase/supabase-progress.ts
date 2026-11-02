/* ─────────────────────────────────────────────────────────────
 * Reading progress against Supabase.
 *
 * Position used to live only in this browser's localStorage, so "continue
 * where you left off" meant "where you left off on THIS device". Migration
 * 0038 makes the database the record; this is the client half.
 *
 * Two rules carried over from the device-session work, because they are what
 * made that one safe:
 *
 * 1. A failed read returns null, not an empty array. "The server did not
 *    answer" and "this reader has no progress" are different facts, and
 *    confusing them would reset somebody's page to 1 on a bad connection.
 *
 * 2. Writes go to an RPC, never to the table. user_id is stamped from the JWT
 *    and the entitlement is checked server-side, so a caller cannot write
 *    progress onto another account or about a title it does not hold.
 * ───────────────────────────────────────────────────────────── */

import type { ReadingProgress } from "../../types"
import { isSupabaseConfigured, requireSupabase } from "./supabase"
import { isUuid } from "./supabase-entitlements"

const PROGRESS_COLUMNS =
  "progress_id, user_id, product_id, current_page, progress_percent, last_read_at"

interface ProgressRow {
  progress_id: string
  user_id: string
  product_id: string
  current_page?: number | null
  progress_percent?: number | string | null
  last_read_at: string
}

/**
 * Maps a wire row onto the app's `ReadingProgress`.
 *
 * `progress_percent` arrives as a string from `NUMERIC(5,2)`, which is the
 * classic place a numeric column silently turns into NaN downstream.
 */
function toReadingProgress(row: ProgressRow): ReadingProgress {
  const percent = Number(row.progress_percent ?? 0)

  return {
    progress_id: row.progress_id,
    user_id: row.user_id,
    product_id: row.product_id,
    current_page: Math.max(1, row.current_page ?? 1),
    progress_percent: Number.isFinite(percent) ? percent : 0,
    last_read_at: row.last_read_at,
  }
}

/** Every saved position for this account, newest read first. */
export async function fetchMyReadingProgress(
  userId: string,
): Promise<ReadingProgress[] | null> {
  if (!isSupabaseConfigured) return null

  try {
    const { data, error } = await requireSupabase()
      .from("reading_progress")
      .select(PROGRESS_COLUMNS)
      .eq("user_id", userId)
      .order("last_read_at", { ascending: false })

    if (error) {
      console.warn("[progress] own progress read refused:", error.message)

      return null
    }

    return ((data ?? []) as ProgressRow[]).map(toReadingProgress)
  } catch (err) {
    console.warn("[progress] own progress read failed:", err)

    return null
  }
}

/**
 * One saved position, for the book being opened.
 *
 * Narrowed to a single product rather than reusing the whole-list read so the
 * restore path does not depend on how many other titles the account has.
 */
export async function fetchReadingProgressFor(
  productId: string,
): Promise<ReadingProgress | null> {
  /* Local catalogue ids are not UUIDs and the column is one. Sending them
   * would be a cast error at best and a wrong match at worst. */
  if (!isSupabaseConfigured || !isUuid(productId)) return null

  try {
    const { data, error } = await requireSupabase()
      .from("reading_progress")
      .select(PROGRESS_COLUMNS)
      .eq("product_id", productId)
      .maybeSingle()

    if (error) {
      console.warn("[progress] read refused:", error.message)

      return null
    }

    return data ? toReadingProgress(data as ProgressRow) : null
  } catch (err) {
    console.warn("[progress] read failed:", err)

    return null
  }
}

export interface ProgressWrite {
  productId: string
  currentPage: number
  progressPercent: number
  /**
   * When the reader reached this position on THIS device.
   *
   * Sent rather than left to the server clock because the conflict rule
   * compares moments, and the moment that matters is when a human turned the
   * page - not when a delayed request finally arrived.
   */
  lastReadAt: string
}

/**
 * Pushes the reading position. Returns the row the database now holds, which
 * may not be the one sent: a newer position from another device wins, and the
 * caller is told so rather than being left to believe its own.
 */
export async function saveReadingProgressRemote(
  input: ProgressWrite,
): Promise<ReadingProgress | null> {
  if (!isSupabaseConfigured || !isUuid(input.productId)) return null

  try {
    const { data, error } = await requireSupabase().rpc(
      "save_my_reading_progress",
      {
        p_product_id: input.productId,
        p_current_page: Math.max(1, Math.round(input.currentPage)),
        p_progress_percent: Math.min(100, Math.max(0, input.progressPercent)),
        p_last_read_at: input.lastReadAt,
      },
    )

    if (error) {
      /* not_entitled is a real answer about this book, not a transport
       * failure - the reader should stop pushing for it. */
      console.warn("[progress] write refused:", error.message)

      return null
    }

    return data ? toReadingProgress(data as ProgressRow) : null
  } catch (err) {
    console.warn("[progress] write failed:", err)

    return null
  }
}
