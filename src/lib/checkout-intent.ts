/* ─────────────────────────────────────────────────────────────
 * Checkout intent.
 *
 * Registering during a purchase costs the customer a round trip to
 * their inbox: they leave the SPA to click the verification link, and
 * the link opens a fresh document in which nothing of the purchase
 * survives - the selected book lives in React state, and the
 * `/register?redirect=/checkout` hint lived in the URL of a page they
 * are no longer on. The result was a verified account dumped on the
 * library with no order in progress, on a funnel whose only job is to
 * sell that one book.
 *
 * So the two facts that have to outlive the email trip are written
 * down here, and read back on the other side:
 *
 *   • which product was being bought, so `/checkout` can restore it;
 *   • where the customer was heading, so the confirmation screen can
 *     take them there instead of the library.
 *
 * This is navigation state, not business data: the order, the
 * entitlement and the account are all owned by Supabase. It is
 * expiring (an hour) and single-use for the path, so a stale intent
 * cannot hijack a later visit, and every write is guarded - a browser
 * that refuses storage simply keeps the pre-existing behaviour.
 * ───────────────────────────────────────────────────────────── */

const INTENT_KEY = "casanova_checkout_intent_v1"

/** How long an abandoned purchase stays worth resuming. */
const INTENT_TTL_MS = 60 * 60 * 1000

interface CheckoutIntent {
  product_id: string | null
  return_path: string | null
  saved_at: number
}

function read(): CheckoutIntent | null {
  try {
    const raw = localStorage.getItem(INTENT_KEY)
    if (!raw) return null

    const parsed = JSON.parse(raw) as Partial<CheckoutIntent> | null

    if (!parsed || typeof parsed.saved_at !== "number") return null

    if (Date.now() - parsed.saved_at > INTENT_TTL_MS) {
      localStorage.removeItem(INTENT_KEY)
      return null
    }

    return {
      product_id:
        typeof parsed.product_id === "string" ? parsed.product_id : null,
      return_path:
        typeof parsed.return_path === "string" ? parsed.return_path : null,
      saved_at: parsed.saved_at,
    }
  } catch {
    return null
  }
}

function write(next: CheckoutIntent | null): void {
  try {
    if (!next || (!next.product_id && !next.return_path))
      localStorage.removeItem(INTENT_KEY)
    else localStorage.setItem(INTENT_KEY, JSON.stringify(next))
  } catch {
    /* storage unavailable - the funnel falls back to losing the intent,
     * which is exactly what happened before this module existed. */
  }
}

function current(): CheckoutIntent {
  return read() ?? { product_id: null, return_path: null, saved_at: Date.now() }
}

/**
 * Accepts only a same-origin app path.
 *
 * The value comes from a query string a third party can write
 * (`/register?redirect=…`), and after verification the app navigates to
 * it. A `//evil.com` or `https://evil.com` there is an open redirect onto a
 * screen that says "your account is confirmed", so anything that is not a
 * root-relative path is dropped.
 */
export function safeInternalPath(raw?: string | null): string | null {
  if (!raw) return null

  const value = raw.trim()

  if (!value.startsWith("/") || value.startsWith("//")) return null

  if (/[\s"']/.test(value) || value.length > 500) return null

  return value
}

/** The product a purchase was in progress for, if any. */
export function rememberedProductId(): string | null {
  return read()?.product_id ?? null
}

export function rememberProductId(productId: string): void {
  const intent = current()

  if (intent.product_id === productId) return

  write({ ...intent, product_id: productId, saved_at: Date.now() })
}

/** Where to go once the address is confirmed - read without consuming it. */
export function peekReturnPath(): string | null {
  return read()?.return_path ?? null
}

/** Reads the pending destination and clears it, so it applies once. */
export function takeReturnPath(): string | null {
  const intent = read()

  if (!intent?.return_path) return null

  write({ ...intent, return_path: null })

  return intent.return_path
}

export function rememberReturnPath(path: string): void {
  const intent = current()

  if (intent.return_path === path) return

  write({ ...intent, return_path: path, saved_at: Date.now() })
}

/** A finished purchase has nothing left to resume. */
export function clearCheckoutIntent(): void {
  write(null)
}
