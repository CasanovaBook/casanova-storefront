import { useEffect, useRef, useState } from "react"

import Icon from "../icons"

export interface PageNavigatorColors {
  text: string
  muted: string
  border: string
  accent: string
}

export interface PageNavigatorProps {
  currentPage: number
  totalPages: number
  /** "2–3" in spread mode; defaults to the current page. */
  pageLabel?: string
  canPrev: boolean
  canNext: boolean
  onPrev: () => void
  onNext: () => void
  onJump: (page: number) => void
  colors: PageNavigatorColors
}

function clampPage(page: number, totalPages: number): number {
  const total = Math.max(1, Math.floor(totalPages) || 1)
  const value = Math.floor(Number(page))
  return Number.isFinite(value) ? Math.min(Math.max(value, 1), total) : 1
}

/**
 * Bottom-bar page control: a release-committed range slider plus a direct
 * page field. The slider updates locally while dragging so the thumb stays
 * smooth; the PDF surface only repaints when the value is committed.
 */
export default function PageNavigator({
  currentPage,
  totalPages,
  pageLabel,
  canPrev,
  canNext,
  onPrev,
  onNext,
  onJump,
  colors,
}: PageNavigatorProps) {
  const [sliderValue, setSliderValue] = useState(currentPage)
  const [dragging, setDragging] = useState(false)
  const [draft, setDraft] = useState(String(currentPage))
  const [editing, setEditing] = useState(false)
  const cancelNextBlur = useRef(false)

  useEffect(() => {
    if (!dragging) setSliderValue(currentPage)
  }, [currentPage, dragging])

  useEffect(() => {
    if (!editing) setDraft(String(currentPage))
  }, [currentPage, editing])

  const commitSlider = () => {
    setDragging(false)

    const page = clampPage(sliderValue, totalPages)
    setSliderValue(page)

    if (page !== currentPage) onJump(page)
  }

  const commitDraft = () => {
    setEditing(false)

    if (cancelNextBlur.current) {
      cancelNextBlur.current = false
      setDraft(String(currentPage))
      return
    }

    const parsed = Number.parseInt(draft, 10)
    const page = Number.isFinite(parsed)
      ? clampPage(parsed, totalPages)
      : currentPage

    setDraft(String(page))

    if (page !== currentPage) onJump(page)
  }

  const label = pageLabel || String(currentPage)

  return (
    <div className="flex items-center gap-2 px-3 py-2.5 sm:px-5">
      <button
        type="button"
        onClick={onPrev}
        disabled={!canPrev}
        className="tap-target flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-2.5 text-sm font-medium transition-opacity hover:opacity-70 disabled:opacity-30 sm:px-4"
        style={{ borderColor: colors.border, color: colors.text }}
        aria-label="העמוד הקודם"
      >
        <Icon name="chevronRight" size={15} />
        <span className="hidden sm:inline">הקודם</span>
      </button>

      {totalPages > 0 ? (
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <input
            type="range"
            min={1}
            max={totalPages}
            step={1}
            value={sliderValue}
            onChange={(event) => setSliderValue(Number(event.target.value))}
            onPointerDown={() => setDragging(true)}
            onPointerUp={commitSlider}
            onKeyUp={commitSlider}
            onBlur={commitSlider}
            className="h-2 min-w-0 flex-1 cursor-pointer"
            style={{ accentColor: colors.accent }}
            aria-label="בחירת עמוד"
            aria-valuemin={1}
            aria-valuemax={totalPages}
            aria-valuenow={sliderValue}
            aria-valuetext={`עמודים ${label} מתוך ${totalPages}`}
          />

          <form
            className="flex shrink-0 items-center gap-1"
            onSubmit={(event) => {
              event.preventDefault()
              commitDraft()
            }}
          >
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={totalPages}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onFocus={(event) => {
                setEditing(true)
                event.currentTarget.select()
              }}
              onBlur={commitDraft}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault()
                  cancelNextBlur.current = true
                  setDraft(String(currentPage))
                  setEditing(false)
                  event.currentTarget.blur()
                }
              }}
              className="w-12 rounded-md border px-1.5 py-1 text-center text-xs tabular-nums outline-none"
              style={{
                borderColor: colors.border,
                color: colors.text,
                background: "transparent",
              }}
              aria-label="מספר עמוד ליעד"
            />
            <span
              className="text-xs tabular-nums"
              style={{ color: colors.muted }}
              title={`עמודים ${label} מתוך ${totalPages}`}
            >
              / {totalPages}
            </span>
          </form>
        </div>
      ) : (
        <span
          className="flex-1 text-center text-xs tabular-nums"
          style={{ color: colors.muted }}
        >
          עמוד {currentPage}
        </span>
      )}

      <button
        type="button"
        onClick={onNext}
        disabled={!canNext}
        className="tap-target flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-2.5 text-sm font-medium transition-opacity hover:opacity-70 disabled:opacity-30 sm:px-4"
        style={{ borderColor: colors.border, color: colors.text }}
        aria-label="העמוד הבא"
      >
        <span className="hidden sm:inline">הבא</span>
        <Icon name="chevronLeft" size={15} />
      </button>
    </div>
  )
}
