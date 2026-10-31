import { lazy, Suspense, useEffect, useState, type ReactNode } from "react"
import Modal from "../Modal"
import { Chip } from "../qa/QaBits"
import { buttonPrimary, buttonSecondary, inputClass } from "../ui/PageParts"
import { SkeletonList } from "../ui/Skeleton"
import ProjectQuestions from "../ProjectQuestions"
import PinDailyReports from "../client/PinDailyReports"
import { severityLabels, useBlueprints, useChecklist, useProjectPins, type Pin, type PinSeverity } from "../../lib/blueprints"
import { clientActionPath, openClientPath } from "../../lib/clientPortalModel"
import { followLink } from "../../lib/notifications"
import { reportFieldProblem, usePinRecords } from "../../lib/pinRecords"
import { WHOLE_PIN_ITEM, checklistText, defectChecklist, defectOpen, emptyRecordFilter, inspectionChecklist, inspectionOpen, issueOpen, pinNextActions, pinSectionCounts, recordFilterActive, recordKindCounts, recordKindLabels, recordKindsFor, recordMatches, snagOpen, type NextAction, type PanelRole, type RecordFacts, type RecordFilter, type RecordKind, type RecordState, type SubmissionLink } from "../../lib/pinRecordsModel"
import { manilaToday } from "../../lib/progress"
import { useProject, type TeamMember } from "../../lib/projects"
import { defectStatusLabels, defectTone, dueText, fixStageText, inspectionStatusLabels, inspectionTone, refNumber, snagStatusLabels, snagTone } from "../../lib/qaModel"
import { useWorkQaHistory } from "../../lib/qaAttempts"
import { useSettings } from "../../lib/settings"
import { useToast } from "../../lib/toast"
import DateRangeFilter from "../ui/DateRangeFilter"
import { presetRange, rangeProblem, rangeText, type DateRange, type RangePreset } from "../../lib/dateRangeModel"

const DefectDetail = lazy(() => import("../qa/DefectDetail"))
const InspectionDetail = lazy(() => import("../qa/InspectionDetail"))
const IssueDetails = lazy(() => import("../issues/IssueDetails"))
const LogIssueModal = lazy(() => import("../issues/LogIssueModal"))
const NewDefectModal = lazy(() => import("../qa/NewDefectModal"))
const SnagDetail = lazy(() => import("../qa/SnagPanel").then((module) => ({ default: module.SnagDetail })))
const ClientSnagModal = lazy(() => import("../qa/SnagParts").then((module) => ({ default: module.ClientSnagModal })))

const day = (iso: string) => new Date(iso).toLocaleDateString("en-PH", { timeZone: "Asia/Manila", day: "numeric", month: "short", year: "numeric" })
const heading = "text-xs font-extrabold uppercase tracking-wider text-fg-muted"

// Everything connected to one pin, loaded once for the panel (tab counts) and shared by its sections.
export function usePinPanelData(pin: Pin, role: PanelRole) {
  const records = usePinRecords(pin, role)
  const history = useWorkQaHistory(role === "client" ? null : pin.id)
  const checklist = useChecklist(pin.id)
  const set = { defects: records.records.defects, inspections: history.inspections, snags: records.records.snags, issues: records.records.issues.length, questions: records.records.questions, reports: records.records.reports.length }
  const reload = async () => { await Promise.all([records.reload(), history.reload()]) }
  return { ...records, reload, history, checklist, set, counts: pinSectionCounts(role, set) }
}
export type PinPanelData = ReturnType<typeof usePinPanelData>
export type PinPanelProps = { pin: Pin; role: PanelRole; meId: string; team: TeamMember[]; canEdit: boolean; canWork: boolean; data: PinPanelData; wide?: boolean; onPinChanged?: () => void }

type Row = { key: string; cells: ReactNode[]; description?: string | null; details?: Array<[string, string | null | undefined]>; onOpen?: () => void; openLabel: string; mine?: boolean; facts: RecordFacts }

function RecordDetails({ row }: { row: Row }) {
  const details = row.details?.filter(([, value]) => value) ?? []
  return <>
    {row.description ? <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-relaxed">{row.description}</p> : null}
    {details.length ? <dl className="mt-3 grid gap-x-4 gap-y-2 border-t border-line pt-3 text-xs" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,10rem),1fr))" }}>
      {details.map(([label, value]) => <div key={label} className="min-w-0"><dt className="font-semibold text-fg-muted">{label}</dt><dd className="mt-0.5 whitespace-pre-wrap break-words leading-relaxed">{value}</dd></div>)}
    </dl> : null}
  </>
}

