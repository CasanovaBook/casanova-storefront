export type LoginErrorCode =
  | "INVALID_CREDENTIALS"
  | "RATE_LIMITED"
  | "CAPTCHA_REQUIRED"
  | "CAPTCHA_FAILED"
  | "CAPTCHA_UNAVAILABLE"
  | "AUTH_UNAVAILABLE"
  | "EMAIL_UNCONFIRMED"
  | "ACCOUNT_BLOCKED"
  | "VALIDATION"

export interface LoginRequest {
  email: string
  password: string
  /** Standard Turnstile form-field key, sent as JSON when CAPTCHA is required. */
  "cf-turnstile-response"?: string
}

export interface LoginSuccess {
  access_token: string
  refresh_token: string
  expires_in: number
  token_type: string
}

export interface LoginFailure {
  error: string
  code: LoginErrorCode
  retryAfterSeconds?: number
  captchaRequired?: boolean
  isUnconfirmed?: boolean
}

export const LOGIN_MESSAGES = {
  INVALID_CREDENTIALS: "שם משתמש או סיסמה שגויים",
  RATE_LIMITED:
    "יותר מדי ניסיונות התחברות. אנא נסה שוב מאוחר יותר",
  CAPTCHA_REQUIRED: "כדי להמשיך, יש להשלים את אימות האבטחה.",
  CAPTCHA_FAILED: "אימות האבטחה נכשל. אנא נסה שוב.",
  CAPTCHA_UNAVAILABLE:
    "אימות האבטחה אינו זמין כרגע. אנא נסה שוב בעוד רגע.",
  AUTH_UNAVAILABLE:
    "שירות ההתחברות אינו זמין כרגע. אנא נסה שוב בעוד רגע.",
  EMAIL_UNCONFIRMED:
    "כתובת האימייל טרם אומתה. אנא אשר את המייל שנשלח אליך כדי להמשיך.",
  ACCOUNT_BLOCKED:
    "החשבון שלך מושהה ואינו יכול להתחבר. אם לדעתך נפלה טעות, אנא צור קשר עם התמיכה.",
  VALIDATION: "הבקשה אינה תקינה.",
} as const satisfies Record<LoginErrorCode, string>
