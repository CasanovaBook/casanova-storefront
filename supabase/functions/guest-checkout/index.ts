/* guest-checkout - create the account, grant the book, send the welcome mail.
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
 *   4. generate a recovery link and send a branded welcome email via Resend.
 *
 * Required Edge Function secrets: RESEND_API_KEY, SITE_URL, ALLOWED_ORIGIN.
 * The standard SUPABASE_* secrets are injected by Supabase.
 *
 * The order RPC re-derives the price from public.products and keeps the
 * payment-gateway guard. This function refuses missing products, unavailable
 * products and a configured gateway BEFORE creating an account.
 *
 * A Resend or link-generation failure returns email_sent:false. The completed
 * order and entitlement are never rolled back; the success page falls back to
 * the normal "forgot password" flow.
 */

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2"

const EMAIL_RE = /^[A-Za-z0-9._%+!#$&'*\/=?^`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/
const PHONE_RE = /^\+?[0-9][0-9 ()-]{6,18}$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const RATE_LIMIT_WINDOW_MINUTES = 10
const RATE_LIMIT_MAX_ORDERS = 5

const RESEND_ENDPOINT = "https://api.resend.com/emails"
const RESEND_FROM = "Casanova Books <no-reply@casanova-books.com>"
const WELCOME_SUBJECT =
  "תודה שרכשת ב-Casanova! הגדרת סיסמה לספרייה האישית שלך"
const SUPPORT_URL = "https://casanova-books.com/support"

let cachedAdmin: SupabaseClient | null = null

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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

interface WelcomeEmailData {
  firstName: string
  productName: string
  orderNumber?: string
  actionLink: string
}

function welcomeEmailHtml(data: WelcomeEmailData): string {
  const firstName = data.firstName.trim()
  const greeting = firstName ? `היי ${escapeHtml(firstName)},` : "שלום,"
  const productName = escapeHtml(data.productName)
  const orderNumber = data.orderNumber
    ? escapeHtml(data.orderNumber)
    : ""
  const actionLink = escapeHtml(data.actionLink)
  const year = new Date().getFullYear()

  return `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="dark" />
  <meta name="supported-color-schemes" content="dark" />
  <title>Casanova - הגדרת סיסמה</title>
</head>
<body style="margin:0; padding:0; background:#11100e; direction:rtl; -webkit-text-size-adjust:100%;">
  <div style="display:none; max-height:0; overflow:hidden; opacity:0; color:transparent;">
    החשבון שלך נוצר. נותר להגדיר סיסמה כדי לפתוח את הספרייה האישית.
  </div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#11100e; direction:rtl;">
    <tr>
      <td align="center" style="padding:32px 12px;">

        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px; background:#191612; border:1px solid #3a332b; border-radius:16px; overflow:hidden;">

          <tr>
            <td align="center" style="padding:30px 24px 22px; background:#11100e; border-bottom:1px solid #3a332b;">
              <div style="font-family:'Frank Ruhl Libre',Georgia,serif; font-size:24px; font-weight:700; letter-spacing:5px; color:#de9a60;">CASANOVA</div>
              <div style="margin-top:6px; font-family:'Heebo',Arial,sans-serif; font-size:12px; letter-spacing:2px; color:#b7ac9e;">ספרייה דיגיטלית פרטית</div>
            </td>
          </tr>

          <tr>
            <td dir="rtl" style="padding:36px 32px 10px; font-family:'Heebo',Arial,Helvetica,sans-serif; color:#f4eee4; text-align:right;">
              <p style="margin:0 0 18px; font-size:15px; line-height:1.8; color:#b7ac9e;">${greeting}</p>

              <h1 style="margin:0 0 18px; font-family:'Frank Ruhl Libre',Georgia,serif; font-size:26px; line-height:1.35; font-weight:700; color:#f4eee4;">
                תודה שרכשת את ${productName}
              </h1>

              <p style="margin:0 0 16px; font-size:15px; line-height:1.8; color:#e8ded0;">
                אנחנו שמחים שהצטרפת ל-Casanova. הספר הדיגיטלי שרכשת מחכה לך בספרייה האישית שלך.
              </p>

              <p style="margin:0 0 24px; font-size:15px; line-height:1.8; color:#e8ded0;">
                החשבון האישי שלך נוצר בהצלחה. כדי לצפות בספר הדיגיטלי שרכשת בספרייה האישית שלך, נותר רק להגדיר סיסמה.
              </p>

              ${orderNumber
                ? `<p style="margin:0 0 24px; padding:12px 14px; background:#201b16; border:1px solid #3a332b; border-radius:10px; font-size:13px; line-height:1.7; color:#b7ac9e;">
                     מספר הזמנה: <span dir="ltr" style="font-family:Consolas,Monaco,monospace; color:#f4eee4;">${orderNumber}</span>
                   </p>`
                : ""}

              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto 26px;">
                <tr>
                  <td align="center" style="background:#de9a60; border-radius:10px;">
                    <a href="${actionLink}" target="_blank" rel="noopener" style="display:inline-block; padding:15px 38px; font-family:'Heebo',Arial,sans-serif; font-size:16px; font-weight:700; color:#14110e; text-decoration:none;">
                      הגדרת סיסמה לכניסה
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin:0 0 8px; font-size:13px; line-height:1.7; color:#b7ac9e;">
                אם הכפתור אינו נפתח, אפשר להעתיק את הקישור:
              </p>

              <p dir="ltr" style="margin:0 0 24px; padding:12px; background:#11100e; border:1px solid #3a332b; border-radius:8px; font-family:Consolas,Monaco,monospace; font-size:12px; line-height:1.6; color:#b7ac9e; word-break:break-all; text-align:left;">
                ${actionLink}
              </p>

              <p style="margin:0; font-size:13px; line-height:1.7; color:#b7ac9e;">
                הקישור מוגבל בזמן. אם הוא פג, אפשר לבקש קישור חדש בעמוד "שכחת סיסמה?" ולהגדיר סיסמה מחדש.
              </p>
            </td>
          </tr>

          <tr>
            <td align="center" style="padding:26px 32px 30px; border-top:1px solid #3a332b; font-family:'Heebo',Arial,sans-serif; font-size:12px; line-height:1.8; color:#b7ac9e;">
              <p style="margin:0 0 6px;">&copy; ${year} CASANOVA. כל הזכויות שמורות.</p>
              <p style="margin:0;">
                לפניות ותמיכה:
                <a href="${SUPPORT_URL}" style="color:#de9a60; text-decoration:underline;">עמוד התמיכה</a>
              </p>
            </td>
          </tr>

        </table>

        <p style="margin:18px 0 0; font-family:'Heebo',Arial,sans-serif; font-size:11px; line-height:1.7; color:#7f7568;">
          נשלח לך מייל זה בעקבות רכישה ב-<a href="https://casanova-books.com" style="color:#7f7568; text-decoration:underline;">casanova-books.com</a>.
        </p>

      </td>
    </tr>
  </table>
</body>
</html>`
}

function welcomeEmailText(data: WelcomeEmailData): string {
  const firstName = data.firstName.trim()
  const lines = [
    firstName ? `היי ${firstName},` : "שלום,",
    "",
    `תודה שרכשת את ${data.productName}.`,
    "אנחנו שמחים שהצטרפת ל-Casanova.",
    "החשבון האישי שלך נוצר בהצלחה. כדי לצפות בספר הדיגיטלי שרכשת בספרייה האישית שלך, נותר רק להגדיר סיסמה.",
    data.orderNumber ? `מספר הזמנה: ${data.orderNumber}` : null,
    "",
    `להגדרת סיסמה: ${data.actionLink}`,
    "",
    'הקישור מוגבל בזמן. אם הוא פג, אפשר לבקש קישור חדש בעמוד "שכחת סיסמה?".',
    "",
    `לפניות ותמיכה: ${SUPPORT_URL}`,
    `© ${new Date().getFullYear()} CASANOVA. כל הזכויות שמורות.`,
  ]

  return lines.filter((line): line is string => line !== null).join("\n")
}

async function sendWelcomeEmail(
  admin: SupabaseClient,
  input: GuestRequest,
  orderResult: Record<string, unknown>,
): Promise<boolean> {
  const apiKey = Deno.env.get("RESEND_API_KEY")

  if (!apiKey) {
    console.error("[guest-checkout] RESEND_API_KEY is missing; welcome email skipped")
    return false
  }

  const { data, error } = await admin.auth.admin.generateLink({
    type: "recovery",
    email: input.email,
    options: { redirectTo: `${siteUrl()}/setup-password` },
  })

  const actionLink = data?.properties?.action_link

  if (error || !actionLink) {
    console.error(
      "[guest-checkout] recovery link generation failed",
      error?.message ?? "no action link returned",
    )
    return false
  }

  const order = orderResult.order as Record<string, unknown> | undefined
  const item = orderResult.item as Record<string, unknown> | undefined

  const productName =
    typeof item?.product_name === "string" && item.product_name.trim()
      ? item.product_name
      : "הספר הדיגיטלי"

  const orderNumber =
    typeof order?.order_number === "string" ? order.order_number : undefined

  const orderId = typeof order?.order_id === "string" ? order.order_id : undefined

  const emailData: WelcomeEmailData = {
    firstName: input.first_name,
    productName,
    orderNumber,
    actionLink,
  }

  try {
    const response = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        ...(orderId
          ? { "Idempotency-Key": `guest-welcome-${orderId}` }
          : {}),
      },
      body: JSON.stringify({
        from: RESEND_FROM,
        to: [input.email],
        subject: WELCOME_SUBJECT,
        html: welcomeEmailHtml(emailData),
        text: welcomeEmailText(emailData),
      }),
      signal: AbortSignal.timeout(10_000),
    })

    if (!response.ok) {
      const detail = await response.text().catch(() => "")
      console.error(
        "[guest-checkout] Resend refused the welcome email",
        response.status,
        detail.slice(0, 500),
      )
      return false
    }

    return true
  } catch (err) {
    console.error(
      "[guest-checkout] Resend request failed",
      err instanceof Error ? err.message : err,
    )
    return false
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

  try {
    emailSent = await sendWelcomeEmail(
      admin,
      input,
      orderResult as Record<string, unknown>,
    )
  } catch (err) {
    console.error(
      "[guest-checkout] welcome email failed",
      err instanceof Error ? err.message : err,
    )
  }

  return jsonResponse(
    { ...(orderResult as Record<string, unknown>), email_sent: emailSent },
    200,
    cors,
  )
})
