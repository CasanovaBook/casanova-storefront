import {
  errorResponse,
  getClientIp,
  jsonResponse,
  readLoginRequest,
} from "./http.ts"
import { hashIdentifier, type RateLimiter } from "./rate-limit.ts"
import type { AuthenticateResult } from "./supabase-auth.ts"
import type { TurnstileVerification } from "./turnstile.ts"

export interface LoginHandlerDeps {
  limiter: RateLimiter
  authenticate: (email: string, password: string) => Promise<AuthenticateResult>
  verifyCaptcha: (
    token: string,
    ip: string | null,
  ) => Promise<TurnstileVerification>
  pepper?: string
  log?: (event: string) => void
}

function rateLimitedResponse(retryAfterSeconds: number): Response {
  return errorResponse(
    "RATE_LIMITED",
    429,
    { retryAfterSeconds },
    { "Retry-After": String(retryAfterSeconds) },
  )
}

/**
 * Factory rather than a module-level handler, so the ordering rules can be
 * tested with fakes. The only path that reaches Supabase Auth is one that has
 * passed both the IP limit and, when required, Turnstile verification.
 */
export function createLoginHandler(
  deps: LoginHandlerDeps,
): (request: Request) => Promise<Response> {
  const pepper = deps.pepper ?? process.env.RATE_LIMIT_PEPPER ?? ""
  const log = deps.log ?? (() => {})

  return async function loginHandler(request: Request): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: { "Cache-Control": "no-store" },
      })
    }

    if (request.method !== "POST") {
      return errorResponse(
        "VALIDATION",
        405,
        {},
        { Allow: "POST, OPTIONS" },
      )
    }

    const parsed = await readLoginRequest(request)
    if (!parsed.ok) return parsed.response

    const ip = getClientIp(request)
    if (!ip) log("missing_client_ip")

    const ipHash = ip ? await hashIdentifier(ip, pepper) : null
    const accountHash = await hashIdentifier(parsed.data.email, pepper)

    const ipDecision = await deps.limiter.checkIp(ipHash)
    if (ipDecision.blocked) {
      log("ip_rate_limited")
      return rateLimitedResponse(ipDecision.retryAfterSeconds ?? 300)
    }

    const accountFailures = await deps.limiter.getAccountFailures(
      ipHash,
      accountHash,
    )

    if (accountFailures >= 3) {
      const token = parsed.data.turnstileToken?.trim()

      if (!token) {
        log("captcha_required")
        return errorResponse("CAPTCHA_REQUIRED", 428, {
          captchaRequired: true,
        })
      }

      const captcha = await deps.verifyCaptcha(token, ip)

      if (!captcha.available) {
        log("captcha_unavailable")
        return errorResponse("CAPTCHA_UNAVAILABLE", 503)
      }

      if (!captcha.ok) {
        await deps.limiter.recordCaptchaFailure(ipHash)
        const attempts = await deps.limiter.checkCaptchaAttempts(ipHash)

        if (attempts.blocked) {
          log("captcha_attempts_limited")
          return rateLimitedResponse(attempts.retryAfterSeconds ?? 300)
        }

        log("captcha_failed")
        return errorResponse("CAPTCHA_FAILED", 400, {
          captchaRequired: true,
        })
      }
    }

    const auth = await deps.authenticate(
      parsed.data.email,
      parsed.data.password,
    )

    if (auth.ok) {
      await deps.limiter.clearAccount(ipHash, accountHash)
      return jsonResponse(auth.session, 200)
    }

    if (auth.code === "AUTH_UNAVAILABLE") {
      log("auth_unavailable")
      return errorResponse("AUTH_UNAVAILABLE", 503)
    }

    if (auth.code === "RATE_LIMITED") {
      log("upstream_rate_limited")
      return rateLimitedResponse(auth.retryAfterSeconds ?? 300)
    }

    /* A malformed upstream response is not a credential failure: do not
     * punish the account or advance the IP window. */
    if (
      auth.code !== "INVALID_CREDENTIALS" &&
      auth.code !== "EMAIL_UNCONFIRMED" &&
      auth.code !== "ACCOUNT_BLOCKED"
    ) {
      log("auth_unavailable")
      return errorResponse("AUTH_UNAVAILABLE", 503)
    }

    const failures = await deps.limiter.recordFailure(ipHash, accountHash)
    const captchaRequired = failures.captchaRequired

    if (auth.code === "EMAIL_UNCONFIRMED") {
      log("email_unconfirmed")
      return errorResponse("EMAIL_UNCONFIRMED", 401, {
        isUnconfirmed: true,
        captchaRequired,
      })
    }

    if (auth.code === "ACCOUNT_BLOCKED") {
      log("account_blocked")
      return errorResponse("ACCOUNT_BLOCKED", 403, {
        captchaRequired,
      })
    }

    log("invalid_credentials")
    return errorResponse("INVALID_CREDENTIALS", 401, {
      captchaRequired,
    })
  }
}
