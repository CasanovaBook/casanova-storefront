import Icon from "../icons"

export interface BookmarkToggleProps {
  page: number
  bookmarked: boolean
  disabled?: boolean
  onToggle: () => void
  colors: { text: string; muted: string; border: string; accent: string }
}

export default function BookmarkToggle({
  page,
  bookmarked,
  disabled = false,
  onToggle,
  colors,
}: BookmarkToggleProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      aria-pressed={bookmarked}
      aria-label={bookmarked ? `הסרת סימנייה מעמוד ${page}` : `סימון עמוד ${page}`}
      title={bookmarked ? "הסרת הסימנייה מהעמוד" : "סימון העמוד הנוכחי"}
      className="tap-target flex items-center justify-center rounded border transition-opacity hover:opacity-70 disabled:opacity-30"
      style={{
        width: 32,
        height: 32,
        borderColor: bookmarked ? colors.accent : colors.border,
        color: bookmarked ? colors.accent : colors.muted,
      }}
    >
      <Icon
        name="bookmark"
        size={15}
        fill={bookmarked ? "currentColor" : "none"}
      />
    </button>
  )
}
