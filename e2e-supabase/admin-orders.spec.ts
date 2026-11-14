import { test, expect, type Page } from "@playwright/test"

/* Hosted-mode regression coverage.
 *
 * The browser storage is cleared before the app boots and only a valid
 * Supabase auth session is seeded. Every Supabase response is stubbed, so
 * the order below exists only in the fake server - if /admin/orders renders
 * it, the screen really read /rest/v1/orders instead of localStorage. */

const ADMIN_ID = "11111111-1111-4111-8111-111111111111"
const ORDER_ID = "22222222-2222-4222-8222-222222222222"
const STORAGE_KEY = "sb-testproject-auth-token"
const now = Math.floor(Date.now() / 1000)

const b64 = (value: unknown) =>
  Buffer.from(JSON.stringify(value)).toString("base64url")

const accessToken = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({
  sub: ADMIN_ID,
  email: "qa-admin@example.com",
  role: "authenticated",
  aud: "authenticated",
  iat: now,
  exp: now + 3600,
  session_id: "qa-session",
})}.${b64("signature")}`

const authUser = {
  id: ADMIN_ID,
  email: "qa-admin@example.com",
  aud: "authenticated",
  role: "authenticated",
  created_at: new Date(now * 1000).toISOString(),
  updated_at: new Date(now * 1000).toISOString(),
  app_metadata: { provider: "email", providers: ["email"] },
  user_metadata: { first_name: "QA", last_name: "Admin" },
}

const profile = {
  user_id: ADMIN_ID,
  first_name: "QA",
  last_name: "Admin",
  email: "qa-admin@example.com",
  phone: null,
  role: "ADMIN",
  admin_role: "SUPER_ADMIN",
  account_status: "ACTIVE",
  password_set: true,
  must_change_password: false,
  created_at: new Date(now * 1000).toISOString(),
  updated_at: new Date(now * 1000).toISOString(),
}

const order = {
  order_id: ORDER_ID,
  order_number: "CNV-2026-1042",
  user_id: "33333333-3333-4333-8333-333333333333",
  order_status: "PAID",
  payment_status: "PAID",
  subtotal: 149,
  discount_amount: 0,
  total_amount: 149,
  currency: "ILS",
  coupon_code: null,
  customer_first_name: "דנה",
  customer_last_name: "כהן",
  customer_email: "dana@example.com",
  customer_phone: "0501234567",
  created_at: new Date(now * 1000).toISOString(),
  paid_at: new Date(now * 1000).toISOString(),
}

const item = {
  order_item_id: "44444444-4444-4444-8444-444444444444",
  order_id: ORDER_ID,
  product_id: "55555555-5555-4555-8555-555555555555",
  product_name: "לרדת לפרטים",
  quantity: 1,
  unit_price: 149,
  discount_amount: 0,
  line_total: 149,
}

const payment = {
  payment_id: "66666666-6666-4666-8666-666666666666",
  order_id: ORDER_ID,
  provider: "cardcom",
  status: "CAPTURED",
  amount: 149,
  currency: "ILS",
  transaction_reference: "tx-qa-1",
  card_last4: "4242",
  failure_reason: null,
  created_at: new Date(now * 1000).toISOString(),
}

const session = {
  access_token: accessToken,
  token_type: "bearer",
  expires_in: 3600,
  expires_at: now + 3600,
  refresh_token: "qa-refresh-token",
  user: authUser,
}

async function seedAuthOnly(page: Page) {
  /* addInitScript runs before every document, so localStorage is empty on
   * every load and the only thing in it is the auth session. */
  await page.addInitScript(
    ({ key, value }) => {
      window.localStorage.clear()
      window.sessionStorage.clear()
      window.localStorage.setItem(key, value)
    },
    { key: STORAGE_KEY, value: JSON.stringify(session) },
  )
}

async function stubSupabase(
  page: Page,
  options: { requests: string[]; failOrders?: boolean },
) {
  await page.route("**/auth/v1/user*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(authUser),
    })
  })

  await page.route("**/rest/v1/**", async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname
    const wantsObject = (request.headers()["accept"] ?? "").includes(
      "vnd.pgrst.object+json",
    )

    options.requests.push(`${path}${url.search}`)

    if (options.failOrders && path.endsWith("/orders")) {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ message: "orders read failed" }),
      })
      return
    }

    let body: unknown = []

    if (path.endsWith("/users")) {
      body = wantsObject ? profile : [profile]
    } else if (path.endsWith("/orders")) {
      body = [order]
    } else if (path.endsWith("/order_items")) {
      body = [item]
    } else if (path.endsWith("/payments")) {
      body = [payment]
    } else if (path.includes("/rpc/")) {
      body = order
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    })
  })
}

test("authenticated admin reads hosted orders with empty local storage", async ({
  page,
}) => {
  const requests: string[] = []

  await seedAuthOnly(page)
  await stubSupabase(page, { requests })

  await page.goto("/admin/orders")

  await expect(
    page.getByRole("heading", { level: 1, name: "הזמנות" }),
  ).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText("CNV-2026-1042").first()).toBeVisible()

  expect(
    requests.some((request) => request.startsWith("/rest/v1/orders")),
  ).toBe(true)

  /* The order is not a local row that happened to survive. */
  const localDb = await page.evaluate(
    () => window.localStorage.getItem("casanova_db_v1") ?? "",
  )
  expect(localDb).not.toContain("CNV-2026-1042")
})

test("a failed order read is an error, not a silent zeroed dashboard", async ({
  page,
}) => {
  const requests: string[] = []

  await seedAuthOnly(page)
  await stubSupabase(page, { requests, failOrders: true })

  await page.goto("/admin/orders")

  await expect(page.getByText("טעינת ההזמנות נכשלה")).toBeVisible({
    timeout: 30_000,
  })
  await expect(page.getByText("אין עדיין הזמנות.")).toHaveCount(0)
  await expect(page.getByText("orders read failed").first()).toBeVisible()

  await page.goto("/admin")

  await expect(page.getByText("נתוני ההזמנות לא נטענו")).toBeVisible({
    timeout: 30_000,
  })
})
