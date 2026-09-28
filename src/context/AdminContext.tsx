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
 * admin's role may not do — the checks in the pages only decide what
 * to render, never what is allowed.
 * ───────────────────────────────────────────────────────────── */

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react"

import type {
  AdminRole,
  AdminSubscription,
  AuditCategory,
  AuditLogEntry,
  CrmLead,
  CrmNote,
  CrmTask,
  EmailLog,
  Inquiry,
  InquiryNote,
  Invoice,
  LeadStage,
  NoteCategory,
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

import { useStore } from "../lib/store"

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
  addLeadNote,
  createPasswordResetForUser,
  deleteLead,
  deleteTask,
  dismissAlert,
  listAudit,
  ok,
  reinstateAlert,
  resendEmail,
  saveLead,
  saveTask,
  setLeadStage,
  toggleTask,
  updateSettings,
  writeAudit,
  type Actor,
  type AuditInput,
  type Result,
} from "../lib/api"

import {
  cancelSubscription,
  confirmRefund,
  executeRefund,
  failRefund,
  issueInvoice,
  markOrderFailed,
  markOrderPaid,
  refundableAmount,
  requestRefund,
  reviewRefund,
  cancelOrder,
  type ConfirmPaymentInput,
} from "../lib/api-orders"

import {
  addInquiryNote,
  extendAccess,
  grantAccess,
  getCustomerProfile,
  linkInquiryToOrder,
  removeAccess,
  setAccessStatus,
  setUserAdminRole,
  setUserStatus,
  updateInquiry,
  updateUser,
  type CustomerProfile,
} from "../lib/api-support"

import { isSupabaseConfigured } from "../lib/supabase"

import { fetchAllProfiles, mergeUserSources } from "../lib/supabase-auth"

