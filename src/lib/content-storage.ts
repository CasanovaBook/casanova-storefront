/* ─────────────────────────────────────────────────────────────
 * Content-storage client - the browser side of the Supabase
 * Storage delivery path.
 *
 * Edge Functions do the privileged work with the service_role key
 * (which never reaches this bundle):
 *
 *   • create-upload-url - CMS: get a signed UPLOAD url for a book.
 *   • reader-content    - reader: stream a private book. Every request
 *     carries the reader's session and is authorized server-side.
 *   • get-content-url   - legacy signer, no longer called by this client.
 *
 * The browser never receives a Storage download URL for a book. The
 * reader endpoint returns a URL on the Edge Function itself; the storage
 * object is signed only inside the function runtime and is never exposed.
 *
 * Everything here returns the app's `Result`/`Failure` shape so the
 * CMS and the grant layer can treat a Supabase failure exactly like
 * any other service failure.
 * ───────────────────────────────────────────────────────────── */

import { fail, ok, type ErrorCode, type Result } from "../shared/result"

import {
  isSupabaseConfigured,
  requireSupabase,
  supabaseAnonKey,
  supabaseUrl,
} from "../integrations/supabase/supabase"

export interface UploadTarget {
  bucket: string

  path: string

  token: string

  /** Optional: only present when a server-side pointer table tracks revisions.
   *  With the deterministic-path design the client tracks the version itself. */

  version?: number
}

/**
 * Admin-facing availability of a product's digital file.
 *
 * `available` / `missing` come from an authoritative check of the private
 * bucket (the object at `product-<id>/book.pdf` really does / does not exist).
 * `unverified` means the check could not run (Supabase off, the status
 * function not deployed, or a transport failure) - callers must fall back to
 * the row's own pointer fields and must NOT report a confident "not uploaded".
 * No URL, path or token is ever returned here.
 */
export type ContentStatus =
  | {
      state: "available"
      fileName: string
      sizeBytes?: number
      contentType?: string
    }
  | { state: "missing" }
  | { state: "unverified" }

interface InvokeResult<T> {
  data?: T

  status?: number

  message?: string
}

/**
 * Upper bound on one Edge Function call.
 *
 * `fetch` has no timeout of its own. A request stuck at the gateway (a
 * cold start that never boots, a connection the platform holds open)
 * would otherwise leave the reader on "פותח את הספר…" forever, which is
 * exactly the shape of the "only a refresh fixes it" report. Twenty
 * seconds is well above a normal signing round trip - the observed
 * production call is ~10 s - so this only fires on a genuinely hung
 * request, and it turns that into the existing retryable failure.
 */
const FUNCTION_TIMEOUT_MS = 20_000

/**
 * Invokes a function and normalises both the success and the error
 * channel. On a non-2xx response supabase-js surfaces a FunctionsHttpError
 * whose `context` is the raw Response, so the JSON error the function
 * returned is read back out of it to preserve the real reason.
 */

async function invoke<T>(
  fn: string,
  body: Record<string, unknown>,
): Promise<InvokeResult<T>> {
  const client = requireSupabase()

  const { data, error } = await client.functions.invoke<T>(fn, {
    body,
    timeout: FUNCTION_TIMEOUT_MS,
  })

  if (!error) return { data: (data ?? undefined) as T | undefined }

  const context = (error as { context?: Response }).context

  let message = error.message

  if (context) {
    try {
      const parsed = (await context.json()) as { error?: unknown }

      if (parsed && typeof parsed.error === "string") message = parsed.error
    } catch {
      /* a non-JSON error body keeps the transport message */
    }

    return { status: context.status, message }
  }

  return { message }
}

const NOT_CONFIGURED = "PROVIDER_NOT_CONFIGURED" as ErrorCode

/** Maps a function HTTP status onto the app's error vocabulary. */

function codeFor(status: number | undefined): ErrorCode {
  if (status === 404) return "NOT_FOUND"

  if (status === 400) return "VALIDATION"

  return "STORAGE"
}

/**
 * What a failed content lookup means, decided from the HTTP status alone.
 *
 * The status is the only trustworthy part: the body of a refusal comes from
 * the Edge Function or from the transport layer, and both speak English -
 * "Could not sign the content URL" reaching a customer through the reader is
 * exactly how a storage outage came to be reported as "the publisher has not
 * uploaded the file yet". The raw message stays in the console, never on the
 * screen.
 *
 * `NOT_FOUND` is the one code that entitles the UI to claim the file is
 * missing, and only the server's 404 on the deterministic object earns it.
 * A 5xx and a request that never got an answer share a code because the
 * customer's next step is the same in both cases: try again.
 */
