/* ─────────────────────────────────────────────────────────────
 * CMS — customer inquiries.
 *
 * Every ticket submitted through the public support form lands here.
 * Admins can open it, move it through the status lifecycle, assign an
 * owner, add internal or customer-visible notes, and link it to the
 * order it concerns. The list is read from the persisted collection —
 * there is no demo ticket to fall back on.
 * ───────────────────────────────────────────────────────────── */

import { useState } from "react"

import { Link } from "react-router"

import { useAdmin } from "../../context/AdminContext"

import { can } from "../../lib/permissions"

import { formatIsraelDateTime } from "../../lib/datetime"

import {
  createInquiry,
  INQUIRY_STATUS_LABEL,
  INQUIRY_TOPIC_LABEL,
} from "../../lib/api-support"

import type {
  Inquiry,
  InquiryStatus,
  InquiryNote,
  InquiryTopic,
} from "../../types"

import AccessDenied from "../../components/AccessDenied"

import Modal from "../../components/Modal"

import Icon, { type IconName } from "../../components/icons"

const STATUS_ORDER: InquiryStatus[] = [
  "NEW",

  "OPEN",

  "IN_PROGRESS",

  "WAITING_FOR_CUSTOMER",

  "RESOLVED",

  "CLOSED",
]

const STATUS_STYLE: Record<InquiryStatus, { bg: string, color: string }> = {
  NEW: { bg: "rgba(59,130,246,0.12)", color: "#3B82F6" },

  OPEN: { bg: "rgba(245,158,11,0.12)", color: "#F59E0B" },

  IN_PROGRESS: { bg: "rgba(168,85,247,0.12)", color: "#A855F7" },

  WAITING_FOR_CUSTOMER: { bg: "rgba(56,189,248,0.12)", color: "#38BDF8" },

  RESOLVED: { bg: "rgba(34,197,94,0.12)", color: "var(--color-success)" },

  CLOSED: { bg: "rgba(107,114,128,0.14)", color: "#6B7280" },
}

const SOURCE_LABEL: Record<Inquiry["source"], string> = {
  WEBSITE: "מהאתר",

  CMS: "נרשם במערכת",

  EMAIL: "מדואר אלקטרוני",

  MOBILE_APP: "מהאפליקציה",
}

const inputStyle = {
  background: "var(--color-secondary)",

  borderColor: "var(--color-border)",

  color: "var(--color-foreground)",
} as const

const inputClass = "w-full px-4 py-2.5 rounded-lg border text-sm outline-none"

function StatusPill({ status }: { status: InquiryStatus }) {
  const s = STATUS_STYLE[status] ?? STATUS_STYLE.NEW

  return (
    <span
      className="text-xs px-2.5 py-0.5 rounded-full whitespace-nowrap"
      style={{ background: s.bg, color: s.color }}
    >
      {INQUIRY_STATUS_LABEL[status] ?? status}
    </span>
  )
}

/* ── Ticket detail ────────────────────────────────────── */

