/**
 * Runtime verification of the accessibility system.
 *
 * Drives Chrome over CDP (no test framework is installed in this repo) against
 * a running build and asserts the behaviour a keyboard or screen-reader user
 * depends on: one interface only, launcher semantics, panel positioning and
 * focus handling, Escape, Tab containment, every preference, hiding and
 * restoring, persistence across reloads, and that the floating control does not
 * sit on top of interactive page content.
 *
 * Usage:
 *   npx vite build && npx vite preview --port 4199
 *   A11Y_URL=http://127.0.0.1:4199 node scripts/verify-accessibility.mjs
 *
 * Environment:
 *   A11Y_URL          base URL of the running site (default http://127.0.0.1:4199)
 *   A11Y_DEBUG_PORT   Chrome DevTools port (default 9333)
 *   CHROME_PATH       path to the Chrome binary, if it is not in a standard place
 */

import { spawn } from "node:child_process"
import { existsSync } from "node:fs"

const BASE = process.env.A11Y_URL || "http://127.0.0.1:4199"
const DEBUG_PORT = Number(process.env.A11Y_DEBUG_PORT || 9333)

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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const results = []

function check(name, pass, detail = "") {
  results.push({ name, pass })
  console.log(
    `${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` :: ${detail}` : ""}`,
  )
}

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

class Cdp {
  constructor(ws) {
    this.ws = ws
    this.id = 0
    this.pending = new Map()
    ws.addEventListener("message", (event) => {
      const message = JSON.parse(event.data)
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id)
        this.pending.delete(message.id)
        if (message.error) reject(new Error(JSON.stringify(message.error)))
        else resolve(message.result)
      }
    })
  }

  send(method, params = {}) {
    const id = ++this.id
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }

  async eval(expression) {
    const result = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    })
    if (result.exceptionDetails) {
      throw new Error(`eval failed: ${result.exceptionDetails.text}`)
    }
    return result.result.value
  }

  async key(key, code, options = {}) {
    const text =
      options.text ?? (key.length === 1 && !options.modifiers ? key : undefined)
    const base = {
      key,
      code,
      windowsVirtualKeyCode: options.vk ?? 0,
      nativeVirtualKeyCode: options.vk ?? 0,
      modifiers: options.modifiers ?? 0,
      text,
      unmodifiedText: text,
    }
    await this.send("Input.dispatchKeyEvent", { type: "keyDown", ...base })
    await this.send("Input.dispatchKeyEvent", { type: "keyUp", ...base })
  }

  async waitFor(expression, label, attempts = 120) {
    for (let attempt = 0; attempt < attempts; attempt++) {
      const found = await this.eval(expression).catch(() => false)
      if (found) return true
      await sleep(500)
    }
    console.log(`  (timed out waiting for ${label})`)
    return false
  }
}

