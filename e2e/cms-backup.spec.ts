import { expect, test } from "@playwright/test"
import { readFileSync } from "node:fs"

/* Runs against the LOCAL data layer (see playwright.config.ts env): every
 * write - import, reset - lands in the browser context's localStorage, never
 * in the real Supabase project. */

const BACKUP_URL = "/admin/cms/content-editor/backup"
const SESSION_KEY = "usr_qa_admin"

const SAVED_TWO = [
  ["global.brand", "Casanova QA"],
  ["global.tagline", "ספריית בדיקה"],
] as const

const maestroRows = (entries: ReadonlyArray<readonly [string, unknown]>) =>
  entries.map(([id, value]) => ({
    id,
    value,
    updated_by: "qa@example.com",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  }))

/** Seeds cookie consent, an ADMIN/SUPER_ADMIN local account + session, and
 * the saved-content stores (both the render cache and the maestro table,
 * because export re-reads the table via loadContent()). */
async function openBackupPage(
  page: import("@playwright/test").Page,
  saved: ReadonlyArray<readonly [string, unknown]> = SAVED_TWO,
) {
  await page.addInitScript(
    (seed) => {
      localStorage.setItem(
        "casanova_cookie_consent_v1",
        JSON.stringify({
          version: 1,
          essential: true,
          functional: true,
          timestamp: "2026-01-01T00:00:00.000Z",
        }),
      );
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
      );
      localStorage.setItem("casanova_session_v1", seed.sessionKey);
      localStorage.setItem(
        "casanova.maestro.v1.site_content",
        JSON.stringify(seed.rows),
      );
      localStorage.setItem("casanova.content.cache.v1", JSON.stringify(seed.cache));
    },
    {
      sessionKey: SESSION_KEY,
      rows: maestroRows(saved),
      cache: Object.fromEntries(saved),
    },
  );

  await page.goto(BACKUP_URL);
  await expect(
    page.getByRole("heading", { level: 1, name: "גיבוי ושחזור" }),
  ).toBeVisible();
}

const section = (page: import("@playwright/test").Page, id: string) =>
  page.locator(`section[aria-labelledby="${id}"]`);

const savedBadge = (page: import("@playwright/test").Page) =>
  section(page, "backup-status-title").locator(".app-badge");

const statValues = (page: import("@playwright/test").Page) =>
  section(page, "backup-status-title").locator("dl dd");

const siteContentRows = (page: import("@playwright/test").Page) =>
  page.evaluate(
    () =>
      JSON.parse(
        localStorage.getItem("casanova.maestro.v1.site_content") ?? "[]",
      ).length,
  );

