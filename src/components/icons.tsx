import type { ReactElement, SVGProps } from "react"

export type IconName = "home" | "grid" | "box" | "users" | "user" | "receipt" | "target" | "library" | "book" | "bookOpen" | "bag" | "cart" | "card" | "check" | "checkCircle" | "x" | "mail" | "phone" | "message" | "tag" | "star" | "sparkles" | "shield" | "lock" | "key" | "zap" | "chart" | "clock" | "calendar" | "trendUp" | "trophy" | "crown" | "money" | "inbox" | "flame" | "gift" | "infinity" | "pen" | "list" | "search" | "eye" | "eyeOff" | "alert-triangle" | "alertTriangle" | "logout" | "arrowLeft" | "arrowRight" | "chevronDown" | "chevronLeft" | "chevronRight" | "menu" | "smartphone" | "sun" | "moon" | "layers" | "video" | "download" | "upload" | "link" | "external" | "refresh" | "zoomIn" | "zoomOut" | "fitWidth" | "settings" | "accessibility" | "type" | "lineSpacing" | "letterSpacing" | "maximize"

const ICONS: Record<IconName, ReactElement> = {
  home: (
    <>
      <path d="m3 10.5 9-7.5 9 7.5" />
      <path d="M5 9.5V21h5v-6h4v6h5V9.5" />
    </>
  ),

  grid: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </>
  ),

  box: (
    <>
      <path d="M21 8 12 3 3 8v8l9 5 9-5V8Z" />
      <path d="m3.3 8.3 8.7 4.7 8.7-4.7" />
      <path d="M12 13v9" />
    </>
  ),

  users: (
    <>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </>
  ),

  user: (
    <>
      <circle cx="12" cy="7" r="4" />
      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
    </>
  ),

  receipt: (
    <>
      <path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1-2-1Z" />
      <path d="M8 7h8" />
      <path d="M8 11h8" />
      <path d="M8 15h5" />
    </>
  ),

  target: (
    <>
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="6" />
      <circle cx="12" cy="12" r="2" />
    </>
  ),

  library: (
    <>
      <path d="m16 6 4 14" />
      <path d="M12 6v14" />
      <path d="M8 8v12" />
      <path d="M4 4v16" />
    </>
  ),

  book: (
    <>
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z" />
    </>
  ),

  bookOpen: (
    <>
      <path d="M2 4h6a4 4 0 0 1 4 4v12a3 3 0 0 0-3-3H2V4Z" />
      <path d="M22 4h-6a4 4 0 0 0-4 4v12a3 3 0 0 1 3-3h7V4Z" />
    </>
  ),

  bag: (
    <>
      <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4H6Z" />
      <path d="M3 6h18" />
      <path d="M16 10a4 4 0 0 1-8 0" />
    </>
  ),

  cart: (
    <>
      <circle cx="9" cy="20" r="1.5" />
      <circle cx="18" cy="20" r="1.5" />
      <path d="M2 3h2.5l2.3 12.3a1.5 1.5 0 0 0 1.5 1.2h8.9a1.5 1.5 0 0 0 1.5-1.2L20.5 7H5" />
    </>
  ),

  card: (
    <>
      <rect x="2" y="4" width="20" height="16" rx="2.5" />
      <path d="M2 10h20" />
      <path d="M6 15h4" />
    </>
  ),

  check: <path d="M20 6 9 17l-5-5" />,

  checkCircle: (
    <>
      <path d="M22 11.1V12a10 10 0 1 1-5.9-9.1" />
      <path d="M22 4 12 14l-3-3" />
    </>
  ),

  x: (
    <>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </>
  ),

  mail: (
    <>
      <rect x="2" y="4" width="20" height="16" rx="2.5" />
      <path d="m22 7-10 5L2 7" />
    </>
  ),

  phone: (
    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92Z" />
  ),

  message: (
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10Z" />
  ),

  tag: (
    <>
      <path d="M12.6 2.6 21 11a2 2 0 0 1 0 2.8l-7.2 7.2a2 2 0 0 1-2.8 0L2.6 12.6A2 2 0 0 1 2 11.2V4a2 2 0 0 1 2-2h7.2a2 2 0 0 1 1.4.6Z" />
      <circle cx="7.5" cy="7.5" r="1" fill="currentColor" stroke="none" />
    </>
  ),

  star: (
    <path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2Z" />
  ),

  sparkles: (
    <>
      <path d="m12 3 1.9 5.1a2 2 0 0 0 1.2 1.2L20.2 11l-5.1 1.9a2 2 0 0 0-1.2 1.2L12 19.2l-1.9-5.1a2 2 0 0 0-1.2-1.2L3.8 11l5.1-1.7a2 2 0 0 0 1.2-1.2L12 3Z" />
      <path d="M19 17v4" />
      <path d="M17 19h4" />
    </>
  ),

  shield: <path d="M12 22s8-3.6 8-10V5l-8-3-8 3v7c0 6.4 8 10 8 10Z" />,

  lock: (
    <>
      <rect x="3.5" y="11" width="17" height="10.5" rx="2.5" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </>
  ),

  key: (
    <>
      <circle cx="7.5" cy="15.5" r="4.5" />
      <path d="m11 12 10-10" />
      <path d="m16 7 3 3" />
    </>
  ),

  zap: <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8Z" />,

  chart: (
    <>
      <path d="M6 20v-4" />
      <path d="M12 20V10" />
      <path d="M18 20V4" />
    </>
  ),

  clock: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 6v6l4 2" />
    </>
  ),

  calendar: (
    <>
      <rect x="3" y="4" width="18" height="18" rx="2.5" />
      <path d="M16 2v4" />
      <path d="M8 2v4" />
      <path d="M3 10h18" />
    </>
  ),

  trendUp: (
    <>
      <path d="m22 7-8.5 8.5-5-5L2 17" />
      <path d="M16 7h6v6" />
    </>
  ),

  trophy: (
    <>
      <path d="M6 2h12v7a6 6 0 0 1-12 0V2Z" />
      <path d="M6 4H4.5a2.5 2.5 0 0 0 0 5H6" />
      <path d="M18 4h1.5a2.5 2.5 0 0 1 0 5H18" />
      <path d="M12 15v4" />
      <path d="M8 21h8" />
    </>
  ),

  crown: (
    <>
      <path d="m2 7 4.5 4L12 4l5.5 7L22 7l-2 12H4L2 7Z" />
    </>
  ),

  money: (
    <>
      <rect x="2" y="6" width="20" height="12" rx="2.5" />
      <circle cx="12" cy="12" r="2.5" />
      <path d="M6 12h.01" />
      <path d="M18 12h.01" />
    </>
  ),

  inbox: (
    <>
      <path d="M22 12h-6l-2 3h-4l-2-3H2" />
      <path d="M5.5 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.7 4H7.3a2 2 0 0 0-1.8 1.1Z" />
    </>
  ),

  flame: (
    <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5Z" />
  ),

  gift: (
    <>
      <path d="M20 12v10H4V12" />
      <path d="M2 7h20v5H2V7Z" />
      <path d="M12 22V7" />
      <path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7Z" />
      <path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7Z" />
    </>
  ),

  infinity: (
    <path d="M18.18 8c1.8 0 3.32 1.6 3.32 4s-1.52 4-3.32 4c-2.9 0-4.68-4-6.18-4s-3.28 4-6.18 4C4.02 16 2.5 14.4 2.5 12s1.52-4 3.32-4c2.9 0 4.68 4 6.18 4s3.28-4 6.18-4Z" />
  ),

  pen: <path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3Z" />,

  list: (
    <>
      <path d="M8 6h13" />
      <path d="M8 12h13" />
      <path d="M8 18h13" />
      <path d="M3 6h.01" />
      <path d="M3 12h.01" />
      <path d="M3 18h.01" />
    </>
  ),

  search: (
    <>
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </>
  ),

  eye: (
    <>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),

  eyeOff: (
    <>
      <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
      <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
      <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
      <line x1="2" y1="2" x2="22" y2="22" />
    </>
  ),

  "alert-triangle": (
    <>
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </>
  ),

  alertTriangle: (
    <>
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </>
  ),

  logout: (
    <>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="m16 17 5-5-5-5" />
      <path d="M21 12H9" />
    </>
  ),

  arrowLeft: (
    <>
      <path d="M19 12H5" />
      <path d="m12 19-7-7 7-7" />
    </>
  ),

  arrowRight: (
    <>
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </>
  ),

  chevronDown: <path d="m6 9 6 6 6-6" />,

  chevronLeft: <path d="m15 18-6-6 6-6" />,

  chevronRight: <path d="m9 18 6-6-6-6" />,

  menu: (
    <>
      <path d="M4 6h16" />
      <path d="M4 12h16" />
      <path d="M4 18h16" />
    </>
  ),

  smartphone: (
    <>
      <rect width="14" height="20" x="5" y="2" rx="2" ry="2" />
      <path d="M12 18h.01" />
    </>
  ),

  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2" />
      <path d="M12 20v2" />
      <path d="m4.9 4.9 1.4 1.4" />
      <path d="m17.7 17.7 1.4 1.4" />
      <path d="M2 12h2" />
      <path d="M20 12h2" />
      <path d="m4.9 19.1 1.4-1.4" />
      <path d="m17.7 6.3 1.4-1.4" />
    </>
  ),

  moon: <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />,

  layers: (
    <>
      <path d="m12 2 9 5-9 5-9-5 9-5Z" />
      <path d="m3 12 9 5 9-5" />
      <path d="m3 17 9 5 9-5" />
    </>
  ),

  video: (
    <>
      <rect x="2" y="5" width="14" height="14" rx="2.5" />
      <path d="m16 10 6-3v10l-6-3" />
    </>
  ),

  download: (
    <>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="m7 10 5 5 5-5" />
      <path d="M12 15V3" />
    </>
  ),

  upload: (
    <>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="m7 8 5-5 5 5" />
      <path d="M12 3v12" />
    </>
  ),

  link: (
    <>
      <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" />
      <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />
    </>
  ),

  external: (
    <>
      <path d="M15 3h6v6" />
      <path d="M10 14 21 3" />
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    </>
  ),

  refresh: (
    <>
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <path d="M21 3v6h-6" />
    </>
  ),

  /* The reader's text-size controls. A magnifier rather than a bare + and −
   * so the pair still reads as "zoom" beside the sun/moon and fullscreen
   * toggles, which are also unlabeled single glyphs. */

  zoomIn: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m21 21-4.7-4.7" />
      <path d="M10.5 7.5v6" />
      <path d="M7.5 10.5h6" />
    </>
  ),

  zoomOut: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m21 21-4.7-4.7" />
      <path d="M7.5 10.5h6" />
    </>
  ),

  fitWidth: (
    <>
      <path d="M3 12h18" />
      <path d="m6.5 8.5-3.5 3.5 3.5 3.5" />
      <path d="m17.5 8.5 3.5 3.5-3.5 3.5" />
    </>
  ),

  /* Glyphs for the accessibility panel's toggle tiles. Each toggle pairs one
   * with a visible text label — the icon is never the whole name. */
  type: (
    <>
      <path d="M4 7V4h16v3" />
      <path d="M12 4v16" />
      <path d="M9 20h6" />
    </>
  ),

  lineSpacing: (
    <>
      <path d="M10 5h11" />
      <path d="M10 12h11" />
      <path d="M10 19h11" />
      <path d="M5 4v16" />
      <path d="m3 6 2-2 2 2" />
      <path d="m3 18 2 2 2-2" />
    </>
  ),

  letterSpacing: (
    <>
      <path d="m4 16 3.5-9L11 16" />
      <path d="M5.2 13h5.6" />
      <path d="m13 16 3.5-9L20 16" />
      <path d="M14.2 13h5.6" />
    </>
  ),

  maximize: (
    <>
      <path d="M8 3H5a2 2 0 0 0-2 2v3" />
      <path d="M16 3h3a2 2 0 0 1 2 2v3" />
      <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
      <path d="M8 21H5a2 2 0 0 1-2-2v-3" />
    </>
  ),

  /* Universal access mark: head, outstretched arms, body and legs. Used only
   * by the accessibility controls, which always pair it with a text label or
   * an aria-label — the glyph is never the whole accessible name. */
  accessibility: (
    <>
      <circle cx="12" cy="4.7" r="1.9" />
      <path d="M4.9 8.6c4.6 1.4 9.6 1.4 14.2 0" />
      <path d="M12 8.4v6.2" />
      <path d="m12 14.6-3.2 6.1M12 14.6l3.2 6.1" />
    </>
  ),

  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </>
  ),
}

interface IconProps extends SVGProps<SVGSVGElement> {
  name: IconName

  size?: number
}

export function Icon({ name, size = 18, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {ICONS[name]}
    </svg>
  )
}

export default Icon