async function main() {
  const chromePath = CHROME_CANDIDATES.find((candidate) =>
    existsSync(candidate),
  )
  if (!chromePath) throw new Error("Chrome not found; set CHROME_PATH")

  const chrome = spawn(
    chromePath,
    [
      "--headless=new",
      `--remote-debugging-port=${DEBUG_PORT}`,
      `--user-data-dir=${process.cwd()}/.tmp/chrome-verify`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-gpu",
      "--window-size=1280,900",
      "about:blank",
    ],
    { stdio: "ignore" },
  )

  try {
    const ws = new WebSocket(await getPageSocketUrl())
    await new Promise((resolve, reject) => {
      ws.addEventListener("open", resolve, { once: true })
      ws.addEventListener("error", reject, { once: true })
    })
    const cdp = new Cdp(ws)
    await cdp.send("Page.enable")
    await cdp.send("Runtime.enable")

    await cdp.send("Page.navigate", { url: `${BASE}/` })
    await cdp.waitFor(
      `!!document.getElementById('root')?.children.length`,
      "the app to mount",
    )
    /* Start from a clean state so the run is repeatable: a previous run leaves
     * its preferences (and possibly a hidden widget) in the browser profile. */
    await cdp.eval(`localStorage.removeItem('casanova_accessibility_v2')`)
    await cdp.send("Page.reload", {})
    check(
      "launcher renders on the sales landing page",
      await cdp.waitFor(
        `!!document.querySelector('#accessibility-launcher')`,
        "the launcher",
      ),
    )

    const duplicates = await cdp.eval(`
      ({
        launchers: document.querySelectorAll('#accessibility-launcher').length,
        panels: document.querySelectorAll('#accessibility-panel').length,
        legacy: document.querySelectorAll('.accessibility-menu, [data-access-high-contrast]').length,
      })
    `)
    check(
      "exactly one launcher, no legacy widget markup",
      duplicates.launchers === 1 && duplicates.legacy === 0,
      JSON.stringify(duplicates),
    )

    const launcher = await cdp.eval(`
      (() => {
        const el = document.getElementById('accessibility-launcher')
        const rect = el.getBoundingClientRect()
        return {
          tag: el.tagName,
          name: (el.getAttribute('aria-label') || '').trim(),
          text: (el.textContent || '').trim(),
          expanded: el.getAttribute('aria-expanded'),
          controls: el.getAttribute('aria-controls'),
          haspopup: el.getAttribute('aria-haspopup'),
          rect: { top: rect.top, left: rect.left, bottom: rect.bottom, height: rect.height },
          vh: window.innerHeight,
        }
      })()
    `)
    check(
      "launcher is a real button with a text label",
      launcher.tag === "BUTTON" && launcher.text.includes("נגישות"),
    )
    check(
      "launcher has an accessible name that starts with its visible text",
      launcher.name.includes("נגישות"),
    )
    check(
      "launcher exposes collapsed state and panel relationship",
      launcher.expanded === "false" &&
        launcher.controls === "accessibility-panel" &&
        launcher.haspopup === "dialog",
    )
    check(
      "launcher is inside the viewport, 44px tall, at the RTL start edge",
      launcher.rect.top >= 0 &&
        launcher.rect.bottom <= launcher.vh + 1 &&
        launcher.rect.left <= 20 &&
        launcher.rect.height >= 44,
      JSON.stringify(launcher.rect),
    )

    // Keyboard activation, not a synthetic click.
    await cdp.eval(`document.getElementById('accessibility-launcher').focus()`)
    await cdp.key("Enter", "Enter", { vk: 13, text: "\r" })
    await sleep(400)
    const openedByKeyboard = await cdp.eval(
      `!!document.getElementById('accessibility-panel')`,
    )
    if (!openedByKeyboard) {
      await cdp.eval(
        `document.getElementById('accessibility-launcher').click()`,
      )
      await sleep(400)
    }
    const panel = await cdp.eval(`
      (() => {
        const node = document.getElementById('accessibility-panel')
        if (!node) return { open: false, rect: {}, vw: 0, vh: 0, bodyScrollWidth: 0 }
        const rect = node.getBoundingClientRect()
        const labelId = node.getAttribute('aria-labelledby')
        return {
          open: true,
          role: node.getAttribute('role'),
          modal: node.getAttribute('aria-modal'),
          labelText: document.getElementById(labelId)?.textContent?.trim(),
          focusInside: node.contains(document.activeElement),
          expanded: document.getElementById('accessibility-launcher').getAttribute('aria-expanded'),
          rect: { top: rect.top, left: rect.left, right: rect.right, bottom: rect.bottom },
          vw: window.innerWidth,
          vh: window.innerHeight,
          bodyScrollWidth: document.body.scrollWidth,
        }
      })()
    `)
    check(
      "Enter on the launcher opens the panel",
      openedByKeyboard === true && panel.open === true,
    )
    check(
      "panel has dialog semantics with a resolvable name",
      panel.role === "dialog" && !!panel.labelText,
    )
    check(
      "panel is not announced as modal, so the page stays usable",
      !panel.modal || panel.modal === "false",
    )
    check("focus moves into the panel", panel.focusInside === true)
    check("launcher reports expanded=true", panel.expanded === "true")
    check(
      "panel is fully inside the viewport, beside the button",
      panel.rect.top >= 0 &&
        panel.rect.left >= 0 &&
        panel.rect.right <= panel.vw + 1 &&
        panel.rect.bottom <= panel.vh + 1,
      JSON.stringify(panel.rect),
    )
    check(
      "panel does not cause horizontal page overflow",
      panel.bodyScrollWidth <= panel.vw + 1,
    )

    const focusables = await cdp.eval(
      `document.querySelectorAll('#accessibility-panel a[href], #accessibility-panel button:not([disabled]), #accessibility-panel input:not([disabled])').length`,
    )
    let stayedInside = true
    for (let press = 0; press < focusables + 2; press++) {
      await cdp.key("Tab", "Tab", { vk: 9 })
      const inside = await cdp.eval(
        `document.getElementById('accessibility-panel').contains(document.activeElement)`,
      )
      if (!inside) stayedInside = false
    }
    check(
      `Tab cycles inside the panel (${focusables} controls)`,
      stayedInside === true,
    )

    const zoom = await cdp.eval(`
      (() => {
        const buttons = Array.from(document.querySelectorAll('#accessibility-panel .a11y-button'))
        buttons
          .find((button) => (button.getAttribute('aria-label') || '').includes('הגדל את'))
          .click()
        return true
      })()
    `)
    await sleep(250)
    const zoomState = await cdp.eval(`
      ({
        fontSize: document.documentElement.style.fontSize,
        readout: document.querySelector('#accessibility-panel .a11y-readout').textContent.trim(),
      })
    `)
    check(
      "font scale step changes the root font size",
      zoom === true &&
        zoomState.fontSize === "110%" &&
        zoomState.readout === "110%",
      JSON.stringify(zoomState),
    )

    const toggled = await cdp.eval(`
      (() => {
        const tile = Array.from(document.querySelectorAll('#accessibility-panel .a11y-tile')).find(
          (button) => button.textContent.includes('גווני אפור'),
        )
        tile.click()
        return true
      })()
    `)
    await sleep(100)
    const toggledState = await cdp.eval(`
      (() => {
        const tile = Array.from(document.querySelectorAll('#accessibility-panel .a11y-tile')).find(
          (button) => button.textContent.includes('גווני אפור'),
        )
        const stored = JSON.parse(localStorage.getItem('casanova_accessibility_v2') || '{}')
        return {
          pressed: tile.getAttribute('aria-pressed'),
          attribute: document.documentElement.dataset.a11yGrayscale,
          stored: stored?.preferences?.grayscale,
          legacy: localStorage.getItem('casanova_accessibility_v1'),
        }
      })()
    `)
    check(
      "grayscale tile updates the html attribute, localStorage and aria-pressed",
      toggled === true &&
        toggledState.pressed === "true" &&
        toggledState.attribute === "true" &&
        toggledState.stored === true,
    )
    check("legacy v1 storage key is removed", toggledState.legacy === null)

    await cdp.key("Escape", "Escape", { vk: 27 })
    await sleep(300)
    const closed = await cdp.eval(`
      ({
        panel: !!document.getElementById('accessibility-panel'),
        focusId: document.activeElement?.id || document.activeElement?.tagName,
      })
    `)
    check("Escape closes the panel", closed.panel === false)
    check(
      "focus returns to the launcher",
      closed.focusId === "accessibility-launcher",
    )

    await cdp.key("Enter", "Enter", { vk: 13, text: "\r" })
    await sleep(300)
    await cdp.eval(`
      (() => {
        const buttons = Array.from(document.querySelectorAll('#accessibility-panel .a11y-button'))
        buttons.find((button) => button.textContent.includes('הסתר את כפתור הנגישות')).click()
      })()
    `)
    await sleep(400)
    const hidden = await cdp.eval(`
      (() => {
        const restore = document.querySelector('[data-a11y-restore]')
        const stored = JSON.parse(localStorage.getItem('casanova_accessibility_v2') || '{}')
        return {
          launcher: !!document.getElementById('accessibility-launcher'),
          panel: !!document.getElementById('accessibility-panel'),
          restore: !!restore,
          restoreText: restore?.textContent?.trim(),
          restoreFocused: restore === document.activeElement,
          grayscaleStillOn: document.documentElement.dataset.a11yGrayscale,
          fontScaleStillSet: document.documentElement.style.fontSize,
          storedHidden: stored?.hidden,
        }
      })()
    `)
    check(
      "hide removes the floating launcher and the panel",
      hidden.launcher === false && hidden.panel === false,
    )
    check(
      "hiding the widget keeps every enabled setting",
      hidden.grayscaleStillOn === "true" && hidden.fontScaleStillSet === "110%",
    )
    check("hidden state persists", hidden.storedHidden === true)
    check(
      "the footer control becomes the way back and receives focus",
      hidden.restore === true && hidden.restoreFocused === true,
      JSON.stringify({
        text: hidden.restoreText,
        focused: hidden.restoreFocused,
      }),
    )

    await cdp.send("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "Alt",
      code: "AltLeft",
      windowsVirtualKeyCode: 18,
      nativeVirtualKeyCode: 18,
      modifiers: 1,
    })
    await cdp.key("a", "KeyA", { vk: 65, modifiers: 1 })
    await cdp.send("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "Alt",
      code: "AltLeft",
      windowsVirtualKeyCode: 18,
      nativeVirtualKeyCode: 18,
    })
    await sleep(400)
    const restored = await cdp.eval(`
      ({
        launcher: !!document.getElementById('accessibility-launcher'),
        panel: !!document.getElementById('accessibility-panel'),
      })
    `)
    check(
      "Alt+A restores the button and opens the panel",
      restored.launcher === true && restored.panel === true,
    )

    await cdp.key("Escape", "Escape", { vk: 27 })
    await cdp.send("Page.reload", {})
    await cdp.waitFor(
      `!!document.getElementById('accessibility-launcher')`,
      "the launcher after reload",
    )
    const afterReload = await cdp.eval(`
      ({
        fontScale: document.documentElement.style.fontSize,
        grayscale: document.documentElement.dataset.a11yGrayscale,
      })
    `)
    check(
      "preferences survive a reload",
      afterReload.fontScale === "110%" && afterReload.grayscale === "true",
      JSON.stringify(afterReload),
    )

    await cdp.eval(`document.getElementById('accessibility-launcher').click()`)
    await sleep(300)
    await cdp.eval(`
      (() => {
        const buttons = Array.from(document.querySelectorAll('#accessibility-panel .a11y-button'))
        buttons.find((button) => button.textContent.includes('איפוס הגדרות נגישות')).click()
      })()
    `)
    await sleep(300)
    const reset = await cdp.eval(`
      ({
        fontSize: document.documentElement.style.fontSize || 'default',
        enabled: Array.from(document.documentElement.attributes).filter(
          (attribute) => attribute.name.startsWith('data-a11y-') && attribute.value === 'true',
        ).length,
      })
    `)
    check(
      "reset returns every preference to its default",
      reset.fontSize === "default" && reset.enabled === 0,
    )
    await cdp.key("Escape", "Escape", { vk: 27 })

    // Small viewport — the layout a phone actually gives the widget.
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 360,
      height: 640,
      deviceScaleFactor: 2,
      mobile: true,
    })
    await sleep(500)
    await cdp.eval(`document.getElementById('accessibility-launcher').click()`)
    await cdp.waitFor(
      `!!document.getElementById('accessibility-panel')`,
      "the panel on mobile",
    )
    await sleep(300)
    const mobile = await cdp.eval(`
      (() => {
        const panel = document.getElementById('accessibility-panel').getBoundingClientRect()
        const launcher = document.getElementById('accessibility-launcher').getBoundingClientRect()
        return {
          panel: { top: panel.top, left: panel.left, right: panel.right, bottom: panel.bottom },
          launcher: { left: launcher.left, height: launcher.height },
          vw: window.innerWidth,
          vh: window.innerHeight,
          bodyScrollWidth: document.body.scrollWidth,
        }
      })()
    `)
    check(
      "panel stays inside a 360x640 viewport",
      mobile.panel.left >= 0 &&
        mobile.panel.right <= mobile.vw + 1 &&
        mobile.panel.top >= 0 &&
        mobile.panel.bottom <= mobile.vh + 1,
      JSON.stringify(mobile.panel),
    )
    check(
      "no horizontal overflow on mobile",
      mobile.bodyScrollWidth <= mobile.vw + 1,
    )
    check(
      "launcher keeps its 44px target on mobile",
      mobile.launcher.height >= 44,
    )

    // Small viewport with the largest text the panel allows: the 200%-zoom case.
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 640,
      height: 480,
      deviceScaleFactor: 1,
      mobile: false,
    })
    await sleep(400)
    await cdp.eval(`
      (() => {
        const buttons = Array.from(document.querySelectorAll('#accessibility-panel .a11y-button'))
        const inc = buttons.find((button) => (button.getAttribute('aria-label') || '').includes('הגדל את'))
        for (let press = 0; press < 6; press++) inc.click()
      })()
    `)
    await sleep(600)
    const zoomed = await cdp.eval(`
      (() => {
        const node = document.getElementById('accessibility-panel')
        const rect = node.getBoundingClientRect()
        return {
          rect: { top: rect.top, left: rect.left, right: rect.right, bottom: rect.bottom },
          vw: window.innerWidth,
          vh: window.innerHeight,
          fontSize: document.documentElement.style.fontSize,
          reachable: Array.from(node.querySelectorAll('.a11y-button, .a11y-tile')).every(
            (button) => button.offsetParent !== null,
          ),
          bodyScrollWidth: document.body.scrollWidth,
        }
      })()
    `)
    check(
      "panel stays inside a 640x480 viewport at 160% text",
      zoomed.rect.left >= 0 &&
        zoomed.rect.right <= zoomed.vw + 1 &&
        zoomed.rect.top >= 0 &&
        zoomed.rect.bottom <= zoomed.vh + 1,
      JSON.stringify(zoomed.rect) + ` font=${zoomed.fontSize}`,
    )
    check(
      "every panel control stays reachable when the panel scrolls",
      zoomed.reachable === true,
    )
    check(
      "no horizontal overflow at 160% text",
      zoomed.bodyScrollWidth <= zoomed.vw + 1,
    )

    // Hiding must not be a one-way door, even across a reload.
    await cdp.eval(`
      (() => {
        const buttons = Array.from(document.querySelectorAll('#accessibility-panel .a11y-button'))
        buttons.find((button) => button.textContent.includes('הסתר את כפתור הנגישות')).click()
      })()
    `)
    await sleep(400)
    await cdp.send("Page.reload", {})
    await cdp.waitFor(
      `!!document.querySelector('[data-a11y-restore]')`,
      "the restore control",
    )
    const hiddenAfterReload = await cdp.eval(`
      ({
        launcher: !!document.getElementById('accessibility-launcher'),
        restore: !!document.querySelector('[data-a11y-restore]'),
      })
    `)
    check(
      "a hidden widget stays hidden and stays restorable after a reload",
      hiddenAfterReload.launcher === false &&
        hiddenAfterReload.restore === true,
    )

    // ── The floating control must not sit on top of interactive content ──
    /* The previous step left the widget hidden on purpose; Alt+A is the
     * documented way back, and also proves it works after a reload. */
    await cdp.send("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "Alt",
      code: "AltLeft",
      windowsVirtualKeyCode: 18,
      nativeVirtualKeyCode: 18,
      modifiers: 1,
    })
    await cdp.key("a", "KeyA", { vk: 65, modifiers: 1 })
    await cdp.send("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "Alt",
      code: "AltLeft",
      windowsVirtualKeyCode: 18,
      nativeVirtualKeyCode: 18,
    })
    await sleep(400)
    const overlapExpression = `
      (() => {
        const control = document.getElementById('accessibility-launcher')
        const panel = document.getElementById('accessibility-panel')
        if (!control) return { hits: [] }
        const boxes = [control.getBoundingClientRect()]
        if (panel) boxes.push(panel.getBoundingClientRect())
        const selector = 'a[href], button, input, select, textarea, [role="button"]'
        const hits = []
        for (const element of document.querySelectorAll(selector)) {
          if (control.contains(element) || panel?.contains(element)) continue
          const rect = element.getBoundingClientRect()
          if (rect.width === 0 || rect.height === 0) continue
          if (rect.bottom < 0 || rect.top > window.innerHeight) continue
          const style = getComputedStyle(element)
          if (style.visibility === 'hidden' || style.display === 'none' || style.opacity === '0') continue
          for (const box of boxes) {
            const overlaps = !(
              rect.right <= box.left ||
              rect.left >= box.right ||
              rect.bottom <= box.top ||
              rect.top >= box.bottom
            )
            if (overlaps) {
              hits.push({
                tag: element.tagName.toLowerCase(),
                text: (element.getAttribute('aria-label') || element.textContent || '').trim().slice(0, 30),
                area: Math.round(
                  Math.max(0, Math.min(rect.right, box.right) - Math.max(rect.left, box.left)) *
                    Math.max(0, Math.min(rect.bottom, box.bottom) - Math.max(rect.top, box.top)),
                ),
                elementArea: Math.round(rect.width * rect.height),
              })
              break
            }
          }
        }
        return { hits }
      })()
    `
    for (const [width, height] of [
      [1280, 900],
      [360, 640],
    ]) {
      await cdp.send("Emulation.setDeviceMetricsOverride", {
        width,
        height,
        deviceScaleFactor: 1,
        mobile: width === 360,
      })
      for (const route of ["/", "/store", "/checkout", "/support"]) {
        await cdp.send("Page.navigate", { url: `${BASE}${route}` })
        await cdp.waitFor(
          `!!document.getElementById('accessibility-launcher')`,
          `the launcher on ${route}`,
        )
        /* The panel is dismissed, so only the launcher is measured. */
        await cdp.key("Escape", "Escape", { vk: 27 })
        await sleep(600)
        const overlap = await cdp.eval(overlapExpression)
        const worst = overlap.hits.reduce(
          (max, hit) => Math.max(max, hit.area / hit.elementArea),
          0,
        )
        check(
          `launcher does not cover a control on ${route || "/"} at ${width}px`,
          worst < 0.05,
          overlap.hits.length
            ? overlap.hits
                .map(
                  (hit) =>
                    `${hit.tag}("${hit.text}") ${hit.area}/${hit.elementArea}px`,
                )
                .join(", ")
            : "no overlaps",
        )
      }
    }
  } finally {
    chrome.kill()
  }
}

main()
  .then(() => {
    const failed = results.filter((result) => !result.pass)
    console.log(
      `\n${results.length - failed.length}/${results.length} checks passed`,
    )
    process.exit(failed.length ? 1 : 0)
  })
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
