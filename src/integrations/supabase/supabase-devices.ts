/* ─────────────────────────────────────────────────────────────
 * Device sessions against Supabase.
 *
 * The browser used to be the only place a device slot existed, which made
 * the cap a per-installation suggestion: a phone and a laptop each counted
 * their own rows and neither could see the other. Migration 0035 moves the
 * decision server-side, and this module is the whole client half of it.
 *
 * Two rules shape everything below.
 *
 * 1. Reads return `null` on failure and `[]` when the answer is genuinely
 *    "nothing". A dropped request must never be mirrored as an empty table,
 *    because that would make this browser conclude the reader owns no
 *    devices and clear a list that is in fact fine.
 *
 * 2. Writes go to RPCs, never to the table. There is no INSERT, UPDATE or
 *    DELETE policy for a browser role on purpose: `user_id` and `revoked_by`
 *    are stamped from the JWT inside the function, so a crafted call cannot
 *    claim a slot on someone else's account or lift a block.
 * ───────────────────────────────────────────────────────────── */

import type {
  DeviceIntegrity,
  DevicePlatform,
  DeviceSession,
} from "../../types"
import { isSupabaseConfigured, requireSupabase } from "./supabase"
import { isUuid } from "./supabase-entitlements"

const SESSION_COLUMNS =
  "session_id, user_id, device_fingerprint, platform, device_name, device_model, os_version, app_version, device_integrity, secure_flag_active, started_at, last_seen_at, ended_at, revoked, revoked_at, revoked_by, revoke_reason"

/** Why a write did not happen, in terms the service layer can turn into
 *  the reader-facing Hebrew it already uses. */
export type DeviceWriteFailure =
  /* The RPC is not in the database yet - migration 0035 has not been
   * applied. The caller must fall back to the local document rather than
   * fail the reader's action. */
  | "unavailable"
  | "device_limit_exceeded"
  | "device_previously_terminated"
  | "session_revoked"
  | "session_ended"
  | "session_not_open"
  | "session_not_found"
  | "session_not_revocable"
  | "unauthenticated"
  | "permission_denied"
  | "error"

export type DeviceWrite<T> =
  | { ok: true; data: T; server: true }
  | { ok: false; code: DeviceWriteFailure; message: string }

/** The `public.device_sessions` row as it arrives over the wire. */
interface SessionRow {
  session_id: string
  user_id: string
  device_fingerprint: string
  platform?: string | null
  device_name?: string | null
  device_model?: string | null
  os_version?: string | null
  app_version?: string | null
  device_integrity?: string | null
  secure_flag_active?: boolean | null
  started_at: string
  last_seen_at: string
  ended_at?: string | null
  revoked?: boolean | null
  revoked_at?: string | null
  revoked_by?: string | null
  revoke_reason?: string | null
}

const PLATFORMS: DevicePlatform[] = ["WEB", "ANDROID", "IOS"]

const INTEGRITIES: DeviceIntegrity[] = [
  "UNKNOWN",
  "TRUSTED",
  "ROOTED",
  "JAILBROKEN",
  "ATTESTATION_FAILED",
  "EMULATOR",
]

/**
 * Maps a wire row onto the app's `DeviceSession`.
 *
 * Defensive on purpose: the columns are constrained, but a row written by an
 * older build or by the native client can carry a value this enum does not
 * know. Falling back to the least-privileged reading (WEB, UNKNOWN, revoked
 * untouched) keeps the list honest instead of inventing a verdict.
 */
function toDeviceSession(row: SessionRow): DeviceSession {
  return {
    session_id: row.session_id,
    user_id: row.user_id,
    device_fingerprint: row.device_fingerprint,
    platform: PLATFORMS.includes(row.platform as DevicePlatform)
      ? (row.platform as DevicePlatform)
      : "WEB",
    device_name: row.device_name ?? "",
    device_model: row.device_model ?? undefined,
    os_version: row.os_version ?? undefined,
    app_version: row.app_version ?? undefined,
    device_integrity: INTEGRITIES.includes(
      row.device_integrity as DeviceIntegrity,
    )
      ? (row.device_integrity as DeviceIntegrity)
      : "UNKNOWN",
    secure_flag_active: row.secure_flag_active ?? true,
    started_at: row.started_at,
    last_seen_at: row.last_seen_at,
    ended_at: row.ended_at ?? undefined,
    revoked: row.revoked ?? false,
    revoked_at: row.revoked_at ?? undefined,
    revoked_by: row.revoked_by ?? undefined,
    revoke_reason: row.revoke_reason ?? undefined,
  }
}

/**
 * Flips false the first time a call proves the server has no device RPCs.
 *
 * Module state rather than a per-call check because the answer cannot change
 * within a page life, and because a reader on an un-migrated project should
 * pay for that discovery once, not on every heartbeat. A reload re-probes,
 * which is the recovery path after the migration is applied.
 */
let serverDevices: boolean | null = null

/** True only when a server call has actually succeeded. */
export function serverDevicesConfirmed(): boolean {
  return serverDevices === true
}

/** Postgres raises these names inside the RPCs; PostgREST hands the message
 *  back verbatim, so the name is the contract between the two halves. */
function classify(err: { code?: string; message?: string }): DeviceWriteFailure {
  const message = err.message ?? ""

  /* PGRST202: the function is not in the schema. Almost always "the
   * migration has not been run on this project yet". */
  if (err.code === "PGRST202" || /Could not find the function/.test(message))
    return "unavailable"

  const names: DeviceWriteFailure[] = [
    "device_limit_exceeded",
    "device_previously_terminated",
    "session_revoked",
    "session_ended",
    "session_not_open",
    "session_not_found",
    "session_not_revocable",
    "unauthenticated",
  ]

  for (const name of names) {
    if (message.includes(name)) return name
  }

  /* admin_require_permission raises 'permission_denied: <name>' with 42501. */
  if (err.code === "42501" || message.includes("permission_denied"))
    return "permission_denied"

  if (message.includes("row-level security")) return "permission_denied"

  return "error"
}

