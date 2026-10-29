import { useEffect, useMemo, useRef, useState } from "react"
import ProjectContextBar from "../../components/ProjectContextBar"
import { dbMessage } from "../../components/editor/PinParts"
import { EmptyState, PageHead, inputClass } from "../../components/ui/PageParts"
import { SkeletonList } from "../../components/ui/Skeleton"
import { severityChip, severityLabels, statusChip, statusLabels, type Pin, type PinStatus } from "../../lib/blueprints"
import { followLink } from "../../lib/notifications"
import { pinPlanPath } from "../../lib/pinRecordsModel"
import { isOverdue } from "../../lib/progress"
import { getSelectedProjectId } from "../../lib/projects"
import { assignWorkItem } from "../../lib/projectManagers"
import { useProjectWork } from "../../lib/projectWork"
import { supabase } from "../../lib/supabase"
import { useToast } from "../../lib/toast"
import type { EngineerPageProps } from "./types"

const UNASSIGNED = "unassigned"
type AssignmentFilter = "all" | "assigned" | "unassigned"
const filterLabels: Record<AssignmentFilter, string> = { assigned: "Assigned", unassigned: "Unassigned", all: "All work" }

// A detailed work list, including assignees no longer in the team. Filtering never changes assignments.
export default function EngineerAssignments(_: EngineerPageProps) {
  return AssignmentBoard({ variant: "engineer" }) // same hooks, same tree as before the board was shared
}