export function contentFailure(
  status: number | undefined,
): { code: ErrorCode; message: string } {
  switch (status) {
    case 404:
      return {
        code: "NOT_FOUND",
        message: "לקובץ הקריאה של הספר הזה עדיין לא הוצמד עותק דיגיטלי.",
      }
    case 403:
      return {
        code: "FORBIDDEN",
        message:
          "הגישה לספר הזה נדחתה על ידי השרת. אם שילמת עבורו, יש לפנות לתמיכה.",
      }
    case 401:
      return {
        code: "UNAUTHENTICATED",
        message: "תוקף ההתחברות פג. יש להתחבר מחדש כדי לפתוח את הספר.",
      }
    case 400:
      return {
        code: "VALIDATION",
        message: "בקשת הפתיחה של הספר לא תקינה. יש לרענן את העמוד ולנסות שוב.",
      }
    default:
      return {
        code: "STORAGE",
        message:
          "לא ניתן היה לפתוח את הקובץ כרגע. התקלה אינה בספר - ניתן לנסות שוב.",
      }
  }
}

/**
 * The reader's authenticated content endpoint.
 *
 * The URL is on the Edge Function, not Storage: the object path and its
 * signed URL exist only inside the function runtime. `v` is a per-mint cache
 * key so pdf.js's document cache cannot hand one reader's parsed document to
 * the next session on a shared browser.
 *
 * `session_id` travels as a query parameter rather than a header for one
 * concrete reason: pdf.js issues its own byte-range requests, and a parameter
 * rides along on every one of them automatically while a header would have to
 * be threaded through the PDF worker's fetch configuration. It is an
 * identifier, not a credential - the request is still authorised by the
 * bearer token, and the function checks the session belongs to that token's
 * account before serving a single byte.
 */
function readerContentUrl(productId: string, sessionId?: string): string {
  const base = supabaseUrl.replace(/\/+$/, "")

  const url = new URL(`${base}/functions/v1/reader-content`)

  url.searchParams.set("product_id", productId)

  if (sessionId) url.searchParams.set("session_id", sessionId)

  url.searchParams.set("v", crypto.randomUUID())

  return url.toString()
}

/** True when a content address points at the streaming endpoint and must be
 *  fetched with the reader's session headers. */
export function isProtectedContentUrl(value: string): boolean {
  if (!isSupabaseConfigured) return false

  try {
    const expected = new URL(
      `${supabaseUrl.replace(/\/+$/, "")}/functions/v1/reader-content`,
    )

    const actual = new URL(value)

    return (
      actual.origin === expected.origin &&
      actual.pathname === expected.pathname
    )
  } catch {
    return false
  }
}

/**
 * Headers pdf.js must attach to every request for the streaming endpoint:
 * the reader's Supabase session and the project's public API key. Neither
 * is a Storage credential. The access token is read at load time (and
 * auto-refreshed by supabase-js when near expiry), never persisted in the
 * local content-grant record.
 */
export async function contentRequestHeaders(): Promise<Record<string, string>> {
  if (!isSupabaseConfigured) throw new Error("content-auth-required")

  const { data, error } = await requireSupabase().auth.getSession()

  const token = data.session?.access_token

  if (error || !token) throw new Error("content-auth-required")

  return {
    Authorization: `Bearer ${token}`,
    apikey: supabaseAnonKey,
  }
}

/**
 * Reader path: verify access and return the streaming endpoint for a product.
 *
 * The HEAD preflight is deliberate. It makes the Edge Function verify the
 * JWT, the account status, the entitlement and the object's existence before
 * the reader shows a canvas - and it transfers no readable content (the
 * server checks existence with a discarded one-byte range). The function's
 * `x-content-delivery` marker distinguishes a missing object (404 from the
 * function) from a function that was never deployed (gateway 404).
 */
