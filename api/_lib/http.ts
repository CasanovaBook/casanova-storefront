import {
  LOGIN_MESSAGES,
  type LoginErrorCode,
  type LoginFailure,
} from "../../src/shared/auth-login.ts"

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
}

export function jsonResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, ...headers },
  })
}

export function errorResponse(
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
export function getClientIp(request: Request): string | null {
  const runtimeIp = (request as Request & { ip?: string }).ip
  if (runtimeIp) return runtimeIp

  const realIp = request.headers.get("x-real-ip")
  if (realIp) return realIp.trim()

  const forwarded = request.headers.get("x-forwarded-for")
  return forwarded?.split(",")[0]?.trim() || null
}

export interface ParsedLogin {
  email: string
  password: string
  turnstileToken?: string
}

export type ReadLoginResult =
  | { ok: true; data: ParsedLogin }
  | { ok: false; response: Response }

const MAX_BODY_BYTES = 16_384

export async function readLoginRequest(request: Request): Promise<ReadLoginResult> {
  const contentType = request.headers.get("content-type") ?? ""
  if (!contentType.toLowerCase().includes("application/json")) {
    return {
      ok: false,
      response: errorResponse("VALIDATION", 415),
    }
  }

  const declaredLength = Number(request.headers.get("content-length") ?? "0")
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return {
      ok: false,
      response: errorResponse("VALIDATION", 413),
    }
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return {
      ok: false,
      response: errorResponse("VALIDATION", 400),
    }
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return {
      ok: false,
      response: errorResponse("VALIDATION", 400),
    }
  }

  const { email, password, turnstileToken } = body as Record<string, unknown>

  if (
    typeof email !== "string" ||
    typeof password !== "string" ||
    email.length > 254 ||
    password.length > 1024
  ) {
    return {
      ok: false,
      response: errorResponse("VALIDATION", 400),
    }
  }

  if (
    turnstileToken !== undefined &&
    (typeof turnstileToken !== "string" || turnstileToken.length > 4096)
  ) {
    return {
      ok: false,
      response: errorResponse("VALIDATION", 400),
    }
  }

  const normalizedEmail = email.trim().toLowerCase()

  if (!normalizedEmail || !normalizedEmail.includes("@")) {
    return {
      ok: false,
      response: errorResponse("VALIDATION", 400),
    }
  }

  return {
    ok: true,
    data: {
      email: normalizedEmail,
      password,
      turnstileToken: turnstileToken?.trim() || undefined,
    },
  }
}
