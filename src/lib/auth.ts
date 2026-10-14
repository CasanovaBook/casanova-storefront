/* ─────────────────────────────────────────────────────────────
 * Credential hashing and session handling.
 *
 * Passwords are never stored or logged in clear text: each account
 * carries its own random salt and only a digest is persisted. The
 * digest is produced with WebCrypto SHA-256 where available and falls
 * back to a deterministic non-cryptographic digest otherwise, because
 * a static bundle has no server to do this properly. Replacing this
 * module with real server-side argon2/bcrypt verification is listed as
 * technical debt in the final report.
 * ───────────────────────────────────────────────────────────── */

import type { StoredUser, User } from "../types"

export const SESSION_KEY = "casanova_session_v1"

/** Strips credential material before a user record reaches React state. */

export function toPublicUser(u: StoredUser): User {
  const {
    password_hash: _hash,
    password_salt: _salt,
    password_set: _set,
    ...pub
  } = u

  return pub
}

export function hasPassword(u: StoredUser): boolean {
  return Boolean(u.password_hash && u.password_salt)
}

export function randomSalt(): string {
  const bytes = new Uint8Array(16)

  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(bytes)
  } else {
    for (let i = 0; i < bytes.length; i += 1)
      bytes[i] = Math.floor(Math.random() * 256)
  }

  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")
}

function fallbackDigest(input: string): string {
  // FNV-1a over several rounds. Not cryptographic — a placeholder so the

  // app never keeps plaintext passwords even without WebCrypto.

  let h1 = 0x811c9dc5

  let h2 = 0x01000193

  for (let round = 0; round < 4; round += 1) {
    for (let i = 0; i < input.length; i += 1) {
      const c = input.charCodeAt(i) + round

      h1 = (h1 ^ c) >>> 0

      h1 = Math.imul(h1, 0x01000193) >>> 0

      h2 = (h2 + c + h1) >>> 0

      h2 = Math.imul(h2, 0x85ebca6b) >>> 0
    }
  }

  return (
    (h1 >>> 0).toString(16).padStart(8, "0") +
    (h2 >>> 0).toString(16).padStart(8, "0")
  )
}

