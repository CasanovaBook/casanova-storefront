/**
 * Maestro Core — singleton client.
 *
 * Components import `maestro` from "@/maestro" and call e.g.
 * `maestro.products.list(...)`. The active connector defaults to Supabase when
 * VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY are set, and to the local
 * connector otherwise. It can be swapped at runtime with `configureMaestro`.
 *
 * On top of the connector, this layer applies:
 *  - role-based access rules (RBAC) — defence in depth, the database RLS is the real gate
 *  - public reads restricted to published / active records
 *  - an audit trail for every staff mutation
 */

import { createLocalConnector } from "../connectors/LocalConnector";
import { createSupabaseConnector } from "../connectors/SupabaseConnector";
import type { Collection, MaestroConnector } from "../connectors/MaestroConnector";
import { forbidden } from "./errors";
import { ADMIN_ROLES, STAFF_ROLES } from "./types";
import type { Base, ID, ListOptions, MaestroResult, MediaItem, NewRecord, ResourceOptions, Role, SiteSettings, ContentEntry, AuditEntry } from "./types";

const env = import.meta.env as Record<string, string | undefined>;

function defaultConnector(): MaestroConnector {
  if (env.VITE_SUPABASE_URL && env.VITE_SUPABASE_ANON_KEY) {
    return createSupabaseConnector({ url: env.VITE_SUPABASE_URL.replace(/\/$/, ""), anonKey: env.VITE_SUPABASE_ANON_KEY });
  }
  if ((import.meta.env as Record<string, unknown>).PROD && typeof console !== "undefined") {
    console.warn("[maestro] Running with the LOCAL connector in production: data stays in the visitor's browser. Configure Supabase.");
  }
  return createLocalConnector();
}

let connector: MaestroConnector = defaultConnector();

export function configureMaestro(opts: { connector: MaestroConnector }): void {
  connector = opts.connector;
}

// ── access rules ─────────────────────────────────────────────────────────────

type Op = "list" | "get" | "create" | "update" | "delete";
type Who = "anyone" | "staff" | "admin";
type Name = "products" | "categories" | "cms_sections" | "cms_pages" | "cms_categories" | "testimonials" | "faqs" | "coupons" | "orders" | "users" | "content" | "media" | "audit" | "settings";

const rule = (r: Partial<Record<Op, Who>>, dflt: Who = "staff"): Record<Op, Who> => ({ list: dflt, get: dflt, create: dflt, update: dflt, delete: dflt, ...r });

const POLICY: Record<Name, Record<Op, Who>> = {
  products: rule({ list: "anyone", get: "anyone" }),
  categories: rule({ list: "anyone", get: "anyone" }),
  cms_sections: rule({ list: "anyone", get: "anyone" }),
  cms_pages: rule({ list: "anyone", get: "anyone" }),
  cms_categories: rule({ list: "anyone", get: "anyone" }),
  testimonials: rule({ list: "anyone", get: "anyone" }),
  faqs: rule({ list: "anyone", get: "anyone" }),
  coupons: rule({}),
  orders: rule({ list: "staff", get: "staff" }),
  users: rule({ list: "staff", get: "staff" }),
  settings: rule({ list: "anyone", get: "anyone", update: "admin", create: "admin", delete: "admin" }),
  content: rule({ list: "anyone", get: "anyone" }),
  media: rule({}),
  audit: rule({ list: "staff", get: "staff", create: "staff", update: "admin", delete: "admin" }),
};

/** Public visitors only ever see these records. */
const PUBLIC_FILTER: Partial<Record<Name, Record<string, string | boolean>>> = {
  products: { status: "ACTIVE" },
  cms_sections: { active: true },
  cms_pages: { status: "ACTIVE" },
  testimonials: { active: true },
  faqs: { active: true },
  coupons: { status: "ACTIVE" },
};

const AUDITED: Name[] = ["products", "categories", "cms_sections", "cms_pages", "cms_categories", "testimonials", "faqs", "coupons", "orders", "users", "settings", "media"];

const roleOf = (): Role | null => connector.auth.session()?.role ?? null;
const isStaff = () => STAFF_ROLES.includes(roleOf() as Role);
const isAdmin = () => ADMIN_ROLES.includes(roleOf() as Role);

function allowed(who: Who): boolean {
  return who === "anyone" || (who === "staff" && isStaff()) || (who === "admin" && isAdmin());
}

