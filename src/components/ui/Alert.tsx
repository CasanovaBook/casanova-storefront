import type { ReactNode } from "react"
import Icon, { type IconName } from "../icons"

type Tone = "info" | "success" | "warning" | "error"

const ICONS: Record<Tone, IconName> = {
  info: "sparkles",
  success: "checkCircle",
  warning: "alertTriangle",
  error: "alertTriangle",
}

export default function Alert({
  tone = "info",
  children,
  title,
}: {
  tone?: Tone
  children: ReactNode
  title?: ReactNode
}) {
  return (
    <div
      className={`app-alert app-alert--${tone}`}
      role={tone === "error" ? "alert" : "status"}
      aria-live={tone === "error" ? undefined : "polite"}
    >
      <Icon
        name={ICONS[tone]}
        size={17}
        style={{ flexShrink: 0, marginTop: 2 }}
        className="app-muted"
      />
      <div style={{ minWidth: 0 }}>
        {title && <strong style={{ display: "block", marginBottom: "0.15rem" }}>{title}</strong>}
        <div>{children}</div>
      </div>
    </div>
  )
}
