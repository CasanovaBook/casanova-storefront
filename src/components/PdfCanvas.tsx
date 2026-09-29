import { useEffect, useRef, useState } from "react"

/* ─────────────────────────────────────────────────────────────
 * PdfCanvas — protected-content PDF renderer.
 *
 * Renders a PDF into a <canvas> the page owns, instead of handing
 * the bytes to the browser's native PDF plugin inside an <iframe>.
 *
 * Why: the native plugin exposes its own toolbar with one-click
 * download / print / save buttons that no page CSS or JS can reach
 * (Chromium ignores the legacy #toolbar=0 hint). Rendering to canvas
 * means the page decides which controls exist — and there is no
 * download control. It also means the page turns are re-renders of
 * an already-parsed document rather than full document reloads, and
 * the real page count comes from the document itself instead of from
 * a number typed into the CMS.
 *
 * Security honesty: canvas rendering deters casual extraction (no
 * download button, copy/drag/print are blocked by the host page) but
 * is NOT strong DRM — pixels on a screen can always be captured.
 * The real protections stay server-side: short-lived signed URLs,
 * entitlement checks, use-budgeted grants and the identity watermark
 * this component composes under.
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

let workerReady = false

/** Points pdf.js at its worker once; a Vite `?url` import keeps the
 *  worker file version-matched without a hardcoded CDN address (the
 *  CDN form would leak reader traffic and book bytes to a third party). */
async function ensureWorker(): Promise<void> {
  if (workerReady) return
  const mod = await PDFJS_IMPORT()
  const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url"))
    .default
  mod.GlobalWorkerOptions.workerSrc = workerUrl
  workerReady = true
}

/** Module-level doc cache. The reader mounts/unmounts PdfCanvas per page
 *  navigation by design (see below), so the parsed document must outlive
 *  the component: one parse per signed URL per session, and a page turn
 *  costs one canvas paint instead of a 148-page re-parse. Keyed on the
 *  signed URL so a fresh grant (new URL) naturally replaces the old doc. */
const docCache = new Map<string, Promise<PdfDoc>>()

function loadDoc(url: string): Promise<PdfDoc> {
  const existing = docCache.get(url)
  if (existing) return existing

  const task = ensureWorker().then(() =>
    PDFJS_IMPORT().then(({ getDocument }) =>
      getDocument({
        url,
        // The signed URL already carries the authorization; nothing else
        // is sent, and credentials are never attached.
        withCredentials: false,
      }).promise,
    ),
  )

  docCache.set(url, task)

  // Drop the cache entry if the parse fails, so a retry gets a clean
  // attempt instead of a cached rejection.
  task.catch(() => docCache.delete(url))

  // Keep the map bounded: one document is all a reader session needs.
  if (docCache.size > 2) {
    const oldest = docCache.keys().next().value
    if (oldest && oldest !== url) docCache.delete(oldest)
  }

  return task
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
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [rendering, setRendering] = useState(true)
  // Bumped on every (doc, page, zoom) change; only the newest render task
  // is allowed to paint, so rapid page turns never interleave.
  const renderEpoch = useRef(0)

  const totalReported = useRef(false)
  useEffect(() => {
    totalReported.current = false
  }, [signedUrl])

  useEffect(() => {
    let cancelled = false
    const canvas = canvasRef.current
    if (!canvas) return

    const epoch = ++renderEpoch.current
    setRendering(true)

    void (async () => {
      try {
        const doc = await loadDoc(signedUrl)

        if (cancelled || epoch !== renderEpoch.current) return

        if (!totalReported.current) {
          totalReported.current = true
          onTotalPages?.(doc.numPages)
        }

        const safePage = Math.min(Math.max(page, 1), doc.numPages)
        const pdfPage: PdfPage = await doc.getPage(safePage)

        if (cancelled || epoch !== renderEpoch.current) return

        // Render at device resolution so text stays crisp on HiDPI.
        const dpr = Math.min(window.devicePixelRatio || 1, 2)
        const cssWidth = canvas.parentElement?.clientWidth || 800
        const base = pdfPage.getViewport({ scale: 1 })
        const scale = ((cssWidth / base.width) * (zoom || 1)) * dpr
        const viewport = pdfPage.getViewport({ scale })

        const ctx = canvas.getContext("2d")
        if (!ctx) throw new Error("canvas unavailable")

        canvas.width = Math.floor(viewport.width)
        canvas.height = Math.floor(viewport.height)
        canvas.style.width = `${Math.floor(viewport.width / dpr)}px`
        canvas.style.height = `${Math.floor(viewport.height / dpr)}px`

        const renderTask = pdfPage.render({
          canvasContext: ctx,
          canvas,
          viewport,
        })
        await renderTask.promise

        if (cancelled || epoch !== renderEpoch.current) {
          renderTask.cancel()
          return
        }

        setRendering(false)
        onRendered?.()
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
    }
    // zoom is intentionally in the deps: a zoom change is a re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedUrl, page, zoom])

  /* Center the page in the viewport: a tall phone page or a zoomed
   * desktop page should sit in the middle, not hug one side. */
  return (
    <div className="relative flex justify-center" style={{ minHeight: "40vh" }}>
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
            className="h-8 w-8 animate-spin rounded-full border-2 border-t-transparent"
            style={{ borderColor: "var(--color-primary)", borderTopColor: "transparent" }}
          />
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center p-8 text-center text-sm" style={{ color: "var(--color-danger)" }}>
          {error}
        </div>
      )}
      {/* Attribution layer: the page's own watermark sits under the same
       * overlay stack the iframe-based reader used. */}
      {watermark && (
        <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-lg" aria-hidden="true">
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
                  <span key={col} className="text-[13px] tracking-wider whitespace-nowrap">
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

/** Warms the parser and worker without rendering: called on hover/focus
 *  of "המשך קריאה" so the first open skips the lazy-chunk fetch. */
export function prefetchPdfRuntime(): void {
  void PDFJS_IMPORT()
  void ensureWorker()
}
