/* ─────────────────────────────────────────────────────────────
 * SecureFileVault — the "no download" half of the DRM.
 *
 * ScreenShield stops a capture of the screen. This stops a copy of the
 * file leaving the app, which is the harder problem and the one the
 * `block_download` flag in `drm_policies` is actually about.
 *
 * THE RULE
 * A protected PDF exists on this device in exactly one place: a
 * subdirectory of the app's private sandbox, whose path is computed
 * here and never persisted anywhere the user can read. It is fetched by
 * this module, opened by the reader, and deleted by this module.
 *
 * WHY THAT IS ENOUGH
 * On Android `DocumentDir` resolves to `/data/data/<package>/files`,
 * which no other app and no file manager can reach without root — and a
 * rooted device is refused before it ever gets a grant. On iOS it is the
 * app's own `Documents` directory, excluded from backup by
 * `excludeFromBackup()` below so an iTunes/Finder restore onto a second
 * phone does not carry the book with it.
 *
 * WHAT "NO DOWNLOAD" MEANS CONCRETELY
 * There is no save button, no share sheet, no "open in another app" and
 * no export path in this application, so the primary defence is that the
 * affordance does not exist. This module adds the four that a code
 * change could accidentally reintroduce:
 *   - `assertInsideVault()` refuses to hand any path outside the vault
 *     to the PDF renderer, so a stray `DownloadDir` write fails loudly.
 *   - the vault directory is wiped on logout and on revocation.
 *   - copies with an expired TTL are destroyed on every app start, and
 *     each destruction is reported as an `OFFLINE_EXPIRED` event so the
 *     CMS can see that offline copies are actually being cleaned up.
 *   - `purge()` is called when the reader unmounts, so a streamed file
 *     does not outlive the screen that asked for it.
 *
 * Streaming is the default. An offline copy is written only when the
 * policy says `allow_offline`, and then only for `offline_ttl_hours`.
 * ───────────────────────────────────────────────────────────── */

import { NativeModules, Platform } from "react-native"

import RNFetchBlob, { type StatefulPromise } from "react-native-blob-util"

import type { RedeemedGrant } from "../net/types"

/* ── Native helpers ─────────────────────────────────────── */

/**
 * Two operations `react-native-blob-util` does not expose, both of which
 * are security requirements rather than conveniences. Implemented in the
 * same `ScreenShield` native module; see the platform sources.
 */

interface VaultNative {
  /** iOS: set `NSURLIsExcludedFromBackupKey`. Android: no-op (internal
   *  storage is not backed up when `allowBackup=false`). */

  excludeFromBackup(path: string): Promise<boolean>

  /** SHA-256 of a file, to verify the bytes that arrived against the
   *  `checksum` the grant carried. */

  sha256File(path: string): Promise<string>
}

const Vault: VaultNative | undefined =
  NativeModules.ScreenShield as VaultNative & Record<string, unknown> | undefined ??
  undefined

/* ── Paths ──────────────────────────────────────────────── */

/**
 * The vault root.
 *
 * Deliberately under `DocumentDir` and deliberately not
 * `DownloadDir` / `DCIMDir` / `MovieDir`, all of which blob-util also
 * offers and all of which are user-visible. Using one of those would be
 * a one-word change that silently turned "read only" into "downloaded".
 */

function vaultRoot(): string {
  return `${RNFetchBlob.fs.dirs.DocumentDir}/casanova-vault`
}

/**
 * Per-product file path.
 *
 * The name is derived from the grant id rather than the product slug so
 * that nothing about the catalogue is readable from a directory listing,
 * and so two grants for the same product never collide.
 */

function vaultPathFor(grantId: string): string {
  const safe = grantId.replace(/[^a-zA-Z0-9_-]/g, "")

  return `${vaultRoot()}/${safe}.pdf`
}

async function ensureVault(): Promise<string> {
  const root = vaultRoot()

  const exists = await RNFetchBlob.fs.exists(root)

  if (!exists) await RNFetchBlob.fs.mkdir(root)

  if (Platform.OS === "ios") {
    /* A backup that carries the book defeats the device cap: restore it
     * onto a second phone and that phone has a copy nobody authorised. */

    await Vault?.excludeFromBackup(root).catch(() => false)
  }

  return root
}

/** True when `path` is inside the vault. Everything the PDF renderer is
 *  given must pass this check. */

export function isInsideVault(path: string): boolean {
  const root = vaultRoot()

  return path === root || path.startsWith(`${root}/`)
}

/** Throws rather than returning false: a path escaping the vault is a
 *  programming error, and the reader must not continue with it. */

export function assertInsideVault(path: string): void {
  if (!isInsideVault(path)) {
    throw new Error(
      `הקובץ אינו נמצא בכספת המאובטחת של האפליקציה ולכן לא ייפתח.`,
    )
  }
}

