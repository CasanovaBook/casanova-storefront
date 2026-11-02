/* A quiet answer to "is this list still current?".

 * A device panel is easy to misread as broken: another tab released a device,
 * or a session idled out, and nothing on screen says the page noticed. So this
 * states when the list was last looked at and pulses once when the rows
 * actually move. It never spins - a permanent spinner would read as "not yet
 * loaded" on a panel that is in fact showing the truth. */

import { useEffect, useRef, useState } from "react"

import {
  formatIsraelClockTimeFull,
  formatIsraelDateParts,
} from "../../lib/datetime"

/** Long enough to be seen, short enough not to look stuck. */
const PULSE_MS = 1_400

export default function DeviceSyncBadge({
  syncedAt,
  revision,
}: {
  syncedAt: number
  revision: string
}) {
  const [moved, setMoved] = useState(false)
  const seen = useRef(revision)
  const mounted = useRef(false)

  useEffect(() => {
    /* The first render has nothing to compare against; claiming the list had
     * just changed on mount would be a lie about an event nobody caused. */
    if (!mounted.current) {
      mounted.current = true
      seen.current = revision
      return
    }

    if (seen.current === revision) return

    seen.current = revision
    setMoved(true)

    const id = window.setTimeout(() => setMoved(false), PULSE_MS)

    return () => window.clearTimeout(id)
  }, [revision])

  const at = new Date(syncedAt).toISOString()

  const time = formatIsraelDateParts(at)?.time ?? ""

  const text = moved
    ? "עודכן עכשיו"
    : time
      ? `עודכן ${time}`
      : "הרשימה עדכנית"

  return (
    <span
      className={`app-sync${moved ? " app-sync--moved" : ""}`}
      role="status"
      aria-live="polite"
      title={`הרשימה נבדקה בשעה ${formatIsraelClockTimeFull(at)}`}
    >
      <span className="app-sync-dot" aria-hidden="true" />
      {text}
    </span>
  )
}
