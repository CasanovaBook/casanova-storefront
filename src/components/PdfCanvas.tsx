import { useEffect, useRef, useState } from "react"

/* ─────────────────────────────────────────────────────────────
 * PdfCanvas — protected-content PDF renderer (v2).
 *
 * Renders a PDF into a <canvas> the page owns, instead of handing
 * the bytes to the browser's native PDF plugin inside an <iframe>
 * (whose toolbar is a one-click download/print path no page code
 * can reach — Chromium ignores #toolbar=0).
 *
 * ── Why v1 corrupted text, and how this version is built ──
 *
 * v1 rendered every page straight into the one visible <canvas> and
 * only set a `cancelled` flag when the page changed — it never
 * cancelled the in-flight pdf.js RenderTask before starting the next
 * one. pdf.js shares a page's translated operator list between
 * concurrent renders of the same page, so the old and new glyph
 * streams interleaved into the same bitmap: overlapping letters,
 * broken line layout (the corruption screenshots).
 *
 * v2 makes that impossible by construction:
 *
 *  1. Every render paints into its OWN offscreen canvas. Two render
 *     tasks can never share a bitmap again.
 *  2. A single global render queue serialises all renders. The
 *     worker parallelises parsing; canvas painting is sequential
 *     anyway, and the queue is what lets us cancel cleanly.
 *  3. Cancellation is real: changing pages marks the queued item
 *     cancelled and calls RenderTask.cancel() on anything in flight,
 *     so rapid flipping never queues a backlog of stale renders.
 *  4. Finished pages are cached as ImageBitmaps keyed by
 *     (url, page, zoom, dpr). A page you flip back to is presented
 *     with one drawImage — no re-render at all.
 *  5. The neighbouring pages are rendered into the cache after the
 *     current page paints, so normal next/previous navigation hits
 *     the cache and feels immediate.
 *
 * The parsed document itself is cached per signed URL at module
 * level: the 148-page file is parsed once per grant, never re-parsed
 * per page.
 *
 * Security honesty: canvas rendering removes the accidental download
 * path and composes with the copy/print deterrents in the host page,
 * but it is NOT strong DRM — pixels can always be captured. The real
 * boundary stays server-side: entitlement checks, use-budgeted
 * grants, short-lived signed URLs, and the identity watermark this
 * component composes under.
 * ───────────────────────────────────────────────────────────── */

// Grouped so Vite code-splits the parser away from the entry chunk and
// the reader only pays for it when a PDF actually opens.
const PDFJS_IMPORT = () => import("pdfjs-dist")

type PdfDoc = Awaited<ReturnType<typeof PDFJS_IMPORT>>["getDocument"] extends (
  ...args: never[]
) => { promise: Promise<infer D> }
  ? D
  : never
type PdfPage = Awaited<ReturnType<PdfDoc["getPage"]>>
type RenderTask = ReturnType<PdfPage["render"]>

let workerReady = false

/** Points pdf.js at its worker once; a Vite `?url` import keeps the
 *  worker file version-matched and self-hosted (no CDN: the CSP
 *  forbids third-party script, and reader traffic must not leak to
 *  or depend on a third party). */
async function ensureWorker(): Promise<void> {
  if (workerReady) return
  const mod = await PDFJS_IMPORT()
  const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url"))
    .default
  mod.GlobalWorkerOptions.workerSrc = workerUrl
  workerReady = true
}

/* ── Parsed-document cache ─────────────────────────────────── */

const docCache = new Map<string, Promise<PdfDoc>>()

function loadDoc(url: string): Promise<PdfDoc> {
  const existing = docCache.get(url)
  if (existing) return existing

  const task = ensureWorker().then(() =>
    PDFJS_IMPORT().then(({ getDocument }) =>
      getDocument({
        url,
        // The signed URL already carries the authorization; nothing
        // else is sent and credentials are never attached.
        withCredentials: false,
        // Keep font metadata alive across repeated renders of the same
        // page object (cache hits, neighbour prefetches): without this
        // pdf.js may dispose font resources after the first render and
        // a second render of the same page can mis-shape text.
        fontExtraProperties: true,
        // Self-hosted font/encoding resources, copied from the matching
        // pdfjs-dist release into public/pdfjs at build time. A PDF whose
        // fonts are not embedded falls back to these; a CDN would violate
        // the CSP and leak reader traffic, so they ship with the app.
        // Requested lazily by the worker ONLY when a page actually
        // references a non-embedded font — pages using embedded fonts
        // never fetch any of it.
        standardFontDataUrl: "/pdfjs/standard_fonts/",
        cMapUrl: "/pdfjs/cmaps/",
        cMapPacked: true,
      }).promise,
    ),
  )

  docCache.set(url, task)

  // A failed parse must not poison the cache — a retry gets a clean
  // attempt instead of a cached rejection.
  task.catch(() => docCache.delete(url))

  // One document per reader session is all the cache needs.
  if (docCache.size > 2) {
    const oldest = docCache.keys().next().value
    if (oldest && oldest !== url) docCache.delete(oldest)
  }

  return task
}

