import LegalShell from "../components/legal/LegalShell"
import { Md } from "../content/render"
import { useContent } from "../content/useContent"

/**
 * Privacy Policy page.
 *
 * Content is fully editable through Maestro CMS. The registry defines
 * privacy.eyebrow, privacy.title, privacy.intro and privacy.sections.
 */
export default function PrivacyPage() {
  const c = useContent()

  const eyebrow = c("privacy.eyebrow") || "PRIVACY POLICY"
  const title = c("privacy.title") || "מדיניות פרטיות"
  const intro = c("privacy.intro")
  const sections = c.list<{ heading: string; text: string }>("privacy.sections")

  return (
    <div className="px-4 sm:px-6 lg:px-8">
      <LegalShell eyebrow={eyebrow} title={title} intro={intro}>
        <div className="mx-auto max-w-3xl">
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
