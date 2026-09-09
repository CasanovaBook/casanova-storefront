/* create-upload-url — issue a signed Storage upload URL for a book PDF.
 *
 * Called by the CMS product editor (through src/lib/content-storage.ts) when
 * an admin picks a PDF. It mints a single-object signed UPLOAD url for path
 * `product-<id>/book.pdf` in the private `books` bucket, so the browser can
 * push bytes without ever holding the service_role key.
 *
 * The path is derived here from the validated product_id — the client does not
 * choose it, so it cannot write to (or later sign) an arbitrary object. Nothing
 * is persisted server-side: get-content-url derives the same deterministic
 * path, so setup needs no Postgres table (CLI/SQL-free).
 *
 * SELF-CONTAINED ON PURPOSE (see get-content-url): to deploy without the CLI,
 * open the Dashboard → Edge Functions → create a new function named EXACTLY
 * `create-upload-url`, paste this whole file, set "Verify JWT" to OFF, deploy.
 *
 * LIMITATION (this phase): admin identity is client-side only, so this endpoint
 * cannot cryptographically confirm the caller is an admin. Both functions harden
 * together once auth moves server-side.
 */

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2"

/** Private Storage bucket that holds the uploaded book PDFs. */

const BUCKET = "books"

/* ── inlined shared helpers (identical to get-content-url) ──────────────── */

let cached: SupabaseClient | null = null

/** service_role client. SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected
 *  into every Edge Function runtime by Supabase, so no secret has to be set by
 *  hand. The key bypasses RLS and never leaves this runtime. */

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

/** Product ids are opaque strings ('prd_...') used to build a Storage path, so
 *  they are restricted to a safe charset to rule out path traversal ('../'). */

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

  const path = `product-${productId}/book.pdf`

  try {
    const admin = adminClient()

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

    // No pointer row: the reader derives this same path from the product_id,

    // so there is nothing to persist. Version tracking stays client-side.

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
