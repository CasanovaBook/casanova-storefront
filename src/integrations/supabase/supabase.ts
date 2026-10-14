/* ─────────────────────────────────────────────────────────────
 * Supabase client — the single browser-facing connection to the
 * hosted Postgres/Auth/Storage backend.
 *
 * Only the two client-safe values are read here, and only through
 * `VITE_`-prefixed variables, because Vite inlines every `VITE_`
 * value into the public bundle at build time:
 *
 *   • VITE_SUPABASE_URL      — the project URL
 *   • VITE_SUPABASE_ANON_KEY — the publishable/anon key, which is
 *     meant to ship to the browser and is only as powerful as the
 *     Row Level Security policies allow.
 *
 * The `service_role` key is deliberately NOT referenced anywhere in
 * this module or any client code. It bypasses RLS entirely, so it
 * belongs on a trusted server only. It is kept in `.env.local`
 * without the `VITE_` prefix so it can never be inlined into a
 * browser bundle. See `.env.example`.
 * ───────────────────────────────────────────────────────────── */

import { createClient, type SupabaseClient } from "@supabase/supabase-js"

const url = import.meta.env.VITE_SUPABASE_URL

const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

/**
 * True when both client-safe variables are present. Lets the app
 * degrade to its local persistence layer (or show a setup hint)
 * instead of throwing on import when Supabase is not configured yet.
 */

export const isSupabaseConfigured = Boolean(url && anonKey)

/**
 * The shared Supabase client, or `null` when unconfigured.
 *
 * A single instance is reused across the app so auth state, the
 * realtime socket and the fetch pool are not duplicated per call
 * site. Creating the client is cheap and side-effect free; nothing
 * is sent over the network until a query is issued.
 */

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(url as string, anonKey as string, {
      auth: {
        persistSession: true,

        autoRefreshToken: true,

        detectSessionInUrl: true,
      },
    })
  : null

/**
 * Returns the configured client or throws a descriptive error.
 *
 * Use at call sites that genuinely require a live backend so the
 * failure names the missing variable instead of surfacing as an
 * opaque "cannot read property of null".
 */

export function requireSupabase(): SupabaseClient {
  if (!supabase) {
    throw new Error(
      "Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env.local.",
    )
  }

  return supabase
}
