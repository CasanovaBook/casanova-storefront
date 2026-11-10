/**
 * Maestro Admin - content editor.
 *
 * Group-based sidebar with field editors for all content fields defined in the registry.
 * Supports draft system with publish/discard workflow.
 *
 * Features:
 *  - Per-field reset to default
 *  - SEO preview (Google SERP mockup)
 *  - Keyboard shortcuts (Ctrl+S = publish, Escape = discard)
 *  - Unsaved changes warning (beforeunload)
 *  - Change counter in toolbar
 *  - Field diff indicators
 *  - Global search across all groups
 *  - Auto-resize textareas
 *  - Collapsible list items with reorder/duplicate
 *  - Image URL preview thumbnails
 *  - Focus states with gold border
 *  - Loading indicator
 */

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FocusEvent } from "react"
import { useLocation, useNavigate, useSearchParams } from "react-router"
import {
  GROUPS,
  FIELDS,
  FIELD_MAP,
  fieldsOfGroup,
  DEFAULT_CONTENT_GROUP,
  type FieldDef,
  type FieldType,
} from "@/content/registry"
import {
  getDraft,
  setDraft,
  getSaved,
  getRaw,
  applySaved,
  loadContent,
  hasDraft,
  previewEnabled,
  PREVIEW_KEY,
} from "@/content/store"
import {
  PREVIEW_HIGHLIGHT_MESSAGE,
  isPreviewReadyMessage,
  type PreviewHighlightMessage,
} from "@/content/preview-bridge"
import { maestro } from "@/maestro"
import { useApp } from "@/context/AppContext"
import { can } from "@/lib/permissions"
import Icon from "@/components/icons"
import PageHeader from "@/components/ui/PageHeader"
import EmptyState from "@/components/ui/EmptyState"
import Alert from "@/components/ui/Alert"
import { toast } from "./toast"

/* Shared editor control styles retained from the previous editor. They use
 * the application tokens so the dense CMS controls follow the same palette
 * as the rest of the admin area. */
const btnBase =
  "rounded-lg px-3 py-1.5 text-sm font-medium transition-colors"

const inputStyle: CSSProperties = {
  background: "var(--color-secondary)",
  border: "1px solid var(--color-border)",
  color: "var(--color-foreground)",
  borderRadius: "var(--radius)",
}

const cardStyle: CSSProperties = {
  background: "var(--color-card)",
  border: "1px solid var(--color-border)",
  borderRadius: "var(--radius-md)",
}

/** Inline live preview needs the third column; below this width it would
 *  squeeze the fields pane to an unusable strip on tablets. */
function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(
    () => typeof window !== "undefined" && window.matchMedia(query).matches,
  )
  useEffect(() => {
    const media = window.matchMedia(query)
    const update = () => setMatches(media.matches)
    update()
    media.addEventListener("change", update)
    return () => media.removeEventListener("change", update)
  }, [query])
  return matches
}

/** Auto-resizing textarea that grows with content. */
function AutoTextarea({
  value,
  onChange,
  rows = 3,
  minHeight,
  maxHeight,
  resizable,
  placeholder,
  style,
  dir,
  mono,
  id,
  ariaLabel,
}: {
  value: string
  onChange: (v: string) => void
  rows?: number
  /** Floor for the auto-grown height, in px - roomier than `rows` alone for long documents. */
  minHeight?: number
  /** Ceiling for the auto-grown height; past it the box scrolls instead of stretching the page. */
  maxHeight?: number
  /** Let the admin drag the bottom edge; once dragged, auto-grow stops fighting that height. */
  resizable?: boolean
  placeholder?: string
  style?: React.CSSProperties
  dir?: string
  mono?: boolean
  id?: string
  ariaLabel?: string
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const userSized = useRef(false)
  const resize = useCallback(() => {
    const el = ref.current
    if (!el || userSized.current) return
    el.style.height = "auto"
    el.style.height = `${Math.min(
      Math.max(el.scrollHeight, rows * 22, minHeight ?? 0),
      maxHeight ?? Number.POSITIVE_INFINITY,
    )}px`
  }, [rows, minHeight, maxHeight])
  useEffect(() => {
    resize()
  }, [value, resize])
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === "undefined") return
    let width = el.clientWidth
    const ro = new ResizeObserver(() => {
      if (el.clientWidth === width) return
      width = el.clientWidth
      resize()
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [resize])
  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onPointerDown={(e) => {
        // The drag grip lives at the bottom corner (bottom-left in RTL);
        // a grab there is the admin setting the height on purpose.
        const el = ref.current
        if (!resizable || !el) return
        const rect = el.getBoundingClientRect()
        const nearBottom = e.clientY >= rect.bottom - 16
        const nearEdge =
          e.clientX <= rect.left + 16 || e.clientX >= rect.right - 16
        if (nearBottom && nearEdge) userSized.current = true
      }}
      rows={rows}
      placeholder={placeholder}
      id={id}
      aria-label={ariaLabel}
      className={`w-full px-3 py-2 text-sm ${mono ? "font-mono" : ""}`}
      style={{
        resize: resizable ? "vertical" : "none",
        overflow: resizable ? "auto" : "hidden",
        ...style,
      }}
      dir={dir ?? "rtl"}
    />
  )
}

const inputProps = (dir = "rtl") => ({
  className: "w-full px-3 py-2 text-sm",
  dir,
})

/** Stable id for a field's single control; keys contain dots, so CSS selectors must quote them. */
const controlId = (key: string) => `field-${key}`

/** The slice of a field definition the preview bridge needs. */
type PreviewField = Pick<FieldDef, "key" | "label" | "type">

/** Types that render exactly one focusable control, so the row label can point at it. */
const LABELABLE: FieldType[] = [
  "text",
  "textarea",
  "body",
  "rich",
  "md",
  "image",
  "link",
  "strings",
  "select",
  "boolean",
]

const TYPE_LABELS: Record<string, string> = {
  text: "טקסט",
  textarea: "טקסט ארוך",
  body: "גוף מסמך",
  rich: "עשיר",
  md: "Markdown",
  image: "תמונה",
  link: "קישור",
  strings: "רשימה",
  list: "פריטים",
  boolean: "כן/לא",
  select: "בחירה",
}

// ── Section grouping ──────────────────────────────────────────────────────────

/** A logical block of the edited page, rendered as one accordion card. */
type ContentSection = {
  id: string
  label: string
  fields: FieldDef[]
  anchor?: string
  order: number
}

type SectionRule = {
  id: string
  label: string
  /** First key segment(s) after the group id that belong to this section. */
  parts: string[]
  order: number
  /** Optional selector for the matching block in the previewed page. */
  anchor?: string
}

const LEGAL_SECTION_RULES: SectionRule[] = [
  { id: "intro", label: "כותרת ופתיחה", parts: ["eyebrow", "title"], order: 10 },
  { id: "sections", label: "סעיפי המסמך", parts: ["sections"], order: 20 },
  { id: "body", label: "גוף המסמך", parts: ["body"], order: 30 },
  { id: "seo", label: "SEO ושיתוף", parts: ["seo"], order: 40 },
]

/**
 * Page-specific section layouts. Order here is deliberate: the editorial
 * flow of the page, not the raw registry order, so Header/Footer lands at the
 * bottom where an editor expects it instead of between hero and benefits.
 */
