/* ─────────────────────────────────────────────────────────────
 * CMS — content protection & security.
 *
 * Three panels, all driven by the same store the reader reads from, so
 * an edit here changes what a customer experiences on their next page
 * turn rather than on the next release:
 *
 *   1. Protection policies — which deterrents are in force, the identity
 *      watermark, the device cap and the inactivity timeout.
 *   2. Device sessions — every browser currently holding a slot, with
 *      the ability to revoke one and stop that screen immediately.
 *   3. Protection events — what the deterrents actually caught.
 *
 * Restricted to SUPER_ADMIN. The service layer enforces the same
 * permission, so this page is a view of the policy rather than the
 * policy itself.
 * ───────────────────────────────────────────────────────────── */

import { useMemo, useState } from "react"

import { useAdmin } from "../../context/AdminContext"

import { useStore } from "../../data/store"

import { can } from "../../lib/permissions"

import {
  HIGH_SIGNAL_EVENTS,
  SCOPE_LABEL,
  SECURITY_EVENT_LABEL,
  deleteDrmPolicy,
  isSessionExpired,
  isSessionOpen,
  listDeviceSessions,
  resolveDrmPolicy,
  revokeDeviceSession,
  saveDrmPolicy,
  type DrmPolicyInput,
} from "../../lib/api-security"

import type {
  DeviceSession,
  DrmPolicy,
  DrmScope,
  SecurityEventType,
} from "../../types"

import AccessDenied from "../../components/AccessDenied"

import EmptyState from "../../components/ui/EmptyState"

import PageHeader from "../../components/ui/PageHeader"

import Alert from "../../components/ui/Alert"

import Modal from "../../components/Modal"

import Icon, { type IconName } from "../../components/icons"

const inputStyle = {
  background: "var(--color-secondary)",

  borderColor: "var(--color-border)",

  color: "var(--color-foreground)",
} as const

const inputClass = "w-full px-4 py-2.5 rounded-lg border text-sm outline-none"

const SCOPES: DrmScope[] = ["ALL", "WEB", "MOBILE"]

/** Every deterrent the policy can switch, with what turning it off costs. */

const FLAG_FIELDS: { key: keyof DrmPolicyInput, label: string, hint: string }[] =
  [
    {
      key: "block_screenshots",

      label: "חסימת צילום מסך",

      hint: "מיירטת מקשי צילום ומוחקת את לוח הגזירים באיבוד מיקוד. אינה עוצרת צילום ברמת מערכת ההפעלה.",
    },

    {
      key: "block_screen_recording",

      label: "חסימת הקלטת מסך",

      hint: "מדווחת על קיצורי הקלטה ומכסה את התוכן כאשר החלון אינו פעיל.",
    },

    {
      key: "hide_content_on_blur",

      label: "הסתרת התוכן באיבוד מיקוד",

      hint: "הקריאה נעלמת כאשר עוברים לחלון אחר — מונעת חשיפה בשיתוף מסך או בצילום אקראי.",
    },

    {
      key: "block_copy",

      label: "חסימת העתקה וגרירה",

      hint: "מנטרלת בחירת טקסט, העתקה, גזירה וגרירת קובץ אל שולחן העבודה.",
    },

    {
      key: "block_print",

      label: "חסימת הדפסה",

      hint: "מונעת Ctrl/Cmd+P ומרוקנת את פלט ההדפסה. הדפסה מתוך תצוגת ה־PDF של הדפדפן אינה נחסמת בדפדפן.",
    },

    {
      key: "block_download",

      label: "חסימת הורדה ושיתוף",

      hint: "באפליקציה: מונעת שמירת קובץ, ייצוא, פתיחה באפליקציה אחרת ואת תפריט השיתוף, ומנפיקה לכל קריאה קישור חד־פעמי במקום כתובת קבועה של הקובץ. בדפדפן: מסירה את סרגל הכלים של תצוגת ה־PDF ואת נתיבי השמירה שניתן לזהות.",
    },

    {
      key: "block_rooted_devices",

      label: "חסימת מכשירים פרוצים",

      hint: "מכשיר עם Root או Jailbreak הופך את חסימת צילום המסך ואת ארגז החול של האפליקציה להמלצה בלבד. כאשר הדגל דלוק, מכשיר כזה לא מקבל תוכן מוגן והאירוע נרשם.",
    },
  ]

