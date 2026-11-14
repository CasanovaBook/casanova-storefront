import { isSupabaseConfigured } from "../../integrations/supabase/supabase"
import Alert from "../ui/Alert"

/**
 * Makes the remaining browser-only business data impossible to mistake
 * for hosted data. Rendered only when Supabase is configured; without it
 * the whole app is intentionally local.
 */
export default function LocalDataNotice({
  items,
}: {
  items: string[]
}) {
  if (!isSupabaseConfigured) return null

  return (
    <div className="mb-4">
      <Alert tone="warning" title="נתונים מקומיים — לא מסונכרנים">
        <p>
          {items.join(", ")} עדיין נשמרים ב-localStorage של הדפדפן הזה בלבד.
          הם אינם משותפים בין מכשירים ואינם נשמרים ב-Supabase, ולכן אין
          להסתמך עליהם כמקור אמת תפעולי.
        </p>
      </Alert>
    </div>
  )
}
