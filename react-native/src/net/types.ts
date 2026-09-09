/* ─────────────────────────────────────────────────────────────
 * Wire types for the shared backend.
 *
 * These mirror `src/types/index.ts` in the web project one-for-one for
 * every field the phone actually reads. They are redeclared rather than
 * imported across the project boundary on purpose: the web app is a
 * Vite build and this is a Metro build, and a shared import would mean
 * one bundler resolving files out of the other's tree. Keeping the two
 * in sync is a review checklist item, and the SQL schema in
 * `schema.sql` is the arbiter when they disagree.
 *
 * One deliberate omission runs through the whole file: no type here has
 * a permanent `content_url`. The address of a protected file is only
 * ever reachable through `RedeemedGrant`, which expires.
 * ───────────────────────────────────────────────────────────── */

export type Role = "CUSTOMER" | "ADMIN" | "MODERATOR"

export type AccountStatus = "ACTIVE" | "SUSPENDED" | "DEACTIVATED"

export type AccessStatus = "ACTIVE" | "EXPIRED" | "REVOKED" | "SUSPENDED"

export type ProductType = "EBOOK" | "SUBSCRIPTION" | "DIGITAL_PRODUCT" | "PHYSICAL_PRODUCT" | "BUNDLE" | "COURSE" | "PREMIUM_ACCESS"

export type DevicePlatform = "WEB" | "ANDROID" | "IOS"

export type DrmScope = "WEB" | "MOBILE" | "ALL"

export type ContentGrantScope = "STREAM" | "OFFLINE_CACHE"

export type DeviceIntegrity = "UNKNOWN" | "TRUSTED" | "ROOTED" | "JAILBROKEN" | "ATTESTATION_FAILED" | "EMULATOR"

export type SecurityEventType = "SCREENSHOT_BLOCKED" | "RECORDING_DETECTED" | "COPY_BLOCKED" | "PRINT_BLOCKED" | "CONTEXT_MENU_BLOCKED" | "SOURCE_VIEW_BLOCKED" | "VISIBILITY_HIDDEN" | "SESSION_REVOKED" | "DEVICE_LIMIT_EXCEEDED" | "DOWNLOAD_BLOCKED" | "SHARE_BLOCKED" | "MIRROR_DETECTED" | "DEVICE_COMPROMISED" | "GRANT_REPLAY_BLOCKED" | "OFFLINE_EXPIRED"

/* ── People ───────────────────────────────────────────── */

/** A user with no credential fields. The backend never returns any. */

export interface PublicUser {
  user_id: string

  first_name: string

  last_name: string

  email: string

  phone?: string

  role: Role

  account_status: AccountStatus

  created_at: string

  last_login_at?: string
}

export function fullName(user: PublicUser): string {
  return `${user.first_name} ${user.last_name}`.trim()
}

/* ── Catalogue ────────────────────────────────────────── */

export interface BookMetadata {
  author_name?: string

  subtitle?: string

  isbn?: string

  publisher?: string

  language?: string

  total_pages?: number
}

/**
 * A catalogue row as `v_storefront_catalog` returns it.
 *
 * The view deliberately does not select `products.content_url` or
 * `content_assets.public_url`, so neither field exists on this type.
 * That is not an oversight to be "fixed" by widening the interface: an
 * anonymous or merely-signed-in reader must not be able to name the
 * file, because a URL that can be named can be shared, and a shared
 * permanent URL outlives every revocation the CMS can perform.
 */

export interface CatalogProduct {
  product_id: string

  name: string

  slug: string

  subtitle?: string

  description: string

  short_description: string

  product_type: ProductType

  price: number

  sale_price?: number

  currency: string

  image_url?: string

  images?: string[]

  cover_colors?: [string, string]

  rating?: number

  reviews_count?: number

  book?: BookMetadata

  created_at: string
}

export function effectivePrice(product: CatalogProduct): number {
  return typeof product.sale_price === "number" &&
    product.sale_price < product.price
    ? product.sale_price
    : product.price
}

/* ── Entitlements ─────────────────────────────────────── */

/** Purchase-time display snapshot; survives the product being edited or deleted. */

export interface ProductSnapshot {
  product_id: string

  name: string

  slug: string

  product_type: ProductType

  cover_colors?: [string, string]

  image_url?: string

  author_name?: string

  total_pages?: number
}

export interface UserProduct {
  user_product_id: string

  user_id: string

  product_id: string

  product_snapshot: ProductSnapshot

  source_order_id?: string

  access_status: AccessStatus

  granted_at: string

  expires_at?: string
}

/** True only for a row the reader may actually open right now. */

export function isEntitlementLive(up: UserProduct, now = Date.now()): boolean {
  if (up.access_status !== "ACTIVE") return false

  if (up.expires_at && new Date(up.expires_at).getTime() <= now) return false

  return true
}

export interface ReadingProgress {
  product_id: string

  current_page: number

  total_pages: number

  progress_percent: number

  last_read_at: string
}

/* ── Protection policy ────────────────────────────────── */

/**
 * The subset of `drm_policies` the phone acts on. The CMS owns the row;
 * the client only reads it, and reads it fresh at every session start so
 * an administrator tightening the policy does not have to wait for an
 * app-store release.
 */

