import { useEffect, useState } from "react"
import { taskProgress } from "../../lib/taskProgress"
import { Icon } from "./EditorToolbar"
import LayerStack, { EyeButton, describe } from "./LayerStack"
import { ChecklistProgress, PinChecklist, PinTimeline, ProgressTracker, field } from "./PinParts"
import ChecklistPhotos from "../ChecklistPhotos"
import { PinActionsSection, PinCommunicationSection, PinIssuesSection, PinReportsSection, usePinPanelData, type PinPanelData } from "./PinRecordSections"
import { clientActionPath, clientPinStatus, openClientPath } from "../../lib/clientPortalModel"
import { pinSectionsFor, readPinSection, sectionLabel, type PinSection } from "../../lib/pinRecordsModel"
import { useToast } from "../../lib/toast"
import { usePinQa } from "../../lib/pinQa"
import { SkeletonList } from "../ui/Skeleton"
import {
  annotationColors,
  annotationKindLabels,
  categoryLabels,
  formatMeters,
  isPointKind,
  statusChip,
  statusDot,
  statusLabels,
  useChecklist,
  useSignedUrl,
  type Annotation,
  type AnnotationColor,
  type Blueprint,
  type HistoryEntry,
  type Pin,
  type PinStatus,
  type Revision,
} from "../../lib/blueprints"
import { areaSquareMeters, formatArea, lengthMeters, polygonAreaPx, polylineLengthPx } from "../../lib/geometry"
import type { AlignMode } from "../../lib/arrange"
import { canMoveLayer, sortByLayer, type LayerAction } from "../../lib/layers"
import { disciplineLabels, type TeamMember } from "../../lib/projects"
import { symbolByKey, type SymbolKey } from "../../lib/symbols"

export type EditorRole = "engineer" | "foreman" | "client" | "admin"
export type SheetTab = "pins" | "layers" | "history" | "sheet"
export type LayerVisibility = { pins: boolean; notes: boolean; shapes: boolean; drawings: boolean }
export type AnnotationPatch = { text?: string; color?: AnnotationColor; opacity?: number; stroke?: number; font_size?: number; locked?: boolean; w?: number; rotation?: number }

// Everything that works on the current selection (one or many items). Provided by the editor.
export type SelectionActions = {
  align: (mode: AlignMode) => void
  alignToSheet: (mode: AlignMode) => void
  distribute: (axis: "horizontal" | "vertical") => void
  group: () => void
  ungroup: () => void
  copy: () => void
  duplicate: () => void
  paste: () => void
  remove: () => void
  setLocked: (locked: boolean) => void
  layer: (action: LayerAction) => void
  copyStyle: () => void
  applyStyle: () => void
  hasStyle: boolean
  hasClipboard: boolean
}

const allStatuses = (Object.keys(statusLabels) as PinStatus[]).filter(status => status !== "for_review")
const workStatus = (status: PinStatus) => clientPinStatus(status) as PinStatus
const today = () => new Date().toISOString().slice(0, 10)
const prettyDate = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString("en-PH", { day: "numeric", month: "short", year: "numeric" })
const timeFmt = (iso: string) => new Date(iso).toLocaleString("en-PH", { timeZone: "Asia/Manila", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })

function ChecklistSummary({ pinId }: { pinId: string }) {
  const { items, loading } = useChecklist(pinId)
  if (loading) return <SkeletonList rows={1} label="Loading tasks" />
  if (!items.length) return <p className="text-xs text-fg-muted">No tasks yet.</p>
  return <ChecklistProgress done={taskProgress(items).approved} total={items.length} />
}

// Checklist ticks, remarks and photo uploads: ONLY the Foreman the pin is assigned to. Engineers build the checklist and
// approve; the database enforces the same rule (can_work_on_pin, 0040).
export const canWorkOn = (props: Pick<InspectorProps, "role" | "canReport" | "meId">, pin: Pin) =>
  props.role === "foreman" && props.canReport && pin.assigned_to === props.meId && pin.status !== "verified"

// Why the checklist is read-only for this person (shown above the items so nobody wonders where the Upload button went).
export const checklistNotice = (props: Pick<InspectorProps, "role" | "canReport" | "meId">, pin: Pin, assigneeName?: string) => {
  if (props.role === "foreman" && pin.assigned_to !== props.meId) {
    return pin.assigned_to
      ? `This work is assigned to ${assigneeName ?? "another foreman"}. Only that foreman can add evidence and submit for QA Review. Ask the engineer to reassign it if it is yours.`
      : "This work is not assigned to anyone yet. The engineer must assign this pin to you (Details > Assigned foreman) before you can add evidence and submit for QA Review."
  }
  if (props.role === "engineer") return "Add each task with its QC criteria. The assigned Foreman opens the task, adds photos and submits it for QA Review. You inspect and complete each task once QC passes and linked NCRs are closed."
  return ""
}

export type InspectorProps = {
  role: EditorRole
  canEdit: boolean
  canReport: boolean
  meId: string
  team: TeamMember[]
  blueprint: Blueprint | null
  revision: Revision | null
  revisions: Revision[]
  onRevision: (id: string) => void
  sheetPins: Pin[]
  numberOf: (pin: Pin) => number
  annotations: Annotation[]
  selectedPin: Pin | null
  selectedAnnotation: Annotation | null
  selectedAnnotations: Annotation[]
  actions: SelectionActions
  onSelectPin: (id: string) => void
  onSelectAnnotation: (id: string, additive: boolean) => void
  sheetTab: SheetTab
  onSheetTab: (tab: SheetTab) => void
  hidden: Set<PinStatus>
  onToggleStatus: (status: PinStatus) => void
  layers: LayerVisibility
  onLayer: (key: keyof LayerVisibility, value: boolean) => void
  scaleWidthM: number | null
  baseLocked: boolean
  canLockBase: boolean
  onToggleBaseLock: () => void
  onMoveLayer: (id: string, action: LayerAction) => void
  onToggleLocked: (item: { type: "pin" | "annotation"; id: string }) => void
  onLockAll: (locked: boolean) => void
  hiddenIds: Set<string>
  onToggleHidden: (id: string) => void
  hiddenPinIds: Set<string>
  onTogglePinHidden: (id: string) => void
  showBase: boolean
  onShowBase: (value: boolean) => void
  onReorder: (idsBottomFirst: string[]) => void
  canDeleteSheet: boolean
  onDeleteSheet: () => void
  canSeeHistory: boolean
  history: HistoryEntry[]
  historyLoading: boolean
  historyError: string
  onSetStatus: (pin: Pin, status: PinStatus) => void
  onReport: (pin: Pin, status: "in_progress" | "for_review", note: string) => Promise<void>
  onOpenDetails: (section?: PinSection) => void
  pinLink?: { pinId: string; search: string } | null // the pin a link opened, with its ?pintab=
  onDeletePin: () => void
  onPinChanged: () => void
  onAnnotationPatch: (patch: AnnotationPatch) => void
  onDeleteAnnotation: () => void
}

