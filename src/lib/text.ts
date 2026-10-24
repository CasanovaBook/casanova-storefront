const DASHES = /[\u2013\u2014]/g

/** Replaces en and em dashes with a standard hyphen. */
export function normalizeHyphens(text: string): string {
  return text.replace(DASHES, "-")
}

/** Normalizes every string inside a content value while preserving its shape. */
export function normalizeHyphensDeep<T>(value: T): T {
  if (typeof value === "string") return normalizeHyphens(value) as T
  if (Array.isArray(value)) {
    return value.map((item) => normalizeHyphensDeep(item)) as T
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, normalizeHyphensDeep(item)]),
    ) as T
  }
  return value
}
