/* redeem-password-reset — swap a sealed reset id for the real recovery link.
 *
 * The customer-facing /reset-password page calls this with the `r` id from
 * its URL and then navigates to the returned action link in their own
 * browser. The raw Supabase link — project domain, recovery token and all —
 * is only ever present inside this response, which the page consumes
 * immediately by redirecting; it is never rendered, stored or logged.
 *
 * SECURITY PROPERTIES
 *
 * 1. The id is the only credential. It is a full 128-bit random UUID with
 *    the dashes stripped — unguessable, un enumerable, and worthless after
 *    the first redeem (the row is deleted in the same request, so replay
 *    returns 410).
 * 2. Expiry is enforced twice: the row's expires_at is checked here even
 *    though admin-password-reset already stops sealing after 10 minutes.
 * 3. Authorization model: the table has RLS enabled with no policies, so
 *    anon/authenticated keys can read nothing; this function uses the
 *    service role, which is exactly the one trusted path.
 * 4. Nothing about the request or the link is logged — the response body is
 *    the only copy, and the client discards it on redirect.
 *
 * verify_jwt is false (config.toml): the caller is an anonymous customer
 * mid-recovery, the id itself is the bearer secret, and there is no session
 * to verify.
 */

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2"

/* ── inlined shared helpers (mirrors admin-password-reset) ──────────────── */

let cached: SupabaseClient | null = null

function adminClient(): SupabaseClient {
  if (cached) return cached

  const url = Deno.env.get("SUPABASE_URL")
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")

  if (!url || !serviceRole) {
    throw new Error(
      "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in the function environment.",
    )
  }

  cached = createClient(url, serviceRole, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  return cached
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

/* ── handler ────────────────────────────────────────────────────────────── */

Deno.serve(async (req: Request) => {
  const cors = corsHeaders(req)

  if (req.method === "OPTIONS") return new Response("ok", { headers: cors })

  if (req.method !== "POST")
    return jsonResponse({ error: "Method not allowed" }, 405, cors)

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: "Invalid request" }, 400, cors)
  }

  const id = (body as { id?: unknown }).id

  // Same shape admin-password-reset minted: 32 hex chars.
  if (typeof id !== "string" || !/^[0-9a-f]{32}$/.test(id)) {
    return jsonResponse({ error: "קישור האיפוס אינו תקין." }, 400, cors)
  }

  try {
    const admin = adminClient()

    // Atomic single-use redeem: DELETE … RETURNING. Two concurrent requests
    // with the same id race on one row — exactly one delete lands, the
    // loser sees no row and gets the same answer as an expired link.
    const { data: row, error: deleteError } = await admin
      .from("password_reset_links")
      .delete()
      .eq("id", id)
      .select("action_link, expires_at")
      .maybeSingle()

    if (deleteError) {
      return jsonResponse({ error: "לא ניתן לאמת את הקישור." }, 500, cors)
    }

    // Unknown id, already used, or past its 10-minute lifetime.
    if (!row || new Date(row.expires_at).getTime() <= Date.now()) {
      return jsonResponse(
        { error: "קישור האיפוס אינו תקין או שפג תוקפו." },
        410,
        cors,
      )
    }

    return jsonResponse({ action_link: row.action_link }, 200, cors)
  } catch {
    return jsonResponse({ error: "Unexpected error" }, 500, cors)
  }
})
