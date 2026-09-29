import { useEffect, useRef } from "react"

import type { SecurityEventType } from "../types"

/**
 * What the DRM policy asks the browser to deter.
 *
 * Every flag maps to a policy column, so relaxing protection is a CMS
 * edit rather than a code change — and turning a flag off is recorded in
 * the audit trail by whoever did it.
 */

export interface ScreenProtectionOptions {
  /** Capture-key interception plus clipboard wiping (block_screenshots). */

  blockScreenshots: boolean

  /** Same interception, reported as a recording attempt (block_screen_recording). */

  blockScreenRecording: boolean

  /** Copy / cut / drag / selection suppression (block_copy). */

  blockCopy: boolean

  /** Print suppression: Ctrl/Cmd+P plus a blanking print stylesheet (block_print). */

  blockPrint: boolean

  /** Blank the page while it is hidden or unfocused (hide_content_on_blur). */

  hideOnBlur: boolean

  /** Called with `true` while the content should be covered. */

  onShieldChange?: (shielded: boolean) => void

  /** Called when a deterrent actually fires, so the event reaches the log. */

  onBlocked?: (type: SecurityEventType, detail?: string) => void
}

/**
 * Injected only while `blockPrint` is on. Browsers ignore
 * `preventDefault()` on a print dialog, so the reliable client-side
 * deterrent is to make the printed output blank — the reader still
 * cannot be stopped from pressing the keys, but the paper comes out
 * empty.
 */

const PRINT_BLOCK_CSS =
  "@media print { html, body { display: none !important; } }"

const noop = () => undefined

/**
 * DRM deterrent layer for protected content (the reader).
 *
 * Scoped honestly: a web page cannot stop a camera, an OS-level
 * screenshot, or a browser extension. What this does is (a) remove the
 * effortless paths — right-click save, select-and-copy, Ctrl+P,
 * PrintScreen-to-clipboard — (b) blank the page when it is not the
 * focused window so a screen-share or an alt-tab does not leave the
 * content on display, and (c) report each blocked attempt so the CMS
 * can show which accounts are probing the protection.
 *
 * Attribution — the part that actually deters redistribution — is the
 * watermark the reader draws on top; this hook only handles behaviour.
 */