function formatDate(value: string): string {
  return new Date(value).toLocaleString("he-IL", {
    day: "numeric",

    month: "short",

    year: "numeric",

    hour: "2-digit",

    minute: "2-digit",
  })
}

function Card({
  icon,

  title,

  description,

  children,
}: {
  icon: IconName

  title: string

  description: string

  children: React.ReactNode
}) {
  const titleId = `security-${title.replace(/\s+/g, "-")}`

  return (
    <section className="app-surface" aria-labelledby={titleId}>
      <div className="app-surface-head">
        <div className="flex items-center gap-3 min-w-0">
          <span
            className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{
              background:
                "color-mix(in srgb, var(--color-primary) 12%, transparent)",
              color: "var(--color-primary)",
            }}
            aria-hidden="true"
          >
            <Icon name={icon} size={18} />
          </span>
          <div className="min-w-0">
            <h2 id={titleId} className="app-section-title">
              {title}
            </h2>
            <p className="text-xs app-muted mt-0.5 leading-relaxed">
              {description}
            </p>
          </div>
        </div>
      </div>
      <div className="app-surface-body">{children}</div>
    </section>
  )
}

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="app-field">
      <span className="app-label">{label}</span>
      {children}
      {hint && <p className="app-hint">{hint}</p>}
    </div>
  )
}

function Toggle({
  label,

  hint,

  checked,

  onChange,
}: {
  label: string

  hint: string

  checked: boolean

  onChange: (next: boolean) => void
}) {
  return (
    <label className="flex items-start gap-3 cursor-pointer select-none py-2">
      <input
        type="checkbox"
        className="mt-1"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>
        <span className="text-sm font-medium">{label}</span>
        <span
          className="block text-[11px] mt-0.5 leading-relaxed"
          style={{ color: "var(--color-muted-foreground)" }}
        >
          {hint}
        </span>
      </span>
    </label>
  )
}

