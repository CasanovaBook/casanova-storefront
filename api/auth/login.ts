/**
 * Self-contained Vercel Edge login endpoint.
 *
 * Vercel's Edge bundler rejects relative imports from ../_lib, so the IP
 * limiter, Redis-backed counters, Turnstile verification and Supabase token
 * exchange all live in this file. The only import is a public npm package.
 *
 * The Hebrew messages are duplicated from src/shared/auth-login.ts for the
 * client; keep the two copies in sync when changing wording.
 */

import { Redis } from "@upstash/redis"

/* ── Shared response contract ─────────────────────────────────────────── */

type LoginErrorCode =
  | "INVALID_CREDENTIALS"
  | "RATE_LIMITED"
  | "CAPTCHA_REQUIRED"
  | "CAPTCHA_FAILED"
  | "CAPTCHA_UNAVAILABLE"
  | "AUTH_UNAVAILABLE"
  | "EMAIL_UNCONFIRMED"
  | "ACCOUNT_BLOCKED"
  | "VALIDATION"

interface LoginSuccess {
  access_token: string
  refresh_token: string
  expires_in: number
  token_type: string
}

interface LoginFailure {
  error: string
  code: LoginErrorCode
  retryAfterSeconds?: number
  captchaRequired?: boolean
  isUnconfirmed?: boolean
}

const LOGIN_MESSAGES = {
  INVALID_CREDENTIALS: "שם משתמש או סיסמה שגויים",
  RATE_LIMITED:
    "יותר מדי ניסיונות התחברות. אנא נסה שוב מאוחר יותר",
  CAPTCHA_REQUIRED: "כדי להמשיך, יש להשלים את אימות האבטחה.",
  CAPTCHA_FAILED: "אימות האבטחה נכשל. אנא נסה שוב.",
  CAPTCHA_UNAVAILABLE:
    "אימות האבטחה אינו זמין כרגע. אנא נסה שוב בעוד רגע.",
  AUTH_UNAVAILABLE:
    "שירות ההתחברות אינו זמין כרגע. אנא נסה שוב בעוד רגע.",
  EMAIL_UNCONFIRMED:
    "כתובת האימייל טרם אומתה. אנא אשר את המייל שנשלח אליך כדי להמשיך.",
  ACCOUNT_BLOCKED:
    "החשבון שלך מושהה ואינו יכול להתחבר. אם לדעתך נפלה טעות, אנא צור קשר עם התמיכה.",
  VALIDATION: "הבקשה אינה תקינה.",
} as const satisfies Record<LoginErrorCode, string>

/* ── HTTP helpers ─────────────────────────────────────────────────────── */

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
}

function jsonResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, ...headers },
  })
}

function errorResponse(
  code: LoginErrorCode,
  status: number,
  extra: Partial<LoginFailure> = {},
  headers: Record<string, string> = {},
): Response {
  return jsonResponse(
    {
      error: LOGIN_MESSAGES[code],
      code,
      ...extra,
    } satisfies LoginFailure,
    status,
    headers,
  )
}

/**
 * Vercel puts the client address on the request. Prefer the runtime-provided
 * value when present and fall back to the platform-managed proxy headers.
 * A missing value is handled by the caller; it never collapses every visitor
 * into one shared rate-limit bucket.
 */
function getClientIp(request: Request): string | null {
  const runtimeIp = (request as Request & { ip?: string }).ip
  if (runtimeIp) return runtimeIp

  const realIp = request.headers.get("x-real-ip")
  if (realIp) return realIp.trim()

  const forwarded = request.headers.get("x-forwarded-for")
  return forwarded?.split(",")[0]?.trim() || null
}

interface ParsedLogin {
  email: string
  password: string
  turnstileToken?: string
}

type ReadLoginResult =
  | { ok: true; data: ParsedLogin }
  | { ok: false; response: Response }

const MAX_BODY_BYTES = 16_384