export function useScreenProtection(options: ScreenProtectionOptions): void {
  // Handlers are re-created on every render, but the effect must not be:

  // tearing down and re-adding document listeners on each policy object

  // identity change would open gaps where nothing is protected. The ref

  // keeps the latest callbacks reachable from listeners installed once.

  const optionsRef = useRef(options)

  optionsRef.current = options

  const report = (type: SecurityEventType, detail?: string) => {
    optionsRef.current.onBlocked?.(type, detail)
  }

  useEffect(() => {
    const opts = () => optionsRef.current

    /* ── Selection, copy and drag ─────────────────────────── */

    const suppress = (e: Event) => {
      if (!opts().blockCopy) return

      e.preventDefault()

      if (e.type === "contextmenu") report("CONTEXT_MENU_BLOCKED")
      else report("COPY_BLOCKED", e.type)
    }

    /* ── Capture keys ─────────────────────────────────────── */

    const handleKeyDown = (e: KeyboardEvent) => {
      const { blockScreenshots, blockScreenRecording, blockPrint, blockCopy } =
        opts()

      const key = e.key.toLowerCase()

      const meta = e.ctrlKey || e.metaKey

      if (blockPrint && meta && key === "p") {
        e.preventDefault()

        report("PRINT_BLOCKED")

        return
      }

      if (meta && key === "s") {
        // Save-page is a capture path whether or not printing is blocked.

        if (blockScreenshots || blockCopy) {
          e.preventDefault()

          report("SCREENSHOT_BLOCKED", "save-page")

          return
        }
      }

      /* Ctrl/Cmd+U opens view-source for this page, which prints the reader's
       * markup — including the iframe src, i.e. a direct URL to the content
       * file. That is the shortest path from "protected reader" to "download
       * link", so it is gated on copy blocking rather than on the capture
       * flags. Placed before the early return below, which would otherwise
       * skip it whenever screenshots and recording are both allowed. */

      if (blockCopy && meta && key === "u") {
        e.preventDefault()

        report("SOURCE_VIEW_BLOCKED", "view-source")

        return
      }

      if (!blockScreenshots && !blockScreenRecording) return

      // Ctrl/Cmd+Shift+S and +I are the browser save-capture and

      // inspector paths. Ctrl+Shift+C is deliberately not here: it is the

      // element picker, and reporting it would fill the log with noise

      // that hides real capture attempts.

      const captureCombo = meta && e.shiftKey && (key === "s" || key === "i")

      const macCapture =
        e.metaKey && e.shiftKey && ["3", "4", "5"].includes(e.key)

      const recordingCombo =
        e.metaKey && e.shiftKey && (key === "r" || key === "v")

      if (
        e.key === "PrintScreen" ||
        captureCombo ||
        macCapture ||
        recordingCombo
      ) {
        e.preventDefault()

        // Wipe the clipboard: PrintScreen lands there, so clearing it

        // defeats the capture-then-paste workflow on the platforms where

        // the key itself cannot be swallowed.

        if (navigator.clipboard) navigator.clipboard.writeText("").catch(noop)

        const isRecording = recordingCombo || (macCapture && e.key === "5")

        report(
          isRecording && blockScreenRecording
            ? "RECORDING_DETECTED"
            : "SCREENSHOT_BLOCKED",
          e.key,
        )
      }
    }

    /* ── Clipboard hygiene ────────────────────────────────── */

    const wipeClipboard = () => {
      if (!opts().blockScreenshots) return

      if (navigator.clipboard) navigator.clipboard.writeText("").catch(noop)
    }

    /* ── Focus / visibility shield ────────────────────────── */

    const notify = () => {
      const hidden = document.hidden || !document.hasFocus()

      if (hidden && opts().hideOnBlur) report("VISIBILITY_HIDDEN")

      opts().onShieldChange?.(hidden && opts().hideOnBlur)
    }

    /* ── Print stylesheet ─────────────────────────────────── */

    let printStyle: HTMLStyleElement | null = null

    const applyPrintBlock = () => {
      const wanted = optionsRef.current.blockPrint

      if (wanted && !printStyle) {
        printStyle = document.createElement("style")

        printStyle.dataset.drmPrintBlock = "true"

        printStyle.textContent = PRINT_BLOCK_CSS

        document.head.appendChild(printStyle)
      } else if (!wanted && printStyle) {
        printStyle.remove()

        printStyle = null
      }
    }

    applyPrintBlock()

    const onBeforePrint = () => {
      if (optionsRef.current.blockPrint) report("PRINT_BLOCKED", "beforeprint")
    }

    document.addEventListener("contextmenu", suppress)

    document.addEventListener("copy", suppress)

    document.addEventListener("cut", suppress)

    document.addEventListener("dragstart", suppress)

    document.addEventListener("keydown", handleKeyDown)

    window.addEventListener("beforeprint", onBeforePrint)

    window.addEventListener("blur", wipeClipboard)

    window.addEventListener("blur", notify)

    window.addEventListener("focus", notify)

    document.addEventListener("visibilitychange", wipeClipboard)

    document.addEventListener("visibilitychange", notify)

    return () => {
      document.removeEventListener("contextmenu", suppress)

      document.removeEventListener("copy", suppress)

      document.removeEventListener("cut", suppress)

      document.removeEventListener("dragstart", suppress)

      document.removeEventListener("keydown", handleKeyDown)

      window.removeEventListener("beforeprint", onBeforePrint)

      window.removeEventListener("blur", wipeClipboard)

      window.removeEventListener("blur", notify)

      window.removeEventListener("focus", notify)

      document.removeEventListener("visibilitychange", wipeClipboard)

      document.removeEventListener("visibilitychange", notify)

      printStyle?.remove()
    }

    // Installed once. Policy changes are read through `optionsRef`, so a

    // CMS edit takes effect on the next event without ever leaving a gap.
  }, [])
}

