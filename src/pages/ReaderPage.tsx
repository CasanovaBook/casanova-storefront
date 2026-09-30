import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useParams, useNavigate } from "react-router"
import { useApp } from "../context/AppContext"
import { useCms } from "../context/CmsContext"
import { useStore } from "../lib/store"
import PdfCanvas, {
  prefetchPdfRuntime,
} from "../components/PdfCanvas"
import { useScreenProtection } from "../lib/useScreenProtection"
import {
  consumeContentGrant,
  issueContentGrant,
  isSessionExpired,
  recordEvent,
  refreshDeviceSession,
  registerDeviceSession,
  renderWatermark,
  resolveDrmPolicy,
} from "../lib/api-security"
import type { SecurityEventType } from "../types"
import Icon from "../components/icons"

/** Minimum horizontal travel, in CSS pixels, that counts as a page swipe. */
const SWIPE_THRESHOLD = 36
/** Below this travel and this duration a press is read as an edge tap. */
const TAP_TRAVEL = 14
const TAP_DURATION = 500
/** Heartbeat interval; the session is extended only after real activity. */
const HEARTBEAT_MS = 20_000
const ACTIVITY_WINDOW_MS = 60_000
/**
 * How often the reader re-verifies the entitlement server-side while the
 * book is open.
 *
 * A grant minted once at open time is not authorization — it is a
 * snapshot of authorization. `get-content-url` checks
 * `access_status = 'ACTIVE'` only when it signs, and the signed URL it
 * hands back cannot be un-signed, so the only way an already-open reader
 * learns that an administrator pressed חסימה is to ask the server again.
 * Thirty seconds bounds how long a suspended account can keep turning
 * pages; each beat is one cheap entitlement read through RLS.
 */
const ACCESS_REVALIDATE_MS = 30_000

/**
 * Text-size rungs, as a percentage of the PDF's natural scale.
 *
 * Discrete rather than continuous because every change repaints the page
 * through PdfCanvas at a new scale — a slider would fire a repaint for
 * every pixel of travel. Repaints are cheap (one canvas draw from the
 * already-parsed document), but rungs still read better than a twitchy
 * continuous control.
 */
const ZOOM_STEPS = [75, 100, 125, 150, 200, 250, 300, 400]
/** Sentinel meaning "fit the page to the width", i.e. emit no zoom at all. */
const ZOOM_FIT = 0

/**
 * The reader renders the content file attached to the product in the CMS.
 * Nothing is synthesised here: if no file has been uploaded the page says so
 * instead of inventing text. Progress is tracked against the page count
 * declared on the book, so it keeps working for any title the store adds.
 *
 * Two things run underneath the page itself:
 *
 *  • Copy protection, resolved from the active DRM policy rather than
 *    hardcoded, so the business can tune it per platform without a
 *    release. The identity watermark is the part that actually deters
 *    redistribution — a capture of this screen carries the buyer's own
 *    name and address — and the deterrents around it only remove the
 *    effortless paths.
 *
 *  • A device session, claimed on open and renewed while the reader is
 *    genuinely in use. It is what enforces `max_devices_per_user` and
 *    `session_timeout_minutes`, and because it is read from the store an
 *    administrator revoking it in the CMS stops this screen immediately.
 *
 * Navigation works with keys, on-screen buttons, edge taps and edge
 * swipes. The swipe strips sit at the sides so the centre of the page
 * still scrolls the embedded document normally.
 *
 * Text size is a separate control from navigation, and it works by
 * repainting the current page at a new scale through PdfCanvas — there
 * is no browser PDF plugin involved anymore, so there is also no plugin
 * toolbar and no download/print path to disable.
 */
