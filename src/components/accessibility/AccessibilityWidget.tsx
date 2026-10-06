import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react"
import { createPortal } from "react-dom"
import {
  FONT_SCALE_MAX,
  FONT_SCALE_MIN,
  useAccessibility,
  type AccessibilityToggle,
} from "../../context/AccessibilityContext"
import Icon, { type IconName } from "../icons"

/**
 * The single accessibility interface for the site.
 *
 * A compact control attached to the inline-end edge of the viewport (the left
 * edge in this RTL layout), vertically centred so it clears the fixed header,
 * the checkout summary and the reader's bottom bar instead of covering a
 * control at either end of the screen.
 *
 * The panel is a non-modal popup anchored beside that button:
 *  - it is a portal to `document.body`, so no transformed or clipped ancestor
 *    can cut it off or trap it — the same reason `Modal.tsx` portals;
 *  - its position is measured from the button's own rect on open and on every
 *    resize, so it opens on whichever side has room and is clamped inside the
 *    viewport at any zoom level, rather than being pinned to fixed pixels;
 *  - it carries dialog semantics with a heading for its accessible name, moves
 *    focus into itself, cycles Tab inside itself, closes on Escape or on a
 *    click outside, and hands focus back to whatever opened it.
 *
 * It is deliberately *not* `aria-modal`: the page behind stays usable, which is
 * what makes the panel something a visitor can keep open while reading.
 */

export const ACCESSIBILITY_PANEL_ID = "accessibility-panel"
export const ACCESSIBILITY_LAUNCHER_ID = "accessibility-launcher"

const PANEL_TITLE_ID = "accessibility-panel-title"
const VIEWPORT_MARGIN = 12
const ANCHOR_GAP = 12

type ToggleRow = {
  key: AccessibilityToggle
  label: string
  icon: IconName
}

const DISPLAY_TOGGLES: ToggleRow[] = [
  { key: "highContrast", label: "ניגודיות גבוהה", icon: "sun" },
  { key: "textContrast", label: "שיפור ניגודיות הטקסט", icon: "type" },
  { key: "grayscale", label: "גווני אפור", icon: "layers" },
  { key: "readableFont", label: "פונט קריא", icon: "bookOpen" },
]

const READING_TOGGLES: ToggleRow[] = [
  { key: "lineHeight", label: "הגדלת ריווח השורות", icon: "lineSpacing" },
  { key: "letterSpacing", label: "הגדלת ריווח האותיות", icon: "letterSpacing" },
  { key: "contentSpacing", label: "הגדלת ריווח בין פסקאות", icon: "list" },
  { key: "highlightLinks", label: "הדגשת קישורים", icon: "link" },
]

const FOCUS_TOGGLES: ToggleRow[] = [
  { key: "highlightFocus", label: "הדגשת מסגרת המיקוד", icon: "target" },
  { key: "reduceMotion", label: "עצירת אנימציות", icon: "zap" },
  { key: "largeTargets", label: "הגדלת אזורי לחיצה", icon: "maximize" },
]

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(", ")

/** Focusable descendants of the panel that are actually rendered. */
function focusableInside(panel: HTMLElement): HTMLElement[] {
  return Array.from(
    panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  ).filter(
    (element) =>
      element.offsetParent !== null || element === document.activeElement,
  )
}

