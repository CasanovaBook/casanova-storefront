/* ─────────────────────────────────────────────────────────────
 * CMS - platform settings.
 *
 * These values drive real behaviour elsewhere in the app: the
 * currency shown in the catalogue, the prefixes behind order and
 * invoice numbers, the upload ceiling, and above all whether the
 * system is allowed to claim that money moved. While no payment
 * provider is configured the refund execution switch stays off and
 * the CMS refuses to mark anything as refunded.
 *
 * The site-copy card holds the other half of that idea: the marketing
 * words a visitor reads on the landing page. Every field starts empty
 * and every field stays optional, so the platform never says anything
 * about the business that an editor did not write down first.
 * ───────────────────────────────────────────────────────────── */

import { useState } from "react"

import { useNavigate } from "react-router"

import { useCms } from "../../context/CmsContext"

import { useAdmin } from "../../context/AdminContext"

import { can } from "../../lib/permissions"

import { resetDatabase } from "../../data/db"

import type { PlatformSettings } from "../../types"

import AccessDenied from "../../components/AccessDenied"

import Alert from "../../components/ui/Alert"

import PageHeader from "../../components/ui/PageHeader"

import Icon, { type IconName } from "../../components/icons"

const CURRENCIES = ["ILS", "USD", "EUR", "GBP"]

const inputClass = "w-full px-4 py-2.5"

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