test.describe("Maestro CMS backup page", () => {
  let healthIssues: string[];

  test.beforeEach(({ page }) => {
    healthIssues = [];

    page.on("pageerror", (error) =>
      healthIssues.push(`pageerror: ${error.message}`),
    );
    page.on("console", (message) => {
      if (message.type() === "error")
        healthIssues.push(`console: ${message.text()}`);
    });
    page.on("requestfailed", (request) => {
      /* Third-party fonts are cosmetic and can fail offline; nothing the
       * screen's own behavior depends on. */
      if (/fonts\.(googleapis|gstatic)\.com/.test(request.url())) return;
      healthIssues.push(`requestfailed: ${request.url()}`);
    });
    page.on("response", (response) => {
      if (response.status() >= 400)
        healthIssues.push(`http ${response.status()}: ${response.url()}`);
    });
    page.on("request", (request) => {
      /* Tripwire: in local mode the app must never reach the real backend
       * or a captcha provider. */
      if (/supabase\.co|challenges\.cloudflare\.com/.test(request.url()))
        healthIssues.push(`backend call leaked: ${request.url()}`);
    });
  });

  test.afterEach(() => {
    expect(healthIssues, healthIssues.join("\n")).toEqual([]);
  });

  test("status card renders consistent counters for the saved fields", async ({
    page,
  }) => {
    await openBackupPage(page);

    const total = Number(await statValues(page).nth(0).textContent());
    const saved = Number(await statValues(page).nth(1).textContent());
    const defaults = Number(await statValues(page).nth(2).textContent());

    expect(total).toBeGreaterThan(0);
    expect(saved).toBe(SAVED_TWO.length);
    expect(defaults).toBe(total - saved);
    await expect(savedBadge(page)).toHaveText(`${SAVED_TWO.length} שדות שנערכו`);
  });

  test("export downloads the saved content as JSON", async ({ page }) => {
    await openBackupPage(page);

    const exportButton = section(page, "backup-export-title").getByRole(
      "button",
    );
    await expect(exportButton).toBeEnabled();
    await expect(exportButton).toContainText(
      `ייצוא ${SAVED_TWO.length} שדות`,
    );

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      exportButton.click(),
    ]);

    expect(download.suggestedFilename()).toMatch(
      /^maestro-backup-\d{4}-\d{2}-\d{2}\.json$/,
    );

    const exported = JSON.parse(
      readFileSync(await download.path(), "utf8"),
    ) as Record<string, unknown>;
    expect(exported["global.brand"]).toBe("Casanova QA");
    expect(exported["global.tagline"]).toBe("ספריית בדיקה");
  });

  test("import accepts a valid file, skips unknown keys and updates the counts", async ({
    page,
  }) => {
    await openBackupPage(page);

    await page
      .locator('input[aria-label="קובץ JSON לייבוא"]')
      .setInputFiles({
        name: "import.json",
        mimeType: "application/json",
        buffer: Buffer.from(
          JSON.stringify({
            "home.hero.title": "כותרת מיבוא",
            "qa.key.not.in.registry": true,
          }),
        ),
      });

    await expect(page.getByText("הייבוא הושלם")).toBeVisible();
    await expect(page.getByText(/יובאו 1 שדות בהצלחה/)).toBeVisible();
    await expect(
      page.getByText(/דילוג על 1 מפתחות לא מוכרים/),
    ).toBeVisible();

    /* The UI count and the persisted maestro table both moved by one. */
    await expect(savedBadge(page)).toHaveText("3 שדות שנערכו");
    expect(await siteContentRows(page)).toBe(SAVED_TWO.length + 1);
  });

  for (const [label, body, expected] of [
    ["a malformed file", "{ not json at all", "שגיאה בפרסור הקובץ"],
    ["a non-object file", JSON.stringify([1, 2, 3]), "הקובץ אינו JSON תקין"],
    [
      "a registry-mismatched file",
      JSON.stringify({ "qa.no.such_key": "x" }),
      "אף מפתח לא תואם לרישום",
    ],
  ] as const) {
    test(`import rejects ${label}`, async ({ page }) => {
      await openBackupPage(page);

      await page
        .locator('input[aria-label="קובץ JSON לייבוא"]')
        .setInputFiles({
          name: "bad.json",
          mimeType: "application/json",
          buffer: Buffer.from(body),
        });

      await expect(page.getByText("הייבוא נכשל")).toBeVisible();
      await expect(page.getByText(expected)).toBeVisible();
      await expect(page.getByText("הייבוא הושלם")).toHaveCount(0);
      /* Nothing was persisted. */
      expect(await siteContentRows(page)).toBe(SAVED_TWO.length);
    });
  }

  test("reset asks for confirmation and cancels without data loss", async ({
    page,
  }) => {
    await openBackupPage(page);

    const resetSection = section(page, "backup-reset-title");
    await expect(
      resetSection.getByText("פעולה בלתי הפיכה"),
    ).toBeVisible();

    const resetButton = resetSection.locator("button.app-btn-danger");
    await expect(resetButton).toHaveText("איפוס הכל");
    await resetButton.click();

    /* Confirmation state. */
    await expect(resetButton).toHaveText("לחצו שוב לאישור");
    await expect(
      resetSection.getByText("לחיצה נוספת תמחק את כל 2 השדות שנערכו"),
    ).toBeVisible();

    /* Cancel path keeps everything. */
    await resetSection.getByRole("button", { name: "ביטול" }).click();
    await expect(resetButton).toHaveText("איפוס הכל");
    await expect(savedBadge(page)).toHaveText("2 שדות שנערכו");
    expect(await siteContentRows(page)).toBe(SAVED_TWO.length);
  });

  test("reset confirmed on second click restores registry defaults", async ({
    page,
  }) => {
    await openBackupPage(page);

    const resetButton = section(
      page,
      "backup-reset-title",
    ).locator("button.app-btn-danger");

    await resetButton.click();
    await resetButton.click();

    /* Saved content emptied; export fell back to its disabled hint state. */
    await expect(savedBadge(page)).toHaveText("0 שדות שנערכו");
    expect(await siteContentRows(page)).toBe(0);
    await expect(statValues(page).nth(1)).toHaveText("0");

    const exportButton = section(page, "backup-export-title").getByRole(
      "button",
    );
    await expect(exportButton).toBeDisabled();
    await expect(
      page.getByText("אין תוכן שנערך לייצוא - כל השדות כבר בברירת המחדל."),
    ).toBeVisible();
  });
})
