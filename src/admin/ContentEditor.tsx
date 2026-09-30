/**
 * Maestro Admin — content editor.
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

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useLocation, useNavigate, useSearchParams } from "react-router"
import {
  GROUPS,
  FIELDS,
  FIELD_MAP,
  fieldsOfGroup,
  DEFAULT_CONTENT_GROUP,
  type FieldDef,
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
import { maestro } from "@/maestro"
import { useApp } from "@/context/AppContext"
import { can } from "@/lib/permissions"
import Icon from "@/components/icons"
import { toast } from "./toast"

const inputStyle: React.CSSProperties = {
  background: "var(--color-secondary)",
  border: "1px solid var(--color-border)",
  color: "var(--color-foreground)",
  borderRadius: "var(--radius)",
}

const cardStyle: React.CSSProperties = {
  background: "var(--color-card)",
  border: "1px solid var(--color-border)",
  borderRadius: "var(--radius-md)",
}

const focusBorder = "1px solid var(--color-primary)"
const focusShadow = "0 0 0 2px rgba(227,174,60,0.15)"

/** Auto-resizing textarea that grows with content. */
function AutoTextarea({
  value,
  onChange,
  rows = 3,
  placeholder,
  style,
  dir,
  mono,
}: {
  value: string
  onChange: (v: string) => void
  rows?: number
  placeholder?: string
  style?: React.CSSProperties
  dir?: string
  mono?: boolean
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const resize = useCallback(() => {
    const el = ref.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${Math.max(el.scrollHeight, rows * 22)}px`
  }, [rows])
  useEffect(() => {
    resize()
  }, [value, resize])
  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      rows={rows}
      placeholder={placeholder}
      className={`w-full px-3 py-2 text-sm ${mono ? "font-mono" : ""}`}
      style={{ ...inputStyle, resize: "none", overflow: "hidden", ...style }}
      dir={dir ?? "rtl"}
      onFocus={(e) => {
        e.currentTarget.style.border = focusBorder
        e.currentTarget.style.boxShadow = focusShadow
      }}
      onBlur={(e) => {
        e.currentTarget.style.border = (inputStyle.border as string)
        e.currentTarget.style.boxShadow = "none"
      }}
    />
  )
}

const inputProps = (dir = "rtl") => ({
  className: "w-full px-3 py-2 text-sm",
  style: inputStyle,
  dir,
  onFocus: (e: React.FocusEvent<HTMLInputElement>) => {
    e.currentTarget.style.border = focusBorder
    e.currentTarget.style.boxShadow = focusShadow
  },
  onBlur: (e: React.FocusEvent<HTMLInputElement>) => {
    e.currentTarget.style.border = (inputStyle.border as string)
    e.currentTarget.style.boxShadow = "none"
  },
})

const TYPE_LABELS: Record<string, string> = {
  text: "טקסט",
  textarea: "טקסט ארוך",
  rich: "עשיר",
  md: "Markdown",
  image: "תמונה",
  link: "קישור",
  strings: "רשימה",
  list: "פריטים",
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
    case "text": {
      const v = typeof value === "string" ? value : ""
      return (
        <div>
          <input
            type="text"
            value={v}
            onChange={(e) => onChange(e.target.value)}
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
        />
      )
    case "rich":
      return (
        <div>
          <AutoTextarea
            value={typeof value === "string" ? value : ""}
            onChange={onChange as (v: string) => void}
            rows={3}
            placeholder="שורה חדשה = מעבר שורה. *מילה* = הדגשה."
          />
          <p
            className="mt-1 text-[10px]"
            style={{ color: "var(--color-muted-foreground)", opacity: 0.5 }}
          >
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
          />
          <p
            className="mt-1 text-[10px]"
            style={{ color: "var(--color-muted-foreground)", opacity: 0.5 }}
          >
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
          />
          <div className="mt-1 flex justify-end">
            <span
              className="text-[10px]"
              style={{ color: "var(--color-muted-foreground)", opacity: 0.5 }}
            >
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
            onClick={() => {
              const blank: Record<string, unknown> = {}
              for (const f of itemFields)
                blank[f.key] = f.type === "boolean" ? false : ""
              onChange([...items, blank])
            }}
            className="w-full rounded-xl py-2.5 text-xs font-medium transition-all hover:opacity-80 flex items-center justify-center gap-1.5"
            style={{
              border: "1px dashed var(--color-border)",
              color: "var(--color-primary)",
            }}
          >
            <span className="text-sm">+</span> הוספת פריט
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
      className="rounded-xl overflow-hidden transition-all"
      style={{
        background: "var(--color-secondary)",
        border: "1px solid var(--color-border)",
      }}
    >
      <div
        className="flex items-center gap-2 px-3 py-2 cursor-pointer select-none"
        onClick={() => setOpen(!open)}
      >
        <span
          className="text-[10px] font-bold w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0"
          style={{
            background: "rgba(227,174,60,0.15)",
            color: "var(--color-primary)",
          }}
        >
          {idx + 1}
        </span>
        <span
          className="text-xs font-medium truncate flex-1"
          style={{ color: "var(--color-foreground)" }}
        >
          {title}
        </span>
        <div
          className="flex items-center gap-0.5 flex-shrink-0"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => onMove(-1)}
            disabled={idx === 0}
            className="p-0.5 rounded transition-opacity hover:opacity-80 disabled:opacity-20"
            style={{ color: "var(--color-muted-foreground)" }}
            title="העלה למעלה"
          >
            <span className="text-xs">▲</span>
          </button>
          <button
            onClick={() => onMove(1)}
            disabled={idx === total - 1}
            className="p-0.5 rounded transition-opacity hover:opacity-80 disabled:opacity-20"
            style={{ color: "var(--color-muted-foreground)" }}
            title="הורד למטה"
          >
            <span className="text-xs">▼</span>
          </button>
          <button
            onClick={onDuplicate}
            className="p-0.5 rounded transition-opacity hover:opacity-80"
            style={{ color: "var(--color-muted-foreground)" }}
            title="שכפל"
          >
            <Icon name="layers" size={12} />
          </button>
          <button
            onClick={onDelete}
            className="p-0.5 rounded transition-opacity hover:opacity-80"
            style={{ color: "var(--color-danger)" }}
            title="מחק"
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
          className="px-3 pb-3 space-y-2"
          style={{ borderTop: "1px solid var(--color-border)" }}
        >
          {fields.map((f) => (
            <div key={f.key} className="pt-2">
              <label
                className="text-[11px] font-medium mb-1 block"
                style={{ color: "var(--color-muted-foreground)" }}
              >
                {f.label}
              </label>
              {f.type === "textarea" || f.type === "md" ? (
                <AutoTextarea
                  value={String(item[f.key] ?? "")}
                  onChange={(v) => onChange({ ...item, [f.key]: v })}
                  rows={f.type === "md" ? 5 : 3}
                  mono={f.type === "md"}
                  style={{ fontSize: "11px", padding: "6px 8px" }}
                />
              ) : (
                <input
                  type="text"
                  value={String(item[f.key] ?? "")}
                  onChange={(e) =>
                    onChange({ ...item, [f.key]: e.target.value })
                  }
                  className="w-full rounded-lg px-2.5 py-1.5 text-xs"
                  style={inputStyle}
                  dir={f.type === "link" ? "ltr" : "rtl"}
                  onFocus={(e) => {
                    e.currentTarget.style.border = focusBorder
                    e.currentTarget.style.boxShadow = focusShadow
                  }}
                  onBlur={(e) => {
                    e.currentTarget.style.border = (inputStyle.border as string)
                    e.currentTarget.style.boxShadow = "none"
                  }}
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
    <div className="p-4" style={cardStyle}>
      <h3
        className="mb-3 text-sm font-bold flex items-center gap-2"
        style={{ color: "var(--color-foreground)" }}
      >
        <Icon name="eye" size={14} /> תצוגת Google
      </h3>
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
        <p
          className="mt-0.5 text-xs line-clamp-2"
          style={{ color: "var(--color-muted-foreground)" }}
        >
          {description || "ללא תיאור"}
        </p>
      </div>
      <div className="mt-2 flex gap-4 text-xs">
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
  const [searchQuery, setSearchQuery] = useState("")
  const [showSeo, setShowSeo] = useState(false)
  const [showModified, setShowModified] = useState(false)
  const [showPreview, setShowPreview] = useState(true)
  const [previewKey, setPreviewKey] = useState(0)
  const draftRef = useRef(draft)
  draftRef.current = draft

  useEffect(() => {
    setLoading(true)
    loadContent().finally(() => setLoading(false))
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

  const groupFields = useMemo(() => {
    const fields = fieldsOfGroup(activeGroup)
    if (!searchQuery) return fields
    const q = searchQuery.toLowerCase()
    return fields.filter(
      (f) =>
        f.label.toLowerCase().includes(q) || f.key.toLowerCase().includes(q),
    )
  }, [activeGroup, searchQuery])

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
      if (!field) return
      const res = await maestro.content.reset([key])
      if (res.error) {
        toast.error(`שגיאה: ${res.error.message}`)
        return
      }
      toast.success(`שוחזר: ${field.label}`)
      if (key in draft) {
        const next = { ...draft }
        delete next[key]
        setDraftState(next)
        setDraft(next)
      }
      const saved = getSaved()
      const newSaved = { ...saved }
      delete newSaved[key]
      applySaved(newSaved, [key])
    },
    [draft],
  )

  const handlePublish = useCallback(async () => {
    if (!canPublish || !Object.keys(draft).length) return
    setSaving(true)
    try {
      const res = await maestro.content.saveMany(draft)
      if (res.error) {
        toast.error(`שגיאה: ${res.error.message}`)
        return
      }
      const count = Object.keys(draft).length
      applySaved(draft)
      setDraftState({})
      setDraft({})
      toast.success(`פורסמו ${count} שינויים בהצלחה`)
    } finally {
      setSaving(false)
    }
  }, [draft, canPublish])

  const handleDiscard = useCallback(() => {
    if (!hasDraft()) return
    if (!confirm("לבטל את כל השינויים שלא פורסמו?")) return
    setDraftState({})
    setDraft({})
    toast.info("הטיוטה נמחקה")
  }, [])

  const activeGroupDef = EDITABLE_GROUPS.find((g) => g.id === activeGroup)
  const activeGroupLabel = activeGroupDef?.label ?? ""
  const previewPath = activeGroupDef?.path ?? "/"
  const hasSeo = !!FIELD_MAP[`${activeGroup}.seo.title`]

  const previewUrl = useMemo(() => {
    const url = new URL(previewPath, window.location.origin)
    url.searchParams.set("maestro-preview", "1")
    return url.toString()
  }, [previewPath, previewKey])

  useEffect(() => {
    if (!showPreview || draftCount === 0) return
    const timer = setTimeout(() => setPreviewKey((k) => k + 1), 800)
    return () => clearTimeout(timer)
  }, [draft, showPreview, draftCount])

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
  const visibleFields = showModified
    ? groupFields.filter((f) => isModified(f.key))
    : groupFields
  const btnBase = "rounded-lg px-3 py-1.5 text-sm font-medium transition-all"

  /* The editing-context bar: the quiet, always-visible answer to "where am
   * I and what am I editing?". Sits inside the existing admin chrome — no
   * overlay, no banner, nothing the customer-facing page ever renders. */
  const EditorContextBar = (
    <div
      className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl px-4 py-2.5"
      style={{
        background: "var(--color-card)",
        border: "1px solid var(--color-border)",
      }}
      dir="rtl"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
        <span
          className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-bold"
          style={{
            background: "rgba(227,174,60,0.14)",
            color: "var(--color-primary)",
          }}
        >
          <Icon name="pen" size={12} />
          עורך תוכן
        </span>
        <span
          className="truncate text-sm font-semibold"
          style={{ color: "var(--color-foreground)" }}
          title={activeGroupLabel}
        >
          {activeGroupLabel}
        </span>
        {draftCount > 0 && (
          <span
            className="inline-flex flex-shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium"
            style={{
              background: "rgba(227,174,60,0.1)",
              color: "var(--color-primary)",
            }}
          >
            {draftCount} שינויים שלא פורסמו
          </span>
        )}
      </div>
      <button
        onClick={() => navigate("/admin/cms/content-editor/content")}
        className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-opacity hover:opacity-70"
        style={{ color: "var(--color-muted-foreground)" }}
      >
        <Icon name="arrowRight" size={13} />
        חזרה לניהול התוכן
      </button>
    </div>
  )

  return (
    <div>
      {EditorContextBar}
      <div
        className="flex h-[calc(100vh-9rem)] rounded-xl overflow-hidden"
        style={{ border: "1px solid var(--color-border)" }}
      >
        {/* Group sidebar */}
        <div
          className="w-56 overflow-auto flex-shrink-0"
          style={{
            background: "var(--color-card)",
            borderLeft: "1px solid var(--color-border)",
          }}
        >
          <div className="p-2">
            <div className="relative">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="חיפוש קבוצה…"
                className="w-full rounded-lg py-2 pe-3 ps-8 text-xs"
                style={inputStyle}
                dir="rtl"
                aria-label="חיפוש קבוצת תוכן"
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
                  onClick={() => {
                    setActiveGroup(g.id)
                    setShowSeo(false)
                  }}
                  className="flex items-center justify-between w-full px-3 py-2 text-right text-sm rounded-lg transition-all"
                  style={{
                    background: active
                      ? "linear-gradient(90deg, rgba(227,174,60,0.16), rgba(227,174,60,0.05))"
                      : "transparent",
                    color: active
                      ? "var(--color-primary)"
                      : "var(--color-muted-foreground)",
                    boxShadow: active
                      ? "inset 3px 0 0 var(--color-primary)"
                      : "none",
                    fontWeight: active ? 600 : 400,
                  }}
                >
                  <span className="truncate">{g.label}</span>
                  {gModified > 0 && (
                    <span
                      className="flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold"
                      style={{
                        background: "rgba(227,174,60,0.2)",
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
            <p
              className="text-xs font-medium mb-1.5"
              style={{ color: "var(--color-muted-foreground)" }}
            >
              סטטיסטיקות
            </p>
            <div className="space-y-1">
              <div className="flex justify-between text-xs">
                <span
                  style={{
                    color: "var(--color-muted-foreground)",
                    opacity: 0.7,
                  }}
                >
                  שדות
                </span>
                <span style={{ color: "var(--color-foreground)" }}>
                  {FIELDS.length}
                </span>
              </div>
              <div className="flex justify-between text-xs">
                <span
                  style={{
                    color: "var(--color-muted-foreground)",
                    opacity: 0.7,
                  }}
                >
                  שונו
                </span>
                <span
                  style={{ color: "var(--color-primary)", fontWeight: 600 }}
                >
                  {modifiedCount}
                </span>
              </div>
              <div className="flex justify-between text-xs">
                <span
                  style={{
                    color: "var(--color-muted-foreground)",
                    opacity: 0.7,
                  }}
                >
                  בטיוטה
                </span>
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
          className="flex-1 overflow-auto p-4"
          style={{ background: "var(--color-background)" }}
        >
          <div className="mb-4 flex items-center justify-between flex-wrap gap-2">
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
                    background: "rgba(227,174,60,0.12)",
                    color: "var(--color-primary)",
                  }}
                >
                  <Icon name="pen" size={10} />
                  {draftCount} שינויים שלא פורסמו
                </span>
              )}
            </div>
            <div className="flex gap-2 flex-wrap">
              <button
                onClick={() => setShowModified(!showModified)}
                className={btnBase}
                style={{
                  border: "1px solid var(--color-border)",
                  background: showModified
                    ? "rgba(227,174,60,0.12)"
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
                      ? "rgba(34,197,94,0.12)"
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
                className={btnBase}
                style={{
                  border: "1px solid var(--color-border)",
                  background: showPreview
                    ? "rgba(227,174,60,0.12)"
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
                    className={btnBase}
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
                    background: "rgba(227,174,60,0.08)",
                    border: "1px solid rgba(227,174,60,0.2)",
                    color: "var(--color-primary)",
                  }}
                >
                  שמור כטיוטה — רק מנהל יכול לפרסם
                </span>
              )}
            </div>
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

          <div className="space-y-3">
            {visibleFields.map((field) => {
              const modified = isModified(field.key)
              return (
                <div
                  key={field.key}
                  className="rounded-xl p-4"
                  style={{
                    ...cardStyle,
                    borderColor: modified
                      ? "rgba(227,174,60,0.3)"
                      : "var(--color-border)",
                  }}
                >
                  <div className="flex items-center justify-between mb-2">
                    <label
                      className="text-sm font-medium flex items-center gap-2"
                      style={{ color: "var(--color-foreground)" }}
                    >
                      {field.label}
                      <span
                        className="text-[10px] px-1.5 py-0.5 rounded-md"
                        style={{
                          background: "var(--color-secondary)",
                          color: "var(--color-muted-foreground)",
                          opacity: 0.7,
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
                        onClick={() => handleResetField(field.key)}
                        className="text-xs transition-opacity hover:opacity-70"
                        style={{ color: "var(--color-muted-foreground)" }}
                        title="שחזור לברירת המחדל"
                      >
                        שחזר ברירת מחדל
                      </button>
                    )}
                  </div>
                  {field.hint && (
                    <p
                      className="mb-1.5 text-xs"
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
                      field.key in draft ? draft[field.key] : getRaw(field.key)
                    }
                    onChange={(v) => handleChange(field.key, v)}
                  />
                  <p
                    className="mt-2 text-[10px] font-mono"
                    dir="ltr"
                    style={{
                      color: "var(--color-muted-foreground)",
                      opacity: 0.3,
                    }}
                  >
                    {field.key}
                  </p>
                </div>
              )
            })}
            {!visibleFields.length && (
              <p
                className="text-sm"
                style={{ color: "var(--color-muted-foreground)" }}
              >
                {showModified
                  ? "אין שדות ששונו בקבוצה זו."
                  : "אין שדות לקבוצה זו."}
              </p>
            )}
          </div>
        </div>

        {/* Live preview pane */}
        {showPreview && (
          <div
            className="flex-shrink-0 flex flex-col overflow-hidden"
            style={{
              width: "480px",
              borderLeft: "1px solid var(--color-border)",
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
                  onClick={() => setPreviewKey((k) => k + 1)}
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
                src={previewUrl}
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
