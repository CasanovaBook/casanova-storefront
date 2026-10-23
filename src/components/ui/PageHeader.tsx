import { useEffect, type ReactNode } from "react"
import { Link } from "react-router"

export interface BreadcrumbItem {
  label: string
  to?: string
}

export default function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  breadcrumbs,
  metaTitle,
}: {
  eyebrow?: ReactNode
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  breadcrumbs?: BreadcrumbItem[]
  metaTitle?: string
}) {
  const documentTitle =
    metaTitle ?? (typeof title === "string" ? title : "")

  useEffect(() => {
    if (!documentTitle.trim()) return

    const pageTitle = `${documentTitle.trim()} | CASANOVA`
    const previous = document.title
    document.title = pageTitle

    return () => {
      if (document.title === pageTitle) document.title = previous
    }
  }, [documentTitle])

  return (
    <header className="app-page-header">
      {breadcrumbs && breadcrumbs.length > 0 && (
        <nav className="app-breadcrumbs" aria-label="מיקום בעמוד">
          <ol>
            {breadcrumbs.map((item, index) => (
              <li key={`${item.label}-${index}`}>
                {item.to ? <Link to={item.to}>{item.label}</Link> : <span>{item.label}</span>}
              </li>
            ))}
          </ol>
        </nav>
      )}

      <div className="app-page-heading">
        <div>
          {eyebrow && <p className="app-eyebrow">{eyebrow}</p>}
          <h1 className="app-title">{title}</h1>
          {description && <p className="app-subtitle">{description}</p>}
        </div>

        {actions && <div className="app-page-actions">{actions}</div>}
      </div>
    </header>
  )
}
