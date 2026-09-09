/* ─────────────────────────────────────────────────────────────
 * Service layer (the "API").
 *
 * Every read and write in the application goes through this module or
 * one of its siblings (`api-orders.ts`, `api-support.ts`). Each
 * mutating operation receives the calling principal and refuses the
 * call unless that principal holds the matching permission — so
 * authorization is enforced by the service, not by whether a button
 * happened to be rendered.
 *
 * Transport boundary: operations read/write through `src/lib/db.ts`.
 * Pointing that driver at HTTP endpoints turns this module into a
 * client for a real backend without changing a single call site.
 * ───────────────────────────────────────────────────────────── */

import type {
  AdminRole,
  AuditCategory,
  Category,
  CmsBackup,
  CmsSection,
  Coupon,
  CrmLead,
  CrmNote,
  CrmTask,
  EmailLog,
  FaqItem,
  LeadStage,
  NoteCategory,
  PlatformSettings,
  Product,
  ProductStatus,
  Role,
  StoredUser,
  Testimonial,
  User,
} from "../types"

import { snapshotProduct } from "../types"

import { getDb, mutate, nextSequence, nowIso, uid, uniqueSlug } from "./db"

import { can, ROLE_LABEL, type AdminPermission } from "./permissions"

import {
  hasHebrewChars,
  hasPassword,
  hashPassword,
  isEmail,
  normalizeEmail,
  passwordProblem,
  randomSalt,
  toPublicUser,
  verifyPassword,
} from "./auth"

/* ── Result plumbing ──────────────────────────────────── */

export type ErrorCode = "UNAUTHENTICATED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION" | "CONFLICT" | "PROVIDER_NOT_CONFIGURED" | "STORAGE"

export type Result<T = undefined> = { ok: true, data: T } | Failure

/** The failure branch on its own, so guards can return it for any `Result<T>`. */

export interface Failure {
  ok: false

  error: string

  code: ErrorCode
}

export function ok<T>(data: T): Result<T> {
  return { ok: true, data }
}

export function fail(code: ErrorCode, error: string): Failure {
  return { ok: false, code, error }
}

/* ── Principal ────────────────────────────────────────── */

export interface Actor {
  user_id: string

  name: string

  role: Role

  admin_role?: AdminRole
}

export function actorFromUser(user: User | null): Actor | null {
  if (!user) return null

  return {
    user_id: user.user_id,

    name: `${user.first_name} ${user.last_name}`.trim(),

    role: user.role,

    admin_role: user.admin_role,
  }
}

/**
 * Unauthenticated principal. Allowed only for the operations that are
 * public by design (browsing the catalog, checkout, submitting an
 * inquiry, password reset).
 */

export const ANONYMOUS: Actor | null = null

/** Shared by the sibling service modules so every write enforces the same policy. */

export function guard(
  actor: Actor | null,
  permission: AdminPermission,
): Failure | null {
  if (!actor)
    return fail("UNAUTHENTICATED", "יש להתחבר לחשבון מנהל כדי לבצע פעולה זו.")

  if (actor.role !== "ADMIN")
    return fail("FORBIDDEN", "הפעולה זמינה למנהלים בלבד.")

  if (!can(actor.admin_role, permission)) {
    const label = actor.admin_role ? ROLE_LABEL[actor.admin_role] : "לא מוגדר"

    return fail("FORBIDDEN", `לתפקיד "${label}" אין הרשאה לבצע פעולה זו.`)
  }

  return null
}

/* ── Audit ────────────────────────────────────────────── */

export interface AuditInput {
  category: AuditCategory

  action: string

  target_type: string

  target_id: string

  target_label: string

  details: string
}

/**
 * Writes an audit entry. Called from inside already-authorized service
 * functions, so it performs no permission check of its own.
 */

export function writeAudit(actor: Actor | null, entry: AuditInput): void {
  mutate((db) => {
    db.audit_log = [
      {
        audit_id: uid("aud"),

        actor_id: actor?.user_id ?? "system",

        actor_name: actor?.name ?? "מערכת",

        actor_role: actor?.admin_role ?? actor?.role ?? "SYSTEM",

        category: entry.category,

        action: entry.action,

        target_type: entry.target_type,

        target_id: entry.target_id,

        target_label: entry.target_label,

        details: entry.details,

        created_at: nowIso(),
      },

      ...db.audit_log,
    ]
  })
}

export function listAudit(actor: Actor | null) {
  const denied = guard(actor, "audit")

  if (denied) return denied

  return ok(getDb().audit_log)
}

/* ── Transactional email ──────────────────────────────── */

export interface EmailInput {
  recipient: string

  recipient_name?: string

  template: string

  subject: string

  related_type?: EmailLog["related_type"]

  related_id?: string
}

/**
 * Records an outgoing message. Without a configured provider the
 * message is queued, never marked as sent — the admin panel must not
 * claim a delivery that did not happen.
 */

export function dispatchEmail(input: EmailInput): EmailLog {
  const provider = getDb().settings.email_provider

  return mutate((db) => {
    const log: EmailLog = {
      email_log_id: uid("eml"),

      recipient: input.recipient,

      recipient_name: input.recipient_name,

      template: input.template,

      subject: input.subject,

      status: "QUEUED",

      sent_at: nowIso(),

      related_type: input.related_type,

      related_id: input.related_id,

      failure_reason: provider
        ? undefined
        : "לא הוגדר ספק שליחת מיילים — ההודעה ממתינה בתור.",
    }

    db.email_logs = [log, ...db.email_logs]

    return log
  })
}

export function listEmailLogs(actor: Actor | null) {
  const denied = guard(actor, "emails")

  if (denied) return denied

  return ok(getDb().email_logs)
}

