/* ─────────────────────────────────────────────────────────────
 * Forced sign-out.
 *
 * One sequence, in one order, that cannot be interrupted by its own failure.
 *
 * The order is the whole design. Everything that destroys this browser's
 * ability to keep reading happens synchronously, first. The network call that
 * asks Supabase to revoke the token happens last and is allowed to fail -
 * because a teardown that awaits a request before it clears local state is a
 * teardown that does not happen when the request fails, and the reader is
 * left signed in on a device that was just disconnected. That was a real bug
 * in the first version of this flow.
 *
 * What "forced" means here, stated honestly: a browser tab is not a
 * security boundary. Somebody with devtools open can block a redirect, and
 * nothing written in this file can prevent that. What makes a revoked device
 * actually inert is the session check in the reader-content function, which
 * refuses the byte range whether or not this browser cooperates. This module
 * is the client keeping its word; that is the server keeping ours.
 * ───────────────────────────────────────────────────────────── */

import { purgePdfEngine } from "../components/pdf/pdf-engine"
import { DB_KEY, getDb, mutate } from "../data/db"
import { SESSION_KEY } from "./auth"
import { signOutUser } from "../integrations/supabase/supabase-auth"

/** Why the reader was signed out, so the login page can say so. */
export type SignOutReason = "self_disconnect" | "blocked" | "session_gone"

export const SIGNED_OUT_PARAM = "signed_out"

/**
 * Keys that can resume a session, or hand a token to whoever sits down next.
 *
 * Enumerated rather than "clear everything", because clearing everything is
 * both destructive and wrong: `casanova_db_v1` is the entire application
 * database in local mode, and erasing cookie consent, theme and accessibility
 * settings punishes the next person at this keyboard for something the
 * previous one did. Those keys are not credentials.
 */
const SESSION_BEARING_KEYS = [
  SESSION_KEY,
  "casanova.maestro.v1.session",
  "casanova.maestro.supabase.session",
  "casanova_checkout_intent_v1",
]

/** supabase-js stores the session under `sb-<project>-auth-token`, and may
 *  hold numbered variants. Matched by pattern because the project ref is not
 *  a constant this module can import without pulling in the env layer. */
function isSupabaseAuthKey(key: string): boolean {
  return /^sb-[^-]+-auth-token(-\d+)?$/.test(key)
}

/**
 * Drops this account's device rows and content grants from the local mirror.
 *
 * A grant is a live, use-budgeted address to a book, and a device row is the
 * proof this browser holds a slot. Both survive in localStorage otherwise,
 * and neither is anything a signed-out browser should still be carrying.
 */
function purgeAccountRecords(userId: string | null): void {
  if (!userId) return

  const db = getDb()

  const hasRows =
    db.device_sessions.some((s) => s.user_id === userId) ||
    db.content_grants.some((g) => g.user_id === userId)

  if (!hasRows) return

  mutate((draft) => {
    draft.device_sessions = draft.device_sessions.filter(
      (s) => s.user_id !== userId,
    )
    draft.content_grants = draft.content_grants.filter(
      (g) => g.user_id !== userId,
    )
  })
}

function clearSessionStorage(): void {
  for (const key of SESSION_BEARING_KEYS) {
    try {
      localStorage.removeItem(key)
    } catch {
      /* A storage that throws (private mode, quota) cannot stop the teardown.
       * The redirect below still happens, and the server check still refuses. */
    }
  }

  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i)

      if (key && isSupabaseAuthKey(key)) localStorage.removeItem(key)
    }
  } catch {
    /* Same: best effort, never fatal. */
  }
}

/**
 * Destroy this browser's reading state and leave the application.
 *
 * Never rejects. Callers can await it, but nothing depends on it succeeding,
 * and the final act is a full-page navigation - which discards the React tree,
 * its state and any pending effect, rather than trusting them to unwind
 * politely while being torn down.
 */
export async function forceSignOut(
  reason: SignOutReason,
  userId: string | null,
): Promise<void> {
  try {
    // 1. The book itself: parsed documents and rendered page bitmaps.
    purgePdfEngine()

    // 2. This account's slots and grants in the mirrored document.
    purgeAccountRecords(userId)

    // 3. Every key that could resume the session.
    clearSessionStorage()
  } catch {
    // The redirect below is the point; nothing here may prevent it.
  }

  // 4. Ask the server to revoke the token. Last, and allowed to fail.
  try {
    await signOutUser()
  } catch {
    /* An unreachable auth server is not a reason to keep a revoked device
     * signed in locally. The row is closed, the storage is gone, and the
     * content edge will refuse this session on the next request regardless. */
  }

  // 5. Leave. `replace` so the back button cannot return to a live app.
  const target = `/login?${SIGNED_OUT_PARAM}=${reason}`

  try {
    window.location.replace(target)
  } catch {
    /* test/jsdom environments without navigation */
  }
}

/** The DB document key, re-exported so tests can assert what survived. */
export const DOCUMENT_KEY = DB_KEY
