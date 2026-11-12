/* ─────────────────────────────────────────────────────────────
 * Cookie & localStorage consent storage.
 *
 * One source of truth for the banner, the theme/accessibility gates and
 * any future consumer. Consent is strict opt-in: the optional category is
 * false until the visitor affirmatively turns it on.
 * ───────────────────────────────────────────────────────────── */

export const CONSENT_KEY = "casanova_cookie_consent_v1"

/** Bump only when older records can no longer be honoured safely. */
export const CONSENT_VERSION = 1

export const CONSENT_CHANGED_EVENT = "casanova:consent-changed"
export const CONSENT_OPEN_EVENT = "casanova:open-consent"

export interface ConsentState {
  version: number
  essential: true
  functional: boolean
  timestamp: string
}

export const DEFAULT_CONSENT: ConsentState = {
  version: CONSENT_VERSION,
  essential: true,
  functional: false,
  timestamp: "",
}

export function readConsent(): ConsentState | null {
  if (typeof window === "undefined") return null

  try {
    const raw = window.localStorage.getItem(CONSENT_KEY)
    if (!raw) return null

    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== "object") return null

    const value = parsed as Record<string, unknown>

    if (value.version !== CONSENT_VERSION) return null
    if (typeof value.functional !== "boolean") return null

    /* The retired analytics flag in older records is intentionally ignored. */
    return {
      version: CONSENT_VERSION,
      essential: true,
      functional: value.functional,
      timestamp: typeof value.timestamp === "string" ? value.timestamp : "",
    }
  } catch {
    return null
  }
}

export function writeConsent(state: ConsentState): void {
  if (typeof window === "undefined") return

  try {
    window.localStorage.setItem(CONSENT_KEY, JSON.stringify(state))
  } catch {
    /* Storage unavailable - listeners still receive the in-memory change. */
  }

  window.dispatchEvent(new Event(CONSENT_CHANGED_EVENT))
}

/** True only after the visitor explicitly opted in to functional storage. */
export function isFunctionalAllowed(): boolean {
  return readConsent()?.functional === true
}

/** Keys owned by the functional tier; never include auth or checkout keys. */
export const FUNCTIONAL_STORAGE_KEYS = [
  "casanova_theme",
  "casanova_accessibility_v2",
  "casanova.content.cache.v1",
] as const

/** Removes every stored functional preference. */
export function clearFunctionalStorage(): void {
  if (typeof window === "undefined") return

  try {
    for (const key of FUNCTIONAL_STORAGE_KEYS) {
      window.localStorage.removeItem(key)
    }
  } catch {
    /* Nothing to clear if storage is blocked. */
  }
}

/** Opens the banner in its detailed view, from anywhere in the app. */
export function openConsentPreferences(): void {
  if (typeof window === "undefined") return
  window.dispatchEvent(new Event(CONSENT_OPEN_EVENT))
}