// Shared with the Project Manager workspace (variant "pm"): the same board, saved through assign_work_item, under a section heading.
export function AssignmentBoard({ variant, readOnly = false }: { variant: "engineer" | "pm"; readOnly?: boolean }) {
  const projectId = getSelectedProjectId()
  const work = useProjectWork(projectId)
  const toast = useToast()
  const [sheet, setSheet] = useState("all")
  const [assignment, setAssignment] = useState<AssignmentFilter>("all")
  const [status, setStatus] = useState<"all" | "open" | PinStatus>("all")
  const [saving, setSaving] = useState<string | null>(null)
  const pending = useRef(false)
  const currentProject = useRef(projectId)
  currentProject.current = projectId
  useEffect(() => { setSheet("all"); setAssignment("all"); setStatus("all") }, [projectId])

  const foremen = work.team.filter(member => member.role === "foreman")
  const allWork = useMemo(() => work.pins.filter(pin => pin.project_id === projectId && pin.category !== "note"), [work.pins, projectId])
  const available = allWork.filter(pin => (sheet === "all" || pin.blueprint_id === sheet) && (status === "all" || (status === "open" ? pin.status !== "verified" : pin.status === status)))
  const assigned = available.filter(pin => Boolean(pin.assigned_to)).length
  const counts = { all: available.length, assigned, unassigned: available.length - assigned }
  const shown = available.filter(pin => assignment === "all" || (assignment === "assigned" ? Boolean(pin.assigned_to) : !pin.assigned_to))

  const assign = async (pinId: string, target: string) => {
    const pin = work.pins.find(item => item.id === pinId)
    if (pending.current || work.loading || work.error || !projectId || !pin || pin.project_id !== projectId || pin.locked || pin.status === "verified" || pin.status === "for_review" || (pin.assigned_to ?? UNASSIGNED) === target) return
    const assignedTo = target === UNASSIGNED ? null : target
    if (assignedTo && !foremen.some(member => member.user_id === assignedTo)) return
    const requestProject = projectId
    pending.current = true
    setSaving(pinId)
    try {
      let saved: Pin
      if (variant === "pm") {
        saved = (await assignWorkItem(pinId, assignedTo, pin.updated_at)) as Pin
        if (currentProject.current !== requestProject) return
      } else {
        const { data, error } = await supabase.from("pins").update({ assigned_to: assignedTo }).eq("id", pinId).eq("project_id", requestProject).eq("updated_at", pin.updated_at).select("*")
        if (currentProject.current !== requestProject) return
        if (error || !data?.length) throw new Error(error ? dbMessage(error) : "This work changed or is no longer assignable. The board will reload; review the current record before trying again.")
        saved = data[0] as Pin
      }
      work.setPins(current => current.map(item => item.id === pinId && item.project_id === requestProject ? { ...saved, x: Number(saved.x), y: Number(saved.y) } : item))
      await work.reload().catch(() => undefined)
      if (currentProject.current !== requestProject) return
      toast.success(assignedTo ? `Assigned to ${work.nameOf(assignedTo)}` : "Unassigned", pin.title)
    } catch (error) {
      if (currentProject.current !== requestProject) return
      await work.reload().catch(() => undefined)
      if (currentProject.current !== requestProject) return
      toast.error("Not assigned", (error as Error).message)
    } finally { pending.current = false; setSaving(null) }
  }

  const filters = (<div className="flex flex-wrap items-end gap-3"><label className="text-xs font-semibold">Sheet
          <select value={sheet} onChange={event => setSheet(event.target.value)} aria-label="Filter by sheet" className={inputClass + " mt-1"}>
            <option value="all">All sheets</option>
            {work.blueprints.map(bp => <option key={bp.id} value={bp.id}>{bp.title}</option>)}
          </select>
        </label><label className="text-xs font-semibold">Work status<select aria-label="Filter by work status" className={inputClass + " mt-1"} value={status} onChange={event => setStatus(event.target.value as typeof status)}>
          <option value="all">All statuses</option><option value="open">Open work only</option>{(Object.keys(statusLabels) as PinStatus[]).map(key => <option key={key} value={key}>{statusLabels[key]}</option>)}
        </select></label></div>)
  const pm = variant === "pm"
  const body = (
    <>
      {!projectId ? null : work.loading ? <SkeletonList rows={4} label="Loading assignments" />
        : work.error ? <p role="alert" className="rounded-lg bg-danger-soft p-4 text-sm text-danger-fg">{work.error} <button type="button" className="underline" onClick={() => void work.reload()}>Retry</button></p>
        : <div className="space-y-4">
          <p className="text-sm text-fg-muted">Project total: {allWork.length} work pins · {allWork.filter(pin => pin.status !== "verified").length} open · {allWork.filter(pin => pin.status === "verified").length} completed. Counts below follow the selected sheet and status.</p>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface p-3">
            <div role="group" aria-label="Filter by assignment" className="flex flex-wrap gap-2">
              {(Object.keys(filterLabels) as AssignmentFilter[]).map(key => <button key={key} type="button" aria-pressed={assignment === key} onClick={() => setAssignment(key)}
                className={`rounded-full border px-3 py-2 text-xs font-bold transition ${assignment === key ? "border-brand bg-brand text-white" : "border-line text-fg-muted hover:border-brand/50 hover:text-brand-text"}`}>
                {filterLabels[key]} <span className="ml-1 tabular-nums">({counts[key]})</span>
              </button>)}
            </div>
            <p role="status" className="text-xs text-fg-muted">{shown.length} of {available.length} work pin{available.length === 1 ? "" : "s"} shown</p>
          </div>
          {!foremen.length ? <p role="status" className="rounded-lg bg-amber-100 px-3 py-2 text-sm text-amber-950 dark:bg-amber-900/40 dark:text-amber-100">{pm ? "No Foreman is on this project yet. Add one to the team above before assigning work." : "No Foreman is on this project yet. Ask an administrator to add one to the team before assigning work."}</p> : null}
          {!shown.length ? <EmptyState title={available.length ? `No ${assignment === "assigned" ? "assigned" : "unassigned"} work in this selection` : "No work in this selection"}>
            Choose another assignment filter, sheet or status to see more work. Notes are not assignable work.
          </EmptyState> : <section aria-label="Assignment details" className="overflow-hidden rounded-xl border border-line bg-surface">
            <div aria-hidden="true" className="hidden gap-4 border-b border-line bg-surface-muted px-4 py-3 text-xs font-extrabold uppercase tracking-wide text-fg-muted lg:grid lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_6rem_7rem_minmax(12rem,1.4fr)]">
              <span>Work / sheet</span><span>Status</span><span>Priority</span><span>Due date</span><span>Assigned Foreman</span>
            </div>
            <ul className="divide-y divide-line">
              {shown.map(pin => <AssignmentRow key={pin.id} pin={pin} sheet={work.sheetOf(pin.blueprint_id)} assignee={work.nameOf(pin.assigned_to)}
                foremen={foremen.map(member => ({ id: member.user_id, name: member.full_name }))} late={isOverdue(pin, work.today)}
                saving={saving === pin.id} busy={saving !== null || readOnly} onAssign={target => void assign(pin.id, target)}
                onOpen={() => followLink(pinPlanPath(pm ? "project_manager" : "engineer", { projectId: pin.project_id, pinId: pin.id, sheetId: pin.blueprint_id }), pin.project_id)} />)}
            </ul>
          </section>}
        </div>}
    </>
  )
  if (pm) return (
    <section aria-labelledby="pm-assignments" className="mt-6">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="pm-assignments" className="border-l-4 border-accent pl-3 text-lg font-extrabold text-brand-strong">Work assignments</h2>
          <p className="mt-1 pl-4 text-sm text-fg-muted">Move work items between Foremen. The Foreman needs Assigned work access to the plan's type. Locked work, work awaiting the Engineer's review and completed work keep their Foreman.</p>
        </div>
        {filters}
      </div>
      {body}
    </section>
  )
  return (
    <div className="engineer-page" style={{ width: "min(100%, 1280px)" }}>
      <ProjectContextBar listPath="/engineer/projects" listLabel="My projects" />
      <PageHead eyebrow="Planning" title="Assignment board"
        description="All project work pins, including completed work. Saved assignments are shared with the Foreman's My work and QA pages; unassigned work does not appear in a Foreman's task list."
        actions={filters} />
      {body}
    </div>
  )
}

