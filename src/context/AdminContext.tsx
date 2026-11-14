/* ─────────────────────────────────────────────────────────────
 * Admin operations context.
 *
 * Read side: every collection is projected straight from the store,
 * never from a second copy that could drift. Alerts and revenue are
 * derived on read, so no total is stored that could disagree with the
 * transactions it came from.
 *
 * Write side: every action is a thin call into the service layer with
 * the signed-in admin attached. The service refuses anything the
 * admin's role may not do - the checks in the pages only decide what
 * to render, never what is allowed.
 * ───────────────────────────────────────────────────────────── */

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react"

import type {
  AdminRole,
  AdminSubscription,
  AuditCategory,
  AuditLogEntry,
  EmailLog,
  Inquiry,
  InquiryNote,
  Invoice,
  Order,
  Payment,
  PlatformSettings,
  ReadingProgress,
  Refund,
  RefundRequestStatus,
  SystemAlert,
  User,
  UserProduct,
} from "../types"

import { useStore } from "../data/store"

import { computeAlerts } from "../lib/alerts"

import {
  computeRevenue,
  lifetimeTotals,
  presetRange,
  type DateRange,
  type RangePreset,
  type RevenueSummary,
} from "../lib/analytics"

import {
  createPasswordResetForUser,
  dismissAlert,
  listAudit,
  ok,
  reinstateAlert,
  resendEmail,
  updateSettings,
  writeAudit,
  type Actor,
  type AuditInput,
  type Result,
} from "../lib/api"

import {
  cancelSubscription,
  confirmRefund as confirmRefundLocal,
  executeRefund as executeRefundLocal,
  failRefund as failRefundLocal,
  issueInvoice as issueInvoiceLocal,
  markOrderFailed as markOrderFailedLocal,
  markOrderPaid as markOrderPaidLocal,
  refundableAmount as refundableAmountLocal,
  requestRefund as requestRefundLocal,
  reviewRefund as reviewRefundLocal,
  cancelOrder as cancelOrderLocal,
  type ConfirmPaymentInput,
} from "../lib/api-orders"

import {
  confirmRefundRemote,
  executeRefundRemote,
  failRefundRemote,
  fetchAllInvoices,
  fetchAllPayments,
  fetchAllRefunds,
  fetchAuditLog,
  issueInvoiceRemote,
  requestRefundRemote,
  reviewRefundRemote,
} from "../integrations/supabase/supabase-finance"

import {
  addInquiryNote,
  deleteInquiry,
  grantAccess,
  getCustomerProfile,
  linkInquiryToOrder,
  mirrorRemoteInquiries,
  removeAccess,
  setAccessStatus,
  setUserAdminRole,
  setUserStatus,
  updateInquiry,
  updateUser,
  upsertRemoteInquiryNotes,
  type CustomerProfile,
} from "../lib/api-support"

import { isSupabaseConfigured, requireSupabase } from "../integrations/supabase/supabase"

import {
  fetchAllInquiries,
  fetchAllInquiryNotes,
} from "../integrations/supabase/supabase-inquiries"

import { fetchAllProfiles, mergeUserSources } from "../integrations/supabase/supabase-auth"

import { fetchAllEntitlements } from "../integrations/supabase/supabase-entitlements"

import { createAdminPasswordResetLink } from "../integrations/supabase/supabase-admin"

import {
  cancelOrderRemote,
  fetchAllOrders,
  markOrderFailedRemote,
  markOrderPaidRemote,
} from "../integrations/supabase/supabase-orders"

import { useApp } from "./AppContext"

interface AdminContextValue {
  actor: Actor | null

  adminRole: AdminRole | undefined

  /* Collections, live from the store */

  /**
   * Every known account: the local store merged with `public.users`,
   * which wins on any `user_id` present in both. Shared by the dashboard
   * and /admin/users so the two can never disagree.
   */
  users: User[]

  /** True while the Supabase user list is being (re)read. */
  usersLoading: boolean

  /** Re-reads `public.users` now. Safe to call repeatedly. */
  refreshUsers: () => Promise<void>

  /** Non-null when the hosted user list could not be read. */
  usersError: string | null

  /**
   * Every known order: the local document merged with `public.orders`, which
   * wins on any `order_id` present in both. The admin screens read this one
   * array so the dashboard and /admin/orders cannot disagree.
   */
  orders: Order[]

  /** True while the Supabase order list is being (re)read. */
  ordersLoading: boolean

  /** Non-null when the last hosted order read failed. The previous list is
   *  kept on screen; this is what stops an outage rendering as "0 orders". */
  ordersError: string | null

  /** Re-reads the hosted orders now. Safe to call repeatedly. */
  refreshOrders: () => Promise<void>

