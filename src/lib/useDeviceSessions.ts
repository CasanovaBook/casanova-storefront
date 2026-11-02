/* ─────────────────────────────────────────────────────────────
 * The one owner of "which devices are connected, right now".
 *
 * The reader's device panel and the admin security screen show the same
 * rows and shared the same blind spot: the store tells them when a row
 * *changed*, but a session idling past `session_timeout_minutes` changes
 * nothing - expiry is derived against the clock while rendering. So a
 * panel could go on calling a dead device "עכשיו" until the visitor
 * reloaded the page, which is exactly what made the list look broken.
 *
 * Everything here reads. No timer writes: `mutate()` rewrites the whole
 * document and notifies every subscriber, so a scheduled write would turn
 * a display concern into storage churn for the entire app.
 * ───────────────────────────────────────────────────────────── */

import { useEffect, useMemo, useRef, useState } from "react"

import { useStore } from "../data/store"
import type { DeviceSession, DrmPolicy } from "../types"
import {
  isSessionOpen,
  listAllDeviceSessions,
  listDeviceSessions,
  occupiesSlot,
  resolveDrmPolicy,
} from "./api-security"
import type { Actor } from "../shared/result"

/** Fine enough that relative time never lies, coarse enough to be invisible. */
const CLOCK_TICK_MS = 15_000

/**
 * Minimum gap between return-to-tab re-reads. Focus and visibility fire
 * constantly - fullscreen toggles, iframe interactions, and the device-session
 * touches themselves - so an unthrottled handler would re-derive the list on
 * every flicker. Same reasoning as the entitlement sync it mirrors.
 */
const RETURN_MIN_MS = 60_000

const byActivity = (a: DeviceSession, b: DeviceSession) =>
  new Date(b.last_seen_at).getTime() - new Date(a.last_seen_at).getTime()

export interface DeviceSessionsView {
  /** Rows still open, most recent activity first. */
  sessions: DeviceSession[]
  /** Every row this actor may see, history included. */
  rows: DeviceSession[]
  policy: DrmPolicy
  /** Slots actually held - open *and* not idled out. What the cap counts. */
  used: number
  cap: number
  full: boolean
  /** Only until the first paint, so an empty list is not read as "no devices". */
  loading: boolean
  /** When this view last looked at the data (mount, or a return to the tab). */
  syncedAt: number
  /** Moves whenever the visible set moves; lets the UI mark the moment. */
  revision: string
  /** One clock per render, so rows in a list do not disagree with each other. */
  now: number
}

/**
 * Live device-session view for the signed-in actor.
 *
 * `staff` asks for every account's sessions, which the service answers only
 * when the actor holds the `security` permission; an ordinary reader always
 * gets their own rows and nothing more.
 */
export function useDeviceSessions(
  actor: Actor | null,
  options: { staff?: boolean } = {},
): DeviceSessionsView {
  const staff = options.staff === true
  const db = useStore()

  const [clock, setClock] = useState(0)
  const [syncedAt, setSyncedAt] = useState(() => Date.now())
  const [loading, setLoading] = useState(true)
  const lastLook = useRef(syncedAt)

  useEffect(() => {
    setLoading(false)
  }, [])

  useEffect(() => {
    const id = window.setInterval(() => setClock((n) => n + 1), CLOCK_TICK_MS)

    return () => window.clearInterval(id)
  }, [])

  useEffect(() => {
    const onReturn = () => {
      if (document.visibilityState !== "visible") return

      const at = Date.now()

      if (at - lastLook.current < RETURN_MIN_MS) return

      lastLook.current = at
      setSyncedAt(at)
      setClock((n) => n + 1)
    }

    window.addEventListener("focus", onReturn)
    document.addEventListener("visibilitychange", onReturn)

    return () => {
      window.removeEventListener("focus", onReturn)
      document.removeEventListener("visibilitychange", onReturn)
    }
  }, [])

  const policy = useMemo(
    () => resolveDrmPolicy(db.drm_policies, "WEB"),
    [db.drm_policies],
  )

  /* `db.device_sessions` is the change signal, not an input: the service reads
   * the document itself, and going through it keeps the authorization rule in
   * one place instead of in whichever page is displaying the list. */
  const rows = useMemo(() => {
    const result = staff
      ? listAllDeviceSessions(actor)
      : listDeviceSessions(actor)

    return result.ok ? [...result.data].sort(byActivity) : []
  }, [actor, staff, db.device_sessions])

  const sessions = useMemo(() => rows.filter(isSessionOpen), [rows])

  /* Clock-dependent on purpose. A row that idles past the timeout is edited by
   * nobody, so this memo is the only thing that notices - `clock` belongs in the
   * list even though the body never mentions it. */
  const used = useMemo(
    () => sessions.filter((s) => occupiesSlot(s, policy)).length,
    [sessions, policy, clock],
  )

  const revision = useMemo(
    () => sessions.map((s) => `${s.session_id}:${s.last_seen_at}`).join(","),
    [sessions],
  )

  const cap = policy.max_devices_per_user

  return {
    sessions,
    rows,
    policy,
    used,
    cap,
    full: used >= cap,
    loading,
    syncedAt,
    revision,
    now: Date.now(),
  }
}