import { createAdminPasswordResetLink } from "../lib/supabase-admin"

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

  orders: Order[]

  payments: Payment[]

  invoices: Invoice[]

  refunds: Refund[]

  subscriptions: AdminSubscription[]

  userProducts: UserProduct[]

  readingProgress: ReadingProgress[]

  emailLogs: EmailLog[]

  auditLog: AuditLogEntry[]

  inquiries: Inquiry[]

  inquiryNotes: InquiryNote[]

  leads: CrmLead[]

  tasks: CrmTask[]

  crmNotes: CrmNote[]

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
  ) => Result<UserProduct>

  setAccessStatus: (
    userProductId: string,
    status: UserProduct["access_status"],
    actionLabel?: string,
  ) => Result

  extendAccess: (userProductId: string, expiresAt: string) => Result

  removeAccess: (userProductId: string) => Result

  /* Orders & payments */

  markOrderPaid: (orderId: string, input?: ConfirmPaymentInput) => Result<Order>

  markOrderFailed: (orderId: string, reason: string) => Result<Order>

  cancelOrder: (orderId: string, reason?: string) => Result<Order>

  issueInvoice: (orderId: string) => Result<Invoice>

  /* Refunds — recording a request never moves money */

  refundableAmount: (order: Order) => number

  requestRefund: (
    orderId: string,
    amount: number,
    reason: string,
  ) => Result<Refund>

  reviewRefund: (
    refundId: string,
    decision: "APPROVED" | "REJECTED",
    note?: string,
  ) => Result<Refund>

  executeRefund: (refundId: string) => Result<Refund>

  confirmRefund: (refundId: string, providerRefundId: string) => Result<Refund>

  failRefund: (refundId: string, note: string) => Result<Refund>

  /* Subscriptions & email */

  cancelSubscription: (subscriptionId: string) => Result

  resendEmail: (emailLogId: string) => Result<EmailLog>

  /* Support inquiries */

  updateInquiry: (
    inquiryId: string,

    patch: Partial<Pick<Inquiry, "status" | "assigned_to" | "related_order_id" | "topic" | "subject">>,
  ) => Result<Inquiry>

  linkInquiryToOrder: (
    inquiryId: string,
    orderId: string | null,
  ) => Result<Inquiry>

  addInquiryNote: (
    inquiryId: string,
    content: string,
    internal?: boolean,
  ) => Result<InquiryNote>

  /* CRM */

  saveLead: (
    data: Omit<CrmLead, "lead_id" | "created_at" | "notes_count"> & {
      lead_id?: string
    },

    id?: string,
  ) => Result<CrmLead>

  setLeadStage: (leadId: string, stage: LeadStage) => Result

  addLeadNote: (
    leadId: string,
    content: string,
    category?: NoteCategory,
  ) => Result<CrmNote>

  deleteLead: (leadId: string) => Result

  saveTask: (
    data: Omit<CrmTask, "task_id"> & { task_id?: string },
    id?: string,
  ) => Result<CrmTask>

  toggleTask: (taskId: string) => Result

  deleteTask: (taskId: string) => Result

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
   * created, so an account registered through Supabase Auth — by any other
   * visitor, on any other device — was invisible in the admin dashboard
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

  const refreshUsers = useMemo(
    () => async () => {
      setUsersLoading(true)
      try {
        setRemoteUsers(await fetchAllProfiles())
      } finally {
        setUsersLoading(false)
      }
    },
    [],
  )

  /* Fetch once an admin session exists, and again whenever the signed-in
   * user changes — the read is RLS-gated on that identity, so running it
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
    () => mergeUserSources(db.users, remoteUsers),
    [db.users, remoteUsers],
  )

  const value = useMemo<AdminContextValue>(() => {
    const alerts = computeAlerts(db)

    const dismissed = db.dismissed_alerts

    return {
      actor,

      adminRole: user?.admin_role,

      users,

      usersLoading,

      refreshUsers,

      orders: db.orders,

      payments: db.payments,

      invoices: db.invoices,

      refunds: db.refunds,

      subscriptions: db.subscriptions,

      userProducts: db.user_products,

      readingProgress: db.reading_progress,

      emailLogs: db.email_logs,

      auditLog: db.audit_log,

      inquiries: db.inquiries,

      inquiryNotes: db.inquiry_notes,

      leads: db.crm_leads,

      tasks: db.crm_tasks,

      crmNotes: db.crm_notes,

      dismissedAlerts: dismissed,

      alerts,

      openAlerts: alerts.filter((a) => !dismissed.includes(a.alert_id)),

      dismissAlert: (alertId) => dismissAlert(actor, alertId),

      reinstateAlert: (alertId) => reinstateAlert(actor, alertId),

      revenueFor: (preset, custom) =>
        computeRevenue(
          db.orders,
          db.refunds,
          db.products,
          presetRange(preset, custom),
        ),

      rangeFor: (preset, custom) => presetRange(preset, custom),

      lifetime: lifetimeTotals(db.orders, db.refunds),

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
         * link, which only the service_role can produce — hence the Edge
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

      grantAccess: (userId, productId, sourceOrderId) =>
        grantAccess(actor, userId, productId, sourceOrderId),

      setAccessStatus: (userProductId, status, actionLabel) =>
        setAccessStatus(actor, userProductId, status, actionLabel),

      extendAccess: (userProductId, expiresAt) =>
        extendAccess(actor, userProductId, expiresAt),

      removeAccess: (userProductId) => removeAccess(actor, userProductId),

      markOrderPaid: (orderId, input) => markOrderPaid(actor, orderId, input),

      markOrderFailed: (orderId, reason) =>
        markOrderFailed(actor, orderId, reason),

      cancelOrder: (orderId, reason) => cancelOrder(actor, orderId, reason),

      issueInvoice: (orderId) => issueInvoice(actor, orderId),

      refundableAmount,

      requestRefund: (orderId, amount, reason) =>
        requestRefund(actor, orderId, amount, reason),

      reviewRefund: (refundId, decision, note) =>
        reviewRefund(actor, refundId, decision, note),

      executeRefund: (refundId) => executeRefund(actor, refundId),

      confirmRefund: (refundId, providerRefundId) =>
        confirmRefund(actor, refundId, providerRefundId),

      failRefund: (refundId, note) => failRefund(actor, refundId, note),

      cancelSubscription: (subscriptionId) =>
        cancelSubscription(actor, subscriptionId),

      resendEmail: (emailLogId) => resendEmail(actor, emailLogId),

      updateInquiry: (inquiryId, patch) =>
        updateInquiry(actor, inquiryId, patch),

      linkInquiryToOrder: (inquiryId, orderId) =>
        linkInquiryToOrder(actor, inquiryId, orderId),

      addInquiryNote: (inquiryId, content, internal) =>
        addInquiryNote(actor, inquiryId, content, internal),

      saveLead: (data, id) => saveLead(actor, data, id),

      setLeadStage: (leadId, stage) => setLeadStage(actor, leadId, stage),

      addLeadNote: (leadId, content, category) =>
        addLeadNote(actor, leadId, content, category),

      deleteLead: (leadId) => deleteLead(actor, leadId),

      saveTask: (data, id) => saveTask(actor, data, id),

      toggleTask: (taskId) => toggleTask(actor, taskId),

      deleteTask: (taskId) => deleteTask(actor, taskId),

      updateSettings: (patch) => updateSettings(actor, patch),
    }
  }, [db, actor, user, users, usersLoading, refreshUsers])

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
