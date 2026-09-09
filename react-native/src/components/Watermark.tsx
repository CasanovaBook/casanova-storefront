/* ─────────────────────────────────────────────────────────────
 * Watermark — attribution, not encryption.
 *
 * A watermark cannot stop a determined person from removing it. What it
 * does is make every leaked page name the account it came from, which is
 * the difference between "our book is on a Telegram channel" and "this
 * copy came from account X on date Y". That is the whole reason
 * `drm_policies.watermark_enabled` exists, and it is why the text comes
 * from the grant's frozen `watermark_text` rather than being rendered
 * here from the signed-in user: a value the server stamped at mint time
 * cannot be changed by patching this bundle.
 *
 * It is a repeating diagonal tile rather than one line in a corner,
 * because a corner stamp is cropped out by the first person who bothers.
 * ───────────────────────────────────────────────────────────── */

import { useMemo, type ReactNode } from "react"

import { Dimensions, StyleSheet, Text, View } from "react-native"

import { colors } from "../theme"

export interface WatermarkProps {
  /** The frozen stamp from the content grant. */

  text: string | null

  /** 0–1, from `drm_policies.watermark_opacity`. */

  opacity?: number

  /** Render nothing at all when false, honouring `watermark_enabled`. */

  enabled?: boolean
}

/** Rows and columns of the tile. Sized against the screen so a tablet
 *  gets proportionally more stamps rather than one large stamp. */

function tileCount(): { rows: number, cols: number } {
  const { width, height } = Dimensions.get("window")

  return {
    rows: Math.max(3, Math.ceil(height / 190)),

    cols: Math.max(2, Math.ceil(width / 260)),
  }
}

export function Watermark({
  text,
  opacity = 0.14,
  enabled = true,
}: WatermarkProps) {
  const { rows, cols } = useMemo(tileCount, [])

  if (!enabled || !text) return null

  /* Clamped: an opacity above ~0.3 makes the page hard to read, and a
   * policy value is editable by a human who may not have seen the
   * result. Below 0.04 it survives nothing. */

  const alpha = Math.max(0.04, Math.min(0.3, opacity))

  const cells: ReactNode[] = []

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      cells.push(
        <View key={`${row}:${col}`} style={styles.cell} pointerEvents="none">
          <Text
            numberOfLines={1}
            pointerEvents="none"
            style={[styles.text, { opacity: alpha, color: colors.foreground }]}
          >
            {text}
          </Text>
        </View>,
      )
    }
  }

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <View style={styles.grid} pointerEvents="none">
        {cells}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  /* Sits above the PDF but below the shield overlay, which is at 9999.
   * If the shield ever rendered under the watermark, a capture would
   * show the stamp over a black rectangle and nothing else — harmless,
   * but the ordering here keeps the intent obvious. */

  grid: {
    flex: 1,

    flexDirection: "row",

    flexWrap: "wrap",

    transform: [{ rotate: "-24deg" }, { scale: 1.45 }],
  },

  cell: {
    flexBasis: "46%",

    flexGrow: 1,

    alignItems: "center",

    justifyContent: "center",

    paddingVertical: 44,
  },

  text: {
    fontSize: 13,

    fontWeight: "600",

    letterSpacing: 0.4,

    textAlign: "center",

    writingDirection: "rtl",
  },
})

export default Watermark
