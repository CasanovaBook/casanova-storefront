/* support-inbound - map an email reply back into its ticket.
 *
 * The confirmation and reply emails carry a Reply-To alias of the form
 * `support+INQ-2026-0001@SUPPORT_REPLY_DOMAIN` and the ticket number in the
 * subject. The mail provider (Resend inbound / any provider with an HTTP
 * webhook) posts the parsed message here; this function extracts the ticket
 * number, checks the shared secret, and calls `support_inbound_reply`, which
 * inserts the message as a customer-visible note and reopens the ticket if it
 * was waiting.
 *
 * Sender verification happens in SQL: the From address must equal
 * `inquiries.customer_email`. A forwarded message, a guessed ticket number or
 * a mismatched sender is refused.
 *
 * Required secret: SUPPORT_INBOUND_SECRET (any long random string; configure
 * the provider webhook to send it as `x-support-inbound-secret`).
 * The standard SUPABASE_* secrets are injected.
 *
 * Payload: { from, to, subject, text } - the provider's parsed fields. `to`
 * may be a string, an array, or an array of { address } objects.
 */

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2"

const MAX_BODY_BYTES = 262_144
const TICKET_RE = /INQ-\d{4}-\d{4,}/i
const EMAIL_RE =
  /^[A-Za-z0-9._%+!#$&'*\/=?^`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/

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

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

/** Pulls the bare address out of `Name <a@b>`, `{ address }`, or a string. */
function bareAddress(value: unknown): string {
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>
    const nested = record.address ?? record.email
    return typeof nested === "string" ? nested.trim().toLowerCase() : ""
  }
  if (typeof value !== "string") return ""
  const match = value.match(/<([^>]+)>/)
  return (match ? match[1] : value).trim().toLowerCase()
}

/** Flattens the provider's `to` field into a searchable string. */
function recipientText(value: unknown): string {
  if (typeof value === "string") return value
  if (!Array.isArray(value)) return ""
  return value
    .map((entry) => {
      if (typeof entry === "string") return entry
      if (entry && typeof entry === "object") {
        const record = entry as Record<string, unknown>
        return typeof record.address === "string"
          ? record.address
          : typeof record.email === "string"
            ? record.email
            : ""
      }
      return ""
    })
    .join(" ")
}

/** Raw HTML fallback for providers that post only the rendered body. */
function stripHtml(value: string): string {
  return value
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}

/** Removes the quoted history so the thread stores only the new message. */
function newContent(raw: string): string {
  const text = raw.replace(/\r\n/g, "\n").trim()
  const cut = text.search(/\n(?:On .+wrote:|ב-.*כתבו?:|-----Original Message-----)/i)
  const body = cut > 0 ? text.slice(0, cut).trim() : text
  return body.slice(0, 20_000)
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405)
  }

  const expected = Deno.env.get("SUPPORT_INBOUND_SECRET")
  if (!expected) {
    return jsonResponse({ error: "Inbound email is not configured." }, 503)
  }

  const provided = req.headers.get("x-support-inbound-secret") ?? ""
  if (provided !== expected) {
    return jsonResponse({ error: "Unauthorized" }, 401)
  }

  const declaredLength = Number(req.headers.get("content-length") ?? "0")
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return jsonResponse({ error: "Payload too large" }, 413)
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400)
  }

  const root = (body ?? {}) as Record<string, unknown>
  /* Providers differ: some post the parsed message at the top level, some
   * wrap it in { type, data }. Both shapes are accepted. */
  const input =
    root.data && typeof root.data === "object" && !Array.isArray(root.data)
      ? (root.data as Record<string, unknown>)
      : root
  const from = bareAddress(input.from)
  const recipients = recipientText(input.to)
  const subject = typeof input.subject === "string" ? input.subject : ""
  const rawText =
    typeof input.text === "string"
      ? input.text
      : typeof input.plain === "string"
        ? input.plain
        : typeof input.body === "string"
          ? input.body
          : ""
  const rawHtml = typeof input.html === "string" ? input.html : ""

  if (!EMAIL_RE.test(from)) {
    return jsonResponse({ error: "sender_missing" }, 400)
  }

  const ticketMatch =
    recipients.match(TICKET_RE) ?? subject.match(TICKET_RE) ?? null
  if (!ticketMatch) {
    return jsonResponse({ error: "ticket_missing" }, 422)
  }
  const ticket = ticketMatch[0].toUpperCase()

  const content = newContent(rawText || stripHtml(rawHtml))
  if (!content) {
    return jsonResponse({ error: "content_missing" }, 400)
  }

  try {
    const { data, error } = await adminClient().rpc("support_inbound_reply", {
      p_ticket_number: ticket,
      p_from_email: from,
      p_content: content,
    })

    if (error) {
      const message = error.message ?? ""
      console.warn("[support-inbound] refused", { ticket, code: error.code, message })

      if (message.includes("sender_mismatch")) {
        return jsonResponse({ error: "sender_mismatch" }, 403)
      }
      if (message.includes("inquiry_missing")) {
        return jsonResponse({ error: "inquiry_missing" }, 404)
      }

      return jsonResponse({ error: "store_failed" }, 500)
    }

    const note = (Array.isArray(data) ? data[0] : data) as { note_id?: string } | null

    return jsonResponse({ ok: true, ticket, note_id: note?.note_id ?? null }, 200)
  } catch (err) {
    console.error(
      "[support-inbound] failed",
      err instanceof Error ? err.message : err,
    )
    return jsonResponse({ error: "store_failed" }, 500)
  }
})