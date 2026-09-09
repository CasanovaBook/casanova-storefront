/* ─────────────────────────────────────────────────────────────
 * Design tokens.
 *
 * Values are copied from `src/index.css` in the web project so the two
 * clients look like the same product. Dark only: a DRM reader on a
 * phone is used at night, and one palette means one set of contrast
 * decisions to get right.
 * ───────────────────────────────────────────────────────────── */

export const colors = {
  background: "#0B0D16",

  surface: "#131624",

  surfaceRaised: "#1A1E30",

  foreground: "#F5F3EC",

  muted: "#9AA1B8",

  border: "#2B3048",

  primary: "#E3AE3C",

  primaryForeground: "#0B0D16",

  success: "#22C55E",

  danger: "#EF4444",

  /* The shield overlay is pure black rather than `background`: it sits
   * over a window the OS is actively trying to capture, and any
   * transparency at all shows the content underneath in the capture. */

  shield: "#000000",
} as const

export const spacing = {
  xs: 4,

  sm: 8,

  md: 12,

  lg: 16,

  xl: 24,

  xxl: 32,
} as const

export const radius = {
  sm: 8,

  md: 12,

  lg: 16,

  pill: 999,
} as const

/**
 * Font families. `Frank Ruhl Libre` and `Heebo` are the web's faces; on
 * a phone they would have to be bundled as assets, and a Hebrew display
 * face is 300KB+ per weight. System Hebrew rendering is good enough
 * that the trade is not worth the binary size, so the tokens resolve to
 * the platform defaults and only the weights differ.
 */

export const fontFamily = {
  display: undefined as string | undefined,

  body: undefined as string | undefined,
} as const

export const fontSize = {
  xs: 11,

  sm: 13,

  md: 15,

  lg: 17,

  xl: 21,

  xxl: 27,
} as const

/** 44pt is the iOS minimum and the Android recommendation; anything
 *  smaller is an accessibility defect, not a styling choice. */

export const TAP_TARGET = 44
