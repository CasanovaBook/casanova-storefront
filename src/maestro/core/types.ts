/**
 * Maestro Core - shared domain types for Casanova Bookstore.
 *
 * Every resource is a flat record so it maps 1:1 to a Postgres table
 * (see schema.sql) and to a localStorage collection.
 *
 * Only the types Maestro's CMS layer needs to operate are defined here.
 * Full domain types live in src/types/index.ts; these are the subset
 * the connector interface and RBAC policy speak.
 */

export type ID = string;

/** Uniform result envelope returned by every connector call. */
export interface MaestroResult<T> {
  data: T | null;
  error: Error | null;
}

export type FilterValue = string | number | boolean | null;

export interface ListOptions {
  /** Reserved for multi-site. Ignored by current connectors. */
  siteId?: ID;
  orderBy?: string;
  orderDir?: "asc" | "desc";
  filter?: Record<string, FilterValue>;
  limit?: number;
}

export interface ResourceOptions {
  siteId?: ID;
}

export interface Base {
  id: ID;
  created_at: string;
  updated_at: string;
}

export type NewRecord<T extends Base> = Omit<T, "id" | "created_at" | "updated_at"> & { id?: ID };

// ── Roles & auth ─────────────────────────────────────────────────────────────

/**
 * Casanova admin roles. Mirrors AdminRole from src/types/index.ts.
 * CUSTOMER is the implicit role for non-staff users.
 */
export type Role = "CUSTOMER" | "SUPER_ADMIN" | "SUPPORT" | "FINANCE" | "CONTENT" | "MARKETING";

export const STAFF_ROLES: Role[] = ["SUPER_ADMIN", "SUPPORT", "FINANCE", "CONTENT", "MARKETING"];
export const ADMIN_ROLES: Role[] = ["SUPER_ADMIN"];

export interface AuthSession {
  user: { id: ID; email: string };
  role: Role;
  accessToken?: string;
  refreshToken?: string;
  /** Unix seconds. */
  expiresAt?: number;
}

// ── CMS: content entries, media ─────────────────────────────────────────────

/**
 * One editable piece of site content. `id` IS the content key (e.g. "home.hero.title"),
 * `value` is any JSON (string, list of items, ...). Missing keys fall back to the defaults
 * in src/content/registry.ts, so an empty table still renders the whole site.
 */
export interface ContentEntry extends Base {
  value: unknown;
  updated_by: string | null;
}

export interface MediaItem extends Base {
  name: string;
  url: string;
  size: number;
  width: number | null;
  height: number | null;
  alt: string;
}

// ── Audit ────────────────────────────────────────────────────────────────────

export interface AuditEntry extends Base {
  actor_id: string;
  actor_email: string;
  action: string;
  entity: string;
  entity_id: string;
  detail: string | null;
}

/**
 * Structured change payload written into `AuditEntry.detail` as JSON.
 * Values are pre-clipped strings so the writer can guarantee the serialized
 * envelope always fits the journal's size budget without cutting JSON.
 */
export type AuditAction = "create" | "update" | "delete" | "upsert" | "reset" | "import";

export interface AuditChange {
  /** Record field ("name") or content key ("sales.hero.title"). */
  key: string;
  /** Clipped previous value; null when there was none (create / new key). */
  before: string | null;
  /** Clipped new value; null when the value is gone (delete / reset). */
  after: string | null;
  /** True when `before` or `after` was clipped to the value budget. */
  cut?: true;
}

export interface AuditDetail {
  /** Format tag; absent on every row written before structured diffs. */
  v: 1;
  /** record = field diff of one row; content = diff of content keys. */
  kind: "record" | "content";
  changes: AuditChange[];
  /** Key names that did not fit as full changes (dense fallback). */
  keys?: string[];
  /** True count of changes when `changes` was trimmed to fit the budget. */
  total?: number;
  truncated?: true;
}

// ── Site settings (singleton) ────────────────────────────────────────────────

/**
 * Lightweight settings row managed by Maestro. The full PlatformSettings
 * type lives in src/types/index.ts; this is the subset the CMS connector
 * reads and writes for platform-wide configuration.
 */
export interface SiteSettings extends Base {
  brand_name: string;
  default_currency: string;
  payment_provider: string | null;
  email_provider: string | null;
  phone: string | null;
  email: string | null;
  footer_text: string | null;
  tagline: string | null;
  mobile_app_enabled: boolean;
  maintenance_mode: boolean;
  maintenance_message: string | null;
}
