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
 *   2. A verification link can legitimately end in three states -
 *      confirmed, expired/used, or opened in a browser that does not
 *      hold the session. A bare redirect to /login cannot express the
 *      difference, which is why the user was left staring at a login
 *      form with no idea whether the click had registered. Each state
 *      gets its own message and its own next action.
 * ───────────────────────────────────────────────────────────── */

import { useEffect, useState } from "react"
import { Link, useNavigate } from "react-router"
import { useApp } from "../context/AppContext"
import { isSupabaseConfigured } from "../integrations/supabase/supabase"
import { peekReturnPath, takeReturnPath } from "../lib/checkout-intent"
import Alert from "../components/ui/Alert"
import Spinner from "../components/ui/Spinner"
import AuthShell from "../components/layout/AuthShell"

type VerifyState = "checking" | "confirmed" | "expired" | "no-session"

export default function VerifyEmailPage() {
  const { isAuthenticated, authReady, user } = useApp()
  const navigate = useNavigate()
  const [state, setState] = useState<VerifyState>("checking")

  /* The destination the customer was heading for before leaving to click
   * this link. Reading it is what lets the screen promise the right place;
   * it is consumed only on the way out, so a link opened in the wrong
   * browser still has it waiting for the sign-in. */
  const [returnPath] = useState(() => peekReturnPath())

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
     * does not hold the session - a different browser, a private window,
     * or an expired sign-in. The account is still usable; the user simply
     * has to prove it by signing in. */
    setState("no-session")
  }, [authReady, isAuthenticated, linkError])

  /* Once confirmed, move the user on by themselves rather than yanking
   * the screen out from under them mid-sentence. */
  useEffect(() => {
    if (state !== "confirmed") return
    const timer = setTimeout(() => {
      navigate(
        takeReturnPath() ??
          (user?.role === "ADMIN" ? "/admin" : "/dashboard/library"),
        { replace: true },
      )
    }, 2500)
    return () => clearTimeout(timer)
  }, [state, navigate, user?.role])

  const isAdmin = user?.role === "ADMIN"
  const destination = returnPath ?? (isAdmin ? "/admin" : "/dashboard/library")
  const busy = state === "checking"
  const copy = {
    checking: {
      title: "מאמתים את הכתובת…",
      body: "רגע אחד, אנחנו בודקים שהקישור שפתחת תקף ושהחשבון אומת בהצלחה.",
    },
    confirmed: {
      title: "הכתובת אומתה בהצלחה",
      body: returnPath
        ? "החשבון שלך מאומת ואתה מחובר. מעבירים אותך חזרה להמשך."
        : "החשבון שלך מאומת ואתה מחובר. מעבירים אותך לספרייה שלך…",
    },
    expired: {
      title: "הקישור אינו תקף",
      body: linkError,
    },
    "no-session": {
      /* This state is reached both when a link was opened in a browser that
       * holds no session AND when someone lands here without a link at all -
       * a bookmark, a crawler, a typed URL. Asserting "the address was
       * verified" would be a claim this page cannot support in the second
       * case, and a false claim on a screen that talks about the security of
       * an account is worse than plain wording. So it says what is true either
       * way and what to do about it. */
      title: "נשאר רק להתחבר",
      body: isSupabaseConfigured
        ? "אם פתחת את קישור האימות מהמייל, הכתובת כבר אומתה - בדפדפן הזה צריך להתחבר איתה בשנית. אם עדיין לא אישרת, פתח את הקישור שהגיע אליך."
        : 'אין כרגע שרת Supabase מחובר, ולכן אימות בדוא"ל אינו זמין.',
    },
  }[state]

  return (
    <AuthShell
      eyebrow="אימות כתובת"
      title={copy.title}
      description={state === "expired" ? undefined : copy.body}
    >
      {busy ? (
        <Spinner label="נא להמתין…" />
      ) : state === "confirmed" ? (
        <div className="space-y-4">
          <Link to={destination} className="app-btn w-full">
            {returnPath === "/checkout"
              ? "להשלמת הרכישה"
              : isAdmin
                ? "לממשק הניהול"
                : "לספרייה שלי"}
          </Link>
        </div>
      ) : state === "expired" ? (
        <div className="space-y-4">
          <Alert tone="warning">{copy.body}</Alert>
          <Link
            to={
              returnPath
                ? `/login?redirect=${encodeURIComponent(returnPath)}`
                : "/login"
            }
            className="app-btn w-full"
          >
            חזרה להתחברות
          </Link>
          <p className="app-hint text-center">
            ניתן לשלוח קישור חדש מהמסך שבו נרשמת, באמצעות לחצן "שליחת קישור
            שוב".
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <Link
            to={
              returnPath
                ? `/login?redirect=${encodeURIComponent(returnPath)}`
                : "/login"
            }
            className="app-btn w-full"
          >
            התחבר עכשיו
          </Link>
        </div>
      )}
    </AuthShell>
  )
}
