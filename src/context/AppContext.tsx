/* ─────────────────────────────────────────────────────────────
 * Storefront session context.
 *
 * Holds nothing that the database already owns: the signed-in user is
 * resolved from the persisted session id, entitlements / orders /
 * reading progress are read live from the store, and every write goes
 * through the service layer so authorization is enforced there rather
 * than in the component that triggered it.
 *
 * Only genuinely ephemeral UI state lives here — the theme and the
 * in-progress cart.
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
import type {
  AdminRole,
  CartItem,
  Order,
  Product,
  ReadingProgress,
  User,
  UserProduct,
} from "../types"
import { effectivePrice } from "../types"
import { ensureCrossTabSync, useStore } from "../lib/store"
import {
  readSessionUserId,
  writeSessionUserId,
  toPublicUser,
} from "../lib/auth"
import {
  actorFromUser,
  bootstrapAdmin,
  isBootstrapRequired,
  login as loginRequest,
  registerCustomer,
  type Actor,
  type BootstrapInput,
  type RegisterInput,
  type Result,
} from "../lib/api"
import { mirrorRemoteEntitlements, saveReadingProgress } from "../lib/api-support"
import {
  checkout,
  listOrdersForUser,
  type CheckoutInput,
  type CheckoutOutcome,
} from "../lib/api-orders"
import {
  supabase,
  isSupabaseConfigured,
  requireSupabase,
} from "../lib/supabase"
import { maestro } from "../maestro"
import {
  signInWithEmail,
  signUpWithEmail,
  signOutUser,
  resendVerification,
  fetchProfile,
  buildAppUser,
} from "../lib/supabase-auth"
import { fetchMyEntitlements } from "../lib/supabase-entitlements"

/**
 * Resolves a stored session to an app user, refusing a blocked account.
 *
 * The suspension status lives in public.users and is not part of the JWT, so
 * it is re-read on every restore — otherwise suspending a customer would
 * leave them working until their token happened to expire. The session is
 * torn down rather than merely hidden, so they do not keep a valid token for
 * a blocked account.
 */
type RestoredAuthUser = Parameters<typeof buildAppUser>[0]

async function resolveRestoredUser(
  session: { user: RestoredAuthUser } | null,
): Promise<User | null> {
  if (!session?.user) return null

  const profile = await fetchProfile(session.user.id)

  if (profile && profile.account_status !== "ACTIVE") {
    await signOutUser()

    return null
  }

  return buildAppUser(session.user, profile)
}


const THEME_KEY = "casanova_theme"

/** How often the signed-in account's entitlements are re-fetched as a
 * safety net under the Realtime push. Realtime covers INSERT/UPDATE
 * instantly; DELETE cannot pass RLS filtering, so removals surface on
 * this beat. */
const ENTITLEMENT_REVALIDATE_MS = 30_000

export interface AuthOutcome {
  ok: boolean
  error?: string
  user?: User
  needsEmailConfirmation?: boolean
  isUnconfirmed?: boolean
}

interface AppContextValue {
  /** Live database snapshot — the single source of truth for every screen. */
  user: User | null
  actor: Actor | null
  isAuthenticated: boolean
  isAdmin: boolean
  adminRole: AdminRole | undefined
  /**
   * False until the very first Supabase session lookup has finished.
   *
   * Every route guard MUST wait for this. The Supabase client restores a
   * session asynchronously, so on a cold load `isAuthenticated` is `false`
   * for a moment even when a valid session exists. A guard that reads
   * `isAuthenticated` without also reading `authReady` therefore sees
   * "logged out" during that window and redirects away — which is exactly
   * what happened to the user who followed a verification link: Supabase
   * had signed them in, but the dashboard guard had not yet heard about it.
   */
  authReady: boolean
  /** True while no administrator exists yet; gates the first-run setup screen. */
  bootstrapRequired: boolean

  theme: "dark" | "light"
  toggleTheme: () => void

  /* ── Auth ── */
  login: (email: string, password: string) => Promise<AuthOutcome>
  register: (input: RegisterInput) => Promise<AuthOutcome>
  resendConfirmation: (email: string) => Promise<{ ok: boolean; error?: string }>
  setupAdmin: (input: BootstrapInput) => Promise<AuthOutcome>
  logout: () => void

