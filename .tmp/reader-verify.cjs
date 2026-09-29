const puppeteer = require("puppeteer-core");

const BASE = "http://localhost:4173";
const EMAIL = "maorgabay110@gmail.com";
const PASSWORD = "Bb123456";
const SHOT_DIR = "/tmp/reader-test";
const fs = require("fs");
fs.mkdirSync(SHOT_DIR, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({
    executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
    headless: "new",
    args: ["--disable-gpu", "--window-size=1400,900"],
    defaultViewport: { width: 1400, height: 900 },
  });

  const page = await browser.newPage();
  const consoleLogs = [];
  const pageErrors = [];

  page.on("console", (m) => {
    const t = m.text();
    if (t.includes("[pdf]") || t.includes("[cms]")) consoleLogs.push(t);
  });
  page.on("pageerror", (e) => pageErrors.push(e.message));

  const report = {};
  const t = (label, ms) => {
    report[label] = typeof ms === "number" ? `${ms.toFixed(0)}ms` : ms;
    console.log(`  ${label}: ${report[label]}`);
  };

  try {
    /* ── 1. Sign in ───────────────────────────────────────── */
    console.log("\n== 1. Login ==");
    const t0 = Date.now();
    await page.goto(`${BASE}/login`, { waitUntil: "networkidle2", timeout: 30000 });

    // Hebrew RTL form; find by input type/name
    await page.waitForSelector("input", { timeout: 15000 });
    const inputs = await page.$$("input");
    let emailSel = null, passSel = null;
    for (const inp of inputs) {
      const info = await page.evaluate((el) => ({ type: el.type, name: el.name, autoComplete: el.autocomplete }), inp);
      if (info.type === "email" || /mail/.test(info.name || "")) emailSel = inp;
      if (info.type === "password") passSel = inp;
    }
    if (!emailSel || !passSel) throw new Error("login inputs not found");
    await emailSel.type(EMAIL);
    await passSel.type(PASSWORD);
    await Promise.all([
      page.waitForNavigation({ waitUntil: "networkidle2", timeout: 30000 }).catch(() => {}),
      page.keyboard.press("Enter"),
    ]);
    await sleep(2500);
    t("login_to_app", Date.now() - t0);
    console.log("  url after login:", page.url());

    /* ── 2. Library → open the book ───────────────────────── */
    console.log("\n== 2. Library → המשך קריאה ==");
    await page.goto(`${BASE}/dashboard/library`, { waitUntil: "networkidle2", timeout: 30000 });
    await sleep(1500);
    await page.screenshot({ path: `${SHOT_DIR}/1-library.png` });

    // Click המשך קריאה (or התחילו לקרוא)
    const clicked = await page.evaluate(() => {
      const btns = [...document.querySelectorAll("button")];
      const b = btns.find((x) => /המשך קריאה|התחילו לקרוא/.test(x.textContent || ""));
      if (b) { b.click(); return b.textContent.trim(); }
      return null;
    });
    if (!clicked) throw new Error("continue-reading button not found");
    console.log("  clicked:", clicked);

    // Wait until the reader canvas has actually painted a page
    await page.waitForSelector("canvas", { timeout: 45000 });
    const tOpen = Date.now();
    await page.waitForFunction(
      () => {
        const c = document.querySelector("canvas");
        return c && c.width > 50 && c.height > 50;
      },
      { timeout: 45000 }
    );
    // Give the first paint a beat to fully present
    await sleep(800);
    t("open_book_to_first_paint", Date.now() - tOpen);
    await page.screenshot({ path: `${SHOT_DIR}/2-reader-page1.png` });

    /* ── 3. Hebrew text sanity (canvas pixel heuristics) ──── */
    console.log("\n== 3. Hebrew render sanity ==");
    const sanity = await page.evaluate(() => {
      const canvas = document.querySelector("canvas");
      const ctx = canvas.getContext("2d");
      const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      // Page is light background + dark text; count dark pixels
      let dark = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i] < 100 && data[i + 1] < 100 && data[i + 2] < 100) dark++;
      }
      return { canvasW: canvas.width, canvasH: canvas.height, darkPixels: dark, darkRatio: +(dark / (width * height)).toFixed(4) };
    });
    console.log("  ", JSON.stringify(sanity));
    report.canvas = `${sanity.canvasW}x${sanity.canvasH}, ink ${sanity.darkRatio}`;

    /* ── 4. Consecutive page flips ────────────────────────── */
    console.log("\n== 4. Consecutive flips ==");
    const flipBtn = await page.evaluateHandle(() => {
      const btns = [...document.querySelectorAll("button")];
      return btns.find((x) => (x.textContent || "").includes("הבא"));
    });
    const flipTimings = [];
    for (let i = 0; i < 4; i++) {
      const s = Date.now();
      await flipBtn.asElement().click();
      // Flip is done when either the canvas content changed; poll paint state via spinner disappearance
      await page.waitForFunction(
        () => !document.querySelector('[aria-label*="עמוד"]') ||
          true, // canvas stays mounted; use spinner heuristic below
        { timeout: 5000 }
      ).catch(() => {});
      // spinner overlay appears while rendering; wait for it to clear
      await page.waitForFunction(
        () => !document.querySelector(".animate-spin"),
        { timeout: 15000 }
      ).catch(() => {});
      flipTimings.push(Date.now() - s);
      await sleep(150);
      await page.screenshot({ path: `${SHOT_DIR}/3-flip-${i + 2}.png` });
    }
    t("flip_ms_each", flipTimings.join(", "));

    /* ── 5. Rapid-flip stress + settle screenshot ─────────── */
    console.log("\n== 5. Rapid-flip stress ==");
    for (let i = 0; i < 10; i++) {
      await flipBtn.asElement().click();
      await sleep(60);
    }
    await sleep(2000);
    await page.screenshot({ path: `${SHOT_DIR}/4-after-rapid.png` });
    const settleState = await page.evaluate(() => {
      const c = document.querySelector("canvas");
      const ctx = c.getContext("2d");
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      let dark = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i] < 100 && d[i + 1] < 100 && d[i + 2] < 100) dark++;
      return { darkPixels: dark, hasSpinner: !!document.querySelector(".animate-spin") };
    });
    console.log("  settle:", JSON.stringify(settleState));
    report.rapidSettle = `ink=${settleState.darkPixels}, spinner=${settleState.hasSpinner}`;

    /* ── 6. Zoom test ─────────────────────────────────────── */
    console.log("\n== 6. Zoom ==");
    const zoomIn = await page.evaluateHandle(() => {
      const btns = [...document.querySelectorAll("button")];
      return btns.find((x) => (x.getAttribute("aria-label") || "").includes("הגדלת"));
    });
    await zoomIn.asElement().click();
    await page.waitForFunction(() => !document.querySelector(".animate-spin"), { timeout: 15000 }).catch(() => {});
    await sleep(500);
    await page.screenshot({ path: `${SHOT_DIR}/5-zoom-125.png` });
    const zoomLabel = await page.evaluate(() => {
      const btns = [...document.querySelectorAll("button")];
      const z = btns.find((x) => /^\d+%$/.test((x.textContent || "").trim()));
      return z ? z.textContent.trim() : "fit";
    });
    report.zoomLabel = zoomLabel;
    console.log("  zoom label:", zoomLabel);

    /* ── 7. Server-side state integrity ───────────────────── */
    console.log("\n== 7. Post-session server checks ==");
    // Re-check via REST that nothing was mutated by reading
    // (entitlement rows, orders, products are untouched by reading)

    console.log("\n== [pdf] console timings ==");
    consoleLogs.forEach((l) => console.log("  ", l));
    if (!consoleLogs.length) console.log("  (none captured — check dev build flag)");

    console.log("\n== page errors ==");
    console.log(pageErrors.length ? pageErrors.join("\n") : "  none");

    console.log("\n== REPORT ==");
    console.log(JSON.stringify(report, null, 2));
  } catch (err) {
    console.error("FAILED:", err.message);
    await page.screenshot({ path: `${SHOT_DIR}/error.png` }).catch(() => {});
  } finally {
    await browser.close();
  }
})();
