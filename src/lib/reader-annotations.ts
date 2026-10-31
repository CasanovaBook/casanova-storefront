/* ─────────────────────────────────────────────────────────────
 * Reader annotations - the persistence boundary for bookmarks,
 * highlights and notes.
 *
 * Hosted mode writes to the reader_bookmarks/reader_highlights tables,
 * whose RLS is scoped to auth.uid(). Local mode mirrors the same shape in
 * the local document so the reader remains usable without Supabase.
 * ───────────────────────────────────────────────────────────── */

import type {
  HighlightRect,
  ReaderBookmark,
  ReaderHighlight,
  UserProduct,
} from "../types"
import { fail, ok, type Failure, type Result } from "../shared/result"
import type { Actor } from "./api"
import { getDb, mutate, nowIso, uid } from "../data/db"
import { isSupabaseConfigured } from "../integrations/supabase/supabase"
import { isUuid } from "../integrations/supabase/supabase-entitlements"
import {
  createReaderBookmarkInDb,
  createReaderHighlightInDb,
  deleteReaderBookmarkInDb,
  deleteReaderHighlightInDb,
  fetchReaderBookmarksFromDb,
  fetchReaderHighlightsFromDb,
  updateReaderHighlightInDb,
} from "../integrations/supabase/supabase-reader"
import {
  DEFAULT_HIGHLIGHT_COLOR,
  isHighlightColor,
  normalizeAnnotationPage,
  normalizeHighlightRects,
  normalizeNote,
  normalizeQuote,
} from "./annotation-utils"

export interface ReaderAnnotations {
  bookmarks: ReaderBookmark[]
  highlights: ReaderHighlight[]
}

export interface HighlightInput {
  page: number
  color: string
  rects: HighlightRect[]
  quote: string
  note?: string
}

export interface HighlightPatch {
  color?: string
  note?: string | null
  quote?: string
  rects?: HighlightRect[]
}

function hosted(actor: Actor, productId: string): boolean {
  return (
    isSupabaseConfigured && isUuid(actor.user_id) && isUuid(productId)
  )
}

