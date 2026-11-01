import { expect, test, type Page } from "@playwright/test"

/* Runs against the local Maestro connector (see playwright.config.ts env):
 * the audit table is seeded directly into localStorage, including legacy
 * row shapes written before the structured journal existed and a row whose
 * JSON was sliced by the old writer - the screen must render all of them. */

const AUDIT_URL = "/admin/cms/content-editor/audit"

interface AuditFixture {
  id: string
  actor_email: string
  action: string
  entity: string
  entity_id: string
  detail: string | null
  created_at: string
}

const today = new Date().toISOString()
const past = "2026-01-15T10:20:30.000Z"

const envelope = (before: string, after: string) =>
  JSON.stringify({
    v: 1,
    kind: "content",
    changes: [{ key: "sales.hero.title", before, after }],
  })

const FIXTURES: AuditFixture[] = [
  {
    id: "aud_1",
    actor_email: "qa-editor@example.com",
    action: "update",
    entity: "content",
    entity_id: "sales.hero.title",
    detail: envelope("כותרת ישנה", "כותרת חדשה"),
    created_at: today,
  },
  {
    id: "aud_2",
    actor_email: "qa-admin@example.com",
    action: "delete",
    entity: "products",
    entity_id: "prd_1",
    detail: JSON.stringify({
      v: 1,
      kind: "record",
      changes: [{ key: "name", before: "ספר גנוז", after: null }],
    }),
    created_at: past,
  },
  {
    id: "aud_3",
    actor_email: "qa-editor@example.com",
    action: "update",
    entity: "products",
    entity_id: "prd_2",
    detail: JSON.stringify({ name: "כותרת שנתמנה" }),
    created_at: past,
  },
  {
    id: "aud_4",
    actor_email: "qa-admin@example.com",
    action: "update",
    entity: "content",
    entity_id: "2 keys",
    detail: JSON.stringify(["global.brand", "home.hero.title"]),
    created_at: past,
  },
  {
    id: "aud_5",
    actor_email: "qa-admin@example.com",
    action: "reset",
    entity: "content",
    entity_id: "3 keys",
    detail: '{"v":1,"kind":"content","changes":[{"key":"a"',
    created_at: past,
  },
  {
    id: "aud_6",
    actor_email: "qa-importer@example.com",
    action: "import",
    entity: "content",
    entity_id: "sales.faq.title",
    detail: JSON.stringify({
      v: 1,
      kind: "content",
      changes: [{ key: "sales.faq.title", before: "נוסח יבוא", after: "נוסח האתר" }],
      keys: ["sales.exit.title"],
      total: 2,
      truncated: true,
    }),
    created_at: today,
  },
]

