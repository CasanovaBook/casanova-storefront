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
 * stays here and the client only receives the finished link. Same split as
 * get-content-url / create-upload-url.
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

/** Mirrors the project's OTP/recovery expiry, which Supabase defaults to one
 *  hour. Confirm under Auth → Settings if that has been changed. */
const LINK_TTL_SECONDS = 3600

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
 * Public origin the recovery link should return the customer to.
 *
 * Supabase validates this against the project's Redirect URLs, so it has to
 * be the real site rather than whatever host invoked the function — the
 * deployment URL differs from the custom domain.
 */
function siteUrl(req: Request): string {
  const configured = Deno.env.get("SITE_URL")

  if (configured) return configured.replace(/\/+$/, "")

  const allowed = Deno.env.get("ALLOWED_ORIGIN")

  if (allowed && allowed !== "*") return allowed.replace(/\/+$/, "")

  return (req.headers.get("Origin") ?? "https://casanova-books.com").replace(
    /\/+$/,
    "",
  )
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

    // 4. Mint the recovery link. generateLink sends no mail.
    const { data: link, error: linkError } =
      await admin.auth.admin.generateLink({
        type: "recovery",
        email: target.email,
        options: { redirectTo: `${siteUrl(req)}/setup-password` },
      })

    const actionLink = link?.properties?.action_link

    if (linkError || !actionLink) {
      return jsonResponse(
        { error: linkError?.message ?? "לא ניתן ליצור קישור איפוס." },
        500,
        cors,
      )
    }

    return jsonResponse(
      {
        link: actionLink,
        email: target.email,
        expires_at: new Date(
          Date.now() + LINK_TTL_SECONDS * 1000,
        ).toISOString(),
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