function PolicyEditor({
  policy,

  onClose,

  onSaved,
}: {
  policy: DrmPolicy | null

  onClose: () => void

  onSaved: (message: string) => void
}) {
  const [form, setForm] = useState<DrmPolicyInput>(() =>
    policy
      ? {
          policy_name: policy.policy_name,

          applies_to: policy.applies_to,

          block_screenshots: policy.block_screenshots,

          block_screen_recording: policy.block_screen_recording,

          hide_content_on_blur: policy.hide_content_on_blur,

          block_copy: policy.block_copy,

          block_print: policy.block_print,

          block_download: policy.block_download,

          allow_offline: policy.allow_offline,

          offline_ttl_hours: policy.offline_ttl_hours ?? null,

          block_rooted_devices: policy.block_rooted_devices,

          watermark_enabled: policy.watermark_enabled,

          watermark_template: policy.watermark_template,

          watermark_opacity: policy.watermark_opacity,

          max_devices_per_user: policy.max_devices_per_user,

          session_timeout_minutes: policy.session_timeout_minutes,

          active: policy.active,
        }
      : {
          policy_name: "",

          applies_to: "WEB",

          block_screenshots: true,

          block_screen_recording: true,

          hide_content_on_blur: true,

          block_copy: true,

          block_print: true,

          block_download: true,

          allow_offline: false,

          offline_ttl_hours: null,

          block_rooted_devices: true,

          watermark_enabled: true,

          watermark_template: "{name} · {email}",

          watermark_opacity: 0.07,

          max_devices_per_user: 3,

          session_timeout_minutes: 120,

          active: true,
        },
  )

  const [error, setError] = useState("")

  const { actor } = useAdmin()

  const setFlag = (key: keyof DrmPolicyInput, value: boolean) =>
    setForm({ ...form, [key]: value } as DrmPolicyInput)

  const submit = () => {
    setError("")

    const result = saveDrmPolicy(actor, form, policy?.policy_id)

    if (!result.ok) {
      setError(result.error)

      return
    }

    onSaved(
      policy
        ? "המדיניות עודכנה."
        : "המדיניות נוצרה והיא חלה מיידית על הקוראים הפתוחים.",
    )

    onClose()
  }

  return (
    <Modal
      size="2xl"
      title={policy ? "עריכת מדיניות הגנה" : "מדיניות הגנה חדשה"}
      onClose={onClose}
    >

        <div className="space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="שם המדיניות">
              <input
                className={inputClass}
                style={inputStyle}
                value={form.policy_name}
                placeholder="למשל: ספרים דיגיטליים — מחמיר"
                onChange={(e) =>
                  setForm({ ...form, policy_name: e.target.value })
                }
              />
            </Field>
            <Field
              label="חלה על"
              hint="מדיניות מדויקת לפלטפורמה גוברת על מדיניות ״הכול״."
            >
              <select
                className={inputClass}
                style={inputStyle}
                value={form.applies_to}
                onChange={(e) =>
                  setForm({ ...form, applies_to: e.target.value as DrmScope })
                }
              >
                {SCOPES.map((scope) => (
                  <option key={scope} value={scope}>
                    {SCOPE_LABEL[scope]}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <div
            className="rounded-xl border p-4"
            style={{
              borderColor: "var(--color-border)",
              background: "var(--color-secondary)",
            }}
          >
            <p
              className="text-xs font-semibold mb-2"
              style={{ color: "var(--color-muted-foreground)" }}
            >
              אמצעי מניעה
            </p>
            {FLAG_FIELDS.map((flag) => (
              <Toggle
                key={flag.key}
                label={flag.label}
                hint={flag.hint}
                checked={Boolean(form[flag.key])}
                onChange={(next) => setFlag(flag.key, next)}
              />
            ))}
          </div>

          <div
            className="rounded-xl border p-4"
            style={{
              borderColor: "var(--color-border)",
              background: "var(--color-secondary)",
            }}
          >
            <Toggle
              label="סימון מזהה (Watermark)"
              hint="שם הקורא וכתובתו מוטבעים על גבי התוכן. זהו אמצעי ההרתעה החזק ביותר: כל עותק שודלף מצביע על החשבון שממנו נלקח."
              checked={form.watermark_enabled}
              onChange={(next) => setForm({ ...form, watermark_enabled: next })}
            />
            {form.watermark_enabled && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-3">
                <Field
                  label="תבנית הסימון"
                  hint="משתנים זמינים: {name} שם הקורא, {email} כתובתו, {date} תאריך הקריאה."
                >
                  <input
                    dir="ltr"
                    className={inputClass}
                    style={inputStyle}
                    value={form.watermark_template}
                    onChange={(e) =>
                      setForm({ ...form, watermark_template: e.target.value })
                    }
                  />
                </Field>
                <Field
                  label={`עוצמת הסימון — ${Math.round(form.watermark_opacity * 100)}%`}
                  hint="עד 40%. עוצמה גבוהה מקשה על קריאה."
                >
                  <input
                    type="range"
                    min="0.01"
                    max="0.4"
                    step="0.01"
                    className="w-full"
                    value={form.watermark_opacity}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        watermark_opacity: Number(e.target.value),
                      })
                    }
                  />
                </Field>
              </div>
            )}
          </div>

          <div
            className="rounded-xl border p-4"
            style={{
              borderColor: "var(--color-border)",
              background: "var(--color-secondary)",
            }}
          >
            <Toggle
              label="קריאה ללא חיבור לאינטרנט"
              hint="שומר עותק מוצפן בארגז החול של האפליקציה בלבד. זהו בכל זאת קובץ שנשאר על המכשיר אחרי סיום הקריאה, ולכן הוא כבוי כברירת מחדל ומוגבל בזמן."
              checked={form.allow_offline}
              onChange={(next) =>
                setForm({
                  ...form,
                  allow_offline: next,
                  offline_ttl_hours: next
                    ? (form.offline_ttl_hours ?? 72)
                    : null,
                })
              }
            />
            {form.allow_offline && (
              <div className="mt-3">
                <Field
                  label="משך שמירת העותק (שעות)"
                  hint="בתום התוקף האפליקציה מוחקת את העותק ונדרשת להתחבר שוב. עד 720 שעות (30 ימים)."
                >
                  <input
                    dir="ltr"
                    type="number"
                    min="1"
                    max="720"
                    className={inputClass}
                    style={inputStyle}
                    value={form.offline_ttl_hours ?? ""}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        offline_ttl_hours: Number(e.target.value) || null,
                      })
                    }
                  />
                </Field>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field
              label="מכשירים לכל חשבון"
              hint="מספר הדפדפנים שיכולים לקרוא בו־זמנית. חריגה נחסמת ונרשמת ביומן האירועים."
            >
              <input
                dir="ltr"
                type="number"
                min="1"
                max="50"
                className={inputClass}
                style={inputStyle}
                value={form.max_devices_per_user}
                onChange={(e) =>
                  setForm({
                    ...form,
                    max_devices_per_user: Number(e.target.value),
                  })
                }
              />
            </Field>
            <Field
              label="פג תוקף בחוסר פעילות (דקות)"
              hint="הקריאה נעצרת וניתנת לחידוש בלחיצה. ההתקדמות נשמרת."
            >
              <input
                dir="ltr"
                type="number"
                min="1"
                className={inputClass}
                style={inputStyle}
                value={form.session_timeout_minutes}
                onChange={(e) =>
                  setForm({
                    ...form,
                    session_timeout_minutes: Number(e.target.value),
                  })
                }
              />
            </Field>
          </div>

          <label className="flex items-center gap-2.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={form.active}
              onChange={(e) => setForm({ ...form, active: e.target.checked })}
            />
            <span className="text-sm font-medium">מדיניות פעילה</span>
          </label>

          {error && (
            <Alert tone="error">{error}</Alert>
          )}

          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="app-btn-secondary"
            >
              ביטול
            </button>
            <button
              type="button"
              onClick={submit}
              className="app-btn"
            >
              {policy ? "שמירת שינויים" : "יצירת המדיניות"}
            </button>
          </div>
        </div>
      </Modal>
  )
}