/* ── Render queue ────────────────────────────────────────────
 * One paint at a time, anywhere in the app. Items cancelled before
 * they start cost nothing; the running item is cancelled through
 * pdf.js's own RenderTask (which stops the worker mid-page). */

interface QueueItem {
  key: string
  run: () => Promise<void>
  cancelled: boolean
  task?: RenderTask
}

const renderQueue: QueueItem[] = []
let draining = false

function enqueue(item: QueueItem): void {
  // An item re-enqueued for the same key supersedes any queued twin.
  for (let i = renderQueue.length - 1; i >= 0; i--) {
    if (renderQueue[i].key === item.key) renderQueue.splice(i, 1)
  }
  renderQueue.push(item)
  void drainQueue()
}

async function drainQueue(): Promise<void> {
  if (draining) return
  draining = true
  try {
    while (renderQueue.length > 0) {
      const item = renderQueue.shift()
      if (!item || item.cancelled) continue
      try {
        await item.run()
      } catch (err) {
        // A cancelled render rejects by design; anything else is logged
        // in dev only — the component surfaces its own error state.
        if (
          !(err instanceof Error && err.name === "RenderingCancelledException") &&
          import.meta.env.DEV
        ) {
          console.warn("[pdf] render failed:", err)
        }
      }
    }
  } finally {
    draining = false
  }
}

function cancelQueued(key: string): void {
  for (const item of renderQueue) {
    if (item.key === key) item.cancelled = true
  }
}

/* ── Page-bitmap cache ─────────────────────────────────────── */

const BITMAP_CACHE_LIMIT = 6

const bitmapCache = new Map<string, ImageBitmap>()

function bitmapKey(
  url: string,
  page: number,
  zoomPermille: number,
  dpr: number,
): string {
  return `${url}|${page}|${zoomPermille}|${Math.round(dpr * 100)}`
}

function cachePut(key: string, bitmap: ImageBitmap): void {
  // The same key may already hold a bitmap (a re-render after a resize
  // with identical dimensions); replace rather than double-store.
  const previous = bitmapCache.get(key)
  if (previous === bitmap) return
  if (previous) previous.close()
  bitmapCache.set(key, bitmap)

  // Insertion-ordered Map: evict the oldest entries beyond the limit,
  // closing their GPU/memory backing store. The key just inserted is
  // newest, so it is never the one evicted.
  while (bitmapCache.size > BITMAP_CACHE_LIMIT) {
    const oldestKey = bitmapCache.keys().next().value
    if (oldestKey === undefined) break
    const oldest = bitmapCache.get(oldestKey)
    bitmapCache.delete(oldestKey)
    oldest?.close()
  }
}

function cacheClear(): void {
  for (const bitmap of bitmapCache.values()) bitmap.close()
  bitmapCache.clear()
}

/** Renders one page at the given geometry into a canvas of its own and
 *  returns it as an ImageBitmap. Runs through the global queue. */
