/**
 * Sensitive-data masking for the admin panel.
 *
 * Policy: admins and support agents must NEVER see raw passwords, full card
 * numbers, CVV, API keys, tokens or secrets. The admin panel only ever stores
 * and renders already-masked representations produced by these helpers.
 */

/** Never store/render more than the last 4 digits of a card. */

export function maskCard(last4?: string): string {
  const tail = (last4 ?? "").replace(/\D/g, "").slice(-4)

  return tail ? `•••• •••• •••• ${tail}` : "•••• •••• •••• ••••"
}

/** Keep first char + domain of an email, mask the middle. */

export function maskEmail(email: string): string {
  const [local, domain] = email.split("@")

  if (!domain) return "•••"

  const head = local.slice(0, 1)

  return `${head}•••@${domain}`
}

/** Mask any secret/token/key down to a fixed opaque placeholder. */

export function maskSecret(label = "ערך"): string {
  return `${label} מוסתר`
}

/** CVV is never stored or shown. */

export function maskCvv(): string {
  return "•••"
}

export const SECURITY_NOTE =
  "מטעמי אבטחה, סיסמאות, מספרי כרטיס מלאים, CVV, מפתחות API, טוקנים ו־סודות אינם נחשפים לעולם במערכת הניהול."
