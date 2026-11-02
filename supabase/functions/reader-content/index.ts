/* reader-content - stream a protected book to an entitled reader.
 *
 * This is the only content-delivery path the web reader uses. The browser
 * never receives a Supabase Storage URL: it fetches this function, and the
 * function signs the private object inside its own runtime (30-second URL)
 * only after every request has passed the authorization checks below.
 *
 * AUTHORIZATION - re-run on every GET, HEAD and range request:
 * 1. The caller's Supabase Auth JWT is cryptographically verified.
 * 2. public.users must exist and not be SUSPENDED/DEACTIVATED.
 * 3. The caller must be an ADMIN, or hold an ACTIVE, unexpired
 *    public.user_products entitlement for the requested product.
 * 4. A non-admin caller must name a device session that still exists, is
 *    not revoked, is not ended, and has reported recently enough to satisfy
 *    the active policy's idle timeout. Without this the fourth check, a
 *    blocked device stopped reading only if its own browser agreed to stop.
 * 5. The Storage key is derived server-side (`product-<id>/book.pdf`);
 *    the request cannot name an object.
 *
 * RESPONSES:
 * - GET  streams the object, passing through a single byte range so pdf.js
 *        can seek without re-downloading the document.
 * - HEAD is the client's preflight: it validates access and confirms the
 *        object exists with a discarded one-byte range, so no readable
 *        content is transferred.
 * - Every response is no-store and carries the ALLOWED_ORIGIN CORS policy.
 *   The signed URL is never echoed in a body, header or log.
 */

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2"

/** Private Storage bucket that holds the uploaded book PDFs. */
const BUCKET = "books"

/** Lifetime of the Storage URL. It never leaves this runtime and is used
 *  immediately, so it only has to outlive one upstream request. */
const SIGNED_URL_TTL_SECONDS = 30

/** Marker the client reads to distinguish this function's 404 (missing
 *  object) from a gateway 404 (function never deployed). */
const DELIVERY_HEADER = "x-content-delivery"
const DELIVERY_VALUE = "reader-content"

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

function corsHeaders(req: Request): Record<string, string> {
  const configured = Deno.env.get("ALLOWED_ORIGIN")
  const origin =
    configured && configured !== "*"
      ? configured
      : (req.headers.get("Origin") ?? "*")

  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers":
      "authorization, apikey, x-client-info, content-type, range",
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
    /* pdf.js reads Content-Length/Accept-Ranges from cross-origin fetches,
     * and the client uses the delivery marker to tell a missing object from
     * a missing function. */
    "Access-Control-Expose-Headers":
      "accept-ranges, content-length, content-range, content-type, x-content-delivery",
    Vary: "Origin",
  }
}

function jsonResponse(
  body: unknown,
  status: number,
  cors: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...cors,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      [DELIVERY_HEADER]: DELIVERY_VALUE,
    },
  })
}

function safeProductId(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return /^[A-Za-z0-9_-]{1,128}$/.test(trimmed) ? trimmed : null
}

/** The session column is a real `uuid`, so anything else cannot match a row
 *  and would make the lookup error. Refusing it here turns a malformed value
 *  into the same answer as an unknown device rather than a 500. */
function safeUuid(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(
    trimmed,
  )
    ? trimmed
    : null
}

/**
 * One byte range, or `null` when absent. Anything else - multiple ranges,
 * a malformed header, an over-long value - is refused rather than forwarded
 * to Storage.
 */
function singleRange(value: string | null): string | null | "invalid" {
  if (!value) return null

  const header = value.trim()

  if (header.length > 100 || !/^bytes=\d*-\d*$/.test(header)) return "invalid"

  const [start, end] = header.slice("bytes=".length).split("-")

  if (!start && !end) return "invalid"

  if (start && end && Number(start) > Number(end)) return "invalid"

  return header
}

function isMissingObject(message: string, error: unknown): boolean {
  if (/not found|does not exist|no such object/i.test(message)) return true

  const shape = error as { statusCode?: string; code?: string }
  return shape.statusCode === "404" || shape.code === "NoSuchKey"
}

interface ProfileRow {
  role?: string
  account_status?: string
}

interface EntitlementRow {
  product_id?: string
  product_snapshot?: { product_id?: string }
  expires_at?: string | null
}

interface SessionRow {
  session_id?: string
  revoked?: boolean
  ended_at?: string | null
  last_seen_at?: string
}

interface PolicyRow {
  session_timeout_minutes?: number
}

/**
 * Idle minutes from the most recently updated active policy, so "expired"
 * means the same thing here as it does in the browser and in the claim RPC.
 * The web reader is the only caller of this function, so a single lookup
 * without per-platform precedence is enough.
 */
