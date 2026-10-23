import { useEffect, useMemo, useState } from "react"
import { Link } from "react-router"
import { useApp } from "../context/AppContext"
import { useStore } from "../data/store"
import { claimFirstLogin } from "../lib/first-login"
import {
  deviceFingerprint,
  endDeviceSession,
  isSessionExpired,
  isSessionOpen,
  listDeviceSessions,
  resolveDrmPolicy,
} from "../lib/api-security"
import type { ProductSnapshot } from "../types"
import Icon, { type IconName } from "../components/icons"
import PageHeader from "../components/ui/PageHeader"
import EmptyState from "../components/ui/EmptyState"
import Alert from "../components/ui/Alert"

const FALLBACK_COVER: [string, string] = ["#1A1A2E", "#2A2A3E"]

const ACCESS_LABEL: Record<string, string> = {
  ACTIVE: "פעיל",
  EXPIRED: "פג תוקף",
  REVOKED: "נשלל",
  SUSPENDED: "מושעה",
}

/** Renders the cover stored on the entitlement, so it survives product edits. */
function MiniCover({ snapshot }: { snapshot: ProductSnapshot }) {
  if (snapshot.image_url) {
    return (
      <img
        src={snapshot.image_url}
        alt=""
        className="w-12 h-[4.5rem] rounded-md flex-shrink-0 shadow-lg object-cover"
      />
    )
  }
  const [from, to] = snapshot.cover_colors ?? FALLBACK_COVER
  return (
    <div
      className="w-12 h-[4.5rem] rounded-md flex-shrink-0 shadow-lg"
      style={{ background: `linear-gradient(160deg, ${from}, ${to})` }}
      aria-hidden="true"
    />
  )
}

/** Coarse Hebrew "how long ago" text — a precise clock adds nothing here. */
function lastSeen(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000)
  if (minutes < 1) return "עכשיו"
  if (minutes < 60) return `לפני ${minutes} דק׳`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `לפני ${hours} שע׳`
  const days = Math.round(hours / 24)
  return days === 1 ? "אתמול" : `לפני ${days} ימים`
}

/**
 * Self-service device management.
 *
 * The reader enforces `max_devices_per_user` and refuses to open a book
 * once every slot is taken. Without this card the only way out of that
 * would be a support ticket, so a customer can always see which slots
 * they hold and free one without asking anybody.
 */