// Compact summary rows in both views. Full notes belong in the opened record, never inside every table row.
function RecordList({ title, columns, rows, empty }: { title: string; columns: string[]; rows: Row[]; wide?: boolean; empty: string }) {
  const [detailKey, setDetailKey] = useState<string | null>(null)
  const detail = rows.find(row => row.key === detailKey)
  useEffect(() => { if (detailKey && !rows.some(row => row.key === detailKey)) setDetailKey(null) }, [detailKey, rows])
  const open = (row: Row) => row.onOpen ? row.onOpen() : setDetailKey(row.key)
  return (
    <section aria-label={title} className="min-w-0 space-y-2">
      <h4 className={`${heading} flex items-center gap-2`}>{title}<span className="rounded-full bg-surface-muted px-1.5 py-0.5 text-[11px] font-bold text-fg">{rows.length}</span></h4>
      {!rows.length ? <p className="rounded-lg border border-dashed border-line px-3 py-2 text-xs text-fg-muted">{empty}</p> : (
        <div role="region" aria-label={`${title} detailed view, scroll for more columns`} tabIndex={0} className="max-w-full overflow-x-auto rounded-xl border border-line focus-visible:outline-2 focus-visible:outline-brand">
          <table aria-label={`${title} detailed view`} className="w-full min-w-[48rem] text-left text-sm">
            <thead className="bg-surface-muted/60 text-[11px] uppercase tracking-wider text-fg-muted"><tr>{columns.map((column) => <th key={column} scope="col" className="px-3 py-2 font-bold">{column}</th>)}<th scope="col" className="px-3 py-2"><span className="sr-only">Open</span></th></tr></thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key} tabIndex={0} aria-label={row.openLabel} aria-haspopup="dialog" onClick={() => open(row)}
                  onKeyDown={event => { if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); open(row) } }}
                  className={`cursor-pointer border-t border-line align-top transition hover:bg-surface-muted/60 focus-visible:bg-brand-soft focus-visible:outline-2 focus-visible:outline-brand ${row.mine ? "bg-brand-soft/40" : ""}`}>
                  {row.cells.map((cell, index) => <td key={index} className={`px-3 py-3 ${index === 0 ? "whitespace-nowrap font-bold text-brand-text" : index === 1 ? "min-w-64 max-w-md" : "min-w-28"}`}>
                    <span className={index === 0 ? "" : `line-clamp-2 break-words ${index === 1 ? "max-w-72" : "max-w-48"}`}>{cell}</span>
                  </td>)}
                  <td className="px-3 py-3 text-right"><button type="button" className={`${buttonSecondary} whitespace-nowrap !min-h-8 !px-3 !py-1 !text-xs`} aria-label={row.openLabel} aria-haspopup="dialog" onClick={event => { event.stopPropagation(); open(row) }}>View details</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {detail ? <Modal title={`${title} details`} onClose={() => setDetailKey(null)} footer={<button type="button" className={buttonSecondary} onClick={() => setDetailKey(null)}>Close details</button>}>
        <dl className="grid gap-3 text-sm sm:grid-cols-2">{columns.map((column, index) => <div key={column} className="min-w-0"><dt className="text-xs font-semibold text-fg-muted">{column}</dt><dd className="mt-1 whitespace-pre-wrap break-words">{detail.cells[index]}</dd></div>)}</dl>
        <RecordDetails row={detail} />
      </Modal> : null}
    </section>
  )
}

function NextActions({ actions, onOpen }: { actions: NextAction[]; onOpen: (action: NextAction) => void }) {
  if (!actions.length) return <p className="rounded-xl border border-dashed border-line p-4 text-sm text-fg-muted">No next action is waiting on this pin.</p>
  return (
    <section aria-label="Next actions on this pin" className="rounded-xl border border-brand/40 bg-brand-soft/40 p-3">
      <h4 className={`${heading} text-brand-text`}>Next actions</h4>
      <ul className="mt-2 space-y-1.5">
        {actions.map((action) => (
          <li key={action.key}><button type="button" onClick={() => onOpen(action)} className="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left !text-sm hover:bg-surface">
            <span aria-hidden="true" className={`mt-1.5 h-2 w-2 flex-none rounded-full ${action.tone === "act" ? "bg-brand" : action.tone === "wait" ? "bg-amber-500" : "bg-sky-500"}`} />
            <span className="min-w-0 break-words font-semibold">{action.text}</span>
          </button></li>
        ))}
      </ul>
    </section>
  )
}