export async function hashPassword(
  password: string,
  salt: string,
): Promise<string> {
  const material = `${salt}:${password}`

  const subtle = typeof crypto !== "undefined" ? crypto.subtle : undefined

  if (!subtle) return fallbackDigest(material)

  try {
    const encoded = new TextEncoder().encode(material)

    const buffer = await subtle.digest("SHA-256", encoded)

    return Array.from(new Uint8Array(buffer), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join("")
  } catch {
    return fallbackDigest(material)
  }
}

export async function verifyPassword(
  password: string,

  salt: string | undefined,

  expectedHash: string | undefined,
): Promise<boolean> {
  if (!salt || !expectedHash) return false

  const actual = await hashPassword(password, salt)

  // Constant-length comparison; avoids leaking hash length differences.

  if (actual.length !== expectedHash.length) return false

  let diff = 0

  for (let i = 0; i < actual.length; i += 1)
    diff |= actual.charCodeAt(i) ^ expectedHash.charCodeAt(i)

  return diff === 0
}

/**
 * One rule per field, shared by every form that asks for it.
 *
 * The standalone register screen and the checkout screen used to carry their
 * own inline copies of the email and phone checks, and the copies drifted: one
 * accepted any address holding an `@`, the other required a full pattern, and
 * neither agreed with `isEmail()`, which is what the service layer actually
 * refuses on. A field that is accepted at registration and rejected at
 * purchase (or the reverse) is a customer-visible contradiction, so the wording
 * and the thresholds now live beside the validator the backend already uses.
 */

/** Why an address cannot be used, in the customer's language — or `null`. */
export function emailProblem(value: string): string | null {
  const email = value.trim()

  if (!email) return "יש להזין כתובת אימייל."

  if (hasHebrewChars(email))
    return "כתובת האימייל אינה יכולה להכיל אותיות בעברית. יש להזין כתובת באנגלית בלבד."

  /* Anything outside ASCII fails the same way for the same reason: the mail
   * system, the identity key and the receipts all expect an ASCII address. */
  if (!/^[\x20-\x7E]+$/.test(email))
    return "כתובת האימייל חייבת להכיל אותיות באנגלית בלבד."

  if (!email.includes("@"))
    return "כתובת האימייל חייבת להכיל את הסימן @"

  /* The same test the service layer applies, so the form never accepts an
   * address the store will refuse. */
  if (!isEmail(email)) return "נדרשת כתובת מייל תקינה"

  return null
}

/* ── Phone (Israeli mobile) ─────────────────────────────
 *
 * The number is captured as a prefix plus a subscriber number so the two
 * parts can be validated and re-displayed without guessing where one ends.
 * Stored form stays the flat local format (`0501234567`) that `users.phone`
 * and `orders.customer_phone` already hold — no format change, no migration.
 */

/** The mobile prefixes the storefront offers. */
export const PHONE_PREFIXES = [
  "050",
  "051",
  "052",
  "053",
  "054",
  "055",
  "058",
] as const

/** Digits the subscriber part holds; prefix (3) + this = the full 10. */
export const PHONE_NUMBER_DIGITS = 7

export interface PhoneParts {
  prefix: string

  number: string
}

/**
 * Splits a stored phone back into the picker's two controls.
 *
 * Both shapes the database can legitimately contain are handled: the local
 * `0XXXXXXXXX` form the storefront writes, and the `972XXXXXXXXX` form an
 * older record or a hand-entered contact can carry. A number whose prefix is
 * not an Israeli mobile prefix has no slot to return to, so it comes back
 * empty rather than half-filled — the customer retypes it instead of placing
 * an order under a number they did not confirm.
 */
export function parsePhoneParts(
  phone?: string | null,
  fallbackPrefix: string = PHONE_PREFIXES[0],
): PhoneParts {
  const empty = { prefix: fallbackPrefix, number: "" }
  if (!phone) return empty

  const digits = phone.replace(/\D/g, "")

  const local = digits.startsWith("972")
    ? `0${digits.slice(3)}`
    : digits.startsWith("0")
      ? digits
      : ""

  if (local.length < 10) return empty

  return {
    prefix: local.slice(0, 3),
    number: local.slice(3, 3 + PHONE_NUMBER_DIGITS),
  }
}

/** The flat stored form, or `null` until a number is actually entered. */
export function joinPhone({ prefix, number }: PhoneParts): string {
  return prefix && number ? `${prefix}${number}` : ""
}

/**
 * Why a phone number cannot be used — or `null`.
 *
 * `required` is the whole point of the parameter: the purchase must collect a
 * reachable number (docs/PRODUCT_BRIEF.md §5 lists Phone among the fields a
 * checkout has to gather), while opening an account does not. One validator,
 * two honest answers, so the two screens can never disagree about the format.
 */
export function phoneProblem(
  parts: PhoneParts,
  required: boolean,
): string | null {
  const { prefix, number } = parts

  if (!number) return required ? "שדה חובה" : null

  if (!/^\d+$/.test(number)) return "מספר הטלפון יכול להכיל רק ספרות"

  if (number.length > PHONE_NUMBER_DIGITS)
    return `מספר הטלפון חייב להכיל בדיוק ${PHONE_NUMBER_DIGITS} ספרות`

  if (number.length < PHONE_NUMBER_DIGITS)
    return `מספר הטלפון חייב להכיל בדיוק ${PHONE_NUMBER_DIGITS} ספרות (הוקלדו ${number.length} ספרות)`

  const digits = joinPhone(parts)

  if (digits.length !== 3 + PHONE_NUMBER_DIGITS || !digits.startsWith("0"))
    return "פורמט מספר טלפון לא תקין"

  return null
}

/** Basic strength gate shared by setup and reset flows. */

export function passwordProblem(password: string): string | null {
  if (password.length < 8) return "הסיסמה חייבת להכיל לפחות 8 תווים."

  if (!/[A-Za-z]/.test(password)) return "הסיסמה חייבת להכיל אותיות."

  if (!/\d/.test(password)) return "הסיסמה חייבת להכיל ספרה."

  return null
}

/* ── Session ──────────────────────────────────────────── */

export function readSessionUserId(): string | null {
  try {
    return localStorage.getItem(SESSION_KEY)
  } catch {
    return null
  }
}

export function writeSessionUserId(userId: string | null): void {
  try {
    if (userId) localStorage.setItem(SESSION_KEY, userId)
    else localStorage.removeItem(SESSION_KEY)
  } catch {
    /* storage unavailable — session stays in memory only */
  }
}

export function normalizeEmail(email: string): string {
  return email.toLowerCase().trim()
}

export function isEmail(value: string): boolean {
  return (
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && /^[\x20-\x7E]+$/.test(value)
  )
}

export function hasHebrewChars(text: string): boolean {
  return /[\u0590-\u05FF]/.test(text)
}
