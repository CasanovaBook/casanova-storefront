import { useEffect, useState, useRef } from "react"

const STORAGE_KEY = "casanova_accessibility_v1"

type Prefs = {
  fontScale: number
  highContrast: boolean
  grayscale: boolean
  highlightLinks: boolean
  reducedMotion: boolean
}

const defaultPrefs: Prefs = {
  fontScale: 100,
  highContrast: false,
  grayscale: false,
  highlightLinks: false,
  reducedMotion: false,
}

function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return defaultPrefs
    return { ...defaultPrefs, ...JSON.parse(raw) }
  } catch {
    return defaultPrefs
  }
}

function savePrefs(p: Prefs) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p))
  } catch {}
}

function applyPrefs(p: Prefs) {
  document.documentElement.style.fontSize = `${p.fontScale}%`
  document.documentElement.setAttribute("data-access-high-contrast", String(p.highContrast))
  document.documentElement.setAttribute("data-access-grayscale", String(p.grayscale))
  document.documentElement.setAttribute("data-access-highlight-links", String(p.highlightLinks))
  document.documentElement.setAttribute("data-access-reduced-motion", String(p.reducedMotion))
}

export default function AccessibilityMenu() {
  const [open, setOpen] = useState(false)
  const [prefs, setPrefs] = useState<Prefs>(() => loadPrefs())
  const btnRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    applyPrefs(prefs)
    savePrefs(prefs)
  }, [prefs])

  useEffect(() => {
    // Apply persisted on mount
    applyPrefs(prefs)
  }, [])

  useEffect(() => {
    const handler = () => setOpen(true)
    window.addEventListener("open-accessibility-debug", handler)
    return () => window.removeEventListener("open-accessibility-debug", handler)
  }, [])

  const inc = () => setPrefs((s) => ({ ...s, fontScale: Math.min(150, s.fontScale + 10) }))
  const dec = () => setPrefs((s) => ({ ...s, fontScale: Math.max(80, s.fontScale - 10) }))
  const reset = () => setPrefs(defaultPrefs)

  return (
    <div className="accessibility-menu" aria-hidden={open ? "false" : "true"}>
      <button
        ref={btnRef}
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls="accessibility-panel"
        onClick={() => setOpen((v) => !v)}
        className="tap-target px-3 py-2 rounded-lg border"
        style={{ marginLeft: 8 }}
      >
        נגישות
      </button>

      {open && (
        <div
          id="accessibility-panel"
          role="dialog"
          aria-label="תפריט נגישות"
          className="card-glow p-4 rounded shadow"
          style={{ position: "absolute", right: 12, top: 56, zIndex: 120 }}
        >
          <div className="flex flex-col gap-2" style={{ minWidth: 220 }}>
            <button onClick={inc} className="tap-target text-sm">הגדלת טקסט</button>
            <button onClick={dec} className="tap-target text-sm">הקטנת טקסט</button>
            <button
              onClick={() => setPrefs((s) => ({ ...s, highContrast: !s.highContrast }))}
              className="tap-target text-sm"
            >
              ניגודיות גבוהה
            </button>
            <button
              onClick={() => setPrefs((s) => ({ ...s, grayscale: !s.grayscale }))}
              className="tap-target text-sm"
            >
              גווני אפור
            </button>
            <button
              onClick={() => setPrefs((s) => ({ ...s, highlightLinks: !s.highlightLinks }))}
              className="tap-target text-sm"
            >
              הדגשת קישורים
            </button>
            <button
              onClick={() => setPrefs((s) => ({ ...s, reducedMotion: !s.reducedMotion }))}
              className="tap-target text-sm"
            >
              הפחתת תנועה
            </button>
            <button onClick={reset} className="tap-target text-sm text-red-500">איפוס הגדרות נגישות</button>
            <button onClick={() => setOpen(false)} className="tap-target text-sm">סגירת תפריט הנגישות</button>
          </div>
        </div>
      )}
    </div>
  )
}
