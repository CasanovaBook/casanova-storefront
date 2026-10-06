/* ─────────────────────────────────────────────────────────────
 * Email verification confirmation.
 *
 * Where a user lands after clicking the link Supabase sends at
 * signup. Two things are true at once on this screen, and both are
 * handled here rather than in a route guard:
 *
 *   1. The Supabase client is still restoring the session the link
 *      just created (`authReady` is false). Until that settles nobody
 *      can honestly say whether verification worked, so the screen
 *      waits instead of guessing.
 *   2. A verification link can legitimately end in three states —
 *      confirmed, expired/used, or opened in a browser that does not
 *      hold the session. A bare redirect to /login cannot express the
 *      difference, which is why the user was left staring at a login
 *      form with no idea whether the click had registered. Each state
 *      gets its own message and its own next action.
 * ───────────────────────────────────────────────────────────── */

import { useEffect, useState } from "react"
import { Link, useNavigate } from "react-router"
import { useApp } from "../context/AppContext"
import { isSupabaseConfigured } from "../lib/supabase"
import Icon from "../components/icons"
import ThemeToggle from "../components/ThemeToggle"
import AccessibilityFooterLink from "../components/accessibility/AccessibilityFooterLink"
import logoImg from "../../images/main_photo.jpg"

type VerifyState = "checking" | "confirmed" | "expired" | "no-session"

