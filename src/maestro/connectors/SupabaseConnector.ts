/**
 * Maestro Core — Supabase connector.
 *
 * Talks to PostgREST / GoTrue over plain `fetch` (no SDK dependency).
 * Security lives in the database: see schema.sql for the Row Level
 * Security policies. The anon key is public by design; it can only do
 * what the RLS policies allow (read published content, insert orders).
 */

import { MaestroError, toMaestroError } from "../core/errors";
import { STAFF_ROLES } from "../core/types";
import { prepareImage } from "../core/image";
import type { AuthSession, Base, ID, ListOptions, MaestroResult, MediaItem, NewRecord, Role } from "../core/types";
import type { AuthConnector, Collection, GenericRecord, MaestroConnector } from "./MaestroConnector";

interface Cfg {
  url: string;
  anonKey: string;
}

const SESSION_KEY = "casanova.maestro.supabase.session";
const TIMEOUT_MS = 15000;

const uuid = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

function decodeJwt(token: string): { sub?: string; email?: string; exp?: number; app_metadata?: { role?: string } } {
  try {
    const payload = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(decodeURIComponent(escape(atob(payload))));
  } catch {
    return {};
  }
}

function sessionFromToken(access: string, refresh: string | undefined): AuthSession {
  const jwt = decodeJwt(access);
  return {
    user: { id: jwt.sub ?? "", email: jwt.email ?? "" },
    role: (jwt.app_metadata?.role as Role) ?? "CUSTOMER",
    accessToken: access,
    refreshToken: refresh,
    expiresAt: jwt.exp,
  };
}

