/* support-mail - deliver support notifications from the authenticated app.
 *
 * Two actions, one sender:
 *
 *   confirmation  A signed-in customer just opened a ticket through
 *                 `create_my_inquiry`. The caller's JWT must own that ticket.
 *   reply         An admin posted a customer-visible reply (internal = FALSE).
 *                 The caller's JWT must resolve to an ADMIN in public.users.
 *
 * The guest confirmation is sent by `support-inquiry` itself; this function
 * covers the authenticated half so every ticket - guest or account - gets the
 * same numbered email. The Reply-To alias (`support+INQ-…@SUPPORT_REPLY_DOMAIN`)
 * is what `support-inbound` maps back into the thread.
 *
 * verify_jwt is false in config.toml and the JWT is verified here, matching
 * admin-password-reset: without an explicit check the "authorization" header
 * would be ignored entirely.
 *
 * Required secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY.
 * Optional: RESEND_FROM, SUPPORT_REPLY_DOMAIN.
 *
 * Delivery is best-effort: the row is already stored, so a missing key or a
 * provider refusal returns { sent: false } with 200 and the caller keeps the
 * successful action. Every attempt is recorded in email_logs.
 */

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2"

const RESEND_ENDPOINT = "https://api.resend.com/emails"
const FALLBACK_FROM = "Casanova Books <no-reply@casanova-books.com>"
const MAX_BODY_BYTES = 8_192

let cachedAdmin: SupabaseClient | null = null

function adminClient(): SupabaseClient {
  if (cachedAdmin) return cachedAdmin

  const url = Deno.env.get("SUPABASE_URL")
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")

  if (!url || !serviceRole) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.")
  }

  cachedAdmin = createClient(url, serviceRole, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  return cachedAdmin
}

function corsHeaders(req: Request): HeadersInit {
  const configured = Deno.env.get("ALLOWED_ORIGIN")
  const origin =
    configured && configured !== "*"
      ? configured
      : (req.headers.get("Origin") ?? "*")

  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  }
}

function jsonResponse(
  body: unknown,
  status: number,
  cors: HeadersInit,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  })
}

interface InquiryRow {
  inquiry_id: string
  ticket_number: string
  customer_name: string
  customer_email: string
  subject: string
  user_id: string | null
}

interface NoteRow {
  note_id: string
  inquiry_id: string
  author_id: string | null
  content: string
  internal: boolean
}

function replyAddress(ticket: string): string | undefined {
  const domain = Deno.env.get("SUPPORT_REPLY_DOMAIN")
  if (!domain) return undefined
  return `support+${ticket}@${domain.replace(/^@+/, "")}`
}

function wrapHtml(inner: string): string {
  return `<div dir="rtl" style="font-family:Heebo,Arial,sans-serif;background:#11100e;color:#f4eee4;padding:28px;border-radius:12px">${inner}</div>`
}

function ticketBlock(ticket: string): string {
  return `<p style="margin:0 0 8px;font-size:14px">מספר המעקב שלך:</p>
  <p dir="ltr" style="margin:0 0 18px;font-size:22px;font-weight:700;color:#de9a60;letter-spacing:1px">${ticket}</p>`
}

interface MailPayload {
  subject: string
  html: string
  text: string
  template: string
  idempotencyKey: string
}

function buildPayload(
  action: "confirmation" | "reply",
  inquiry: InquiryRow,
  note: NoteRow | undefined,
  canReply: boolean,
): MailPayload {
  const replyHint = canReply
    ? "אפשר להשיב להודעה זו בדיוק כדי להוסיף מידע לפנייה - התשובה תיכנס לאותה שיחה."
    : "לעדכונים נוספים אפשר לחזור לעמוד התמיכה ולציין את מספר המעקב."

  if (action === "reply" && note) {
    const content = note.content.replace(/</g, "&lt;")
    return {
      subject: `[${inquiry.ticket_number}] תגובה לפנייתך - Casanova`,
      html: wrapHtml(`<p style="margin:0 0 12px;font-size:15px">שלום ${inquiry.customer_name},</p>
        <p style="margin:0 0 10px;font-size:14px;color:#b7ac9e">צוות התמיכה השיב לפנייתך "${inquiry.subject}":</p>
        <div style="margin:0 0 18px;padding:14px;border-radius:10px;background:#191612;border:1px solid #3a332b;font-size:15px;line-height:1.7;white-space:pre-wrap">${content}</div>
        ${ticketBlock(inquiry.ticket_number)}
        <p style="margin:0;font-size:14px;line-height:1.7;color:#b7ac9e">${replyHint}</p>`),
      text: [
        `שלום ${inquiry.customer_name},`,
        "",
        `צוות התמיכה השיב לפנייתך "${inquiry.subject}":`,
        "",
        note.content,
        "",
        `מספר המעקב שלך: ${inquiry.ticket_number}`,
        replyHint,
      ].join("\n"),
      template: "INQUIRY_REPLIED",
      idempotencyKey: `support-reply-${note.note_id}`,
    }
  }

  return {
    subject: `[${inquiry.ticket_number}] קיבלנו את פנייתך - Casanova`,
    html: wrapHtml(`<p style="margin:0 0 12px;font-size:15px">שלום ${inquiry.customer_name},</p>
      <p style="margin:0 0 16px;font-size:15px;line-height:1.7">קיבלנו את פנייתך בנושא <strong>${inquiry.subject}</strong>.</p>
      ${ticketBlock(inquiry.ticket_number)}
      <p style="margin:0;font-size:14px;line-height:1.7;color:#b7ac9e">${replyHint}</p>`),
    text: [
      `שלום ${inquiry.customer_name},`,
      "",
      `קיבלנו את פנייתך בנושא "${inquiry.subject}".`,
      `מספר המעקב שלך: ${inquiry.ticket_number}`,
      "",
      replyHint,
    ].join("\n"),
    template: "INQUIRY_RECEIVED",
    idempotencyKey: `support-confirmation-${inquiry.inquiry_id}`,
  }
}

