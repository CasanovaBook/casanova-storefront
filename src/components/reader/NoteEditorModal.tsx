import { useEffect, useState } from "react"

import type { Result } from "../../shared/result"
import { HIGHLIGHT_COLORS } from "../../lib/annotation-utils"
import Modal from "../Modal"
import Icon from "../icons"

export interface NoteEditorModalProps {
  mode: "create" | "edit"
  page: number
  quote: string
  initialColor: string
  initialNote?: string
  onSave: (
    input: { color: string; note: string },
  ) => Promise<Result<unknown>>
  onDelete?: () => void
  onClose: () => void
}

export default function NoteEditorModal({
  mode,
  page,
  quote,
  initialColor,
  initialNote,
  onSave,
  onDelete,
  onClose,
}: NoteEditorModalProps) {
  const [note, setNote] = useState(initialNote ?? "")
  const [color, setColor] = useState(initialColor)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    setNote(initialNote ?? "")
    setColor(initialColor)
    setError("")
  }, [initialColor, initialNote, page, mode])

  const save = async () => {
    if (mode === "create" && !note.trim()) {
      setError("יש לכתוב הערה לפני השמירה.")
      return
    }

    setSaving(true)
    setError("")

    const result = await onSave({ color, note })

    setSaving(false)

    if (result.ok) {
      onClose()
    } else {
      setError(result.error)
    }
  }

  return (
    <Modal
      onClose={onClose}
      size="md"
      align="center"
      zIndex={320}
      title={mode === "create" ? "הערה חדשה" : "עריכת הערה"}
      subtitle={`עמוד ${page}`}
    >
      <div className="space-y-4">
        {quote && (
          <blockquote
            className="rounded-lg border-s-2 px-3 py-2 text-xs leading-relaxed"
            style={{
              borderColor: "var(--color-primary)",
              background: "var(--color-secondary)",
              color: "var(--color-muted-foreground)",
            }}
            dir="auto"
          >
            {quote}
          </blockquote>
        )}

        <div>
          <p className="app-label mb-2">צבע ההדגשה</p>
          <div className="flex items-center gap-2">
            {HIGHLIGHT_COLORS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setColor(option.value)}
                aria-label={option.label}
                aria-pressed={color === option.value}
                className="h-7 w-7 rounded-full border-2 transition-transform hover:scale-110"
                style={{
                  background: option.value,
                  borderColor:
                    color === option.value
                      ? "var(--color-foreground)"
                      : "transparent",
                }}
              />
            ))}
          </div>
        </div>

        <div>
          <label htmlFor="reader-note-text" className="app-label mb-2 block">
            ההערה שלך
          </label>
          <textarea
            id="reader-note-text"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={4}
            maxLength={2000}
            placeholder="מה חשוב לזכור מהקטע הזה?"
            className="w-full resize-y rounded-lg border px-3 py-2 text-sm outline-none"
            style={{
              borderColor: "var(--color-border)",
              background: "var(--color-card)",
              color: "var(--color-foreground)",
            }}
            autoFocus
          />
          <p
            className="mt-1 text-end text-[11px]"
            style={{ color: "var(--color-muted-foreground)" }}
          >
            {note.length} / 2000
          </p>
        </div>

        {error && (
          <p
            role="alert"
            className="rounded-lg border px-3 py-2 text-xs"
            style={{
              borderColor: "rgba(167,70,54,0.35)",
              color: "var(--color-danger)",
              background: "rgba(167,70,54,0.08)",
            }}
          >
            {error}
          </p>
        )}

        <div className="flex items-center justify-between gap-2">
          <div>
            {mode === "edit" && onDelete && (
              <button
                type="button"
                onClick={onDelete}
                disabled={saving}
                className="tap-target flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-opacity hover:opacity-70 disabled:opacity-40"
                style={{
                  borderColor: "rgba(167,70,54,0.35)",
                  color: "var(--color-danger)",
                }}
              >
                <Icon name="trash" size={13} />
                מחיקה
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="rounded-lg border px-4 py-2 text-xs font-medium transition-opacity hover:opacity-70 disabled:opacity-40"
              style={{
                borderColor: "var(--color-border)",
                color: "var(--color-muted-foreground)",
              }}
            >
              ביטול
            </button>
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving}
              className="btn-gradient tap-target rounded-lg px-4 py-2 text-xs font-semibold disabled:opacity-50"
            >
              {saving ? "שומר…" : "שמירה"}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
