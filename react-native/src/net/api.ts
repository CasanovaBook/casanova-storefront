/* ─────────────────────────────────────────────────────────────
 * The shared API surface.
 *
 * ONE DATABASE, TWO CLIENTS. The web storefront in `../src` and this
 * app are both consumers of the same PostgreSQL schema (`schema.sql`).
 * Neither has its own copy of anything, and neither writes through a
 * private channel: every function below names the endpoint it calls,
 * the web service function that already implements the same operation
 * against the same tables, and the table or view the server reads.
 *
 *   phone                          web service                    SQL
 *   ─────────────────────────────  ─────────────────────────────  ────────────────────────────
 *   fetchPublicSettings()          getSettings()                  platform_settings
 *   login()                        login()                        users, sessions
 *   fetchCatalog()                 listPublicProducts()           v_storefront_catalog
 *   fetchLibrary()                 listUserProducts()             v_entitled_content
 *   registerDevice()               registerDeviceSession()        device_sessions, drm_policies
 *   heartbeatDevice()              refreshDeviceSession()         device_sessions
 *   revokeDevice()                 revokeDeviceSession()          device_sessions (+ grant cascade)
 *   issueGrant()                   issueContentGrant()            content_access_grants
 *   redeemGrant()                  consumeContentGrant()          consume_content_grant()
 *   reportSecurityEvent()          recordEvent()                  security_events
 *   saveProgress()                 saveReadingProgress()          reading_progress
 *   submitInquiry()                submitPublicInquiry()          inquiries (source MOBILE_APP)
 *
 * The security-relevant property of this mapping is that it is the same
 * code path on both sides. A revocation performed in the CMS cascades
 * through `trg_user_product_revokes_grants` and
 * `trg_device_session_revokes_grants`, so a URL already sitting in a
 * phone's memory dies at the same moment it dies in a browser tab.
 * ───────────────────────────────────────────────────────────── */

import { BUILD_NUMBER, CLIENT } from "../config"

import { del, deviceId, get, post, put } from "./client"

import type {
  ApiResult,
  CatalogProduct,
  DeviceIntegrity,
  DeviceSession,
  DrmPolicy,
  IssuedGrant,
  Order,
  PublicSettings,
  PublicUser,
  ReadingProgress,
  RedeemedGrant,
  SecurityEventType,
  UserProduct,
} from "./types"

import { fullName } from "./types"

/* ── Settings and the mobile kill switch ──────────────── */

export interface BootCheck {
  settings: PublicSettings

  /** Set when this build must not be allowed to proceed. */

  blockReason: string | null
}

/**
 * First call of every cold start.
 *
 * `platform_settings.mobile_app_enabled` is the kill switch and
 * `mobile_min_build` is the forced-upgrade floor. Both are checked here
 * rather than left to the server alone, because a server refusal still
 * has to be *explained* to the user, and "the app is disabled" reads
 * very differently from "you need to update".
 */

export async function bootCheck(): Promise<BootCheck> {
  const result = await get<PublicSettings>("/settings/public", {
    anonymous: true,
  })

  if (!result.ok) {
    /* Failing open here would let a network outage become a way to run
     * a build that was pulled for a security reason. Fail closed with
     * a neutral message: the user retries, the server decides. */

    return {
      settings: {
        brand_name: "קזנובה",

        default_currency: "ILS",

        mobile_app_enabled: false,

        mobile_min_build: 0,
      },

      blockReason:
        "לא ניתן לאמת את תקינות האפליקציה מול השרת. נסו שוב בעוד כמה דקות.",
    }
  }

  const settings = result.data

  if (!settings.mobile_app_enabled) {
    return {
      settings,
      blockReason:
        "האפליקציה אינה זמינה כרגע. הספרים שלכם זמינים לקריאה דרך האתר.",
    }
  }

  if (
    settings.mobile_min_build > 0 &&
    BUILD_NUMBER < settings.mobile_min_build
  ) {
    return {
      settings,

      blockReason: `גרסה ${BUILD_NUMBER} של האפליקציה אינה נתמכת יותר. עדכנו לגרסה החדשה כדי להמשיך לקרוא.`,
    }
  }

  return { settings, blockReason: null }
}

/* ── Auth ─────────────────────────────────────────────── */

export interface LoginResponse {
  token: string

  user: PublicUser

  /** The policy that applies to this device, resolved server-side by scope. */

  policy: DrmPolicy
}

/**
 * Writes a `sessions` row with `client = 'ANDROID' | 'IOS'`, which is
 * what lets the CMS see mobile sign-ins as a separate population from
 * browser ones.
 */

export async function login(
  email: string,
  password: string,
): Promise<ApiResult<LoginResponse>> {
  return post<LoginResponse>(
    "/auth/login",

    {
      email: email.trim().toLowerCase(),

      password,

      client: CLIENT,

      app_version: BUILD_NUMBER,

      device_id: await deviceId(),
    },

    { anonymous: true },
  )
}

/** Ends the `sessions` row. Does not touch device_sessions — a logout
 *  is not a device revocation, and the next login should reuse the slot
 *  rather than consume a new one. */

export const logout = () => post<undefined>("/auth/logout")

export const fetchMe = () => get<PublicUser>("/auth/me")

export const requestPasswordReset = (email: string) =>
  post<{ sent: boolean }>(
    "/auth/password-reset",
    { email: email.trim().toLowerCase() },
    { anonymous: true },
  )

/* ── Catalogue and library ────────────────────────────── */

