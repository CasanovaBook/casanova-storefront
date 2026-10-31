/* ─────────────────────────────────────────────────────────────
 * Hosted reader annotations - bookmarks, highlights and notes.
 *
 * Every query filters by the caller's user_id even though RLS enforces
 * the same predicate: the client-side filter keeps a compromised or
 * misconfigured policy from widening a list, and it makes the intended
 * scope explicit at the call site.
 *
 * All functions resolve; none reject. A missing table (migration 0034 not
 * deployed) surfaces as a normal Result failure so the reader can keep
 * rendering the book without its annotation controls.
 * ───────────────────────────────────────────────────────────── */

import type {
  HighlightRect,
  ReaderBookmark,
  ReaderHighlight,
} from "../../types"
import { fail, ok, type Failure, type Result } from "../../shared/result"
import {
  DEFAULT_HIGHLIGHT_COLOR,
  isHighlightColor,
  normalizeAnnotationPage,
  normalizeHighlightRects,
  normalizeNote,
  normalizeQuote,
} from "../../lib/annotation-utils"
import { isSupabaseConfigured, requireSupabase } from "./supabase"

interface BookmarkRow {
  bookmark_id: string
  user_id: string
  product_id: string
  page: number | string
  created_at: string
}

interface HighlightRow {
  highlight_id: string
  user_id: string
  product_id: string
  page: number | string
  color: string
  rects: unknown
  quote: string
  note?: string | null
  created_at: string
  updated_at: string
}

function toBookmark(row: BookmarkRow): ReaderBookmark {
  return {
    bookmark_id: String(row.bookmark_id),
    user_id: String(row.user_id),
    product_id: String(row.product_id),
    page: normalizeAnnotationPage(row.page),
    created_at: String(row.created_at),
  }
}

function toHighlight(row: HighlightRow): ReaderHighlight {
  const note = normalizeNote(row.note)

  return {
    highlight_id: String(row.highlight_id),
    user_id: String(row.user_id),
    product_id: String(row.product_id),
    page: normalizeAnnotationPage(row.page),
    color: isHighlightColor(row.color) ? row.color : DEFAULT_HIGHLIGHT_COLOR,
    rects: normalizeHighlightRects(row.rects),
    quote: normalizeQuote(row.quote),
    ...(note ? { note } : {}),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at ?? row.created_at),
  }
}

function storageFailure(error: { message?: string } | null): Failure {
  return fail("STORAGE", error?.message || "שמירת הסימניות נכשלה.")
}

export async function fetchReaderBookmarksFromDb(
  userId: string,
  productId: string,
): Promise<Result<ReaderBookmark[]>> {
  if (!isSupabaseConfigured) {
    return fail("PROVIDER_NOT_CONFIGURED", "שרת Supabase אינו מוגדר.")
  }

  const { data, error } = await requireSupabase()
    .from("reader_bookmarks")
    .select("bookmark_id, user_id, product_id, page, created_at")
    .eq("user_id", userId)
    .eq("product_id", productId)
    .order("page", { ascending: true })
    .order("created_at", { ascending: true })

  if (error) return storageFailure(error)

  return ok(((data ?? []) as BookmarkRow[]).map(toBookmark))
}

export async function createReaderBookmarkInDb(
  userId: string,
  productId: string,
  page: number,
): Promise<Result<ReaderBookmark>> {
  if (!isSupabaseConfigured) {
    return fail("PROVIDER_NOT_CONFIGURED", "שרת Supabase אינו מוגדר.")
  }

  const { data, error } = await requireSupabase()
    .from("reader_bookmarks")
    .insert({ user_id: userId, product_id: productId, page })
    .select("bookmark_id, user_id, product_id, page, created_at")
    .single()

  if (error) {
    /* A retry or a double-click can race the unique (user, product, page)
     * constraint; return the row that already exists instead of an error. */
    if (error.code === "23505") {
      const existing = await requireSupabase()
        .from("reader_bookmarks")
        .select("bookmark_id, user_id, product_id, page, created_at")
        .eq("user_id", userId)
        .eq("product_id", productId)
        .eq("page", page)
        .maybeSingle()

      if (!existing.error && existing.data) {
        return ok(toBookmark(existing.data as BookmarkRow))
      }
    }

    return storageFailure(error)
  }

  if (!data) return fail("STORAGE", "הסימנייה לא נשמרה.")
  return ok(toBookmark(data as BookmarkRow))
}