async function readLoginRequest(request: Request): Promise<ReadLoginResult> {
  const contentType = request.headers.get("content-type") ?? ""
  if (!contentType.toLowerCase().includes("application/json")) {
    return { ok: false, response: errorResponse("VALIDATION", 415) }
  }

  const declaredLength = Number(request.headers.get("content-length") ?? "0")
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return { ok: false, response: errorResponse("VALIDATION", 413) }
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return { ok: false, response: errorResponse("VALIDATION", 400) }
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, response: errorResponse("VALIDATION", 400) }
  }

  const input = body as Record<string, unknown>
  const { email, password } = input
  const turnstileToken =
    input["cf-turnstile-response"] ?? input.turnstileToken

  if (
    typeof email !== "string" ||
    typeof password !== "string" ||
    email.length > 254 ||
    password.length > 1024
  ) {
    return { ok: false, response: errorResponse("VALIDATION", 400) }
  }

  if (
    turnstileToken !== undefined &&
    (typeof turnstileToken !== "string" || turnstileToken.length > 4096)
  ) {
    return { ok: false, response: errorResponse("VALIDATION", 400) }
  }

  const normalizedEmail = email.trim().toLowerCase()

  if (!normalizedEmail || !normalizedEmail.includes("@")) {
    return { ok: false, response: errorResponse("VALIDATION", 400) }
  }

  return {
    ok: true,
    data: {
      email: normalizedEmail,
      password,
      turnstileToken:
        typeof turnstileToken === "string"
          ? turnstileToken.trim() || undefined
          : undefined,
    },
  }
}

/* ── Upstash rate limiting ────────────────────────────────────────────── */

const IP_WINDOW_MS = 5 * 60 * 1000
const IP_WINDOW_SECONDS = 5 * 60
const ACCOUNT_TTL_MS = 5 * 60 * 1000
const ACCOUNT_TTL_SECONDS = 5 * 60
const MAX_IP_FAILURES = 5
const CAPTCHA_MAX_ATTEMPTS = 10

interface RateLimitDecision {
  blocked: boolean
  retryAfterSeconds?: number
}

interface AccountFailureResult {
  failures: number
  captchaRequired: boolean
}

interface RateLimiter {
  checkIp(ipHash: string | null): Promise<RateLimitDecision>
  getAccountFailures(ipHash: string | null, accountHash: string): Promise<number>
  recordFailure(
    ipHash: string | null,
    accountHash: string,
  ): Promise<AccountFailureResult>
  clearAccount(ipHash: string | null, accountHash: string): Promise<void>
  checkCaptchaAttempts(ipHash: string | null): Promise<RateLimitDecision>
  recordCaptchaFailure(ipHash: string | null): Promise<void>
}

interface RateLimitRedis {
  zremrangebyscore(key: string, min: number, max: number): Promise<number>
  zcard(key: string): Promise<number>
  zadd(
    key: string,
    scoreMember: { score: number; member: string },
  ): Promise<number | null>
  expire(key: string, seconds: number): Promise<number>
  get(key: string): Promise<unknown>
  incr(key: string): Promise<number>
  del(key: string): Promise<number>
}

interface AccountEntry {
  failures: number
  resetAt: number
}

interface RateLimiterOptions {
  /** Pass null to run entirely in-memory (tests / local fallback). */
  redis?: RateLimitRedis | null
  now?: () => number
}

function createRedis(): RateLimitRedis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN

  if (!url || !token) return null

  try {
    return new Redis({ url, token }) as unknown as RateLimitRedis
  } catch {
    console.warn("[auth-rate-limit] Redis client could not be initialised")
    return null
  }
}

function prune(entries: number[], nowMs: number, windowMs: number): number[] {
  return entries.filter((timestamp) => timestamp > nowMs - windowMs)
}

function retryAfterSeconds(entries: number[], nowMs: number): number {
  const oldest = entries[0]
  if (oldest === undefined) return 1
  return Math.max(1, Math.ceil((oldest + IP_WINDOW_MS - nowMs) / 1000))
}