export function resendEmail(
  actor: Actor | null,
  emailLogId: string,
): Result<EmailLog> {
  const denied = guard(actor, "resend_email")

  if (denied) return denied

  const db = getDb()

  const existing = db.email_logs.find((e) => e.email_log_id === emailLogId)

  if (!existing) return fail("NOT_FOUND", "המייל לא נמצא.")

  const provider = db.settings.email_provider

  const updated = mutate((d) => {
    const next: EmailLog = {
      ...existing,

      status: "QUEUED",

      sent_at: nowIso(),

      failure_reason: provider
        ? undefined
        : "לא הוגדר ספק שליחת מיילים — ההודעה ממתינה בתור.",
    }

    d.email_logs = d.email_logs.map((e) =>
      e.email_log_id === emailLogId ? next : e,
    )

    return next
  })

  writeAudit(actor, {
    category: "EMAIL_RESEND",

    action: "שליחת מייל מחדש",

    target_type: "EMAIL",

    target_id: emailLogId,

    target_label: existing.recipient,

    details: existing.subject,
  })

  return ok(updated)
}

/* ── Platform settings ────────────────────────────────── */

export function getSettings(): PlatformSettings {
  return getDb().settings
}

export function updateSettings(
  actor: Actor | null,
  patch: Partial<PlatformSettings>,
): Result<PlatformSettings> {
  const denied = guard(actor, "settings")

  if (denied) return denied

  const next = mutate((db) => {
    db.settings = {
      ...db.settings,
      ...patch,
      updated_at: nowIso(),
      updated_by: actor?.name,
    }

    return db.settings
  })

  const changed = Object.keys(patch).filter(
    (k) => k !== "updated_at" && k !== "updated_by",
  )

  writeAudit(actor, {
    category: "SETTINGS",

    action: "עדכון הגדרות פלטפורמה",

    target_type: "SETTINGS",

    target_id: "platform",

    target_label: "הגדרות",

    details: changed.join(", ") || "—",
  })

  return ok(next)
}

/* ── Authentication ───────────────────────────────────── */

/** True until the first administrator account exists. */

export function isBootstrapRequired(): boolean {
  return !getDb().users.some((u) => u.role === "ADMIN")
}

export interface BootstrapInput {
  first_name: string

  last_name: string

  email: string

  password: string
}

/** One-time creation of the first SUPER_ADMIN. Refused once one exists. */

export async function bootstrapAdmin(
  input: BootstrapInput,
): Promise<Result<User>> {
  if (!isBootstrapRequired())
    return fail("FORBIDDEN", "כבר קיים חשבון מנהל — ההתקנה הראשונית הושלמה.")

  if (hasHebrewChars(input.email))
    return fail("VALIDATION", "כתובת אימייל אינה יכולה להכיל אותיות בעברית.")

  const email = normalizeEmail(input.email)

  if (!isEmail(email)) return fail("VALIDATION", "כתובת המייל אינה תקינה.")

  if (!input.first_name.trim() || !input.last_name.trim())
    return fail("VALIDATION", "יש למלא שם מלא.")

  const problem = passwordProblem(input.password)

  if (problem) return fail("VALIDATION", problem)

  const salt = randomSalt()

  const password_hash = await hashPassword(input.password, salt)

  const user = mutate((db) => {
    const created: StoredUser = {
      user_id: uid("usr"),

      first_name: input.first_name.trim(),

      last_name: input.last_name.trim(),

      email,

      role: "ADMIN",

      admin_role: "SUPER_ADMIN",

      account_status: "ACTIVE",

      must_change_password: false,

      password_hash,

      password_salt: salt,

      password_set: true,

      created_at: nowIso(),

      updated_at: nowIso(),
    }

    db.users = [...db.users, created]

    return created
  })

  const actor = actorFromUser(toPublicUser(user))

  writeAudit(actor, {
    category: "AUTH",

    action: "הקמת חשבון מנהל ראשון",

    target_type: "USER",

    target_id: user.user_id,

    target_label: user.email,

    details: "SUPER_ADMIN",
  })

  return ok(toPublicUser(user))
}

export async function login(
  email: string,
  password: string,
): Promise<Result<User>> {
  if (hasHebrewChars(email))
    return fail("VALIDATION", "כתובת אימייל אינה יכולה להכיל אותיות בעברית.")

  const normalized = normalizeEmail(email)

  const found = getDb().users.find((u) => u.email === normalized)

  if (!found) return fail("VALIDATION", "אימייל או סיסמה שגויים.")

  if (found.account_status !== "ACTIVE") {
    return fail("FORBIDDEN", "חשבון זה אינו פעיל. אנא פנה לתמיכה.")
  }

  if (!hasPassword(found)) {
    return fail(
      "FORBIDDEN",
      'לחשבון זה טרם הוגדרה סיסמה. השתמש בקישור "שכחת סיסמה?" כדי להגדיר אחת.',
    )
  }

  const valid = await verifyPassword(
    password,
    found.password_salt,
    found.password_hash,
  )

  if (!valid) return fail("VALIDATION", "אימייל או סיסמה שגויים.")

  const updated = mutate((db) => {
    db.users = db.users.map((u) =>
      u.user_id === found.user_id ? { ...u, last_login_at: nowIso() } : u,
    )

    return db.users.find((u) => u.user_id === found.user_id) as StoredUser
  })

  return ok(toPublicUser(updated))
}

export interface RegisterInput {
  first_name: string

  last_name: string

  email: string

  phone?: string

  password?: string
}

/** Public customer registration (also used by checkout). */

