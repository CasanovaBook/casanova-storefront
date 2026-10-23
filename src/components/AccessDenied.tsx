import EmptyState from "./ui/EmptyState"

import { ROLE_LABEL } from "../lib/permissions"

import { useAdmin } from "../context/AdminContext"

/** Rendered when the current admin role lacks the permission for a page/action. */

export default function AccessDenied({ page }: { page: string }) {
  const { adminRole } = useAdmin()

  const roleLabel = adminRole ? ROLE_LABEL[adminRole] : "לא הוגדר"

  return (
    <EmptyState
      icon="lock"
      title="אין הרשאה למסך זה"
      description={
        <>
          תפקידך הנוכחי ({roleLabel}) אינו כולל גישה למסך "{page}". פנה לסופר
          אדמין לקבלת הרשאות מתאימות.
        </>
      }
    />
  )
}
