/* ─────────────────────────────────────────────────────────────
 * Reader state QA — /read/:productId under every content outcome.
 *
 * The reader defect was not a wrong string, it was one screen claiming
 * several different things: a lookup still in flight, a storage outage and a
 * genuinely missing file were all reported to a paying customer as "the
 * publisher has not uploaded the copy yet". This drives each outcome through
 * the real application — real router, real grant effect, real PDF parser —
 * and asserts what the customer is actually told.
 *
 *   node scripts/verify-reader-content-states.cjs
 *
 * Reads and writes nothing in the repository: the throwaway Chrome profile
 * lives in the OS temp directory and the report lands in ignored `.tmp/`.
 *
 * Local only: the auth backend is a local process with no mail transport,
 * the "book" is a generated one-page PDF, and no request can reach an inbox
 * or a real project.
 * ───────────────────────────────────────────────────────────── */

const { spawn } = require("node:child_process")
const path = require("node:path")
const os = require("node:os")
const fs = require("node:fs")

const MOCK_PORT = Number(process.env.MOCK_PORT || 9303)
const APP_PORT = Number(process.env.APP_PORT || 5303)
const CDP_PORT = Number(process.env.CDP_PORT || 9336)
const APP = `http://127.0.0.1:${APP_PORT}`
const MOCK = `http://127.0.0.1:${MOCK_PORT}`
const ROOT = path.resolve(__dirname, "..")
const PROFILE = path.join(os.tmpdir(), "casanova-reader-qa-profile")
const CHROME =
  process.env.CHROME_PATH ||
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const children = []

function run(cmd, args, opts) {
  const child = spawn(cmd, args, { cwd: ROOT, ...opts })
  for (const s of [child.stdout, child.stderr]) if (s) s.on("data", () => {})
  children.push(child)
  return child
}

async function waitFor(label, probe, tries = 80) {
  for (let i = 0; i < tries; i += 1) {
    try {
      if (await probe()) return
    } catch {
      /* not up yet */
    }
    await sleep(500)
  }
  throw new Error(`${label} did not come up`)
}

let cdp
let nextId = 0
const pending = new Map()

function cdpSend(method, params = {}) {
  return new Promise((resolve) => {
    nextId += 1
    pending.set(nextId, resolve)
    cdp.send(JSON.stringify({ id: nextId, method, params }))
  })
}

async function connectCdp() {
  const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json`)).json()
  const page = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl)
  if (!page) throw new Error("no page target")
  await new Promise((resolve, reject) => {
    cdp = new WebSocket(page.webSocketDebuggerUrl)
    cdp.onopen = resolve
    cdp.onerror = () => reject(new Error("cdp socket failed"))
    cdp.onmessage = (event) => {
      const msg = JSON.parse(event.data)
      if (msg.id && pending.has(msg.id)) {
        pending.get(msg.id)(msg)
        pending.delete(msg.id)
      }
    }
  })
  await cdpSend("Page.enable")
  await cdpSend("Runtime.enable")
  /* The shipped CSP is connect-src 'self' https://*.supabase.co and is NOT
   * relaxed for the test: the mock lives on 127.0.0.1, so the DevTools session
   * ignores CSP. Nothing in the bundle or vercel.json changes. */
  await cdpSend("Page.setBypassCSP", { enabled: true })
}

async function evaluate(expression) {
  const res = await cdpSend("Runtime.evaluate", {
    expression: `(async () => { ${expression} })()`,
    awaitPromise: true,
    returnByValue: true,
  })
  if (res.exceptionDetails || (res.result && res.result.exceptionDetails)) {
    throw new Error(
      JSON.stringify(res.exceptionDetails || res.result.exceptionDetails).slice(0, 400),
    )
  }
  return res.result && res.result.result ? res.result.result.value : undefined
}

const SNAP = `
  const txt = (el) => (el ? el.textContent.replace(/\\s+/g, " ").trim() : "")
  return JSON.stringify({
    path: location.pathname,
    /* The watermark layer repeats the account name across the whole reader,
     * so body.innerText is useless for asserting copy. Read the elements that
     * actually carry the message instead. */
    headings: Array.from(document.querySelectorAll("main h1, main h2")).map((e) => txt(e)),
    paras: Array.from(document.querySelectorAll("main p")).map((e) => txt(e)),
    buttons: Array.from(document.querySelectorAll("main button, main a")).map((e) => txt(e)),
    probe: JSON.stringify({
      mains: document.querySelectorAll("main").length,
      h1: Array.from(document.querySelectorAll("h1")).map((e) => txt(e)),
      p: Array.from(document.querySelectorAll("p")).map((e) => txt(e)).slice(0, 6),
      btn: Array.from(document.querySelectorAll("button,a")).map((e) => txt(e)).slice(0, 12),
    }),
    body: document.body.innerText.replace(/\\s+/g, " "),
    canvas: Boolean(document.querySelector("canvas")),
    retry: Array.from(document.querySelectorAll("button")).some((b) =>
      (b.textContent || "").includes("ניסיון נוסף"),
    ),
  })
`

async function goto(url) {
  await cdpSend("Page.navigate", { url })
  await waitFor(`navigation to ${url}`, async () => (await evaluate("return document.readyState")) === "complete", 60)
  await sleep(500)
}

async function snap() {
  return JSON.parse(await evaluate(SNAP))
}

async function until(pred, ms = 15000) {
  const deadline = Date.now() + ms
  let last = await snap()
  while (Date.now() < deadline) {
    if (pred(last)) return last
    await sleep(300)
    last = await snap()
  }
  return last
}

const results = []
/* Reports go to the ignored scratch directory, never next to the sources —
 * running the suite must not leave the tree dirty. */
const DEBUG = path.join(ROOT, ".tmp", "reader-states-debug.txt")
fs.writeFileSync(DEBUG, "", "utf8")

function expect(name, ok, detail) {
  results.push({ name, ok: Boolean(ok) })
  fs.appendFileSync(DEBUG, `${ok ? "PASS" : "FAIL"}  ${name}\n  ${String(detail).slice(0, 600)}\n\n`, "utf8")
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`)
}

