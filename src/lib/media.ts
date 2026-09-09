import type { MediaLink } from "../types"

/** Detect the hosting platform of a media URL. */

export function detectPlatform(url: string): MediaLink["platform"] {
  const u = url.toLowerCase()

  if (u.includes("youtube.com") || u.includes("youtu.be")) return "YOUTUBE"

  if (u.includes("vimeo.com")) return "VIMEO"

  return "WEB"
}

/** Convert a YouTube/Vimeo share URL into an embeddable player URL. */

export function toEmbedUrl(url: string): string | null {
  // YouTube: watch?v=ID | youtu.be/ID | shorts/ID

  const yt = url.match(
    /(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)([\w-]{6,})/,
  )

  if (yt) return `https://www.youtube.com/embed/${yt[1]}`

  // Vimeo: vimeo.com/ID

  const vm = url.match(/vimeo\.com\/(\d+)/)

  if (vm) return `https://player.vimeo.com/video/${vm[1]}`

  return null
}

export const PLATFORM_LABEL: Record<MediaLink["platform"], string> = {
  YOUTUBE: "YouTube",

  VIMEO: "Vimeo",

  WEB: "קישור חיצוני",
}