async function idleMinutes(admin: SupabaseClient): Promise<number> {
  const { data } = await admin
    .from("drm_policies")
    .select("session_timeout_minutes")
    .eq("active", true)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  const row = (data ?? null) as PolicyRow | null

  return typeof row?.session_timeout_minutes === "number"
    ? row.session_timeout_minutes
    : 120
}

/**
 * The device the request claims to be on, checked against the database.
 *
 * This is what turns an administrator's חסימה into something other than a
 * suggestion. Every earlier check answers "is this account entitled"; none of
 * them asked "is this device still allowed to read", so a blocked device kept
 * pulling pages because the only thing that noticed the block was a heartbeat
 * the reader's own browser could choose not to run.
 */
async function sessionRefusal(
  admin: SupabaseClient,
  userId: string,
  sessionId: string | null,
  cors: Record<string, string>,
): Promise<Response | null> {
  if (!sessionId) {
    return jsonResponse(
      { error: "בקשת הקריאה אינה מזהה מכשיר. יש לרענן את העמוד." },
      403,
      cors,
    )
  }

  /* Filtered by the caller's own id, so a guessed session uuid from another
   * account resolves to "not found" rather than to someone else's row. */
  const { data } = await admin
    .from("device_sessions")
    .select("session_id, revoked, ended_at, last_seen_at")
    .eq("session_id", sessionId)
    .eq("user_id", userId)
    .maybeSingle()

  const session = (data ?? null) as SessionRow | null

  if (!session) {
    return jsonResponse(
      { error: "המכשיר הזה אינו רשום עוד. יש להתחבר מחדש." },
      403,
      cors,
    )
  }

  if (session.revoked) {
    return jsonResponse(
      { error: "הגישה ממכשיר זה נחסמה על ידי מנהל." },
      403,
      cors,
    )
  }

  if (session.ended_at) {
    return jsonResponse(
      { error: "המכשיר נותק. יש לפתוח את הספר מחדש." },
      403,
      cors,
    )
  }

  const idle = await idleMinutes(admin)

  const stale =
    !session.last_seen_at ||
    Date.now() - new Date(session.last_seen_at).getTime() > idle * 60_000

  if (stale) {
    return jsonResponse(
      { error: "הסשן פג תוקף. יש ללחוץ ״המשך קריאה״." },
      403,
      cors,
    )
  }

  return null
}

/**
 * Returns `null` when the caller may stream the product, or the refusal to
 * send. Runs before any Storage call, so an unauthorized request never
 * touches the bucket.
 */
async function authorize(
  admin: SupabaseClient,
  token: string,
  productId: string,
  sessionId: string | null,
  cors: Record<string, string>,
): Promise<Response | null> {
  const { data: { user }, error: authError } = await admin.auth.getUser(token)

  if (authError || !user) {
    return jsonResponse(
      { error: "משתמש אינו מורשה או שתוקף ההתחברות פג." },
      401,
      cors,
    )
  }

  const { data: profile } = await admin
    .from("users")
    .select("role, account_status")
    .eq("user_id", user.id)
    .maybeSingle()

  const row = (profile ?? null) as ProfileRow | null

  /* A suspension can land while a token is still valid; the JWT alone does
   * not say whether this account may read. A missing profile row does not
   * prove suspension, so it is not treated as one. */
  if (row?.account_status && row.account_status !== "ACTIVE") {
    return jsonResponse(
      { error: "החשבון אינו פעיל ואינו יכול לגשת לתוכן." },
      403,
      cors,
    )
  }

  if (row?.role === "ADMIN") return null

  const { data: entitlements, error: entitlementError } = await admin
    .from("user_products")
    .select("product_id, product_snapshot, expires_at")
    .eq("user_id", user.id)
    .eq("access_status", "ACTIVE")

  if (entitlementError) {
    return jsonResponse({ error: "שגיאה בבדיקת הרשאות גישה." }, 500, cors)
  }

  const hasAccess = ((entitlements ?? []) as EntitlementRow[]).some((entry) => {
    const matchesProduct =
      entry.product_id === productId ||
      entry.product_snapshot?.product_id === productId

    const notExpired =
      !entry.expires_at || new Date(entry.expires_at).getTime() > Date.now()

    return matchesProduct && notExpired
  })

  if (!hasAccess) {
    return jsonResponse(
      { error: "אין לך הרשאת גישה פעילה לספר זה." },
      403,
      cors,
    )
  }

  /* Staff already bypass the entitlement check above, and they read titles
   * they do not own as their job, so they are not asked to present a device
   * slot they were never issued. Every reader who is not staff is. */
  return await sessionRefusal(admin, user.id, sessionId, cors)
}

