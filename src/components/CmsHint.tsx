import { useApp } from "../context/AppContext"

/**
 * Placeholder rendered where CMS content is missing.
 *
 * Visible to an administrator only, so a visitor never sees scaffolding —
 * and never sees invented copy standing in for content nobody wrote. That
 * trade is deliberate: an unconfigured page looks sparse to a customer, but
 * it can never claim something the business did not say.
 *
 * Returning `null` rather than an empty box matters for layout too: a
 * visitor's page closes up as though the slot were never there, instead of
 * leaving a gap that reads as a rendering bug.
 */

export default function CmsHint({ what }: { what: string }) {
  const { isAdmin } = useApp()

  if (!isAdmin) return null

  return (
    <p
      className="text-xs px-4 py-3 rounded-lg border border-dashed"
      style={{
        borderColor: "rgba(212,160,48,0.45)",
        color: "var(--color-muted-foreground)",
      }}
    >
      {what}
    </p>
  )
}
