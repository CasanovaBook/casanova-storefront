import Icon from "./icons"

import { ROLE_LABEL } from "../lib/permissions"

import { useAdmin } from "../context/AdminContext"

/** Rendered when the current admin role lacks the permission for a page/action. */

export default function AccessDenied({ page }: { page: string }) {
  const { adminRole } = useAdmin()

  const roleLabel = adminRole ? ROLE_LABEL[adminRole] : "לא הוגדר"

  return (
    <div
      className="rounded-2xl border p-12 flex flex-col items-center text-center gap-3"
      style={{
        background: "var(--color-card)",
        borderColor: "var(--color-border)",
      }}
    >
      <span
        className="w-14 h-14 rounded-full flex items-center justify-center"
        style={{ background: "rgba(239,68,68,0.15)", color: "#F87171" }}
      >
        <Icon name="lock" size={26} />
      </span>
      <h2
        className="text-xl font-display font-bold"
        style={{ color: "var(--color-foreground)" }}
      >
        אין הרשאה למסך זה
      </h2>
      <p
        className="text-sm max-w-md"
        style={{ color: "var(--color-muted-foreground)" }}
      >
        תפקידך הנוכחי ({roleLabel}) אינו כולל גישה למסך "{page}". פנה לסופר
        אדמין לקבלת הרשאות מתאימות.
      </p>
    </div>
  )
}
