/* ─────────────────────────────────────────────────────────────
 * CMS — platform settings.
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

import { resetDatabase } from "../../lib/db"

import type { PlatformSettings } from "../../types"

import AccessDenied from "../../components/AccessDenied"

import Icon, { type IconName } from "../../components/icons"

const inputStyle = {
  background: "var(--color-secondary)",

  borderColor: "var(--color-border)",

  color: "var(--color-foreground)",
} as const

const inputClass = "w-full px-4 py-2.5 rounded-lg border text-sm outline-none"

const CURRENCIES = ["ILS", "USD", "EUR", "GBP"]

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

    /* Site copy. trust_badges is a list, edited one entry per line — the
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

        text: "לא ניתן לאפשר ביצוע החזרים ללא הגדרת ספק תשלומים — המערכת לא תטען שהכסף הוחזר.",
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

  return (
    <div className="max-w-4xl mx-auto page-enter">
      <div className="mb-8">
        <h1 className="font-display text-4xl font-semibold mb-1">
          הגדרות מערכת
        </h1>
        <p style={{ color: "var(--color-muted-foreground)" }}>
          הגדרות הפלטפורמה משפיעות על המטבע, מספור ההזמנות והחשבוניות, מגבלות
          ההעלאה ועל מה שהמערכת רשאית לדווח ככסף שהתקבל או הוחזר.
        </p>
        {settings.updated_by && (
          <p
            className="text-xs mt-2"
            style={{ color: "var(--color-muted-foreground)" }}
          >
            עודכן לאחרונה על ידי {settings.updated_by} ·{" "}
            {new Date(settings.updated_at).toLocaleString("he-IL", {
              day: "numeric",

              month: "short",

              year: "numeric",

              hour: "2-digit",

              minute: "2-digit",
            })}
          </p>
        )}
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
          <button onClick={() => setMessage(null)}>
            <Icon name="x" size={13} />
          </button>
        </p>
      )}

      <div className="space-y-6">
        <Card
          icon="sparkles"
          title="מותג ותפעול"
          description="שם המותג וקידומות המספור של המסמכים."
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="שם המותג">
              <input
                dir="ltr"
                className={inputClass}
                style={inputStyle}
                value={form.brand_name}
                onChange={(e) =>
                  setForm({ ...form, brand_name: e.target.value })
                }
              />
            </Field>
            <Field label="מטבע ברירת מחדל" hint="מוצר חדש נפתח עם המטבע הזה.">
              <select
                className={inputClass}
                style={inputStyle}
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
                style={inputStyle}
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
                style={inputStyle}
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
                style={inputStyle}
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
                style={inputStyle}
                value={form.max_upload_bytes}
                onChange={(e) =>
                  setForm({ ...form, max_upload_bytes: e.target.value })
                }
              />
            </Field>
          </div>
        </Card>

        <Card
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
                style={inputStyle}
                placeholder="ריק — התגית לא תוצג"
                value={form.tagline}
                onChange={(e) => setForm({ ...form, tagline: e.target.value })}
              />
            </Field>
            <Field
              label="הבטחות מתחת לכותרת"
              hint="הבטחה אחת בכל שורה. אל תכתבו כאן התחייבות — למשל אחריות או החזר כספי — שאינכם עומדים בה בפועל."
            >
              <textarea
                rows={3}
                className={inputClass}
                style={inputStyle}
                placeholder="ריק — שורת ההבטחות לא תוצג"
                value={form.trust_badges}
                onChange={(e) =>
                  setForm({ ...form, trust_badges: e.target.value })
                }
              />
            </Field>
            <Field label="כותרת הקטלוג">
              <input
                className={inputClass}
                style={inputStyle}
                placeholder="ריק — הכותרת לא תוצג"
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
                style={inputStyle}
                placeholder="ריק — הפתיח לא יוצג"
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
                style={inputStyle}
                placeholder="ריק — הכותרת לא תוצג"
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
                style={inputStyle}
                placeholder="ריק — הפתיח לא יוצג"
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
                  style={inputStyle}
                  placeholder="ריק — לא מוצגת"
                  value={form.footer_text}
                  onChange={(e) =>
                    setForm({ ...form, footer_text: e.target.value })
                  }
                />
              </Field>
            </div>
          </div>
        </Card>

        <Card
          icon="sparkles"
          title="דף מכירה — היא קודם"
          description="טקסטים שמופיעים בכפתור הדביק ובחלון הנטישה בדף הנחיתה הראשי. שדה ריק מציג את טקסט ברירת המחדל."
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field
              label="טקסט כפתור דביק (מובייל)"
              hint="מופיע בתחתית המסך בגלילה במובייל."
            >
              <input
                className={inputClass}
                style={inputStyle}
                placeholder="רכישה עכשיו — 89 ₪"
                value={form.sales_sticky_cta}
                onChange={(e) =>
                  setForm({ ...form, sales_sticky_cta: e.target.value })
                }
              />
            </Field>
            <Field label="כותרת חלון נטישה">
              <input
                className={inputClass}
                style={inputStyle}
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
                  style={inputStyle}
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
                style={inputStyle}
                placeholder="כן. אני רוצה את הספר"
                value={form.sales_exit_cta}
                onChange={(e) =>
                  setForm({ ...form, sales_exit_cta: e.target.value })
                }
              />
            </Field>
          </div>
        </Card>

        <Card
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
              style={inputStyle}
              placeholder="לא מוגדר"
              value={form.payment_provider}
              onChange={(e) =>
                setForm({ ...form, payment_provider: e.target.value })
              }
            />
          </Field>
          {noProvider && (
            <p
              className="text-xs mt-3 px-3 py-2 rounded-lg"
              style={{ background: "rgba(245,158,11,0.1)", color: "#F59E0B" }}
            >
              לא מוגדר ספק תשלומים: הקופה יוצרת הזמנה בסטטוס ״ממתין לאישור״
              בלבד, ושום הזמנה אינה מסומנת כשולמה אוטומטית.
            </p>
          )}
        </Card>

        <Card
          icon="refresh"
          title="החזרים כספיים"
          description="ההחזר מסומן כמוחזר רק כאשר ספק התשלומים אישר זאת בפועל."
        >
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={form.refund_execution_enabled}
              onChange={(e) =>
                setForm({ ...form, refund_execution_enabled: e.target.checked })
              }
            />
            <span>
              <span className="text-sm font-medium">
                אפשר סימון החזר ככסף שהוחזר בפועל
              </span>
              <span
                className="block text-xs mt-0.5"
                style={{ color: "var(--color-muted-foreground)" }}
              >
                כשהמתג כבוי, מנהלים יכולים לתעד, לאשר או לדחות בקשות החזר — אך
                המערכת מסרבת לסמן החזר כבוצע. זהו מצב ברירת המחדל עד לחיבור
                סליקה התומכת בהחזרים מתוכנתים.
              </span>
            </span>
          </label>
        </Card>

        <Card
          icon="mail"
          title="ספק דואר אלקטרוני"
          description="מזהה הספק דרכו נשלחות הודעות אישור, חשבוניות ואיפוסי סיסמה."
        >
          <Field
            label="מזהה ספק הדואר"
            hint="ריק — ההודעות נרשמות ביומן המיילים בסטטוס ״בתור״ ואינן נמסרות."
          >
            <input
              dir="ltr"
              className={inputClass}
              style={inputStyle}
              placeholder="לא מוגדר"
              value={form.email_provider}
              onChange={(e) =>
                setForm({ ...form, email_provider: e.target.value })
              }
            />
          </Field>
        </Card>

        <div className="flex justify-end">
          <button
            onClick={save}
            className="btn-gradient px-8 py-2.5 rounded-full font-semibold text-sm"
          >
            שמירת ההגדרות
          </button>
        </div>

        <div
          className="rounded-lg border p-6"
          style={{
            borderColor: "rgba(239,68,68,0.35)",
            background: "rgba(239,68,68,0.04)",
          }}
        >
          <div className="flex items-center gap-3 mb-1">
            <span style={{ color: "var(--color-danger)" }}>
              <Icon name="shield" size={17} />
            </span>
            <h2
              className="font-display text-lg font-semibold"
              style={{ color: "var(--color-danger)" }}
            >
              מחיקת כל הנתונים
            </h2>
          </div>
          <p
            className="text-xs mb-4"
            style={{ color: "var(--color-muted-foreground)" }}
          >
            הפעולה מוחקת מוצרים, הזמנות, תשלומים, החזרים, לקוחות, הרשאות גישה,
            פניות ויומנים — ומחזירה את המערכת להתקנה ריקה לחלוטין. היא אינה
            הפיכה ואינה מבצעת גיבוי אוטומטי; יש לייצא גיבוי מ־CMS לפני כן.
          </p>
          <div className="flex gap-2 flex-wrap items-center">
            <input
              className="px-4 py-2.5 rounded-lg border text-sm outline-none min-w-56"
              style={inputStyle}
              placeholder='הקלידו "מחיקה מלאה" לאישור'
              value={confirmPhrase}
              onChange={(e) => setConfirmPhrase(e.target.value)}
            />
            <button
              onClick={wipe}
              disabled={confirmPhrase.trim() !== "מחיקה מלאה"}
              className="px-5 py-2.5 rounded-full border text-sm font-semibold disabled:opacity-40"
              style={{
                borderColor: "rgba(239,68,68,0.5)",
                color: "var(--color-danger)",
              }}
            >
              מחיקה לצמיתות
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