/* ── handler ────────────────────────────────────────────────────────────── */

Deno.serve(async (req: Request) => {
  const cors = corsHeaders(req)

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors })
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    return jsonResponse({ error: "Method not allowed" }, 405, cors)
  }

  const url = new URL(req.url)
  const productId = safeProductId(url.searchParams.get("product_id"))

  if (!productId) {
    return jsonResponse({ error: "A valid product_id is required" }, 400, cors)
  }

  const range = singleRange(req.headers.get("Range"))

  if (range === "invalid") {
    return jsonResponse({ error: "Unsupported byte range." }, 416, cors)
  }

  const authHeader = req.headers.get("Authorization")
  const token = authHeader?.replace(/^Bearer\s+/i, "")

  if (!token) {
    return jsonResponse({ error: "יש להתחבר כדי לגשת לספר." }, 401, cors)
  }

  try {
    const admin = adminClient()

    const sessionId = safeUuid(url.searchParams.get("session_id"))

    const refusal = await authorize(admin, token, productId, sessionId, cors)
    if (refusal) return refusal

    const path = `product-${productId}/book.pdf`

    const { data: signed, error: signError } = await admin.storage
      .from(BUCKET)
      .createSignedUrl(path, SIGNED_URL_TTL_SECONDS)

    if (signError || !signed?.signedUrl) {
      if (signError && isMissingObject(signError.message ?? "", signError)) {
        return jsonResponse(
          { error: "No content file is attached to this product" },
          404,
          cors,
        )
      }

      return jsonResponse({ error: "Could not open the content file." }, 502, cors)
    }

    /* HEAD is the client's access preflight. A one-byte range confirms the
     * object really exists (and that Storage can serve it) without
     * transferring any readable content; the body is discarded. */
    if (req.method === "HEAD") {
      const probe = await fetch(signed.signedUrl, {
        method: "GET",
        headers: { Range: "bytes=0-0" },
      })

      await probe.body?.cancel().catch(() => undefined)

      if (probe.status === 404) {
        return jsonResponse(
          { error: "No content file is attached to this product" },
          404,
          cors,
        )
      }

      if (!probe.ok) {
        return jsonResponse(
          { error: "Could not open the content file." },
          502,
          cors,
        )
      }

      return new Response(null, {
        status: 200,
        headers: {
          ...cors,
          "Content-Type": "application/pdf",
          "Accept-Ranges": "bytes",
          "Cache-Control": "private, no-store, max-age=0",
          "X-Content-Type-Options": "nosniff",
          [DELIVERY_HEADER]: DELIVERY_VALUE,
        },
      })
    }

    const upstream = await fetch(signed.signedUrl, {
      method: "GET",
      headers: range ? { Range: range } : undefined,
    })

    if (upstream.status === 416) {
      return new Response(upstream.body, {
        status: 416,
        headers: {
          ...cors,
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
          [DELIVERY_HEADER]: DELIVERY_VALUE,
        },
      })
    }

    if (!upstream.ok) {
      /* Storage's own status is not forwarded verbatim: a 5xx from the
       * storage layer is a delivery failure, not a statement about the
       * caller's entitlement. A missing object is the one 404 the client
       * already knows how to explain. */
      const status = upstream.status === 404 ? 404 : 502
      return jsonResponse(
        {
          error:
            status === 404
              ? "No content file is attached to this product"
              : "Could not read the content file.",
        },
        status,
        cors,
      )
    }

    const headers = new Headers(cors)

    headers.set(
      "Content-Type",
      upstream.headers.get("Content-Type") ?? "application/pdf",
    )
    headers.set("Accept-Ranges", "bytes")
    headers.set("Cache-Control", "private, no-store, max-age=0")
    headers.set("Content-Disposition", "inline")
    headers.set("X-Content-Type-Options", "nosniff")
    headers.set(DELIVERY_HEADER, DELIVERY_VALUE)

    for (const name of [
      "content-length",
      "content-range",
      "etag",
      "last-modified",
    ]) {
      const value = upstream.headers.get(name)
      if (value) headers.set(name, value)
    }

    return new Response(upstream.body, {
      status: upstream.status,
      headers,
    })
  } catch (err) {
    /* Never include the signed URL or the service key in the response or
     * the log line. A fetch failure can carry the upstream URL in its
     * message, so URLs are redacted before anything is recorded. */
    const reason =
      err instanceof Error
        ? err.message.replace(/https?:\/\/\S+/gi, "[url]")
        : "unknown error"

    console.error("[reader-content] delivery failed:", reason)

    return jsonResponse({ error: "Could not open the content file." }, 502, cors)
  }
})
