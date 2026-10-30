/* ─────────────────────────────────────────────────────────────
 * Public support / contact page.
 *
 * A visitor does not need an account. Against Supabase the ticket goes to
 * the shared queue through `create_my_inquiry` (signed in) or the
 * `support-inquiry` Edge Function (guest, with Turnstile and rate limits),
 * and the numbered confirmation is emailed. Email replies map back into the
 * same thread through `support-inbound`, and an account registered later
 * with the same address claims the history. The local document remains the
 * offline driver's fallback.
 * ───────────────────────────────────────────────────────────── */

import { useState } from "react"

import { Link, useLocation } from "react-router"

import { useApp } from "../context/AppContext"

import {
  createInquiry,
  listMyInquiries,
  replyToInquiry,
  customerReplyAllowed,
  isCustomerInquiryNote,
  CUSTOMER_REPLY_LIMIT_MESSAGE,
  INQUIRY_STATUS_LABEL,
  INQUIRY_TOPIC_LABEL,
} from "../lib/api-support"

import { isSupabaseConfigured } from "../integrations/supabase/supabase"

import TurnstileWidget from "../components/TurnstileWidget"

import { useContent } from "../content/useContent"
import { Rich } from "../content/render"

import { useStore } from "../data/store"

import { formatIsraelDateTime } from "../lib/datetime"

import type { Inquiry, InquiryNote, InquiryTopic } from "../types"

import Icon from "../components/icons"

import Modal from "../components/Modal"
import PageHeader from "../components/ui/PageHeader"
import EmptyState from "../components/ui/EmptyState"
import Alert from "../components/ui/Alert"

const fieldClass = "w-full px-3.5 py-2.5 text-sm outline-none"

const fieldStyle = {
  background: "var(--color-card)",
  borderColor: "var(--color-border)",
  color: "var(--color-foreground)",
} as const

const readOnlyFieldStyle = {
  ...fieldStyle,
  background: "var(--color-muted)",
  color: "var(--color-muted-foreground)",
} as const

const requiredMark = (
  <span aria-hidden="true" style={{ color: "var(--color-danger)" }}>
    {" *"}
  </span>
)