/**
 * Public catalogue. The server answers from `v_storefront_catalog`,
 * which contains no `content_url` and no `public_url` — see the comment
 * on `CatalogProduct` for why that is load-bearing.
 */

export const fetchCatalog = () =>
  get<CatalogProduct[]>("/catalog", { anonymous: true })

/** Everything this account may open right now, from `v_entitled_content`. */

export const fetchLibrary = () => get<UserProduct[]>("/me/library")

export const fetchOrders = () => get<Order[]>("/me/orders")

export const fetchProgress = (productId: string) =>
  get<ReadingProgress | null>(`/me/progress/${encodeURIComponent(productId)}`)

export const saveProgress = (input: {
  product_id: string
  current_page: number
  total_pages: number
}) => put<ReadingProgress>("/me/progress", input)

/* ── Device sessions ──────────────────────────────────── */

export interface RegisterDeviceInput {
  device_name: string

  device_model: string

  os_version: string

  app_version: string

  /** The client's own integrity verdict. See `drm/ScreenShield.tsx`. */

  device_integrity: DeviceIntegrity

  /** False if the native shield failed to install. The server records
   *  it either way; a false here is what makes the CMS show the row as
   *  unprotected instead of silently trusting it. */

  secure_flag_active: boolean
}

export interface RegisterDeviceResponse {
  session: DeviceSession

  policy: DrmPolicy
}

/**
 * Claims a device slot. The server enforces
 * `drm_policies.max_devices_per_user` and answers `DEVICE_LIMIT_EXCEEDED`
 * when the cap is hit, exactly as `registerDeviceSession()` does for the
 * web reader.
 */

export async function registerDevice(
  input: RegisterDeviceInput,
): Promise<ApiResult<RegisterDeviceResponse>> {
  return post<RegisterDeviceResponse>("/me/devices", {
    ...input,
    platform: CLIENT,
    device_id: await deviceId(),
  })
}

/** Extends `last_seen_at`. Also the moment the server notices a revoked
 *  session and answers `SESSION_REVOKED`. */

export const heartbeatDevice = (sessionId: string) =>
  post<DeviceSession>(`/me/devices/${encodeURIComponent(sessionId)}/heartbeat`)

export const listDevices = () => get<DeviceSession[]>("/me/devices")

/** The customer's own "הסר מכשיר" button. Cascades to content grants server-side. */

export const revokeDevice = (sessionId: string, reason: string) =>
  del<undefined>(
    `/me/devices/${encodeURIComponent(sessionId)}?reason=${encodeURIComponent(reason)}`,
  )

/* ── Content grants ───────────────────────────────────── */

/**
 * Step 1 of 2: ask for permission to fetch a file.
 *
 * Returns a token, never an address. The server re-checks the
 * entitlement, the device session, and `block_rooted_devices` before it
 * mints — so a rooted phone that lied in `registerDevice()` can still be
 * stopped here, by a second opinion the client did not write.
 */

export const issueGrant = (input: {
  product_id: string
  session_id: string
  scope: "STREAM" | "OFFLINE_CACHE"
}) => post<IssuedGrant>("/content/grants", input)

/**
 * Step 2 of 2: spend the token and get the address.
 *
 * Server-side this is `consume_content_grant()`, which takes a row lock
 * and re-validates expiry, use budget, revocation and entitlement inside
 * the same transaction. The phone cannot redeem a token twice, cannot
 * redeem a token for a different product, and cannot redeem one after
 * the entitlement behind it was revoked — regardless of what the client
 * believes.
 */

export const redeemGrant = (token: string, productId: string) =>
  post<RedeemedGrant>("/content/grants/redeem", {
    token,
    product_id: productId,
  })

/* ── Security telemetry ───────────────────────────────── */

export interface SecurityEventInput {
  event_type: SecurityEventType

  session_id?: string

  product_id?: string

  metadata?: Record<string, string | number | boolean>
}

/**
 * Fire and forget.
 *
 * The result is deliberately discarded by callers: a phone that cannot
 * reach the server must still hide its content. Reporting is evidence,
 * not a precondition for protection, and awaiting it would make the
 * shield depend on the network being up at the moment someone tries to
 * photograph it.
 */

export function reportSecurityEvent(input: SecurityEventInput): void {
  void post<undefined>("/security/events", {
    ...input,
    platform: CLIENT,
  }).catch(() => undefined)
}

/* ── Support ──────────────────────────────────────────── */

export interface InquiryInput {
  subject: string

  message: string

  topic: "GENERAL" | "ORDER" | "REFUND" | "ACCESS" | "BILLING" | "TECHNICAL"

  related_order_id?: string

  customer_phone?: string
}

/**
 * `source` is fixed to `MOBILE_APP` by the server from the client
 * header rather than being sent by the app: a value the client chooses
 * is a value the client can forge, and the CMS filters on it.
 */

export const submitInquiry = (input: InquiryInput) =>
  post<{ inquiry_id: string, reference: string }>("/support/inquiries", input)

/* ── Display helpers shared by the screens ────────────── */

export function displayName(user: PublicUser | null): string {
  return user ? fullName(user) : ""
}

/**
 * Renders the watermark exactly as the web reader does.
 *
 * In practice the grant's frozen `watermark_text` is preferred over this
 * — see `ReaderScreen` — because a stamp computed on the client can be
 * recomputed with different inputs by anyone who can patch the bundle.
 */

export function renderWatermark(template: string, user: PublicUser): string {
  return template

    .replace(/\{name\}/g, fullName(user))

    .replace(/\{email\}/g, user.email)

    .replace(/\{date\}/g, new Date().toLocaleDateString("he-IL"))
}