function secure<T extends Base>(name: Name, pick: (c: MaestroConnector) => Collection<T>): Collection<T> {
  const inner = () => pick(connector);
  const deny = <R,>(op: Op): MaestroResult<R> => ({ data: null, error: forbidden(`${op} ${name}`) });

  const audit = (action: Op, entityId: ID, detail?: unknown) => {
    const s = connector.auth.session();
    if (!s || !AUDITED.includes(name)) return;
    void connector.audit.create({
      actor_id: s.user.id,
      actor_email: s.user.email,
      action,
      entity: name,
      entity_id: entityId,
      detail: detail ? JSON.stringify(detail).slice(0, 2000) : null,
    });
  };

  return {
    async list(opts: ListOptions = {}) {
      if (!allowed(POLICY[name].list)) return deny("list");
      const pub = !isStaff() ? PUBLIC_FILTER[name] : undefined;
      return inner().list(pub ? { ...opts, filter: { ...opts.filter, ...pub } } : opts);
    },
    async get(id: ID, opts?: ResourceOptions) {
      if (!allowed(POLICY[name].get)) return deny("get");
      const res = await inner().get(id, opts);
      const pub = !isStaff() ? PUBLIC_FILTER[name] : undefined;
      if (res.data && pub && !Object.entries(pub).every(([k, v]) => (res.data as Record<string, unknown>)[k] === v)) {
        return { data: null, error: forbidden(`get ${name}`) };
      }
      return res;
    },
    async create(input: NewRecord<T>, opts?: ResourceOptions) {
      if (!allowed(POLICY[name].create)) return deny("create");
      const res = await inner().create(input, opts);
      if (res.data && isStaff()) audit("create", res.data.id);
      return res;
    },
    async update(id: ID, patch: Partial<T>, opts?: ResourceOptions) {
      if (!allowed(POLICY[name].update)) return deny("update");
      const res = await inner().update(id, patch, opts);
      if (res.data) audit("update", id, patch);
      return res;
    },
    async delete(id: ID, opts?: ResourceOptions) {
      if (!allowed(POLICY[name].delete)) return deny("delete");
      const res = await inner().delete(id, opts);
      if (!res.error) audit("delete", id);
      return res;
    },
    async upsert(input: NewRecord<T> & { id: ID }, opts?: ResourceOptions) {
      if (!allowed(POLICY[name].update)) return deny("update");
      const res = await inner().upsert(input, opts);
      if (res.data) audit("update", input.id, input);
      return res;
    },
  };
}

const collections = {
  products: secure("products", (c) => c.products),
  categories: secure("categories", (c) => c.categories),
  cms_sections: secure("cms_sections", (c) => c.cms_sections),
  cms_pages: secure("cms_pages", (c) => c.cms_pages),
  cms_categories: secure("cms_categories", (c) => c.cms_categories),
  testimonials: secure("testimonials", (c) => c.testimonials),
  faqs: secure("faqs", (c) => c.faqs),
  coupons: secure("coupons", (c) => c.coupons),
  orders: secure("orders", (c) => c.orders),
  users: secure("users", (c) => c.users),
  audit: secure("audit", (c) => c.audit),
  settings: secure("settings", (c) => c.settings),
  content: secure("content", (c) => c.content),
  media: secure("media", (c) => c.media),
};

/**
 * Content API used by the site (read, cached in the UI layer) and by Maestro Admin (write).
 * Values are JSON. Missing keys are not an error: the site falls back to the registry defaults.
 * Bulk saves write ONE audit entry listing the keys that changed.
 */
const content = {
  async all(): Promise<Record<string, unknown>> {
    const res = await collections.content.list();
    const out: Record<string, unknown> = {};
    for (const row of res.data ?? []) out[row.id] = row.value;
    return out;
  },
  async saveMany(values: Record<string, unknown>): Promise<MaestroResult<null>> {
    if (!isStaff()) return { data: null, error: forbidden("save content") };
    const session = connector.auth.session();
    const by = session?.user.email ?? null;
    for (const [key, value] of Object.entries(values)) {
      const res = await connector.content.upsert({ id: key, value, updated_by: by });
      if (res.error) return { data: null, error: res.error };
    }
    if (session) {
      void connector.audit.create({
        actor_id: session.user.id,
        actor_email: session.user.email,
        action: "update",
        entity: "content",
        entity_id: `${Object.keys(values).length} keys`,
        detail: JSON.stringify(Object.keys(values)).slice(0, 1800),
      });
    }
    return { data: null, error: null };
  },
  async reset(keys: string[]): Promise<MaestroResult<null>> {
    if (!isStaff()) return { data: null, error: forbidden("reset content") };
    for (const k of keys) {
      const res = await connector.content.delete(k);
      if (res.error) return { data: null, error: res.error };
    }
    return { data: null, error: null };
  },
};

async function uploadMedia(file: File, alt?: string): Promise<MaestroResult<MediaItem>> {
  if (!isStaff()) return { data: null, error: forbidden("upload media") };
  return connector.uploadMedia(file, alt);
}

/**
 * Public Maestro facade. Everything is wired through getters so
 * `configureMaestro` can replace the connector without stale references.
 */
export const maestro = {
  ...collections,
  get auth() {
    return connector.auth;
  },
  get connector() {
    return { name: connector.name, shared: connector.shared };
  },
  content,
  uploadMedia,
  health: () => connector.health(),
  /**
   * Bridge a Casanova Supabase session into the Maestro connector.
   * When an admin is logged into Casanova, this injects their Supabase
   * token so Maestro can read/write the database with staff access.
   * Pass `null` to clear the bridged session (on logout).
   */
  bridgeSession(s: { accessToken: string; userId: string; email: string; role?: string } | null) {
    if (connector.auth.injectSession) {
      connector.auth.injectSession(s ? {
        user: { id: s.userId, email: s.email },
        role: (s.role as Role) ?? "SUPER_ADMIN",
        accessToken: s.accessToken,
      } : null);
    }
  },
  async getSettings(): Promise<SiteSettings | null> {
    const res = await collections.settings.get("site");
    return res.data;
  },
};

export type MaestroClient = typeof maestro;
