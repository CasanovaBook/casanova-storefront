import { useEffect, useMemo, useState } from "react"
import { Link, useNavigate } from "react-router"
import { useApp } from "../context/AppContext"
import { useStore } from "../lib/store"
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

const FALLBACK_COVER: [string, string] = ["#1A1A2E", "#2A2A3E"]

/** Renders the cover stored on the entitlement, so it survives product edits. */
function MiniCover({ snapshot }: { snapshot: ProductSnapshot }) {
  if (snapshot.image_url) {
    return (
      <img
        src={snapshot.image_url}
        alt={snapshot.name}
        className="w-10 h-14 rounded-md flex-shrink-0 shadow-lg object-cover"
      />
    )
  }
  const [from, to] = snapshot.cover_colors ?? FALLBACK_COVER
  return (
    <div
      className="w-10 h-14 rounded-md flex-shrink-0 shadow-lg"
      style={{ background: `linear-gradient(160deg, ${from}, ${to})` }}
    />
  )
}

function ProgressRing({
  percent,
  size = 48,
}: {
  percent: number
  size?: number
}) {
  const r = (size - 6) / 2
  const circ = 2 * Math.PI * r
  const offset = circ - (percent / 100) * circ
  return (
    <svg width={size} height={size} className="rotate-[-90deg]">
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="var(--color-muted)"
        strokeWidth={3}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="var(--color-primary)"
        strokeWidth={3}
        strokeDasharray={circ}
        strokeDashoffset={offset}
        strokeLinecap="round"
      />
    </svg>
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
    <div className="card-glow p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <div
            className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{
              background: "rgba(227,174,60,0.12)",
              color: "var(--color-primary)",
            }}
          >
            <Icon name="smartphone" size={19} />
          </div>
          <div className="min-w-0">
            <h3 className="font-semibold">מכשירים מחוברים</h3>
            <p
              className="text-xs"
              style={{ color: "var(--color-muted-foreground)" }}
            >
              הקריאה מוגבלת ל־{cap} מכשירים בו־זמנית
            </p>
          </div>
        </div>
        <span
          className="text-xs font-mono font-bold px-2.5 py-1 rounded-full flex-shrink-0"
          style={{
            background: full ? "rgba(239,68,68,0.12)" : "rgba(227,174,60,0.12)",
            color: full ? "var(--color-danger)" : "var(--color-primary)",
          }}
        >
          {open.length} / {cap}
        </span>
      </div>

      {message && (
        <p
          className="text-xs mt-3 px-3 py-2 rounded-lg"
          style={{
            background:
              message.tone === "ok"
                ? "rgba(34,197,94,0.1)"
                : "rgba(239,68,68,0.1)",
            color:
              message.tone === "ok"
                ? "var(--color-success)"
                : "var(--color-danger)",
          }}
        >
          {message.text}
        </p>
      )}

      {open.length === 0 ? (
        <p
          className="text-xs mt-3"
          style={{ color: "var(--color-muted-foreground)" }}
        >
          אין מכשירים רשומים. המכשיר הראשון יירשם אוטומטית כשתפתחו ספר לקריאה.
        </p>
      ) : (
        <div className="mt-4 space-y-2">
          {open.map((session) => {
            const mine = session.device_fingerprint === thisDevice
            const expired = isSessionExpired(session, policy)
            return (
              <div
                key={session.session_id}
                className="rounded-xl border p-3"
                style={{
                  borderColor: "var(--color-border)",
                  background: "rgba(255,255,255,0.02)",
                }}
              >
                {pending === session.session_id ? (
                  <div>
                    <p
                      className="text-xs mb-3"
                      style={{ color: "var(--color-muted-foreground)" }}
                    >
                      לשחרר את {mine ? "המכשיר הזה" : session.device_name}? אם
                      ספר פתוח שם כרגע, הקריאה בו תינעל.
                    </p>
                    <div className="flex gap-2">
                      <button
                        onClick={() => release(session.session_id)}
                        className="tap-target text-xs font-semibold px-4 py-1.5 rounded-full"
                        style={{
                          background: "var(--color-danger)",
                          color: "#FFFFFF",
                        }}
                      >
                        שחרור
                      </button>
                      <button
                        onClick={() => setPending(null)}
                        className="tap-target text-xs px-4 py-1.5 rounded-full border"
                        style={{
                          borderColor: "var(--color-border)",
                          color: "var(--color-muted-foreground)",
                        }}
                      >
                        ביטול
                      </button>
                    </div>
                  </div>
                ) : (
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
                          <span
                            className="text-[10px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0"
                            style={{
                              background: "rgba(227,174,60,0.15)",
                              color: "var(--color-primary)",
                            }}
                          >
                            המכשיר הזה
                          </span>
                        )}
                      </p>
                      <p
                        className="text-[11px]"
                        style={{ color: "var(--color-muted-foreground)" }}
                      >
                        {expired
                          ? "פג תוקף — יתחדש אוטומטית בפתיחת הספר"
                          : `פעילות אחרונה ${lastSeen(session.last_seen_at)}`}
                      </p>
                    </div>
                    <button
                      onClick={() => {
                        setMessage(null)
                        setPending(session.session_id)
                      }}
                      className="tap-target text-xs font-medium px-3 py-1.5 rounded-full border flex-shrink-0 transition-colors hover:bg-white/5"
                      style={{
                        borderColor: "var(--color-border)",
                        color: "var(--color-muted-foreground)",
                      }}
                    >
                      שחרור
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {full && (
        <p
          className="text-[11px] mt-3"
          style={{ color: "var(--color-muted-foreground)" }}
        >
          המכסה מלאה. שחררו מכשיר שלא בשימוש כדי לפתוח ספר במכשיר חדש.
        </p>
      )}
    </div>
  )
}

export default function DashboardPage() {
  const { user, userProducts, readingProgress } = useApp()
  const navigate = useNavigate()

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

  const currentlyReading = userProducts
    .filter((up) => up.access_status === "ACTIVE")
    .map((up) => ({
      up,
      progress: readingProgress.find((rp) => rp.product_id === up.product_id),
    }))
    .sort((a, b) => {
      if (!a.progress && !b.progress) return 0
      if (!a.progress) return 1
      if (!b.progress) return -1
      return (
        new Date(b.progress.last_read_at).getTime() -
        new Date(a.progress.last_read_at).getTime()
      )
    })

  const totalBooks = userProducts.filter(
    (up) => up.access_status === "ACTIVE",
  ).length
  const avgProgress =
    currentlyReading.length > 0
      ? Math.round(
          currentlyReading.reduce(
            (s, { progress }) => s + (progress?.progress_percent ?? 0),
            0,
          ) / currentlyReading.length,
        )
      : 0

  return (
    <div className="max-w-3xl mx-auto page-enter">
      {/* Greeting */}
      <div className="mb-10">
        <p
          className="text-sm mb-1"
          style={{ color: "var(--color-muted-foreground)" }}
        >
          {/* `null` = the claim is still in flight. Show the returning
              greeting rather than flashing "ברוך הבא" and correcting it
              a moment later. */}
          {isFirstLogin ? "ברוך הבא," : "ברוך שובך,"}
        </p>
        <h1 className="font-display text-4xl font-semibold">
          {user?.first_name} {user?.last_name}
        </h1>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-10">
        {([
          { icon: "library", label: "ספרים ברשותכם", value: totalBooks },
          {
            icon: "trendUp",
            label: "התקדמות ממוצעת",
            value: `${avgProgress}%`,
          },
          {
            icon: "clock",
            label: "פעילות אחרונה",
            value: user?.last_login_at
              ? new Date(user.last_login_at).toLocaleDateString("he-IL", {
                  day: "numeric",
                  month: "short",
                })
              : "היום",
          },
        ] as { icon: IconName, label: string, value: string | number }[]).map(
          ({ icon, label, value }) => (
            <div key={label} className="card-glow p-5">
              <div
                className="w-9 h-9 rounded-lg flex items-center justify-center mb-3"
                style={{
                  background: "rgba(227,174,60,0.12)",
                  color: "var(--color-primary)",
                }}
              >
                <Icon name={icon} size={17} />
              </div>
              <p
                className="font-display text-3xl font-semibold mb-1"
                style={{ color: "var(--color-primary)" }}
              >
                {value}
              </p>
              <p
                className="text-xs"
                style={{ color: "var(--color-muted-foreground)" }}
              >
                {label}
              </p>
            </div>
          ),
        )}
      </div>

      {/* Currently reading */}
      <div className="mb-10">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold">המשיכו לקרוא</h2>
          <Link
            to="/dashboard/library"
            className="text-sm hover:opacity-70"
            style={{ color: "var(--color-primary)" }}
          >
            לצפייה בספרייה ←
          </Link>
        </div>

        {currentlyReading.length === 0 ? (
          <div className="card-glow p-8 text-center">
            <div
              className="flex justify-center mb-3"
              style={{ color: "var(--color-muted-foreground)" }}
            >
              <Icon name="inbox" size={32} />
            </div>
            <p
              className="mb-3"
              style={{ color: "var(--color-muted-foreground)" }}
            >
              הספרייה שלך ריקה.
            </p>
            <Link
              to="/dashboard/store"
              className="text-sm font-medium"
              style={{ color: "var(--color-primary)" }}
            >
              גלוש לחנות ←
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {currentlyReading.slice(0, 2).map(({ up, progress }) => (
              <div
                key={up.user_product_id}
                className="card-glow flex items-center gap-5 p-4 cursor-pointer transition-all"
                onClick={() => navigate(`/read/${up.product_id}`)}
              >
                <MiniCover snapshot={up.product_snapshot} />
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm mb-0.5 truncate">
                    {up.product_snapshot.name}
                  </p>
                  <p
                    className="text-xs mb-2"
                    style={{ color: "var(--color-muted-foreground)" }}
                  >
                    {progress
                      ? up.product_snapshot.total_pages
                        ? `עמוד ${progress.current_page} מתוך ${up.product_snapshot.total_pages}`
                        : `עמוד ${progress.current_page}`
                      : "עוד לא התחלתם"}
                  </p>
                  {progress && (
                    <div
                      className="h-1 rounded-full"
                      style={{ background: "var(--color-muted)" }}
                    >
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${progress.progress_percent}%`,
                          background:
                            "linear-gradient(90deg, #E7B94C, #B8862A)",
                        }}
                      />
                    </div>
                  )}
                </div>
                {progress && (
                  <div className="relative flex items-center justify-center flex-shrink-0">
                    <ProgressRing percent={progress.progress_percent} />
                    <span
                      className="absolute text-xs font-mono font-bold"
                      style={{ color: "var(--color-primary)" }}
                    >
                      {Math.round(progress.progress_percent)}%
                    </span>
                  </div>
                )}
                <button
                  className="btn-gradient text-xs font-semibold px-4 py-2 rounded-full flex-shrink-0"
                  onClick={(e) => {
                    e.stopPropagation()
                    navigate(`/read/${up.product_id}`)
                  }}
                >
                  {progress ? "המשך קריאה" : "התחילו לקרוא"}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Quick links */}
      <div className="grid grid-cols-2 gap-4">
        <Link to="/dashboard/library" className="card-glow p-5 group">
          <div
            className="w-10 h-10 rounded-lg flex items-center justify-center mb-3"
            style={{
              background: "rgba(227,174,60,0.12)",
              color: "var(--color-primary)",
            }}
          >
            <Icon name="library" size={19} />
          </div>
          <h3 className="font-semibold mb-1">הספרייה שלי</h3>
          <p
            className="text-xs"
            style={{ color: "var(--color-muted-foreground)" }}
          >
            כל {totalBooks} הספרים שלך במקום אחד.
          </p>
        </Link>
        <Link to="/dashboard/store" className="card-glow p-5">
          <div
            className="w-10 h-10 rounded-lg flex items-center justify-center mb-3"
            style={{
              background: "rgba(227,174,60,0.12)",
              color: "var(--color-primary)",
            }}
          >
            <Icon name="bag" size={19} />
          </div>
          <h3 className="font-semibold mb-1">החנות</h3>
          <p
            className="text-xs"
            style={{ color: "var(--color-muted-foreground)" }}
          >
            גלה ספרים חדשים והרחב את הספרייה שלך.
          </p>
        </Link>
      </div>

      {/* Connected devices */}
      <div className="mt-4">
        <ConnectedDevicesCard />
      </div>
    </div>
  )
}
