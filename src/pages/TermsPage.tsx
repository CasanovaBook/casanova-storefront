import { Link } from "react-router"
import { useCms } from "../context/CmsContext"
import { useContent } from "../content/useContent"
import { Md } from "../content/render"
import Icon from "../components/icons"

/**
 * Terms and Conditions page.
 *
 * Content is fully editable through Maestro CMS. The registry defines
 * terms.eyebrow, terms.title and terms.sections (a list of heading+text).
 * When no sections have been saved, the registry defaults render.
 */
export default function TermsPage() {
  const { settings } = useCms()
  const c = useContent()

  const eyebrow = c("terms.eyebrow") || "TERMS OF USE"
  const title = c("terms.title") || "תנאי שימוש"
  const sections = c.list<{ heading: string; text: string }>("terms.sections")

  return (
    <div className="min-h-full py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="text-center mb-10">
          <p className="text-xs font-bold tracking-wide mb-2" style={{ color: "var(--color-primary)" }}>
            {eyebrow}
          </p>
          <h1
            className="text-3xl font-bold mb-4"
            style={{ color: "var(--color-foreground)" }}
          >
            {title}
          </h1>
          <div
            className="w-16 h-1 mx-auto rounded-full"
            style={{ background: "var(--color-primary)" }}
          />
        </div>

        {/* Content Card */}
        <div
          className="rounded-2xl border p-8 sm:p-10"
          style={{
            background: "var(--color-card)",
            borderColor: "var(--color-border)",
          }}
        >
          {/* Copyright Header */}
          <div className="text-center mb-8 pb-6 border-b" style={{ borderColor: "var(--color-border)" }}>
            <p
              className="text-lg font-semibold mb-1"
              style={{ color: "var(--color-foreground)" }}
            >
              © {new Date().getFullYear()} {settings.brand_name?.toUpperCase() ?? "CASANOVA BOOKS"}
            </p>
            <p
              className="text-sm"
              style={{ color: "var(--color-muted-foreground)" }}
            >
              מאת {settings.brand_name ?? "קזנובה"} | מהדורה ראשונה
            </p>
          </div>

          {/* Terms Content — rendered from the CMS sections list */}
          <div
            className="space-y-6 text-sm leading-relaxed"
            style={{ color: "var(--color-foreground)" }}
            dir="rtl"
          >
            {sections.length > 0 ? (
              sections.map((s, i) => (
                <div key={i}>
                  <h2 className="text-base font-bold mb-2">{s.heading}</h2>
                  <Md text={s.text} className="text-sm leading-relaxed" />
                </div>
              ))
            ) : (
              <p>תוכן התקנון טרם הוגדר.</p>
            )}
          </div>
        </div>

        {/* Back Link */}
        <div className="mt-8 text-center">
          <Link
            to="/"
            className="inline-flex items-center gap-2 text-sm font-medium transition-opacity hover:opacity-70"
            style={{ color: "var(--color-primary)" }}
          >
            <Icon name="arrowRight" size={16} />
            {c("ui.common.back") || "חזרה"}
          </Link>
        </div>
      </div>
    </div>
  )
}
