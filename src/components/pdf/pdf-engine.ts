/* Shared pdf.js engine: worker, document cache, render queue and bitmap
 * cache. Kept outside React so single-page and spread views share the same
 * parsed document and never render two pages into one bitmap. */

const PDFJS_IMPORT = () => import("pdfjs-dist")

export type PdfDoc = Awaited<
  ReturnType<typeof PDFJS_IMPORT>
>["getDocument"] extends (...args: never[]) => { promise: Promise<infer D> }
  ? D
  : never

export type PdfPage = Awaited<ReturnType<PdfDoc["getPage"]>>
export type RenderTask = ReturnType<PdfPage["render"]>

let workerReady = false

async function ensureWorker(): Promise<void> {
  if (workerReady) return
  const mod = await PDFJS_IMPORT()
  const workerUrl = (
    await import("pdfjs-dist/build/pdf.worker.min.mjs?url")
  ).default
  mod.GlobalWorkerOptions.workerSrc = workerUrl
  workerReady = true
}

const docCache = new Map<string, Promise<PdfDoc>>()

const DOC_LOAD_TIMEOUT_MS = 30_000

export function loadPdfDocument(
  url: string,
  httpHeaders?: Record<string, string>,
): Promise<PdfDoc> {
  const existing = docCache.get(url)
  if (existing) return existing

  const task = ensureWorker().then(() =>
    PDFJS_IMPORT().then(({ getDocument }) => {
      const loading = getDocument({
        url,
        httpHeaders,
        withCredentials: false,
        fontExtraProperties: true,
        standardFontDataUrl: "/pdfjs/standard_fonts/",
        cMapUrl: "/pdfjs/cmaps/",
        cMapPacked: true,
      })

      return new Promise<PdfDoc>((resolve, reject) => {
        const timer = window.setTimeout(() => {
          void loading.destroy().catch(() => undefined)
          reject(new Error("pdf-load-timeout"))
        }, DOC_LOAD_TIMEOUT_MS)

        loading.promise.then(
          (doc) => {
            window.clearTimeout(timer)
            resolve(doc)
          },
          (err) => {
            window.clearTimeout(timer)
            reject(err)
          },
        )
      })
    }),
  )

  docCache.set(url, task)

  task.catch(() => docCache.delete(url))

  if (docCache.size > 2) {
    const oldest = docCache.keys().next().value
    if (oldest && oldest !== url) docCache.delete(oldest)
  }

  return task
}

export function clearDocumentCache(url: string): void {
  docCache.delete(url)
}

export async function loadTextLayerClass() {
  const mod = await PDFJS_IMPORT()
  return mod.TextLayer
}

/* ── Render queue ──────────────────────────────────────────── */

interface QueueItem {
  key: string
  run: () => Promise<void>
  cancelled: boolean
  task?: RenderTask
}

const renderQueue: QueueItem[] = []
let draining = false

