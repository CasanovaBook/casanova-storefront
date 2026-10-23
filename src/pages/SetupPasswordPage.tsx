/* ─────────────────────────────────────────────────────────────
 * One-time password setup / Password Reset.
 *
 * Reached either from:
 *   1. Supabase Auth recovery link:
 *      The user clicks the reset link in the email, Supabase sets
 *      an active recovery session (via URL hash fragments or token exchange)
 *      and triggers PASSWORD_RECOVERY or an active session.
 *   2. CMS / local link (`?token=…&email=…`):
 *      The token is validated against its stored hash and burned on use.
 * ───────────────────────────────────────────────────────────── */

import { useEffect, useState } from "react"
import { Link, useNavigate, useSearchParams } from "react-router"
import { resetPasswordWithToken } from "../lib/api"
import {
  supabase,
  isSupabaseConfigured,
} from "../integrations/supabase/supabase"
import { updatePassword as updateSupabasePassword } from "../integrations/supabase/supabase-auth"
import { passwordProblem } from "../lib/auth"
import Icon from "../components/icons"
import Alert from "../components/ui/Alert"
import Spinner from "../components/ui/Spinner"
import AuthShell from "../components/layout/AuthShell"

type PasswordStrength = {
  label: string
  color: string
  width: string
}

export default function SetupPasswordPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const token = params.get("token") ?? ""
  const queryEmail = params.get("email") ?? ""

  // When Supabase handles the recovery session
  const [hasValidSession, setHasValidSession] = useState<boolean>(() => {
    if (!isSupabaseConfigured) return false
    if (typeof window !== "undefined") {
      const hash = window.location.hash
      if (
        hash &&
        (hash.includes("access_token=") || hash.includes("type=recovery"))
      ) {
        return true
      }
    }
    return false
  })
  const [checkingSession, setCheckingSession] = useState<boolean>(
    isSupabaseConfigured && !token,
  )
  const [userEmail, setUserEmail] = useState<string>(queryEmail)

  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [error, setError] = useState("")
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)

  // Listen to Supabase Auth state and check active recovery session
  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) {
      setCheckingSession(false)
      return
    }

    let isMounted = true

    // Check if there is already an active session from token verification
    supabase.auth
      .getSession()
      .then(({ data: { session }, error: sessionError }) => {
        if (!isMounted) return
        if (session?.user && !sessionError) {
          setHasValidSession(true)
          if (session.user.email) {
            setUserEmail(session.user.email)
          }
        }
        setCheckingSession(false)
      })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (!isMounted) return
      if (
        event === "PASSWORD_RECOVERY" ||
        (session?.user && event === "SIGNED_IN")
      ) {
        setHasValidSession(true)
        if (session?.user?.email) {
          setUserEmail(session.user.email)
        }
      }
    })

    return () => {
      isMounted = false
      subscription.unsubscribe()
    }
  }, [])

  const strength = (): PasswordStrength => {
    const len = password.length
    const hasUpper = /[A-Z]/.test(password)
    const hasNum = /\d/.test(password)
    const hasSpecial = /[^a-zA-Z0-9]/.test(password)
    const score = [len >= 8, hasUpper, hasNum, hasSpecial].filter(
      Boolean,
    ).length
    if (score <= 1)
      return { label: "חלשה", color: "var(--color-danger)", width: "25%" }
    if (score === 2) return { label: "סבירה", color: "#C98A4A", width: "50%" }
    if (score === 3) return { label: "טובה", color: "#3B82F6", width: "75%" }
    return { label: "חזקה", color: "var(--color-success)", width: "100%" }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    const problem = passwordProblem(password)
    if (problem) {
      setError(problem)
      return
    }
    if (password !== confirm) {
      setError("הסיסמאות אינן תואמות.")
      return
    }
    setBusy(true)

    if (isSupabaseConfigured) {
      const result = await updateSupabasePassword(password)
      setBusy(false)
      if (!result.ok) {
        setError(result.error)
        return
      }
      setDone(true)
      setTimeout(() => navigate("/login"), 2000)
      return
    }

    const result = await resetPasswordWithToken(token, password)
    setBusy(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setDone(true)
    setTimeout(() => navigate("/login"), 2000)
  }

  const pw = strength()

  if (done) {
    return (
      <AuthShell
        eyebrow="איפוס סיסמה"
        title="הסיסמה עודכנה בהצלחה!"
        description="מעביר אותך למסך ההתחברות..."
        footer={
          <p className="m-0 text-center">
            <Link to="/login">חזרה להתחברות</Link>
          </p>
        }
      >
        <Spinner label="נא להמתין…" />
      </AuthShell>
    )
  }

  // Loading indicator while verifying Supabase recovery session
  if (checkingSession) {
    return (
      <AuthShell eyebrow="איפוס סיסמה" title="מאמת קישור איפוס...">
        <Spinner label="נא להמתין…" />
      </AuthShell>
    )
  }

  /* No valid token and no active Supabase recovery session */
  const isAuthorized = isSupabaseConfigured ? hasValidSession : Boolean(token)

  if (!isAuthorized) {
    return (
      <AuthShell
        eyebrow="איפוס סיסמה"
        title="הקישור אינו תקין או שפג תוקפו"
        description="קישור איפוס הסיסמה אינו תקף או שכבר נעשה בו שימוש. קישורי איפוס תקפים לזמן מוגבל בלבד."
      >
        <div className="flex flex-col gap-2.5 sm:flex-row">
          <Link to="/forgot-password" className="app-btn flex-1">
            בקש קישור חדש
          </Link>
          <Link to="/login" className="app-btn-secondary flex-1">
            התחברות
          </Link>
        </div>
      </AuthShell>
    )
  }

  return (
    <AuthShell
      eyebrow="איפוס סיסמה"
      title="הגדר סיסמה חדשה"
      description={
        <>
          {userEmail ? (
            <>
              מאפס סיסמה עבור{" "}
              <strong dir="ltr" className="break-all">
                {userEmail}
              </strong>
              .{" "}
            </>
          ) : null}
          בחר סיסמה חדשה וחזקה כדי להגן על החשבון שלך.
        </>
      }
      footer={
        <p className="m-0 text-center">
          <Link to="/login">חזרה להתחברות</Link>
        </p>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="app-field">
          <label htmlFor="setup-password-new" className="app-label">
            סיסמה חדשה
          </label>
          <div dir="ltr" className="relative">
            <input
              id="setup-password-new"
              type={showPassword ? "text" : "password"}
              className="w-full py-3 ps-4 pe-12 text-left"
              dir="ltr"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="new-password"
              required
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="app-icon-btn absolute end-1 top-1/2 -translate-y-1/2"
              style={{
                color: showPassword
                  ? "var(--color-primary)"
                  : "var(--color-muted-foreground)",
              }}
              aria-pressed={showPassword}
              aria-label={showPassword ? "הסתרת הסיסמה" : "הצגת הסיסמה"}
              title={showPassword ? "הסתר סיסמה" : "הצג סיסמה"}
            >
              <Icon name="eye" size={16} />
            </button>
          </div>
          {password && (
            <div className="mt-1">
              <div className="mb-1 flex justify-between text-xs">
                <span style={{ color: "var(--color-muted-foreground)" }}>
                  עוצמה
                </span>
                <span style={{ color: pw.color }}>{pw.label}</span>
              </div>
              <div
                className="h-1 overflow-hidden rounded-full"
                style={{ background: "var(--color-muted)" }}
              >
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: pw.width, background: pw.color }}
                />
              </div>
            </div>
          )}
        </div>

        <div className="app-field">
          <label htmlFor="setup-password-confirm" className="app-label">
            אימות סיסמה
          </label>
          <div dir="ltr" className="relative">
            <input
              id="setup-password-confirm"
              type={showConfirmPassword ? "text" : "password"}
              className="w-full py-3 ps-4 pe-12 text-left"
              dir="ltr"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="••••••••"
              autoComplete="new-password"
              required
            />
            <button
              type="button"
              onClick={() => setShowConfirmPassword(!showConfirmPassword)}
              className="app-icon-btn absolute end-1 top-1/2 -translate-y-1/2"
              style={{
                color: showConfirmPassword
                  ? "var(--color-primary)"
                  : "var(--color-muted-foreground)",
              }}
              aria-pressed={showConfirmPassword}
              aria-label={showConfirmPassword ? "הסתרת הסיסמה" : "הצגת הסיסמה"}
              title={showConfirmPassword ? "הסתר סיסמה" : "הצג סיסמה"}
            >
              <Icon name="eye" size={16} />
            </button>
          </div>
        </div>

        {error && <Alert tone="error">{error}</Alert>}

        <button
          type="submit"
          disabled={busy}
          aria-busy={busy || undefined}
          className="app-btn w-full cursor-pointer"
        >
          {busy ? (
            <>
              <span
                className="app-spinner"
                aria-hidden="true"
                style={{
                  width: "1rem",
                  height: "1rem",
                  borderColor:
                    "color-mix(in srgb, var(--color-primary-foreground) 35%, transparent)",
                  borderTopColor: "var(--color-primary-foreground)",
                }}
              />
              מעדכן סיסמה…
            </>
          ) : (
            "עדכון סיסמה"
          )}
        </button>
      </form>
    </AuthShell>
  )
}