export async function registerCustomer(
  input: RegisterInput,
): Promise<Result<User>> {
  if (hasHebrewChars(input.email))
    return fail("VALIDATION", "כתובת אימייל אינה יכולה להכיל אותיות בעברית.")

  const email = normalizeEmail(input.email)

  if (!isEmail(email)) return fail("VALIDATION", "כתובת המייל אינה תקינה.")

  if (getDb().users.some((u) => u.email === email))
    return fail("CONFLICT", "כבר קיים חשבון עבור כתובת מייל זו.")

  let salt: string | undefined

  let password_hash: string | undefined

  if (input.password) {
    const problem = passwordProblem(input.password)

    if (problem) return fail("VALIDATION", problem)

    salt = randomSalt()

    password_hash = await hashPassword(input.password, salt)
  }

  const created = mutate((db) => {
    const user: StoredUser = {
      user_id: uid("usr"),

      first_name: input.first_name.trim(),

      last_name: input.last_name.trim(),

      email,

      phone: input.phone,

      role: "CUSTOMER",

      account_status: "ACTIVE",

      must_change_password: !password_hash,

      password_hash,

      password_salt: salt,

      password_set: Boolean(password_hash),

      created_at: nowIso(),

      updated_at: nowIso(),
    }

    db.users = [...db.users, user]

    return user
  })

  return ok(toPublicUser(created))
}

/** Finds a customer by email, creating one when absent (checkout path). */

export async function findOrCreateCustomer(
  input: RegisterInput,
): Promise<Result<StoredUser>> {
  const email = normalizeEmail(input.email)

  const existing = getDb().users.find((u) => u.email === email)

  if (existing) return ok(existing)

  const created = await registerCustomer(input)

  if (!created.ok) return created

  const stored = getDb().users.find((u) => u.user_id === created.data.user_id)

  if (!stored) return fail("NOT_FOUND", "יצירת החשבון נכשלה.")

  return ok(stored)
}

export async function setPasswordForActor(
  actor: Actor | null,
  password: string,
): Promise<Result<User>> {
  if (!actor) return fail("UNAUTHENTICATED", "יש להתחבר תחילה.")

  const problem = passwordProblem(password)

  if (problem) return fail("VALIDATION", problem)

  const salt = randomSalt()

  const password_hash = await hashPassword(password, salt)

  const updated = mutate((db) => {
    db.users = db.users.map((u) =>
      u.user_id === actor.user_id
        ? {
            ...u,
            password_hash,
            password_salt: salt,
            password_set: true,
            must_change_password: false,
            updated_at: nowIso(),
          }
        : u,
    )

    return db.users.find(
      (u) => u.user_id === actor.user_id,
    ) as StoredUser | undefined
  })

  if (!updated) return fail("NOT_FOUND", "החשבון לא נמצא.")

  return ok(toPublicUser(updated))
}

/** Always succeeds publicly; never reveals whether the address exists. */

export async function requestPasswordReset(
  email: string,
): Promise<Result<{ requested: boolean }>> {
  const normalized = normalizeEmail(email)

  const user = getDb().users.find((u) => u.email === normalized)

  if (!user) return ok({ requested: false })

  const token = randomSalt() + randomSalt()

  const token_hash = await hashPassword(token, "reset")

  const expires = new Date(Date.now() + 60 * 60 * 1000).toISOString()

  mutate((db) => {
    db.password_resets = [
      ...db.password_resets.filter(
        (r) => r.user_id !== user.user_id || r.used_at,
      ),

      {
        token_id: uid("rst"),
        user_id: user.user_id,
        token_hash,
        created_at: nowIso(),
        expires_at: expires,
      },
    ]
  })

  dispatchEmail({
    recipient: user.email,

    recipient_name: `${user.first_name} ${user.last_name}`,

    template: "PASSWORD_RESET",

    subject: "קישור לאיפוס סיסמה",

    related_type: "USER",

    related_id: user.user_id,
  })

  return ok({ requested: true })
}

export async function resetPasswordWithToken(
  token: string,
  password: string,
): Promise<Result<User>> {
  const token_hash = await hashPassword(token, "reset")

  const record = getDb().password_resets.find(
    (r) =>
      r.token_hash === token_hash &&
      !r.used_at &&
      new Date(r.expires_at).getTime() > Date.now(),
  )

  if (!record) return fail("NOT_FOUND", "הקישור אינו תקף או שפג תוקפו.")

  const problem = passwordProblem(password)

  if (problem) return fail("VALIDATION", problem)

  const salt = randomSalt()

  const password_hash = await hashPassword(password, salt)

  const updated = mutate((db) => {
    db.password_resets = db.password_resets.map((r) =>
      r.token_id === record.token_id ? { ...r, used_at: nowIso() } : r,
    )

    db.users = db.users.map((u) =>
      u.user_id === record.user_id
        ? {
            ...u,
            password_hash,
            password_salt: salt,
            password_set: true,
            must_change_password: false,
            updated_at: nowIso(),
          }
        : u,
    )

    return db.users.find(
      (u) => u.user_id === record.user_id,
    ) as StoredUser | undefined
  })

  if (!updated) return fail("NOT_FOUND", "החשבון לא נמצא.")

  return ok(toPublicUser(updated))
}

/**
 * Admin-issued reset link. Only the digest of the token is stored, so the
 * raw value is returned exactly once and cannot be read back later — it is
 * the fallback path for resetting a customer's password while no email
 * provider is connected.
 */

export async function createPasswordResetForUser(
  actor: Actor | null,

  userId: string,
): Promise<Result<{ token: string, expires_at: string }>> {
  const denied = guard(actor, "users")

  if (denied) return denied

  const user = getDb().users.find((u) => u.user_id === userId)

  if (!user) return fail("NOT_FOUND", "המשתמש לא נמצא.")

  const token = randomSalt() + randomSalt()

  const token_hash = await hashPassword(token, "reset")

  const expires_at = new Date(Date.now() + 60 * 60 * 1000).toISOString()

  mutate((db) => {
    db.password_resets = [
      ...db.password_resets.filter((r) => r.user_id !== userId || r.used_at),

      {
        token_id: uid("rst"),
        user_id: userId,
        token_hash,
        created_at: nowIso(),
        expires_at,
      },
    ]
  })

  writeAudit(actor, {
    category: "AUTH",

    action: "הנפקת קישור איפוס סיסמה",

    target_type: "USER",

    target_id: userId,

    target_label: `${user.first_name} ${user.last_name}`,

    details: "הקישור תקף לשעה אחת",
  })

  return ok({ token, expires_at })
}

/* ── Categories ───────────────────────────────────────── */

