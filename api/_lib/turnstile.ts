export interface TurnstileVerification {
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
export async function verifyTurnstile(
  token: string,
  ip: string | null,
): Promise<TurnstileVerification> {
  const secret = process.env.TURNSTILE_SECRET_KEY
  if (!secret) return { ok: false, available: false }

  const body = new URLSearchParams({
    secret,
    response: token,
  })

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
