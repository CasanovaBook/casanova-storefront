import {
  expect,
  test,
  type BrowserContext,
  type Page,
} from "@playwright/test"

/* Connected devices: liveness, the slot meter, and honest timestamps.
 *
 * Runs against the local data layer (playwright.config.ts nulls the Supabase
 * env), so nothing here can touch a real account.
 *
 * What "live" can mean in this mode: the device document is localStorage, so
 * two pages in ONE browser context share it and a write in one repaints the
 * other through the `storage` event. Two physical devices would not - that
 * needs the server round-trip, and is deliberately out of scope here. */

const READER = "usr_qa_reader"

const ADMIN = "usr_qa_admin"

/** Israel is UTC+3 in June, so this instant is already the next day there. */

const STAMP = "2026-06-15T21:30:00.000Z"

const STAMP_ISRAEL = "16.06.2026 00:30"

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString()

type SessionSeed = {
  session_id: string

  user_id: string

  device_fingerprint: string

  device_name: string

  platform: "WEB" | "IOS" | "ANDROID"

  started_at: string

  last_seen_at: string
}

function session(
  id: string,
  minutes: number,
  userId: string = READER,
): SessionSeed {
  return {
    session_id: `dvs-${id}`,

    user_id: userId,

    device_fingerprint: `fp-${id}`,

    device_name: "Chrome · Windows",

    platform: "WEB",

    started_at: minutesAgo(minutes + 30),

    last_seen_at: minutesAgo(minutes),
  }
}

function dbDoc(sessions: SessionSeed[], withBook: boolean) {
  return {
    version: 1,

    users: [
      {
        user_id: ADMIN,
        first_name: "QA",
        last_name: "Bot",
        email: "qa@example.com",
        role: "ADMIN",
        admin_role: "SUPER_ADMIN",
        account_status: "ACTIVE",
        password_set: true,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
      },
      {
        user_id: READER,
        first_name: "Rina",
        last_name: "Reader",
        email: "reader@example.com",
        role: "CUSTOMER",
        account_status: "ACTIVE",
        password_set: true,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
      },
    ],

    device_sessions: sessions,

    user_products: withBook
      ? [
          {
            user_product_id: "up_qa_book",
            user_id: READER,
            product_id: "prd_qa_book",
            product_snapshot: {
              product_id: "prd_qa_book",
              name: "היא קודם",
              slug: "she-first",
              product_type: "EBOOK",
              cover_colors: ["#1A1A2E", "#2A2A3E"],
              total_pages: 40,
            },
            access_status: "ACTIVE",
            granted_at: "2026-01-01T00:00:00.000Z",
          },
        ]
      : [],
  }
}

/**
 * Seeds through `setIfNew`, because `addInitScript` re-runs on every
 * navigation - a plain set would undo the very write a test is watching.
 */
async function seed(
  context: BrowserContext,
  doc: ReturnType<typeof dbDoc>,
  signedInAs: string = READER,
) {
  await context.addInitScript(
    ({ value, sessionId }) => {
      const setIfNew = (key: string, raw: string) => {
        if (!localStorage.getItem(key)) localStorage.setItem(key, raw)
      }

      setIfNew(
        "casanova_cookie_consent_v1",
        JSON.stringify({
          essential: true,
          functional: true,
          analytics: false,
          timestamp: "2026-01-01T00:00:00.000Z",
        }),
      )
      setIfNew("casanova_db_v1", JSON.stringify(value))
      setIfNew("casanova_session_v1", sessionId)
    },
    { value: doc, sessionId: signedInAs },
  )
}

function watchHealth(page: Page, issues: string[]) {
  page.on("pageerror", (e) => issues.push(`pageerror: ${e.message}`))

  page.on("console", (m) => {
    if (m.type() === "error") issues.push(`console: ${m.text()}`)

    /* A claim loop or a store-write storm shows up here first. */
    if (m.type() === "warning" && /\[content\] unknown key/.test(m.text()))
      issues.push(`content key drift: ${m.text()}`)
  })

  page.on("requestfailed", (r) => {
    if (/fonts\.(googleapis|gstatic)\.com/.test(r.url())) return

    issues.push(`requestfailed: ${r.url()}`)
  })

  page.on("response", (r) => {
    if (r.status() >= 400) issues.push(`http ${r.status()}: ${r.url()}`)
  })

  page.on("request", (r) => {
    if (/supabase\.co|challenges\.cloudflare\.com/.test(r.url()))
      issues.push(`backend call leaked: ${r.url()}`)
  })
}

const row = (page: Page, id: string) =>
  page.locator(`[data-testid="device-row"][data-session-id="${id}"]`)

/** Opens the two-step confirm on a row, then presses the destructive button. */
async function disconnect(page: Page, id: string) {
  await row(page, id).getByRole("button", { name: /^לנתק את/ }).click()
  await page.locator(`#release-${id} .app-btn-danger`).click()
}

