import { Redis } from "@upstash/redis"

const IP_WINDOW_MS = 5 * 60 * 1000
const IP_WINDOW_SECONDS = 5 * 60
const ACCOUNT_TTL_MS = 5 * 60 * 1000
const ACCOUNT_TTL_SECONDS = 5 * 60
const MAX_IP_FAILURES = 5
const CAPTCHA_MAX_ATTEMPTS = 10

export interface RateLimitDecision {
  blocked: boolean
  retryAfterSeconds?: number
}

export interface AccountFailureResult {
  failures: number
  captchaRequired: boolean
}

export interface RateLimiter {
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
  return Math.max(
    1,
    Math.ceil((oldest + IP_WINDOW_MS - nowMs) / 1000),
  )
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
export async function hashIdentifier(
  value: string,
  pepper = "",
): Promise<string> {
  const bytes = new TextEncoder().encode(`${pepper}${value}`)
  const digest = await crypto.subtle.digest("SHA-256", bytes)

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
}

export function createRateLimiter(
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

  const localAccountCount = (
    key: string,
    nowMs: number,
  ): number => {
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
