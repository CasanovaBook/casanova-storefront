/* ─────────────────────────────────────────────────────────────
 * Cookie & localStorage consent banner.
 *
 * Israeli Privacy Protection Law requires informing users about
 * data collection and obtaining consent for non-essential storage.
 * This banner covers both traditional cookies and localStorage usage.
 *
 * The banner distinguishes between:
 *  - Essential storage (session, checkout) - always active
 *  - Functional storage (accessibility prefs, theme) - user can opt out
 *  - Analytics (Google Analytics, if configured) - requires explicit consent
 *
 * Consent state is stored in localStorage under a versioned key.
 * ───────────────────────────────────────────────────────────── */

import { useEffect, useState } from "react"
import Icon from "./icons"

const CONSENT_KEY = "casanova_cookie_consent_v1"

interface ConsentState {
  essential: true // always true, cannot be declined
  functional: boolean
  analytics: boolean
  timestamp: string
}

const DEFAULT_CONSENT: ConsentState = {
  essential: true,
  functional: true,
  analytics: false,
  timestamp: "",
}

function readConsent(): ConsentState | null {
  try {
    const raw = localStorage.getItem(CONSENT_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<ConsentState>
    if (!parsed || typeof parsed.functional !== "boolean") return null
    return {
      essential: true,
      functional: parsed.functional ?? true,
      analytics: parsed.analytics ?? false,
      timestamp: parsed.timestamp ?? "",
    }
  } catch {
    return null
  }
}

function writeConsent(state: ConsentState): void {
  try {
    localStorage.setItem(CONSENT_KEY, JSON.stringify(state))
  } catch {
    /* Storage unavailable - consent stays in memory only */
  }
}

/**
 * Returns the current consent state. If no consent has been given yet,
 * returns null (which triggers the banner).
 */
export function getConsent(): ConsentState | null {
  return readConsent()
}

/**
 * Returns true if analytics storage is permitted by the user's consent.
 */
export function isAnalyticsAllowed(): boolean {
  return readConsent()?.analytics === true
}

export default function CookieConsent() {
  const [show, setShow] = useState(false)
  const [consent, setConsent] = useState<ConsentState | null>(null)
  const [detailed, setDetailed] = useState(false)

  useEffect(() => {
    const existing = readConsent()
    if (existing) {
      setConsent(existing)
    } else {
      setShow(true)
    }
  }, [])

  const handleAcceptAll = () => {
    const state: ConsentState = {
      essential: true,
      functional: true,
      analytics: true,
      timestamp: new Date().toISOString(),
    }
    writeConsent(state)
    setConsent(state)
    setShow(false)
  }

  const handleEssentialOnly = () => {
    const state: ConsentState = {
      essential: true,
      functional: false,
      analytics: false,
      timestamp: new Date().toISOString(),
    }
    writeConsent(state)
    setConsent(state)
    setShow(false)
  }

  const handleSavePreferences = () => {
    const state: ConsentState = {
      essential: true,
      functional: consent?.functional ?? true,
      analytics: consent?.analytics ?? false,
      timestamp: new Date().toISOString(),
    }
    writeConsent(state)
    setConsent(state)
    setShow(false)
  }

  if (!show) return null

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-[100] p-4"
      role="region"
      aria-labelledby="cookie-consent-title"
      aria-describedby="cookie-consent-desc"
    >
      <div className="consent-panel max-w-2xl mx-auto rounded-2xl border p-4 sm:p-6">
        <h2 id="cookie-consent-title" className="font-display text-lg font-bold mb-2 flex items-center gap-2">
          <Icon name="lock" size={18} style={{ color: "#DE9A60" }} />
          פרטיות ואחסון נתונים
        </h2>

        <div id="cookie-consent-desc" className="text-sm mb-3 space-y-2" style={{ color: "#ded4c6" }}>
          <p>
            האתר משתמש ב-<strong>localStorage</strong> חיוני לתפעול (התחברות
            ורכישה) ובהעדפות אופציונליות (נגישות וערכת נושא). אין שימוש
            ב-<strong>Cookies של צד שלישי</strong> למעט Google Analytics, אם
            הופעל, ולא נאסף מידע לפרסום ללא הסכמתך.
          </p>
          {detailed && (
            <div className="consent-detail mt-3 space-y-3 p-3 rounded-lg">
              <div className="flex items-start gap-3">
                <span className="w-3 h-3 rounded-full mt-1 flex-shrink-0" style={{ background: "#8FBF7F" }} />
                <div>
                  <p className="font-semibold text-sm">חיוני (תמיד פעיל)</p>
                  <p className="consent-muted text-xs">
                    סשן התחברות, שמירת רכישה במהלך אימות דוא"ל. לא ניתן לבטל.
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <label className="flex items-start gap-3 cursor-pointer flex-1">
                  <input
                    type="checkbox"
                    checked={consent?.functional ?? true}
                    onChange={(e) => setConsent((prev) => prev ? { ...prev, functional: e.target.checked } : prev)}
                    className="consent-checkbox mt-1 w-4 h-4 flex-shrink-0"
                  />
                  <div>
                    <p className="font-semibold text-sm">פונקציונלי</p>
                    <p className="consent-muted text-xs">
                      העדפות נגישות, ערכת נושא, מטמון תוכן. משפר את חוויית השימוש.
                    </p>
                  </div>
                </label>
              </div>
              <div className="flex items-start gap-3">
                <label className="flex items-start gap-3 cursor-pointer flex-1">
                  <input
                    type="checkbox"
                    checked={consent?.analytics ?? false}
                    onChange={(e) => setConsent((prev) => prev ? { ...prev, analytics: e.target.checked } : prev)}
                    className="consent-checkbox mt-1 w-4 h-4 flex-shrink-0"
                  />
                  <div>
                    <p className="font-semibold text-sm">אנליטיקה (Google Analytics)</p>
                    <p className="consent-muted text-xs">
                      סטטיסטיקה אנונימית על ביקורים באתר. מופעל רק אם האתר מפעיל את השירות.
                    </p>
                  </div>
                </label>
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-stretch gap-2.5">
          {!detailed ? (
            <>
              <button
                onClick={handleAcceptAll}
                className="consent-primary min-h-[44px] px-5 py-2.5 rounded-full font-bold text-sm flex-1"
              >
                קבל הכל
              </button>
              <button
                onClick={handleEssentialOnly}
                className="consent-secondary min-h-[44px] px-5 py-2.5 rounded-full text-sm font-medium flex-1"
              >
                חיוני בלבד
              </button>
              <button
                onClick={() => setDetailed(true)}
                className="consent-muted min-h-[44px] w-full text-sm font-medium transition-opacity hover:opacity-70 px-2"
              >
                התאמה אישית
              </button>
            </>
          ) : (
            <>
              <button
                onClick={handleSavePreferences}
                className="consent-primary min-h-[44px] px-5 py-2.5 rounded-full font-bold text-sm flex-1"
              >
                שמור העדפות
              </button>
              <button
                onClick={() => setDetailed(false)}
                className="consent-secondary min-h-[44px] px-5 py-2.5 rounded-full text-sm font-medium flex-1"
              >
                חזרה
              </button>
            </>
          )}
        </div>

        <p className="consent-muted text-xs mt-4">
          למידע נוסף, ראה את{" "}
          <a
            href="/privacy-policy"
            className="consent-link underline transition-colors"
          >
            מדיניות הפרטיות
          </a>{" "}
          שלנו.
        </p>
      </div>
    </div>
  )
}