export function Tabs<T extends string>({ tabs, value, onChange, label }: { tabs: Array<{ key: T; label: string; count?: number }>; value: T; onChange: (key: T) => void; label: string }) {
  return (
    <div role="tablist" aria-label={label} className="flex shrink-0 overflow-x-auto overscroll-x-contain border-b border-line bg-surface-muted/40 px-2 [scrollbar-width:thin]">
      {tabs.map((tab) => (
        <button key={tab.key} type="button" role="tab" aria-selected={value === tab.key} onClick={() => onChange(tab.key)} className={`flex min-h-11 shrink-0 grow items-center justify-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-3 text-xs font-bold transition ${value === tab.key ? "border-brand text-brand-text" : "border-transparent text-fg-muted hover:text-fg"}`}>
          {tab.label}
          {tab.count ? <span className="rounded-full bg-brand px-1.5 py-0.5 text-[11px] font-bold leading-none text-white" aria-label={`${tab.count} open`}>{tab.count}</span> : null}
        </button>
      ))}
    </div>
  )
}

// Right panel of the editor. It changes with the selection: sheet tabs when nothing is selected, pin tabs for a pin,
// a small editor for a drawing, note, text box or shape. Deep editing (all fields, large photos) happens in the pin details dialog.
export default function Inspector(props: InspectorProps) {
  const { selectedPin: pin, selectedAnnotation: annotation } = props
  if (props.selectedAnnotations.length >= 2) return <MultiPanel {...props} />
  if (annotation) return <AnnotationEditor {...props} annotation={annotation} />
  if (pin) return <PinPanel {...props} pin={pin} />

  const tabs: Array<{ key: SheetTab; label: string }> = [{ key: "pins", label: "Pins" }, { key: "layers", label: "Layers" }, ...(props.canSeeHistory ? [{ key: "history" as const, label: "History" }] : []), { key: "sheet", label: "Sheet" }]
  const active = props.sheetTab === "history" && !props.canSeeHistory ? "pins" : props.sheetTab
  return (
    <aside className="flex h-full min-h-0 w-full min-w-0 flex-col bg-surface">
      <Tabs tabs={tabs} value={active} onChange={props.onSheetTab} label="Sheet sections" />
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain p-4">
        {active === "pins" ? <PinListTab {...props} /> : null}
        {active === "layers" ? <LayersTab {...props} /> : null}
        {active === "history" ? <HistoryTab {...props} /> : null}
        {active === "sheet" ? <SheetTab {...props} /> : null}
      </div>
    </aside>
  )
}

// The section a pin opens on: the one its link asked for (once), otherwise Details.
export const startSection = (props: Pick<InspectorProps, "role" | "pinLink">, pinId: string): PinSection =>
  props.pinLink?.pinId === pinId ? readPinSection(props.pinLink.search, props.role) : "details"