function renderPageBitmap(
  doc: PdfDoc,
  url: string,
  pageNum: number,
  zoom: number,
  cssWidth: number,
  dpr: number,
): Promise<ImageBitmap> {
  const key = bitmapKey(url, pageNum, Math.round(zoom * 1000), dpr)

  const cached = bitmapCache.get(key)
  if (cached) return Promise.resolve(cached)

  return new Promise<ImageBitmap>((resolve, reject) => {
    const item: QueueItem = {
      key,
      cancelled: false,
      run: async () => {
        // The cache may have been filled while this item sat queued.
        const nowCached = bitmapCache.get(key)
        if (nowCached) {
          resolve(nowCached)
          return
        }

        const pdfPage: PdfPage = await doc.getPage(pageNum)

        const base = pdfPage.getViewport({ scale: 1 })
        const scale = (cssWidth / base.width) * zoom * dpr
        const viewport = pdfPage.getViewport({ scale })

        // Dedicated canvas per render — the structural fix for the
        // interleaved-glyph corruption.
        const offscreen = document.createElement("canvas")
        offscreen.width = Math.max(1, Math.floor(viewport.width))
        offscreen.height = Math.max(1, Math.floor(viewport.height))
        const ctx = offscreen.getContext("2d", { alpha: false })
        if (!ctx) throw new Error("canvas unavailable")

        const renderTask = pdfPage.render({
          canvas: offscreen,
          canvasContext: ctx,
          viewport,
        })

        // Recorded on the queue item so a cancellation requested after
        // this point reaches the in-flight task itself.
        item.task = renderTask

        try {
          await renderTask.promise
        } catch (err) {
          offscreen.width = 0
          offscreen.height = 0
          throw err
        }

        const bitmap = await createImageBitmap(offscreen)
        // Free the DOM canvas backing store immediately; the bitmap is
        // what gets cached and presented.
        offscreen.width = 0
        offscreen.height = 0

        cachePut(key, bitmap)
        resolve(bitmap)
      },
    }

    enqueue(item)
  })
}

/** Dev-only phase timing: pinpoints where open time is actually spent
 *  (chunk load vs download/parse vs first paint vs per-page paint). */
function devTiming(label: string, startedAt: number): void {
  if (import.meta.env.DEV) {
    console.info(`[pdf] ${label}: ${(performance.now() - startedAt).toFixed(0)}ms`)
  }
}

export interface PdfCanvasProps {
  signedUrl: string

  page: number

  /** Scale multiplier chosen by the reader's text-size control. 1 = natural. */
  zoom?: number

  /** Rendered underneath the canvas: identity watermark text per page. */
  watermark?: string

  /** Countered once the page's real total is known from the document. */
  onTotalPages?: (total: number) => void

  /** Called after the page finishes painting. */
  onRendered?: () => void
}

