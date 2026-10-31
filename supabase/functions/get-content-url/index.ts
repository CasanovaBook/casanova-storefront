/* get-content-url - LEGACY signer retained for deployed clients.
 *
 * The current web reader does not call this function: it streams through
 * `reader-content`, which never exposes a Storage URL. This endpoint is kept
 * only until old bundles age out. It still verifies the JWT and entitlement,
 * but because its response is a direct Storage URL, the lifetime is now the
 * shortest useful one (30 seconds) rather than a whole reading session.
 *
 * AUTHORIZATION ENFORCEMENT:
 * 1. Verifies the caller's Supabase Auth JWT.
 * 2. Refuses a SUSPENDED or DEACTIVATED account.
 * 3. If the user is an ADMIN, access is granted.
 * 4. Otherwise, verifies that the user holds an active entitlement in
 *    public.user_products.
 * 5. Derives the Storage key server-side from the validated product_id
 *    (`product-<id>/book.pdf`) and signs it for 30 seconds.
 */

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2"

/** Private Storage bucket that holds the uploaded book PDFs. */
const BUCKET = "books"

/** Signed-URL lifetime in seconds. The URL is used immediately to start the
 *  document transfer; a copied URL is useless seconds later. */
const SIGNED_URL_TTL_SECONDS = 30

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

function safeProductId(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return /^[A-Za-z0-9_-]{1,128}$/.test(trimmed) ? trimmed : null
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

  const productId = safeProductId((body as { product_id?: unknown }).product_id)
  if (!productId)
    return jsonResponse({ error: "A valid product_id is required" }, 400, cors)

  const authHeader = req.headers.get("Authorization")
  const token = authHeader?.replace(/^Bearer\s+/i, "")

  if (!token) {
    return jsonResponse({ error: "יש להתחבר כדי לגשת לספר." }, 401, cors)
  }

  try {
    const admin = adminClient()

    // 1. Verify authenticated user identity from JWT
    const { data: { user }, error: authError } = await admin.auth.getUser(token)
    if (authError || !user) {
      return jsonResponse(
        { error: "משתמש אינו מורשה או שתוקף ההתחברות פג." },
        401,
        cors,
      )
    }

    // 2. A valid token is not enough: a suspended account can still hold one.
    const { data: profile } = await admin
      .from("users")
      .select("role, account_status")
      .eq("user_id", user.id)
      .maybeSingle()

    if (profile?.account_status && profile.account_status !== "ACTIVE") {
      return jsonResponse(
        { error: "החשבון אינו פעיל ואינו יכול לגשת לתוכן." },
        403,
        cors,
      )
    }

    const isAdmin = profile?.role === "ADMIN"

    // 3. If not an admin, verify active entitlement
    if (!isAdmin) {
      // Check user_products table by product_id or snapshot product_id
      const { data: entitlements, error: entError } = await admin
        .from("user_products")
        .select("access_status, expires_at, product_id, product_snapshot")
        .eq("user_id", user.id)
        .eq("access_status", "ACTIVE")

      if (entError) {
        return jsonResponse({ error: "שגיאה בבדיקת הרשאות גישה." }, 500, cors)
      }

      const hasValidAccess = entitlements?.some((e: {
        product_id?: string
        product_snapshot?: { product_id?: string }
        expires_at?: string | null
      }) => {
        const matchesProduct =
          e.product_id === productId ||
          e.product_snapshot?.product_id === productId

        const notExpired =
          !e.expires_at || new Date(e.expires_at).getTime() > Date.now()

        return matchesProduct && notExpired
      })

      if (!hasValidAccess) {
        return jsonResponse(
          { error: "אין לך הרשאת גישה פעילה לספר זה. אנא רכוש את הספר כדי לקרוא." },
          403,
          cors,
        )
      }
    }

    // 4. Sign the object in the private "books" bucket.
    //
    // The path is deterministic (`product-<id>/book.pdf`), so the old
    // `.list()` pre-check was a second Storage round trip that only
    // re-derived the same answer: signing a missing object fails anyway,
    // with the same 404 mapped below. Dropping the list halves the
    // Storage latency on the reader's critical path without touching
    // authorization - every check above still runs first.
    const path = `product-${productId}/book.pdf`

    const { data: signed, error: signError } = await admin.storage
      .from(BUCKET)
      .createSignedUrl(path, SIGNED_URL_TTL_SECONDS)

    if (signError || !signed?.signedUrl) {
      // Storage reports a missing object as its own error; surface it as
      // the same 404 the list-based lookup used to return, so the client
      // message ("no file attached") is unchanged.
      const missing =
        signError &&
        (signError.message?.includes("not found") ||
          (signError as { statusCode?: string }).statusCode === "404" ||
          (signError as { code?: string }).code === "NoSuchKey")

      if (missing) {
        return jsonResponse(
          { error: "No content file is attached to this product" },
          404,
          cors,
        )
      }

      return jsonResponse(
        { error: "Could not sign the content URL" },
        500,
        cors,
      )
    }

    return jsonResponse(
      {
        signedUrl: signed.signedUrl,
        expiresAt: new Date(
          Date.now() + SIGNED_URL_TTL_SECONDS * 1000,
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
