import { useEffect, useRef, useState } from "react"

const SCRIPT_ID = "cf-turnstile-script"
const SCRIPT_SRC =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&hl=he"

interface TurnstileRenderOptions {
  sitekey: string
  theme?: "light" | "dark" | "auto"
  size?: "normal" | "compact" | "flexible"
  language?: string
  callback: (token: string) => void
  "expired-callback"?: () => void
  "error-callback"?: () => void
}

interface TurnstileApi {
  render: (container: HTMLElement, options: TurnstileRenderOptions) => string
  reset: (widgetId?: string) => void
  remove: (widgetId?: string) => void
}

declare global {
  interface Window {
    turnstile?: TurnstileApi
  }
}

let loader: Promise<TurnstileApi> | null = null

function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile)
  if (loader) return loader

  loader = new Promise<TurnstileApi>((resolve, reject) => {
    const existing = document.getElementById(SCRIPT_ID) as
      | HTMLScriptElement
      | null

    const fail = () => {
      loader = null
      existing?.remove()
      reject(new Error("Turnstile script failed to load"))
    }

    const succeed = () => {
      if (window.turnstile) resolve(window.turnstile)
      else fail()
    }

    if (existing) {
      existing.addEventListener("load", succeed, { once: true })
      existing.addEventListener("error", fail, { once: true })
      return
    }

    const script = document.createElement("script")
    script.id = SCRIPT_ID
    script.src = SCRIPT_SRC
    script.async = true
    script.defer = true
    script.addEventListener("load", succeed, { once: true })
    script.addEventListener("error", fail, { once: true })
    document.head.appendChild(script)
  })

  return loader
}

export default function TurnstileWidget({
  siteKey,
  theme,
  onToken,
  onExpire,
  onError,
  resetSignal = 0,
}: {
  siteKey?: string
  theme: "light" | "dark"
  onToken: (token: string) => void
  onExpire: () => void
  onError: () => void
  resetSignal?: number
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const widgetIdRef = useRef<string | null>(null)
  const callbacksRef = useRef({ onToken, onExpire, onError })
  const [unavailable, setUnavailable] = useState(!siteKey)

  callbacksRef.current = { onToken, onExpire, onError }

  useEffect(() => {
    if (!siteKey) {
      setUnavailable(true)
      return
    }

    let cancelled = false
    setUnavailable(false)

    loadTurnstile()
      .then((api) => {
        if (cancelled || !containerRef.current) return

        widgetIdRef.current = api.render(containerRef.current, {
          sitekey: siteKey,
          theme,
          size: "flexible",
          language: "he",
          callback: (token) => callbacksRef.current.onToken(token),
          "expired-callback": () => callbacksRef.current.onExpire(),
          "error-callback": () => {
            setUnavailable(true)
            callbacksRef.current.onError()
          },
        })
      })
      .catch(() => {
        if (cancelled) return
        setUnavailable(true)
        callbacksRef.current.onError()
      })

    return () => {
      cancelled = true
      const widgetId = widgetIdRef.current
      if (widgetId && window.turnstile) {
        try {
          window.turnstile.remove(widgetId)
        } catch {
          /* the widget may already be gone after a navigation */
        }
      }
      widgetIdRef.current = null
    }
  }, [siteKey, theme])

  useEffect(() => {
    if (resetSignal <= 0) return
    const widgetId = widgetIdRef.current
    if (!widgetId || !window.turnstile) return

    try {
      window.turnstile.reset(widgetId)
    } catch {
      /* a removed widget needs no reset */
    }
  }, [resetSignal])

  if (!siteKey || unavailable) {
    return (
      <div className="auth-captcha" role="status">
        <p className="app-hint">
          אימות האבטחה אינו זמין כרגע. אנא נסה שוב בעוד רגע.
        </p>
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className="auth-captcha"
      role="group"
      aria-label="אימות אבטחה"
    />
  )
}