const SECTION_RULES: Record<string, SectionRule[]> = {
  sales: [
    { id: "hero", label: "Hero", parts: ["hero"], order: 10, anchor: ".cv-hero, #hero" },
    { id: "benefits", label: "רצועת יתרונות", parts: ["benefits"], order: 20, anchor: ".cv-strip" },
    { id: "about", label: "על הספר", parts: ["about"], order: 30, anchor: "#about" },
    { id: "quote", label: "ציטוט", parts: ["quote"], order: 40, anchor: ".cv-quote-band" },
    { id: "inside", label: "מה בפנים", parts: ["inside", "features"], order: 50, anchor: "#inside" },
    { id: "audience", label: "למי זה מתאים", parts: ["audience"], order: 60, anchor: "#inside" },
    { id: "offer", label: "רכישה ומחיר", parts: ["offer"], order: 70, anchor: "#purchase" },
    { id: "faq", label: "שאלות נפוצות", parts: ["faq"], order: 80, anchor: "#faq" },
    { id: "exit", label: "פופאפ יציאה", parts: ["exit"], order: 90, anchor: "[role='dialog']" },
    { id: "seo", label: "SEO ושיתוף", parts: ["seo"], order: 100 },
    { id: "headerFooter", label: "הדר ופוטר", parts: ["header", "footer", "stickyCta"], order: 110, anchor: "header" },
  ],
  global: [
    { id: "branding", label: "מיתוג", parts: ["logo", "favicon", "brand", "tagline"], order: 10, anchor: "header" },
    { id: "nav", label: "ניווט ראשי", parts: ["nav"], order: 20, anchor: "header" },
    { id: "footer", label: "פוטר", parts: ["footerTagline", "footerCopyright"], order: 30, anchor: "footer" },
    { id: "seo", label: "SEO ושיתוף", parts: ["seo"], order: 40 },
  ],
  store: [
    { id: "hero", label: "Hero", parts: ["hero"], order: 10, anchor: ".cv-hero, #hero" },
    { id: "empty", label: "מצב ריק", parts: ["empty"], order: 20 },
    { id: "seo", label: "SEO ושיתוף", parts: ["seo"], order: 30 },
  ],
  library: [
    { id: "general", label: "כללי", parts: ["title"], order: 10 },
    { id: "empty", label: "מצב ריק", parts: ["empty"], order: 20 },
    { id: "seo", label: "SEO ושיתוף", parts: ["seo"], order: 30 },
  ],
  support: [
    { id: "hero", label: "Hero", parts: ["hero"], order: 10, anchor: ".cv-hero, #hero" },
    { id: "success", label: "הודעת הצלחה", parts: ["success"], order: 20 },
    { id: "seo", label: "SEO ושיתוף", parts: ["seo"], order: 30 },
  ],
  announcements: [
    { id: "announcements", label: "באנר הודעות", parts: ["*"], order: 10, anchor: ".announcement-banner" },
  ],
  system: [
    { id: "system", label: "הודעות מערכת", parts: ["*"], order: 10 },
  ],
  terms: LEGAL_SECTION_RULES,
  privacy: LEGAL_SECTION_RULES,
  cancellation: LEGAL_SECTION_RULES,
}

const PART_LABELS: Record<string, string> = {
  hero: "Hero",
  benefits: "רצועת יתרונות",
  about: "על הספר",
  quote: "ציטוט",
  inside: "מה בפנים",
  features: "נושאים בתוכן",
  audience: "למי זה מתאים",
  offer: "רכישה ומחיר",
  faq: "שאלות נפוצות",
  exit: "פופאפ יציאה",
  header: "הדר",
  footer: "פוטר",
  stickyCta: "סרגל נייד",
  seo: "SEO ושיתוף",
  empty: "מצב ריק",
  success: "הודעת הצלחה",
  sections: "סעיפים",
  body: "גוף המסמך",
  title: "כללי",
  eyebrow: "פתיחה",
  brand: "מיתוג",
  nav: "ניווט",
}

/** The first key segment after the group id: `sales.hero.headline` → `hero`. */
function fieldPart(field: FieldDef): string {
  const prefix = `${field.group}.`
  const tail = field.key.startsWith(prefix)
    ? field.key.slice(prefix.length)
    : field.key
  return tail.split(".")[0] ?? ""
}

/** "Hero - שורת פתיחה" → "Hero"; used when no explicit rule exists. */
function labelFromField(field: FieldDef): string {
  return field.label.split(/\s[-–]\s/)[0]?.trim() || field.label
}

function buildSections(group: string, fields: FieldDef[]): ContentSection[] {
  const rules = SECTION_RULES[group] ?? []
  const sections = new Map<string, ContentSection>()
  let fallbackOrder = 500
  for (const field of fields) {
    const part = fieldPart(field)
    const rule = rules.find(
      (r) => r.parts.includes("*") || r.parts.includes(part),
    )
    const id = rule?.id ?? part
    const existing = sections.get(id)
    if (existing) {
      existing.fields.push(field)
    } else {
      sections.set(id, {
        id,
        label: rule?.label ?? PART_LABELS[part] ?? labelFromField(field),
        fields: [field],
        anchor: rule?.anchor,
        order: rule?.order ?? fallbackOrder++,
      })
    }
  }
  return [...sections.values()].sort((a, b) => a.order - b.order)
}

/** A field counts as filled when any meaningful value exists at any depth. */
function isFilledValue(value: unknown): boolean {
  if (value === null || value === undefined) return false
  if (typeof value === "string") return value.trim().length > 0
  if (Array.isArray(value)) return value.some(isFilledValue)
  if (typeof value === "object") {
    return Object.values(value as Record<string, unknown>).some(isFilledValue)
  }
  return true
}

// ── Field editor ──────────────────────────────────────────────────────────────

