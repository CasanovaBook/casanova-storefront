/* ─────────────────────────────────────────────────────────────
 * Service layer (the "API").
 *
 * Every read and write in the application goes through this module or
 * one of its siblings (`api-orders.ts`, `api-support.ts`). Each
 * mutating operation receives the calling principal and refuses the
 * call unless that principal holds the matching permission - so
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
  EmailLog,
  FaqItem,
  PlatformSettings,
  Product,
  ProductStatus,
  Role,
  StoredUser,
  Testimonial,
  User,
} from "../types"

import { snapshotProduct } from "../types"

import { getDb, mutate, nextSequence, nowIso, uid, uniqueSlug } from "../data/db"

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

/* ── Shared application contract ────────────────────────────────
 * The Result / ErrorCode / Actor / guard vocabulary is defined once in
 * `src/shared/result.ts`. api.ts imports it for internal use and
 * re-exports it so every existing `import { … } from "lib/api"` call
 * site keeps compiling unchanged, while infrastructure modules import
 * the contract directly from `shared/result` instead of depending on
 * this large service module. */

import {
  fail,
  guard,
  ok,
  type Actor,
  type ErrorCode,
  type Failure,
  type Result,
} from "../shared/result"

export { fail, guard, ok } from "../shared/result"
export type { Actor, ErrorCode, Failure, Result } from "../shared/result"

/* ── Extracted services (Phase 5B / Group B) ────────────────
 * audit, notifications, settings, assets and alerts moved to
 * `src/services/*`. api.ts imports the primitives its retained
 * functions still call (writeAudit, dispatchEmail) and re-exports the
 * moved symbols so every existing `@/lib/api` caller keeps working. */

import { writeAudit } from "../services/audit"

import { dispatchEmail } from "../services/notifications"

export { writeAudit }
export { listAudit, type AuditInput } from "../services/audit"

export { dispatchEmail }
export {
  listEmailLogs,
  resendEmail,
  type EmailInput,
} from "../services/notifications"

export { getSettings, updateSettings } from "../services/settings"

export { readAssetFile } from "../services/assets"

export {
  dismissAlert,
  listDismissedAlerts,
  reinstateAlert,
} from "../services/alerts"

export {
  archiveProduct,
  createProduct,
  deleteCategory,
  getProduct,
  getProductBySlug,
  listCategories,
  listFeaturedProducts,
  listProducts,
  listPublicProducts,
  moveProduct,
  resolveProducts,
  saveCategory,
  setProductStatus,
  updateProduct,
  deleteProduct,
  type ProductDraft,
} from "../services/catalog"

export {
  deleteFaq,
  deleteSection,
  deleteTestimonial,
  exportCmsBackup,
  listFaqs,
  listSections,
  listTestimonials,
  moveSection,
  restoreCmsBackup,
  saveFaq,
  saveSection,
  saveTestimonial,
  toggleSection,
} from "../services/cms"

/* ── Principal ────────────────────────────────────────── */

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
    return fail("FORBIDDEN", "כבר קיים חשבון מנהל - ההתקנה הראשונית הושלמה.")

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

export interface RegisterOptions {
  /**
   * Session id of the caller. When that account is a passwordless guest
   * (created at checkout), registration must finish *that* row instead of
   * inserting a second CUSTOMER - otherwise orders and entitlements stay
   * attached to the abandoned guest identity.
   */
  upgradeUserId?: string | null
}

function isClaimableGuest(user: StoredUser): boolean {
  return user.role === "CUSTOMER" && !hasPassword(user)
}

