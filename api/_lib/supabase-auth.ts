import type {
  LoginErrorCode,
  LoginSuccess,
} from "../../src/shared/auth-login.ts"

export type AuthenticateResult =
  | { ok: true; session: LoginSuccess }
  | {
      ok: false
      code: LoginErrorCode
      isUnconfirmed?: boolean
      retryAfterSeconds?: number
    }

interface SupabaseErrorBody {
  error?: string
  error_description?: string
  error_code?: string
  code?: string | number
  msg?: string
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.toLowerCase() : ""
}

function parseRetryAfter(response: Response): number {
  const header = Number(response.headers.get("retry-after") ?? "")
  return Number.isFinite(header) && header > 0 ? header : 300
}

/**
 * Password grant through Supabase Auth. This endpoint never uses the service
 * role; it uses the public anon key exactly as the browser did before the
 * login was moved behind rate limiting.
 */
export async function authenticateWithSupabase(
  email: string,
  password: string,
): Promise<AuthenticateResult> {
  const url =
    process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? ""
  const anonKey =
    process.env.SUPABASE_ANON_KEY ??
    process.env.VITE_SUPABASE_ANON_KEY ??
    ""

  if (!url || !anonKey) {
    return { ok: false, code: "AUTH_UNAVAILABLE" }
  }

  let response: Response

  try {
    response = await fetch(
      `${url.replace(/\/+$/, "")}/auth/v1/token?grant_type=password`,
      {
        method: "POST",
        headers: {
          apikey: anonKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email, password }),
        signal: AbortSignal.timeout(10_000),
      },
    )
  } catch {
    return { ok: false, code: "AUTH_UNAVAILABLE" }
  }

  if (response.ok) {
    const body = (await response.json().catch(() => null)) as
      | Partial<LoginSuccess>
      | null

    if (
      !body ||
      typeof body.access_token !== "string" ||
      typeof body.refresh_token !== "string"
    ) {
      return { ok: false, code: "AUTH_UNAVAILABLE" }
    }

    return {
      ok: true,
      session: {
        access_token: body.access_token,
        refresh_token: body.refresh_token,
        expires_in:
          typeof body.expires_in === "number" ? body.expires_in : 3600,
        token_type:
          typeof body.token_type === "string" ? body.token_type : "bearer",
      },
    }
  }

  if (response.status === 429) {
    return {
      ok: false,
      code: "RATE_LIMITED",
      retryAfterSeconds: parseRetryAfter(response),
    }
  }

  if (response.status >= 500) {
    return { ok: false, code: "AUTH_UNAVAILABLE" }
  }

  const body = (await response.json().catch(() => null)) as
    | SupabaseErrorBody
    | null

  if (!body) return { ok: false, code: "AUTH_UNAVAILABLE" }

  const message = [
    body.msg,
    body.error_description,
    body.error,
    body.error_code,
    String(body.code ?? ""),
  ]
    .map(readString)
    .filter(Boolean)
    .join(" ")

  if (
    message.includes("email not confirmed") ||
    message.includes("not confirmed") ||
    message.includes("email_not_confirmed")
  ) {
    return { ok: false, code: "EMAIL_UNCONFIRMED", isUnconfirmed: true }
  }

  if (message.includes("banned")) {
    return { ok: false, code: "ACCOUNT_BLOCKED" }
  }

  if (
    message.includes("invalid login credentials") ||
    message.includes("invalid_credentials") ||
    message.includes("invalid_grant") ||
    response.status === 400 ||
    response.status === 401
  ) {
    return { ok: false, code: "INVALID_CREDENTIALS" }
  }

  return { ok: false, code: "AUTH_UNAVAILABLE" }
}