export function listCategories(): Category[] {
  return [...getDb().categories].sort(
    (a, b) => a.display_order - b.display_order,
  )
}

export function saveCategory(
  actor: Actor | null,

  data: { name: string, slug?: string, description?: string },

  id?: string,
): Result<Category> {
  const denied = guard(actor, "products")

  if (denied) return denied

  const name = data.name.trim()

  if (!name) return fail("VALIDATION", "שם הקטגוריה חובה.")

  const db = getDb()

  const taken = db.categories
    .filter((c) => c.category_id !== id)
    .map((c) => c.slug)

  const slug = uniqueSlug(data.slug || name, taken, "category")

  if (db.categories.some((c) => c.slug === slug && c.category_id !== id)) {
    return fail("CONFLICT", "קטגוריה עם מזהה URL זה כבר קיימת.")
  }

  const saved = mutate((d) => {
    if (id) {
      const idx = d.categories.findIndex((c) => c.category_id === id)

      if (idx < 0) return null

      const next = {
        ...d.categories[idx],
        name,
        slug,
        description: data.description,
      }

      d.categories = d.categories.map((c) => (c.category_id === id ? next : c))

      return next
    }

    const nextOrder =
      d.categories.reduce((max, c) => Math.max(max, c.display_order), 0) + 1

    const created: Category = {
      category_id: uid("cat"),

      name,

      slug,

      description: data.description,

      display_order: nextOrder,

      created_at: nowIso(),
    }

    d.categories = [...d.categories, created]

    return created
  })

  if (!saved) return fail("NOT_FOUND", "הקטגוריה לא נמצאה.")

  return ok(saved)
}

export function deleteCategory(
  actor: Actor | null,
  categoryId: string,
): Result {
  const denied = guard(actor, "products")

  if (denied) return denied

  const category = getDb().categories.find((c) => c.category_id === categoryId)

  if (!category) return fail("NOT_FOUND", "הקטגוריה לא נמצאה.")

  mutate((db) => {
    db.categories = db.categories.filter((c) => c.category_id !== categoryId)

    db.products = db.products.map((p) =>
      p.category_ids?.includes(categoryId)
        ? {
            ...p,
            category_ids: p.category_ids.filter((c) => c !== categoryId),
            updated_at: nowIso(),
          }
        : p,
    )
  })

  writeAudit(actor, {
    category: "PRODUCT_UPDATE",

    action: "מחיקת קטגוריה",

    target_type: "CATEGORY",

    target_id: categoryId,

    target_label: category.name,

    details: "הקטגוריה הוסרה מכל המוצרים ששויכו אליה",
  })

  return ok(undefined)
}

/* ── Products ─────────────────────────────────────────── */

export type ProductDraft = Omit<Product, "product_id" | "created_at" | "updated_at" | "archived_at"> & {
  slug?: string
}

export function listProducts(): Product[] {
  return getDb().products
}

export function getProduct(productId: string): Product | undefined {
  return getDb().products.find((p) => p.product_id === productId)
}

export function getProductBySlug(slug: string): Product | undefined {
  return getDb().products.find((p) => p.slug === slug)
}

/**
 * Catalog view for the storefront: published, publicly visible, ordered.
 *
 * `content_url` is stripped here on purpose. This is the payload an
 * anonymous visitor receives, so anything in it is public by definition —
 * and the address of a protected PDF is the shortest possible route from
 * "browse the catalogue" to "download the book". Readers get the location
 * through issueContentGrant(), which checks the entitlement and the device
 * session first. v_storefront_catalog in schema.sql drops the same two
 * columns for the same reason.
 */

export function listPublicProducts(): Product[] {
  return getDb()

    .products.filter((p) => p.status === "ACTIVE" && p.visibility === "PUBLIC")

    .sort(
      (a, b) =>
        (a.position || 0) - (b.position || 0) ||
        b.created_at.localeCompare(a.created_at),
    )

    .map((p) => (p.content_url ? { ...p, content_url: undefined } : p))
}

export function listFeaturedProducts(): Product[] {
  return listPublicProducts().filter((p) => p.featured)
}

export function resolveProducts(ids: string[] | undefined): Product[] {
  if (!ids || ids.length === 0) return []

  const all = getDb().products

  return ids
    .map((id) => all.find((p) => p.product_id === id))
    .filter((p): p is Product => Boolean(p))
}

function validateProductDraft(data: Partial<Product>): string | null {
  if (data.name !== undefined && !data.name.trim()) return "שם המוצר חובה."

  if (data.price !== undefined && (Number.isNaN(data.price) || data.price < 0))
    return "המחיר חייב להיות מספר חיובי."

  if (
    data.sale_price !== undefined &&
    data.sale_price !== null &&
    data.price !== undefined &&
    data.sale_price >= data.price
  ) {
    return "מחיר המבצע חייב להיות נמוך מהמחיר הרגיל."
  }

  if (
    data.inventory !== undefined &&
    data.inventory !== null &&
    data.inventory < 0
  ) {
    return "מלאי לא יכול להיות שלילי."
  }

  return null
}

export function createProduct(
  actor: Actor | null,
  data: Partial<Product>,
): Result<Product> {
  const denied = guard(actor, "products")

  if (denied) return denied

  const problem = validateProductDraft(data)

  if (problem) return fail("VALIDATION", problem)

  if (!data.name?.trim()) return fail("VALIDATION", "שם המוצר חובה.")

  const db = getDb()

  const slug = uniqueSlug(
    data.slug || data.name,
    db.products.map((p) => p.slug),
    "product",
  )

  const maxPosition = db.products.reduce(
    (max, p) => Math.max(max, p.position || 0),
    0,
  )

  const settings = db.settings

  const created = mutate((d) => {
    const product: Product = {
      name: data.name!.trim(),

      description: "",

      short_description: "",

      product_type: "EBOOK",

      price: 0,

      currency: settings.default_currency,

      status: "DRAFT",

      visibility: "PUBLIC",

      availability: "AVAILABLE",

      inventory: null,

      featured: false,

      position: maxPosition + 1,

      ...data,

      // Honour a caller-supplied id so the product editor can upload a

      // content file to Supabase Storage (keyed by product_id) *before*

      // the first save. Falls back to a fresh id for every other caller.

      product_id: data.product_id?.trim() || uid("prd"),

      slug,

      created_at: nowIso(),

      updated_at: nowIso(),
    }

    d.products = [...d.products, product]

    return product
  })

  writeAudit(actor, {
    category: "PRODUCT_CREATE",

    action: "יצירת מוצר חדש",

    target_type: "PRODUCT",

    target_id: created.product_id,

    target_label: created.name,

    details: `${created.product_type} · ₪${created.price.toLocaleString()} · סטטוס ${created.status}`,
  })

  return ok(created)
}