const CHECKING = "פותח את הספר…"
/* Set once the mock's product id is read; module scope so the helpers below
 * can navigate with it. */
let READ = ""
const MISSING_HEAD = "התוכן טרם הועלה"
const REFUSED_HEAD = "הקישור לתוכן לא אושר"
const MISSING_CLAIM = "עדיין לא הוצמד עותק דיגיטלי"

/** Search the message-bearing elements only, never the watermark. */
const said = (s, needle) =>
  [...(s.headings || []), ...(s.paras || []), ...(s.buttons || []), s.probe || ""].some((t) =>
    t.includes(needle),
  )

async function setScenario(s) {
  await fetch(`${MOCK}/__/scenario`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(s),
  })
}

/* Every scenario needs a clean document: `issueContentGrant` reuses a live
 * STREAM grant for the same account, product and device rather than asking
 * the server again — correct behaviour in production, and it would otherwise
 * make every scenario after the first one test a cached answer. */
async function signInAndOpen(scenario) {
  await goto(`${APP}/`)
  await evaluate("localStorage.clear(); sessionStorage.clear(); return 1")
  await setScenario({
    login: "confirmed",
    profile: true,
    profilePhone: null,
    entitlement: true,
    content: "ok",
    ...scenario,
  })
  await goto(`${APP}/login`)
  await evaluate(`
    const set = (id, v) => {
      const el = document.getElementById(id)
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, v)
      el.dispatchEvent(new Event("input", { bubbles: true }))
    }
    set("auth-email", "shopper@test.invalid")
    set("auth-password", "Passw0rd1")
    document.querySelector('button[type="submit"]').click()
    return "sent"
  `)
  await until((x) => x.path !== "/login", 10000)
  await goto(READ)
}

