import { useState } from "react"

import { useAdmin } from "../../context/AdminContext"

import { can, ROLE_LABEL } from "../../lib/permissions"

import type { AuditCategory } from "../../types"

import type { AdminRole } from "../../types"

import AccessDenied from "../../components/AccessDenied"

import EmptyState from "../../components/ui/EmptyState"

import PageHeader from "../../components/ui/PageHeader"

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

  const clearFilters = () => {
    setSearch("")
    setCategoryFilter("ALL")
  }

  return (
    <div className="page-enter">
      <PageHeader
        eyebrow="Audit Log"
        title="יומן פעולות"
        description="תיעוד מלא ובלתי הפיך של כל פעולה משמעותית שביצע מנהל - שינוי מחיר, החזר, הרשאות, חסימות והחלפות תוכן."
      />

      <section
        className="app-surface app-surface--flat mb-4"
        aria-label="סינון יומן הפעולות"
      >
        <div className="app-surface-body">
          <div className="app-field mb-4">
            <label className="app-label" htmlFor="audit-search">
              חיפוש
            </label>
            <div className="relative">
              <Icon
                name="search"
                size={15}
                className="app-muted pointer-events-none absolute top-1/2 -translate-y-1/2"
                style={{ insetInlineEnd: "0.9rem" }}
              />
              <input
                id="audit-search"
                className="w-full px-4"
                style={{ paddingInlineEnd: "2.5rem" }}
                placeholder="חיפוש לפי מבצע, פעולה או יעד..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>

          <div
            className="app-tabs"
            role="group"
            aria-label="סינון לפי קטגוריית פעולה"
          >
            {[...new Set(["ALL", ...usedCategories])].map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCategoryFilter(c)}
                className="app-tab"
                data-active={categoryFilter === c}
                aria-pressed={categoryFilter === c}
              >
                {c === "ALL" ? "הכול" : CATEGORY_LABEL[(c as AuditCategory)]}
              </button>
            ))}
          </div>
        </div>
      </section>

      {filtered.length === 0 ? (
        auditLog.length === 0 ? (
          <EmptyState
            icon="list"
            title="אין רישומים עדיין"
            description="כל פעולת ניהול משמעותית תתועד כאן באופן אוטומטי."
          />
        ) : (
          <EmptyState
            icon="search"
            title="לא נמצאו רישומים"
            description="לא נמצאו פעולות התואמות את הסינון."
            actions={
              <button
                type="button"
                onClick={clearFilters}
                className="app-btn-secondary"
              >
                ניקוי הסינון
              </button>
            }
          />
        )
      ) : (
        <div className="app-table-wrap">
          <table className="app-table" style={{ minWidth: "56rem" }}>
            <caption className="sr-only">
              יומן פעולות - זמן, מבצע, קטגוריה, פעולה, יעד ופרטים
            </caption>
            <thead>
              <tr>
                <th scope="col">זמן</th>
                <th scope="col">מבצע/ת</th>
                <th scope="col">קטגוריה</th>
                <th scope="col">פעולה</th>
                <th scope="col">יעד</th>
                <th scope="col">פרטים</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((entry) => (
                <tr key={entry.audit_id}>
                  <td className="text-xs app-muted whitespace-nowrap">
                    {new Date(entry.created_at).toLocaleString("he-IL", {
                      day: "numeric",

                      month: "short",

                      hour: "2-digit",

                      minute: "2-digit",
                    })}
                  </td>
                  <td style={{ overflowWrap: "anywhere" }}>
                    <p className="text-xs font-medium">{entry.actor_name}</p>
                    <p className="text-[10px] app-muted mt-0.5">
                      {ROLE_LABEL[(entry.actor_role as AdminRole)] ??
                        entry.actor_role}
                    </p>
                  </td>
                  <td>
                    <span className="app-badge app-badge--accent">
                      <Icon name={CATEGORY_ICON[entry.category]} size={11} />
                      {CATEGORY_LABEL[entry.category]}
                    </span>
                  </td>
                  <td
                    className="text-xs font-medium"
                    style={{ minWidth: "11rem", overflowWrap: "anywhere" }}
                  >
                    {entry.action}
                  </td>
                  <td
                    className="text-xs"
                    style={{ minWidth: "9rem", overflowWrap: "anywhere" }}
                  >
                    {entry.target_label}
                  </td>
                  <td
                    className="text-xs app-muted"
                    style={{
                      minWidth: "14rem",
                      maxWidth: "24rem",
                      overflowWrap: "anywhere",
                    }}
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
