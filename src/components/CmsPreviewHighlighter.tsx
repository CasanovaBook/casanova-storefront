/**
 * Live-preview field highlighter.
 *
 * Mounted once for the whole app, but idle unless this document is a Maestro
 * preview (?maestro-preview=1). The editor posts the content key and current
 * value of the field the admin is hovering or focused on; this component finds
 * the element that renders that value and outlines it in place.
 *
 * Only `outline`, `outline-offset`, `box-shadow` and `transition` are touched,
 * so highlighting never changes layout flow. Inline styles are restored as
 * soon as the field is left.
 */

import { useEffect } from "react"
import { previewEnabled } from "@/content/store"
import {
  PREVIEW_READY_MESSAGE,
  isPreviewHighlightMessage,
  type PreviewHighlightMessage,
} from "@/content/preview-bridge"

const OUTLINE = "2px solid #d9b25f"
const GLOW = "0 0 0 5px rgba(217,178,95,0.22), 0 0 24px rgba(217,178,95,0.35)"
const HIGHLIGHT_ATTRIBUTE = "data-cms-preview-highlight"
const TEXT_SELECTOR =
  "h1,h2,h3,h4,h5,h6,p,span,a,button,li,blockquote,figcaption,label,strong,em,small,td,th"

type SavedStyle = {
  outline: string
  outlineOffset: string
  boxShadow: string
  transition: string
}

