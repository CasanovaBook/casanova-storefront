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
  replyToInquiry,
  customerReplyAllowed,
  CUSTOMER_REPLY_LIMIT_MESSAGE,
  INQUIRY_STATUS_LABEL,
  INQUIRY_TOPIC_LABEL,
} from "../lib/api-support"

import { useContent } from "../content/useContent"
import { Rich } from "../content/render"

import { useStore } from "../lib/store"

import { formatIsraelDateTime } from "../lib/datetime"

import type { Inquiry, InquiryNote, InquiryTopic } from "../types"

import Icon from "../components/icons"

import Modal from "../components/Modal"

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

/* ── Conversation ────────────────────────────────────── */

function whenLabel(iso: string): string {
  return new Date(iso).toLocaleString("he-IL", {
    day: "numeric",

    month: "short",

    hour: "2-digit",

    minute: "2-digit",
  })
}

/**
 * One message of the thread.
 *
 * The customer's own messages sit on the right (the reading side in RTL)
 * with the gold accent, support's on the left in the neutral surface — so
 * the direction of the conversation is readable at a glance, and each
 * message carries its author and timestamp.
 */
function MessageBubble({
  mine,

  author,

  content,

  timestamp,
}: {
  mine: boolean

  author: string

  content: string

  timestamp: string
}) {
  return (
    <div className={`flex ${mine ? "justify-start" : "justify-end"}`}>
      <div
        className="max-w-[85%] p-3 rounded-lg border"
        style={
          mine
            ? {
                background: "rgba(212,160,48,0.07)",

                borderColor: "rgba(212,160,48,0.28)",
              }
            : {
                background: "var(--color-secondary)",

                borderColor: "var(--color-border)",
              }
        }
      >
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <span
            className="text-xs font-semibold"
            style={{
              color: mine
                ? "var(--color-primary)"
                : "var(--color-foreground)",
            }}
          >
            {author}
          </span>
          <span
            className="text-[11px]"
            style={{ color: "var(--color-muted-foreground)" }}
          >
            {whenLabel(timestamp)}
          </span>
        </div>
        <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">
          {content}
        </p>
      </div>
    </div>
  )
}

/**
 * The customer's side of one ticket: everything they wrote, every reply the
 * support team sent, and a box to answer back.
 *
 * Rendered through the shared Modal, so it is portalled to the body (the
 * page root carries `page-enter`) and its overlay scrolls from the top — a
 * long conversation stays fully readable and the composer stays reachable
 * on any window height.
 */
