import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"

/**
 * Accessibility preferences for the whole storefront.
 *
 * This provider is the *only* place that reads, validates, persists and
 * applies accessibility settings. It mounts once, above the router in
 * `src/App.tsx`, so a preference set on the storefront is still in force on
 * checkout, the dashboard, the admin panel and the protected reader, and
 * survives navigation without any page knowing about it.
 *
 * How settings reach the page
 * ---------------------------
 * Every flag is a `data-a11y-*` attribute on `<html>` (font size is the one
 * exception: it is the root `font-size` itself). The styling that reacts to
 * them lives in one clearly marked block in `src/index.css`. That keeps the
 * cost at zero re-renders of page content — toggling a setting mutates one
 * attribute on one element — and it works for content this app does not own,
 * such as CMS-rendered pages.
 *
 * What is deliberately *not* persisted
 * ------------------------------------
 * Only the preference object and the one `hidden` boolean are written to
 * localStorage, under a versioned key. No identifiers, no session data, so
 * this state cannot collide with authentication, checkout or reader state.
 * The v1 key written by the removed accessibility menu is deleted on read:
 * its attribute names no longer exist, so leaving it behind would be dead
 * state that looks live.
 */

/** Versioned key. Bump it whenever the stored shape changes. */
export const ACCESSIBILITY_STORAGE_KEY = "casanova_accessibility_v2"

/** Keys written by the removed accessibility menu. Deleted, not migrated. */
const LEGACY_STORAGE_KEYS = ["casanova_accessibility_v1"]

export const FONT_SCALE_DEFAULT = 100
export const FONT_SCALE_MIN = 90
export const FONT_SCALE_MAX = 160
export const FONT_SCALE_STEP = 10

export interface AccessibilityPreferences {
  /** Root font size, as a percentage of the browser's own default. */
  fontScale: number
  /** Larger line height across body copy. */
  lineHeight: boolean
  /** Wider letter spacing, which helps some readers with dyslexia. */
  letterSpacing: boolean
  /** Extra space between paragraphs and list items. */
  contentSpacing: boolean
  /** Black/white/yellow theme with strong borders. */
  highContrast: boolean
  /** Raises the contrast of muted text without repainting the theme. */
  textContrast: boolean
  /** Desaturates theme colours and images. */
  grayscale: boolean
  /** Underlines every link. */
  highlightLinks: boolean
  /** Stronger, two-tone focus ring. */
  highlightFocus: boolean
  /** Swaps the display serif for the body sans. */
  readableFont: boolean
  /** Stops animation and transitions, including the OS-level request. */
  reduceMotion: boolean
  /** Grows compact controls to at least 52px. */
  largeTargets: boolean
}

export type AccessibilityToggle = Exclude<keyof AccessibilityPreferences, "fontScale">

const DEFAULT_PREFERENCES: AccessibilityPreferences = {
  fontScale: FONT_SCALE_DEFAULT,
  lineHeight: false,
  letterSpacing: false,
  contentSpacing: false,
  highContrast: false,
  textContrast: false,
  grayscale: false,
  highlightLinks: false,
  highlightFocus: false,
  readableFont: false,
  reduceMotion: false,
  largeTargets: false,
}

const TOGGLE_KEYS: AccessibilityToggle[] = [
  "lineHeight",
  "letterSpacing",
  "contentSpacing",
  "highContrast",
  "textContrast",
  "grayscale",
  "highlightLinks",
  "highlightFocus",
  "readableFont",
  "reduceMotion",
  "largeTargets",
]

/** The data attribute that drives each toggle in `src/index.css`. */
const TOGGLE_ATTRIBUTES: Record<AccessibilityToggle, string> = {
  lineHeight: "a11yLineHeight",
  letterSpacing: "a11yLetterSpacing",
  contentSpacing: "a11yContentSpacing",
  highContrast: "a11yContrast",
  textContrast: "a11yTextContrast",
  grayscale: "a11yGrayscale",
  highlightLinks: "a11yLinks",
  highlightFocus: "a11yFocus",
  readableFont: "a11yReadableFont",
  reduceMotion: "a11yReduceMotion",
  largeTargets: "a11yLargeTargets",
}

interface StoredState {
  preferences: AccessibilityPreferences
  hidden: boolean
}

function clampFontScale(value: number): number {
  const stepped = Math.round(value / FONT_SCALE_STEP) * FONT_SCALE_STEP
  return Math.min(FONT_SCALE_MAX, Math.max(FONT_SCALE_MIN, stepped))
}

/** Rebuilds a preferences object from untrusted local storage. */
function sanitizePreferences(raw: unknown): AccessibilityPreferences {
  const preferences = { ...DEFAULT_PREFERENCES }
  if (!raw || typeof raw !== "object") return preferences
  const source = raw as Record<string, unknown>

  const scale = Number(source.fontScale)
  if (Number.isFinite(scale)) preferences.fontScale = clampFontScale(scale)

  for (const key of TOGGLE_KEYS) {
    if (typeof source[key] === "boolean")
      preferences[key] = (source[key] as boolean)
  }

  return preferences
}

function loadState(): StoredState {
  if (typeof window === "undefined") {
    return { preferences: { ...DEFAULT_PREFERENCES }, hidden: false }
  }
  try {
    for (const key of LEGACY_STORAGE_KEYS) window.localStorage.removeItem(key)
  } catch {
    /* Storage can be unavailable (private mode, disabled cookies). */
  }
  try {
    const raw = window.localStorage.getItem(ACCESSIBILITY_STORAGE_KEY)
    if (!raw) return { preferences: { ...DEFAULT_PREFERENCES }, hidden: false }
    const parsed = JSON.parse(raw) as Record<string, unknown>
    return {
      preferences: sanitizePreferences(parsed?.preferences),
      hidden: parsed?.hidden === true,
    }
  } catch {
    return { preferences: { ...DEFAULT_PREFERENCES }, hidden: false }
  }
}