/** Markdown/rich-text markers the editor stores but the page does not render. */
function normalize(text: string): string {
  return text
    .replace(/\r/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\*\*|\*|`/g, "")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*[-•]\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim()
}

/** Every string inside a field value, including list rows and string arrays. */
function stringsIn(value: unknown, depth = 0): string[] {
  if (depth > 4) return []
  if (typeof value === "string") return [value]
  if (Array.isArray(value)) {
    return value.flatMap((item) => stringsIn(item, depth + 1))
  }
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).flatMap((item) =>
      stringsIn(item, depth + 1),
    )
  }
  return []
}

/** Longest first: the full value is the most precise match a page can offer. */
function candidatesFor(value: unknown): string[] {
  const found = new Set<string>()
  for (const raw of stringsIn(value)) {
    const full = normalize(raw)
    if (full.length >= 2) found.add(full)
    for (const line of raw.split(/\n+/)) {
      const lineText = normalize(line)
      if (lineText.length >= 2) found.add(lineText)
    }
  }
  return [...found].sort((a, b) => b.length - a.length).slice(0, 40)
}

function isVisible(el: HTMLElement): boolean {
  if (!el.isConnected) return false
  const rect = el.getBoundingClientRect()
  if (rect.width < 1 || rect.height < 1) return false
  const style = window.getComputedStyle(el)
  return (
    style.visibility !== "hidden" &&
    style.display !== "none" &&
    style.opacity !== "0"
  )
}

/**
 * Known anchor for a field's section, when the page has one. A scoped search
 * keeps `sales.hero.*` out of the identical header CTA, for example; when the
 * page has no matching scope the caller falls back to the whole document.
 */
function scopeFor(key: string): HTMLElement | null {
  const part = key.split(".")[1] ?? ""
  let selector: string | undefined
  if (part.startsWith("footer")) selector = "footer"
  else if (part.startsWith("header") || part === "nav") selector = "header"
  else if (part === "brand" || part === "tagline") selector = "header"
  else if (part === "hero") selector = ".cv-hero, #hero"
  else if (part === "benefits") selector = ".cv-strip"
  else if (part === "about") selector = "#about"
  else if (part === "quote") selector = ".cv-quote-band"
  else if (part === "inside" || part === "features" || part === "audience")
    selector = "#inside"
  else if (part === "offer") selector = "#purchase"
  else if (part === "faq") selector = "#faq"
  else if (part === "exit") selector = "[role='dialog']"
  if (!selector) return null
  try {
    return document.querySelector<HTMLElement>(selector)
  } catch {
    return null
  }
}

function findText(root: ParentNode, candidates: string[]): HTMLElement | null {
  if (!candidates.length) return null
  const viewportArea = Math.max(1, window.innerWidth * window.innerHeight)
  const nodes: { el: HTMLElement; text: string; area: number }[] = []
  for (const el of root.querySelectorAll<HTMLElement>(TEXT_SELECTOR)) {
    if (!isVisible(el)) continue
    const text = normalize(el.innerText || "")
    if (!text) continue
    const rect = el.getBoundingClientRect()
    const area = rect.width * rect.height
    if (area <= 0 || area > viewportArea * 0.5) continue
    nodes.push({ el, text, area })
  }

  for (const candidate of candidates) {
    let best: { el: HTMLElement; score: number } | null = null
    for (const node of nodes) {
      const exact = node.text === candidate
      /* Short values ("מחיר", "כן") would otherwise match half the page, so
       * only exact equality is trusted below four characters. */
      if (!exact && (candidate.length < 4 || !node.text.includes(candidate))) {
        continue
      }
      /* A short phrase inside a much larger block is a container, not the
       * element that renders the field; exact matches still win. */
      if (
        !exact &&
        candidate.length < 12 &&
        node.text.length > candidate.length * 3
      ) {
        continue
      }
      const score = (exact ? 2 : 1) * 1e9 - node.area
      if (!best || score > best.score) best = { el: node.el, score }
    }
    if (best) return best.el
  }
  return null
}

function findImage(root: ParentNode, value: unknown): HTMLElement | null {
  if (typeof value !== "string" || !value.trim()) return null
  const wanted = value.trim()
  for (const img of Array.from(root.querySelectorAll("img"))) {
    if (!isVisible(img)) continue
    const src = img.currentSrc || img.src
    if (
      src === wanted ||
      src.endsWith(wanted) ||
      wanted.endsWith(src) ||
      (img.alt && normalize(img.alt) === normalize(wanted))
    ) {
      return img
    }
  }
  return null
}

function findLink(root: ParentNode, value: unknown): HTMLElement | null {
  if (typeof value !== "string" || !value.trim()) return null
  let wanted: URL
  try {
    wanted = new URL(value.trim(), window.location.href)
  } catch {
    return null
  }
  for (const a of Array.from(
    root.querySelectorAll<HTMLAnchorElement>("a[href]"),
  )) {
    if (!isVisible(a)) continue
    let href: URL
    try {
      href = new URL(a.href, window.location.href)
    } catch {
      continue
    }
    if (
      href.hash === wanted.hash &&
      href.pathname === wanted.pathname &&
      href.search === wanted.search
    ) {
      return a
    }
  }
  return null
}

function locate(message: PreviewHighlightMessage): HTMLElement | null {
  if (!message.key) return null
  /* Opening an accordion targets the whole block, not a single value. */
  if (message.anchor) {
    try {
      const anchored = document.querySelector<HTMLElement>(message.anchor)
      if (anchored) return anchored
    } catch {
      /* stale/invalid selector: fall back to value matching below */
    }
  }
  if (message.kind === "section") return scopeFor(message.key)
  /* SEO fields have no visible element of their own; a URL match would pick
   * an unrelated cover image or link, which is worse than no outline. */
  if ((message.key.split(".")[1] ?? "") === "seo") return null

  const scope = scopeFor(message.key)
  if (message.kind === "image") {
    return (
      (scope && findImage(scope, message.value)) ??
      findImage(document, message.value)
    )
  }
  if (message.kind === "link") {
    return (
      (scope && findLink(scope, message.value)) ??
      findLink(document, message.value)
    )
  }
  const candidates = candidatesFor(message.value)
  return (
    (scope && findText(scope, candidates)) ?? findText(document, candidates)
  )
}

function reveal(el: HTMLElement): void {
  const rect = el.getBoundingClientRect()
  const height = window.innerHeight || document.documentElement.clientHeight
  if (rect.top >= 8 && rect.bottom <= height - 8) return
  const reduced =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  el.scrollIntoView({
    block: "center",
    inline: "nearest",
    behavior: reduced ? "auto" : "smooth",
  })
}

export default function CmsPreviewHighlighter() {
  useEffect(() => {
    if (!previewEnabled()) return

    let active: HTMLElement | null = null
    let saved: SavedStyle | null = null

    const clear = () => {
      if (active && saved) {
        active.style.outline = saved.outline
        active.style.outlineOffset = saved.outlineOffset
        active.style.boxShadow = saved.boxShadow
        active.style.transition = saved.transition
        active.removeAttribute(HIGHLIGHT_ATTRIBUTE)
      }
      active = null
      saved = null
    }

    const apply = (el: HTMLElement) => {
      if (el === active) return
      clear()
      active = el
      saved = {
        outline: el.style.outline,
        outlineOffset: el.style.outlineOffset,
        boxShadow: el.style.boxShadow,
        transition: el.style.transition,
      }
      el.style.outline = OUTLINE
      el.style.outlineOffset = "4px"
      el.style.boxShadow = GLOW
      el.style.transition = saved.transition
        ? `${saved.transition}, outline-color 140ms ease, box-shadow 140ms ease`
        : "outline-color 140ms ease, box-shadow 140ms ease"
      el.setAttribute(HIGHLIGHT_ATTRIBUTE, "true")
    }

    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return
      if (event.source !== window.parent) return
      if (!isPreviewHighlightMessage(event.data)) return

      const message = event.data
      if (!message.key) {
        clear()
        return
      }
      const target = locate(message)
      if (!target) {
        clear()
        return
      }
      apply(target)
      if (message.reveal) reveal(target)
    }

    window.addEventListener("message", onMessage)

    /* The editor may already hold an active field when this document mounts
     * (manual refresh, preview toggled on). Announce readiness so it replays. */
    if (window.parent !== window) {
      try {
        window.parent.postMessage(
          { type: PREVIEW_READY_MESSAGE },
          window.location.origin,
        )
      } catch {
        /* embedded in an opaque origin: no bridge possible */
      }
    }

    return () => {
      window.removeEventListener("message", onMessage)
      clear()
    }
  }, [])

  return null
}
