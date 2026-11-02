/* ─────────────────────────────────────────────────────────────
 * The one owner of "which devices are connected, right now".
 *
 * Two things make this list lie, and the hook answers both.
 *
 * Ageing. A session that idles past `session_timeout_minutes` is not edited
 * by anybody - expiry is derived from `last_seen_at` while rendering - so a
 * panel that only listens for writes keeps calling a dead device "עכשיו" and
 * keeps counting it against a slot nobody holds. A coarse clock re-derives
 * the view.
 *
 * Distance. With a server, the rows that matter live there: a phone claims a
 * slot in a database this browser has never seen. So the hook mirrors the
 * server's answer into the document, listens for changes on it, and
 * re-reads on a beat. The event is treated as a hint, never as data - only a
 * fresh RLS-scoped SELECT writes to the mirror, which is the same doctrine
 * the entitlement and support subscriptions follow.
 *
 * Nothing here writes on a timer. `mutate()` rewrites the whole document and
 * notifies every subscriber, so a scheduled write would turn a display
 * concern into storage churn for the entire app; the mirror already skips a
 * write when the rows have not moved.
 * ───────────────────────────────────────────────────────────── */

import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { useStore } from "../data/store"
import type { DeviceSession, DrmPolicy } from "../types"
import {
  isSessionOpen,
  listAllDeviceSessions,
  listDeviceSessions,
  occupiesSlot,
  resolveDrmPolicy,
  syncDeviceSessions,
} from "./api-security"
import type { Actor } from "../shared/result"

import { isSupabaseConfigured, requireSupabase } from "../integrations/supabase/supabase"
import { serverDevicesConfirmed } from "../integrations/supabase/supabase-devices"

/** Fine enough that relative time never lies, coarse enough to be invisible. */
const CLOCK_TICK_MS = 15_000

/**
 * Minimum gap between return-to-tab re-reads. Focus and visibility fire
 * constantly - fullscreen toggles, iframe interactions, the device-session
 * touches themselves - so an unthrottled handler would re-derive the list on
 * every flicker.
 */
const RETURN_MIN_MS = 60_000

/**
 * The backstop for the push. A row deleted under RLS arrives as a payload
 * that carries only the key, and a row that merely idled out sends no event
 * at all, so the subscription alone cannot be trusted to shrink the list.
 */
const REVALIDATE_MS = 30_000

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
  /** Only until the first read has settled, so an empty list is not read as
   *  "no devices" while the server is still being asked. */
  loading: boolean
  /** A server round-trip is in flight. */
  syncing: boolean
  /** Whether what is on screen came from the database or from this browser. */
  source: "server" | "local"
  /** When this view last looked at the data. */
  syncedAt: number
  /** Moves whenever the visible set moves; lets the UI mark the moment. */
  revision: string
  /** One clock per render, so rows in a list do not disagree with each other. */
  now: number
  /** Ask the server again now. Safe to call from a manual refresh control. */
  refresh: () => void
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
  const uid = actor?.user_id ?? null

  const [clock, setClock] = useState(0)
  const [syncedAt, setSyncedAt] = useState(() => Date.now())
  const [loading, setLoading] = useState(isSupabaseConfigured)
  const [syncing, setSyncing] = useState(false)
  const [server, setServer] = useState(() => serverDevicesConfirmed())
  const lastLook = useRef(syncedAt)

  /* Held in a ref so `refresh` keeps one identity. `actor` is rebuilt
   * whenever the users table hands back a fresh object, and a callback keyed
   * on it would re-subscribe the realtime channel on every store write. */
  const actorRef = useRef(actor)

  useEffect(() => {
    actorRef.current = actor
  }, [actor])

  const pull = useCallback(async () => {
    if (!isSupabaseConfigured || !actorRef.current) return

    setSyncing(true)

    await syncDeviceSessions(actorRef.current)

    setSyncing(false)
    setServer(serverDevicesConfirmed())
    setSyncedAt(Date.now())
    setLoading(false)
  }, [])

  /* Local mode has nothing to ask, so the first paint is the answer. */
  useEffect(() => {
    if (!isSupabaseConfigured) setLoading(false)
  }, [])

  useEffect(() => {
    void pull()
  }, [pull, uid])

  useEffect(() => {
    const id = window.setInterval(() => setClock((n) => n + 1), CLOCK_TICK_MS)

    return () => window.clearInterval(id)
  }, [])

  /* A hidden tab is not going to act on the answer, and a heartbeat that
   * fires in the background is traffic nobody reads. */
  useEffect(() => {
    if (!isSupabaseConfigured) return

    const id = window.setInterval(() => {
      if (document.visibilityState !== "visible") return

      void pull()
    }, REVALIDATE_MS)

    return () => window.clearInterval(id)
  }, [pull])

  useEffect(() => {
    const onReturn = () => {
      if (document.visibilityState !== "visible") return

      const at = Date.now()

      if (at - lastLook.current < RETURN_MIN_MS) return

      lastLook.current = at

      setClock((n) => n + 1)

      if (isSupabaseConfigured) void pull()
      else setSyncedAt(at)
    }

    window.addEventListener("focus", onReturn)
    document.addEventListener("visibilitychange", onReturn)

    return () => {
      window.removeEventListener("focus", onReturn)
      document.removeEventListener("visibilitychange", onReturn)
    }
  }, [pull])

  /* ── Push ───────────────────────────────────────────────
   *
   * A reader on a phone claims a slot in the database. Without this, the
   * laptop running the same account finds out on the next beat - up to half
   * a minute of "my other device does not exist".
   *
   * Staff subscribe unfiltered and let RLS decide what arrives, the way the
   * support queue does: a filtered staff channel would only ever show the
   * administrator their own devices. */
  useEffect(() => {
    if (!isSupabaseConfigured || !uid) return

    const client = requireSupabase()
    const scoped = client.channel(`device-sessions-${uid}`).on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "device_sessions",
        filter: `user_id=eq.${uid}`,
      },
      () => void pull(),
    )

    if (!staff) {
      scoped.subscribe()

      return () => {
        void client.removeChannel(scoped)
      }
    }

    const queue = client.channel(`device-sessions-staff-${uid}`).on(
      "postgres_changes",
      { event: "*", schema: "public", table: "device_sessions" },
      () => void pull(),
    )

    scoped.subscribe()
    queue.subscribe()

    return () => {
      void client.removeChannel(scoped)
      void client.removeChannel(queue)
    }
  }, [pull, staff, uid])

  const policy = useMemo(
    () => resolveDrmPolicy(db.drm_policies, "WEB"),
    [db.drm_policies],
  )

  /* `db.device_sessions` is the change signal, not an input: the service
   * reads the document itself, and going through it keeps the authorization
   * rule in one place instead of in whichever page is displaying the list. */
  const rows = useMemo(() => {
    const result = staff
      ? listAllDeviceSessions(actor)
      : listDeviceSessions(actor)

    return result.ok ? [...result.data].sort(byActivity) : []
  }, [actor, staff, db.device_sessions])

  const sessions = useMemo(() => rows.filter(isSessionOpen), [rows])

  /* Clock-dependent on purpose. A row that idles past the timeout is edited
   * by nobody, so this memo is the only thing that notices - `clock` belongs
   * in the list even though the body never mentions it. */
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
    syncing,
    source: server ? "server" : "local",
    syncedAt,
    revision,
    now: Date.now(),
    refresh: () => void pull(),
  }
}
