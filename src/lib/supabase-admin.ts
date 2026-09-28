/* ─────────────────────────────────────────────────────────────
 * Admin actions that need the service_role key, and therefore live
 * behind a Supabase Edge Function.
 *
 * The service_role key must never reach this bundle, so these call
 * `functions.invoke` and receive only the finished artefact — the
 * same arrangement content-storage.ts uses for Storage URLs.
 * ───────────────────────────────────────────────────────────── */

import { fail, ok, type ErrorCode, type Result } from "./api"

import { isSupabaseConfigured, requireSupabase } from "./supabase"

export interface AdminPasswordResetLink {
  /** The full recovery URL, ready to hand to the customer. */
  link: string

  email: string

  expires_at: string
}

/** Mirrors `codeFor` in content-storage.ts so both Edge-Function clients
 *  report failures with the same vocabulary. */
function codeFor(status: number | undefined): ErrorCode {
  if (status === 404) return "NOT_FOUND"

  if (status === 403) return "FORBIDDEN"

  if (status === 401) return "UNAUTHENTICATED"

  if (status === 400) return "VALIDATION"

  return "STORAGE"
}

/**
 * Mints a Supabase recovery link for a customer, without sending mail.
 *
 * The link is a real Supabase action link, not an app token: the customer's
 * password lives in `auth.users`, so only Supabase can authorise a change to
 * it. The local driver's `password_resets` token means nothing on the hosted
 * backend, which is why this replaced it rather than being layered beside it.
 */
export async function createAdminPasswordResetLink(
  userId: string,
): Promise<Result<AdminPasswordResetLink>> {
  if (!isSupabaseConfigured) {
    return fail("PROVIDER_NOT_CONFIGURED", "שרת Supabase אינו מוגדר.")
  }

  try {
    const { data, error } = await requireSupabase().functions.invoke<
      AdminPasswordResetLink
    >("admin-password-reset", { body: { user_id: userId } })

    if (error) {
      /* On a non-2xx supabase-js surfaces a FunctionsHttpError whose
       * `context` is the raw Response, so the function's own Hebrew reason is
       * read back out. Losing it would leave the admin with a bare
       * "Edge Function returned a non-2xx status code" and no idea whether
       * the fault was the user, the permissions, or the deployment. */
      const context = (error as { context?: Response }).context

      let message = error.message
      let status: number | undefined

      if (context) {
        status = context.status

        try {
          const parsed = (await context.json()) as { error?: unknown }

          if (typeof parsed?.error === "string") message = parsed.error
        } catch {
          /* a non-JSON error body keeps the transport message */
        }
      }

      return fail(codeFor(status), message)
    }

    if (!data?.link) {
      return fail("STORAGE", "לא התקבל קישור איפוס מהשרת.")
    }

    return ok(data)
  } catch (err) {
    return fail(
      "STORAGE",
      err instanceof Error ? err.message : "שגיאה ביצירת קישור איפוס.",
    )
  }
}
