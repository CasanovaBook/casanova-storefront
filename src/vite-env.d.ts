/// <reference types="vite/client" />

/**
 * Typed shape of the environment variables this app reads at build
 * time. Only `VITE_`-prefixed values are exposed to the browser; the
 * `service_role` key is intentionally absent here because it must
 * never reach client code.
 */
interface ImportMetaEnv {
  /** Supabase project URL, e.g. https://<ref>.supabase.co */
  readonly VITE_SUPABASE_URL?: string
  /** Client-safe publishable/anon key. Safe to ship to the browser. */
  readonly VITE_SUPABASE_ANON_KEY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
