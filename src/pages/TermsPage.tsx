import LegalShell from "../components/legal/LegalShell"
import { Md } from "../content/render"
import { useContent } from "../content/useContent"

/**
 * Terms and Conditions page.
 *
 * Content is fully editable through Maestro CMS. The registry defines
 * terms.eyebrow, terms.title, terms.body and terms.sections.
 */
export default function TermsPage() {
  const c = useContent()

  const eyebrow = c("terms.eyebrow") || "TERMS OF USE"
  const title = c("terms.title") || "תנאי שימוש"
  const body = c("terms.body")
  const sections = c.list<{ heading: string; text: string }>("terms.sections")

  return (
    <div className="px-4 sm:px-6 lg:px-8">
      <LegalShell eyebrow={eyebrow} title={title}>
        <div className="mx-auto max-w-3xl">
          <div className="mb-8 text-right">
            <p
              className="font-display text-xl font-semibold"
              style={{ color: "var(--color-accent)" }}
            >
              © 2026 CASANOVA BOOKS
            </p>
            <p
              className="mt-1 text-sm"
              style={{ color: "var(--color-muted-foreground)" }}
            >
              מאת קזנובה | מהדורה ראשונה
            </p>
          </div>

          <Md text={body} className="text-right leading-relaxed" />

          {sections.map((s, i) => (
            <section key={i}>
              <h2>{s.heading}</h2>
              <Md text={s.text} />
            </section>
          ))}
        </div>
      </LegalShell>
    </div>
  )
}
