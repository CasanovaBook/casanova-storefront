/* ─────────────────────────────────────────────────────────────
 * First-run installation.
 *
 * A fresh deployment has no accounts at all, so nobody can sign in.
 * This screen runs exactly once and creates the first SUPER_ADMIN;
 * the service layer refuses the call as soon as any administrator
 * exists, so it cannot be used to mint extra privileged accounts.
 * ───────────────────────────────────────────────────────────── */

import { useEffect, useState } from "react"
import { useNavigate } from "react-router"
import { useApp } from "../context/AppContext"
import {
  PASSWORD_CHAR_RULE,
  hasHebrewChars,
  hasInvalidPasswordChars,
  passwordProblem,
} from "../lib/auth"
import Icon from "../components/icons"
import Alert from "../components/ui/Alert"
import AuthShell from "../components/layout/AuthShell"

export default function SetupPage() {
  const { setupAdmin, bootstrapRequired } = useApp()
  const navigate = useNavigate()

  const [form, setForm] = useState({
    first_name: "",
    last_name: "",
    email: "",
    password: "",
    confirm: "",
  })

  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const [hebrewWarning, setHebrewWarning] = useState(false)
  const [emailHebrewWarning, setEmailHebrewWarning] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)

  // Check for Hebrew characters in password and email
  const handleFormChange = (key: keyof typeof form, value: string) => {
    setForm({ ...form, [key]: value })

    if (key === "password") {
      setHebrewWarning(hasInvalidPasswordChars(value))
    }

    if (key === "email") {
      setEmailHebrewWarning(hasHebrewChars(value))

      if (
        error ===
          "כתובת האימייל אינה יכולה להכיל אותיות בעברית. יש להזין כתובת באנגלית בלבד." &&
        !hasHebrewChars(value)
      ) {
        setError("")
      }
    }
  }

  // Once an administrator exists this page has no purpose any more.
  useEffect(() => {
    if (!bootstrapRequired) navigate("/login", { replace: true })
  }, [bootstrapRequired, navigate])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    setError("")

    // Disallow Hebrew in email
    if (hasHebrewChars(form.email)) {
      setError(
        "כתובת האימייל אינה יכולה להכיל אותיות בעברית. יש להזין כתובת באנגלית בלבד.",
      )
      return
    }

    const problem = passwordProblem(form.password)

    if (problem) {
      setError(problem)
      return
    }

    if (form.password !== form.confirm) {
      setError("אימות הסיסמה אינו תואם.")
      return
    }

    setBusy(true)

    const result = await setupAdmin({
      first_name: form.first_name.trim(),
      last_name: form.last_name.trim(),
      email: form.email.trim(),
      password: form.password,
    })

    setBusy(false)

    if (!result.ok) {
      setError(result.error ?? "ההתקנה נכשלה.")
      return
    }

    navigate("/admin", { replace: true })
  }

  if (!bootstrapRequired) return null

  const fields: {
    key: keyof typeof form
    label: string
    type: string
    ltr?: boolean
  }[] = [
    { key: "first_name", label: "שם פרטי", type: "text" },
    { key: "last_name", label: "שם משפחה", type: "text" },
    { key: "email", label: "אימייל", type: "email", ltr: true },
    { key: "password", label: "סיסמה", type: "password" },
    { key: "confirm", label: "אימות סיסמה", type: "password" },
  ]

  return (
    <AuthShell
      eyebrow="הפעלה ראשונה"
      title="התקנה ראשונית"
      description="המערכת ריקה - אין בה עדיין אף חשבון. צור את חשבון המנהל הראשון כדי לפתוח את אזור הניהול."
    >
      <div className="space-y-5">
        <Alert tone="warning">
          החשבון שתיצור כאן יקבל הרשאות מנהל־על. המסך הזה ננעל לצמיתות לאחר
          יצירת המנהל הראשון.
        </Alert>

        {error && <Alert tone="error">{error}</Alert>}

        <form onSubmit={handleSubmit} className="space-y-4">
          {fields.map(({ key, label, type, ltr }) => {
            const revealed =
              key === "password"
                ? showPassword
                : key === "confirm"
                  ? showConfirmPassword
                  : false
            const warningId =
              key === "email"
                ? "setup-field-email-warning"
                : key === "password"
                  ? "setup-field-password-warning"
                  : undefined
            const hasWarning =
              (key === "email" && emailHebrewWarning) ||
              (key === "password" && hebrewWarning)

            return (
              <div key={key} className="app-field">
                <label htmlFor={`setup-field-${key}`} className="app-label">
                  {label}
                </label>
                {type === "password" ? (
                  <div dir="ltr" className="relative">
                    <input
                      id={`setup-field-${key}`}
                      type={revealed ? "text" : "password"}
                      dir="ltr"
                      className="w-full py-3 ps-4 pe-12 text-left"
                      style={
                        hasWarning
                          ? { borderColor: "var(--color-danger)" }
                          : undefined
                      }
                      value={form[key]}
                      placeholder="••••••••"
                      onChange={(e) => handleFormChange(key, e.target.value)}
                      aria-invalid={hasWarning || undefined}
                      aria-describedby={hasWarning ? warningId : undefined}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        if (key === "password") {
                          setShowPassword(!showPassword)
                        } else if (key === "confirm") {
                          setShowConfirmPassword(!showConfirmPassword)
                        }
                      }}
                      className="app-icon-btn absolute end-1 top-1/2 -translate-y-1/2"
                      style={{
                        color: revealed
                          ? "var(--color-primary)"
                          : "var(--color-muted-foreground)",
                      }}
                      aria-label={revealed ? "הסתרת הסיסמה" : "הצגת הסיסמה"}
                      aria-pressed={revealed}
                      title={revealed ? "הסתר סיסמה" : "הצג סיסמה"}
                    >
                      <Icon name="eye" size={16} />
                    </button>
                  </div>
                ) : (
                  <input
                    id={`setup-field-${key}`}
                    type={type}
                    dir={ltr ? "ltr" : undefined}
                    className={"w-full px-4 py-3" + (ltr ? " text-left" : "")}
                    style={
                      hasWarning
                        ? { borderColor: "var(--color-danger)" }
                        : undefined
                    }
                    value={form[key]}
                    onChange={(e) => handleFormChange(key, e.target.value)}
                    aria-invalid={hasWarning || undefined}
                    aria-describedby={hasWarning ? warningId : undefined}
                  />
                )}
                {key === "email" && emailHebrewWarning && (
                  <div
                    id="setup-field-email-warning"
                    role="status"
                    className="app-alert app-alert--warning"
                  >
                    <Icon
                      name="alertTriangle"
                      size={17}
                      style={{
                        flexShrink: 0,
                        marginTop: 2,
                        color: "var(--color-primary)",
                      }}
                    />
                    <span className="text-xs">
                      כתובת האימייל חייבת להכיל אותיות באנגלית בלבד (ללא אותיות
                      בעברית)
                    </span>
                  </div>
                )}
                {key === "password" && hebrewWarning && (
                  <div
                    id="setup-field-password-warning"
                    role="status"
                    className="app-alert app-alert--warning"
                  >
                    <Icon
                      name="alertTriangle"
                      size={17}
                      style={{
                        flexShrink: 0,
                        marginTop: 2,
                        color: "var(--color-primary)",
                      }}
                    />
                    <span className="text-xs">{PASSWORD_CHAR_RULE}</span>
                  </div>
                )}
              </div>
            )
          })}

          <button
            type="submit"
            disabled={busy}
            aria-busy={busy || undefined}
            className="app-btn w-full"
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
                יוצר את החשבון…
              </>
            ) : (
              "יצירת חשבון המנהל הראשון"
            )}
          </button>
        </form>
      </div>
    </AuthShell>
  )
}
