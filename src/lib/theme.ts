export type Theme = "light" | "dark"

export const THEME_STORAGE_KEY = "casanova_theme"

export function isTheme(value: unknown): value is Theme {
  return value === "light" || value === "dark"
}

export function getStoredTheme(): Theme | null {
  if (typeof window === "undefined") return null

  try {
    const value = window.localStorage.getItem(THEME_STORAGE_KEY)
    return isTheme(value) ? value : null
  } catch {
    return null
  }
}

export function getSystemTheme(): Theme {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return "light"
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light"
}

/**
 * The pre-hydration script in index.html resolves the same preference before
 * the first paint. Reading its result here keeps React from disagreeing with
 * what is already on screen.
 */
export function getInitialTheme(): Theme {
  if (typeof document !== "undefined") {
    const current = document.documentElement.dataset.theme
    if (isTheme(current)) return current
  }

  return getStoredTheme() ?? getSystemTheme()
}

export function applyTheme(theme: Theme): void {
  if (typeof document === "undefined") return

  const root = document.documentElement

  root.dataset.theme = theme
  root.classList.toggle("dark", theme === "dark")
}

export function storeTheme(theme: Theme): void {
  if (typeof window === "undefined") return

  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme)
  } catch {
    /* Storage can be blocked; the in-memory theme still applies. */
  }
}
