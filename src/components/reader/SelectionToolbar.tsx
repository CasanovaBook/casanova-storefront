import { useEffect } from "react"
import { createPortal } from "react-dom"

import type { ReaderTextSelection } from "../../types"
import { HIGHLIGHT_COLORS } from "../../lib/annotation-utils"
import Icon from "../icons"

export interface SelectionToolbarProps {
  selection: ReaderTextSelection
  onPickColor: (color: string) => void
  onAddNote: () => void
  onClose: () => void
}

/**
 * Floating action surface for a text selection. Portalled to <body> so a
 * transformed page/route ancestor cannot turn its fixed coordinates into
 * coordinates relative to a tall page container.
 */
export default function SelectionToolbar({
  selection,
  onPickColor,
  onAddNote,
  onClose,
}: SelectionToolbarProps) {
  const anchor = selection.anchor
  const width = Math.min(310, Math.max(220, window.innerWidth - 16))
  const center = anchor.x + anchor.width / 2
  const left = Math.min(
    Math.max(center, width / 2 + 8),
    window.innerWidth - width / 2 - 8,
  )
  const above = anchor.y > 96
  const top = above ? anchor.y - 10 : anchor.y + anchor.height + 10

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }

    document.addEventListener("keydown", onKeyDown)

    return () => document.removeEventListener("keydown", onKeyDown)
  }, [onClose])

  return createPortal(
    <div
      role="toolbar"
      aria-label="פעולות על טקסט מסומן"
      className="fixed z-[400] rounded-xl border p-2 text-xs shadow-2xl"
      style={{
        left,
        top,
        width,
        transform: above ? "translate(-50%, -100%)" : "translate(-50%, 0)",
        background: "var(--color-card)",
        borderColor: "var(--color-border)",
        color: "var(--color-foreground)",
      }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="mb-2 flex items-start gap-2">
        <p
          className="min-w-0 flex-1 line-clamp-2 text-[11px] leading-relaxed"
          style={{ color: "var(--color-muted-foreground)" }}
          dir="auto"
        >
          {selection.quote}
        </p>
        <button
          type="button"
          onClick={onClose}
          aria-label="סגירת תפריט ההדגשה"
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full transition-opacity hover:opacity-70"
          style={{ color: "var(--color-muted-foreground)" }}
        >
          <Icon name="x" size={13} />
        </button>
      </div>

      <div className="flex items-center gap-2">
        {HIGHLIGHT_COLORS.map((color) => (
          <button
            key={color.value}
            type="button"
            onClick={() => onPickColor(color.value)}
            aria-label={`הדגשה ב${color.label}`}
            title={`הדגשה ב${color.label}`}
            className="h-6 w-6 rounded-full border-2 border-white/80 shadow-sm transition-transform hover:scale-110"
            style={{ background: color.value }}
          />
        ))}

        <span
          className="mx-0.5 h-5 w-px"
          style={{ background: "var(--color-border)" }}
          aria-hidden="true"
        />

        <button
          type="button"
          onClick={onAddNote}
          className="flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium transition-opacity hover:opacity-70"
          style={{
            borderColor: "var(--color-border)",
            color: "var(--color-foreground)",
          }}
        >
          <Icon name="pen" size={12} />
          הערה
        </button>
      </div>
    </div>,
    document.body,
  )
}
