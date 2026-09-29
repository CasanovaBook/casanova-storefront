/* ─────────────────────────────────────────────────────────────
 * Supabase Auth Service
 *
 * Provides typed, clean wrappers around supabase.auth.* methods:
 *   • signInWithEmail
 *   • signUpWithEmail
 *   • signOutUser
 *   • resendVerification
 *   • requestPasswordReset
 *   • updatePassword
 *   • fetchProfile
 * ───────────────────────────────────────────────────────────── */

import type { User as SupabaseAuthUser } from "@supabase/supabase-js"
import { requireSupabase, isSupabaseConfigured } from "./supabase"
import { toPublicUser } from "./auth"
import type { StoredUser, User, Role, AdminRole, AccountStatus } from "../types"

export interface AuthSuccess<T = undefined> {
  ok: true
  data: T
}

export interface AuthFailure {
  ok: false
  error: string
  code?: string
  isUnconfirmed?: boolean
}

export type AuthResult<T = undefined> = AuthSuccess<T> | AuthFailure

export function authOk<T>(data: T): AuthSuccess<T> {
  return { ok: true, data }
}

export function authFail(error: string, code?: string, isUnconfirmed = false): AuthFailure {
  return { ok: false, error, code, isUnconfirmed }
}

/**
 * What a customer is told when their account is not ACTIVE.
 *
 * Shared deliberately: a blocked account can be met on the way in (a fresh
 * sign-in) and on the way back (an existing session being restored), and both
 * paths must say the same thing. The wording invites the customer to contact
 * support, because a suspension may well be a mistake.
 */
export function accountBlockedMessage(status: AccountStatus): string {
  if (status === "DEACTIVATED") {
    return "החשבון שלך סגור. אם לדעתך נפלה טעות, אנא צור קשר עם התמיכה."
  }

  return "החשבון שלך מושהה ואינו יכול להתחבר. אם לדעתך נפלה טעות, אנא צור קשר עם התמיכה."
}

/** Translates Supabase error messages into friendly Hebrew messages. */
export function translateAuthError(err: { message?: string; status?: number; code?: string }): {
  message: string
  isUnconfirmed: boolean
} {
  const msg = err.message || ""
  const lower = msg.toLowerCase()

  if (lower.includes("email not confirmed") || lower.includes("not confirmed")) {
    return {
      message: "כתובת האימייל טרם אומתה. אנא אשר את המייל שנשלח אליך כדי להמשיך.",
      isUnconfirmed: true,
    }
  }

  if (lower.includes("invalid login credentials") || lower.includes("invalid_credentials")) {
    return {
      message: "כתובת אימייל או סיסמה שגויים.",
      isUnconfirmed: false,
    }
  }

  if (lower.includes("user already registered") || lower.includes("already registered") || lower.includes("user_already_exists")) {
    return {
      message: "כבר קיים חשבון עם כתובת אימייל זו.",
      isUnconfirmed: false,
    }
  }

  /* GoTrue's own ban refusal, raised when `auth.users.banned_until` is in the
   * future. It answers with a bare English "User is banned", which would
   * otherwise reach the customer verbatim. */
  if (lower.includes("banned")) {
    return { message: accountBlockedMessage("SUSPENDED"), isUnconfirmed: false }
  }

  if (lower.includes("rate limit") || lower.includes("too many requests") || err.status === 429) {
    return {
      message: "יותר מדי נסיונות. אנא המתן מספר דקות ונסה שוב.",
      isUnconfirmed: false,
    }
  }

  if (lower.includes("password should be at least")) {
    return {
      message: "הסיסמה חייבת להכיל לפחות 8 תווים.",
      isUnconfirmed: false,
    }
  }

  return {
    message: msg || "אירעה שגיאה באימות מול השרת.",
    isUnconfirmed: false,
  }
}

/** The `public.users` columns this app reads, as they arrive over the wire. */
interface UserRow {
  user_id: string
  first_name?: string | null
  last_name?: string | null
  email: string
  phone?: string | null
  role?: string | null
  admin_role?: string | null
  account_status?: string | null
  must_change_password?: boolean | null
  created_at: string
  updated_at: string
  last_login_at?: string | null
  last_activity_at?: string | null
  greeted_at?: string | null
}

/**
 * Maps a `public.users` row onto the app's `User` shape.
 *
 * The dashboard and the users page need exactly the same projection, so
 * it lives here rather than being re-written at each call site. Empty
 * names are tolerated: a row created by a purchase, or by an older app
 * version, may carry none, and the UI falls back to the email for the
 * avatar initial.
 */