function accountKey(accountHash: string, ipHash: string | null): string {
  return `auth:acct:${accountHash}:${ipHash ?? "noip"}`
}

function ipKey(ipHash: string): string {
  return `auth:ip:${ipHash}`
}

function captchaKey(ipHash: string): string {
  return `auth:captcha:${ipHash}`
}

/**
 * SHA-256 + optional pepper. Only the digest is stored in Redis, never the
 * raw email address or IP.
 */
async function hashIdentifier(
  value: string,
  pepper = "",
): Promise<string> {
  const bytes = new TextEncoder().encode(`${pepper}${value}`)
  const digest = await crypto.subtle.digest("SHA-256", bytes)

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
}

function createRateLimiter(
  options: RateLimiterOptions = {},
): RateLimiter {
  const now = options.now ?? (() => Date.now())
  const redis = options.redis === undefined ? createRedis() : options.redis

  const localIpFailures = new Map<string, number[]>()
  const localAccountFailures = new Map<string, AccountEntry>()
  const localCaptchaAttempts = new Map<string, number[]>()

  const localIpDecision = (ipHash: string, nowMs: number): RateLimitDecision => {
    const entries = prune(
      localIpFailures.get(ipHash) ?? [],
      nowMs,
      IP_WINDOW_MS,
    )

    if (entries.length === 0) localIpFailures.delete(ipHash)
    else localIpFailures.set(ipHash, entries)

    if (entries.length >= MAX_IP_FAILURES) {
      return {
        blocked: true,
        retryAfterSeconds: retryAfterSeconds(entries, nowMs),
      }
    }

    return { blocked: false }
  }

  const localAccountCount = (key: string, nowMs: number): number => {
    const entry = localAccountFailures.get(key)
    if (!entry) return 0
    if (entry.resetAt <= nowMs) {
      localAccountFailures.delete(key)
      return 0
    }
    return entry.failures
  }

  return {
    async checkIp(ipHash) {
      if (!ipHash) return { blocked: false }

      const nowMs = now()
      const local = localIpDecision(ipHash, nowMs)
      if (local.blocked) return local

      if (!redis) return local

      try {
        const key = ipKey(ipHash)
        await redis.zremrangebyscore(key, 0, nowMs - IP_WINDOW_MS)
        const count = await redis.zcard(key)

        if (count > 0) await redis.expire(key, IP_WINDOW_SECONDS)

        if (count >= MAX_IP_FAILURES) {
          return {
            blocked: true,
            retryAfterSeconds: IP_WINDOW_SECONDS,
          }
        }
      } catch {
        console.warn("[auth-rate-limit] Redis IP check failed; using memory")
      }

      return { blocked: false }
    },

    async getAccountFailures(ipHash, accountHash) {
      const nowMs = now()
      const key = accountKey(accountHash, ipHash)
      const local = localAccountCount(key, nowMs)

      if (!redis) return local

      try {
        const value = await redis.get(key)
        const remote = Number(value ?? 0)
        return Number.isFinite(remote) && remote > 0 ? remote : local
      } catch {
        console.warn("[auth-rate-limit] Redis account read failed; using memory")
        return local
      }
    },

    async recordFailure(ipHash, accountHash) {
      const nowMs = now()
      let accountFailures: number

      if (ipHash) {
        const entries = prune(
          localIpFailures.get(ipHash) ?? [],
          nowMs,
          IP_WINDOW_MS,
        )
        entries.push(nowMs)
        localIpFailures.set(ipHash, entries)
      }

      const key = accountKey(accountHash, ipHash)
      const existing = localAccountFailures.get(key)
      const base =
        existing && existing.resetAt > nowMs ? existing.failures : 0
      const nextLocal = base + 1

      localAccountFailures.set(key, {
        failures: nextLocal,
        resetAt: nowMs + ACCOUNT_TTL_MS,
      })
      accountFailures = nextLocal

      if (redis) {
        try {
          if (ipHash) {
            const keyIp = ipKey(ipHash)
            await redis.zadd(keyIp, {
              score: nowMs,
              member: `${nowMs}:${crypto.randomUUID()}`,
            })
            await redis.expire(keyIp, IP_WINDOW_SECONDS)
          }

          const nextRemote = await redis.incr(key)
          if (nextRemote === 1) {
            await redis.expire(key, ACCOUNT_TTL_SECONDS)
          }
          if (Number.isFinite(nextRemote) && nextRemote > 0) {
            accountFailures = nextRemote
          }
        } catch {
          console.warn(
            "[auth-rate-limit] Redis failure write failed; using memory",
          )
        }
      }

      return {
        failures: accountFailures,
        captchaRequired: accountFailures >= 3,
      }
    },

    async clearAccount(ipHash, accountHash) {
      const key = accountKey(accountHash, ipHash)
      localAccountFailures.delete(key)

      if (!redis) return

      try {
        await redis.del(key)
      } catch {
        console.warn("[auth-rate-limit] Redis account clear failed")
      }
    },

    async checkCaptchaAttempts(ipHash) {
      if (!ipHash) return { blocked: false }

      const nowMs = now()
      const entries = prune(
        localCaptchaAttempts.get(ipHash) ?? [],
        nowMs,
        IP_WINDOW_MS,
      )

      if (entries.length === 0) localCaptchaAttempts.delete(ipHash)
      else localCaptchaAttempts.set(ipHash, entries)

      if (entries.length >= CAPTCHA_MAX_ATTEMPTS) {
        return {
          blocked: true,
          retryAfterSeconds: retryAfterSeconds(entries, nowMs),
        }
      }

      if (!redis) return { blocked: false }

      try {
        const key = captchaKey(ipHash)
        await redis.zremrangebyscore(key, 0, nowMs - IP_WINDOW_MS)
        const count = await redis.zcard(key)
        if (count > 0) await redis.expire(key, IP_WINDOW_SECONDS)

        if (count >= CAPTCHA_MAX_ATTEMPTS) {
          return {
            blocked: true,
            retryAfterSeconds: IP_WINDOW_SECONDS,
          }
        }
      } catch {
        console.warn("[auth-rate-limit] Redis CAPTCHA check failed; using memory")
      }

      return { blocked: false }
    },

    async recordCaptchaFailure(ipHash) {
      if (!ipHash) return

      const nowMs = now()
      const entries = prune(
        localCaptchaAttempts.get(ipHash) ?? [],
        nowMs,
        IP_WINDOW_MS,
      )
      entries.push(nowMs)
      localCaptchaAttempts.set(ipHash, entries)

      if (!redis) return

      try {
        const key = captchaKey(ipHash)
        await redis.zadd(key, {
          score: nowMs,
          member: `${nowMs}:${crypto.randomUUID()}`,
        })
        await redis.expire(key, IP_WINDOW_SECONDS)
      } catch {
        console.warn("[auth-rate-limit] Redis CAPTCHA write failed; using memory")
      }
    },
  }
}

