import { Link } from "react-router"
import { useContent } from "../content/useContent"
import { Md } from "../content/render"
import Icon from "../components/icons"

/**
 * Cancellation and Refund Policy page.
 *
 * Content is fully editable through Maestro CMS. The registry defines
 * cancellation.eyebrow, cancellation.title and cancellation.sections.
 */
export default function CancellationPolicyPage() {
  const c = useContent()

  const eyebrow = c("cancellation.eyebrow") || "CANCELLATION"
  const title = c("cancellation.title") || "מדיניות ביטול עסקה והחזר כספי"
  const sections = c.list<{ heading: string; text: string }>("cancellation.sections")

  return (
    <div className="min-h-full py-12 px-4 sm:px-6 lg:px-8" dir="rtl">
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
          <div className="space-y-6 text-sm leading-relaxed" style={{ color: "var(--color-foreground)" }}>
            {sections.length > 0 ? (
              sections.map((s, i) => (
                <div key={i}>
                  <h2 className="text-lg font-bold mb-2">{s.heading}</h2>
                  <Md text={s.text} className="text-sm leading-relaxed" />
                </div>
              ))
            ) : (
              <p>תוכן מדיניות הביטול טרם הוגדר.</p>
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
