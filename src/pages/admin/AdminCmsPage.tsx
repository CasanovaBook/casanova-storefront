import { useRef, useState } from "react"

import { useCms } from "../../context/CmsContext"

import { useAdmin } from "../../context/AdminContext"

import { can } from "../../lib/permissions"

import type {
  Coupon,
  CmsSection,
  CmsSectionItem,
  FaqItem,
  SectionType,
  Testimonial,
} from "../../types"

import { detectPlatform, toEmbedUrl, PLATFORM_LABEL } from "../../lib/media"

import AccessDenied from "../../components/AccessDenied"

import Icon, { type IconName } from "../../components/icons"

const TYPE_META: Record<SectionType, { label: string, icon: IconName }> = {
  HERO: { label: "פתיח ראשי (Hero)", icon: "zap" },

  TEXT: { label: "מקטע טקסט", icon: "pen" },

  VIDEO: { label: "וידאו / צפייה חיה", icon: "video" },

  GALLERY: { label: "גלריה", icon: "grid" },

  PRODUCTS: { label: "שורת מוצרים", icon: "book" },

  TESTIMONIALS: { label: "המלצות", icon: "message" },

  FAQ: { label: "שאלות נפוצות", icon: "list" },

  CTA: { label: "קריאה לפעולה (סיום)", icon: "sparkles" },

  FEATURES: { label: "רשימת תכונות", icon: "checkCircle" },

  STEPS: { label: "שלבי תהליך", icon: "list" },

  AUDIENCE: { label: "קהל יעד", icon: "users" },

  OFFER: { label: "בלוק הצעה (מחיר)", icon: "tag" },

  GUARANTEE: { label: "אחריות / ערבות", icon: "shield" },
}

/**
 * One line under the type selector saying what the type really does on the
 * page. No-code editing only works if the editor can predict the result
 * without opening the site to check.
 */

const TYPE_HINT: Record<SectionType, string> = {
  HERO: "כותרת הפתיחה והמשפט הראשון באתר. מוצג פעם אחת, בראש הדף.",

  TEXT: "פסקת תוכן חופשית. אפשר להוסיף כמה שרוצים — הסדר באתר נקבע לפי מיקום הסקטור ברשימה.",

  VIDEO: "נגן מוטמע מ־YouTube / Vimeo. ללא קישור תקין הסקטור לא יוצג באתר.",

  GALLERY:
    "רשת תמונות. התמונות נשמרות כרשימה מסודרת ומוצגות לפי הסדר שקובעים כאן.",

  PRODUCTS:
    "שורת כרטיסי מוצר מתוך הקטלוג המפורסם. הכותרת והתיאור נערכים כאן; המוצרים עצמם בלשונית ״מוצרים״.",

  TESTIMONIALS:
    "מפעיל את בלוק ההמלצות וקובע את כותרתו. ההמלצות עצמן נערכות בלשונית ״המלצות״.",

  FAQ: "מפעיל את בלוק השאלות הנפוצות וקובע את כותרתו. השאלות נערכות בלשונית ״שאלות נפוצות״.",

  CTA: "בלוק הסיום עם הכפתור לרכישה. אם אין סקטור כזה פעיל, לא יוצג בלוק סיום באתר.",

  FEATURES: "רשימת תכונות עם כותרת ותיאור קצר לכל פריט. מוצגת כרשת אייקונים.",

  STEPS: "שלבי תהליך ממוספרים. כל פריט הוא צעד עם כותרת והסבר קצר.",

  AUDIENCE: "רשימת קהלי יעד. פריטים ראשיים (למי זה) ומשניים (למי לא).",

  OFFER: "בלוק הצעה עם מחיר ובונוסים. מוצג עם כפתור רכישה.",

  GUARANTEE: "בלוק אחריות או ערבות. טקסט חופשי שמרגיע את הרוכש.",
}

const inputStyle = {
  background: "var(--color-secondary)",

  borderColor: "var(--color-border)",

  color: "var(--color-foreground)",
} as const

function Field({
  label,
  children,
}: {
  label: string
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
    </div>
  )
}

