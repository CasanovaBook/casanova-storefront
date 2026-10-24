/* guest-checkout - create the account, grant the book, send the setup mail.
 *
 * WHY THIS IS SERVER-SIDE
 *
 * `create_storefront_order` binds the buyer to `auth.uid()` and is executable
 * only by `authenticated`. A visitor has no session, so this function performs
 * the privileged half with the service role:
 *
 *   1. find or create the Supabase Auth user for the typed email;
 *   2. ensure the matching public.users profile;
 *   3. call create_guest_storefront_order (service_role only);
 *   4. send a Supabase recovery email so the buyer can set a password.
 *
 * The order RPC re-derives the price from public.products and keeps the
 * payment-gateway guard. This function refuses missing products, unavailable
 * products and a configured gateway BEFORE creating an account.
 *
 * The recovery mail is sent with the anon key so Supabase Auth owns delivery
 * and the existing Reset-password template. If it fails, the order is still
 * valid and the response says email_sent:false; the success page falls back
 * to "forgot password".
 */

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2"

const EMAIL_RE = /^[A-Za-z0-9._%+!#$&'*\/=?^`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/
const PHONE_RE = /^\+?[0-9][0-9 ()-]{6,18}$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const RATE_LIMIT_WINDOW_MINUTES = 10
const RATE_LIMIT_MAX_ORDERS = 5

let cachedAdmin: SupabaseClient | null = null
let cachedAnon: SupabaseClient | null = null

function adminClient(): SupabaseClient {
  if (cachedAdmin) return cachedAdmin

  const url = Deno.env.get("SUPABASE_URL")
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")

  if (!url || !serviceRole) {
    throw new Error(
      "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in the function environment.",
    )
  }

  cachedAdmin = createClient(url, serviceRole, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  return cachedAdmin
}

function anonClient(): SupabaseClient | null {
  if (cachedAnon) return cachedAnon

  const url = Deno.env.get("SUPABASE_URL")
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")

  if (!url || !anonKey) return null

  cachedAnon = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  return cachedAnon
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

/** Branded site origin, never the caller's Origin header. */
function siteUrl(): string {
  const configured = Deno.env.get("SITE_URL")

  if (configured) return configured.replace(/\/+$/, "")

  const allowed = Deno.env.get("ALLOWED_ORIGIN")

  if (allowed && allowed !== "*") return allowed.replace(/\/+$/, "")

  return "https://casanova-books.com"
}

interface GuestRequest {
  product_id: string
  first_name: string
  last_name: string
  email: string
  phone: string
  idempotency_key: string
}

function parseRequest(body: unknown): { data?: GuestRequest; error?: string } {
  if (!body || typeof body !== "object") return { error: "בקשה לא תקינה." }

  const value = body as Record<string, unknown>

  const productId = typeof value.product_id === "string"
    ? value.product_id.trim()
    : ""
  const firstName = typeof value.first_name === "string"
    ? value.first_name.trim()
    : ""
  const lastName = typeof value.last_name === "string"
    ? value.last_name.trim()
    : ""
  const email = typeof value.email === "string" ? value.email.trim() : ""
  const phone = typeof value.phone === "string" ? value.phone.trim() : ""
  const idempotencyKey = typeof value.idempotency_key === "string"
    ? value.idempotency_key.trim()
    : ""

  if (!UUID_RE.test(productId)) return { error: "המוצר לא נמצא." }
  if (!firstName || !lastName) return { error: "יש למלא שם מלא." }
  if (firstName.length > 100 || lastName.length > 100)
    return { error: "השם ארוך מדי." }
  if (!EMAIL_RE.test(email)) return { error: "כתובת המייל אינה תקינה." }
  if (email.length > 255) return { error: "כתובת המייל ארוכה מדי." }
  if (!phone) return { error: "שדה חובה" }
  if (!PHONE_RE.test(phone)) return { error: "יש להזין מספר טלפון תקין." }

  return {
    data: {
      product_id: productId,
      first_name: firstName,
      last_name: lastName,
      email: email.toLowerCase(),
      phone,
      idempotency_key: UUID_RE.test(idempotencyKey)
        ? idempotencyKey
        : crypto.randomUUID(),
    },
  }
}

function refusalFor(message: string): { status: number; token: string } {
  if (message.includes("user_not_found")) return { status: 404, token: "user_not_found" }
  if (message.includes("email_conflict")) return { status: 409, token: "email_conflict" }
  if (message.includes("account_suspended")) return { status: 403, token: "account_suspended" }
  if (message.includes("gateway_configured")) return { status: 409, token: "gateway_configured" }
  if (message.includes("product_not_found")) return { status: 404, token: "product_not_found" }
  if (message.includes("product_unavailable")) return { status: 409, token: "product_unavailable" }
  if (
    message.includes("name_required") ||
    message.includes("email_invalid") ||
    message.includes("phone_required") ||
    message.includes("phone_invalid")
  ) {
    return { status: 400, token: "validation" }
  }

  return { status: 500, token: "service_unavailable" }
}

async function findAuthUserId(
  admin: SupabaseClient,
  email: string,
): Promise<{ id?: string; error?: string }> {
  const { data, error } = await admin.rpc("get_auth_user_id_by_email", {
    p_email: email,
  })

  if (error) return { error: error.message }

  return { id: typeof data === "string" ? data : undefined }
}

async function ensureProfile(
  admin: SupabaseClient,
  userId: string,
  input: GuestRequest,
): Promise<{ status?: number; token?: string }> {
  const { data: profile, error: readError } = await admin
    .from("users")
    .select("user_id, email, account_status")
    .eq("user_id", userId)
    .maybeSingle()

  if (readError) {
    console.error("[guest-checkout] profile read failed", readError.message)
    return { status: 500, token: "service_unavailable" }
  }

  if (profile) {
    if (profile.account_status === "SUSPENDED" || profile.account_status === "DEACTIVATED") {
      return { status: 403, token: "account_suspended" }
    }

    const profileEmail = String(profile.email ?? "").trim().toLowerCase()

    if (profileEmail !== input.email) {
      return { status: 409, token: "email_conflict" }
    }

    return {}
  }

  // New account. The unversioned handle_new_user trigger may have created a
  // row already; ON CONFLICT user_id keeps this safe. Names come from the form.
  const { error: insertError } = await admin.from("users").insert({
    user_id: userId,
    first_name: input.first_name,
    last_name: input.last_name,
    email: input.email,
    phone: input.phone,
    role: "CUSTOMER",
    account_status: "ACTIVE",
    password_set: false,
  })

  if (!insertError) return {}

  if (insertError.code !== "23505") {
    console.error("[guest-checkout] profile insert failed", insertError.message)
    return { status: 500, token: "service_unavailable" }
  }

  // A concurrent trigger insert may have won the race. Re-read by user id.
  const { data: winner } = await admin
    .from("users")
    .select("user_id, email, account_status")
    .eq("user_id", userId)
    .maybeSingle()

  if (!winner) {
    // The unique violation was the lower(email) index under another user id.
    return { status: 409, token: "email_conflict" }
  }

  if (winner.account_status === "SUSPENDED" || winner.account_status === "DEACTIVATED") {
    return { status: 403, token: "account_suspended" }
  }

  return {}
}

Deno.serve(async (req: Request) => {
  const cors = corsHeaders(req)

  if (req.method === "OPTIONS") return new Response("ok", { headers: cors })
  if (req.method !== "POST")
    return jsonResponse({ error: "Method not allowed" }, 405, cors)

  let body: unknown

  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: "בקשה לא תקינה." }, 400, cors)
  }

  const parsed = parseRequest(body)

  if (!parsed.data) {
    return jsonResponse({ error: parsed.error }, 400, cors)
  }

  const input = parsed.data
  const admin = adminClient()

  // Preflight: never create an account for a request the order will refuse.
  const { data: settings, error: settingsError } = await admin
    .from("platform_settings")
    .select("payment_provider")
    .limit(1)
    .maybeSingle()

  if (settingsError) {
    console.error("[guest-checkout] settings read failed", settingsError.message)
    return jsonResponse({ error: "service_unavailable" }, 500, cors)
  }

  if (!settings) {
    return jsonResponse({ error: "service_unavailable" }, 500, cors)
  }

  if (settings.payment_provider) {
    return jsonResponse({ error: "gateway_configured" }, 409, cors)
  }

  const { data: product, error: productError } = await admin
    .from("products")
    .select("product_id, status, visibility, availability")
    .eq("product_id", input.product_id)
    .maybeSingle()

  if (productError) {
    console.error("[guest-checkout] product read failed", productError.message)
    return jsonResponse({ error: "service_unavailable" }, 500, cors)
  }

  if (!product) return jsonResponse({ error: "product_not_found" }, 404, cors)

  if (
    product.status !== "ACTIVE" ||
    product.visibility === "HIDDEN" ||
    product.availability === "OUT_OF_STOCK"
  ) {
    return jsonResponse({ error: "product_unavailable" }, 409, cors)
  }

  // Minimum abuse guard: cap repeated guest orders for one address. Supabase
  // Auth separately rate-limits the recovery mail.
  const since = new Date(
    Date.now() - RATE_LIMIT_WINDOW_MINUTES * 60_000,
  ).toISOString()

  const { count, error: countError } = await admin
    .from("orders")
    .select("order_id", { count: "exact", head: true })
    .eq("customer_email", input.email)
    .gte("created_at", since)

  if (countError) {
    console.error("[guest-checkout] rate check failed", countError.message)
  } else if ((count ?? 0) >= RATE_LIMIT_MAX_ORDERS) {
    return jsonResponse({ error: "rate_limited" }, 429, cors)
  }

  const lookup = await findAuthUserId(admin, input.email)

  if (lookup.error) {
    console.error("[guest-checkout] auth lookup failed", lookup.error)
    return jsonResponse({ error: "service_unavailable" }, 500, cors)
  }

  let userId = lookup.id

  if (!userId) {
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email: input.email,
      email_confirm: true,
      user_metadata: {
        first_name: input.first_name,
        last_name: input.last_name,
        phone: input.phone,
      },
    })

    if (createError || !created.user) {
      // An existing auth user is the expected branch, not a failure.
      const retryLookup = await findAuthUserId(admin, input.email)

      userId = retryLookup.id

      if (!userId) {
        console.error(
          "[guest-checkout] auth user creation failed",
          createError?.message ?? retryLookup.error ?? "no user returned",
        )
        return jsonResponse({ error: "service_unavailable" }, 500, cors)
      }
    } else {
      userId = created.user.id
    }
  }

  const profileFailure = await ensureProfile(admin, userId, input)

  if (profileFailure.token) {
    return jsonResponse(
      { error: profileFailure.token },
      profileFailure.status ?? 500,
      cors,
    )
  }

  let { data: orderResult, error: orderError } = await admin.rpc(
    "create_guest_storefront_order",
    {
      p_user_id: userId,
      p_product_id: input.product_id,
      p_first_name: input.first_name,
      p_last_name: input.last_name,
      p_email: input.email,
      p_phone: input.phone,
      p_idempotency_key: input.idempotency_key,
    },
  )

  // A concurrent retry can lose the unique-key race; one re-read resolves it.
  if (orderError?.code === "23505") {
    const retry = await admin.rpc("create_guest_storefront_order", {
      p_user_id: userId,
      p_product_id: input.product_id,
      p_first_name: input.first_name,
      p_last_name: input.last_name,
      p_email: input.email,
      p_phone: input.phone,
      p_idempotency_key: input.idempotency_key,
    })

    orderResult = retry.data
    orderError = retry.error
  }

  if (orderError) {
    const refusal = refusalFor(orderError.message ?? "")
    console.error("[guest-checkout] order refused", orderError.message)
    return jsonResponse({ error: refusal.token }, refusal.status, cors)
  }

  if (!orderResult || typeof orderResult !== "object" || Array.isArray(orderResult)) {
    return jsonResponse({ error: "service_unavailable" }, 500, cors)
  }

  let emailSent = false

  const anon = anonClient()

  if (anon) {
    const { error: mailError } = await anon.auth.resetPasswordForEmail(
      input.email,
      { redirectTo: `${siteUrl()}/setup-password` },
    )

    emailSent = !mailError

    if (mailError) {
      console.error("[guest-checkout] setup email failed", mailError.message)
    }
  } else {
    console.error("[guest-checkout] SUPABASE_ANON_KEY is missing; setup email skipped")
  }

  return jsonResponse(
    { ...(orderResult as Record<string, unknown>), email_sent: emailSent },
    200,
    cors,
  )
})