// One pin beside the sheet: Details and assignment, Checklist & QA, Issues & NCRs, Next actions, Daily reports, Photos, Activity and
// Communication, as the role allows (pinSectionsFor). Counts mark what still needs attention. "For review" stays a checklist
// state: the pin header shows the work status only.
function PinPanel(props: InspectorProps & { pin: Pin }) {
  const { pin } = props
  const data = usePinPanelData(pin, props.role)
  const [pinTab, setPinTab] = useState<PinSection>(() => startSection(props, pin.id))
  useEffect(() => { setPinTab(startSection(props, pin.id)) }, [pin.id, props.pinLink]) // eslint-disable-line react-hooks/exhaustive-deps
  const tabs = pinSectionsFor(props.role).map((key) => ({ key, label: sectionLabel(props.role, key), count: data.counts[key] }))
  const active = tabs.some((tab) => tab.key === pinTab) ? pinTab : "details"
  return (
    <aside className="flex h-full min-h-0 w-full min-w-0 flex-col bg-surface">
      <div className="flex items-start gap-2 px-4 pb-3 pt-4">
        <span className="mt-0.5 flex h-7 w-7 flex-none items-center justify-center rounded-full text-xs font-bold text-white" style={{ background: statusDot[workStatus(pin.status)] }}>{props.numberOf(pin)}</span>
        <div className="min-w-0 flex-1 space-y-1.5">
          <h2 className="break-words text-base font-extrabold">{pin.title}{pin.locked ? <span title="Locked" className="ml-1 inline-block align-middle text-fg-muted"><Icon name="lock" size={14} /></span> : null}</h2>
          <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${statusChip[workStatus(pin.status)]}`}>{statusLabels[workStatus(pin.status)]}</span>
        </div>
        <button type="button" onClick={() => props.onOpenDetails(active)} className="flex-none rounded-lg border border-line px-2 py-1 text-[11px] font-bold hover:bg-surface-muted" title="Open this section in the full pin view with detailed columns">Full view</button>
      </div>
      <Tabs tabs={tabs} value={active} onChange={setPinTab} label="Pin sections" />
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain p-4 [overflow-wrap:anywhere] [scrollbar-gutter:stable]" aria-label="Pin section content" tabIndex={0}>
        <PinSectionBody {...props} pin={pin} section={active} data={data} />
      </div>
    </aside>
  )
}

// The body of one pin section, shared by the side panel (compact cards) and the full pin view (wide = detailed columns).
export function PinSectionBody(props: InspectorProps & { pin: Pin; section: PinSection; data: PinPanelData; wide?: boolean; refreshKey?: number; onChanged?: () => void }) {
  const { pin, section, data } = props
  const shared = { pin, role: props.role, meId: props.meId, team: props.team, canEdit: props.canEdit, canWork: canWorkOn(props, pin), data, wide: props.wide, onPinChanged: props.onChanged ?? props.onPinChanged }
  if (section === "details") return props.wide ? null : <PinDetailsTab {...props} pin={pin} />
  if (section === "checklist") return <PinChecklist pin={pin} canEdit={props.canEdit} canTick={canWorkOn(props, pin)} notice={checklistNotice(props, pin, pin.assigned_to ? props.team.find((member) => member.user_id === pin.assigned_to)?.full_name : undefined)} onPinChanged={props.onChanged ?? props.onPinChanged} />
  if (section === "issues") return <PinIssuesSection key={pin.id} {...shared} />
  if (section === "actions") return props.role === "admin" ? null : <PinActionsSection key={pin.id} {...shared} />
  if (section === "reports") return <PinReportsSection key={pin.id} {...shared} />
  if (section === "photos") return props.role === "client" ? null : <ChecklistPhotos key={`${pin.project_id}:${pin.id}`} pin={pin} />
  if (section === "activity") return props.role === "client" ? null : <PinTimeline pinId={pin.id} canComment={props.canReport} refreshKey={props.refreshKey} />
  return <PinCommunicationSection {...shared} />
}

export function PinDetailsTab(props: InspectorProps & { pin: Pin; inDialog?: boolean }) {
  const { pin, team } = props
  const qa = usePinQa(pin.id)
  const toast = useToast()
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState(false)
  const nameOf = (id: string | null) => (id ? (team.find((member) => member.user_id === id)?.full_name ?? "Administrator") : "Not assigned yet")
  const overdue = pin.due_date && pin.due_date < today() && pin.status !== "verified"

  const report = async (status: "in_progress" | "for_review") => {
    setBusy(true)
    try {
      await props.onReport(pin, status, note)
      setNote("")
    } catch (error) {
      toast.error("Could not report progress", error instanceof Error ? error.message : undefined)
    }
    setBusy(false)
  }

  return (
    <div className="space-y-4">
      <ProgressTracker status={workStatus(pin.status)} />
      {props.role === "client" ? <div className="grid gap-2 border-y border-line py-3 sm:grid-cols-2"><button type="button" onClick={() => openClientPath(clientActionPath("ticket", pin.project_id, pin.id))} className="rounded-lg border border-line px-3 py-2 text-xs font-bold hover:bg-surface-muted">Report a problem here</button><button type="button" onClick={() => openClientPath(clientActionPath("communication", pin.project_id, pin.id))} className="rounded-lg border border-line px-3 py-2 text-xs font-bold hover:bg-surface-muted">Ask about this pin</button></div> : null}

      {props.canEdit ? (
        <div>
          <p className="mb-1 text-xs font-bold uppercase tracking-wider text-fg-muted">Set status</p>
          <div className="flex flex-wrap gap-1">
            {allStatuses.map((status) => (
              <button key={status} type="button" onClick={() => props.onSetStatus(pin, status)} disabled={workStatus(pin.status) === status || (status === "verified" && (!qa.state || Boolean(qa.state.problem) || Boolean(qa.error)))} title={status === "verified" ? qa.error || qa.state?.problem || undefined : undefined} className={`flex items-center gap-1 rounded-full border px-2 py-1 text-[11px] font-semibold transition disabled:cursor-default disabled:opacity-50 ${workStatus(pin.status) === status ? "border-transparent text-white" : "border-line hover:bg-surface-muted"}`} style={workStatus(pin.status) === status ? { background: statusDot[status] } : undefined}>
                <span className="h-2 w-2 rounded-full" style={{ background: statusDot[status] }} />
                {statusLabels[status]}
              </button>
            ))}
          </div>
          {qa.state?.problem && pin.status !== "verified" ? <p className="mt-2 text-xs text-fg-muted">Cannot complete yet: {qa.state.problem}</p> : null}
        </div>
      ) : props.role === "foreman" ? (
        <div className="space-y-2 rounded-xl border border-line p-3">
          <p className="text-xs font-bold uppercase tracking-wider text-fg-muted">Report progress</p>
          {pin.assigned_to !== props.meId ? <p className="text-sm text-fg-muted">{pin.assigned_to ? "This work is assigned to another foreman." : "This work is not assigned yet. The engineer assigns each pin to a foreman."}</p> : pin.status === "verified" ? <p className="text-sm text-fg-muted">Completed work can only be reopened by the Engineer.</p> : (
            <>
              <textarea className={field} rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note for the engineer (optional)" maxLength={2000} aria-label="Progress note" />
              <div className="flex gap-2">
                <button type="button" disabled={busy || pin.status === "for_review"} onClick={() => void report("in_progress")} className="flex-1 rounded-lg border border-line px-2 py-2 text-xs font-bold hover:bg-surface-muted disabled:opacity-60">Work in progress</button>
              </div>
              <p role="status" className="text-xs text-fg-muted">{pin.status === "for_review" ? "Awaiting Engineer inspection" : "Submit tasks for QA Review from Tasks & QC, including for partially completed work."}</p>
            </>
          )}
        </div>
      ) : null}

      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div><dt className="text-[11px] font-bold uppercase tracking-wider text-fg-muted">Assigned</dt><dd className="font-semibold">{nameOf(pin.assigned_to)}{pin.assigned_to && pin.assigned_at ? <span className="block text-[11px] font-normal text-fg-muted">by {nameOf(pin.assigned_by ?? null)} on {prettyDate(pin.assigned_at.slice(0, 10))}</span> : null}</dd></div>
        <div>
          <dt className="text-[11px] font-bold uppercase tracking-wider text-fg-muted">Deadline</dt>
          <dd className={`font-semibold ${overdue ? "text-danger-fg" : ""}`}>{pin.due_date ? prettyDate(pin.due_date) : "Not set"}{overdue ? " (overdue)" : ""}</dd>
        </div>
        <div><dt className="text-[11px] font-bold uppercase tracking-wider text-fg-muted">Category</dt><dd className="font-semibold">{categoryLabels[pin.category]}</dd></div>
        <div><dt className="text-[11px] font-bold uppercase tracking-wider text-fg-muted">Discipline</dt><dd className="font-semibold">{pin.discipline ? disciplineLabels[pin.discipline] : "Not set"}</dd></div>
      </dl>
      {pin.verified_at ? <p className="text-xs font-semibold text-ok-fg">Completed by {nameOf(pin.verified_by)} on {prettyDate(pin.verified_at.slice(0, 10))}</p> : null}
      {pin.description ? <p className="whitespace-pre-wrap rounded-lg bg-surface-muted/60 p-3 text-sm">{pin.description}</p> : null}
      {props.canEdit ? (
        <button type="button" onClick={() => props.onToggleLocked({ type: "pin", id: pin.id })} className="flex w-full items-center justify-between rounded-lg border border-line px-3 py-2 text-sm font-semibold hover:bg-surface-muted" title="A locked pin cannot be moved, renamed or deleted. Its status can still change.">
          <span className="flex items-center gap-2"><Icon name={pin.locked ? "lock" : "unlock"} size={16} />{pin.locked ? "Pin is locked" : "Lock this pin"}</span>
          <span className="text-xs text-fg-muted">{pin.locked ? "Click to unlock" : "Stops moving and editing"}</span>
        </button>
      ) : null}

      {props.inDialog ? null : (
        <>
          <div>
            <p className="mb-1 text-xs font-bold uppercase tracking-wider text-fg-muted">Tasks</p>
            <ChecklistSummary pinId={pin.id} />
          </div>

          <div className="flex flex-wrap gap-2 pt-1">
            <button type="button" onClick={() => props.onOpenDetails()} className="flex-1 rounded-lg bg-brand px-3 py-2 text-sm font-bold text-white hover:bg-brand-hover">Open full details</button>
            {props.canEdit ? <button type="button" onClick={props.onDeletePin} disabled={pin.locked} title={pin.locked ? "Unlock the pin first" : undefined} className="rounded-lg border border-line px-3 py-2 text-sm font-semibold text-danger-fg hover:bg-danger-soft disabled:opacity-50">Delete</button> : null}
          </div>
        </>
      )}
    </div>
  )
}

function PinListTab(props: InspectorProps) {
  const counts = Object.fromEntries(allStatuses.map((status) => [status, 0])) as Record<PinStatus, number>
  for (const pin of props.sheetPins) counts[workStatus(pin.status)]++
  const visible = props.sheetPins.filter((pin) => !props.hidden.has(workStatus(pin.status)))
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1" role="group" aria-label="Show pins by status">
        {allStatuses.map((status) => (
          <button key={status} type="button" aria-pressed={!props.hidden.has(status)} onClick={() => props.onToggleStatus(status)} className={`flex items-center gap-1 rounded-full border border-line px-2 py-1 text-[11px] font-semibold ${props.hidden.has(status) ? "text-fg-muted line-through" : ""}`}>
            <span className="h-2 w-2 rounded-full" style={{ background: statusDot[status] }} />
            {statusLabels[status]} {counts[status]}
          </button>
        ))}
      </div>
      {props.sheetPins.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line p-4 text-center text-sm text-fg-muted">{props.canEdit ? "No pins on this sheet. Choose the Pin tool and click the plan." : "No pins on this sheet yet."}</p>
      ) : (
        <ol className="space-y-1">
          {visible.map((pin) => (
            <li key={pin.id}>
              <button type="button" onClick={() => props.onSelectPin(pin.id)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-surface-muted">
                <span className="flex h-6 w-6 flex-none items-center justify-center rounded-full text-[11px] font-bold text-white" style={{ background: statusDot[workStatus(pin.status)] }}>{props.numberOf(pin)}</span>
                <span className="min-w-0 flex-1 truncate">{pin.title}</span>
                {pin.locked ? <span className="text-fg-muted" title="Locked"><Icon name="lock" size={13} /></span> : null}
                {pin.due_date && pin.due_date < today() && pin.status !== "verified" ? <span className="text-[11px] font-bold text-danger-fg">OVERDUE</span> : null}
              </button>
            </li>
          ))}
          {visible.length === 0 ? <li className="text-sm text-fg-muted">All pins are hidden by the filter.</li> : null}
        </ol>
      )}
    </div>
  )
}

function LayersTab(props: InspectorProps) {
  const row = (key: keyof LayerVisibility, label: string) => (
    <label key={key} className="flex cursor-pointer items-center justify-between rounded-lg px-2 py-2 text-sm transition hover:bg-surface-muted">
      {label}
      <input type="checkbox" className="h-4 w-4 accent-[#9e1f93]" checked={props.layers[key]} onChange={(e) => props.onLayer(key, e.target.checked)} />
    </label>
  )
  const anyUnlocked = props.annotations.some((a) => !a.locked) || props.sheetPins.some((p) => !p.locked)
  const [pinsOpen, setPinsOpen] = useState(false)

  return (
    <div className="space-y-5">
      <LayerStack
        annotations={props.annotations}
        selectedIds={props.selectedAnnotations.map((item) => item.id)}
        canEdit={props.canEdit}
        hiddenIds={props.hiddenIds}
        onToggleHidden={props.onToggleHidden}
        onSelectAnnotation={props.onSelectAnnotation}
        onMoveLayer={props.onMoveLayer}
        onToggleLocked={props.onToggleLocked}
        onReorder={props.onReorder}
        showBase={props.showBase}
        onShowBase={props.onShowBase}
        baseLocked={props.baseLocked}
        canLockBase={props.canLockBase}
        onToggleBaseLock={props.onToggleBaseLock}
        pinCount={props.sheetPins.length}
        anyUnlocked={anyUnlocked}
        onLockAll={props.onLockAll}
      />

      <div>
        <button type="button" onClick={() => setPinsOpen((value) => !value)} aria-expanded={pinsOpen} className="flex w-full items-center justify-between rounded-lg px-1 py-1 text-xs font-bold uppercase tracking-wider text-fg-muted transition hover:text-fg">
          <span>Pins ({props.sheetPins.length}) <span className="font-medium normal-case tracking-normal">always on top</span></span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={`transition ${pinsOpen ? "rotate-180" : ""}`} aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
        </button>
        {pinsOpen ? (
          <ul className="mt-1 space-y-0.5">
            {props.sheetPins.length === 0 ? <li className="px-2 py-1 text-xs text-fg-muted">No pins on this sheet.</li> : null}
            {props.sheetPins.map((pin) => (
              <li key={pin.id} className={`flex items-center gap-1.5 rounded-lg px-1.5 py-1 transition hover:bg-surface-muted ${props.hiddenPinIds.has(pin.id) ? "opacity-55" : ""}`}>
                <button type="button" onClick={() => props.onSelectPin(pin.id)} className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm">
                  <span className="flex h-5 w-5 flex-none items-center justify-center rounded-full text-[11px] font-bold text-white" style={{ background: statusDot[workStatus(pin.status)] }}>{props.numberOf(pin)}</span>
                  <span className="truncate">{pin.title}</span>
                </button>
                <EyeButton hidden={props.hiddenPinIds.has(pin.id)} onClick={() => props.onTogglePinHidden(pin.id)} label={pin.title} />
                {pin.locked ? <span className="p-1 text-fg-muted" title="Locked"><Icon name="lock" size={13} /></span> : null}
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div>
        <p className="mb-1 text-xs font-bold uppercase tracking-wider text-fg-muted">Show on the sheet</p>
        {row("pins", "Pins")}
        {row("notes", "Notes, text and images")}
        {row("shapes", "Highlighted shapes")}
        {row("drawings", "Drawings and measurements")}
      </div>
      <div>
        <p className="mb-2 text-xs font-bold uppercase tracking-wider text-fg-muted">Legend</p>
        <ul className="space-y-1.5 text-sm">
          {allStatuses.map((status) => <li key={status} className="flex items-center gap-2"><span className="h-3 w-3 rounded-full" style={{ background: statusDot[status] }} />{statusLabels[status]}</li>)}
        </ul>
      </div>
      <div>
        <p className="mb-1 text-xs font-bold uppercase tracking-wider text-fg-muted">Scale</p>
        <p className="text-sm text-fg-muted">{props.scaleWidthM ? `Calibrated: the full width of this sheet is ${formatMeters(props.scaleWidthM)}.` : "Not calibrated. Measure a known length with the tape, then press \"Set scale from last line\"."}</p>
      </div>
    </div>
  )
}

function HistoryTab(props: InspectorProps) {
  if (props.historyLoading && props.history.length === 0) return <SkeletonList rows={4} label="Loading history" />
  if (props.historyError) return <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger-fg">{props.historyError}</p>
  if (props.history.length === 0) return <p className="rounded-lg border border-dashed border-line p-4 text-center text-sm text-fg-muted">No edits recorded on this sheet yet.</p>
  return (
    <ol className="space-y-0.5" aria-label="Edit history">
      {props.history.map((entry) => (
        <li key={entry.id} className="rounded-lg px-2 py-1.5 hover:bg-surface-muted">
          <p className="text-sm font-semibold leading-snug">{entry.summary}</p>
          <p className="text-xs text-fg-muted">{entry.actor_name}{entry.actor_role ? ` (${entry.actor_role})` : ""} • {timeFmt(entry.created_at)}</p>
        </li>
      ))}
    </ol>
  )
}

function SheetTab(props: InspectorProps) {
  const { blueprint, revisions, revision } = props
  if (!blueprint) return <p className="text-sm text-fg-muted">No sheet selected.</p>
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-extrabold">{blueprint.title}</h3>
        <p className="text-sm text-fg-muted">{[blueprint.level, blueprint.discipline ? disciplineLabels[blueprint.discipline] : null].filter(Boolean).join(" • ") || "No level or discipline set"}</p>
        {props.baseLocked ? <p className="mt-1 flex items-center gap-1 text-xs font-semibold text-brand-text"><Icon name="lock" size={13} /> Base layer locked</p> : null}
      </div>
      <div>
        <p className="mb-1 text-xs font-bold uppercase tracking-wider text-fg-muted">Revisions</p>
        {revisions.length === 0 ? <p className="text-sm text-fg-muted">No file uploaded yet.</p> : (
          <ul className="space-y-1">
            {revisions.map((r, index) => (
              <li key={r.id}>
                <button type="button" onClick={() => props.onRevision(r.id)} className={`w-full rounded-lg border px-3 py-2 text-left text-sm ${revision?.id === r.id ? "border-brand bg-brand-soft" : "border-line hover:bg-surface-muted"}`}>
                  <span className="font-bold">Rev {r.revision}{index === 0 ? " (latest)" : ""}</span>
                  <span className="block text-xs text-fg-muted">{new Date(r.created_at).toLocaleDateString("en-PH", { day: "numeric", month: "short", year: "numeric" })} • {r.file_name}</span>
                  {r.notes ? <span className="block text-xs">{r.notes}</span> : null}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="text-xs text-fg-muted">{revision ? `${revision.preview_width} × ${revision.preview_height} px preview` : ""}</p>
      {props.canDeleteSheet ? (
        <div className="rounded-xl border border-danger-fg/30 bg-danger-soft/50 p-3">
          <p className="text-xs font-bold uppercase tracking-wider text-danger-fg">Danger zone</p>
          <p className="mt-1 text-xs text-fg-muted">Removes this sheet with every revision, pin, drawing and image on it.</p>
          <button type="button" onClick={props.onDeleteSheet} className="mt-2 w-full rounded-lg border border-danger-fg/40 bg-surface px-3 py-2 text-sm font-bold text-danger-fg transition hover:bg-danger-soft">Delete this sheet...</button>
        </div>
      ) : null}
    </div>
  )
}

const alignButtons: Array<{ mode: AlignMode; label: string; icon: string }> = [
  { mode: "left", label: "Align left", icon: "alignLeft" },
  { mode: "center", label: "Align centers", icon: "alignCenter" },
  { mode: "right", label: "Align right", icon: "alignRight" },
  { mode: "top", label: "Align top", icon: "alignTop" },
  { mode: "middle", label: "Align middles", icon: "alignMiddle" },
  { mode: "bottom", label: "Align bottom", icon: "alignBottom" },
]

// What you can do with several items selected: arrange, group, copy, lock, reorder, delete.
function MultiPanel(props: InspectorProps) {
  const items = props.selectedAnnotations
  const a = props.actions
  const canArrange = props.canEdit
  const allLocked = items.every((item) => item.locked)
  const grouped = items.some((item) => item.group_id)
  const sameGroup = items.length > 1 && items.every((item) => item.group_id && item.group_id === items[0].group_id)
  const counts = items.reduce<Record<string, number>>((map, item) => ({ ...map, [item.kind]: (map[item.kind] ?? 0) + 1 }), {})
  const tile = "flex h-9 items-center justify-center rounded-lg border border-line text-fg hover:bg-surface-muted disabled:opacity-40"
  return (
    <aside className="flex h-full w-full flex-col border-l border-line bg-surface">
      <div className="px-4 pb-3 pt-4">
        <p className="text-xs font-bold uppercase tracking-wider text-brand-text">{sameGroup ? "Group" : "Selection"}</p>
        <h2 className="text-base font-extrabold">{items.length} items selected</h2>
        <p className="text-xs text-fg-muted">{Object.entries(counts).map(([kind, n]) => `${n} ${annotationKindLabels[kind as keyof typeof annotationKindLabels].toLowerCase()}`).join(", ")}</p>
      </div>
      <div className="flex-1 space-y-4 overflow-y-auto border-t border-line p-4">
        {canArrange ? (
          <>
            <div>
              <p className="mb-1 text-sm font-semibold">Align</p>
              <div className="grid grid-cols-6 gap-1">
                {alignButtons.map((button) => <button key={button.mode} type="button" aria-label={button.label} title={button.label} disabled={allLocked} onClick={() => a.align(button.mode)} className={tile}><Icon name={button.icon} size={16} /></button>)}
              </div>
              <div className="mt-1 grid grid-cols-2 gap-1">
                <button type="button" disabled={items.length < 3 || allLocked} onClick={() => a.distribute("horizontal")} className={`${tile} gap-1.5 text-xs font-semibold`} title="Equal gaps between the items, left to right (needs 3 or more)"><Icon name="distH" size={16} />Spread across</button>
                <button type="button" disabled={items.length < 3 || allLocked} onClick={() => a.distribute("vertical")} className={`${tile} gap-1.5 text-xs font-semibold`} title="Equal gaps between the items, top to bottom (needs 3 or more)"><Icon name="distV" size={16} />Spread down</button>
              </div>
            </div>
            <div>
              <p className="mb-1 text-sm font-semibold">Group</p>
              <div className="grid grid-cols-2 gap-1">
                <button type="button" disabled={sameGroup} onClick={a.group} className={`${tile} gap-1.5 text-xs font-semibold`} title="Move, copy and lock these items as one (Ctrl+G)"><Icon name="group" size={16} />Group</button>
                <button type="button" disabled={!grouped} onClick={a.ungroup} className={`${tile} text-xs font-semibold`} title="Split the group again (Ctrl+Shift+G)">Ungroup</button>
              </div>
            </div>
            <div>
              <p className="mb-1 text-sm font-semibold">Order</p>
              <div className="grid grid-cols-2 gap-1">
                <button type="button" onClick={() => a.layer("front")} className={`${tile} gap-1.5 text-xs font-semibold`}><Icon name="front" size={16} />To front</button>
                <button type="button" onClick={() => a.layer("back")} className={`${tile} gap-1.5 text-xs font-semibold`}><Icon name="sendBack" size={16} />To back</button>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-1">
              <button type="button" onClick={a.copy} className={`${tile} gap-1 text-xs font-semibold`} title="Copy (Ctrl+C)"><Icon name="copy" size={14} />Copy</button>
              <button type="button" onClick={a.duplicate} className={`${tile} text-xs font-semibold`} title="Duplicate (Ctrl+D)">Duplicate</button>
              <button type="button" onClick={a.copyStyle} className={`${tile} gap-1 text-xs font-semibold`} title="Copy the style of the first selected item"><Icon name="brush" size={14} />Style</button>
            </div>
            {a.hasStyle ? <button type="button" onClick={a.applyStyle} className="w-full rounded-md border border-dashed border-brand px-2 py-1.5 text-xs font-bold text-brand-text hover:bg-brand-soft">Apply the copied style to all {items.length}</button> : null}
            <div className="flex gap-2">
              <button type="button" onClick={() => a.setLocked(!allLocked)} className={`${tile} flex-1 gap-1.5 text-sm font-semibold`}><Icon name={allLocked ? "unlock" : "lock"} size={15} />{allLocked ? "Unlock all" : "Lock all"}</button>
              <button type="button" onClick={a.remove} className={`${tile} flex-1 gap-1.5 text-sm font-semibold text-danger-fg hover:bg-danger-soft`}><Icon name="trash" size={15} />Delete</button>
            </div>
          </>
        ) : <p className="text-sm text-fg-muted">You can look at these items but only engineers can change them.</p>}
        <p className="text-xs text-fg-muted">Drag any selected item to move them all. Arrow keys nudge (Shift = bigger steps). Esc clears the selection.</p>
      </div>
    </aside>
  )
}

const noteColors = Object.keys(annotationColors) as AnnotationColor[]
const sizeButtons: Array<{ label: string; value: number }> = [{ label: "S", value: 1 }, { label: "M", value: 1.6 }, { label: "L", value: 2.4 }, { label: "XL", value: 3.6 }]
const layerButtons: Array<{ action: LayerAction; label: string }> = [
  { action: "front", label: "To front" },
  { action: "forward", label: "Forward" },
  { action: "backward", label: "Backward" },
  { action: "back", label: "To back" },
]

function AnnotationEditor(props: InspectorProps & { annotation: Annotation }) {
  const { annotation: a } = props
  const [text, setText] = useState(a.text ?? "")
  useEffect(() => setText(a.text ?? ""), [a.id, a.text])
  const orderedIds = sortByLayer(props.annotations).map((item) => item.id)
  const editable = props.canEdit && !a.locked
  const hasText = a.kind === "note" || a.kind === "text"
  const labelOnly = a.kind === "shape" || a.kind === "polyline" || a.kind === "area" || a.kind === "arrow" || a.kind === "cloud" || a.kind === "symbol" || a.kind === "image"
  const width = props.revision?.preview_width ?? 0
  const height = props.revision?.preview_height ?? 0

  let measurement: string | null = null
  if (a.points && width && height && a.kind === "dimension") {
    const lengthPx = polylineLengthPx(a.points, width, height)
    const meters = lengthMeters(lengthPx, width, props.scaleWidthM)
    measurement = `Length: ${meters !== null ? formatMeters(meters) : `${Math.round(lengthPx)} px (set the scale to read metres)`}`
  }
  if (a.points && width && height && (a.kind === "polyline" || a.kind === "area")) {
    const lengthPx = polylineLengthPx(a.points, width, height, a.kind === "area")
    const meters = lengthMeters(lengthPx, width, props.scaleWidthM)
    const lengthText = meters !== null ? formatMeters(meters) : `${Math.round(lengthPx)} px`
    if (a.kind === "polyline") measurement = `Length: ${lengthText}`
    else {
      const m2 = areaSquareMeters(polygonAreaPx(a.points, width, height), width, props.scaleWidthM)
      measurement = `Area: ${m2 !== null ? formatArea(m2) : `${Math.round(polygonAreaPx(a.points, width, height)).toLocaleString("en-PH")} px²`} • Perimeter: ${lengthText}`
    }
    if (props.scaleWidthM === null) measurement += " (set the scale to read metres)"
  }

  return (
    <aside className="flex h-full w-full flex-col border-l border-line bg-surface">
      <div className="px-4 pb-3 pt-4">
        <p className="text-xs font-bold uppercase tracking-wider text-brand-text">{a.kind === "shape" ? (a.shape === "ellipse" ? "Ellipse highlight" : "Rectangle highlight") : annotationKindLabels[a.kind]}</p>
        <h2 className="flex items-center gap-1.5 text-base font-extrabold">{a.kind === "image" ? "Picture on the sheet" : a.kind === "note" ? "Callout" : a.kind === "text" ? "Text on the sheet" : a.kind === "shape" ? "Highlighted area" : a.kind === "draw" ? "Pen stroke" : a.kind === "highlight" ? "Highlighter stroke" : a.kind === "polyline" ? "Path measurement" : a.kind === "arrow" ? "Arrow" : a.kind === "dimension" ? "Dimension line" : a.kind === "cloud" ? "Revision cloud" : a.kind === "symbol" ? (symbolByKey[a.symbol as SymbolKey]?.label ?? "Symbol") : "Area measurement"}{a.locked ? <span className="text-fg-muted" title="Locked"><Icon name="lock" size={14} /></span> : null}</h2>
        {measurement ? <p className="mt-1 text-sm font-semibold">{measurement}</p> : null}
      </div>
      <div className="flex-1 space-y-4 overflow-y-auto border-t border-line p-4">
        {a.locked && props.canEdit ? (
          <div className="flex items-center justify-between gap-2 rounded-lg bg-accent/20 px-3 py-2 text-sm">
            <span className="flex items-center gap-1.5 font-semibold"><Icon name="lock" size={14} /> Locked</span>
            <button type="button" onClick={() => props.onToggleLocked({ type: "annotation", id: a.id })} className="rounded-md border border-line bg-surface px-2 py-1 text-xs font-bold hover:bg-surface-muted">Unlock</button>
          </div>
        ) : null}
        {hasText || labelOnly ? (
          <label className="block text-sm font-semibold">
            {hasText ? (a.kind === "note" ? "Note text" : "Text") : a.kind === "image" ? "Caption (optional)" : "Label (optional)"}
            <textarea className={field} rows={hasText ? 4 : 2} maxLength={500} value={text} readOnly={!editable} onChange={(e) => setText(e.target.value)} onBlur={() => { if (editable && text !== (a.text ?? "") && (!hasText || text.trim())) props.onAnnotationPatch({ text: text.trim() }) }} />
          </label>
        ) : null}
        {a.kind === "image" || a.kind === "shape" || a.kind === "text" || a.kind === "symbol" ? (
          <label className="block text-sm font-semibold">
            <span className="flex items-center justify-between">Rotation <span className="flex items-center gap-2 text-xs font-normal text-fg-muted">{Math.round(a.rotation)}°{a.rotation ? <button type="button" disabled={!editable} onClick={() => props.onAnnotationPatch({ rotation: 0 })} className="rounded border border-line px-1.5 py-0.5 font-semibold text-fg hover:bg-surface-muted disabled:opacity-50">Reset</button> : null}</span></span>
            <input type="range" min={-180} max={180} step={1} value={Math.round(a.rotation)} disabled={!editable} onChange={(e) => props.onAnnotationPatch({ rotation: Number(e.target.value) })} className="mt-1 w-full accent-[#9e1f93]" aria-label="Rotation in degrees" />
          </label>
        ) : null}
        {a.kind !== "image" ? (
        <div>
          <p className="mb-1 text-sm font-semibold">Color</p>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Color">
            {noteColors.map((name) => (
              <button key={name} type="button" role="radio" aria-checked={a.color === name} aria-label={name} disabled={!editable} onClick={() => props.onAnnotationPatch({ color: name })} className={`h-6 w-6 rounded-full border-2 transition disabled:opacity-60 ${a.color === name ? "scale-110 border-fg" : "border-line"}`} style={{ background: annotationColors[name] }} />
            ))}
          </div>
        </div>
        ) : null}
        <label className="block text-sm font-semibold">
          <span className="flex items-center justify-between">Opacity <span className="text-xs font-normal text-fg-muted">{Math.round(a.opacity * 100)}%</span></span>
          <input type="range" min={5} max={100} step={5} value={Math.round(a.opacity * 100)} disabled={!editable} onChange={(e) => props.onAnnotationPatch({ opacity: Number(e.target.value) / 100 })} className="mt-1 w-full accent-[#9e1f93]" aria-label="Opacity" />
        </label>
        {a.kind === "symbol" ? (
          <label className="block text-sm font-semibold">
            <span className="flex items-center justify-between">Size <span className="text-xs font-normal text-fg-muted">{(a.w ?? 4).toFixed(1)}%</span></span>
            <input type="range" min={1} max={20} step={0.5} value={a.w ?? 4} disabled={!editable} onChange={(e) => props.onAnnotationPatch({ w: Math.min(Number(e.target.value), 100 - a.x) })} className="mt-1 w-full accent-[#9e1f93]" aria-label="Symbol size" />
          </label>
        ) : null}
        {isPointKind(a.kind) ? (
          <label className="block text-sm font-semibold">
            <span className="flex items-center justify-between">Line thickness <span className="text-xs font-normal text-fg-muted">{(a.stroke ?? 0.2).toFixed(2)}</span></span>
            <input type="range" min={a.kind === "highlight" ? 0.4 : 0.05} max={a.kind === "highlight" ? 3 : 1} step={0.05} value={a.stroke ?? 0.2} disabled={!editable} onChange={(e) => props.onAnnotationPatch({ stroke: Number(e.target.value) })} className="mt-1 w-full accent-[#9e1f93]" aria-label="Line thickness" />
          </label>
        ) : null}
        {a.kind === "text" ? (
          <div>
            <p className="mb-1 text-sm font-semibold">Text size</p>
            <div className="flex gap-1" role="radiogroup" aria-label="Text size">
              {sizeButtons.map((size) => (
                <button key={size.label} type="button" role="radio" aria-checked={Math.abs((a.font_size ?? 1.6) - size.value) < 0.05} disabled={!editable} onClick={() => props.onAnnotationPatch({ font_size: size.value })} className={`flex-1 rounded-md border px-2 py-1 text-xs font-semibold disabled:opacity-60 ${Math.abs((a.font_size ?? 1.6) - size.value) < 0.05 ? "border-brand bg-brand-soft text-brand-text" : "border-line hover:bg-surface-muted"}`}>{size.label}</button>
              ))}
            </div>
          </div>
        ) : null}
        {props.canEdit ? (
          <div>
            <p className="mb-1 text-sm font-semibold">Layer</p>
            <div className="grid grid-cols-2 gap-1">
              {layerButtons.map((item) => (
                <button key={item.action} type="button" disabled={!canMoveLayer(orderedIds, a.id, item.action)} onClick={() => props.onMoveLayer(a.id, item.action)} className="rounded-md border border-line px-2 py-1.5 text-xs font-semibold hover:bg-surface-muted disabled:opacity-40">{item.label}</button>
              ))}
            </div>
          </div>
        ) : null}
        {props.canEdit ? (
          <div className="grid grid-cols-3 gap-1">
            <button type="button" onClick={props.actions.copy} className="flex items-center justify-center gap-1 rounded-md border border-line px-2 py-1.5 text-xs font-semibold hover:bg-surface-muted" title="Copy (Ctrl+C)"><Icon name="copy" size={14} />Copy</button>
            <button type="button" onClick={props.actions.duplicate} className="rounded-md border border-line px-2 py-1.5 text-xs font-semibold hover:bg-surface-muted" title="Duplicate (Ctrl+D)">Duplicate</button>
            <button type="button" onClick={props.actions.copyStyle} className="flex items-center justify-center gap-1 rounded-md border border-line px-2 py-1.5 text-xs font-semibold hover:bg-surface-muted" title="Copy this item's color, opacity and thickness"><Icon name="brush" size={14} />Style</button>
          </div>
        ) : null}
        {props.canEdit && props.actions.hasStyle ? <button type="button" disabled={a.locked} onClick={props.actions.applyStyle} className="w-full rounded-md border border-dashed border-brand px-2 py-1.5 text-xs font-bold text-brand-text hover:bg-brand-soft disabled:opacity-50">Apply the copied style to this item</button> : null}
        {props.canEdit ? (
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => props.onToggleLocked({ type: "annotation", id: a.id })} className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-line px-3 py-2 text-sm font-semibold hover:bg-surface-muted"><Icon name={a.locked ? "unlock" : "lock"} size={15} />{a.locked ? "Unlock" : "Lock"}</button>
            <button type="button" onClick={props.onDeleteAnnotation} disabled={a.locked} title={a.locked ? "Unlock it first" : undefined} className="flex-1 rounded-lg border border-line px-3 py-2 text-sm font-semibold text-danger-fg hover:bg-danger-soft disabled:opacity-50">Delete</button>
          </div>
        ) : null}
        {props.canEdit && !a.locked ? <p className="text-xs text-fg-muted">Drag it on the sheet to move it{a.kind === "shape" || a.kind === "text" || a.kind === "image" || a.kind === "symbol" ? "; drag the square handle to resize and the round handle to rotate" : ""}. Ctrl+Z undoes.</p> : null}
      </div>
    </aside>
  )
}