export default function AdminSecurityPage() {
  const { adminRole, users, actor } = useAdmin()

  const db = useStore()

  const [message, setMessage] = useState<{
    kind: "ok" | "error"
    text: string
  } | null>(null)

  const [editing, setEditing] = useState<{
    open: boolean
    policy: DrmPolicy | null
  }>({ open: false, policy: null })

  const [eventFilter, setEventFilter] = useState<SecurityEventType | "ALL">(
    "ALL",
  )

  const [deviceFilter, setDeviceFilter] = useState<"OPEN" | "ALL">("OPEN")

  // Revoking needs a reason for the audit trail, so it is a two-step

  // inline flow rather than a browser prompt — prompts are unreliable on

  // mobile and cannot be styled to match the rest of the CMS.

  const [pendingRevoke, setPendingRevoke] = useState<DeviceSession | null>(null)

  const [revokeReason, setRevokeReason] = useState("")

  /* Deleting a policy used to run on a single click. It stays the same
   * mutation, but it now passes through an explicit Hebrew confirmation. */
  const [pendingDelete, setPendingDelete] = useState<DrmPolicy | null>(null)

  const policies = db.drm_policies

  const events = db.security_events

  const inForce = useMemo(() => resolveDrmPolicy(policies, "WEB"), [policies])

  const devices = useMemo(() => {
    // Privileged staff see every account's devices. Without the permission

    // the guarded service call is used instead, which returns only the

    // caller's own sessions — so the page degrades to a personal device

    // list rather than becoming a way to enumerate other customers.

    const all: DeviceSession[] = can(adminRole, "security")
      ? db.device_sessions
      : (() => {
          const scoped = listDeviceSessions(actor)

          return scoped.ok ? scoped.data : []
        })()

    return deviceFilter === "OPEN" ? all.filter(isSessionOpen) : all
  }, [db.device_sessions, actor, adminRole, deviceFilter])

  const filteredEvents = useMemo(
    () =>
      eventFilter === "ALL"
        ? events
        : events.filter((e) => e.event_type === eventFilter),

    [events, eventFilter],
  )

  const usedEventTypes = useMemo(
    () => [...new Set(events.map((e) => e.event_type))] as SecurityEventType[],

    [events],
  )

  const highSignal = useMemo(
    () =>
      events.filter((e) => HIGH_SIGNAL_EVENTS.includes(e.event_type)).length,

    [events],
  )

  if (!can(adminRole, "security"))
    return <AccessDenied page="הגנת תוכן ואבטחה" />

  const nameOf = (userId?: string) => {
    if (!userId) return "ללא חשבון"

    const found = users.find((u) => u.user_id === userId)

    return found ? `${found.first_name} ${found.last_name}` : "חשבון שנמחק"
  }

  const titleOf = (productId?: string) => {
    if (!productId) return ""

    return db.products.find((p) => p.product_id === productId)?.name ?? ""
  }

  const remove = (policy: DrmPolicy) => {
    const result = deleteDrmPolicy(actor, policy.policy_id)

    setMessage(
      result.ok
        ? { kind: "ok", text: "המדיניות נמחקה." }
        : { kind: "error", text: result.error },
    )

    setPendingDelete(null)
  }

  const revoke = () => {
    if (!pendingRevoke) return

    const result = revokeDeviceSession(
      actor,
      pendingRevoke.session_id,
      revokeReason,
    )

    setMessage(
      result.ok
        ? { kind: "ok", text: "המכשיר נחסם. מסך הקריאה שלו יינעל מיידית." }
        : { kind: "error", text: result.error },
    )

    setPendingRevoke(null)

    setRevokeReason("")
  }

  const noActivePolicy = policies.filter((p) => p.active).length === 0

  return (
    <div className="page-enter">
      <PageHeader
        eyebrow="הגנה ובקרה"
        title="הגנת תוכן ואבטחה"
        description="מדיניות ההגנה על ספרים ומוצרים דיגיטליים, המכשירים המורשים לקרוא בהם, ויומן הניסיונות שנחסמו. כל שינוי כאן משפיע מיידית על הקוראים הפתוחים."
      />

      {message && (
        <div className="mb-4">
          <Alert tone={message.kind === "ok" ? "success" : "error"}>
            <div className="flex items-start justify-between gap-3">
              <span>{message.text}</span>
              <button
                type="button"
                onClick={() => setMessage(null)}
                aria-label="סגירת הודעה"
                className="app-icon-btn"
                style={{ width: "1.75rem", height: "1.75rem", minHeight: "1.75rem" }}
              >
                <Icon name="x" size={13} />
              </button>
            </div>
          </Alert>
        </div>
      )}

      {noActivePolicy && (
        <div className="mb-5">
          <Alert tone="warning">
            כל המדיניות כבויה, ולכן חלה מדיניות ברירת המחדל המוגנת של המערכת —
            ההגנות אינן כבויות. כדי להרפות הגנה יש לערוך מדיניות פעילה ולכבות
            בתוכה את הדגל הרלוונטי, כך שהשינוי יתועד ביומן הפעולות.
          </Alert>
        </div>
      )}

      <div className="space-y-6">
        {/* ── What is in force right now ───────────────────── */}
        <Card
          icon="shield"
          title="מה חל כרגע על הקורא בדפדפן"
          description="סיכום המדיניות שנבחרה בפועל עבור פלטפורמת הדפדפן, לפי הכלל: היקף מדויק גובר על ״הכול״."
        >
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-center">
            {[
              {
                label: "מכשירים לחשבון",
                value: String(inForce.max_devices_per_user),
                icon: "smartphone" as IconName,
              },

              {
                label: "פג תוקף (דק׳)",
                value: String(inForce.session_timeout_minutes),
                icon: "clock" as IconName,
              },

              {
                label: "סימון מזהה",

                value: inForce.watermark_enabled
                  ? `${Math.round(inForce.watermark_opacity * 100)}%`
                  : "כבוי",

                icon: "eye" as IconName,
              },

              {
                label: "אמצעי מניעה",

                value: String(
                  FLAG_FIELDS.filter((f) => Boolean(inForce[f.key])).length +
                    (inForce.watermark_enabled ? 1 : 0),
                ),

                icon: "lock" as IconName,
              },
            ].map((tile) => (
              <div
                key={tile.label}
                className="rounded-xl border p-4"
                style={{
                  borderColor: "var(--color-border)",
                  background: "var(--color-secondary)",
                }}
              >
                <span
                  className="flex justify-center mb-2"
                  style={{ color: "var(--color-primary)" }}
                >
                  <Icon name={tile.icon} size={16} />
                </span>
                <p className="font-display text-xl font-semibold">
                  {tile.value}
                </p>
                <p
                  className="text-[11px] mt-0.5"
                  style={{ color: "var(--color-muted-foreground)" }}
                >
                  {tile.label}
                </p>
              </div>
            ))}
          </div>
          <p
            className="text-[11px] mt-4 leading-relaxed"
            style={{ color: "var(--color-muted-foreground)" }}
          >
            מגבלה כנה: דפדפן אינו יכול למנוע צילום של המסך במצלמה, ואינו יכול
            להצפין קובץ שהדפדפן עצמו צריך לקרוא. מה שהמדיניות הזו מספקת הוא
            זיהוי — כל עותק שודלף נושא את פרטי הרוכש — והגבלה מעשית על הפצת
            רכישה אחת בין מכשירים. הגנה מלאה מחייבת שרת שמנפיק עמודים חתומים לכל
            הפעלה.
          </p>
        </Card>

        {/* ── Policies ─────────────────────────────────────── */}
        <Card
          icon="layers"
          title="מדיניות הגנה"
          description="ניתן להגדיר מדיניות שונה לכל פלטפורמה או לכל סוג מוצר, ולהחליף ביניהן ללא שינוי קוד."
        >
          <div className="flex flex-wrap justify-end gap-2 mb-4">
            <button
              type="button"
              onClick={() => setEditing({ open: true, policy: null })}
              className="app-btn"
            >
              <Icon name="sparkles" size={14} />
              מדיניות חדשה
            </button>
          </div>

          {policies.length === 0 ? (
            <EmptyState
              icon="shield"
              title="לא הוגדרה מדיניות"
              description="חלה מדיניות ברירת המחדל המוגנת."
            />
          ) : (
            <div className="space-y-3">
              {policies.map((policy) => {
                const governing =
                  policy.policy_id === inForce.policy_id && policy.active

                return (
                  <div
                    key={policy.policy_id}
                    className="app-surface app-surface--flat p-4"
                    style={{
                      borderColor: governing
                        ? "var(--color-primary)"
                        : "var(--color-border)",
                    }}
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="font-semibold text-sm">
                            {policy.policy_name}
                          </h3>
                          <span className="app-badge app-badge--neutral">
                            {SCOPE_LABEL[policy.applies_to]}
                          </span>
                          {governing && (
                            <span className="app-badge app-badge--accent">
                              בתוקף כעת
                            </span>
                          )}
                          {!policy.active && (
                            <span className="app-badge app-badge--neutral">
                              כבויה
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] app-muted mt-2 leading-relaxed">
                          {FLAG_FIELDS.filter((f) => Boolean(policy[f.key]))

                            .map((f) => f.label)

                            .join(" · ") || "ללא אמצעי מניעה"}
                          {" · "}
                          {policy.watermark_enabled
                            ? `סימון מזהה ${Math.round(policy.watermark_opacity * 100)}%`
                            : "ללא סימון מזהה"}
                          {" · "}
                          {policy.max_devices_per_user} מכשירים · פג תוקף אחרי{" "}
                          {policy.session_timeout_minutes} דק׳
                        </p>
                        <p className="text-[10px] app-muted mt-1.5">
                          עודכן {formatDate(policy.updated_at)}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2 flex-shrink-0">
                        <button
                          type="button"
                          onClick={() => setEditing({ open: true, policy })}
                          className="app-btn-secondary"
                          style={{
                            minHeight: "2.25rem",
                            padding: "0.4rem 0.85rem",
                            fontSize: "0.75rem",
                          }}
                        >
                          <Icon name="pen" size={13} /> עריכה
                        </button>
                        <button
                          type="button"
                          onClick={() => setPendingDelete(policy)}
                          className="app-btn-secondary"
                          style={{
                            minHeight: "2.25rem",
                            padding: "0.4rem 0.85rem",
                            fontSize: "0.75rem",
                            borderColor:
                              "color-mix(in srgb, var(--color-danger) 40%, var(--color-border))",
                            color: "var(--color-danger)",
                          }}
                        >
                          <Icon name="x" size={13} /> מחיקה
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </Card>

        {/* ── Device sessions ──────────────────────────────── */}
        <Card
          icon="smartphone"
          title="מכשירים מחוברים"
          description="כל דפדפן שתופס מקום במכסת המכשירים של חשבון. חסימה כאן נועלת את מסך הקריאה של אותו מכשיר מיידית."
        >
          <div
            className="app-tabs mb-4"
            role="group"
            aria-label="סינון מכשירים מחוברים"
          >
            {(["OPEN", "ALL"] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setDeviceFilter(value)}
                className="app-tab"
                data-active={deviceFilter === value}
                aria-pressed={deviceFilter === value}
              >
                {value === "OPEN" ? "פעילים כעת" : "הכול כולל היסטוריה"}
              </button>
            ))}
          </div>

          {devices.length === 0 ? (
            <EmptyState
              icon="smartphone"
              title="אין מכשירים רשומים"
              description="מכשיר נרשם בפעם הראשונה כאשר לקוח פותח ספר שקנה."
            />
          ) : (
            <div className="app-table-wrap">
              <table className="app-table" style={{ minWidth: "48rem" }}>
                <caption className="sr-only">
                  מכשירים מחוברים — חשבון, מכשיר, מועד פתיחה, פעילות אחרונה,
                  מצב וחסימה
                </caption>
                <thead>
                  <tr>
                    <th scope="col">חשבון</th>
                    <th scope="col">מכשיר</th>
                    <th scope="col">נפתח</th>
                    <th scope="col">נראה לאחרונה</th>
                    <th scope="col">מצב</th>
                    <th scope="col" style={{ textAlign: "left" }}>
                      פעולות
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {devices.map((session) => {
                    const expired = isSessionExpired(session, inForce)

                    const status = session.revoked
                      ? { text: "נחסם", badge: "app-badge--danger" }
                      : session.ended_at
                        ? {
                            text: "שוחרר",
                            badge: "app-badge--neutral",
                          }
                        : expired
                          ? { text: "פג תוקף", badge: "app-badge--warning" }
                          : { text: "פעיל", badge: "app-badge--success" }

                    return (
                      <tr key={session.session_id}>
                        <td
                          className="text-xs"
                          style={{ overflowWrap: "anywhere" }}
                        >
                          {nameOf(session.user_id)}
                        </td>
                        <td className="text-xs">
                          <span className="flex items-center gap-1.5">
                            <Icon name="smartphone" size={13} />{" "}
                            <span style={{ overflowWrap: "anywhere" }}>
                              {session.device_name}
                            </span>
                          </span>
                          <span
                            className="text-[10px] app-muted"
                            dir="ltr"
                            style={{
                              display: "block",
                              maxWidth: "18rem",
                              overflowWrap: "anywhere",
                            }}
                          >
                            {session.device_fingerprint}
                          </span>
                        </td>
                        <td className="text-[11px] app-muted whitespace-nowrap">
                          {formatDate(session.started_at)}
                        </td>
                        <td className="text-[11px] app-muted whitespace-nowrap">
                          {formatDate(session.last_seen_at)}
                        </td>
                        <td>
                          <span className={`app-badge ${status.badge}`}>
                            {status.text}
                          </span>
                        </td>
                        <td style={{ textAlign: "left" }}>
                          {isSessionOpen(session) && (
                            <button
                              type="button"
                              onClick={() => {
                                setPendingRevoke(session)

                                setRevokeReason("")
                              }}
                              className="app-btn-secondary"
                              style={{
                                minHeight: "2.1rem",
                                padding: "0.3rem 0.7rem",
                                fontSize: "0.72rem",
                                borderColor:
                                  "color-mix(in srgb, var(--color-danger) 40%, var(--color-border))",
                                color: "var(--color-danger)",
                              }}
                            >
                              חסימה
                            </button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {pendingRevoke && (
            <div
              className="mt-4 rounded-xl border p-4"
              style={{
                borderColor:
                  "color-mix(in srgb, var(--color-danger) 40%, var(--color-border))",
                background:
                  "color-mix(in srgb, var(--color-danger) 5%, var(--color-card))",
              }}
            >
              <p
                className="text-sm font-semibold mb-1"
                style={{ color: "var(--color-danger)" }}
              >
                חסימת המכשיר של {nameOf(pendingRevoke.user_id)}
              </p>
              <p className="text-[11px] app-muted mb-3 leading-relaxed">
                מסך הקריאה באותו מכשיר יינעל מיידית והמקום יתפנה במכסת המכשירים
                של החשבון. הסיבה תירשם ביומן הפעולות וביומן אירועי ההגנה.
              </p>
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                <input
                  className="w-full px-4 py-2.5 sm:flex-1 sm:min-w-56"
                  style={inputStyle}
                  placeholder="סיבה (למשל: שיתוף חשבון עם גורם שלישי)"
                  value={revokeReason}
                  onChange={(e) => setRevokeReason(e.target.value)}
                />
                <button
                  type="button"
                  onClick={revoke}
                  className="app-btn-danger"
                >
                  אישור חסימה
                </button>
                <button
                  type="button"
                  onClick={() => setPendingRevoke(null)}
                  className="app-btn-secondary"
                >
                  ביטול
                </button>
              </div>
            </div>
          )}
        </Card>

        {/* ── Protection events ────────────────────────────── */}
        <Card
          icon="zap"
          title="אירועי הגנה"
          description="מה שאמצעי המניעה תפסו בפועל. אירועים כפולים מאותו מסך מצומצמים, והיומן מוגבל באורכו כדי לא להאט את המערכת."
        >
          <div
            className="app-tabs mb-4"
            role="group"
            aria-label="סינון אירועי הגנה"
          >
            <button
              type="button"
              onClick={() => setEventFilter("ALL")}
              className="app-tab"
              data-active={eventFilter === "ALL"}
              aria-pressed={eventFilter === "ALL"}
            >
              הכול ({events.length})
            </button>
            {usedEventTypes.map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => setEventFilter(type)}
                className="app-tab"
                data-active={eventFilter === type}
                aria-pressed={eventFilter === type}
                style={{
                  fontWeight: HIGH_SIGNAL_EVENTS.includes(type) ? 700 : 600,
                }}
              >
                {SECURITY_EVENT_LABEL[type]} (
                {events.filter((e) => e.event_type === type).length})
              </button>
            ))}
          </div>

          {filteredEvents.length === 0 ? (
            <EmptyState
              icon="zap"
              title="אין אירועים להצגה"
              description={
                events.length === 0
                  ? "לא נרשמו אירועי הגנה. זהו מצב תקין — אירוע נרשם רק כאשר מישהו מנסה פעולה שנחסמה."
                  : "לא נמצאו אירועים מהסוג שנבחר."
              }
            />
          ) : (
            <div className="space-y-2">
              {filteredEvents.slice(0, 60).map((event) => {
                const product = titleOf(event.product_id)

                const detail =
                  typeof event.metadata.detail === "string"
                    ? event.metadata.detail
                    : ""

                return (
                  <div
                    key={event.event_id}
                    className="rounded-lg border px-4 py-3 flex flex-wrap items-center gap-x-3 gap-y-1"
                    style={{
                      borderColor: HIGH_SIGNAL_EVENTS.includes(event.event_type)
                        ? "rgba(201,138,74,0.4)"
                        : "var(--color-border)",

                      background: "var(--color-secondary)",
                    }}
                  >
                    <span
                      className="text-xs font-semibold"
                      style={{
                        color: HIGH_SIGNAL_EVENTS.includes(event.event_type)
                          ? "var(--color-primary)"
                          : "var(--color-foreground)",
                      }}
                    >
                      {SECURITY_EVENT_LABEL[event.event_type]}
                    </span>
                    <span
                      className="text-[11px] app-muted"
                      style={{ overflowWrap: "anywhere", minWidth: 0 }}
                    >
                      {nameOf(event.user_id)}
                      {product ? ` · ${product}` : ""}
                      {detail ? ` · ${detail}` : ""}
                    </span>
                    <span className="text-[11px] app-muted ms-auto whitespace-nowrap">
                      {formatDate(event.created_at)}
                    </span>
                  </div>
                )
              })}
              {filteredEvents.length > 60 && (
                <p className="text-[11px] app-muted text-center pt-2">
                  מוצגים 60 האירועים האחרונים מתוך {filteredEvents.length}.
                </p>
              )}
            </div>
          )}

          <p className="text-[11px] app-muted mt-4 leading-relaxed">
            אירועים בעלי משקל גבוה עד כה: {highSignal}. אלו מצביעים על ניסיון
            עקיפה מכוון ולא על הקשה מקרית.
          </p>
        </Card>
      </div>

      {editing.open && (
        <PolicyEditor
          policy={editing.policy}
          onClose={() => setEditing({ open: false, policy: null })}
          onSaved={(text) => setMessage({ kind: "ok", text })}
        />
      )}

      {pendingDelete && (
        <Modal
          size="md"
          align="center"
          title="מחיקת מדיניות הגנה"
          onClose={() => setPendingDelete(null)}
        >
          <p className="text-sm leading-relaxed">
            למחוק את המדיניות{" "}
            <strong>{pendingDelete.policy_name}</strong> (
            {SCOPE_LABEL[pendingDelete.applies_to]})? מחיקת המדיניות אינה הפיכה,
            היא תירשם ביומן הפעולות, וההגנות שהיא מפעילה יפסיקו לחול על
            הפלטפורמה שהיא חלה עליה.
          </p>
          <p className="text-xs app-muted mt-3 leading-relaxed">
            אם זו המדיניות הפעילה היחידה, המערכת תסרב למחוק אותה כדי שלא
            תישאר המערכת ללא מדיניות מוגדרת.
          </p>
          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 mt-6">
            <button
              type="button"
              onClick={() => setPendingDelete(null)}
              className="app-btn-secondary"
            >
              ביטול
            </button>
            <button
              type="button"
              onClick={() => remove(pendingDelete)}
              className="app-btn-danger"
            >
              <Icon name="x" size={14} /> מחיקת המדיניות
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}
