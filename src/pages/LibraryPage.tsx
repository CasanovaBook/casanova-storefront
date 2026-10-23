import { useEffect } from "react"
import { Link, useNavigate } from "react-router"
import { prefetchPdfRuntime } from "../components/PdfCanvas"
import { useApp } from "../context/AppContext"
import { useCms } from "../context/CmsContext"
import { useContent } from "../content/useContent"
import type { ProductSnapshot } from "../types"
import Icon from "../components/icons"
import PageHeader from "../components/ui/PageHeader"
import EmptyState from "../components/ui/EmptyState"
import Alert from "../components/ui/Alert"

/* Hover/focus/touch on "המשך קריאה" starts fetching the PDF runtime chunk
 * before the click lands, so the first open skips most of its lazy-load
 * latency. A no-op once loaded; it never fetches content — only code. */

/** The chunk download also starts on mount: a reader who arrived here to
 *  read is going to click within seconds, and the ~430 kB parser chunk is
 *  the single largest fixed cost of the first open. Pure code fetch — no
 *  content, no auth, nothing that could serve the book to anyone. */
function usePrefetchPdfRuntimeOnMount(): void {
  useEffect(() => {
    const idle =
      typeof requestIdleCallback === "function"
        ? (cb: () => void) => requestIdleCallback(cb, { timeout: 2000 })
        : (cb: () => void) => window.setTimeout(cb, 300)
    const handle = idle(prefetchPdfRuntime)
    return () => {
      if (typeof cancelIdleCallback === "function" && typeof handle === "number") {
        cancelIdleCallback(handle)
      } else if (typeof handle === "number") {
        clearTimeout(handle)
      }
    }
  }, [])
}

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: "פעיל",
  EXPIRED: "פג תוקף",
  REVOKED: "נשלל",
  SUSPENDED: "מושעה",
}

const STATUS_HINT: Record<string, string> = {
  EXPIRED: "תוקף הגישה הסתיים. הספר נשאר באוסף, אך אינו זמין לקריאה.",
  REVOKED: "הגישה לספר נשללה. הספר נשאר באוסף, אך אינו זמין לקריאה.",
  SUSPENDED: "הגישה לספר מושעית כרגע, ולכן אינו זמין לקריאה.",
}

const FALLBACK_COVER: [string, string] = ["#1A1A2E", "#2A2A3E"]

/* The library renders the snapshot stored on the entitlement, so purchased
 * titles stay readable even after the catalogue entry is renamed, archived
 * or deleted. The live product is only consulted for the current cover art. */
function LibraryCover({
  snapshot,
  imageUrl,
  active,
  onClick,
}: {
  snapshot: ProductSnapshot
  imageUrl?: string
  active: boolean
  onClick: () => void
}) {
  const src = imageUrl ?? snapshot.image_url
  const [from, to] = snapshot.cover_colors ?? FALLBACK_COVER
  const cursor = active ? "cursor-pointer" : "cursor-default"
  /* Clicking the cover opens the book, but that is a pointer shortcut: the
   * button beside it does the same thing from the keyboard. The image is
   * therefore announced as decorative — its title sits right next to it and
   * repeating it would only make the screen reader read the name twice. */
  if (src) {
    return (
      <img
        src={src}
        alt=""
        className={`w-16 h-24 sm:w-20 sm:h-[7.5rem] rounded-md flex-shrink-0 shadow-lg object-cover ${cursor}`}
        style={{ opacity: active ? 1 : 0.5 }}
        onClick={onClick}
      />
    )
  }
  return (
    <div
      className={`w-16 h-24 sm:w-20 sm:h-[7.5rem] rounded-md flex-shrink-0 shadow-lg ${cursor}`}
      style={{
        background: `linear-gradient(160deg, ${from}, ${to})`,
        opacity: active ? 1 : 0.5,
      }}
      onClick={onClick}
      aria-hidden="true"
    />
  )
}

function AccessBadge({ status }: { status: string }) {
  const variant =
    status === "ACTIVE"
      ? "app-badge--success"
      : status === "REVOKED"
        ? "app-badge--danger"
        : "app-badge--warning"
  return (
    <span className={`app-badge ${variant}`}>
      {STATUS_LABEL[status] ?? status}
    </span>
  )
}