function toUserRow(row: UserRow): User {
  return {
    user_id: row.user_id,
    first_name: row.first_name || "",
    last_name: row.last_name || "",
    email: row.email,
    phone: row.phone || undefined,
    role: (row.role || "CUSTOMER") as Role,
    admin_role: (row.admin_role || undefined) as AdminRole | undefined,
    account_status: (row.account_status || "ACTIVE") as AccountStatus,
    must_change_password: Boolean(row.must_change_password),
    created_at: row.created_at,
    updated_at: row.updated_at,
    last_login_at: row.last_login_at || undefined,
    last_activity_at: row.last_activity_at || undefined,
    greeted_at: row.greeted_at ?? null,
  }
}

/** Fetches the public.users profile row for an authenticated user. */
export async function fetchProfile(authUserId: string): Promise<User | null> {
  if (!isSupabaseConfigured) return null
  const client = requireSupabase()

  const { data, error } = await client
    .from("users")
    .select("*")
    .eq("user_id", authUserId)
    .maybeSingle()

  if (error || !data) return null

  return toUserRow(data as UserRow)
}

/**
 * Fetches every row in `public.users` — the source of truth for
 * authenticated accounts.
 *
 * Ordered newest-first by `created_at` so both the dashboard's
 * "משתמשים אחרונים" panel and the users table can render this list
 * directly, with no client-side re-sort that could disagree with it.
 *
 * Returns an empty array when Supabase is unconfigured or the read is
 * refused. The read is gated by the live RLS policies on `public.users`
 * — "Users can view own profile" / "Admins have full access to users",
 * both keyed on `is_admin()`. Callers must treat an empty result as "no
 * remote data", never as "there are no users" — an empty table and a
 * denied query look identical, so the caller falls back to the local
 * store rather than blanking the screen.
 */
export async function fetchAllProfiles(): Promise<User[]> {
  if (!isSupabaseConfigured) return []
  const client = requireSupabase()

  const { data, error } = await client
    .from("users")
    .select("*")
    .order("created_at", { ascending: false })

  if (error) {
    console.warn("[supabase-auth] users list refused:", error.message)
    return []
  }

  return ((data ?? []) as UserRow[]).map(toUserRow)
}

/**
 * Refusals raised by the `admin_set_account_status` RPC.
 *
 * Every one of them is a bare `snake_case` token passed to `RAISE EXCEPTION`
 * (migrations 0011 and 0013), not a sentence. Translating them here is what
 * keeps a machine token off a Hebrew screen — reading only the SQLSTATE left
 * `admin_protected` rendered verbatim in the customer dialog, and reading only
 * the message text would break the moment PostgREST stops echoing it.
 */
const STATUS_REFUSALS: Record<string, { error: string; code: string }> = {
  admin_required: {
    error: "אין הרשאה לעדכן את המשתמש. נדרשת הרשאת מנהל.",
    code: "FORBIDDEN",
  },
  admin_protected: {
    error: "לא ניתן להשהות או לסגור חשבון מנהל.",
    code: "ADMIN_PROTECTED",
  },
  user_not_found: {
    error: "המשתמש לא נמצא.",
    code: "NOT_FOUND",
  },
  invalid_status: {
    error: "סטטוס החשבון המבוקש אינו תקין.",
    code: "VALIDATION",
  },
}

/** Resolves a refused status write to wording an admin can read, or `null`
 * when the error is not one the RPC raises on purpose. */
function describeStatusRefusal(
  code: string,
  message: string,
): { error: string; code: string } | null {
  for (const token of Object.keys(STATUS_REFUSALS)) {
    if (message.includes(token)) return STATUS_REFUSALS[token]
  }

  if (code === "42501") return STATUS_REFUSALS.admin_required
  if (code === "P0002") return STATUS_REFUSALS.user_not_found
  if (code === "22023") return STATUS_REFUSALS.invalid_status

  /* P0001 is the generic SQLSTATE of `RAISE EXCEPTION`. A token this file does
   * not know about yet still must not be shown as-is, so it gets neutral
   * wording while the real token stays visible in the console for diagnosis. */
  if (code === "P0001") {
    console.warn("[supabase-auth] unmapped RPC refusal:", message)
    return {
      error: "הפעולה נדחתה על ידי המערכת. יש לרענן את הרשימה ולנסות שוב.",
      code: "VALIDATION",
    }
  }

  return null
}


