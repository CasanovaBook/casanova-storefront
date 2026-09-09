/* ─────────────────────────────────────────────────────────────
 * CRM — sales pipeline, follow-up tasks and the transactional
 * email log.
 *
 * Every row comes from the persisted database: leads, notes and
 * tasks are created here (or by a storefront enquiry) and read back
 * through the store, so nothing is held in component state and a
 * reload never resurrects demo content.
 * ───────────────────────────────────────────────────────────── */

import { useState } from "react"

import { useAdmin } from "../../context/AdminContext"

import { useCms } from "../../context/CmsContext"

import { can } from "../../lib/permissions"

import type {
  CrmLead,
  CrmTask,
  EmailStatus,
  LeadSource,
  LeadStage,
  NoteCategory,
  TaskPriority,
} from "../../types"

import AccessDenied from "../../components/AccessDenied"

import Icon, { type IconName } from "../../components/icons"

const STAGES: LeadStage[] = ["NEW", "CONTACTED", "INTERESTED", "WON", "LOST"]

const STAGE_META: Record<LeadStage, { label: string, color: string }> = {
  NEW: { label: "חדש", color: "#3B82F6" },

  CONTACTED: { label: "נוצר קשר", color: "#F59E0B" },

  INTERESTED: { label: "מתעניין", color: "#A855F7" },

  WON: { label: "נסגר", color: "var(--color-success)" },

  LOST: { label: "אבד", color: "#6B7280" },
}

const SOURCE_LABEL: Record<LeadSource, string> = {
  LANDING_PAGE: "עמוד נחיתה",

  STORE: "החנות",

  REFERRAL: "הפניה",

  CAMPAIGN: "קמפיין",

  MANUAL: "ידני",

  MOBILE_APP: "אפליקציה",
}

const PRIORITY_LABEL: Record<TaskPriority, { label: string, color: string }> = {
  HIGH: { label: "גבוהה", color: "var(--color-danger)" },

  MEDIUM: { label: "בינונית", color: "#F59E0B" },

  LOW: { label: "נמוכה", color: "var(--color-muted-foreground)" },
}

const NOTE_CATEGORY_META: Record<NoteCategory, {
  label: string
  icon: IconName
}> = {
  CALL: { label: "שיחה", icon: "phone" },

  EMAIL: { label: "מייל", icon: "mail" },

  MEETING: { label: "פגישה", icon: "users" },

  GENERAL: { label: "כללי", icon: "pen" },
}

const EMAIL_STATUS_LABEL: Record<EmailStatus, { label: string, color: string }> =
  {
    QUEUED: { label: "בתור", color: "#F59E0B" },

    SENT: { label: "נשלח", color: "#3B82F6" },

    FAILED: { label: "נכשל", color: "var(--color-danger)" },

    DELIVERED: { label: "התקבל", color: "var(--color-success)" },
  }

const inputStyle = {
  background: "var(--color-secondary)",

  borderColor: "var(--color-border)",

  color: "var(--color-foreground)",
} as const

const inputClass = "w-full px-4 py-2.5 rounded-lg border text-sm outline-none"

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
      <div className="card-glow w-full max-w-xl p-6 max-h-[85vh] overflow-y-auto">
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

/* ── Lead detail ──────────────────────────────────────── */