  payments: Payment[]

  invoices: Invoice[]

  refunds: Refund[]

  /** True while the hosted finance reads are in flight. */
  financeLoading: boolean

  /** Non-null when invoices, refunds or payments failed to load. The last
   *  successful lists stay on screen; this is what prevents an outage from
   *  rendering as "no invoices / no refunds". */
  financeError: string | null

  /** Re-reads hosted invoices, refunds and payments now. */
  refreshFinance: () => Promise<void>

  subscriptions: AdminSubscription[]

  userProducts: UserProduct[]

  /** Non-null when the hosted entitlement list could not be read. */
  entitlementsError: string | null

  /** Re-reads the hosted entitlements now. */
  refreshEntitlements: () => Promise<void>

  readingProgress: ReadingProgress[]

  emailLogs: EmailLog[]

  auditLog: AuditLogEntry[]

  /** True while the hosted audit log is being read. */
  auditLoading: boolean

  /** Non-null when the hosted audit log could not be read. */
  auditError: string | null

  /** Re-reads the hosted audit log now. */
  refreshAudit: () => Promise<void>

  inquiries: Inquiry[]

  inquiryNotes: InquiryNote[]

  dismissedAlerts: string[]

  /* Derived */

  alerts: SystemAlert[]

  openAlerts: SystemAlert[]

  dismissAlert: (alertId: string) => Result

  reinstateAlert: (alertId: string) => Result

  revenueFor: (
    preset: RangePreset,
    custom?: { from?: string, to?: string },
  ) => RevenueSummary

  rangeFor: (
    preset: RangePreset,
    custom?: { from?: string, to?: string },
  ) => DateRange

  lifetime: { gross: number, net: number, refunded: number }

  /* Audit */

  recordAudit: (entry: AuditInput) => void

  /* Customers */

  updateUser: (
    userId: string,

    patch: Partial<Pick<User, "first_name" | "last_name" | "email" | "phone" | "admin_role" | "role">>,

    auditAction?: string,

    auditCategory?: AuditCategory,
  ) => Result<User>

  setUserStatus: (
    userId: string,
    status: User["account_status"],
  ) => Promise<Result<User>>

  setUserAdminRole: (userId: string, adminRole: AdminRole) => Result<User>

  customerProfile: (userId: string) => Result<CustomerProfile>

  /* Yields a ready-to-use URL rather than a raw token, because the two
   * backends mint links in different shapes: the local driver issues a token
   * that this app consumes, while Supabase issues a complete action link.
   * Callers render a single field either way. */
  createPasswordResetLink: (
    userId: string,
  ) => Promise<Result<{ link: string, expires_at: string }>>

  /* Access management */

  grantAccess: (
    userId: string,
    productId: string,
    sourceOrderId?: string,
  ) => Promise<Result<UserProduct>>

  setAccessStatus: (
    userProductId: string,
    status: UserProduct["access_status"],
    actionLabel?: string,
  ) => Promise<Result>

  removeAccess: (userProductId: string) => Promise<Result>

  /* Orders & payments */

  markOrderPaid: (
    orderId: string,
    input?: ConfirmPaymentInput,
  ) => Promise<Result<Order>>

  markOrderFailed: (orderId: string, reason: string) => Promise<Result<Order>>

  cancelOrder: (orderId: string, reason?: string) => Promise<Result<Order>>

  issueInvoice: (orderId: string) => Promise<Result<Invoice>>

  /* Refunds - recording a request never moves money */

  refundableAmount: (order: Order) => number

  requestRefund: (
    orderId: string,
    amount: number,
    reason: string,
  ) => Promise<Result<Refund>>

  reviewRefund: (
    refundId: string,
    decision: "APPROVED" | "REJECTED",
    note?: string,
  ) => Promise<Result<Refund>>

  executeRefund: (refundId: string) => Promise<Result<Refund>>

  confirmRefund: (
    refundId: string,
    providerRefundId: string,
  ) => Promise<Result<Refund>>

  failRefund: (refundId: string, note: string) => Promise<Result<Refund>>

  /* Subscriptions & email */

  cancelSubscription: (subscriptionId: string) => Result

  resendEmail: (emailLogId: string) => Result<EmailLog>

  /* Support inquiries */

  updateInquiry: (
    inquiryId: string,

    patch: Partial<Pick<Inquiry, "status" | "assigned_to" | "related_order_id" | "topic" | "subject">>,
  ) => Promise<Result<Inquiry>>

  linkInquiryToOrder: (
    inquiryId: string,
    orderId: string | null,
  ) => Promise<Result<Inquiry>>

