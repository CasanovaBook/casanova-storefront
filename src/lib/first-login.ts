/* ─────────────────────────────────────────────────────────────
 * Per-account first-login greeting.
 *
 * The dashboard greets a customer differently on the visit that
 * follows their first sign-in ("ברוך הבא") than on every visit
 * after it ("ברוך שובך"). That fact belongs to the ACCOUNT, not to
 * the browser — a customer who signs in on a phone after using a
 * desktop is a returning customer and must be greeted as one.
 *
 * The two existing columns cannot answer the question, which is why
 * migrations/0004_first_login_greeting.sql adds `users.greeted_at`:
 *
 *   • `public.users.last_login_at` is NULL for every Supabase
 *     account. Only the legacy local-driver path in `api.ts` writes
 *     it, so on the hosted backend it carries no history.
 *   • `authUser.last_sign_in_at` is set by Supabase on the very first
 *     sign-in too. By the time it is readable it is already true for
 *     the login happening right now, so it can never separate the
 *     first login from the second.
 *
 * `greeted_at` is therefore written once, on the first dashboard view,
 * and read forever after.
 *
 * THE CLAIM IS ATOMIC, AND THAT IS THE WHOLE POINT. This is a single
 * conditional UPDATE that returns a row only for the caller that
 * actually set the value:
 *
 *   UPDATE public.users SET greeted_at = NOW()
 *    WHERE user_id = $1 AND greeted_at IS NULL
 *   RETURNING user_id
 *
 * A row comes back → this call was first → "ברוך הבא". No row →
 * somebody already greeted this account → "ברוך שובך". Because the
 * NULL test and the write are one statement, two devices opening the
 * dashboard simultaneously cannot both win: the second UPDATE
 * matches nothing. Reading greeted_at and then writing it back would
 * have exactly that race, and on a phone-and-desktop pair it is not
 * theoretical.
 *
 * The update is scoped to `user_id = auth.uid()` server-side by RLS
 * (see the policy this migration installs), so a client cannot greet
 * somebody else's account by passing a different id.
 * ───────────────────────────────────────────────────────────── */

import { isSupabaseConfigured, requireSupabase } from "./supabase"
import type { User } from "../types"

/* Without a backend there is no account to attach the fact to, so the
 * old per-browser record is the best available answer. This path only
 * runs in local development without Supabase configured. */
const LOCAL_KEY = "casanova_greeted_users"

function claimLocally(userId: string): boolean {
  if (typeof window === "undefined") return false
  try {
    const raw = window.localStorage.getItem(LOCAL_KEY)
    const seen: Record<string, true> = raw ? JSON.parse(raw) : {}
    if (seen && typeof seen === "object" && seen[userId]) return false
    window.localStorage.setItem(
      LOCAL_KEY,
      JSON.stringify({ ...(seen ?? {}), [userId]: true }),
    )
    return true
  } catch {
    /* Private mode or corrupted value. Never let a cosmetic greeting
     * break the dashboard. */
    return false
  }
}

/**
 * Resolves whether this is the account's first dashboard view, and
 * records the fact so no later visit — on any device — repeats it.
 *
 * Returns `true` only for the caller that won the claim. Safe to call
 * from a render path: it never throws, and a failed write degrades to
 * the returning-customer greeting rather than a broken page.
 */
export async function claimFirstLogin(
  userId: string | undefined,
): Promise<boolean> {
  if (!userId) return false
  if (!isSupabaseConfigured) return claimLocally(userId)

  try {
    const client = requireSupabase()
    const { data, error } = await client
      .from("users")
      .update({ greeted_at: new Date().toISOString() })
      .eq("user_id", userId)
      .is("greeted_at", null)
      .select("user_id")
      .maybeSingle()

    if (error) {
      /* Most likely RLS is not enabled on `users` yet, or this anon key
       * may not write the column. Falling back keeps the page usable;
       * the greeting simply becomes per-browser until the policy in
       * 0004 is applied. */
      console.warn("[first-login] claim failed:", error.message)
      return claimLocally(userId)
    }

    /* A row back means this statement is the one that set greeted_at. */
    return Boolean(data)
  } catch {
    return claimLocally(userId)
  }
}

/**
 * Reads the flag without claiming it, for callers that need to know
 * the state without consuming the first-login greeting.
 */
export async function hasBeenGreeted(
  user: User | null,
): Promise<boolean> {
  if (!user) return false
  if (!isSupabaseConfigured) return !claimLocallyReadOnly(user.user_id)

  try {
    const client = requireSupabase()
    const { data, error } = await client
      .from("users")
      .select("greeted_at")
      .eq("user_id", user.user_id)
      .maybeSingle()
    if (error) return false
    return Boolean(data?.greeted_at)
  } catch {
    return false
  }
}

function claimLocallyReadOnly(userId: string): boolean {
  if (typeof window === "undefined") return false
  try {
    const raw = window.localStorage.getItem(LOCAL_KEY)
    const seen: Record<string, true> = raw ? JSON.parse(raw) : {}
    return Boolean(seen?.[userId])
  } catch {
    return false
  }
}

/** Support/testing helper: forget the local fallback record. */
export function resetFirstLoginTracking(): void {
  if (typeof window === "undefined") return
  try {
    window.localStorage.removeItem(LOCAL_KEY)
  } catch {
    /* see claimLocally */
  }
}