/**
 * Admin-only: sets `account_status` on a `public.users` row — the write half
 * of the admin user list.
 *
 * `fetchAllProfiles` above was moved onto Supabase because `db.users` only
 * ever holds records this browser created. The admin *actions* were left
 * behind on the local store, so suspending a real customer resolved that
 * customer locally and failed with "המשתמש לא נמצא." for every account that
 * had actually registered — no matter that the same row was rendering in the
 * list right behind the dialog.
 *
 * This calls the `admin_set_account_status` RPC rather than PATCHing the
 * table. The `authenticated` role holds UPDATE on `greeted_at` only
 * (migration 0004), so a direct write of `account_status` is refused with
 * 42501 before RLS is consulted; and granting the column instead would let a
 * suspended customer reactivate their own row, because RLS is row-level and
 * cannot restrict which column is written. See migrations/0011.
 *
 * Failure codes are mapped rather than passed through, so a refused write is
 * never reported as a missing user. Removing exactly that confusion is what
 * this change is for.
 */
export async function updateAccountStatus(
  userId: string,
  status: AccountStatus,
): Promise<AuthResult<User>> {
  if (!isSupabaseConfigured) return authFail("שרת Supabase אינו מוגדר.")

  const client = requireSupabase()

  const { error } = await client.rpc("admin_set_account_status", {
    p_user_id: userId,
    p_status: status,
  })

  if (error) {
    const refused = describeStatusRefusal(error.code ?? "", error.message ?? "")

    if (refused) return authFail(refused.error, refused.code)

    /* Surfaced verbatim on purpose: this is where "function
     * admin_set_account_status does not exist" appears when migrations/0011
     * has not been applied yet, and masking that would hide the one clue
     * that explains why the button still fails. */
    return authFail(error.message, error.code)
  }

  /* Read the row back so the caller renders what is actually stored rather
   * than the status it asked for. `is_admin()` grants this SELECT, same as
   * the list read. */
  const { data } = await client
    .from("users")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle()

  return data
    ? authOk(toUserRow(data as UserRow))
    : authFail("המשתמש לא נמצא.", "NOT_FOUND")
}

/**
 * Merges the local user store with the Supabase-backed list.
 *
 * `public.users` wins for any `user_id` present in both, because it is
 * the source of truth for authenticated accounts. Local-only rows are
 * kept so an install that predates Supabase — or a browser holding
 * records the remote table does not have — does not suddenly lose data.
 * Deduplication is by `user_id`, so no user can appear twice.
 */