function ConversationModal({
  inquiry,

  notes,

  onClose,
}: {
  inquiry: Inquiry

  notes: InquiryNote[]

  onClose: () => void
}) {
  const { user, actor } = useApp()

  const [draft, setDraft] = useState("")

  const [error, setError] = useState("")

  const [sending, setSending] = useState(false)

  /* Only the customer-visible half of the conversation belongs here. The
   * read path already excludes internal annotations and RLS forbids them
   * outright; this filter is the third, purely local guard so a private
   * staff note can never be rendered in the customer panel. */
  const thread = notes
    .filter((n) => n.inquiry_id === inquiry.inquiry_id && !n.internal)
    .sort((a, b) => a.created_at.localeCompare(b.created_at))

  const closed = inquiry.status === "RESOLVED" || inquiry.status === "CLOSED"

  /* The stored resolution moment — the database's, not the visitor's clock —
   * pinned to Israel time like every other timestamp in the product. An
   * unresolved (or reopened) ticket has no value here, so nothing is shown. */
  const resolvedLabel = formatIsraelDateTime(inquiry.resolved_at)

  /* Read from the conversation in the store, so it flips back the moment a
   * staff reply is mirrored in — including the realtime one. The database
   * enforces the same limit; this only lets the composer explain itself. */
  const canReply = customerReplyAllowed(inquiry, user?.user_id)

  const submit = async () => {
    if (!canReply || !draft.trim() || sending) return

    setSending(true)

    setError("")

    const result = await replyToInquiry(actor, inquiry.inquiry_id, draft)

    setSending(false)

    if (!result.ok) {
      setError(result.error)

      return
    }

    setDraft("")
  }

  return (
    <Modal
      size="2xl"
      title={inquiry.subject}
      titleClassName="truncate"
      ariaLabel={`שיחה בפנייה ${inquiry.ticket_number}`}
      onClose={onClose}
      subtitle={
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          <span
            dir="ltr"
            className="font-mono text-xs"
            style={{ color: "var(--color-muted-foreground)" }}
          >
            {inquiry.ticket_number}
          </span>
          <StatusPill inquiry={inquiry} />
        </div>
      }
    >
      <div
        className="flex items-center gap-2 text-xs mb-4 flex-wrap"
        style={{ color: "var(--color-muted-foreground)" }}
      >
        <span>{INQUIRY_TOPIC_LABEL[inquiry.topic]}</span>
        <span>·</span>
        <span>
          נפתחה ב־
          {new Date(inquiry.created_at).toLocaleDateString("he-IL", {
            day: "numeric",

            month: "long",

            year: "numeric",
          })}
        </span>
        {resolvedLabel && (
          <>
            <span>·</span>
            <span
              className="inline-flex items-center gap-1"
              style={{ color: "var(--color-success)" }}
            >
              <Icon name="checkCircle" size={12} />
              נפתרה ב־{resolvedLabel}
            </span>
          </>
        )}
      </div>

      <div className="space-y-3 mb-5">
        <MessageBubble
          mine
          author="ההודעה ששלחת"
          content={inquiry.message}
          timestamp={inquiry.created_at}
        />
        {thread.map((note) => {
          const mine = note.author_id === user?.user_id

          return (
            <MessageBubble
              key={note.note_id}
              mine={mine}
              author={mine ? "אתה" : "צוות התמיכה"}
              content={note.content}
              timestamp={note.created_at}
            />
          )
        })}
      </div>

      {error && (
        <p
          role="alert"
          className="text-xs px-3 py-2 rounded-lg mb-3"
          style={{
            background: "rgba(239,68,68,0.1)",

            color: "var(--color-danger)",
          }}
        >
          {error}
        </p>
      )}

      {closed && (
        <p
          className="text-xs mb-3"
          style={{ color: "var(--color-muted-foreground)" }}
        >
          הפנייה סומנה כנפתרה. אפשר לכתוב כאן בכל זאת — ההודעה תתווסף לשיחה
          והצוות יראה אותה.
        </p>
      )}

      {!canReply && (
        <p
          className="text-xs px-3 py-2 rounded-lg mb-3"
          style={{
            background: "rgba(245,158,11,0.1)",

            color: "#F59E0B",
          }}
        >
          {CUSTOMER_REPLY_LIMIT_MESSAGE}
        </p>
      )}

      <div className="flex items-start gap-2 flex-wrap">
        <label htmlFor="support-reply" className="sr-only">
          כתיבת תגובה לצוות התמיכה
        </label>
        <textarea
          id="support-reply"
          className={`flex-1 min-w-56 ${inputClass} min-h-20 resize-y`}
          style={canReply ? inputStyle : { ...inputStyle, opacity: 0.55 }}
          placeholder={
            canReply
              ? "כתיבת תגובה לצוות התמיכה..."
              : "ניתן לשלוח הודעה נוספת לאחר תגובת הצוות"
          }
          value={draft}
          disabled={!canReply}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void submit()
          }}
        />
        <button
          onClick={submit}
          disabled={!canReply || sending || !draft.trim()}
          className="btn-gradient px-5 py-2.5 rounded-full text-sm font-semibold disabled:opacity-40"
        >
          {sending ? "שולח…" : "שליחת הודעה"}
        </button>
      </div>
    </Modal>
  )
}