async function completeGuestRegistration(
  existing: StoredUser,
  input: RegisterInput,
  email: string,
  password: string,
): Promise<Result<User>> {
  const problem = passwordProblem(password)

  if (problem) return fail("VALIDATION", problem)

  const taken = getDb().users.find(
    (u) => u.email === email && u.user_id !== existing.user_id,
  )

  if (taken) return fail("CONFLICT", "כבר קיים חשבון עבור כתובת מייל זו.")

  const salt = randomSalt()

  const password_hash = await hashPassword(password, salt)

  const updated = mutate((db) => {
    db.users = db.users.map((u) =>
      u.user_id === existing.user_id
        ? {
            ...u,
            first_name: input.first_name.trim() || u.first_name,
            last_name: input.last_name.trim() || u.last_name,
            email,
            phone: input.phone?.trim() || u.phone,
            password_hash,
            password_salt: salt,
            password_set: true,
            must_change_password: false,
            last_login_at: nowIso(),
            updated_at: nowIso(),
          }
        : u,
    )

    return db.users.find((u) => u.user_id === existing.user_id) as StoredUser
  })

  return ok(toPublicUser(updated))
}

/** Public customer registration (also used by checkout). */

export async function registerCustomer(
  input: RegisterInput,
  options?: RegisterOptions,
): Promise<Result<User>> {
  if (hasHebrewChars(input.email))
    return fail("VALIDATION", "כתובת אימייל אינה יכולה להכיל אותיות בעברית.")

  const email = normalizeEmail(input.email)

  if (!isEmail(email)) return fail("VALIDATION", "כתובת המייל אינה תקינה.")

  /* Both forms mark the name fields as required and both say so in their own
   * words; this is the same rule the hosted path enforces
   * (`create_storefront_order` → `name_required`). Stating it here as well is
   * what makes the agreement real rather than a courtesy the client may skip.
   * A passwordless guest row created without a name would also leave the
   * order and the invoice with nothing to print. */
  if (!input.first_name.trim() || !input.last_name.trim())
    return fail("VALIDATION", "יש למלא שם מלא.")

  const db = getDb()

  const sessionUser = options?.upgradeUserId
    ? db.users.find((u) => u.user_id === options.upgradeUserId)
    : undefined

  // A signed-in guest completing the register form is converting their
  // existing purchase identity, not opening a parallel account.
  if (sessionUser && isClaimableGuest(sessionUser) && input.password) {
    return completeGuestRegistration(sessionUser, input, email, input.password)
  }

  const existing = db.users.find((u) => u.email === email)

  if (existing) {
    if (isClaimableGuest(existing) && input.password) {
      return completeGuestRegistration(existing, input, email, input.password)
    }

    return fail("CONFLICT", "כבר קיים חשבון עבור כתובת מייל זו.")
  }

  let salt: string | undefined

  let password_hash: string | undefined

  if (input.password) {
    const problem = passwordProblem(input.password)

    if (problem) return fail("VALIDATION", problem)

    salt = randomSalt()

    password_hash = await hashPassword(input.password, salt)
  }

  const created = mutate((d) => {
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

      last_login_at: password_hash ? nowIso() : undefined,

      created_at: nowIso(),

      updated_at: nowIso(),
    }

    d.users = [...d.users, user]

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

  if (existing) {
    /* A returning customer can hand over a phone number for the first time at
     * the till: the checkout form has always collected it while the account was
     * created without one. The order keeps it either way; carrying it onto the
     * profile is what stops the support form and the next checkout from asking
     * again for something the customer already gave - and it is the local
     * mirror of what `syncAccountPhone` does on the hosted backend.
     *
     * Only ever fills a blank. A profile that already holds a number was set
     * deliberately somewhere else, and a purchase form is not the place to
     * overwrite it. */
    const phone = input.phone?.trim()

    if (!phone || existing.phone) return ok(existing)

    const updated = mutate((d) => {
      d.users = d.users.map((u) =>
        u.user_id === existing.user_id
          ? { ...u, phone, updated_at: nowIso() }
          : u,
      )

      return d.users.find((u) => u.user_id === existing.user_id) as StoredUser
    })

    return ok(updated)
  }

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
 * raw value is returned exactly once and cannot be read back later - it is
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
