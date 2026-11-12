/* ─────────────────────────────────────────────────────────────
 * Cookie & localStorage consent banner.
 *
 * Israeli Privacy Protection Law requires informing users about
 * data collection and obtaining consent for non-essential storage.
 * This banner covers both traditional cookies and localStorage usage.
 *
 * The banner distinguishes between:
 *  - Essential storage (session, checkout) - always active
 *  - Functional storage (accessibility prefs, theme) - opt-in only
 *
 * Consent state is stored in localStorage under a versioned key.
 * ───────────────────────────────────────────────────────────── */

import { useEffect, useState } from "react"
import Icon from "./icons"
import {
  CONSENT_KEY,
  CONSENT_OPEN_EVENT,
  CONSENT_VERSION,
  DEFAULT_CONSENT,
  clearFunctionalStorage,
  readConsent,
  writeConsent,
  type ConsentState,
} from "../lib/consent"

export default function CookieConsent() {
  /* Read synchronously so the banner is present on the first paint and the
   * customization view always starts from a real, editable record. This is
   * what keeps `consent` non-null for a first-time visitor, so the optional
   * checkbox is unchecked and fully interactive. */
  const [consent, setConsent] = useState<ConsentState>(
    () => readConsent() ?? DEFAULT_CONSENT,
  )
  const [show, setShow] = useState(() => readConsent() === null)
  const [detailed, setDetailed] = useState(false)

  useEffect(() => {
    const sync = () => setConsent(readConsent() ?? DEFAULT_CONSENT)

    const open = () => {
      sync()
      setDetailed(true)
      setShow(true)
    }

    const onStorage = (event: StorageEvent) => {
      if (event.key !== null && event.key !== CONSENT_KEY) return

      const next = readConsent()
      setConsent(next ?? DEFAULT_CONSENT)
      setShow(next === null)
    }

    window.addEventListener(CONSENT_OPEN_EVENT, open)
    window.addEventListener("storage", onStorage)

    return () => {
      window.removeEventListener(CONSENT_OPEN_EVENT, open)
      window.removeEventListener("storage", onStorage)
    }
  }, [])

  const saveConsent = (functional: boolean) => {
    /* Declining the functional tier must remove what it already stored. */
    if (!functional) clearFunctionalStorage()

    const state: ConsentState = {
      version: CONSENT_VERSION,
      essential: true,
      functional,
      timestamp: new Date().toISOString(),
    }

    writeConsent(state)
    setConsent(state)
    setShow(false)
    setDetailed(false)
  }

  const handleAcceptAll = () => saveConsent(true)
  const handleEssentialOnly = () => saveConsent(false)
  const handleSavePreferences = () => saveConsent(consent.functional)

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
            האתר משתמש באחסון מקומי חיוני לתפעולו (התחברות ורכישה)
            ובהעדפות אופציונליות (נגישות וערכת נושא). העדפות אופציונליות
            נשמרות רק לאחר אישורך.
          </p>
          {detailed && (
            <div className="consent-detail mt-3 space-y-3 p-3 rounded-lg">
              <div className="flex items-start gap-3">
                <span className="w-3 h-3 rounded-full mt-1 flex-shrink-0" style={{ background: "#8FBF7F" }} />
                <div>
                  <p className="font-semibold text-sm">חיוני (תמיד פעיל)</p>
                  <p className="consent-muted text-xs">
                    שמירת מצב ההתחברות והשלמת הרכישה, כולל אימות כתובת
                    הדוא״ל. לא ניתן לבטל.
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <label
                  htmlFor="consent-functional"
                  className="flex min-h-[44px] w-full cursor-pointer items-start gap-3 rounded-md py-1 flex-1"
                >
                  <input
                    id="consent-functional"
                    name="functional"
                    type="checkbox"
                    checked={consent.functional}
                    onChange={(event) => {
                      const checked = event.currentTarget.checked
                      setConsent((prev) => ({
                        ...prev,
                        functional: checked,
                      }))
                    }}
                    aria-describedby="consent-functional-desc"
                    className="consent-checkbox mt-1 w-4 h-4 flex-shrink-0"
                  />
                  <span>
                    <span className="block font-semibold text-sm">
                      פונקציונלי
                    </span>
                    <span
                      id="consent-functional-desc"
                      className="consent-muted block text-xs"
                    >
                      שמירת העדפות נגישות וערכת נושא לשיפור חוויית השימוש.
                    </span>
                  </span>
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
