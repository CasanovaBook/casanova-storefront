/* ─────────────────────────────────────────────────────────────
 * useReaderSession — the protected-reading state machine.
 *
 * One hook owns the whole chain from "the user tapped a book" to "bytes
 * are on screen", because every step in it is a security decision and
 * splitting them across components makes it possible to skip one:
 *
 *   1. probe device integrity      → block rooted / emulated devices
 *   2. claim a device session      → enforce max_devices_per_user
 *   3. resolve the DRM policy      → everything below obeys it
 *   4. mint a content grant        → server re-checks the entitlement
 *   5. redeem the grant            → single-use, row-locked
 *   6. fetch into the vault        → checksum-verified, private path
 *   7. heartbeat                   → notices revocation while reading
 *   8. renew or destroy            → no copy outlives its authority
 *
 * The ordering is not cosmetic. Step 4 happens after step 1 because the
 * server refuses to mint for a compromised device, and it refuses based
 * on what step 1 reported — so a false "trusted" from a rooted phone is
 * the only way past it, and that is exactly what the server's own
 * `block_rooted_devices` check at mint time exists to second-guess.
 * ───────────────────────────────────────────────────────────── */

import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import DeviceInfo from "react-native-device-info"

import {
  ACTIVITY_WINDOW_MS,
  APP_VERSION,
  GRANT_REVALIDATION_MS,
  SESSION_HEARTBEAT_MS,
} from "../config"

import {
  heartbeatDevice,
  issueGrant,
  redeemGrant,
  registerDevice,
  reportSecurityEvent,
} from "../net/api"

import type {
  DrmPolicy,
  PublicUser,
  SecurityEventType,
  DeviceIntegrity,
} from "../net/types"

import { RESTRICTIVE_POLICY } from "../net/types"

import {
  fetchToVault,
  openFromVault,
  purge,
  wipeAll,
  type VaultEntry,
} from "./SecureFileVault"

import {
  SCREEN_SHIELD_AVAILABLE,
  isCompromised,
  probeIntegrity,
} from "./ScreenShield"

export type ReaderPhase = "idle" | "registering" | "granting" | "fetching" | "ready" | "blocked" | "error"

export interface ReaderSessionState {
  phase: ReaderPhase

  sessionId: string | null

  policy: DrmPolicy

  integrity: DeviceIntegrity

  /** Local, vault-only path handed to the PDF renderer. */

  filePath: string | null

  /** The frozen stamp from the grant. Preferred over a client-rendered one. */

  watermark: string | null

  /** 0..1 while fetching. */

  downloadProgress: number

  /** Human-readable Hebrew reason for `blocked` or `error`. */

  message: string | null

  /** Whether the block is permanent for this session (revoked, compromised, capped). */

  permanent: boolean

  /** True once the session was revoked while the file was open. */

  revoked: boolean
}

export interface ReaderSession
  extends ReaderSessionState {

  /** Re-run the chain. A no-op when the block is permanent. */

  /** Called on every page turn so the heartbeat knows the session is
   *  genuinely in use rather than merely left open. */

  /** Report a protection event against this session and product. */

  /** Extend the local copy's authority without re-downloading it. */
  retry: () => void

  markActivity: () => void

  report: (type: SecurityEventType, detail?: string) => void

  renew: () => Promise<boolean>
}

export interface UseReaderSessionInput {
  productId: string | undefined

  user: PublicUser | null

  /** Ask for a copy that outlives the session. Refused unless the policy allows it. */

  offline?: boolean

  /** Mirror of every protection event, for callers that want their own handling. */

  onEvent?: (type: SecurityEventType, detail?: string) => void
}

