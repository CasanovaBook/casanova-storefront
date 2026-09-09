import { useState } from "react"

import { useAdmin } from "../../context/AdminContext"

import { can, ROLE_LABEL } from "../../lib/permissions"

import type { AuditCategory } from "../../types"

import type { AdminRole } from "../../types"

import AccessDenied from "../../components/AccessDenied"

import Icon, { type IconName } from "../../components/icons"

const CATEGORY_LABEL: Record<AuditCategory, string> = {
  PRICE_CHANGE: "שינוי מחיר",

  REFUND: "החזר כספי",

  ACCESS_CHANGE: "שינוי הרשאות",

  USER_BLOCK: "חסימת משתמש",

  CONTENT_SWAP: "החלפת תוכן",

  PRODUCT_CREATE: "יצירת מוצר",

  PRODUCT_UPDATE: "עדכון מוצר",

  PRODUCT_DELETE: "מחיקת מוצר",

  ORDER_CHANGE: "שינוי הזמנה",

  ROLE_CHANGE: "שינוי תפקיד",

  EMAIL_RESEND: "שליחת מייל",

  COUPON_CHANGE: "שינוי קופון",

  INQUIRY: "פניית לקוח",

  SETTINGS: "הגדרות מערכת",

  SECURITY: "הגנת תוכן ואבטחה",

  AUTH: "התחברות ואיפוס סיסמה",

  OTHER: "אחר",
}

const CATEGORY_ICON: Record<AuditCategory, IconName> = {
  PRICE_CHANGE: "money",

  REFUND: "card",

  ACCESS_CHANGE: "key",

  USER_BLOCK: "lock",

  CONTENT_SWAP: "upload",

  PRODUCT_CREATE: "box",

  PRODUCT_UPDATE: "pen",

  PRODUCT_DELETE: "x",

  ORDER_CHANGE: "receipt",

  ROLE_CHANGE: "user",

  EMAIL_RESEND: "mail",

  COUPON_CHANGE: "tag",

  INQUIRY: "message",

  SETTINGS: "settings",

  SECURITY: "shield",

  AUTH: "lock",

  OTHER: "list",
}

export default function AdminAuditPage() {
  const { auditLog, adminRole } = useAdmin()

  const [categoryFilter, setCategoryFilter] = useState("ALL")

  const [search, setSearch] = useState("")

  if (!can(adminRole, "audit")) return <AccessDenied page="יומן פעולות" />

  const filtered = auditLog.filter((a) => {
    const matchCategory =
      categoryFilter === "ALL" || a.category === categoryFilter

    const matchSearch =
      `${a.actor_name} ${a.action} ${a.target_label} ${a.details}`

        .toLowerCase()

        .includes(search.toLowerCase())

    return matchCategory && matchSearch
  })

  const usedCategories = [
    ...new Set(auditLog.map((a) => a.category)),
  ] as AuditCategory[]

  return (
    <div className="max-w-5xl mx-auto page-enter">
      <div className="mb-8">
        <h1 className="font-display text-4xl font-semibold mb-1">
          יומן פעולות (Audit Log)
        </h1>
        <p style={{ color: "var(--color-muted-foreground)" }}>
          תיעוד מלא ובלתי הפיך של כל פעולה משמעותית שביצע מנהל — שינוי מחיר,
          החזר, הרשאות, חסימות והחלפות תוכן.
        </p>
      </div>

      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <input
          className="flex-1 min-w-48 px-4 py-2.5 rounded-lg border text-sm outline-none"
          style={{
            background: "var(--color-secondary)",
            borderColor: "var(--color-border)",
            color: "var(--color-foreground)",
          }}
          placeholder="חיפוש לפי מבצע, פעולה או יעד..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="flex gap-2 flex-wrap">
          {[...new Set(["ALL", ...usedCategories])].map((c) => (
            <button
              key={c}
              onClick={() => setCategoryFilter(c)}
              className="px-3 py-2 rounded-full text-xs font-medium border transition-all"
              style={{
                background:
                  categoryFilter === c ? "var(--color-primary)" : "transparent",

                color:
                  categoryFilter === c
                    ? "var(--color-primary-foreground)"
                    : "var(--color-muted-foreground)",

                borderColor:
                  categoryFilter === c
                    ? "var(--color-primary)"
                    : "var(--color-border)",
              }}
            >
              {c === "ALL" ? "הכול" : CATEGORY_LABEL[(c as AuditCategory)]}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="card-glow p-12 text-center">
          <span
            className="w-12 h-12 rounded-full inline-flex items-center justify-center mb-3"
            style={{
              background: "rgba(227,174,60,0.12)",
              color: "var(--color-primary)",
            }}
          >
            <Icon name="list" size={22} />
          </span>
          <p className="font-semibold">אין רישומים עדיין</p>
          <p
            className="text-sm mt-1"
            style={{ color: "var(--color-muted-foreground)" }}
          >
            כל פעולת ניהול משמעותית תתועד כאן באופן אוטומטי.
          </p>
        </div>
      ) : (
        <div
          className="rounded-lg border overflow-hidden"
          style={{ borderColor: "var(--color-border)" }}
        >
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: "var(--color-secondary)" }}>
                {["זמן", "מבצע/ת", "קטגוריה", "פעולה", "יעד", "פרטים"].map(
                  (col) => (
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
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {filtered.map((entry, i) => (
                <tr
                  key={entry.audit_id}
                  style={{
                    background:
                      i % 2 === 0
                        ? "var(--color-card)"
                        : "var(--color-background)",

                    borderBottom: "1px solid var(--color-border)",
                  }}
                >
                  <td
                    className="px-5 py-3 text-xs whitespace-nowrap"
                    style={{ color: "var(--color-muted-foreground)" }}
                  >
                    {new Date(entry.created_at).toLocaleString("he-IL", {
                      day: "numeric",

                      month: "short",

                      hour: "2-digit",

                      minute: "2-digit",
                    })}
                  </td>
                  <td className="px-5 py-3">
                    <p className="text-xs font-medium">{entry.actor_name}</p>
                    <p
                      className="text-[10px]"
                      style={{ color: "var(--color-muted-foreground)" }}
                    >
                      {ROLE_LABEL[(entry.actor_role as AdminRole)] ??
                        entry.actor_role}
                    </p>
                  </td>
                  <td className="px-5 py-3">
                    <span
                      className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full"
                      style={{
                        background: "rgba(227,174,60,0.1)",
                        color: "var(--color-primary)",
                      }}
                    >
                      <Icon name={CATEGORY_ICON[entry.category]} size={11} />
                      {CATEGORY_LABEL[entry.category]}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-xs font-medium">
                    {entry.action}
                  </td>
                  <td className="px-5 py-3 text-xs">{entry.target_label}</td>
                  <td
                    className="px-5 py-3 text-xs max-w-56"
                    style={{ color: "var(--color-muted-foreground)" }}
                  >
                    {entry.details}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
