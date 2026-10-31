import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import usePageTitle from "../lib/usePageTitle"
import { useParams, useNavigate } from "react-router"
import { useApp } from "../context/AppContext"
import { useCms } from "../context/CmsContext"
import { useStore } from "../data/store"
import PdfSurface from "../components/pdf/PdfSurface"
import { prefetchPdfRuntime } from "../components/pdf/pdf-engine"
import WatermarkPattern from "../components/WatermarkPattern"
import BookmarkToggle from "../components/reader/BookmarkToggle"
import AnnotationsPanel from "../components/reader/AnnotationsPanel"
import NoteEditorModal from "../components/reader/NoteEditorModal"
import PageNavigator from "../components/reader/PageNavigator"
import SelectionToolbar from "../components/reader/SelectionToolbar"
import {
  contentFailure,
  isProtectedContentUrl,
} from "../lib/content-storage"
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
import { isSupabaseConfigured } from "../integrations/supabase/supabase"
import { fetchProfile } from "../integrations/supabase/supabase-auth"
import { DEFAULT_HIGHLIGHT_COLOR } from "../lib/annotation-utils"
import {
  nextReaderPage,
  pageRangeLabel,
  previousReaderPage,
  readerVisiblePages,
} from "../lib/reader-pages"
import { useMediaQuery } from "../lib/useMediaQuery"
import { useReaderAnnotations } from "../lib/useReaderAnnotations"
import { fail } from "../shared/result"
import type {
  ReaderHighlight,
  ReaderTextSelection,
  SecurityEventType,
  User,
} from "../types"
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
 * The streaming endpoint re-checks authorization for every request, but a
 * document already parsed and painted in this tab needs no new request - so
 * a revocation would leave what is already on screen untouched. The only way
 * an already-open reader learns that an administrator pressed חסימה is to
 * ask the server again. Thirty seconds bounds how long a suspended account
 * can keep turning pages; each beat is one cheap entitlement read through
 * RLS.
 */
const ACCESS_REVALIDATE_MS = 30_000

/**
 * Text-size rungs, as a percentage of the PDF's natural scale.
 *
 * Discrete rather than continuous because every change repaints the page
 * through PdfSurface at a new scale - a slider would fire a repaint for
 * every pixel of travel. Repaints are cheap (one canvas draw from the
 * already-parsed document), but rungs still read better than a twitchy
 * continuous control.
 */
const ZOOM_STEPS = [75, 100, 125, 150, 200, 250, 300, 400]

const WATERMARK_OVERLAY_STYLE = { zIndex: 120 } as const

type NoteEditorState =
  | { mode: "create"; selection: ReaderTextSelection; color: string }
  | { mode: "edit"; highlight: ReaderHighlight }
/** Sentinel meaning "fit the page to the width", i.e. emit no zoom at all. */
const ZOOM_FIT = 0

/**
 * Reader chrome palette.
 *
 * The reader keeps its own dark/light reading choice, independent of the
 * account theme, so its toolbars and overlays use both brand modes directly
 * rather than the theme-dependent CSS variables. The values mirror the
 * black / cream / camel tokens: warm black chrome in dark mode, cream chrome
 * in light mode, with camel as the single accent.
 */
const READER_PALETTE = {
  dark: {
    background: "#11100e",
    chrome: "#191612",
    text: "#f4eee4",
    muted: "#b7ac9e",
    border: "#3a332b",
    accent: "#de9a60",
    accentSoft: "rgba(222, 154, 96, 0.12)",
  },
  light: {
    background: "#f4eee4",
    chrome: "#fbf8f2",
    text: "#191612",
    muted: "#625a51",
    border: "#d9cfc2",
    accent: "#96552d",
    accentSoft: "rgba(150, 85, 45, 0.10)",
  },
} as const

/**
 * Page-turn shortcuts are global, so they must never steal keys from a
 * field the reader is typing in. Walk the target (and the focused element,
 * which can differ when the event starts at <body>) up to the nearest form
 * or editable node.
 */
function isEditableTarget(target: EventTarget | null): boolean {
  const element =
    target instanceof HTMLElement
      ? target
      : document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null
  if (!element) return false
  if (element.isContentEditable) return true
  const tag = element.tagName
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true
  return Boolean(
    element.closest(
      "input, textarea, select, [contenteditable]:not([contenteditable='false']), [role='textbox']",
    ),
  )
}

