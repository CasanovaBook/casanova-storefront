/* ─────────────────────────────────────────────────────────────
 * Public support / contact page.
 *
 * Submissions are written to the inquiry collection and appear in the
 * CMS immediately, with a real ticket number. Nothing is emailed to a
 * third party and nothing is faked: while no mail provider is
 * configured the acknowledgement stays queued in the CMS mail log.
 * ───────────────────────────────────────────────────────────── */

import { useState } from "react"

import { Link } from "react-router"

import { useApp } from "../context/AppContext"

import {
  createInquiry,
  listMyInquiries,
  INQUIRY_STATUS_LABEL,
  INQUIRY_TOPIC_LABEL,
} from "../lib/api-support"

import { useContent } from "../content/useContent"
import { Rich } from "../content/render"

import type { Inquiry, InquiryTopic } from "../types"

import Icon from "../components/icons"

const inputStyle = {
  background: "var(--color-secondary)",

  borderColor: "var(--color-border)",

  color: "var(--color-foreground)",
} as const

const inputClass = "w-full px-4 py-3 rounded-lg border text-sm outline-none"

function StatusPill({ inquiry }: { inquiry: Inquiry }) {
  const closed = inquiry.status === "RESOLVED" || inquiry.status === "CLOSED"

  return (
    <span
      className="text-xs px-2.5 py-0.5 rounded-full whitespace-nowrap"
      style={{
        background: closed ? "rgba(34,197,94,0.12)" : "rgba(245,158,11,0.12)",

        color: closed ? "var(--color-success)" : "#F59E0B",
      }}
    >
      {INQUIRY_STATUS_LABEL[inquiry.status]}
    </span>
  )
}

