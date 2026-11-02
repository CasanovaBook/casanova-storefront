/* A quiet answer to "is this list still current?".

 * A device panel is easy to misread as broken: another tab released a device,
 * a phone claimed a slot, or a session idled out, and nothing on screen says
 * the page noticed. So this states when the list was last looked at, pulses
 * when the rows actually move, and names where the rows came from.
 *
 * That last part is not decoration. A list mirrored from the database is a
 * statement about every device on the account; a list read from this browser
 * is a statement about this browser. Showing both the same way would let an
 * administrator block a device they cannot see and let a reader believe a
 * phone is absent when it is only unreachable.
 *
 * It never spins permanently - a spinner that never stops reads as "not yet
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
  source = "local",
  syncing = false,
}: {
  syncedAt: number
  revision: string
  /** "server" once a database answer has actually reached this view. */
  source?: "server" | "local"
  /** A round-trip is in flight right now. */
  syncing?: boolean
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

  const text = syncing
    ? "סונכרן…"
    : moved
      ? "עודכן עכשיו"
      : source === "server"
        ? time
          ? `עודכן ${time}`
          : "מסונכרן"
        : time
          ? `מקומי · ${time}`
          : "מקומי"

  /* The distinction has to be in the accessible name, not only in the dot's
   * colour - a screen reader hears "עודכן 14:35" from a browser that cannot
   * see the reader's phone. */
  const hint =
    source === "server"
      ? `הרשימה מגיעה מהשרת. נבדקה בשעה ${formatIsraelClockTimeFull(at)}`
      : `הרשימה מקומית לדפדפן הזה. נבדקה בשעה ${formatIsraelClockTimeFull(at)}`

  return (
    <span
      className={`app-sync${moved || syncing ? " app-sync--moved" : ""}${
        source === "local" ? " app-sync--local" : ""
      }`}
      role="status"
      aria-live="polite"
      title={hint}
    >
      <span className="app-sync-dot" aria-hidden="true" />
      {text}
    </span>
  )
}
