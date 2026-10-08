/* ─────────────────────────────────────────────────────────────
 * Content-storage client — the browser side of the Supabase
 * Storage delivery path.
 *
 * Two Edge Functions do the privileged work with the service_role
 * key (which never reaches this bundle):
 *
 *   • create-upload-url — CMS: get a signed UPLOAD url for a book.
 *   • get-content-url   — reader: resolve a product to a short-lived
 *     signed DOWNLOAD url.
 *
 * Everything here returns the app's `Result`/`Failure` shape so the
 * CMS and the grant layer can treat a Supabase failure exactly like
 * any other service failure.
 * ───────────────────────────────────────────────────────────── */

import { fail, ok, type ErrorCode, type Result } from "./api"

import { isSupabaseConfigured, requireSupabase } from "./supabase"

export interface SignedContent {
  signedUrl: string

  expiresAt: string
}

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
 * function not deployed, or a transport failure) — callers must fall back to
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

  const { data, error } = await client.functions.invoke<T>(fn, { body })

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
 * Reader path: exchange a product id for a short-lived signed URL.
 * The path is derived server-side from the validated product_id, so the
 * client never dictates which object is signed.
 */

export async function fetchSignedContentUrl(
  productId: string,
): Promise<Result<SignedContent>> {
  if (!isSupabaseConfigured) {
    return fail(
      NOT_CONFIGURED,
      "שירות התוכן אינו מוגדר. יש להגדיר VITE_SUPABASE_URL ו־VITE_SUPABASE_ANON_KEY.",
    )
  }

  try {
    const res = await invoke<SignedContent>("get-content-url", {
      product_id: productId,
    })

    if (!res.data?.signedUrl) {
      return fail(
        codeFor(res.status),

        res.status === 404
          ? "לתוכן הזה לא הוצמד קובץ. יש לפנות לתמיכה."
          : (res.message ?? "לא ניתן לקבל קישור לתוכן כרגע."),
      )
    }

    return ok({ signedUrl: res.data.signedUrl, expiresAt: res.data.expiresAt })
  } catch (err) {
    return fail(
      "STORAGE",
      err instanceof Error ? err.message : "שגיאת אחסון בלתי צפויה.",
    )
  }
}

/**
 * CMS path, step 1: ask for a signed upload URL. The reader derives the
 * same deterministic path from the product id, so a successful upload is
 * immediately resolvable by get-content-url.
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
 * column — the same object the Reader serves through `get-content-url`.
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
    // verify" — never report a confident miss on a failed lookup.
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