function FieldEditor({
  field,
  value,
  onChange,
}: {
  field: FieldDef
  value: unknown
  onChange: (v: unknown) => void
}) {
  switch (field.type) {
    case "boolean": {
      const on = value === true
      return (
        <div className="flex items-center gap-2">
          <input
            id={controlId(field.key)}
            type="checkbox"
            checked={on}
            onChange={(e) => onChange(e.target.checked)}
            className="h-4 w-4 flex-shrink-0"
          />
          {/* sibling text, not a second label: keeps the accessible name = the row label */}
          <span className="app-hint">{on ? "מופעל" : "כבוי"}</span>
        </div>
      )
    }
    case "select": {
      const v = typeof value === "string" ? value : ""
      const opts = field.options ?? []
      return (
        <select
          id={controlId(field.key)}
          value={v}
          onChange={(e) => onChange(e.target.value)}
          className="w-full px-3 py-2 text-sm"
          style={{ cursor: "pointer" }}
        >
          {/* a stale/unknown stored value stays visible instead of silently coercing */}
          {!opts.some((o) => o.value === v) && (
            <option value={v}>{v || "(ריק)"}</option>
          )}
          {opts.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )
    }
    case "text": {
      const v = typeof value === "string" ? value : ""
      return (
        <div>
          <input
            type="text"
            value={v}
            onChange={(e) => onChange(e.target.value)}
            id={controlId(field.key)}
            aria-label={field.label}
            {...inputProps()}
          />
          <div className="mt-1 flex justify-end">
            <span
              className="text-[10px] font-mono"
              style={{
                color:
                  v.length > 200
                    ? "var(--color-danger)"
                    : "var(--color-muted-foreground)",
                opacity: 0.6,
              }}
            >
              {v.length}
            </span>
          </div>
        </div>
      )
    }
    case "textarea":
      return (
        <AutoTextarea
          value={typeof value === "string" ? value : ""}
          onChange={onChange as (v: string) => void}
          rows={4}
          id={controlId(field.key)}
          ariaLabel={field.label}
        />
      )
    case "body": {
      const v = typeof value === "string" ? value : ""
      const lines = v.split("\n").filter((l) => l.trim() !== "").length
      const chars = [...v].filter((ch) => !/\s/.test(ch)).length
      return (
        <div>
          <AutoTextarea
            value={v}
            onChange={onChange as (v2: string) => void}
            rows={10}
            minHeight={250}
            maxHeight={480}
            resizable
            id={controlId(field.key)}
            ariaLabel={field.label}
            style={{ lineHeight: 1.75, padding: "0.75rem 1rem" }}
          />
          <div className="mt-1 flex justify-end">
            <span className="app-hint">
              {lines === 1 ? "שורה אחת" : `${lines} שורות`} ·{" "}
              {chars === 1 ? "תו אחד" : `${chars} תווים`}
            </span>
          </div>
        </div>
      )
    }
    case "rich":
      return (
        <div>
          <AutoTextarea
            value={typeof value === "string" ? value : ""}
            onChange={onChange as (v: string) => void}
            rows={3}
            placeholder="שורה חדשה = מעבר שורה. *מילה* = הדגשה."
            id={controlId(field.key)}
            ariaLabel={field.label}
          />
          <p className="app-hint mt-1">
            *מילה* = הדגשה · שורה חדשה = שורה חדשה
          </p>
        </div>
      )
    case "md":
      return (
        <div>
          <AutoTextarea
            value={typeof value === "string" ? value : ""}
            onChange={onChange as (v: string) => void}
            rows={8}
            placeholder="Markdown: פסקאות, ## כותרות, - רשימות, **מודגש**"
            mono
            id={controlId(field.key)}
            ariaLabel={field.label}
          />
          <p className="app-hint mt-1">
            ## כותרת · **מודגש** · - רשימה · פסקאות בהפרדת שורה ריקה
          </p>
        </div>
      )
    case "image": {
      const v = typeof value === "string" ? value : ""
      return (
        <div>
          <input
            type="url"
            value={v}
            onChange={(e) => onChange(e.target.value)}
            id={controlId(field.key)}
            aria-label={field.label}
            {...inputProps("ltr")}
            placeholder="https://…"
          />
          {v && (
            <div className="mt-2 flex items-center gap-2">
              <img
                src={v}
                alt="תצוגה מקדימה"
                className="w-12 h-12 rounded-lg object-cover flex-shrink-0"
                style={{ border: "1px solid var(--color-border)" }}
                onError={(e) => {
                  ;(e.target as HTMLImageElement).style.opacity = "0.2"
                }}
              />
              <span
                className="text-[10px] font-mono truncate"
                dir="ltr"
                style={{ color: "var(--color-muted-foreground)", opacity: 0.5 }}
              >
                {v}
              </span>
            </div>
          )}
        </div>
      )
    }
    case "link":
      return (
        <input
          type="text"
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
          id={controlId(field.key)}
          aria-label={field.label}
          {...inputProps("ltr")}
          placeholder="/path או https://…"
        />
      )
    case "strings": {
      const arr = Array.isArray(value)
        ? value.join("\n")
        : typeof value === "string"
          ? value
          : ""
      const count = arr.split("\n").filter(Boolean).length
      return (
        <div>
          <AutoTextarea
            value={arr}
            onChange={(v) => onChange(v.split("\n").filter(Boolean))}
            rows={4}
            placeholder={field.hint ?? "פריט אחד בכל שורה"}
            id={controlId(field.key)}
            ariaLabel={field.label}
          />
          <div className="mt-1 flex justify-end">
            <span className="app-hint">
              {count} פריטים
            </span>
          </div>
        </div>
      )
    }
    case "list": {
      const items = Array.isArray(value)
        ? value as Record<string, unknown>[]
        : []
      const itemFields = field.itemFields ?? []
      const titleKey = field.itemTitle ?? itemFields[0]?.key ?? ""
      return (
        <div className="space-y-1.5">
          {items.map((item, idx) => (
            <ListItemEditor
              key={idx}
              item={item}
              idx={idx}
              total={items.length}
              fields={itemFields}
              titleKey={titleKey}
              onChange={(updated) =>
                onChange(items.map((it, i) => (i === idx ? updated : it)))
              }
              onDelete={() => onChange(items.filter((_, i) => i !== idx))}
              onMove={(dir) => {
                const t = idx + dir
                if (t < 0 || t >= items.length) return
                const n = [...items]
                ;[n[idx], n[t]] = [n[t], n[idx]]
                onChange(n)
              }}
              onDuplicate={() =>
                onChange([
                  ...items.slice(0, idx + 1),
                  { ...item },
                  ...items.slice(idx + 1),
                ])
              }
            />
          ))}
          <button
            type="button"
            onClick={() => {
              const blank: Record<string, unknown> = {}
              for (const f of itemFields)
                blank[f.key] = f.type === "boolean" ? false : ""
              onChange([...items, blank])
            }}
            className="w-full rounded-lg border border-dashed py-2.5 text-xs font-medium transition-colors flex items-center justify-center gap-1.5 hover:bg-[var(--color-secondary)]"
            style={{
              borderColor: "var(--color-border)",
              color: "var(--color-primary)",
            }}
          >
            <span className="text-sm" aria-hidden="true">+</span> הוספת פריט
          </button>
        </div>
      )
    }
    default:
      return (
        <div
          className="text-sm"
          style={{ color: "var(--color-muted-foreground)" }}
        >
          סוג שדה לא נתמך: {field.type}
        </div>
      )
  }
}

// ── List item editor (collapsible, reorder, duplicate) ────────────────────────

function ListItemEditor({
  item,
  idx,
  total,
  fields,
  titleKey,
  onChange,
  onDelete,
  onMove,
  onDuplicate,
}: {
  item: Record<string, unknown>
  idx: number
  total: number
  fields: { key: string; label: string; type: string; hint?: string }[]
  titleKey: string
  onChange: (v: Record<string, unknown>) => void
  onDelete: () => void
  onMove: (dir: -1 | 1) => void
  onDuplicate: () => void
}) {
  const [open, setOpen] = useState(idx === 0)
  const title = titleKey
    ? String(item[titleKey] ?? `פריט ${idx + 1}`)
    : `פריט ${idx + 1}`
  return (
    <div
      className="overflow-hidden rounded-lg transition-colors"
      style={{
        background: "var(--color-secondary)",
        border: "1px solid var(--color-border)",
      }}
    >
      <div className="flex items-center gap-2 px-2.5 py-2 select-none">
        <span
          className="text-[10px] font-bold w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0"
          style={{
            background: "color-mix(in srgb, var(--color-primary) 15%, transparent)",
            color: "var(--color-primary)",
          }}
          aria-hidden="true"
        >
          {idx + 1}
        </span>
        {/* The disclosure is a real button, so the section can be opened and
         * closed from the keyboard; it can not be the whole row, because the
         * row also holds the move and delete buttons. */}
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          className="min-w-0 flex-1 truncate text-start text-xs font-medium rounded transition-colors hover:text-[var(--color-primary)]"
          style={{ color: "var(--color-foreground)" }}
        >
          {title}
        </button>
        <div className="flex items-center gap-0.5 flex-shrink-0">
          <button
            type="button"
            onClick={() => onMove(-1)}
            disabled={idx === 0}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors hover:bg-[var(--color-muted)] disabled:opacity-20"
            style={{ color: "var(--color-muted-foreground)" }}
            title="העלה למעלה"
            aria-label={`העלאת ${title} למעלה`}
          >
            <span className="text-xs" aria-hidden="true">▲</span>
          </button>
          <button
            type="button"
            onClick={() => onMove(1)}
            disabled={idx === total - 1}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors hover:bg-[var(--color-muted)] disabled:opacity-20"
            style={{ color: "var(--color-muted-foreground)" }}
            title="הורד למטה"
            aria-label={`הורדת ${title} למטה`}
          >
            <span className="text-xs" aria-hidden="true">▼</span>
          </button>
          <button
            type="button"
            onClick={onDuplicate}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors hover:bg-[var(--color-muted)]"
            style={{ color: "var(--color-muted-foreground)" }}
            title="שכפל"
            aria-label={`שכפול ${title}`}
          >
            <Icon name="layers" size={12} />
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors hover:bg-[var(--color-muted)]"
            style={{ color: "var(--color-danger)" }}
            title="מחק"
            aria-label={`מחיקת ${title}`}
          >
            <Icon name="x" size={12} />
          </button>
        </div>
        <Icon
          name={open ? "chevronDown" : "chevronRight"}
          size={12}
          style={{ color: "var(--color-muted-foreground)", flexShrink: 0 }}
        />
      </div>
      {open && (
        <div
          className="px-3 pb-3 space-y-2.5"
          style={{ borderTop: "1px solid var(--color-border)" }}
        >
          {fields.map((f) => (
            <div key={f.key} className="app-field pt-2">
              <label
                className="app-label"
                style={{ fontSize: "0.72rem" }}
              >
                {f.label}
              </label>
              {f.type === "textarea" || f.type === "md" ? (
                <AutoTextarea
                  value={String(item[f.key] ?? "")}
                  onChange={(v) => onChange({ ...item, [f.key]: v })}
                  rows={f.type === "md" ? 5 : 3}
                  mono={f.type === "md"}
                  style={{ fontSize: "12px", padding: "6px 8px" }}
                />
              ) : (
                <input
                  type="text"
                  value={String(item[f.key] ?? "")}
                  onChange={(e) =>
                    onChange({ ...item, [f.key]: e.target.value })
                  }
                  className="w-full rounded-md px-2.5 py-1.5 text-xs"
                  dir={f.type === "link" ? "ltr" : "rtl"}
                />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── SEO Preview ───────────────────────────────────────────────────────────────

function SeoPreview({ groupId }: { groupId: string }) {
  const title = String(getRaw(`${groupId}.seo.title`) ?? "")
  const description = String(getRaw(`${groupId}.seo.description`) ?? "")
  const titleLen = title.length
  const descLen = description.length
  const titleOk = titleLen > 0 && titleLen <= 60
  const descOk = descLen >= 120 && descLen <= 160
  return (
    <section className="app-surface" aria-labelledby="seo-preview-title">
      <div className="app-surface-head">
        <h2 id="seo-preview-title" className="app-section-title flex items-center gap-2">
          <Icon name="eye" size={16} /> תצוגת Google
        </h2>
      </div>
      <div className="app-surface-body">
        <div
          className="rounded-lg p-3"
          dir="ltr"
          style={{
            background: "var(--color-secondary)",
            border: "1px solid var(--color-border)",
          }}
        >
          <p
            className="text-xs truncate"
            style={{ color: "var(--color-success)" }}
          >
            {window.location.origin}
            {GROUPS.find((g) => g.id === groupId)?.path ?? "/"}
          </p>
          <p
            className="mt-0.5 text-base truncate font-medium"
            style={{ color: "#8ab4f8" }}
          >
            {title || "ללא כותרת"}
          </p>
          <p className="mt-0.5 text-xs line-clamp-2 app-muted">
            {description || "ללא תיאור"}
          </p>
        </div>
        <div className="mt-2 flex flex-wrap gap-4 text-xs">
          <span
            style={{
              color: titleOk
                ? "var(--color-success)"
                : titleLen > 60
                  ? "var(--color-danger)"
                  : "var(--color-muted-foreground)",
            }}
          >
            כותרת: {titleLen}/60
          </span>
          <span
            style={{
              color: descOk
                ? "var(--color-success)"
                : descLen > 160
                  ? "var(--color-danger)"
                  : "var(--color-muted-foreground)",
            }}
          >
            תיאור: {descLen}/160
          </span>
        </div>
      </div>
    </section>
  )
}

// ── Main editor ───────────────────────────────────────────────────────────────

/** Groups the editor offers, in sidebar order. Computed once; used to
 * validate the ?group= URL parameter and by the context bar. */
const EDITABLE_GROUPS = GROUPS.filter(
  (g) =>
    g.section === "pages" || g.section === "legal" || g.section === "global",
)
const editableGroupIds = new Set(EDITABLE_GROUPS.map((g) => g.id))

export function ContentEditor() {
  const { adminRole } = useApp()
  const canPublish = can(adminRole, "cms:edit_live")
  const navigate = useNavigate()

  /* The selected content group lives in the URL (?group=<id>) so the editor
   * context survives a refresh, a share and back/forward navigation. Route
   * state passed by the dashboard (navigate(..., { state: { group } }))
   * seeds it on entry; after that the URL is the single source of truth.
   * An unknown id falls back to the default group rather than an empty
   * editor, so a stale link still lands somewhere useful. */
  const [searchParams, setSearchParams] = useSearchParams()
  const locationStateGroup = (useLocation().state as { group?: string } | null)
    ?.group
  const requestedGroup =
    searchParams.get("group") ?? locationStateGroup ?? DEFAULT_CONTENT_GROUP
  const activeGroup = editableGroupIds.has(requestedGroup)
    ? requestedGroup
    : DEFAULT_CONTENT_GROUP

  const setActiveGroup = useCallback(
    (id: string) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          next.set("group", id)
          return next
        },
        { replace: true },
      )
    },
    [setSearchParams],
  )

  const [draft, setDraftState] = useState<Record<string, unknown>>(() =>
    getDraft(),
  )
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [resettingKey, setResettingKey] = useState<string | null>(null)
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const [showSeo, setShowSeo] = useState(false)
  const [showModified, setShowModified] = useState(false)
  const [onlyUnfilled, setOnlyUnfilled] = useState(false)
  /* Accordion state, keyed by stable section ids. */
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    () => new Set(),
  )
  const [showPreview, setShowPreview] = useState(true)
  /* Bumped only by the explicit refresh button. Draft edits must NOT remount
   * the frame: the preview document is same-origin and subscribed to the
   * content store, so it repaints in place on every draft write. */
  const [previewKey, setPreviewKey] = useState(0)
  const previewFrameRef = useRef<HTMLIFrameElement | null>(null)
  /* Offset captured before a manual refresh, re-applied once the fresh
   * document finishes loading. Left at 0 for ordinary loads. */
  const previewRestoreScroll = useRef(0)
  /* What the pointer and keyboard focus are on, mirrored into the preview.
   * Hover wins while both are set; leaving the field returns to focus. */
  const hoveredPreviewField = useRef<PreviewField | null>(null)
  const focusedPreviewField = useRef<PreviewField | null>(null)
  /* The section whose expansion was mirrored, so collapsing it can clear. */
  const lastPreviewedSection = useRef<string | null>(null)
  const draftRef = useRef(draft)
  draftRef.current = draft
  /* A ref, not only state, so a double click or a keyboard shortcut cannot
   * start two saves before React has re-rendered the disabled button. */
  const savingRef = useRef(false)
  const inlinePreviewAvailable = useMediaQuery("(min-width: 1280px)")

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void loadContent()
      .catch(() => {
        if (!cancelled)
          toast.error("טעינת התוכן נכשלה. בדקו את החיבור ונסו לרענן.")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (Object.keys(draftRef.current).length > 0) e.preventDefault()
    }
    window.addEventListener("beforeunload", handler)
    return () => window.removeEventListener("beforeunload", handler)
  }, [])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault()
        if (canPublish && Object.keys(draftRef.current).length > 0)
          handlePublish()
      }
      if (e.key === "Escape" && Object.keys(draftRef.current).length > 0)
        handleDiscard()
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canPublish])

  const draftCount = Object.keys(draft).length

  const groupFields = useMemo(() => fieldsOfGroup(activeGroup), [activeGroup])

  const handleChange = useCallback(
    (key: string, value: unknown) => {
      const next = { ...draft }
      if (value === getRaw(key)) {
        delete next[key]
      } else {
        next[key] = value
      }
      setDraftState(next)
      setDraft(next)
    },
    [draft],
  )

  const handleResetField = useCallback(
    async (key: string) => {
      const field = FIELD_MAP[key]
      if (!field || resettingKey) return
      if (
        !window.confirm(
          `לשחזר את "${field.label}" לברירת המחדל? הפעולה נשמרת מיד.`,
        )
      )
        return
      setResettingKey(key)
      try {
        const res = await maestro.content.reset([key])
        if (res.error) {
          toast.error(`לא שוחזר: ${res.error.message}`)
          return
        }
        toast.success(`שוחזר: ${field.label}`)
        const next = { ...draftRef.current }
        if (key in next) {
          delete next[key]
          setDraftState(next)
          setDraft(next)
        }
        const newSaved = { ...getSaved() }
        delete newSaved[key]
        applySaved(newSaved, [key])
      } catch (err) {
        toast.error(
          err instanceof Error
            ? `לא שוחזר: ${err.message}`
            : "השחזור נכשל. בדקו את החיבור ונסו שוב.",
        )
      } finally {
        setResettingKey(null)
      }
    },
    [resettingKey],
  )

  const handlePublish = useCallback(async () => {
    if (!canPublish || savingRef.current) return
    /* Snapshot the draft: edits made while the request is in flight must
     * not be silently wiped when the save resolves. */
    const snapshot = { ...draftRef.current }
    const keys = Object.keys(snapshot)
    if (!keys.length) return
    const unknown = keys.filter((key) => !FIELD_MAP[key])
    if (unknown.length) {
      toast.error("הטיוטה מכילה שדות לא מוכרים. רעננו את העמוד ונסו שוב.")
      return
    }

    savingRef.current = true
    setSaving(true)
    try {
      const res = await maestro.content.saveMany(snapshot)
      if (res.error) {
        toast.error(`לא נשמר: ${res.error.message || "שגיאה בשמירה."}`)
        return
      }
      applySaved(snapshot)

      /* Keep only values the admin changed after the save started. A key
       * whose current draft now equals the snapshot was saved and is no
       * longer pending; a key changed again stays a draft. */
      const remaining = { ...draftRef.current }
      for (const key of keys) {
        if (JSON.stringify(remaining[key]) === JSON.stringify(snapshot[key]))
          delete remaining[key]
      }
      setDraftState(remaining)
      setDraft(remaining)
      setLastSavedAt(new Date())

      const pending = Object.keys(remaining).length
      if (pending > 0) {
        toast.info(
          `נשמרו ${keys.length} שינויים · ${pending} שינויים חדשים נשמרו כטיוטה`,
        )
      } else {
        toast.success(`פורסמו ${keys.length} שינויים בהצלחה`)
      }
    } catch (err) {
      toast.error(
        err instanceof Error
          ? `לא נשמר: ${err.message}`
          : "השמירה נכשלה. בדקו את החיבור ונסו שוב.",
      )
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }, [canPublish])

  const handleDiscard = useCallback(() => {
    if (savingRef.current || !hasDraft()) return
    if (!window.confirm("לבטל את כל השינויים שלא פורסמו?")) return
    setDraftState({})
    setDraft({})
    toast.info("הטיוטה נמחקה")
  }, [])

  const activeGroupDef = EDITABLE_GROUPS.find((g) => g.id === activeGroup)
  const activeGroupLabel = activeGroupDef?.label ?? ""
  const previewPath = activeGroupDef?.path ?? "/"
  const hasSeo = !!FIELD_MAP[`${activeGroup}.seo.title`]

  /* Same-origin preview document: it reads the draft from the content store
   * and receives a `storage` event for every write, so editing a field
   * updates the preview live without reloading it. The URL therefore depends
   * only on the page being previewed - never on the draft. */
  const previewUrl = useMemo(() => {
    const url = new URL(previewPath, window.location.origin)
    url.searchParams.set("maestro-preview", "1")
    return url.toString()
  }, [previewPath])

  /** Full reload of the preview, keeping the reader where they were. */
  const refreshPreview = useCallback(() => {
    try {
      previewRestoreScroll.current =
        previewFrameRef.current?.contentWindow?.scrollY ?? 0
    } catch {
      /* frame not readable yet: start from the top */
      previewRestoreScroll.current = 0
    }
    setPreviewKey((k) => k + 1)
  }, [])

  const handlePreviewLoaded = useCallback(() => {
    const offset = previewRestoreScroll.current
    if (!offset) return
    previewRestoreScroll.current = 0
    try {
      previewFrameRef.current?.contentWindow?.scrollTo(0, offset)
    } catch {
      /* unreachable same-origin guard: nothing to restore across origins */
    }
  }, [])

  /** Single gate for everything sent into the preview frame. */
  const postPreviewMessage = useCallback(
    (message: PreviewHighlightMessage) => {
      if (!showPreview || !inlinePreviewAvailable) return
      const frame = previewFrameRef.current
      if (!frame?.contentWindow) return
      try {
        frame.contentWindow.postMessage(message, window.location.origin)
      } catch {
        /* frame navigated or became unreadable: nothing to highlight */
      }
    },
    [inlinePreviewAvailable, showPreview],
  )

  /** Posts the active field to the same-origin preview, or clears it. */
  const postPreviewHighlight = useCallback(
    (active: PreviewField | null, reveal: boolean) => {
      if (!active) {
        postPreviewMessage({ type: PREVIEW_HIGHLIGHT_MESSAGE, key: null })
        return
      }
      /* The draft wins over saved/default for the same reason the preview
       * shows it: the outline must match the value on screen. */
      const value =
        active.key in draftRef.current
          ? draftRef.current[active.key]
          : getRaw(active.key)
      postPreviewMessage({
        type: PREVIEW_HIGHLIGHT_MESSAGE,
        key: active.key,
        label: active.label,
        kind: active.type,
        value,
        reveal,
      })
    },
    [postPreviewMessage],
  )

  /** A section was opened: outline its block, not one of its values. */
  const postPreviewSection = useCallback(
    (section: ContentSection) => {
      postPreviewMessage({
        type: PREVIEW_HIGHLIGHT_MESSAGE,
        key: `${activeGroup}.${section.id}`,
        label: section.label,
        kind: "section",
        anchor: section.anchor,
        reveal: true,
      })
    },
    [activeGroup, postPreviewMessage],
  )

  const syncPreviewHighlight = useCallback(
    (reveal = false) => {
      postPreviewHighlight(
        hoveredPreviewField.current ?? focusedPreviewField.current,
        reveal,
      )
    },
    [postPreviewHighlight],
  )

  /* A fresh preview document announces itself once its highlighter mounts;
   * replay the active field so a refresh or preview toggle keeps the outline. */
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return
      const frame = previewFrameRef.current
      if (!frame?.contentWindow || event.source !== frame.contentWindow) return
      if (!isPreviewReadyMessage(event.data)) return
      syncPreviewHighlight(false)
    }
    window.addEventListener("message", handler)
    return () => window.removeEventListener("message", handler)
  }, [syncPreviewHighlight])

  /* Edits can re-render or replace the matched element. Re-resolve after the
   * typing settles instead of scanning the preview DOM on every keystroke. */
  useEffect(() => {
    if (!hoveredPreviewField.current && !focusedPreviewField.current) return
    const timer = window.setTimeout(() => syncPreviewHighlight(false), 200)
    return () => window.clearTimeout(timer)
  }, [draft, syncPreviewHighlight])

  const previousPreviewGroup = useRef(activeGroup)
  useEffect(() => {
    if (previousPreviewGroup.current === activeGroup) return
    previousPreviewGroup.current = activeGroup
    hoveredPreviewField.current = null
    focusedPreviewField.current = null
    lastPreviewedSection.current = null
    postPreviewHighlight(null, false)
  }, [activeGroup, postPreviewHighlight])

  const previewHoverStart = useCallback(
    (field: FieldDef) => {
      hoveredPreviewField.current = {
        key: field.key,
        label: field.label,
        type: field.type,
      }
      /* Hover also reveals: the whole point is to find the element in the
       * preview, and reveal() is a no-op when it is already on screen. */
      syncPreviewHighlight(true)
    },
    [syncPreviewHighlight],
  )

  const previewHoverEnd = useCallback(() => {
    if (!hoveredPreviewField.current) return
    hoveredPreviewField.current = null
    syncPreviewHighlight(false)
  }, [syncPreviewHighlight])

  const previewFocusStart = useCallback(
    (field: FieldDef) => {
      focusedPreviewField.current = {
        key: field.key,
        label: field.label,
        type: field.type,
      }
      syncPreviewHighlight(true)
    },
    [syncPreviewHighlight],
  )

  const previewFocusEnd = useCallback(
    (event: FocusEvent<HTMLDivElement>) => {
      const next = event.relatedTarget
      if (next instanceof Node && event.currentTarget.contains(next)) return
      focusedPreviewField.current = null
      syncPreviewHighlight(false)
    },
    [syncPreviewHighlight],
  )

  const handlePreview = useCallback(() => {
    const url = new URL(previewPath, window.location.origin)
    url.searchParams.set("maestro-preview", "1")
    /* A tab opened with window.open inherits a copy of the opener's
     * sessionStorage, so the preview flag follows the new tab everywhere
     * the admin goes and the banner turns up on the storefront itself.
     * Clearing it here, before the tab is created, keeps the preview
     * scoped to the preview URL that sets it deliberately. */
    try {
      window.sessionStorage.removeItem(PREVIEW_KEY)
    } catch {
      /* storage blocked: the query flag still drives the preview itself */
    }
    window.open(url.toString(), "_blank")
  }, [previewPath])

  const isModified = useCallback(
    (key: string) => {
      const saved = getSaved()
      const field = FIELD_MAP[key]
      if (!field) return false
      const current =
        key in draft ? draft[key] : key in saved ? saved[key] : field.default
      return JSON.stringify(current) !== JSON.stringify(field.default)
    },
    [draft],
  )

  const modifiedCount = useMemo(
    () => FIELDS.filter((f) => isModified(f.key)).length,
    [isModified],
  )
  const sections = useMemo(
    () => buildSections(activeGroup, groupFields),
    [activeGroup, groupFields],
  )

  const normalizedQuery = searchQuery.trim().toLowerCase()

  const visibleSections = useMemo(
    () =>
      sections
        .map((section) => {
          /* A section-title match keeps the whole section together; otherwise
           * only the fields whose label or key match remain. */
          const titleMatch =
            normalizedQuery.length > 0 &&
            section.label.toLowerCase().includes(normalizedQuery)
          let fields = section.fields
          if (normalizedQuery) {
            fields = titleMatch
              ? fields
              : fields.filter(
                  (f) =>
                    f.label.toLowerCase().includes(normalizedQuery) ||
                    f.key.toLowerCase().includes(normalizedQuery),
                )
          }
          if (showModified) fields = fields.filter((f) => isModified(f.key))
          if (onlyUnfilled) {
            fields = fields.filter(
              (f) =>
                !isFilledValue(
                  f.key in draft ? draft[f.key] : getRaw(f.key),
                ),
            )
          }
          return { ...section, fields }
        })
        .filter((section) => section.fields.length > 0),
    [sections, normalizedQuery, showModified, onlyUnfilled, draft, isModified],
  )

  const sectionStats = useMemo(() => {
    const stats = new Map<string, { filled: number; total: number }>()
    for (const section of sections) {
      const filled = section.fields.filter((f) =>
        isFilledValue(f.key in draft ? draft[f.key] : getRaw(f.key)),
      ).length
      stats.set(section.id, { filled, total: section.fields.length })
    }
    return stats
  }, [sections, draft])

  const firstSectionId = sections[0]?.id

  /* Default: one open section. A group switch always starts there, so the
   * editor never opens on a wall of expanded forms. */
  useEffect(() => {
    setExpandedSections(new Set(firstSectionId ? [firstSectionId] : []))
  }, [activeGroup, firstSectionId])

  /* Search reveals what it found; it never leaves matches hidden. */
  useEffect(() => {
    if (!normalizedQuery) return
    const matches = sections
      .filter(
        (section) =>
          section.label.toLowerCase().includes(normalizedQuery) ||
          section.fields.some(
            (f) =>
              f.label.toLowerCase().includes(normalizedQuery) ||
              f.key.toLowerCase().includes(normalizedQuery),
          ),
      )
      .map((section) => section.id)
    if (!matches.length) return
    setExpandedSections((prev) => {
      const next = new Set(prev)
      for (const id of matches) next.add(id)
      return next
    })
  }, [normalizedQuery, sections])

  /* Empty-only mode is a to-do list: open every section that still needs work. */
  useEffect(() => {
    if (!onlyUnfilled) return
    const unfinished = sections
      .filter((section) =>
        section.fields.some(
          (f) =>
            !isFilledValue(
              f.key in draftRef.current
                ? draftRef.current[f.key]
                : getRaw(f.key),
            ),
        ),
      )
      .map((section) => section.id)
    setExpandedSections(new Set(unfinished))
  }, [onlyUnfilled, sections])

  const expandAllSections = useCallback(() => {
    setExpandedSections(new Set(visibleSections.map((s) => s.id)))
  }, [visibleSections])

  const collapseAllSections = useCallback(() => {
    setExpandedSections(new Set())
    lastPreviewedSection.current = null
    postPreviewHighlight(null, false)
  }, [postPreviewHighlight])

  const toggleSection = useCallback(
    (section: ContentSection) => {
      const open = !expandedSections.has(section.id)
      setExpandedSections((prev) => {
        const next = new Set(prev)
        if (open) next.add(section.id)
        else next.delete(section.id)
        return next
      })
      if (open) {
        lastPreviewedSection.current = section.id
        postPreviewSection(section)
      } else if (lastPreviewedSection.current === section.id) {
        lastPreviewedSection.current = null
        postPreviewHighlight(null, false)
      }
    },
    [expandedSections, postPreviewHighlight, postPreviewSection],
  )
  /* The editing-context header replaces the old floating context bar. The
   * group label, save state and route back stay visible while the editor
   * columns keep their own independent scroll. */
  const saveStatus = saving ? (
    <>
      <span
        className="h-2.5 w-2.5 rounded-full border border-current border-t-transparent animate-spin"
        aria-hidden="true"
      />
      שומר…
    </>
  ) : draftCount > 0 ? (
    <>
      <Icon name="pen" size={10} />
      {draftCount} שינויים שלא פורסמו
    </>
  ) : lastSavedAt ? (
    <>
      <Icon name="checkCircle" size={10} />
      נשמר לאחרונה{" "}
      {lastSavedAt.toLocaleTimeString("he-IL", {
        hour: "2-digit",
        minute: "2-digit",
      })}
    </>
  ) : (
    <>
      <Icon name="checkCircle" size={10} />
      כל השינויים שמורים
    </>
  )

  return (
    <div dir="rtl">
      <PageHeader
        eyebrow="Maestro CMS · עורך תוכן"
        title="עריכת תוכן"
        description={`קבוצת התוכן הפעילה: ${activeGroupLabel}. שינויים נשמרים כטיוטה עד לפרסום.`}
        actions={
          <>
            <span
              role="status"
              aria-live="polite"
              aria-atomic="true"
              className={`app-badge ${saving || draftCount > 0 ? "app-badge--accent" : "app-badge--success"}`}
            >
              {saveStatus}
            </span>
            <button
              type="button"
              onClick={() => navigate("/admin/cms/content-editor")}
              className="app-btn-secondary"
            >
              <Icon name="arrowRight" size={13} />
              חזרה ללוח הבקרה
            </button>
          </>
        }
      />
      <div
        className="flex w-full flex-col overflow-hidden rounded-xl border md:flex-row md:h-[calc(100dvh-12rem)] md:min-h-[30rem]"
        style={{ borderColor: "var(--color-border)", background: "var(--color-background)" }}
        aria-busy={loading || saving}
      >
        {/* Group sidebar */}
        <div
          className="hidden md:block w-60 flex-shrink-0 overflow-auto"
          style={{
            background: "var(--color-card)",
            borderInlineEnd: "1px solid var(--color-border)",
          }}
          aria-label="קבוצות תוכן"
        >
          <div className="p-2">
            <div className="relative">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="חיפוש סעיפים ושדות…"
                className="w-full rounded-lg py-2 pe-3 ps-8 text-xs"
                dir="rtl"
                aria-label="חיפוש סעיפים ושדות בקבוצה הפעילה"
              />
              <span
                className="absolute top-1/2 -translate-y-1/2 start-2.5 pointer-events-none"
                style={{ color: "var(--color-muted-foreground)" }}
              >
                <Icon name="search" size={14} />
              </span>
            </div>
          </div>
          <div className="px-1 pb-1">
            {EDITABLE_GROUPS.map((g) => {
              const active = g.id === activeGroup
              const gModified = fieldsOfGroup(g.id).filter((f) =>
                isModified(f.key),
              ).length
              return (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => {
                    setActiveGroup(g.id)
                    setShowSeo(false)
                  }}
                  aria-current={active ? "true" : undefined}
                  className="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-start text-sm transition-colors hover:bg-[var(--color-secondary)]"
                  style={{
                    background: active
                      ? "color-mix(in srgb, var(--color-primary) 12%, transparent)"
                      : "transparent",
                    color: active
                      ? "var(--color-primary)"
                      : "var(--color-muted-foreground)",
                    borderInlineStart: active
                      ? "3px solid var(--color-primary)"
                      : "3px solid transparent",
                    fontWeight: active ? 600 : 400,
                  }}
                >
                  <span className="truncate">{g.label}</span>
                  {gModified > 0 && (
                    <span
                      className="flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold"
                      style={{
                        background: "color-mix(in srgb, var(--color-primary) 20%, transparent)",
                        color: "var(--color-primary)",
                      }}
                    >
                      {gModified}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
          <div
            className="p-3 mt-2"
            style={{ borderTop: "1px solid var(--color-border)" }}
          >
            <p className="app-label mb-1.5" style={{ color: "var(--color-muted-foreground)" }}>
              סטטיסטיקות
            </p>
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs">
                <span className="app-muted">שדות</span>
                <span style={{ color: "var(--color-foreground)" }}>
                  {FIELDS.length}
                </span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="app-muted">שונו</span>
                <span
                  style={{ color: "var(--color-primary)", fontWeight: 600 }}
                >
                  {modifiedCount}
                </span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="app-muted">בטיוטה</span>
                <span
                  style={{
                    color:
                      draftCount > 0
                        ? "var(--color-primary)"
                        : "var(--color-muted-foreground)",
                    fontWeight: draftCount > 0 ? 600 : 400,
                  }}
                >
                  {draftCount}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Fields */}
        <div
          className="min-w-0 flex-1 overflow-auto scroll-pt-20 p-4 2xl:p-6"
          style={{ background: "var(--color-background)" }}
        >
          <div
            className="sticky top-0 z-20 -mx-4 -mt-4 mb-4 flex items-center justify-between flex-wrap gap-2 border-b px-4 pt-4 pb-3 2xl:-mx-6 2xl:-mt-6 2xl:mb-6 2xl:px-6 2xl:pt-6"
            style={{
              background: "var(--color-background)",
              borderColor: "var(--color-border)",
            }}
          >
            <div className="flex items-center gap-3">
              <h2
                className="text-lg font-bold"
                style={{ color: "var(--color-foreground)" }}
              >
                {activeGroupDef?.label}
              </h2>
              {loading && (
                <span
                  className="flex items-center gap-1.5 text-xs animate-pulse"
                  style={{ color: "var(--color-muted-foreground)" }}
                >
                  <span className="w-2 h-2 rounded-full bg-current animate-ping" />
                  טוען…
                </span>
              )}
              {draftCount > 0 && (
                <span
                  className="rounded-full px-2.5 py-0.5 text-xs font-medium flex items-center gap-1"
                  style={{
                    background: "rgba(222,154,96,0.12)",
                    color: "var(--color-primary)",
                  }}
                >
                  <Icon name="pen" size={10} />
                  {draftCount} שינויים שלא פורסמו
                </span>
              )}
            </div>
            <div className="flex gap-2 flex-wrap items-center">
              <div
                className="flex items-center overflow-hidden rounded-lg"
                style={{
                  border: "1px solid var(--color-border)",
                  background: "var(--color-card)",
                }}
              >
                <button
                  onClick={expandAllSections}
                  className="px-2.5 py-1.5 text-xs transition-colors hover:bg-[var(--color-secondary)]"
                  style={{ color: "var(--color-muted-foreground)" }}
                  title="הרחבת כל הסעיפים"
                >
                  הרחב הכל
                </button>
                <span
                  className="h-4 w-px"
                  style={{ background: "var(--color-border)" }}
                  aria-hidden="true"
                />
                <button
                  onClick={collapseAllSections}
                  className="px-2.5 py-1.5 text-xs transition-colors hover:bg-[var(--color-secondary)]"
                  style={{ color: "var(--color-muted-foreground)" }}
                  title="כיווץ כל הסעיפים"
                >
                  כווץ הכל
                </button>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={onlyUnfilled}
                onClick={() => setOnlyUnfilled((v) => !v)}
                className="inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs transition-colors"
                style={{
                  border: "1px solid var(--color-border)",
                  background: onlyUnfilled
                    ? "rgba(222,154,96,0.12)"
                    : "var(--color-card)",
                  color: onlyUnfilled
                    ? "var(--color-primary)"
                    : "var(--color-muted-foreground)",
                }}
                title="הצגת שדות שעדיין לא מולאו"
              >
                <span
                  className={`flex h-4 w-7 items-center rounded-full p-0.5 transition-colors ${onlyUnfilled ? "justify-end" : "justify-start"}`}
                  style={{
                    background: onlyUnfilled
                      ? "var(--color-primary)"
                      : "var(--color-border)",
                  }}
                  aria-hidden="true"
                >
                  <span className="h-3 w-3 rounded-full bg-white shadow-sm" />
                </span>
                הצג שדות ריקים בלבד
              </button>
              <button
                onClick={() => setShowModified(!showModified)}
                className={btnBase}
                style={{
                  border: "1px solid var(--color-border)",
                  background: showModified
                    ? "rgba(222,154,96,0.12)"
                    : "var(--color-card)",
                  color: showModified
                    ? "var(--color-primary)"
                    : "var(--color-muted-foreground)",
                }}
              >
                {showModified ? "הצג הכל" : "הצג ששונו"}
              </button>
              {hasSeo && (
                <button
                  onClick={() => setShowSeo(!showSeo)}
                  className={btnBase}
                  style={{
                    border: "1px solid var(--color-border)",
                    background: showSeo
                      ? "rgba(79,122,79,0.12)"
                      : "var(--color-card)",
                    color: showSeo
                      ? "var(--color-success)"
                      : "var(--color-muted-foreground)",
                  }}
                >
                  SEO
                </button>
              )}
              <button
                onClick={() => setShowPreview(!showPreview)}
                className={`${btnBase} hidden xl:inline-flex items-center`}
                style={{
                  border: "1px solid var(--color-border)",
                  background: showPreview
                    ? "rgba(222,154,96,0.12)"
                    : "var(--color-card)",
                  color: showPreview
                    ? "var(--color-primary)"
                    : "var(--color-muted-foreground)",
                }}
                title="הצגת/הסתרת תצוגה מקדימה חיה"
              >
                <span className="flex items-center gap-1">
                  <Icon name="eye" size={14} />
                  {showPreview ? "תצוגה חיה" : "הצג תצוגה"}
                </span>
              </button>
              <button
                onClick={handlePreview}
                className={btnBase}
                style={{
                  border: "1px solid var(--color-border)",
                  background: "var(--color-card)",
                  color: "var(--color-primary)",
                }}
                title="פתיחת העמוד בלשונית חדשה עם תצוגה מקדימה של הטיוטה"
              >
                <span className="flex items-center gap-1">
                  <Icon name="external" size={14} />
                  לשונית חדשה
                </span>
              </button>
              {hasDraft() && canPublish && (
                <>
                  <button
                    onClick={handleDiscard}
                    disabled={saving}
                    className={`${btnBase} disabled:opacity-50`}
                    style={{
                      border: "1px solid var(--color-border)",
                      background: "var(--color-card)",
                      color: "var(--color-muted-foreground)",
                    }}
                  >
                    ביטול
                  </button>
                  <button
                    onClick={handlePublish}
                    disabled={saving}
                    className={`${btnBase} flex items-center gap-1.5`}
                    style={{
                      background: "var(--color-primary)",
                      color: "var(--color-primary-foreground)",
                      opacity: saving ? 0.7 : 1,
                    }}
                  >
                    {saving && (
                      <span className="w-3.5 h-3.5 rounded-full border-2 border-current border-t-transparent animate-spin" />
                    )}
                    {saving ? "שומר…" : "פרסם"}
                  </button>
                </>
              )}
              {hasDraft() && !canPublish && (
                <span
                  className="rounded-lg px-3 py-1.5 text-xs"
                  style={{
                    background: "rgba(222,154,96,0.08)",
                    border: "1px solid rgba(222,154,96,0.2)",
                    color: "var(--color-primary)",
                  }}
                >
                  שמור כטיוטה - רק מנהל יכול לפרסם
                </span>
              )}
            </div>
          </div>

          <div className="mb-4 md:hidden">
            <label
              htmlFor="cms-group-picker"
              className="mb-1 block text-xs font-medium"
              style={{ color: "var(--color-muted-foreground)" }}
            >
              קבוצת תוכן
            </label>
            <select
              id="cms-group-picker"
              value={activeGroup}
              onChange={(e) => {
                setActiveGroup(e.target.value)
                setShowSeo(false)
              }}
              className="w-full rounded-lg px-3 py-2 text-sm"
              style={inputStyle}
            >
              {EDITABLE_GROUPS.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.label}
                </option>
              ))}
            </select>
          </div>

          {showSeo && hasSeo && (
            <div className="mb-4">
              <SeoPreview groupId={activeGroup} />
            </div>
          )}

          {draftCount > 0 && canPublish && (
            <p
              className="mb-3 text-xs flex items-center gap-1"
              style={{ color: "var(--color-muted-foreground)", opacity: 0.6 }}
            >
              <Icon name="zap" size={10} />
              קיצורים: Ctrl+S = פרסום · Escape = ביטול
            </p>
          )}

          {visibleSections.length > 0 ? (
            <div className="space-y-3">
              {visibleSections.map((section) => {
                const open = expandedSections.has(section.id)
                const stats = sectionStats.get(section.id) ?? {
                  filled: 0,
                  total: section.fields.length,
                }
                const percent =
                  stats.total > 0
                    ? Math.round((stats.filled / stats.total) * 100)
                    : 0
                const complete =
                  stats.total > 0 && stats.filled === stats.total
                const sectionModified = section.fields.filter((f) =>
                  isModified(f.key),
                ).length
                return (
                  <section
                    key={section.id}
                    className="overflow-hidden rounded-xl border"
                    style={{
                      ...cardStyle,
                      borderColor: open
                        ? "rgba(222,154,96,0.28)"
                        : "var(--color-border)",
                    }}
                    aria-labelledby={`cms-section-title-${section.id}`}
                  >
                    <button
                      type="button"
                      onClick={() => toggleSection(section)}
                      aria-expanded={open}
                      aria-controls={`cms-section-body-${section.id}`}
                      className="flex w-full items-center gap-3 px-4 py-3 text-start transition-colors hover:bg-[var(--color-secondary)]"
                    >
                      <Icon
                        name={open ? "chevronDown" : "chevronRight"}
                        size={14}
                        style={{
                          color: "var(--color-muted-foreground)",
                          flexShrink: 0,
                        }}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span
                            id={`cms-section-title-${section.id}`}
                            className="truncate text-sm font-semibold"
                            style={{ color: "var(--color-foreground)" }}
                          >
                            {section.label}
                          </span>
                          {sectionModified > 0 && (
                            <span
                              className="flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px]"
                              style={{
                                background: "rgba(222,154,96,0.12)",
                                color: "var(--color-primary)",
                              }}
                              title={`${sectionModified} שדות ששונו`}
                            >
                              <Icon name="pen" size={9} />
                              {sectionModified}
                            </span>
                          )}
                        </span>
                        <span
                          className="mt-0.5 block truncate text-[10px] font-mono"
                          dir="ltr"
                          style={{
                            color: "var(--color-muted-foreground)",
                            opacity: 0.35,
                          }}
                        >
                          {`${activeGroup}.${section.id}`}
                        </span>
                      </span>
                      <span
                        className="flex shrink-0 items-center gap-2"
                        title={`${stats.filled} מתוך ${stats.total} שדות מלאים`}
                      >
                        <span
                          className="hidden h-1 w-12 overflow-hidden rounded-full sm:block"
                          style={{ background: "var(--color-secondary)" }}
                          aria-hidden="true"
                        >
                          <span
                            className="block h-full rounded-full transition-all"
                            style={{
                              width: `${percent}%`,
                              background: complete
                                ? "var(--color-success)"
                                : "var(--color-primary)",
                              opacity: complete ? 0.85 : 0.55,
                            }}
                          />
                        </span>
                        <span
                          className="rounded-full px-2 py-0.5 text-[10px] font-medium tabular-nums"
                          style={{
                            background: complete
                              ? "rgba(79,122,79,0.12)"
                              : "var(--color-secondary)",
                            color: complete
                              ? "var(--color-success)"
                              : "var(--color-muted-foreground)",
                          }}
                          aria-label={`${stats.filled} מתוך ${stats.total} שדות מלאים`}
                        >
                          {stats.filled}/{stats.total}
                        </span>
                      </span>
                    </button>

                    {open && (
                      <div
                        id={`cms-section-body-${section.id}`}
                        className="border-t p-3 md:p-4"
                        style={{ borderColor: "var(--color-border)" }}
                      >
                        <div className="grid grid-cols-1 gap-3 3xl:grid-cols-2 4xl:grid-cols-3">
                          {section.fields.map((field) => {
                            const modified = isModified(field.key)
                            const spansFull = [
                              "textarea",
                              "body",
                              "rich",
                              "md",
                              "strings",
                              "list",
                            ].includes(field.type)
                            return (
                              <div
                                key={field.key}
                                onMouseEnter={() => previewHoverStart(field)}
                                onMouseLeave={previewHoverEnd}
                                onFocusCapture={() => previewFocusStart(field)}
                                onBlurCapture={previewFocusEnd}
                                className={`rounded-lg p-3.5 transition-colors${spansFull ? " col-span-full" : ""}`}
                                style={{
                                  background: "var(--color-secondary)",
                                  border: `1px solid ${
                                    modified
                                      ? "rgba(222,154,96,0.3)"
                                      : "var(--color-border)"
                                  }`,
                                }}
                              >
                                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                                  <label
                                    className="flex min-w-0 items-center gap-2 text-[13px] font-semibold"
                                    style={{ color: "var(--color-foreground)" }}
                                    htmlFor={
                                      LABELABLE.includes(field.type)
                                        ? controlId(field.key)
                                        : undefined
                                    }
                                  >
                                    {field.label}
                                    <span
                                      className="rounded-md px-1.5 py-0.5 text-[9px] font-normal tracking-wide"
                                      style={{
                                        background:
                                          "color-mix(in srgb, var(--color-background) 60%, transparent)",
                                        color:
                                          "var(--color-muted-foreground)",
                                        opacity: 0.65,
                                      }}
                                    >
                                      {TYPE_LABELS[field.type] ?? field.type}
                                    </span>
                                    {modified && (
                                      <span
                                        style={{ color: "var(--color-primary)" }}
                                        title="שונה מברירת המחדל"
                                      >
                                        <Icon name="pen" size={10} />
                                      </span>
                                    )}
                                  </label>
                                  {modified && (
                                    <button
                                      onClick={() =>
                                        handleResetField(field.key)
                                      }
                                      disabled={resettingKey !== null}
                                      className="text-[11px] transition-opacity hover:opacity-70 disabled:opacity-40"
                                      style={{
                                        color: "var(--color-muted-foreground)",
                                      }}
                                      title="שחזור לברירת המחדל"
                                    >
                                      {resettingKey === field.key
                                        ? "משחזר…"
                                        : "שחזר ברירת מחדל"}
                                    </button>
                                  )}
                                </div>
                                {field.hint && (
                                  <p
                                    className="mb-1.5 text-[11px] leading-5"
                                    style={{
                                      color: "var(--color-muted-foreground)",
                                      opacity: 0.6,
                                    }}
                                  >
                                    {field.hint}
                                  </p>
                                )}
                                <FieldEditor
                                  field={field}
                                  value={
                                    field.key in draft
                                      ? draft[field.key]
                                      : getRaw(field.key)
                                  }
                                  onChange={(v) =>
                                    handleChange(field.key, v)
                                  }
                                />
                                <p
                                  className="mt-2 truncate text-[10px] font-mono"
                                  dir="ltr"
                                  title={field.key}
                                  style={{
                                    color: "var(--color-muted-foreground)",
                                    opacity: 0.28,
                                  }}
                                >
                                  {field.key}
                                </p>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )}
                  </section>
                )
              })}
            </div>
          ) : (
            <div
              className="rounded-xl border p-6 text-center text-sm"
              style={{
                borderColor: "var(--color-border)",
                background: "var(--color-card)",
                color: "var(--color-muted-foreground)",
              }}
            >
              {showModified
                ? "אין שדות ששונו בקבוצה זו."
                : onlyUnfilled
                  ? "כל השדות בקבוצה הזו מלאים."
                  : searchQuery
                    ? "לא נמצאו שדות או סעיפים תואמים."
                    : "אין שדות לקבוצה זו."}
            </div>
          )}
        </div>

        {/* Live preview pane - desktop only; tablets use the new-tab
         * preview so the field editor keeps a usable width. */}
        {showPreview && inlinePreviewAvailable && (
          <div
            className="flex w-[clamp(24rem,30vw,48rem)] shrink-0 flex-col overflow-hidden"
            style={{
              borderInlineStart: "1px solid var(--color-border)",
              background: "var(--color-card)",
            }}
          >
            <div
              className="flex items-center justify-between px-4 py-2.5"
              style={{ borderBottom: "1px solid var(--color-border)" }}
            >
              <span
                className="flex items-center gap-2 text-xs font-semibold"
                style={{ color: "var(--color-muted-foreground)" }}
              >
                <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                תצוגה חיה
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={refreshPreview}
                  className="rounded-lg p-1.5 transition-colors hover:bg-white/5"
                  style={{ color: "var(--color-muted-foreground)" }}
                  title="רענון תצוגה"
                  aria-label="רענון תצוגה מקדימה"
                >
                  <Icon name="refresh" size={14} />
                </button>
                <button
                  onClick={() => setShowPreview(false)}
                  className="rounded-lg p-1.5 transition-colors hover:bg-white/5"
                  style={{ color: "var(--color-muted-foreground)" }}
                  title="הסתר תצוגה"
                  aria-label="הסתר תצוגה מקדימה"
                >
                  <Icon name="x" size={14} />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-hidden">
              <iframe
                key={previewKey}
                ref={previewFrameRef}
                src={previewUrl}
                onLoad={handlePreviewLoaded}
                className="w-full h-full border-0"
                title="תצוגה מקדימה חיה"
              />
            </div>
            <div
              className="px-4 py-2 text-xs flex items-center justify-between"
              style={{
                borderTop: "1px solid var(--color-border)",
                color: "var(--color-muted-foreground)",
                opacity: 0.7,
              }}
            >
              <span>{activeGroupLabel}</span>
              <span className="font-mono" dir="ltr">
                {previewPath}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