export default function PdfCanvas({
  signedUrl,
  page,
  zoom = 1,
  watermark,
  onTotalPages,
  onRendered,
}: PdfCanvasProps) {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [rendering, setRendering] = useState(true)
  // Measured container width drives the render scale; a ResizeObserver
  // keeps it honest across viewport and fullscreen changes.
  const [containerWidth, setContainerWidth] = useState(0)

  // Only the newest (page, zoom) change may paint; older completions
  // (cache fills, prefetches) are ignored by the visible canvas.
  const renderEpoch = useRef(0)

  // The in-flight queue item for the current key, so an unmount or a
  // rapid flip cancels real work instead of letting it run to auction.
  const activeItemRef = useRef<QueueItem | null>(null)

  const totalReported = useRef(false)
  useEffect(() => {
    totalReported.current = false
  }, [signedUrl])

  // Zoom changes invalidate every cached bitmap (they are the wrong
  // scale), so drop the lot rather than letting them age out.
  const zoomPermille = Math.round((zoom || 1) * 1000)
  useEffect(() => {
    cacheClear()
  }, [zoomPermille])

  useEffect(() => {
    const wrapper = wrapperRef.current
    if (!wrapper) return

    let raf = 0
    let lastWidth = 0
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0
      // Debounce through rAF and ignore sub-pixel churn, or a scrollbar
      // appearing triggers render → layout → render loops.
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
    if (containerWidth <= 0) return

    let cancelled = false
    const canvas = canvasRef.current
    if (!canvas) return

    const epoch = ++renderEpoch.current
    setRendering(true)
    setError(null)

    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const effectiveZoom = zoom || 1
    const openedAt = performance.now()

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
        const doc = await loadDoc(signedUrl)

        if (cancelled || epoch !== renderEpoch.current) return

        devTiming("document downloaded + parsed", openedAt)

        if (!totalReported.current) {
          totalReported.current = true
          onTotalPages?.(doc.numPages)
        }

        const safePage = Math.min(Math.max(page, 1), doc.numPages)
        const key = bitmapKey(
          signedUrl,
          safePage,
          zoomPermille,
          dpr,
        )

        // Cancel whatever the previous (page, zoom) left running: queued
        // items are flagged, an in-flight render is cancelled through
        // pdf.js. This is the fix for slow rapid flipping — stale pages
        // never finish rendering "to auction".
        if (activeItemRef.current) {
          cancelQueued(activeItemRef.current.key)
          activeItemRef.current.task?.cancel()
        }

        const item: QueueItem = {
          key,
          cancelled: false,
          run: async () => {}, // replaced by the queue; kept for the ref contract
        }
        activeItemRef.current = item
        const cacheMiss = !bitmapCache.has(key)

        const cached = bitmapCache.get(key)
        if (cached) {
          paint(cached)
          setRendering(false)
          onRendered?.()
        } else if (cacheMiss) {
          const paintStartedAt = performance.now()
          const bitmap = await renderPageBitmap(
            doc,
            signedUrl,
            safePage,
            effectiveZoom,
            containerWidth,
            dpr,
          )

          devTiming(`page ${safePage} rendered`, paintStartedAt)

          // A stale completion never paints — but the bitmap is already
          // in the cache, so flipping back to it is instant.
          if (cancelled || epoch !== renderEpoch.current) return

          paint(bitmap)
          devTiming("first page displayed", openedAt)
          setRendering(false)
          onRendered?.()
        }

        // Warm the adjacent pages into the cache so the next flip is a
        // drawImage instead of a render. Queued behind the current page,
        // cancellable, and bounded to two pages.
        const neighbours = [safePage + 1, safePage - 1].filter(
          (n) => n >= 1 && n <= doc.numPages,
        )
        for (const neighbour of neighbours) {
          if (cancelled) return
          void renderPageBitmap(
            doc,
            signedUrl,
            neighbour,
            effectiveZoom,
            containerWidth,
            dpr,
          ).catch(() => undefined)
        }
      } catch (err) {
        if (cancelled) return
        setRendering(false)
        setError(
          err instanceof Error && /password/i.test(err.message)
            ? "הקובץ מוגן בסיסמה ואינו ניתן לפתיחה."
            : "טעינת הקובץ נכשלה. נסו לרענן את העמוד.",
        )
      }
    })()

    return () => {
      cancelled = true
      if (activeItemRef.current) {
        cancelQueued(activeItemRef.current.key)
        activeItemRef.current.task?.cancel()
        activeItemRef.current = null
      }
    }
    // zoomPermille is derived from zoom; containerWidth drives re-render
    // on resize/fullscreen. eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedUrl, page, zoomPermille, containerWidth])

  /* The wrapper is what ResizeObserver measures; the canvas is centred
   * inside it. */
  return (
    <div ref={wrapperRef} className="relative flex justify-center" style={{ minHeight: "40vh" }}>
      <canvas
        ref={canvasRef}
        className="max-w-full rounded-lg shadow-lg"
        style={{ background: "#fff" }}
        aria-label={`עמוד ${page}`}
      />
      {rendering && !error && (
        <div
          className="absolute inset-0 flex items-center justify-center rounded-lg"
          style={{ background: "rgba(7,7,14,0.55)" }}
        >
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
          className="absolute inset-0 flex items-center justify-center p-8 text-center text-sm"
          style={{ color: "var(--color-danger)" }}
        >
          {error}
        </div>
      )}
      {/* Attribution layer: the page's own watermark sits under the same
       * overlay stack the iframe-based reader used. */}
      {watermark && (
        <div
          className="pointer-events-none absolute inset-0 overflow-hidden rounded-lg"
          aria-hidden="true"
        >
          <div
            className="absolute flex flex-col justify-around"
            style={{
              top: "-50%",
              left: "-50%",
              width: "200%",
              height: "200%",
              transform: "rotate(-24deg)",
              opacity: 0.07,
              color: "#000000",
            }}
          >
            {Array.from({ length: 9 }).map((_, row) => (
              <div key={row} className="flex justify-around">
                {Array.from({ length: 4 }).map((_, col) => (
                  <span
                    key={col}
                    className="whitespace-nowrap text-[13px] tracking-wider"
                  >
                    {watermark}
                  </span>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/** Warms the parser and worker without rendering: called from the
 *  library (hover/focus/touch and on mount) so the first open skips
 *  the lazy-chunk fetch. Fetches code only — never content. */
export function prefetchPdfRuntime(): void {
  void PDFJS_IMPORT()
  void ensureWorker()
}
