/* ─────────────────────────────────────────────────────────────
 * Domain model.
 *
 * Relationships are expressed with IDs, never by embedding whole
 * objects. Purchase-time data that must survive a product being
 * edited, archived or deleted is stored as an explicit, bounded
 * snapshot (`OrderItem`, `ProductSnapshot`) — not as a live copy of
 * the product record.
 * ───────────────────────────────────────────────────────────── */

export type Role = "CUSTOMER" | "ADMIN" | "MODERATOR"
export type AdminRole = "SUPER_ADMIN" | "SUPPORT" | "FINANCE" | "CONTENT" | "MARKETING"
export type AccountStatus = "ACTIVE" | "SUSPENDED" | "DEACTIVATED"
export type ProductType = "EBOOK" | "SUBSCRIPTION" | "DIGITAL_PRODUCT" | "PHYSICAL_PRODUCT" | "BUNDLE" | "COURSE" | "PREMIUM_ACCESS"
export type ProductStatus = "ACTIVE" | "INACTIVE" | "DRAFT" | "ARCHIVED"
export type ProductVisibility = "PUBLIC" | "UNLISTED" | "HIDDEN"
export type ProductAvailability = "AVAILABLE" | "OUT_OF_STOCK" | "PREORDER"
export type OrderStatus = "PENDING" | "PAID" | "CANCELLED" | "REFUNDED" | "FAILED"
export type PaymentStatus = "PENDING" | "PAID" | "FAILED" | "PARTIALLY_REFUNDED" | "REFUNDED" | "CANCELLED"
export type RefundStatus = "NONE" | "REQUESTED" | "PARTIAL" | "FULL"
export type AccessStatus = "ACTIVE" | "EXPIRED" | "REVOKED" | "SUSPENDED"
export type DiscountType = "PERCENTAGE" | "FIXED_AMOUNT"
export type EmailStatus = "QUEUED" | "SENT" | "FAILED" | "DELIVERED"
export type SubscriptionStatus = "ACTIVE" | "PAST_DUE" | "CANCELLED" | "EXPIRED"

/* ── People ───────────────────────────────────────────── */

export interface User {
  user_id: string
  first_name: string
  last_name: string
  email: string
  phone?: string
  role: Role
  /** Sub-role for admin accounts; only meaningful when role is ADMIN. */
  admin_role?: AdminRole
  account_status: AccountStatus
  must_change_password?: boolean
  email_confirmed_at?: string | null
  created_at: string
  updated_at: string
  last_login_at?: string
  last_activity_at?: string
  /**
   * Set once, on the first dashboard view after sign-in, and never
   * cleared. NULL means the account has not been greeted yet, which
   * is the only state in which the dashboard says "ברוך הבא".
   * Per-account, so a second device never re-greets a returning
   * customer. See migrations/0004_first_login_greeting.sql.
   */
  greeted_at?: string | null
}

/**
 * A user record as stored by the persistence driver. The credential
 * fields never leave the storage layer — `toPublicUser()` strips them
 * before anything reaches React state or the UI.
 */
export interface StoredUser
  extends User {
  /** Set when the account was created by a purchase and has no password yet. */
  password_hash?: string
  password_salt?: string
  password_set: boolean
}

/* ── Catalog ──────────────────────────────────────────── */

export interface Category {
  category_id: string
  name: string
  slug: string
  description?: string
  display_order: number
  created_at: string
}

export interface MediaLink {
  media_link_id: string
  label: string
  url: string
  platform: "YOUTUBE" | "VIMEO" | "WEB"
}

export interface ContentFile {
  file_name: string
  file_size_kb: number
  mime_type: string
  version: number
  uploaded_at: string
  /** Supabase Storage location, when the file was uploaded to a bucket
   * rather than inlined or referenced by an external URL. */
  storage_bucket?: string
  storage_path?: string
}

/** Book-specific metadata; only meaningful when product_type is EBOOK. */
export interface BookMetadata {
  author_name?: string
  subtitle?: string
  isbn?: string
  publisher?: string
  language?: string
  publication_date?: string
  total_pages?: number
}

export interface SeoFields {
  title?: string
  description?: string
  keywords?: string
}

export interface Product {
  product_id: string
  name: string
  slug: string
  sku?: string
  subtitle?: string
  description: string
  short_description: string
  product_type: ProductType