/** Writes every setting onto `<html>`. One DOM write per flag, nothing else. */
function applyPreferences(
  preferences: AccessibilityPreferences,
  hidden: boolean,
) {
  const root = document.documentElement

  if (preferences.fontScale === FONT_SCALE_DEFAULT) {
    root.style.removeProperty("font-size")
  } else {
    root.style.fontSize = `${preferences.fontScale}%`
  }

  for (const key of TOGGLE_KEYS) {
    root.dataset[TOGGLE_ATTRIBUTES[key]] = preferences[key] ? "true" : "false"
  }

  /* The launcher reads this through CSS only to keep its edge flush; the
   * panel is separate. Nothing else depends on a mounted widget. */
  root.dataset.a11yHidden = hidden ? "true" : "false"
}

interface AccessibilityContextValue {
  preferences: AccessibilityPreferences
  /** True when the visitor hid the floating button. */
  hidden: boolean
  /** True while the settings panel is open. */
  panelOpen: boolean
  /** The control that opened the panel, so focus can go back to it. */
  opener: HTMLElement | null
  setToggle: (key: AccessibilityToggle, value: boolean) => void
  setFontScale: (value: number) => void
  stepFontScale: (direction: 1 | -1) => void
  resetPreferences: () => void
  openPanel: (opener?: HTMLElement | null) => void
  closePanel: () => void
  hideWidget: () => void
  showWidget: () => void
}

const AccessibilityContext = createContext<AccessibilityContextValue | null>(
  null,
)

export function AccessibilityProvider({ children }: { children: ReactNode }) {
  const [{ preferences: initialPreferences, hidden: initialHidden }] =
    useState(loadState)
  const [preferences, setPreferences] =
    useState<AccessibilityPreferences>(initialPreferences)
  const [hidden, setHidden] = useState(initialHidden)
  const [panelOpen, setPanelOpen] = useState(false)
  const [opener, setOpener] = useState<HTMLElement | null>(null)

  /* Layout effect, not effect: the saved font size and contrast theme are in
   * place before the first paint, so a returning visitor does not see the
   * page render twice. */
  useLayoutEffect(() => {
    applyPreferences(preferences, hidden)
  }, [preferences, hidden])

  useEffect(() => {
    try {
      window.localStorage.setItem(
        ACCESSIBILITY_STORAGE_KEY,
        JSON.stringify({ preferences, hidden }),
      )
    } catch {
      /* Persistence is best-effort; the session still works without it. */
    }
  }, [preferences, hidden])

  const setToggle = useCallback((key: AccessibilityToggle, value: boolean) => {
    setPreferences((current) => ({ ...current, [key]: value }))
  }, [])

  const setFontScale = useCallback((value: number) => {
    setPreferences((current) => ({
      ...current,
      fontScale: clampFontScale(value),
    }))
  }, [])

  const stepFontScale = useCallback((direction: 1 | -1) => {
    setPreferences((current) => ({
      ...current,
      fontScale: clampFontScale(
        current.fontScale + direction * FONT_SCALE_STEP,
      ),
    }))
  }, [])

  const resetPreferences = useCallback(() => {
    setPreferences({ ...DEFAULT_PREFERENCES })
  }, [])

  const openPanel = useCallback((source?: HTMLElement | null) => {
    const active = document.activeElement
    setOpener(source ?? (active instanceof HTMLElement ? active : null))
    setPanelOpen(true)
  }, [])

  const closePanel = useCallback(() => {
    setPanelOpen(false)
  }, [])

  const hideWidget = useCallback(() => {
    setPanelOpen(false)
    setHidden(true)
  }, [])

  const showWidget = useCallback(() => {
    setHidden(false)
  }, [])

  /**
   * Alt+A opens the panel from anywhere, including the reader and the admin
   * shell, and restores the button if it had been hidden. `event.code` is used
   * rather than `event.key` because Alt+A produces a different character on
   * macOS keyboards. This is the visitor's guaranteed way back to the controls
   * on a page with no footer — a screen-reader user cannot be locked out of
   * the accessibility settings by hiding the button.
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey)
        return
      if (event.code !== "KeyA") return
      event.preventDefault()
      setHidden(false)
      setPanelOpen(true)
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [])

  const value = useMemo<AccessibilityContextValue>(
    () => ({
      preferences,
      hidden,
      panelOpen,
      opener,
      setToggle,
      setFontScale,
      stepFontScale,
      resetPreferences,
      openPanel,
      closePanel,
      hideWidget,
      showWidget,
    }),
    [
      preferences,
      hidden,
      panelOpen,
      opener,
      setToggle,
      setFontScale,
      stepFontScale,
      resetPreferences,
      openPanel,
      closePanel,
      hideWidget,
      showWidget,
    ],
  )

  return (
    <AccessibilityContext.Provider value={value}>
      {children}
    </AccessibilityContext.Provider>
  )
}

export function useAccessibility(): AccessibilityContextValue {
  const context = useContext(AccessibilityContext)
  if (!context) {
    throw new Error(
      "useAccessibility must be used inside an AccessibilityProvider",
    )
  }
  return context
}
