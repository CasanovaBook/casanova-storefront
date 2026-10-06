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
import { supabase, isSupabaseConfigured } from "../lib/supabase"
import { updatePassword as updateSupabasePassword } from "../lib/supabase-auth"
import { passwordProblem } from "../lib/auth"
import Icon from "../components/icons"
import ThemeToggle from "../components/ThemeToggle"
import logoImg from "../../images/main_photo.jpg"

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
      if (hash && (hash.includes("access_token=") || hash.includes("type=recovery"))) {
        return true
      }
    }
    return false
  })
  const [checkingSession, setCheckingSession] = useState<boolean>(isSupabaseConfigured && !token)
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
    supabase.auth.getSession().then(({ data: { session }, error: sessionError }) => {
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
      if (event === "PASSWORD_RECOVERY" || (session?.user && event === "SIGNED_IN")) {
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

  const strength = (): { label: string, color: string, width: string } => {
    const len = password.length
    const hasUpper = /[A-Z]/.test(password)
    const hasNum = /\d/.test(password)
    const hasSpecial = /[^a-zA-Z0-9]/.test(password)
    const score = [len >= 8, hasUpper, hasNum, hasSpecial].filter(
      Boolean,
    ).length
    if (score <= 1)
      return { label: "חלשה", color: "var(--color-danger)", width: "25%" }
    if (score === 2) return { label: "סבירה", color: "#F59E0B", width: "50%" }
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
  const inputStyle = {
    background: "var(--color-secondary)",
    borderColor: "var(--color-border)",
    color: "var(--color-foreground)",
  }

  if (done) {
    return (
      <div
        className="min-h-screen flex items-center justify-center px-6"
        style={{ background: "var(--color-background)" }}
      >
        <div className="text-center page-enter">
          <div
            className="w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-4 glow-pulse"
            style={{
              background: "rgba(34,197,94,0.12)",
              color: "var(--color-success)",
              border: "1px solid rgba(34,197,94,0.35)",
              boxShadow: "0 0 40px rgba(34,197,94,0.25)",
            }}
          >
            <Icon name="checkCircle" size={36} />
          </div>
          <h2 className="font-display text-2xl font-semibold mb-2">
            הסיסמה עודכנה בהצלחה!
          </h2>
          <p style={{ color: "var(--color-muted-foreground)" }}>
            מעביר אותך למסך ההתחברות...
          </p>
        </div>
      </div>
    )
  }

  // Loading indicator while verifying Supabase recovery session
  if (checkingSession) {
    return (
      <div
        className="min-h-screen flex flex-col items-center justify-center px-6 gap-3"
        style={{ background: "var(--color-background)", color: "var(--color-muted-foreground)" }}
      >
        <span
          className="w-8 h-8 rounded-full border-2 animate-spin"
          style={{
            borderColor: "var(--color-border)",
            borderTopColor: "var(--color-primary)",
          }}
        />
        <span className="text-sm">מאמת קישור איפוס...</span>
      </div>
    )
  }

  /* No valid token and no active Supabase recovery session */
  const isAuthorized = isSupabaseConfigured ? hasValidSession : Boolean(token)

  if (!isAuthorized) {
    return (
      <div
        className="min-h-screen flex items-center justify-center px-6"
        style={{ background: "var(--color-background)" }}
      >
        <div className="w-full max-w-sm text-center page-enter">
          <div
            className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4"
            style={{
              background: "rgba(239,68,68,0.12)",
              border: "1px solid rgba(239,68,68,0.3)",
              color: "var(--color-danger)",
            }}
          >
            <Icon name="lock" size={28} />
          </div>
          <h1 className="font-display text-2xl font-semibold mb-2">
            הקישור אינו תקין או שפג תוקפו
          </h1>
          <p
            className="text-sm mb-6"
            style={{ color: "var(--color-muted-foreground)" }}
          >
            קישור איפוס הסיסמה אינו תקף או שכבר נעשה בו שימוש. קישורי איפוס תקפים לזמן מוגבל בלבד.
          </p>
          <div className="flex gap-3 justify-center">
            <Link
              to="/forgot-password"
              className="btn-gradient px-5 py-2.5 rounded-full font-semibold text-sm"
            >
              בקש קישור חדש
            </Link>
            <Link
              to="/login"
              className="px-5 py-2.5 rounded-full border text-sm"
              style={{
                borderColor: "var(--color-border)",
                color: "var(--color-foreground)",
              }}
            >
              התחברות
            </Link>
          </div>
        </div>
      </div>
    )
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
          left: "50%",
          transform: "translateX(-50%)",
        }}
      />
      <div className="absolute top-5 left-5 z-10">
        <ThemeToggle />
      </div>

      <div className="w-full max-w-sm page-enter relative">
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
            className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4"
            style={{
              background: "rgba(227,174,60,0.12)",
              border: "1px solid rgba(227,174,60,0.3)",
              color: "var(--color-primary)",
            }}
          >
            <Icon name="lock" size={28} />
          </div>
          <h1 className="font-display text-3xl font-semibold mb-2">
            הגדר סיסמה חדשה
          </h1>
          <p
            className="text-sm"
            style={{ color: "var(--color-muted-foreground)" }}
          >
            {userEmail ? (
              <>
                מאפס סיסמה עבור <strong dir="ltr">{userEmail}</strong>.{" "}
              </>
            ) : null}
            בחר סיסמה חדשה וחזקה כדי להגן על החשבון שלך.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="setup-password-new"
              className="block text-xs font-medium mb-1.5"
              style={{ color: "var(--color-muted-foreground)" }}
            >
              סיסמה חדשה
            </label>
            <div className="relative">
              <input
                id="setup-password-new"
                type={showPassword ? "text" : "password"}
                className="w-full px-4 py-3 pl-10 rounded-lg border text-sm outline-none"
                dir="ltr"
                style={inputStyle}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="new-password"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="tap-target absolute left-3 top-1/2 transform -translate-y-1/2 transition-colors p-1 hover:opacity-100"
                style={{
                  color: showPassword
                    ? "#FFFFFF"
                    : "var(--color-muted-foreground)",
                  opacity: showPassword ? 1 : 0.5,
                }}
                aria-pressed={showPassword}
                aria-label={showPassword ? "הסתרת הסיסמה" : "הצגת הסיסמה"}
                title={showPassword ? "הסתר סיסמה" : "הצג סיסמה"}
              >
                <Icon name="eye" size={16} />
              </button>
            </div>
            {password && (
              <div className="mt-2">
                <div className="flex justify-between text-xs mb-1">
                  <span style={{ color: "var(--color-muted-foreground)" }}>
                    עוצמה
                  </span>
                  <span style={{ color: pw.color }}>{pw.label}</span>
                </div>
                <div
                  className="h-1 rounded-full"
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

          <div>
            <label
              htmlFor="setup-password-confirm"
              className="block text-xs font-medium mb-1.5"
              style={{ color: "var(--color-muted-foreground)" }}
            >
              אימות סיסמה
            </label>
            <div className="relative">
              <input
                id="setup-password-confirm"
                type={showConfirmPassword ? "text" : "password"}
                className="w-full px-4 py-3 pl-10 rounded-lg border text-sm outline-none"
                dir="ltr"
                style={inputStyle}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="••••••••"
                autoComplete="new-password"
                required
              />
              <button
                type="button"
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                className="tap-target absolute left-3 top-1/2 transform -translate-y-1/2 transition-colors p-1 hover:opacity-100"
                style={{
                  color: showConfirmPassword
                    ? "#FFFFFF"
                    : "var(--color-muted-foreground)",
                  opacity: showConfirmPassword ? 1 : 0.5,
                }}
                aria-pressed={showConfirmPassword}
                aria-label={showConfirmPassword ? "הסתרת הסיסמה" : "הצגת הסיסמה"}
                title={showConfirmPassword ? "הסתר סיסמה" : "הצג סיסמה"}
              >
                <Icon name="eye" size={16} />
              </button>
            </div>
          </div>

          {error && (
            <div
              role="alert"
              className="px-4 py-3 rounded-lg border text-sm"
              style={{
                background: "rgba(239,68,68,0.08)",
                borderColor: "rgba(239,68,68,0.3)",
                color: "var(--color-danger)",
              }}
            >
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={busy}
            className="btn-gradient w-full py-3 rounded-full font-semibold text-sm mt-2 disabled:opacity-40 cursor-pointer"
          >
            {busy ? "מעדכן סיסמה…" : "עדכון סיסמה"}
          </button>
        </form>
      </div>
    </div>
  )
}
