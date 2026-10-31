import { useCallback, useEffect, useState } from "react"

import type { ReaderBookmark, ReaderHighlight } from "../types"
import { fail, type Result } from "../shared/result"
import type { Actor } from "./api"
import {
  createReaderBookmark,
  createReaderHighlight,
  deleteReaderBookmark,
  deleteReaderHighlight,
  fetchReaderAnnotations,
  updateReaderHighlight,
  type HighlightInput,
  type HighlightPatch,
} from "./reader-annotations"

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

/**
 * Loads and mutates the signed-in reader's annotations for one product.
 *
 * The service is the authorization boundary; this hook only mirrors the
 * returned rows into component state. A failed load does not block the
 * book - it surfaces in the annotations panel while reading continues.
 */
export function useReaderAnnotations(
  actor: Actor | null,
  productId: string | undefined,
) {
  const [bookmarks, setBookmarks] = useState<ReaderBookmark[]>([])
  const [highlights, setHighlights] = useState<ReaderHighlight[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!actor || !productId) {
      setBookmarks([])
      setHighlights([])
      setLoading(false)
      setError(null)
      return
    }

    setLoading(true)
    setError(null)

    try {
      const result = await fetchReaderAnnotations(actor, productId)

      if (result.ok) {
        setBookmarks(sortBookmarks(result.data.bookmarks))
        setHighlights(sortHighlights(result.data.highlights))
      } else {
        setError(result.error)
      }
    } catch {
      setError("טעינת הסימניות וההערות נכשלה.")
    }

    setLoading(false)
  }, [actor, productId])

  useEffect(() => {
    let cancelled = false

    setBookmarks([])
    setHighlights([])

    if (!actor || !productId) {
      setLoading(false)
      setError(null)
      return () => {
        cancelled = true
      }
    }

    setLoading(true)
    setError(null)

    void fetchReaderAnnotations(actor, productId)
      .then((result) => {
        if (cancelled) return

        if (result.ok) {
          setBookmarks(sortBookmarks(result.data.bookmarks))
          setHighlights(sortHighlights(result.data.highlights))
        } else {
          setError(result.error)
        }

        setLoading(false)
      })
      .catch(() => {
        if (cancelled) return
        setError("טעינת הסימניות וההערות נכשלה.")
        setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [actor, productId])

  const addBookmark = useCallback(
    async (page: number): Promise<Result<ReaderBookmark>> => {
      if (!actor || !productId) {
        return fail("UNAUTHENTICATED", "יש להתחבר כדי לשמור סימנייה.")
      }

      const result = await createReaderBookmark(actor, productId, page)

      if (result.ok) {
        setBookmarks((current) =>
          sortBookmarks([
            ...current.filter(
              (row) =>
                !(
                  row.page === result.data.page &&
                  row.product_id === result.data.product_id
                ),
            ),
            result.data,
          ]),
        )
        setError(null)
      } else {
        setError(result.error)
      }

      return result
    },
    [actor, productId],
  )

  const removeBookmark = useCallback(
    async (bookmarkId: string): Promise<Result> => {
      if (!actor) {
        return fail("UNAUTHENTICATED", "יש להתחבר כדי למחוק סימנייה.")
      }

      const result = await deleteReaderBookmark(actor, bookmarkId)

      if (result.ok) {
        setBookmarks((current) =>
          current.filter((row) => row.bookmark_id !== bookmarkId),
        )
        setError(null)
      } else {
        setError(result.error)
      }

      return result
    },
    [actor],
  )

  const addHighlight = useCallback(
    async (input: HighlightInput): Promise<Result<ReaderHighlight>> => {
      if (!actor || !productId) {
        return fail("UNAUTHENTICATED", "יש להתחבר כדי לשמור הדגשה.")
      }

      const result = await createReaderHighlight(actor, productId, input)

      if (result.ok) {
        setHighlights((current) =>
          sortHighlights([...current, result.data]),
        )
        setError(null)
      } else {
        setError(result.error)
      }

      return result
    },
    [actor, productId],
  )

  const editHighlight = useCallback(
    async (
      highlightId: string,
      patch: HighlightPatch,
    ): Promise<Result<ReaderHighlight>> => {
      if (!actor) {
        return fail("UNAUTHENTICATED", "יש להתחבר כדי לעדכן הערה.")
      }

      const result = await updateReaderHighlight(actor, highlightId, patch)

      if (result.ok) {
        setHighlights((current) =>
          sortHighlights(
            current.map((row) =>
              row.highlight_id === result.data.highlight_id
                ? result.data
                : row,
            ),
          ),
        )
        setError(null)
      } else {
        setError(result.error)
      }

      return result
    },
    [actor],
  )

  const removeHighlight = useCallback(
    async (highlightId: string): Promise<Result> => {
      if (!actor) {
        return fail("UNAUTHENTICATED", "יש להתחבר כדי למחוק הדגשה.")
      }

      const result = await deleteReaderHighlight(actor, highlightId)

      if (result.ok) {
        setHighlights((current) =>
          current.filter((row) => row.highlight_id !== highlightId),
        )
        setError(null)
      } else {
        setError(result.error)
      }

      return result
    },
    [actor],
  )

  return {
    bookmarks,
    highlights,
    loading,
    error,
    refresh,
    addBookmark,
    removeBookmark,
    addHighlight,
    editHighlight,
    removeHighlight,
    clearError: () => setError(null),
  }
}
