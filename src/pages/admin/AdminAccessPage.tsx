import { useState } from "react"
import { Link } from "react-router"

import { useAdmin } from "../../context/AdminContext"
import { useCms } from "../../context/CmsContext"
import { can } from "../../lib/permissions"
import type { ProductSnapshot } from "../../types"
import AccessDenied from "../../components/AccessDenied"
import Icon from "../../components/icons"
import PageHeader from "../../components/ui/PageHeader"
import EmptyState from "../../components/ui/EmptyState"
import Alert from "../../components/ui/Alert"
import { useAccessActions } from "./useAccessActions"

const ACCESS_LABEL: Record<string, { text: string, badge: string }> = {
  ACTIVE: { text: "פעיל", badge: "app-badge--success" },
  EXPIRED: { text: "פג תוקף", badge: "app-badge--warning" },
  REVOKED: { text: "נשלל", badge: "app-badge--danger" },
  SUSPENDED: { text: "חסום", badge: "app-badge--neutral" },
}

const FALLBACK_COVER: [string, string] = ["#1A1A2E", "#2A2A3E"]

/** Cover from the stored snapshot, so archived products still render. */
function AccessCover({ snapshot }: { snapshot: ProductSnapshot }) {
  if (snapshot.image_url) {
    return (
      <img
        src={snapshot.image_url}
        alt={snapshot.name}
        className="w-8 h-11 rounded flex-shrink-0 object-cover"
      />
    )
  }
  const [from, to] = snapshot.cover_colors ?? FALLBACK_COVER
  return (
    <div
      className="w-8 h-11 rounded flex-shrink-0"
      style={{ background: `linear-gradient(160deg, ${from}, ${to})` }}
      aria-hidden="true"
    />
  )
}

