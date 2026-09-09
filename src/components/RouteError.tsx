import { Link, isRouteErrorResponse, useRouteError } from "react-router"

import Icon from "./icons"

/**
 * What a failed route looks like.
 *
 * Shared by the error boundary and the catch-all, because "this address does
 * not exist" and "this screen threw" are the same screen with different words:
 * both need a way out, and neither needs a stack trace.
 */

function RouteErrorView({ missing }: { missing: boolean }) {
  return (
    <div className="min-h-[70vh] flex flex-col items-center justify-center px-6 py-16 text-center gap-4">
      <span
        className="w-16 h-16 rounded-full flex items-center justify-center shrink-0"
        style={{
          background: missing
            ? "rgba(212,175,55,0.14)"
            : "rgba(239,68,68,0.15)",

          color: missing ? "var(--color-primary)" : "#F87171",
        }}
      >
        <Icon name={missing ? "search" : "shield"} size={28} />
      </span>

      <h1
        className="font-display text-3xl md:text-4xl font-bold"
        style={{ color: "var(--color-foreground)" }}
      >
        {missing ? "הדף לא נמצא" : "המסך לא הצליח להיטען"}
      </h1>

      <p
        className="text-sm md:text-base max-w-md"
        style={{ color: "var(--color-muted-foreground)" }}
      >
        {missing
          ? "הכתובת שביקשתם אינה קיימת, או שהקישור השתנה מאז ששותף."
          : "קרתה תקלה בלתי צפויה במסך הזה. רענון אחד פותר את זה כמעט תמיד — ואם לא, נשמח לשמוע מכם ונתקן."}
      </p>

      <div className="flex flex-wrap items-center justify-center gap-3 mt-2">
        {missing ? (
          <Link
            to="/store"
            className="btn-gradient tap-target px-6 py-3 rounded-full text-sm font-semibold"
          >
            לחנות
          </Link>
        ) : (
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="btn-gradient tap-target px-6 py-3 rounded-full text-sm font-semibold inline-flex items-center gap-2"
          >
            <Icon name="refresh" size={16} />
            טעינה מחדש
          </button>
        )}
        <Link
          to="/"
          className="tap-target px-6 py-3 rounded-full text-sm font-semibold inline-flex items-center gap-2"
          style={{
            border: "1px solid var(--color-border)",
            color: "var(--color-foreground)",
          }}
        >
          <Icon name="home" size={16} />
          לדף הבית
        </Link>
      </div>

      {/* Deliberately no error text, no component stack and no source frames.
          React Router already logs the real error to the console, which is
          where a developer can read it; repeating it into the DOM would hand
          internals to anyone who manages to trigger a bug. */}
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

  const missing = isRouteErrorResponse(error) && error.status === 404

  return <RouteErrorView missing={missing} />
}

/** Catch-all for addresses the route table does not define. */

export function NotFoundPage() {
  return <RouteErrorView missing />
}
