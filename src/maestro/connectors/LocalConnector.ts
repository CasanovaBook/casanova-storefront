/**
 * Maestro Core — local connector (default, no secrets required).
 *
 * Persists to the visitor's own localStorage, so it is meant for development,
 * demos and Figma preview. Data submitted this way is NOT visible to staff
 * on another device — set VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY for
 * production (see schema.sql).
 *
 * Uses the same `casanova_db_v1` localStorage key as the rest of the app
 * so local development shares state with the existing CMS.
 */

import { MaestroError, toMaestroError } from "../core/errors";
import type { AuthSession, Base, ID, ListOptions, MaestroResult, MediaItem, NewRecord, Role } from "../core/types";
import { blobToDataUrl, prepareImage } from "../core/image";
import type { AuthConnector, Collection, GenericRecord, MaestroConnector } from "./MaestroConnector";

const PREFIX = "casanova.maestro.v1.";

const uuid = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

const nowIso = () => new Date().toISOString();

const ok = <T>(data: T): MaestroResult<T> => ({ data, error: null });
const fail = <T>(err: unknown): MaestroResult<T> => ({ data: null, error: toMaestroError(err) });

function read<T>(table: string): T[] {
  try {
    const raw = localStorage.getItem(PREFIX + table);
    if (raw) return JSON.parse(raw) as T[];
  } catch {
    /* storage blocked or corrupted: fall through to empty */
  }
  return [];
}

function write<T>(table: string, rows: T[]): void {
  try {
    localStorage.setItem(PREFIX + table, JSON.stringify(rows));
  } catch {
    /* quota / blocked: keep in-memory copy only */
  }
}

const memory = new Map<string, unknown[]>();

function localCollection<T extends Base>(table: string, uniqueKeys: (keyof T)[] = []): Collection<T> {
  const rows = (): T[] => {
    if (!memory.has(table)) memory.set(table, read<T>(table));
    return memory.get(table) as T[];
  };
  const save = (next: T[]) => {
    memory.set(table, next);
    write(table, next);
  };

  return {
    async list(opts: ListOptions = {}) {
      try {
        let out = rows().filter((r) => Object.entries(opts.filter ?? {}).every(([k, v]) => (r as Record<string, unknown>)[k] === v));
        if (opts.orderBy) {
          const key = opts.orderBy;
          const dir = opts.orderDir === "asc" ? 1 : -1;
          out = out.slice().sort((a, b) => {
            const av = (a as Record<string, unknown>)[key] as string | number | null;
            const bv = (b as Record<string, unknown>)[key] as string | number | null;
            if (av === bv) return 0;
            if (av == null) return 1;
            if (bv == null) return -1;
            return av < bv ? -dir : dir;
          });
        }
        if (opts.limit) out = out.slice(0, opts.limit);
        return ok(out);
      } catch (e) {
        return fail(e);
      }
    },
    async get(id: ID) {
      const row = rows().find((r) => r.id === id);
      return row ? ok(row) : fail(new MaestroError("Not found", { code: "not_found" }));
    },
    async create(input: NewRecord<T>) {
      try {
        const current = rows();
        for (const key of uniqueKeys) {
          const value = (input as Record<string, unknown>)[key as string];
          if (value != null && current.some((r) => (r as Record<string, unknown>)[key as string] === value)) {
            return fail(new MaestroError(`Duplicate ${String(key)}`, { code: "23505" }));
          }
        }
        const ts = nowIso();
        const row = { ...input, id: input.id ?? uuid(), created_at: ts, updated_at: ts } as unknown as T;
        save([...current, row]);
        return ok(row);
      } catch (e) {
        return fail(e);
      }
    },
    async update(id: ID, patch: Partial<T>) {
      const current = rows();
      const idx = current.findIndex((r) => r.id === id);
      if (idx === -1) return fail(new MaestroError("Not found", { code: "not_found" }));
      const next = { ...current[idx], ...patch, id, updated_at: nowIso() } as T;
      const copy = current.slice();
      copy[idx] = next;
      save(copy);
      return ok(next);
    },
    async delete(id: ID) {
      save(rows().filter((r) => r.id !== id));
      return ok(null);
    },
    async upsert(input: NewRecord<T> & { id: ID }) {
      try {
        const current = rows();
        const idx = current.findIndex((r) => r.id === input.id);
        const ts = nowIso();
        if (idx === -1) {
          const row = { ...input, created_at: ts, updated_at: ts } as unknown as T;
          save([...current, row]);
          return ok(row);
        }
        const row = { ...current[idx], ...input, updated_at: ts } as T;
        const copy = current.slice();
        copy[idx] = row;
        save(copy);
        return ok(row);
      } catch (e) {
        return fail(e);
      }
    },
  };
}

