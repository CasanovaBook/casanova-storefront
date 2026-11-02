import { expect, test, type Page } from "@playwright/test"

/* Announcement banner driven by the Maestro `announcements` group.
 * Runs against the local data layer (playwright.config.ts nulls the
 * Supabase env), so publishing here can never touch real content.
 *
 * Selector note: content keys contain dots, so `#field-announcements.enabled`
 * would parse as id+class in CSS - always quote the attribute. */

const BANNER = ".announcement-banner"

type Seed = Array<[string, unknown]>

const SEED_ON: Seed = [
  ["announcements.enabled", true],
  ["announcements.message", "מבצע הספר הראשון - 20% הנחה עד סוף השבוע"],
  ["announcements.linkUrl", "/store"],
  ["announcements.buttonText", "למבצע"],
  ["announcements.bgStyle", "warning"],
]

async function seed(page: Page, content: Seed | null) {
  await page.addInitScript(
    (rows) => {
      const setIfNew = (key: string, value: string) => {
        if (!localStorage.getItem(key)) localStorage.setItem(key, value)
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
      setIfNew(
        "casanova_db_v1",
        JSON.stringify({
          version: 1,
          users: [
            {
              user_id: "usr_qa_admin",
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
          ],
        }),
      )
      setIfNew("casanova_session_v1", "usr_qa_admin")
      if (rows) {
        setIfNew("casanova.maestro.v1.site_content", JSON.stringify(rows))
        setIfNew("casanova.content.cache.v1", JSON.stringify(Object.fromEntries(rows)))
      }
    },
    content
      ? content.map(([id, value]) => ({
          id,
          value,
          updated_by: "qa@example.com",
          created_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-01-01T00:00:00.000Z",
        }))
      : null,
  )
}

test.describe("announcement banner", () => {
  let healthIssues: string[]

  test.beforeEach(({ page }) => {
    healthIssues = []
    page.on("pageerror", (e) => healthIssues.push(`pageerror: ${e.message}`))
    page.on("console", (m) => {
      if (m.type() === "error") healthIssues.push(`console: ${m.text()}`)
      /* A typo between registry key and component read would surface here
       * as a silent fallback; fail loudly instead. */
      if (m.type() === "warning" && /\[content\] unknown key/.test(m.text()))
        healthIssues.push(`content key drift: ${m.text()}`)
    })
    page.on("requestfailed", async (r) => {
      if (/fonts\.(googleapis|gstatic)\.com/.test(r.url())) return
      /* A request the browser abandoned because the page navigated away is
       * not an outage. The cover image on the landing page is still loading
       * when these tests move on, and `net::ERR_ABORTED` was being recorded
       * as a failure - which made the suite red for a reason that had nothing
       * to do with the banner. Anything else still counts. */
      if ((await r.failure())?.errorText === "net::ERR_ABORTED") return
      healthIssues.push(`requestfailed: ${r.url()}`)
    })
    page.on("response", (r) => {
      if (r.status() >= 400) healthIssues.push(`http ${r.status()}: ${r.url()}`)
    })
    page.on("request", (r) => {
      if (/supabase\.co|challenges\.cloudflare\.com/.test(r.url()))
        healthIssues.push(`backend call leaked: ${r.url()}`)
    })
  })

  test.afterEach(() => {
    expect(healthIssues, healthIssues.join("\n")).toEqual([])
  })

  test("shows on both public shells directly above the header", async ({
    page,
  }) => {
    await seed(page, SEED_ON)

    await page.goto("/")
    const banner = page.locator(BANNER)
    await expect(banner).toBeVisible()
    await expect(banner).toContainText("מבצע הספר הראשון")
    await expect(banner).toHaveAttribute("data-style", "warning")
    await expect(banner.locator(".announcement-banner-cta")).toHaveAttribute(
      "href",
      "/store",
    )
    await expect(page.locator(`${BANNER} + .site-header`)).toHaveCount(1)

    await page.goto("/terms-and-conditions")
    await expect(page.locator(BANNER)).toBeVisible()
    await expect(page.locator(`${BANNER} + .site-header`)).toHaveCount(1)
  })

  test("theme variants derive different inks and gradients", async ({
    page,
  }) => {
    await seed(page, SEED_ON)
    await page.goto("/")

    const readTheme = () =>
      page
        .locator(BANNER)
        .evaluate((el) => ({
          ink: getComputedStyle(el).getPropertyValue("--ann-ink").trim(),
          bg: getComputedStyle(el).backgroundImage,
        }))

    const warning = await readTheme()
    expect(warning.bg).not.toBe("none")

    await page.evaluate(() => {
      for (const key of [
        "casanova.maestro.v1.site_content",
        "casanova.content.cache.v1",
      ]) {
        const raw = localStorage.getItem(key)
        if (!raw) continue
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed)) {
          const row = parsed.find((r) => r.id === "announcements.bgStyle")
          if (row) row.value = "info"
          else parsed.push({ id: "announcements.bgStyle", value: "info" })
        } else {
          parsed["announcements.bgStyle"] = "info"
        }
        localStorage.setItem(key, JSON.stringify(parsed))
      }
    })
    await page.reload()
    await expect(page.locator(BANNER)).toHaveAttribute("data-style", "info")

    const info = await readTheme()
    expect(info.ink).not.toBe(warning.ink)
    expect(info.bg).not.toBe(warning.bg)
  })

  test("renders nothing when disabled", async ({ page }) => {
    await seed(page, [
      ["announcements.enabled", false],
      ["announcements.message", "טקסט שלא יוצג"],
    ])
    await page.goto("/")
    await expect(page.locator(BANNER)).toHaveCount(0)
    await expect(page.locator(".site-header")).toBeVisible()
  })

  test("renders nothing when enabled but the message is empty", async ({
    page,
  }) => {
    await seed(page, [
      ["announcements.enabled", true],
      ["announcements.message", "   "],
    ])
    await page.goto("/")
    await expect(page.locator(BANNER)).toHaveCount(0)
  })

  test("link without button text makes the message itself clickable", async ({
    page,
  }) => {
    await seed(page, [
      ["announcements.enabled", true],
      ["announcements.message", "פרק חדש נוסף לספר"],
      ["announcements.linkUrl", "/store"],
    ])
    await page.goto("/")
    await expect(
      page.locator(`${BANNER} .announcement-banner-link`),
    ).toHaveAttribute("href", "/store")
    await expect(page.locator(`${BANNER} .announcement-banner-cta`)).toHaveCount(
      0,
    )
  })

  test("button text without a link drops the dead CTA", async ({ page }) => {
    await seed(page, [
      ["announcements.enabled", true],
      ["announcements.message", "עדכון קל"],
      ["announcements.buttonText", "לחצו כאן"],
    ])
    await page.goto("/")
    await expect(page.locator(BANNER)).toContainText("עדכון קל")
    await expect(page.locator(`${BANNER} .announcement-banner-cta`)).toHaveCount(
      0,
    )
  })

  test("publishing in the CMS shows the banner on the live site", async ({
    page,
  }) => {
    /* No content seed: the publish itself must create the rows, and the
     * setIfNew seed script must not clobber them on the next navigation. */
    await seed(page, null)

    await page.goto("/")
    await expect(page.locator(BANNER)).toHaveCount(0)

    await page.goto("/admin/cms/content-editor/content?group=announcements")
    await expect(
      page.getByRole("button", { name: /באנר והודעות/ }).first(),
    ).toHaveAttribute("aria-current", "true")

    await page.locator('[id="field-announcements.enabled"]').check()
    await page
      .locator('[id="field-announcements.message"]')
      .fill("עדכון: הספרייה נפתחת מחדש")
    await page
      .locator('[id="field-announcements.bgStyle"]')
      .selectOption("info")
    await page.getByRole("button", { name: "פרסם" }).click()
    await expect(page.getByText(/פורסמו 3 שינויים/)).toBeVisible()

    await page.goto("/")
    await expect(page.locator(BANNER)).toBeVisible()
    await expect(page.locator(BANNER)).toHaveAttribute("data-style", "info")
    await expect(
      page.locator(`${BANNER} .announcement-banner-text`),
    ).toHaveText("עדכון: הספרייה נפתחת מחדש")

    /* The boolean must persist as a real boolean, not a string. */
    expect(
      await page.evaluate(
        () =>
          JSON.parse(
            localStorage.getItem("casanova.maestro.v1.site_content") ?? "[]",
          ).find((r: { id: string }) => r.id === "announcements.enabled")
            ?.value,
      ),
    ).toBe(true)
  })
})
