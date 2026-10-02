/* ─────────────────────────────────────────────────────────────
 * Modal — the single dialog primitive for the admin panel.
 *
 * Every admin dialog (customer profile, support ticket, manual ticket,
 * lead, order, product, categories, protection policy) renders through this
 * component, so sizing, scrolling, z-index and dismissal behave identically
 * everywhere. Add a dialog here rather than hand-rolling another overlay.
 *
 * Sizing / scrolling
 * ------------------
 * The overlay is `items-start` with `overflow-y-auto` and the panel carries a
 * small vertical margin. Content taller than the viewport therefore scrolls
 * from the top, which keeps the header, the close button, every field and the
 * footer reachable at any window height. This is what `/admin/users` does
 * correctly. A `max-h` + `overflow-y-auto` on the panel instead clips the
 * dialog once the panel is taller than the viewport, and centring a panel
 * taller than the viewport (`items-center`) pushes its top out of reach —
 * do not reintroduce either. Vertically centred dialogs (`align="center"`,
 * used for short confirmations) centre with `my-auto` rather than
 * `items-center` for the same reason.
 *
 * Why a portal
 * ------------
 * Admin pages mount inside a `.page-enter` root, whose `fadeUp` animation is
 * applied with `fill-mode: both`. That retains `transform: translateY(0)`
 * after the animation finishes, and any transform other than `none` makes an
 * element the containing block for its `position: fixed` descendants. A plain
 * `fixed inset-0` overlay is then sized to the page-height container instead
 * of to the viewport: an `items-center` dialog ends up centred against a box
 * many screens tall, so it sits below the fold with parts unreachable and
 * controls unclickable (the bug on /admin/support). Portalling to
 * `document.body` escapes every transformed ancestor.
 * ───────────────────────────────────────────────────────────── */

import { useEffect, useRef, type ReactNode } from "react"
import { createPortal } from "react-dom"
import Icon from "./icons"

const SIZE_CLASS = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-lg",
  xl: "max-w-xl",
  "2xl": "max-w-2xl",
  "3xl": "max-w-3xl",
  "4xl": "max-w-4xl",
} as const

export type ModalSize = keyof typeof SIZE_CLASS

/* Mounted dialogs register their dismiss handler here: Escape closes only the
 * top-most one, so a confirmation stacked over a form does not close both. */
const escapeStack: Array<() => void> = []

/* Nested dialogs share a single body scroll lock. */
let lockCount = 0

export default function Modal({
  onClose,
  children,
  size = "xl",
  align = "start",
  zIndex = 100,
  title,
  subtitle,
  titleClassName = "",
  ariaLabel,
  panelClassName = "",
  overlayClassName = "",
  closeOnOverlayClick = false,
  hideHeader = false,
}: {
  onClose: () => void
  children: ReactNode
  size?: ModalSize
  align?: "start" | "center"
  zIndex?: number
  title?: ReactNode
  subtitle?: ReactNode
  titleClassName?: string
  ariaLabel?: string
  panelClassName?: string
  overlayClassName?: string
  closeOnOverlayClick?: boolean
  hideHeader?: boolean
}) {
  useEffect(() => {
    const dismiss = () => onClose()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      if (escapeStack[escapeStack.length - 1] !== dismiss) return
      event.stopPropagation()
      onClose()
    }
    escapeStack.push(dismiss)
    lockCount += 1
    if (lockCount === 1) document.body.style.overflow = "hidden"
    document.addEventListener("keydown", onKeyDown)
    return () => {
      document.removeEventListener("keydown", onKeyDown)
      const index = escapeStack.indexOf(dismiss)
      if (index !== -1) escapeStack.splice(index, 1)
      lockCount -= 1
      if (lockCount === 0) document.body.style.overflow = ""
    }
  }, [onClose])

  const panelRef = useRef<HTMLDivElement | null>(null)
  const previousActive = useRef<Element | null>(null)

  useEffect(() => {
    // Focus management: save active element, move focus into panel and trap Tab
    previousActive.current = document.activeElement

    const node = panelRef.current
    if (node) {
      const focusable = node.querySelector<HTMLElement>(
        'button, a[href], input, textarea, select, [tabindex]:not([tabindex="-1"])',
      )
      try {
        ;(focusable ?? node).focus()
      } catch {}
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return
      if (!node) return
      const focusables = Array.from(
        node.querySelectorAll<HTMLElement>(
          'a[href], area[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), iframe, [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => el.offsetParent !== null)
      if (focusables.length === 0) return
      const first = focusables[0]
      const last = focusables[focusables.length - 1]

      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault()
          last.focus()
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }

    document.addEventListener("keydown", onKey)

    return () => {
      document.removeEventListener("keydown", onKey)
      try {
        ;(previousActive.current as HTMLElement | null)?.focus()
      } catch {}
    }
  }, [])

  const showHeader = !hideHeader && title !== undefined

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel ?? (typeof title === "string" ? title : undefined)}
      className={`fixed inset-0 flex items-start justify-center overflow-y-auto overscroll-contain p-4 sm:p-6 ${overlayClassName}`}
      style={{ background: "rgba(0,0,0,0.7)", zIndex }}
      onClick={closeOnOverlayClick ? onClose : undefined}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        className={`card-glow w-full ${SIZE_CLASS[size]} p-6 ${
          align === "center" ? "my-auto" : "my-4"
        } ${panelClassName}`}
        onClick={
          closeOnOverlayClick
            ? (event) => event.stopPropagation()
            : undefined
        }
      >
        {showHeader && (
          <div className="flex items-center justify-between gap-3 mb-5">
            <div className="min-w-0">
              <h2
                className={`font-display text-xl font-semibold ${titleClassName}`}
              >
                {title}
              </h2>
              {subtitle}
            </div>
            <button
              onClick={onClose}
              aria-label="סגירה"
              className="shrink-0"
              style={{ color: "var(--color-muted-foreground)" }}
            >
              <Icon name="x" size={16} />
            </button>
          </div>
        )}
        {children}
      </div>
    </div>,
    document.body,
  )
}
