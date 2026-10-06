/**
 * Automated accessibility audit.
 *
 * Runs axe-core (deque) against the public routes of a running build, once with
 * the settings panel open and — with A11Y_ALL_SETTINGS=1 — again with every
 * accessibility preference enabled at 160% text. It also reports the structural
 * facts this project now guarantees: one accessibility interface, one `<main>`,
 * the skip link, one `<nav>`, one `<h1>` and no duplicate ids.
 *
 * Usage:
 *   npm pack axe-core && tar -xzf axe-core-*.tgz   # or: pnpm add -D axe-core
 *   AXE_PATH=package/axe.min.js \
 *   A11Y_URL=http://127.0.0.1:4199 node scripts/audit-accessibility.mjs
 *
 * Environment:
 *   A11Y_URL           base URL of the running site (default http://127.0.0.1:4199)
 *   A11Y_ROUTES        comma-separated routes without a leading slash
 *                      (default: storefront, store, checkout, support, auth, legal)
 *   A11Y_ALL_SETTINGS  set to any value to enable every preference before auditing
 *   AXE_PATH           path to axe.min.js (default node_modules/axe-core/axe.min.js)
 *   A11Y_DEBUG_PORT    Chrome DevTools port (default 9403)
 *   CHROME_PATH        path to the Chrome binary, if it is not in a standard place
 *
 * What this cannot do: axe covers roughly a third of WCAG's success criteria.
 * Zero violations is not a compliance statement — see docs/ACCESSIBILITY.md.
 */

import { spawn } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"

const BASE = process.env.A11Y_URL || "http://127.0.0.1:4199"
const DEBUG_PORT = Number(process.env.A11Y_DEBUG_PORT || 9403)
const AXE_PATH = process.env.AXE_PATH || "node_modules/axe-core/axe.min.js"

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  `${process.env.LOCALAPPDATA || ""}\\Google\\Chrome\\Application\\chrome.exe`,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].filter(Boolean)

const DEFAULT_ROUTES = [
  "",
  "store",
  "checkout",
  "support",
  "login",
  "register",
  "forgot-password",
  "terms-and-conditions",
]

const ROUTES = (
  process.env.A11Y_ROUTES ? process.env.A11Y_ROUTES.split(",") : DEFAULT_ROUTES
).map((route) => (route.startsWith("/") ? route : `/${route}`))

const sleep = (ms) =>
  new Promise((resolvePromise) => setTimeout(resolvePromise, ms))

async function getPageSocketUrl() {
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      const targets = await (
        await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)
      ).json()
      const page = targets.find((target) => target.type === "page")
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl
    } catch {
      /* Chrome is still starting. */
    }
    await sleep(250)
  }
  throw new Error("Chrome's debug endpoint never came up")
}