export function updateProduct(
  actor: Actor | null,
  productId: string,
  patch: Partial<Product>,
): Result<Product> {
  const denied = guard(actor, "products")

  if (denied) return denied

  const db = getDb()

  const existing = db.products.find((p) => p.product_id === productId)

  if (!existing) return fail("NOT_FOUND", "המוצר לא נמצא.")

  const merged = { ...existing, ...patch } as Product

  const problem = validateProductDraft(merged)

  if (problem) return fail("VALIDATION", problem)

  const priceChanged =
    patch.price !== undefined || patch.sale_price !== undefined

  if (priceChanged) {
    const priceDenied = guard(actor, "edit_price")

    if (priceDenied) return priceDenied
  }

  const contentChanged =
    patch.content_url !== undefined ||
    patch.content_file !== undefined ||
    patch.image_url !== undefined

  if (contentChanged) {
    const contentDenied = guard(actor, "edit_content")

    if (contentDenied) return contentDenied
  }

  let slug = existing.slug

  if (patch.slug !== undefined && patch.slug !== existing.slug) {
    const taken = db.products
      .filter((p) => p.product_id !== productId)
      .map((p) => p.slug)

    slug = uniqueSlug(patch.slug || existing.name, taken, "product")
  }

  const updated = mutate((d) => {
    const next: Product = {
      ...existing,
      ...patch,
      slug,
      product_id: productId,
      updated_at: nowIso(),
    }

    d.products = d.products.map((p) => (p.product_id === productId ? next : p))

    // Access grants keep their own snapshot; refresh it so libraries stay readable.

    d.user_products = d.user_products.map((up) =>
      up.product_id === productId
        ? { ...up, product_snapshot: snapshotProduct(next) }
        : up,
    )

    return next
  })

  if (
    priceChanged &&
    (existing.price !== updated.price ||
      existing.sale_price !== updated.sale_price)
  ) {
    writeAudit(actor, {
      category: "PRICE_CHANGE",

      action: "שינוי מחיר",

      target_type: "PRODUCT",

      target_id: productId,

      target_label: updated.name,

      details:
        `₪${existing.price.toLocaleString()} → ₪${updated.price.toLocaleString()}` +
        (updated.sale_price !== undefined
          ? ` · מבצע ₪${updated.sale_price.toLocaleString()}`
          : ""),
    })
  } else if (contentChanged) {
    writeAudit(actor, {
      category: "CONTENT_SWAP",

      action: "עדכון קובץ תוכן / תמונה",

      target_type: "PRODUCT",

      target_id: productId,

      target_label: updated.name,

      details: updated.content_file?.file_name ?? updated.content_url ?? "—",
    })
  } else {
    writeAudit(actor, {
      category: "PRODUCT_UPDATE",

      action: "עדכון מוצר",

      target_type: "PRODUCT",

      target_id: productId,

      target_label: updated.name,

      details: Object.keys(patch).join(", "),
    })
  }

  return ok(updated)
}

export function setProductStatus(
  actor: Actor | null,
  productId: string,
  status: ProductStatus,
): Result<Product> {
  const denied = guard(actor, "products")

  if (denied) return denied

  const existing = getProduct(productId)

  if (!existing) return fail("NOT_FOUND", "המוצר לא נמצא.")

  const updated = mutate((db) => {
    const next: Product = {
      ...existing,

      status,

      archived_at: status === "ARCHIVED" ? nowIso() : undefined,

      updated_at: nowIso(),
    }

    db.products = db.products.map((p) =>
      p.product_id === productId ? next : p,
    )

    return next
  })

  writeAudit(actor, {
    category: "PRODUCT_UPDATE",

    action:
      status === "ARCHIVED"
        ? "העברה לארכיון"
        : status === "ACTIVE"
          ? "פרסום מוצר"
          : "שינוי סטטוס מוצר",

    target_type: "PRODUCT",

    target_id: productId,

    target_label: existing.name,

    details: `${existing.status} → ${status}`,
  })

  return ok(updated)
}

export function archiveProduct(
  actor: Actor | null,
  productId: string,
): Result<Product> {
  return setProductStatus(actor, productId, "ARCHIVED")
}

/** Reorders within the catalog grid. */

export function moveProduct(
  actor: Actor | null,
  productId: string,
  direction: -1 | 1,
): Result {
  const denied = guard(actor, "products")

  if (denied) return denied

  const sorted = [...getDb().products].sort(
    (a, b) => (a.position || 0) - (b.position || 0),
  )

  const idx = sorted.findIndex((p) => p.product_id === productId)

  const swap = idx + direction

  if (idx < 0 || swap < 0 || swap >= sorted.length) return ok(undefined)

  const a = sorted[idx].position || 0

  const b = sorted[swap].position || 0

  mutate((db) => {
    db.products = db.products.map((p) => {
      if (p.product_id === sorted[idx].product_id)
        return {
          ...p,
          position: b === a ? idx + direction : b,
          updated_at: nowIso(),
        }

      if (p.product_id === sorted[swap].product_id)
        return { ...p, position: a, updated_at: nowIso() }

      return p
    })
  })

  return ok(undefined)
}