function LeadModal({
  lead,

  productName,

  onClose,
}: {
  lead: CrmLead

  productName: string

  onClose: () => void
}) {
  const { crmNotes, setLeadStage, addLeadNote, deleteLead } = useAdmin()

  const [noteDraft, setNoteDraft] = useState("")

  const [category, setCategory] = useState<NoteCategory>("GENERAL")

  const [error, setError] = useState("")

  const notes = crmNotes

    .filter((n) => n.lead_id === lead.lead_id)

    .slice()

    .sort((a, b) => b.created_at.localeCompare(a.created_at))

  const submitNote = () => {
    if (!noteDraft.trim()) return

    const result = addLeadNote(lead.lead_id, noteDraft.trim(), category)

    if (!result.ok) {
      setError(result.error)

      return
    }

    setError("")

    setNoteDraft("")
  }

  return (
    <ModalShell title={`כרטיס ליד — ${lead.full_name}`} onClose={onClose}>
      {error && (
        <p
          className="text-xs px-3 py-2 rounded-lg mb-4"
          style={{
            background: "rgba(239,68,68,0.1)",
            color: "var(--color-danger)",
          }}
        >
          {error}
        </p>
      )}

      <div className="grid grid-cols-2 gap-3 mb-5">
        {[
          { label: "אימייל", value: lead.email, ltr: true },

          { label: "טלפון", value: lead.phone ?? "—", ltr: true },

          {
            label: "מקור",
            value: SOURCE_LABEL[lead.source] ?? lead.source,
            ltr: false,
          },

          { label: "מוצר שמעניין אותו", value: productName, ltr: false },

          {
            label: "נוצר בתאריך",
            value: new Date(lead.created_at).toLocaleDateString("he-IL"),
            ltr: false,
          },

          {
            label: "קשר אחרון",

            value: lead.last_contact_at
              ? new Date(lead.last_contact_at).toLocaleDateString("he-IL")
              : "אין",

            ltr: false,
          },
        ].map(({ label, value, ltr }) => (
          <div
            key={label}
            className="p-3 rounded-md"
            style={{ background: "var(--color-secondary)" }}
          >
            <p
              className="text-xs mb-0.5"
              style={{ color: "var(--color-muted-foreground)" }}
            >
              {label}
            </p>
            <p
              className="text-sm font-medium truncate"
              dir={ltr ? "ltr" : undefined}
            >
              {value}
            </p>
          </div>
        ))}
      </div>

      {lead.tags.length > 0 && (
        <div className="flex gap-2 flex-wrap mb-5">
          {lead.tags.map((t) => (
            <span
              key={t}
              className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full"
              style={{
                background: "rgba(212,160,48,0.1)",

                color: "var(--color-primary)",

                border: "1px solid rgba(212,160,48,0.25)",
              }}
            >
              <Icon name="tag" size={11} /> {t}
            </span>
          ))}
        </div>
      )}

      <div className="mb-6">
        <p
          className="text-xs font-semibold mb-2"
          style={{ color: "var(--color-muted-foreground)" }}
        >
          שלב בצינור
        </p>
        <div className="flex gap-2 flex-wrap">
          {STAGES.map((s) => (
            <button
              key={s}
              onClick={() => {
                const result = setLeadStage(lead.lead_id, s)

                setError(result.ok ? "" : result.error)
              }}
              className="px-3 py-1.5 rounded-full text-xs font-medium border transition-all"
              style={{
                background:
                  lead.stage === s ? STAGE_META[s].color : "transparent",

                color:
                  lead.stage === s ? "#fff" : "var(--color-muted-foreground)",

                borderColor:
                  lead.stage === s
                    ? STAGE_META[s].color
                    : "var(--color-border)",
              }}
            >
              {STAGE_META[s].label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <p
          className="text-xs font-semibold mb-3"
          style={{ color: "var(--color-muted-foreground)" }}
        >
          יומן תקשורת ({notes.length})
        </p>
        {notes.length === 0 ? (
          <p
            className="text-sm mb-3"
            style={{ color: "var(--color-muted-foreground)" }}
          >
            אין רישומים עדיין.
          </p>
        ) : (
          <div className="space-y-2 mb-4">
            {notes.map((n) => (
              <div
                key={n.note_id}
                className="p-3 rounded-md border"
                style={{
                  borderColor: "var(--color-border)",
                  background: "var(--color-background)",
                }}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span style={{ color: "var(--color-primary)" }}>
                    <Icon
                      name={NOTE_CATEGORY_META[n.category]?.icon ?? "pen"}
                      size={13}
                    />
                  </span>
                  <span className="text-xs font-medium">
                    {NOTE_CATEGORY_META[n.category]?.label ?? n.category}
                  </span>
                  <span
                    className="text-xs"
                    style={{ color: "var(--color-muted-foreground)" }}
                  >
                    · {n.author}
                  </span>
                  <span
                    className="text-xs mr-auto"
                    style={{ color: "var(--color-muted-foreground)" }}
                  >
                    {new Date(n.created_at).toLocaleDateString("he-IL", {
                      day: "numeric",

                      month: "short",

                      hour: "2-digit",

                      minute: "2-digit",
                    })}
                  </span>
                </div>
                <p className="text-sm leading-relaxed">{n.content}</p>
              </div>
            ))}
          </div>
        )}

        <div className="flex gap-2 mb-3">
          <select
            className="px-3 py-2.5 rounded-lg border text-sm outline-none"
            style={inputStyle}
            value={category}
            onChange={(e) => setCategory(e.target.value as NoteCategory)}
          >
            {(Object.keys(NOTE_CATEGORY_META) as NoteCategory[]).map((c) => (
              <option key={c} value={c}>
                {NOTE_CATEGORY_META[c].label}
              </option>
            ))}
          </select>
          <input
            className="flex-1 px-4 py-2.5 rounded-lg border text-sm outline-none"
            style={inputStyle}
            placeholder="הוסיפו הערה חדשה..."
            value={noteDraft}
            onChange={(e) => setNoteDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitNote()
            }}
          />
          <button
            className="btn-gradient px-4 py-2 rounded-full text-sm font-semibold disabled:opacity-40"
            disabled={!noteDraft.trim()}
            onClick={submitNote}
          >
            הוספה
          </button>
        </div>

        <button
          onClick={() => {
            if (!window.confirm(`למחוק את כרטיס הליד של ${lead.full_name}?`))
              return

            const result = deleteLead(lead.lead_id)

            if (!result.ok) setError(result.error)
            else onClose()
          }}
          className="text-xs px-3 py-1.5 rounded-full border"
          style={{
            borderColor: "rgba(239,68,68,0.3)",
            color: "var(--color-danger)",
          }}
        >
          מחיקת הליד
        </button>
      </div>
    </ModalShell>
  )
}

/* ── Lead creation ────────────────────────────────────── */

function NewLeadModal({ onClose }: { onClose: () => void }) {
  const { saveLead } = useAdmin()

  const { products } = useCms()

  const [form, setForm] = useState({
    full_name: "",

    email: "",

    phone: "",

    source: "MANUAL" as LeadSource,

    stage: "NEW" as LeadStage,

    interested_product_id: "",

    tags: "",
  })

  const [error, setError] = useState("")

  const submit = () => {
    if (!form.full_name.trim()) return setError("שם מלא חובה.")

    if (!form.email.trim()) return setError("כתובת אימייל חובה.")

    const result = saveLead({
      full_name: form.full_name.trim(),

      email: form.email.trim(),

      phone: form.phone.trim() || undefined,

      source: form.source,

      stage: form.stage,

      interested_product_id: form.interested_product_id || undefined,

      tags: form.tags

        .split(",")

        .map((t) => t.trim())

        .filter(Boolean),
    })

    if (!result.ok) {
      setError(result.error)

      return
    }

    onClose()

    return undefined
  }

  return (
    <ModalShell title="ליד חדש" onClose={onClose}>
      {error && (
        <p
          className="text-xs px-3 py-2 rounded-lg mb-4"
          style={{
            background: "rgba(239,68,68,0.1)",
            color: "var(--color-danger)",
          }}
        >
          {error}
        </p>
      )}
      <div className="space-y-3">
        <input
          className={inputClass}
          style={inputStyle}
          placeholder="שם מלא"
          value={form.full_name}
          onChange={(e) => setForm({ ...form, full_name: e.target.value })}
        />
        <div className="grid grid-cols-2 gap-3">
          <input
            dir="ltr"
            className={inputClass}
            style={inputStyle}
            placeholder="email@example.com"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
          <input
            dir="ltr"
            className={inputClass}
            style={inputStyle}
            placeholder="טלפון"
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <select
            className={inputClass}
            style={inputStyle}
            value={form.source}
            onChange={(e) =>
              setForm({ ...form, source: e.target.value as LeadSource })
            }
          >
            {(Object.keys(SOURCE_LABEL) as LeadSource[]).map((s) => (
              <option key={s} value={s}>
                {SOURCE_LABEL[s]}
              </option>
            ))}
          </select>
          <select
            className={inputClass}
            style={inputStyle}
            value={form.stage}
            onChange={(e) =>
              setForm({ ...form, stage: e.target.value as LeadStage })
            }
          >
            {STAGES.map((s) => (
              <option key={s} value={s}>
                {STAGE_META[s].label}
              </option>
            ))}
          </select>
        </div>
        <select
          className={inputClass}
          style={inputStyle}
          value={form.interested_product_id}
          onChange={(e) =>
            setForm({ ...form, interested_product_id: e.target.value })
          }
        >
          <option value="">מוצר רלוונטי — ללא</option>
          {products.map((p) => (
            <option key={p.product_id} value={p.product_id}>
              {p.name}
            </option>
          ))}
        </select>
        <input
          className={inputClass}
          style={inputStyle}
          placeholder="תגיות (מופרדות בפסיקים)"
          value={form.tags}
          onChange={(e) => setForm({ ...form, tags: e.target.value })}
        />
        <button
          onClick={submit}
          className="btn-gradient w-full py-2.5 rounded-full font-semibold text-sm"
        >
          שמירת הליד
        </button>
      </div>
    </ModalShell>
  )
}

/* ── Task creation ────────────────────────────────────── */

function NewTaskModal({ onClose }: { onClose: () => void }) {
  const { saveTask, leads } = useAdmin()

  const [form, setForm] = useState({
    title: "",

    lead_id: "",

    due_date: new Date().toISOString().slice(0, 10),

    priority: "MEDIUM" as TaskPriority,
  })

  const [error, setError] = useState("")

  const submit = () => {
    if (!form.title.trim()) return setError("כותרת המשימה חובה.")

    if (!form.due_date) return setError("תאריך יעד חובה.")

    const lead = leads.find((l) => l.lead_id === form.lead_id)

    const result = saveTask({
      title: form.title.trim(),

      lead_id: lead?.lead_id,

      lead_name: lead?.full_name,

      due_date: form.due_date,

      priority: form.priority,

      done: false,
    })

    if (!result.ok) {
      setError(result.error)

      return
    }

    onClose()

    return undefined
  }

  return (
    <ModalShell title="משימת מעקב חדשה" onClose={onClose}>
      {error && (
        <p
          className="text-xs px-3 py-2 rounded-lg mb-4"
          style={{
            background: "rgba(239,68,68,0.1)",
            color: "var(--color-danger)",
          }}
        >
          {error}
        </p>
      )}
      <div className="space-y-3">
        <input
          className={inputClass}
          style={inputStyle}
          placeholder="כותרת המשימה"
          value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
        />
        <select
          className={inputClass}
          style={inputStyle}
          value={form.lead_id}
          onChange={(e) => setForm({ ...form, lead_id: e.target.value })}
        >
          <option value="">קשורה לליד — ללא</option>
          {leads.map((l) => (
            <option key={l.lead_id} value={l.lead_id}>
              {l.full_name}
            </option>
          ))}
        </select>
        <div className="grid grid-cols-2 gap-3">
          <input
            dir="ltr"
            type="date"
            className={inputClass}
            style={inputStyle}
            value={form.due_date}
            onChange={(e) => setForm({ ...form, due_date: e.target.value })}
          />
          <select
            className={inputClass}
            style={inputStyle}
            value={form.priority}
            onChange={(e) =>
              setForm({ ...form, priority: e.target.value as TaskPriority })
            }
          >
            {(Object.keys(PRIORITY_LABEL) as TaskPriority[]).map((p) => (
              <option key={p} value={p}>
                עדיפות {PRIORITY_LABEL[p].label}
              </option>
            ))}
          </select>
        </div>
        <button
          onClick={submit}
          className="btn-gradient w-full py-2.5 rounded-full font-semibold text-sm"
        >
          שמירת המשימה
        </button>
      </div>
    </ModalShell>
  )
}

/* ── Main page ────────────────────────────────────────── */

export default function AdminCrmPage() {
  const {
    leads,
    tasks,
    crmNotes,
    emailLogs,
    adminRole,
    toggleTask,
    deleteTask,
  } = useAdmin()

  const { productById } = useCms()

  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null)

  const [showNewLead, setShowNewLead] = useState(false)

  const [showNewTask, setShowNewTask] = useState(false)

  const [tab, setTab] = useState<"PIPELINE" | "TASKS" | "EMAILS">("PIPELINE")

  const [search, setSearch] = useState("")

  const [notice, setNotice] = useState("")

  if (!can(adminRole, "crm"))
    return <AccessDenied page="CRM — ניהול לקוחות ולמידים" />

  const productName = (id?: string) => productById(id)?.name ?? "—"

  const query = search.trim().toLowerCase()

  const filtered = leads.filter((l) =>
    `${l.full_name} ${l.email} ${l.phone ?? ""} ${l.tags.join(" ")}`
      .toLowerCase()
      .includes(query),
  )

  const openTasks = tasks.filter((t) => !t.done).length

  const won = leads.filter((l) => l.stage === "WON").length

  const closed = leads.filter(
    (l) => l.stage === "WON" || l.stage === "LOST",
  ).length

  const conversion = closed > 0 ? Math.round((won / closed) * 100) : 0

  const active = leads.filter(
    (l) => l.stage !== "WON" && l.stage !== "LOST",
  ).length

  const selectedLead = leads.find((l) => l.lead_id === selectedLeadId) ?? null

  const run = (
    result: { ok: boolean, error?: string },
    successMessage?: string,
  ) => {
    if (!result.ok) {
      setNotice(result.error ?? "הפעולה נכשלה.")

      return
    }

    setNotice(successMessage ?? "")
  }

  const tabs: {
    id: "PIPELINE" | "TASKS" | "EMAILS"
    icon: IconName
    label: string
  }[] = [
    { id: "PIPELINE", icon: "target", label: "לידים וצינור מכירות" },

    {
      id: "TASKS",
      icon: "checkCircle",
      label: `משימות מעקב${openTasks > 0 ? ` (${openTasks})` : ""}`,
    },

    { id: "EMAILS", icon: "mail", label: "יומן מיילים" },
  ]

  return (
    <div className="max-w-6xl mx-auto page-enter">
      <div className="flex items-center justify-between gap-4 mb-8 flex-wrap">
        <div>
          <h1 className="font-display text-4xl font-semibold mb-1">
            CRM — ניהול לקוחות ולמידים
          </h1>
          <p style={{ color: "var(--color-muted-foreground)" }}>
            צינור מכירות, משימות מעקב ויומן תקשורת — הכול במקום אחד.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowNewTask(true)}
            className="px-4 py-2.5 rounded-full border text-sm transition-colors hover:bg-white/5"
            style={{
              borderColor: "var(--color-border)",
              color: "var(--color-foreground)",
            }}
          >
            + משימה
          </button>
          <button
            onClick={() => setShowNewLead(true)}
            className="btn-gradient px-5 py-2.5 rounded-full font-semibold text-sm"
          >
            + ליד חדש
          </button>
        </div>
      </div>

      {notice && (
        <p
          className="text-xs px-4 py-2.5 rounded-lg mb-4 flex items-center justify-between gap-3"
          style={{
            background: "rgba(239,68,68,0.1)",
            color: "var(--color-danger)",
          }}
        >
          {notice}
          <button onClick={() => setNotice("")}>
            <Icon name="x" size={13} />
          </button>
        </p>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        {([
          { icon: "target", label: "לידים פעילים", value: active },

          { icon: "trophy", label: "נסגרו", value: won },

          { icon: "trendUp", label: "אחוז המרה", value: `${conversion}%` },

          { icon: "clock", label: "משימות פתוחות", value: openTasks },
        ] as { icon: IconName, label: string, value: number | string }[])

          .map(({ icon, label, value }) => (
            <div key={label} className="card-glow p-5">
              <div
                className="w-9 h-9 rounded-lg flex items-center justify-center mb-3"
                style={{
                  background: "rgba(227,174,60,0.12)",
                  color: "var(--color-primary)",
                }}
              >
                <Icon name={icon} size={17} />
              </div>
              <p
                className="font-display text-3xl font-semibold mb-1"
                style={{ color: "var(--color-primary)" }}
              >
                {value}
              </p>
              <p
                className="text-xs"
                style={{ color: "var(--color-muted-foreground)" }}
              >
                {label}
              </p>
            </div>
          ))}
      </div>

      <div className="flex gap-2 mb-6 flex-wrap">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className="flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium border transition-all"
            style={{
              background: tab === t.id ? "var(--color-primary)" : "transparent",

              color:
                tab === t.id
                  ? "var(--color-primary-foreground)"
                  : "var(--color-muted-foreground)",

              borderColor:
                tab === t.id ? "var(--color-primary)" : "var(--color-border)",
            }}
          >
            <Icon name={t.icon} size={14} /> {t.label}
          </button>
        ))}
      </div>

      {tab === "PIPELINE" && (
        <>
          <div className="mb-4">
            <input
              className={`${inputClass} max-w-sm`}
              style={inputStyle}
              placeholder="חיפוש ליד לפי שם, אימייל, טלפון או תגית..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          {leads.length === 0 ? (
            <div
              className="rounded-lg border border-dashed p-12 text-center"
              style={{ borderColor: "var(--color-border)" }}
            >
              <Icon
                name="target"
                size={28}
                style={{ color: "var(--color-muted-foreground)" }}
              />
              <p className="mt-3 font-medium">
                אין עדיין לידים בצינור המכירות.
              </p>
              <p
                className="text-sm mt-1 mb-5"
                style={{ color: "var(--color-muted-foreground)" }}
              >
                לידים נוצרים כאן ידנית או מפניות שמגיעות מהאתר.
              </p>
              <button
                onClick={() => setShowNewLead(true)}
                className="btn-gradient px-6 py-2.5 rounded-full font-semibold text-sm"
              >
                + הוספת הליד הראשון
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 items-start">
              {STAGES.map((stage) => {
                const stageLeads = filtered.filter((l) => l.stage === stage)

                return (
                  <div key={stage} className="card-glow p-3">
                    <div className="flex items-center gap-2 mb-3 px-1">
                      <span
                        className="w-2 h-2 rounded-full"
                        style={{ background: STAGE_META[stage].color }}
                      />
                      <p className="text-xs font-semibold">
                        {STAGE_META[stage].label}
                      </p>
                      <span
                        className="text-xs mr-auto px-1.5 rounded-full"
                        style={{
                          background: "var(--color-secondary)",
                          color: "var(--color-muted-foreground)",
                        }}
                      >
                        {stageLeads.length}
                      </span>
                    </div>
                    <div className="space-y-2">
                      {stageLeads.map((lead) => (
                        <button
                          key={lead.lead_id}
                          onClick={() => setSelectedLeadId(lead.lead_id)}
                          className="w-full text-right p-3 rounded-lg border transition-all hover:border-yellow-600/40"
                          style={{
                            background: "var(--color-background)",
                            borderColor: "var(--color-border)",
                          }}
                        >
                          <p className="text-sm font-medium mb-0.5">
                            {lead.full_name}
                          </p>
                          <p
                            className="text-xs truncate mb-1.5"
                            dir="ltr"
                            style={{ color: "var(--color-muted-foreground)" }}
                          >
                            {lead.email}
                          </p>
                          <div className="flex items-center justify-between">
                            <span
                              className="flex items-center gap-1 text-xs truncate"
                              style={{ color: "var(--color-muted-foreground)" }}
                            >
                              <Icon
                                name="book"
                                size={11}
                                className="flex-shrink-0"
                              />{" "}
                              {productName(lead.interested_product_id)}
                            </span>
                            <span
                              className="flex items-center gap-1 text-xs flex-shrink-0"
                              style={{ color: "var(--color-muted-foreground)" }}
                            >
                              <Icon name="message" size={11} />{" "}
                              {
                                crmNotes.filter(
                                  (n) => n.lead_id === lead.lead_id,
                                ).length
                              }
                            </span>
                          </div>
                        </button>
                      ))}
                      {stageLeads.length === 0 && (
                        <p
                          className="text-xs text-center py-4"
                          style={{ color: "var(--color-muted-foreground)" }}
                        >
                          {leads.length === filtered.length
                            ? "אין לידים בשלב זה"
                            : "אין תוצאות תואמות"}
                        </p>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}

      {tab === "TASKS" && (
        <div className="card-glow overflow-hidden">
          {tasks.length === 0 ? (
            <p
              className="text-sm text-center py-10"
              style={{ color: "var(--color-muted-foreground)" }}
            >
              אין משימות מעקב.
            </p>
          ) : (
            <div
              className="divide-y"
              style={{ borderColor: "var(--color-border)" }}
            >
              {tasks

                .slice()

                .sort(
                  (a, b) =>
                    Number(a.done) - Number(b.done) ||
                    a.due_date.localeCompare(b.due_date),
                )

                .map((task: CrmTask) => {
                  const overdue =
                    !task.done && new Date(task.due_date).getTime() < Date.now()

                  return (
                    <div
                      key={task.task_id}
                      className="flex items-center gap-4 px-5 py-4"
                    >
                      <button
                        onClick={() => run(toggleTask(task.task_id))}
                        title={task.done ? "סימון כלא בוצע" : "סימון כבוצע"}
                        className="w-5 h-5 rounded-full border flex items-center justify-center text-xs flex-shrink-0 transition-all"
                        style={{
                          borderColor: task.done
                            ? "var(--color-success)"
                            : "var(--color-border)",

                          background: task.done
                            ? "var(--color-success)"
                            : "transparent",

                          color: "#fff",
                        }}
                      >
                        {task.done && <Icon name="check" size={11} />}
                      </button>
                      <div className="flex-1 min-w-0">
                        <p
                          className="text-sm font-medium mb-0.5"
                          style={{
                            textDecoration: task.done ? "line-through" : "none",

                            color: task.done
                              ? "var(--color-muted-foreground)"
                              : undefined,
                          }}
                        >
                          {task.title}
                        </p>
                        <p
                          className="text-xs"
                          style={{ color: "var(--color-muted-foreground)" }}
                        >
                          {task.lead_name
                            ? `קשור לליד: ${task.lead_name} · `
                            : ""}
                          יעד:{" "}
                          <span
                            style={{
                              color: overdue
                                ? "var(--color-danger)"
                                : undefined,
                            }}
                          >
                            {new Date(task.due_date).toLocaleDateString(
                              "he-IL",
                              { day: "numeric", month: "short" },
                            )}
                            {overdue && " — באיחור"}
                          </span>
                        </p>
                      </div>
                      <span
                        className="text-xs px-2.5 py-1 rounded-full flex-shrink-0"
                        style={{
                          background: "var(--color-secondary)",
                          color: PRIORITY_LABEL[task.priority].color,
                        }}
                      >
                        עדיפות {PRIORITY_LABEL[task.priority].label}
                      </span>
                      <button
                        onClick={() => run(deleteTask(task.task_id))}
                        title="מחיקת המשימה"
                        className="flex-shrink-0"
                        style={{ color: "var(--color-muted-foreground)" }}
                      >
                        <Icon name="x" size={13} />
                      </button>
                    </div>
                  )
                })}
            </div>
          )}
        </div>
      )}

      {tab === "EMAILS" && (
        <>
          <p
            className="text-xs mb-3"
            style={{ color: "var(--color-muted-foreground)" }}
          >
            היומן משקף כל הודעה שהמערכת ניסתה לשלוח. כל עוד לא הוגדר ספק דואר
            בהגדרות המערכת, ההודעות נשארות בסטטוס ״בתור״ ולא נמסרות בפועל.
          </p>
          <div
            className="rounded-lg border overflow-x-auto"
            style={{ borderColor: "var(--color-border)" }}
          >
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: "var(--color-secondary)" }}>
                  {["נמען", "תבנית", "נושא", "סטטוס", "נשלח בתאריך"].map(
                    (col) => (
                      <th
                        key={col}
                        className="text-right px-5 py-3 text-xs tracking-wide whitespace-nowrap"
                        style={{
                          color: "var(--color-muted-foreground)",
                          borderBottom: "1px solid var(--color-border)",
                        }}
                      >
                        {col}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {emailLogs.length === 0 ? (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-5 py-10 text-center text-sm"
                      style={{ color: "var(--color-muted-foreground)" }}
                    >
                      אין רשומות מייל עדיין.
                    </td>
                  </tr>
                ) : (
                  emailLogs.map((log, i) => (
                    <tr
                      key={log.email_log_id}
                      style={{
                        background:
                          i % 2 === 0
                            ? "var(--color-card)"
                            : "var(--color-background)",

                        borderBottom: "1px solid var(--color-border)",
                      }}
                    >
                      <td className="px-5 py-3">
                        <p className="font-medium">
                          {log.recipient_name ?? "—"}
                        </p>
                        <p
                          className="text-xs"
                          dir="ltr"
                          style={{ color: "var(--color-muted-foreground)" }}
                        >
                          {log.recipient}
                        </p>
                      </td>
                      <td
                        className="px-5 py-3 text-xs"
                        style={{ color: "var(--color-muted-foreground)" }}
                      >
                        {log.template}
                      </td>
                      <td className="px-5 py-3">
                        <p className="text-sm">{log.subject}</p>
                        {log.failure_reason && (
                          <p
                            className="text-xs"
                            style={{ color: "var(--color-danger)" }}
                          >
                            {log.failure_reason}
                          </p>
                        )}
                      </td>
                      <td className="px-5 py-3">
                        <span
                          className="text-xs px-2.5 py-0.5 rounded-full whitespace-nowrap"
                          style={{
                            background: "var(--color-secondary)",
                            color: EMAIL_STATUS_LABEL[log.status].color,
                          }}
                        >
                          {EMAIL_STATUS_LABEL[log.status].label}
                        </span>
                      </td>
                      <td
                        className="px-5 py-3 text-xs whitespace-nowrap"
                        style={{ color: "var(--color-muted-foreground)" }}
                      >
                        {new Date(log.sent_at).toLocaleDateString("he-IL", {
                          day: "numeric",

                          month: "short",

                          hour: "2-digit",

                          minute: "2-digit",
                        })}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {selectedLead && (
        <LeadModal
          lead={selectedLead}
          productName={productName(selectedLead.interested_product_id)}
          onClose={() => setSelectedLeadId(null)}
        />
      )}
      {showNewLead && <NewLeadModal onClose={() => setShowNewLead(false)} />}
      {showNewTask && <NewTaskModal onClose={() => setShowNewTask(false)} />}
    </div>
  )
}