async function openAuditPage(page: Page) {
  await page.addInitScript(
    (rows) => {
      localStorage.setItem(
        "casanova_cookie_consent_v1",
        JSON.stringify({
          essential: true,
          functional: true,
          analytics: false,
          timestamp: "2026-01-01T00:00:00.000Z",
        }),
      )
      localStorage.setItem(
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
      localStorage.setItem("casanova_session_v1", "usr_qa_admin")
      localStorage.setItem(
        "casanova.maestro.v1.audit_log",
        JSON.stringify(
          rows.map((r) => ({ ...r, actor_id: "usr_qa_admin", updated_at: r.created_at })),
        ),
      )
    },
    FIXTURES,
  )

  await page.goto(AUDIT_URL)
  await expect(
    page.getByRole("heading", { level: 1, name: "יומן שינויים" }),
  ).toBeVisible()
}

const rowByEntityId = (page: Page, id: string) =>
  page.locator("tbody tr").filter({ hasText: id })

test.describe("Maestro CMS audit log", () => {
  let healthIssues: string[]

  test.beforeEach(({ page }) => {
    healthIssues = []

    page.on("pageerror", (error) =>
      healthIssues.push(`pageerror: ${error.message}`),
    )
    page.on("console", (message) => {
      if (message.type() === "error")
        healthIssues.push(`console: ${message.text()}`)
    })
    page.on("requestfailed", (request) => {
      if (/fonts\.(googleapis|gstatic)\.com/.test(request.url())) return
      healthIssues.push(`requestfailed: ${request.url()}`)
    })
    page.on("response", (response) => {
      if (response.status() >= 400)
        healthIssues.push(`http ${response.status()}: ${response.url()}`)
    })
    page.on("request", (request) => {
      if (/supabase\.co|challenges\.cloudflare\.com/.test(request.url()))
        healthIssues.push(`backend call leaked: ${request.url()}`)
    })
  })

  test.afterEach(() => {
    expect(healthIssues, healthIssues.join("\n")).toEqual([])
  })

  test("renders exact timestamps and structured detail summaries", async ({
    page,
  }) => {
    await openAuditPage(page)

    await expect(page.locator('p[role="status"]')).toContainText("6 רשומות")

    const time = rowByEntityId(page, "sales.hero.title").locator("time")
    await expect(time).toHaveText(/^\d{2}\.\d{2}\.\d{4} \d{2}:\d{2}$/)
    await expect(time).toHaveAttribute(
      "title",
      /^\d{2}\.\d{2}\.\d{4} \d{2}:\d{2}:\d{2}$/,
    )

    /* Key badges instead of raw strings: content keys as chips, "N keys"
     * translated, and the details cell shows a summary, never raw JSON. */
    await expect(
      rowByEntityId(page, "sales.hero.title").locator(
        ".app-badge--wrap",
      ),
    ).toHaveText("sales.hero.title")
    await expect(rowByEntityId(page, "2 מפתחות")).toBeVisible()
    await expect(
      rowByEntityId(page, "sales.hero.title").getByText("מפתח אחד"),
    ).toBeVisible()

    /* Action badges carry Hebrew labels for the new verbs too. */
    await expect(rowByEntityId(page, "sales.faq.title").getByText("ייבוא")).toBeVisible()
    await expect(rowByEntityId(page, "prd_1").getByText("מחיקה")).toBeVisible()
  })

  test("filters by actor, action and date preset", async ({ page }) => {
    await openAuditPage(page)

    await page.selectOption("#audit-actor", "qa-editor@example.com")
    await expect(page.locator('p[role="status"]')).toContainText("2 רשומות")

    await page.selectOption("#audit-actor", "")
    await page.selectOption("#audit-action", "import")
    await expect(page.locator('p[role="status"]')).toContainText("1 רשומות")

    await page.selectOption("#audit-action", "")
    await page.selectOption("#audit-preset", "today")
    await expect(page.locator('p[role="status"]')).toContainText("2 רשומות")
    await expect(page.locator("tbody tr")).toHaveCount(2)

    await page.getByRole("button", { name: "ניקוי סינון" }).click()
    await expect(page.locator('p[role="status"]')).toContainText("6 רשומות")
  })

  test("custom date range narrows to the stored window", async ({ page }) => {
    await openAuditPage(page)

    await page.selectOption("#audit-preset", "custom")
    await page.fill("#audit-from", "2026-01-01")
    await page.fill("#audit-to", "2026-01-31")

    /* Four rows (aud_2..aud_5) share 15.01.2026; the two "today" rows fall out. */
    await expect(page.locator('p[role="status"]')).toContainText("4 רשומות")
    await expect(rowByEntityId(page, "prd_1")).toBeVisible()
    await expect(rowByEntityId(page, "sales.hero.title")).toHaveCount(0)
  })

  test("diff modal shows before/after for structured rows", async ({
    page,
  }) => {
    await openAuditPage(page)

    await rowByEntityId(page, "sales.hero.title")
      .getByRole("button", { name: /הצגת שינויים/ })
      .click()

    const dialog = page.getByRole("dialog")
    await expect(dialog).toBeVisible()
    await expect(dialog.locator(".app-audit-diff-before")).toContainText(
      "כותרת ישנה",
    )
    await expect(dialog.locator(".app-audit-diff-after")).toContainText(
      "כותרת חדשה",
    )
  })

  test("truncated rows show the warning and the extra key chips", async ({
    page,
  }) => {
    await openAuditPage(page)

    await rowByEntityId(page, "sales.faq.title")
      .getByRole("button", { name: /הצגת שינויים/ })
      .click()

    const dialog = page.getByRole("dialog")
    await expect(dialog.getByText("קוצו כדי לעמוד בתק היומן")).toBeVisible()
    await expect(dialog.locator(".app-audit-keylist .app-badge")).toHaveText([
      "sales.exit.title",
    ])
    await expect(dialog.locator(".app-audit-diff-after")).toContainText(
      "נוסח האתר",
    )
  })

  test("a backup import lands a structured diff row in the journal", async ({
    page,
  }) => {
    /* End-to-end write path: import through the backup UI (local connector)
     * and read the journal back - the row must carry the real before/after
     * values, not just key names. */
    await page.addInitScript(() => {
      /* addInitScript runs on EVERY navigation - seed only what is absent so
       * the import's audit row survives the jump to the journal page. */
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
      setIfNew("casanova.maestro.v1.audit_log", JSON.stringify([]))
      setIfNew(
        "casanova.maestro.v1.site_content",
        JSON.stringify([
          {
            id: "global.brand",
            value: "Casanova QA",
            updated_by: "qa@example.com",
            created_at: "2026-01-01T00:00:00.000Z",
            updated_at: "2026-01-01T00:00:00.000Z",
          },
        ]),
      )
      setIfNew(
        "casanova.content.cache.v1",
        JSON.stringify({ "global.brand": "Casanova QA" }),
      )
    })

    await page.goto("/admin/cms/content-editor/backup")
    await page
      .locator('input[aria-label="קובץ JSON לייבוא"]')
      .setInputFiles({
        name: "import.json",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify({ "global.brand": "Casanova Modified" })),
      })
    await expect(page.getByText("הייבוא הושלם")).toBeVisible()

    await page.goto(AUDIT_URL)
    const row = rowByEntityId(page, "global.brand")
    await expect(row.getByText("ייבוא")).toBeVisible()
    await row.getByRole("button", { name: /הצגת שינויים/ }).click()

    const dialog = page.getByRole("dialog")
    await expect(dialog.locator(".app-audit-diff-before")).toContainText(
      "Casanova QA",
    )
    await expect(dialog.locator(".app-audit-diff-after")).toContainText(
      "Casanova Modified",
    )
  })

  test("legacy rows degrade honestly", async ({ page }) => {
    await openAuditPage(page)

    /* Old patch object: new values only, with an explicit note. */
    await rowByEntityId(page, "prd_2")
      .getByRole("button", { name: /הצגת שינויים/ })
      .click()
    const patchDialog = page.getByRole("dialog")
    await expect(patchDialog.getByText("רשומה ישנה")).toBeVisible()
    await expect(patchDialog.locator(".app-audit-diff-after")).toContainText(
      "כותרת שנתמנה",
    )
    await patchDialog.getByRole("button", { name: "סגירת החלון" }).click()

    /* Old sliced-JSON row: rendered as raw text, no crash. The "N keys"
     * entity id is itself badge-translated to "3 מפתחות". */
    await rowByEntityId(page, "3 מפתחות")
      .getByRole("button", { name: /הצגת שינויים/ })
      .click()
    await expect(page.getByRole("dialog").locator("pre")).toContainText(
      '{"v":1,"kind":"content"',
    )
  })
})
