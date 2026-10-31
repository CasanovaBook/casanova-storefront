import { useMemo, useState } from "react"

import type { ReaderBookmark, ReaderHighlight } from "../../types"
import { HIGHLIGHT_COLORS } from "../../lib/annotation-utils"
import Modal from "../Modal"
import Icon from "../icons"

export interface AnnotationsPanelProps {
  bookmarks: ReaderBookmark[]
  highlights: ReaderHighlight[]
  loading: boolean
  error: string | null
  currentPage: number
  onClose: () => void
  onJump: (page: number) => void
  onRemoveBookmark: (bookmarkId: string) => Promise<unknown>
  onRemoveHighlight: (highlightId: string) => Promise<unknown>
  onEditHighlight: (highlight: ReaderHighlight) => void
  onAddBookmark: (page: number) => Promise<unknown>
  onRetry: () => void
}

type Tab = "bookmarks" | "highlights"

function formatDate(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleDateString("he-IL", {
        day: "2-digit",
        month: "2-digit",
        year: "2-digit",
      })
}

function colorLabel(color: string): string {
  return (
    HIGHLIGHT_COLORS.find((option) => option.value === color)?.label ?? "צבע"
  )
}

export default function AnnotationsPanel({
  bookmarks,
  highlights,
  loading,
  error,
  currentPage,
  onClose,
  onJump,
  onRemoveBookmark,
  onRemoveHighlight,
  onEditHighlight,
  onAddBookmark,
  onRetry,
}: AnnotationsPanelProps) {
  const [tab, setTab] = useState<Tab>("bookmarks")
  const [busyId, setBusyId] = useState<string | null>(null)

  const currentBookmark = useMemo(
    () => bookmarks.find((bookmark) => bookmark.page === currentPage),
    [bookmarks, currentPage],
  )

  const jump = (page: number) => {
    onJump(page)
    onClose()
  }

  const remove = async (
    id: string,
    action: (bookmarkId: string) => Promise<unknown>,
  ) => {
    setBusyId(id)
    await action(id)
    setBusyId(null)
  }

  return (
    <Modal
      onClose={onClose}
      size="lg"
      zIndex={320}
      title="סימניות והערות"
      subtitle="כל מה שסימנת נשמר בחשבון שלך."
    >
      <div className="space-y-4">
        <div
          className="flex gap-1 rounded-xl border p-1"
          style={{ borderColor: "var(--color-border)" }}
          role="tablist"
          aria-label="סימניות והערות"
        >
          {(
            [
              ["bookmarks", "סימניות", bookmarks.length],
              ["highlights", "הדגשות והערות", highlights.length],
            ] as const
          ).map(([value, label, count]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={tab === value}
              onClick={() => setTab(value)}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition-colors"
              style={{
                background:
                  tab === value ? "var(--color-secondary)" : "transparent",
                color:
                  tab === value
                    ? "var(--color-foreground)"
                    : "var(--color-muted-foreground)",
              }}
            >
              {value === "bookmarks" ? (
                <Icon name="bookmark" size={13} />
              ) : (
                <Icon name="pen" size={13} />
              )}
              {label}
              <span
                className="rounded-full px-1.5 py-0.5 text-[10px] tabular-nums"
                style={{
                  background: "var(--color-border)",
                  color: "var(--color-muted-foreground)",
                }}
              >
                {count}
              </span>
            </button>
          ))}
        </div>

        {error && (
          <div
            role="alert"
            className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-xs"
            style={{
              borderColor: "rgba(167,70,54,0.35)",
              color: "var(--color-danger)",
              background: "rgba(167,70,54,0.08)",
            }}
          >
            <span className="min-w-0">{error}</span>
            <button
              type="button"
              onClick={onRetry}
              className="shrink-0 rounded border px-2 py-1 text-[11px] font-medium"
              style={{ borderColor: "rgba(167,70,54,0.35)" }}
            >
              ניסיון נוסף
            </button>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-xs" style={{ color: "var(--color-muted-foreground)" }}>
            <span className="app-spinner h-4 w-4" />
            טוען סימניות והערות…
          </div>
        ) : tab === "bookmarks" ? (
          <div className="space-y-3">
            {!currentBookmark && (
              <button
                type="button"
                onClick={() => void onAddBookmark(currentPage)}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed px-4 py-3 text-xs font-medium transition-opacity hover:opacity-70"
                style={{
                  borderColor: "var(--color-border)",
                  color: "var(--color-primary)",
                }}
              >
                <Icon name="bookmark" size={14} />
                סימון העמוד הנוכחי ({currentPage})
              </button>
            )}

            {bookmarks.length === 0 ? (
              <div
                className="flex flex-col items-center gap-2 py-10 text-center text-xs"
                style={{ color: "var(--color-muted-foreground)" }}
              >
                <Icon name="bookmark" size={24} />
                <p>אין סימניות עדיין. אפשר לסמן עמוד מתוך סרגל הקריאה.</p>
              </div>
            ) : (
              <ul className="space-y-2">
                {bookmarks.map((bookmark) => (
                  <li
                    key={bookmark.bookmark_id}
                    className="flex items-center gap-2 rounded-xl border px-3 py-2.5"
                    style={{ borderColor: "var(--color-border)" }}
                  >
                    <button
                      type="button"
                      onClick={() => jump(bookmark.page)}
                      className="flex min-w-0 flex-1 items-center gap-3 text-start"
                    >
                      <span
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-semibold tabular-nums"
                        style={{
                          background: "var(--color-secondary)",
                          color: "var(--color-primary)",
                        }}
                      >
                        {bookmark.page}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-medium">
                          עמוד {bookmark.page}
                        </span>
                        {bookmark.created_at && (
                          <span
                            className="block text-[11px]"
                            style={{ color: "var(--color-muted-foreground)" }}
                          >
                            {formatDate(bookmark.created_at)}
                          </span>
                        )}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        void remove(bookmark.bookmark_id, onRemoveBookmark)
                      }
                      disabled={busyId === bookmark.bookmark_id}
                      aria-label={`מחיקת סימנייה בעמוד ${bookmark.page}`}
                      className="tap-target flex h-8 w-8 items-center justify-center rounded-lg transition-opacity hover:opacity-70 disabled:opacity-40"
                      style={{ color: "var(--color-danger)" }}
                    >
                      <Icon name="trash" size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : highlights.length === 0 ? (
          <div
            className="flex flex-col items-center gap-2 py-10 text-center text-xs"
            style={{ color: "var(--color-muted-foreground)" }}
          >
            <Icon name="pen" size={24} />
            <p>סמנו טקסט בעמוד כדי ליצור הדגשה או הערה אישית.</p>
          </div>
        ) : (
          <ul className="space-y-2">
            {highlights.map((highlight) => (
              <li
                key={highlight.highlight_id}
                className="rounded-xl border px-3 py-2.5"
                style={{ borderColor: "var(--color-border)" }}
              >
                <div className="flex items-start gap-2">
                  <button
                    type="button"
                    onClick={() => jump(highlight.page)}
                    className="flex min-w-0 flex-1 items-start gap-2 text-start"
                  >
                    <span
                      className="mt-0.5 h-4 w-4 shrink-0 rounded-full border"
                      style={{
                        background: highlight.color,
                        borderColor: "rgba(0,0,0,0.12)",
                      }}
                      aria-label={colorLabel(highlight.color)}
                    />
                    <span className="min-w-0">
                      <span
                        className="block text-[11px] font-semibold"
                        style={{ color: "var(--color-primary)" }}
                      >
                        עמוד {highlight.page}
                      </span>
                      {highlight.quote && (
                        <span className="mt-0.5 block line-clamp-2 text-xs leading-relaxed" dir="auto">
                          {highlight.quote}
                        </span>
                      )}
                      {highlight.note && (
                        <span
                          className="mt-1 block text-[11px] leading-relaxed"
                          style={{ color: "var(--color-muted-foreground)" }}
                        >
                          {highlight.note}
                        </span>
                      )}
                    </span>
                  </button>
                  <div className="flex shrink-0 items-center">
                    <button
                      type="button"
                      onClick={() => onEditHighlight(highlight)}
                      aria-label={`עריכת הערה בעמוד ${highlight.page}`}
                      className="tap-target flex h-8 w-8 items-center justify-center rounded-lg transition-opacity hover:opacity-70"
                      style={{ color: "var(--color-primary)" }}
                    >
                      <Icon name="pen" size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        void remove(highlight.highlight_id, onRemoveHighlight)
                      }
                      disabled={busyId === highlight.highlight_id}
                      aria-label={`מחיקת הדגשה בעמוד ${highlight.page}`}
                      className="tap-target flex h-8 w-8 items-center justify-center rounded-lg transition-opacity hover:opacity-70 disabled:opacity-40"
                      style={{ color: "var(--color-danger)" }}
                    >
                      <Icon name="trash" size={14} />
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  )
}