export default function SupportPage() {
  const { user, actor, orders } = useApp()
  const c = useContent()

  const [form, setForm] = useState({
    customer_name: user ? `${user.first_name} ${user.last_name}` : "",

    customer_email: user?.email ?? "",

    customer_phone: user?.phone ?? "",

    topic: "GENERAL" as InquiryTopic,

    related_order_id: "",

    subject: "",

    message: "",
  })

  const [error, setError] = useState("")

  const [submitted, setSubmitted] = useState<Inquiry | null>(null)

  const [sending, setSending] = useState(false)

  const myInquiries = listMyInquiries(actor)

  /* Identity fields are display-only for a signed-in customer: the values
   * come straight from the authenticated profile, and the service layer
   * re-derives them server-side regardless of what is submitted. */
  const identityLocked = user !== null

  const identityName = user
    ? `${user.first_name} ${user.last_name}`.trim() || user.email
    : form.customer_name

  const identityEmail = user ? user.email : form.customer_email

  const identityFieldStyle = identityLocked
    ? {
        ...inputStyle,

        opacity: 0.6,

        cursor: "not-allowed",

        color: "var(--color-muted-foreground)",
      }
    : inputStyle

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    setError("")

    setSending(true)

    const result = await createInquiry(actor, {
      customer_name: identityName,

      customer_email: identityEmail,

      customer_phone: form.customer_phone || undefined,

      subject: form.subject,

      message: form.message,

      topic: form.topic,

      related_order_id: form.related_order_id || undefined,
    })

    setSending(false)

    if (!result.ok) {
      setError(result.error)

      return
    }

    setSubmitted(result.data)

    setForm({ ...form, subject: "", message: "", related_order_id: "" })
  }

  return (
    <div className="max-w-5xl mx-auto px-6 py-16 page-enter">
      <div className="text-center mb-10">
        <h1 className="font-display text-4xl font-semibold mb-3">
          <Rich text={c("support.hero.title") || "פנייה לשירות הלקוחות"} />
        </h1>
        <p
          className="max-w-xl mx-auto"
          style={{ color: "var(--color-muted-foreground)" }}
        >
          {c("support.hero.lede") || "כל פנייה מקבלת מספר מעקב ונשמרת במערכת, כך שצוות התמיכה יכול לטפל בה ולשייך אותה להזמנה הרלוונטית."}
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-8 items-start">
        <div className="card-glow p-6">
          {submitted ? (
            <div className="text-center py-6">
              <div
                className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-4"
                style={{
                  background: "rgba(34,197,94,0.12)",
                  color: "var(--color-success)",
                }}
              >
                <Icon name="checkCircle" size={26} />
              </div>
              <h2 className="font-display text-2xl font-semibold mb-2">
                הפנייה התקבלה
              </h2>
              <p
                className="text-sm mb-1"
                style={{ color: "var(--color-muted-foreground)" }}
              >
                מספר המעקב שלך:
              </p>
              <p
                dir="ltr"
                className="font-mono text-lg mb-5"
                style={{ color: "var(--color-primary)" }}
              >
                {submitted.ticket_number}
              </p>
              <div className="flex gap-3 justify-center flex-wrap">
                <button
                  onClick={() => setSubmitted(null)}
                  className="btn-gradient px-5 py-2.5 rounded-full font-semibold text-sm"
                >
                  פנייה נוספת
                </button>
                <Link
                  to={user ? "/dashboard" : "/login"}
                  className="px-5 py-2.5 rounded-full border text-sm"
                  style={{
                    borderColor: "var(--color-border)",
                    color: "var(--color-foreground)",
                  }}
                >
                  {user ? "חזרה ללוח האישי" : "התחברות למעקב"}
                </Link>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <p
                  className="text-xs px-3 py-2.5 rounded-lg"
                  style={{
                    background: "rgba(239,68,68,0.1)",
                    color: "var(--color-danger)",
                  }}
                >
                  {error}
                </p>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label
                    className="block text-xs font-medium mb-1.5"
                    style={{ color: "var(--color-muted-foreground)" }}
                  >
                    שם מלא
                  </label>
                  <input
                    className={inputClass}
                    style={identityFieldStyle}
                    value={identityName}
                    disabled={identityLocked}
                    readOnly={identityLocked}
                    aria-readonly={identityLocked}
                    onChange={(e) => {
                      if (identityLocked) return

                      setForm({ ...form, customer_name: e.target.value })
                    }}
                  />
                  {identityLocked && (
                    <p
                      className="text-[11px] mt-1"
                      style={{ color: "var(--color-muted-foreground)" }}
                    >
                      נקבע לפי החשבון המחובר ואינו ניתן לעריכה.
                    </p>
                  )}
                </div>
                <div>
                  <label
                    className="block text-xs font-medium mb-1.5"
                    style={{ color: "var(--color-muted-foreground)" }}
                  >
                    אימייל
                  </label>
                  <input
                    dir="ltr"
                    type="email"
                    className={inputClass}
                    style={identityFieldStyle}
                    value={identityEmail}
                    disabled={identityLocked}
                    readOnly={identityLocked}
                    aria-readonly={identityLocked}
                    onChange={(e) => {
                      if (identityLocked) return

                      setForm({ ...form, customer_email: e.target.value })
                    }}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label
                    className="block text-xs font-medium mb-1.5"
                    style={{ color: "var(--color-muted-foreground)" }}
                  >
                    טלפון (אופציונלי)
                  </label>
                  <input
                    dir="ltr"
                    className={inputClass}
                    style={inputStyle}
                    value={form.customer_phone}
                    onChange={(e) =>
                      setForm({ ...form, customer_phone: e.target.value })
                    }
                  />
                </div>
                <div>
                  <label
                    className="block text-xs font-medium mb-1.5"
                    style={{ color: "var(--color-muted-foreground)" }}
                  >
                    נושא הפנייה
                  </label>
                  <select
                    className={inputClass}
                    style={inputStyle}
                    value={form.topic}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        topic: e.target.value as InquiryTopic,
                      })
                    }
                  >
                    {(Object.keys(INQUIRY_TOPIC_LABEL) as InquiryTopic[]).map(
                      (t) => (
                        <option key={t} value={t}>
                          {INQUIRY_TOPIC_LABEL[t]}
                        </option>
                      ),
                    )}
                  </select>
                </div>
              </div>

              {orders.length > 0 && (
                <div>
                  <label
                    className="block text-xs font-medium mb-1.5"
                    style={{ color: "var(--color-muted-foreground)" }}
                  >
                    שיוך להזמנה (אופציונלי)
                  </label>
                  <select
                    className={inputClass}
                    style={inputStyle}
                    value={form.related_order_id}
                    onChange={(e) =>
                      setForm({ ...form, related_order_id: e.target.value })
                    }
                  >
                    <option value="">ללא שיוך</option>
                    {orders.map((o) => (
                      <option key={o.order_id} value={o.order_id}>
                        {o.order_number} ·{" "}
                        {new Date(o.created_at).toLocaleDateString("he-IL")}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label
                  className="block text-xs font-medium mb-1.5"
                  style={{ color: "var(--color-muted-foreground)" }}
                >
                  כותרת
                </label>
                <input
                  className={inputClass}
                  style={inputStyle}
                  value={form.subject}
                  onChange={(e) =>
                    setForm({ ...form, subject: e.target.value })
                  }
                />
              </div>

              <div>
                <label
                  className="block text-xs font-medium mb-1.5"
                  style={{ color: "var(--color-muted-foreground)" }}
                >
                  פירוט הפנייה
                </label>
                <textarea
                  className={`${inputClass} min-h-32 resize-y`}
                  style={inputStyle}
                  value={form.message}
                  onChange={(e) =>
                    setForm({ ...form, message: e.target.value })
                  }
                />
              </div>

              <button
                type="submit"
                disabled={sending}
                className="btn-gradient w-full py-3 rounded-full font-semibold text-sm disabled:opacity-40"
              >
                {sending ? "שולח…" : "שליחת הפנייה"}
              </button>
            </form>
          )}
        </div>

        <div className="space-y-6">
          <div className="card-glow p-6">
            <h2 className="font-display text-lg font-semibold mb-3">
              פניות קודמות
            </h2>
            {!user ? (
              <p
                className="text-sm mb-4"
                style={{ color: "var(--color-muted-foreground)" }}
              >
                התחבר כדי לראות את היסטוריית הפניות שלך ואת מספרי המעקב.
              </p>
            ) : myInquiries.length === 0 ? (
              <p
                className="text-sm"
                style={{ color: "var(--color-muted-foreground)" }}
              >
                אין עדיין פניות בחשבון שלך.
              </p>
            ) : (
              <ul className="space-y-3">
                {myInquiries.map((i) => (
                  <li
                    key={i.inquiry_id}
                    className="p-3 rounded-lg border"
                    style={{
                      borderColor: "var(--color-border)",
                      background: "var(--color-background)",
                    }}
                  >
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span
                        dir="ltr"
                        className="font-mono text-xs"
                        style={{ color: "var(--color-muted-foreground)" }}
                      >
                        {i.ticket_number}
                      </span>
                      <StatusPill inquiry={i} />
                    </div>
                    <p className="text-sm font-medium mb-0.5">{i.subject}</p>
                    <p
                      className="text-xs"
                      style={{ color: "var(--color-muted-foreground)" }}
                    >
                      {new Date(i.created_at).toLocaleDateString("he-IL", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                      {" · "}
                      {INQUIRY_TOPIC_LABEL[i.topic]}
                    </p>
                  </li>
                ))}
              </ul>
            )}
            {!user && (
              <Link
                to="/login"
                className="inline-block mt-2 text-sm font-medium px-4 py-2 rounded-full border"
                style={{
                  borderColor: "var(--color-border)",
                  color: "var(--color-foreground)",
                }}
              >
                התחברות
              </Link>
            )}
          </div>

          <div className="card-glow p-6">
            <h2 className="font-display text-lg font-semibold mb-3">
              לפני שפונים
            </h2>
            <ul
              className="space-y-2.5 text-sm"
              style={{ color: "var(--color-muted-foreground)" }}
            >
              <li className="flex gap-2">
                <Icon
                  name="bookOpen"
                  size={15}
                  className="flex-shrink-0 mt-0.5"
                  style={{ color: "var(--color-primary)" }}
                />
                קובץ הקריאה לא נפתח? ודאו שאתם מחוברים ושמופיעה לכם גישה
                בספרייה.
              </li>
              <li className="flex gap-2">
                <Icon
                  name="receipt"
                  size={15}
                  className="flex-shrink-0 mt-0.5"
                  style={{ color: "var(--color-primary)" }}
                />
                שאלות על חיוב או חשבונית — צרפו את מספר ההזמנה כדי שנוכל לשייך
                את הפנייה.
              </li>
              <li className="flex gap-2">
                <Icon
                  name="card"
                  size={15}
                  className="flex-shrink-0 mt-0.5"
                  style={{ color: "var(--color-primary)" }}
                />
                בקשות להחזר כספי מטופלות מול ההזמנה המקורית ולא דורשות פרטי
                כרטיס.
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}