export default function SupportPage() {
  const { user, actor, orders } = useApp()

  /* The conversation is part of the shared document, so subscribing here
   * keeps an open ticket up to date: a reply that arrives over realtime is
   * mirrored into the store and re-renders the modal and the list counts. */
  const db = useStore()

  const [openId, setOpenId] = useState<string | null>(null)

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

  /* The ticket the conversation dialog shows. Looked up from the freshly
   * mirrored list rather than held as a snapshot, so a status the admin
   * changed — or a reply that just arrived — is reflected in the open
   * dialog instead of a stale copy. */
  const opened = myInquiries.find((i) => i.inquiry_id === openId) ?? null

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
                  role="alert"
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
                    htmlFor="support-name"
                    className="block text-xs font-medium mb-1.5"
                    style={{ color: "var(--color-muted-foreground)" }}
                  >
                    שם מלא
                  </label>
                  <input
                    id="support-name"
                    className={inputClass}
                    style={identityFieldStyle}
                    value={identityName}
                    disabled={identityLocked}
                    readOnly={identityLocked}
                    aria-readonly={identityLocked}
                    aria-describedby={identityLocked ? "support-identity-note" : undefined}
                    onChange={(e) => {
                      if (identityLocked) return

                      setForm({ ...form, customer_name: e.target.value })
                    }}
                  />
                  {identityLocked && (
                    <p
                      id="support-identity-note"
                      className="text-[11px] mt-1"
                      style={{ color: "var(--color-muted-foreground)" }}
                    >
                      נקבע לפי החשבון המחובר ואינו ניתן לעריכה.
                    </p>
                  )}
                </div>
                <div>
                  <label
                    htmlFor="support-email"
                    className="block text-xs font-medium mb-1.5"
                    style={{ color: "var(--color-muted-foreground)" }}
                  >
                    אימייל
                  </label>
                  <input
                    id="support-email"
                    dir="ltr"
                    type="email"
                    className={inputClass}
                    style={identityFieldStyle}
                    value={identityEmail}
                    disabled={identityLocked}
                    readOnly={identityLocked}
                    aria-readonly={identityLocked}
                    aria-describedby={identityLocked ? "support-identity-note" : undefined}
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
                    htmlFor="support-phone"
                    className="block text-xs font-medium mb-1.5"
                    style={{ color: "var(--color-muted-foreground)" }}
                  >
                    טלפון (אופציונלי)
                  </label>
                  <input
                    id="support-phone"
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
                    htmlFor="support-topic"
                    className="block text-xs font-medium mb-1.5"
                    style={{ color: "var(--color-muted-foreground)" }}
                  >
                    נושא הפנייה
                  </label>
                  <select
                    id="support-topic"
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
                    htmlFor="support-order"
                    className="block text-xs font-medium mb-1.5"
                    style={{ color: "var(--color-muted-foreground)" }}
                  >
                    שיוך להזמנה (אופציונלי)
                  </label>
                  <select
                    id="support-order"
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
                  htmlFor="support-subject"
                  className="block text-xs font-medium mb-1.5"
                  style={{ color: "var(--color-muted-foreground)" }}
                >
                  כותרת
                </label>
                <input
                  id="support-subject"
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
                  htmlFor="support-message"
                  className="block text-xs font-medium mb-1.5"
                  style={{ color: "var(--color-muted-foreground)" }}
                >
                  פירוט הפנייה
                </label>
                <textarea
                  id="support-message"
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
                {myInquiries.map((i) => {
                  /* Counted from the store so the list re-renders when a reply
                   * is mirrored in, and so the customer can see that a ticket
                   * already holds an answer from the team. */
                  const messages = db.inquiry_notes.filter(
                    (n) => n.inquiry_id === i.inquiry_id && !n.internal,
                  )

                  const staffReply = messages.some(
                    (n) => n.author_id !== user?.user_id,
                  )

                  /* Date + time of the resolution, from the stored
                   * `resolved_at` (empty for a ticket that is not resolved,
                   * so the line simply is not rendered). */
                  const resolvedLabel = formatIsraelDateTime(i.resolved_at)

                  return (
                    <li key={i.inquiry_id}>
                      <button
                        type="button"
                        onClick={() => setOpenId(i.inquiry_id)}
                        className="w-full text-start p-3 rounded-lg border transition-colors"
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
                        <p className="text-sm font-medium mb-0.5">
                          {i.subject}
                        </p>
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
                        {resolvedLabel && (
                          <p
                            className="inline-flex items-center gap-1 text-xs mt-0.5"
                            style={{ color: "var(--color-success)" }}
                          >
                            <Icon name="checkCircle" size={11} />
                            נפתרה ב־{resolvedLabel}
                          </p>
                        )}
                        <div className="flex items-center justify-between gap-2 mt-2.5 flex-wrap">
                          <span
                            className="inline-flex items-center gap-1.5 text-xs"
                            style={{
                              color: staffReply
                                ? "var(--color-primary)"
                                : "var(--color-muted-foreground)",
                            }}
                          >
                            <Icon name="message" size={12} />
                            {staffReply
                              ? "תגובת צוות התמיכה"
                              : `${messages.length + 1} הודעות`}
                          </span>
                          <span
                            className="inline-flex items-center gap-1 text-xs font-medium"
                            style={{ color: "var(--color-primary)" }}
                          >
                            צפייה בשיחה
                            <Icon name="chevronLeft" size={12} />
                          </span>
                        </div>
                      </button>
                    </li>
                  )
                })}
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

      {opened && (
        <ConversationModal
          inquiry={opened}
          notes={db.inquiry_notes}
          onClose={() => setOpenId(null)}
        />
      )}
    </div>
  )
}
