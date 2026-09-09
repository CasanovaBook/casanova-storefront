/* ─────────────────────────────────────────────────────────────
 * Auth and boot state.
 *
 * Owns three things the rest of the app reads but never writes: the
 * signed-in user, the public platform settings, and the verdict of the
 * boot check. It is also the only place that clears the file vault, so
 * "sign out destroys every local copy" cannot be forgotten by a screen.
 * ───────────────────────────────────────────────────────────── */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"

import { loadApiBaseUrl } from "../config"

import {
  bootCheck,
  fetchMe,
  login as loginRequest,
  logout as logoutRequest,
  reportSecurityEvent,
  type BootCheck,
} from "../net/api"

import { clearSession, readStoredSession, storeSession } from "../net/client"

import type {
  ApiResult,
  DrmPolicy,
  PublicSettings,
  PublicUser,
} from "../net/types"

import { RESTRICTIVE_POLICY } from "../net/types"

import { purgeExpired, wipeAll } from "../drm/SecureFileVault"

export type BootPhase = "booting" | "blocked" | "signed-out" | "signed-in"

export interface AuthState {
  phase: BootPhase

  user: PublicUser | null

  settings: PublicSettings

  policy: DrmPolicy

  /** Non-null when this build must not run. Rendered by `GateScreen`. */

  blockReason: string | null

  /** Product ids whose expired offline copies were destroyed at boot. */

  expiredAtBoot: string[]

  signIn: (email: string, password: string) => Promise<ApiResult<PublicUser>>

  signOut: () => Promise<void>

  refresh: () => Promise<void>
}

const DEFAULT_SETTINGS: PublicSettings = {
  brand_name: "קזנובה",

  default_currency: "ILS",

  mobile_app_enabled: true,

  mobile_min_build: 0,
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<BootPhase>("booting")

  const [user, setUser] = useState<PublicUser | null>(null)

  const [settings, setSettings] = useState<PublicSettings | null>(null)

  const [policy, setPolicy] = useState<DrmPolicy>(RESTRICTIVE_POLICY)

  const [blockReason, setBlockReason] = useState<string | null>(null)

  const [expiredAtBoot, setExpiredAtBoot] = useState<string[]>([])

  /* Cold start.
   *
   * The order matters: the kill switch is evaluated before any stored
   * credential is read, so a build that has been pulled cannot use a
   * cached token to get as far as the library screen and render titles. */

  useEffect(() => {
    let cancelled = false

    void (async () => {
      await loadApiBaseUrl()

      const boot: BootCheck = await bootCheck()

      if (cancelled) return

      setSettings(boot.settings)

      if (boot.blockReason) {
        setBlockReason(boot.blockReason)

        setPhase("blocked")

        /* A blocked build keeps nothing. If the reason is a security
         * fix, the local copies are exactly what must not survive it. */

        await wipeAll().catch(() => undefined)

        await clearSession().catch(() => undefined)

        setUser(null)

        return
      }

      /* Offline copies past their TTL are destroyed here rather than on a
       * timer, because a phone that is closed for a week never fires one. */

      const expired = await purgeExpired().catch(() => [] as string[])

      if (cancelled) return

      setExpiredAtBoot(expired)

      expired.forEach((productId) =>
        reportSecurityEvent({
          event_type: "OFFLINE_EXPIRED",

          product_id: productId,

          metadata: { detail: "destroyed at app start" },
        }),
      )

      const stored = await readStoredSession()

      if (cancelled) return

      if (!stored) {
        setPhase("signed-out")

        return
      }

      /* A stored token is a claim, not proof. It is validated before the
       * app renders anything, so a revoked session cannot reach the
       * library even for one frame. */

      const me = await fetchMe()

      if (cancelled) return

      if (!me.ok) {
        await clearSession().catch(() => undefined)

        setPhase("signed-out")

        return
      }

      setUser(me.data)

      setPhase("signed-in")
    })()

    return () => {
      cancelled = true
    }
  }, [])

  const signIn = useCallback(
    async (email: string, password: string): Promise<ApiResult<PublicUser>> => {
      const result = await loginRequest(email, password)

      if (!result.ok) return result

      await storeSession(result.data.token, result.data.user.user_id)

      setPolicy(result.data.policy ?? RESTRICTIVE_POLICY)

      setUser(result.data.user)

      setPhase("signed-in")

      return { ok: true, data: result.data.user }
    },
    [],
  )

  const signOut = useCallback(async () => {
    /* Best effort: the server should end the session row, but a phone
     * with no signal still has to sign out locally. */

    await logoutRequest().catch(() => undefined)

    await clearSession().catch(() => undefined)

    /* Destroying every local copy is not optional and is not the user's
     * choice. A signed-out device holding protected bytes is a device
     * that can be handed to someone else. */

    await wipeAll().catch(() => undefined)

    setUser(null)

    setPhase("signed-out")
  }, [])

  const refresh = useCallback(async () => {
    const [boot, me] = await Promise.all([bootCheck(), fetchMe()])

    setSettings(boot.settings)

    if (boot.blockReason) {
      setBlockReason(boot.blockReason)

      setPhase("blocked")

      await wipeAll().catch(() => undefined)

      await clearSession().catch(() => undefined)

      setUser(null)

      return
    }

    if (!me.ok) {
      await clearSession().catch(() => undefined)

      setUser(null)

      setPhase("signed-out")

      return
    }

    setUser(me.data)

    setPhase("signed-in")
  }, [])

  const value = useMemo<AuthState>(
    () => ({
      phase,

      user,

      settings: settings ?? DEFAULT_SETTINGS,

      policy,

      blockReason,

      expiredAtBoot,

      signIn,

      signOut,

      refresh,
    }),

    [
      phase,
      user,
      settings,
      policy,
      blockReason,
      expiredAtBoot,
      signIn,
      signOut,
      refresh,
    ],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext)

  if (!context) throw new Error("useAuth must be used inside <AuthProvider>")

  return context
}