async function main() {
  const mockSrc = fs.readFileSync(path.join(__dirname, "mock-supabase.cjs"), "utf8")
  const productId = /const PRODUCT_ID = "([^"]+)"/.exec(mockSrc)[1]
  if (!/^[0-9a-fA-F-]{36}$/.test(productId)) throw new Error(`PRODUCT_ID is not a uuid: ${productId}`)
  READ = `${APP}/read/${productId}`

  run(process.execPath, [path.join(__dirname, "mock-supabase.cjs"), String(MOCK_PORT)], { stdio: "ignore" })
  await waitFor("mock", async () => (await fetch(`${MOCK}/__/state`)).ok)

  run(
    process.execPath,
    [path.join(ROOT, "node_modules", "vite", "bin", "vite.js"), "--host", "127.0.0.1", "--port", String(APP_PORT), "--strictPort"],
    {
      stdio: "ignore",
      env: { ...process.env, VITE_SUPABASE_URL: MOCK, VITE_SUPABASE_ANON_KEY: "mock-anon-key-not-a-secret" },
    },
  )
  await waitFor("vite", async () => (await fetch(APP)).ok)

  run(CHROME, ["--headless=new", `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${PROFILE}`, "--no-first-run", "--no-default-browser-check", "--disable-gpu", "--window-size=1200,900", "about:blank"], { stdio: "ignore" })
  await waitFor("chrome", async () => (await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)).ok)
  await connectCdp()

  /* ── sign an entitled customer in ─────────────────────────── */
  await goto(`${APP}/`)
  await evaluate("localStorage.clear(); sessionStorage.clear(); return 1")
  await setScenario({ login: "confirmed", profile: true, profilePhone: null, entitlement: true, content: "ok" })
  await goto(`${APP}/login`)
  await evaluate(`
    const set = (id, v) => {
      const el = document.getElementById(id)
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, v)
      el.dispatchEvent(new Event("input", { bubbles: true }))
    }
    set("auth-email", "shopper@test.invalid")
    set("auth-password", "Passw0rd1")
    document.querySelector('button[type="submit"]').click()
    return "sent"
  `)
  const signedIn = await until((s) => s.path !== "/login", 10000)
  expect("R0 the harness account signs in", signedIn.path !== "/login", JSON.stringify(signedIn))

  /* ── 1. entitled + content available ──────────────────────── */
  await goto(READ)
  let s = await until((x) => x.canvas || said(x, MISSING_HEAD) || said(x, REFUSED_HEAD), 15000)
  expect("R1.1 a valid entitlement with an available file reaches the document", s.canvas === true, JSON.stringify(s))
  expect("R1.2 and no diagnostic claim is shown", !said(s, MISSING_CLAIM) && !said(s, CHECKING) && !said(s, REFUSED_HEAD), JSON.stringify({ h: s.headings, p: s.paras }))

  /* ── 2. genuinely missing file (the server's own 404) ─────── */
  await signInAndOpen({ content: "missing" })
  s = await until((x) => said(x, MISSING_HEAD), 15000)
  expect("R2.1 a server 404 is reported as content not uploaded", said(s, MISSING_HEAD) && said(s, MISSING_CLAIM), s.probe)
  expect("R2.2 and it is accurate, so support is offered", said(s, "פנייה לתמיכה"), JSON.stringify({ b: s.buttons }))

  /* ── 3. access refused (403) ──────────────────────────────── */
  await signInAndOpen({ content: "forbidden" })
  s = await until((x) => said(x, REFUSED_HEAD), 15000)
  expect("R3.1 an access refusal is named as a refusal", said(s, REFUSED_HEAD), JSON.stringify({ h: s.headings, p: s.paras }))
  expect("R3.2 and is NOT dressed up as a missing upload", !said(s, MISSING_CLAIM), JSON.stringify({ h: s.headings, p: s.paras }))

  /* ── 4. session expired (401) ─────────────────────────────── */
  await signInAndOpen({ content: "expired" })
  s = await until((x) => said(x, REFUSED_HEAD) || x.path === "/login", 15000)
  expect("R4.1 an expired credential says sign in again", said(s, "תוקף ההתחברות פג"), JSON.stringify({ h: s.headings, p: s.paras }))
  expect("R4.2 and does not blame the catalogue", !said(s, MISSING_CLAIM), JSON.stringify({ h: s.headings, p: s.paras }))

  /* ── 5. server outage (500, English body) ─────────────────── */
  await signInAndOpen({ content: "outage" })
  s = await until((x) => said(x, REFUSED_HEAD), 15000)
  expect("R5.1 a storage outage is offered a retry", s.retry === true, JSON.stringify({ h: s.headings, p: s.paras, b: s.buttons }))
  expect("R5.2 the provider's English never reaches the screen", !/Could not sign|content URL/i.test(s.body), JSON.stringify({ p: s.paras }))
  expect("R5.3 an outage is not reported as a missing file", !said(s, MISSING_CLAIM), JSON.stringify({ h: s.headings, p: s.paras }))

  /* ── 6. transport failure (non-JSON 502) ──────────────────── */
  await signInAndOpen({ content: "throw" })
  s = await until((x) => said(x, REFUSED_HEAD), 15000)
  expect("R6.1 a request with no usable answer is Hebrew and generic", said(s, "לא ניתן היה לפתוח את הקובץ"), JSON.stringify({ h: s.headings, p: s.paras }))
  expect("R6.2 and does not claim the file is missing", !said(s, MISSING_CLAIM), JSON.stringify({ h: s.headings, p: s.paras }))

  /* ── 7. the in-flight window (the actual regression) ──────── */
  await signInAndOpen({ content: "delay" })
  s = await until((x) => said(x, CHECKING) || x.canvas, 4000)
  expect("R7.1 while the lookup is in flight the reader says it is checking", said(s, CHECKING), JSON.stringify({ h: s.headings, p: s.paras }))
  expect("R7.2 and makes no claim about an upload", !said(s, MISSING_CLAIM) && !said(s, MISSING_HEAD), JSON.stringify({ h: s.headings, p: s.paras }))
  expect("R7.3 and does not send the customer to support yet", !said(s, "פנייה לתמיכה"), JSON.stringify({ b: s.buttons }))
  /* …and the same screen resolves on its own once the answer arrives. */
  s = await until((x) => x.canvas, 12000)
  expect("R7.4 the reader resolves into the document without a reload", s.canvas === true, JSON.stringify({ h: s.headings, canvas: s.canvas }))

  /* ── 8. no entitlement at all ─────────────────────────────── */
  await signInAndOpen({ entitlement: false, content: "ok" })
  s = await until((x) => x.path !== `/read/${productId}`, 12000)
  expect("R8.1 an unentitled visitor is redirected, not told the file is missing", !said(s, MISSING_CLAIM), JSON.stringify({ path: s.path, h: s.headings }))

  fs.writeFileSync(
    path.join(ROOT, ".tmp", "reader-states-qa.json"),
    JSON.stringify({ at: new Date().toISOString(), results }, null, 2),
    "utf8",
  )

  const failed = results.filter((r) => !r.ok)
  console.log(`\n${results.length - failed.length}/${results.length} reader-state assertions passed`)
  process.exitCode = failed.length ? 1 : 0
}

main()
  .catch((err) => {
    console.log("READER QA ERROR:", err && err.message)
    process.exitCode = 2
  })
  .finally(() => {
    for (const c of children) {
      try {
        c.kill()
      } catch {
        /* already gone */
      }
    }
  })
