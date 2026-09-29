import { useState } from "react"
import { createPortal } from "react-dom"
import { useAdmin } from "../../context/AdminContext"
import { useCms } from "../../context/CmsContext"
import { formatIsraelDateTime } from "../../lib/datetime"
import { can } from "../../lib/permissions"
import { SECURITY_NOTE } from "../../lib/sensitive"
import type { ProductSnapshot, User } from "../../types"
import AccessDenied from "../../components/AccessDenied"
import Icon from "../../components/icons"

const ROLE_LABEL_USER: Record<string, string> = {
  ADMIN: "מנהל",
  CUSTOMER: "לקוח",
}

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: "פעיל",
  SUSPENDED: "מושעה",
}

const ACCESS_LABEL: Record<string, { text: string, color: string }> = {
  ACTIVE: { text: "פעיל", color: "var(--color-success)" },
  EXPIRED: { text: "פג תוקף", color: "#F59E0B" },
  REVOKED: { text: "נשלל", color: "var(--color-danger)" },
  SUSPENDED: { text: "מושעה", color: "#6B7280" },
}

const ORDER_STATUS_LABEL: Record<string, string> = {
  PAID: "שולם",
  PENDING: "ממתין",
  FAILED: "נכשל",
  REFUNDED: "הוחזר",
  CANCELLED: "בוטל",
}

const REFUND_STATUS_LABEL: Record<string, { text: string, color: string }> = {
  REQUESTED: { text: "התקבלה בקשה", color: "#60A5FA" },
  PENDING: { text: "ממתין להחלטה", color: "#F59E0B" },
  APPROVED: { text: "אושר", color: "var(--color-success)" },
  REJECTED: { text: "נדחה", color: "var(--color-danger)" },
  PROCESSING: { text: "בטיפול", color: "#F59E0B" },
  REFUNDED: { text: "הוחזר בפועל", color: "var(--color-success)" },
  FAILED: { text: "נכשל", color: "var(--color-danger)" },
}

const INQUIRY_STATUS_LABEL: Record<string, string> = {
  NEW: "חדשה",
  OPEN: "פתוחה",
  IN_PROGRESS: "בטיפול",
  WAITING_FOR_CUSTOMER: "ממתינה ללקוח",
  RESOLVED: "נפתרה",
  CLOSED: "סגורה",
}

/**
 * Avatar initial for a user row.
 *
 * A Supabase-backed account can legitimately have no first name — an
 * OAuth signup carries none, and a row written by an older app version
 * may have an empty one. Falling back to the email keeps the avatar
 * legible instead of rendering an empty circle, and the name line below
 * it collapses to the email rather than showing a stray space.
 */
function initialOf(u: { first_name: string, email: string }): string {
  return u.first_name.charAt(0) || u.email.charAt(0) || "?"
}

/** Display name, never blank: a nameless account falls back to its email. */
function nameOf(u: { first_name: string, last_name: string, email: string }): string {
  const full = `${u.first_name} ${u.last_name}`.trim()
  return full || u.email
}

const FALLBACK_COVER: [string, string] = ["#1A1A2E", "#2A2A3E"]

/** Cover from the entitlement snapshot — survives product edits or removal. */
function TinyCover({ snapshot }: { snapshot: ProductSnapshot }) {
  if (snapshot.image_url) {
    return (
      <img
        src={snapshot.image_url}
        alt={snapshot.name}
        className="w-6 h-8 rounded flex-shrink-0 object-cover"
      />
    )
  }
  const [from, to] = snapshot.cover_colors ?? FALLBACK_COVER
  return (
    <div
      className="w-6 h-8 rounded flex-shrink-0"
      style={{ background: `linear-gradient(160deg, ${from}, ${to})` }}
    />
  )
}

type Tab = "overview" | "purchases" | "access" | "progress" | "refunds" | "support" | "activity"

const inputStyle = {
  background: "var(--color-secondary)",
  borderColor: "var(--color-border)",
  color: "var(--color-foreground)",
} as const

