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

  revoked?: boolean

  revoked_at?: string
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
              name: "לרדת לפרטים",
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

      /* The session pointer is seeded once per tab, not on every navigation.
       * `setIfNew` would otherwise re-create it after a forced sign-out and
       * restore the very session the teardown just destroyed - the test would
       * then be asserting against its own scaffolding rather than the product. */
      if (!sessionStorage.getItem("qa_session_seeded")) {
        localStorage.setItem("casanova_session_v1", sessionId)
        sessionStorage.setItem("qa_session_seeded", "1")
      }
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

  page.on("requestfailed", async (r) => {
    if (/fonts\.(googleapis|gstatic)\.com/.test(r.url())) return

    /* An abandoned request from a navigation is not an outage - see the same
     * note in the banner spec. */
    if ((await r.failure())?.errorText === "net::ERR_ABORTED") return

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

/**
 * This browser's real device fingerprint, read from the card the reader
 * already sees. Needed because the rows a test seeds must match the device the
 * code under test believes it is running on.
 *
 * Seeds and navigates first: without a session the dashboard redirects to the
 * login page and there is no card to read the attribute from.
 */
async function realFingerprint(
  page: Page,
  doc: ReturnType<typeof dbDoc> = dbDoc([], false),
): Promise<string> {
  await seed(page.context(), doc)

  await page.goto("/dashboard")

  const fp = await page
    .locator("[data-device-fingerprint]")
    .first()
    .getAttribute("data-device-fingerprint")

  expect(fp).toBeTruthy()

  return fp as string
}

/**
 * Replaces the stored document after the first navigation. Takes plain data:
 * `page.evaluate` serializes its argument, so a function closed over module
 * constants would arrive in the browser with those names undefined.
 */
async function rewrite(page: Page, doc: Record<string, unknown>) {
  await page.evaluate((value) => {
    localStorage.setItem("casanova_db_v1", JSON.stringify(value))
  }, doc)
}

function liveRow(fp: string, id = "dvs-live") {
  return {
    session_id: id,
    user_id: READER,
    device_fingerprint: fp,
    device_name: "Chrome · Windows",
    platform: "WEB",
    device_integrity: "UNKNOWN",
    secure_flag_active: true,
    revoked: false,
    started_at: minutesAgo(30),
    last_seen_at: minutesAgo(1),
  }
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
      dbDoc([session("desktop", 2), session("mobile", 5)], false),
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
     * and the meter would then be measuring two rows instead of the one this
     * test seeded. The claim has its own test below. */
    await seed(page.context(), dbDoc([session("a", 1)], false))

    await page.goto("/dashboard")

    await expect(page.getByText("1 / 2")).toBeVisible()
    await expect(page.getByText("המכסה מלאה")).toHaveCount(0)
  })

  test("a full cap reads as full and is marked dangerous", async ({ page }) => {
    await seed(
      page.context(),
      dbDoc([session("a", 1), session("b", 2)], false),
    )

    await page.goto("/dashboard")

    const badge = page.getByText("2 / 2")

    await expect(badge).toBeVisible()
    await expect(badge).toHaveClass(/app-badge--danger/)
    await expect(page.getByText("המכסה מלאה")).toBeVisible()
  })

  test("an idle-expired device is listed but no longer holds a slot", async ({
    page,
  }) => {
    /* Default policy ends a session after 120 minutes of silence. Three rows
     * are seeded so the old rule - every open row holds a slot - would read
     * 3 / 2 and block this reader from opening a book anywhere else. No book
     * seeded, so the sign-in claim cannot add a fourth row here either. */
    await seed(
      page.context(),
      dbDoc([session("a", 1), session("b", 2), session("stale", 600)], false),
    )

    await page.goto("/dashboard")

    await expect(page.getByText("2 / 2")).toBeVisible()
    await expect(row(page, "dvs-stale")).toBeVisible()
    await expect(
      page.getByText("ננעל לאחר היעדר פעילות - יש ללחוץ ״המשך קריאה״ בפתיחת הספר"),
    ).toBeVisible()
    await expect(
      page.getByText("מכשיר אחד ברשימה כבר אינו תופס מקום"),
    ).toBeVisible()
  })

  test("a restored session claims no slot on its own", async ({ page }) => {
    /* The regression this guards: the claim ran on every mount, and a mount
     * cannot tell a fresh sign-in from a silent token restore. A returning
     * reader who had never registered - or who had just disconnected - got a
     * slot written for them by a page load. Registering a device is something
     * a person does, not something that happens to them. */
    await seed(page.context(), dbDoc([], true))

    await page.goto("/dashboard")

    await expect(page.locator('[data-testid="device-row"]')).toHaveCount(0)
    await expect(page.getByText("אין מכשירים רשומים")).toBeVisible()
  })

  test("a refresh does not resurrect a disconnected device", async ({
    page,
  }) => {
    const fp = await realFingerprint(page)

    /* The row carries the stamp a release writes. Without `end_reason` the
     * claim could not tell this from an ordinary idle expiry, and the honest
     * answer for an expiry is to let the reader back in without a fuss. */
    await rewrite(page, {
      ...dbDoc([], true),
      device_sessions: [
        {
          ...liveRow(fp),
          ended_at: minutesAgo(1),
          secure_flag_active: false,
          end_reason: "released",
        },
      ],
    })

    await page.goto("/dashboard")

    await expect(page.locator('[data-testid="device-row"]')).toHaveCount(0)
    await expect(page.getByText("0 / 2")).toBeVisible()
  })

  test("a browser without a book claims no slot on sign-in", async ({
    page,
  }) => {
    await seed(page.context(), dbDoc([], false))

    await page.goto("/dashboard")

    await expect(page.getByText("אין מכשירים רשומים")).toBeVisible()
    await expect(page.locator('[data-testid="device-row"]')).toHaveCount(0)
  })

  test("a full cap blocks the sign-in claim rather than evicting a device", async ({
    page,
  }) => {
    /* Two live rows and a book: signing in would like to claim this browser
     * as a third device. The rule is to refuse the newcomer, never to cut off
     * a reader who is already reading - so the row count stays at two. */
    await seed(
      page.context(),
      dbDoc([session("a", 1), session("b", 2)], true),
    )

    await page.goto("/dashboard")

    await expect(page.locator('[data-testid="device-row"]')).toHaveCount(2)
    await expect(page.getByText("2 / 2")).toBeVisible()
  })

  test("a stored policy from the three-device era is read as two", async ({
    page,
  }) => {
    /* The bug this guards: the shipped default was 3 before the limit was
     * lowered, `{ ...baseline, ...stored }` lets the stored 3 win, and the
     * panel went on offering a third slot while the server refused it. */
    const doc = dbDoc([session("a", 1)], false)

    await seed(page.context(), {
      ...doc,
      drm_policies: [
        {
          policy_id: "pol_qa_legacy",
          policy_name: "מדיניות ברירת מחדל",
          applies_to: "ALL",
          max_devices_per_user: 3,
          session_timeout_minutes: 120,
          active: true,
        },
      ],
    })

    await page.goto("/dashboard")

    await expect(page.getByText("1 / 2")).toBeVisible()
    await expect(
      page.getByText("הקריאה מוגבלת ל־2 מכשירים בו־זמנית"),
    ).toBeVisible()
  })

  test("a cap somebody chose deliberately is left alone", async ({ page }) => {
    /* Only the legacy default is upgraded. An administrator who set four has
     * a number that means something, and silently flattening it to two would
     * be the same class of bug in the other direction. */
    const doc = dbDoc([session("a", 1)], false)

    await seed(page.context(), {
      ...doc,
      drm_policies: [
        {
          policy_id: "pol_qa_chosen",
          policy_name: "מדיניות ברירת מחדל",
          applies_to: "ALL",
          max_devices_per_user: 4,
          session_timeout_minutes: 120,
          active: true,
        },
      ],
    })

    await page.goto("/dashboard")

    await expect(page.getByText("1 / 4")).toBeVisible()
  })

  test("a disconnect is written as state, not just removed from the list", async ({
    page,
  }) => {
    await seed(page.context(), dbDoc([session("phone", 3)], false))

    await page.goto("/dashboard")

    await disconnect(page, "dvs-phone")

    /* The row must still be there, closed, with the protection flag down and
     * an event saying who released it. A UI that merely stops rendering the
     * row would pass for the reader and leave the admin with nothing to audit. */
    const stored = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("casanova_db_v1") ?? "{}"),
    )

    const released = stored.device_sessions.find(
      (s: { session_id: string }) => s.session_id === "dvs-phone",
    )

    expect(released, "the released row must survive as a record").toBeTruthy()
    expect(released.ended_at).toBeTruthy()
    expect(released.secure_flag_active).toBe(false)
    expect(released.revoked).toBe(false)

    const event = (stored.security_events ?? []).find(
      (e: { event_type: string; session_id?: string }) =>
        e.event_type === "SESSION_RELEASED" && e.session_id === "dvs-phone",
    )

    expect(event, "a release must be logged like a block is").toBeTruthy()

    await expect(row(page, "dvs-phone")).toHaveCount(0)
  })

  test("disconnecting THIS device destroys the session and leaves the app", async ({
    page,
  }) => {
    const fp = await realFingerprint(page)

    await rewrite(page, {
      ...dbDoc([], true),
      device_sessions: [liveRow(fp, "dvs-mine")],
    })

    await page.goto("/dashboard")

    const mine = page.locator('[data-testid="device-row"][data-mine="true"]')

    await expect(mine).toHaveCount(1)

    await mine
      .getByRole("button", { name: "לנתק מכשיר זה ולהתנתק" })
      .click()
    await page.locator("#release-dvs-mine .app-btn-danger").click()

    /* A full-page navigation, not a router push: the React tree, its state and
     * any pending effect are discarded rather than trusted to unwind. */
    await expect(page).toHaveURL(/\/login\?signed_out=self_disconnect$/)

    await expect
      .poll(() =>
        page.evaluate(() => localStorage.getItem("casanova_session_v1")),
      )
      .toBeNull()

    const doc = await page.evaluate(
      () => JSON.parse(localStorage.getItem("casanova_db_v1") ?? "{}"),
    )

    expect(
      (doc.device_sessions ?? []).filter(
        (s: { user_id: string }) => s.user_id === READER,
      ),
    ).toHaveLength(0)

    await expect(page.getByText("נתקת את המכשיר הזה")).toBeVisible()
  })

  test("a blocked device is signed out and told why", async ({ page }) => {
    const fp = await realFingerprint(page)

    await rewrite(page, {
      ...dbDoc([], false),
      device_sessions: [
        {
          ...liveRow(fp, "dvs-blocked-here"),
          revoked: true,
          revoked_at: minutesAgo(1),
          ended_at: minutesAgo(1),
          secure_flag_active: false,
          end_reason: "revoked",
        },
      ],
    })

    await page.goto("/dashboard")

    await expect(page).toHaveURL(/\/login\?signed_out=blocked$/)
    await expect
      .poll(() =>
        page.evaluate(() => localStorage.getItem("casanova_session_v1")),
      )
      .toBeNull()
    await expect(page.getByText("הגישה ממכשיר זה נחסמה")).toBeVisible()
  })

  test("an unrelated blocked device does not sign this one out", async ({
    page,
  }) => {
    /* The guard is scoped to this browser's fingerprint. Without that scope,
     * an administrator blocking a reader's phone would log out the laptop
     * they are reading on - so this row is blocked, and belongs to a device
     * that is not this one. */
    const blocked = session("other", 1)

    await seed(
      page.context(),
      dbDoc([{ ...blocked, revoked: true, revoked_at: minutesAgo(2) }], false),
    )

    await page.goto("/dashboard")

    await expect(page).toHaveURL(/\/dashboard/)
    await expect
      .poll(() =>
        page.evaluate(() => localStorage.getItem("casanova_session_v1")),
      )
      .toBe("usr_qa_reader")
  })

  test("the panel says when it last looked, and where the rows came from", async ({
    page,
  }) => {
    await seed(page.context(), dbDoc([session("a", 1)], true))

    await page.goto("/dashboard")

    const status = page.locator(".app-sync")

    await expect(status).toBeVisible()
    await expect(status).toHaveAttribute("role", "status")

    /* With no server to ask, the list is this browser's and has to say so.
     * Claiming "עודכן" from a local document would tell a reader their phone
     * is absent when it is only unreachable from here. */
    await expect(status).toContainText("מקומי")
    await expect(status).toHaveClass(/app-sync--local/)
    await expect(status).toHaveAttribute(
      "title",
      /הרשימה מקומית לדפדפן הזה/,
    )
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
     * counted against the reader's two slots. */
    await expect(target).toContainText("0 / 2")
    await expect(target).toContainText("אינו תופס מקום")
  })
})