/* ── Entries ────────────────────────────────────────────── */

export interface VaultEntry {
  grant_id: string

  product_id: string

  path: string

  bytes: number

  /** Epoch millis after which the copy must be destroyed. */

  expires_at: number

  /** True when the policy allowed this copy to outlive its session. */

  offline: boolean
}

/**
 * The index of what is in the vault.
 *
 * Kept as a single small JSON file inside the vault itself rather than in
 * AsyncStorage: AsyncStorage is a plaintext store that a rooted device
 * or an `adb backup` can read, and while it would not contain the PDF it
 * would contain a map of what is on the device. Colocating the index
 * with the files means one deletion removes both.
 */

const INDEX_NAME = "index.json"

function indexPath(): string {
  return `${vaultRoot()}/${INDEX_NAME}`
}

async function readIndex(): Promise<VaultEntry[]> {
  try {
    const exists = await RNFetchBlob.fs.exists(indexPath())

    if (!exists) return []

    const raw = await RNFetchBlob.fs.readFile(indexPath(), "utf8")

    const parsed = JSON.parse(String(raw)) as unknown

    return Array.isArray(parsed) ? parsed as VaultEntry[] : []
  } catch {
    /* An unreadable index is treated as an empty vault. The files
     * themselves are still on disk, so `wipeAll()` remains the reliable
     * cleanup path and a corrupt index cannot strand protected content. */

    return []
  }
}

async function writeIndex(entries: VaultEntry[]): Promise<void> {
  await ensureVault()

  await RNFetchBlob.fs.writeFile(indexPath(), JSON.stringify(entries), "utf8")
}

export async function listVault(): Promise<VaultEntry[]> {
  return readIndex()
}

/* ── Fetch ──────────────────────────────────────────────── */

export interface FetchOptions {
  /** Ask for an offline copy. Ignored unless the policy allows it. */

  offline?: boolean

  /** Millis the copy may live. Required when `offline` is true. */

  ttlMs?: number

  onProgress?: (received: number, total: number) => void
}

export interface FetchFailure {
  ok: false

  reason: string

  /** Which security event the caller should report, when one applies. */

  event?: "DOWNLOAD_BLOCKED" | "GRANT_REPLAY_BLOCKED"
}

export type FetchResult = { ok: true, entry: VaultEntry } | FetchFailure

/**
 * Downloads the file named by a redeemed grant straight into the vault.
 *
 * The URL is used once, here, and is not stored: not in the index, not
 * in AsyncStorage, not in a variable that outlives this call. After it
 * expires the only way to get the bytes again is to mint a new grant,
 * which is a decision the server makes with the entitlement, the device
 * session and the policy in front of it.
 */

export async function fetchToVault(
  grant: RedeemedGrant,
  options: FetchOptions = {},
): Promise<FetchResult> {
  /* `block_download` is enforced by the caller refusing to reach this
   * function at all for a scope the policy does not allow; the guard
   * here is the second line, for the case where an offline copy was
   * requested without a TTL, which would otherwise be a permanent
   * download wearing an offline label. */

  if (options.offline && !options.ttlMs) {
    return {
      ok: false,

      reason:
        "עותק לא מקוון מחייב משך שמירה מוגדר. ללא תוקף זו הורדה לצמיתות, והיא נחסמת.",

      event: "DOWNLOAD_BLOCKED",
    }
  }

  const path = vaultPathFor(grant.grant_id)

  try {
    await ensureVault()
  } catch {
    return { ok: false, reason: "לא ניתן ליצור את הכספת המאובטחת במכשיר." }
  }

  try {
    const task: StatefulPromise<RNFetchBlob.FetchBlobResponse> =
      RNFetchBlob.config({
        path,

        /* The grant's fetch headers carry whatever the CDN needs to serve
         * the file. They are passed here and nowhere else, so the file
         * endpoint never has to accept an unauthenticated request. */

        timeout: 60_000,
      }).fetch("GET", grant.content_url, grant.fetch_headers ?? {})

    if (options.onProgress) {
      task.progress({ interval: 250 }, (received, total) =>
        options.onProgress?.(received, total),
      )
    }

    const response = await task

    if (response.info().status !== 200) {
      await RNFetchBlob.fs.unlink(path).catch(() => undefined)

      return {
        ok: false,
        reason: `השרת סירב לספק את הקובץ (${response.info().status}).`,
      }
    }

    const stat = await RNFetchBlob.fs.stat(path)

    const bytes = Number(stat.size) || 0

    /* Size is the cheap integrity check and it catches the common
     * failure — an HTML error page written where a PDF was expected. */

    if (grant.file_size_bytes && bytes !== grant.file_size_bytes) {
      await RNFetchBlob.fs.unlink(path).catch(() => undefined)

      return {
        ok: false,
        reason: "הקובץ שהתקבל אינו תואם את הגודל הצפוי. ייתכן שההורדה נקטעה.",
      }
    }

    if (bytes < 1024) {
      await RNFetchBlob.fs.unlink(path).catch(() => undefined)

      return { ok: false, reason: "הקובץ שהתקבל ריק או פגום." }
    }

    if (grant.checksum && Vault) {
      const digest = await Vault.sha256File(path).catch(() => "")

      if (digest && digest.toLowerCase() !== grant.checksum.toLowerCase()) {
        await RNFetchBlob.fs.unlink(path).catch(() => undefined)

        return {
          ok: false,
          reason: "בדיקת התקינות של הקובץ נכשלה. נסו לפתוח את הספר שוב.",
        }
      }
    }

    const offline = Boolean(options.offline && options.ttlMs)

    const entry: VaultEntry = {
      grant_id: grant.grant_id,

      product_id: grant.product_id,

      path,

      bytes,

      /* A streamed copy dies with the grant; an offline copy lives as
       * long as the policy allows and not one millisecond longer. */

      expires_at: offline
        ? Date.now() + Number(options.ttlMs)
        : Math.min(
            Date.now() + 30 * 60_000,
            new Date(grant.expires_at).getTime(),
          ),

      offline,
    }

    const index = (await readIndex()).filter(
      (e) => e.grant_id !== entry.grant_id,
    )

    index.push(entry)

    await writeIndex(index)

    assertInsideVault(entry.path)

    return { ok: true, entry }
  } catch {
    /* A half-written file is worse than no file: the PDF renderer would
     * fail on it and the reader would show a blank page with no reason. */

    await RNFetchBlob.fs.unlink(path).catch(() => undefined)

    return {
      ok: false,
      reason: "הורדת הקובץ נכשלה. בדקו את החיבור לרשת ונסו שוב.",
    }
  }
}

