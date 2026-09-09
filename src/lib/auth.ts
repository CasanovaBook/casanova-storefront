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
