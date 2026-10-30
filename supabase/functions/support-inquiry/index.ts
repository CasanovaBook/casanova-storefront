/* support-inquiry - open a support ticket for a visitor without an account.
 *
 * WHY THIS IS SERVER-SIDE
 *
 * 0018 deliberately kept anonymous submissions out of the shared queue: an
 * unauthenticated INSERT path would be an open spam surface. This function is
 * that path done safely. It is the validation / CAPTCHA / rate-limit boundary,
 * and every privileged write happens with the service role through
 * `create_guest_inquiry`, which is executable only by service_role.
 *
 * FLOW
 *
 *   1. validate the payload (the same rules the SQL function re-checks);
 *   2. rate limit per IP and per address (per-instance memory, Turnstile is
 *      the cross-instance gate);
 *   3. verify the Turnstile token when TURNSTILE_SECRET_KEY is configured;
 *   4. insert through create_guest_inquiry (ticket number from the sequence;
 *      user_id linked when the address already has an account);
 *   5. send the confirmation email through Resend, with a Reply-To alias the
 *      inbound webhook maps back to the ticket.
 *
 * Required secrets: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (injected),
 * RESEND_API_KEY for delivery, optional RESEND_FROM, SITE_URL/ALLOWED_ORIGIN,
 * SUPPORT_REPLY_DOMAIN and TURNSTILE_SECRET_KEY.
 *
 * A failed email never fails the ticket: the row is the source of truth and
 * the response says email_sent:false.
 */

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2"

const EMAIL_RE =
  /^[A-Za-z0-9._%+!#$&'*\/=?^`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/

const MAX_BODY_BYTES = 32_768
const VALID_TOPICS = new Set([
  "GENERAL",
  "ORDER",
  "REFUND",
  "ACCESS",
  "BILLING",
  "TECHNICAL",
])

const RATE_WINDOW_MS = 10 * 60 * 1000
const MAX_PER_IP = 5
const MAX_PER_EMAIL = 3

const RESEND_ENDPOINT = "https://api.resend.com/emails"
const FALLBACK_FROM = "Casanova Books <no-reply@casanova-books.com>"

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

function clientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for") ?? ""
  return forwarded.split(",")[0]?.trim() || "unknown"
}

/* ── per-instance rate limit ─────────────────────────────────────────────── */

const hits = new Map<string, number[]>()

function underLimit(key: string, max: number): boolean {
  const now = Date.now()
  const recent = (hits.get(key) ?? []).filter((t) => now - t < RATE_WINDOW_MS)

  if (recent.length >= max) {
    hits.set(key, recent)
    return false
  }

  recent.push(now)
  hits.set(key, recent)
  return true
}

/* ── Turnstile ───────────────────────────────────────────────────────────── */

async function verifyTurnstile(token: string, ip: string): Promise<boolean> {
  const secret = Deno.env.get("TURNSTILE_SECRET_KEY")
  if (!secret) return true
  if (!token) return false

  try {
    const form = new FormData()
    form.append("secret", secret)
    form.append("response", token)
    if (ip !== "unknown") form.append("remoteip", ip)

    const response = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      { method: "POST", body: form, signal: AbortSignal.timeout(8_000) },
    )
    const result = (await response.json()) as { success?: boolean }
    return result.success === true
  } catch {
    return false
  }
}

/* ── email ───────────────────────────────────────────────────────────────── */

interface InquiryRow {
  inquiry_id: string
  ticket_number: string
  customer_name: string
  customer_email: string
  subject: string
}

function replyAddress(ticket: string): string | undefined {
  const domain = Deno.env.get("SUPPORT_REPLY_DOMAIN")
  if (!domain) return undefined
  return `support+${ticket}@${domain.replace(/^@+/, "")}`
}

function confirmationHtml(row: InquiryRow): string {
  return `<div dir="rtl" style="font-family:Heebo,Arial,sans-serif;background:#11100e;color:#f4eee4;padding:28px;border-radius:12px">
  <p style="margin:0 0 12px;font-size:15px">שלום ${row.customer_name},</p>
  <p style="margin:0 0 16px;font-size:15px;line-height:1.7">קיבלנו את פנייתך בנושא <strong>${row.subject}</strong>.</p>
  <p style="margin:0 0 8px;font-size:14px">מספר המעקב שלך:</p>
  <p dir="ltr" style="margin:0 0 18px;font-size:22px;font-weight:700;color:#de9a60;letter-spacing:1px">${row.ticket_number}</p>
  <p style="margin:0;font-size:14px;line-height:1.7;color:#b7ac9e">אפשר להשיב להודעה זו בדיוק כדי להוסיף מידע לפנייה - התשובה תיכנס לאותה שיחה. אין צורך בחשבון.</p>
</div>`
}

function confirmationText(row: InquiryRow): string {
  return [
    `שלום ${row.customer_name},`,
    "",
    `קיבלנו את פנייתך בנושא "${row.subject}".`,
    `מספר המעקב שלך: ${row.ticket_number}`,
    "",
    "אפשר להשיב להודעה זו כדי להוסיף מידע לפנייה - התשובה תיכנס לאותה שיחה. אין צורך בחשבון.",
  ].join("\n")
}

interface EmailOutcome {
  sent: boolean
  providerId?: string
  failure?: string
}

