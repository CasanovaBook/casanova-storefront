/**
 * Maestro Core — connector interface contract.
 *
 * A connector is the swappable boundary between Maestro and a data source
 * (localStorage today, Supabase in production, any REST API later).
 * UI code never imports a connector — it only talks to `maestro` from "@/maestro".
 */

import type {
  AuditEntry,
  AuthSession,
  ContentEntry,
  ID,
  ListOptions,
  MaestroResult,
  MediaItem,
  NewRecord,
  ResourceOptions,
  SiteSettings,
  Base,
} from "../core/types";

export interface Collection<T extends Base> {
  list(opts?: ListOptions): Promise<MaestroResult<T[]>>;
  get(id: ID, opts?: ResourceOptions): Promise<MaestroResult<T>>;
  create(input: NewRecord<T>, opts?: ResourceOptions): Promise<MaestroResult<T>>;
  update(id: ID, patch: Partial<T>, opts?: ResourceOptions): Promise<MaestroResult<T>>;
  delete(id: ID, opts?: ResourceOptions): Promise<MaestroResult<null>>;
  /** Insert, or replace when the id already exists. */
  upsert(input: NewRecord<T> & { id: ID }, opts?: ResourceOptions): Promise<MaestroResult<T>>;
}

export interface AuthConnector {
  session(): AuthSession | null;
  signIn(email: string, password: string): Promise<MaestroResult<AuthSession>>;
  signOut(): Promise<void>;
  /** Subscribe to session changes. Returns an unsubscribe function. */
  onChange(cb: (s: AuthSession | null) => void): () => void;
  /**
   * Accept an external session (e.g. from the Casanova Supabase SDK).
   * When present, this takes priority over the connector's own session,
   * so a Casanova admin login automatically grants Maestro staff access.
   */
  injectSession?(s: AuthSession | null): void;
}

/**
 * Generic record shape used by connector collections.
 * The actual domain types (Product, CmsSection, etc.) live in src/types/index.ts;
 * connectors work with `Record<string, unknown>` extended with Base fields.
 */
export type GenericRecord = Base & Record<string, unknown>;

export interface MaestroConnector {
  readonly name: "local" | "supabase" | (string & {});
  /** True when data is durable and shared between visitors and staff. */
  readonly shared: boolean;

  products: Collection<GenericRecord>;
  categories: Collection<GenericRecord>;
  cms_sections: Collection<GenericRecord>;
  cms_pages: Collection<GenericRecord>;
  cms_categories: Collection<GenericRecord>;
  testimonials: Collection<GenericRecord>;
  faqs: Collection<GenericRecord>;
  coupons: Collection<GenericRecord>;
  orders: Collection<GenericRecord>;
  users: Collection<GenericRecord>;
  audit: Collection<AuditEntry>;
  settings: Collection<SiteSettings>;
  content: Collection<ContentEntry>;
  media: Collection<MediaItem>;
  auth: AuthConnector;

  /** Stores an image (resized) and returns the media record with its public URL. */
  uploadMedia(file: File, alt?: string): Promise<MaestroResult<MediaItem>>;

  health(): Promise<MaestroResult<{ ok: boolean; connector: string }>>;
}