/**
 * Hard deletion. Refused whenever the product is referenced by financial
 * or entitlement history — archiving is the correct action there, so
 * historical orders can never be corrupted.
 */

export function deleteProduct(actor: Actor | null, productId: string): Result {
  const denied = guard(actor, "delete_product")

  if (denied) return denied

  const db = getDb()

  const existing = db.products.find((p) => p.product_id === productId)

  if (!existing) return fail("NOT_FOUND", "המוצר לא נמצא.")

  const referencedByOrders = db.orders.some((o) =>
    o.items.some((i) => i.product_id === productId),
  )

  const referencedByGrants = db.user_products.some(
    (up) => up.product_id === productId,
  )

  if (referencedByOrders || referencedByGrants) {
    return fail(
      "CONFLICT",

      referencedByOrders
        ? "לא ניתן למחוק מוצר שמופיע בהזמנות קיימות — יש להעביר אותו לארכיון כדי לשמור על שלמות הנתונים ההיסטוריים."
        : "לא ניתן למחוק מוצר שקיימות עבורו הרשאות גישה של לקוחות — יש להעביר אותו לארכיון.",
    )
  }

  mutate((d) => {
    d.products = d.products.filter((p) => p.product_id !== productId)
  })

  writeAudit(actor, {
    category: "PRODUCT_DELETE",

    action: "מחיקת מוצר",

    target_type: "PRODUCT",

    target_id: productId,

    target_label: existing.name,

    details: "נמחק לצמיתות (ללא היסטוריית הזמנות או גישה)",
  })

  return ok(undefined)
}

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
      ).toLocaleString()}KB — יש להעלות קבצים גדולים לאחסון חיצוני ולהדביק את הכתובת שלהם.`,
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

/* ── CMS content ──────────────────────────────────────── */

export function listSections(): CmsSection[] {
  return [...getDb().sections].sort((a, b) => a.display_order - b.display_order)
}

export function saveSection(
  actor: Actor | null,

  data: Omit<CmsSection, "section_id" | "display_order" | "updated_at">,

  id?: string,
): Result<CmsSection> {
  const denied = guard(actor, "cms")

  if (denied) return denied

  if (!data.title.trim()) return fail("VALIDATION", "כותרת הסקטור חובה.")

  const saved = mutate((db) => {
    if (id) {
      const next = {
        ...db.sections.find((s) => s.section_id === id) as CmsSection,
        ...data,
        updated_at: nowIso(),
      }

      db.sections = db.sections.map((s) => (s.section_id === id ? next : s))

      return next
    }

    const nextOrder =
      db.sections.reduce((max, s) => Math.max(max, s.display_order), 0) + 1

    const created: CmsSection = {
      ...data,
      section_id: uid("sec"),
      display_order: nextOrder,
      updated_at: nowIso(),
    }

    db.sections = [...db.sections, created]

    return created
  })

  return ok(saved)
}

export function deleteSection(actor: Actor | null, id: string): Result {
  const denied = guard(actor, "cms")

  if (denied) return denied

  mutate((db) => {
    db.sections = db.sections.filter((s) => s.section_id !== id)
  })

  return ok(undefined)
}

export function toggleSection(actor: Actor | null, id: string): Result {
  const denied = guard(actor, "cms")

  if (denied) return denied

  mutate((db) => {
    db.sections = db.sections.map((s) =>
      s.section_id === id
        ? { ...s, active: !s.active, updated_at: nowIso() }
        : s,
    )
  })

  return ok(undefined)
}

export function moveSection(
  actor: Actor | null,
  id: string,
  direction: -1 | 1,
): Result {
  const denied = guard(actor, "cms")

  if (denied) return denied

  const sorted = listSections()

  const idx = sorted.findIndex((s) => s.section_id === id)

  const swap = idx + direction

  if (idx < 0 || swap < 0 || swap >= sorted.length) return ok(undefined)

  const aOrder = sorted[idx].display_order

  const bOrder = sorted[swap].display_order

  mutate((db) => {
    db.sections = db.sections.map((s) =>
      s.section_id === sorted[idx].section_id
        ? {
            ...s,
            display_order: bOrder === aOrder ? aOrder + direction : bOrder,
          }
        : s.section_id === sorted[swap].section_id
          ? { ...s, display_order: aOrder }
          : s,
    )
  })

  return ok(undefined)
}

export function listTestimonials(): Testimonial[] {
  return [...getDb().testimonials].sort(
    (a, b) => a.display_order - b.display_order,
  )
}

export function saveTestimonial(
  actor: Actor | null,

  data: Omit<Testimonial, "testimonial_id" | "display_order">,

  id?: string,
): Result<Testimonial> {
  const denied = guard(actor, "cms")

  if (denied) return denied

  if (!data.quote.trim() || !data.name.trim())
    return fail("VALIDATION", "ציטוט ושם הם שדות חובה.")

  const saved = mutate((db) => {
    if (id) {
      const next = {
        ...db.testimonials.find((t) => t.testimonial_id === id) as Testimonial,
        ...data,
      }

      db.testimonials = db.testimonials.map((t) =>
        t.testimonial_id === id ? next : t,
      )

      return next
    }

    const nextOrder =
      db.testimonials.reduce((max, t) => Math.max(max, t.display_order), 0) + 1

    const created = {
      ...data,
      testimonial_id: uid("tst"),
      display_order: nextOrder,
    }

    db.testimonials = [...db.testimonials, created]

    return created
  })

  return ok(saved)
}

export function deleteTestimonial(actor: Actor | null, id: string): Result {
  const denied = guard(actor, "cms")

  if (denied) return denied

  mutate((db) => {
    db.testimonials = db.testimonials.filter((t) => t.testimonial_id !== id)
  })

  return ok(undefined)
}

export function listFaqs(): FaqItem[] {
  return [...getDb().faqs].sort((a, b) => a.display_order - b.display_order)
}

export function saveFaq(
  actor: Actor | null,

  data: Omit<FaqItem, "faq_id" | "display_order">,

  id?: string,
): Result<FaqItem> {
  const denied = guard(actor, "cms")

  if (denied) return denied

  if (!data.question.trim()) return fail("VALIDATION", "שאלה חובה.")

  const saved = mutate((db) => {
    if (id) {
      const next = {
        ...db.faqs.find((f) => f.faq_id === id) as FaqItem,
        ...data,
      }

      db.faqs = db.faqs.map((f) => (f.faq_id === id ? next : f))

      return next
    }

    const nextOrder =
      db.faqs.reduce((max, f) => Math.max(max, f.display_order), 0) + 1

    const created = { ...data, faq_id: uid("faq"), display_order: nextOrder }

    db.faqs = [...db.faqs, created]

    return created
  })

  return ok(saved)
}

export function deleteFaq(actor: Actor | null, id: string): Result {
  const denied = guard(actor, "cms")

  if (denied) return denied

  mutate((db) => {
    db.faqs = db.faqs.filter((f) => f.faq_id !== id)
  })

  return ok(undefined)
}

/* ── Coupons ──────────────────────────────────────────── */

export function listCoupons(): Coupon[] {
  return getDb().coupons
}

export function findCoupon(code: string): Coupon | undefined {
  const normalized = code.trim().toUpperCase()

  const coupon = getDb().coupons.find(
    (c) => c.code.toUpperCase() === normalized && c.status === "ACTIVE",
  )

  if (!coupon) return undefined

  if (coupon.expires_at && new Date(coupon.expires_at).getTime() < Date.now())
    return undefined

  if (
    coupon.usage_limit !== undefined &&
    coupon.times_used >= coupon.usage_limit
  )
    return undefined

  return coupon
}

export function saveCoupon(
  actor: Actor | null,

  data: Omit<Coupon, "coupon_id" | "times_used">,

  id?: string,
): Result<Coupon> {
  const denied = guard(actor, "cms")

  if (denied) return denied

  const code = data.code.trim().toUpperCase()

  if (!code) return fail("VALIDATION", "קוד הקופון חובה.")

  const db = getDb()

  if (
    db.coupons.some((c) => c.code.toUpperCase() === code && c.coupon_id !== id)
  ) {
    return fail("CONFLICT", "קופון עם קוד זה כבר קיים.")
  }

  const saved = mutate((d) => {
    if (id) {
      const next = {
        ...d.coupons.find((c) => c.coupon_id === id) as Coupon,
        ...data,
        code,
      }

      d.coupons = d.coupons.map((c) => (c.coupon_id === id ? next : c))

      return next
    }

    const created: Coupon = {
      ...data,
      code,
      coupon_id: uid("cpn"),
      times_used: 0,
    }

    d.coupons = [...d.coupons, created]

    return created
  })

  writeAudit(actor, {
    category: "COUPON_CHANGE",

    action: id ? "עדכון קופון" : "יצירת קופון",

    target_type: "COUPON",

    target_id: saved.coupon_id,

    target_label: saved.code,

    details: `${saved.discount_type} ${saved.discount_value}`,
  })

  return ok(saved)
}

export function deleteCoupon(actor: Actor | null, id: string): Result {
  const denied = guard(actor, "cms")

  if (denied) return denied

  const coupon = getDb().coupons.find((c) => c.coupon_id === id)

  if (!coupon) return fail("NOT_FOUND", "הקופון לא נמצא.")

  mutate((db) => {
    db.coupons = db.coupons.filter((c) => c.coupon_id !== id)
  })

  writeAudit(actor, {
    category: "COUPON_CHANGE",

    action: "מחיקת קופון",

    target_type: "COUPON",

    target_id: id,

    target_label: coupon.code,

    details: "—",
  })

  return ok(undefined)
}

/**
 * Increments usage. Called only from the checkout service after an order
 * was actually created, so a redemption can never be counted twice.
 */

export function redeemCoupon(code: string): void {
  const normalized = code.trim().toUpperCase()

  mutate((db) => {
    db.coupons = db.coupons.map((c) =>
      c.code.toUpperCase() === normalized
        ? { ...c, times_used: c.times_used + 1 }
        : c,
    )
  })
}

/* ── CMS backup / restore ─────────────────────────────── */

export function exportCmsBackup(actor: Actor | null): Result<CmsBackup> {
  const denied = guard(actor, "cms")

  if (denied) return denied

  const db = getDb()

  return ok({
    backed_up_at: nowIso(),

    sections: db.sections,

    products: db.products,

    categories: db.categories,

    testimonials: db.testimonials,

    faqs: db.faqs,
  })
}

/** Restores catalog and content only. Orders, refunds and customers are never touched. */

export function restoreCmsBackup(
  actor: Actor | null,
  backup: Partial<CmsBackup>,
): Result {
  const denied = guard(actor, "cms")

  if (denied) return denied

  if (!backup || typeof backup !== "object")
    return fail("VALIDATION", "קובץ הגיבוי אינו תקין.")

  mutate((db) => {
    if (Array.isArray(backup.sections)) db.sections = backup.sections

    if (Array.isArray(backup.products)) db.products = backup.products

    if (Array.isArray(backup.categories)) db.categories = backup.categories

    if (Array.isArray(backup.testimonials))
      db.testimonials = backup.testimonials

    if (Array.isArray(backup.faqs)) db.faqs = backup.faqs
  })

  writeAudit(actor, {
    category: "OTHER",

    action: "שחזור גיבוי CMS",

    target_type: "CMS",

    target_id: "backup",

    target_label: backup.backed_up_at ?? "—",

    details: "התוכן והקטלוג שוחזרו מקובץ גיבוי",
  })

  return ok(undefined)
}

/* ── CRM ──────────────────────────────────────────────── */

export function listLeads(): CrmLead[] {
  return getDb().crm_leads
}

export function listCrmTasks(): CrmTask[] {
  return getDb().crm_tasks
}

export function listCrmNotes(): CrmNote[] {
  return getDb().crm_notes
}

export function saveLead(
  actor: Actor | null,

  data: Omit<CrmLead, "lead_id" | "created_at" | "notes_count"> & {
    lead_id?: string
  },

  id?: string,
): Result<CrmLead> {
  const denied = guard(actor, "crm")

  if (denied) return denied

  if (!data.full_name.trim() || !isEmail(data.email))
    return fail("VALIDATION", "שם מלא וכתובת מייל תקינה הם שדות חובה.")

  const saved = mutate((db) => {
    if (id) {
      const next = {
        ...db.crm_leads.find((l) => l.lead_id === id) as CrmLead,
        ...data,
        lead_id: id,
      }

      db.crm_leads = db.crm_leads.map((l) => (l.lead_id === id ? next : l))

      return next
    }

    const created: CrmLead = {
      ...data,
      lead_id: uid("lead"),
      notes_count: 0,
      created_at: nowIso(),
    }

    db.crm_leads = [created, ...db.crm_leads]

    return created
  })

  return ok(saved)
}

export function setLeadStage(
  actor: Actor | null,
  leadId: string,
  stage: LeadStage,
): Result {
  const denied = guard(actor, "crm")

  if (denied) return denied

  const lead = getDb().crm_leads.find((l) => l.lead_id === leadId)

  if (!lead) return fail("NOT_FOUND", "הליד לא נמצא.")

  mutate((db) => {
    db.crm_leads = db.crm_leads.map((l) =>
      l.lead_id === leadId ? { ...l, stage, last_contact_at: nowIso() } : l,
    )
  })

  writeAudit(actor, {
    category: "OTHER",

    action: "עדכון שלב ליד",

    target_type: "LEAD",

    target_id: leadId,

    target_label: lead.full_name,

    details: `${lead.stage} → ${stage}`,
  })

  return ok(undefined)
}

export function addLeadNote(
  actor: Actor | null,

  leadId: string,

  content: string,

  category: NoteCategory = "GENERAL",
): Result<CrmNote> {
  const denied = guard(actor, "crm")

  if (denied) return denied

  if (!content.trim()) return fail("VALIDATION", "תוכן ההערה חובה.")

  const lead = getDb().crm_leads.find((l) => l.lead_id === leadId)

  if (!lead) return fail("NOT_FOUND", "הליד לא נמצא.")

  const note = mutate((db) => {
    const created: CrmNote = {
      note_id: uid("cnote"),

      lead_id: leadId,

      category,

      content: content.trim(),

      created_at: nowIso(),

      author: actor?.name ?? "מערכת",
    }

    db.crm_notes = [created, ...db.crm_notes]

    db.crm_leads = db.crm_leads.map((l) =>
      l.lead_id === leadId
        ? {
            ...l,
            notes_count: l.notes_count + 1,
            last_contact_at: created.created_at,
          }
        : l,
    )

    return created
  })

  return ok(note)
}

export function deleteLead(actor: Actor | null, leadId: string): Result {
  const denied = guard(actor, "crm")

  if (denied) return denied

  mutate((db) => {
    db.crm_leads = db.crm_leads.filter((l) => l.lead_id !== leadId)

    db.crm_notes = db.crm_notes.filter((n) => n.lead_id !== leadId)

    db.crm_tasks = db.crm_tasks.filter((t) => t.lead_id !== leadId)
  })

  return ok(undefined)
}

export function saveTask(
  actor: Actor | null,

  data: Omit<CrmTask, "task_id"> & { task_id?: string },

  id?: string,
): Result<CrmTask> {
  const denied = guard(actor, "crm")

  if (denied) return denied

  if (!data.title.trim()) return fail("VALIDATION", "כותרת המשימה חובה.")

  const saved = mutate((db) => {
    if (id) {
      const next = {
        ...db.crm_tasks.find((t) => t.task_id === id) as CrmTask,
        ...data,
        task_id: id,
      }

      db.crm_tasks = db.crm_tasks.map((t) => (t.task_id === id ? next : t))

      return next
    }

    const created: CrmTask = { ...data, task_id: uid("task") }

    db.crm_tasks = [created, ...db.crm_tasks]

    return created
  })

  return ok(saved)
}

export function toggleTask(actor: Actor | null, taskId: string): Result {
  const denied = guard(actor, "crm")

  if (denied) return denied

  mutate((db) => {
    db.crm_tasks = db.crm_tasks.map((t) =>
      t.task_id === taskId ? { ...t, done: !t.done } : t,
    )
  })

  return ok(undefined)
}

export function deleteTask(actor: Actor | null, taskId: string): Result {
  const denied = guard(actor, "crm")

  if (denied) return denied

  mutate((db) => {
    db.crm_tasks = db.crm_tasks.filter((t) => t.task_id !== taskId)
  })

  return ok(undefined)
}

/* ── Alerts bookkeeping ───────────────────────────────── */

export function listDismissedAlerts(): string[] {
  return getDb().dismissed_alerts
}

export function dismissAlert(actor: Actor | null, alertId: string): Result {
  const denied = guard(actor, "alerts")

  if (denied) return denied

  mutate((db) => {
    if (!db.dismissed_alerts.includes(alertId))
      db.dismissed_alerts = [...db.dismissed_alerts, alertId]
  })

  return ok(undefined)
}

export function reinstateAlert(actor: Actor | null, alertId: string): Result {
  const denied = guard(actor, "alerts")

  if (denied) return denied

  mutate((db) => {
    db.dismissed_alerts = db.dismissed_alerts.filter((a) => a !== alertId)
  })

  return ok(undefined)
}

/* ── Sequence helpers shared with the sibling services ── */

export function nextReference(
  prefix: string,
  sequenceKey: string,
  pad = 4,
): string {
  const year = new Date().getFullYear()

  return mutate(
    (db) =>
      `${prefix}-${year}-${String(nextSequence(db, sequenceKey)).padStart(pad, "0")}`,
  )
}