export default function LibraryPage() {
  const { userProducts, readingProgress } = useApp()
  const cms = useCms()
  const c = useContent()
  const navigate = useNavigate()

  usePrefetchPdfRuntimeOnMount()

  const getProgress = (productId: string) =>
    readingProgress.find((rp) => rp.product_id === productId)

  /* Readable titles first, each group preserving the entitlement order from
   * the account. Access status is displayed, never inferred: an inactive
   * grant remains visible with its own explanation instead of disappearing
   * from the customer's collection. */
  const activeBooks = userProducts.filter((up) => up.access_status === "ACTIVE")
  const inactiveBooks = userProducts.filter(
    (up) => up.access_status !== "ACTIVE",
  )

  const renderBook = (up: (typeof userProducts)[number]) => {
    const progress = getProgress(up.product_id)
    const isActive = up.access_status === "ACTIVE"
    const snapshot = up.product_snapshot
    const live = cms.productById(up.product_id)
    const totalPages = snapshot.total_pages ?? live?.book?.total_pages
    const percent = progress
      ? Math.min(100, Math.max(0, progress.progress_percent))
      : 0
    const open = () => isActive && navigate(`/read/${up.product_id}`)

    return (
      <article key={up.user_product_id} className="app-surface p-4 sm:p-5">
        <div className="flex items-start gap-4">
          <LibraryCover
            snapshot={snapshot}
            imageUrl={live?.image_url}
            active={isActive}
            onClick={open}
          />

          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
              <div className="min-w-0">
                <h3 className="font-display text-lg font-semibold leading-snug">
                  {snapshot.name}
                </h3>
                {snapshot.author_name && (
                  <p className="text-sm app-muted mt-0.5">
                    מאת {snapshot.author_name}
                  </p>
                )}
              </div>
              <AccessBadge status={up.access_status} />
            </div>

            {progress ? (
              <div className="mt-3">
                <div className="flex flex-wrap justify-between gap-x-3 gap-y-0.5 text-xs app-muted mb-1">
                  <span className="tabular-nums">
                    עמוד {progress.current_page}
                    {totalPages ? ` / ${totalPages}` : ""}
                  </span>
                  <span className="tabular-nums">{percent.toFixed(1)}%</span>
                </div>
                <div
                  className="h-1.5 rounded-full overflow-hidden"
                  style={{ background: "var(--color-muted)" }}
                  role="progressbar"
                  aria-label={`התקדמות בקריאה של ${snapshot.name}`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(percent)}
                  aria-valuetext={`${percent.toFixed(0)}% מהספר`}
                >
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${percent}%`,
                      background: "linear-gradient(90deg, #DE9A60, #96552D)",
                    }}
                  />
                </div>
                <p className="text-xs app-muted mt-1">
                  נקרא לאחרונה:{" "}
                  {new Date(progress.last_read_at).toLocaleDateString("he-IL", {
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </p>
              </div>
            ) : (
              <p className="text-xs app-muted mt-2">
                {totalPages
                  ? `עוד לא התחלתם — ${totalPages} עמודים`
                  : "עוד לא התחלתם לקרוא"}
              </p>
            )}

            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs app-muted">
                נרכש בתאריך{" "}
                {new Date(up.granted_at).toLocaleDateString("he-IL", {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })}
              </p>
              {isActive ? (
                <Link
                  to={`/read/${up.product_id}`}
                  onMouseEnter={prefetchPdfRuntime}
                  onFocus={prefetchPdfRuntime}
                  onTouchStart={prefetchPdfRuntime}
                  className="app-btn w-full sm:w-auto"
                >
                  {progress ? "המשך קריאה" : "התחילו לקרוא"}
                </Link>
              ) : (
                <span className="app-badge app-badge--neutral w-fit">
                  אין גישה לקריאה
                </span>
              )}
            </div>
          </div>
        </div>

        {!isActive && (
          <div className="mt-4">
            <Alert tone={up.access_status === "REVOKED" ? "error" : "warning"}>
              {STATUS_HINT[up.access_status] ??
                "הגישה לספר אינה פעילה כרגע."}
            </Alert>
          </div>
        )}
      </article>
    )
  }

  return (
    <div className="max-w-3xl mx-auto page-enter">
      <PageHeader
        eyebrow="האוסף האישי"
        title={c("library.title") || "הספרייה שלי"}
        description={
          userProducts.length > 0
            ? `${
                userProducts.length === 1
                  ? "ספר אחד באוסף"
                  : `${userProducts.length} ספרים באוסף`
              } · ${
                activeBooks.length === 1
                  ? "ספר אחד זמין לקריאה"
                  : `${activeBooks.length} זמינים לקריאה`
              }`
            : "הספרים שתרכשו יופיעו כאן, עם מצב הגישה והתקדמות הקריאה."
        }
      />

      {userProducts.length === 0 ? (
        <EmptyState
          icon="library"
          title={c("library.empty.title") || "הספרייה שלכם ריקה"}
          description={
            c("library.empty.text") || "רכשו ספרים מהחנות והם יופיעו כאן."
          }
          actions={
            <Link to="/dashboard/store" className="app-btn">
              {c("library.empty.cta") || "לחנות הספרים"}
            </Link>
          }
        />
      ) : (
        <div className="space-y-8">
          {activeBooks.length > 0 && (
            <section aria-labelledby="active-books-title">
              <div className="flex items-baseline justify-between gap-3 mb-3">
                <h2 id="active-books-title" className="app-section-title">
                  מוכנים לקריאה
                </h2>
                <span className="text-xs app-muted tabular-nums">
                  {activeBooks.length}
                </span>
              </div>
              <div className="space-y-4">{activeBooks.map(renderBook)}</div>
            </section>
          )}

          {inactiveBooks.length > 0 && (
            <section aria-labelledby="inactive-books-title">
              <div className="flex items-baseline justify-between gap-3 mb-3">
                <div>
                  <h2 id="inactive-books-title" className="app-section-title">
                    הרשאות שאינן פעילות
                  </h2>
                  <p className="text-xs app-muted mt-1">
                    הספרים נשארים באוסף, אך אינם זמינים לקריאה עד להסדרת
                    ההרשאה.
                  </p>
                </div>
                <span className="text-xs app-muted tabular-nums">
                  {inactiveBooks.length}
                </span>
              </div>
              <div className="space-y-4">{inactiveBooks.map(renderBook)}</div>
            </section>
          )}

          {activeBooks.length === 0 && inactiveBooks.length > 0 && (
            <p className="text-xs app-muted flex flex-wrap items-center gap-2">
              <Icon name="inbox" size={14} />
              אין כרגע ספרים זמינים לקריאה. אפשר להוסיף ספרים חדשים
              <Link
                to="/dashboard/store"
                className="underline underline-offset-4 text-[var(--color-primary)]"
              >
                מהחנות
              </Link>
              .
            </p>
          )}
        </div>
      )}
    </div>
  )
}
