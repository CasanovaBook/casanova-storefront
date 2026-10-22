/* ─────────────────────────────────────────────────────────────
 * Cookie & localStorage consent banner.
 *
 * Israeli Privacy Protection Law requires informing users about
 * data collection and obtaining consent for non-essential storage.
 * This banner covers both traditional cookies and localStorage usage.
 *
 * The banner distinguishes between:
 *  - Essential storage (session, checkout) — always active
 *  - Functional storage (accessibility prefs, theme) — user can opt out
 *  - Analytics (Google Analytics, if configured) — requires explicit consent
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
    /* Storage unavailable — consent stays in memory only */
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
      <div
        className="max-w-2xl mx-auto rounded-2xl border p-6 shadow-2xl"
        style={{
          background: "var(--color-card)",
          borderColor: "var(--color-border)",
        }}
      >
        <h2 id="cookie-consent-title" className="font-display text-lg font-bold mb-3 flex items-center gap-2">
          <Icon name="lock" size={18} style={{ color: "var(--color-primary)" }} />
          פרטיות ואחסון נתונים
        </h2>

        <div id="cookie-consent-desc" className="text-sm mb-4 space-y-2" style={{ color: "var(--color-foreground)" }}>
          <p>
            האתר משתמש ב-<strong>localStorage</strong> של הדפדפן לאחסון נתונים.
            חלק מהנתונים חיוניים לתפעול האתר (כגון התחברות ורכישה), ואחרים
            משמשים לשיפור החוויה (העדפות נגישות, ערכת נושא).
          </p>
          <p>
            האתר <strong>אינו משתמש ב-Cookies של צד שלישי</strong> למעט
            Google Analytics (אם הופעל). לא נאסף מידע אישי לצורכי פרסום או
            שיווק ללא הסכמתך.
          </p>
          {detailed && (
            <div className="mt-3 space-y-3 p-3 rounded-lg" style={{ background: "var(--color-secondary)" }}>
              <div className="flex items-start gap-3">
                <span className="w-3 h-3 rounded-full mt-1 flex-shrink-0" style={{ background: "var(--color-success)" }} />
                <div>
                  <p className="font-semibold text-sm">חיוני (תמיד פעיל)</p>
                  <p className="text-xs" style={{ color: "var(--color-muted-foreground)" }}>
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
                    className="mt-1 w-4 h-4 flex-shrink-0 accent-[#D4A030]"
                  />
                  <div>
                    <p className="font-semibold text-sm">פונקציונלי</p>
                    <p className="text-xs" style={{ color: "var(--color-muted-foreground)" }}>
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
                    className="mt-1 w-4 h-4 flex-shrink-0 accent-[#D4A030]"
                  />
                  <div>
                    <p className="font-semibold text-sm">אנליטיקה (Google Analytics)</p>
                    <p className="text-xs" style={{ color: "var(--color-muted-foreground)" }}>
                      סטטיסטיקה אנונימית על ביקורים באתר. מופעל רק אם האתר מפעיל את השירות.
                    </p>
                  </div>
                </label>
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          {!detailed ? (
            <>
              <button
                onClick={handleAcceptAll}
                className="btn-gradient px-6 py-2.5 rounded-full font-bold text-sm flex-1 sm:flex-none"
              >
                קבל הכל
              </button>
              <button
                onClick={handleEssentialOnly}
                className="px-6 py-2.5 rounded-full border text-sm font-medium transition-all"
                style={{ borderColor: "var(--color-border)", color: "var(--color-foreground)" }}
              >
                חיוני בלבד
              </button>
              <button
                onClick={() => setDetailed(true)}
                className="text-sm font-medium transition-opacity hover:opacity-70 px-2"
                style={{ color: "var(--color-muted-foreground)" }}
              >
                התאמה אישית
              </button>
            </>
          ) : (
            <>
              <button
                onClick={handleSavePreferences}
                className="btn-gradient px-6 py-2.5 rounded-full font-bold text-sm flex-1 sm:flex-none"
              >
                שמור העדפות
              </button>
              <button
                onClick={() => setDetailed(false)}
                className="px-6 py-2.5 rounded-full border text-sm font-medium transition-all"
                style={{ borderColor: "var(--color-border)", color: "var(--color-foreground)" }}
              >
                חזרה
              </button>
            </>
          )}
        </div>

        <p className="text-xs mt-4" style={{ color: "var(--color-muted-foreground)" }}>
          למידע נוסף, ראה את{" "}
          <a
            href="/privacy-policy"
            className="underline transition-opacity hover:opacity-70"
            style={{ color: "var(--color-primary)" }}
          >
            מדיניות הפרטיות
          </a>{" "}
          שלנו.
        </p>
      </div>
    </div>
  )
}