function ConnectedDevicesCard() {
  const { actor } = useApp()
  const db = useStore()
  const policy = useMemo(
    () => resolveDrmPolicy(db.drm_policies, "WEB"),
    [db.drm_policies],
  )
  const thisDevice = useMemo(() => deviceFingerprint(), [])
  const [pending, setPending] = useState<string | null>(null)
  const [message, setMessage] = useState<{
    tone: "ok" | "err"
    text: string
  } | null>(null)

  /* The read goes through the service so authorization stays in one
   * place; `db.device_sessions` is the dependency that re-runs it when
   * the reader or another tab changes a session. */
  const open = useMemo(() => {
    const scoped = listDeviceSessions(actor)
    if (!scoped.ok) return []
    return scoped.data
      .filter(isSessionOpen)
      .sort(
        (a, b) =>
          new Date(b.last_seen_at).getTime() -
          new Date(a.last_seen_at).getTime(),
      )
  }, [actor, db.device_sessions])

  const cap = policy.max_devices_per_user
  const full = open.length >= cap

  const release = (sessionId: string) => {
    const result = endDeviceSession(actor, sessionId)
    setPending(null)
    setMessage(
      result.ok
        ? { tone: "ok", text: "המכשיר שוחרר והמקום התפנה במכסה." }
        : { tone: "err", text: result.error },
    )
  }

  return (
    <section className="app-surface" aria-labelledby="devices-title">
      <div className="app-surface-head">
        <div className="flex items-center gap-3 min-w-0">
          <span
            className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{
              background: "color-mix(in srgb, var(--color-primary) 12%, transparent)",
              color: "var(--color-primary)",
            }}
            aria-hidden="true"
          >
            <Icon name="smartphone" size={19} />
          </span>
          <div className="min-w-0">
            <h2 id="devices-title" className="app-section-title">
              מכשירים מחוברים
            </h2>
            <p className="text-xs app-muted mt-0.5">
              הקריאה מוגבלת ל־{cap} מכשירים בו־זמנית
            </p>
          </div>
        </div>
        <span
          className={`app-badge ${
            full ? "app-badge--danger" : "app-badge--accent"
          }`}
          aria-label={`${open.length} מתוך ${cap} מקומות מכשיר בשימוש`}
        >
          {open.length} / {cap}
        </span>
      </div>

      <div className="app-surface-body">
        {message && (
          <div className="mb-4">
            <Alert tone={message.tone === "ok" ? "success" : "error"}>
              {message.text}
            </Alert>
          </div>
        )}

        {open.length === 0 ? (
          <p className="text-xs app-muted">
            אין מכשירים רשומים. המכשיר הראשון יירשם אוטומטית כשתפתחו ספר
            לקריאה.
          </p>
        ) : (
          <ul className="space-y-2">
            {open.map((session) => {
              const mine = session.device_fingerprint === thisDevice
              const expired = isSessionExpired(session, policy)
              const isPending = pending === session.session_id
              const confirmId = `release-${session.session_id}`
              return (
                <li
                  key={session.session_id}
                  className="rounded-lg border p-3"
                  style={{
                    borderColor: "var(--color-border)",
                    background: "var(--color-muted)",
                  }}
                >
                  <div className="flex items-center gap-3">
                    <Icon
                      name={session.platform === "WEB" ? "grid" : "smartphone"}
                      size={16}
                      className="flex-shrink-0"
                      style={{ color: "var(--color-muted-foreground)" }}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm truncate flex items-center gap-2">
                        <span className="truncate">{session.device_name}</span>
                        {mine && (
                          <span className="app-badge app-badge--accent flex-shrink-0">
                            המכשיר הזה
                          </span>
                        )}
                      </p>
                      <p className="text-[11px] app-muted">
                        {expired
                          ? "פג תוקף — יתחדש אוטומטית בפתיחת הספר"
                          : `פעילות אחרונה ${lastSeen(session.last_seen_at)}`}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setMessage(null)
                        setPending(isPending ? null : session.session_id)
                      }}
                      aria-expanded={isPending}
                      aria-controls={confirmId}
                      className="app-btn-secondary flex-shrink-0"
                      style={{ minHeight: 44 }}
                    >
                      שחרור
                    </button>
                  </div>

                  {isPending && (
                    <div id={confirmId} className="mt-3">
                      <p className="text-xs app-muted mb-3">
                        לשחרר את {mine ? "המכשיר הזה" : session.device_name}? אם
                        ספר פתוח שם כרגע, הקריאה בו תינעל.
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => release(session.session_id)}
                          className="app-btn-danger"
                        >
                          שחרור
                        </button>
                        <button
                          type="button"
                          onClick={() => setPending(null)}
                          className="app-btn-secondary"
                        >
                          ביטול
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}

        {full && (
          <p className="text-[11px] app-muted mt-3">
            המכסה מלאה. שחררו מכשיר שלא בשימוש כדי לפתוח ספר במכשיר חדש.
          </p>
        )}
      </div>
    </section>
  )
}

export default function DashboardPage() {
  const { user, userProducts, readingProgress } = useApp()

  /* The claim is a network round-trip, so it cannot be read during
   * render. Start at the value the profile already carries — a profile
   * with greeted_at set can only be a returning customer, and showing
   * "ברוך הבא" to them for the duration of the request would be a
   * visible flicker of the wrong wording. `null` means "not yet
   * resolved", not "first login". */
  const [isFirstLogin, setIsFirstLogin] = useState<boolean | null>(
    user?.greeted_at == null ? null : false,
  )

  useEffect(() => {
    if (!user?.user_id) return
    /* Already known from the profile — no claim needed, and claiming
     * would be wrong: it would consume the greeting for an account
     * that has already had it. */
    if (user.greeted_at) {
      setIsFirstLogin(false)
      return
    }
    let cancelled = false
    claimFirstLogin(user.user_id).then((first) => {
      if (!cancelled) setIsFirstLogin(first)
    })
    return () => {
      cancelled = true
    }
  }, [user?.user_id, user?.greeted_at])

  /* Every entitlement the account holds, not only the readable ones: a
   * blocked or revoked book must stay visible with its status, or a
   * customer would conclude the book — and their purchase — had
   * vanished. Visibility and authorization are separate concerns; the
   * open affordance is what carries the authorization boundary, and
   * get-content-url re-checks the status server-side regardless. */
  const currentlyReading = userProducts
    .map((up) => ({
      up,
      progress: readingProgress.find((rp) => rp.product_id === up.product_id),
    }))
    .sort((a, b) => {
      /* Readable books first, then by recency; a blocked book the user
       * was just reading should not bury an active one. */
      if (a.up.access_status === "ACTIVE" !== (b.up.access_status === "ACTIVE"))
        return a.up.access_status === "ACTIVE" ? -1 : 1
      if (!a.progress && !b.progress) return 0
      if (!a.progress) return 1
      if (!b.progress) return -1
      return (
        new Date(b.progress.last_read_at).getTime() -
        new Date(a.progress.last_read_at).getTime()
      )
    })

  const readableBooks = userProducts.filter(
    (up) => up.access_status === "ACTIVE",
  )
  const totalBooks = userProducts.length
  const avgProgress =
    readableBooks.length > 0
      ? Math.round(
          readableBooks.reduce(
            (s, up) => {
              const progress = readingProgress.find(
                (rp) => rp.product_id === up.product_id,
              )
              return s + (progress?.progress_percent ?? 0)
            },
            0,
          ) / readableBooks.length,
        )
      : 0

  const lastActivityIso = user?.last_activity_at ?? user?.last_login_at
  const lastActivity = lastActivityIso
    ? new Date(lastActivityIso).toLocaleDateString("he-IL", {
        day: "numeric",
        month: "short",
      })
    : "—"

  const displayName =
    [user?.first_name, user?.last_name].filter(Boolean).join(" ").trim() ||
    "האזור האישי"

  const stats: { icon: IconName, label: string, value: string | number }[] = [
    { icon: "library", label: "ספרים ברשותכם", value: totalBooks },
    {
      icon: "trendUp",
      label: "התקדמות ממוצעת",
      value: readableBooks.length > 0 ? `${avgProgress}%` : "—",
    },
    { icon: "clock", label: "פעילות אחרונה", value: lastActivity },
  ]

  return (
    <div className="max-w-3xl mx-auto page-enter">
      <PageHeader
        eyebrow={isFirstLogin ? "ברוך הבא" : "ברוך שובך"}
        title={displayName}
        metaTitle="סקירה כללית"
        description="שמחים לראות אתכם. הספרים, ההתקדמות והמכשירים שלכם — במקום אחד ושקט."
      />

      {/* Real account figures only: titles held, average progress across
       * readable titles, and the last recorded activity. On a phone they
       * become full-width rows instead of three squeezed columns. */}
      <section aria-label="סיכום החשבון" className="app-surface mb-10 overflow-hidden">
        <div className="grid sm:grid-cols-3">
          {stats.map(({ icon, label, value }, index) => (
            <div
              key={label}
              className={`flex items-center gap-3 p-4 sm:flex-col sm:items-start sm:p-5 ${
                index > 0 ? "border-t sm:border-t-0 sm:border-s" : ""
              }`}
              style={
                index > 0 ? { borderColor: "var(--color-border)" } : undefined
              }
            >
              <span
                className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
                style={{
                  background:
                    "color-mix(in srgb, var(--color-primary) 12%, transparent)",
                  color: "var(--color-primary)",
                }}
                aria-hidden="true"
              >
                <Icon name={icon} size={17} />
              </span>
              <div className="min-w-0">
                <p className="font-display text-2xl font-semibold leading-tight tabular-nums">
                  {value}
                </p>
                <p className="text-xs app-muted mt-0.5">{label}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Currently reading */}
      <section className="mb-10" aria-labelledby="continue-title">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <h2 id="continue-title" className="app-section-title">
            המשיכו לקרוא
          </h2>
          {totalBooks > 0 && (
            <Link
              to="/dashboard/library"
              className="tap-target inline-flex items-center gap-1 text-sm app-muted hover:text-[var(--color-foreground)]"
            >
              לכל הספרייה
              <Icon name="arrowLeft" size={14} />
            </Link>
          )}
        </div>

        {currentlyReading.length === 0 ? (
          <EmptyState
            icon="library"
            title="הספרייה שלכם ריקה"
            description="עדיין לא נוסף ספר לאוסף. הספרים שתרכשו יופיעו כאן, עם התקדמות הקריאה."
            actions={
              <Link to="/dashboard/store" className="app-btn">
                לחנות הספרים
              </Link>
            }
          />
        ) : (
          <div className="space-y-3">
            {currentlyReading.slice(0, 2).map(({ up, progress }) => {
              const isActive = up.access_status === "ACTIVE"
              const totalPages = up.product_snapshot.total_pages
              const percent = progress
                ? Math.min(100, Math.max(0, Math.round(progress.progress_percent)))
                : 0
              return (
                <article key={up.user_product_id} className="app-surface p-4 sm:p-5">
                  <div className="flex items-start gap-4">
                    <div style={{ opacity: isActive ? 1 : 0.55 }}>
                      <MiniCover snapshot={up.product_snapshot} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <h3 className="font-semibold text-sm leading-snug">
                          {up.product_snapshot.name}
                        </h3>
                        {!isActive && (
                          <span
                            className={`app-badge ${
                              up.access_status === "REVOKED"
                                ? "app-badge--danger"
                                : "app-badge--warning"
                            }`}
                          >
                            {ACCESS_LABEL[up.access_status] ?? "לא פעיל"}
                          </span>
                        )}
                      </div>
                      <p className="text-xs app-muted mt-1">
                        {progress
                          ? totalPages
                            ? `עמוד ${progress.current_page} מתוך ${totalPages}`
                            : `עמוד ${progress.current_page}`
                          : "עוד לא התחלתם"}
                      </p>
                      {progress && (
                        <div
                          className="h-1.5 rounded-full mt-2.5 overflow-hidden"
                          style={{ background: "var(--color-muted)" }}
                          role="progressbar"
                          aria-label={`התקדמות בקריאה של ${up.product_snapshot.name}`}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-valuenow={percent}
                          aria-valuetext={`${percent}% מהספר`}
                        >
                          <div
                            className="h-full rounded-full transition-all"
                            style={{
                              width: `${percent}%`,
                              background:
                                "linear-gradient(90deg, #DE9A60, #96552D)",
                            }}
                          />
                        </div>
                      )}
                      {!isActive && (
                        <p className="text-xs app-muted mt-2">
                          הגישה לספר אינה פעילה כרגע, ולכן הקריאה חסומה.
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                    <span className="text-xs app-muted tabular-nums">
                      {progress
                        ? `${percent}% הושלמו`
                        : totalPages
                          ? `${totalPages} עמודים`
                          : "טרם נקבע מספר עמודים"}
                    </span>
                    {isActive ? (
                      <Link
                        to={`/read/${up.product_id}`}
                        className="app-btn w-full sm:w-auto"
                      >
                        {progress ? "המשך קריאה" : "התחילו לקרוא"}
                      </Link>
                    ) : (
                      <span className="app-badge app-badge--neutral">
                        אין גישה לקריאה
                      </span>
                    )}
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </section>

      {/* Quick links */}
      <section className="mb-4" aria-labelledby="quick-links-title">
        <h2 id="quick-links-title" className="app-section-title mb-4">
          קיצורי דרך
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Link
            to="/dashboard/library"
            className="app-surface p-5 group transition-colors hover:border-[color:var(--color-primary)]"
          >
            <div className="flex items-start justify-between gap-3 mb-3">
              <span
                className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
                style={{
                  background:
                    "color-mix(in srgb, var(--color-primary) 12%, transparent)",
                  color: "var(--color-primary)",
                }}
                aria-hidden="true"
              >
                <Icon name="library" size={19} />
              </span>
              <span className="app-badge app-badge--neutral">{totalBooks}</span>
            </div>
            <h3 className="font-semibold mb-1">הספרייה שלי</h3>
            <p className="text-xs app-muted">
              {totalBooks > 0
                ? "כל הספרים שרכשתם, עם מצב הגישה וההתקדמות."
                : "הספרים שתרכשו יופיעו כאן."}
            </p>
          </Link>
          <Link
            to="/dashboard/store"
            className="app-surface p-5 group transition-colors hover:border-[color:var(--color-primary)]"
          >
            <div className="flex items-start justify-between gap-3 mb-3">
              <span
                className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
                style={{
                  background:
                    "color-mix(in srgb, var(--color-primary) 12%, transparent)",
                  color: "var(--color-primary)",
                }}
                aria-hidden="true"
              >
                <Icon name="bag" size={19} />
              </span>
            </div>
            <h3 className="font-semibold mb-1">החנות</h3>
            <p className="text-xs app-muted">
              גלו ספרים חדשים והרחיבו את הספרייה שלכם.
            </p>
          </Link>
        </div>
      </section>

      {/* Connected devices */}
      <ConnectedDevicesCard />
    </div>
  )
}
