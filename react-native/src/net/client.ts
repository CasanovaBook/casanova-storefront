/* ─────────────────────────────────────────────────────────────
 * HTTP transport.
 *
 * Three rules this module exists to enforce:
 *
 *  1. The session token lives in the platform keychain, never in
 *     AsyncStorage. AsyncStorage is a plaintext XML/plist file that
 *     `adb backup`, an iOS unencrypted backup, or any debugging tool
 *     can read. A stolen token is a stolen library.
 *
 *  2. The token is stored `THIS_DEVICE_ONLY`. Restoring a backup onto
 *     a second phone must not hand that phone a signed-in session —
 *     the device cap in `drm_policies.max_devices_per_user` is
 *     meaningless if a backup can clone a slot.
 *
 *  3. Every request carries the client identity headers, so the server
 *     can apply `mobile_app_enabled` and `mobile_min_build` and refuse
 *     a build that predates a security fix. A kill switch that only
 *     works for clients that volunteer their version is not a kill
 *     switch.
 * ───────────────────────────────────────────────────────────── */

import * as Keychain from "react-native-keychain"

import DeviceInfo from "react-native-device-info"

import {
  APP_VERSION,
  BUILD_NUMBER,
  CLIENT,
  REQUEST_TIMEOUT_MS,
  apiBaseUrl,
} from "../config"

import type { ApiErrorCode, ApiResult } from "./types"

const TOKEN_SERVICE = "com.casanova.reader.session"

/* ── Session token ──────────────────────────────────────── */

let cachedToken: string | null = null

let cachedUserId: string | null = null

export async function readStoredSession(): Promise<{
  token: string
  userId: string
} | null> {
  if (cachedToken && cachedUserId)
    return { token: cachedToken, userId: cachedUserId }

  try {
    const credential = await Keychain.getGenericPassword({
      service: TOKEN_SERVICE,
    })

    if (!credential) return null

    /* The username slot carries the user id so a cold start can render
     * "signed in as" before the first network round trip. */

    const token = credential.password

    const userId = credential.username

    cachedToken = token

    cachedUserId = userId

    return { token, userId }
  } catch {
    /* A keychain read fails on a device whose secure enclave is
     * unavailable or after an OS restore. Treat it as signed out
     * rather than crashing the boot sequence. */

    return null
  }
}

export async function storeSession(
  token: string,
  userId: string,
): Promise<void> {
  await Keychain.setGenericPassword(userId, token, {
    service: TOKEN_SERVICE,

    accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  })

  cachedToken = token

  cachedUserId = userId
}

export async function clearSession(): Promise<void> {
  cachedToken = null

  cachedUserId = null

  try {
    await Keychain.resetGenericPassword({ service: TOKEN_SERVICE })
  } catch {
    /* Nothing was stored, or the keychain is unavailable. Either way
     * the in-memory copy above is already gone, which is what matters. */
  }
}

export function currentUserId(): string | null {
  return cachedUserId
}

/* ── Device identity ────────────────────────────────────── */

let cachedDeviceId: string | null = null

/**
 * Stable per-install identifier.
 *
 * `getUniqueId()` is not a hardware serial and is not a security
 * boundary — it is the value the server hashes into
 * `device_sessions.device_fingerprint` so one phone reappears as one
 * row instead of a new device on every launch. Spoofing it buys an
 * attacker a fresh device slot, which `max_devices_per_user` is there
 * to make expensive, not impossible.
 */

export async function deviceId(): Promise<string> {
  if (cachedDeviceId) return cachedDeviceId

  let id: string

  try {
    id = await DeviceInfo.getUniqueId()
  } catch {
    /* Falls back to a bundle id, which is the same on every install of
     * the app and therefore still stable enough to cap devices. */

    id = DeviceInfo.getBundleId()
  }

  cachedDeviceId = id

  return id
}

async function identityHeaders(): Promise<Record<string, string>> {
  const id = await deviceId()

  return {
    "X-Casanova-Client": CLIENT,

    "X-Casanova-App-Version": APP_VERSION,

    "X-Casanova-Build": String(BUILD_NUMBER),

    "X-Casanova-Device-Id": id,

    "X-Casanova-Device-Model": DeviceInfo.getModel(),

    "X-Casanova-OS-Version": DeviceInfo.getSystemVersion(),
  }
}

/* ── Request ────────────────────────────────────────────── */

function failure<T>(code: ApiErrorCode, error: string): ApiResult<T> {
  return { ok: false, code, error }
}

export interface RequestOptions {
  /** Skip the Authorization header. Used by login and the public catalogue. */

  anonymous?: boolean

  /** Override the transport timeout for a slow endpoint. */

  timeoutMs?: number
}

/**
 * Performs one request and normalises every way it can fail into the
 * same `ApiResult` envelope the web service layer returns, so screens
 * never have to distinguish "the server said no" from "there was no
 * server" at the call site.
 */

export async function request<T>(
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",

  path: string,

  body?: unknown,

  options: RequestOptions = {},
): Promise<ApiResult<T>> {
  const controller = new AbortController()

  const timer = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? REQUEST_TIMEOUT_MS,
  )

  try {
    const headers: Record<string, string> = {
      Accept: "application/json",

      ...(await identityHeaders()),
    }

    if (body !== undefined) headers["Content-Type"] = "application/json"

    if (!options.anonymous) {
      const token = cachedToken ?? (await readStoredSession())?.token

      if (token) headers.Authorization = `Bearer ${token}`
    }

    const response = await fetch(`${apiBaseUrl()}${path}`, {
      method,

      headers,

      body: body === undefined ? undefined : JSON.stringify(body),

      signal: controller.signal,
    })

    /* A 204 with no body is a legitimate success for the DELETE and
     * heartbeat endpoints; parsing it as JSON would throw. */

    if (response.status === 204) return { ok: true, data: undefined as T }

    const payload = (await response
      .json()
      .catch(() => null)) as ApiResult<T> | null

    if (!response.ok) {
      /* The server's own Hebrew message wins: it was written for the
       * CMS and reads correctly here too. */

      if (payload && payload.ok === false) {
        if (payload.code === "UNAUTHENTICATED") await clearSession()

        return payload
      }

      if (response.status === 401) {
        await clearSession()

        return failure<T>(
          "UNAUTHENTICATED",
          "יש להתחבר מחדש — פג תוקף ההתחברות.",
        )
      }

      if (response.status === 403)
        return failure<T>("FORBIDDEN", "אין הרשאה לבצע פעולה זו.")

      if (response.status === 404)
        return failure<T>("NOT_FOUND", "המשאב לא נמצא.")

      return failure<T>("STORAGE", `השרת החזיר שגיאה (${response.status}).`)
    }

    if (!payload) return failure<T>("STORAGE", "תגובת השרת אינה תקינה.")

    return payload
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return failure<T>(
        "TIMEOUT",
        "הבקשה ארכה זמן רב מדי. בדקו את החיבור לרשת ונסו שוב.",
      )
    }

    return failure<T>(
      "NETWORK",
      "אין חיבור לשרת. התוכן זמין רק כשיש חיבור מאומת.",
    )
  } finally {
    clearTimeout(timer)
  }
}

export const get = <T>(path: string, options?: RequestOptions) =>
  request<T>("GET", path, undefined, options)

export const post = <T,>(
  path: string,
  body?: unknown,
  options?: RequestOptions,
) => request<T>("POST", path, body, options)

export const put = <T,>(
  path: string,
  body?: unknown,
  options?: RequestOptions,
) => request<T>("PUT", path, body, options)

export const del = <T>(path: string, options?: RequestOptions) =>
  request<T>("DELETE", path, undefined, options)
