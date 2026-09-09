/* ─────────────────────────────────────────────────────────────
 * Library, devices and orders.
 *
 * Loaded only while signed in, and reloaded on focus rather than on a
 * timer: the CMS can revoke an entitlement at any moment, but a phone
 * that polls every few seconds is a phone with a flat battery. Focus is
 * the moment a reader actually looks at the list, so that is when the
 * list is refreshed.
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

import {
  fetchLibrary,
  fetchOrders,
  listDevices,
  revokeDevice,
} from "../net/api"

import type { DeviceSession, Order, UserProduct } from "../net/types"

import { isEntitlementLive } from "../net/types"

import { useAuth } from "./AuthContext"

import { purge, vaultSizeBytes } from "../drm/SecureFileVault"

export interface LibraryState {
  entitlements: UserProduct[]

  /** Only the rows the reader may open right now. */

  readable: UserProduct[]

  devices: DeviceSession[]

  orders: Order[]

  loading: boolean

  error: string | null

  /** Bytes of protected content currently in the vault. */

  vaultBytes: number

  reload: () => Promise<void>

  /** The customer's own device removal. Destroys local copies too. */

  removeDevice: (sessionId: string) => Promise<string | null>
}

const LibraryContext = createContext<LibraryState | null>(null)

export function LibraryProvider({ children }: { children: ReactNode }) {
  const { phase } = useAuth()

  const [entitlements, setEntitlements] = useState<UserProduct[]>([])

  const [devices, setDevices] = useState<DeviceSession[]>([])

  const [orders, setOrders] = useState<Order[]>([])

  const [loading, setLoading] = useState(false)

  const [error, setError] = useState<string | null>(null)

  const [vaultBytes, setVaultBytes] = useState(0)

  const signedIn = phase === "signed-in"

  const reload = useCallback(async () => {
    if (!signedIn) return

    setLoading(true)

    const [library, deviceList, orderList, bytes] = await Promise.all([
      fetchLibrary(),

      listDevices(),

      fetchOrders(),

      vaultSizeBytes().catch(() => 0),
    ])

    setLoading(false)

    if (!library.ok) {
      setError(library.error)

      return
    }

    setError(null)

    setEntitlements(library.data)

    if (deviceList.ok) setDevices(deviceList.data)

    if (orderList.ok) setOrders(orderList.data)

    setVaultBytes(bytes)
  }, [signedIn])

  useEffect(() => {
    if (!signedIn) {
      setEntitlements([])

      setDevices([])

      setOrders([])

      setVaultBytes(0)

      setError(null)

      return
    }

    void reload()
  }, [signedIn, reload])

  const removeDevice = useCallback(
    async (sessionId: string): Promise<string | null> => {
      /* The server cascades to content_access_grants, so every URL handed
       * to that device dies there. The local bytes have to die here —
       * there is no server round trip that can delete a file. */

      const result = await revokeDevice(
        sessionId,
        "הוסר על ידי בעל החשבון מהאפליקציה",
      )

      const bytes = await vaultSizeBytes().catch(() => 0)

      setVaultBytes(bytes)

      if (!result.ok) return result.error

      await reload()

      return null
    },

    [reload],
  )

  /** Local copies of products that are no longer readable are destroyed
   *  as soon as the list says so. Waiting for the TTL would leave a
   *  revoked book sitting in the sandbox. */

  useEffect(() => {
    if (!signedIn || entitlements.length === 0) return

    const unreadable = entitlements.filter((up) => !isEntitlementLive(up))

    if (unreadable.length === 0) return

    void Promise.all(
      unreadable.map((up) => purge(up.product_id).catch(() => undefined)),
    ).then(async () => {
      const bytes = await vaultSizeBytes().catch(() => 0)

      setVaultBytes(bytes)
    })
  }, [signedIn, entitlements])

  const readable = useMemo(
    () => entitlements.filter((up) => isEntitlementLive(up)),
    [entitlements],
  )

  const value = useMemo<LibraryState>(
    () => ({
      entitlements,
      readable,
      devices,
      orders,
      loading,
      error,
      vaultBytes,
      reload,
      removeDevice,
    }),

    [
      entitlements,
      readable,
      devices,
      orders,
      loading,
      error,
      vaultBytes,
      reload,
      removeDevice,
    ],
  )

  return (
    <LibraryContext.Provider value={value}>{children}</LibraryContext.Provider>
  )
}

export function useLibrary(): LibraryState {
  const context = useContext(LibraryContext)

  if (!context)
    throw new Error("useLibrary must be used inside <LibraryProvider>")

  return context
}