/* ── Turnstile ────────────────────────────────────────────────────────── */

interface TurnstileVerification {
  ok: boolean
  available: boolean
}

interface TurnstileResponse {
  success?: boolean
}

/**
 * Server-side verification. The secret never reaches the browser.
 * A network/configuration failure is reported separately so the endpoint can
 * fail closed with a 503 instead of silently bypassing the challenge.
 */
async function verifyTurnstile(
  token: string,
  ip: string | null,
): Promise<TurnstileVerification> {
  const secret = process.env.TURNSTILE_SECRET_KEY
  if (!secret) return { ok: false, available: false }

  const body = new URLSearchParams({ secret, response: token })
  if (ip) body.set("remoteip", ip)

  try {
    const response = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        body,
        signal: AbortSignal.timeout(5_000),
      },
    )

    if (!response.ok) return { ok: false, available: false }

    const data = (await response.json()) as TurnstileResponse
    return { ok: data.success === true, available: true }
  } catch {
    return { ok: false, available: false }
  }
}

/* ── Supabase Auth ────────────────────────────────────────────────────── */

type AuthenticateResult =
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
async function authenticateWithSupabase(
  email: string,
  password: string,
): Promise<AuthenticateResult> {
  /* The browser client is created from VITE_SUPABASE_URL. The server must use
   * the same project, or a password updated by the browser is checked against
   * a different GoTrue instance here. Prefer the browser pair and keep the
   * server pair only as a fallback for deployments that set one name. */
  const browserUrl = process.env.VITE_SUPABASE_URL
  const serverUrl = process.env.SUPABASE_URL
  const url = browserUrl ?? serverUrl ?? ""
  const anonKey =
    process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? ""

  if (!url || !anonKey) {
    console.error("[auth-login] supabase auth environment is incomplete", {
      hasUrl: Boolean(url),
      hasAnonKey: Boolean(anonKey),
    })
    return { ok: false, code: "AUTH_UNAVAILABLE" }
  }

  if (browserUrl && serverUrl) {
    try {
      const browserHost = new URL(browserUrl).host
      const serverHost = new URL(serverUrl).host

      if (browserHost !== serverHost) {
        console.error("[auth-login] supabase project env mismatch", {
          browserHost,
          serverHost,
          using: "VITE_SUPABASE_URL",
        })
      }
    } catch {
      console.error("[auth-login] invalid supabase url configuration")
      return { ok: false, code: "AUTH_UNAVAILABLE" }
    }
  }

  let projectHost = ""

  try {
    projectHost = new URL(url).host
  } catch {
    console.error("[auth-login] invalid supabase url configuration")
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
          Authorization: `Bearer ${anonKey}`,
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
    console.error("[auth-login] gotrue unavailable", {
      status: response.status,
      project: projectHost,
    })
    return { ok: false, code: "AUTH_UNAVAILABLE" }
  }

  const body = (await response.json().catch(() => null)) as
    | SupabaseErrorBody
    | null

  /* Log the upstream error before mapping it. Without this, every 400/401 was
   * reported as a wrong password, including CAPTCHA failures, invalid API keys
   * and project mismatches. No password or token is logged here. */
  console.error("[auth-login] gotrue rejected", {
    status: response.status,
    project: projectHost,
    error: body?.error,
    errorDescription: body?.error_description,
    errorCode: body?.error_code,
    code: body?.code,
    message: body?.msg,
  })

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
    message.includes("captcha protection") ||
    message.includes("captcha_failed") ||
    message.includes("captcha")
  ) {
    return {
      ok: false,
      code: message.includes("captcha_failed")
        ? "CAPTCHA_FAILED"
        : "CAPTCHA_REQUIRED",
    }
  }

  if (
    message.includes("invalid api key") ||
    message.includes("invalid jwt") ||
    message.includes("no api key") ||
    message.includes("missing api key") ||
    message.includes("apikey")
  ) {
    return { ok: false, code: "AUTH_UNAVAILABLE" }
  }

  if (
    message.includes("invalid login credentials") ||
    message.includes("invalid_credentials") ||
    message.includes("invalid_grant")
  ) {
    return { ok: false, code: "INVALID_CREDENTIALS" }
  }

  return { ok: false, code: "AUTH_UNAVAILABLE" }
}

