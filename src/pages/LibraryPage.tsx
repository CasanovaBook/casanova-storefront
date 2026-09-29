import { useNavigate } from "react-router"
import { prefetchPdfRuntime } from "../components/PdfCanvas"
import { useApp } from "../context/AppContext"
import { useCms } from "../context/CmsContext"
import { useContent } from "../content/useContent"
import type { ProductSnapshot } from "../types"
import Icon from "../components/icons"

/* Hover/focus/touch on "המשך קריאה" starts fetching the PDF runtime chunk
 * before the click lands, so the first open skips most of its lazy-load
 * latency. A no-op once loaded; it never fetches content — only code. */

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: "פעיל",
  EXPIRED: "פג תוקף",
  REVOKED: "נשלל",
  SUSPENDED: "מושעה",
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
  if (src) {
    return (
      <img
        src={src}
        alt={snapshot.name}
        className="w-16 h-24 rounded-md flex-shrink-0 cursor-pointer shadow-lg object-cover"
        style={{ opacity: active ? 1 : 0.5 }}
        onClick={onClick}
      />
    )
  }
  return (
    <div
      className="w-16 h-24 rounded-md flex-shrink-0 cursor-pointer shadow-lg"
      style={{
        background: `linear-gradient(160deg, ${from}, ${to})`,
        opacity: active ? 1 : 0.5,
      }}
      onClick={onClick}
    />
  )
}

function AccessBadge({ status }: { status: string }) {
  const colors: Record<string, { bg: string, color: string }> = {
    ACTIVE: { bg: "rgba(34,197,94,0.1)", color: "var(--color-success)" },
    EXPIRED: { bg: "rgba(239,68,68,0.1)", color: "var(--color-danger)" },
    REVOKED: { bg: "rgba(239,68,68,0.1)", color: "var(--color-danger)" },
    SUSPENDED: { bg: "rgba(245,158,11,0.1)", color: "#F59E0B" },
  }
  const { bg, color } = colors[status] ?? colors.ACTIVE
  return (
    <span
      className="text-xs px-2 py-0.5 rounded-full"
      style={{ background: bg, color }}
    >
      {STATUS_LABEL[status] ?? status}
    </span>
  )
}

export default function LibraryPage() {
  const { userProducts, readingProgress } = useApp()
  const cms = useCms()
  const c = useContent()
  const navigate = useNavigate()

  const getProgress = (productId: string) =>
    readingProgress.find((rp) => rp.product_id === productId)

  return (
    <div className="max-w-3xl mx-auto page-enter">
      <div className="mb-8">
        <h1 className="font-display text-4xl font-semibold mb-2">
          {c("library.title") || "הספרייה שלי"}
        </h1>
        <p style={{ color: "var(--color-muted-foreground)" }}>
          {userProducts.length} ספרים באוסף שלך.
        </p>
      </div>

      {userProducts.length === 0 ? (
        <div className="card-glow p-12 text-center">
          <div
            className="flex justify-center mb-4 opacity-60"
            style={{ color: "var(--color-primary)" }}
          >
            <Icon name="library" size={40} />
          </div>
          <h2 className="font-display text-xl font-semibold mb-2">
            {c("library.empty.title") || "הספרייה שלך ריקה"}
          </h2>
          <p
            className="text-sm mb-6"
            style={{ color: "var(--color-muted-foreground)" }}
          >
            {c("library.empty.text") || "רכוש ספר כדי להוסיף אותו לספרייה שלך."}
          </p>
          <button
            onClick={() => navigate("/dashboard/store")}
            className="btn-gradient px-6 py-2.5 rounded-full font-semibold text-sm"
          >
            {c("library.empty.cta") || "לחנות הספרים"}
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {userProducts.map((up) => {
            const progress = getProgress(up.product_id)
            const isActive = up.access_status === "ACTIVE"
            const snapshot = up.product_snapshot
            const live = cms.productById(up.product_id)
            const totalPages = snapshot.total_pages ?? live?.book?.total_pages
            const open = () => isActive && navigate(`/read/${up.product_id}`)
            return (
              <div
                key={up.user_product_id}
                className="card-glow flex gap-5 p-5"
              >
                {/* Cover */}
                <LibraryCover
                  snapshot={snapshot}
                  imageUrl={live?.image_url}
                  active={isActive}
                  onClick={open}
                />

                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <div>
                      <h3 className="font-display text-lg font-semibold leading-snug">
                        {snapshot.name}
                      </h3>
                      {snapshot.author_name && (
                        <p
                          className="text-sm"
                          style={{ color: "var(--color-muted-foreground)" }}
                        >
                          מאת {snapshot.author_name}
                        </p>
                      )}
                    </div>
                    <AccessBadge status={up.access_status} />
                  </div>

                  {progress ? (
                    <div className="mt-3 mb-3">
                      <div
                        className="flex justify-between text-xs mb-1"
                        style={{ color: "var(--color-muted-foreground)" }}
                      >
                        <span>
                          עמוד {progress.current_page}
                          {totalPages ? ` / ${totalPages}` : ""}
                        </span>
                        <span>{progress.progress_percent.toFixed(1)}%</span>
                      </div>
                      <div
                        className="h-1.5 rounded-full"
                        style={{ background: "var(--color-muted)" }}
                      >
                        <div
                          className="h-full rounded-full transition-all"
                          style={{
                            width: `${progress.progress_percent}%`,
                            background:
                              "linear-gradient(90deg, #E7B94C, #B8862A)",
                          }}
                        />
                      </div>
                      <p
                        className="text-xs mt-1"
                        style={{ color: "var(--color-muted-foreground)" }}
                      >
                        נקרא לאחרונה:{" "}
                        {new Date(progress.last_read_at).toLocaleDateString(
                          "he-IL",
                          {
                            day: "numeric",
                            month: "short",
                            hour: "2-digit",
                            minute: "2-digit",
                          },
                        )}
                      </p>
                    </div>
                  ) : (
                    <p
                      className="text-xs mt-2 mb-3"
                      style={{ color: "var(--color-muted-foreground)" }}
                    >
                      {totalPages
                        ? `עוד לא התחלתם — ${totalPages} עמודים`
                        : "עוד לא התחלתם לקרוא"}
                    </p>
                  )}

                  <div className="flex items-center gap-3">
                    {isActive ? (
                      <button
                        onMouseEnter={prefetchPdfRuntime}
                        onFocus={prefetchPdfRuntime}
                        onTouchStart={prefetchPdfRuntime}
                        onClick={() => navigate(`/read/${up.product_id}`)}
                        className="btn-gradient px-4 py-1.5 rounded-full text-sm font-semibold"
                      >
                        {progress ? "המשך קריאה" : "התחילו לקרוא"}
                      </button>
                    ) : (
                      <span
                        className="text-sm"
                        style={{ color: "var(--color-muted-foreground)" }}
                      >
                        אין גישה זמינה
                      </span>
                    )}
                    <span
                      className="text-xs"
                      style={{ color: "var(--color-muted-foreground)" }}
                    >
                      נרכש בתאריך{" "}
                      {new Date(up.granted_at).toLocaleDateString("he-IL", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                    </span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