export async function fetchProtectedContentUrl(
  productId: string,
  sessionId?: string,
): Promise<Result<{ contentUrl: string }>> {
  if (!isSupabaseConfigured) {
    return fail(
      NOT_CONFIGURED,
      "שירות התוכן אינו מוגדר. יש להגדיר VITE_SUPABASE_URL ו־VITE_SUPABASE_ANON_KEY.",
    )
  }

  const contentUrl = readerContentUrl(productId, sessionId)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FUNCTION_TIMEOUT_MS)

  try {
    const headers = await contentRequestHeaders()

    const res = await fetch(contentUrl, {
      method: "HEAD",
      headers,
      signal: controller.signal,
      cache: "no-store",
    })

    const delivered =
      res.headers.get("x-content-delivery") === "reader-content"

    if (!res.ok) {
      const failure =
        res.status === 404 && !delivered
          ? {
              code: "STORAGE" as ErrorCode,
              message: "שירות הקריאה אינו זמין כרגע. נסו שוב בעוד רגע.",
            }
          : contentFailure(res.status)

      /* The status and deployment marker stay in the console for whoever is
       * looking into a report; the customer gets the sentence above. */
      console.warn(
        "[content] delivery refused:",
        res.status,
        delivered ? "reader-content" : "gateway",
      )

      return fail(failure.code, failure.message)
    }

    return ok({ contentUrl })
  } catch (err) {
    if (err instanceof Error && err.message === "content-auth-required") {
      return fail(
        "UNAUTHENTICATED",
        "תוקף ההתחברות פג. יש להתחבר מחדש כדי לפתוח את הספר.",
      )
    }

    const failure = contentFailure(undefined)

    console.warn(
      "[content] delivery threw:",
      err instanceof Error ? err.message : err,
    )

    return fail(failure.code, failure.message)
  } finally {
    clearTimeout(timer)
  }
}

/**
 * CMS path, step 1: ask for a signed upload URL. The reader derives the
 * same deterministic path from the product id, so a successful upload is
 * immediately resolvable by reader-content.
 */

export async function createContentUploadUrl(
  productId: string,

  meta: { mimeType: string, fileSize: number },
): Promise<Result<UploadTarget>> {
  if (!isSupabaseConfigured) {
    return fail(
      NOT_CONFIGURED,
      "שירות התוכן אינו מוגדר. יש להגדיר VITE_SUPABASE_URL ו־VITE_SUPABASE_ANON_KEY.",
    )
  }

  try {
    const res = await invoke<UploadTarget>("create-upload-url", {
      product_id: productId,

      mime_type: meta.mimeType,

      file_size: meta.fileSize,
    })

    if (!res.data?.token || !res.data?.path) {
      return fail(
        codeFor(res.status),
        res.message ?? "לא ניתן להתחיל את ההעלאה.",
      )
    }

    return ok(res.data)
  } catch (err) {
    return fail(
      "STORAGE",
      err instanceof Error ? err.message : "שגיאת אחסון בלתי צפויה.",
    )
  }
}

/**
 * CMS path, step 2: push the bytes to the signed upload URL. Uses the
 * Storage SDK's uploadToSignedUrl so the service_role key is never
 * involved client-side.
 */

export async function uploadBookFile(
  target: UploadTarget,
  file: File,
): Promise<Result<{ path: string }>> {
  if (!isSupabaseConfigured) {
    return fail(NOT_CONFIGURED, "שירות התוכן אינו מוגדר.")
  }

  try {
    const { error } = await requireSupabase()

      .storage.from(target.bucket)

      .uploadToSignedUrl(target.path, target.token, file, {
        contentType: file.type || "application/pdf",
      })

    if (error) return fail("STORAGE", error.message)

    return ok({ path: target.path })
  } catch (err) {
    return fail(
      "STORAGE",
      err instanceof Error ? err.message : "שגיאת העלאה בלתי צפויה.",
    )
  }
}

/**
 * Admin path: ask whether a product's file actually exists in the private
 * bucket. This is the honest source of truth behind the "digital content"
 * column - the same object the Reader serves through `reader-content`.
 *
 * Degrades to `unverified` rather than a false negative when the function is
 * not deployed or the call fails, so the CMS never claims a real book was
 * never uploaded just because a lookup could not be made.
 */
export async function fetchContentStatus(
  productId: string,
): Promise<ContentStatus> {
  if (!isSupabaseConfigured) return { state: "unverified" }

  try {
    const res = await invoke<{
      exists?: unknown
      fileName?: unknown
      sizeBytes?: unknown
      contentType?: unknown
    }>("get-content-status", { product_id: productId })

    // A confirmed answer is always a 200 with an `exists` boolean, whether
    // the file is present or genuinely absent. Anything else is "could not
    // verify" - never report a confident miss on a failed lookup.
    if (typeof res.data?.exists !== "boolean") return { state: "unverified" }

    if (!res.data.exists) return { state: "missing" }

    const size = Number(res.data.sizeBytes)
    return {
      state: "available",
      fileName:
        typeof res.data.fileName === "string" ? res.data.fileName : "book.pdf",
      sizeBytes: Number.isFinite(size) ? size : undefined,
      contentType:
        typeof res.data.contentType === "string"
          ? res.data.contentType
          : undefined,
    }
  } catch {
    return { state: "unverified" }
  }
}