function ModalShell({
  title,

  onClose,

  children,
}: {
  title: string

  onClose: () => void

  children: React.ReactNode
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.7)" }}
    >
      <div className="card-glow w-full max-w-xl p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-display text-xl font-semibold">{title}</h2>
          <button
            onClick={onClose}
            style={{ color: "var(--color-muted-foreground)" }}
          >
            <Icon name="x" size={16} />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

/** Embedded player preview for YouTube/Vimeo links. */

function MediaPreview({ url }: { url: string }) {
  const embed = toEmbedUrl(url)

  const platform = detectPlatform(url)

  if (embed) {
    return (
      <div
        className="rounded-lg overflow-hidden border"
        style={{ borderColor: "var(--color-border)" }}
      >
        <div
          className="flex items-center gap-2 px-3 py-2 text-xs"
          style={{
            background: "var(--color-secondary)",
            color: "var(--color-muted-foreground)",
          }}
        >
          <Icon name="video" size={13} />
          תצוגה חיה — {PLATFORM_LABEL[platform]}
        </div>
        <iframe
          src={embed}
          title="תצוגת וידאו"
          className="w-full aspect-video block"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          style={{ border: 0 }}
        />
      </div>
    )
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      dir="ltr"
      className="flex items-center gap-2 px-3 py-2 rounded-lg border text-xs break-all"
      style={{
        borderColor: "var(--color-border)",
        color: "var(--color-primary)",
      }}
    >
      <Icon name="external" size={13} className="flex-shrink-0" />
      {url}
    </a>
  )
}

/* ── Sections tab ───────────────────────────────────────────── */

function SectionModal({
  section,

  onClose,
}: {
  section: CmsSection | null

  onClose: () => void
}) {
  const { saveSection } = useCms()

  const [form, setForm] = useState({
    type: (section?.type ?? "TEXT") as SectionType,

    page: (section?.page ?? "HOME") as "HOME" | "SALES",

    title: section?.title ?? "",

    content: section?.content ?? "",

    media_url: section?.media_url ?? "",

    media_urls: section?.media_urls ?? [],

    active: section?.active ?? true,

    items: (section?.items ?? []) as CmsSectionItem[],
  })

  const canSave = form.title.trim().length > 0

  /* A gallery is an ordered list, so blank rows are kept rather than
   * dropped: an editor mid-typing must not watch the field they are
   * filling in disappear. Blanks are filtered out on save. */

  const setImage = (index: number, value: string) =>
    setForm((f) => ({
      ...f,
      media_urls: f.media_urls.map((u, i) => (i === index ? value : u)),
    }))

  const addImage = () =>
    setForm((f) => ({ ...f, media_urls: [...f.media_urls, ""] }))

  const removeImage = (index: number) =>
    setForm((f) => ({
      ...f,
      media_urls: f.media_urls.filter((_, i) => i !== index),
    }))

  const moveImage = (index: number, dir: -1 | 1) =>
    setForm((f) => {
      const target = index + dir

      if (target < 0 || target >= f.media_urls.length) return f

      const next = [...f.media_urls]

      ;[next[index], next[target]] = [next[target], next[index]]

      return { ...f, media_urls: next }
    })

  const galleryImages = form.media_urls.map((u) => u.trim()).filter(Boolean)

  const isGallery = form.type === "GALLERY"

  const hasItems = ["FEATURES", "STEPS", "AUDIENCE", "OFFER"].includes(
    form.type,
  )

  return (
    <ModalShell title={section ? "עריכת סקטור" : "סקטור חדש"} onClose={onClose}>
      <div className="space-y-4">
        <Field label="סוג הסקטור">
          <select
            className="w-full px-4 py-2.5 rounded-lg border text-sm outline-none"
            style={inputStyle}
            value={form.type}
            onChange={(e) =>
              setForm({ ...form, type: e.target.value as SectionType })
            }
          >
            {(Object.keys(TYPE_META) as SectionType[]).map((t) => (
              <option key={t} value={t}>
                {TYPE_META[t].label}
              </option>
            ))}
          </select>
        </Field>
        <p
          className="text-xs -mt-2"
          style={{ color: "var(--color-muted-foreground)" }}
        >
          {TYPE_HINT[form.type]}
        </p>
        <Field label="דף יעד">
          <select
            className="w-full px-4 py-2.5 rounded-lg border text-sm outline-none"
            style={inputStyle}
            value={form.page}
            onChange={(e) =>
              setForm({ ...form, page: e.target.value as "HOME" | "SALES" })
            }
          >
            <option value="HOME">דף הבית (/)</option>
            <option value="SALES">דף מכירה — היא קודם (/)</option>
          </select>
        </Field>
        <Field label="כותרת הסקטור">
          <input
            className="w-full px-4 py-2.5 rounded-lg border text-sm outline-none"
            style={inputStyle}
            value={form.title}
            placeholder="לדוגמה: רבי־המכר שלנו"
            onChange={(e) => setForm({ ...form, title: e.target.value })}
          />
        </Field>
        <Field
          label={
            isGallery
              ? "תיאור קצר מתחת לכותרת הגלריה — אופציונלי"
              : "תוכן / הוראת תצוגה"
          }
        >
          <textarea
            rows={3}
            className="w-full px-4 py-2.5 rounded-lg border text-sm outline-none resize-none"
            style={inputStyle}
            value={form.content}
            onChange={(e) => setForm({ ...form, content: e.target.value })}
          />
        </Field>

        {hasItems && (
          <Field label={`פריטים (${form.items.length})`}>
            <div className="space-y-2">
              {form.items.map((item, idx) => (
                <div key={item.item_id} className="flex items-start gap-2">
                  <span
                    className="text-xs font-mono w-4 text-center flex-shrink-0 mt-2.5"
                    style={{ color: "var(--color-muted-foreground)" }}
                  >
                    {idx + 1}
                  </span>
                  <div className="flex-1 space-y-1.5">
                    <input
                      className="w-full px-3 py-2 rounded-lg border text-sm outline-none"
                      style={inputStyle}
                      placeholder="כותרת"
                      value={item.title}
                      onChange={(e) => {
                        const items = [...form.items]

                        items[idx] = { ...items[idx], title: e.target.value }

                        setForm({ ...form, items })
                      }}
                    />
                    <input
                      className="w-full px-3 py-2 rounded-lg border text-xs outline-none"
                      style={inputStyle}
                      placeholder="תיאור (אופציונלי)"
                      value={item.content}
                      onChange={(e) => {
                        const items = [...form.items]

                        items[idx] = { ...items[idx], content: e.target.value }

                        setForm({ ...form, items })
                      }}
                    />
                    {form.type === "AUDIENCE" && (
                      <select
                        className="w-full px-3 py-1.5 rounded-lg border text-xs outline-none"
                        style={inputStyle}
                        value={item.group ?? "PRIMARY"}
                        onChange={(e) => {
                          const items = [...form.items]

                          items[idx] = {
                            ...items[idx],
                            group: e.target.value as "PRIMARY" | "SECONDARY",
                          }

                          setForm({ ...form, items })
                        }}
                      >
                        <option value="PRIMARY">ראשי (למי זה)</option>
                        <option value="SECONDARY">משני (למי לא)</option>
                      </select>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setForm({
                        ...form,
                        items: form.items.filter((_, i) => i !== idx),
                      })
                    }
                    aria-label="הסרת פריט"
                    className="tap-target w-8 h-8 flex items-center justify-center rounded-lg border flex-shrink-0 mt-1 transition-colors hover:bg-white/5"
                    style={{
                      borderColor: "var(--color-border)",
                      color: "var(--color-danger)",
                    }}
                  >
                    <Icon name="x" size={13} />
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() =>
                  setForm({
                    ...form,

                    items: [
                      ...form.items,

                      {
                        item_id: `it_${Date.now()}`,
                        title: "",
                        content: "",
                        group: form.type === "AUDIENCE" ? "PRIMARY" : undefined,
                      },
                    ],
                  })
                }
                className="text-xs font-medium px-3 py-1.5 rounded-full border transition-colors hover:bg-white/5"
                style={{
                  borderColor: "var(--color-border)",
                  color: "var(--color-foreground)",
                }}
              >
                + הוספת פריט
              </button>
            </div>
          </Field>
        )}

        {isGallery ? (
          <Field label={`תמונות הגלריה · ${galleryImages.length} בסדר התצוגה`}>
            <div className="space-y-2">
              {form.media_urls.length === 0 && (
                <p
                  className="text-xs"
                  style={{ color: "var(--color-muted-foreground)" }}
                >
                  אין תמונות עדיין. הגלריה לא תוצג באתר עד שיווסף לפחות קישור
                  אחד.
                </p>
              )}
              {form.media_urls.map((url, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span
                    className="text-xs font-mono w-4 text-center flex-shrink-0"
                    style={{ color: "var(--color-muted-foreground)" }}
                  >
                    {i + 1}
                  </span>
                  {url.trim() ? (
                    <img
                      src={url.trim()}
                      alt=""
                      className="w-9 h-9 rounded-md object-cover flex-shrink-0 border"
                      style={{ borderColor: "var(--color-border)" }}
                    />
                  ) : (
                    <div
                      className="w-9 h-9 rounded-md flex-shrink-0 border flex items-center justify-center"
                      style={{
                        borderColor: "var(--color-border)",
                        color: "var(--color-muted-foreground)",
                      }}
                    >
                      <Icon name="upload" size={13} />
                    </div>
                  )}
                  <input
                    dir="ltr"
                    value={url}
                    placeholder="https://…"
                    onChange={(e) => setImage(i, e.target.value)}
                    className="flex-1 min-w-0 px-3 py-2 rounded-lg border text-xs outline-none"
                    style={inputStyle}
                  />
                  <div className="flex flex-col flex-shrink-0">
                    <button
                      type="button"
                      onClick={() => moveImage(i, -1)}
                      disabled={i === 0}
                      aria-label="הזזה למעלה"
                      className="tap-target text-[10px] leading-none px-1.5 py-1 disabled:opacity-25"
                      style={{ color: "var(--color-muted-foreground)" }}
                    >
                      ▲
                    </button>
                    <button
                      type="button"
                      onClick={() => moveImage(i, 1)}
                      disabled={i === form.media_urls.length - 1}
                      aria-label="הזזה למטה"
                      className="tap-target text-[10px] leading-none px-1.5 py-1 disabled:opacity-25"
                      style={{ color: "var(--color-muted-foreground)" }}
                    >
                      ▼
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeImage(i)}
                    aria-label="הסרת תמונה"
                    className="tap-target w-9 h-9 flex items-center justify-center rounded-lg border flex-shrink-0 transition-colors hover:bg-white/5"
                    style={{
                      borderColor: "var(--color-border)",
                      color: "var(--color-danger)",
                    }}
                  >
                    <Icon name="x" size={13} />
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={addImage}
                className="tap-target text-xs font-medium px-3 py-1.5 rounded-full border transition-colors hover:bg-white/5"
                style={{
                  borderColor: "var(--color-border)",
                  color: "var(--color-foreground)",
                }}
              >
                + הוספת תמונה
              </button>
            </div>
          </Field>
        ) : (
          <>
            <Field
              label={
                form.type === "VIDEO"
                  ? "קישור לצפייה חיה (YouTube / Vimeo / פלטפורמות אחרות)"
                  : "קישור לתמונה או לוידאו — אופציונלי"
              }
            >
              <input
                dir="ltr"
                className="w-full px-4 py-2.5 rounded-lg border text-sm outline-none"
                style={inputStyle}
                value={form.media_url}
                placeholder="https://www.youtube.com/watch?v=..."
                onChange={(e) =>
                  setForm({ ...form, media_url: e.target.value })
                }
              />
            </Field>
            {form.media_url.trim() && (
              <MediaPreview url={form.media_url.trim()} />
            )}
          </>
        )}
        <label className="flex items-center gap-2.5 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={form.active}
            onChange={(e) => setForm({ ...form, active: e.target.checked })}
            className="accent-[#E3AE3C] w-4 h-4"
          />
          <span className="text-sm">הסקטור פעיל ומוצג באתר</span>
        </label>
      </div>
      <div className="flex gap-3 mt-6">
        <button
          disabled={!canSave}
          onClick={() => {
            saveSection(
              {
                type: form.type,

                page: form.page,

                title: form.title,

                content: form.content,

                /* A gallery keeps its assets in the media_urls list; leaving
                 * the single field set would let a stale video link survive a
                 * type change and show up nowhere. */

                media_url: isGallery
                  ? undefined
                  : form.media_url.trim() || undefined,

                media_urls:
                  isGallery && galleryImages.length > 0
                    ? galleryImages
                    : undefined,

                items:
                  hasItems && form.items.length > 0
                    ? form.items.filter((it) => it.title.trim())
                    : undefined,

                active: form.active,
              },

              section?.section_id,
            )

            onClose()
          }}
          className="btn-gradient flex-1 py-2.5 rounded-full font-semibold text-sm disabled:opacity-40"
        >
          {section ? "שמירת שינויים" : "הוספת סקטור"}
        </button>
        <button
          onClick={onClose}
          className="px-5 py-2.5 rounded-full border text-sm transition-colors hover:bg-white/5"
          style={{
            borderColor: "var(--color-border)",
            color: "var(--color-foreground)",
          }}
        >
          ביטול
        </button>
      </div>
    </ModalShell>
  )
}

function SectionsTab({ showToast }: { showToast: (msg: string) => void }) {
  const { sections, deleteSection, toggleSection, moveSection } = useCms()

  const [modal, setModal] = useState<{
    open: boolean
    section: CmsSection | null
  }>({ open: false, section: null })

  const [previewId, setPreviewId] = useState<string | null>(null)

  const sorted = [...sections].sort((a, b) => a.display_order - b.display_order)

  return (
    <>
      <div className="space-y-4">
        {sorted.map((section, idx) => {
          const meta = TYPE_META[section.type]

          return (
            <div
              key={section.section_id}
              className="rounded-lg border p-5"
              style={{
                background: "var(--color-card)",

                borderColor: section.active
                  ? "var(--color-border)"
                  : "rgba(107,114,128,0.3)",

                opacity: section.active ? 1 : 0.65,
              }}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3 min-w-0">
                  <span
                    className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
                    style={{
                      background: "rgba(227,174,60,0.12)",
                      color: "var(--color-primary)",
                    }}
                  >
                    <Icon name={meta.icon} size={17} />
                  </span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-medium">{section.title}</p>
                      <span
                        className="text-xs px-2 py-0.5 rounded-full"
                        style={{
                          background: section.active
                            ? "rgba(34,197,94,0.1)"
                            : "rgba(107,114,128,0.15)",

                          color: section.active
                            ? "var(--color-success)"
                            : "#9CA3AF",
                        }}
                      >
                        {section.active ? "פעיל" : "כבוי"}
                      </span>
                      <span
                        className="text-xs"
                        style={{ color: "var(--color-muted-foreground)" }}
                      >
                        {meta.label}
                      </span>
                      {section.page === "SALES" && (
                        <span
                          className="text-xs px-2 py-0.5 rounded-full"
                          style={{
                            background: "rgba(227,174,60,0.12)",
                            color: "var(--color-primary)",
                          }}
                        >
                          מכירה
                        </span>
                      )}
                    </div>
                    <p
                      className="text-sm mt-1 line-clamp-2"
                      style={{ color: "var(--color-muted-foreground)" }}
                    >
                      {section.content}
                    </p>
                    {section.media_url && (
                      <button
                        onClick={() =>
                          setPreviewId(
                            previewId === section.section_id
                              ? null
                              : section.section_id,
                          )
                        }
                        className="flex items-center gap-1.5 mt-2 text-xs transition-opacity hover:opacity-75"
                        style={{ color: "var(--color-primary)" }}
                      >
                        <Icon name="video" size={13} />
                        {detectPlatform(section.media_url) !== "WEB"
                          ? `תצוגה חיה — ${PLATFORM_LABEL[detectPlatform(section.media_url)]}`
                          : "קישור חיצוני"}
                        <Icon
                          name={
                            previewId === section.section_id
                              ? "chevronDown"
                              : "eye"
                          }
                          size={12}
                        />
                      </button>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <div className="flex flex-col gap-1">
                    <button
                      onClick={() => moveSection(section.section_id, -1)}
                      disabled={idx === 0}
                      className="w-6 h-6 rounded flex items-center justify-center transition-colors hover:bg-white/5 disabled:opacity-25"
                      style={{ color: "var(--color-muted-foreground)" }}
                      title="הזזה למעלה"
                    >
                      <Icon
                        name="chevronDown"
                        size={13}
                        style={{ transform: "rotate(180deg)" }}
                      />
                    </button>
                    <button
                      onClick={() => moveSection(section.section_id, 1)}
                      disabled={idx === sorted.length - 1}
                      className="w-6 h-6 rounded flex items-center justify-center transition-colors hover:bg-white/5 disabled:opacity-25"
                      style={{ color: "var(--color-muted-foreground)" }}
                      title="הזזה למטה"
                    >
                      <Icon name="chevronDown" size={13} />
                    </button>
                  </div>
                  <button
                    onClick={() => toggleSection(section.section_id)}
                    className="text-xs px-3 py-1.5 rounded-full border transition-colors hover:bg-white/5"
                    style={{
                      borderColor: section.active
                        ? "var(--color-border)"
                        : "rgba(34,197,94,0.3)",

                      color: section.active
                        ? "var(--color-foreground)"
                        : "var(--color-success)",
                    }}
                  >
                    {section.active ? "כיבוי" : "הפעלה"}
                  </button>
                  <button
                    onClick={() => setModal({ open: true, section })}
                    className="text-xs px-3 py-1.5 rounded-full border transition-colors hover:bg-white/5"
                    style={{
                      borderColor: "var(--color-border)",
                      color: "var(--color-foreground)",
                    }}
                  >
                    עריכה
                  </button>
                  <button
                    onClick={() => {
                      deleteSection(section.section_id)

                      showToast("הסקטור הוסר")
                    }}
                    className="text-xs px-3 py-1.5 rounded-full border transition-colors hover:bg-red-500/10"
                    style={{
                      borderColor: "rgba(239,68,68,0.3)",
                      color: "var(--color-danger)",
                    }}
                  >
                    מחיקה
                  </button>
                </div>
              </div>

              {previewId === section.section_id && section.media_url && (
                <div className="mt-4">
                  <MediaPreview url={section.media_url} />
                </div>
              )}
            </div>
          )
        })}
      </div>

      {modal.open && (
        <SectionModal
          section={modal.section}
          onClose={() => setModal({ open: false, section: null })}
        />
      )}

      <button
        onClick={() => setModal({ open: true, section: null })}
        className="btn-gradient mt-6 px-5 py-2.5 rounded-full font-semibold text-sm"
      >
        + סקטור חדש
      </button>
    </>
  )
}

/* ── Testimonials tab ───────────────────────────────────────── */

function TestimonialModal({
  testimonial,
  onClose,
}: {
  testimonial: Testimonial | null
  onClose: () => void
}) {
  const { saveTestimonial } = useCms()

  const [form, setForm] = useState({
    quote: testimonial?.quote ?? "",

    name: testimonial?.name ?? "",

    title: testimonial?.title ?? "",

    avatar: testimonial?.avatar ?? "",

    active: testimonial?.active ?? true,
  })

  const canSave = form.quote.trim() && form.name.trim()

  return (
    <ModalShell
      title={testimonial ? "עריכת המלצה" : "המלצה חדשה"}
      onClose={onClose}
    >
      <div className="space-y-4">
        <Field label="ציטוט">
          <textarea
            rows={3}
            className="w-full px-4 py-2.5 rounded-lg border text-sm outline-none resize-none"
            style={inputStyle}
            value={form.quote}
            onChange={(e) => setForm({ ...form, quote: e.target.value })}
          />
        </Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="שם">
            <input
              className="w-full px-4 py-2.5 rounded-lg border text-sm outline-none"
              style={inputStyle}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </Field>
          <Field label="תפקיד">
            <input
              className="w-full px-4 py-2.5 rounded-lg border text-sm outline-none"
              style={inputStyle}
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
          </Field>
          <Field label="אות אווטאר">
            <input
              className="w-full px-4 py-2.5 rounded-lg border text-sm outline-none"
              style={inputStyle}
              maxLength={1}
              value={form.avatar}
              onChange={(e) => setForm({ ...form, avatar: e.target.value })}
            />
          </Field>
        </div>
        <label className="flex items-center gap-2.5 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={form.active}
            onChange={(e) => setForm({ ...form, active: e.target.checked })}
            className="accent-[#E3AE3C] w-4 h-4"
          />
          <span className="text-sm">מוצגת באתר</span>
        </label>
      </div>
      <div className="flex gap-3 mt-6">
        <button
          disabled={!canSave}
          onClick={() => {
            saveTestimonial(form, testimonial?.testimonial_id)

            onClose()
          }}
          className="btn-gradient flex-1 py-2.5 rounded-full font-semibold text-sm disabled:opacity-40"
        >
          שמירה
        </button>
        <button
          onClick={onClose}
          className="px-5 py-2.5 rounded-full border text-sm hover:bg-white/5"
          style={{
            borderColor: "var(--color-border)",
            color: "var(--color-foreground)",
          }}
        >
          ביטול
        </button>
      </div>
    </ModalShell>
  )
}

function TestimonialsTab({ showToast }: { showToast: (msg: string) => void }) {
  const { testimonials, deleteTestimonial } = useCms()

  const [modal, setModal] = useState<{
    open: boolean
    item: Testimonial | null
  }>({ open: false, item: null })

  const sorted = [...testimonials].sort(
    (a, b) => a.display_order - b.display_order,
  )

  return (
    <>
      <div className="space-y-4">
        {sorted.map((t) => (
          <div
            key={t.testimonial_id}
            className="rounded-lg border p-5 flex items-start justify-between gap-4"
            style={{
              background: "var(--color-card)",
              borderColor: "var(--color-border)",
              opacity: t.active ? 1 : 0.65,
            }}
          >
            <div className="flex gap-3 min-w-0">
              <span
                className="w-9 h-9 rounded-full flex items-center justify-center font-bold flex-shrink-0"
                style={{
                  background: "rgba(227,174,60,0.12)",
                  color: "var(--color-primary)",
                }}
              >
                {t.avatar}
              </span>
              <div className="min-w-0">
                <p className="text-sm leading-relaxed">{t.quote}</p>
                <p
                  className="text-xs mt-2"
                  style={{ color: "var(--color-muted-foreground)" }}
                >
                  {t.name} · {t.title} {!t.active && "· מוסתרת"}
                </p>
              </div>
            </div>
            <div className="flex gap-2 flex-shrink-0">
              <button
                onClick={() => setModal({ open: true, item: t })}
                className="text-xs px-3 py-1.5 rounded-full border hover:bg-white/5"
                style={{
                  borderColor: "var(--color-border)",
                  color: "var(--color-foreground)",
                }}
              >
                עריכה
              </button>
              <button
                onClick={() => {
                  deleteTestimonial(t.testimonial_id)
                  showToast("ההמלצה הוסרה")
                }}
                className="text-xs px-3 py-1.5 rounded-full border hover:bg-red-500/10"
                style={{
                  borderColor: "rgba(239,68,68,0.3)",
                  color: "var(--color-danger)",
                }}
              >
                מחיקה
              </button>
            </div>
          </div>
        ))}
      </div>
      {modal.open && (
        <TestimonialModal
          testimonial={modal.item}
          onClose={() => setModal({ open: false, item: null })}
        />
      )}
      <button
        onClick={() => setModal({ open: true, item: null })}
        className="btn-gradient mt-6 px-5 py-2.5 rounded-full font-semibold text-sm"
      >
        + המלצה חדשה
      </button>
    </>
  )
}

/* ── FAQ tab ────────────────────────────────────────────────── */

function FaqModal({
  item,
  onClose,
}: {
  item: FaqItem | null
  onClose: () => void
}) {
  const { saveFaq } = useCms()

  const [form, setForm] = useState({
    question: item?.question ?? "",

    answer: item?.answer ?? "",

    active: item?.active ?? true,
  })

  const canSave = form.question.trim() && form.answer.trim()

  return (
    <ModalShell title={item ? "עריכת שאלה" : "שאלה חדשה"} onClose={onClose}>
      <div className="space-y-4">
        <Field label="השאלה">
          <input
            className="w-full px-4 py-2.5 rounded-lg border text-sm outline-none"
            style={inputStyle}
            value={form.question}
            onChange={(e) => setForm({ ...form, question: e.target.value })}
          />
        </Field>
        <Field label="התשובה">
          <textarea
            rows={4}
            className="w-full px-4 py-2.5 rounded-lg border text-sm outline-none resize-none"
            style={inputStyle}
            value={form.answer}
            onChange={(e) => setForm({ ...form, answer: e.target.value })}
          />
        </Field>
        <label className="flex items-center gap-2.5 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={form.active}
            onChange={(e) => setForm({ ...form, active: e.target.checked })}
            className="accent-[#E3AE3C] w-4 h-4"
          />
          <span className="text-sm">מוצגת באתר</span>
        </label>
      </div>
      <div className="flex gap-3 mt-6">
        <button
          disabled={!canSave}
          onClick={() => {
            saveFaq(form, item?.faq_id)
            onClose()
          }}
          className="btn-gradient flex-1 py-2.5 rounded-full font-semibold text-sm disabled:opacity-40"
        >
          שמירה
        </button>
        <button
          onClick={onClose}
          className="px-5 py-2.5 rounded-full border text-sm hover:bg-white/5"
          style={{
            borderColor: "var(--color-border)",
            color: "var(--color-foreground)",
          }}
        >
          ביטול
        </button>
      </div>
    </ModalShell>
  )
}

function FaqsTab({ showToast }: { showToast: (msg: string) => void }) {
  const { faqs, deleteFaq } = useCms()

  const [modal, setModal] = useState<{ open: boolean, item: FaqItem | null }>({
    open: false,
    item: null,
  })

  const sorted = [...faqs].sort((a, b) => a.display_order - b.display_order)

  return (
    <>
      <div className="space-y-4">
        {sorted.map((f) => (
          <div
            key={f.faq_id}
            className="rounded-lg border p-5 flex items-start justify-between gap-4"
            style={{
              background: "var(--color-card)",
              borderColor: "var(--color-border)",
              opacity: f.active ? 1 : 0.65,
            }}
          >
            <div className="min-w-0">
              <p className="font-medium text-sm flex items-center gap-2">
                {f.question}
                {!f.active && (
                  <span
                    className="text-xs px-2 py-0.5 rounded-full"
                    style={{
                      background: "rgba(107,114,128,0.15)",
                      color: "#9CA3AF",
                    }}
                  >
                    מוסתרת
                  </span>
                )}
              </p>
              <p
                className="text-xs mt-2 leading-relaxed"
                style={{ color: "var(--color-muted-foreground)" }}
              >
                {f.answer}
              </p>
            </div>
            <div className="flex gap-2 flex-shrink-0">
              <button
                onClick={() => setModal({ open: true, item: f })}
                className="text-xs px-3 py-1.5 rounded-full border hover:bg-white/5"
                style={{
                  borderColor: "var(--color-border)",
                  color: "var(--color-foreground)",
                }}
              >
                עריכה
              </button>
              <button
                onClick={() => {
                  deleteFaq(f.faq_id)
                  showToast("השאלה הוסרה")
                }}
                className="text-xs px-3 py-1.5 rounded-full border hover:bg-red-500/10"
                style={{
                  borderColor: "rgba(239,68,68,0.3)",
                  color: "var(--color-danger)",
                }}
              >
                מחיקה
              </button>
            </div>
          </div>
        ))}
      </div>
      {modal.open && (
        <FaqModal
          item={modal.item}
          onClose={() => setModal({ open: false, item: null })}
        />
      )}
      <button
        onClick={() => setModal({ open: true, item: null })}
        className="btn-gradient mt-6 px-5 py-2.5 rounded-full font-semibold text-sm"
      >
        + שאלה חדשה
      </button>
    </>
  )
}

/* ── Coupons tab ────────────────────────────────────────────── */

function CouponModal({
  coupon,
  onClose,
}: {
  coupon: Coupon | null
  onClose: () => void
}) {
  const { saveCoupon } = useCms()

  const [form, setForm] = useState({
    code: coupon?.code ?? "",

    discount_type: (coupon?.discount_type ??
      "PERCENTAGE") as Coupon["discount_type"],

    discount_value: coupon?.discount_value ?? 10,

    minimum_order: coupon?.minimum_order ?? 0,

    usage_limit: coupon?.usage_limit ?? 1000,

    status: coupon?.status ?? "ACTIVE",
  })

  const canSave = form.code.trim().length >= 3

  return (
    <ModalShell title={coupon ? "עריכת קופון" : "קופון חדש"} onClose={onClose}>
      <div className="space-y-4">
        <Field label="קוד קופון">
          <input
            dir="ltr"
            className="w-full px-4 py-2.5 rounded-lg border text-sm outline-none font-mono"
            style={inputStyle}
            value={form.code}
            placeholder="SUMMER25"
            onChange={(e) =>
              setForm({ ...form, code: e.target.value.toUpperCase() })
            }
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="סוג הנחה">
            <select
              className="w-full px-4 py-2.5 rounded-lg border text-sm outline-none"
              style={inputStyle}
              value={form.discount_type}
              onChange={(e) =>
                setForm({
                  ...form,
                  discount_type: e.target.value as Coupon["discount_type"],
                })
              }
            >
              <option value="PERCENTAGE">אחוזים</option>
              <option value="FIXED_AMOUNT">סכום קבוע (₪)</option>
            </select>
          </Field>
          <Field
            label={
              form.discount_type === "PERCENTAGE"
                ? "אחוז הנחה"
                : "סכום הנחה (₪)"
            }
          >
            <input
              type="number"
              dir="ltr"
              className="w-full px-4 py-2.5 rounded-lg border text-sm outline-none"
              style={inputStyle}
              value={form.discount_value}
              onChange={(e) =>
                setForm({ ...form, discount_value: Number(e.target.value) })
              }
            />
          </Field>
          <Field label="מינימום הזמנה (₪)">
            <input
              type="number"
              dir="ltr"
              className="w-full px-4 py-2.5 rounded-lg border text-sm outline-none"
              style={inputStyle}
              value={form.minimum_order}
              onChange={(e) =>
                setForm({ ...form, minimum_order: Number(e.target.value) })
              }
            />
          </Field>
          <Field label="מגבלת שימוש">
            <input
              type="number"
              dir="ltr"
              className="w-full px-4 py-2.5 rounded-lg border text-sm outline-none"
              style={inputStyle}
              value={form.usage_limit}
              onChange={(e) =>
                setForm({ ...form, usage_limit: Number(e.target.value) })
              }
            />
          </Field>
        </div>
        <Field label="סטטוס">
          <select
            className="w-full px-4 py-2.5 rounded-lg border text-sm outline-none"
            style={inputStyle}
            value={form.status}
            onChange={(e) => setForm({ ...form, status: e.target.value })}
          >
            <option value="ACTIVE">פעיל</option>
            <option value="INACTIVE">כבוי</option>
          </select>
        </Field>
      </div>
      <div className="flex gap-3 mt-6">
        <button
          disabled={!canSave}
          onClick={() => {
            saveCoupon(form, coupon?.coupon_id)
            onClose()
          }}
          className="btn-gradient flex-1 py-2.5 rounded-full font-semibold text-sm disabled:opacity-40"
        >
          שמירה
        </button>
        <button
          onClick={onClose}
          className="px-5 py-2.5 rounded-full border text-sm hover:bg-white/5"
          style={{
            borderColor: "var(--color-border)",
            color: "var(--color-foreground)",
          }}
        >
          ביטול
        </button>
      </div>
    </ModalShell>
  )
}

function CouponsTab({ showToast }: { showToast: (msg: string) => void }) {
  const { coupons, deleteCoupon } = useCms()

  const [modal, setModal] = useState<{ open: boolean, item: Coupon | null }>({
    open: false,
    item: null,
  })

  return (
    <>
      <div
        className="rounded-lg border overflow-hidden"
        style={{ borderColor: "var(--color-border)" }}
      >
        <table className="w-full text-sm">
          <thead>
            <tr style={{ background: "var(--color-secondary)" }}>
              {[
                "קוד",
                "הנחה",
                "מינימום הזמנה",
                "שימושים",
                "סטטוס",
                "פעולות",
              ].map((col) => (
                <th
                  key={col}
                  className="text-right px-5 py-3 text-xs tracking-wide"
                  style={{
                    color: "var(--color-muted-foreground)",
                    borderBottom: "1px solid var(--color-border)",
                  }}
                >
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {coupons.map((c, i) => (
              <tr
                key={c.coupon_id}
                style={{
                  background:
                    i % 2 === 0
                      ? "var(--color-card)"
                      : "var(--color-background)",

                  borderBottom: "1px solid var(--color-border)",
                }}
              >
                <td className="px-5 py-3 font-mono font-semibold" dir="ltr">
                  {c.code}
                </td>
                <td className="px-5 py-3">
                  {c.discount_type === "PERCENTAGE"
                    ? `${c.discount_value}%`
                    : `₪${c.discount_value}`}
                </td>
                <td className="px-5 py-3">₪{c.minimum_order}</td>
                <td
                  className="px-5 py-3"
                  style={{ color: "var(--color-muted-foreground)" }}
                >
                  {c.times_used} / {c.usage_limit ?? "∞"}
                </td>
                <td className="px-5 py-3">
                  <span
                    className="text-xs px-2 py-0.5 rounded-full"
                    style={{
                      background:
                        c.status === "ACTIVE"
                          ? "rgba(34,197,94,0.1)"
                          : "rgba(107,114,128,0.15)",

                      color:
                        c.status === "ACTIVE"
                          ? "var(--color-success)"
                          : "#9CA3AF",
                    }}
                  >
                    {c.status === "ACTIVE" ? "פעיל" : "כבוי"}
                  </span>
                </td>
                <td className="px-5 py-3">
                  <div className="flex gap-2">
                    <button
                      onClick={() => setModal({ open: true, item: c })}
                      className="text-xs px-3 py-1 rounded-full border hover:bg-white/5"
                      style={{
                        borderColor: "var(--color-border)",
                        color: "var(--color-foreground)",
                      }}
                    >
                      עריכה
                    </button>
                    <button
                      onClick={() => {
                        deleteCoupon(c.coupon_id)
                        showToast("הקופון הוסר")
                      }}
                      className="text-xs px-3 py-1 rounded-full border hover:bg-red-500/10"
                      style={{
                        borderColor: "rgba(239,68,68,0.3)",
                        color: "var(--color-danger)",
                      }}
                    >
                      מחיקה
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {modal.open && (
        <CouponModal
          coupon={modal.item}
          onClose={() => setModal({ open: false, item: null })}
        />
      )}
      <button
        onClick={() => setModal({ open: true, item: null })}
        className="btn-gradient mt-6 px-5 py-2.5 rounded-full font-semibold text-sm"
      >
        + קופון חדש
      </button>
    </>
  )
}

/* ── Page ───────────────────────────────────────────────────── */

const TABS: {
  id: "SECTIONS" | "TESTIMONIALS" | "FAQ" | "COUPONS"
  label: string
  icon: IconName
}[] = [
  { id: "SECTIONS", label: "סקטורים", icon: "layers" },

  { id: "TESTIMONIALS", label: "המלצות", icon: "message" },

  { id: "FAQ", label: "שאלות נפוצות", icon: "list" },

  { id: "COUPONS", label: "קופונים", icon: "tag" },
]

export default function AdminCmsPage() {
  const cms = useCms()

  const { adminRole } = useAdmin()

  const [tab, setTab] = useState<typeof TABS[number]["id"]>("SECTIONS")

  const [toast, setToast] = useState<string | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)

  const showToast = (msg: string) => {
    setToast(msg)

    window.setTimeout(() => setToast(null), 2600)
  }

  if (!can(adminRole, "cms")) return <AccessDenied page="CMS — ניהול תוכן" />

  /** The backup is produced by the service layer so it always matches the live schema. */

  const handleBackup = () => {
    const result = cms.exportBackup()

    if (!result.ok) {
      showToast(result.error)

      return
    }

    const blob = new Blob([JSON.stringify(result.data, null, 2)], {
      type: "application/json",
    })

    const url = URL.createObjectURL(blob)

    const a = document.createElement("a")

    a.href = url

    a.download = `casanova-cms-backup-${new Date().toISOString().slice(0, 10)}.json`

    a.click()

    URL.revokeObjectURL(url)

    showToast("הגיבוי הורד בהצלחה")
  }

  /** Restores catalogue and content only — orders, refunds and customers are never touched. */

  const handleRestore = (file: File) => {
    const reader = new FileReader()

    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result))

        if (
          !data ||
          (!Array.isArray(data.sections) && !Array.isArray(data.products))
        ) {
          showToast("קובץ הגיבוי אינו תקין")

          return
        }

        const result = cms.restoreBackup(data)

        showToast(result.ok ? "הגיבוי שוחזר בהצלחה" : result.error)
      } catch {
        showToast("קובץ הגיבוי אינו תקין")
      }
    }

    reader.readAsText(file)
  }

  const counts: Record<string, number> = {
    SECTIONS: cms.sections.length,

    TESTIMONIALS: cms.testimonials.length,

    FAQ: cms.faqs.length,

    COUPONS: cms.coupons.length,
  }

  return (
    <div className="max-w-5xl mx-auto page-enter">
      <div className="flex items-center justify-between mb-2 flex-wrap gap-4">
        <div>
          <h1 className="font-display text-4xl font-semibold mb-1">
            CMS — ניהול תוכן
          </h1>
          <p style={{ color: "var(--color-muted-foreground)" }}>
            כל התוכן שמוצג באתר — סקטורים, מוצרים, המלצות, שאלות נפוצות
            וקופונים. השינויים נשמרים ומתפרסמים מיידית.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleBackup}
            className="flex items-center gap-2 px-4 py-2.5 rounded-full border text-sm transition-colors hover:bg-white/5"
            style={{
              borderColor: "var(--color-border)",
              color: "var(--color-foreground)",
            }}
          >
            <Icon name="download" size={15} /> גיבוי
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-2 px-4 py-2.5 rounded-full border text-sm transition-colors hover:bg-white/5"
            style={{
              borderColor: "var(--color-border)",
              color: "var(--color-foreground)",
            }}
          >
            <Icon name="upload" size={15} /> שחזור
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]

              if (f) handleRestore(f)

              e.target.value = ""
            }}
          />
        </div>
      </div>

      <div className="flex gap-2 my-8 flex-wrap">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-full text-sm font-medium border transition-colors"
            style={{
              borderColor:
                tab === t.id ? "var(--color-primary)" : "var(--color-border)",

              background:
                tab === t.id ? "rgba(227,174,60,0.12)" : "var(--color-card)",

              color:
                tab === t.id
                  ? "var(--color-primary)"
                  : "var(--color-muted-foreground)",
            }}
          >
            <Icon name={t.icon} size={15} />
            {t.label}
            <span className="text-xs opacity-70">({counts[t.id]})</span>
          </button>
        ))}
      </div>

      {tab === "SECTIONS" && <SectionsTab showToast={showToast} />}
      {tab === "TESTIMONIALS" && <TestimonialsTab showToast={showToast} />}
      {tab === "FAQ" && <FaqsTab showToast={showToast} />}
      {tab === "COUPONS" && <CouponsTab showToast={showToast} />}

      {toast && (
        <div
          className="fixed bottom-6 right-1/2 translate-x-1/2 px-5 py-3 rounded-full text-sm font-medium z-50"
          style={{
            background: "var(--color-primary)",
            color: "var(--color-primary-foreground)",
          }}
        >
          {toast}
        </div>
      )}
    </div>
  )
}
