import { useEffect, useRef, useState } from "react"

import type {
  ReaderHighlight,
  ReaderTextSelection,
} from "../../types"
import { contentRequestHeaders } from "../../lib/content-storage"
import PdfPageView from "./PdfPageView"
import {
  clearDocumentCache,
  loadPdfDocument,
  renderPageBitmap,
  type PdfDoc,
} from "./pdf-engine"

export interface PdfSurfaceProps {
  contentUrl: string
  requiresAuth?: boolean
  /** Pages in reading order: one page in single mode, up to two in spread. */
  pages: number[]
  zoom?: number
  textLayer?: boolean
  highlights?: ReaderHighlight[]
  readingDirection?: "rtl" | "ltr"
  onTotalPages?: (total: number) => void
  onTextSelection?: (selection: ReaderTextSelection | null) => void
  onHighlightActivate?: (highlight: ReaderHighlight) => void
}

export default function PdfSurface({
  contentUrl,
  requiresAuth = false,
  pages,
  zoom = 1,
  textLayer = true,
  highlights = [],
  readingDirection = "rtl",
  onTotalPages,
  onTextSelection,
  onHighlightActivate,
}: PdfSurfaceProps) {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const [doc, setDoc] = useState<PdfDoc | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadNonce, setReloadNonce] = useState(0)
  const [containerWidth, setContainerWidth] = useState(0)

  useEffect(() => {
    const wrapper = wrapperRef.current
    if (!wrapper) return

    let raf = 0
    let lastWidth = 0

    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0
      if (Math.abs(width - lastWidth) < 4) return
      lastWidth = width
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => setContainerWidth(width))
    })

    observer.observe(wrapper)

    return () => {
      observer.disconnect()
      cancelAnimationFrame(raf)
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    setDoc(null)
    setLoading(true)
    setError(null)

    void (async () => {
      try {
        const httpHeaders = requiresAuth
          ? await contentRequestHeaders()
          : undefined

        const next = await loadPdfDocument(contentUrl, httpHeaders)

        if (cancelled) return

        setDoc(next)
        setLoading(false)
        onTotalPages?.(next.numPages)
      } catch (err) {
        if (cancelled) return

        setLoading(false)
        setError(
          err instanceof Error && /password/i.test(err.message)
            ? "הקובץ מוגן בסיסמה ואינו ניתן לפתיחה."
            : err instanceof Error && err.message === "content-auth-required"
              ? "תוקף ההתחברות פג. יש להתחבר מחדש כדי לפתוח את הספר."
              : err instanceof Error && err.message === "pdf-load-timeout"
                ? "הקובץ לא נטען בזמן. בדקו את החיבור ונסו שוב."
                : "טעינת הקובץ נכשלה. נסו שוב.",
        )
      }
    })()

    return () => {
      cancelled = true
    }
  }, [contentUrl, requiresAuth, reloadNonce, onTotalPages])

  const gap = pages.length > 1 ? 12 : 0
  const pageWidth =
    containerWidth > 0
      ? pages.length > 1
        ? Math.max(80, (containerWidth - gap) / 2)
        : containerWidth
      : 0

  /* Warm the pages on either side of the visible spread. The render cache
   * is keyed by page, width and zoom, so the next turn usually becomes a
   * drawImage rather than a fresh raster. */
  useEffect(() => {
    if (!doc || pageWidth <= 0 || pages.length === 0) return

    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const last = pages[pages.length - 1]
    const first = pages[0]
    const candidates =
      pages.length > 1
        ? [last + 1, last + 2, first - 1, first - 2]
        : [last + 1, first - 1, last + 2, first - 2]

    for (const candidate of [...new Set(candidates)]) {
      if (candidate < 1 || candidate > doc.numPages || pages.includes(candidate))
        continue

      void renderPageBitmap(
        doc,
        contentUrl,
        candidate,
        zoom || 1,
        pageWidth,
        dpr,
      ).catch(() => undefined)
    }
  }, [doc, contentUrl, pages, zoom, pageWidth])

  return (
    <div ref={wrapperRef} className="relative min-h-[40vh] w-full">
      {loading && !doc && (
        <div className="absolute inset-0 flex min-h-[40vh] items-center justify-center">
          <div
            className="h-8 w-8 animate-spin rounded-full border-2"
            style={{
              borderColor: "var(--color-primary)",
              borderTopColor: "transparent",
            }}
          />
        </div>
      )}

      {error && (
        <div
          className="flex min-h-[40vh] flex-col items-center justify-center gap-4 px-6 text-center text-sm"
          style={{ color: "var(--color-danger)" }}
        >
          <span>{error}</span>
          <button
            type="button"
            onClick={() => {
              clearDocumentCache(contentUrl)
              setReloadNonce((nonce) => nonce + 1)
            }}
            className="tap-target rounded-full border px-4 py-2 text-xs font-semibold transition-opacity hover:opacity-70"
            style={{
              borderColor: "var(--color-danger)",
              color: "var(--color-danger)",
            }}
          >
            ניסיון נוסף
          </button>
        </div>
      )}

      {doc && pageWidth > 0 && (
        <div
          className="flex w-full items-start justify-center gap-3"
          dir={readingDirection}
        >
          {pages.map((pageNumber) => (
            <PdfPageView
              key={pageNumber}
              doc={doc}
              contentUrl={contentUrl}
              pageNumber={pageNumber}
              cssWidth={pageWidth}
              zoom={zoom || 1}
              textLayer={textLayer}
              highlights={highlights}
              onTextSelection={onTextSelection}
              onHighlightActivate={onHighlightActivate}
            />
          ))}
        </div>
      )}
    </div>
  )
}
