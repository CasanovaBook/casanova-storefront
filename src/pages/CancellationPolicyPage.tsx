import LegalShell from "../components/legal/LegalShell"
import { Md } from "../content/render"
import { useContent } from "../content/useContent"

/**
 * Cancellation and Refund Policy page.
 *
 * Content is fully editable through Maestro CMS. The registry defines
 * cancellation.eyebrow, cancellation.title, cancellation.intro and
 * cancellation.sections.
 */
export default function CancellationPolicyPage() {
  const c = useContent()

  const eyebrow = c("cancellation.eyebrow") || "CANCELLATION"
  const title = c("cancellation.title") || "מדיניות ביטול עסקה והחזר כספי"
  const intro = c("cancellation.intro")
  const sections = c.list<{ heading: string; text: string }>(
    "cancellation.sections",
  )

  return (
    <div className="px-4 sm:px-6 lg:px-8">
      <LegalShell eyebrow={eyebrow} title={title} intro={intro}>
        {sections.map((s, i) => (
          <section key={i}>
            <h2>{s.heading}</h2>
            <Md text={s.text} />
          </section>
        ))}
      </LegalShell>
    </div>
  )
}
