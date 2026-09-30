import { useState } from "react"

import { useAdmin } from "../../context/AdminContext"

import { useCms } from "../../context/CmsContext"

import { can } from "../../lib/permissions"

import type { ProductSnapshot } from "../../types"

import AccessDenied from "../../components/AccessDenied"

import Icon from "../../components/icons"

import { useAccessActions } from "./useAccessActions"

const ACCESS_LABEL: Record<string, { text: string, color: string }> = {
  ACTIVE: { text: "פעיל", color: "var(--color-success)" },

  EXPIRED: { text: "פג תוקף", color: "#F59E0B" },

  REVOKED: { text: "נשלל", color: "var(--color-danger)" },

  SUSPENDED: { text: "חסום", color: "#6B7280" },
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
    />
  )
}

const inputStyle = {
  background: "var(--color-secondary)",

  borderColor: "var(--color-border)",

  color: "var(--color-foreground)",
} as const

export default function AdminAccessPage() {
  const {
    users,

    orders,

    userProducts,

    adminRole,

    grantAccess,

    setAccessStatus,

    extendAccess,

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
    extendedExpiry,
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

  return (
    <div className="max-w-5xl mx-auto page-enter">
      <div className="mb-8">
        <h1 className="font-display text-4xl font-semibold mb-1">
          הרשאות גישה
        </h1>
        <p style={{ color: "var(--color-muted-foreground)" }}>
          Access Management — פתיחה, חסימה, הארכה או הסרה של גישה למוצרים, כולל
          מעקב אחר מקור ההרשאה.
        </p>
      </div>

      {/* Grant new access */}
      {canGrant && (
        <div className="card-glow p-5 mb-6">
          <h2 className="font-semibold text-sm mb-4 flex items-center gap-2">
            <Icon
              name="key"
              size={15}
              className="flex-shrink-0"
              style={{ color: "var(--color-primary)" }}
            />
            הענקת גישה חדשה
          </h2>
          <div className="grid md:grid-cols-4 gap-3">
            <select
              className="text-sm rounded-lg px-3 py-2.5 border outline-none"
              style={inputStyle}
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
            <select
              className="text-sm rounded-lg px-3 py-2.5 border outline-none"
              style={inputStyle}
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
            <select
              className="text-sm rounded-lg px-3 py-2.5 border outline-none disabled:opacity-50"
              style={inputStyle}
              value={grantOrder}
              onChange={(e) => setGrantOrder(e.target.value)}
              disabled={!grantUser}
            >
              <option value="">מקור: הענקה ידנית</option>
              {grantUserOrders.map((o) => (
                <option key={o.order_id} value={o.order_id}>
                  מקור: הזמנה {o.order_id} (₪{o.total_amount.toLocaleString()})
                </option>
              ))}
            </select>
            <button
              onClick={() => void handleGrant()}
              disabled={!grantUser || !grantProduct}
              className="px-4 py-2.5 rounded-lg text-sm font-medium disabled:opacity-40"
              style={{
                background: "var(--color-primary)",
                color: "var(--color-primary-foreground)",
              }}
            >
              פתיחת גישה
            </button>
          </div>
          {grantError && (
            <p
              className="text-xs mt-3"
              style={{ color: "var(--color-danger)" }}
            >
              {grantError}
            </p>
          )}
          {products.length === 0 && (
            <p
              className="text-xs mt-3"
              style={{ color: "var(--color-muted-foreground)" }}
            >
              אין עדיין מוצרים בקטלוג — יש ליצור מוצר לפני הענקת גישה.
            </p>
          )}
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <input
          className="flex-1 min-w-48 px-4 py-2.5 rounded-lg border text-sm outline-none"
          style={inputStyle}
          placeholder="חיפוש לפי משתמש או מוצר..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="flex gap-2">
          {([
            { value: "ALL", label: "הכול" },

            { value: "ACTIVE", label: "פעיל" },

            { value: "SUSPENDED", label: "חסום" },

            { value: "REVOKED", label: "נשלל" },

            { value: "EXPIRED", label: "פג תוקף" },
          ] as const).map((s) => (
            <button
              key={s.value}
              onClick={() => setStatusFilter(s.value)}
              className="px-3 py-2 rounded-full text-xs font-medium border transition-all"
              style={{
                background:
                  statusFilter === s.value
                    ? "var(--color-primary)"
                    : "transparent",

                color:
                  statusFilter === s.value
                    ? "var(--color-primary-foreground)"
                    : "var(--color-muted-foreground)",

                borderColor:
                  statusFilter === s.value
                    ? "var(--color-primary)"
                    : "var(--color-border)",
              }}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Action feedback — the RPC refusals and failures surfaced here,
          so a failed action is never a silent dead click. */}
      {(actionError || actionSuccess) && (
        <div
          role={actionError ? "alert" : "status"}
          className="flex items-center justify-between gap-3 rounded-lg px-4 py-2.5 mb-4 text-sm"
          style={{
            background: actionError
              ? "rgba(239,68,68,0.08)"
              : "rgba(34,197,94,0.08)",
            border: `1px solid ${
              actionError ? "rgba(239,68,68,0.3)" : "rgba(34,197,94,0.3)"
            }`,
            color: actionError
              ? "var(--color-danger)"
              : "var(--color-success)",
          }}
        >
          <span>{actionError || actionSuccess}</span>
          <button
            onClick={clearFeedback}
            className="text-xs opacity-70 hover:opacity-100 flex-shrink-0"
            aria-label="סגירת הודעה"
          >
            ✕
          </button>
        </div>
      )}

      {/* Access records */}
      <div className="space-y-3">
        {rows.length === 0 && (
          <div
            className="card-glow p-10 text-center text-sm"
            style={{ color: "var(--color-muted-foreground)" }}
          >
            {userProducts.length === 0
              ? "לא נפתחו עדיין הרשאות גישה."
              : "לא נמצאו הרשאות גישה תואמות."}
          </div>
        )}
        {rows.map(({ up, owner, sourceOrder }) => {
          const st = ACCESS_LABEL[up.access_status] ?? {
            text: up.access_status,
            color: "var(--color-muted-foreground)",
          }

          return (
            <div key={up.user_product_id} className="card-glow p-4">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="flex items-center gap-3 min-w-0">
                  <AccessCover snapshot={up.product_snapshot} />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">
                      {up.product_snapshot.name}
                    </p>
                    <p
                      className="text-xs"
                      style={{ color: "var(--color-muted-foreground)" }}
                    >
                      {owner ? `${owner.first_name} ${owner.last_name} · ` : ""}
                      <span dir="ltr">{owner?.email}</span>
                    </p>
                  </div>
                </div>
                <span
                  className="text-xs font-bold px-3 py-1 rounded-full flex-shrink-0"
                  style={{
                    background: `${
                      st.color === "var(--color-success)"
                        ? "rgba(34,197,94,"
                        : st.color === "var(--color-danger)"
                          ? "rgba(239,68,68,"
                          : "rgba(245,158,11,"
                    }0.12)`,
                    color: st.color,
                  }}
                >
                  {st.text}
                </span>
              </div>

              <div
                className="flex items-center gap-4 mt-3 text-xs flex-wrap"
                style={{ color: "var(--color-muted-foreground)" }}
              >
                <span className="flex items-center gap-1.5">
                  <Icon name="receipt" size={12} />
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
                <span className="flex items-center gap-1.5">
                  <Icon name="clock" size={12} />
                  הוענקה {new Date(up.granted_at).toLocaleDateString("he-IL")}
                </span>
                {up.expires_at && (
                  <span className="flex items-center gap-1.5">
                    <Icon name="calendar" size={12} />
                    בתוקף עד{" "}
                    {new Date(up.expires_at).toLocaleDateString("he-IL")}
                  </span>
                )}
              </div>

              {canGrant && (
                <div className="flex gap-2 mt-3 flex-wrap items-center">
                  {up.access_status !== "ACTIVE" && (
                    <button
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
                      className="text-xs px-3 py-1.5 rounded-full border disabled:opacity-50"
                      style={{
                        borderColor: "rgba(34,197,94,0.3)",
                        color: "var(--color-success)",
                      }}
                    >
                      פתיחה
                    </button>
                  )}
                  {up.access_status === "ACTIVE" && (
                    <button
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
                      className="text-xs px-3 py-1.5 rounded-full border disabled:opacity-50"
                      style={{
                        borderColor: "rgba(245,158,11,0.3)",
                        color: "#F59E0B",
                      }}
                    >
                      חסימה
                    </button>
                  )}
                  <button
                    onClick={() =>
                      void run(
                        up.user_product_id,
                        () =>
                          extendAccess(
                            up.user_product_id,
                            extendedExpiry(up.expires_at),
                          ),
                        { successMessage: "התוקף הוארך ב־30 ימים" },
                      )
                    }
                    disabled={busyId !== null}
                    className="text-xs px-3 py-1.5 rounded-full border disabled:opacity-50"
                    style={{
                      borderColor: "var(--color-border)",
                      color: "var(--color-foreground)",
                    }}
                  >
                    הארכה ב־30 ימים
                  </button>
                  <button
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
                    className="text-xs px-3 py-1.5 rounded-full border disabled:opacity-50"
                    style={{
                      borderColor: "rgba(239,68,68,0.3)",
                      color: "var(--color-danger)",
                    }}
                  >
                    שלילה
                  </button>
                  <button
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
                    className="text-xs px-3 py-1.5 rounded-full border disabled:opacity-50"
                    style={{
                      borderColor: "rgba(239,68,68,0.3)",
                      color: "var(--color-danger)",
                    }}
                  >
                    {busyId === up.user_product_id ? "מבצע…" : "הסרה מלאה"}
                  </button>
                  {busyId === up.user_product_id && (
                    <span
                      className="w-3.5 h-3.5 rounded-full border-2 animate-spin"
                      style={{
                        borderColor: "var(--color-border)",
                        borderTopColor: "var(--color-primary)",
                      }}
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
    </div>
  )
}
