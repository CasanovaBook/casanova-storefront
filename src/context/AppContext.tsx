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
import { saveReadingProgress } from "../lib/api-support"
import {
  checkout,
  listOrdersForUser,
  type CheckoutInput,
  type CheckoutOutcome,
} from "../lib/api-orders"

const THEME_KEY = "casanova_theme"

export interface AuthOutcome {
  ok: boolean
  error?: string
  user?: User
}

interface AppContextValue {
  /** Live database snapshot — the single source of truth for every screen. */
  user: User | null
  actor: Actor | null
  isAuthenticated: boolean
  isAdmin: boolean
  adminRole: AdminRole | undefined
  /** True while no administrator exists yet; gates the first-run setup screen. */
  bootstrapRequired: boolean

  theme: "dark" | "light"
  toggleTheme: () => void

  /* ── Auth ── */
  login: (email: string, password: string) => Promise<AuthOutcome>
  register: (input: RegisterInput) => Promise<AuthOutcome>
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
  const [sessionId, setSessionId] = useState<string | null>(() =>
    readSessionUserId(),
  )

  // Resolved from the store on every change, so an admin editing this
  // account (suspension, role change) is reflected without a re-login.
  const user = useMemo<User | null>(() => {
    if (!sessionId) return null
    const stored = db.users.find((u) => u.user_id === sessionId)
    return stored ? toPublicUser(stored) : null
  }, [db.users, sessionId])

  // A dropped or deactivated account ends the session immediately.
  useEffect(() => {
    if (sessionId && !user) {
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
      const result = await loginRequest(email, password)
      if (result.ok) beginSession(result.data)
      return toOutcome(result)
    },
    [beginSession],
  )

  const register = useCallback(
    async (input: RegisterInput): Promise<AuthOutcome> => {
      const result = await registerCustomer(input)
      if (result.ok) beginSession(result.data)
      return toOutcome(result)
    },
    [beginSession],
  )

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

  const logout = useCallback(() => {
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
        bootstrapRequired: isBootstrapRequired(),
        theme,
        toggleTheme,
        login,
        register,
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
