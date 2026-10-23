import type { ReactNode } from "react"
import Icon, { type IconName } from "../icons"

export default function EmptyState({
  icon = "inbox",
  title,
  description,
  actions,
}: {
  icon?: IconName
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
}) {
  return (
    <div className="app-empty">
      <span className="app-empty-icon" aria-hidden="true">
        <Icon name={icon} size={22} />
      </span>
      <h2 className="app-empty-title">{title}</h2>
      {description && <p className="app-empty-text">{description}</p>}
      {actions && <div className="app-empty-actions">{actions}</div>}
    </div>
  )
}