export default function VerifyEmailPage() {
  const { isAuthenticated, authReady, user } = useApp()
  const navigate = useNavigate()
  const [state, setState] = useState<VerifyState>("checking")

  /* Supabase reports a spent or tampered link in the URL fragment as
   * `#error=...&error_code=otp_expired`. Read once, on mount, because
   * the client clears the hash as it consumes the token. */
  const [linkError, setLinkError] = useState("")
  useEffect(() => {
    const hash = window.location.hash
    if (!hash.includes("error")) return
    const code = new URLSearchParams(hash).get("error_code") ?? ""
    setLinkError(
      code === "otp_expired"
        ? "הקישור כבר נוצל או שתחלף. ניתן לבקש קישור חדש."
        : "לא ניתן היה לאמת את הקישור. ניתן לבקש קישור חדש.",
    )
  }, [])

  useEffect(() => {
    /* Without a backend there is no email to confirm; say so plainly
     * rather than showing a success that never happened. */
    if (!isSupabaseConfigured) {
      setState("no-session")
      return
    }
    if (!authReady) return
    if (linkError) {
      setState("expired")
      return
    }
    if (isAuthenticated) {
      setState("confirmed")
      return
    }
    /* The address was confirmed, but the link was opened somewhere that
     * does not hold the session — a different browser, a private window,
     * or an expired sign-in. The account is still usable; the user simply
     * has to prove it by signing in. */
    setState("no-session")
  }, [authReady, isAuthenticated, linkError])

  /* Once confirmed, move the user on by themselves rather than yanking
   * the screen out from under them mid-sentence. */
  useEffect(() => {
    if (state !== "confirmed") return
    const timer = setTimeout(() => {
      navigate(user?.role === "ADMIN" ? "/admin" : "/dashboard/library", {
        replace: true,
      })
    }, 2500)
    return () => clearTimeout(timer)
  }, [state, navigate, user?.role])

  const isAdmin = user?.role === "ADMIN"
  const busy = state === "checking"
  const copy = {
    checking: {
      title: "מאמתים את הכתובת…",
      body: "רגע אחד, אנחנו בודקים שהקישור שפתחת תקף ושהחשבון אומת בהצלחה.",
      icon: "mail",
      color: "var(--color-primary)",
      bg: "rgba(212,160,48,0.1)",
      border: "1px solid rgba(212,160,48,0.3)",
    },
    confirmed: {
      title: "הכתובת אומתה בהצלחה",
      body: "החשבון שלך מאומת ואתה מחובר. מעבירים אותך לספרייה שלך…",
      icon: "checkCircle",
      color: "var(--color-success)",
      bg: "rgba(34,197,94,0.12)",
      border: "1px solid rgba(34,197,94,0.3)",
    },
    expired: {
      title: "הקישור אינו תקף",
      body: linkError,
      icon: "alertTriangle",
      color: "#F59E0B",
      bg: "rgba(245,158,11,0.1)",
      border: "1px solid rgba(245,158,11,0.3)",
    },
    "no-session": {
      title: "הכתובת אומתה — נשאר רק להתחבר",
      body: isSupabaseConfigured
        ? "האימות הושלם, אבל הדפדפן הזה אינו מחובר. התחבר עם הכתובת והסיסמה שבחרת, והכול מוכן."
        : 'אין כרגע שרת Supabase מחובר, ולכן אימות בדוא"ל אינו זמין.',
      icon: "lock",
      color: "var(--color-primary)",
      bg: "rgba(212,160,48,0.1)",
      border: "1px solid rgba(212,160,48,0.3)",
    },
  }[state] as {
    title: string
    body: string
    icon: "mail" | "checkCircle" | "alertTriangle" | "lock"
    color: string
    bg: string
    border: string
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center px-6 relative overflow-hidden"
      style={{ background: "var(--color-background)" }}
    >
      <div
        className="absolute w-[500px] h-[500px] rounded-full pointer-events-none"
        style={{
          background:
            "radial-gradient(circle, rgba(212,160,48,0.08) 0%, transparent 70%)",
          top: "-140px",
          right: "-120px",
        }}
      />
      <div className="absolute top-5 left-5 z-10">
        <ThemeToggle />
      </div>

      <main id="main" className="w-full max-w-sm page-enter relative">
        <div className="text-center mb-8">
          <Link to="/" className="inline-flex items-center gap-2 mb-6">
            <img
              src={logoImg}
              alt=""
              className="w-9 h-9 rounded-lg object-cover"
            />
            <span
              dir="ltr"
              className="font-display text-xl font-semibold tracking-wide"
              style={{ color: "var(--color-primary)" }}
            >
              Casanova
            </span>
          </Link>

          <div
            className={`w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-4 ${
              state === "checking" ? "" : "glow-pulse"
            }`}
            style={{ background: copy.bg, color: copy.color, border: copy.border }}
            role="status"
            aria-live="polite"
          >
            <Icon name={copy.icon} size={32} />
          </div>

          <h1 className="font-display text-3xl font-semibold mb-2">
            {copy.title}
          </h1>
          <p className="text-sm" style={{ color: "var(--color-muted-foreground)" }}>
            {copy.body}
          </p>
        </div>

        {busy ? (
          <p
            className="text-center text-xs"
            style={{ color: "var(--color-muted-foreground)" }}
          >
            נא להמתין…
          </p>
        ) : state === "confirmed" ? (
          <Link
            to={isAdmin ? "/admin" : "/dashboard/library"}
            className="btn-gradient block w-full py-3 rounded-full font-semibold text-sm text-center"
          >
            {isAdmin ? "לממשק הניהול" : "לספרייה שלי"}
          </Link>
        ) : state === "expired" ? (
          <div className="space-y-3">
            <Link
              to="/login"
              className="btn-gradient block w-full py-3 rounded-full font-semibold text-sm text-center"
            >
              חזרה להתחברות
            </Link>
            <p
              className="text-center text-xs"
              style={{ color: "var(--color-muted-foreground)" }}
            >
              ניתן לשלוח קישור חדש מהמסך שבו נרשמת, באמצעות לחצן
              "שליחת קישור שוב".
            </p>
          </div>
        ) : (
          <Link
            to="/login"
            className="btn-gradient block w-full py-3 rounded-full font-semibold text-sm text-center"
          >
            התחבר עכשיו
          </Link>
        )}

        {/* No site footer on this screen; the accessibility controls still
         * have to be reachable from here. */}
        <div className="text-center mt-6 text-xs">
          <AccessibilityFooterLink />
        </div>
      </main>
    </div>
  )
}