// ── Auth (development only) ──────────────────────────────────────────────────

const SESSION_KEY = PREFIX + "session";

/** Local admin login exists only in dev builds (or when VITE_DEV_ADMIN_PASSWORD is set explicitly). */
const devPassword: string | null =
  (import.meta.env as Record<string, string | undefined>).VITE_DEV_ADMIN_PASSWORD || (import.meta.env as Record<string, unknown>).DEV ? "casanova-admin" : null;

function localAuth(): AuthConnector {
  const listeners = new Set<(s: AuthSession | null) => void>();
  let current: AuthSession | null = null;
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (raw) current = JSON.parse(raw) as AuthSession;
  } catch {
    /* ignore */
  }
  const emit = () => listeners.forEach((cb) => cb(current));

  return {
    session: () => current,
    async signIn(email, password) {
      if (!devPassword) {
        return fail(new MaestroError("Admin sign-in is unavailable: the backend is not configured.", { code: "auth_disabled" }));
      }
      if (!email || password !== devPassword) {
        return fail(new MaestroError("Invalid email or password", { code: "invalid_credentials" }));
      }
      current = { user: { id: "local-admin", email }, role: "SUPER_ADMIN" as Role };
      try {
        sessionStorage.setItem(SESSION_KEY, JSON.stringify(current));
      } catch {
        /* ignore */
      }
      emit();
      return ok(current);
    },
    async signOut() {
      current = null;
      try {
        sessionStorage.removeItem(SESSION_KEY);
      } catch {
        /* ignore */
      }
      emit();
    },
    onChange(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
}

export function createLocalConnector(): MaestroConnector {
  const media = localCollection<MediaItem>("media");
  return {
    name: "local",
    shared: false,
    products: localCollection<GenericRecord>("products", ["slug"]),
    categories: localCollection<GenericRecord>("categories", ["slug"]),
    cms_sections: localCollection<GenericRecord>("cms_sections"),
    cms_pages: localCollection<GenericRecord>("cms_pages", ["slug"]),
    cms_categories: localCollection<GenericRecord>("cms_categories", ["slug"]),
    testimonials: localCollection<GenericRecord>("testimonials"),
    faqs: localCollection<GenericRecord>("faqs"),
    coupons: localCollection<GenericRecord>("coupons", ["code"]),
    orders: localCollection<GenericRecord>("orders", ["order_number"]),
    users: localCollection<GenericRecord>("users", ["email"]),
    audit: localCollection("audit_log"),
    settings: localCollection("settings"),
    content: localCollection("site_content"),
    media,
    auth: localAuth(),
    async uploadMedia(file: File, alt = "") {
      try {
        const img = await prepareImage(file);
        const url = await blobToDataUrl(img.blob);
        return media.create({ name: file.name, url, size: img.blob.size, width: img.width, height: img.height, alt } as NewRecord<MediaItem>);
      } catch (e) {
        return fail(e);
      }
    },
    async health() {
      return ok({ ok: true, connector: "local" });
    },
  };
}
