/**
 * Page grouping for the reader.
 *
 * Spread layout treats page 1 as a cover and then pairs the verso/recto
 * pages of the book: [2, 3], [4, 5], ... . The pages are returned in
 * reading order; the spread container inherits the document's RTL direction,
 * so the first page of the pair is rendered on the right in this Hebrew
 * storefront. `page` is 1-based.
 */
export function readerSpreadPages(page: number, totalPages: number): number[] {
  const total = Math.max(0, Math.floor(totalPages))

  if (total <= 1) return [1]

  const safePage = Math.min(Math.max(Math.floor(page) || 1, 1), total)

  if (safePage <= 1) return [1]

  const start = safePage % 2 === 0 ? safePage : safePage - 1

  return start + 1 <= total ? [start, start + 1] : [start]
}

export function readerVisiblePages(
  page: number,
  totalPages: number,
  spread: boolean,
): number[] {
  if (!spread) {
    const total = Math.max(0, Math.floor(totalPages))
    const safePage = Math.max(1, Math.floor(page) || 1)
    return [total > 0 ? Math.min(safePage, total) : safePage]
  }

  return readerSpreadPages(page, totalPages)
}

/** The next page an action should land on, or null at the end. */
export function nextReaderPage(
  page: number,
  totalPages: number,
  spread: boolean,
): number | null {
  const total = Math.max(0, Math.floor(totalPages))

  if (total <= 0) return null

  if (!spread) {
    return page < total ? page + 1 : null
  }

  const pages = readerSpreadPages(page, total)
  const next = pages[pages.length - 1] + 1

  return next <= total ? next : null
}

/** The previous page an action should land on, or null at the cover. */
export function previousReaderPage(
  page: number,
  totalPages: number,
  spread: boolean,
): number | null {
  if (!spread) return page > 1 ? page - 1 : null

  const pages = readerSpreadPages(page, totalPages)

  if (pages[0] <= 1) return null

  /* Going back from [2,3] lands on the cover; from [4,5] it lands on the
   * start of the previous spread, [2,3]. */
  return pages[0] === 2 ? 1 : pages[0] - 2
}

export function pageRangeLabel(pages: number[]): string {
  if (pages.length <= 1) return String(pages[0] ?? 1)
  return `${pages[0]}–${pages[pages.length - 1]}`
}