test.describe("connected devices", () => {
  let issues: string[]

  test.beforeEach(({ page }) => {
    issues = []
    watchHealth(page, issues)
  })

  test.afterEach(() => {
    expect(issues, issues.join("\n")).toEqual([])
  })

  test("a release in one tab drops the row in another, with no reload", async ({
    browser,
  }) => {
    const context = await browser.newContext()

    await seed(
      context,
      dbDoc([session("desktop", 2), session("mobile", 5)], true),
    )

    const watching = await context.newPage()
    const acting = await context.newPage()

    watchHealth(watching, issues)
    watchHealth(acting, issues)

    await watching.goto("/dashboard")
    await acting.goto("/dashboard")

    await expect(row(watching, "dvs-mobile")).toBeVisible()
    await expect(row(acting, "dvs-mobile")).toBeVisible()

    await disconnect(acting, "dvs-mobile")

    /* The whole point: `watching` never navigates and is never reloaded. */
    await expect(row(watching, "dvs-mobile")).toHaveCount(0)
    await expect(row(watching, "dvs-desktop")).toBeVisible()

    await context.close()
  })

  test("the slot meter counts held slots", async ({ page }) => {
    /* No book: an owner signing in claims this browser as a device of its own,
     * and the meter would then be measuring four rows instead of the two this
     * test seeded. The claim has its own test below. */
    await seed(
      page.context(),
      dbDoc([session("a", 1), session("b", 2)], false),
    )

    await page.goto("/dashboard")

    await expect(page.getByText("2 / 3")).toBeVisible()
    await expect(page.getByText("המכסה מלאה")).toHaveCount(0)
  })

  test("a full cap reads as full and is marked dangerous", async ({ page }) => {
    await seed(
      page.context(),
      dbDoc([session("a", 1), session("b", 2), session("c", 3)], true),
    )

    await page.goto("/dashboard")

    const badge = page.getByText("3 / 3")

    await expect(badge).toBeVisible()
    await expect(badge).toHaveClass(/app-badge--danger/)
    await expect(page.getByText("המכסה מלאה")).toBeVisible()
  })

  test("an idle-expired device is listed but no longer holds a slot", async ({
    page,
  }) => {
    /* Default policy ends a session after 120 minutes of silence. Three rows
     * are seeded so the old rule - every open row holds a slot - would read
     * 3 / 3 and block this reader from opening a book anywhere else. No book
     * seeded, so the sign-in claim cannot add a fourth row here either. */
    await seed(
      page.context(),
      dbDoc([session("a", 1), session("b", 2), session("stale", 600)], false),
    )

    await page.goto("/dashboard")

    await expect(page.getByText("2 / 3")).toBeVisible()
    await expect(row(page, "dvs-stale")).toBeVisible()
    await expect(
      page.getByText("ננעל לאחר היעדר פעילות - יש ללחוץ ״המשך קריאה״ בפתיחת הספר"),
    ).toBeVisible()
    await expect(
      page.getByText("מכשיר אחד ברשימה כבר אינו תופס מקום"),
    ).toBeVisible()
  })

  test("signing in with a book in the library registers this device", async ({
    page,
  }) => {
    /* No sessions seeded: any row that appears was claimed by this browser. */
    await seed(page.context(), dbDoc([], true))

    await page.goto("/dashboard")

    await expect(
      page.locator('[data-testid="device-row"][data-mine="true"]'),
    ).toHaveCount(1)
    await expect(page.getByText("1 / 3")).toBeVisible()
  })

  test("a browser without a book claims no slot on sign-in", async ({
    page,
  }) => {
    await seed(page.context(), dbDoc([], false))

    await page.goto("/dashboard")

    await expect(page.getByText("אין מכשירים רשומים")).toBeVisible()
    await expect(page.locator('[data-testid="device-row"]')).toHaveCount(0)
  })

  test("the panel states when the list was last checked", async ({ page }) => {
    await seed(page.context(), dbDoc([session("a", 1)], true))

    await page.goto("/dashboard")

    const status = page.locator(".app-sync")

    await expect(status).toBeVisible()
    await expect(status).toHaveAttribute("role", "status")
    await expect(status).toContainText("עודכן")
  })

  test("admin shows Israel-time stamps and per-account slots", async ({
    page,
  }) => {
    const idle = session("old", 600)

    await seed(
      page.context(),
      {
        ...dbDoc(
          [{ ...idle, started_at: STAMP, last_seen_at: STAMP }],
          false,
        ),
      },
      ADMIN,
    )

    await page.goto("/admin/security")

    const target = row(page, "dvs-old")

    await expect(target).toBeVisible()

    /* Not the viewer's zone, not "Invalid Date": the instant above is 00:30 on
     * the following day in Israel, and the table has to say so. */
    await expect(target).toContainText(STAMP_ISRAEL)

    /* Open, but idled past the timeout - so it is listed and explicitly not
     * counted against the reader's three slots. */
    await expect(target).toContainText("0 / 3")
    await expect(target).toContainText("אינו תופס מקום")
  })
})
