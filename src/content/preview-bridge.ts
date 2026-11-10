/**
 * Bridge between the Maestro content editor and its same-origin preview frame.
 *
 * The editor posts whichever field the admin is hovering/focused on; the
 * preview locates the element rendering that value and outlines it. Keeping
 * the message shape in one module means the two sides cannot drift.
 */

export const PREVIEW_HIGHLIGHT_MESSAGE = "casanova:cms-highlight" as const
export const PREVIEW_READY_MESSAGE = "casanova:cms-preview-ready" as const

export interface PreviewHighlightMessage {
  type: typeof PREVIEW_HIGHLIGHT_MESSAGE
  /** Content key being edited, e.g. "sales.hero.headline". null clears. */
  key: string | null
  /** Hebrew field label, available to the preview for a caption. */
  label?: string
  /** Field type ("text", "rich", "image", "link", "list", ...). */
  kind?: string
  /** Current value; the preview locates the element that renders it. */
  value?: unknown
  /** Whole-section target: selector for the block an accordion controls. */
  anchor?: string
  /** Scroll the matched element into view (focus, hover or section open). */
  reveal?: boolean
}

export interface PreviewReadyMessage {
  type: typeof PREVIEW_READY_MESSAGE
}

export function isPreviewHighlightMessage(
  data: unknown,
): data is PreviewHighlightMessage {
  if (typeof data !== "object" || data === null) return false
  const msg = data as Record<string, unknown>
  return (
    msg.type === PREVIEW_HIGHLIGHT_MESSAGE &&
    (msg.key === null || typeof msg.key === "string")
  )
}

export function isPreviewReadyMessage(
  data: unknown,
): data is PreviewReadyMessage {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as Record<string, unknown>).type === PREVIEW_READY_MESSAGE
  )
}
