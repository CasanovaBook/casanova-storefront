import { createLoginHandler } from "../_lib/login-handler.ts"
import { createRateLimiter } from "../_lib/rate-limit.ts"
import { authenticateWithSupabase } from "../_lib/supabase-auth.ts"
import { verifyTurnstile } from "../_lib/turnstile.ts"

export const config = { runtime: "edge" }

/* Created once per isolate: the module-level in-memory counters survive
 * between requests handled by the same instance. Upstash remains the
 * cross-instance source of truth. */
const limiter = createRateLimiter()

export default createLoginHandler({
  limiter,
  authenticate: authenticateWithSupabase,
  verifyCaptcha: verifyTurnstile,
  /* Event names only: no email addresses, IPs, passwords or tokens. */
  log: (event) => console.warn(`[auth-login] ${event}`),
})
