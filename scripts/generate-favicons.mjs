/*
 * Generates the favicon set from images/main_photo.jpg.
 *
 * One-off build tool (run: `node scripts/generate-favicons.mjs`); the
 * output is committed to public/ so the app never depends on sharp at
 * runtime or build time.
 *
 * Composition: the source is a square 1254×1254 illustration on an
 * off-white field. A favicon-sized rendering of the full frame keeps the
 * ring and the book legible, so the crop is a symmetric ~4% inset — just
 * enough to trim the uneven white margin — followed by a resize onto a
 * white square tile. PNG output carries transparency for the corners of
 * the rounded tile; the .ico keeps a square white field, which is the
 * safest rendering for legacy consumers that ignore alpha.
 */

import { existsSync } from "node:fs"
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import sharp from "sharp"

const SRC = path.resolve("images/main_photo.jpg")
const OUT = path.resolve("public")

if (!existsSync(SRC)) {
  console.error(`source image not found: ${SRC}`)
  process.exit(1)
}

await mkdir(OUT, { recursive: true })

const src = sharp(SRC)
const meta = await src.metadata()
const side = Math.min(meta.width ?? 0, meta.height ?? 0)

if (side < 256) {
  console.error(`source too small for favicon work: ${meta.width}x${meta.height}`)
  process.exit(1)
}

/* Symmetric inset crop, then square center crop (source is already square,
 * but this keeps the script correct if the photo is ever re-landscaped). */
const INSET = Math.round(side * 0.04)
const cropSide = side - INSET * 2
const cropped = src.extract({
  left: INSET,
  top: INSET,
  width: cropSide,
  height: cropSide,
})

/** Resized square raster on an opaque white field, at the requested size. */
function tile(size) {
  return cropped
    .clone()
    .resize(size, size, { fit: "cover", position: "centre" })
    .flatten({ background: "#ffffff" })
    .png()
}

/**
 * Rounded-tile variant: white tile with transparent corners so the icon
 * does not read as a hard white square on dark tab bars. Radius is ~9%
 * of the side — enough to be visible at 16 px, not so much that the
 * illustration's own ring feels cropped.
 */
async function roundedTile(size) {
  const radius = Math.round(size * 0.09)
  const mask = Buffer.from(
    `<svg width="${size}" height="${size}">
       <rect x="0" y="0" width="${size}" height="${size}" rx="${radius}" ry="${radius}" fill="#fff"/>
     </svg>`,
  )

  return cropped
    .clone()
    .resize(size, size, { fit: "cover", position: "centre" })
    .flatten({ background: "#ffffff" })
    .composite([{ input: mask, blend: "dest-in" }])
    .png()
    .toBuffer()
}

/* ── PNG set (modern browsers) ─────────────────────────────
 * 16/32 cover tab rendering; 48 is the Windows desktop-shortcut size;
 * 180 is the Apple touch icon (opaque square — iOS rounds it itself,
 * transparency becomes black); 192/512 serve PWA/Android surfaces and
 * any manifest that later lands. Rounded variants are used where the
 * consumer shows the icon as-is; opaque where the OS masks it. */
const pngTargets = [
  { name: "favicon-16x16.png", size: 16, rounded: false },
  { name: "favicon-32x32.png", size: 32, rounded: false },
  { name: "favicon-48x48.png", size: 48, rounded: false },
  { name: "favicon-96x96.png", size: 96, rounded: true },
  { name: "apple-touch-icon.png", size: 180, rounded: false },
  { name: "android-chrome-192x192.png", size: 192, rounded: true },
  { name: "android-chrome-512x512.png", size: 512, rounded: true },
]

for (const t of pngTargets) {
  const pipeline = t.rounded ? roundedTile(t.size) : tile(t.size).toBuffer()
  const buf = await pipeline
  await writeFile(path.join(OUT, t.name), buf)
  console.log(`✓ ${t.name}`)
}

/* ── .ico — multi-resolution, for consumers that only speak ICO ──
 * sharp cannot emit ICO, but the format is a simple container: a
 * 6-byte header, one 16-byte directory entry per image, then the
 * encoded PNGs. ICO consumers have accepted PNG-encoded entries since
 * Vista; the small sizes stay crisp because they were rendered from a
 * 512 px downscale rather than scaled by the browser. */
const icoSizes = [16, 32, 48]
const icoImages = await Promise.all(
  icoSizes.map((s) => tile(s).toBuffer()),
)

const header = Buffer.alloc(6)
header.writeUInt16LE(0, 0) // reserved
header.writeUInt16LE(1, 2) // type: icon
header.writeUInt16LE(icoSizes.length, 4) // image count

const dirEntries = []
const payloads = []
let offset = 6 + icoSizes.length * 16

icoSizes.forEach((s, i) => {
  const entry = Buffer.alloc(16)
  entry.writeUInt8(s === 256 ? 0 : s, 0) // width
  entry.writeUInt8(s === 256 ? 0 : s, 1) // height
  entry.writeUInt8(0, 2) // palette
  entry.writeUInt8(0, 3) // reserved
  entry.writeUInt16LE(1, 4) // color planes
  entry.writeUInt16LE(32, 6) // bits per pixel
  entry.writeUInt32LE(icoImages[i].length, 8) // bytes
  entry.writeUInt32LE(offset, 12)
  offset += icoImages[i].length
  dirEntries.push(entry)
  payloads.push(icoImages[i])
})

const ico = Buffer.concat([header, ...dirEntries, ...payloads])
await writeFile(path.join(OUT, "favicon.ico"), ico)
console.log(`✓ favicon.ico (${icoSizes.join(", ")})`)

/* ── site.webmanifest — home-screen metadata for Android/Chrome ── */
const manifest = {
  name: "Casanova — ספרייה דיגיטלית פרטית",
  short_name: "Casanova",
  icons: [
    {
      src: "/android-chrome-192x192.png",
      sizes: "192x192",
      type: "image/png",
    },
    {
      src: "/android-chrome-512x512.png",
      sizes: "512x512",
      type: "image/png",
    },
  ],
  display: "standalone",
  /* Matches the app's dark theme-color in index.html. */
  background_color: "#0B0D16",
  theme_color: "#0B0D16",
}
await writeFile(
  path.join(OUT, "site.webmanifest"),
  JSON.stringify(manifest, null, 2) + "\n",
)
console.log("✓ site.webmanifest")

console.log("favicon generation complete")