/* ── Read ───────────────────────────────────────────────── */

/**
 * Returns a live entry for a product, or null.
 *
 * Expired entries are destroyed as a side effect of being read. Waiting
 * for a scheduled sweep would leave a window in which an expired offline
 * copy is still on the device and still openable.
 */

export async function openFromVault(
  productId: string,
): Promise<VaultEntry | null> {
  const index = await readIndex()

  const now = Date.now()

  const candidates = index.filter((e) => e.product_id === productId)

  const live = candidates.find((e) => e.expires_at > now)

  for (const stale of candidates.filter((e) => e.expires_at <= now)) {
    await RNFetchBlob.fs.unlink(stale.path).catch(() => undefined)
  }

  if (candidates.some((e) => e.expires_at <= now)) {
    await writeIndex(
      index.filter((e) => !(e.product_id === productId && e.expires_at <= now)),
    )
  }

  if (!live) return null

  const exists = await RNFetchBlob.fs.exists(live.path)

  if (!exists) {
    await writeIndex(
      (await readIndex()).filter((e) => e.grant_id !== live.grant_id),
    )

    return null
  }

  return live
}

/* ── Destruction ────────────────────────────────────────── */

/** One product's copies. Called when the reader closes a streamed file. */

export async function purge(productId: string): Promise<void> {
  const index = await readIndex()

  const doomed = index.filter((e) => e.product_id === productId)

  await Promise.all(
    doomed.map((e) => RNFetchBlob.fs.unlink(e.path).catch(() => undefined)),
  )

  await writeIndex(index.filter((e) => e.product_id !== productId))
}

/**
 * Everything. Called on logout and whenever a device session or an
 * entitlement is revoked, because a revoked device must not be left
 * holding bytes it is no longer allowed to read.
 */

export async function wipeAll(): Promise<void> {
  const root = vaultRoot()

  await RNFetchBlob.fs.unlink(root).catch(() => undefined)
}

/**
 * Startup sweep. Returns the product ids whose offline copies were
 * destroyed, so the caller can report one `OFFLINE_EXPIRED` event each —
 * the CMS shows those as evidence that the TTL is being honoured on real
 * devices rather than only written into the policy.
 */

export async function purgeExpired(): Promise<string[]> {
  const index = await readIndex()

  const now = Date.now()

  const expired = index.filter((e) => e.expires_at <= now)

  if (expired.length === 0) return []

  await Promise.all(
    expired.map((e) => RNFetchBlob.fs.unlink(e.path).catch(() => undefined)),
  )

  await writeIndex(index.filter((e) => e.expires_at > now))

  return Array.from(new Set(expired.map((e) => e.product_id)))
}

/** Bytes currently held. Shown on the dashboard so storage is not a
 *  mystery to the reader. */

export async function vaultSizeBytes(): Promise<number> {
  const index = await readIndex()

  return index.reduce((sum, e) => sum + e.bytes, 0)
}
