const puppeteer = require("puppeteer-core");
const BASE = "http://localhost:4173";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const browser = await puppeteer.launch({
    executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
    headless: "new",
    args: ["--disable-gpu"],
    defaultViewport: { width: 1400, height: 900 },
  });
  const page = await browser.newPage();
  const logs = [];
  page.on("console", (m) => logs.push(`${m.type()}: ${m.text()}`));
  page.on("pageerror", (e) => logs.push("PAGEERROR: " + e.message));
  page.on("requestfailed", (r) => logs.push("REQFAIL: " + r.url().slice(0, 120) + " " + (r.failure()?.errorText || "")));
  page.on("response", (r) => { if (r.status() >= 400) logs.push(`HTTP ${r.status()}: ` + r.url().slice(0, 140)); });

  // login
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle2", timeout: 30000 });
  await page.waitForSelector("input");
  const inputs = await page.$$("input");
  for (const inp of inputs) {
    const info = await page.evaluate((el) => el.type, inp);
    if (info === "email") await inp.type("maorgabay110@gmail.com");
    if (info === "password") await inp.type("Bb123456");
  }
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle2", timeout: 30000 }).catch(() => {}),
    page.keyboard.press("Enter"),
  ]);
  await sleep(2000);

  // go straight to the reader for the known product id
  await page.goto(`${BASE}/read/9f1c2d3e-4a5b-4c6d-8e7f-0a1b2c3d4e5f`, { waitUntil: "networkidle2", timeout: 30000 });
  await sleep(8000);
  const state = await page.evaluate(() => {
    const text = document.body.innerText.slice(0, 800);
    const canvases = document.querySelectorAll("canvas").length;
    return { url: location.href, text, canvases };
  });
  console.log("URL:", state.url);
  console.log("CANVASES:", state.canvases);
  console.log("PAGE TEXT:\n" + state.text);
  console.log("\nLOGS:");
  logs.forEach((l) => console.log("  " + l.slice(0, 200)));
  await page.screenshot({ path: "/tmp/reader-test/diag-reader.png" });
  await browser.close();
})();
