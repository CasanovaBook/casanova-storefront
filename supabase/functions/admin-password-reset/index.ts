/* admin-password-reset — mint a Supabase recovery link for a customer.
 *
 * Called by the admin users page ("יצירת קישור איפוס סיסמה") through
 * src/lib/supabase-admin.ts.
 *
 * WHY THIS LIVES SERVER-SIDE
 *
 * Producing a recovery link WITHOUT sending mail means calling
 * `auth.admin.generateLink`, which is a service_role operation. The
 * service_role key must never reach the browser, so the privileged half
 * stays here and the client only receives the finished artefact. Same split
 * as get-content-url / create-upload-url.
 *
 * WHY THE RAW ACTION LINK IS NEVER RETURNED
 *
 * `generateLink` returns a URL on the Supabase project domain carrying the
 * raw recovery token in its query string. Handing that to the admin UI both
 * exposes infrastructure the customer should never see and leaves a live
 * credential sitting in a chat window or clipboard. Instead the action link
 * is sealed server-side — in the password_reset_links table, readable only
 * through the service role — and the UI receives a branded URL,
 * https://casanova-books.com/reset-password?r=…, whose single redeemable
 * secret is a random 128-bit id. The customer-facing page redeems that id
 * through redeem-password-reset and follows the real link inside their own
 * browser; see that function for the handoff's security properties.
 *
 * Supabase's own `resetPasswordForEmail` is deliberately not used: it sends
 * the mail itself and returns nothing, and the admin wants the link in hand
 * to pass to a customer. That is exactly the case where the customer cannot
 * find or receive the email.
 *
 * AUTHORIZATION ENFORCEMENT:
 * 1. Verifies the caller's Supabase Auth JWT.
 * 2. Requires the caller's public.users row to have role = 'ADMIN'.
 * 3. Resolves the target address from public.users by user_id. The email is
 *    never read from the request body, so this cannot be turned into a probe
 *    for — or a reset of — an address that is not in this database.
 */

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2"

/** How long the reset link stays valid. Enforced here — after this the
 *  sealed id is dead and can never be exchanged for the recovery link —
 *  and mirrored in the admin dialog's expiry stamp. Supabase additionally
 *  enforces its own OTP expiry on the underlying recovery token, so the
 *  effective lifetime is the shorter of the two. */

const LINK_TTL_SECONDS = 600

/* ── inlined shared helpers ─────────────────────────────────────────────── */

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

/**
 * Public origin the reset page lives on — always the branded site, never
 * whatever host invoked this function.
 */

function siteUrl(): string {
  const configured = Deno.env.get("SITE_URL")

  if (configured) return configured.replace(/\/+$/, "")

  const allowed = Deno.env.get("ALLOWED_ORIGIN")

  if (allowed && allowed !== "*") return allowed.replace(/\/+$/, "")

  return "https://casanova-books.com"
}

function safeUserId(value: unknown): string | null {
  if (typeof value !== "string") return null

  const trimmed = value.trim()

  return /^[0-9a-fA-F-]{36}$/.test(trimmed) ? trimmed : null
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
    return jsonResponse({ error: "Invalid JSON body" }, 400, cors)
  }

  const userId = safeUserId((body as { user_id?: unknown }).user_id)

  if (!userId)
    return jsonResponse({ error: "A valid user_id is required" }, 400, cors)

  const authHeader = req.headers.get("Authorization")

  const token = authHeader?.replace(/^Bearer\s+/i, "")

  if (!token) {
    return jsonResponse({ error: "יש להתחבר כדי לבצע פעולה זו." }, 401, cors)
  }

  try {
    const admin = adminClient()

    // 1. Verify the caller's identity from the JWT

    const {
      data: { user },

      error: authError,
    } = await admin.auth.getUser(token)

    if (authError || !user) {
      return jsonResponse(
        { error: "משתמש אינו מורשה או שתוקף ההתחברות פג." },

        401,

        cors,
      )
    }

    // 2. Caller must be staff. This is the real gate — the panel's own

    //    `can(adminRole, "users")` check is cosmetic, since a signed-in

    //    customer could call this endpoint directly.

    const { data: caller } = await admin

      .from("users")

      .select("role")

      .eq("user_id", user.id)

      .maybeSingle()

    if (caller?.role !== "ADMIN") {
      return jsonResponse({ error: "נדרשת הרשאת מנהל." }, 403, cors)
    }

    // 3. Resolve the target from the database. Never trust an address sent

    //    by the client, or this becomes a reset-anything endpoint.

    const { data: target } = await admin

      .from("users")

      .select("email")

      .eq("user_id", userId)

      .maybeSingle()

    if (!target?.email) {
      return jsonResponse({ error: "המשתמש לא נמצא." }, 404, cors)
    }

    // 4. Mint the recovery link. generateLink sends no mail, and the link

    //    is sealed server-side — it never travels to any client as-is.

    const { data: link, error: linkError } =
      await admin.auth.admin.generateLink({
        type: "recovery",

        email: target.email,

        options: { redirectTo: `${siteUrl()}/setup-password` },
      })

    const actionLink = link?.properties?.action_link

    if (linkError || !actionLink) {
      return jsonResponse(
        { error: linkError?.message ?? "לא ניתן ליצור קישור איפוס." },

        500,

        cors,
      )
    }

    // 5. Seal it behind a random 128-bit id. service_role is the only key

    //    that can read password_reset_links, and both Edge Functions run

    //    with that key — so the raw token is reachable only inside the

    //    trusted runtime, never in a browser, log or admin UI.

    const sealId = crypto.randomUUID().replace(/-/g, "")

    const expiresAt = new Date(Date.now() + LINK_TTL_SECONDS * 1000)

    const { error: sealError } = await admin

      .from("password_reset_links")

      .insert({
        id: sealId,
        action_link: actionLink,
        expires_at: expiresAt.toISOString(),
      })

    if (sealError) {
      return jsonResponse(
        { error: "שמירת הקישור נכשלה. נסו שוב." },

        500,

        cors,
      )
    }

    // 6. Branded, token-free URL. The customer-facing /reset-password page

    //    redeems the id and follows the real link in their own browser.

    return jsonResponse(
      {
        link: `${siteUrl()}/reset-password?r=${sealId}`,

        email: target.email,

        expires_at: expiresAt.toISOString(),
      },

      200,

      cors,
    )
  } catch (err) {
    return jsonResponse(
      { error: err instanceof Error ? err.message : "Unexpected error" },

      500,

      cors,
    )
  }
})