async function http(cfg: Cfg, path: string, init: RequestInit & { token?: string | null } = {}): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const { token, headers, ...rest } = init;
    return await fetch(`${cfg.url}${path}`, {
      ...rest,
      signal: ctrl.signal,
      headers: {
        apikey: cfg.anonKey,
        Authorization: `Bearer ${token || cfg.anonKey}`,
        "Content-Type": "application/json",
        ...(headers as Record<string, string> | undefined),
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

async function toError(res: Response): Promise<Error> {
  let body: { message?: string; code?: string; error_description?: string; msg?: string } = {};
  try {
    body = await res.json();
  } catch {
    /* non-json body */
  }
  const message = body.message ?? body.error_description ?? body.msg ?? `HTTP ${res.status}`;
  const code = body.code ?? (res.status === 409 ? "23505" : res.status === 401 || res.status === 403 ? "forbidden" : String(res.status));
  return new MaestroError(message, { code });
}

function supabaseAuth(cfg: Cfg): AuthConnector {
  const listeners = new Set<(s: AuthSession | null) => void>();
  let current: AuthSession | null = null;
  /** External session injected from the Casanova Supabase SDK (takes priority). */
  let external: AuthSession | null = null;
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (raw) current = JSON.parse(raw) as AuthSession;
  } catch {
    /* ignore */
  }

  const emit = () => listeners.forEach((cb) => cb(external ?? current));

  const set = (s: AuthSession | null) => {
    current = s;
    try {
      if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
      else localStorage.removeItem(SESSION_KEY);
    } catch {
      /* ignore */
    }
    emit();
  };

  const refresh = async (): Promise<void> => {
    if (!current?.refreshToken) return set(null);
    try {
      const res = await http(cfg, "/auth/v1/token?grant_type=refresh_token", {
        method: "POST",
        body: JSON.stringify({ refresh_token: current.refreshToken }),
      });
      if (!res.ok) return set(null);
      const json = (await res.json()) as { access_token: string; refresh_token: string };
      set(sessionFromToken(json.access_token, json.refresh_token));
    } catch {
      /* keep the old session; network may be down */
    }
  };

  // Refresh a minute before expiry, and once on load if already expired.
  if (current?.expiresAt && current.expiresAt * 1000 - Date.now() < 60_000) void refresh();
  if (typeof window !== "undefined") {
    setInterval(() => {
      if (current?.expiresAt && current.expiresAt * 1000 - Date.now() < 120_000) void refresh();
    }, 60_000);
  }

  return {
    /** Effective session: external (Casanova SSO) takes priority over own. */
    session: () => external ?? current,
    async signIn(email, password) {
      try {
        const res = await http(cfg, "/auth/v1/token?grant_type=password", {
          method: "POST",
          body: JSON.stringify({ email, password }),
        });
        if (!res.ok) return { data: null, error: await toError(res) };
        const json = (await res.json()) as { access_token: string; refresh_token: string };
        const s = sessionFromToken(json.access_token, json.refresh_token);
        set(s);
        return { data: s, error: null };
      } catch (e) {
        return { data: null, error: toMaestroError(e) };
      }
    },
    async signOut() {
      external = null;
      const token = current?.accessToken;
      set(null);
      if (token) {
        try {
          await http(cfg, "/auth/v1/logout", { method: "POST", token });
        } catch {
          /* local sign-out already done */
        }
      }
    },
    onChange(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    /** Accept a Casanova Supabase session so Maestro inherits staff access. */
    injectSession(s: AuthSession | null) {
      external = s;
      emit();
    },
  };
}

function filterQuery(opts: ListOptions): string {
  const p: string[] = [];
  for (const [k, v] of Object.entries(opts.filter ?? {})) {
    p.push(`${encodeURIComponent(k)}=${v === null ? "is.null" : `eq.${encodeURIComponent(String(v))}`}`);
  }
  if (opts.orderBy) p.push(`order=${encodeURIComponent(opts.orderBy)}.${opts.orderDir === "asc" ? "asc" : "desc"}`);
  if (opts.limit) p.push(`limit=${opts.limit}`);
  return p.length ? `?${p.join("&")}` : "";
}

function sbCollection<T extends Base>(cfg: Cfg, auth: AuthConnector, table: string): Collection<T> {
  const token = () => auth.session()?.accessToken ?? null;
  const isStaff = () => STAFF_ROLES.includes(auth.session()?.role as Role);

  return {
    async list(opts = {}) {
      try {
        const res = await http(cfg, `/rest/v1/${table}${filterQuery(opts)}`, { token: token() });
        if (!res.ok) return { data: null, error: await toError(res) };
        return { data: (await res.json()) as T[], error: null };
      } catch (e) {
        return { data: null, error: toMaestroError(e) };
      }
    },
    async get(id: ID) {
      try {
        const res = await http(cfg, `/rest/v1/${table}?id=eq.${encodeURIComponent(id)}&limit=1`, { token: token() });
        if (!res.ok) return { data: null, error: await toError(res) };
        const rows = (await res.json()) as T[];
        return rows[0] ? { data: rows[0], error: null } : { data: null, error: new MaestroError("Not found", { code: "not_found" }) };
      } catch (e) {
        return { data: null, error: toMaestroError(e) };
      }
    },
    async create(input: NewRecord<T>) {
      const ts = new Date().toISOString();
      const row = { ...input, id: input.id ?? uuid(), created_at: ts, updated_at: ts } as unknown as T;
      try {
        const res = await http(cfg, `/rest/v1/${table}`, {
          method: "POST",
          token: token(),
          headers: { Prefer: isStaff() ? "return=representation" : "return=minimal" },
          body: JSON.stringify(row),
        });
        if (!res.ok) return { data: null, error: await toError(res) };
        if (isStaff()) {
          const rows = (await res.json()) as T[];
          return { data: rows[0] ?? row, error: null };
        }
        return { data: row, error: null };
      } catch (e) {
        return { data: null, error: toMaestroError(e) };
      }
    },
    async update(id: ID, patch: Partial<T>) {
      try {
        const res = await http(cfg, `/rest/v1/${table}?id=eq.${encodeURIComponent(id)}`, {
          method: "PATCH",
          token: token(),
          headers: { Prefer: "return=representation" },
          body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }),
        });
        if (!res.ok) return { data: null, error: await toError(res) };
        const rows = (await res.json()) as T[];
        return rows[0] ? { data: rows[0], error: null } : { data: null, error: new MaestroError("Not found or not allowed", { code: "forbidden" }) };
      } catch (e) {
        return { data: null, error: toMaestroError(e) };
      }
    },
    async delete(id: ID) {
      try {
        const res = await http(cfg, `/rest/v1/${table}?id=eq.${encodeURIComponent(id)}`, { method: "DELETE", token: token() });
        if (!res.ok) return { data: null, error: await toError(res) };
        return { data: null, error: null };
      } catch (e) {
        return { data: null, error: toMaestroError(e) };
      }
    },
    async upsert(input: NewRecord<T> & { id: ID }) {
      const ts = new Date().toISOString();
      const row = { ...input, updated_at: ts } as unknown as T;
      try {
        const res = await http(cfg, `/rest/v1/${table}?on_conflict=id`, {
          method: "POST",
          token: token(),
          headers: { Prefer: "resolution=merge-duplicates,return=representation" },
          body: JSON.stringify(row),
        });
        if (!res.ok) return { data: null, error: await toError(res) };
        const rows = (await res.json()) as T[];
        return { data: rows[0] ?? row, error: null };
      } catch (e) {
        return { data: null, error: toMaestroError(e) };
      }
    },
  };
}

export function createSupabaseConnector(cfg: Cfg): MaestroConnector {
  const auth = supabaseAuth(cfg);
  const media = sbCollection<MediaItem>(cfg, auth, "media");
  return {
    name: "supabase",
    shared: true,
    products: sbCollection<GenericRecord>(cfg, auth, "products"),
    categories: sbCollection<GenericRecord>(cfg, auth, "categories"),
    cms_sections: sbCollection<GenericRecord>(cfg, auth, "cms_sections"),
    cms_pages: sbCollection<GenericRecord>(cfg, auth, "cms_pages"),
    cms_categories: sbCollection<GenericRecord>(cfg, auth, "cms_categories"),
    testimonials: sbCollection<GenericRecord>(cfg, auth, "testimonials"),
    faqs: sbCollection<GenericRecord>(cfg, auth, "faqs"),
    coupons: sbCollection<GenericRecord>(cfg, auth, "coupons"),
    orders: sbCollection<GenericRecord>(cfg, auth, "orders"),
    users: sbCollection<GenericRecord>(cfg, auth, "users"),
    audit: sbCollection(cfg, auth, "maestro_audit_log"),
    settings: sbCollection(cfg, auth, "platform_settings"),
    content: sbCollection(cfg, auth, "site_content"),
    media,
    auth,
    async uploadMedia(file: File, alt = ""): Promise<MaestroResult<MediaItem>> {
      try {
        const img = await prepareImage(file);
        const path = `${uuid()}.${img.ext}`;
        const res = await http(cfg, `/storage/v1/object/media/${path}`, {
          method: "POST",
          token: auth.session()?.accessToken ?? null,
          headers: { "Content-Type": img.type, "x-upsert": "false" },
          body: img.blob,
        });
        if (!res.ok) return { data: null, error: await toError(res) };
        const url = `${cfg.url}/storage/v1/object/public/media/${path}`;
        return media.create({ name: file.name, url, size: img.blob.size, width: img.width, height: img.height, alt } as NewRecord<MediaItem>);
      } catch (e) {
        return { data: null, error: toMaestroError(e) };
      }
    },
    async health(): Promise<MaestroResult<{ ok: boolean; connector: string }>> {
      try {
        const res = await http(cfg, "/rest/v1/platform_settings?limit=1");
        return res.ok ? { data: { ok: true, connector: "supabase" }, error: null } : { data: null, error: await toError(res) };
      } catch (e) {
        return { data: null, error: toMaestroError(e) };
      }
    },
  };
}