function AssignmentRow({ pin, sheet, assignee, foremen, late, saving, busy, onAssign, onOpen }: {
  pin: Pin; sheet: string; assignee: string; foremen: Array<{ id: string; name: string }>; late: boolean; saving: boolean; busy: boolean; onAssign: (target: string) => void; onOpen: () => void
}) {
  const blocked = pin.locked || pin.status === "for_review" || pin.status === "verified"
  const missingAssignee = Boolean(pin.assigned_to && !foremen.some(member => member.id === pin.assigned_to))
  return <li className="grid gap-4 px-4 py-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_6rem_7rem_minmax(12rem,1.4fr)] lg:items-start">
    <div className="min-w-0 sm:col-span-2 lg:col-span-1">
      <button type="button" onClick={onOpen} className="break-words text-left text-sm font-extrabold text-brand-text hover:underline">{pin.title}</button>
      <p className="mt-1 break-words text-xs text-fg-muted">{sheet}</p>
      {pin.description ? <p className="mt-2 whitespace-pre-wrap break-words text-xs leading-relaxed text-fg-muted">{pin.description}</p> : null}
    </div>
    <div><p className="mb-1 text-xs font-semibold text-fg-muted lg:hidden">Status</p><span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-bold ${statusChip[pin.status]}`}>{statusLabels[pin.status]}</span>
      {pin.locked ? <p className="mt-1 text-xs text-fg-muted">Locked</p> : null}</div>
    <div><p className="mb-1 text-xs font-semibold text-fg-muted lg:hidden">Priority</p><span className={`inline-flex rounded px-1.5 py-0.5 text-[11px] font-extrabold uppercase ${severityChip[pin.severity]}`}>{severityLabels[pin.severity]}</span></div>
    <div><p className="mb-1 text-xs font-semibold text-fg-muted lg:hidden">Due date</p><p className={`text-xs font-semibold ${late ? "text-red-700 dark:text-red-300" : "text-fg-muted"}`}>
      {pin.due_date ? <time dateTime={pin.due_date}>{new Date(pin.due_date + "T00:00:00").toLocaleDateString("en-PH", { day: "numeric", month: "short", year: "numeric" })}</time> : "Not set"}
      {late ? <span className="mt-1 block">Overdue</span> : null}</p></div>
    <div className="min-w-0">
      <p className={`mb-1 text-xs font-bold ${pin.assigned_to ? "text-fg" : "text-amber-800 dark:text-amber-300"}`}>{pin.assigned_to ? assignee : "Unassigned"}</p>
      <label className="block"><span className="sr-only">Assign {pin.title} to Foreman</span>
        <select aria-label={`Assign ${pin.title} to Foreman`} value={pin.assigned_to ?? UNASSIGNED} disabled={blocked || busy || !foremen.length} onChange={event => onAssign(event.target.value)} className={inputClass + " !px-2 !py-1.5 !text-xs disabled:opacity-60"}>
          <option value={UNASSIGNED}>Unassigned</option>
          {missingAssignee ? <option value={pin.assigned_to!} disabled>{assignee} (not in current team)</option> : null}
          {foremen.map(member => <option key={member.id} value={member.id}>{member.name}</option>)}
        </select>
      </label>
      {saving ? <p role="status" className="mt-1 text-xs text-fg-muted">Saving assignment…</p>
        : blocked ? <p className="mt-1 text-xs text-fg-muted">{pin.status === "verified" ? "Completed work preserves its Foreman. Reopen it before reassigning." : pin.status === "for_review" ? "Awaiting Engineer review; assignment cannot change." : "Unlock the pin on the plan to change its assignment."}</p> : null}
    </div>
  </li>
}
