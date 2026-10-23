import type { ReactNode } from "react"
import { Link } from "react-router"
import Icon from "../icons"
import PageHeader from "../ui/PageHeader"

export default function LegalShell({
  eyebrow,
  title,
  intro,
  children,
}: {
  eyebrow?: ReactNode
  title: string
  intro?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="legal-shell">
      <div className="app-page app-page--content">
        <PageHeader
          eyebrow={eyebrow}
          title={title}
          description={intro}
          breadcrumbs={[
            { label: "דף הבית", to: "/" },
            { label: title },
          ]}
        />

        <article className="legal-doc">
          <div className="legal-doc-meta">
            <span>מסמך CASANOVA</span>
            <span>גרסה מתעדכנת</span>
          </div>
          <div className="legal-doc-body">{children}</div>
        </article>

        <div className="legal-foot">
          <Link to="/" className="app-btn app-btn-secondary">
            <Icon name="arrowRight" size={15} />
            חזרה לדף הבית
          </Link>
          <p>
            שאלות לגבי המסמך?{" "}
            <Link to="/support">אפשר לפנות אלינו דרך עמוד התמיכה</Link>.
          </p>
        </div>
      </div>
    </div>
  )
}