export default function AccessibilityWidget() {
  const {
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
  } = useAccessibility()

  const launcherRef = useRef<HTMLButtonElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const [panelStyle, setPanelStyle] = useState<CSSProperties | null>(null)
  const [message, setMessage] = useState("")
  const wasOpen = useRef(false)
  const focusMoved = useRef(false)

  /**
   * Anchors the panel next to the launcher: on the side of the button with
   * room for it, vertically centred on the button and clamped to the viewport.
   * Everything is derived from measured rects, so it holds at 200% zoom and at
   * any viewport width instead of depending on hard-coded pixel offsets.
   */
  const positionPanel = useCallback(() => {
    const launcher = launcherRef.current
    const panel = panelRef.current
    if (!launcher || !panel) return

    const anchor = launcher.getBoundingClientRect()
    const measured = panel.getBoundingClientRect()
    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight
    const width = Math.min(measured.width, viewportWidth - VIEWPORT_MARGIN * 2)
    const height = Math.min(
      measured.height,
      viewportHeight - VIEWPORT_MARGIN * 2,
    )

    const roomAfter = viewportWidth - anchor.right
    const roomBefore = anchor.left

    let left: number
    if (roomAfter >= width + ANCHOR_GAP) left = anchor.right + ANCHOR_GAP
    else if (roomBefore >= width + ANCHOR_GAP)
      left = anchor.left - ANCHOR_GAP - width
    else left = (viewportWidth - width) / 2

    left = Math.min(
      Math.max(left, VIEWPORT_MARGIN),
      Math.max(VIEWPORT_MARGIN, viewportWidth - width - VIEWPORT_MARGIN),
    )

    const anchorCenter = anchor.top + anchor.height / 2
    const top = Math.min(
      Math.max(anchorCenter - height / 2, VIEWPORT_MARGIN),
      Math.max(VIEWPORT_MARGIN, viewportHeight - height - VIEWPORT_MARGIN),
    )

    setPanelStyle({ top, left })
  }, [])

  /* Measure once the panel is in the DOM, and again whenever the viewport or
   * the panel's own height changes (zoom, rotation, a longer list of labels). */
  useLayoutEffect(() => {
    if (!panelOpen) {
      setPanelStyle(null)
      return
    }
    positionPanel()
  }, [panelOpen, positionPanel, preferences.fontScale])

  /* Focus moves into the dialog only once it has a position — an element still
   * waiting on `visibility: hidden` cannot receive focus, so doing this in the
   * same commit as the open would silently do nothing and leave the dialog
   * open with focus behind it. Runs once per opening, not on every reposition,
   * so resizing the window never steals focus. */
  useEffect(() => {
    if (!panelOpen) {
      focusMoved.current = false
      return
    }
    if (focusMoved.current || !panelStyle) return
    focusMoved.current = true
    try {
      panelRef.current?.focus()
    } catch {
      /* Focus can be refused mid-navigation; Tab handling still works. */
    }
  }, [panelOpen, panelStyle])

  useEffect(() => {
    if (!panelOpen) return
    const onResize = () => positionPanel()
    window.addEventListener("resize", onResize)
    const panel = panelRef.current
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(onResize)
    if (panel && observer) observer.observe(panel)
    return () => {
      window.removeEventListener("resize", onResize)
      observer?.disconnect()
    }
  }, [panelOpen, positionPanel])

  /* Keyboard and pointer behaviour of the open panel. */
  useEffect(() => {
    if (!panelOpen) return
    const panel = panelRef.current
    if (!panel) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        /* Stop the event here so a dialog further up the page does not also
         * react to the same Escape press. */
        event.stopPropagation()
        event.preventDefault()
        closePanel()
        return
      }
      if (event.key !== "Tab") return
      const items = focusableInside(panel)
      if (items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]
      if (!panel.contains(document.activeElement)) {
        event.preventDefault()
        first.focus()
        return
      }
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (panel.contains(target) || launcherRef.current?.contains(target))
        return
      closePanel()
    }

    panel.addEventListener("keydown", onKeyDown)
    document.addEventListener("pointerdown", onPointerDown, true)
    return () => {
      panel.removeEventListener("keydown", onKeyDown)
      document.removeEventListener("pointerdown", onPointerDown, true)
    }
  }, [panelOpen, closePanel])

  /* Focus returns to whichever control opened the panel. When the panel is
   * closed by hiding the widget that button is gone, so focus falls back to
   * the footer control that restores it, and only then to the main region — a
   * keyboard user never loses their place. */
  useEffect(() => {
    if (panelOpen) {
      wasOpen.current = true
      return
    }
    if (!wasOpen.current) return
    wasOpen.current = false

    const restoreTarget =
      (opener?.isConnected ? opener : null) ??
      launcherRef.current ??
      document.querySelector<HTMLElement>("[data-a11y-restore]")

    if (restoreTarget) {
      try {
        restoreTarget.focus()
      } catch {
        /* Nothing else to do; the live region below still reports the change. */
      }
      return
    }

    const main = document.getElementById("main")
    if (main) {
      try {
        main.setAttribute("tabindex", "-1")
        main.focus()
      } catch {
        /* Ignore. */
      }
    }
  }, [panelOpen, opener])

  const onFontScaleChange = (value: number) => {
    setFontScale(value)
    setMessage(`גודל הטקסט שונה ל-${value} אחוז`)
  }

  const onReset = () => {
    resetPreferences()
    setMessage("הגדרות הנגישות אופסו לברירת המחדל")
  }

  const onHide = () => {
    hideWidget()
    setMessage(
      "כפתור הנגישות הוסתר. אפשר להחזיר אותו מהקישור בתחתית העמוד או במקשי Alt ו-A יחד.",
    )
  }

  /* Each toggle renders as a pressed-state tile: a real button carrying
   * `aria-pressed`, so a screen reader announces "pressed" / "not pressed"
   * instead of leaving a bare checkbox state to be inferred. */
  const toggleTile = ({ key, label, icon }: ToggleRow) => (
    <button
      type="button"
      className="a11y-tile"
      key={key}
      aria-pressed={preferences[key]}
      onClick={() => setToggle(key, !preferences[key])}
    >
      <span className="a11y-tile-icon">
        <Icon name={icon} size={18} />
      </span>
      <span>{label}</span>
    </button>
  )

  return (
    <>
      {/* Always mounted, even while the button is hidden, so hiding the widget
       * is still announced to a screen reader. */}
      <div className="sr-only" role="status">
        {message}
      </div>

      {!hidden && (
        <button
          ref={launcherRef}
          id={ACCESSIBILITY_LAUNCHER_ID}
          type="button"
          className="a11y-launcher"
          aria-haspopup="dialog"
          aria-expanded={panelOpen}
          aria-controls={ACCESSIBILITY_PANEL_ID}
          aria-label={
            panelOpen ? "נגישות — סגירת התפריט" : "נגישות — פתיחת התפריט"
          }
          title="הגדרות נגישות"
          onClick={(event) => {
            if (panelOpen) closePanel()
            else openPanel(event.currentTarget)
          }}
        >
          <Icon name="accessibility" size={18} />
          <span>נגישות</span>
        </button>
      )}

      {panelOpen &&
        createPortal(
          <div
            id={ACCESSIBILITY_PANEL_ID}
            ref={panelRef}
            role="dialog"
            aria-labelledby={PANEL_TITLE_ID}
            tabIndex={-1}
            className="a11y-panel"
            style={{
              /* Hidden for the single frame it takes to measure, so the panel
               * is never painted at the wrong corner of the screen. */
              ...panelStyle,
              visibility: panelStyle ? "visible" : "hidden",
            }}
          >
            <div className="a11y-panel-head">
              <h2 id={PANEL_TITLE_ID} className="a11y-panel-title">
                <Icon name="accessibility" size={16} />
                הגדרות נגישות
              </h2>
              <button
                type="button"
                className="a11y-icon-button"
                aria-label="סגירת תפריט הנגישות"
                title="סגירת תפריט הנגישות"
                onClick={closePanel}
              >
                <Icon name="x" size={16} />
              </button>
            </div>

            <div className="a11y-panel-body">
              <fieldset className="a11y-group">
                <legend>גודל טקסט</legend>
                <div className="a11y-font-controls">
                  <button
                    type="button"
                    className="a11y-button"
                    onClick={() => stepFontScale(1)}
                    disabled={preferences.fontScale >= FONT_SCALE_MAX}
                    /* The visible glyphs appear in the name as their own word
                     * (not inside brackets), so voice control still matches
                     * them to the name (WCAG 2.5.3). */
                    aria-label="הגדל את גודל הטקסט A+"
                  >
                    A+
                  </button>
                  <span className="a11y-readout" aria-live="polite">
                    {preferences.fontScale}%
                  </span>
                  <button
                    type="button"
                    className="a11y-button"
                    onClick={() => stepFontScale(-1)}
                    disabled={preferences.fontScale <= FONT_SCALE_MIN}
                    aria-label="הקטן את גודל הטקסט A−"
                  >
                    A−
                  </button>
                </div>
                <button
                  type="button"
                  className="a11y-button a11y-button-wide"
                  onClick={() => onFontScaleChange(100)}
                  disabled={preferences.fontScale === 100}
                >
                  גודל טקסט רגיל
                </button>
              </fieldset>

              <fieldset className="a11y-group">
                <legend>תצוגה</legend>
                <div className="a11y-tile-grid">
                  {DISPLAY_TOGGLES.map(toggleTile)}
                </div>
              </fieldset>

              <fieldset className="a11y-group">
                <legend>קריאה</legend>
                <div className="a11y-tile-grid">
                  {READING_TOGGLES.map(toggleTile)}
                </div>
              </fieldset>

              <fieldset className="a11y-group">
                <legend>מיקוד ותנועה</legend>
                <div className="a11y-tile-grid">
                  {FOCUS_TOGGLES.map(toggleTile)}
                </div>
              </fieldset>

              <div className="a11y-panel-actions">
                <button
                  type="button"
                  className="a11y-button a11y-button-danger a11y-button-wide"
                  onClick={onReset}
                >
                  <Icon name="refresh" size={16} />
                  איפוס הגדרות נגישות
                </button>
                <button
                  type="button"
                  className="a11y-button a11y-button-wide"
                  onClick={onHide}
                >
                  <Icon name="eyeOff" size={16} />
                  הסתר את כפתור הנגישות
                </button>
                <p className="a11y-panel-note">
                  לפתיחת התפריט בכל עמוד: Alt + A. לפניות בנושא נגישות אפשר
                  לפנות <a href="/support">בעמוד התמיכה</a>.
                </p>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  )
}