  /** Regular price. */
  price: number
  /** Promotional price; when present and lower than `price` the product is on sale. */
  sale_price?: number
  currency: string

  image_url?: string
  images?: string[]
  /** Fallback gradient used when no cover image is supplied. */
  cover_colors?: [string, string]

  category_ids?: string[]
  tags?: string[]

  status: ProductStatus
  visibility: ProductVisibility
  availability: ProductAvailability
  /** `null` means unlimited (digital goods). */
  inventory: number | null
  featured: boolean
  /** Manual ordering hint used by catalog grids and carousels. */
  position: number

  rating?: number
  reviews_count?: number

  /** Present for EBOOK products. */
  book?: BookMetadata
  seo?: SeoFields
  metadata?: Record<string, string>

  media_links?: MediaLink[]
  content_file?: ContentFile
  /**
   * Legacy/fallback address of the content file rendered by the reader
   * (e.g. /books/x.pdf or a data URL). When `storage_path` is present the
   * reader ignores this and resolves a short-lived Supabase signed URL
   * instead, so the permanent address of a protected file is never stored
   * on the catalogue row.
   */
  content_url?: string
  /** Supabase Storage pointer for the protected file (private bucket). */
  storage_bucket?: string
  storage_path?: string

  bundle_item_ids?: string[]
  related_product_ids?: string[]
  upsell_ids?: string[]
  cross_sell_ids?: string[]

  created_at: string
  updated_at: string
  archived_at?: string
}

/**
 * Bounded, purchase-time copy of the display fields an access grant or
 * order line needs. Keeps historical records intact when a product is
 * later edited, archived or deleted.
 */
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

export function snapshotProduct(p: Product): ProductSnapshot {
  return {
    product_id: p.product_id,
    name: p.name,
    slug: p.slug,
    product_type: p.product_type,
    cover_colors: p.cover_colors,
    image_url: p.image_url,
    author_name: p.book?.author_name,
    total_pages: p.book?.total_pages,
  }
}

/** The price a customer actually pays for one unit right now. */
export function effectivePrice(p: Product): number {
  return typeof p.sale_price === "number" && p.sale_price < p.price
    ? p.sale_price
    : p.price
}

export function isOnSale(p: Product): boolean {
  return typeof p.sale_price === "number" && p.sale_price < p.price
}

/* ── Commerce ─────────────────────────────────────────── */

export interface OrderItem {
  order_item_id: string
  order_id: string
  product_id: string
  /** Purchase-time name; survives product edits/archival/deletion. */
  product_name: string
  quantity: number
  /** Unit price charged at purchase time. */
  unit_price: number
  /** Discount applied to this line (already reflected in `line_total`). */
  discount_amount: number
  /** unit_price * quantity - discount_amount */
  line_total: number
}

export interface Order {
  order_id: string
  /** Human-facing reference shown to the customer (e.g. CNV-2026-0001). */
  order_number: string
  user_id: string
  order_status: OrderStatus
  payment_status: PaymentStatus
  refund_status: RefundStatus
  refunded_amount: number
  subtotal: number
  discount_amount: number
  total_amount: number
  currency: string
  coupon_code?: string
  payment_provider?: string
  transaction_reference?: string
  /** Only the last 4 digits are ever stored or displayed. */
  card_last4?: string
  customer_first_name: string
  customer_last_name: string
  customer_email: string
  customer_phone?: string
  created_at: string
  paid_at?: string
  items: OrderItem[]
}

/** One attempted charge against an order. */
export interface Payment {
  payment_id: string
  order_id: string
  provider: string
  status: "PENDING" | "AUTHORIZED" | "CAPTURED" | "FAILED" | "CANCELLED"
  amount: number
  currency: string
  transaction_reference?: string
  card_last4?: string
  failure_reason?: string
  created_at: string
}

export interface Refund {
  refund_id: string
  order_id: string
  payment_id?: string
  /** Amount originally charged on the order. */
  original_amount: number
  amount: number
  currency: string
  reason: string
  status: RefundRequestStatus
  provider?: string
  /** Returned by the payment provider once the refund is executed. */
  provider_refund_id?: string
  requested_at: string
  reviewed_at?: string
  reviewed_by?: string
  review_note?: string
  processed_at?: string
  initiated_by: string
  initiated_by_id?: string
}

export type RefundRequestStatus = "REQUESTED" | "PENDING" | "APPROVED" | "REJECTED" | "PROCESSING" | "REFUNDED" | "FAILED"

