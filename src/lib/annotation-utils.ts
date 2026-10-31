import type { HighlightRect } from "../types"

/** The reader's highlight palette. Values are stored as six-digit hex. */
export const HIGHLIGHT_COLORS = [
  { value: "#facc15", label: "צהוב" },
  { value: "#34d399", label: "ירוק" },
  { value: "#60a5fa", label: "כחול" },
  { value: "#f472b6", label: "ורוד" },
] as const

export const DEFAULT_HIGHLIGHT_COLOR = HIGHLIGHT_COLORS[0].value

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/

export function isHighlightColor(value: unknown): value is string {
  return typeof value === "string" && HEX_COLOR.test(value)
}

function finiteNumber(value: unknown): number | null {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

/**
 * Normalize client rectangles to the page's 0..1 coordinate space.
 * Malformed, zero-area and off-page rectangles are discarded; the result is
 * capped so a pathological selection cannot bloat a row.
 */
export function normalizeHighlightRects(input: unknown): HighlightRect[] {
  if (!Array.isArray(input)) return []

  const rects: HighlightRect[] = []

  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue

    const value = raw as Record<string, unknown>

    const x = finiteNumber(value.x)
    const y = finiteNumber(value.y)
    const width = finiteNumber(value.width)
    const height = finiteNumber(value.height)

    if (x === null || y === null || width === null || height === null) continue

    const left = Math.min(Math.max(x, 0), 1)
    const top = Math.min(Math.max(y, 0), 1)
    const right = Math.min(Math.max(x + width, 0), 1)
    const bottom = Math.min(Math.max(y + height, 0), 1)

    const w = Math.round((right - left) * 10_000) / 10_000
    const h = Math.round((bottom - top) * 10_000) / 10_000

    if (w <= 0.001 || h <= 0.001) continue

    rects.push({
      x: Math.round(left * 10_000) / 10_000,
      y: Math.round(top * 10_000) / 10_000,
      width: w,
      height: h,
    })

    if (rects.length >= 100) break
  }

  return rects
}

export function normalizeQuote(value: unknown): string {
  if (typeof value !== "string") return ""
  return value.replace(/\s+/g, " ").trim().slice(0, 4000)
}

export function normalizeNote(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const note = value.trim().slice(0, 2000)
  return note || undefined
}

export function normalizeAnnotationPage(value: unknown): number {
  const page = Math.floor(Number(value))
  return Number.isFinite(page) && page > 0 ? page : 1
}

/** CSS color with an alpha channel, for the translucent highlight layer. */
export function highlightFill(color: string, alpha = 0.35): string {
  if (!HEX_COLOR.test(color)) return `rgba(250, 204, 21, ${alpha})`

  const r = parseInt(color.slice(1, 3), 16)
  const g = parseInt(color.slice(3, 5), 16)
  const b = parseInt(color.slice(5, 7), 16)

  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}