function enqueue(item: QueueItem): void {
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

/* ── Page-bitmap cache ─────────────────────────────────────── */

const BITMAP_CACHE_LIMIT = 10

const bitmapCache = new Map<string, ImageBitmap>()

/** Shared in-flight renders, so a prefetch and the page component that
 *  appears next do not rasterize the same page twice. */
const bitmapInFlight = new Map<string, Promise<ImageBitmap>>()

function bitmapKey(
  url: string,
  page: number,
  zoomPermille: number,
  cssWidth: number,
  dpr: number,
): string {
  return `${url}|${page}|${zoomPermille}|${Math.round(cssWidth)}|${Math.round(dpr * 100)}`
}

function cachePut(key: string, bitmap: ImageBitmap): void {
  const previous = bitmapCache.get(key)
  if (previous === bitmap) return
  if (previous) previous.close()
  bitmapCache.set(key, bitmap)

  while (bitmapCache.size > BITMAP_CACHE_LIMIT) {
    const oldestKey = bitmapCache.keys().next().value
    if (oldestKey === undefined) break
    const oldest = bitmapCache.get(oldestKey)
    bitmapCache.delete(oldestKey)
    oldest?.close()
  }
}

export function clearBitmapCache(): void {
  for (const bitmap of bitmapCache.values()) bitmap.close()
  bitmapCache.clear()
}

/** Renders one page at the given geometry into a bitmap and caches it.
 *  An AbortSignal cancels queued/in-flight work and rejects with AbortError,
 *  which lets page components tear down without painting a stale page. */
export function renderPageBitmap(
  doc: PdfDoc,
  url: string,
  pageNum: number,
  zoom: number,
  cssWidth: number,
  dpr: number,
  signal?: AbortSignal,
): Promise<ImageBitmap> {
  const key = bitmapKey(url, pageNum, Math.round(zoom * 1000), cssWidth, dpr)

  const cached = bitmapCache.get(key)
  if (cached) return Promise.resolve(cached)

  const pending = bitmapInFlight.get(key)
  if (pending) return pending

  const promise = new Promise<ImageBitmap>((resolve, reject) => {
    let settled = false

    const item: QueueItem = {
      key,
      cancelled: false,
      run: async () => {
        if (item.cancelled) return

        const nowCached = bitmapCache.get(key)
        if (nowCached) {
          finishResolve(nowCached)
          return
        }

        let offscreen: HTMLCanvasElement | null = null

        try {
          const pdfPage = await doc.getPage(pageNum)
          if (item.cancelled) return

          const base = pdfPage.getViewport({ scale: 1 })
          const scale = (cssWidth / base.width) * zoom * dpr
          const viewport = pdfPage.getViewport({ scale })

          offscreen = document.createElement("canvas")
          offscreen.width = Math.max(1, Math.floor(viewport.width))
          offscreen.height = Math.max(1, Math.floor(viewport.height))
          const ctx = offscreen.getContext("2d", { alpha: false })
          if (!ctx) throw new Error("canvas unavailable")

          const renderTask = pdfPage.render({
            canvas: offscreen,
            canvasContext: ctx,
            viewport,
          })

          item.task = renderTask

          await renderTask.promise

          if (item.cancelled || settled) return

          const bitmap = await createImageBitmap(offscreen)

          offscreen.width = 0
          offscreen.height = 0
          offscreen = null

          if (item.cancelled || settled) {
            bitmap.close()
            return
          }

          cachePut(key, bitmap)
          finishResolve(bitmap)
        } catch (err) {
          if (offscreen) {
            offscreen.width = 0
            offscreen.height = 0
          }
          finishReject(err)
        }
      },
    }

    const onAbort = () => {
      item.cancelled = true
      item.task?.cancel()
      finishReject(new DOMException("Aborted", "AbortError"))
    }

    const cleanup = () => {
      signal?.removeEventListener("abort", onAbort)
    }

    const finishResolve = (bitmap: ImageBitmap) => {
      if (settled) return
      settled = true
      cleanup()
      resolve(bitmap)
    }

    const finishReject = (err: unknown) => {
      if (settled) return
      settled = true
      cleanup()
      reject(err)
    }

    if (signal?.aborted) {
      finishReject(new DOMException("Aborted", "AbortError"))
      return
    }

    signal?.addEventListener("abort", onAbort, { once: true })
    enqueue(item)
  })

  bitmapInFlight.set(key, promise)

  void promise.then(
    () => {
      if (bitmapInFlight.get(key) === promise) bitmapInFlight.delete(key)
    },
    () => {
      if (bitmapInFlight.get(key) === promise) bitmapInFlight.delete(key)
    },
  )

  return promise
}

export function devTiming(label: string, startedAt: number): void {
  if (import.meta.env.DEV) {
    console.info(`[pdf] ${label}: ${(performance.now() - startedAt).toFixed(0)}ms`)
  }
}

/** Warms the parser and worker without fetching any content. */
export function prefetchPdfRuntime(): void {
  void PDFJS_IMPORT()
  void ensureWorker()
}
