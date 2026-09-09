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

import { useStore } from "../../lib/store"

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
  return (
    <div className="card-glow p-6">
      <div className="flex items-center gap-3 mb-1">
        <span style={{ color: "var(--color-primary)" }}>
          <Icon name={icon} size={17} />
        </span>
        <h2 className="font-display text-lg font-semibold">{title}</h2>
      </div>
      <p
        className="text-xs mb-5"
        style={{ color: "var(--color-muted-foreground)" }}
      >
        {description}
      </p>
      {children}
    </div>
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
    <div>
      <label
        className="block text-xs font-medium mb-1.5"
        style={{ color: "var(--color-muted-foreground)" }}
      >
        {label}
      </label>
      {children}
      {hint && (
        <p
          className="text-[11px] mt-1 leading-relaxed"
          style={{ color: "var(--color-muted-foreground)" }}
        >
          {hint}
        </p>
      )}
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
    <div className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto p-4 sm:p-6 drawer-scrim">
      <div
        className="w-full max-w-2xl rounded-2xl border p-6 my-4"
        style={{
          background: "var(--color-card)",
          borderColor: "var(--color-border)",
        }}
      >
        <div className="flex items-center justify-between mb-5">
          <h3 className="font-display text-xl font-semibold">
            {policy ? "עריכת מדיניות הגנה" : "מדיניות הגנה חדשה"}
          </h3>
          <button
            onClick={onClose}
            aria-label="סגירה"
            className="tap-target flex items-center justify-center"
          >
            <Icon name="x" size={17} />
          </button>
        </div>

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
            <p
              className="text-xs px-4 py-2.5 rounded-lg"
              style={{
                background: "rgba(239,68,68,0.1)",
                color: "var(--color-danger)",
              }}
            >
              {error}
            </p>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button
              onClick={onClose}
              className="px-5 py-2.5 rounded-full border text-sm font-semibold"
              style={{
                borderColor: "var(--color-border)",
                color: "var(--color-muted-foreground)",
              }}
            >
              ביטול
            </button>
            <button
              onClick={submit}
              className="btn-gradient px-6 py-2.5 rounded-full text-sm font-semibold"
            >
              {policy ? "שמירת שינויים" : "יצירת המדיניות"}
            </button>
          </div>
        </div>
      </div>
    </div>
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
    <div className="max-w-5xl mx-auto page-enter">
      <div className="mb-8">
        <h1 className="font-display text-4xl font-semibold mb-1">
          הגנת תוכן ואבטחה
        </h1>
        <p style={{ color: "var(--color-muted-foreground)" }}>
          מדיניות ההגנה על ספרים ומוצרים דיגיטליים, המכשירים המורשים לקרוא בהם,
          ויומן הניסיונות שנחסמו. כל שינוי כאן משפיע מיידית על הקוראים הפתוחים.
        </p>
      </div>

      {message && (
        <p
          className="text-xs px-4 py-2.5 rounded-lg mb-4 flex items-center justify-between gap-3"
          style={{
            background:
              message.kind === "ok"
                ? "rgba(34,197,94,0.1)"
                : "rgba(239,68,68,0.1)",

            color:
              message.kind === "ok"
                ? "var(--color-success)"
                : "var(--color-danger)",
          }}
        >
          {message.text}
          <button onClick={() => setMessage(null)} aria-label="סגירת הודעה">
            <Icon name="x" size={13} />
          </button>
        </p>
      )}

      {noActivePolicy && (
        <p
          className="text-xs px-4 py-3 rounded-lg mb-5 leading-relaxed"
          style={{ background: "rgba(245,158,11,0.1)", color: "#F59E0B" }}
        >
          כל המדיניות כבויה, ולכן חלה מדיניות ברירת המחדל המוגנת של המערכת —
          ההגנות אינן כבויות. כדי להרפות הגנה יש לערוך מדיניות פעילה ולכבות
          בתוכה את הדגל הרלוונטי, כך שהשינוי יתועד ביומן הפעולות.
        </p>
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
          <div className="flex justify-end mb-4">
            <button
              onClick={() => setEditing({ open: true, policy: null })}
              className="btn-gradient px-5 py-2.5 rounded-full text-sm font-semibold"
            >
              מדיניות חדשה
            </button>
          </div>

          {policies.length === 0 ? (
            <p
              className="text-sm text-center py-8"
              style={{ color: "var(--color-muted-foreground)" }}
            >
              לא הוגדרה מדיניות. חלה מדיניות ברירת המחדל המוגנת.
            </p>
          ) : (
            <div className="space-y-3">
              {policies.map((policy) => {
                const governing =
                  policy.policy_id === inForce.policy_id && policy.active

                return (
                  <div
                    key={policy.policy_id}
                    className="rounded-xl border p-4"
                    style={{
                      borderColor: governing
                        ? "var(--color-primary)"
                        : "var(--color-border)",

                      background: "var(--color-secondary)",
                    }}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="font-semibold text-sm">
                            {policy.policy_name}
                          </h3>
                          <span
                            className="text-[10px] px-2 py-0.5 rounded-full border"
                            style={{
                              borderColor: "var(--color-border)",
                              color: "var(--color-muted-foreground)",
                            }}
                          >
                            {SCOPE_LABEL[policy.applies_to]}
                          </span>
                          {governing && (
                            <span
                              className="text-[10px] px-2 py-0.5 rounded-full font-bold"
                              style={{
                                background: "var(--color-primary)",
                                color: "var(--color-primary-foreground)",
                              }}
                            >
                              בתוקף כעת
                            </span>
                          )}
                          {!policy.active && (
                            <span
                              className="text-[10px] px-2 py-0.5 rounded-full"
                              style={{
                                background: "rgba(148,163,184,0.18)",
                                color: "var(--color-muted-foreground)",
                              }}
                            >
                              כבויה
                            </span>
                          )}
                        </div>
                        <p
                          className="text-[11px] mt-2 leading-relaxed"
                          style={{ color: "var(--color-muted-foreground)" }}
                        >
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
                        <p
                          className="text-[10px] mt-1.5"
                          style={{ color: "var(--color-muted-foreground)" }}
                        >
                          עודכן {formatDate(policy.updated_at)}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => setEditing({ open: true, policy })}
                          className="tap-target px-4 py-2 rounded-lg border text-xs font-medium flex items-center gap-1.5"
                          style={{
                            borderColor: "var(--color-border)",
                            color: "var(--color-foreground)",
                          }}
                        >
                          <Icon name="pen" size={13} /> עריכה
                        </button>
                        <button
                          onClick={() => remove(policy)}
                          className="tap-target px-4 py-2 rounded-lg border text-xs font-medium flex items-center gap-1.5"
                          style={{
                            borderColor: "rgba(239,68,68,0.4)",
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
          <div className="flex gap-2 flex-wrap mb-4">
            {(["OPEN", "ALL"] as const).map((value) => (
              <button
                key={value}
                onClick={() => setDeviceFilter(value)}
                className="tap-target px-4 py-2 rounded-full text-xs font-medium border"
                style={{
                  background:
                    deviceFilter === value
                      ? "var(--color-primary)"
                      : "transparent",

                  color:
                    deviceFilter === value
                      ? "var(--color-primary-foreground)"
                      : "var(--color-muted-foreground)",

                  borderColor:
                    deviceFilter === value
                      ? "var(--color-primary)"
                      : "var(--color-border)",
                }}
              >
                {value === "OPEN" ? "פעילים כעת" : "הכול כולל היסטוריה"}
              </button>
            ))}
          </div>

          {devices.length === 0 ? (
            <p
              className="text-sm text-center py-8"
              style={{ color: "var(--color-muted-foreground)" }}
            >
              אין מכשירים רשומים. מכשיר נרשם בפעם הראשונה כאשר לקוח פותח ספר
              שקנה.
            </p>
          ) : (
            <div className="overflow-x-auto -mx-6 px-6">
              <table className="w-full text-sm min-w-[640px]">
                <thead>
                  <tr
                    className="text-[11px] text-right"
                    style={{ color: "var(--color-muted-foreground)" }}
                  >
                    <th className="pb-2 font-medium">חשבון</th>
                    <th className="pb-2 font-medium">מכשיר</th>
                    <th className="pb-2 font-medium">נפתח</th>
                    <th className="pb-2 font-medium">נראה לאחרונה</th>
                    <th className="pb-2 font-medium">מצב</th>
                    <th className="pb-2 font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {devices.map((session) => {
                    const expired = isSessionExpired(session, inForce)

                    const status = session.revoked
                      ? { text: "נחסם", color: "var(--color-danger)" }
                      : session.ended_at
                        ? {
                            text: "שוחרר",
                            color: "var(--color-muted-foreground)",
                          }
                        : expired
                          ? { text: "פג תוקף", color: "#F59E0B" }
                          : { text: "פעיל", color: "var(--color-success)" }

                    return (
                      <tr
                        key={session.session_id}
                        className="border-t"
                        style={{ borderColor: "var(--color-border)" }}
                      >
                        <td className="py-2.5 text-xs">
                          {nameOf(session.user_id)}
                        </td>
                        <td className="py-2.5 text-xs">
                          <span className="flex items-center gap-1.5">
                            <Icon name="smartphone" size={13} />{" "}
                            {session.device_name}
                          </span>
                          <span
                            className="text-[10px]"
                            style={{ color: "var(--color-muted-foreground)" }}
                            dir="ltr"
                          >
                            {session.device_fingerprint}
                          </span>
                        </td>
                        <td
                          className="py-2.5 text-[11px]"
                          style={{ color: "var(--color-muted-foreground)" }}
                        >
                          {formatDate(session.started_at)}
                        </td>
                        <td
                          className="py-2.5 text-[11px]"
                          style={{ color: "var(--color-muted-foreground)" }}
                        >
                          {formatDate(session.last_seen_at)}
                        </td>
                        <td
                          className="py-2.5 text-[11px] font-medium"
                          style={{ color: status.color }}
                        >
                          {status.text}
                        </td>
                        <td className="py-2.5 text-left">
                          {isSessionOpen(session) && (
                            <button
                              onClick={() => {
                                setPendingRevoke(session)

                                setRevokeReason("")
                              }}
                              className="tap-target px-3 py-1.5 rounded-lg border text-[11px] font-medium"
                              style={{
                                borderColor: "rgba(239,68,68,0.4)",
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
                borderColor: "rgba(239,68,68,0.4)",
                background: "rgba(239,68,68,0.05)",
              }}
            >
              <p
                className="text-sm font-semibold mb-1"
                style={{ color: "var(--color-danger)" }}
              >
                חסימת המכשיר של {nameOf(pendingRevoke.user_id)}
              </p>
              <p
                className="text-[11px] mb-3"
                style={{ color: "var(--color-muted-foreground)" }}
              >
                מסך הקריאה באותו מכשיר יינעל מיידית והמקום יתפנה במכסת המכשירים
                של החשבון. הסיבה תירשם ביומן הפעולות וביומן אירועי ההגנה.
              </p>
              <div className="flex flex-wrap gap-2 items-center">
                <input
                  className="flex-1 min-w-56 px-4 py-2.5 rounded-lg border text-sm outline-none"
                  style={inputStyle}
                  placeholder="סיבה (למשל: שיתוף חשבון עם גורם שלישי)"
                  value={revokeReason}
                  onChange={(e) => setRevokeReason(e.target.value)}
                />
                <button
                  onClick={revoke}
                  className="tap-target px-5 py-2.5 rounded-full text-sm font-semibold border"
                  style={{
                    borderColor: "rgba(239,68,68,0.5)",
                    color: "var(--color-danger)",
                  }}
                >
                  אישור חסימה
                </button>
                <button
                  onClick={() => setPendingRevoke(null)}
                  className="tap-target px-5 py-2.5 rounded-full text-sm font-medium border"
                  style={{
                    borderColor: "var(--color-border)",
                    color: "var(--color-muted-foreground)",
                  }}
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
          <div className="flex items-center gap-2 flex-wrap mb-4">
            <button
              onClick={() => setEventFilter("ALL")}
              className="tap-target px-3 py-2 rounded-full text-xs font-medium border"
              style={{
                background:
                  eventFilter === "ALL"
                    ? "var(--color-primary)"
                    : "transparent",

                color:
                  eventFilter === "ALL"
                    ? "var(--color-primary-foreground)"
                    : "var(--color-muted-foreground)",

                borderColor:
                  eventFilter === "ALL"
                    ? "var(--color-primary)"
                    : "var(--color-border)",
              }}
            >
              הכול ({events.length})
            </button>
            {usedEventTypes.map((type) => (
              <button
                key={type}
                onClick={() => setEventFilter(type)}
                className="tap-target px-3 py-2 rounded-full text-xs font-medium border"
                style={{
                  background:
                    eventFilter === type
                      ? "var(--color-primary)"
                      : "transparent",

                  color:
                    eventFilter === type
                      ? "var(--color-primary-foreground)"
                      : "var(--color-muted-foreground)",

                  borderColor:
                    eventFilter === type
                      ? "var(--color-primary)"
                      : "var(--color-border)",

                  fontWeight: HIGH_SIGNAL_EVENTS.includes(type) ? 700 : 500,
                }}
              >
                {SECURITY_EVENT_LABEL[type]} (
                {events.filter((e) => e.event_type === type).length})
              </button>
            ))}
          </div>

          {filteredEvents.length === 0 ? (
            <p
              className="text-sm text-center py-8"
              style={{ color: "var(--color-muted-foreground)" }}
            >
              {events.length === 0
                ? "לא נרשמו אירועי הגנה. זהו מצב תקין — אירוע נרשם רק כאשר מישהו מנסה פעולה שנחסמה."
                : "לא נמצאו אירועים מהסוג שנבחר."}
            </p>
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
                        ? "rgba(245,158,11,0.35)"
                        : "var(--color-border)",

                      background: "var(--color-secondary)",
                    }}
                  >
                    <span
                      className="text-xs font-semibold"
                      style={{
                        color: HIGH_SIGNAL_EVENTS.includes(event.event_type)
                          ? "#F59E0B"
                          : "var(--color-foreground)",
                      }}
                    >
                      {SECURITY_EVENT_LABEL[event.event_type]}
                    </span>
                    <span
                      className="text-[11px]"
                      style={{ color: "var(--color-muted-foreground)" }}
                    >
                      {nameOf(event.user_id)}
                      {product ? ` · ${product}` : ""}
                      {detail ? ` · ${detail}` : ""}
                    </span>
                    <span
                      className="text-[11px] mr-auto"
                      style={{ color: "var(--color-muted-foreground)" }}
                    >
                      {formatDate(event.created_at)}
                    </span>
                  </div>
                )
              })}
              {filteredEvents.length > 60 && (
                <p
                  className="text-[11px] text-center pt-2"
                  style={{ color: "var(--color-muted-foreground)" }}
                >
                  מוצגים 60 האירועים האחרונים מתוך {filteredEvents.length}.
                </p>
              )}
            </div>
          )}

          <p
            className="text-[11px] mt-4"
            style={{ color: "var(--color-muted-foreground)" }}
          >
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
    </div>
  )
}
