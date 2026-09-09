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

import { createContext, useContext, useMemo, type ReactNode } from "react"

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

import { toPublicUser } from "../lib/auth"

import { useApp } from "./AppContext"

interface AdminContextValue {
  actor: Actor | null

  adminRole: AdminRole | undefined

  /* Collections, live from the store */

  users: User[]

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
  ) => Result<User>

  setUserAdminRole: (userId: string, adminRole: AdminRole) => Result<User>

  customerProfile: (userId: string) => Result<CustomerProfile>

  createPasswordResetLink: (
    userId: string,
  ) => Promise<Result<{ token: string, expires_at: string }>>

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

  const value = useMemo<AdminContextValue>(() => {
    const alerts = computeAlerts(db)

    const dismissed = db.dismissed_alerts

    return {
      actor,

      adminRole: user?.admin_role,

      users: db.users.map(toPublicUser),

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

      setUserStatus: (userId, status) => setUserStatus(actor, userId, status),

      setUserAdminRole: (userId, adminRole) =>
        setUserAdminRole(actor, userId, adminRole),

      customerProfile: (userId) => getCustomerProfile(actor, userId),

      createPasswordResetLink: (userId) =>
        createPasswordResetForUser(actor, userId),

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
  }, [db, actor, user])

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