function InquiryModal({
  inquiry,
  onClose,
}: {
  inquiry: Inquiry
  onClose: () => void
}) {
  const {
    inquiryNotes,
    users,
    orders,
    adminRole,
    updateInquiry,
    linkInquiryToOrder,
    addInquiryNote,
  } = useAdmin()

  const [noteDraft, setNoteDraft] = useState("")

  const [internal, setInternal] = useState(true)

  const [error, setError] = useState("")

  const canManage = can(adminRole, "manage_support")

  const notes: InquiryNote[] = inquiryNotes

    .filter((n) => n.inquiry_id === inquiry.inquiry_id)

    .slice()

    .sort((a, b) => a.created_at.localeCompare(b.created_at))

  const relatedOrder = orders.find(
    (o) => o.order_id === inquiry.related_order_id,
  )

  // Only this customer's orders can be linked, so a ticket can never be

  // attached to somebody else's purchase.

  const linkableOrders = orders

    .filter(
      (o) =>
        o.user_id === inquiry.user_id ||
        o.customer_email.toLowerCase() === inquiry.customer_email.toLowerCase(),
    )

    .sort((a, b) => b.created_at.localeCompare(a.created_at))

  const admins = users.filter((u) => u.role === "ADMIN")

  const submitNote = async () => {
    if (!noteDraft.trim()) return

    const result = await addInquiryNote(
      inquiry.inquiry_id,
      noteDraft.trim(),
      internal,
    )

    if (!result.ok) {
      setError(result.error)

      return
    }

    setError("")

    setNoteDraft("")
  }

  const details: { label: string, value: string, ltr?: boolean }[] = [
    { label: "מספר פנייה", value: inquiry.ticket_number, ltr: true },

    { label: "שם הלקוח", value: inquiry.customer_name },

    { label: "אימייל", value: inquiry.customer_email, ltr: true },

    { label: "טלפון", value: inquiry.customer_phone ?? "—", ltr: true },

    {
      label: "נושא הפנייה",
      value: INQUIRY_TOPIC_LABEL[inquiry.topic] ?? inquiry.topic,
    },

    { label: "מקור", value: SOURCE_LABEL[inquiry.source] ?? inquiry.source },

    {
      label: "התקבלה בתאריך",

      value: new Date(inquiry.created_at).toLocaleString("he-IL", {
        day: "numeric",

        month: "short",

        year: "numeric",

        hour: "2-digit",

        minute: "2-digit",
      }),
    },

    {
      label: "עודכן לאחרונה",

      value: new Date(inquiry.updated_at).toLocaleString("he-IL", {
        day: "numeric",

        month: "short",

        hour: "2-digit",

        minute: "2-digit",
      }),
    },

    { label: "מטפל/ת", value: inquiry.assigned_to_name ?? "לא שויך" },

    {
      /* Date AND time: `resolved_at` is a full timestamptz stamped by the
       * database on the resolution transition (migration 0020), formatted
       * with the shared Israel-pinned helper so the admin panel and the
       * customer's ticket show the same moment. */
      label: "נפתרה בתאריך",

      value: formatIsraelDateTime(inquiry.resolved_at) || "—",
    },
  ]

  return (
    <Modal
      size="3xl"
      title={inquiry.subject}
      titleClassName="truncate"
      ariaLabel={inquiry.subject}
      onClose={onClose}
      subtitle={
        <div className="flex items-center gap-2 mt-1">
          <span
            dir="ltr"
            className="font-mono text-xs"
            style={{ color: "var(--color-muted-foreground)" }}
          >
            {inquiry.inquiry_id}
          </span>
          <StatusPill status={inquiry.status} />
        </div>
      }
    >

        {error && (
          <p
            className="text-xs px-3 py-2 rounded-lg mb-4"
            style={{
              background: "rgba(239,68,68,0.1)",
              color: "var(--color-danger)",
            }}
          >
            {error}
          </p>
        )}

        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-5">
          {details.map(({ label, value, ltr }) => (
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
              <p
                className="text-sm font-medium truncate"
                dir={ltr ? "ltr" : undefined}
              >
                {value}
              </p>
            </div>
          ))}
        </div>

        <div className="mb-5">
          <p
            className="text-xs font-semibold mb-2"
            style={{ color: "var(--color-muted-foreground)" }}
          >
            ההודעה
          </p>
          {/* The ticket's opening message is the customer's first message, so
              it carries the same sender label and tint as every later one. */}
          <div
            className="p-4 rounded-lg border"
            style={{
              background: "rgba(212,160,48,0.07)",

              borderColor: "rgba(212,160,48,0.28)",
            }}
          >
            <div className="flex items-center gap-2 mb-1.5 flex-wrap">
              <span
                className="inline-flex items-center gap-1 text-xs font-semibold"
                style={{ color: "var(--color-primary)" }}
              >
                <Icon name="user" size={11} />
                לקוח
              </span>
              <span
                className="text-[11px]"
                style={{ color: "var(--color-muted-foreground)" }}
              >
                {inquiry.customer_name}
              </span>
            </div>
            <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">
              {inquiry.message}
            </p>
          </div>
        </div>

        {canManage && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-5">
            <div>
              <label
                className="block text-xs font-medium mb-1.5"
                style={{ color: "var(--color-muted-foreground)" }}
              >
                סטטוס
              </label>
              <select
                className={inputClass}
                style={inputStyle}
                value={inquiry.status}
                onChange={async (e) => {
                  const result = await updateInquiry(inquiry.inquiry_id, {
                    status: e.target.value as InquiryStatus,
                  })

                  setError(result.ok ? "" : result.error)
                }}
              >
                {STATUS_ORDER.map((s) => (
                  <option key={s} value={s}>
                    {INQUIRY_STATUS_LABEL[s]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label
                className="block text-xs font-medium mb-1.5"
                style={{ color: "var(--color-muted-foreground)" }}
              >
                שיוך לנציג
              </label>
              <select
                className={inputClass}
                style={inputStyle}
                value={inquiry.assigned_to ?? ""}
                onChange={async (e) => {
                  const result = await updateInquiry(inquiry.inquiry_id, {
                    assigned_to: e.target.value || undefined,
                  })

                  setError(result.ok ? "" : result.error)
                }}
              >
                <option value="">לא שויך</option>
                {admins.map((a) => (
                  <option key={a.user_id} value={a.user_id}>
                    {a.first_name} {a.last_name}
                  </option>
                ))}
              </select>
            </div>
            <div className="md:col-span-2">
              <label
                className="block text-xs font-medium mb-1.5"
                style={{ color: "var(--color-muted-foreground)" }}
              >
                שיוך להזמנה
              </label>
              {linkableOrders.length === 0 ? (
                <p
                  className="text-xs"
                  style={{ color: "var(--color-muted-foreground)" }}
                >
                  ללקוח זה אין הזמנות במערכת.
                </p>
              ) : (
                <select
                  className={inputClass}
                  style={inputStyle}
                  value={inquiry.related_order_id ?? ""}
                  onChange={async (e) => {
                    const result = await linkInquiryToOrder(
                      inquiry.inquiry_id,
                      e.target.value || null,
                    )

                    setError(result.ok ? "" : result.error)
                  }}
                >
                  <option value="">ללא שיוך</option>
                  {linkableOrders.map((o) => (
                    <option key={o.order_id} value={o.order_id}>
                      {o.order_number} ·{" "}
                      {new Date(o.created_at).toLocaleDateString("he-IL")} ·{" "}
                      {o.payment_status === "PAID" ? "שולם" : o.payment_status}
                    </option>
                  ))}
                </select>
              )}
              {relatedOrder && (
                <Link
                  to="/admin/orders"
                  className="inline-flex items-center gap-1.5 text-xs mt-2"
                  style={{ color: "var(--color-primary)" }}
                >
                  <Icon name="receipt" size={12} />
                  מעבר לניהול ההזמנה {relatedOrder.order_number}
                </Link>
              )}
            </div>
          </div>
        )}

        <div>
          <p
            className="text-xs font-semibold mb-3"
            style={{ color: "var(--color-muted-foreground)" }}
          >
            הערות ({notes.length})
          </p>
          {notes.length === 0 ? (
            <p
              className="text-sm mb-3"
              style={{ color: "var(--color-muted-foreground)" }}
            >
              אין הערות עדיין.
            </p>
          ) : (
            <div className="space-y-2 mb-4">
              {notes.map((n) => {
                /* Who wrote a message is backend data — `author_id`, which the
                 * database stamps from the JWT — compared with the ticket's
                 * own `user_id`. Nothing here is inferred from content, and a
                 * ticket with no owner (the public form while signed out, or a
                 * ticket logged from a phone call) can only ever be written to
                 * by staff, so every note there is the team's. */
                const fromCustomer =
                  inquiry.user_id !== undefined &&
                  n.author_id === inquiry.user_id

                return (
                  <div
                    key={n.note_id}
                    className={`flex ${
                      fromCustomer ? "justify-start" : "justify-end"
                    }`}
                  >
                    <div
                      className="max-w-[85%] min-w-0 p-3 rounded-lg border"
                      style={{
                        borderColor: n.internal
                          ? "rgba(245,158,11,0.3)"
                          : fromCustomer
                            ? "rgba(212,160,48,0.28)"
                            : "var(--color-border)",

                        background: n.internal
                          ? "rgba(245,158,11,0.05)"
                          : fromCustomer
                            ? "rgba(212,160,48,0.07)"
                            : "var(--color-secondary)",
                      }}
                    >
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span
                          className="inline-flex items-center gap-1 text-xs font-semibold"
                          style={{
                            color: fromCustomer
                              ? "var(--color-primary)"
                              : "var(--color-foreground)",
                          }}
                        >
                          <Icon
                            name={fromCustomer ? "user" : "shield"}
                            size={11}
                          />
                          {fromCustomer ? "לקוח" : "צוות התמיכה"}
                        </span>
                        {n.author_name && (
                          <span
                            className="text-[11px]"
                            style={{ color: "var(--color-muted-foreground)" }}
                          >
                            {n.author_name}
                          </span>
                        )}
                        {n.internal && (
                          <span
                            className="text-[10px] px-1.5 py-0.5 rounded-full"
                            style={{
                              background: "rgba(245,158,11,0.15)",

                              color: "#F59E0B",
                            }}
                          >
                            פנימי
                          </span>
                        )}
                        <span
                          className="text-xs mr-auto"
                          style={{ color: "var(--color-muted-foreground)" }}
                        >
                          {new Date(n.created_at).toLocaleString("he-IL", {
                            day: "numeric",

                            month: "short",

                            hour: "2-digit",

                            minute: "2-digit",
                          })}
                        </span>
                      </div>
                      <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">
                        {n.content}
                      </p>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          <div className="flex gap-2 flex-wrap">
            <select
              className="px-3 py-2.5 rounded-lg border text-sm outline-none"
              style={inputStyle}
              value={internal ? "INTERNAL" : "PUBLIC"}
              onChange={(e) => setInternal(e.target.value === "INTERNAL")}
            >
              <option value="INTERNAL">הערה פנימית</option>
              <option value="PUBLIC">תגובה ללקוח</option>
            </select>
            <input
              className="flex-1 min-w-48 px-4 py-2.5 rounded-lg border text-sm outline-none"
              style={inputStyle}
              placeholder="הוסיפו הערה..."
              value={noteDraft}
              onChange={(e) => setNoteDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitNote()
              }}
            />
            <button
              className="btn-gradient px-4 py-2 rounded-full text-sm font-semibold disabled:opacity-40"
              disabled={!noteDraft.trim()}
              onClick={submitNote}
            >
              הוספה
            </button>
          </div>
        </div>
      </Modal>
  )
}

/* ── Manual ticket ────────────────────────────────────── */

function NewInquiryModal({ onClose }: { onClose: () => void }) {
  const { actor } = useAdmin()

  const [form, setForm] = useState({
    customer_name: "",

    customer_email: "",

    customer_phone: "",

    topic: "GENERAL" as InquiryTopic,

    subject: "",

    message: "",
  })

  const [error, setError] = useState("")

  const [saving, setSaving] = useState(false)

  const submit = async () => {
    setSaving(true)

    const result = await createInquiry(actor, { ...form, source: "CMS" })

    setSaving(false)

    if (!result.ok) {
      setError(result.error)

      return
    }

    onClose()
  }

  return (
    <Modal size="xl" title="רישום פנייה שהתקבלה טלפונית" onClose={onClose}>

        {error && (
          <p
            className="text-xs px-3 py-2 rounded-lg mb-4"
            style={{
              background: "rgba(239,68,68,0.1)",
              color: "var(--color-danger)",
            }}
          >
            {error}
          </p>
        )}

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <input
              className={inputClass}
              style={inputStyle}
              placeholder="שם מלא"
              value={form.customer_name}
              onChange={(e) =>
                setForm({ ...form, customer_name: e.target.value })
              }
            />
            <input
              dir="ltr"
              className={inputClass}
              style={inputStyle}
              placeholder="email@example.com"
              value={form.customer_email}
              onChange={(e) =>
                setForm({ ...form, customer_email: e.target.value })
              }
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <input
              dir="ltr"
              className={inputClass}
              style={inputStyle}
              placeholder="טלפון"
              value={form.customer_phone}
              onChange={(e) =>
                setForm({ ...form, customer_phone: e.target.value })
              }
            />
            <select
              className={inputClass}
              style={inputStyle}
              value={form.topic}
              onChange={(e) =>
                setForm({ ...form, topic: e.target.value as InquiryTopic })
              }
            >
              {(Object.keys(INQUIRY_TOPIC_LABEL) as InquiryTopic[]).map((t) => (
                <option key={t} value={t}>
                  {INQUIRY_TOPIC_LABEL[t]}
                </option>
              ))}
            </select>
          </div>
          <input
            className={inputClass}
            style={inputStyle}
            placeholder="כותרת"
            value={form.subject}
            onChange={(e) => setForm({ ...form, subject: e.target.value })}
          />
          <textarea
            className={`${inputClass} min-h-28 resize-y`}
            style={inputStyle}
            placeholder="פירוט הפנייה"
            value={form.message}
            onChange={(e) => setForm({ ...form, message: e.target.value })}
          />
          <button
            onClick={submit}
            disabled={saving}
            className="btn-gradient w-full py-2.5 rounded-full font-semibold text-sm disabled:opacity-40"
          >
            {saving ? "שומר…" : "שמירת הפנייה"}
          </button>
        </div>
      </Modal>
  )
}

/* ── Page ─────────────────────────────────────────────── */

export default function AdminSupportPage() {
  const { inquiries, inquiryNotes, adminRole } = useAdmin()

  const [selectedId, setSelectedId] = useState<string | null>(null)

  const [showNew, setShowNew] = useState(false)

  const [search, setSearch] = useState("")

  const [statusFilter, setStatusFilter] = useState<"ALL" | InquiryStatus>("ALL")

  const [topicFilter, setTopicFilter] = useState<"ALL" | InquiryTopic>("ALL")

  if (!can(adminRole, "support")) return <AccessDenied page="פניות לקוחות" />

  const query = search.trim().toLowerCase()

  const filtered = inquiries

    .filter((i) => {
      if (statusFilter !== "ALL" && i.status !== statusFilter) return false

      if (topicFilter !== "ALL" && i.topic !== topicFilter) return false

      if (!query) return true

      return `${i.ticket_number} ${i.customer_name} ${i.customer_email} ${i.customer_phone ?? ""} ${i.subject} ${i.message}`

        .toLowerCase()

        .includes(query)
    })

    .sort((a, b) => b.created_at.localeCompare(a.created_at))

  const openCount = inquiries.filter(
    (i) =>
      i.status === "NEW" ||
      i.status === "OPEN" ||
      i.status === "IN_PROGRESS" ||
      i.status === "WAITING_FOR_CUSTOMER",
  ).length

  const resolvedCount = inquiries.filter(
    (i) => i.status === "RESOLVED" || i.status === "CLOSED",
  ).length

  const selected = inquiries.find((i) => i.inquiry_id === selectedId) ?? null

  const stats: { icon: IconName, label: string, value: number }[] = [
    { icon: "inbox", label: "סך הפניות", value: inquiries.length },

    { icon: "message", label: "ממתינות לטיפול", value: openCount },

    { icon: "checkCircle", label: "נסגרו", value: resolvedCount },

    { icon: "list", label: "הערות שנרשמו", value: inquiryNotes.length },
  ]

  return (
    <div className="max-w-6xl mx-auto page-enter">
      <div className="flex items-center justify-between gap-4 mb-8 flex-wrap">
        <div>
          <h1 className="font-display text-4xl font-semibold mb-1">
            פניות לקוחות
          </h1>
          <p style={{ color: "var(--color-muted-foreground)" }}>
            כל פנייה שנשלחה מהאתר נשמרת כאן עם מספר מעקב, סטטוס, שיוך לנציג
            ויומן הערות.
          </p>
        </div>
        {can(adminRole, "manage_support") && (
          <button
            onClick={() => setShowNew(true)}
            className="btn-gradient px-5 py-2.5 rounded-full font-semibold text-sm"
          >
            + רישום פנייה
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        {stats.map(({ icon, label, value }) => (
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
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_auto] gap-2 mb-4">
        <input
          className={`${inputClass} max-w-sm`}
          style={inputStyle}
          placeholder="חיפוש לפי שם, אימייל, מספר פנייה או תוכן..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className="px-4 py-2.5 rounded-lg border text-sm outline-none"
          style={inputStyle}
          value={statusFilter}
          onChange={(e) =>
            setStatusFilter(e.target.value as "ALL" | InquiryStatus)
          }
        >
          <option value="ALL">כל הסטטוסים</option>
          {STATUS_ORDER.map((s) => (
            <option key={s} value={s}>
              {INQUIRY_STATUS_LABEL[s]}
            </option>
          ))}
        </select>
        <select
          className="px-4 py-2.5 rounded-lg border text-sm outline-none"
          style={inputStyle}
          value={topicFilter}
          onChange={(e) =>
            setTopicFilter(e.target.value as "ALL" | InquiryTopic)
          }
        >
          <option value="ALL">כל הנושאים</option>
          {(Object.keys(INQUIRY_TOPIC_LABEL) as InquiryTopic[]).map((t) => (
            <option key={t} value={t}>
              {INQUIRY_TOPIC_LABEL[t]}
            </option>
          ))}
        </select>
      </div>

      {inquiries.length === 0 ? (
        <div
          className="rounded-lg border border-dashed p-12 text-center"
          style={{ borderColor: "var(--color-border)" }}
        >
          <Icon
            name="message"
            size={28}
            style={{ color: "var(--color-muted-foreground)" }}
          />
          <p className="mt-3 font-medium">אין פניות לקוחות.</p>
          <p
            className="text-sm mt-1"
            style={{ color: "var(--color-muted-foreground)" }}
          >
            פניות שנשלחו מטופס התמיכה באתר יופיעו כאן מיד.
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <div
          className="rounded-lg border p-10 text-center"
          style={{ borderColor: "var(--color-border)" }}
        >
          <p
            className="text-sm"
            style={{ color: "var(--color-muted-foreground)" }}
          >
            לא נמצאו פניות תואמות.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((inquiry) => (
            <button
              key={inquiry.inquiry_id}
              onClick={() => setSelectedId(inquiry.inquiry_id)}
              className="w-full text-right card-glow p-4 flex items-center gap-4 transition-all hover:border-yellow-600/40"
              style={{ borderColor: "var(--color-border)" }}
            >
              <div
                className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
                style={{
                  background: STATUS_STYLE[inquiry.status].bg,
                  color: STATUS_STYLE[inquiry.status].color,
                }}
              >
                <Icon name="message" size={16} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-medium truncate">
                    {inquiry.subject}
                  </p>
                  <StatusPill status={inquiry.status} />
                </div>
                <p
                  className="text-xs truncate mt-0.5"
                  style={{ color: "var(--color-muted-foreground)" }}
                >
                  {inquiry.customer_name} · {INQUIRY_TOPIC_LABEL[inquiry.topic]}{" "}
                  ·{" "}
                  {new Date(inquiry.created_at).toLocaleDateString("he-IL", {
                    day: "numeric",
                    month: "short",
                  })}
                  {inquiry.assigned_to_name
                    ? ` · מטפל: ${inquiry.assigned_to_name}`
                    : ""}
                  {inquiry.related_order_id ? " · משויכת להזמנה" : ""}
                </p>
              </div>
              <span className="flex items-center gap-3 flex-shrink-0">
                <span
                  dir="ltr"
                  className="font-mono text-xs"
                  style={{ color: "var(--color-muted-foreground)" }}
                >
                  {inquiry.ticket_number}
                </span>
                <span
                  className="text-xs"
                  style={{ color: "var(--color-muted-foreground)" }}
                >
                  {
                    inquiryNotes.filter(
                      (n) => n.inquiry_id === inquiry.inquiry_id,
                    ).length
                  }
                </span>
              </span>
            </button>
          ))}
        </div>
      )}

      {selected && (
        <InquiryModal inquiry={selected} onClose={() => setSelectedId(null)} />
      )}
      {showNew && <NewInquiryModal onClose={() => setShowNew(false)} />}
    </div>
  )
}
