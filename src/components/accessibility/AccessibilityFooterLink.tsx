import { useAccessibility } from "../../context/AccessibilityContext"
import Icon from "../icons"
import { ACCESSIBILITY_PANEL_ID } from "./AccessibilityWidget"

/**
 * The accessibility control in the site footer.
 *
 * Two jobs, one control, never duplicated:
 *  - while the floating button is visible it is a second, always-present way
 *    into the same settings panel, for people who do not use the side button;
 *  - once the button has been hidden it is the way back. Hiding the button is
 *    therefore never a one-way door, which is the failure mode this whole
 *    component exists to prevent.
 *
 * It is rendered by the public footer, the sales page footer and the signed-in
 * side navigation, so it is reachable from the storefront, from a login or
 * checkout page and from the dashboard and admin shells alike.
 */
export default function AccessibilityFooterLink({
  className = "",
}: {
  className?: string
}) {
  const { hidden, panelOpen, openPanel, showWidget } = useAccessibility()

  const label = hidden ? "הצגת כפתור הנגישות" : "הגדרות נגישות"

  return (
    <button
      type="button"
      data-a11y-restore={hidden ? "" : undefined}
      className={`a11y-footer-link ${className}`.trim()}
      aria-haspopup="dialog"
      aria-expanded={panelOpen}
      aria-controls={panelOpen ? ACCESSIBILITY_PANEL_ID : undefined}
      onClick={(event) => {
        if (hidden) showWidget()
        openPanel(event.currentTarget)
      }}
    >
      <Icon name="accessibility" size={14} />
      {label}
    </button>
  )
}