export default function ReaderPage() {
  const { productId } = useParams<{ productId: string }>()
  const navigate = useNavigate()
  const {
    isAuthenticated,
    authReady,
    hasAccess,
    getProgress,
    updateProgress,
    userProducts,
    user,
    actor,
    refreshEntitlements,
  } = useApp()
  const { products } = useCms()
  const db = useStore()

  // The catalogue entry may be archived or removed after a purchase, so the
  // title and page count fall back to the snapshot stored on the entitlement.
  const product = products.find((p) => p.product_id === productId)
  const entitlement = userProducts.find((up) => up.product_id === productId)
  const snapshot = entitlement?.product_snapshot

  const title = product?.name ?? snapshot?.name ?? ""
  /* The CMS count is a hint only; the document itself is authoritative.
   * A mistyped count used to break the progress bar (a 148-page PDF
   * against "3" rendered 300%) and clamp navigation early. PdfCanvas
   * reports the real total once the file is parsed. */
  const [docTotalPages, setDocTotalPages] = useState<number | null>(null)
  const totalPages = docTotalPages ??
    product?.book?.total_pages ??
    snapshot?.total_pages ??
    0

  /* The address of the file is never read off the catalogue row. The reader
   * asks the service layer for a grant, which re-checks the entitlement and
   * the device session and hands back a short-lived, use-budgeted URL — the
   * same contract the native reader follows, and the reason the storefront
   * catalogue carries no content_url at all. */
  const [contentUrl, setContentUrl] = useState<string | undefined>(undefined)
  const [grantWatermark, setGrantWatermark] = useState<string | undefined>(
    undefined,
  )
  const [grantError, setGrantError] = useState<string | null>(null)
  const isPdf = Boolean(contentUrl && /\.pdf(\?|#|$)/i.test(contentUrl))

  /* A PDF renders through PdfCanvas, which parses the document once and
   * paints pages onto a canvas the page owns — no browser PDF plugin, so
   * no plugin toolbar with its one-click download / print buttons, and
   * page turns cost a repaint instead of a full document reload. */

  // Starting the parser fetch as soon as an entitled reader is looking at
  // this page hides most of the lazy-chunk latency behind the grant round
  // trip. Cheap no-op once already loaded.
  useEffect(() => {
    if (isPdf) prefetchPdfRuntime()
  }, [isPdf])

  /* ── Protection policy, live from the store ────────────── */
  const policy = useMemo(
    () => resolveDrmPolicy(db.drm_policies, "WEB"),
    [db.drm_policies],
  )

  /* ── Device session ────────────────────────────────────── */
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [deviceError, setDeviceError] = useState<string | null>(null)
  const session = useMemo(
    () => db.device_sessions.find((s) => s.session_id === sessionId) ?? null,
    [db.device_sessions, sessionId],
  )
  // Kept in a ref so the protection callbacks can attribute an event to
  // the right session without being rebuilt whenever it changes.
  const sessionIdRef = useRef<string | null>(null)
  useEffect(() => {
    sessionIdRef.current = sessionId
  }, [sessionId])

  /* One claim per account, keyed on the user id rather than on `actor`
   * itself. `actor` is a memoised object, and a store write during
   * registration can hand back a fresh identity — which would re-run this
   * effect, write again, and loop until React bails out with "maximum
   * update depth exceeded". The id is stable across those rebuilds. */
  const registeredFor = useRef<string | null>(null)
  useEffect(() => {
    if (!actor) return
    if (registeredFor.current === actor.user_id) return
    registeredFor.current = actor.user_id
    const result = registerDeviceSession(actor)
    if (result.ok) {
      setSessionId(result.data.session_id)
      setDeviceError(null)
    } else {
      /* Clear the guard so a retry can happen: hitting the device cap is
       * not permanent — freeing a slot in the dashboard makes the next
       * attempt succeed. */
      registeredFor.current = null
      setDeviceError(result.error)
    }
  }, [actor])

  /* ── Activity tracking ─────────────────────────────────── */
  const lastActivity = useRef(Date.now())
  const markActivity = useCallback(() => {
    lastActivity.current = Date.now()
  }, [])

  useEffect(() => {
    const events: (keyof WindowEventMap)[] = [
      "pointerdown",
      "keydown",
      "wheel",
      "scroll",
      "touchstart",
    ]
    events.forEach((name) =>
      window.addEventListener(name, markActivity, { passive: true }),
    )
    return () =>
      events.forEach((name) => window.removeEventListener(name, markActivity))
  }, [markActivity])

  // Extends the session while the reader is actually being used, and stops
  // extending it once the reader goes quiet so the timeout can take hold.
  useEffect(() => {
    if (!session || !actor || session.revoked) return
    const id = window.setInterval(() => {
      if (Date.now() - lastActivity.current > ACTIVITY_WINDOW_MS) return
      const result = refreshDeviceSession(actor, session.session_id)
      if (result.ok) setSessionId(result.data.session_id)
    }, HEARTBEAT_MS)
    return () => window.clearInterval(id)
  }, [session, actor])

  /* ── Content grant ────────────────────────────────────── */
  /* One mint per account, product and device slot, keyed on a ref for the
   * same reason as the registration above: consuming a grant writes to the
   * store, and an effect that re-runs on every store write would spend the
   * grant's use budget without the reader turning a page. */
  const grantedFor = useRef<string | null>(null)
  useEffect(() => {
    if (!actor || !productId || !sessionId || !hasAccess(productId)) return
    const key = `${actor.user_id}:${productId}:${sessionId}`
    if (grantedFor.current === key) return
    grantedFor.current = key

    /* issueContentGrant is async now: a Storage-hosted file resolves to a
     * short-lived signed URL over the network. Guard against the effect
     * being torn down mid-flight (navigation, session change) so a late
     * result cannot write state for a reader that has already moved on. */
    let cancelled = false
    void (async () => {
      const issued = await issueContentGrant(actor, {
        productId,
        sessionId,
        scope: "STREAM",
      })
      if (cancelled) return
      if (!issued.ok) {
        grantedFor.current = null
        setContentUrl(undefined)
        setGrantError(issued.error)
        return
      }
      const redeemed = consumeContentGrant(issued.data.token, productId)
      if (cancelled) return
      if (!redeemed.ok) {
        grantedFor.current = null
        setContentUrl(undefined)
        setGrantError(redeemed.error)
        return
      }
      setGrantError(null)
      setGrantWatermark(redeemed.data.watermark_text)
      setContentUrl(redeemed.data.content_url)
    })()

    return () => {
      cancelled = true
    }
  }, [actor, productId, sessionId, hasAccess])

  /* Live access revalidation.
   *
   * The grant mint above runs once per sitting: after it succeeds the
   * reader holds a parsed PDF and a signed URL, and nothing would ever
   * tell it that access died in the meantime — an administrator pressing
   * חסימה (or שלילה) changed `user_products.access_status` on the server,
   * but this tab went on rendering from memory. The mirror in AppContext
   * only refreshed on focus, throttled to a minute, and even a refreshed
   * mirror would not tear down an already-rendered PdfCanvas.
   *
   * Two layers fix that without touching authorization itself:
   *
   *  1. Every 30 s the entitlements are re-fetched from Supabase (through
   *     RLS, the caller's own rows) and the guard below re-evaluates
   *     `hasAccess` against the fresh mirror.
   *  2. The guard — which already ran on open — now also runs on every
   *     mirror change and tears the content down when access is gone:
   *     the signed URL is dropped, the parsed document unmounts, and the
   *     block screen replaces the page. From there the existing paths take
   *     over: the Library hides the book, a reopen fails in
   *     issueContentGrant, and get-content-url refuses to sign anything
   *     new. This is an enforcement boundary, not cosmetics — without it
   *     the only server-side checks in the system never fire again after
   *     the first mint.
   */
  useEffect(() => {
    if (!productId) return

    const beat = window.setInterval(() => {
      if (document.visibilityState !== "visible") return
      void refreshEntitlements()
    }, ACCESS_REVALIDATE_MS)

    const revalidate = () => {
      if (document.visibilityState !== "visible") return
      void refreshEntitlements()
    }

    window.addEventListener("focus", revalidate)
    document.addEventListener("visibilitychange", revalidate)

    return () => {
      window.clearInterval(beat)
      window.removeEventListener("focus", revalidate)
      document.removeEventListener("visibilitychange", revalidate)
    }
  }, [productId, refreshEntitlements])

  // Enforcement guard for the beat above — see the comment block there.
  // Also covers the pre-existing cold-open path, so the original guard
  // below it is superseded; both exist for now, this one runs later.
  useEffect(() => {
    if (!productId) return
    if (!authReady) return
    if (!isAuthenticated) {
      navigate("/login", { replace: true })
      return
    }
    if (!hasAccess(productId)) {
      setContentUrl(undefined)
      setGrantWatermark(undefined)
      navigate("/dashboard/library", { replace: true })
    }
  }, [authReady, isAuthenticated, productId, hasAccess, userProducts])

  /* ── DRM deterrents ────────────────────────────────────── */
  const [shielded, setShielded] = useState(false)

  const onBlocked = useCallback(
    (type: SecurityEventType, detail?: string) => {
      recordEvent({
        user_id: user?.user_id,
        session_id: sessionIdRef.current ?? undefined,
        product_id: productId,
        event_type: type,
        metadata: detail ? { detail } : {},
      })
    },
    [user?.user_id, productId],
  )

  useScreenProtection({
    blockScreenshots: policy.block_screenshots,
    blockScreenRecording: policy.block_screen_recording,
    blockCopy: policy.block_copy,
    blockPrint: policy.block_print,
    hideOnBlur: policy.hide_content_on_blur,
    onShieldChange: setShielded,
    onBlocked,
  })

  const watermark = useMemo(() => {
    /* The grant's stamp wins: it was frozen when the grant was minted, so a
     * leaked capture keeps naming the account it was issued to even after
     * that account is renamed. */
    if (grantWatermark) return grantWatermark
    return user
      ? renderWatermark(policy.watermark_template, {
          name: `${user.first_name} ${user.last_name}`.trim(),
          email: user.email,
        })
      : ""
  }, [user, policy.watermark_template, grantWatermark])

  /* ── Reading state ─────────────────────────────────────── */
  const savedProgress = productId ? getProgress(productId) : undefined
  const [currentPage, setCurrentPage] = useState(() => {
    const saved = savedProgress?.current_page ?? 1
    return totalPages > 0 ? Math.min(Math.max(saved, 1), totalPages) : 1
  })
  const [darkMode, setDarkMode] = useState(true)
  const [isFullscreen, setIsFullscreen] = useState(false)
  /* Session-scoped, not persisted with the reading progress. Zoom is a
   * property of the screen in front of the reader right now — a phone held
   * at arm's length wants a different size from the same account on a
   * desktop — so carrying it between devices would be more often wrong than
   * right. Page position is the opposite: that one is worth keeping. */
  const [zoom, setZoom] = useState<number>(ZOOM_FIT)

  // Access guard — entitlements, not the catalogue, decide who may read.
  /* `authReady` must gate this: arriving from a verification link, the
   * session is still being restored, and without the gate the reader was
   * redirected to /login before the entitlement lookup had a chance. */
  useEffect(() => {
    if (!authReady) return
    if (!isAuthenticated) {
      navigate("/login", { replace: true })
      return
    }
    if (!productId || !hasAccess(productId)) {
      navigate("/dashboard/library", { replace: true })
    }
  }, [authReady, isAuthenticated, productId, hasAccess, navigate])

  /* Saves when the reader actually turns a page. The guard is a ref holding
   * what was last written rather than the effect's own dependency list:
   * `updateProgress` is rebuilt whenever the signed-in user's row is
   * rewritten, and without this the effect re-ran, saved, rewrote the row,
   * and re-ran again — a loop that took the reader down before the book ever
   * appeared. saveReadingProgress now declines no-op writes too; this is the
   * belt to that brace. */
  const savedProgressKey = useRef<string | null>(null)
  useEffect(() => {
    if (!productId || !contentUrl) return
    const key = `${productId}:${currentPage}:${totalPages}`
    if (savedProgressKey.current === key) return
    savedProgressKey.current = key
    updateProgress(productId, currentPage, totalPages)
  }, [currentPage, productId, contentUrl, totalPages, updateProgress])

  const goTo = useCallback(
    (page: number) => {
      markActivity()
      setCurrentPage(
        totalPages > 0
          ? Math.min(Math.max(page, 1), totalPages)
          : Math.max(page, 1),
      )
    },
    [totalPages, markActivity],
  )

  /* Leaving "fit" lands on the nearest rung rather than on the first one.
   * Fit-width renders somewhere around 100–115% depending on the viewport, so
   * pressing "smaller" from fit and dropping straight to 75% would read as a
   * lurch rather than as one step down. */
  const stepZoom = useCallback(
    (direction: 1 | -1) => {
      markActivity()
      setZoom((current) => {
        if (current === ZOOM_FIT) return direction > 0 ? 125 : 100
        const index = ZOOM_STEPS.indexOf(current)
        /* Not on the ladder — only possible if a step value was edited without
         * updating the sentinels. Snap to the largest rather than to zero,
         * because zero is the fit sentinel and would silently mean "reset". */
        if (index === -1) return ZOOM_STEPS[ZOOM_STEPS.length - 1]
        return ZOOM_STEPS[
          Math.min(Math.max(index + direction, 0), ZOOM_STEPS.length - 1)
        ]
      })
    },
    [markActivity],
  )

  const resetZoom = useCallback(() => {
    markActivity()
    setZoom(ZOOM_FIT)
  }, [markActivity])

  // Keyboard navigation (RTL: left arrow = forward)
  const handleKey = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft" || e.key === "ArrowDown") goTo(currentPage + 1)
      if (e.key === "ArrowRight" || e.key === "ArrowUp") goTo(currentPage - 1)
      if (e.key === "Escape") setIsFullscreen(false)
    },
    [currentPage, goTo],
  )

  useEffect(() => {
    window.addEventListener("keydown", handleKey)
    return () => window.removeEventListener("keydown", handleKey)
  }, [handleKey])

  /* ── Touch gestures ────────────────────────────────────── */
  const gesture = useRef<{ x: number, y: number, t: number } | null>(null)

  const beginGesture = useCallback((e: React.PointerEvent) => {
    gesture.current = { x: e.clientX, y: e.clientY, t: Date.now() }
  }, [])

  const cancelGesture = useCallback(() => {
    gesture.current = null
  }, [])

  const endGesture = useCallback(
    (e: React.PointerEvent, edge: "next" | "prev") => {
      const start = gesture.current
      gesture.current = null
      if (!start) return
      const dx = e.clientX - start.x
      const dy = e.clientY - start.y

      // Clearly horizontal travel wins: a vertical drag on the strip is a
      // scroll, and turning a page on the way past would feel broken.
      if (Math.abs(dx) >= SWIPE_THRESHOLD && Math.abs(dx) > Math.abs(dy)) {
        goTo(dx < 0 ? currentPage + 1 : currentPage - 1)
        return
      }
      // Otherwise a short, quick press is an edge tap.
      if (
        Math.hypot(dx, dy) < TAP_TRAVEL &&
        Date.now() - start.t < TAP_DURATION
      ) {
        goTo(edge === "next" ? currentPage + 1 : currentPage - 1)
      }
    },
    [currentPage, goTo],
  )

  if (!authReady || !isAuthenticated || !productId || !hasAccess(productId)) return null

  const progressPercent = totalPages > 0 ? (currentPage / totalPages) * 100 : 0

  /* Page stepping does not depend on knowing the total, and that is a fix
   * rather than a preference.
   *
   * It used to require `totalPages > 0`, which meant a title whose page count
   * was never filled in rendered with no navigation at all: no buttons, no
   * counter, no edge swipes. A paying customer could only read it by
   * scrolling, with no indication that the book had more than one page. The
   * count is a number an administrator types into the CMS; turning a page
   * must not hinge on whether somebody remembered to type it.
   *
   * The count is still used for what it is genuinely for — the progress bar,
   * the "N / M" denominator and the clamp at the last page. When it is
   * unknown the reader shows the current page alone and lets forward
   * navigation run unbounded, because the viewer clamps at the document's
   * real last page and stays put: pressing "next" there is a no-op, not an
   * error. `goTo` already had that branch; only the gate was wrong. */
  const canStep = Boolean(contentUrl)
  const knownTotal = totalPages > 0

  const zoomedIn = zoom !== ZOOM_FIT
  const canZoomIn = !zoomedIn || zoom < ZOOM_STEPS[ZOOM_STEPS.length - 1]
  const canZoomOut = !zoomedIn || zoom > ZOOM_STEPS[0]
  const expired = session ? isSessionExpired(session, policy) : false
  const revoked = Boolean(session?.revoked)
  const locked = Boolean(deviceError) || expired || revoked

  const resume = () => {
    if (!actor) return
    // A revoked slot cannot be renewed — it has to be claimed again, which
    // re-checks the device cap and can legitimately fail.
    const result =
      session && !session.revoked
        ? refreshDeviceSession(actor, session.session_id)
        : registerDeviceSession(actor)
    if (result.ok) {
      setSessionId(result.data.session_id)
      setDeviceError(null)
    } else {
      setDeviceError(result.error)
    }
  }

  const bg = darkMode ? "#07070E" : "#FAFAF5"
  const textColor = darkMode ? "#EDE8DF" : "#1A1A1A"
  const panelBg = darkMode ? "#0D0D1C" : "#F0EFE8"
  const borderColor = darkMode ? "#1E1E2E" : "#E0DDD0"
  const mutedColor = darkMode ? "#7A7589" : "#888"

  return (
    <div
      className="reader-shell flex flex-col"
      style={{
        background: bg,
        color: textColor,
        transition: "background 0.2s, color 0.2s",
        userSelect: "none",
      }}
    >
      {/* Top bar */}
      <header
        className="safe-top fixed top-0 left-0 right-0 z-50 border-b flex items-center justify-between px-3 sm:px-5 h-14 sm:h-12"
        style={{
          background: panelBg,
          borderColor,
          backdropFilter: "blur(8px)",
        }}
      >
        <div className="flex items-center gap-2 sm:gap-4 min-w-0">
          <button
            onClick={() => navigate("/dashboard/library")}
            className="tap-target text-sm flex items-center gap-1.5 transition-opacity hover:opacity-70"
            style={{ color: mutedColor }}
          >
            <Icon name="arrowRight" size={14} />
            <span className="hidden sm:inline">לספרייה</span>
          </button>
          <span
            className="text-xs hidden sm:block truncate max-w-[40vw]"
            style={{ color: mutedColor }}
          >
            {title}
          </span>
        </div>

        <div className="flex items-center gap-1.5 sm:gap-3">
          {policy.watermark_enabled &&
            watermark && /* Telling the reader the copy is attributed is part of the
             * deterrent: a leaked page is traceable to them personally. */
            (
              <span
                className="hidden sm:flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded border"
                style={{ borderColor, color: mutedColor }}
                title={`העותק מסומן בשם: ${watermark}`}
              >
                <Icon name="shield" size={12} /> עותק אישי מסומן
              </span>
            )}

          {/* Text size. Offered only for a PDF: these controls work through
           * the PDF open-parameter fragment, and a non-PDF content URL goes to
           * the iframe untouched, so there would be nothing for them to act on.
           * Showing a control that cannot work is worse than not showing it. */}
          {isPdf && (
            <div
              className="flex items-center gap-1"
              role="group"
              aria-label="גודל הטקסט"
            >
              <button
                onClick={() => stepZoom(-1)}
                disabled={!canZoomOut}
                className="tap-target flex items-center justify-center rounded border transition-opacity hover:opacity-70 disabled:opacity-30 disabled:hover:opacity-30"
                style={{ borderColor, color: mutedColor }}
                aria-label="הקטנת הטקסט"
                title="הקטנת הטקסט"
              >
                <Icon name="zoomOut" size={15} />
              </button>

              {/* The readout is also the reset: one control that says what the
               * size is and returns it to fit-width, instead of a third button
               * in a bar that is already crowded on a phone. While at fit it
               * shows the fit-width glyph and is inert — there is nothing to
               * reset — and the fixed min-width stops the bar from jumping
               * sideways every time the label changes shape. */}
              <button
                onClick={resetZoom}
                disabled={!zoomedIn}
                className="tap-target flex items-center justify-center gap-1 px-1 text-[11px] tabular-nums rounded border transition-opacity hover:opacity-70 disabled:opacity-40 disabled:hover:opacity-40"
                style={{ borderColor, color: mutedColor, minWidth: "2.9rem" }}
                aria-label="התאמת העמוד לרוחב המסך"
                title="התאמה לרוחב המסך"
              >
                {zoomedIn ? `${zoom}%` : <Icon name="fitWidth" size={14} />}
              </button>

              <button
                onClick={() => stepZoom(1)}
                disabled={!canZoomIn}
                className="tap-target flex items-center justify-center rounded border transition-opacity hover:opacity-70 disabled:opacity-30 disabled:hover:opacity-30"
                style={{ borderColor, color: mutedColor }}
                aria-label="הגדלת הטקסט"
                title="הגדלת הטקסט"
              >
                <Icon name="zoomIn" size={15} />
              </button>
            </div>
          )}

          {/* Dark mode */}
          <button
            onClick={() => setDarkMode((d) => !d)}
            className="tap-target flex items-center justify-center rounded border transition-opacity hover:opacity-70"
            style={{ borderColor, color: mutedColor }}
            aria-label={darkMode ? "מצב בהיר" : "מצב כהה"}
          >
            <Icon name={darkMode ? "sun" : "moon"} size={15} />
          </button>

          <button
            onClick={() => setIsFullscreen((f) => !f)}
            className="tap-target flex items-center justify-center rounded border transition-opacity hover:opacity-70"
            style={{ borderColor, color: mutedColor }}
            aria-label="מסך מלא"
          >
            <Icon name="layers" size={15} />
          </button>
        </div>
      </header>

      {/* Main reading area */}
      <main className="flex-1 pt-14 sm:pt-12 pb-24 sm:pb-20">
        {contentUrl && !locked ? (
          <div
            className="relative mx-auto px-1.5 sm:px-2 py-2"
            style={{
              maxWidth: "72rem",
              height: isFullscreen
                ? "calc(100dvh - 3rem)"
                : "calc(100dvh - 8.5rem)",
            }}
          >
            {/* A scroll container rather than a replaced element: the canvas
             * pages render at natural height and the reader scrolls inside
             * the same shell, so the header, bar and watermark never move. */}
            <div
              className="h-full overflow-auto rounded-lg border"
              style={{ borderColor, background: "#fff" }}
            >
              {isPdf ? (
                <PdfCanvas
                  signedUrl={contentUrl}
                  page={currentPage}
                  zoom={zoom === ZOOM_FIT ? 1 : zoom / 100}
                  watermark={policy.watermark_enabled ? watermark : undefined}
                  onTotalPages={setDocTotalPages}
                />
              ) : (
                <iframe
                  src={contentUrl}
                  title={title}
                  className="h-full w-full"
                  style={{ background: "#fff" }}
                />
              )}
            </div>

            {canStep && (
              <>
                {/* Edge gesture strips. Deliberately narrow and on the
                 * sides only, so the document in the centre keeps its own
                 * scrolling and pinch-zoom. */}
                <div
                  className="swipe-zone absolute top-0 bottom-0 right-0 z-30 flex items-center justify-center"
                  style={{
                    width: "clamp(44px, 11vw, 88px)",
                    touchAction: "pan-y",
                  }}
                  onPointerDown={beginGesture}
                  onPointerUp={(e) => endGesture(e, "prev")}
                  onPointerCancel={cancelGesture}
                  onPointerLeave={cancelGesture}
                  role="button"
                  tabIndex={-1}
                  aria-label="העמוד הקודם — החליקו או הקישו"
                >
                  <Icon
                    name="chevronRight"
                    size={22}
                    className="swipe-hint"
                    style={{ color: mutedColor }}
                  />
                </div>
                <div
                  className="swipe-zone absolute top-0 bottom-0 left-0 z-30 flex items-center justify-center"
                  style={{
                    width: "clamp(44px, 11vw, 88px)",
                    touchAction: "pan-y",
                  }}
                  onPointerDown={beginGesture}
                  onPointerUp={(e) => endGesture(e, "next")}
                  onPointerCancel={cancelGesture}
                  onPointerLeave={cancelGesture}
                  role="button"
                  tabIndex={-1}
                  aria-label="העמוד הבא — החליקו או הקישו"
                >
                  <Icon
                    name="chevronLeft"
                    size={22}
                    className="swipe-hint"
                    style={{ color: mutedColor }}
                  />
                </div>
              </>
            )}
          </div>
        ) : (
          <div className="max-w-lg mx-auto px-6 py-24 text-center">
            <div
              className="w-16 h-16 rounded-full mx-auto mb-5 flex items-center justify-center"
              style={{
                background: "rgba(212,160,48,0.1)",
                color: "var(--color-primary)",
              }}
            >
              <Icon name="bookOpen" size={26} />
            </div>
            <h1 className="font-display text-2xl font-semibold mb-2">
              {grantError ? "הקישור לתוכן לא אושר" : "התוכן טרם הועלה"}
            </h1>
            <p className="text-sm mb-2" style={{ color: mutedColor }}>
              {grantError ??
                `לקובץ הקריאה של "${title}" עדיין לא הוצמד עותק דיגיטלי במערכת.`}
            </p>
            <p className="text-sm mb-8" style={{ color: mutedColor }}>
              {grantError
                ? "כל קריאה מקבלת קישור חד־פעמי משלה. אם הגישה שלך תקינה, ניסיון נוסף מנפיק קישור טרי."
                : "הגישה שלך לספר תקינה — התוכן יופיע כאן מיד לאחר שהקובץ יועלה."}
            </p>
            <div className="flex flex-wrap justify-center gap-3">
              {grantError && (
                <button
                  onClick={() => {
                    /* Clearing the guard is what lets the effect mint again;
                     * without it a refusal would be permanent for this slot. */
                    grantedFor.current = null
                    setGrantError(null)
                    setContentUrl(undefined)
                    resume()
                  }}
                  className="btn-gradient tap-target px-5 py-2.5 rounded-full text-sm font-semibold"
                >
                  ניסיון נוסף
                </button>
              )}
              <button
                onClick={() => navigate("/dashboard/library")}
                className="tap-target px-5 py-2.5 rounded-full text-sm font-semibold border transition-opacity hover:opacity-70"
                style={{ borderColor, color: textColor }}
              >
                חזרה לספרייה
              </button>
              <a
                href="/support"
                className="btn-gradient tap-target px-5 py-2.5 rounded-full text-sm font-semibold"
              >
                פנייה לתמיכה
              </a>
            </div>
          </div>
        )}
      </main>

      {/* Bottom navigation bar */}
      {canStep && !locked && (
        <div
          className="safe-bottom fixed bottom-0 left-0 right-0 z-50 border-t"
          style={{ background: panelBg, borderColor }}
        >
          {/* Progress bar. Only when the total is known: a bar that cannot
           * know its own denominator is not a progress bar, it is a decoration
           * stuck at zero. */}
          {knownTotal && (
            <div className="h-0.5" style={{ background: borderColor }}>
              <div
                className="h-full transition-all"
                style={{
                  width: `${progressPercent}%`,
                  background: "var(--color-primary)",
                }}
              />
            </div>
          )}

          <div className="flex items-center justify-between gap-2 px-3 sm:px-5 py-2.5">
            <button
              onClick={() => goTo(currentPage - 1)}
              disabled={currentPage <= 1}
              className="tap-target flex items-center gap-1.5 text-sm font-medium px-4 py-2.5 rounded-lg border disabled:opacity-30 transition-opacity hover:opacity-70"
              style={{ borderColor, color: textColor }}
            >
              <Icon name="chevronRight" size={15} />
              <span>הקודם</span>
            </button>

            <div
              className="flex items-center gap-3 text-sm"
              style={{ color: mutedColor }}
            >
              <span className="tabular-nums">
                {knownTotal
                  ? `${currentPage} / ${totalPages}`
                  : `עמוד ${currentPage}`}
              </span>
              {knownTotal && (
                <>
                  <span className="hidden sm:block">·</span>
                  <span className="hidden sm:block">
                    {progressPercent.toFixed(0)}% הושלמו
                  </span>
                </>
              )}
            </div>

            <button
              onClick={() => goTo(currentPage + 1)}
              disabled={knownTotal && currentPage >= totalPages}
              className="tap-target flex items-center gap-1.5 text-sm font-medium px-4 py-2.5 rounded-lg border disabled:opacity-30 transition-opacity hover:opacity-70"
              style={{ borderColor, color: textColor }}
            >
              <span>הבא</span>
              <Icon name="chevronLeft" size={15} />
            </button>
          </div>

          <p
            className="text-center text-[11px] pb-2 sm:hidden"
            style={{ color: mutedColor }}
          >
            החליקו משולי המסך או הקישו עליהם כדי להפוך דף
          </p>
        </div>
      )}

      {/* Identity watermark — the attribution layer over protected content */}
      {policy.watermark_enabled && watermark && !locked && (
        <div
          className="drm-watermark fixed inset-0 overflow-hidden"
          style={{ zIndex: 120 }}
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
              opacity: policy.watermark_opacity,
              color: darkMode ? "#FFFFFF" : "#000000",
            }}
          >
            {Array.from({ length: 9 }).map((_, row) => (
              <div key={row} className="flex justify-around">
                {Array.from({ length: 4 }).map((_, col) => (
                  <span key={col} className="text-[13px] tracking-wider">
                    {watermark}
                  </span>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Device / session lock — replaces the content, never sits behind it */}
      {locked && (
        <div
          className="fixed inset-0 flex flex-col items-center justify-center gap-4 px-6 text-center"
          style={{ background: bg, zIndex: 210 }}
        >
          <Icon
            name={revoked ? "lock" : "clock"}
            size={34}
            style={{ color: "var(--color-primary)" }}
          />
          <h2 className="font-display text-xl font-semibold">
            {revoked
              ? "הגישה ממכשיר זה נחסמה"
              : expired
                ? "ההתקשרות פגה"
                : "לא ניתן לפתוח את הקובץ"}
          </h2>
          <p className="text-sm max-w-md" style={{ color: mutedColor }}>
            {revoked
              ? "מנהל מערכת חסם את הקריאה מהמכשיר הזה. ניתן לבקש רישום מחדש, והבקשה תיבדק מול מגבלת המכשירים של החשבון."
              : expired
                ? `לא הייתה פעילות במשך ${policy.session_timeout_minutes} דקות, ולכן הקריאה נעצרה. ההתקדמות שלך נשמרה.`
                : deviceError}
          </p>
          <div className="flex flex-wrap justify-center gap-3 mt-2">
            <button
              onClick={resume}
              className="btn-gradient tap-target px-6 py-3 rounded-full text-sm font-semibold"
            >
              {revoked ? "נסה לרשום את המכשיר שוב" : "המשך קריאה"}
            </button>
            <button
              onClick={() => navigate("/dashboard/library")}
              className="tap-target px-6 py-3 rounded-full text-sm font-semibold border transition-opacity hover:opacity-70"
              style={{ borderColor, color: textColor }}
            >
              חזרה לספרייה
            </button>
            <a
              href="/support"
              className="tap-target px-6 py-3 rounded-full text-sm flex items-center gap-2"
              style={{ color: mutedColor }}
            >
              <Icon name="message" size={15} /> פנייה לתמיכה
            </a>
          </div>
        </div>
      )}

      {/* DRM shield overlay — covers everything while the window is blurred */}
      {shielded && !locked && (
        <div
          className="fixed inset-0 flex flex-col items-center justify-center gap-4 px-6"
          style={{ background: bg, zIndex: 200 }}
        >
          <Icon
            name="shield"
            size={36}
            style={{ color: "var(--color-primary)" }}
          />
          <p className="text-sm text-center" style={{ color: mutedColor }}>
            התוכן מוסתר להגנה על זכויות יוצרים.
            <br />
            חזרו לחלון זה כדי להמשיך לקרוא.
          </p>
        </div>
      )}
    </div>
  )
}