  /* ── Cart (ephemeral) ── */
  cart: CartItem[]
  cartLines: { product: Product, quantity: number, line_total: number }[]
  cartTotal: number
  selectedProduct: Product | null
  setSelectedProduct: (p: Product | null) => void
  addToCart: (product: Product) => void
  removeFromCart: (productId: string) => void
  clearCart: () => void

  /* ── Purchase ── */
  placeOrder: (input: CheckoutInput) => Promise<Result<CheckoutOutcome>>
  /** The order created in this browsing session, for the confirmation screen. */
  lastOrder: Order | null

  /* ── Library ── */
  userProducts: UserProduct[]
  readingProgress: ReadingProgress[]
  orders: Order[]
  /**
   * Re-fetches the signed-in account's entitlements from Supabase now,
   * bypassing the once-a-minute focus throttle. The Reader calls this on
   * its revalidation beat so an access change made while the book is open
   * lands in the mirror within seconds instead of whenever focus returns.
   */
  refreshEntitlements: () => Promise<void>
  hasAccess: (productId: string) => boolean
  getProgress: (productId: string) => ReadingProgress | undefined
  updateProgress: (productId: string, page: number, totalPages: number) => void
}

const AppContext = createContext<AppContextValue | null>(null)

function toOutcome(result: Result<User>): AuthOutcome {
  return result.ok
    ? { ok: true, user: result.data }
    : { ok: false, error: result.error }
}

