/* create-upload-url — issue a signed Storage upload URL for a book PDF.
 *
 * Called by the CMS product editor (through src/lib/content-storage.ts) when
 * an admin picks a PDF. It mints a single-object signed UPLOAD url for path
 * `product-<id>/book.pdf` in the private `books` bucket, so the browser can
 * push bytes without ever holding the service_role key.
 *
 * AUTHORIZATION:
 * Cryptographically verifies that the caller has a valid Supabase Auth JWT
 * and holds the ADMIN role in public.users.
 */

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2"

/** Private Storage bucket that holds the uploaded book PDFs. */
const BUCKET = "books"

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

  let body: { product_id?: unknown }
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400, cors)
  }

  const productId = safeProductId(body.product_id)
  if (!productId)
    return jsonResponse({ error: "A valid product_id is required" }, 400, cors)

  const authHeader = req.headers.get("Authorization")
  const token = authHeader?.replace(/^Bearer\s+/i, "")

  if (!token) {
    return jsonResponse({ error: "יש להתחבר כמנהל כדי להעלות תוכן." }, 401, cors)
  }

  try {
    const admin = adminClient()

    // 1. Verify caller identity
    const { data: { user }, error: authError } = await admin.auth.getUser(token)
    if (authError || !user) {
      return jsonResponse({ error: "משתמש אינו מורשה או שתוקף ההתחברות פג." }, 401, cors)
    }

    // 2. Check if caller has ADMIN role
    const { data: profile } = await admin
      .from("users")
      .select("role")
      .eq("user_id", user.id)
      .maybeSingle()

    if (profile?.role !== "ADMIN") {
      return jsonResponse({ error: "העלאת קבצים מותרת למנהלים בלבד." }, 403, cors)
    }

    const path = `product-${productId}/book.pdf`

    const { data: signed, error: signError } = await admin.storage
      .from(BUCKET)
      .createSignedUploadUrl(path)

    if (signError || !signed?.token || !signed?.path) {
      return jsonResponse(
        { error: "Could not create an upload URL" },
        500,
        cors,
      )
    }

    return jsonResponse(
      { bucket: BUCKET, path: signed.path, token: signed.token },
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