type Opened = { kind: "defect" | "inspection" | "snag" | "issue"; id: string } | null

const states: Array<[RecordState, string]> = [["all", "All"], ["open", "Open"], ["closed", "Closed"]]

// Filters for the pin's records: type dropdown (counts under the other filters), status, checklist item
// and search. Next actions live in their own tab and are never narrowed by these filters.
const filterField = `${inputClass} mt-1 !py-1.5 !text-sm !font-normal !normal-case !tracking-normal`

function RecordFilterBar({ role, filter, onChange, facts, items, wide }: { role: PanelRole; filter: RecordFilter; onChange: (filter: RecordFilter) => void; facts: RecordFacts[]; items: Array<{ id: string; text: string }>; wide?: boolean }) {
  const kinds = recordKindsFor(role)
  const counts = recordKindCounts(facts, filter)
  const shown = facts.filter((row) => recordMatches(row, filter)).length
  const set = (patch: Partial<RecordFilter>) => onChange({ ...filter, ...patch })
  return (
    <section aria-label="Filter this pin's records" className="space-y-2 rounded-xl border border-line bg-surface-muted/40 p-3">
      <div className={`grid gap-3 ${wide ? "sm:grid-cols-2 lg:grid-cols-4" : ""}`} style={wide ? undefined : { gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,11rem),1fr))" }}>
        {kinds.length > 1 ? <label className="min-w-0 text-[11px] font-bold uppercase tracking-wider text-fg-muted">Record type
          <select aria-label="Record type" className={filterField} value={filter.kind} onChange={(event) => set({ kind: event.target.value as RecordFilter["kind"] })}>
            {(["all", ...kinds] as Array<RecordKind | "all">).map((kind) => <option key={kind} value={kind}>{kind === "all" ? "All records" : recordKindLabels[kind]} ({counts[kind]})</option>)}
          </select>
        </label> : null}
        <label className="min-w-0 text-[11px] font-bold uppercase tracking-wider text-fg-muted">Status
          <select aria-label="Record status" className={filterField} value={filter.state} onChange={(event) => set({ state: event.target.value as RecordState })}>
            {states.map(([state, label]) => <option key={state} value={state}>{label}</option>)}
          </select>
        </label>
        {role !== "client" ? (
          <label className="min-w-0 text-[11px] font-bold uppercase tracking-wider text-fg-muted">Task
            <select className={filterField} value={filter.item} onChange={(event) => set({ item: event.target.value })}>
              <option value="">All tasks</option>
              <option value={WHOLE_PIN_ITEM}>Whole work pin (no item)</option>
              {items.map((item) => <option key={item.id} value={item.id}>{item.text}</option>)}
            </select>
          </label>
        ) : null}
        <label className="min-w-0 text-[11px] font-bold uppercase tracking-wider text-fg-muted">Search
          <input type="search" className={filterField} value={filter.query} onChange={(event) => set({ query: event.target.value })} placeholder={role === "client" ? "Report number or words" : "NCR / IR number, title, person"} />
        </label>
      </div>
      <p className="flex flex-wrap items-center justify-between gap-2 text-xs text-fg-muted" role="status">
        <span>Showing {shown} of {facts.length} record{facts.length === 1 ? "" : "s"}</span>
        {recordFilterActive(filter) ? <button type="button" className="font-bold text-brand-text underline" onClick={() => onChange(emptyRecordFilter)}>Clear filters</button> : null}
      </p>
    </section>
  )
}

// Next actions reuses the exact record-open dialogs and authorization of the register, but shows no register or filters.
export function PinActionsSection(props: PinPanelProps) {
  return <PinIssuesSection {...props} view="actions" />
}