/* ── Handler ──────────────────────────────────────────────────────────── */

const rateLimiter = createRateLimiter()
const pepper = process.env.RATE_LIMIT_PEPPER ?? ""

function logEvent(event: string): void {
  console.warn(`[auth-login] ${event}`)
}

function rateLimitedResponse(retryAfterSeconds: number): Response {
  return errorResponse(
    "RATE_LIMITED",
    429,
    { retryAfterSeconds },
    { "Retry-After": String(retryAfterSeconds) },
  )
}

async function loginHandler(request: Request): Promise<Response> {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: { "Cache-Control": "no-store" },
    })
  }

  if (request.method !== "POST") {
    return errorResponse("VALIDATION", 405, {}, { Allow: "POST, OPTIONS" })
  }

  const parsed = await readLoginRequest(request)
  if (!parsed.ok) return parsed.response

  const ip = getClientIp(request)
  if (!ip) logEvent("missing_client_ip")

  const ipHash = ip ? await hashIdentifier(ip, pepper) : null
  const accountHash = await hashIdentifier(parsed.data.email, pepper)

  const ipDecision = await rateLimiter.checkIp(ipHash)
  if (ipDecision.blocked) {
    logEvent("ip_rate_limited")
    return rateLimitedResponse(ipDecision.retryAfterSeconds ?? 300)
  }

  const accountFailures = await rateLimiter.getAccountFailures(
    ipHash,
    accountHash,
  )

  if (accountFailures >= 3) {
    const token = parsed.data.turnstileToken?.trim()

    if (!token) {
      logEvent("captcha_required")
      return errorResponse("CAPTCHA_REQUIRED", 403, {
        captchaRequired: true,
      })
    }

    const captcha = await verifyTurnstile(token, ip)

    if (!captcha.available) {
      logEvent("captcha_unavailable")
      return errorResponse("CAPTCHA_UNAVAILABLE", 503)
    }

    if (!captcha.ok) {
      await rateLimiter.recordCaptchaFailure(ipHash)
      const attempts = await rateLimiter.checkCaptchaAttempts(ipHash)

      if (attempts.blocked) {
        logEvent("captcha_attempts_limited")
        return rateLimitedResponse(attempts.retryAfterSeconds ?? 300)
      }

      logEvent("captcha_failed")
      return errorResponse("CAPTCHA_FAILED", 403, {
        captchaRequired: true,
      })
    }
  }

  const auth = await authenticateWithSupabase(
    parsed.data.email,
    parsed.data.password,
  )

  if (auth.ok) {
    await rateLimiter.clearAccount(ipHash, accountHash)
    return jsonResponse(auth.session, 200)
  }

  if (auth.code === "AUTH_UNAVAILABLE") {
    logEvent("auth_unavailable")
    return errorResponse("AUTH_UNAVAILABLE", 503)
  }

  if (auth.code === "RATE_LIMITED") {
    logEvent("upstream_rate_limited")
    return rateLimitedResponse(auth.retryAfterSeconds ?? 300)
  }

  if (auth.code === "CAPTCHA_REQUIRED" || auth.code === "CAPTCHA_FAILED") {
    logEvent(auth.code === "CAPTCHA_REQUIRED" ? "captcha_required" : "captcha_failed")
    return errorResponse(auth.code, 403, { captchaRequired: true })
  }

  /* A malformed upstream response is not a credential failure: do not punish
   * the account or advance the IP window. */
  if (
    auth.code !== "INVALID_CREDENTIALS" &&
    auth.code !== "EMAIL_UNCONFIRMED" &&
    auth.code !== "ACCOUNT_BLOCKED"
  ) {
    logEvent("auth_unavailable")
    return errorResponse("AUTH_UNAVAILABLE", 503)
  }

  const failures = await rateLimiter.recordFailure(ipHash, accountHash)
  const captchaRequired = failures.captchaRequired

  if (auth.code === "EMAIL_UNCONFIRMED") {
    logEvent("email_unconfirmed")
    return errorResponse("EMAIL_UNCONFIRMED", 401, {
      isUnconfirmed: true,
      captchaRequired,
    })
  }

  if (auth.code === "ACCOUNT_BLOCKED") {
    logEvent("account_blocked")
    /* 423 keeps 403 exclusively for the Turnstile challenge contract. */
    return errorResponse("ACCOUNT_BLOCKED", 423, { captchaRequired })
  }

  logEvent("invalid_credentials")
  return errorResponse("INVALID_CREDENTIALS", 401, { captchaRequired })
}

export const config = { runtime: "edge" }

export default loginHandler