function Section({
  id,

  icon,

  title,

  description,

  children,
}: {
  id: string

  icon: IconName

  title: string

  description: string

  children: React.ReactNode
}) {
  return (
    <section className="app-surface" aria-labelledby={id}>
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
            <h2 id={id} className="app-section-title">
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

export default function AdminSettingsPage() {
  const { settings } = useCms()

  const { adminRole, updateSettings, recordAudit } = useAdmin()

  const navigate = useNavigate()

  const [form, setForm] = useState({
    brand_name: settings.brand_name,

    default_currency: settings.default_currency,

    invoice_prefix: settings.invoice_prefix,

    order_prefix: settings.order_prefix,

    inquiry_prefix: settings.inquiry_prefix,

    payment_provider: settings.payment_provider ?? "",

    email_provider: settings.email_provider ?? "",

    refund_execution_enabled: settings.refund_execution_enabled,

    max_upload_bytes: String(settings.max_upload_bytes),

    /* Site copy. trust_badges is a list, edited one entry per line - the
     * same convention the HERO block uses for a multi-line title, and the
     * same one the subscription product uses for its feature bullets. */

    tagline: settings.tagline ?? "",

    trust_badges: (settings.trust_badges ?? []).join("\n"),

    catalogue_title: settings.catalogue_title ?? "",

    catalogue_blurb: settings.catalogue_blurb ?? "",

    pricing_title: settings.pricing_title ?? "",

    pricing_blurb: settings.pricing_blurb ?? "",

    footer_text: settings.footer_text ?? "",

    /* Sales landing page copy. */

    sales_sticky_cta: settings.sales_sticky_cta ?? "",

    sales_exit_title: settings.sales_exit_title ?? "",

    sales_exit_body: settings.sales_exit_body ?? "",

    sales_exit_cta: settings.sales_exit_cta ?? "",
  })

  const [message, setMessage] = useState<{
    kind: "ok" | "error"
    text: string
  } | null>(null)

  const [confirmPhrase, setConfirmPhrase] = useState("")

  if (!can(adminRole, "settings")) return <AccessDenied page="הגדרות מערכת" />

  const noProvider = form.payment_provider.trim().length === 0

  const save = () => {
    const maxUpload = Number(form.max_upload_bytes)

    if (!form.brand_name.trim()) {
      setMessage({ kind: "error", text: "שם המותג חובה." })

      return
    }

    if (Number.isNaN(maxUpload) || maxUpload < 1024) {
      setMessage({
        kind: "error",
        text: "מגבלת ההעלאה חייבת להיות לפחות 1024 בתים.",
      })

      return
    }

    if (form.refund_execution_enabled && noProvider) {
      setMessage({
        kind: "error",

        text: "לא ניתן לאפשר ביצוע החזרים ללא הגדרת ספק תשלומים - המערכת לא תטען שהכסף הוחזר.",
      })

      return
    }

    const patch: Partial<PlatformSettings> = {
      brand_name: form.brand_name.trim(),

      default_currency: form.default_currency,

      invoice_prefix:
        form.invoice_prefix.trim().toUpperCase() || settings.invoice_prefix,

      order_prefix:
        form.order_prefix.trim().toUpperCase() || settings.order_prefix,

      inquiry_prefix:
        form.inquiry_prefix.trim().toUpperCase() || settings.inquiry_prefix,

      payment_provider: form.payment_provider.trim() || null,

      email_provider: form.email_provider.trim() || null,

      refund_execution_enabled: form.refund_execution_enabled,

      max_upload_bytes: Math.round(maxUpload),

      /* Written even when empty on purpose: clearing a field here has to
       * clear it on the page, not silently leave last month's copy up. */

      tagline: form.tagline.trim(),

      trust_badges: form.trust_badges

        .split("\n")

        .map((b) => b.trim())

        .filter(Boolean),

      catalogue_title: form.catalogue_title.trim(),

      catalogue_blurb: form.catalogue_blurb.trim(),

      pricing_title: form.pricing_title.trim(),

      pricing_blurb: form.pricing_blurb.trim(),

      footer_text: form.footer_text.trim(),

      sales_sticky_cta: form.sales_sticky_cta.trim(),

      sales_exit_title: form.sales_exit_title.trim(),

      sales_exit_body: form.sales_exit_body.trim(),

      sales_exit_cta: form.sales_exit_cta.trim(),
    }

    const result = updateSettings(patch)

    if (!result.ok) {
      setMessage({ kind: "error", text: result.error })

      return
    }

    setMessage({ kind: "ok", text: "ההגדרות נשמרו." })
  }

  const wipe = () => {
    if (confirmPhrase.trim() !== "מחיקה מלאה") {
      setMessage({ kind: "error", text: "יש להקליד ״מחיקה מלאה״ כדי לאשר." })

      return
    }

    recordAudit({
      category: "SETTINGS",

      action: "מחיקת כל נתוני הפלטפורמה",

      target_type: "SETTINGS",

      target_id: "platform",

      target_label: "איפוס מלא",

      details: "כל המוצרים, ההזמנות, הלקוחות והפניות נמחקו",
    })

    resetDatabase()

    navigate("/", { replace: true })
  }

  const saveButton = (
    <button type="button" onClick={save} className="app-btn">
      שמירת ההגדרות
    </button>
  )

  return (
    <div className="page-enter">
      <PageHeader
        eyebrow="ניהול פלטפורמה"
        title="הגדרות מערכת"
        description={
          <>
            הגדרות הפלטפורמה משפיעות על המטבע, מספור ההזמנות והחשבוניות,
            מגבלות ההעלאה ועל מה שהמערכת רשאית לדווח ככסף שהתקבל או הוחזר.
            {settings.updated_by && (
              <span className="block text-xs mt-1.5">
                עודכן לאחרונה על ידי {settings.updated_by} ·{" "}
                {new Date(settings.updated_at).toLocaleString("he-IL", {
                  day: "numeric",

                  month: "short",

                  year: "numeric",

                  hour: "2-digit",

                  minute: "2-digit",
                })}
              </span>
            )}
          </>
        }
        actions={saveButton}
      />

      {message && (
        <div className="mb-5">
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

      <h2 className="app-eyebrow">זהות ומספור</h2>

      <div className="space-y-5">
        <Section
          id="settings-brand"
          icon="sparkles"
          title="מותג ותפעול"
          description="שם המותג וקידומות המספור של המסמכים."
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="שם המותג">
              <input
                dir="ltr"
                className={inputClass}
                value={form.brand_name}
                onChange={(e) =>
                  setForm({ ...form, brand_name: e.target.value })
                }
              />
            </Field>
            <Field label="מטבע ברירת מחדל" hint="מוצר חדש נפתח עם המטבע הזה.">
              <select
                className={inputClass}
                value={form.default_currency}
                onChange={(e) =>
                  setForm({ ...form, default_currency: e.target.value })
                }
              >
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="קידומת מספר הזמנה">
              <input
                dir="ltr"
                className={inputClass}
                value={form.order_prefix}
                onChange={(e) =>
                  setForm({ ...form, order_prefix: e.target.value })
                }
              />
            </Field>
            <Field label="קידומת מספר חשבונית">
              <input
                dir="ltr"
                className={inputClass}
                value={form.invoice_prefix}
                onChange={(e) =>
                  setForm({ ...form, invoice_prefix: e.target.value })
                }
              />
            </Field>
            <Field label="קידומת מספר פנייה">
              <input
                dir="ltr"
                className={inputClass}
                value={form.inquiry_prefix}
                onChange={(e) =>
                  setForm({ ...form, inquiry_prefix: e.target.value })
                }
              />
            </Field>
            <Field
              label="מגבלת העלאת קובץ (בתים)"
              hint="קבצים גדולים יותר יש לאחסן בשרת הקבצים ולהדביק את הכתובת שלהם במוצר."
            >
              <input
                dir="ltr"
                type="number"
                min="1024"
                step="1024"
                className={inputClass}
                value={form.max_upload_bytes}
                onChange={(e) =>
                  setForm({ ...form, max_upload_bytes: e.target.value })
                }
              />
            </Field>
          </div>
        </Section>
      </div>

      <h2 className="app-eyebrow" style={{ marginTop: "2rem" }}>
        תוכן ושיווק
      </h2>

      <div className="space-y-5">
        <Section
          id="settings-site-copy"
          icon="sparkles"
          title="תוכן האתר"
          description="כל מילה המוצגת למבקר בדף הבית מגיעה מכאן או מבלוקי ה־CMS. שדה ריק אינו מציג טקסט חלופי: המבקר פשוט לא רואה את האזור, ומנהל רואה רמז במקומו."
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field
              label="סיסמת מותג"
              hint="השורה הקצרה בתוך התגית המוזהבת, מעל הכותרת הראשית."
            >
              <input
                className={inputClass}
                placeholder="ריק - התגית לא תוצג"
                value={form.tagline}
                onChange={(e) => setForm({ ...form, tagline: e.target.value })}
              />
            </Field>
            <Field
              label="הבטחות מתחת לכותרת"
              hint="הבטחה אחת בכל שורה. אל תכתבו כאן התחייבות - למשל אחריות או החזר כספי - שאינכם עומדים בה בפועל."
            >
              <textarea
                rows={3}
                className={inputClass}
                placeholder="ריק - שורת ההבטחות לא תוצג"
                value={form.trust_badges}
                onChange={(e) =>
                  setForm({ ...form, trust_badges: e.target.value })
                }
              />
            </Field>
            <Field label="כותרת הקטלוג">
              <input
                className={inputClass}
                placeholder="ריק - הכותרת לא תוצג"
                value={form.catalogue_title}
                onChange={(e) =>
                  setForm({ ...form, catalogue_title: e.target.value })
                }
              />
            </Field>
            <Field label="פתיח לקטלוג">
              <textarea
                rows={2}
                className={inputClass}
                placeholder="ריק - הפתיח לא יוצג"
                value={form.catalogue_blurb}
                onChange={(e) =>
                  setForm({ ...form, catalogue_blurb: e.target.value })
                }
              />
            </Field>
            <Field
              label="כותרת בלוק החבילות"
              hint="הבלוק כולו מוצג רק כשיש גם מוצר חבילה וגם מוצר מנוי במצב פורסם."
            >
              <input
                className={inputClass}
                placeholder="ריק - הכותרת לא תוצג"
                value={form.pricing_title}
                onChange={(e) =>
                  setForm({ ...form, pricing_title: e.target.value })
                }
              />
            </Field>
            <Field label="פתיח לבלוק החבילות">
              <textarea
                rows={2}
                className={inputClass}
                placeholder="ריק - הפתיח לא יוצג"
                value={form.pricing_blurb}
                onChange={(e) =>
                  setForm({ ...form, pricing_blurb: e.target.value })
                }
              />
            </Field>
            <div className="md:col-span-2">
              <Field
                label="שורת סיום בפוטר"
                hint="מוצגת מעל שורת זכויות היוצרים, בתחתית כל דף."
              >
                <textarea
                  rows={2}
                  className={inputClass}
                  placeholder="ריק - לא מוצגת"
                  value={form.footer_text}
                  onChange={(e) =>
                    setForm({ ...form, footer_text: e.target.value })
                  }
                />
              </Field>
            </div>
          </div>
        </Section>

        <Section
          id="settings-sales-copy"
          icon="target"
          title="דף מכירה - היא קודם"
          description="טקסטים שמופיעים בכפתור הדביק ובחלון הנטישה בדף הנחיתה הראשי. שדה ריק מציג את טקסט ברירת המחדל."
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field
              label="טקסט כפתור דביק (מובייל)"
              hint="מופיע בתחתית המסך בגלילה במובייל."
            >
              <input
                className={inputClass}
                placeholder="רכישה עכשיו - {price} ₪"
                value={form.sales_sticky_cta}
                onChange={(e) =>
                  setForm({ ...form, sales_sticky_cta: e.target.value })
                }
              />
            </Field>
            <Field label="כותרת חלון נטישה">
              <input
                className={inputClass}
                placeholder="רגע לפני שאתה הולך…"
                value={form.sales_exit_title}
                onChange={(e) =>
                  setForm({ ...form, sales_exit_title: e.target.value })
                }
              />
            </Field>
            <div className="md:col-span-2">
              <Field label="טקסט חלון נטישה">
                <textarea
                  rows={2}
                  className={inputClass}
                  placeholder="הטקסט שמופיע בגוף החלון"
                  value={form.sales_exit_body}
                  onChange={(e) =>
                    setForm({ ...form, sales_exit_body: e.target.value })
                  }
                />
              </Field>
            </div>
            <Field label="כפתור חלון נטישה">
              <input
                className={inputClass}
                placeholder="כן. אני רוצה את הספר"
                value={form.sales_exit_cta}
                onChange={(e) =>
                  setForm({ ...form, sales_exit_cta: e.target.value })
                }
              />
            </Field>
          </div>
        </Section>
      </div>

      <h2 className="app-eyebrow" style={{ marginTop: "2rem" }}>
        סליקה ותקשורת
      </h2>

      <div className="space-y-5">
        <Section
          id="settings-payment"
          icon="card"
          title="ספק תשלומים"
          description="כל עוד לא הוזנו פרטי ספק, ההזמנות נרשמות כממתינות לאישור ומנהל חייב לאשר כל תשלום ידנית."
        >
          <Field
            label="מזהה ספק התשלומים"
            hint="למשל stripe, paypal או cardcom. ריק פירושו שהגבייה מתבצעת מחוץ למערכת."
          >
            <input
              dir="ltr"
              className={inputClass}
              placeholder="לא מוגדר"
              value={form.payment_provider}
              onChange={(e) =>
                setForm({ ...form, payment_provider: e.target.value })
              }
            />
          </Field>
          {noProvider && (
            <div className="mt-4">
              <Alert tone="warning">
                לא מוגדר ספק תשלומים: הקופה יוצרת הזמנה בסטטוס ״ממתין לאישור״
                בלבד, ושום הזמנה אינה מסומנת כשולמה אוטומטית.
              </Alert>
            </div>
          )}
        </Section>

        <Section
          id="settings-refunds"
          icon="refresh"
          title="החזרים כספיים"
          description="ההחזר מסומן כמוחזר רק כאשר ספק התשלומים אישר זאת בפועל."
        >
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              className="mt-1"
              checked={form.refund_execution_enabled}
              onChange={(e) =>
                setForm({ ...form, refund_execution_enabled: e.target.checked })
              }
            />
            <span>
              <span className="text-sm font-medium">
                אפשר סימון החזר ככסף שהוחזר בפועל
              </span>
              <span className="block text-xs app-muted mt-0.5 leading-relaxed">
                כשהמתג כבוי, מנהלים יכולים לתעד, לאשר או לדחות בקשות החזר - אך
                המערכת מסרבת לסמן החזר כבוצע. זהו מצב ברירת המחדל עד לחיבור
                סליקה התומכת בהחזרים מתוכנתים.
              </span>
            </span>
          </label>
        </Section>

        <Section
          id="settings-email"
          icon="mail"
          title="ספק דואר אלקטרוני"
          description="מזהה הספק דרכו נשלחות הודעות אישור, חשבוניות ואיפוסי סיסמה."
        >
          <Field
            label="מזהה ספק הדואר"
            hint="ריק - ההודעות נרשמות ביומן המיילים בסטטוס ״בתור״ ואינן נמסרות."
          >
            <input
              dir="ltr"
              className={inputClass}
              placeholder="לא מוגדר"
              value={form.email_provider}
              onChange={(e) =>
                setForm({ ...form, email_provider: e.target.value })
              }
            />
          </Field>
        </Section>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 mt-6">
        <p className="text-xs app-muted">
          השינויים נשמרים רק לאחר לחיצה על ״שמירת ההגדרות״.
        </p>
        {saveButton}
      </div>

      <h2
        className="app-eyebrow"
        style={{ color: "var(--color-danger)", marginTop: "2.5rem" }}
      >
        אזור מסוכן
      </h2>

      <section
        aria-labelledby="settings-wipe"
        className="app-surface"
        style={{
          borderColor:
            "color-mix(in srgb, var(--color-danger) 45%, var(--color-border))",
        }}
      >
        <div
          className="app-surface-head"
          style={{
            background:
              "color-mix(in srgb, var(--color-danger) 6%, var(--color-card))",
          }}
        >
          <div className="flex items-center gap-3 min-w-0">
            <span
              className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
              style={{
                background:
                  "color-mix(in srgb, var(--color-danger) 12%, transparent)",
                color: "var(--color-danger)",
              }}
              aria-hidden="true"
            >
              <Icon name="shield" size={18} />
            </span>
            <div className="min-w-0">
              <h2
                id="settings-wipe"
                className="app-section-title"
                style={{ color: "var(--color-danger)" }}
              >
                מחיקת כל הנתונים
              </h2>
              <p className="text-xs app-muted mt-0.5">
                פעולה בלתי הפיכה - יש לייצא גיבוי לפני ביצוע.
              </p>
            </div>
          </div>
          <span className="app-badge app-badge--danger">לא ניתן לביטול</span>
        </div>

        <div className="app-surface-body">
          <p className="text-sm app-muted leading-relaxed">
            הפעולה מוחקת מוצרים, הזמנות, תשלומים, החזרים, לקוחות, הרשאות גישה,
            פניות ויומנים - ומחזירה את המערכת להתקנה ריקה לחלוטין. היא אינה
            הפיכה ואינה מבצעת גיבוי אוטומטי; יש לייצא גיבוי מ־CMS לפני כן.
          </p>

          <div className="app-field mt-5" style={{ maxWidth: "34rem" }}>
            <label className="app-label" htmlFor="settings-wipe-confirm">
              אישור מחיקה
            </label>
            <input
              id="settings-wipe-confirm"
              className="w-full"
              placeholder='הקלידו "מחיקה מלאה" לאישור'
              autoComplete="off"
              value={confirmPhrase}
              onChange={(e) => setConfirmPhrase(e.target.value)}
            />
            <p className="app-hint">
              הקלידו בדיוק את המילים ״מחיקה מלאה״ כדי שהכפתור יופעל.
            </p>
          </div>

          <div className="mt-4">
            <button
              type="button"
              onClick={wipe}
              disabled={confirmPhrase.trim() !== "מחיקה מלאה"}
              className="app-btn-danger"
            >
              <Icon name="x" size={15} />
              מחיקה לצמיתות
            </button>
          </div>
        </div>
      </section>
    </div>
  )
}