async function main() {
  const chromePath = CHROME_CANDIDATES.find((candidate) =>
    existsSync(candidate),
  )
  if (!chromePath) throw new Error("Chrome not found; set CHROME_PATH")
  if (!existsSync(AXE_PATH)) {
    throw new Error(
      `axe-core not found at ${AXE_PATH}; set AXE_PATH (see the header of this file)`,
    )
  }
  const axeSource = readFileSync(AXE_PATH, "utf8")

  const chrome = spawn(
    chromePath,
    [
      "--headless=new",
      `--remote-debugging-port=${DEBUG_PORT}`,
      `--user-data-dir=${resolve(".tmp/chrome-axe")}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-gpu",
      "--window-size=1280,900",
      "about:blank",
    ],
    { stdio: "ignore" },
  )

  let totalViolationNodes = 0

  try {
    const ws = new WebSocket(await getPageSocketUrl())
    await new Promise((resolvePromise, reject) => {
      ws.addEventListener("open", resolvePromise, { once: true })
      ws.addEventListener("error", reject, { once: true })
    })

    let id = 0
    const pending = new Map()
    const pageErrors = []
    ws.addEventListener("message", (event) => {
      const message = JSON.parse(event.data)
      if (message.method === "Runtime.exceptionThrown") {
        pageErrors.push(
          `EXCEPTION ${message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text}`,
        )
      }
      if (
        message.method === "Runtime.consoleAPICalled" &&
        message.params.type === "error"
      ) {
        pageErrors.push(
          `CONSOLE ${message.params.args.map((arg) => arg.value ?? arg.description).join(" ")}`,
        )
      }
      if (message.id && pending.has(message.id)) {
        const { resolve: resolvePromise, reject } = pending.get(message.id)
        pending.delete(message.id)
        if (message.error) reject(new Error(JSON.stringify(message.error)))
        else resolvePromise(message.result)
      }
    })
    const send = (method, params = {}) => {
      const messageId = ++id
      return new Promise((resolvePromise, reject) => {
        pending.set(messageId, { resolve: resolvePromise, reject })
        ws.send(JSON.stringify({ id: messageId, method, params }))
      })
    }
    const evaluate = async (expression) => {
      const result = await send("Runtime.evaluate", {
        expression,
        returnByValue: true,
        awaitPromise: true,
      })
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.text)
      return result.result.value
    }

    await send("Page.enable")
    await send("Runtime.enable")
    /* Injected through CDP rather than a <script> tag, so the page's own CSP
     * cannot refuse it, and re-injected on every navigation. */
    await send("Page.addScriptToEvaluateOnNewDocument", { source: axeSource })

    for (const route of ROUTES) {
      await send("Page.navigate", { url: `${BASE}${route}` })
      for (let attempt = 0; attempt < 60; attempt++) {
        const mounted = await evaluate(
          `!!document.getElementById('root')?.children.length`,
        ).catch(() => false)
        if (mounted) break
        await sleep(400)
      }
      await sleep(1200)

      /* Open the panel so its own contrast and semantics are audited in the
       * state a visitor can actually reach. */
      await evaluate(
        `document.getElementById('accessibility-launcher')?.click()`,
      )
      await sleep(600)
      if (process.env.A11Y_ALL_SETTINGS) {
        await evaluate(`
          (() => {
            const panel = document.getElementById('accessibility-panel')
            if (!panel) return
            panel.querySelectorAll('.a11y-tile[aria-pressed=false]').forEach((tile) => {
              tile.click()
            })
            const increase = Array.from(panel.querySelectorAll('.a11y-button')).find((button) =>
              (button.getAttribute('aria-label') || '').startsWith('הגדל'),
            )
            for (let press = 0; press < 6; press++) increase.click()
          })()
        `)
        await sleep(1200)
      }

      if ((await evaluate(`typeof axe !== 'undefined'`)) !== true) {
        console.log(`\n=== ${route || "/"} ===\n  (axe did not load)`)
        continue
      }

      const audit = await evaluate(`
        (async () => {
          const result = await axe.run(document, {
            resultTypes: ['violations', 'incomplete'],
            runOnly: {
              type: 'tag',
              values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'],
            },
          })
          return {
            path: location.pathname,
            violations: result.violations.map((violation) => ({
              id: violation.id,
              impact: violation.impact,
              help: violation.help,
              nodes: violation.nodes.length,
              targets: violation.nodes.slice(0, 3).map((node) => node.target.join(' ')),
            })),
            contrastToReview: result.incomplete
              .filter((item) => item.id === 'color-contrast')
              .flatMap((item) => item.nodes.map((node) => node.target.join(' '))),
          }
        })()
      `)

      const structure = await evaluate(`
        (() => {
          const ids = Array.from(document.querySelectorAll('[id]')).map((element) => element.id)
          const duplicates = ids.filter((value, index) => ids.indexOf(value) !== index)
          return {
            launchers: document.querySelectorAll('#accessibility-launcher').length,
            panels: document.querySelectorAll('#accessibility-panel').length,
            settingsEntryPoints: document.querySelectorAll('[data-a11y-restore], .a11y-footer-link').length,
            mainLandmarks: document.querySelectorAll('main, [role="main"]').length,
            mainHasId: !!document.getElementById('main'),
            skipLink: !!document.querySelector('.skip-link'),
            navLandmarks: document.querySelectorAll('nav').length,
            h1: document.querySelectorAll('h1').length,
            duplicateIds: [...new Set(duplicates)],
          }
        })()
      `)
      const structureOk =
        structure.launchers === 1 &&
        structure.mainLandmarks === 1 &&
        structure.mainHasId &&
        structure.h1 === 1 &&
        structure.duplicateIds.length === 0

      console.log(`\n=== ${audit.path} ===`)
      console.log(
        `  structure: ${
          structureOk ? "ok" : "REVIEW"
        } :: launcher=${structure.launchers} panel=${structure.panels} ` +
          `entryPoints=${structure.settingsEntryPoints} main=${structure.mainLandmarks} mainId=${structure.mainHasId} ` +
          `skipLink=${structure.skipLink} nav=${structure.navLandmarks} h1=${structure.h1} ` +
          `dupIds=${JSON.stringify(structure.duplicateIds)}`,
      )
      console.log(
        `  settings audited: ${await evaluate(
          `Array.from(document.documentElement.attributes).filter((attribute) => attribute.name.startsWith('data-a11y-') && attribute.value === 'true').length + ' enabled, font ' + (document.documentElement.style.fontSize || '100%')`,
        )}`,
      )
      if (audit.violations.length === 0) {
        console.log("  no axe violations")
      }
      for (const violation of audit.violations) {
        totalViolationNodes += violation.nodes
        console.log(
          `  ${violation.impact} :: ${violation.id} (${violation.nodes}) — ${violation.help}`,
        )
        for (const target of violation.targets) console.log(`      ${target}`)
      }
      for (const target of audit.contrastToReview) {
        console.log(
          `  contrast needs a human eye (gradient background): ${target}`,
        )
      }
      if (pageErrors.length) {
        console.log("  page errors:")
        for (const error of pageErrors.slice(0, 5))
          console.log(`    ${error.slice(0, 200)}`)
        pageErrors.length = 0
      }
    }
  } finally {
    chrome.kill()
  }

  console.log(`\nTOTAL AXE VIOLATION NODES: ${totalViolationNodes}`)
  process.exit(totalViolationNodes ? 1 : 0)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