  addInquiryNote: (
    inquiryId: string,
    content: string,
    internal?: boolean,
  ) => Promise<Result<InquiryNote>>

  deleteInquiry: (inquiryId: string) => Promise<Result<void>>

  /* Platform settings */

  updateSettings: (patch: Partial<PlatformSettings>) => Result<PlatformSettings>
}

const AdminContext = createContext<AdminContextValue | null>(null)

/** Exposed so callers can hand a refund status to the UI without re-importing. */

export type { RefundRequestStatus }

export function AdminProvider({ children }: { children: ReactNode }) {
  const db = useStore()

  const { actor, user } = useApp()

  /* ── Users ────────────────────────────────────────────────
   *
   * The admin user list is the one collection that cannot be served from
   * the local store alone. `db.users` only ever holds records this browser
   * created, so an account registered through Supabase Auth - by any other
   * visitor, on any other device - was invisible in the admin dashboard
   * until it was rebuilt by hand.
   *
   * `public.users` is the source of truth for authenticated accounts, so it
   * is read here and merged over the local rows by `user_id`. Both the
   * dashboard's "משתמשים אחרונים" panel and /admin/users read the single
   * `users` array produced below, which is what keeps the two screens
   * consistent by construction rather than by convention.
   *
   * Nothing is written back: this is a read-through cache, so the browser
   * never becomes a second source of truth and no user is ever duplicated.
   */
  const [remoteUsers, setRemoteUsers] = useState<User[]>([])

  const [usersLoading, setUsersLoading] = useState(false)

  const [usersError, setUsersError] = useState<string | null>(null)

  const refreshUsers = useMemo(
    () => async () => {
      if (!isSupabaseConfigured) {
        setRemoteUsers([])
        setUsersError(null)
        return
      }

      setUsersLoading(true)
      try {
        const result = await fetchAllProfiles()

        if (result.ok) {
          setRemoteUsers(result.data)
          setUsersError(null)
        } else {
          setUsersError(result.error)
        }
      } catch (err) {
        setUsersError(
          err instanceof Error ? err.message : "טעינת המשתמשים נכשלה.",
        )
      } finally {
        setUsersLoading(false)
      }
    },
    [],
  )

  /* Fetch once an admin session exists, and again whenever the signed-in
   * user changes - the read is RLS-gated on that identity, so running it
   * while signed out would only ever return an empty list. */
  useEffect(() => {
    if (!user) return
    void refreshUsers()
  }, [user?.user_id, refreshUsers])

  /* Re-read when the admin returns to the tab. This is what makes a user
   * who registered while the dashboard sat open in another window appear
   * without a manual reload. */
  useEffect(() => {
    if (!user) return
    const onFocus = () => {
      if (document.visibilityState === "visible") void refreshUsers()
    }
    document.addEventListener("visibilitychange", onFocus)
    window.addEventListener("focus", onFocus)
    return () => {
      document.removeEventListener("visibilitychange", onFocus)
      window.removeEventListener("focus", onFocus)
    }
  }, [user?.user_id, refreshUsers])

  const users = useMemo(
    () => (isSupabaseConfigured ? remoteUsers : mergeUserSources(db.users, [])),
    [db.users, remoteUsers],
  )

  /* ── Entitlements ─────────────────────────────────────────
   *
   * The same split the users list had: a purchase or a grant made
   * elsewhere lives in Supabase, while `db.user_products` only ever holds
   * rows this browser wrote. Reading the hosted rows here is what lets
   * /admin/access and /admin/users show the real entitlements - including
   * one just created by an admin - instead of an empty local list.
   *
   * Read-through cache, merged by the entitlement's identity
   * (`user_id` + `product_id`, which is what the table itself is unique
   * on). Nothing is written back to Supabase from this state.
   */
  const [remoteEntitlements, setRemoteEntitlements] = useState<UserProduct[]>([])

  const [entitlementsError, setEntitlementsError] = useState<string | null>(
    null,
  )

  /** Merges rows returned by an admin action into the cache immediately, so
   *  the list updates even before (or without) the next full read. */
  const upsertRemoteEntitlement = useCallback((row: UserProduct) => {
    setRemoteEntitlements((prev) => {
      const key = (up: UserProduct) => `${up.user_id}:${up.product_id}`
      const byKey = new Map(prev.map((up) => [key(up), up]))
      byKey.set(key(row), row)
      return [...byKey.values()]
    })
  }, [])

  const refreshEntitlements = useMemo(
    () => async () => {
      if (!isSupabaseConfigured) {
        setRemoteEntitlements([])
        setEntitlementsError(null)
        return
      }

      try {
        const result = await fetchAllEntitlements()

        /* A successful empty answer clears the list: rows deleted in
         * Supabase must not linger as ghost grants. A failed read keeps
         * the last successful list and records the error, so an outage
         * cannot be mistaken for "no entitlements". */
        if (result.ok) {
          setRemoteEntitlements(result.data)
          setEntitlementsError(null)
        } else {
          setEntitlementsError(result.error)
        }
      } catch (err) {
        setEntitlementsError(
          err instanceof Error ? err.message : "טעינת הרשאות הגישה נכשלה.",
        )
      }
    },
    [],
  )

  /* Read once an admin session exists (the read is RLS-gated on that
   * identity), and again whenever the signed-in user changes. */
  useEffect(() => {
    if (!user || !isSupabaseConfigured) return
    void refreshEntitlements()
  }, [user?.user_id, refreshEntitlements])

  /* And on return to the tab, so a purchase approved while the panel sat
   * open appears without a manual reload. */
  useEffect(() => {
    if (!user || !isSupabaseConfigured) return
    const onFocus = () => {
      if (document.visibilityState === "visible") void refreshEntitlements()
    }
    window.addEventListener("focus", onFocus)
    return () => window.removeEventListener("focus", onFocus)
  }, [user?.user_id, refreshEntitlements])

  /* ── Support tickets (staff queue) ──────────────────────
   *
   * Tickets submitted from the customer's device land in Postgres, so the
   * queue is mirrored here the way the users list is: an initial read once
   * a staff session exists, a re-read on returning to the tab, and a
   * realtime subscription that refetches on every change - the event is a
   * hint; the RLS-scoped read is the data. A non-staff JWT passes only its
   * own rows' policies, so the mirror can never widen beyond what the
   * server allows.
   */
  const isStaff =
    user?.role === "ADMIN" || user?.role === "MODERATOR"

  /* Tickets and their conversations come from the same authoritative read,
   * in parallel: the customer's reply and the admin's own reply must both be
   * visible in the queue, and the notes read is RLS-scoped like the tickets
   * one - an admin sees every conversation, nobody else sees more than
   * their own. */
  const refreshInquiries = useMemo(
    () => async () => {
      const [tickets, notes] = await Promise.all([
        fetchAllInquiries(),
        fetchAllInquiryNotes(),
      ])

      mirrorRemoteInquiries(tickets, null)

      upsertRemoteInquiryNotes(notes ?? [])
    },
    [],
  )

  useEffect(() => {
    if (!user || !isSupabaseConfigured || !isStaff) return
    void refreshInquiries()
  }, [user?.user_id, isStaff, refreshInquiries])

  useEffect(() => {
    if (!user || !isSupabaseConfigured || !isStaff) return
    const onFocus = () => {
      if (document.visibilityState === "visible") void refreshInquiries()
    }
    window.addEventListener("focus", onFocus)
    return () => window.removeEventListener("focus", onFocus)
  }, [user?.user_id, isStaff, refreshInquiries])

  useEffect(() => {
    if (!user || !isSupabaseConfigured || !isStaff) return
    const client = requireSupabase()
    const channel = client
      .channel("inquiries-staff")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "inquiries" },
        () => {
          void refreshInquiries()
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "inquiry_notes" },
        () => {
          void refreshInquiries()
        },
      )
      .subscribe()
    return () => {
      void client.removeChannel(channel)
    }
  }, [user?.user_id, isStaff, refreshInquiries])

  /* ── Orders ───────────────────────────────────────────────
   *
   * Purchases are recorded in Supabase by the checkout RPCs, while
   * `db.orders` only ever holds what this browser saw. Reading the hosted
   * rows here is what makes a sale from another device appear in
   * /admin/orders and in the dashboard's order and revenue figures.
   *
   * A failed read keeps the last successful list and records the error,
   * so the screens can distinguish "no orders" from "could not load".
   */
  const [remoteOrders, setRemoteOrders] = useState<Order[] | null>(null)

  const [ordersLoading, setOrdersLoading] = useState(false)

  const [ordersError, setOrdersError] = useState<string | null>(null)

  const refreshOrders = useMemo(
    () => async () => {
      if (!isSupabaseConfigured) {
        setRemoteOrders(null)
        setOrdersError(null)
        return
      }

      setOrdersLoading(true)
      try {
        const result = await fetchAllOrders()
        if (result.ok) {
          setRemoteOrders(result.data)
          setOrdersError(null)
        } else {
          setOrdersError(result.error)
        }
      } finally {
        setOrdersLoading(false)
      }
    },
    [],
  )

  /* Read once a staff session exists: the query is RLS-gated on that
   * identity, so running it while signed out could only return nothing. */
  useEffect(() => {
    if (!user || !isSupabaseConfigured || !isStaff) return
    void refreshOrders()
  }, [user?.user_id, isStaff, refreshOrders])

  /* And on return to the tab, so an order placed while the panel sat open
   * appears without a manual reload. */
  useEffect(() => {
    if (!user || !isSupabaseConfigured || !isStaff) return
    const onFocus = () => {
      if (document.visibilityState === "visible") void refreshOrders()
    }
    window.addEventListener("focus", onFocus)
    return () => window.removeEventListener("focus", onFocus)
  }, [user?.user_id, isStaff, refreshOrders])

  /* ── Finance: invoices, refunds, payments ─────────────────
   *
   * These are the rows the finance/orders screens render and the
   * refund totals revenue is derived from. They are read from Postgres
   * whenever it is configured; the local document is only the fallback
   * for an unconfigured install. A failed read keeps the last successful
   * list and records the error, so an outage is never rendered as
   * "no invoices" or "no refunds".
   */
  const [remoteInvoices, setRemoteInvoices] = useState<Invoice[] | null>(null)

  const [remoteRefunds, setRemoteRefunds] = useState<Refund[] | null>(null)

  const [remotePayments, setRemotePayments] = useState<Payment[] | null>(null)

  const [financeLoading, setFinanceLoading] = useState(false)

  const [financeError, setFinanceError] = useState<string | null>(null)

  const refreshFinance = useMemo(
    () => async () => {
      if (!isSupabaseConfigured) {
        setRemoteInvoices(null)
        setRemoteRefunds(null)
        setRemotePayments(null)
        setFinanceError(null)
        return
      }

      setFinanceLoading(true)
      try {
        const [invoicesResult, refundsResult, paymentsResult] =
          await Promise.all([
            fetchAllInvoices(),
            fetchAllRefunds(),
            fetchAllPayments(),
          ])

        const errors: string[] = []

        if (invoicesResult.ok) setRemoteInvoices(invoicesResult.data)
        else errors.push(invoicesResult.error)

        if (refundsResult.ok) setRemoteRefunds(refundsResult.data)
        else errors.push(refundsResult.error)

        if (paymentsResult.ok) setRemotePayments(paymentsResult.data)
        else errors.push(paymentsResult.error)

        setFinanceError(errors.length > 0 ? errors.join(" ") : null)
      } catch (err) {
        setFinanceError(
          err instanceof Error ? err.message : "טעינת נתוני הכספים נכשלה.",
        )
      } finally {
        setFinanceLoading(false)
      }
    },
    [],
  )

  useEffect(() => {
    if (!user || !isSupabaseConfigured || !isStaff) return
    void refreshFinance()
  }, [user?.user_id, isStaff, refreshFinance])

  useEffect(() => {
    if (!user || !isSupabaseConfigured || !isStaff) return
    const onFocus = () => {
      if (document.visibilityState === "visible") void refreshFinance()
    }
    window.addEventListener("focus", onFocus)
    return () => window.removeEventListener("focus", onFocus)
  }, [user?.user_id, isStaff, refreshFinance])

  /* ── Audit log ────────────────────────────────────────────
   * Server-side RPCs append their own audit rows; every other hosted
   * admin write is followed by a re-read. The browser-local audit trail
   * is only used when Supabase is unconfigured.
   */
  const [remoteAudit, setRemoteAudit] = useState<AuditLogEntry[] | null>(null)

  const [auditLoading, setAuditLoading] = useState(false)

  const [auditError, setAuditError] = useState<string | null>(null)

  const refreshAudit = useMemo(
    () => async () => {
      if (!isSupabaseConfigured) {
        setRemoteAudit(null)
        setAuditError(null)
        return
      }

      setAuditLoading(true)
      try {
        const result = await fetchAuditLog()
        if (result.ok) {
          setRemoteAudit(result.data)
          setAuditError(null)
        } else {
          setAuditError(result.error)
        }
      } catch (err) {
        setAuditError(
          err instanceof Error ? err.message : "טעינת יומן הפעולות נכשלה.",
        )
      } finally {
        setAuditLoading(false)
      }
    },
    [],
  )

  useEffect(() => {
    if (!user || !isSupabaseConfigured || !isStaff) return
    void refreshAudit()
  }, [user?.user_id, isStaff, refreshAudit])

  useEffect(() => {
    if (!user || !isSupabaseConfigured || !isStaff) return
    const onFocus = () => {
      if (document.visibilityState === "visible") void refreshAudit()
    }
    window.addEventListener("focus", onFocus)
    return () => window.removeEventListener("focus", onFocus)
  }, [user?.user_id, isStaff, refreshAudit])

  /* Hosted rows are the whole answer once Supabase is configured: mixing
   * the local document back in would resurrect rows deleted server-side
   * and make a browser-local order look like a real sale. */
  const payments = isSupabaseConfigured ? (remotePayments ?? []) : db.payments

  const invoices = isSupabaseConfigured ? (remoteInvoices ?? []) : db.invoices

  const refunds = isSupabaseConfigured ? (remoteRefunds ?? []) : db.refunds

  const auditLog = isSupabaseConfigured ? (remoteAudit ?? []) : db.audit_log

  const baseOrders = useMemo(() => {
    const rows = isSupabaseConfigured ? (remoteOrders ?? []) : db.orders

    return [...rows].sort((a, b) => b.created_at.localeCompare(a.created_at))
  }, [db.orders, remoteOrders])

  /* `orders` deliberately stores no refund roll-up (schema.sql derives it
   * in v_order_refunds), and no provider fields either (those live on the
   * captured payment). Both are attached here so the list, the modal and
   * the revenue figures read the same facts. */
  const orders = useMemo(() => {
    const captured = new Map<string, Payment>()

    payments.forEach((payment) => {
      if (payment.status === "CAPTURED" && !captured.has(payment.order_id))
        captured.set(payment.order_id, payment)
    })

    return baseOrders.map((order) => {
      const refunded = refunds
        .filter(
          (refund) =>
            refund.order_id === order.order_id &&
            (refund.status === "REFUNDED" || refund.status === "PROCESSING"),
        )
        .reduce((sum, refund) => sum + refund.amount, 0)

      const refundStatus: Order["refund_status"] =
        refunded <= 0
          ? order.refund_status
          : refunded >= order.total_amount
            ? "FULL"
            : "PARTIAL"

      const payment = captured.get(order.order_id)

      return {
        ...order,
        refunded_amount: refunded,
        refund_status: refundStatus,
        payment_provider: payment?.provider ?? order.payment_provider,
        transaction_reference:
          payment?.transaction_reference ?? order.transaction_reference,
        card_last4: payment?.card_last4 ?? order.card_last4,
      }
    })
  }, [baseOrders, payments, refunds])

  const userProducts = useMemo(() => {
    /* Admin manages the source of truth, which is `public.user_products`.
     * Merging the localStorage document in here resurrected rows that had
     * been deleted server-side (the customer-side mirror never deletes),
     * and every action against such a ghost failed with "הרשאת הגישה לא
     * נמצאה". When Supabase is configured the admin list is exactly the
     * server list; the local document is only a fallback for when it is
     * not configured (or the admin read is refused, which yields []). */
    if (isSupabaseConfigured) return remoteEntitlements

    return db.user_products
  }, [db.user_products, remoteEntitlements])

  /* Mirrored remote rows carry only the assignee's id; the support modal
   * renders a name, so it is resolved from the merged user list here -
   * the same display the local driver stores directly. */
  const inquiries = useMemo(() => {
    return db.inquiries.map((i) => {
      if (i.assigned_to_name || !i.assigned_to) return i
      const assignee = users.find((u) => u.user_id === i.assigned_to)
      if (!assignee) return i
      return {
        ...i,
        assigned_to_name:
          `${assignee.first_name} ${assignee.last_name}`.trim() ||
          assignee.email,
      }
    })
  }, [db.inquiries, users])

  /* Mirrored notes carry the author's id only (the table stores no name), so
   * the display name is resolved here - the same treatment `assigned_to_name`
   * gets above. A note whose author is no longer in the list keeps a neutral
   * label rather than rendering an empty name. */
  const inquiryNotes = useMemo(() => {
    return db.inquiry_notes.map((n) => {
      if (n.author_name) return n
      const author = users.find((u) => u.user_id === n.author_id)
      return {
        ...n,
        author_name: author
          ? `${author.first_name} ${author.last_name}`.trim() || author.email
          : "צוות התמיכה",
      }
    })
  }, [db.inquiry_notes, users])

  const value = useMemo<AdminContextValue>(() => {
    const alerts = computeAlerts(db)

    const dismissed = db.dismissed_alerts

    /* Hosted writes are followed by a re-read: the RPC's own row is enough
     * for the Result contract, but the lists and revenue need the server's
     * committed values. */
    const refreshAfterHostedWrite = async () => {
      await Promise.all([refreshOrders(), refreshFinance(), refreshAudit()])
    }

    return {
      actor,

      adminRole: user?.admin_role,

      users,

      usersLoading,

      usersError,

      refreshUsers,

      orders,

      ordersLoading,

      ordersError,

      refreshOrders,

      payments,

      invoices,

      refunds,

      financeLoading,

      financeError,

      refreshFinance,

      subscriptions: db.subscriptions,

      userProducts,

      entitlementsError,

      refreshEntitlements,

      readingProgress: db.reading_progress,

      emailLogs: db.email_logs,

      auditLog,

      auditLoading,

      auditError,

      refreshAudit,

      inquiries,

      inquiryNotes,

      dismissedAlerts: dismissed,

      alerts,

      openAlerts: alerts.filter((a) => !dismissed.includes(a.alert_id)),

      dismissAlert: (alertId) => dismissAlert(actor, alertId),

      reinstateAlert: (alertId) => reinstateAlert(actor, alertId),      revenueFor: (preset, custom) =>
        computeRevenue(
          orders,

          refunds,

          presetRange(preset, custom),
        ),

      rangeFor: (preset, custom) => presetRange(preset, custom),

      lifetime: lifetimeTotals(orders, refunds),

      recordAudit: (entry) => writeAudit(actor, entry),

      updateUser: (userId, patch, auditAction, auditCategory) =>
        updateUser(actor, userId, patch, auditAction, auditCategory),

      setUserStatus: async (userId, status) => {
        const result = await setUserStatus(actor, userId, status)

        /* The remote list is a read-through cache, so a write that lands in
         * Supabase has to be followed by a re-read. Without this the row keeps
         * rendering its old status until the next focus refetch. */
        if (result.ok && isSupabaseConfigured) await refreshUsers()

        return result
      },

      setUserAdminRole: (userId, adminRole) =>
        setUserAdminRole(actor, userId, adminRole),

      customerProfile: (userId) => getCustomerProfile(actor, userId),

      createPasswordResetLink: async (userId) => {
        /* Supabase owns the credentials, so a locally-minted reset token is
         * meaningless there. The reset has to be a real Supabase recovery
         * link, which only the service_role can produce - hence the Edge
         * Function, and hence the authoritative permission check living in it
         * rather than in the service layer's `guard`. */
        if (isSupabaseConfigured) {
          const remote = await createAdminPasswordResetLink(userId)

          return remote.ok
            ? ok({
                link: remote.data.link,
                expires_at: remote.data.expires_at,
              })
            : remote
        }

        const local = await createPasswordResetForUser(actor, userId)

        if (!local.ok) return local

        /* The local driver's token is redeemed by this app's own
         * /setup-password page, so the URL is assembled here. Normalising
         * both backends to `{ link, expires_at }` spares the dialog from
         * having to know which one answered. */
        const email = users.find((u) => u.user_id === userId)?.email ?? ""

        return ok({
          link: `${window.location.origin}/setup-password?token=${local.data.token}&email=${encodeURIComponent(email)}`,
          expires_at: local.data.expires_at,
        })
      },

      /* Entitlement writes are async when they land in Supabase. The
       * service layer decides per target - a uuid id is a hosted row, a
       * legacy local id stays local - so the dialog does not have to know
       * which backend owns the row. After a hosted write the cache is
       * refreshed so the list reflects what the server stored. */
      grantAccess: async (userId, productId, sourceOrderId) => {
        const result = await grantAccess(actor, userId, productId, sourceOrderId)

        if (result.ok) {
          upsertRemoteEntitlement(result.data)
          if (isSupabaseConfigured) void refreshEntitlements()
        }

        return result
      },

      setAccessStatus: async (userProductId, status, actionLabel) => {
        const result = await setAccessStatus(
          actor,
          userProductId,
          status,
          actionLabel,
        )

        if (result.ok && isSupabaseConfigured) void refreshEntitlements()
        /* A NOT_FOUND means the row the list is showing no longer exists
         * server-side - purge the ghost so the admin sees real rows. */
        else if (!result.ok && isSupabaseConfigured && result.code === "NOT_FOUND")
          void refreshEntitlements()

        return result
      },

      removeAccess: async (userProductId) => {
        const result = await removeAccess(actor, userProductId)

        if (result.ok) {
          setRemoteEntitlements((prev) =>
            prev.filter((up) => up.user_product_id !== userProductId),
          )
          if (isSupabaseConfigured) void refreshEntitlements()
        } else if (isSupabaseConfigured && result.code === "NOT_FOUND") {
          /* Already gone server-side (double click, stale row): purge the
           * ghost locally so the list stops offering a dead action. */
          setRemoteEntitlements((prev) =>
            prev.filter((up) => up.user_product_id !== userProductId),
          )
          void refreshEntitlements()
        }

        return result
      },

      markOrderPaid: async (orderId, input) => {
        if (!isSupabaseConfigured)
          return markOrderPaidLocal(actor, orderId, input)

        const result = await markOrderPaidRemote(orderId, input)
        if (result.ok) await refreshAfterHostedWrite()
        return result
      },

      markOrderFailed: async (orderId, reason) => {
        if (!isSupabaseConfigured)
          return markOrderFailedLocal(actor, orderId, reason)

        const result = await markOrderFailedRemote(orderId, reason)
        if (result.ok) await refreshAfterHostedWrite()
        return result
      },

      cancelOrder: async (orderId, reason) => {
        if (!isSupabaseConfigured)
          return cancelOrderLocal(actor, orderId, reason)

        const result = await cancelOrderRemote(orderId, reason)
        if (result.ok) await refreshAfterHostedWrite()
        return result
      },

      issueInvoice: async (orderId) => {
        if (!isSupabaseConfigured)
          return issueInvoiceLocal(actor, orderId)

        const result = await issueInvoiceRemote(orderId)
        if (result.ok) await refreshAfterHostedWrite()
        return result
      },

      refundableAmount: (order) => {
        if (!isSupabaseConfigured) return refundableAmountLocal(order)

        const confirmed = refunds
          .filter(
            (refund) =>
              refund.order_id === order.order_id &&
              (refund.status === "REFUNDED" ||
                refund.status === "PROCESSING"),
          )
          .reduce((sum, refund) => sum + refund.amount, 0)

        return Math.max(
          0,
          Math.round((order.total_amount - confirmed) * 100) / 100,
        )
      },

      requestRefund: async (orderId, amount, reason) => {
        if (!isSupabaseConfigured)
          return requestRefundLocal(actor, orderId, amount, reason)

        const result = await requestRefundRemote(orderId, amount, reason)
        if (result.ok) await refreshAfterHostedWrite()
        return result
      },

      reviewRefund: async (refundId, decision, note) => {
        if (!isSupabaseConfigured)
          return reviewRefundLocal(actor, refundId, decision, note)

        const result = await reviewRefundRemote(refundId, decision, note)
        if (result.ok) await refreshAfterHostedWrite()
        return result
      },

      executeRefund: async (refundId) => {
        if (!isSupabaseConfigured)
          return executeRefundLocal(actor, refundId)

        const result = await executeRefundRemote(refundId)
        if (result.ok) await refreshAfterHostedWrite()
        return result
      },

      confirmRefund: async (refundId, providerRefundId) => {
        if (!isSupabaseConfigured)
          return confirmRefundLocal(actor, refundId, providerRefundId)

        const result = await confirmRefundRemote(refundId, providerRefundId)
        if (result.ok) await refreshAfterHostedWrite()
        return result
      },

      failRefund: async (refundId, note) => {
        if (!isSupabaseConfigured)
          return failRefundLocal(actor, refundId, note)

        const result = await failRefundRemote(refundId, note)
        if (result.ok) await refreshAfterHostedWrite()
        return result
      },

      cancelSubscription: (subscriptionId) =>
        cancelSubscription(actor, subscriptionId),

      resendEmail: (emailLogId) => resendEmail(actor, emailLogId),

      updateInquiry: (inquiryId, patch) =>
        updateInquiry(actor, inquiryId, patch),

      linkInquiryToOrder: (inquiryId, orderId) =>
        linkInquiryToOrder(actor, inquiryId, orderId),

      addInquiryNote: (inquiryId, content, internal) =>
        addInquiryNote(actor, inquiryId, content, internal),

      deleteInquiry: (inquiryId) => deleteInquiry(actor, inquiryId),

      updateSettings: (patch) => updateSettings(actor, patch),
    }
  }, [
    db,
    actor,
    user,
    users,
    userProducts,
    usersLoading,
    usersError,
    entitlementsError,
    refreshUsers,
    refreshEntitlements,
    upsertRemoteEntitlement,
    orders,
    ordersLoading,
    ordersError,
    refreshOrders,
    payments,
    invoices,
    refunds,
    financeLoading,
    financeError,
    refreshFinance,
    auditLog,
    auditLoading,
    auditError,
    refreshAudit,
  ])

  return <AdminContext.Provider value={value}>{children}</AdminContext.Provider>
}

export function useAdmin() {
  const ctx = useContext(AdminContext)

  if (!ctx) throw new Error("useAdmin must be used inside AdminProvider")

  return ctx
}

/** Convenience wrapper so audit entries keep the same call shape as before. */

export type AuditEntryInput = Omit<AuditLogEntry, "audit_id" | "actor_id" | "actor_name" | "actor_role" | "created_at">

/** Reads the audit trail through the guarded service call. */

export function readAuditLog(actor: Actor | null): AuditLogEntry[] {
  const result = listAudit(actor)

  return result.ok ? result.data : []
}
