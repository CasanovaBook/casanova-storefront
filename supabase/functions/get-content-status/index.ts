/* get-content-status — verify a digital product's file exists in Storage.

 * The Reader resolves a book from the deterministic private path
 * `books/product-<id>/book.pdf` (see get-content-url), independent of any
 * field on the product row. So the only real source of truth for "is this
 * book available?" is whether that object actually exists in the bucket.
 *
 * This function answers that question for the Admin CMS without ever handing
 * out a storage path, a public URL or a signed URL: it reports only whether
 * the object is present and its basic metadata. The service_role key that can
 * see the private bucket stays server-side; the caller is authorised here by
 * their own JWT + the ADMIN role in public.users.
 *
 * AUTHORIZATION:
 * 1. Verifies the caller's Supabase Auth JWT.
 * 2. Requires the caller to hold the ADMIN role.
 * 3. Derives the Storage key server-side from the validated product_id.
 * 4. Returns { exists, fileName, sizeBytes, contentType, lastModified } only.
 */

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2"

/** Private Storage bucket that holds the uploaded book PDFs. */
const BUCKET = "books"

/* ── inlined shared helpers (mirrors get-content-url) ─────────────────────── */

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

/** A bucket listing row (only the fields we surface are typed). */
interface StorageRow {
  name: string
  metadata?: { size?: number, mimetype?: string, updated_at?: string } | null
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
    return jsonResponse({ error: "יש להתחבר כדי לבדוק סטטוס תוכן." }, 401, cors)
  }

  try {
    const admin = adminClient()

    // 1. Verify authenticated caller
    const { data: { user }, error: authError } = await admin.auth.getUser(token)
    if (authError || !user) {
      return jsonResponse(
        { error: "משתמש אינו מורשה או שתוקף ההתחברות פג." },
        401,
        cors,
      )
    }

    // 2. Admin-only: this reports the existence of protected content.
    const { data: profile } = await admin
      .from("users")
      .select("role")
      .eq("user_id", user.id)
      .maybeSingle()

    if (profile?.role !== "ADMIN") {
      return jsonResponse({ error: "בדיקת סטטוס תוכן מותרת למנהלים בלבד." }, 403, cors)
    }

    // 3. Check the deterministic object in the private bucket. Listing the
    //    product folder returns only name + size metadata; we forward
    //    existence + basic info, never the resolved path or any URL.
    const folder = `product-${productId}`
    const { data: listing, error: listError } = await admin.storage
      .from(BUCKET)
      .list(folder, { limit: 50 })

    if (listError) {
      // A missing folder is reported by Supabase as an error/empty result;
      // treat it as "no content", not as a transport failure.
      const missing =
        /not found|Invalid path|Empty|Object does not exist/i.test(
          listError.message ?? "",
        )
      if (missing) {
        return jsonResponse({ exists: false }, 200, cors)
      }
      return jsonResponse(
        { error: "לא ניתן לבדוק את סטטוס התוכן כרגע." },
        502,
        cors,
      )
    }

    const file = (listing as StorageRow[] ?? []).find(
      (f) => f.name === "book.pdf",
    )

    if (!file) {
      return jsonResponse({ exists: false }, 200, cors)
    }

    return jsonResponse(
      {
        exists: true,
        fileName: file.name,
        sizeBytes: file.metadata?.size ?? null,
        contentType: file.metadata?.mimetype ?? "application/pdf",
        lastModified: file.metadata?.updated_at ?? null,
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