export function AppProvider({ children }: { children: ReactNode }) {
  const db = useStore()

  useEffect(() => {
    ensureCrossTabSync()
  }, [])

  /* ── Theme ────────────────────────────────────────────── */
  const [theme, setTheme] = useState<"dark" | "light">(() =>
    localStorage.getItem(THEME_KEY) === "light" ? "light" : "dark",
  )

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem(THEME_KEY, theme)
  }, [theme])

  const toggleTheme = useCallback(
    () => setTheme((t) => (t === "dark" ? "light" : "dark")),
    [],
  )

  /* ── Session ──────────────────────────────────────────── */
  const [supabaseUser, setSupabaseUser] = useState<User | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(() =>
    readSessionUserId(),
  )
  /* Latches true once the first session lookup settles. Without it every
   * guard below treats the loading window as "signed out". */
  const [authReady, setAuthReady] = useState(!isSupabaseConfigured)

  // Listen to Supabase Auth state changes and initial session
  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return

    let isMounted = true

    /** Bridge the Casanova Supabase session into Maestro so CMS inherits staff access. */
    const bridge = (session: { access_token: string; user: { id: string; email?: string } } | null) => {
      if (session?.access_token) {
        maestro.bridgeSession({
          accessToken: session.access_token,
          userId: session.user.id,
          email: session.user.email ?? "",
        })
      } else {
        maestro.bridgeSession(null)
      }
    }

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!isMounted) return
      bridge(session)
      if (session?.user) {
        const restored = await resolveRestoredUser(session)

        if (isMounted) setSupabaseUser(restored)
      } else {
        if (isMounted) setSupabaseUser(null)
      }
      /* Latched last, so any guard that starts waiting is released only
       * after the user is already in state. */
      if (isMounted) setAuthReady(true)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        if (!isMounted) return
        bridge(session)
        if (session?.user) {
          const restored = await resolveRestoredUser(session)

          if (isMounted) setSupabaseUser(restored)
        } else {
          if (isMounted) setSupabaseUser(null)
        }
        if (isMounted) setAuthReady(true)
      },
    )

    return () => {
      isMounted = false
      subscription.unsubscribe()
    }
  }, [])

  // In Supabase mode, supabaseUser is the source of truth.
  // In fallback mode, resolve from db.users using sessionId.
  const user = useMemo<User | null>(() => {
    if (isSupabaseConfigured) return supabaseUser
    if (!sessionId) return null
    const stored = db.users.find((u) => u.user_id === sessionId)
    return stored ? toPublicUser(stored) : null
  }, [db.users, sessionId, supabaseUser])

  /* ── Entitlements ───────────────────────────────────────
   *
   * A purchase approved by a payment provider, or a book an admin granted
   * by hand, is recorded in Supabase — but the library and the reader read
   * the local store, so the signed-in account's own rows are cached there.
   * Without this a paying customer saw an empty library no matter what the
   * server held.
   *
   * Keyed on the account id rather than the `user` object: a profile
   * rewrite (a `last_activity_at` stamp is enough) hands back a fresh
   * object and would otherwise re-run this on every store write. Only the
   * signed-in user's own rows are fetched, and the cache is merged, never
   * replaced — a local purchase must survive. */
  const refreshEntitlements = useCallback(
    async (uid: string) => {
      if (!isSupabaseConfigured) return

      const rows = await fetchMyEntitlements(uid)

      /* null (failed read) leaves the cache untouched; a real empty
       * result prunes rows the server has removed — הסרה מלאה must
       * reach this browser, not just the database. */
      if (rows !== null) mirrorRemoteEntitlements(rows)
    },
    [],
  )

  /* Bound to the signed-in account and memoised on the id alone, so its
   * identity survives the re-renders every store write causes. The
   * reader's revalidation beat keys its interval on this function; a
   * fresh identity per render would reset the timer before it could
   * fire. */
  const refreshMyEntitlements = useCallback(
    () => (user ? refreshEntitlements(user.user_id) : Promise.resolve()),
    [user?.user_id, refreshEntitlements],
  )

  useEffect(() => {
    if (!isSupabaseConfigured || !user) return

    let cancelled = false

    const sync = async () => {
      const rows = await fetchMyEntitlements(user.user_id)

      if (!cancelled && rows !== null) mirrorRemoteEntitlements(rows)
    }

    void sync()

    /* Also on return to the tab, so access granted while the reader was
     * elsewhere shows up without a full reload — but no more than once a
     * minute. The reader triggers focus/visibility events constantly
     * (fullscreen switches, iframe interactions, device-session writes
     * that touch the document), and each one used to re-fan into a
     * Supabase round trip. Nothing here is a security check: the reader's
     * grant mint re-verifies the entitlement server-side regardless, so
     * throttling this cache refresh does not weaken authorization. */
    const ENTITLEMENT_SYNC_MIN_MS = 60_000
    let lastSyncAt = Date.now()

    const onFocus = () => {
      if (document.visibilityState !== "visible") return
      if (Date.now() - lastSyncAt < ENTITLEMENT_SYNC_MIN_MS) return
      lastSyncAt = Date.now()
      void sync()
    }

    window.addEventListener("focus", onFocus)

    return () => {
      cancelled = true
      window.removeEventListener("focus", onFocus)
    }
  }, [user?.user_id, refreshEntitlements])

  /* ── Realtime entitlement push ──────────────────────────
   *
   * The fetch paths above all share one weakness: something must
   * trigger them. While a customer sits on the Reader with the tab
   * visible, neither focus nor the throttled refetch fires, and the
   * 30 s revalidation beat in the Reader is a poll, not a push — an
   * access change landed up to 30 s late, and a Library customer saw
   * it only on the next focus.
   *
   * This subscription closes that gap: Supabase Realtime delivers
   * postgres_changes events for public.user_products, filtered by the
   * table's RLS to the signed-in account's own rows (migration 0017
   * added the table to the supabase_realtime publication). On every
   * event the client refetches its rows and mirrors them — the event
   * itself is treated as a hint, not as data, so the payload's shape
   * can never inject state; only a fresh RLS-scoped SELECT writes to
   * the mirror.
   *
   * This is a UX-latency mechanism, never an authorization one. Even
   * if the socket is down or an event is dropped, get-content-url
   * re-checks access_status = 'ACTIVE' server-side on every signing,
   * and the Reader's 30 s beat remains the polling fallback.
   */
  useEffect(() => {
    if (!isSupabaseConfigured || !user) return

    const client = requireSupabase()

    /* One channel per signed-in account, filtered server-side by RLS
     * and client-side by the filter option (belt and brace: the filter
     * keeps unrelated traffic off the wire even for a staff account
     * whose RLS scope is wider). */
    const channel = client
      .channel(`user-products-${user.user_id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "user_products",
          filter: `user_id=eq.${user.user_id}`,
        },
        () => {
          void refreshEntitlements(user.user_id)
        },
      )
      .subscribe()

    return () => {
      void client.removeChannel(channel)
    }
  }, [user?.user_id, refreshEntitlements])

  /* ── Entitlement revalidation beat ──────────────────────
   *
   * The Realtime subscription above cannot deliver DELETE events
   * reliably: RLS is not applied to deletes (there is no row left to
   * check the policy against) and a column filter is evaluated against
   * the old record, which on an RLS-protected table carries only the
   * primary key — so הסרה מלאה produced no event the subscription could
   * match, and the removed book sat in the customer's Library until a
   * manual refresh. INSERT and UPDATE (grant, חסימה, שלילה) are
   * unaffected: they carry the full row and arrive instantly.
   *
   * A short polling beat therefore backs the push for every screen —
   * not just the Reader, whose own 30 s beat covers only the reader
   * route. Thirty seconds bounds how long a removed book lingers in the
   * Library; each beat is one cheap RLS-scoped SELECT of the account's
   * own rows, and the mirror skips the write entirely when nothing
   * changed. Still a UX-latency mechanism only: authorization stays
   * server-side in get-content-url.
   */
  useEffect(() => {
    if (!isSupabaseConfigured || !user) return

    const beat = window.setInterval(() => {
      if (document.visibilityState !== "visible") return
      void refreshEntitlements(user.user_id)
    }, ENTITLEMENT_REVALIDATE_MS)

    return () => {
      window.clearInterval(beat)
    }
  }, [user?.user_id, refreshEntitlements])

  // A dropped or deactivated account ends the session immediately.
  useEffect(() => {
    if (!isSupabaseConfigured && sessionId && !user) {
      writeSessionUserId(null)
      setSessionId(null)
    }
  }, [sessionId, user])

  /* Keyed on the primitives actorFromUser actually reads, not on the `user`
   * object. `user` is rebuilt whenever the users table changes identity —
   * which a `last_activity_at` stamp alone is enough to do — and handing back
   * a fresh `actor` each time would churn every callback keyed on it and
   * re-run effects in screens that only care about *who* is signed in. */
  const actor = useMemo(
    () => actorFromUser(user),
    [
      user?.user_id,
      user?.first_name,
      user?.last_name,
      user?.role,
      user?.admin_role,
    ],
  )

  const beginSession = useCallback((next: User) => {
    writeSessionUserId(next.user_id)
    setSessionId(next.user_id)
  }, [])

  const login = useCallback(
    async (email: string, password: string): Promise<AuthOutcome> => {
      if (isSupabaseConfigured) {
        const res = await signInWithEmail(email, password)
        if (!res.ok) {
          return {
            ok: false,
            error: res.error,
            isUnconfirmed: res.isUnconfirmed,
          }
        }
        setSupabaseUser(res.data)
        return { ok: true, user: res.data }
      }
      const result = await loginRequest(email, password)
      if (result.ok) beginSession(result.data)
      return toOutcome(result)
    },
    [beginSession],
  )

  const register = useCallback(
    async (input: RegisterInput): Promise<AuthOutcome> => {
      if (isSupabaseConfigured) {
        if (!input.password) {
          return { ok: false, error: "נדרשת סיסמה לצורך הרשמה." }
        }
        const res = await signUpWithEmail({
          first_name: input.first_name,
          last_name: input.last_name,
          email: input.email,
          password: input.password,
          phone: input.phone,
        })
        if (!res.ok) {
          return { ok: false, error: res.error }
        }
        if (res.data.user && !res.data.needsEmailConfirmation) {
          setSupabaseUser(res.data.user)
        }
        return {
          ok: true,
          user: res.data.user || undefined,
          needsEmailConfirmation: res.data.needsEmailConfirmation,
        }
      }
      const result = await registerCustomer(input, {
        upgradeUserId: sessionId,
      })
      if (result.ok) beginSession(result.data)
      return toOutcome(result)
    },
    [beginSession, sessionId],
  )

  const resendConfirmation = useCallback(async (email: string) => {
    const res = await resendVerification(email)
    return { ok: res.ok, error: !res.ok ? res.error : undefined }
  }, [])

  const setupAdmin = useCallback(
    async (input: BootstrapInput): Promise<AuthOutcome> => {
      const result = await bootstrapAdmin(input)
      if (result.ok) beginSession(result.data)
      return toOutcome(result)
    },
    [beginSession],
  )

  /* ── Cart ─────────────────────────────────────────────── */
  const [cart, setCart] = useState<CartItem[]>([])
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)
  const [lastOrderId, setLastOrderId] = useState<string | null>(null)

  const logout = useCallback(async () => {
    if (isSupabaseConfigured) {
      await signOutUser()
      setSupabaseUser(null)
    }
    writeSessionUserId(null)
    setSessionId(null)
    setCart([])
    setSelectedProduct(null)
  }, [])

  const addToCart = useCallback((product: Product) => {
    setCart((prev) =>
      prev.some((item) => item.product_id === product.product_id)
        ? prev
        : [...prev, { product_id: product.product_id, quantity: 1 }],
    )
  }, [])

  const removeFromCart = useCallback((productId: string) => {
    setCart((prev) => prev.filter((item) => item.product_id !== productId))
  }, [])

  const clearCart = useCallback(() => setCart([]), [])

  const cartLines = useMemo(
    () =>
      cart
        .map((item) => {
          const product = db.products.find(
            (p) => p.product_id === item.product_id,
          )
          if (!product) return null
          return {
            product,
            quantity: item.quantity,
            line_total: effectivePrice(product) * item.quantity,
          }
        })
        .filter(
          (line): line is {
            product: Product
            quantity: number
            line_total: number
          } => line !== null,
        ),
    [cart, db.products],
  )

  const cartTotal = useMemo(
    () => cartLines.reduce((sum, line) => sum + line.line_total, 0),
    [cartLines],
  )

  const placeOrder = useCallback(
    async (input: CheckoutInput): Promise<Result<CheckoutOutcome>> => {
      const result = await checkout(input)
      if (result.ok) {
        setLastOrderId(result.data.order.order_id)
        setCart([])
        // While no payment gateway is connected checkout auto-approves the
        // order and grants access at once. Sign a guest buyer into the account
        // we just created so they can open the book immediately; a buyer who is
        // already signed in keeps their current session.
        if (result.data.auto_approved && !readSessionUserId()) {
          beginSession(result.data.customer)
        }
      }
      return result
    },
    [beginSession],
  )

  const lastOrder = useMemo(
    () =>
      lastOrderId
        ? (db.orders.find((o) => o.order_id === lastOrderId) ?? null)
        : null,
    [db.orders, lastOrderId],
  )

  /* ── Library ──────────────────────────────────────────── */
  const userProducts = useMemo(
    () =>
      user ? db.user_products.filter((up) => up.user_id === user.user_id) : [],
    [db.user_products, user],
  )

  const readingProgress = useMemo(
    () =>
      user
        ? db.reading_progress.filter((rp) => rp.user_id === user.user_id)
        : [],
    [db.reading_progress, user],
  )

  const orders = useMemo(() => listOrdersForUser(actor), [actor, db.orders])

  const hasAccess = useCallback(
    (productId: string) =>
      userProducts.some(
        (up) => up.product_id === productId && up.access_status === "ACTIVE",
      ),
    [userProducts],
  )

  const getProgress = useCallback(
    (productId: string) =>
      readingProgress.find((rp) => rp.product_id === productId),
    [readingProgress],
  )

  const updateProgress = useCallback(
    (productId: string, page: number, totalPages: number) => {
      // Failures are swallowed on purpose: losing a page marker must never
      // interrupt reading. The service still refuses writes without access.
      saveReadingProgress(actor, productId, page, totalPages)
    },
    [actor],
  )

  return (
    <AppContext.Provider
      value={{
        user,
        actor,
        isAuthenticated: Boolean(user),
        isAdmin: user?.role === "ADMIN",
        adminRole: user?.admin_role,
        authReady,
        bootstrapRequired: isSupabaseConfigured ? false : isBootstrapRequired(),
        theme,
        toggleTheme,
        login,
        register,
        resendConfirmation,
        setupAdmin,
        logout,
        cart,
        cartLines,
        cartTotal,
        selectedProduct,
        setSelectedProduct,
        addToCart,
        removeFromCart,
        clearCart,
        placeOrder,
        lastOrder,
        userProducts,
        readingProgress,
        orders,
        refreshEntitlements: refreshMyEntitlements,
        hasAccess,
        getProgress,
        updateProgress,
      }}
    >
      {children}
    </AppContext.Provider>
  )
}

export function useApp() {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error("useApp must be used inside AppProvider")
  return ctx
}