function StatusPill({ inquiry }: { inquiry: Inquiry }) {
  const closed = inquiry.status === "RESOLVED" || inquiry.status === "CLOSED"

  return (
    <span
      className={`app-badge ${closed ? "app-badge--success" : "app-badge--warning"}`}
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
 * with the gold accent, support's on the left in the neutral surface - so
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
        className="max-w-[88%] rounded-[var(--radius-md)] border p-3"
        style={
          mine
            ? {
                background: "rgba(196,122,67,0.07)",
                borderColor: "rgba(196,122,67,0.28)",
              }
            : {
                background: "var(--color-secondary)",
                borderColor: "var(--color-border)",
              }
        }
      >
        <div className="mb-1 flex flex-wrap items-center gap-2">
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
        <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
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
 * page root carries `page-enter`) and its overlay scrolls from the top - a
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

  /* The stored resolution moment - the database's, not the visitor's clock -
   * pinned to Israel time like every other timestamp in the product. An
   * unresolved (or reopened) ticket has no value here, so nothing is shown. */
  const resolvedLabel = formatIsraelDateTime(inquiry.resolved_at)

  /* Read from the conversation in the store, so it flips back the moment a
   * staff reply is mirrored in - including the realtime one. The database
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
        <div className="mt-1 flex flex-wrap items-center gap-2">
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
        className="mb-4 flex flex-wrap items-center gap-2 text-xs"
        style={{ color: "var(--color-muted-foreground)" }}
      >
        <span>{INQUIRY_TOPIC_LABEL[inquiry.topic]}</span>
        <span aria-hidden="true">·</span>
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
            <span aria-hidden="true">·</span>
            <span
              className="inline-flex items-center gap-1"
              style={{ color: "var(--color-success)" }}
            >
              <Icon name="checkCircle" size={12} aria-hidden="true" />
              נפתרה ב־{resolvedLabel}
            </span>
          </>
        )}
      </div>

      <div
        className="mb-5 space-y-3 rounded-[var(--radius-md)] border p-3 sm:p-4"
        style={{
          background: "var(--color-background)",
          borderColor: "var(--color-border)",
        }}
        role="group"
        aria-label="הודעות השיחה"
      >
        <MessageBubble
          mine
          author="ההודעה ששלחת"
          content={inquiry.message}
          timestamp={inquiry.created_at}
        />
        {thread.map((note) => {
          const mine = isCustomerInquiryNote(
            note,
            inquiry,
            user?.user_id,
            user?.email,
          )

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
        <div className="mb-3">
          <Alert tone="error" title="ההודעה לא נשלחה">
            {error}
          </Alert>
        </div>
      )}

      {closed && (
        <p className="app-hint mb-3">
          הפנייה סומנה כנפתרה. אפשר לכתוב כאן בכל זאת - ההודעה תתווסף לשיחה
          והצוות יראה אותה.
        </p>
      )}

      {!canReply && (
        <div className="mb-3" id="support-reply-limit">
          <Alert tone="warning">{CUSTOMER_REPLY_LIMIT_MESSAGE}</Alert>
        </div>
      )}

      <div
        className="border-t pt-4"
        style={{ borderColor: "var(--color-border)" }}
      >
        <label htmlFor="support-reply" className="app-label mb-2 block">
          תגובה לצוות התמיכה
        </label>
        <textarea
          id="support-reply"
          className={`${fieldClass} min-h-24 resize-y`}
          style={canReply ? fieldStyle : { ...fieldStyle, opacity: 0.55 }}
          placeholder={
            canReply
              ? "כתיבת תגובה לצוות התמיכה..."
              : "ניתן לשלוח הודעה נוספת לאחר תגובת הצוות"
          }
          value={draft}
          disabled={!canReply}
          aria-describedby={
            !canReply
              ? "support-reply-limit support-reply-hint"
              : "support-reply-hint"
          }
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void submit()
          }}
        />
        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p id="support-reply-hint" className="app-hint">
            Ctrl / Cmd + Enter לשליחה מהירה.
          </p>
          <button
            type="button"
            onClick={submit}
            disabled={!canReply || sending || !draft.trim()}
            className="app-btn w-full sm:w-auto"
          >
            {sending ? "שולח…" : "שליחת הודעה"}
          </button>
        </div>
      </div>
    </Modal>
  )
}

export default function SupportPage() {
  const { user, actor, orders, theme } = useApp()
  const location = useLocation()
  const inDashboard = location.pathname.startsWith("/dashboard")

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

  /* Guests are a first-class submission path now, so the public endpoint is
   * protected like the login form: Turnstile when the site key is present,
   * with the same widget lifecycle (token required, reset after every try). */
  const captchaSiteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY
  const guestCaptchaEnabled =
    isSupabaseConfigured && user === null && Boolean(captchaSiteKey)
  const [captchaToken, setCaptchaToken] = useState("")
  const [captchaReset, setCaptchaReset] = useState(0)

  const resetCaptcha = () => {
    setCaptchaToken("")
    setCaptchaReset((value) => value + 1)
  }

  const myInquiries = listMyInquiries(actor)

  /* The ticket the conversation dialog shows. Looked up from the freshly
   * mirrored list rather than held as a snapshot, so a status the admin
   * changed - or a reply that just arrived - is reflected in the open
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    setError("")

    if (guestCaptchaEnabled && !captchaToken) {
      setError("יש להשלים את אימות האבטחה לפני שליחת הפנייה.")
      return
    }

    setSending(true)

    const result = await createInquiry(actor, {
      customer_name: identityName,
      customer_email: identityEmail,
      customer_phone: form.customer_phone || undefined,
      subject: form.subject,
      message: form.message,
      topic: form.topic,
      related_order_id: form.related_order_id || undefined,
      captchaToken: guestCaptchaEnabled ? captchaToken : undefined,
    })

    setSending(false)

    if (guestCaptchaEnabled) resetCaptcha()

    if (!result.ok) {
      setError(result.error)
      return
    }

    setSubmitted(result.data)
    setForm({ ...form, subject: "", message: "", related_order_id: "" })
  }

  const heroTitle = c("support.hero.title") || "פנייה לשירות הלקוחות"
  const plainTitle = heroTitle.replace(/\*/g, "").replace(/[.\s]+$/u, "")

  return (
    <div
      className={
        inDashboard
          ? "page-enter"
          : "page-enter px-5 py-10 sm:px-8 md:py-14 lg:px-12"
      }
    >
      <div className="app-page app-page--content">
        <PageHeader
          eyebrow="CASANOVA · שירות לקוחות"
          title={<Rich text={heroTitle} />}
          metaTitle="תמיכה"
          description={
            c("support.hero.lede") ||
            "כל פנייה מקבלת מספר מעקב ונשמרת במערכת, כך שצוות התמיכה יכול לטפל בה ולשייך אותה להזמנה הרלוונטית."
          }
          breadcrumbs={
            inDashboard
              ? [
                  { label: "לוח אישי", to: "/dashboard" },
                  { label: plainTitle },
                ]
              : [
                  { label: "דף הבית", to: "/" },
                  { label: plainTitle },
                ]
          }
        />

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] lg:items-start lg:gap-8 xl:gap-10">
          <section className="app-surface" aria-labelledby="support-form-title">
            <div className="app-surface-head">
              <div>
                <h2 id="support-form-title" className="app-section-title">
                  פנייה לשירות הלקוחות
                </h2>
                <p className="app-hint mt-1.5">
                  אפשר לשלוח פנייה גם בלי חשבון.{" "}
                  {isSupabaseConfigured
                    ? "עדכונים ותשובות יישלחו לכתובת האימייל שמסרתם, ואפשר להשיב להן ישירות מהמייל."
                    : "מספר המעקב יוצג מיד לאחר השליחה."}
                </p>
              </div>
              {submitted && (
                <span className="app-badge app-badge--success">
                  <Icon name="check" size={11} /> נשלחה
                </span>
              )}
            </div>

            <div
              className="app-surface-body"
              style={{ padding: "clamp(1.4rem, 2.4vw, 1.9rem)" }}
            >
              {submitted ? (
                <div className="mx-auto max-w-md py-2 text-center">
                  <span
                    className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full"
                    style={{
                      background: "rgba(79,122,79,0.12)",
                      color: "var(--color-success)",
                    }}
                    aria-hidden="true"
                  >
                    <Icon name="checkCircle" size={26} />
                  </span>
                  <h3 className="mb-2 font-display text-2xl font-semibold">
                    הפנייה התקבלה
                  </h3>
                  <p className="text-sm app-muted">מספר המעקב שלך:</p>
                  <p
                    dir="ltr"
                    className="mb-3 font-mono text-lg"
                    style={{ color: "var(--color-primary)" }}
                  >
                    {submitted.ticket_number}
                  </p>
                  <div className="mb-5 space-y-2">
                    {isSupabaseConfigured ? (
                      <p className="app-hint">
                        שלחנו אישור לכתובת{" "}
                        <strong dir="ltr">{submitted.customer_email}</strong>.
                        כל תגובה של הצוות תישלח לאותה כתובת - אפשר להשיב
                        להודעה ישירות כדי להמשיך את השיחה.
                      </p>
                    ) : (
                      <p className="app-hint">
                        הפנייה נשמרה במערכת המקומית עם מספר המעקב שלמעלה.
                        במערכת הפרודקשן יישלח אישור לכתובת{" "}
                        <strong dir="ltr">{submitted.customer_email}</strong>.
                      </p>
                    )}
                    {!user && (
                      <p className="app-hint">
                        אם תתחברו עם אותה כתובת מייל, הפנייה וכל השיחה
                        יופיעו גם ב"הפניות שלי".
                      </p>
                    )}
                  </div>
                  <div className="flex flex-wrap justify-center gap-3">
                    <button
                      type="button"
                      onClick={() => setSubmitted(null)}
                      className="app-btn"
                    >
                      פנייה נוספת
                    </button>
                    <Link
                      to={user ? "/dashboard" : "/login"}
                      className="app-btn-secondary"
                    >
                      {user ? "חזרה ללוח האישי" : "התחברות למעקב"}
                    </Link>
                  </div>
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="space-y-7">
                  {error && (
                    <Alert tone="error" title="לא הצלחנו לשלוח את הפנייה">
                      {error}
                    </Alert>
                  )}

                  {!user && (
                    <Alert tone="info" title="פנייה כאורח - בלי חשבון">
                      אין צורך להירשם או להתחבר כדי לפנות.{" "}
                      {isSupabaseConfigured
                        ? "אישור עם מספר מעקב יישלח לכתובת האימייל שתמסרו, וכל תגובה של הצוות תגיע לאותה כתובת."
                        : "מספר המעקב יוצג מיד עם השליחה."}{" "}
                      אם תתחברו בהמשך עם אותה כתובת, הפנייה תופיע גם
                      ב"הפניות שלי".
                    </Alert>
                  )}

                  <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2">
                    <div className="app-field content-start">
                      <label htmlFor="support-name" className="app-label">
                        שם מלא{requiredMark}
                      </label>
                      <input
                        id="support-name"
                        className={fieldClass}
                        style={
                          identityLocked ? readOnlyFieldStyle : fieldStyle
                        }
                        value={identityName}
                        readOnly={identityLocked}
                        aria-required="true"
                        aria-describedby={
                          identityLocked ? "support-identity-note" : undefined
                        }
                        onChange={(e) => {
                          if (identityLocked) return
                          setForm({ ...form, customer_name: e.target.value })
                        }}
                      />
                      {identityLocked && (
                        <p id="support-identity-note" className="app-hint">
                          נקבע לפי החשבון המחובר ואינו ניתן לעריכה.
                        </p>
                      )}
                    </div>

                    <div className="app-field content-start">
                      <label htmlFor="support-email" className="app-label">
                        כתובת אימייל{requiredMark}
                      </label>
                      <input
                        id="support-email"
                        dir="ltr"
                        type="email"
                        className={`${fieldClass} text-start`}
                        style={
                          identityLocked ? readOnlyFieldStyle : fieldStyle
                        }
                        value={identityEmail}
                        readOnly={identityLocked}
                        aria-required="true"
                        aria-describedby={
                          identityLocked ? "support-identity-note" : undefined
                        }
                        onChange={(e) => {
                          if (identityLocked) return
                          setForm({ ...form, customer_email: e.target.value })
                        }}
                      />
                      {!user && (
                        <p className="app-hint">
                          {isSupabaseConfigured
                            ? "לכתובת זו יישלח אישור עם מספר המעקב. ודאו שהיא מדויקת - דרכה תקבלו גם את תגובות הצוות."
                            : "ודאו שכתובת המייל מדויקת - היא תשמש לזיהוי הפנייה."}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2">
                    <div className="app-field content-start">
                      <label htmlFor="support-phone" className="app-label">
                        טלפון (אופציונלי)
                      </label>
                      <input
                        id="support-phone"
                        dir="ltr"
                        type="tel"
                        className={`${fieldClass} text-start`}
                        style={fieldStyle}
                        value={form.customer_phone}
                        onChange={(e) =>
                          setForm({ ...form, customer_phone: e.target.value })
                        }
                      />
                    </div>

                    <div className="app-field content-start">
                      <label htmlFor="support-topic" className="app-label">
                        נושא הפנייה
                      </label>
                      <select
                        id="support-topic"
                        className={fieldClass}
                        style={fieldStyle}
                        value={form.topic}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            topic: e.target.value as InquiryTopic,
                          })
                        }
                      >
                        {(Object.keys(INQUIRY_TOPIC_LABEL) as InquiryTopic[]).map(
                          (topic) => (
                            <option key={topic} value={topic}>
                              {INQUIRY_TOPIC_LABEL[topic]}
                            </option>
                          ),
                        )}
                      </select>
                    </div>
                  </div>

                  {orders.length > 0 && (
                    <div className="app-field content-start">
                      <label htmlFor="support-order" className="app-label">
                        שיוך להזמנה (אופציונלי)
                      </label>
                      <select
                        id="support-order"
                        className={fieldClass}
                        style={fieldStyle}
                        value={form.related_order_id}
                        onChange={(e) =>
                          setForm({ ...form, related_order_id: e.target.value })
                        }
                      >
                        <option value="">ללא שיוך</option>
                        {orders.map((order) => (
                          <option key={order.order_id} value={order.order_id}>
                            {order.order_number} ·{" "}
                            {new Date(order.created_at).toLocaleDateString(
                              "he-IL",
                            )}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  <div className="app-field content-start">
                    <label htmlFor="support-subject" className="app-label">
                      כותרת הפנייה{requiredMark}
                    </label>
                    <input
                      id="support-subject"
                      className={fieldClass}
                      style={fieldStyle}
                      value={form.subject}
                      aria-required="true"
                      placeholder="נושא קצר לפנייה"
                      onChange={(e) =>
                        setForm({ ...form, subject: e.target.value })
                      }
                    />
                  </div>

                  <div className="app-field content-start">
                    <label htmlFor="support-message" className="app-label">
                      פירוט הפנייה{requiredMark}
                    </label>
                    <textarea
                      id="support-message"
                      className={`${fieldClass} resize-y`}
                      style={{ ...fieldStyle, minHeight: "9.5rem" }}
                      value={form.message}
                      aria-required="true"
                      aria-describedby="support-message-hint"
                      onChange={(e) =>
                        setForm({ ...form, message: e.target.value })
                      }
                    />
                    <p id="support-message-hint" className="app-hint">
                      לפחות 10 תווים - ככל שתפרטו יותר, נוכל לעזור מהר יותר.
                    </p>
                  </div>

                  <div
                    className="space-y-4 border-t pt-5"
                    style={{ borderColor: "var(--color-border)" }}
                  >
                    <p className="app-hint">
                      {requiredMark} שדות חובה
                    </p>

                    {guestCaptchaEnabled && (
                      <div
                        className="flex flex-col items-center gap-3 rounded-[var(--radius-lg)] border px-5 py-5 text-center sm:px-6"
                        style={{
                          borderColor:
                            "color-mix(in srgb, var(--color-primary) 24%, var(--color-border))",
                          background:
                            "color-mix(in srgb, var(--color-card) 90%, var(--color-background))",
                        }}
                      >
                        <div className="flex items-center gap-2">
                          <Icon
                            name="shield"
                            size={15}
                            aria-hidden="true"
                            style={{ color: "var(--color-primary)" }}
                          />
                          <span
                            className="text-xs font-semibold tracking-wide"
                            style={{ color: "var(--color-foreground)" }}
                          >
                            אימות אבטחה
                          </span>
                        </div>
                        <p className="app-hint max-w-sm">
                          אימות קצר כדי שנוכל לשלוח את הפנייה. אין צורך
                          בחשבון.
                        </p>
                        <div className="flex w-full justify-center pt-0.5">
                          <TurnstileWidget
                            siteKey={captchaSiteKey}
                            theme={theme}
                            onToken={(token) => setCaptchaToken(token)}
                            onExpire={() => setCaptchaToken("")}
                            onError={() => {
                              setCaptchaToken("")
                              setError(
                                "אימות האבטחה אינו זמין כרגע. אנא נסו שוב בעוד רגע.",
                              )
                            }}
                            resetSignal={captchaReset}
                          />
                        </div>
                      </div>
                    )}

                    <button
                      type="submit"
                      disabled={
                        sending || (guestCaptchaEnabled && !captchaToken)
                      }
                      className="app-btn w-full py-3.5 text-sm font-semibold"
                    >
                      {sending ? "שולח…" : "שליחת הפנייה"}
                    </button>
                  </div>
                </form>
              )}
            </div>
          </section>

          <aside className="space-y-6">
            <section className="app-surface" aria-labelledby="support-history-title">
              <div className="app-surface-head">
                <h2 id="support-history-title" className="app-section-title">
                  הפניות שלי
                </h2>
                {user && myInquiries.length > 0 && (
                  <span className="app-badge app-badge--neutral">
                    {myInquiries.length}
                  </span>
                )}
              </div>
              <div className="app-surface-body">
                {!user ? (
                  <div
                    className="rounded-[var(--radius-md)] border border-dashed p-4"
                    style={{ borderColor: "var(--color-border)" }}
                  >
                    <p className="text-sm font-medium">
                      ההיסטוריה זמינה אחרי התחברות
                    </p>
                    <p className="app-hint mt-1">
                      התחברו כדי לראות את הפניות הקודמות שלכם ואת מספרי
                      המעקב.
                    </p>
                    <Link to="/login" className="app-btn-secondary mt-3">
                      התחברות
                    </Link>
                  </div>
                ) : myInquiries.length === 0 ? (
                  <EmptyState
                    icon="inbox"
                    title="אין עדיין פניות"
                    description="פנייה חדשה שתשלחו תופיע כאן עם מספר מעקב וסטטוס."
                  />
                ) : (
                  <ul className="space-y-3">
                    {myInquiries.map((inquiry) => {
                      /* Counted from the store so the list re-renders when a
                       * reply is mirrored in, and so the customer can see that
                       * a ticket already holds an answer from the team. */
                      const messages = db.inquiry_notes.filter(
                        (n) =>
                          n.inquiry_id === inquiry.inquiry_id && !n.internal,
                      )

                      const staffReply = messages.some(
                        (n) =>
                          !isCustomerInquiryNote(
                            n,
                            inquiry,
                            user?.user_id,
                            user?.email,
                          ),
                      )

                      /* Date + time of the resolution, from the stored
                       * `resolved_at` (empty for a ticket that is not resolved,
                       * so the line simply is not rendered). */
                      const resolvedLabel = formatIsraelDateTime(
                        inquiry.resolved_at,
                      )

                      return (
                        <li key={inquiry.inquiry_id}>
                          <button
                            type="button"
                            onClick={() => setOpenId(inquiry.inquiry_id)}
                            aria-haspopup="dialog"
                            aria-label={`פתיחת שיחה לפנייה ${inquiry.ticket_number}: ${inquiry.subject}`}
                            className="w-full rounded-[var(--radius-md)] border p-3.5 text-start transition-colors hover:border-[var(--color-primary)]"
                            style={{
                              borderColor: "var(--color-border)",
                              background: "var(--color-background)",
                            }}
                          >
                            <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                              <span
                                dir="ltr"
                                className="font-mono text-xs"
                                style={{
                                  color: "var(--color-muted-foreground)",
                                }}
                              >
                                {inquiry.ticket_number}
                              </span>
                              <StatusPill inquiry={inquiry} />
                            </div>
                            <p className="text-sm font-medium">
                              {inquiry.subject}
                            </p>
                            <p className="mt-0.5 text-xs app-muted">
                              {new Date(inquiry.created_at).toLocaleDateString(
                                "he-IL",
                                {
                                  day: "numeric",
                                  month: "short",
                                  year: "numeric",
                                },
                              )}
                              {" · "}
                              {INQUIRY_TOPIC_LABEL[inquiry.topic]}
                            </p>
                            {resolvedLabel && (
                              <p
                                className="mt-0.5 inline-flex items-center gap-1 text-xs"
                                style={{ color: "var(--color-success)" }}
                              >
                                <Icon
                                  name="checkCircle"
                                  size={11}
                                  aria-hidden="true"
                                />
                                נפתרה ב־{resolvedLabel}
                              </p>
                            )}
                            <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
                              <span
                                className="inline-flex items-center gap-1.5 text-xs"
                                style={{
                                  color: staffReply
                                    ? "var(--color-primary)"
                                    : "var(--color-muted-foreground)",
                                }}
                              >
                                <Icon
                                  name="message"
                                  size={12}
                                  aria-hidden="true"
                                />
                                {staffReply
                                  ? "תגובת צוות התמיכה"
                                  : `${messages.length + 1} הודעות`}
                              </span>
                              <span
                                className="inline-flex items-center gap-1 text-xs font-medium"
                                style={{ color: "var(--color-primary)" }}
                              >
                                צפייה בשיחה
                                <Icon
                                  name="chevronLeft"
                                  size={12}
                                  aria-hidden="true"
                                />
                              </span>
                            </div>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>
            </section>

            <section className="app-surface" aria-labelledby="support-tips-title">
              <div className="app-surface-head">
                <h2 id="support-tips-title" className="app-section-title">
                  לפני שפונים
                </h2>
              </div>
              <div className="app-surface-body">
                <ul className="space-y-3 text-sm app-muted">
                  <li className="flex gap-2.5">
                    <Icon
                      name="bookOpen"
                      size={15}
                      className="mt-0.5 flex-shrink-0"
                      style={{ color: "var(--color-primary)" }}
                      aria-hidden="true"
                    />
                    קובץ הקריאה לא נפתח? ודאו שאתם מחוברים ושמופיעה לכם גישה
                    בספרייה.
                  </li>
                  <li className="flex gap-2.5">
                    <Icon
                      name="receipt"
                      size={15}
                      className="mt-0.5 flex-shrink-0"
                      style={{ color: "var(--color-primary)" }}
                      aria-hidden="true"
                    />
                    שאלות על חיוב או חשבונית - צרפו את מספר ההזמנה כדי שנוכל
                    לשייך את הפנייה.
                  </li>
                  <li className="flex gap-2.5">
                    <Icon
                      name="card"
                      size={15}
                      className="mt-0.5 flex-shrink-0"
                      style={{ color: "var(--color-primary)" }}
                      aria-hidden="true"
                    />
                    בקשות להחזר כספי מטופלות מול ההזמנה המקורית ולא דורשות פרטי
                    כרטיס.
                  </li>
                </ul>
              </div>
            </section>
          </aside>
        </div>

        {opened && (
          <ConversationModal
            inquiry={opened}
            notes={db.inquiry_notes}
            onClose={() => setOpenId(null)}
          />
        )}
      </div>
    </div>
  )
}