function activeEntitlement(
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

function localAccess(actor: Actor, productId: string): Failure | null {
  if (activeEntitlement(actor.user_id, productId)) return null
  return fail("FORBIDDEN", "אין לך גישה פעילה למוצר זה.")
}

function sortBookmarks(rows: ReaderBookmark[]): ReaderBookmark[] {
  return [...rows].sort(
    (a, b) => a.page - b.page || a.created_at.localeCompare(b.created_at),
  )
}

function sortHighlights(rows: ReaderHighlight[]): ReaderHighlight[] {
  return [...rows].sort(
    (a, b) => a.page - b.page || a.created_at.localeCompare(b.created_at),
  )
}

export async function fetchReaderAnnotations(
  actor: Actor | null,
  productId: string,
): Promise<Result<ReaderAnnotations>> {
  if (!actor)
    return fail("UNAUTHENTICATED", "יש להתחבר כדי לטעון סימניות והערות.")

  if (hosted(actor, productId)) {
    const [bookmarks, highlights] = await Promise.all([
      fetchReaderBookmarksFromDb(actor.user_id, productId),
      fetchReaderHighlightsFromDb(actor.user_id, productId),
    ])

    if (!bookmarks.ok) return bookmarks
    if (!highlights.ok) return highlights

    return ok({
      bookmarks: sortBookmarks(bookmarks.data),
      highlights: sortHighlights(highlights.data),
    })
  }

  const db = getDb()

  return ok({
    bookmarks: sortBookmarks(
      db.reader_bookmarks.filter(
        (row) =>
          row.user_id === actor.user_id && row.product_id === productId,
      ),
    ),
    highlights: sortHighlights(
      db.reader_highlights.filter(
        (row) =>
          row.user_id === actor.user_id && row.product_id === productId,
      ),
    ),
  })
}

export async function createReaderBookmark(
  actor: Actor | null,
  productId: string,
  page: number,
): Promise<Result<ReaderBookmark>> {
  if (!actor)
    return fail("UNAUTHENTICATED", "יש להתחבר כדי לשמור סימנייה.")

  const safePage = normalizeAnnotationPage(page)

  if (hosted(actor, productId)) {
    return createReaderBookmarkInDb(actor.user_id, productId, safePage)
  }

  const denied = localAccess(actor, productId)
  if (denied) return denied

  const db = getDb()

  const existing = db.reader_bookmarks.find(
    (row) =>
      row.user_id === actor.user_id &&
      row.product_id === productId &&
      row.page === safePage,
  )

  if (existing) return ok(existing)

  try {
    const created = mutate((draft) => {
      const row: ReaderBookmark = {
        bookmark_id: uid("bkm"),
        user_id: actor.user_id,
        product_id: productId,
        page: safePage,
        created_at: nowIso(),
      }

      draft.reader_bookmarks = [...draft.reader_bookmarks, row]

      return row
    })

    return ok(created)
  } catch {
    return fail("STORAGE", "שמירת הסימנייה נכשלה.")
  }
}

export async function deleteReaderBookmark(
  actor: Actor | null,
  bookmarkId: string,
): Promise<Result> {
  if (!actor)
    return fail("UNAUTHENTICATED", "יש להתחבר כדי למחוק סימנייה.")

  if (isSupabaseConfigured && isUuid(actor.user_id) && isUuid(bookmarkId)) {
    return deleteReaderBookmarkInDb(actor.user_id, bookmarkId)
  }

  try {
    mutate((draft) => {
      draft.reader_bookmarks = draft.reader_bookmarks.filter(
        (row) =>
          row.bookmark_id !== bookmarkId || row.user_id !== actor.user_id,
      )
    })

    return ok(undefined)
  } catch {
    return fail("STORAGE", "מחיקת הסימנייה נכשלה.")
  }
}

export async function createReaderHighlight(
  actor: Actor | null,
  productId: string,
  input: HighlightInput,
): Promise<Result<ReaderHighlight>> {
  if (!actor)
    return fail("UNAUTHENTICATED", "יש להתחבר כדי לשמור הדגשה.")

  const page = normalizeAnnotationPage(input.page)
  const quote = normalizeQuote(input.quote)
  const rects = normalizeHighlightRects(input.rects)

  if (!quote) return fail("VALIDATION", "לא נבחר טקסט להדגשה.")
  if (rects.length === 0)
    return fail("VALIDATION", "לא ניתן למקם את ההדגשה על העמוד.")

  const color = isHighlightColor(input.color)
    ? input.color
    : DEFAULT_HIGHLIGHT_COLOR

  const note = normalizeNote(input.note)

  if (hosted(actor, productId)) {
    return createReaderHighlightInDb(actor.user_id, productId, {
      page,
      color,
      rects,
      quote,
      note,
    })
  }

  const denied = localAccess(actor, productId)
  if (denied) return denied

  try {
    const created = mutate((draft) => {
      const row: ReaderHighlight = {
        highlight_id: uid("hl"),
        user_id: actor.user_id,
        product_id: productId,
        page,
        color,
        rects,
        quote,
        ...(note ? { note } : {}),
        created_at: nowIso(),
        updated_at: nowIso(),
      }

      draft.reader_highlights = [...draft.reader_highlights, row]

      return row
    })

    return ok(created)
  } catch {
    return fail("STORAGE", "שמירת ההדגשה נכשלה.")
  }
}

export async function updateReaderHighlight(
  actor: Actor | null,
  highlightId: string,
  patch: HighlightPatch,
): Promise<Result<ReaderHighlight>> {
  if (!actor)
    return fail("UNAUTHENTICATED", "יש להתחבר כדי לעדכן הערה.")

  const color =
    patch.color === undefined
      ? undefined
      : isHighlightColor(patch.color)
        ? patch.color
        : DEFAULT_HIGHLIGHT_COLOR

  const note =
    patch.note === undefined
      ? undefined
      : patch.note === null
        ? null
        : normalizeNote(patch.note) ?? null

  const rects =
    patch.rects === undefined
      ? undefined
      : normalizeHighlightRects(patch.rects)

  const quote =
    patch.quote === undefined ? undefined : normalizeQuote(patch.quote)

  if (
    isSupabaseConfigured &&
    isUuid(actor.user_id) &&
    isUuid(highlightId)
  ) {
    return updateReaderHighlightInDb(actor.user_id, highlightId, {
      ...(color === undefined ? {} : { color }),
      ...(note === undefined ? {} : { note }),
      ...(rects === undefined ? {} : { rects }),
      ...(quote === undefined ? {} : { quote }),
    })
  }

  const db = getDb()
  const existing = db.reader_highlights.find(
    (row) =>
      row.highlight_id === highlightId && row.user_id === actor.user_id,
  )

  if (!existing) return fail("NOT_FOUND", "ההדגשה לא נמצאה.")

  try {
    const updated = mutate((draft) => {
      let next: ReaderHighlight | undefined

      draft.reader_highlights = draft.reader_highlights.map((row) => {
        if (row.highlight_id !== highlightId) return row

        next = {
          ...row,
          ...(color === undefined ? {} : { color }),
          ...(rects === undefined ? {} : { rects }),
          ...(quote === undefined ? {} : { quote }),
          ...(note === undefined
            ? {}
            : note === null
              ? { note: undefined }
              : { note }),
          updated_at: nowIso(),
        }

        return next
      })

      return next as ReaderHighlight
    })

    return ok(updated)
  } catch {
    return fail("STORAGE", "עדכון ההערה נכשל.")
  }
}

export async function deleteReaderHighlight(
  actor: Actor | null,
  highlightId: string,
): Promise<Result> {
  if (!actor)
    return fail("UNAUTHENTICATED", "יש להתחבר כדי למחוק הדגשה.")

  if (isSupabaseConfigured && isUuid(actor.user_id) && isUuid(highlightId)) {
    return deleteReaderHighlightInDb(actor.user_id, highlightId)
  }

  try {
    mutate((draft) => {
      draft.reader_highlights = draft.reader_highlights.filter(
        (row) =>
          row.highlight_id !== highlightId || row.user_id !== actor.user_id,
      )
    })

    return ok(undefined)
  } catch {
    return fail("STORAGE", "מחיקת ההדגשה נכשלה.")
  }
}