function noteProbe(code: DeviceWriteFailure): void {
  if (code === "unavailable") serverDevices = false
  else serverDevices = true
}

async function call<T>(
  fn: string,
  args: Record<string, unknown>,
): Promise<DeviceWrite<T>> {
  if (!isSupabaseConfigured || serverDevices === false)
    return { ok: false, code: "unavailable", message: "no server" }

  try {
    const { data, error } = await requireSupabase().rpc(fn, args)

    if (error) {
      const code = classify(error)

      noteProbe(code)

      return { ok: false, code, message: error.message ?? fn }
    }

    serverDevices = true

    return { ok: true, data: data as T, server: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const code = classify({ message })

    noteProbe(code)

    return { ok: false, code, message }
  }
}

/* ── Reads ─────────────────────────────────────────────── */

/**
 * This account's device rows, newest first.
 *
 * `null` means "no answer", which the caller must not treat as "no devices".
 */
export async function fetchMyDeviceSessions(
  userId: string,
): Promise<DeviceSession[] | null> {
  if (!isSupabaseConfigured || serverDevices === false) return null

  try {
    const { data, error } = await requireSupabase()
      .from("device_sessions")
      .select(SESSION_COLUMNS)
      .eq("user_id", userId)
      .order("last_seen_at", { ascending: false })

    if (error) {
      // A 42501 here means RLS is on but the SELECT policy is missing, which
      // is a migration problem rather than a network one - say so distinctly.
      console.warn("[devices] own sessions refused:", error.message)
      return null
    }

    serverDevices = true

    return ((data ?? []) as SessionRow[]).map(toDeviceSession)
  } catch (err) {
    console.warn("[devices] own sessions failed:", err)
    return null
  }
}

/**
 * Staff view: every account's devices.
 *
 * Refused for anyone without the `security` permission, which RLS answers as
 * an empty set rather than an error - so an empty array here can legitimately
 * mean "not permitted", and the caller keeps its own rows.
 */
export async function fetchAllDeviceSessions(): Promise<DeviceSession[] | null> {
  if (!isSupabaseConfigured || serverDevices === false) return null

  try {
    const { data, error } = await requireSupabase()
      .from("device_sessions")
      .select(SESSION_COLUMNS)
      .order("last_seen_at", { ascending: false })

    if (error) {
      console.warn("[devices] staff session read refused:", error.message)
      return null
    }

    serverDevices = true

    return ((data ?? []) as SessionRow[]).map(toDeviceSession)
  } catch (err) {
    console.warn("[devices] staff session read failed:", err)
    return null
  }
}

/* ── Writes ────────────────────────────────────────────── */

export interface ClaimInput {
  deviceFingerprint: string
  platform: DevicePlatform
  deviceName: string
  deviceModel?: string
  osVersion?: string
  appVersion?: string
  /**
   * Deliberate re-entry for a fingerprint that was released or blocked.
   *
   * False is what an automatic call sends, and the server refuses it for a
   * terminated device - which is the whole point: a page load is not consent.
   */
  confirmReactivate?: boolean
}

/**
 * Claims a slot for the signed-in reader.
 *
 * The server resolves the policy, closes rows whose device has stopped
 * reporting, and only then counts - so the refusal is about devices that are
 * actually reading, not about browsers that were simply closed.
 */
export async function claimDeviceSession(
  input: ClaimInput,
): Promise<DeviceWrite<DeviceSession>> {
  const result = await call<SessionRow>("claim_my_device_session", {
    p_device_fingerprint: input.deviceFingerprint,
    p_platform: input.platform,
    p_device_name: input.deviceName,
    p_device_model: input.deviceModel ?? null,
    p_os_version: input.osVersion ?? null,
    p_app_version: input.appVersion ?? null,
    p_confirm_reactivate: input.confirmReactivate === true,
  })

  return result.ok
    ? { ok: true, data: toDeviceSession(result.data), server: true }
    : result
}

/** Advances `last_seen_at`. The only write the heartbeat is allowed. */
export async function touchDeviceSession(
  sessionId: string,
): Promise<DeviceWrite<DeviceSession>> {
  if (!isUuid(sessionId))
    return {
      ok: false,
      code: "session_not_found",
      message: "local session id",
    }

  const result = await call<SessionRow>("touch_my_device_session", {
    p_session_id: sessionId,
  })

  return result.ok
    ? { ok: true, data: toDeviceSession(result.data), server: true }
    : result
}

/** Frees the reader's own slot. */
export async function endDeviceSessionRemote(
  sessionId: string,
): Promise<DeviceWrite<DeviceSession>> {
  if (!isUuid(sessionId))
    return {
      ok: false,
      code: "session_not_open",
      message: "local session id",
    }

  const result = await call<SessionRow>("end_my_device_session", {
    p_session_id: sessionId,
  })

  return result.ok
    ? { ok: true, data: toDeviceSession(result.data), server: true }
    : result
}

/** Staff block. Requires `manage_drm`; cascades the reader's open copies. */
export async function adminRevokeDeviceSession(
  sessionId: string,
  reason: string | undefined,
): Promise<DeviceWrite<DeviceSession>> {
  if (!isUuid(sessionId))
    return {
      ok: false,
      code: "session_not_revocable",
      message: "local session id",
    }

  const result = await call<SessionRow>("admin_revoke_device_session", {
    p_session_id: sessionId,
    p_reason: reason ?? null,
  })

  return result.ok
    ? { ok: true, data: toDeviceSession(result.data), server: true }
    : result
}
