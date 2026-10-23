import { useEffect, useRef } from "react"
import { Link, isRouteErrorResponse, useRouteError } from "react-router"

import Icon from "./icons"
import usePageTitle from "../lib/usePageTitle"

/**
 * What a failed route looks like.
 *
 * Shared by the error boundary and the catch-all, because "this address does
 * not exist" and "this screen threw" are the same screen with different words:
 * both need a way out, and neither needs a stack trace.
 *
 * `RouteError` is rendered by the router outside PublicRoot, so its standalone
 * variant supplies the document chrome (skip link, `main#main`, brand header
 * and footer). `NotFoundPage` is a child of PublicRoot and must not duplicate
 * those landmarks.
 */

function RouteErrorView({
  missing,
  status,
  standalone = false,
}: {
  missing: boolean
  status?: number | null
  standalone?: boolean
}) {
  usePageTitle(missing ? "הדף לא נמצא" : "המסך לא הצליח להיטען")

  const headingRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    headingRef.current?.focus()
  }, [])

  const eyebrow = missing
    ? "שגיאה 404"
    : status
      ? `שגיאה ${status}`
      : "תקלה זמנית"

  const card = (
    <div className="mx-auto w-full max-w-xl">
      <div className="app-surface overflow-hidden">
        <div style={{ height: 3, background: "var(--color-primary)" }} />

        <div className="flex flex-col items-center gap-3 px-6 py-8 text-center sm:px-10 sm:py-11">
          <span
            className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full"
            style={{
              background: missing
                ? "color-mix(in srgb, var(--color-primary) 12%, transparent)"
                : "color-mix(in srgb, var(--color-danger) 12%, transparent)",
              border: missing
                ? "1px solid color-mix(in srgb, var(--color-primary) 28%, transparent)"
                : "1px solid color-mix(in srgb, var(--color-danger) 28%, transparent)",
              color: missing ? "var(--color-primary)" : "var(--color-danger)",
            }}
          >
            <Icon name={missing ? "search" : "alertTriangle"} size={26} />
          </span>

          <p className="app-eyebrow" style={{ margin: 0 }}>
            {eyebrow}
          </p>

          <h1
            id="route-error-title"
            ref={headingRef}
            tabIndex={-1}
            className="app-title break-words"
          >
            {missing ? "הדף לא נמצא" : "המסך לא הצליח להיטען"}
          </h1>

          <p className="app-subtitle" style={{ marginTop: 0 }}>
            {missing
              ? "הכתובת שביקשתם אינה קיימת, או שהקישור השתנה מאז ששותף."
              : "קרתה תקלה בלתי צפויה במסך הזה. רענון אחד פותר את זה כמעט תמיד — ואם לא, נשמח לשמוע מכם ונתקן."}
          </p>

          <div className="mt-3 flex w-full flex-wrap items-center justify-center gap-2.5">
            {missing ? (
              <Link to="/" className="app-btn">
                <Icon name="home" size={16} />
                לדף הבית
              </Link>
            ) : (
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="app-btn"
              >
                <Icon name="refresh" size={16} />
                טעינה מחדש
              </button>
            )}

            {missing ? (
              <Link to="/store" className="app-btn app-btn-secondary">
                לחנות
              </Link>
            ) : (
              <Link to="/" className="app-btn app-btn-secondary">
                <Icon name="home" size={16} />
                לדף הבית
              </Link>
            )}

            <Link to="/support" className="app-btn app-btn-ghost">
              <Icon name="message" size={16} />
              פנייה לתמיכה
            </Link>
          </div>
        </div>
      </div>
    </div>
  )

  if (!standalone) {
    return (
      <div className="app-page app-page--narrow px-4 py-6 sm:px-6 sm:py-12">
        {card}
      </div>
    )
  }

  return (
    <div
      className="flex min-h-screen flex-col"
      style={{
        background: "var(--color-background)",
        color: "var(--color-foreground)",
      }}
    >
      <a href="#main" className="skip-link">
        דלג לתוכן הראשי
      </a>

      <header
        className="border-b"
        style={{ borderColor: "var(--color-border)" }}
      >
        <div className="site-container flex flex-wrap items-center justify-between gap-3 py-4">
          <Link
            to="/"
            className="inline-flex items-center gap-2.5 no-underline"
            style={{ color: "var(--color-foreground)" }}
            aria-label="Casanova — דף הבית"
          >
            <span
              className="flex h-9 w-9 items-center justify-center rounded-full"
              style={{
                background:
                  "color-mix(in srgb, var(--color-primary) 12%, transparent)",
                border:
                  "1px solid color-mix(in srgb, var(--color-primary) 28%, transparent)",
                color: "var(--color-primary)",
              }}
            >
              <Icon name="bookOpen" size={17} />
            </span>
            <span
              className="font-brand text-lg tracking-[0.16em]"
              dir="ltr"
              lang="en"
            >
              CASANOVA
            </span>
          </Link>

          <Link to="/store" className="app-btn app-btn-secondary">
            לחנות
          </Link>
        </div>
      </header>

      <main
        id="main"
        tabIndex={-1}
        aria-labelledby="route-error-title"
        className="flex flex-1 items-center justify-center px-4 py-10 sm:px-6 sm:py-16"
      >
        {card}
      </main>

      <footer
        className="border-t"
        style={{ borderColor: "var(--color-border)" }}
      >
        <div className="site-container app-muted py-5 text-center text-xs">
          © {new Date().getFullYear()} Casanova. כל הזכויות שמורות.
        </div>
      </footer>
    </div>
  )
}

/**
 * Route-level error boundary.
 *
 * Without an `errorElement`, React Router renders its own developer screen:
 * an English "Unexpected Application Error!" page carrying the component
 * stack. Showing that to a paying reader is wrong twice over — it is
 * untranslated, and it prints application internals into the page.
 */

export default function RouteError() {
  const error = useRouteError()
  const status = isRouteErrorResponse(error) ? error.status : null

  return <RouteErrorView missing={status === 404} status={status} standalone />
}

/** Catch-all for addresses the route table does not define. */

export function NotFoundPage() {
  return <RouteErrorView missing status={404} />
}
