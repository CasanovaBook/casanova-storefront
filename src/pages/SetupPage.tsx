/* ─────────────────────────────────────────────────────────────
 * First-run installation.
 *
 * A fresh deployment has no accounts at all, so nobody can sign in.
 * This screen runs exactly once and creates the first SUPER_ADMIN;
 * the service layer refuses the call as soon as any administrator
 * exists, so it cannot be used to mint extra privileged accounts.
 * ───────────────────────────────────────────────────────────── */

import { useEffect, useState } from "react"

import { Link, useNavigate } from "react-router"

import { useApp } from "../context/AppContext"

import { passwordProblem } from "../lib/auth"

import Icon from "../components/icons"

import ThemeToggle from "../components/ThemeToggle"

import logoImg from "../../images/main_photo.jpg"

// Function to detect Hebrew characters

function hasHebrewChars(text: string): boolean {
  return /[\u0590-\u05FF]/.test(text)
}

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
      setHebrewWarning(hasHebrewChars(value))
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

  const inputClass =
    "w-full px-4 py-3 rounded-lg border text-sm outline-none transition-all"

  const inputStyle = {
    background: "var(--color-secondary)",

    borderColor: "var(--color-border)",

    color: "var(--color-foreground)",
  }

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
    <div
      className="min-h-screen flex items-center justify-center px-6 relative overflow-hidden"
      style={{ background: "var(--color-background)" }}
    >
      <div
        className="absolute w-[500px] h-[500px] rounded-full pointer-events-none"
        style={{
          background:
            "radial-gradient(circle, rgba(212,160,48,0.09) 0%, transparent 70%)",
          top: "-140px",
          right: "-120px",
        }}
      />
      <div className="absolute top-5 left-5 z-10">
        <ThemeToggle />
      </div>

      <div className="w-full max-w-md page-enter relative">
        <div className="text-center mb-8">
          <Link to="/" className="inline-flex items-center gap-2 mb-6">
            <img
              src={logoImg}
              alt="Casanova"
              className="w-9 h-9 rounded-lg object-cover"
            />
            <span
              dir="ltr"
              className="font-display text-xl font-bold tracking-wide"
              style={{ color: "var(--color-primary)" }}
            >
              Casanova
            </span>
          </Link>
          <h1 className="font-display text-3xl font-semibold mb-2">
            התקנה ראשונית
          </h1>
          <p
            className="text-sm"
            style={{ color: "var(--color-muted-foreground)" }}
          >
            המערכת ריקה — אין בה עדיין אף חשבון. צור את חשבון המנהל הראשון כדי
            לפתוח את אזור הניהול.
          </p>
        </div>

        <div className="card-glow p-6">
          <p
            className="text-xs px-3 py-2.5 rounded-lg mb-5 flex items-start gap-2"
            style={{ background: "rgba(245,158,11,0.1)", color: "#F59E0B" }}
          >
            <Icon name="shield" size={14} className="flex-shrink-0 mt-0.5" />
            החשבון שתיצור כאן יקבל הרשאות מנהל־על. המסך הזה ננעל לצמיתות לאחר
            יצירת המנהל הראשון.
          </p>

          {error && (
            <p
              className="text-xs px-3 py-2.5 rounded-lg mb-4"
              style={{
                background: "rgba(239,68,68,0.1)",
                color: "var(--color-danger)",
              }}
            >
              {error}
            </p>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {fields.map(({ key, label, type, ltr }) => (
              <div key={key}>
                <label
                  className="block text-xs font-medium mb-1.5"
                  style={{ color: "var(--color-muted-foreground)" }}
                >
                  {label}
                </label>
                {type === "password" ? (
                  <div className="relative">
                    <input
                      type={
                        key === "password"
                          ? showPassword
                            ? "text"
                            : "password"
                          : key === "confirm"
                            ? showConfirmPassword
                              ? "text"
                              : "password"
                            : type
                      }
                      dir="ltr"
                      className={
                        inputClass +
                        " pl-10 " +
                        "text-left"
                      }
                      style={inputStyle}
                      value={form[key]}
                      placeholder="••••••••"
                      onChange={(e) => handleFormChange(key, e.target.value)}
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
                      className="absolute left-3 top-1/2 transform -translate-y-1/2 transition-colors p-1 hover:opacity-100"
                      style={{
                        color: (
                          key === "password"
                            ? showPassword
                            : showConfirmPassword
                        )
                          ? "#FFFFFF"
                          : "var(--color-muted-foreground)",

                        opacity: (
                          key === "password"
                            ? showPassword
                            : showConfirmPassword
                        )
                          ? 1
                          : 0.5,
                      }}
                      tabIndex={-1}
                      title={
                        (
                          key === "password"
                            ? showPassword
                            : showConfirmPassword
                        )
                          ? "הסתר סיסמה"
                          : "הצג סיסמה"
                      }
                    >
                      <Icon name="eye" size={16} />
                    </button>
                  </div>
                ) : (
                  <input
                    type={type}
                    dir={ltr ? "ltr" : undefined}
                    className={inputClass + (ltr ? " text-left" : "")}
                    style={inputStyle}
                    value={form[key]}
                    onChange={(e) => handleFormChange(key, e.target.value)}
                  />
                )}
                {key === "email" && emailHebrewWarning && (
                  <div
                    className="flex items-center gap-2 mt-1.5 px-3 py-2 rounded-md"
                    style={{
                      background: "rgba(245,158,11,0.1)",
                      borderColor: "rgba(245,158,11,0.3)",
                      border: "1px solid rgba(245,158,11,0.3)",
                    }}
                  >
                    <Icon
                      name="alert-triangle"
                      className="w-4 h-4 flex-shrink-0"
                      style={{ color: "rgb(245,158,11)" }}
                    />
                    <span
                      className="text-xs"
                      style={{ color: "rgb(245,158,11)" }}
                    >
                      כתובת האימייל חייבת להכיל אותיות באנגלית בלבד (ללא אותיות
                      בעברית)
                    </span>
                  </div>
                )}
                {key === "password" && hebrewWarning && (
                  <div
                    className="flex items-center gap-2 mt-1.5 px-3 py-2 rounded-md"
                    style={{
                      background: "rgba(245,158,11,0.1)",
                      borderColor: "rgba(245,158,11,0.3)",
                    }}
                  >
                    <Icon
                      name="alert-triangle"
                      className="w-4 h-4"
                      style={{ color: "rgb(245,158,11)" }}
                    />
                    <span
                      className="text-xs"
                      style={{ color: "rgb(245,158,11)" }}
                    >
                      הסיסמה חייבת להכיל רק אותיות אנגליות וספרות
                    </span>
                  </div>
                )}
              </div>
            ))}

            <button
              type="submit"
              disabled={busy}
              className="btn-gradient w-full py-3 rounded-full font-semibold text-sm disabled:opacity-40"
            >
              {busy ? "יוצר את החשבון…" : "יצירת חשבון המנהל הראשון"}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
