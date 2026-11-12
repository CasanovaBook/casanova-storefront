import { expect, test, type Page, type Request } from "@playwright/test"

/* Privacy regression test.
 *
 * The product promise is that consent and functional preferences never leave
 * localStorage and that no advertising/analytics endpoint is contacted. The
 * suite runs against the local data layer (playwright.config.ts empties the
 * Supabase env), so any non-local request is either a font asset or a leak.
 */

const CONSENT_KEY = "casanova_cookie_consent_v1"

const FUNCTIONAL_KEYS = [
  "casanova_theme",
  "casanova_accessibility_v2",
  "casanova.content.cache.v1",
] as const

const PREFERENCE_KEYS = [CONSENT_KEY, ...FUNCTIONAL_KEYS]

/** Advertising, analytics and telemetry endpoints. */
const TRACKER_PATTERN =
  /(?:google-analytics\.com|googletagmanager\.com|doubleclick\.net|connect\.facebook\.net|facebook\.com\/tr|hotjar\.(?:com|io)|clarity\.ms|mixpanel\.com|segment\.(?:io|com)|posthog\.com|amplitude\.com|sentry\.io|fullstory\.com|heap\.io|matomo\.|plausible\.io|umami\.is|bat\.bing\.com|tiktok\.com|linkedin\.com\/px|pinterest\.com|yandex\.|snap\.licdn\.com|adroll\.com|criteo\.(?:com|net)|taboola\.com|outbrain\.com|\/_vercel\/(?:insights|speed-insights))/i

function collectRequests(page: Page): Request[] {
  const requests: Request[] = []
  page.on("request", (request) => requests.push(request))
  return requests
}

function trackerRequests(requests: Request[]): string[] {
  return requests
    .map((request) => request.url())
    .filter((url) => TRACKER_PATTERN.test(url))
}

/** A preference key in a URL, header or POST body would be an outbound leak. */
function preferenceLeaks(requests: Request[]): string[] {
  return requests
    .filter((request) => {
      const url = request.url()
      const body = request.postData() ?? ""
      const headers = JSON.stringify(request.headers())

      return PREFERENCE_KEYS.some(
        (key) =>
          url.includes(key) || body.includes(key) || headers.includes(key),
      )
    })
    .map((request) => request.url())
}

async function expectNoTracking(requests: Request[]): Promise<void> {
  expect(trackerRequests(requests)).toEqual([])
  expect(preferenceLeaks(requests)).toEqual([])
}

async function readConsent(page: Page): Promise<{
  version?: number
  essential?: boolean
  functional?: boolean
  timestamp?: string
} | null> {
  return page.evaluate((key) => {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : null
  }, CONSENT_KEY)
}

async function seedFunctionalKeys(page: Page): Promise<void> {
  await page.evaluate(() => {
    localStorage.setItem("casanova_theme", "dark")
    localStorage.setItem(
      "casanova_accessibility_v2",
      JSON.stringify({ preferences: { fontScale: 110 }, hidden: false }),
    )
    localStorage.setItem(
      "casanova.content.cache.v1",
      JSON.stringify({ "global.brand": "seed" }),
    )
  })
}

async function expectOnlyLocalKeys(page: Page): Promise<void> {
  const keys = await page.evaluate(() => Object.keys(window.localStorage))
  const unexpected = keys.filter(
    (key) => !key.startsWith("casanova") && !key.startsWith("sb-"),
  )

  expect(keys).toContain(CONSENT_KEY)
  expect(unexpected).toEqual([])

  const cookies = await page.context().cookies()
  expect(
    cookies.filter((cookie) =>
      /^(_ga|_gid|_fbp|_fbc|_hj|mp_|ajs_|__utm)/.test(cookie.name),
    ),
  ).toEqual([])
}

test("initial load sends no tracker requests and Essential Only clears functional storage", async ({
  page,
}) => {
  const requests = collectRequests(page)

  await page.goto("/privacy-policy")
  await expect(
    page.getByRole("heading", { name: "פרטיות ואחסון נתונים" }),
  ).toBeVisible()

  await expectNoTracking(requests)
  await expect(
    page.locator(
      'script[src*="googletagmanager"], script[src*="google-analytics"]',
    ),
  ).toHaveCount(0)

  // Seed data after mount so the assertions prove the click deleted it.
  await seedFunctionalKeys(page)
  expect(
    await page.evaluate(() => localStorage.getItem("casanova_theme")),
  ).toBe("dark")

  await page.getByRole("button", { name: "חיוני בלבד" }).click()
  await expect(page.getByRole("button", { name: "חיוני בלבד" })).toHaveCount(0)

  expect(await readConsent(page)).toMatchObject({
    essential: true,
    functional: false,
  })

  for (const key of FUNCTIONAL_KEYS) {
    expect(await page.evaluate((name) => localStorage.getItem(name), key)).toBeNull()
  }

  // Changing the theme after declining must not recreate the functional key.
  await page.getByRole("switch", { name: "מצב כהה" }).click()
  expect(
    await page.evaluate(() => localStorage.getItem("casanova_theme")),
  ).toBeNull()

  await expectNoTracking(requests)
  await expectOnlyLocalKeys(page)
})

test("Accept All enables local functional storage and still sends no tracker requests", async ({
  page,
}) => {
  const requests = collectRequests(page)

  await page.goto("/privacy-policy")
  await expect(
    page.getByRole("heading", { name: "פרטיות ואחסון נתונים" }),
  ).toBeVisible()

  await expectNoTracking(requests)

  await page.getByRole("button", { name: "קבל הכל" }).click()
  await expect(page.getByRole("button", { name: "קבל הכל" })).toHaveCount(0)

  expect(await readConsent(page)).toMatchObject({
    essential: true,
    functional: true,
  })

  await page.getByRole("switch", { name: "מצב כהה" }).click()
  expect(
    ["light", "dark"].includes(
      (await page.evaluate(() =>
        localStorage.getItem("casanova_theme"),
      )) ?? "",
    ),
  ).toBe(true)

  await expectNoTracking(requests)
  await expectOnlyLocalKeys(page)
})

test("first visit presents one optional category unchecked and supports withdrawal from the footer", async ({
  page,
}) => {
  await page.goto("/privacy-policy")
  await expect(
    page.getByRole("heading", { name: "פרטיות ואחסון נתונים" }),
  ).toBeVisible()

  await page.getByRole("button", { name: "התאמה אישית" }).click()

  const checkbox = page.getByRole("checkbox")
  await expect(checkbox).toHaveCount(1)
  await expect(checkbox).not.toBeChecked()

  await checkbox.check()
  await expect(checkbox).toBeChecked()
  await checkbox.uncheck()
  await expect(checkbox).not.toBeChecked()
  await checkbox.check()

  await page.getByRole("button", { name: "שמור העדפות" }).click()
  await expect(
    page.getByRole("button", { name: "שמור העדפות" }),
  ).toHaveCount(0)

  const accepted = await readConsent(page)
  expect(accepted).toMatchObject({
    version: 1,
    essential: true,
    functional: true,
  })
  expect(accepted).not.toHaveProperty("analytics")

  await page.getByRole("button", { name: "הגדרות עוגיות" }).click()
  await expect(
    page.getByRole("heading", { name: "פרטיות ואחסון נתונים" }),
  ).toBeVisible()
  await expect(page.getByRole("checkbox")).toBeChecked()

  await page.getByRole("checkbox").uncheck()
  await page.getByRole("button", { name: "שמור העדפות" }).click()

  expect(await readConsent(page)).toMatchObject({
    version: 1,
    essential: true,
    functional: false,
  })
})