export async function deleteReaderBookmarkInDb(
  userId: string,
  bookmarkId: string,
): Promise<Result> {
  if (!isSupabaseConfigured) {
    return fail("PROVIDER_NOT_CONFIGURED", "שרת Supabase אינו מוגדר.")
  }

  const { error } = await requireSupabase()
    .from("reader_bookmarks")
    .delete()
    .eq("bookmark_id", bookmarkId)
    .eq("user_id", userId)

  if (error) return storageFailure(error)

  return ok(undefined)
}

export async function fetchReaderHighlightsFromDb(
  userId: string,
  productId: string,
): Promise<Result<ReaderHighlight[]>> {
  if (!isSupabaseConfigured) {
    return fail("PROVIDER_NOT_CONFIGURED", "שרת Supabase אינו מוגדר.")
  }

  const { data, error } = await requireSupabase()
    .from("reader_highlights")
    .select(
      "highlight_id, user_id, product_id, page, color, rects, quote, note, created_at, updated_at",
    )
    .eq("user_id", userId)
    .eq("product_id", productId)
    .order("page", { ascending: true })
    .order("created_at", { ascending: true })

  if (error) return storageFailure(error)

  return ok(((data ?? []) as HighlightRow[]).map(toHighlight))
}

export async function createReaderHighlightInDb(
  userId: string,
  productId: string,
  input: {
    page: number
    color: string
    rects: HighlightRect[]
    quote: string
    note?: string
  },
): Promise<Result<ReaderHighlight>> {
  if (!isSupabaseConfigured) {
    return fail("PROVIDER_NOT_CONFIGURED", "שרת Supabase אינו מוגדר.")
  }

  const { data, error } = await requireSupabase()
    .from("reader_highlights")
    .insert({
      user_id: userId,
      product_id: productId,
      page: input.page,
      color: input.color,
      rects: input.rects,
      quote: input.quote,
      note: input.note ?? null,
    })
    .select(
      "highlight_id, user_id, product_id, page, color, rects, quote, note, created_at, updated_at",
    )
    .single()

  if (error) return storageFailure(error)
  if (!data) return fail("STORAGE", "ההדגשה לא נשמרה.")

  return ok(toHighlight(data as HighlightRow))
}

export async function updateReaderHighlightInDb(
  userId: string,
  highlightId: string,
  patch: {
    color?: string
    note?: string | null
    quote?: string
    rects?: HighlightRect[]
  },
): Promise<Result<ReaderHighlight>> {
  if (!isSupabaseConfigured) {
    return fail("PROVIDER_NOT_CONFIGURED", "שרת Supabase אינו מוגדר.")
  }

  const { data, error } = await requireSupabase()
    .from("reader_highlights")
    .update({
      ...patch,
      updated_at: new Date().toISOString(),
    })
    .eq("highlight_id", highlightId)
    .eq("user_id", userId)
    .select(
      "highlight_id, user_id, product_id, page, color, rects, quote, note, created_at, updated_at",
    )
    .maybeSingle()

  if (error) return storageFailure(error)
  if (!data) return fail("NOT_FOUND", "ההדגשה לא נמצאה.")

  return ok(toHighlight(data as HighlightRow))
}

export async function deleteReaderHighlightInDb(
  userId: string,
  highlightId: string,
): Promise<Result> {
  if (!isSupabaseConfigured) {
    return fail("PROVIDER_NOT_CONFIGURED", "שרת Supabase אינו מוגדר.")
  }

  const { error } = await requireSupabase()
    .from("reader_highlights")
    .delete()
    .eq("highlight_id", highlightId)
    .eq("user_id", userId)

  if (error) return storageFailure(error)

  return ok(undefined)
}
