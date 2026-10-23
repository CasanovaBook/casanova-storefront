import { useEffect, type ReactNode } from "react"
import { Link } from "react-router"
import Icon from "../icons"
import AccessibilityFooterLink from "../accessibility/AccessibilityFooterLink"
import { useContent } from "../../content/useContent"

/**
 * Shared shell for login, registration and account-recovery screens.
 *
 * The form is the primary surface and sits on the reading edge; the dark
 * brand panel is supporting context. Keeping one shell here means the auth
 * pages stop carrying five slightly different versions of the same layout.
 */
export default function AuthShell({
  eyebrow,
  title,
  description,
  children,
  footer,
  wide = false,
}: {
  eyebrow?: ReactNode
  title: ReactNode
  description?: ReactNode
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
}) {
  const c = useContent()
  const brand = c("global.brand") || "Casanova"

  useEffect(() => {
    document.documentElement.dataset.appShell = "true"
    return () => { delete document.documentElement.dataset.appShell }
  }, [])

  useEffect(() => {
    if (typeof title !== "string" || !title.trim()) return

    const pageTitle = `${title.trim()} | CASANOVA`
    const previous = document.title
    document.title = pageTitle

    return () => {
      if (document.title === pageTitle) document.title = previous
    }
  }, [title])

  return (
    <div className="auth-shell">
      <a href="#main" className="skip-link">
        דלג לתוכן הראשי
      </a>

      <main id="main" className="auth-form-panel">
        <div className="auth-topbar">
          <Link to="/" className="auth-back-link">
            <Icon name="arrowRight" size={15} />
            חזרה לאתר
          </Link>
          <div className="auth-topbar-actions">
            <AccessibilityFooterLink />
          </div>
        </div>

        <div className={`auth-card${wide ? " auth-card--wide" : ""}`}>
          <div className="auth-mobile-brand">
            <span className="auth-wordmark" dir="ltr" lang="en">
              {brand}
            </span>
            <span className="auth-wordmark-rule" aria-hidden="true" />
          </div>

          {eyebrow && <p className="app-eyebrow">{eyebrow}</p>}
          <h1 className="app-title auth-title">{title}</h1>
          {description && <p className="auth-description">{description}</p>}

          <div className="auth-content">{children}</div>
          {footer && <div className="auth-footer">{footer}</div>}
        </div>

        <div className="auth-legal">
          <Link to="/terms-and-conditions">תנאי שימוש</Link>
          <Link to="/privacy-policy">מדיניות פרטיות</Link>
          <Link to="/accessibility-statement">הצהרת נגישות</Link>
        </div>
      </main>

      <aside className="auth-brand-panel" aria-label="אודות CASANOVA">
        <Link to="/" className="auth-panel-brand">
          <span className="auth-panel-wordmark" dir="ltr" lang="en">
            CASANOVA
          </span>
        </Link>

        <div className="auth-panel-copy">
          <p className="auth-panel-eyebrow">ספרייה דיגיטלית פרטית</p>
          <h2 className="auth-panel-title">
            החשבון שלכם,
            <br />
            <span>הספרים שלכם.</span>
          </h2>
          <p className="auth-panel-text">
            מקום אחד לניהול הגישה, הרכישות והקריאה — בדפדפן, בכל מכשיר.
          </p>

          <ul className="auth-panel-list">
            <li>
              <Icon name="check" size={14} />
              גישה אישית לספרים שרכשתם
            </li>
            <li>
              <Icon name="check" size={14} />
              קריאה בדפדפן, בלי אפליקציה
            </li>
            <li>
              <Icon name="check" size={14} />
              ניהול החשבון והרכישות במקום אחד
            </li>
          </ul>
        </div>

        <div className="auth-panel-foot">
          <span>CASANOVA</span>
          <span>18+</span>
        </div>
      </aside>
    </div>
  )
}