export function useReaderSession({
  productId,

  user,

  offline = false,

  onEvent,
}: UseReaderSessionInput): ReaderSession {
  const [phase, setPhase] = useState<ReaderPhase>("idle")

  const [sessionId, setSessionId] = useState<string | null>(null)

  const [policy, setPolicy] = useState<DrmPolicy>(RESTRICTIVE_POLICY)

  const [integrity, setIntegrity] = useState<DeviceIntegrity>("UNKNOWN")

  const [filePath, setFilePath] = useState<string | null>(null)

  const [watermark, setWatermark] = useState<string | null>(null)

  const [downloadProgress, setDownloadProgress] = useState(0)

  const [message, setMessage] = useState<string | null>(null)

  const [permanent, setPermanent] = useState(false)

  const [revoked, setRevoked] = useState(false)

  /* The chain is async and multi-step, so every state write is guarded by
   * a run id. An abandoned attempt — unmount, retry, product change —
   * must not land its result on top of the current one, or a slow first
   * fetch resolves after a fast second one and the reader ends up showing
   * a file whose grant was already replaced. */

  const runId = useRef(0)

  const lastActivity = useRef(Date.now())

  const entryRef = useRef<VaultEntry | null>(null)

  const sessionIdRef = useRef<string | null>(null)

  const onEventRef = useRef(onEvent)

  useEffect(() => {
    onEventRef.current = onEvent
  }, [onEvent])

  const userId = user?.user_id ?? null

  const report = useCallback(
    (type: SecurityEventType, detail?: string) => {
      reportSecurityEvent({
        event_type: type,

        session_id: sessionIdRef.current ?? undefined,

        product_id: productId,

        metadata: detail ? { detail } : undefined,
      })

      onEventRef.current?.(type, detail)
    },

    [productId],
  )

  const markActivity = useCallback(() => {
    lastActivity.current = Date.now()
  }, [])

  /** Destroy the local copy and forget it. Used by every refusal path:
   *  a device that may not read a book must not be left holding it. */

  const destroyLocal = useCallback(async () => {
    const id = productId

    entryRef.current = null

    setFilePath(null)

    if (id) await purge(id).catch(() => undefined)
  }, [productId])

  const block = useCallback(
    (text: string, isPermanent: boolean) => {
      setPhase("blocked")

      setPermanent(isPermanent)

      setMessage(text)
    },

    [],
  )

  /* ── The chain ────────────────────────────────────────── */

  const start = useCallback(
    async (id: number) => {
      if (!productId || !userId) return

      const stale = () => id !== runId.current

      setPhase("registering")

      setMessage(null)

      setPermanent(false)

      setRevoked(false)

      /* A still-live offline copy is reused rather than re-downloaded.
       * Streamed copies are never reused: being short-lived is the whole
       * point of them, and an app restart is a new session. */

      const cached = offline ? await openFromVault(productId) : null

      if (stale()) return

      /* 1 — integrity, before anything else, so a compromised device
       * never reaches the point of holding a token or a file. */

      const verdict = await probeIntegrity()

      if (stale()) return

      setIntegrity(verdict)

      if (!SCREEN_SHIELD_AVAILABLE) {
        /* A build without the native module cannot protect anything.
         * Continuing would render the book on a screen that can be
         * photographed freely, so this is a hard stop. */

        await destroyLocal()

        block(
          "רכיב ההגנה אינו מותקן בגרסה זו של האפליקציה. עדכנו את האפליקציה או קראו דרך האתר.",
          true,
        )

        report("DEVICE_COMPROMISED", "native shield module missing")

        return
      }

      /* 2 — claim a device slot. */

      const registered = await registerDevice({
        device_name: `${DeviceInfo.getBrand()} ${DeviceInfo.getModel()}`,

        device_model: DeviceInfo.getModel(),

        os_version: DeviceInfo.getSystemVersion(),

        app_version: APP_VERSION,

        device_integrity: verdict,

        secure_flag_active: SCREEN_SHIELD_AVAILABLE,
      })

      if (stale()) return

      if (!registered.ok) {
        /* The cap is a conflict, not a transport error: retrying will not
         * help until a slot is freed from the dashboard. */

        const capped = registered.code === "CONFLICT"

        if (capped) {
          await destroyLocal()

          block(registered.error, true)

          report("DEVICE_LIMIT_EXCEEDED", registered.error)
        } else {
          setPhase("error")

          setMessage(registered.error)
        }

        return
      }

      const resolvedPolicy = registered.data.policy ?? RESTRICTIVE_POLICY

      sessionIdRef.current = registered.data.session.session_id

      setSessionId(registered.data.session.session_id)

      setPolicy(resolvedPolicy)

      /* 3 — policy gate. The server enforces the same rule at mint time;
       * deciding here first is what turns it into a readable Hebrew
       * refusal instead of an opaque one. */

      if (resolvedPolicy.block_rooted_devices && isCompromised(verdict)) {
        await destroyLocal()

        block(
          "המכשיר זוהה כפרוץ, כמכשיר עם jailbreak או כמדמה. קריאה בתוכן מוגן אינה מותרת במכשיר זה.",
          true,
        )

        report("DEVICE_COMPROMISED", `integrity=${verdict}`)

        return
      }

      if (cached) {
        /* The device is authorised and the bytes are already verified on
         * disk. Skip straight to reading without spending a grant. */

        entryRef.current = cached

        setFilePath(cached.path)

        setPhase("ready")

        markActivity()

        return
      }

      /* 4 — mint. */

      setPhase("granting")

      const wantOffline = offline && resolvedPolicy.allow_offline

      if (offline && !resolvedPolicy.allow_offline) {
        /* Not an error: fall back to streaming. Refusing to open the book
         * at all because offline is off would be worse than reading it
         * online, but the attempt is still recorded. */

        report("DOWNLOAD_BLOCKED", "offline copy requested, policy forbids it")
      }

      const issued = await issueGrant({
        product_id: productId,

        session_id: registered.data.session.session_id,

        scope: wantOffline ? "OFFLINE_CACHE" : "STREAM",
      })

      if (stale()) return

      if (!issued.ok) {
        const denied =
          issued.code === "FORBIDDEN" || issued.code === "DEVICE_COMPROMISED"

        await destroyLocal()

        if (denied) {
          block(issued.error, true)
        } else {
          setPhase("error")

          setMessage(issued.error)
        }

        return
      }

      /* 5 — redeem. The server locks the row, re-validates and spends one
       * use; the address in the response exists only inside this call. */

      const redeemed = await redeemGrant(issued.data.token, productId)

      if (stale()) return

      if (!redeemed.ok) {
        await destroyLocal()

        if (redeemed.code === "FORBIDDEN") {
          block(redeemed.error, true)
        } else {
          setPhase("error")

          setMessage(redeemed.error)

          if (redeemed.code === "GRANT_EXPIRED")
            report("GRANT_REPLAY_BLOCKED", redeemed.error)
        }

        return
      }

      /* 6 — into the vault. */

      setPhase("fetching")

      setDownloadProgress(0)

      const fetched = await fetchToVault(redeemed.data, {
        offline: wantOffline,

        ttlMs:
          wantOffline && resolvedPolicy.offline_ttl_hours
            ? resolvedPolicy.offline_ttl_hours * 3_600_000
            : undefined,

        onProgress: (received, total) => {
          if (stale()) return

          setDownloadProgress(total > 0 ? Math.min(1, received / total) : 0)
        },
      })

      if (stale()) return

      if (!fetched.ok) {
        await destroyLocal()

        setPhase("error")

        setMessage(fetched.reason)

        if (fetched.event) report(fetched.event, fetched.reason)

        return
      }

      entryRef.current = fetched.entry

      /* The grant's stamp wins over anything this client could render: it
       * was frozen server-side at mint time, so patching the bundle does
       * not change whose name appears on the page. */

      setWatermark(redeemed.data.watermark_text ?? null)

      setFilePath(fetched.entry.path)

      setDownloadProgress(1)

      setPhase("ready")

      markActivity()
    },

    [productId, userId, offline, report, markActivity, destroyLocal, block],
  )

  useEffect(() => {
    if (!productId || !userId) {
      setPhase("idle")

      return
    }

    runId.current += 1

    void start(runId.current)
  }, [productId, userId, start])

  const retry = useCallback(() => {
    if (permanent) return

    setFilePath(null)

    entryRef.current = null

    runId.current += 1

    void start(runId.current)
  }, [permanent, start])

  /* ── Heartbeat ────────────────────────────────────────── */

  useEffect(() => {
    if (!sessionId || phase === "blocked") return

    const timer = setInterval(
      () => {
        /* Only extend while the reader is genuinely in use. A phone left
         * open on one page overnight must time out exactly as the web
         * reader does, or `session_timeout_minutes` means nothing. */

        if (Date.now() - lastActivity.current > ACTIVITY_WINDOW_MS) return

        void (async () => {
          const result = await heartbeatDevice(sessionId)

          const cutOff = !result.ok || result.data.revoked

          if (!cutOff && result.ok) {
            sessionIdRef.current = result.data.session_id

            setSessionId(result.data.session_id)

            return
          }

          const reason = result.ok
            ? (result.data.revoke_reason ?? "הגישה ממכשיר זה נחסמה.")
            : result.code === "UNAUTHENTICATED"
              ? "פג תוקף ההתחברות. התחברו מחדש כדי להמשיך לקרוא."
              : result.error

          setRevoked(true)

          block(reason, true)

          report("SESSION_REVOKED", reason)

          /* The bytes have to go. A revoked device keeping a local copy is
           * the exact failure the grant system exists to prevent. */

          await destroyLocal()
        })()
      },
      SESSION_HEARTBEAT_MS,
    )

    return () => clearInterval(timer)
  }, [sessionId, phase, report, block, destroyLocal])

  /* ── Renewal ──────────────────────────────────────────── */

  const renew = useCallback(async (): Promise<boolean> => {
    if (!productId || !sessionId) return false

    const entry = entryRef.current

    if (!entry) return false

    const issued = await issueGrant({
      product_id: productId,
      session_id: sessionId,
      scope: "STREAM",
    })

    if (!issued.ok) {
      /* A refused grant means the entitlement or the session is gone. */

      setRevoked(true)

      block(issued.error, true)

      report("GRANT_REPLAY_BLOCKED", issued.error)

      await destroyLocal()

      return false
    }

    const redeemed = await redeemGrant(issued.data.token, productId)

    if (!redeemed.ok) {
      setPhase("error")

      setMessage(redeemed.error)

      await destroyLocal()

      return false
    }

    /* The bytes are already on disk and were checksum-verified when they
     * arrived, so renewal extends the local expiry without a second
     * download. The token is still spent, which is what keeps the server
     * in charge of whether reading may continue. */

    const next: VaultEntry = {
      ...entry,

      grant_id: redeemed.data.grant_id,

      expires_at:
        offline && policy.allow_offline && policy.offline_ttl_hours
          ? Date.now() + policy.offline_ttl_hours * 3_600_000
          : Math.min(
              Date.now() + 30 * 60_000,
              new Date(redeemed.data.expires_at).getTime(),
            ),
    }

    entryRef.current = next

    if (redeemed.data.watermark_text) setWatermark(redeemed.data.watermark_text)

    return true
  }, [
    productId,
    sessionId,
    offline,
    policy.allow_offline,
    policy.offline_ttl_hours,
    report,
    block,
    destroyLocal,
  ])

  /* While the file is open, check the local copy's authority on an
   * interval. Renewing is silent; failing to renew closes the book. */

  useEffect(() => {
    if (phase !== "ready" || !filePath) return

    const timer = setInterval(
      () => {
        const entry = entryRef.current

        if (!entry) return

        /* Renew slightly ahead of expiry so a page turn never races it. */

        if (entry.expires_at - Date.now() < GRANT_REVALIDATION_MS) void renew()
      },
      GRANT_REVALIDATION_MS,
    )

    return () => clearInterval(timer)
  }, [phase, filePath, renew])

  /* ── Teardown ─────────────────────────────────────────── */

  useEffect(() => {
    /* On unmount the streamed copy is destroyed. An offline copy is left
     * for `purgeExpired()` to collect when its TTL passes. */

    const id = productId

    return () => {
      runId.current += 1

      const entry = entryRef.current

      entryRef.current = null

      if (id && entry && !entry.offline) void purge(id).catch(() => undefined)
    }
  }, [productId])

  return useMemo<ReaderSession>(
    () => ({
      phase,

      sessionId,

      policy,

      integrity,

      filePath,

      watermark,

      downloadProgress,

      message,

      permanent,

      revoked,

      retry,

      markActivity,

      report,

      renew,
    }),

    [
      phase,

      sessionId,

      policy,

      integrity,

      filePath,

      watermark,

      downloadProgress,

      message,

      permanent,

      revoked,

      retry,

      markActivity,

      report,

      renew,
    ],
  )
}

/** The dashboard's "מחק את כל העותקים המקומיים" action. */

export async function destroyAllLocalCopies(): Promise<void> {
  await wipeAll()
}