function UserDetailModal({
  user,
  onClose,
}: {
  user: User
  onClose: () => void
}) {
  const {
    users,
    orders,
    userProducts,
    readingProgress,
    emailLogs,
    auditLog,
    adminRole,
    setUserStatus,
    setAccessStatus,
    extendAccess,
    removeAccess,
    grantAccess,
    customerProfile,
    createPasswordResetLink,
  } = useAdmin()
  const { products } = useCms()
  const live = users.find((u) => u.user_id === user.user_id) ?? user
  const [tab, setTab] = useState<Tab>("overview")
  const [grantProductId, setGrantProductId] = useState("")
  const [actionError, setActionError] = useState("")
  const [resetLink, setResetLink] = useState<{
    link: string
    expires_at: string
  } | null>(null)

  const canGrant = can(adminRole, "grant_access")
  const canBlock = can(adminRole, "block_user")

  // Every figure below is derived from the customer's own records.
  const profileResult = customerProfile(user.user_id)
  const profile = profileResult.ok ? profileResult.data : null

  const userOrders = orders
    .filter((o) => o.user_id === user.user_id)
    .sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    )
  const access = userProducts.filter((up) => up.user_id === user.user_id)
  const progress = readingProgress.filter((rp) => rp.user_id === user.user_id)
  const userRefunds = (profile?.refunds ?? [])
    .slice()
    .sort(
      (a, b) =>
        new Date(b.requested_at).getTime() - new Date(a.requested_at).getTime(),
    )
  const userInquiries = (profile?.inquiries ?? [])
    .slice()
    .sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    )

  const activity: { at: string, text: string }[] = [
    ...(live.last_login_at
      ? [{ at: live.last_login_at, text: "התחברות למערכת" }]
      : []),
    ...(live.last_activity_at
      ? [{ at: live.last_activity_at, text: "פעילות אחרונה באתר" }]
      : []),
    ...emailLogs
      .filter((e) => e.recipient.toLowerCase() === user.email.toLowerCase())
      .map((e) => ({
        at: e.sent_at,
        text: `מייל "${e.subject}" — ${
          e.status === "SENT" || e.status === "DELIVERED"
            ? "נשלח"
            : "בתור / נכשל"
        }`,
      })),
    ...auditLog
      .filter((a) => a.target_type === "USER" && a.target_id === user.user_id)
      .map((a) => ({
        at: a.created_at,
        text: `${a.action} (על ידי ${a.actor_name})`,
      })),
  ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())

  const grantable = products.filter(
    (p) => !access.some((a) => a.product_id === p.product_id),
  )

  /* No email provider is wired up in this deployment, so a reset link is
   * minted here and shown once — the token itself is never stored. */
  const handleResetLink = async () => {
    setActionError("")
    const result = await createPasswordResetLink(user.user_id)
    if (!result.ok) {
      setResetLink(null)
      setActionError(result.error)
      return
    }
    setResetLink(result.data)
  }

  const tabs: { id: Tab, label: string }[] = [
    { id: "overview", label: "פרטים" },
    { id: "purchases", label: `רכישות (${userOrders.length})` },
    { id: "access", label: `הרשאות (${access.length})` },
    { id: "progress", label: "התקדמות קריאה" },
    { id: "refunds", label: `החזרים (${userRefunds.length})` },
    { id: "support", label: `פניות (${userInquiries.length})` },
    { id: "activity", label: "פעילות" },
  ]

  /* Rendered through a portal so `fixed` resolves against the viewport.
   *
   * The page root carries `page-enter`, whose `fadeUp` animation is applied
   * with `fill-mode: both`. That retains `transform: translateY(0)` after the
   * animation finishes, and any transform other than `none` makes an element
   * the containing block for its `position: fixed` descendants. `fixed
   * inset-0` was therefore sized to this page-height container rather than to
   * the viewport, so the dialog was centred against a box many screens tall:
   * it sat below the fold and its top could not be scrolled to. Portalling to
   * `document.body` escapes every transformed ancestor.
   *
   * The layout matches AdminSecurityPage's dialog — `items-start` with
   * `overflow-y-auto` on the overlay — so content taller than the viewport
   * scrolls from the top and the header, close button and footer all stay
   * reachable. Scrolling the overlay rather than the panel is what keeps that
   * true; a `max-h` on the panel would clip instead. */
  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto p-4 sm:p-6"
      style={{ background: "rgba(0,0,0,0.7)" }}
    >
      <div className="card-glow w-full max-w-2xl p-6 my-4">
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-display text-xl font-semibold">פרופיל לקוח</h2>
          <button
            onClick={onClose}
            style={{ color: "var(--color-muted-foreground)" }}
          >
            <Icon name="x" size={16} />
          </button>
        </div>

        <div className="flex items-center gap-4 mb-5">
          <div
            className="w-12 h-12 rounded-full flex items-center justify-center text-lg font-bold"
            style={{
              background: "rgba(212,160,48,0.12)",
              color: "var(--color-primary)",
              border: "1px solid rgba(212,160,48,0.3)",
            }}
          >
            {initialOf(live)}
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold">{nameOf(live)}</h3>
            <p
              className="text-sm"
              dir="ltr"
              style={{ color: "var(--color-muted-foreground)" }}
            >
              {live.email}
            </p>
          </div>
          <span
            className="text-xs font-bold px-3 py-1 rounded-full"
            style={{
              background:
                live.account_status === "ACTIVE"
                  ? "rgba(34,197,94,0.15)"
                  : "rgba(239,68,68,0.15)",
              color:
                live.account_status === "ACTIVE"
                  ? "var(--color-success)"
                  : "var(--color-danger)",
            }}
          >
            {STATUS_LABEL[live.account_status] ?? live.account_status}
          </span>
        </div>

        {/* Tabs */}
        <div className="flex gap-1.5 mb-5 flex-wrap">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className="px-3 py-1.5 rounded-full text-xs font-medium border transition-all"
              style={{
                background:
                  tab === t.id ? "var(--color-primary)" : "transparent",
                color:
                  tab === t.id
                    ? "var(--color-primary-foreground)"
                    : "var(--color-muted-foreground)",
                borderColor:
                  tab === t.id ? "var(--color-primary)" : "var(--color-border)",
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Overview */}
        {tab === "overview" && (
          <div>
            {actionError && (
              <p
                className="text-xs mb-3"
                style={{ color: "var(--color-danger)" }}
              >
                {actionError}
              </p>
            )}
            <div className="grid grid-cols-2 gap-3 mb-4">
              {[
                {
                  label: "תפקיד",
                  value: ROLE_LABEL_USER[live.role] ?? live.role,
                },
                {
                  label: "סטטוס חשבון",
                  value:
                    STATUS_LABEL[live.account_status] ?? live.account_status,
                },
                {
                  label: "הצטרף/ה בתאריך",
                  value: new Date(live.created_at).toLocaleDateString("he-IL"),
                },
                {
                  label: "התחברות אחרונה",
                  value: formatIsraelDateTime(live.last_login_at) || "מעולם",
                },
                {
                  label: "מספר הזמנות",
                  value: profile
                    ? String(profile.order_count)
                    : String(userOrders.length),
                },
                {
                  label: "סה״כ הוצאה (שולם)",
                  value: `₪${(profile?.total_spend ?? 0).toLocaleString()}`,
                },
                {
                  label: "רכישה אחרונה",
                  value: profile?.last_purchase_at
                    ? new Date(profile.last_purchase_at).toLocaleDateString(
                        "he-IL",
                      )
                    : "אין",
                },
                {
                  label: "החזרים ששולמו",
                  value: `₪${(profile?.refunded_total ?? 0).toLocaleString()}`,
                },
                {
                  label: "מוצרים בבעלות",
                  value: String(
                    access.filter((a) => a.access_status === "ACTIVE").length,
                  ),
                },
                { label: "פניות תמיכה", value: String(userInquiries.length) },
              ].map(({ label, value }) => (
                <div
                  key={label}
                  className="p-3 rounded-md"
                  style={{ background: "var(--color-secondary)" }}
                >
                  <p
                    className="text-xs mb-0.5"
                    style={{ color: "var(--color-muted-foreground)" }}
                  >
                    {label}
                  </p>
                  <p className="text-sm font-medium">{value}</p>
                </div>
              ))}
            </div>
            <div
              className="flex items-start gap-2 p-3 rounded-md text-xs"
              style={{
                background: "rgba(56,189,248,0.08)",
                color: "var(--color-muted-foreground)",
                border: "1px solid rgba(56,189,248,0.2)",
              }}
            >
              <Icon name="shield" size={14} className="flex-shrink-0 mt-0.5" />
              <span>
                {SECURITY_NOTE} הסיסמה מאוחסנת כגיבוב מלוח בלבד ואינה מוצגת בשום
                מסך. איפוס מתבצע באמצעות קישור חד־פעמי שנוצר כאן ומועבר ללקוח.
              </span>
            </div>
          </div>
        )}

        {/* Purchases */}
        {tab === "purchases" && (
          <div className="space-y-2">
            {userOrders.length === 0 ? (
              <p
                className="text-sm"
                style={{ color: "var(--color-muted-foreground)" }}
              >
                אין רכישות.
              </p>
            ) : (
              userOrders.map((o) => (
                <div
                  key={o.order_id}
                  className="p-3 rounded-md border"
                  style={{
                    borderColor: "var(--color-border)",
                    background: "var(--color-background)",
                  }}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-mono" dir="ltr">
                      {o.order_id}
                    </span>
                    <span
                      className="text-xs"
                      style={{ color: "var(--color-muted-foreground)" }}
                    >
                      {new Date(o.created_at).toLocaleDateString("he-IL")}
                    </span>
                  </div>
                  <div className="text-sm space-y-1 mb-2">
                    {o.items.map((it) => (
                      <p key={it.order_item_id}>
                        {it.product_name} × {it.quantity} — ₪
                        {it.line_total.toLocaleString()}
                      </p>
                    ))}
                  </div>
                  <div className="flex items-center justify-between">
                    <span
                      className="text-xs font-bold"
                      style={{
                        color:
                          o.order_status === "PAID"
                            ? "var(--color-success)"
                            : o.order_status === "FAILED"
                              ? "var(--color-danger)"
                              : "var(--color-muted-foreground)",
                      }}
                    >
                      {ORDER_STATUS_LABEL[o.order_status] ?? o.order_status}
                      {o.payment_provider ? ` · ${o.payment_provider}` : ""}
                    </span>
                    <span className="text-sm font-semibold">
                      ₪{o.total_amount.toLocaleString()}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* Access */}
        {tab === "access" && (
          <div>
            {canGrant && grantable.length > 0 && (
              <div className="flex gap-2 mb-4">
                <select
                  className="flex-1 text-sm rounded-lg px-3 py-2 border outline-none"
                  style={inputStyle}
                  value={grantProductId}
                  onChange={(e) => setGrantProductId(e.target.value)}
                >
                  <option value="">בחירת מוצר להענקת גישה...</option>
                  {grantable.map((p) => (
                    <option key={p.product_id} value={p.product_id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => {
                    if (!grantProductId) return
                    const result = grantAccess(user.user_id, grantProductId)
                    if (!result.ok) {
                      setActionError(result.error)
                      return
                    }
                    setActionError("")
                    setGrantProductId("")
                  }}
                  disabled={!grantProductId}
                  className="px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-40"
                  style={{
                    background: "var(--color-primary)",
                    color: "var(--color-primary-foreground)",
                  }}
                >
                  פתיחת גישה
                </button>
              </div>
            )}
            {access.length === 0 ? (
              <p
                className="text-sm"
                style={{ color: "var(--color-muted-foreground)" }}
              >
                אין הרשאות גישה.
              </p>
            ) : (
              <div className="space-y-2">
                {access.map((up) => {
                  const st = ACCESS_LABEL[up.access_status] ?? {
                    text: up.access_status,
                    color: "var(--color-muted-foreground)",
                  }
                  return (
                    <div
                      key={up.user_product_id}
                      className="p-3 rounded-md border"
                      style={{
                        borderColor: "var(--color-border)",
                        background: "var(--color-background)",
                      }}
                    >
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center gap-3">
                          <TinyCover snapshot={up.product_snapshot} />
                          <p className="text-sm font-medium">
                            {up.product_snapshot.name}
                          </p>
                        </div>
                        <span
                          className="text-xs font-bold"
                          style={{ color: st.color }}
                        >
                          {st.text}
                        </span>
                      </div>
                      <p
                        className="text-xs mb-2"
                        style={{ color: "var(--color-muted-foreground)" }}
                      >
                        מקור ההרשאה:{" "}
                        {up.source_order_id
                          ? `הזמנה ${up.source_order_id}`
                          : "הענקה ידנית"}{" "}
                        · הוענק{" "}
                        {new Date(up.granted_at).toLocaleDateString("he-IL")}
                        {up.expires_at
                          ? ` · בתוקף עד ${new Date(up.expires_at).toLocaleDateString("he-IL")}`
                          : ""}
                      </p>
                      {canGrant && (
                        <div className="flex gap-2 flex-wrap">
                          {up.access_status !== "ACTIVE" && (
                            <button
                              onClick={() =>
                                setAccessStatus(
                                  up.user_product_id,
                                  "ACTIVE",
                                  "הפעלת גישה מחדש",
                                )
                              }
                              className="text-xs px-2.5 py-1 rounded-full border"
                              style={{
                                borderColor: "rgba(34,197,94,0.3)",
                                color: "var(--color-success)",
                              }}
                            >
                              הפעלה
                            </button>
                          )}
                          {up.access_status === "ACTIVE" && (
                            <button
                              onClick={() =>
                                setAccessStatus(
                                  up.user_product_id,
                                  "SUSPENDED",
                                  "חסימת גישה",
                                )
                              }
                              className="text-xs px-2.5 py-1 rounded-full border"
                              style={{
                                borderColor: "rgba(245,158,11,0.3)",
                                color: "#F59E0B",
                              }}
                            >
                              חסימה זמנית
                            </button>
                          )}
                          <button
                            onClick={() => {
                              const d = new Date(up.expires_at ?? Date.now())
                              d.setDate(d.getDate() + 30)
                              extendAccess(up.user_product_id, d.toISOString())
                            }}
                            className="text-xs px-2.5 py-1 rounded-full border"
                            style={{
                              borderColor: "var(--color-border)",
                              color: "var(--color-foreground)",
                            }}
                          >
                            הארכה ב־30 ימים
                          </button>
                          <button
                            onClick={() =>
                              setAccessStatus(
                                up.user_product_id,
                                "REVOKED",
                                "שלילת גישה",
                              )
                            }
                            className="text-xs px-2.5 py-1 rounded-full border"
                            style={{
                              borderColor: "rgba(239,68,68,0.3)",
                              color: "var(--color-danger)",
                            }}
                          >
                            שלילה
                          </button>
                          <button
                            onClick={() => removeAccess(up.user_product_id)}
                            className="text-xs px-2.5 py-1 rounded-full border"
                            style={{
                              borderColor: "rgba(239,68,68,0.3)",
                              color: "var(--color-danger)",
                            }}
                          >
                            הסרה
                          </button>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* Reading progress */}
        {tab === "progress" && (
          <div className="space-y-3">
            {progress.length === 0 ? (
              <p
                className="text-sm"
                style={{ color: "var(--color-muted-foreground)" }}
              >
                אין נתוני קריאה עדיין.
              </p>
            ) : (
              progress.map((rp) => {
                // The entitlement snapshot is authoritative for a past purchase;
                // the live catalogue is only a fallback for manually added rows.
                const name =
                  access.find((a) => a.product_id === rp.product_id)
                    ?.product_snapshot.name ??
                  products.find((p) => p.product_id === rp.product_id)?.name ??
                  rp.product_id
                return (
                  <div
                    key={rp.progress_id}
                    className="p-3 rounded-md border"
                    style={{
                      borderColor: "var(--color-border)",
                      background: "var(--color-background)",
                    }}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <p className="text-sm font-medium">{name}</p>
                      <p
                        className="text-xs"
                        style={{ color: "var(--color-muted-foreground)" }}
                      >
                        נקרא לאחרונה:{" "}
                        {new Date(rp.last_read_at).toLocaleDateString("he-IL")}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <div
                        className="flex-1 h-1.5 rounded-full overflow-hidden"
                        style={{ background: "var(--color-secondary)" }}
                      >
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${rp.progress_percent}%`,
                            background:
                              "linear-gradient(90deg, #E7B94C, #B8862A)",
                          }}
                        />
                      </div>
                      <span
                        className="text-xs font-bold"
                        style={{ color: "var(--color-primary)" }}
                      >
                        {rp.progress_percent}%
                      </span>
                    </div>
                    <p
                      className="text-xs mt-1"
                      style={{ color: "var(--color-muted-foreground)" }}
                    >
                      עמוד נוכחי: {rp.current_page}
                    </p>
                  </div>
                )
              })
            )}
          </div>
        )}

        {/* Refunds */}
        {tab === "refunds" && (
          <div className="space-y-2">
            {userRefunds.length === 0 ? (
              <p
                className="text-sm"
                style={{ color: "var(--color-muted-foreground)" }}
              >
                לא נמצאו החזרים עבור לקוח זה.
              </p>
            ) : (
              userRefunds.map((r) => {
                const st = REFUND_STATUS_LABEL[r.status] ?? {
                  text: r.status,
                  color: "var(--color-muted-foreground)",
                }
                return (
                  <div
                    key={r.refund_id}
                    className="p-3 rounded-md border"
                    style={{
                      borderColor: "var(--color-border)",
                      background: "var(--color-background)",
                    }}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs font-mono" dir="ltr">
                        {r.order_id}
                      </span>
                      <span
                        className="text-xs font-bold"
                        style={{ color: st.color }}
                      >
                        {st.text}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span style={{ color: "var(--color-muted-foreground)" }}>
                        מתוך ₪{r.original_amount.toLocaleString()} · התבקש{" "}
                        {new Date(r.requested_at).toLocaleDateString("he-IL")}
                      </span>
                      <span className="font-semibold">
                        ₪{r.amount.toLocaleString()}
                      </span>
                    </div>
                    <p
                      className="text-xs mt-1.5"
                      style={{ color: "var(--color-muted-foreground)" }}
                    >
                      סיבה: {r.reason}
                      {r.provider_refund_id
                        ? ` · מזהה ספק: ${r.provider_refund_id}`
                        : ""}
                    </p>
                  </div>
                )
              })
            )}
          </div>
        )}

        {/* Support inquiries */}
        {tab === "support" && (
          <div className="space-y-2">
            {userInquiries.length === 0 ? (
              <p
                className="text-sm"
                style={{ color: "var(--color-muted-foreground)" }}
              >
                אין פניות תמיכה עבור לקוח זה.
              </p>
            ) : (
              userInquiries.map((inq) => (
                <div
                  key={inq.inquiry_id}
                  className="p-3 rounded-md border"
                  style={{
                    borderColor: "var(--color-border)",
                    background: "var(--color-background)",
                  }}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-mono" dir="ltr">
                      {inq.ticket_number}
                    </span>
                    <span
                      className="text-xs"
                      style={{ color: "var(--color-muted-foreground)" }}
                    >
                      {INQUIRY_STATUS_LABEL[inq.status] ?? inq.status}
                    </span>
                  </div>
                  <p className="text-sm font-medium mb-1">{inq.subject}</p>
                  <p
                    className="text-xs mb-1.5"
                    style={{ color: "var(--color-muted-foreground)" }}
                  >
                    {new Date(inq.created_at).toLocaleDateString("he-IL")}
                    {inq.assigned_to_name
                      ? ` · בטיפול: ${inq.assigned_to_name}`
                      : " · לא שויכה"}
                  </p>
                  {inq.related_order_id && (
                    <p
                      className="text-xs font-mono"
                      dir="ltr"
                      style={{ color: "var(--color-primary)" }}
                    >
                      {inq.related_order_id}
                    </p>
                  )}
                </div>
              ))
            )}
          </div>
        )}

        {/* Activity */}
        {tab === "activity" && (
          <div className="space-y-2">
            {activity.length === 0 ? (
              <p
                className="text-sm"
                style={{ color: "var(--color-muted-foreground)" }}
              >
                אין פעילות מתועדת.
              </p>
            ) : (
              activity.slice(0, 15).map((ev, i) => (
                <div
                  key={i}
                  className="flex items-center gap-3 text-sm py-1.5 border-b"
                  style={{ borderColor: "var(--color-border)" }}
                >
                  <span
                    className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                    style={{ background: "var(--color-primary)" }}
                  />
                  <span className="flex-1">{ev.text}</span>
                  <span
                    className="text-xs flex-shrink-0"
                    style={{ color: "var(--color-muted-foreground)" }}
                  >
                    {formatIsraelDateTime(ev.at)}
                  </span>
                </div>
              ))
            )}
          </div>
        )}

        {/* Footer actions */}
        <div className="mt-6">
          {resetLink && (
            <div
              className="p-3 rounded-md mb-3 text-xs"
              style={{
                background: "rgba(34,197,94,0.08)",
                border: "1px solid rgba(34,197,94,0.25)",
              }}
            >
              <p
                className="font-semibold mb-1"
                style={{ color: "var(--color-success)" }}
              >
                נוצר קישור איפוס חד־פעמי — בתוקף עד{" "}
                {new Date(resetLink.expires_at).toLocaleString("he-IL", {
                  day: "numeric",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </p>
              <p className="break-all font-mono" dir="ltr">
                {resetLink.link}
              </p>
              <p
                className="mt-1.5"
                style={{ color: "var(--color-muted-foreground)" }}
              >
                הקישור מוצג פעם אחת בלבד ולא ניתן לשלוף אותו שוב. יש להעביר אותו
                ללקוח בערוץ מאובטח.
              </p>
            </div>
          )}
          <div className="flex gap-3">
            <button
              onClick={handleResetLink}
              className="flex-1 py-2 rounded-full text-sm font-medium border transition-colors hover:bg-white/5"
              style={{
                borderColor: "var(--color-border)",
                color: "var(--color-foreground)",
              }}
            >
              יצירת קישור איפוס סיסמה
            </button>
            {canBlock && live.role !== "ADMIN" && (
              <button
                onClick={async () => {
                  const result = await setUserStatus(
                    user.user_id,
                    live.account_status === "ACTIVE" ? "SUSPENDED" : "ACTIVE",
                  )
                  setActionError(result.ok ? "" : result.error)
                }}
                className="flex-1 py-2 rounded-full text-sm font-medium border transition-colors hover:bg-red-500/10"
                style={{
                  borderColor:
                    live.account_status === "ACTIVE"
                      ? "rgba(239,68,68,0.3)"
                      : "rgba(34,197,94,0.3)",
                  color:
                    live.account_status === "ACTIVE"
                      ? "var(--color-danger)"
                      : "var(--color-success)",
                }}
              >
                {live.account_status === "ACTIVE"
                  ? "השהיית משתמש"
                  : "הפעלת משתמש"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}

export default function AdminUsersPage() {
  const { users, userProducts, adminRole } = useAdmin()
  const [selected, setSelected] = useState<User | null>(null)
  const [search, setSearch] = useState("")
  const [roleFilter, setRoleFilter] = useState("ALL")

  if (!can(adminRole, "users")) return <AccessDenied page="משתמשים" />

  const filtered = users.filter((u) => {
    const matchSearch = `${u.first_name} ${u.last_name} ${u.email}`
      .toLowerCase()
      .includes(search.toLowerCase())
    const matchRole = roleFilter === "ALL" || u.role === roleFilter
    return matchSearch && matchRole
  })

  return (
    <div className="max-w-5xl mx-auto page-enter">
      <div className="mb-8">
        <h1 className="font-display text-4xl font-semibold mb-1">משתמשים</h1>
        <p style={{ color: "var(--color-muted-foreground)" }}>
          {users.length} משתמשים רשומים
        </p>
      </div>

      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <input
          className="flex-1 min-w-48 px-4 py-2.5 rounded-lg border text-sm outline-none"
          style={inputStyle}
          placeholder="חיפוש לפי שם או אימייל..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="flex gap-2">
          {([
            { value: "ALL", label: "הכול" },
            { value: "CUSTOMER", label: "לקוחות" },
            { value: "ADMIN", label: "מנהלים" },
          ] as const).map((r) => (
            <button
              key={r.value}
              onClick={() => setRoleFilter(r.value)}
              className="px-3 py-2 rounded-full text-xs font-medium border transition-all"
              style={{
                background:
                  roleFilter === r.value
                    ? "var(--color-primary)"
                    : "transparent",
                color:
                  roleFilter === r.value
                    ? "var(--color-primary-foreground)"
                    : "var(--color-muted-foreground)",
                borderColor:
                  roleFilter === r.value
                    ? "var(--color-primary)"
                    : "var(--color-border)",
              }}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {users.length === 0 && (
        <div
          className="card-glow p-10 text-center text-sm mb-4"
          style={{ color: "var(--color-muted-foreground)" }}
        >
          אין עדיין משתמשים רשומים. לקוחות נוצרים אוטומטית עם השלמת רכישה או
          הרשמה.
        </div>
      )}

      <div
        className="rounded-lg border overflow-hidden"
        style={{ borderColor: "var(--color-border)" }}
      >
        <table className="w-full text-sm">
          <thead>
            <tr style={{ background: "var(--color-secondary)" }}>
              {[
                "משתמש",
                "תפקיד",
                "סטטוס",
                "הצטרפות",
                "ספרים",
                "התחברות אחרונה",
                "פעולות",
              ].map((col) => (
                <th
                  key={col}
                  className="text-right px-5 py-3 text-xs tracking-wide"
                  style={{
                    color: "var(--color-muted-foreground)",
                    borderBottom: "1px solid var(--color-border)",
                  }}
                >
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((user, i) => {
              const count = userProducts.filter(
                (up) =>
                  up.user_id === user.user_id && up.access_status === "ACTIVE",
              ).length
              return (
                <tr
                  key={user.user_id}
                  style={{
                    background:
                      i % 2 === 0
                        ? "var(--color-card)"
                        : "var(--color-background)",
                    borderBottom: "1px solid var(--color-border)",
                  }}
                >
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-3">
                      <div
                        className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                        style={{
                          background: "rgba(212,160,48,0.12)",
                          color: "var(--color-primary)",
                        }}
                      >
                        {initialOf(user)}
                      </div>
                      <div>
                        <p className="font-medium">{nameOf(user)}</p>
                        <p
                          className="text-xs"
                          dir="ltr"
                          style={{ color: "var(--color-muted-foreground)" }}
                        >
                          {user.email}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-3">
                    <span
                      className="text-xs"
                      style={{ color: "var(--color-muted-foreground)" }}
                    >
                      {ROLE_LABEL_USER[user.role] ?? user.role}
                    </span>
                  </td>
                  <td className="px-5 py-3">
                    <span
                      className="text-xs"
                      style={{
                        color:
                          user.account_status === "ACTIVE"
                            ? "var(--color-success)"
                            : "var(--color-danger)",
                      }}
                    >
                      {STATUS_LABEL[user.account_status] ?? user.account_status}
                    </span>
                  </td>
                  <td
                    className="px-5 py-3 text-xs"
                    style={{ color: "var(--color-muted-foreground)" }}
                  >
                    {new Date(user.created_at).toLocaleDateString("he-IL", {
                      day: "numeric",
                      month: "short",
                      year: "2-digit",
                    })}
                  </td>
                  <td className="px-5 py-3">
                    <span className="text-sm font-semibold">{count}</span>
                  </td>
                  <td
                    className="px-5 py-3 text-xs"
                    style={{ color: "var(--color-muted-foreground)" }}
                  >
                    {formatIsraelDateTime(user.last_login_at) || "מעולם"}
                  </td>
                  <td className="px-5 py-3">
                    <button
                      onClick={() => setSelected(user)}
                      className="text-xs px-3 py-1 rounded-full border transition-colors hover:bg-white/5"
                      style={{
                        borderColor: "var(--color-border)",
                        color: "var(--color-foreground)",
                      }}
                    >
                      צפייה
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {selected && (
        <UserDetailModal user={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  )
}