export interface Invoice {
  invoice_id: string
  order_id: string
  invoice_number: string
  amount: number
  currency: string
  issued_at: string
  status: string
}

export interface Coupon {
  coupon_id: string
  code: string
  discount_type: DiscountType
  discount_value: number
  minimum_order: number
  expires_at?: string
  usage_limit?: number
  times_used: number
  status: string
}

export interface CheckoutFormData {
  first_name: string
  last_name: string
  email: string
  phone: string
  coupon_code: string
}

export interface CartItem {
  product_id: string
  quantity: number
}

/* ── Entitlements & reading ───────────────────────────── */

export interface UserProduct {
  user_product_id: string
  user_id: string
  product_id: string
  /** Purchase-time display snapshot; the live product is resolved by id. */
  product_snapshot: ProductSnapshot
  source_order_id?: string
  access_status: AccessStatus
  granted_at: string
  expires_at?: string
}

export interface ReadingProgress {
  progress_id: string
  user_id: string
  product_id: string
  current_page: number
  progress_percent: number
  last_read_at: string
}

/** One-time password reset grant. Only the digest of the token is stored. */
export interface PasswordReset {
  token_id: string
  user_id: string
  token_hash: string
  created_at: string
  expires_at: string
  used_at?: string
}

export interface AdminSubscription {
  subscription_id: string
  user_id: string
  product_id: string
  status: SubscriptionStatus
  billing_interval: "MONTHLY" | "YEARLY"
  start_date: string
  next_billing_date: string
  cancelled_at?: string
}

/* ── Support / customer inquiries ─────────────────────── */

export type InquiryStatus = "NEW" | "OPEN" | "IN_PROGRESS" | "WAITING_FOR_CUSTOMER" | "RESOLVED" | "CLOSED"

export type InquiryTopic = "GENERAL" | "ORDER" | "REFUND" | "ACCESS" | "BILLING" | "TECHNICAL"

export interface Inquiry {
  inquiry_id: string
  /** Public reference shown to the customer (e.g. INQ-2026-0001). */
  ticket_number: string
  customer_name: string
  customer_email: string
  customer_phone?: string
  subject: string
  message: string
  topic: InquiryTopic
  status: InquiryStatus
  /** Matched automatically when the sender email belongs to a known customer. */
  user_id?: string
  related_order_id?: string
  assigned_to?: string
  assigned_to_name?: string
  source: "WEBSITE" | "CMS" | "EMAIL" | "MOBILE_APP"
  created_at: string
  updated_at: string
  resolved_at?: string
}

export interface InquiryNote {
  note_id: string
  inquiry_id: string
  author_id: string
  author_name: string
  content: string
  internal: boolean
  created_at: string
}

/* ── CRM ──────────────────────────────────────────────── */

export type LeadStage = "NEW" | "CONTACTED" | "INTERESTED" | "WON" | "LOST"
export type LeadSource = "LANDING_PAGE" | "STORE" | "REFERRAL" | "CAMPAIGN" | "MANUAL" | "MOBILE_APP"
export type TaskPriority = "HIGH" | "MEDIUM" | "LOW"
export type NoteCategory = "CALL" | "EMAIL" | "MEETING" | "GENERAL"

export interface CrmLead {
  lead_id: string
  full_name: string
  email: string
  phone?: string
  stage: LeadStage
  source: LeadSource
  interested_product_id?: string
  tags: string[]
  notes_count: number
  created_at: string
  last_contact_at?: string
}

export interface CrmTask {
  task_id: string
  title: string
  lead_id?: string
  lead_name?: string
  due_date: string
  priority: TaskPriority
  done: boolean
}

export interface CrmNote {
  note_id: string
  lead_id: string
  category: NoteCategory
  content: string
  created_at: string
  author: string
}

/* ── Transactional email ──────────────────────────────── */

export interface EmailLog {
  email_log_id: string
  recipient: string
  recipient_name?: string
  template: string
  subject: string
  status: EmailStatus
  sent_at: string
  related_type?: "ORDER" | "INQUIRY" | "USER" | "REFUND"
  related_id?: string
  /** Populated when delivery could not be attempted. */
  failure_reason?: string
}

/* ── CMS content ──────────────────────────────────────── */