/** A dialog or the floating accessibility panel owns the keyboard while open. */
function hasOpenDialog(): boolean {
  return Boolean(
    document.querySelector(
      '[role="dialog"], [aria-modal="true"], .a11y-panel',
    ),
  )
}

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
 *    redistribution - a capture of this screen carries the buyer's own
 *    name and address - and the deterrents around it only remove the
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
 * repainting the current page at a new scale through PdfSurface - there
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

  usePageTitle(title ? `קריאה - ${title}` : "קריאה")
  /* The CMS count is a hint only; the document itself is authoritative.
   * A mistyped count used to break the progress bar (a 148-page PDF
   * against "3" rendered 300%) and clamp navigation early. PdfSurface
   * reports the real total once the file is parsed. */
  const [docTotalPages, setDocTotalPages] = useState<number | null>(null)
  const totalPages = docTotalPages ??
    product?.book?.total_pages ??
    snapshot?.total_pages ??
    0

  /* The address of the file is never read off the catalogue row. The reader
   * asks the service layer for a grant, which re-checks the entitlement and
   * the device session and hands back an authenticated streaming endpoint -
   * a use-budgeted local grant over a server-side check, never a Storage
   * address, and the reason the storefront catalogue carries no content_url
   * at all. */
  const [contentUrl, setContentUrl] = useState<string | undefined>(undefined)
  const [grantWatermark, setGrantWatermark] = useState<string | undefined>(
    undefined,
  )
  /* The profile row is the live source for name/phone. The AppContext user
   * is already merged from Auth + profile at restore time, but a purchase,
   * support edit or checkout name sync may have happened since; re-reading
   * the row here keeps the forensic stamp tied to the current account. */
  const [liveProfile, setLiveProfile] = useState<User | null>(null)
  /* Frozen when this reading session receives its content URL; every tile
   * of the watermark carries this exact timestamp, not the render time. */
  const [accessStartedAt, setAccessStartedAt] = useState(() => new Date())
  const [grantError, setGrantError] = useState<string | null>(null)
  /* The status class the refusal carried. Without it a missing file and a
   * storage outage look identical to this screen, which is how the heading
   * came to read "the link was not approved" over a body saying the file was
   * never uploaded. */
  const [grantCode, setGrantCode] = useState<string | null>(null)
  /* The mint is a network round trip. Until it has been answered nothing is
   * known about the file - and the screen used to declare, inside that
   * window, that the publisher had never uploaded it. */
  const [grantPending, setGrantPending] = useState(true)
  /* Bumped by the retry actions. The mint effect keys on it because a
   * retry after a refusal often changes nothing else: the account, the
   * session id and the entitlement are all identical to the failed run,
   * so without a nonce the effect would never run again and the retry
   * button would clear the message and hang on "checking" forever. */
  const [grantAttempt, setGrantAttempt] = useState(0)

  useEffect(() => {
    setLiveProfile(null)

    if (!isSupabaseConfigured || !user?.user_id) return

    let cancelled = false

    void fetchProfile(user.user_id)
      .then((profile) => {
        if (!cancelled && profile) setLiveProfile(profile)
      })
      .catch(() => undefined)

    return () => {
      cancelled = true
    }
  }, [
    user?.user_id,
    user?.first_name,
    user?.last_name,
    user?.phone,
  ])

  useEffect(() => {
    setAccessStartedAt(new Date())
  }, [productId])

  /* Hosted books are served by the authenticated reader-content function -
   * a URL that never names the Storage object and re-checks the session and
   * entitlement on every request. Its path has no .pdf suffix, so it is
   * recognized explicitly; only legacy/external addresses fall back to the
   * extension test. */
  const protectedContent = Boolean(
    contentUrl && isProtectedContentUrl(contentUrl),
  )
  const isPdf = Boolean(
    contentUrl &&
      (protectedContent || /\.pdf(\?|#|$)/i.test(contentUrl)),
  )

  /* A PDF renders through PdfSurface, which parses the document once and
   * paints pages onto a canvas the page owns - no browser PDF plugin, so
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
   * registration can hand back a fresh identity - which would re-run this
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
       * not permanent - freeing a slot in the dashboard makes the next
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
   * grant's use budget without the reader turning a page.
   *
   * The key records whether that slot is IN FLIGHT or DONE. An earlier
   * version marked it as claimed before the request resolved and never
   * released it, so a mint that was torn down mid-flight (an entitlement
   * mirror write, a session refresh) stayed "claimed" while its result was
   * discarded - the reader sat on "פותח את הספר…" indefinitely and only a
   * full reload could start a new mint. Releasing the claim when the run
   * is cancelled is what lets the next run actually ask again.
   *
   * The access check is collapsed to a boolean before it enters the
   * dependency list: `hasAccess` is rebuilt whenever the entitlement array
   * is touched, and depending on the function itself would cancel a
   * perfectly healthy signing request for a change that did not alter the
   * answer. */
  const grantRun = useRef<{ key: string; status: "inflight" | "done" } | null>(
    null,
  )
  /* A single automatic retry for a transport failure. A hung request that
   * the 20 s timeout in the content client turns into STORAGE is exactly
   * the case that used to require a manual browser refresh; retrying once
   * recovers it without making the customer do anything. */
  const autoRetried = useRef<string | null>(null)
  const accessOn = Boolean(productId && hasAccess(productId))
  useEffect(() => {
    if (!actor || !productId || !sessionId || !accessOn) return
    const key = `${actor.user_id}:${productId}:${sessionId}`
    if (grantRun.current?.key === key) return
    grantRun.current = { key, status: "inflight" }
    setGrantPending(true)

    /* issueContentGrant is async now: a Storage-hosted file resolves to the
     * authenticated streaming endpoint over the network. Guard against the
     * effect being torn down mid-flight (navigation, session change) so a
     * late result cannot write state for a reader that has already moved on. */
    let cancelled = false
    void (async () => {
      try {
        const issued = await issueContentGrant(actor, {
          productId,
          sessionId,
          scope: "STREAM",
        })
        if (cancelled) return
        if (!issued.ok) {
          if (issued.code === "STORAGE" && autoRetried.current !== key) {
            autoRetried.current = key
            grantRun.current = null
            setGrantAttempt((attempt) => attempt + 1)
            return
          }
          grantRun.current = null
          setContentUrl(undefined)
          setGrantCode(issued.code)
          setGrantError(issued.error)
          setGrantPending(false)
          return
        }
        const redeemed = consumeContentGrant(issued.data.token, productId)
        if (cancelled) return
        if (!redeemed.ok) {
          grantRun.current = null
          setContentUrl(undefined)
          setGrantCode(redeemed.code)
          setGrantError(redeemed.error)
          setGrantPending(false)
          return
        }
        grantRun.current = { key, status: "done" }
        setGrantError(null)
        setGrantCode(null)
        setGrantPending(false)
        setGrantWatermark(redeemed.data.watermark_text)
        setAccessStartedAt(new Date())
        setContentUrl(redeemed.data.content_url)
      } catch {
        /* Both service calls resolve by contract, but the store write
         * underneath them can still throw (a full localStorage, for
         * one). Without this branch that throw escaped the async task,
         * left the key inflight and parked the screen on "פותח את
         * הספר…" forever - the exact failure this effect now guards
         * against. */
        if (cancelled) return
        if (autoRetried.current !== key) {
          autoRetried.current = key
          grantRun.current = null
          setGrantAttempt((attempt) => attempt + 1)
          return
        }
        const failure = contentFailure(undefined)
        grantRun.current = null
        setContentUrl(undefined)
        setGrantCode(failure.code)
        setGrantError(failure.message)
        setGrantPending(false)
      }
    })()

    return () => {
      cancelled = true
      if (
        grantRun.current?.key === key &&
        grantRun.current.status === "inflight"
      ) {
        grantRun.current = null
      }
    }
  }, [actor, productId, sessionId, accessOn, grantAttempt])

  /* Live access revalidation.
   *
   * The grant mint above runs once per sitting: after it succeeds the
   * reader holds a parsed PDF and a content endpoint, and nothing would ever
   * tell it that access died in the meantime - an administrator pressing
   * חסימה (or שלילה) changed `user_products.access_status` on the server,
   * but this tab went on rendering from memory. The mirror in AppContext
   * only refreshed on focus, throttled to a minute, and even a refreshed
   * mirror would not tear down an already-rendered PdfSurface.
   *
   * Two layers fix that without touching authorization itself:
   *
   *  1. Every 30 s the entitlements are re-fetched from Supabase (through
   *     RLS, the caller's own rows) and the guard below re-evaluates
   *     `hasAccess` against the fresh mirror.
   *  2. The guard - which already ran on open - now also runs on every
   *     mirror change and tears the content down when access is gone:
   *     the content endpoint is dropped, the parsed document unmounts, and the
   *     block screen replaces the page. From there the existing paths take
   *     over: the Library hides the book, a reopen fails in
   *     issueContentGrant, and reader-content refuses any new request. This is an enforcement boundary, not cosmetics - without it
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

  // Enforcement guard for the beat above - see the comment block there.
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
    if (!user) return grantWatermark ?? ""

    /* The live profile row wins over the last AppContext snapshot, but a
     * field it does not hold falls back to the session-derived user. Email
     * comes from the session because that is the address Auth verified. */
    const first = liveProfile?.first_name?.trim() || user.first_name.trim()
    const last = liveProfile?.last_name?.trim() || user.last_name.trim()

    const rendered = renderWatermark(policy.watermark_template, {
      name: `${first} ${last}`.trim(),
      email: user.email || liveProfile?.email || "",
      phone: liveProfile?.phone?.trim() || user.phone?.trim() || "",
      user_id: user.user_id,
      accessedAt: accessStartedAt,
    })

    /* The grant stamp is the fallback for a profile that has no usable
     * fields; the live stamp is what makes the mark reflect this account. */
    return rendered || grantWatermark || ""
  }, [
    user,
    liveProfile,
    policy.watermark_template,
    accessStartedAt,
    grantWatermark,
  ])

  /* The PDF page is always white in this canvas reader, so a dark mark is
   * the one that survives on the content in both themes. 8–12% keeps the
   * repeated multi-line grid legible in a photo without fighting the text. */
  const watermarkOpacity = Math.min(
    0.12,
    Math.max(0.08, policy.watermark_opacity || 0.1),
  )

  /* ── Reading state ─────────────────────────────────────── */
  const savedProgress = productId ? getProgress(productId) : undefined
  const [currentPage, setCurrentPage] = useState(() => {
    const saved = savedProgress?.current_page ?? 1
    return totalPages > 0 ? Math.min(Math.max(saved, 1), totalPages) : 1
  })
  /* True once the reader has navigated in this sitting. The very first
   * page render is not a reading event: it must never write progress,
   * or a mount that raced the CMS load (total unknown, initialiser fell
   * back to 1) would overwrite the stored position - the mechanism
   * behind "blocking reset my page". */
  const navigated = useRef(false)
  const [darkMode, setDarkMode] = useState(true)
  /* This is a roomier reading canvas, not the browser Fullscreen API, so
   * both the state name and the visible label say "immersive reading". */
  const [immersiveMode, setImmersiveMode] = useState(false)
  /* Session-scoped, not persisted with the reading progress. Zoom is a
   * property of the screen in front of the reader right now - a phone held
   * at arm's length wants a different size from the same account on a
   * desktop - so carrying it between devices would be more often wrong than
   * right. Page position is the opposite: that one is worth keeping. */
  const [zoom, setZoom] = useState<number>(ZOOM_FIT)

  const isWideReader = useMediaQuery("(min-width: 1024px)")
  const [spreadMode, setSpreadMode] = useState(false)
  const effectiveSpread = spreadMode && isWideReader

  const [pendingSelection, setPendingSelection] =
    useState<ReaderTextSelection | null>(null)
  const [noteEditor, setNoteEditor] = useState<NoteEditorState | null>(null)
  const [annotationsOpen, setAnnotationsOpen] = useState(false)

  const annotations = useReaderAnnotations(actor, productId)
  const {
    bookmarks,
    highlights,
    loading: annotationsLoading,
    error: annotationsError,
    addBookmark,
    removeBookmark,
    addHighlight,
    editHighlight,
    removeHighlight,
    refresh: refreshAnnotations,
    clearError: clearAnnotationError,
  } = annotations

  const visiblePages = useMemo(
    () =>
      readerVisiblePages(currentPage, totalPages, effectiveSpread),
    [currentPage, effectiveSpread, totalPages],
  )
  const pageLabel = pageRangeLabel(visiblePages)

  useEffect(() => {
    setPendingSelection(null)
  }, [currentPage, effectiveSpread])

  useEffect(() => {
    setNoteEditor(null)
  }, [currentPage, effectiveSpread])

  useEffect(() => {
    if (annotationsOpen) setPendingSelection(null)
  }, [annotationsOpen])

  /* A stored position can outlive a re-uploaded, shorter document. */
  useEffect(() => {
    if (totalPages <= 0) return
    setCurrentPage((page) => Math.min(Math.max(page, 1), totalPages))
  }, [totalPages])

  // Access guard - entitlements, not the catalogue, decide who may read.
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
   * and re-ran again - a loop that took the reader down before the book ever
   * appeared. saveReadingProgress now declines no-op writes too; this is the
   * belt to that brace. */
  const savedProgressKey = useRef<string | null>(null)
  useEffect(() => {
    /* No navigation, no write. Opening the book is not progress; saving
     * on mount is what let a page-1 default (a mount that rendered
     * before the document total was known) replace the stored position
     * of page 12. */
    if (!navigated.current) return
    if (!productId || !contentUrl) return
    const key = `${productId}:${currentPage}:${totalPages}`
    if (savedProgressKey.current === key) return
    savedProgressKey.current = key
    updateProgress(productId, currentPage, totalPages)
  }, [currentPage, productId, contentUrl, totalPages, updateProgress])

  /* Late resume. The mount initialiser could only clamp the saved page
   * against the total it had at that instant - often zero, before the
   * CMS catalogue and the parsed document have reported. Once a real
   * total arrives, if the reader has not navigated yet, jump to the
   * stored position; this is the same clamp the initialiser wanted to
   * do, just with the data it was missing. */
  useEffect(() => {
    if (navigated.current) return
    if (!totalPages) return
    const saved = savedProgress?.current_page
    if (!saved || saved === currentPage) return
    setCurrentPage(Math.min(Math.max(saved, 1), totalPages))
    /* currentPage is read, not tracked: this effect responds to the
     * total and the stored position becoming known, and re-running on
     * every page turn is exactly what navigated.current already gates. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totalPages, savedProgress?.current_page])

  const goTo = useCallback(
    (page: number) => {
      markActivity()
      navigated.current = true
      setCurrentPage(
        totalPages > 0
          ? Math.min(Math.max(page, 1), totalPages)
          : Math.max(page, 1),
      )
    },
    [totalPages, markActivity],
  )

  const stepPage = useCallback(
    (direction: 1 | -1) => {
      const target =
        direction > 0
          ? nextReaderPage(currentPage, totalPages, effectiveSpread)
          : previousReaderPage(currentPage, totalPages, effectiveSpread)

      if (target !== null) goTo(target)
    },
    [currentPage, effectiveSpread, goTo, totalPages],
  )

  const canGoPrev =
    previousReaderPage(currentPage, totalPages, effectiveSpread) !== null
  const canGoNext =
    nextReaderPage(currentPage, totalPages, effectiveSpread) !== null

  const currentBookmark = useMemo(
    () => bookmarks.find((bookmark) => bookmark.page === currentPage),
    [bookmarks, currentPage],
  )

  const toggleBookmark = useCallback(async () => {
    if (currentBookmark) {
      await removeBookmark(currentBookmark.bookmark_id)
    } else {
      await addBookmark(currentPage)
    }
  }, [addBookmark, currentBookmark, currentPage, removeBookmark])

  const pickHighlightColor = useCallback(
    (color: string) => {
      if (!pendingSelection) return

      const selection = pendingSelection
      setPendingSelection(null)
      window.getSelection()?.removeAllRanges()

      void addHighlight({
        page: selection.page,
        rects: selection.rects,
        quote: selection.quote,
        color,
      })
    },
    [addHighlight, pendingSelection],
  )

  const openNoteForSelection = useCallback(() => {
    if (!pendingSelection) return

    setNoteEditor({
      mode: "create",
      selection: pendingSelection,
      color: DEFAULT_HIGHLIGHT_COLOR,
    })
    setPendingSelection(null)
    window.getSelection()?.removeAllRanges()
  }, [pendingSelection])

  const openNoteForHighlight = useCallback((highlight: ReaderHighlight) => {
    setNoteEditor({ mode: "edit", highlight })
  }, [])

  const saveNote = useCallback(
    async (input: { color: string; note: string }) => {
      if (!noteEditor) {
        return fail("VALIDATION", "לא נבחר קטע לשמירה.")
      }

      if (noteEditor.mode === "create") {
        return addHighlight({
          page: noteEditor.selection.page,
          rects: noteEditor.selection.rects,
          quote: noteEditor.selection.quote,
          color: input.color,
          note: input.note,
        })
      }

      return editHighlight(noteEditor.highlight.highlight_id, {
        color: input.color,
        note: input.note.trim() || null,
      })
    },
    [addHighlight, editHighlight, noteEditor],
  )

  const deleteNote = useCallback(() => {
    if (!noteEditor || noteEditor.mode !== "edit") return

    const highlightId = noteEditor.highlight.highlight_id
    setNoteEditor(null)
    void removeHighlight(highlightId)
  }, [noteEditor, removeHighlight])

  const jumpToAnnotation = useCallback(
    (page: number) => {
      setAnnotationsOpen(false)
      goTo(page)
    },
    [goTo],
  )

  const editFromPanel = useCallback((highlight: ReaderHighlight) => {
    setAnnotationsOpen(false)
    setNoteEditor({ mode: "edit", highlight })
  }, [])

  /* Leaving "fit" lands on the nearest rung rather than on the first one.
   * Fit-width renders somewhere around 100-115% depending on the viewport, so
   * pressing "smaller" from fit and dropping straight to 75% would read as a
   * lurch rather than as one step down. */
  const stepZoom = useCallback(
    (direction: 1 | -1) => {
      markActivity()
      setZoom((current) => {
        if (current === ZOOM_FIT) return direction > 0 ? 125 : 100
        const index = ZOOM_STEPS.indexOf(current)
        /* Not on the ladder - only possible if a step value was edited without
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
      if (e.defaultPrevented) return
      /* Leave browser and assistive-technology shortcuts alone: modified
       * arrows select text or navigate the OS, not the book. */
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return
      if (isEditableTarget(e.target)) return
      /* A dialog (including the global accessibility panel) borrows the
       * keyboard while it is open; arrows inside it must keep working. */
      if (hasOpenDialog()) return

      if (e.key === "ArrowLeft" || e.key === "ArrowDown") stepPage(1)
      else if (e.key === "ArrowRight" || e.key === "ArrowUp") stepPage(-1)
      else if (e.key === "Escape") setImmersiveMode(false)
    },
    [stepPage],
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
        stepPage(dx < 0 ? 1 : -1)
        return
      }
      // Otherwise a short, quick press is an edge tap.
      if (
        Math.hypot(dx, dy) < TAP_TRAVEL &&
        Date.now() - start.t < TAP_DURATION
      ) {
        stepPage(edge === "next" ? 1 : -1)
      }
    },
    [stepPage],
  )

  if (!authReady || !isAuthenticated || !productId || !hasAccess(productId)) return null

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
   * The count drives the page slider, the direct page field, spread grouping
   * and the last-page clamp. Until the document reports its own total, the
   * controls stay on the current page rather than guessing a denominator. */
  const canStep = Boolean(contentUrl)
  const knownTotal = totalPages > 0

  const zoomedIn = zoom !== ZOOM_FIT
  const canZoomIn = !zoomedIn || zoom < ZOOM_STEPS[ZOOM_STEPS.length - 1]
  const canZoomOut = !zoomedIn || zoom > ZOOM_STEPS[0]
  const expired = session ? isSessionExpired(session, policy) : false
  const revoked = Boolean(session?.revoked)
  const locked = Boolean(deviceError) || expired || revoked

  /* One decision, made once, about what this screen is allowed to claim.
   * "The file was never uploaded" is a statement about the catalogue and it
   * is earned two ways: the lookup answered that the object is not there
   * (NOT_FOUND), or it came back with nothing to show. Every other refusal is
   * named as a refusal, because a storage outage told to a paying customer as
   * "the publisher has not uploaded it yet" sends support the wrong way. */
  const contentVerdict: "checking" | "refused" | "missing" = grantError
    ? grantCode === "NOT_FOUND"
      ? "missing"
      : "refused"
    : grantPending
      ? "checking"
      : "missing"

  const resume = () => {
    if (!actor) return
    // A revoked slot cannot be renewed - it has to be claimed again, which
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

  const palette = darkMode ? READER_PALETTE.dark : READER_PALETTE.light
  const bg = palette.background
  const textColor = palette.text
  const panelBg = palette.chrome
  const borderColor = palette.border
  const mutedColor = palette.muted
  const accentColor = palette.accent
  const accentSoft = palette.accentSoft

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
      {/* The reader has no site header, but its toolbar is fixed above the
       * document; keyboard users get past it in one Tab. */}
      <a href="#main" className="skip-link">
        דלג לתוכן הקריאה
      </a>

      {/* Top bar */}
      <header
        className="safe-top fixed inset-x-0 top-0 z-50 border-b flex items-center justify-between gap-2 px-3 sm:px-5 h-14 sm:h-12"
        style={{
          background: panelBg,
          borderColor,
          backdropFilter: "blur(8px)",
        }}
      >
        <div className="flex items-center gap-2 sm:gap-4 min-w-0">
          <button
            type="button"
            onClick={() => navigate("/dashboard/library")}
            className="tap-target text-sm flex items-center gap-1.5 transition-opacity hover:opacity-70"
            style={{ color: mutedColor }}
            aria-label="חזרה לספרייה"
            title="חזרה לספרייה"
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
                style={{
                  borderColor,
                  color: mutedColor,
                  background: accentSoft,
                }}
                title={`העותק מסומן בשם: ${watermark}`}
              >
                <Icon name="shield" size={12} style={{ color: accentColor }} />{" "}
                עותק אישי מסומן
              </span>
            )}

          {isPdf && (
            <BookmarkToggle
              page={currentPage}
              bookmarked={Boolean(currentBookmark)}
              disabled={annotationsLoading}
              onToggle={() => void toggleBookmark()}
              colors={{
                text: textColor,
                muted: mutedColor,
                border: borderColor,
                accent: accentColor,
              }}
            />
          )}

          {isPdf && (
            <button
              type="button"
              onClick={() => setAnnotationsOpen(true)}
              className="tap-target relative flex items-center justify-center rounded border transition-opacity hover:opacity-70"
              style={{
                width: 32,
                height: 32,
                borderColor,
                color: mutedColor,
              }}
              aria-label={`סימניות והערות (${bookmarks.length + highlights.length})`}
              title="סימניות, הדגשות והערות"
            >
              <Icon name="notebook" size={15} />
              {bookmarks.length + highlights.length > 0 && (
                <span
                  className="absolute -end-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[9px] font-bold tabular-nums"
                  style={{
                    background: accentColor,
                    color: "var(--color-primary-foreground)",
                  }}
                  aria-hidden="true"
                >
                  {bookmarks.length + highlights.length}
                </span>
              )}
            </button>
          )}

          {isPdf && (
            <button
              type="button"
              onClick={() => setSpreadMode((current) => !current)}
              className="tap-target hidden items-center justify-center rounded border transition-opacity hover:opacity-70 lg:flex"
              style={{
                width: 32,
                height: 32,
                borderColor: spreadMode ? accentColor : borderColor,
                color: spreadMode ? accentColor : mutedColor,
              }}
              aria-pressed={spreadMode}
              aria-label="תצוגת שני עמודים"
              title={
                spreadMode
                  ? "מעבר לתצוגת עמוד אחד"
                  : "מעבר לתצוגת שני עמודים"
              }
            >
              <Icon name="columns" size={15} />
            </button>
          )}

          {/* Display size. Offered only for a PDF: these controls repaint the
           * canvas at a new scale, and a non-PDF content URL goes to the
           * iframe untouched, so there would be nothing for them to act on.
           * Showing a control that cannot work is worse than not showing it. */}
          {isPdf && (
            <div
              className="flex items-center gap-1"
              role="group"
              aria-label="גודל התצוגה"
            >
              <button
                type="button"
                onClick={() => stepZoom(-1)}
                disabled={!canZoomOut}
                className="tap-target flex items-center justify-center rounded border transition-opacity hover:opacity-70 disabled:opacity-30 disabled:hover:opacity-30"
                style={{ borderColor, color: mutedColor }}
                aria-label="הקטנת התצוגה"
                title="הקטנת התצוגה"
              >
                <Icon name="zoomOut" size={15} />
              </button>

              {/* The readout is also the reset: one control that says what the
               * size is and returns it to fit-width, instead of a third button
               * in a bar that is already crowded on a phone. While at fit it
               * shows the fit-width glyph and is inert - there is nothing to
               * reset - and the fixed min-width stops the bar from jumping
               * sideways every time the label changes shape. */}
              <button
                type="button"
                onClick={resetZoom}
                disabled={!zoomedIn}
                className="tap-target flex items-center justify-center gap-1 px-1 text-[11px] tabular-nums rounded border transition-opacity hover:opacity-70 disabled:opacity-40 disabled:hover:opacity-40"
                style={{ borderColor, color: mutedColor, minWidth: "2.9rem" }}
                aria-label={
                  zoomedIn
                    ? `איפוס התצוגה לרוחב המסך (${zoom}%)`
                    : "התאמת העמוד לרוחב המסך"
                }
                title="התאמה לרוחב המסך"
              >
                {zoomedIn ? `${zoom}%` : <Icon name="fitWidth" size={14} />}
              </button>

              <button
                type="button"
                onClick={() => stepZoom(1)}
                disabled={!canZoomIn}
                className="tap-target flex items-center justify-center rounded border transition-opacity hover:opacity-70 disabled:opacity-30 disabled:hover:opacity-30"
                style={{ borderColor, color: mutedColor }}
                aria-label="הגדלת התצוגה"
                title="הגדלת התצוגה"
              >
                <Icon name="zoomIn" size={15} />
              </button>
            </div>
          )}

          {/* Dark mode. The label names the state, and aria-pressed says
           * whether that state is on - the tooltip names the action. */}
          <button
            type="button"
            onClick={() => setDarkMode((d) => !d)}
            className="tap-target flex items-center justify-center rounded border transition-opacity hover:opacity-70"
            style={{ borderColor, color: mutedColor }}
            aria-pressed={darkMode}
            aria-label="מצב קריאה כהה"
            title={darkMode ? "מעבר למצב קריאה בהיר" : "מעבר למצב קריאה כהה"}
          >
            <Icon name={darkMode ? "sun" : "moon"} size={15} />
          </button>

          {/* A wider reading canvas, not browser fullscreen. */}
          <button
            type="button"
            onClick={() => setImmersiveMode((f) => !f)}
            className="tap-target flex items-center justify-center rounded border transition-opacity hover:opacity-70"
            style={{ borderColor, color: mutedColor }}
            aria-pressed={immersiveMode}
            aria-label="מצב קריאה ממוקד"
            title={
              immersiveMode ? "חזרה לתצוגת הקריאה הרגילה" : "הרחבת אזור הקריאה"
            }
          >
            <Icon name="maximize" size={15} />
          </button>
        </div>
      </header>

      {/* Main reading area */}
      <main id="main" className="flex-1 pt-14 sm:pt-12 pb-24 sm:pb-20">
        {contentUrl && !locked ? (
          <>
            {/* The toolbar is too narrow for a visible title on a phone, but
             * the book must still be identifiable as the page heading. */}
            <h1 className="sr-only">{title || "קריאה"}</h1>
            {/* Page turns are a visual change; announce them once each time
             * the page really changes. Screen readers hear the same wording
             * the bottom bar displays. */}
            <p
              className="sr-only"
              role="status"
              aria-live="polite"
              aria-atomic="true"
            >
              {knownTotal
                ? `עמודים ${pageLabel} מתוך ${totalPages}`
                : `עמוד ${currentPage}`}
            </p>
            <div
              className="relative mx-auto px-1.5 sm:px-2 py-2"
              style={{
                maxWidth: "72rem",
                height: immersiveMode
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
                  <PdfSurface
                    contentUrl={contentUrl}
                    requiresAuth={protectedContent}
                    pages={visiblePages}
                    zoom={zoom === ZOOM_FIT ? 1 : zoom / 100}
                    textLayer
                    highlights={highlights}
                    readingDirection={
                      typeof document !== "undefined" &&
                      document.documentElement.dir === "ltr"
                        ? "ltr"
                        : "rtl"
                    }
                    onTotalPages={setDocTotalPages}
                    onTextSelection={setPendingSelection}
                    onHighlightActivate={openNoteForHighlight}
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
                   * scrolling and pinch-zoom. Logical insets keep the previous
                   * page at the reading-start edge in RTL. */}
                  <div
                    className="swipe-zone absolute top-0 bottom-0 z-30 flex items-center justify-center"
                    style={{
                      insetInlineStart: 0,
                      width: "clamp(44px, 11vw, 88px)",
                      touchAction: "pan-y",
                    }}
                    onPointerDown={beginGesture}
                    onPointerUp={(e) => endGesture(e, "prev")}
                    onPointerCancel={cancelGesture}
                    onPointerLeave={cancelGesture}
                    role="button"
                    tabIndex={-1}
                    aria-label="העמוד הקודם - החליקו או הקישו"
                  >
                    <Icon
                      name="chevronRight"
                      size={22}
                      className="swipe-hint"
                      style={{ color: mutedColor }}
                    />
                  </div>
                  <div
                    className="swipe-zone absolute top-0 bottom-0 z-30 flex items-center justify-center"
                    style={{
                      insetInlineEnd: 0,
                      width: "clamp(44px, 11vw, 88px)",
                      touchAction: "pan-y",
                    }}
                    onPointerDown={beginGesture}
                    onPointerUp={(e) => endGesture(e, "next")}
                    onPointerCancel={cancelGesture}
                    onPointerLeave={cancelGesture}
                    role="button"
                    tabIndex={-1}
                    aria-label="העמוד הבא - החליקו או הקישו"
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
          </>
        ) : (
          <div className="max-w-lg mx-auto px-6 py-24 text-center">
            <div
              className="w-16 h-16 rounded-full mx-auto mb-5 flex items-center justify-center"
              style={{
                background: accentSoft,
                color: accentColor,
              }}
            >
              {contentVerdict === "checking" ? (
                <div
                  className="w-6 h-6 rounded-full border-2 animate-spin"
                  style={{
                    borderColor: borderColor,
                    borderTopColor: accentColor,
                  }}
                />
              ) : (
                <Icon name="bookOpen" size={26} />
              )}
            </div>
            {/* Three different answers, and only one of them may say the file
             * was never uploaded: that claim needs the lookup to have come
             * back with it. A paying customer was previously told to wait for
             * an upload that was never the problem. */}
            <h1
              className="font-display text-2xl font-semibold mb-2"
              role="status"
              aria-live="polite"
            >
              {contentVerdict === "checking"
                ? "פותח את הספר…"
                : contentVerdict === "refused"
                  ? "הקישור לתוכן לא אושר"
                  : "התוכן טרם הועלה"}
            </h1>
            <p className="text-sm mb-2" style={{ color: mutedColor }}>
              {contentVerdict === "checking"
                ? "הבדיקה מול שירות התוכן עדיין לא הסתיימה."
                : contentVerdict === "missing"
                  ? `לקובץ הקריאה של "${title}" עדיין לא הוצמד עותק דיגיטלי במערכת.`
                  : grantError}
            </p>
            <p className="text-sm mb-8" style={{ color: mutedColor }}>
              {contentVerdict === "checking"
                ? "העמוד ייטען מעצמו ברגע שהקובץ ייפתח - אין צורך לפנות לתמיכה בינתיים."
                : contentVerdict === "refused"
                  ? "כל קריאה מקבלת קישור חד־פעמי משלה. אם הגישה שלך תקינה, ניסיון נוסף מנפיק קישור טרי."
                  : "הגישה שלך לספר תקינה - התוכן יופיע כאן מיד לאחר שהקובץ יועלה."}
            </p>
            <div className="flex flex-wrap justify-center gap-3">
              {grantError && (
                <button
                  onClick={() => {
                    /* Clearing the guard is what lets the effect mint again;
                     * the nonce covers the case where `resume()` leaves the
                     * session id unchanged, because then no dependency would
                     * change and the mint effect would never re-run. */
                    grantRun.current = null
                    setGrantError(null)
                    setGrantCode(null)
                    setGrantPending(true)
                    setContentUrl(undefined)
                    setGrantAttempt((attempt) => attempt + 1)
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
              {/* While the answer is still in flight there is nothing to
               * report, and a support button beside "no need to contact
               * support yet" contradicts the sentence above it. */}
              {contentVerdict !== "checking" && (
                <a
                  href="/support"
                  className="btn-gradient tap-target px-5 py-2.5 rounded-full text-sm font-semibold"
                >
                  פנייה לתמיכה
                </a>
              )}
            </div>
          </div>
        )}
      </main>

      {/* Bottom navigation bar */}
      {canStep && !locked && (
        <div
          className="safe-bottom fixed inset-x-0 bottom-0 z-50 border-t"
          style={{ background: panelBg, borderColor }}
        >
          <PageNavigator
            currentPage={currentPage}
            totalPages={totalPages}
            pageLabel={pageLabel}
            canPrev={canGoPrev}
            canNext={canGoNext}
            onPrev={() => stepPage(-1)}
            onNext={() => stepPage(1)}
            onJump={goTo}
            colors={{
              text: textColor,
              muted: mutedColor,
              border: borderColor,
              accent: accentColor,
            }}
          />

          <p
            className="text-center text-[11px] pb-2 sm:hidden"
            style={{ color: mutedColor }}
          >
            החליקו משולי המסך או הקישו עליהם כדי להפוך דף
          </p>
        </div>
      )}

      {/* Identity watermark - a dense multi-line pattern over the whole
       * reading surface, including the scroll viewport and the canvas. */}
      {policy.watermark_enabled && watermark && contentUrl && !locked && (
        <WatermarkPattern
          text={watermark}
          opacity={watermarkOpacity}
          color="#000000"
          className="fixed inset-0"
          style={WATERMARK_OVERLAY_STYLE}
        />
      )}

      {/* Device / session lock - replaces the content, never sits behind it */}
      {locked && (
        <div
          className="fixed inset-0 flex flex-col items-center justify-center gap-4 px-6 text-center"
          style={{ background: bg, zIndex: 210 }}
        >
          <Icon
            name={revoked ? "lock" : "clock"}
            size={34}
            style={{ color: accentColor }}
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

      {/* Selection actions and annotation dialogs. All of these portal
       * above the watermark and the reader chrome. */}
      {pendingSelection && !locked && (
        <SelectionToolbar
          selection={pendingSelection}
          onPickColor={pickHighlightColor}
          onAddNote={openNoteForSelection}
          onClose={() => {
            setPendingSelection(null)
            window.getSelection()?.removeAllRanges()
          }}
        />
      )}

      {annotationsOpen && (
        <AnnotationsPanel
          bookmarks={bookmarks}
          highlights={highlights}
          loading={annotationsLoading}
          error={annotationsError}
          currentPage={currentPage}
          onClose={() => setAnnotationsOpen(false)}
          onJump={jumpToAnnotation}
          onRemoveBookmark={removeBookmark}
          onRemoveHighlight={removeHighlight}
          onEditHighlight={editFromPanel}
          onAddBookmark={addBookmark}
          onRetry={() => void refreshAnnotations()}
        />
      )}

      {noteEditor && (
        <NoteEditorModal
          mode={noteEditor.mode}
          page={
            noteEditor.mode === "create"
              ? noteEditor.selection.page
              : noteEditor.highlight.page
          }
          quote={
            noteEditor.mode === "create"
              ? noteEditor.selection.quote
              : noteEditor.highlight.quote
          }
          initialColor={
            noteEditor.mode === "create"
              ? noteEditor.color
              : noteEditor.highlight.color
          }
          initialNote={
            noteEditor.mode === "edit"
              ? noteEditor.highlight.note
              : undefined
          }
          onSave={saveNote}
          onDelete={noteEditor.mode === "edit" ? deleteNote : undefined}
          onClose={() => setNoteEditor(null)}
        />
      )}

      {annotationsError && !annotationsOpen && (
        <div
          className="fixed inset-x-3 bottom-28 z-[300] mx-auto max-w-md"
          role="status"
        >
          <div
            className="flex items-start gap-2 rounded-xl border p-3 text-xs shadow-xl"
            style={{
              borderColor: "rgba(167,70,54,0.35)",
              background: "var(--color-card)",
              color: "var(--color-danger)",
            }}
          >
            <Icon
              name="alertTriangle"
              size={15}
              style={{ flexShrink: 0, marginTop: 2 }}
              aria-hidden="true"
            />
            <p className="min-w-0 flex-1 leading-relaxed">{annotationsError}</p>
            <button
              type="button"
              onClick={clearAnnotationError}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full transition-opacity hover:opacity-70"
              aria-label="סגירת הודעת השגיאה"
            >
              <Icon name="x" size={12} />
            </button>
          </div>
        </div>
      )}

      {/* DRM shield overlay - covers everything while the window is blurred */}
      {shielded && !locked && (
        <div
          className="fixed inset-0 flex flex-col items-center justify-center gap-4 px-6"
          style={{ background: bg, zIndex: 200 }}
        >
          <Icon
            name="shield"
            size={36}
            style={{ color: accentColor }}
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
