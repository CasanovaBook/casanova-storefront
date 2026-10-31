import type { CSSProperties } from "react"

/**
 * A dense, diagonal forensic watermark.
 *
 * Each tile is a multi-line identity stamp rather than a single word, and
 * the tile grid extends 250% past the container in both directions before
 * rotation. Cropping a small region therefore still captures several
 * stamps, and the fixed overlay cannot scroll out of view with the content.
 *
 * The mark is deliberately pointer-events-none: it must never make the
 * reader uncopyable or uninteractive. A browser cannot make a watermark
 * tamper-proof, but this makes the ordinary screenshot/crop workflow carry
 * the signed-in account's identity.
 */
export interface WatermarkPatternProps {
  text: string
  opacity: number
  color?: string
  /** Positioning comes from the caller (`fixed inset-0`, etc.). */
  className?: string
  style?: CSSProperties
  rows?: number
  columns?: number
}

export default function WatermarkPattern({
  text,
  opacity,
  color = "#000000",
  className = "",
  style,
  rows = 14,
  columns = 5,
}: WatermarkPatternProps) {
  const lines = text
    .split(/\s*(?:[•·|]|\n)\s*/)
    .map((line) => line.trim())
    .filter(Boolean)

  if (lines.length === 0) return null

  return (
    <div
      className={`drm-watermark pointer-events-none select-none overflow-hidden ${className}`}
      style={style}
      aria-hidden="true"
    >
      <div
        className="absolute flex flex-col justify-around"
        style={{
          top: "-75%",
          left: "-75%",
          width: "250%",
          height: "250%",
          transform: "rotate(-28deg)",
          opacity,
          color,
        }}
      >
        {Array.from({ length: rows }).map((_, row) => (
          <div key={row} className="flex justify-around gap-x-8">
            {Array.from({ length: columns }).map((_, column) => (
              <div
                key={column}
                className="flex flex-col items-center gap-0.5 text-center leading-tight"
              >
                {lines.map((line, index) => (
                  <span
                    key={index}
                    dir="auto"
                    className="whitespace-nowrap text-[11px] font-medium tracking-wider sm:text-[12px]"
                  >
                    {line}
                  </span>
                ))}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