async function sendConfirmation(row: InquiryRow): Promise<EmailOutcome> {
  const apiKey = Deno.env.get("RESEND_API_KEY")
  if (!apiKey) return { sent: false, failure: "RESEND_API_KEY is missing" }

  const subject = `[${row.ticket_number}] קיבלנו את פנייתך - Casanova`
  const from = Deno.env.get("RESEND_FROM") || FALLBACK_FROM
  const replyTo = replyAddress(row.ticket_number)

  try {
    const response = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `support-inquiry-${row.inquiry_id}`,
      },
      body: JSON.stringify({
        from,
        to: [row.customer_email],
        subject,
        html: confirmationHtml(row, Boolean(replyTo)),
        text: confirmationText(row, Boolean(replyTo)),
        ...(replyTo ? { reply_to: replyTo } : {}),
      }),
      signal: AbortSignal.timeout(10_000),
    })

    if (!response.ok) {
      const detail = await response.text().catch(() => "")
      return { sent: false, failure: `${response.status} ${detail.slice(0, 300)}` }
    }

    const data = (await response.json()) as { id?: string }
    return { sent: true, providerId: data.id }
  } catch (err) {
    return {
      sent: false,
      failure: err instanceof Error ? err.message : "network error",
    }
  }
}

async function logEmail(
  row: InquiryRow,
  subject: string,
  outcome: EmailOutcome,
): Promise<void> {
  try {
    await adminClient().from("email_logs").insert({
      recipient: row.customer_email,
      recipient_name: row.customer_name,
      template: "INQUIRY_RECEIVED",
      subject,
      status: outcome.sent ? "SENT" : "FAILED",
      related_type: "INQUIRY",
      related_id: row.inquiry_id,
      provider_message_id: outcome.providerId ?? null,
      failure_reason: outcome.failure ?? null,
      sent_at: new Date().toISOString(),
    })
  } catch (err) {
    console.warn("[support-inquiry] email log failed", err instanceof Error ? err.message : err)
  }
}

/* ── handler ─────────────────────────────────────────────────────────────── */

interface GuestInput {
  name: string
  email: string
  phone?: string
  subject: string
  message: string
  topic: string
  captchaToken: string
}

function parseBody(body: unknown): GuestInput | null {
  if (!body || typeof body !== "object") return null
  const input = body as Record<string, unknown>
  const name = typeof input.name === "string" ? input.name.trim() : ""
  const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : ""
  const phone = typeof input.phone === "string" ? input.phone.trim() : ""
  const subject = typeof input.subject === "string" ? input.subject.trim() : ""
  const message = typeof input.message === "string" ? input.message.trim() : ""
  const topic = typeof input.topic === "string" ? input.topic.toUpperCase() : "GENERAL"
  const captchaToken =
    typeof input.captchaToken === "string" ? input.captchaToken.trim() : ""

  if (!name || name.length > 200) return null
  if (!EMAIL_RE.test(email) || email.length > 255) return null
  if (phone.length > 50) return null
  if (!subject || subject.length > 255) return null
  if (message.length < 10 || message.length > 20_000) return null

  return {
    name,
    email,
    phone: phone || undefined,
    subject,
    message,
    topic: VALID_TOPICS.has(topic) ? topic : "GENERAL",
    captchaToken,
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

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: "גוף הבקשה אינו תקין." }, 400, cors)
  }

  const input = parseBody(body)
  if (!input) {
    return jsonResponse(
      { error: "יש למלא שם, אימייל, נושא והודעה באורך סביר." },
      400,
      cors,
    )
  }

  const ip = clientIp(req)

  if (!underLimit(`ip:${ip}`, MAX_PER_IP)) {
    return jsonResponse(
      { error: "נשלחו יותר מדי פניות. נסו שוב בעוד מספר דקות.", rateLimited: true },
      429,
      cors,
    )
  }

  if (!underLimit(`email:${input.email}`, MAX_PER_EMAIL)) {
    return jsonResponse(
      { error: "נשלחו יותר מדי פניות מכתובת זו. נסו שוב מאוחר יותר.", rateLimited: true },
      429,
      cors,
    )
  }

  const captchaOk = await verifyTurnstile(input.captchaToken, ip)
  if (!captchaOk) {
    return jsonResponse(
      {
        error: "אימות האבטחה נכשל או שפג תוקפו. יש לנסות שוב.",
        captchaRequired: true,
        code: "CAPTCHA_REQUIRED",
      },
      403,
      cors,
    )
  }

  try {
    const { data, error } = await adminClient().rpc("create_guest_inquiry", {
      p_name: input.name,
      p_email: input.email,
      p_subject: input.subject,
      p_message: input.message,
      p_phone: input.phone ?? null,
      p_topic: input.topic,
    })

    if (error) {
      console.error("[support-inquiry] insert refused", {
        code: error.code,
        message: error.message,
      })

      const message = error.message ?? ""
      const validation = message.includes("validation_")

      return jsonResponse(
        {
          error: validation
            ? "אחד משדות הפנייה אינו תקין. בדקו את הפרטים ונסו שוב."
            : "לא הצלחנו לפתוח את הפנייה. נסו שוב.",
          ...(error.code ? { code: error.code } : {}),
        },
        validation ? 400 : 500,
        cors,
      )
    }

    const row = (Array.isArray(data) ? data[0] : data) as InquiryRow | null
    if (!row?.inquiry_id) {
      return jsonResponse({ error: "שמירת הפנייה לא הושלמה." }, 500, cors)
    }

    const subject = `[${row.ticket_number}] קיבלנו את פנייתך - Casanova`
    const outcome = await sendConfirmation(row)
    await logEmail(row, subject, outcome)

    return jsonResponse({ inquiry: row, email_sent: outcome.sent }, 200, cors)
  } catch (err) {
    console.error("[support-inquiry] failed", err instanceof Error ? err.message : err)
    return jsonResponse({ error: "שירות התמיכה אינו זמין כרגע." }, 500, cors)
  }
})