/**
 * The block types the CMS can publish to the landing page.
 *
 * HERO, TESTIMONIALS, FAQ and CTA are structural: each one drives a
 * single fixed position on the page (and TESTIMONIALS/FAQ read their own
 * collections rather than `content`). TEXT, VIDEO, GALLERY and PRODUCTS
 * are free-form: any number of them can exist and they are rendered in
 * `display_order`, which is how an editor composes the middle of the
 * page without touching code.
 */
export type SectionType = "HERO" | "TEXT" | "VIDEO" | "GALLERY" | "PRODUCTS" | "TESTIMONIALS" | "FAQ" | "CTA" | "FEATURES" | "STEPS" | "AUDIENCE" | "OFFER" | "GUARANTEE"

/** Types the landing page renders as an ordered stream rather than in a fixed slot. */
export const FREEFORM_SECTION_TYPES: SectionType[] = [
  "TEXT",
  "VIDEO",
  "GALLERY",
  "PRODUCTS",
]

/**
 * Which page a CMS section publishes to.
 *
 * HOME sections render on the storefront landing (`/`). SALES sections
 * render on the main page, which is also served at `/` — `/` and the
 * retired `/hi-kodem` alias were the same component, so both values
 * publish to the same route today. The flag is optional so legacy rows
 * (written before the sales page existed) keep publishing to home
 * without a data migration.
 */
export type CmsSectionPage = "HOME" | "SALES"

/**
 * One repeatable sub-block inside a section: a benefit card, a numbered
 * step, a list item, a bonus, a proof icon. `group` lets a single
 * section render two columns (e.g. "למי כן" / "למי לא") from one list.
 */
export interface CmsSectionItem {
  item_id: string
  title: string
  content: string
  group?: "PRIMARY" | "SECONDARY"
}

export interface CmsSection {
  section_id: string
  type: SectionType
  title: string
  content: string
  media_url?: string
  /**
   * Ordered image sources for GALLERY sections. Kept separate from
   * `media_url` so a video section and a gallery never fight over the
   * same field, and so a gallery can hold any number of assets.
   */
  media_urls?: string[]
  /** Which page this section publishes to. Absent / 'HOME' means home. */
  page?: CmsSectionPage
  /** Repeatable sub-blocks: benefit cards, numbered steps, list items, bonuses. */
  items?: CmsSectionItem[]
  active: boolean
  display_order: number
  updated_at: string
}

export interface Testimonial {
  testimonial_id: string
  quote: string
  name: string
  title: string
  avatar: string
  active: boolean
  display_order: number
}

export interface FaqItem {
  faq_id: string
  question: string
  answer: string
  active: boolean
  display_order: number
}

export interface CmsBackup {
  backed_up_at: string
  sections: CmsSection[]
  products: Product[]
  categories: Category[]
  testimonials: Testimonial[]
  faqs: FaqItem[]
}

/* ── Audit, alerts, settings ──────────────────────────── */

export type AuditCategory = "PRICE_CHANGE" | "REFUND" | "ACCESS_CHANGE" | "USER_BLOCK" | "CONTENT_SWAP" | "PRODUCT_CREATE" | "PRODUCT_UPDATE" | "PRODUCT_DELETE" | "ROLE_CHANGE" | "EMAIL_RESEND" | "COUPON_CHANGE" | "ORDER_CHANGE" | "INQUIRY" | "SETTINGS" | "SECURITY" | "AUTH" | "OTHER"

export interface AuditLogEntry {
  audit_id: string
  actor_id: string
  actor_name: string
  actor_role: string
  category: AuditCategory
  action: string
  target_type: string
  target_id: string
  target_label: string
  details: string
  created_at: string
}

export type AlertSeverity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW"

export interface SystemAlert {
  alert_id: string
  severity: AlertSeverity
  title: string
  description: string
  related_type: "ORDER" | "USER" | "EMAIL" | "INVOICE" | "ACCESS" | "SUBSCRIPTION" | "REFUND" | "INQUIRY" | "SETTINGS"
  related_id: string
  created_at: string
}

/**
 * Platform configuration managed from the CMS. Everything that would
 * normally come from server environment variables lives here so the
 * business can change it without a developer.
 */
export interface PlatformSettings {
  brand_name: string
  default_currency: string
  invoice_prefix: string
  order_prefix: string
  inquiry_prefix: string
  /** `null` while no payment gateway credentials are configured. */
  payment_provider: string | null
  /** `null` while no transactional email provider is configured. */
  email_provider: string | null
  /**
   * Only true once a gateway that supports programmatic refunds is
   * connected. While false the CMS can record, approve and reject
   * refund requests but can never mark money as returned.
   */
  refund_execution_enabled: boolean
  /** Max bytes accepted for a browser-side asset upload. */
  max_upload_bytes: number

