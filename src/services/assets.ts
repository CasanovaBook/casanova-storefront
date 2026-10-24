/* ─────────────────────────────────────────────────────────────
 * Assets service - turns a picked browser file into a storable data URL.
 *
 * Extracted verbatim from `src/lib/api.ts` (Phase 5B / Group B).
 * Behaviour is unchanged.
 * ───────────────────────────────────────────────────────────── */

import { getDb } from "../data/db"

import { fail, ok, type Result } from "../shared/result"

/* ── Uploaded assets ──────────────────────────────────── */

/**
 * Converts a picked file into a storable data URL. Guarded by the
 * configured size limit because the persistence driver has a finite
 * quota; larger binaries belong in object storage behind a real backend.
 */

export async function readAssetFile(
  file: File,
): Promise<Result<{
  url: string
  file_name: string
  file_size_kb: number
  mime_type: string
}>> {
  const max = getDb().settings.max_upload_bytes

  if (file.size > max) {
    return fail(
      "VALIDATION",

      `הקובץ גדול מדי (${Math.round(file.size / 1024).toLocaleString()}KB). המגבלה היא ${Math.round(
        max / 1024,
      ).toLocaleString()}KB - יש להעלות קבצים גדולים לאחסון חיצוני ולהדביק את הכתובת שלהם.`,
    )
  }

  const url = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()

    reader.onload = () => resolve(String(reader.result))

    reader.onerror = () => reject(new Error("read failed"))

    reader.readAsDataURL(file)
  }).catch(() => null)

  if (!url) return fail("STORAGE", "קריאת הקובץ נכשלה.")

  return ok({
    url,
    file_name: file.name,
    file_size_kb: Math.round(file.size / 1024),
    mime_type: file.type || "application/octet-stream",
  })
}