export default function AdminAccessPage() {
  const {
    users,
    orders,
    userProducts,
    adminRole,
    grantAccess,
    setAccessStatus,
    removeAccess,
  } = useAdmin()

  /* Every product an entitlement can point at: the whole hosted catalogue
   * for an admin, or the local document when Supabase is unconfigured. The
   * storefront's ACTIVE + PUBLIC list is the wrong source here — a private
   * book is not publicly listed, so the picker came up empty. */
  const { adminProducts: products } = useCms()

  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState("ALL")
  const [grantUser, setGrantUser] = useState("")
  const [grantProduct, setGrantProduct] = useState("")
  const [grantOrder, setGrantOrder] = useState("")
  const [grantError, setGrantError] = useState("")

  /* Loading / confirmation / error surfacing for the four row actions. */
  const {
    busyId,
    error: actionError,
    success: actionSuccess,
    run,
    clearFeedback,
  } = useAccessActions()

  if (!can(adminRole, "access")) return <AccessDenied page="הרשאות גישה" />

  const canGrant = can(adminRole, "grant_access")

  const rows = userProducts
    .map((up) => {
      const owner = users.find((u) => u.user_id === up.user_id)
      const sourceOrder = up.source_order_id
        ? orders.find((o) => o.order_id === up.source_order_id)
        : undefined
      return { up, owner, sourceOrder }
    })
    .filter(({ owner, up }) => {
      const name = up.product_snapshot.name
      const matchSearch = owner
        ? `${owner.first_name} ${owner.last_name} ${owner.email} ${name}`
            .toLowerCase()
            .includes(search.toLowerCase())
        : name.toLowerCase().includes(search.toLowerCase())
      const matchStatus =
        statusFilter === "ALL" || up.access_status === statusFilter
      return matchSearch && matchStatus
    })
    .sort(
      (a, b) =>
        new Date(b.up.granted_at).getTime() -
        new Date(a.up.granted_at).getTime(),
    )

  // Only settled orders can serve as the documented source of a grant.
  const grantUserOrders = orders.filter(
    (o) => o.user_id === grantUser && o.payment_status === "PAID",
  )

  const handleGrant = async () => {
    if (!grantUser || !grantProduct) return

    /* Hosted grants are written server-side, so this is a round trip. */
    const result = await grantAccess(
      grantUser,
      grantProduct,
      grantOrder || undefined,
    )

    if (!result.ok) {
      setGrantError(result.error)
      return
    }

    setGrantError("")
    setGrantUser("")
    setGrantProduct("")
    setGrantOrder("")
  }

  const clearFilters = () => {
    setSearch("")
    setStatusFilter("ALL")
  }

  return (
    <div className="page-enter">
      <PageHeader
        eyebrow="ניהול · בקרת גישה"
        title="הרשאות גישה"
        description="Access Management — פתיחה, חסימה, שלילה או הסרה של גישה למוצרים, כולל מעקב אחר מקור ההרשאה."
        breadcrumbs={[
          { label: "ניהול", to: "/admin" },
          { label: "הרשאות גישה" },
        ]}
        actions={
          can(adminRole, "users") ? (
            <Link to="/admin/users" className="app-btn-secondary">
              <Icon name="users" size={15} />
              ניהול משתמשים
            </Link>
          ) : undefined
        }
      />

      {/* Grant new access */}
      {canGrant && (
        <section
          className="app-surface mb-6"
          aria-labelledby="grant-access-title"
        >
          <div className="app-surface-head">
            <h2
              id="grant-access-title"
              className="app-section-title flex items-center gap-2"
            >
              <Icon
                name="key"
                size={15}
                className="flex-shrink-0"
                style={{ color: "var(--color-primary)" }}
              />
              הענקת גישה חדשה
            </h2>
          </div>
          <div className="app-surface-body">
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3 xl:items-end">
              <div className="app-field">
                <label htmlFor="grant-user" className="app-label">
                  משתמש
                </label>
                <select
                  id="grant-user"
                  className="text-sm rounded-lg px-3 py-2.5 border outline-none"
                  value={grantUser}
                  onChange={(e) => {
                    setGrantUser(e.target.value)
                    setGrantOrder("")
                  }}
                >
                  <option value="">בחירת משתמש...</option>
                  {users.map((u) => (
                    <option key={u.user_id} value={u.user_id}>
                      {u.first_name} {u.last_name} — {u.email}
                    </option>
                  ))}
                </select>
              </div>
              <div className="app-field">
                <label htmlFor="grant-product" className="app-label">
                  מוצר
                </label>
                <select
                  id="grant-product"
                  className="text-sm rounded-lg px-3 py-2.5 border outline-none"
                  value={grantProduct}
                  onChange={(e) => setGrantProduct(e.target.value)}
                >
                  <option value="">בחירת מוצר...</option>
                  {products.map((p) => (
                    <option key={p.product_id} value={p.product_id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="app-field">
                <label htmlFor="grant-order" className="app-label">
                  מקור ההרשאה
                </label>
                <select
                  id="grant-order"
                  className="text-sm rounded-lg px-3 py-2.5 border outline-none disabled:opacity-50"
                  value={grantOrder}
                  onChange={(e) => setGrantOrder(e.target.value)}
                  disabled={!grantUser}
                >
                  <option value="">הענקה ידנית</option>
                  {grantUserOrders.map((o) => (
                    <option key={o.order_id} value={o.order_id}>
                      הזמנה {o.order_id} (₪{o.total_amount.toLocaleString()})
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                onClick={() => void handleGrant()}
                disabled={!grantUser || !grantProduct}
                className="app-btn w-full"
              >
                פתיחת גישה
              </button>
            </div>
            {grantError && (
              <div className="mt-3">
                <Alert tone="error">{grantError}</Alert>
              </div>
            )}
            {products.length === 0 && (
              <p className="app-hint mt-3">
                אין עדיין מוצרים בקטלוג — יש ליצור מוצר לפני הענקת גישה.
              </p>
            )}
          </div>
        </section>
      )}

      {/* Filters */}
      <section className="app-surface mb-4" aria-label="סינון הרשאות גישה">
        <div className="app-surface-body">
          <div className="flex flex-col xl:flex-row xl:items-end gap-4">
            <div className="flex-1 min-w-0">
              <label htmlFor="access-search" className="app-label block mb-1.5">
                חיפוש
              </label>
              <input
                id="access-search"
                type="search"
                className="w-full px-4 py-2.5 rounded-lg border text-sm outline-none"
                placeholder="חיפוש לפי משתמש או מוצר..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="min-w-0">
              <span className="app-label block mb-1.5">סטטוס הרשאה</span>
              <div
                className="app-tabs"
                role="group"
                aria-label="סינון לפי סטטוס הרשאה"
                style={{ borderBottom: 0 }}
              >
                {([
                  { value: "ALL", label: "הכול" },
                  { value: "ACTIVE", label: "פעיל" },
                  { value: "SUSPENDED", label: "חסום" },
                  { value: "REVOKED", label: "נשלל" },
                  { value: "EXPIRED", label: "פג תוקף" },
                ] as const).map((s) => (
                  <button
                    key={s.value}
                    type="button"
                    onClick={() => setStatusFilter(s.value)}
                    className="app-tab"
                    data-active={statusFilter === s.value}
                    aria-pressed={statusFilter === s.value}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Action feedback — the RPC refusals and failures surfaced here,
          so a failed action is never a silent dead click. */}
      {(actionError || actionSuccess) && (
        <div className="flex items-start gap-2 mb-4">
          <div className="flex-1 min-w-0">
            <Alert tone={actionError ? "error" : "success"}>
              {actionError || actionSuccess}
            </Alert>
          </div>
          <button
            type="button"
            onClick={clearFeedback}
            className="app-icon-btn flex-shrink-0"
            aria-label="סגירת הודעה"
          >
            <Icon name="x" size={15} />
          </button>
        </div>
      )}

      {/* Access records */}
      {rows.length === 0 ? (
        <EmptyState
          icon="key"
          title={
            userProducts.length === 0
              ? "לא נפתחו עדיין הרשאות גישה."
              : "לא נמצאו הרשאות גישה תואמות."
          }
          description={
            userProducts.length === 0
              ? "גישה נפתחת בהשלמת רכישה או בהענקה ידנית של מנהל."
              : "נסו לשנות את מונח החיפוש או את סינון הסטטוס."
          }
          actions={
            userProducts.length > 0 ? (
              <button
                type="button"
                className="app-btn-secondary"
                onClick={clearFilters}
              >
                ניקוי סינון
              </button>
            ) : undefined
          }
        />
      ) : (
        <section className="app-surface" aria-labelledby="access-records-title">
          <div className="app-surface-head">
            <h2 id="access-records-title" className="app-section-title">
              רשומות הרשאה
            </h2>
            <span className="app-badge app-badge--neutral">{rows.length}</span>
          </div>
          <div
            className="divide-y"
            style={{ borderColor: "var(--color-border)" }}
          >
            {rows.map(({ up, owner, sourceOrder }) => {
              const st = ACCESS_LABEL[up.access_status] ?? {
                text: up.access_status,
                badge: "app-badge--neutral",
              }

              return (
                <div key={up.user_product_id} className="p-4 sm:p-5">
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <AccessCover snapshot={up.product_snapshot} />
                      <div className="min-w-0">
                        <p className="text-sm font-semibold truncate">
                          {up.product_snapshot.name}
                        </p>
                        <p className="text-xs app-muted truncate">
                          {owner
                            ? `${owner.first_name} ${owner.last_name} · `
                            : ""}
                          <span dir="ltr">{owner?.email}</span>
                        </p>
                      </div>
                    </div>
                    <span className={`app-badge ${st.badge} flex-shrink-0`}>
                      {st.text}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-6 gap-y-2 mt-3 text-xs app-muted">
                    <span className="flex items-start gap-1.5 min-w-0">
                      <Icon
                        name="receipt"
                        size={12}
                        className="flex-shrink-0 mt-0.5"
                      />
                      <span className="min-w-0">
                        {up.source_order_id ? (
                          <>
                            מקור ההרשאה: הזמנה{" "}
                            <span className="font-mono" dir="ltr">
                              {up.source_order_id}
                            </span>
                            {sourceOrder &&
                              ` (₪${sourceOrder.total_amount.toLocaleString()}, שולמה ${new Date(sourceOrder.paid_at ?? sourceOrder.created_at).toLocaleDateString("he-IL")})`}
                          </>
                        ) : (
                          "מקור ההרשאה: הענקה ידנית על ידי מנהל"
                        )}
                      </span>
                    </span>
                    <span className="flex items-center gap-1.5">
                      <Icon name="clock" size={12} className="flex-shrink-0" />
                      הוענקה{" "}
                      {new Date(up.granted_at).toLocaleDateString("he-IL")}
                      {up.expires_at && (
                        <>
                          {" · "}
                          <Icon
                            name="calendar"
                            size={12}
                            className="flex-shrink-0"
                          />
                          בתוקף עד{" "}
                          {new Date(up.expires_at).toLocaleDateString("he-IL")}
                        </>
                      )}
                    </span>
                  </div>

                  {canGrant && (
                    <div className="flex gap-2 mt-4 flex-wrap items-center">
                      {up.access_status !== "ACTIVE" && (
                        <button
                          type="button"
                          onClick={() =>
                            void run(
                              up.user_product_id,
                              () =>
                                setAccessStatus(
                                  up.user_product_id,
                                  "ACTIVE",
                                  "פתיחת גישה מחדש",
                                ),
                              { successMessage: "הגישה נפתחה מחדש" },
                            )
                          }
                          disabled={busyId !== null}
                          className="app-btn-secondary"
                          style={{
                            minHeight: "2.2rem",
                            padding: "0.35rem 0.9rem",
                            fontSize: "0.75rem",
                            color: "var(--color-success)",
                            borderColor:
                              "color-mix(in srgb, var(--color-success) 35%, var(--color-border))",
                          }}
                        >
                          פתיחה
                        </button>
                      )}
                      {up.access_status === "ACTIVE" && (
                        <button
                          type="button"
                          onClick={() =>
                            void run(
                              up.user_product_id,
                              () =>
                                setAccessStatus(
                                  up.user_product_id,
                                  "SUSPENDED",
                                  "חסימת גישה זמנית",
                                ),
                              { successMessage: "הגישה נחסמה" },
                            )
                          }
                          disabled={busyId !== null}
                          className="app-btn-secondary"
                          style={{
                            minHeight: "2.2rem",
                            padding: "0.35rem 0.9rem",
                            fontSize: "0.75rem",
                          }}
                        >
                          חסימה
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() =>
                          void run(
                            up.user_product_id,
                            () =>
                              setAccessStatus(
                                up.user_product_id,
                                "REVOKED",
                                "שלילת גישה",
                              ),
                            {
                              confirm:
                                "לשלול את הגישה של הלקוח למוצר זה? ניתן לשחזר דרך כפתור הפתיחה.",
                              successMessage: "הגישה נשללה",
                            },
                          )
                        }
                        disabled={busyId !== null}
                        className="app-btn-secondary"
                        style={{
                          minHeight: "2.2rem",
                          padding: "0.35rem 0.9rem",
                          fontSize: "0.75rem",
                          color: "var(--color-danger)",
                          borderColor:
                            "color-mix(in srgb, var(--color-danger) 35%, var(--color-border))",
                        }}
                      >
                        שלילה
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          void run(
                            up.user_product_id,
                            () => removeAccess(up.user_product_id),
                            {
                              confirm:
                                "להסיר את הרשאת הגישה לחלוטין? הפעולה אינה הפיכה והרשאה תימחק מהמערכת.",
                              successMessage: "ההרשאה הוסרה לחלוטין",
                            },
                          )
                        }
                        disabled={busyId !== null}
                        className="app-btn-danger"
                        style={{
                          minHeight: "2.2rem",
                          padding: "0.35rem 0.9rem",
                          fontSize: "0.75rem",
                        }}
                      >
                        {busyId === up.user_product_id ? "מבצע…" : "הסרה מלאה"}
                      </button>
                      {busyId === up.user_product_id && (
                        <span
                          className="app-spinner"
                          role="status"
                          aria-label="מבצע פעולה"
                        />
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </section>
      )}
    </div>
  )
}