export function mergeUserSources(local: StoredUser[], remote: User[]): User[] {
  const localUsers = local.map(toPublicUser)
  if (remote.length === 0) return localUsers

  const byId = new Map<string, User>()
  for (const u of localUsers) byId.set(u.user_id, u)
  for (const u of remote) byId.set(u.user_id, u)

  return [...byId.values()].sort(
    (a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  )
}

/** Combines auth.users metadata and public.users row into a unified User. */
export function buildAppUser(authUser: SupabaseAuthUser, profile: User | null): User {
  const meta = authUser.user_metadata || {}

  return {
    user_id: authUser.id,
    first_name: profile?.first_name || meta.first_name || "",
    last_name: profile?.last_name || meta.last_name || "",
    email: authUser.email || profile?.email || "",
    phone: profile?.phone || meta.phone || authUser.phone || undefined,
    role: profile?.role || "CUSTOMER",
    admin_role: profile?.admin_role,
    account_status: profile?.account_status || "ACTIVE",
    email_confirmed_at: authUser.email_confirmed_at || null,
    created_at: profile?.created_at || authUser.created_at,
    updated_at: profile?.updated_at || authUser.updated_at || authUser.created_at,
    last_login_at: authUser.last_sign_in_at || profile?.last_login_at,
    greeted_at: profile?.greeted_at ?? null,
  }
}

/** Sign in with email and password. */
export async function signInWithEmail(
  email: string,
  password: string,
): Promise<AuthResult<User>> {
  if (!isSupabaseConfigured) {
    return authFail("שרת Supabase אינו מוגדר.")
  }

  const client = requireSupabase()
  const { data, error } = await client.auth.signInWithPassword({
    email: email.trim().toLowerCase(),
    password,
  })

  if (error) {
    const { message, isUnconfirmed } = translateAuthError(error)
    return authFail(message, error.code, isUnconfirmed)
  }

  if (!data.user) {
    return authFail("לא התקבלו נתוני משתמש.")
  }

  const profile = await fetchProfile(data.user.id)

  /* A suspended account must not get in.
   *
   * `account_status` is this app's own record and GoTrue knows nothing about
   * it, so nothing upstream refuses the password. Without this check the
   * admin's status change was decoration: the customer signed in exactly as
   * before. The session is torn down rather than merely ignored, so they do
   * not walk away holding a valid token for a blocked account.
   *
   * A missing profile row is allowed through — an account can exist without
   * one, and only an explicit status should ever bar the door. */
  if (profile && profile.account_status !== "ACTIVE") {
    await client.auth.signOut()

    return authFail(
      accountBlockedMessage(profile.account_status),
      "ACCOUNT_BLOCKED",
    )
  }

  return authOk(buildAppUser(data.user, profile))
}

export interface SignUpData {
  first_name: string
  last_name: string
  email: string
  password: string
  phone?: string
}

export interface SignUpOutcome {
  user: User | null
  needsEmailConfirmation: boolean
}

/** Register a new user with Supabase Auth. */
export async function signUpWithEmail(input: SignUpData): Promise<AuthResult<SignUpOutcome>> {
  if (!isSupabaseConfigured) {
    return authFail("שרת Supabase אינו מוגדר.")
  }

  const client = requireSupabase()
  /* The confirmation screen, not the library: the user must be told the
   * address is verified before being moved on, and the library's own
   * guard would otherwise redirect a still-restoring session to /login. */
  const redirectUrl = `${window.location.origin}/verify-email`

  const { data, error } = await client.auth.signUp({
    email: input.email.trim().toLowerCase(),
    password: input.password,
    options: {
      data: {
        first_name: input.first_name.trim(),
        last_name: input.last_name.trim(),
        phone: input.phone?.trim() || undefined,
      },
      emailRedirectTo: redirectUrl,
    },
  })

  if (error) {
    const { message } = translateAuthError(error)
    return authFail(message, error.code)
  }

  if (!data.user) {
    return authFail("יצירת המשתמש נכשלה.")
  }

  // If session is null, email confirmation is required by Supabase
  const needsEmailConfirmation = !data.session || !data.user.email_confirmed_at
  const profile = await fetchProfile(data.user.id)
  const appUser = buildAppUser(data.user, profile)

  return authOk({
    user: appUser,
    needsEmailConfirmation,
  })
}

/** Resend signup verification email. */
export async function resendVerification(email: string): Promise<AuthResult<void>> {
  if (!isSupabaseConfigured) {
    return authFail("שרת Supabase אינו מוגדר.")
  }

  const client = requireSupabase()
  /* Must match the signup redirect exactly, or the resend lands the user
   * somewhere other than the confirmation screen. */
  const redirectUrl = `${window.location.origin}/verify-email`

  const { error } = await client.auth.resend({
    type: "signup",
    email: email.trim().toLowerCase(),
    options: {
      emailRedirectTo: redirectUrl,
    },
  })

  if (error) {
    const { message } = translateAuthError(error)
    return authFail(message, error.code)
  }

  return authOk(undefined)
}

/** Request password reset email. */
export async function requestPasswordReset(email: string): Promise<AuthResult<void>> {
  if (!isSupabaseConfigured) {
    return authFail("שרת Supabase אינו מוגדר.")
  }

  const client = requireSupabase()
  const redirectUrl = `${window.location.origin}/setup-password`

  const { error } = await client.auth.resetPasswordForEmail(
    email.trim().toLowerCase(),
    { redirectTo: redirectUrl },
  )

  if (error) {
    const { message } = translateAuthError(error)
    return authFail(message, error.code)
  }

  return authOk(undefined)
}

/** Update the password for the current recovery/authenticated session. */
export async function updatePassword(newPassword: string): Promise<AuthResult<void>> {
  if (!isSupabaseConfigured) {
    return authFail("שרת Supabase אינו מוגדר.")
  }

  const client = requireSupabase()
  const { error } = await client.auth.updateUser({
    password: newPassword,
  })

  if (error) {
    const { message } = translateAuthError(error)
    return authFail(message, error.code)
  }

  return authOk(undefined)
}

/** Sign out from Supabase Auth. */
export async function signOutUser(): Promise<void> {
  if (!isSupabaseConfigured) return
  const client = requireSupabase()
  await client.auth.signOut()
}