export interface DrmPolicy {
  policy_id: string

  policy_name: string

  applies_to: DrmScope

  block_screenshots: boolean

  block_screen_recording: boolean

  hide_content_on_blur: boolean

  block_download: boolean

  allow_offline: boolean

  offline_ttl_hours?: number | null

  block_rooted_devices: boolean

  watermark_enabled: boolean

  watermark_template: string

  watermark_opacity: number

  max_devices_per_user: number

  session_timeout_minutes: number

  active: boolean
}

/**
 * What the app falls back to when the server has not answered yet.
 *
 * Every flag fails CLOSED. A default of `block_download: false` would
 * mean that a network hiccup at exactly the wrong moment silently turned
 * protection off — the same class of bug the web app's
 * `withProtectionDefaults()` guard exists to prevent.
 */

export const RESTRICTIVE_POLICY: DrmPolicy = {
  policy_id: "client-default",

  policy_name: "ברירת מחדל מחמירה",

  applies_to: "MOBILE",

  block_screenshots: true,

  block_screen_recording: true,

  hide_content_on_blur: true,

  block_download: true,

  allow_offline: false,

  offline_ttl_hours: null,

  block_rooted_devices: true,

  watermark_enabled: true,

  watermark_template: "{name} · {email}",

  watermark_opacity: 0.14,

  max_devices_per_user: 3,

  session_timeout_minutes: 30,

  active: true,
}

/* ── Device sessions ──────────────────────────────────── */

export interface DeviceSession {
  session_id: string

  user_id: string

  device_fingerprint: string

  platform: DevicePlatform

  device_name: string

  device_model?: string

  os_version?: string

  app_version?: string

  device_integrity: DeviceIntegrity

  secure_flag_active: boolean

  started_at: string

  last_seen_at: string

  ended_at?: string

  revoked: boolean

  revoked_at?: string

  revoked_by?: string

  revoke_reason?: string

  /**
   * Computed per request, not stored: the server sets it when the row's
   * `device_fingerprint` matches the `X-Casanova-Device-Id` header of the
   * call. It exists so the device list can say "this phone" and refuse to
   * offer a removal button that would cut off the screen the reader is
   * currently looking at.
   */

  current?: boolean
}

/* ── Content grants ───────────────────────────────────── */

/** Returned by `POST /content/grants`. Holds a token, not an address. */

export interface IssuedGrant {
  grant_id: string

  product_id: string

  scope: ContentGrantScope

  token: string

  watermark_text?: string

  expires_at: string

  max_uses: number
}

/**
 * Returned by `POST /content/grants/redeem`, and the only place in the
 * whole app where the address of a protected file exists.
 *
 * It is consumed by `SecureFileVault.fetch()` and then dropped: the
 * reader keeps the local vault path, never this URL. Persisting it would
 * recreate exactly the permanent link the grant system exists to
 * prevent.
 */

export interface RedeemedGrant {
  grant_id: string

  product_id: string

  scope: ContentGrantScope

  content_url: string

  /** Sent as an Authorization-style header on the file fetch, so the
   *  CDN never has to accept an unauthenticated hit for the URL. */

  fetch_headers?: Record<string, string>

  watermark_text?: string

  checksum?: string

  file_size_bytes?: number

  expires_at: string

  uses_remaining: number
}

/* ── Platform settings ────────────────────────────────── */

/** The public slice of `platform_settings`. No provider credentials. */

export interface PublicSettings {
  brand_name: string

  default_currency: string

  mobile_app_enabled: boolean

  mobile_min_build: number

  support_email?: string

  support_phone?: string
}

/* ── Orders ───────────────────────────────────────────── */

export interface OrderItem {
  product_id: string

  product_name: string

  quantity: number

  unit_price: number

  total_price: number
}

export interface Order {
  order_id: string

  order_number: string

  order_status: "PENDING" | "PAID" | "CANCELLED" | "REFUNDED" | "FAILED"

  payment_status: "PENDING" | "PAID" | "FAILED" | "PARTIALLY_REFUNDED" | "REFUNDED" | "CANCELLED"

  subtotal: number

  discount_amount: number

  total_amount: number

  currency: string

  items: OrderItem[]

  created_at: string
}

/* ── Envelope ─────────────────────────────────────────── */

/**
 * Every endpoint answers in this shape, which is the HTTP form of the
 * web service layer's `Result<T>`. Keeping the envelope identical means
 * an error string written for the CMS reads correctly on a phone, and
 * the Hebrew copy does not have to be maintained twice.
 */

export type ApiResult<T,> = { ok: true, data: T } | {
  ok: false
  code: ApiErrorCode
  error: string
}

export type ApiErrorCode = "UNAUTHENTICATED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION" | "CONFLICT" | "PROVIDER_NOT_CONFIGURED" | "STORAGE" | /* Native-only: nothing to do with the database. */

"NETWORK" | "TIMEOUT" | "APP_DISABLED" | "BUILD_TOO_OLD" | "DEVICE_COMPROMISED" | "GRANT_EXPIRED"
