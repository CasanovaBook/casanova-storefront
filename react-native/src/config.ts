/* ─────────────────────────────────────────────────────────────
 * Runtime configuration for the native reader.
 *
 * The web storefront and this app read and write the SAME database.
 * Neither of them owns it: both are clients of one REST surface, and
 * that surface is described in `src/net/api.ts`. Pointing
 * `API_BASE_URL` at the deployed backend is the only wiring this file
 * needs before a real device can sign in.
 * ───────────────────────────────────────────────────────────── */

import { Platform } from "react-native"

import DeviceInfo from "react-native-device-info"

import AsyncStorage from "@react-native-async-storage/async-storage"

/**
 * Base URL of the shared backend.
 *
 * Overridable at runtime through `setApiBaseUrl()` so a QA build can be
 * pointed at staging without recompiling — the override lives in
 * AsyncStorage, which is wiped on logout and never holds credentials.
 */

export const DEFAULT_API_BASE_URL = "https://api.casanova.local"

const OVERRIDE_KEY = "casanova.api_base_url"

let resolvedBaseUrl: string | null = null

export async function loadApiBaseUrl(): Promise<string> {
  if (resolvedBaseUrl) return resolvedBaseUrl

  try {
    const stored = await AsyncStorage.getItem(OVERRIDE_KEY)

    resolvedBaseUrl =
      stored && /^https?:\/\//.test(stored)
        ? stored.replace(/\/+$/, "")
        : DEFAULT_API_BASE_URL
  } catch {
    /* AsyncStorage can throw on a corrupted store or during the first
     * run before the native module is ready. Falling back to the
     * compiled default keeps the app bootable rather than stranded on
     * an error screen the user cannot act on. */

    resolvedBaseUrl = DEFAULT_API_BASE_URL
  }

  return resolvedBaseUrl
}

export async function setApiBaseUrl(url: string): Promise<string> {
  const trimmed = url.trim().replace(/\/+$/, "")

  if (!/^https?:\/\/.+/.test(trimmed)) {
    throw new Error("כתובת השרת חייבת להתחיל ב־http:// או https://")
  }

  await AsyncStorage.setItem(OVERRIDE_KEY, trimmed)

  resolvedBaseUrl = trimmed

  return trimmed
}

export function apiBaseUrl(): string {
  return resolvedBaseUrl ?? DEFAULT_API_BASE_URL
}

/* ── Client identity ────────────────────────────────────── */

/**
 * What this build reports itself as. The value is written onto every
 * `sessions` row (`client`) and every `device_sessions` row
 * (`app_version`, `os_version`, `device_model`), which is what lets the
 * CMS security screen tell a stale Android build from a current iOS one
 * without parsing a free-text device name.
 */

export const CLIENT: "ANDROID" | "IOS" =
  Platform.OS === "ios" ? "IOS" : "ANDROID"

/** Semver of this build. Compared against `platform_settings.mobile_min_build`. */

export const APP_VERSION = DeviceInfo.getVersion()

/**
 * Integer build number. This is the value `mobile_min_build` gates on,
 * because a semver string cannot be compared safely in SQL — a
 * forced-update check has to be `build_number >= mobile_min_build`.
 */

export const BUILD_NUMBER = Number(DeviceInfo.getBuildNumber()) || 0

/** Device platform as the DRM policy scope understands it. */

export const DEVICE_PLATFORM: "ANDROID" | "IOS" = CLIENT

/* ── Timing ─────────────────────────────────────────────── */

/** Hard ceiling on any single request. A reader must fail fast rather
 *  than spin while a policy decision is pending. */

export const REQUEST_TIMEOUT_MS = 15_000

/** How often the reader tells the server it is still alive. Must stay
 *  comfortably under the smallest `session_timeout_minutes` the CMS can
 *  configure, or a legitimate reader gets swept as abandoned. */

export const SESSION_HEARTBEAT_MS = 60_000

/** User activity newer than this counts as "the reader is in use" and
 *  is what the heartbeat checks before extending the session. */

export const ACTIVITY_WINDOW_MS = 120_000

/**
 * Re-check the grant and the session this often while a file is open.
 * A grant is minted for 30 minutes at most; this is the interval at
 * which the reader notices an administrator revoked it.
 */

export const GRANT_REVALIDATION_MS = 60_000
