/* get-content-url — resolve a product to a short-lived signed Storage URL.
 *
 * Called by the reader (through src/lib/content-storage.ts) when it mints a
 * content grant. It NEVER trusts a client-supplied path: the Storage key is
 * derived server-side from the validated product_id (`product-<id>/book.pdf`),
 * so a caller cannot ask for an arbitrary object in the bucket. No Postgres
 * table is needed — existence is checked directly against Storage, which keeps
 * setup CLI/SQL-free.
 *
 * SELF-CONTAINED ON PURPOSE: the Supabase Dashboard Edge Functions editor
 * deploys one function = one bundle, so the shared helpers are inlined here
 * instead of imported from a sibling folder. To deploy without the CLI: open
 * the Dashboard → Edge Functions → create a new function named EXACTLY
 * `get-content-url`, paste this whole file, set "Verify JWT" to OFF, deploy.
 *
 * HONEST LIMITATION (this phase): the storefront has no Supabase Auth and
 * entitlements live in the browser, so this function cannot verify that the
 * caller actually owns the product. It hides the service_role key and returns
 * a URL that expires in minutes — obscuration and time-limiting, not
 * authorization. When user_products moves to Postgres, add a single ownership
 * check here; no client contract changes.
 */

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2"

/** Private Storage bucket that holds the uploaded book PDFs. */

const BUCKET = "books"

/** Signed-URL lifetime in seconds. Mirrors STREAM_GRANT_MINUTES (30) in
 *  src/lib/api-security.ts so the URL outlives the grant that carries it. */

const SIGNED_URL_TTL_SECONDS = 1800

/* ── inlined shared helpers ─────────────────────────────────────────────── */

let cached: SupabaseClient | null = null

/** service_role client. SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected
 *  into every Edge Function runtime by Supabase, so no secret has to be set by
 *  hand. The key bypasses RLS and never leaves this runtime — it is never a
 *  VITE_ variable and never reaches the browser bundle. */

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

/** CORS: the storefront is a static SPA on an origin Supabase does not control,
 *  so the function answers the preflight itself. ALLOWED_ORIGIN pins it down;
 *  when unset we reflect the request Origin, which is safe here because these
 *  endpoints hand back only short-lived, path-restricted URLs. */

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

  let body: unknown

  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400, cors)
  }

  const productId = safeProductId((body as { product_id?: unknown }).product_id)

  if (!productId)
    return jsonResponse({ error: "A valid product_id is required" }, 400, cors)

  try {
    const admin = adminClient()

    const folder = `product-${productId}`

    const path = `${folder}/book.pdf`

    // Confirm the object actually exists before signing. The key is built from

    // the validated product_id, never from client input.

    const { data: objects, error: listError } = await admin.storage

      .from(BUCKET)

      .list(folder, { search: "book.pdf", limit: 1 })

    if (listError) return jsonResponse({ error: "Lookup failed" }, 500, cors)

    if (!objects?.some((o: { name: string }) => o.name === "book.pdf")) {
      return jsonResponse(
        { error: "No content file is attached to this product" },
        404,
        cors,
      )
    }

    const { data: signed, error: signError } = await admin.storage

      .from(BUCKET)

      .createSignedUrl(path, SIGNED_URL_TTL_SECONDS)

    if (signError || !signed?.signedUrl) {
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
