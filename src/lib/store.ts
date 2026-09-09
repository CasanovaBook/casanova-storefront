/* ─────────────────────────────────────────────────────────────
 * React binding for the persistence layer.
 *
 * `getDb()` returns a new object reference on every write, so
 * `useSyncExternalStore` gives every consumer a re-render without
 * any provider, selector boilerplate or duplicated local state.
 * ───────────────────────────────────────────────────────────── */

import { useSyncExternalStore } from "react"

import { getDb, initCrossTabSync, subscribe, type Database } from "./db"

/** Live database snapshot. Re-renders on any write, in this tab or another. */

export function useStore(): Database {
  return useSyncExternalStore(subscribe, getDb, getDb)
}

let crossTabStarted = false

/**
 * Starts listening for changes made in other tabs. Safe to call more than
 * once — only the first call registers a listener.
 */

export function ensureCrossTabSync(): void {
  if (crossTabStarted) return

  crossTabStarted = true

  initCrossTabSync()
}