interface EmailOutcome {
  sent: boolean
  failure?: string
}

async function sendMail(
  inquiry: InquiryRow,
  payload: MailPayload,
): Promise<EmailOutcome> {
  const apiKey = Deno.env.get("RESEND_API_KEY")
  if (!apiKey) return { sent: false, failure: "RESEND_API_KEY is missing" }

  const from = Deno.env.get("RESEND_FROM") || FALLBACK_FROM
  const replyTo = replyAddress(inquiry.ticket_number)

  try {
    const response = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": payload.idempotencyKey,
      },
      body: JSON.stringify({
        from,
        to: [inquiry.customer_email],
        subject: payload.subject,
        html: payload.html,
        text: payload.text,
        ...(replyTo ? { reply_to: replyTo } : {}),
      }),
      signal: AbortSignal.timeout(10_000),
    })

    if (!response.ok) {
      const detail = await response.text().catch(() => "")
      return { sent: false, failure: `${response.status} ${detail.slice(0, 300)}` }
    }

    return { sent: true }
  } catch (err) {
    return {
      sent: false,
      failure: err instanceof Error ? err.message : "network error",
    }
  }
}

async function logEmail(
  inquiry: InquiryRow,
  payload: MailPayload,
  outcome: EmailOutcome,
): Promise<void> {
  try {
    await adminClient().from("email_logs").insert({
      recipient: inquiry.customer_email,
      recipient_name: inquiry.customer_name,
      template: payload.template,
      subject: payload.subject,
      status: outcome.sent ? "SENT" : "FAILED",
      related_type: "INQUIRY",
      related_id: inquiry.inquiry_id,
      failure_reason: outcome.failure ?? null,
      sent_at: new Date().toISOString(),
    })
  } catch (err) {
    console.warn("[support-mail] email log failed", err instanceof Error ? err.message : err)
  }
}

Deno.serve(async (req: Request) => {
  const cors = corsHeaders(req)

  if (req.method === "OPTIONS") return new Response("ok", { headers: cors })

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405, cors)
  }

  const declaredLength = Number(req.headers.get("content-length") ?? "0")
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return jsonResponse({ error: "הבקשה גדולה מדי." }, 413, cors)
  }

  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "")
  if (!token) {
    return jsonResponse({ error: "יש להתחבר כדי לבצע פעולה זו." }, 401, cors)
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: "גוף הבקשה אינו תקין." }, 400, cors)
  }

  const input = body as Record<string, unknown>
  const action = input.action === "reply" ? "reply" : input.action === "confirmation" ? "confirmation" : null
  const inquiryId = typeof input.inquiry_id === "string" ? input.inquiry_id : ""
  const noteId = typeof input.note_id === "string" ? input.note_id : ""

  if (!action || !inquiryId) {
    return jsonResponse({ error: "בקשה לא תקינה." }, 400, cors)
  }

  if (action === "reply" && !noteId) {
    return jsonResponse({ error: "חסר מזהה הודעה." }, 400, cors)
  }

  try {
    const admin = adminClient()

    const {
      data: { user },
      error: authError,
    } = await admin.auth.getUser(token)

    if (authError || !user) {
      return jsonResponse({ error: "פג תוקף ההתחברות." }, 401, cors)
    }

    const { data: inquiryRow } = await admin
      .from("inquiries")
      .select("inquiry_id, ticket_number, customer_name, customer_email, subject, user_id")
      .eq("inquiry_id", inquiryId)
      .maybeSingle()

    const inquiry = inquiryRow as InquiryRow | null

    if (!inquiry) {
      return jsonResponse({ error: "הפנייה לא נמצאה." }, 404, cors)
    }

    let note: NoteRow | undefined

    if (action === "reply") {
      const { data: caller } = await admin
        .from("users")
        .select("role")
        .eq("user_id", user.id)
        .maybeSingle()

      if ((caller as { role?: string } | null)?.role !== "ADMIN") {
        return jsonResponse({ error: "נדרשת הרשאת מנהל." }, 403, cors)
      }

      const { data: noteRow } = await admin
        .from("inquiry_notes")
        .select("note_id, inquiry_id, author_id, content, internal")
        .eq("note_id", noteId)
        .eq("inquiry_id", inquiryId)
        .maybeSingle()

      const row = noteRow as NoteRow | null

      /* Only the admin's own customer-visible note may be mailed. Without
       * this check an admin could re-send a customer's message (or an
       * internal annotation) as a "support reply". */
      if (!row || row.internal || row.author_id !== user.id) {
        return jsonResponse(
          { error: "ההודעה אינה ניתנת לשליחה ללקוח." },
          400,
          cors,
        )
      }

      note = row
    } else if (inquiry.user_id !== user.id) {
      /* A confirmation belongs to the account that opened the ticket. An
       * admin previewing it must not trigger a second copy. */
      return jsonResponse({ error: "אין הרשאה לשלוח הודעה זו." }, 403, cors)
    }

    const canReply = Boolean(replyAddress(inquiry.ticket_number))
    const payload = buildPayload(action, inquiry, note, canReply)
    const outcome = await sendMail(inquiry, payload)
    await logEmail(inquiry, payload, outcome)

    return jsonResponse({ sent: outcome.sent, reason: outcome.failure }, 200, cors)
  } catch (err) {
    console.error("[support-mail] failed", err instanceof Error ? err.message : err)
    return jsonResponse({ error: "שליחת המייל נכשלה." }, 500, cors)
  }
})