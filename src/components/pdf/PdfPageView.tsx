import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react"

import type {
  ReaderHighlight,
  ReaderTextSelection,
} from "../../types"
import {
  highlightFill,
  normalizeHighlightRects,
} from "../../lib/annotation-utils"
import Icon from "../icons"
import {
  devTiming,
  loadTextLayerClass,
  renderPageBitmap,
  type PdfDoc,
} from "./pdf-engine"

type TextLayerHandle = { cancel: () => void }

export interface PdfPageViewProps {
  doc: PdfDoc
  contentUrl: string
  pageNumber: number
  cssWidth: number
  zoom: number
  textLayer: boolean
  highlights: ReaderHighlight[]
  onTextSelection?: (selection: ReaderTextSelection | null) => void
  onHighlightActivate?: (highlight: ReaderHighlight) => void
}

export default function PdfPageView({
  doc,
  contentUrl,
  pageNumber,
  cssWidth,
  zoom,
  textLayer,
  highlights,
  onTextSelection,
  onHighlightActivate,
}: PdfPageViewProps) {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const textLayerRef = useRef<HTMLDivElement>(null)
  const textLayerHandle = useRef<TextLayerHandle | null>(null)

  const [metrics, setMetrics] = useState<{
    width: number
    height: number
  } | null>(null)
  const [rendering, setRendering] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadNonce, setReloadNonce] = useState(0)

  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const zoomPermille = Math.round((zoom || 1) * 1000)

  useEffect(() => {
    let cancelled = false

    setMetrics(null)

    void (async () => {
      try {
        const page = await doc.getPage(pageNumber)
        if (cancelled) return

        const base = page.getViewport({ scale: 1 })
        const scale = (cssWidth / base.width) * (zoom || 1)
        const viewport = page.getViewport({ scale })

        if (!cancelled) {
          setMetrics({ width: viewport.width, height: viewport.height })
        }
      } catch {
        /* The canvas effect below owns the visible error state. */
      }
    })()

    return () => {
      cancelled = true
    }
  }, [doc, pageNumber, cssWidth, zoom])

  useEffect(() => {
    if (cssWidth <= 0) return

    const canvas = canvasRef.current
    if (!canvas) return

    const controller = new AbortController()
    let cancelled = false
    const openedAt = performance.now()

    setRendering(true)
    setError(null)

    const paint = (bitmap: ImageBitmap) => {
      canvas.width = bitmap.width
      canvas.height = bitmap.height
      const ctx = canvas.getContext("2d")
      if (!ctx) return
      ctx.drawImage(bitmap, 0, 0)
      canvas.style.width = `${Math.floor(bitmap.width / dpr)}px`
      canvas.style.height = `${Math.floor(bitmap.height / dpr)}px`
    }

    void (async () => {
      try {
        const bitmap = await renderPageBitmap(
          doc,
          contentUrl,
          pageNumber,
          zoom || 1,
          cssWidth,
          dpr,
          controller.signal,
        )

        if (cancelled || controller.signal.aborted) return

        paint(bitmap)
        devTiming(`page ${pageNumber} rendered`, openedAt)
        setRendering(false)
      } catch (err) {
        if (
          cancelled ||
          controller.signal.aborted ||
          (err instanceof Error && err.name === "AbortError")
        ) {
          return
        }

        setRendering(false)
        setError(
          err instanceof Error && /password/i.test(err.message)
            ? "העמוד מוגן בסיסמה ואינו ניתן לפתיחה."
            : "טעינת העמוד נכשלה. נסו שוב.",
        )
      }
    })()

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [
    doc,
    contentUrl,
    pageNumber,
    cssWidth,
    zoom,
    zoomPermille,
    dpr,
    reloadNonce,
  ])

  useEffect(() => {
    if (!textLayer || !metrics) return

    const container = textLayerRef.current
    if (!container) return

    let cancelled = false
    container.replaceChildren()

    void (async () => {
      try {
        const page = await doc.getPage(pageNumber)
        if (cancelled) return

        const base = page.getViewport({ scale: 1 })
        const scale = (cssWidth / base.width) * (zoom || 1)
        const viewport = page.getViewport({ scale })

        container.style.setProperty("--scale-factor", String(scale))
        container.style.setProperty("--total-scale-factor", String(scale))
        container.style.setProperty("--scale-round-x", "1px")
        container.style.setProperty("--scale-round-y", "1px")

        const textContent = await page.getTextContent()
        if (cancelled) return

        const TextLayer = await loadTextLayerClass()
        if (cancelled) return

        const layer = new TextLayer({
          textContentSource: textContent,
          container,
          viewport,
        })

        textLayerHandle.current = layer

        await layer.render()
      } catch (err) {
        if (!cancelled && import.meta.env.DEV) {
          console.warn("[pdf] text layer failed:", err)
        }
      }
    })()

    return () => {
      cancelled = true
      textLayerHandle.current?.cancel()
      textLayerHandle.current = null
      container.replaceChildren()
    }
  }, [doc, pageNumber, cssWidth, zoom, textLayer, metrics])

  const captureSelection = useCallback(() => {
    const selection = window.getSelection()
    const layer = textLayerRef.current
    const wrapper = wrapperRef.current

    if (!selection || selection.isCollapsed || !selection.rangeCount) return
    if (!layer || !wrapper) return

    const range = selection.getRangeAt(0)

    if (!layer.contains(range.commonAncestorContainer)) return

    const quote = selection.toString().replace(/\s+/g, " ").trim()
    if (!quote) return

    const pageRect = wrapper.getBoundingClientRect()
    if (pageRect.width <= 0 || pageRect.height <= 0) return

    const rawRects = Array.from(range.getClientRects())
      .filter(
        (rect) =>
          rect.width > 0 &&
          rect.height > 0 &&
          rect.right > pageRect.left &&
          rect.left < pageRect.right &&
          rect.bottom > pageRect.top &&
          rect.top < pageRect.bottom,
      )
      .map((rect) => ({
        x: (Math.max(rect.left, pageRect.left) - pageRect.left) / pageRect.width,
        y: (Math.max(rect.top, pageRect.top) - pageRect.top) / pageRect.height,
        width:
          (Math.min(rect.right, pageRect.right) -
            Math.max(rect.left, pageRect.left)) /
          pageRect.width,
        height:
          (Math.min(rect.bottom, pageRect.bottom) -
            Math.max(rect.top, pageRect.top)) /
          pageRect.height,
      }))

    const rects = normalizeHighlightRects(rawRects)
    if (rects.length === 0) return

    const bounds = range.getBoundingClientRect()

    onTextSelection?.({
      page: pageNumber,
      quote,
      rects,
      anchor: {
        x: bounds.left,
        y: bounds.top,
        width: bounds.width,
        height: bounds.height,
      },
    })
  }, [pageNumber, onTextSelection])

  const pageHighlights = highlights.filter(
    (highlight) => highlight.page === pageNumber,
  )

  const wrapperStyle = metrics
    ? { width: `${metrics.width}px`, height: `${metrics.height}px` }
    : { width: `${Math.max(1, cssWidth * (zoom || 1))}px`, minHeight: "40vh" }

  return (
    <div
      ref={wrapperRef}
      className="pdfPage relative shrink-0 overflow-hidden rounded-lg bg-white shadow-lg"
      style={wrapperStyle}
      data-page={pageNumber}
      onPointerUp={captureSelection}
    >
      <canvas
        ref={canvasRef}
        className="block h-full w-full"
        style={{ background: "#fff" }}
        aria-label={`עמוד ${pageNumber}`}
      />

      {textLayer && (
        <div
          ref={textLayerRef}
          className="textLayer pdfTextLayer"
          data-page={pageNumber}
        />
      )}

      <div className="pdfHighlightLayer pointer-events-none absolute inset-0 z-[2]">
        {pageHighlights.flatMap((highlight) =>
          highlight.rects.map((rect, index) => (
            <div
              key={`${highlight.highlight_id}-${index}`}
              className="pdfHighlight"
              style={{
                left: `${rect.x * 100}%`,
                top: `${rect.y * 100}%`,
                width: `${rect.width * 100}%`,
                height: `${rect.height * 100}%`,
                background: highlightFill(highlight.color),
              }}
            />
          )),
        )}
      </div>

      {pageHighlights.map((highlight) => {
        if (!highlight.note || !highlight.rects[0]) return null

        const rect = highlight.rects[0]

        return (
          <button
            key={`${highlight.highlight_id}-note`}
            type="button"
            className="pdfNoteBadge"
            style={{
              left: `calc(${Math.min(0.985, Math.max(0.015, rect.x + rect.width)) * 100}% - 9px)`,
              top: `calc(${Math.min(0.985, Math.max(0.015, rect.y)) * 100}% - 9px)`,
              borderColor: highlight.color,
            }}
            aria-label={`פתיחת הערה בעמוד ${pageNumber}`}
            title={highlight.note}
            onPointerDown={(event) => event.stopPropagation()}
            onPointerUp={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation()
              onHighlightActivate?.(highlight)
            }}
          >
            <Icon name="message" size={11} />
          </button>
        )
      })}

      {rendering && !error && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/45">
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
          className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 bg-white/95 p-6 text-center text-sm"
          style={{ color: "var(--color-danger)" }}
        >
          <span>{error}</span>
          <button
            type="button"
            onClick={() => {
              setError(null)
              setRendering(true)
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
    </div>
  )
}