// Records and action tabs share their dialogs, not their presentation. Creation starts on this project, sheet and pin.
export function PinIssuesSection({ pin, role, meId, team, canEdit, canWork, data, wide, onPinChanged, view = "records" }: PinPanelProps & { view?: "records" | "actions" }) {
  const [opened, setOpened] = useState<Opened>(null)
  const [creating, setCreating] = useState<"issue" | "ncr" | "problem" | null>(null)
  const [filter, setFilter] = useState<RecordFilter>(emptyRecordFilter)
  useEffect(() => { setFilter(emptyRecordFilter) }, [pin.id])
  const { project } = useProject(role === "client" ? null : pin.project_id)
  const { settings } = useSettings()
  const today = manilaToday()
  const nameOf = (id: string | null) => (id ? (id === meId ? "You" : team.find((member) => member.user_id === id)?.full_name ?? "Someone on the team") : "Not assigned")
  const items = data.checklist.items
  const submissions = data.history.submissions as unknown as SubmissionLink[]
  const { defects, snags, issues } = data.records
  const inspections = data.history.inspections
  const engineer = role === "engineer"
  const client = role === "client"
  const foremen = team.filter((member) => member.role === "foreman" && (member.can_take_work !== false || member.user_id === pin.assigned_to)) // type access (20261028130000)
  const open = (kind: NonNullable<Opened>["kind"], id: string) => setOpened({ kind, id })
  const loading = data.loading || data.history.loading
  const error = data.error || data.history.error

  // Each row carries its facts for the filter: type, open or closed, checklist item ids and the words it can be found by.
  const searchText = (...parts: Array<string | null | undefined>) => parts.filter(Boolean).join(" ")
  const defectRows: Row[] = defects.map((row) => {
    const ir = row.inspection_id ? inspections.find((item) => item.id === row.inspection_id) : null
    const snag = snags.find((item) => item.defect_id === row.id)
    const checklist = defectChecklist(row, submissions, items)
    const source = ir ? `Inspection ${refNumber("ir", ir.number)}` : row.inspection_id ? "Inspection" : snag ? `Client report ${refNumber("snag", snag.number)}` : "Raised directly"
    return {
      key: row.id, mine: role === "foreman" && row.assigned_to === meId && row.status !== "closed", openLabel: `Open ${refNumber("ncr", row.number)}`, onOpen: () => open("defect", row.id),
      cells: [refNumber("ncr", row.number), row.title, checklistText(checklist), <Chip key="s" tone={defectTone[row.status]}>{defectStatusLabels[row.status]}</Chip>, nameOf(row.assigned_to), dueText(row, today), source],
      description: row.description,
      details: [["Severity", row.severity], ["Raised", row.raised_at ? `${day(row.raised_at)} by ${nameOf(row.raised_by)}` : null], ["Due date", row.due_date ? day(`${row.due_date}T00:00:00+08:00`) : "No deadline set"], ["Reference", row.reference], ["Root cause", row.root_cause], ["Corrective action", row.corrective_action], ["Preventive action", row.preventive_action], ["Correction submitted", row.fixed_at ? day(row.fixed_at) : null], ["Closed", row.closed_at ? day(row.closed_at) : null], ["Closing note", row.closing_note]],
      facts: { kind: "ncr", open: defectOpen(row.status), itemIds: checklist.map((item) => item.id), text: searchText(refNumber("ncr", row.number), row.title, row.description, checklistText(checklist), defectStatusLabels[row.status], nameOf(row.assigned_to), source) },
    }
  })
  const inspectionRows: Row[] = [...inspections].sort((a, b) => b.number - a.number).map((row) => {
    const checklist = inspectionChecklist(row, submissions, items)
    return {
      key: row.id, openLabel: `Open ${refNumber("ir", row.number)}`, onOpen: () => open("inspection", row.id),
      cells: [refNumber("ir", row.number), row.title, checklistText(checklist), <Chip key="s" tone={inspectionTone[row.status]}>{inspectionStatusLabels[row.status]}</Chip>,
        `${day(row.requested_at)} by ${nameOf(row.requested_by)}`, row.inspector_id ? nameOf(row.inspector_id) : "Engineer not started"],
      description: row.request_note,
      details: [["Target date", row.target_at ? day(row.target_at) : null], ["Started", row.started_at ? day(row.started_at) : null], ["Finished", row.completed_at ? day(row.completed_at) : null], ["Score", row.score != null ? `${row.score}%` : null], ["Result summary", row.summary]],
      facts: { kind: "inspection", open: inspectionOpen(row.status), itemIds: checklist.map((item) => item.id), text: searchText(refNumber("ir", row.number), row.title, checklistText(checklist), inspectionStatusLabels[row.status], nameOf(row.requested_by), row.inspector_id ? nameOf(row.inspector_id) : null) },
    }
  })
  const issueRows: Row[] = issues.map((row) => {
    const itemName = row.checklist_item_id ? (items.find((item) => item.id === row.checklist_item_id)?.text ?? row.checklist_name ?? "Task") : row.checklist_name ? `${row.checklist_name} (historical)` : "Whole work pin"
    return {
      key: row.id, openLabel: "Open issue record", onOpen: () => open("issue", row.id),
      cells: [day(row.created_at), <span key="d" className="whitespace-pre-wrap break-words">{row.description}</span>, itemName, severityLabels[row.severity as PinSeverity] ?? row.severity, nameOf(row.raised_by)],
      details: [["Status", issueOpen(pin.status) ? "Open — work not completed" : "Closed — work completed"]],
      facts: { kind: "issue", open: issueOpen(pin.status), itemIds: row.checklist_item_id ? [row.checklist_item_id] : row.checklist_name ? [""] : [], text: searchText("issue", row.description, itemName, severityLabels[row.severity as PinSeverity] ?? row.severity, nameOf(row.raised_by)) },
    }
  })
  const snagRows: Row[] = snags.map((row) => {
    const ncr = row.defect_id ? defects.find((item) => item.id === row.defect_id) : null
    const facts: RecordFacts = { kind: "client", open: snagOpen(row.status), itemIds: [], text: searchText(refNumber("snag", row.number), row.title, row.description, snagStatusLabels[row.status], ncr ? refNumber("ncr", ncr.number) : null) }
    return client
      ? { key: row.id, description: row.description, openLabel: `Open ${refNumber("snag", row.number)}`, onOpen: () => open("snag", row.id), cells: [refNumber("snag", row.number), row.title, <Chip key="s" tone={snagTone[row.status]}>{snagStatusLabels[row.status]}</Chip>, fixStageText(row.status, row.fix_stage), day(row.created_at)], facts }
      : { key: row.id, description: row.description, openLabel: `Open ${refNumber("snag", row.number)}`, onOpen: engineer ? () => open("snag", row.id) : undefined, cells: [refNumber("snag", row.number), row.title, <Chip key="s" tone={snagTone[row.status]}>{snagStatusLabels[row.status]}</Chip>, ncr ? refNumber("ncr", ncr.number) : row.defect_id ? "NCR raised" : "None yet", day(row.created_at)], facts }
  })
  const kinds = recordKindsFor(role)
  const allFacts = [...(kinds.includes("ncr") ? defectRows : []), ...(kinds.includes("inspection") ? inspectionRows : []), ...(kinds.includes("issue") ? issueRows : []), ...(kinds.includes("client") ? snagRows : [])].map((row) => row.facts)
  const filtering = recordFilterActive(filter)
  const visible = (kind: RecordKind) => kinds.includes(kind) && (filter.kind === "all" || filter.kind === kind)
  const shown = (rows: Row[]) => rows.filter((row) => recordMatches(row.facts, filter))
  const empty = (none: string, kind: string) => (filtering ? `No ${kind} matches these filters.` : none)

  const actions = pinNextActions(role, meId, data.set, today)
  const openAction = (action: NextAction) => open(action.open.kind, action.open.id)
  const reload = async () => { await data.reload(); onPinChanged?.() }
  const defect = opened?.kind === "defect" ? defects.find((row) => row.id === opened.id) : undefined
  const inspection = opened?.kind === "inspection" ? inspections.find((row) => row.id === opened.id) : undefined
  const snag = opened?.kind === "snag" ? snags.find((row) => row.id === opened.id) : undefined
  const blocked = pin.status === "verified" || pin.category === "note"

  return (
    <div className="min-w-0 space-y-4">
      {view === "actions" ? <><div className="flex flex-wrap gap-2">
        {engineer && canEdit ? <>
          <button type="button" className={`${buttonPrimary} !min-h-9 !py-1.5 !text-xs`} disabled={blocked} title={blocked ? (pin.status === "verified" ? "Reopen completed work before logging an issue" : "Choose a work pin, not a note") : "Flag this pin as an Issue with a description and marked-up photos"} onClick={() => setCreating("issue")}>Log an issue</button>
          <button type="button" className={`${buttonSecondary} !min-h-9 !py-1.5 !text-xs`} title="Numbered non-conformance with deadline: the Foreman corrects, you verify and close" onClick={() => setCreating("ncr")}>Raise NCR</button>
        </> : null}
        {role === "foreman" && canWork ? <button type="button" className={`${buttonPrimary} !min-h-9 !py-1.5 !text-xs`} onClick={() => setCreating("problem")}>Report a field problem</button> : null}
        {client ? <button type="button" className={`${buttonPrimary} !min-h-9 !py-1.5 !text-xs`} onClick={() => openClientPath(clientActionPath("ticket", pin.project_id, pin.id))}>Report a problem here</button> : null}
      </div>
      {engineer && canEdit && blocked ? <p role="status" className="text-xs text-fg-muted">{pin.status === "verified" ? "Reopen completed work before logging a new issue." : "Issues must be linked to a work pin, not a note."}</p> : null}
      {engineer && canEdit ? <p className="text-xs leading-relaxed text-fg-muted"><strong className="text-fg">Log an issue</strong>: flags this pin as an Issue on the plan and shows the assigned Foreman what is wrong, with marked-up photos. During QA it records the issue without interrupting the pending review. No number or deadline. <strong className="text-fg">Raise NCR</strong>: a numbered non-conformance with class, deadline and responsible Foreman; the Foreman corrects it, only you verify and close it, and it blocks completion of the work until closed.</p> : null}
      {role === "foreman" && !canWork ? <p className="text-xs text-fg-muted">Only the Foreman assigned to this pin reports field problems and corrections on it.</p> : null}</> : null}
      {error ? <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger-fg">{error} <button type="button" className="font-bold underline" onClick={() => void reload()}>Retry</button></p> : null}
      {loading ? <SkeletonList rows={3} label="Loading this pin's records" /> : (
        <>
          {view === "actions" ? <NextActions actions={actions} onOpen={openAction} /> : <>
          {allFacts.length ? <RecordFilterBar role={role} filter={filter} onChange={setFilter} facts={allFacts} items={items} wide={wide} /> : null}
          {client ? (
            <RecordList title="My problem reports on this pin" wide={wide} columns={["Report", "Problem", "Status", "Progress", "Reported"]} rows={shown(snagRows)} empty={empty("You have not reported a problem on this pin.", "report")} />
          ) : (
            <>
              {visible("ncr") ? <RecordList title="NCRs (non-conformances)" wide={wide} columns={["NCR", "Problem", "Task", "Status", "Responsible", "Due", "Source"]} rows={shown(defectRows)} empty={empty("No NCR is linked to this pin.", "NCR")} /> : null}
              {visible("inspection") ? <RecordList title="Inspections and QA requests" wide={wide} columns={["Inspection", "Title", "Task", "Status", "Requested", "Inspector"]} rows={shown(inspectionRows)} empty={empty("No inspection has been requested for this pin.", "inspection")} /> : null}
              {visible("issue") ? <RecordList title="Site issues" wide={wide} columns={["Logged", "Description", "Task", "Severity", "Logged by"]} rows={shown(issueRows)} empty={empty("No site issue is logged on this pin.", "site issue")} /> : null}
              {visible("client") ? <RecordList title="Client problem reports" wide={wide} columns={["Report", "Problem", "Status", "NCR", "Reported"]} rows={shown(snagRows)} empty={empty("No client report is linked to this pin.", "client report")} /> : null}
            </>
          )}</>}
        </>
      )}

      <Suspense fallback={null}>
        {defect && project ? <DefectDetail key={defect.id} defect={defect} project={project} foremen={foremen} today={today} canWork={role === "foreman"} canVerify={engineer} nameOf={nameOf} onPlan
          onClose={() => setOpened(null)} onChanged={reload} onOpenInspection={(id) => open("inspection", id)} /> : null}
        {inspection && project ? <InspectionDetail key={inspection.id} inspection={inspection} project={project} weights={settings.weights} threshold={settings.threshold} defects={defects} canInspect={engineer} canRequest={engineer || canWork} nameOf={nameOf} onPlan
          onClose={() => setOpened(null)} onChanged={reload} onOpenDefect={(row) => open("defect", row.id)} onOpenInspection={(id) => open("inspection", id)} /> : null}
        {opened?.kind === "issue" ? <IssueDetails pin={pin} canEdit={engineer && canEdit} nameOf={nameOf} onClose={() => setOpened(null)} /> : null}
        {snag && engineer ? <SnagDetail key={snag.id} snag={snag} today={today} foremen={foremen} nameOf={nameOf} onPlan onClose={() => setOpened(null)} onDecided={async () => { setOpened(null); await reload() }} /> : null}
        {snag && client ? <ClientSnagModal key={snag.id} snag={snag} onPlan onClose={() => setOpened(null)} /> : null}
        {creating === "issue" ? <LogIssueFromPin pin={pin} onClose={() => setCreating(null)} onDone={async () => { setCreating(null); await reload() }} /> : null}
        {creating === "ncr" ? <RaiseNcrFromPin pin={pin} foremen={foremen} today={today} onClose={() => setCreating(null)} onCreated={async (id) => { setCreating(null); await reload(); open("defect", id) }} /> : null}
      </Suspense>
      {creating === "problem" ? <FieldProblemDialog pin={pin} items={items} onClose={() => setCreating(null)} onSent={() => setCreating(null)} /> : null}
    </div>
  )
}

// The create forms start on this project, sheet and pin; they wait for the project's pins so the picker opens on the pin.
function LogIssueFromPin({ pin, onClose, onDone }: { pin: Pin; onClose: () => void; onDone: () => Promise<void> }) {
  const { pins, loading, error, reload } = useProjectPins(pin.project_id)
  const { blueprints } = useBlueprints(pin.project_id)
  if (loading || error) return <Modal title="Log an issue" onClose={onClose} footer={<button type="button" className={buttonSecondary} onClick={onClose}>Cancel</button>}>
    {error ? <p role="alert" className="text-sm text-danger-fg">{error} <button type="button" className="underline" onClick={() => void reload()}>Retry</button></p> : <SkeletonList rows={2} label="Loading work pins" />}
  </Modal>
  return <LogIssueModal pins={pins.length ? pins : [pin]} sheets={blueprints} sheetOf={(id) => blueprints.find((sheet) => sheet.id === id)?.title ?? "Sheet"} initialPinId={pin.id} onClose={onClose} onDone={onDone} />
}
function RaiseNcrFromPin({ pin, foremen, today, onClose, onCreated }: { pin: Pin; foremen: Array<{ user_id: string; full_name: string }>; today: string; onClose: () => void; onCreated: (id: string) => Promise<void> }) {
  const { pins, loading } = useProjectPins(pin.project_id)
  if (loading) return null
  const assigned = foremen.filter((row) => row.user_id === pin.assigned_to)
  return <NewDefectModal projectId={pin.project_id} pins={pins.length ? pins : [pin]} foremen={assigned.length ? [...assigned, ...foremen.filter((row) => row.user_id !== pin.assigned_to)] : foremen} today={today} initialPinId={pin.id} onClose={onClose} onCreated={onCreated} />
}

// The assigned Foreman's report of a problem in the field: kept on the pin timeline and sent to the project Engineers, who decide
// whether it becomes a site issue or an NCR. It does not create an NCR or change the work status itself.
function FieldProblemDialog({ pin, items, onClose, onSent }: { pin: Pin; items: Array<{ id: string; text: string }>; onClose: () => void; onSent: () => void }) {
  const toast = useToast()
  const [itemId, setItemId] = useState("")
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState(false)
  const send = async () => {
    if (busy || note.trim().length < 5) return
    setBusy(true)
    const result = await reportFieldProblem(pin.id, itemId || null, note)
    setBusy(false)
    if (!result.ok) return toast.error("Not sent", result.message)
    toast.success("Field problem sent", "The project Engineers are notified. It is kept in this pin's Activity.")
    onSent()
  }
  return (
    <Modal title="Report a field problem" description={`On ${pin.title}. The Engineer decides whether to log a site issue or raise an NCR.`} onClose={onClose}
      footer={<><button type="button" className={buttonSecondary} disabled={busy} onClick={onClose}>Cancel</button><button type="button" className={buttonPrimary} disabled={busy || note.trim().length < 5} onClick={() => void send()}>{busy ? "Sending…" : "Send to the Engineer"}</button></>}>
      <div className="space-y-4">
        <label className="block text-sm font-bold" htmlFor="field-problem-item">Task
          <select id="field-problem-item" className={`${inputClass} mt-1`} value={itemId} disabled={busy} onChange={(event) => setItemId(event.target.value)}>
            <option value="">Whole work pin (no specific item)</option>
            {items.map((item) => <option key={item.id} value={item.id}>{item.text}</option>)}
          </select>
        </label>
        <label className="block text-sm font-bold" htmlFor="field-problem-note">What is the problem? *
          <textarea id="field-problem-note" className={`${inputClass} mt-1`} rows={4} maxLength={1000} value={note} disabled={busy} onChange={(event) => setNote(event.target.value)} placeholder="What you found, where exactly, and what it stops" />
        </label>
        <p className="text-xs text-fg-muted">At least 5 characters. Corrections to an existing NCR or issue are sent from that NCR or the task, not here.</p>
      </div>
    </Modal>
  )
}

// Daily progress reports that link this pin (linked_work). Clients see submitted reports only; the assigned Foreman can add the pin
// to today's report from here.
export function PinReportsSection({ pin, role, canWork, data }: PinPanelProps) {
  const today = manilaToday()
  const [dates, setDates] = useState<DateRange>(() => presetRange("today", today))
  const problem = rangeProblem(dates)
  const presets: RangePreset[] = ["today", "last7", "thisWeek", "thisMonth", "lastMonth", "all"]
  return (
    <div className="min-w-0 space-y-3">
      {role === "foreman" && canWork ? <button type="button" className={`${buttonSecondary} !min-h-9 !py-1.5 !text-xs`} onClick={() => followLink(`/foreman/daily-report?project=${encodeURIComponent(pin.project_id)}&linkpin=${encodeURIComponent(pin.id)}`, pin.project_id)}>Add this pin to today's daily report</button> : null}
      <div className="space-y-2 rounded-xl border border-line bg-surface-muted/40 p-3">
        <DateRangeFilter label="Report date" range={dates} presets={presets} today={today} onChange={setDates} />
        <p className="text-xs leading-relaxed text-fg-muted">{problem ? "Choose a valid date range to view reports." : `Showing reports for ${rangeText(dates)}. Dates use the daily report's Manila work date, not the photo upload date.`}</p>
      </div>
      {!problem ? <PinDailyReports key={`${pin.id}:${dates.from}:${dates.to}`} pin={pin} reports={data.records.reports} loading={data.loading} error={data.error} onRetry={data.reload} staff={role !== "client"} dates={dates} /> : null}
    </div>
  )
}

// Questions about this pin: the Engineer answers here; a client sees only their own questions and asks on Communication.
export function PinCommunicationSection({ pin, role, meId, team, data }: PinPanelProps) {
  const nameOf = (id: string | null) => (id ? (id === meId ? "You" : team.find((member) => member.user_id === id)?.full_name ?? "Project team") : "Project team")
  if (role === "engineer") return <ProjectQuestions questions={data.records.questions} loading={data.loading} error={data.error} nameOf={nameOf} pinOf={() => null} onAnswered={data.reload} emptyText="No client question is linked to this pin yet." />
  const questions = data.records.questions
  return (
    <div className="min-w-0 space-y-3">
      <button type="button" className={`${buttonPrimary} !min-h-9 !py-1.5 !text-xs`} onClick={() => openClientPath(clientActionPath("communication", pin.project_id, pin.id))}>Ask about this pin</button>
      {data.loading ? <SkeletonList rows={2} label="Loading your questions" /> : !questions.length ? <p className="rounded-lg border border-dashed border-line px-3 py-2 text-xs text-fg-muted">You have not asked about this pin yet. Only you and the project team see your questions.</p> : (
        <ul className="space-y-2">
          {questions.map((question) => (
            <li key={question.id} className="rounded-xl border border-line bg-surface p-3 text-sm">
              <p className="text-[11px] text-fg-muted">{day(question.created_at)}</p>
              <p className="mt-1 whitespace-pre-wrap break-words font-semibold">{question.question}</p>
              {question.answer ? <p className="mt-2 whitespace-pre-wrap break-words rounded-lg bg-surface-muted p-2"><strong className="block text-[11px] text-brand-text">Answered by {nameOf(question.answered_by)}</strong>{question.answer}</p> : <p className="mt-2 text-xs font-semibold text-fg-muted">Waiting for an answer</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