  /* ── Mobile client ─────────────────────────────────
   * The React Native reader authenticates against the same database, so
   * taking the app out of service or forcing an upgrade is a settings
   * edit rather than a store release. A build older than
   * `mobile_min_build` is refused before it can read anything, which is
   * what makes one schema safe to serve two clients at different release
   * cadences. */

  /** False makes the API refuse mobile logins outright. */
  mobile_app_enabled: boolean
  /** Build number a mobile client must be at or above. 0 accepts all. */
  mobile_min_build: number

  /* ── Site copy ────────────────────────────────────
   * Every string a visitor reads as *content* rather than as application
   * chrome. All optional and all empty by default: the platform ships with
   * no marketing copy of its own, so nothing invented can reach a customer
   * before an editor has written something. Where one is missing the
   * landing page renders nothing in that slot, and shows an administrator a
   * hint naming the field to fill. */

  /** Short brand line rendered above the hero headline. */
  tagline?: string
  /** Assurance bullets under the hero. An empty list renders no row at all. */
  trust_badges?: string[]
  /** Heading and intro for the catalogue block. */
  catalogue_title?: string
  catalogue_blurb?: string
  /** Heading and intro for the bundle / subscription block. */
  pricing_title?: string
  pricing_blurb?: string
  /** Optional closing line in the footer, above the copyright. */
  footer_text?: string

  /* ── Main page ─────────────────────────────────────────
   * Conversion copy for the main landing page.
   * Every field is optional and falls back to the bundled launch copy
   * in `src/lib/sales-content.ts`, so the page renders complete copy
   * for any visitor even when no administrator has written anything.
   * An editor who fills a field here overrides the bundled default
   * for that slot; clearing it reverts to the bundled copy. */

  /** Label on the sticky mobile CTA bar. */
  sales_sticky_cta?: string
  /** Exit-intent popup heading. */
  sales_exit_title?: string
  /** Exit-intent popup body. */
  sales_exit_body?: string
  /** Exit-intent popup button label. */
  sales_exit_cta?: string

  updated_at: string
  updated_by?: string
}

/* ── Content protection (DRM) ───────────────────────────── */

/**
 * Which client a protection policy applies to. The web reader and a
 * future native reader need different deterrents — a browser cannot
 * stop an OS-level screenshot, a native app can — so the policy is
 * resolved by scope rather than being one global block of flags.
 */
export type DrmScope = "WEB" | "MOBILE" | "ALL"

export type DevicePlatform = "WEB" | "ANDROID" | "IOS"

/**
 * Verdict of a client's own integrity check.
 *
 * Reported by the device and therefore spoofable, exactly like the
 * fingerprint: it exists so `block_rooted_devices` has something to
 * decide on, and so a pattern of compromised devices shows up in one
 * column instead of in prose.
 */
export type DeviceIntegrity = "UNKNOWN" | "TRUSTED" | "ROOTED" | "JAILBROKEN" | "ATTESTATION_FAILED" | "EMULATOR"

/**
 * What a reader may do with a content grant.
 *
 * STREAM is the page on screen right now: short-lived, reusable inside
 * one session. OFFLINE_CACHE is a copy that outlives the session, so it
 * is single-use, issued only when the policy allows offline reading, and
 * destroyed by the client once its TTL passes.
 */
export type ContentGrantScope = "STREAM" | "OFFLINE_CACHE"

/**
 * Copy-protection policy for purchased content, managed from the CMS.
 *
 * Deliberately a small set of named booleans rather than one "DRM on"
 * switch: the business must be able to relax, say, printing for a
 * title sold to institutions while keeping the watermark and the
 * device cap in force everywhere.
 *
 * These flags are deterrents, not encryption. A browser that can
 * render a page can be photographed, and no client-side code changes
 * that. What the policy buys is attribution — every leaked capture
 * carries the identity of the account it came from — plus a hard cap
 * on how many devices one purchase can be spread across.
 */
