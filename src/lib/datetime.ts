/**
 * Date/time formatting for the admin panel, pinned to Israel time.
 *
 * WHY A SHARED HELPER
 *
 * The admin panel formats every timestamp with `toLocaleDateString("he-IL")`
 * and no `timeZone` option. That silently renders in whatever zone the
 * *viewer's browser* is set to, so the same event could read differently on
 * two admins' screens, or be shifted by hours for a travelling admin. The
 * value that matters - a customer's actual login time - belongs to a fixed
 * wall clock, not to the reader's.
 *
 * WHY `Asia/Jerusalem` AND NOT A FIXED "+03"
 *
 * Israel observes DST, so its offset is UTC+2 in winter and UTC+3 in
 * summer. A hard-coded `+03` would be one hour fast from late October to
 * late March, and because the wrong result still looks like a plausible
 * clock time the error would go unnoticed. The named IANA zone follows the
 * DST calendar automatically. See migrations/0008_set_timezone_israel.sql.
 *
 * `hour12: false` forces 24-hour output; the `he-IL` locale happens to
 * default to it, but relying on a locale default for a stated requirement
 * is how formats break on an ICU update.
 */

/** IANA zone for all admin-facing timestamps. */

export const ISRAEL_TZ = "Asia/Jerusalem"

const DATE_TIME_OPTIONS: Intl.DateTimeFormatOptions = {
  day: "numeric",

  month: "numeric",

  year: "numeric",

  hour: "2-digit",

  minute: "2-digit",

  hour12: false,

  timeZone: ISRAEL_TZ,
}

/**
 * Formats an ISO timestamp as `28.9.2026, 16:35` in Israel time (24-hour).
 *
 * Returns an empty string for `null`/`undefined`/empty/unparseable input -
 * `new Date("nope").toLocaleString(...)` would otherwise yield the literal
 * string `"Invalid Date"` and render that into the UI. Callers pair this
 * with `|| "מעולם"` (or a similar fallback) so the missing case stays under
 * their control.
 */

export function formatIsraelDateTime(value?: string | null): string {
  if (!value) return ""

  const date = new Date(value)

  if (Number.isNaN(date.getTime())) return ""

  return date.toLocaleString("he-IL", DATE_TIME_OPTIONS)
}

/* The audit log needs a deterministic `DD.MM.YYYY HH:mm` with no ICU
 * separators: `toLocaleString("he-IL")` injects a literal ", " between the
 * date and the time, and that pattern is an ICU choice that can change
 * independently of this code. Assembling the string from `formatToParts`
 * pins the exact layout, and `hourCycle: "h23"` (rather than `hour12:
 * false`) rules out a `24:00` edge. */

const CLOCK_OPTIONS: Intl.DateTimeFormatOptions = {
  day: "2-digit",

  month: "2-digit",

  year: "numeric",

  hour: "2-digit",

  minute: "2-digit",

  hourCycle: "h23",

  timeZone: ISRAEL_TZ,
}

function clockParts(
  value?: string | null,

  withSeconds = false,
): {
  date: string
  time: string
  ymd: string
} | null {
  if (!value) return null

  const date = new Date(value)

  if (Number.isNaN(date.getTime())) return null

  const parts = new Intl.DateTimeFormat("en-GB", {
    ...CLOCK_OPTIONS,

    ...(withSeconds ? { second: "2-digit" } : {}),
  }).formatToParts(date)

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? ""

  const day = get("day")

  const month = get("month")

  const year = get("year")

  const hour = get("hour")

  const minute = get("minute")

  const second = get("second")

  return {
    date: `${day}.${month}.${year}`,

    time: second ? `${hour}:${minute}:${second}` : `${hour}:${minute}`,

    ymd: `${year}-${month}-${day}`,
  }
}

/** `24.10.2026 14:35` in Israel time; `""` for missing/invalid input. */

export function formatIsraelClockTime(value?: string | null): string {
  const parts = clockParts(value)

  return parts ? `${parts.date} ${parts.time}` : ""
}

/** `24.10.2026 14:35:07` - full precision for tooltips. */

export function formatIsraelClockTimeFull(value?: string | null): string {
  const parts = clockParts(value, true)

  return parts ? `${parts.date} ${parts.time}` : ""
}

/**
 * Israel-time pieces of a timestamp. `ymd` ("YYYY-MM-DD") is the key for
 * date-range filtering: comparing it lexicographically against
 * `<input type="date">` values needs no offset or DST arithmetic.
 */

export function formatIsraelDateParts(
  value?: string | null,
): {
  date: string
  time: string
  ymd: string
} | null {
  return clockParts(value)
}