export interface DrmPolicy {
  policy_id: string
  policy_name: string
  applies_to: DrmScope
  block_screenshots: boolean
  block_screen_recording: boolean
  hide_content_on_blur: boolean
  block_copy: boolean
  block_print: boolean
  /**
   * Refuses to hand the file to anything the platform no longer
   * controls: save, export, the share sheet, "open in another app".
   * The browser can only refuse the paths it can see; the native reader
   * refuses the act, which is why the same flag governs both.
   */
  block_download: boolean
  /** Opt-in, and always bounded by `offline_ttl_hours`. */
  allow_offline: boolean
  /** Hours an offline copy may survive. Null while offline is off. */
  offline_ttl_hours?: number | null
  /** Refuse protected content on a rooted, jailbroken or emulated device. */
  block_rooted_devices: boolean
  watermark_enabled: boolean
  /**
   * Stamped over the content, e.g. `{name} · {email}`. Placeholders are
   * substituted from the signed-in account at render time so a capture
   * is traceable to the buyer who made it.
   */
  watermark_template: string
  /** 0–1. Low enough to read through, high enough to survive a photo. */
  watermark_opacity: number
  max_devices_per_user: number
  session_timeout_minutes: number
  active: boolean
  created_at: string
  updated_at: string
}

/**
 * One device currently authorised to read a user's purchases.
 *
 * The fingerprint is derived in the browser and is therefore spoofable;
 * it exists to enforce a practical device cap and to give support a
 * list of sessions they can revoke, not to be a security boundary.
 */
export interface DeviceSession {
  session_id: string
  user_id: string
  device_fingerprint: string
  platform: DevicePlatform
  device_name: string
  /** Machine-readable client identity, so support can tell an Android 9
   *  phone from an iOS 18 tablet without parsing `device_name`. */
  device_model?: string
  os_version?: string
  app_version?: string
  device_integrity: DeviceIntegrity
  /** False once the reader detects the protection layer is not running. */
  secure_flag_active: boolean
  started_at: string
  last_seen_at: string
  ended_at?: string
  revoked: boolean
  /**
   * Revocation attribution, kept on the row rather than only in the
   * audit trail: the reader that gets cut off has to be able to say why,
   * and the device list has to show who cut it off and when.
   */
  revoked_at?: string
  revoked_by?: string
  revoke_reason?: string
}

export type SecurityEventType = "SCREENSHOT_BLOCKED" | "RECORDING_DETECTED" | "COPY_BLOCKED" | "PRINT_BLOCKED" | "CONTEXT_MENU_BLOCKED" | "SOURCE_VIEW_BLOCKED" | "VISIBILITY_HIDDEN" | "SESSION_REVOKED" | "DEVICE_LIMIT_EXCEEDED" | /* Native reader */
"DOWNLOAD_BLOCKED" | "SHARE_BLOCKED" | "MIRROR_DETECTED" | "DEVICE_COMPROMISED" | "GRANT_REPLAY_BLOCKED" | "OFFLINE_EXPIRED"

/**
 * A protection event raised by the reader. Written by the service layer
 * only, de-duplicated and capped so a visitor holding down Ctrl+C cannot
 * fill the store or drown out real signal.
 */
export interface SecurityEvent {
  event_id: string
  user_id?: string
  session_id?: string
  product_id?: string
  event_type: SecurityEventType
  platform: DevicePlatform
  metadata: Record<string, string | number | boolean>
  user_agent?: string
  created_at: string
}

/**
 * One short-lived permission to fetch a protected file.
 *
 * The rule both clients obey: nobody is ever given the permanent address
 * of a file. They are given a grant, minted for one signed-in account,
 * one entitled product and one device session, with an expiry and a use
 * budget. Revoking the entitlement or the device therefore also kills
 * every URL already handed out.
 *
 * In the database only `token` is stored as a digest
 * (content_access_grants.token_hash); this client-side shape carries the
 * token itself because the browser is the only party that needs it.
 */
export interface ContentGrant {
  grant_id: string
  user_id: string
  user_product_id: string
  product_id: string
  session_id?: string
  asset_id?: string
  platform: DevicePlatform
  scope: ContentGrantScope
  token: string
  /** Resolved location of the file. Never leaves the reader that asked. */
  content_url: string
  /** Frozen at mint time so a leaked page keeps naming its account. */
  watermark_text?: string
  checksum?: string
  file_size_bytes?: number
  max_uses: number
  use_count: number
  expires_at: string
  first_used_at?: string
  last_used_at?: string
  revoked_at?: string
  revoked_by?: string
  revoke_reason?: string
  created_at: string
}
