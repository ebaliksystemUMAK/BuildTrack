import DefectTrends from "./DefectTrends"
import QaRequirements from "./QaRequirements"
import ChecklistDocumentation from "./ChecklistDocumentation"
import ProjectChecklists from "./ProjectChecklists"
import { useEffect, useMemo, useState } from "react"
import Modal from "../Modal"
import { EmptyState, Meter, StatCard, buttonPrimary, buttonSecondary, inputClass } from "../ui/PageParts"
import { SkeletonKpis, SkeletonList } from "../ui/Skeleton"
import { Chip, HoldChip, SeverityChip } from "./QaBits"
import { useAuth } from "../../lib/auth"
import { useConfirm } from "../../lib/confirm"
import { downloadCsv, toCsv } from "../../lib/progress"
import { printHtml } from "../../lib/printReport"
import {
  defectStatusLabels, defectTone, dueState, dueText, inspectionStatusLabels, inspectionTone, qaActions, qaSeverityLabels, refNumber, severities, severityTone, toleranceText, trades, tradeLabels,
  type Defect, type DefectStatus, type Inspection, type InspectionStatus, type Template, type Trade,
} from "../../lib/qa"
import { qaSummaryHtml } from "../../lib/qaPrint"
import type { QaWorkspace } from "../../lib/qaWorkspace"
import { useToast } from "../../lib/toast"
import { useQaSubmissionIndex } from "../../lib/qaAttempts"
import { checklistGroups, checklistNames } from "../../lib/qaChecklistModel"
import { allDates, inRange, isFiltered, type DateRange } from "../../lib/dateRangeModel"
import { qaOverviewSummary } from "../../lib/qaOverviewModel"
import { useQaOverviewItems } from "../../lib/qaOverview"

export type QaMode = "engineer" | "foreman"
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-PH", { timeZone: "Asia/Manila", day: "numeric", month: "short" }) : "-")
const dueTone = { overdue: "text-red-700 dark:text-red-400", due_soon: "text-amber-800 dark:text-amber-300", ok: "text-fg-muted", none: "text-fg-muted", closed: "text-fg-muted" }
const pct = (value: number | null) => (value === null ? "-" : `${value}%`)

function Table({ head, children, label }: { head: string[]; children: React.ReactNode; label: string }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-surface">
      <table className="w-full min-w-[640px] text-left text-sm" aria-label={label}>
        <thead className="border-b border-line bg-surface-muted text-xs uppercase tracking-wider text-fg-muted"><tr>{head.map((cell) => <th key={cell} scope="col" className="px-3 py-2 font-extrabold">{cell}</th>)}</tr></thead>
        <tbody className="divide-y divide-line">{children}</tbody>
      </table>
    </div>
  )
}

const rowButton = "inline-flex min-h-6 items-center text-left font-bold text-brand-text underline-offset-2 hover:underline focus-visible:outline-2"

// ---------------------------------------------------------------- Overview
export function OverviewPanel({ ws, mode, dates = allDates, onOpenInspection, onOpenDefect, onGo }: { ws: QaWorkspace; mode: QaMode; dates?: DateRange; onOpenInspection: (id: string) => void; onOpenDefect: (id: string) => void; onGo: (tab: "inspections" | "defects") => void }) {
  const { profile } = useAuth()
  const toast = useToast()
  const filtered = isFiltered(dates)
  const items = useQaOverviewItems(filtered ? ws.projectId : null)
  const inspections = useMemo(() => ws.inspections.filter(row => inRange(row.requested_at, dates)), [ws.inspections, dates])
  const defects = useMemo(() => ws.defects.filter(row => inRange(row.raised_at, dates)), [ws.defects, dates])
  const s = useMemo(() => filtered ? qaOverviewSummary(inspections, defects, items.items, ws.today, ws.summary?.staff) : ws.summary, [filtered, inspections, defects, items.items, ws.today, ws.summary])
  const attention = useMemo(() => {
    const rows: Array<{ key: string; tone: string; text: string; sub: string; open: () => void }> = []
    // Only records the person may act on ask for their attention (View only types stay readable in the registers).
    const act = (record: { pin_id?: string | null; inspection_id?: string | null }) => ws.canActOn?.(record) ?? true
    for (const defect of defects) {
      if (defect.status === "closed") continue
      const due = dueState(defect, ws.today)
      const mine = defect.assigned_to === profile?.id
      if (!act(defect)) continue
      if (mode === "engineer" && defect.status === "for_verification") rows.push({ key: defect.id, tone: "bg-sky-500", text: `${refNumber("ncr", defect.number)} is ready to verify`, sub: defect.title, open: () => onOpenDefect(defect.id) })
      else if (due.state === "overdue" && (mode === "engineer" || mine)) rows.push({ key: defect.id, tone: "bg-red-600", text: `${refNumber("ncr", defect.number)} is ${dueText(defect, ws.today).toLowerCase()}`, sub: defect.title, open: () => onOpenDefect(defect.id) })
      else if (mode === "foreman" && mine && (defect.status === "open" || defect.status === "in_progress")) rows.push({ key: defect.id, tone: due.state === "due_soon" ? "bg-amber-500" : "bg-fg-muted", text: `${refNumber("ncr", defect.number)} needs your action (${dueText(defect, ws.today).toLowerCase()})`, sub: defect.title, open: () => onOpenDefect(defect.id) })
    }
    if (mode === "engineer") for (const inspection of inspections) if (inspection.status === "requested" && act(inspection)) rows.push({ key: inspection.id, tone: "bg-amber-500", text: `${refNumber("ir", inspection.number)} is waiting to be inspected`, sub: inspection.title, open: () => onOpenInspection(inspection.id) })
    return rows.slice(0, 8)
  }, [defects, inspections, ws, mode, profile?.id, onOpenDefect, onOpenInspection])

  const print = () => {
    if (!s || !ws.project) return
    const stamp = new Date().toLocaleDateString("en-PH", { timeZone: "Asia/Manila", day: "numeric", month: "long", year: "numeric" })
    if (!printHtml(qaSummaryHtml({ summary: s, defects, project: ws.project, nameOf: ws.nameOf, today: ws.today, asOf: stamp, dates }))) toast.error("Could not open the print dialog")
  }

  if (filtered && (items.error || ws.error)) return <p role="alert" className="rounded-lg bg-danger-soft px-4 py-2 text-sm text-danger-fg">{items.error || ws.error}<button type="button" className="ml-2 font-bold underline" onClick={() => { void items.reload(); void ws.reloadAll() }}>Retry</button></p>
  if (filtered ? ws.loading || items.loading : ws.summaryLoading && !s) return <><SkeletonKpis count={6} /><SkeletonList rows={3} label="Loading the quality summary" /></>
  if (!s) return <p role="alert" className="rounded-lg bg-danger-soft px-4 py-2 text-sm text-danger-fg">Could not load the quality summary.</p>
  const finished = s.inspections.passed + s.inspections.conditional + s.inspections.failed
  const openInspections = inspections.filter(i => i.status === "requested" || i.status === "in_progress")
  const overdueInspections = openInspections.filter(i => i.target_at && Date.parse(i.target_at) < Date.now()).length
  const oldestInspection = openInspections.length ? Math.max(...openInspections.map(i => Math.floor((Date.now() - Date.parse(i.requested_at)) / 3600000))) : 0
  const openNcrs = defects.filter(d => d.status !== "closed")
  const averageNcrAge = openNcrs.length ? Math.round(openNcrs.reduce((n, d) => n + (Date.now() - Date.parse(d.raised_at)) / 86400000, 0) / openNcrs.length) : 0

  return (
    <div className="space-y-5">
      {filtered && inspections.length === 0 && defects.length === 0 ? <EmptyState title="No QA records in these dates">No inspections were requested and no NCRs were raised in this period. Choose another period or clear the dates.</EmptyState> : null}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        <StatCard label="First-time pass rate" value={pct(s.inspections.first_pass_rate)} note={finished ? `${finished} inspection${finished === 1 ? "" : "s"} completed` : "No completed inspection yet"} tone={s.inspections.first_pass_rate === null ? "brand" : s.inspections.first_pass_rate >= ws.threshold ? "green" : "red"} />
        <StatCard label="Waiting for inspection" value={s.inspections.requested + s.inspections.in_progress} note={`${s.inspections.in_progress} in progress`} tone="amber" onClick={() => onGo("inspections")} />
        <StatCard label="Open NCRs" value={s.defects.open} note={`${s.defects.critical_open} critical • ${s.defects.major_open} major • ${s.defects.minor_open} minor`} tone={s.defects.critical_open ? "red" : "brand"} onClick={() => onGo("defects")} />
        <StatCard label="Overdue NCRs" value={s.defects.overdue} note={s.defects.overdue ? "Past their deadline" : "None past deadline"} tone={s.defects.overdue ? "red" : "green"} onClick={() => onGo("defects")} />
        <StatCard label="Avg days to close" value={s.defects.average_days_to_close === null ? "-" : s.defects.average_days_to_close} note={`${s.defects.closed} closed`} tone="brand" />
        <StatCard label="Defects per 100 checks" value={s.items.defects_per_100_items === null ? "-" : s.items.defects_per_100_items} note={`${s.items.failed} of ${s.items.checked} items failed`} tone="brand" />
      </div>

      {mode === "engineer" ? <DefectTrends defects={defects} today={ws.today} dates={dates} /> : null}
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Overdue inspections" value={overdueInspections} note={`Oldest open request: ${oldestInspection} hours`} tone={overdueInspections ? "red" : "green"} onClick={() => onGo("inspections")} />
        <StatCard label="Re-inspections" value={inspections.filter(i => i.reinspection_of).length} note="Linked follow-up inspection requests" tone="brand" />
        <StatCard label="Average open NCR age" value={`${averageNcrAge} days`} note={`${openNcrs.length} unresolved NCRs`} tone={averageNcrAge > 7 ? "amber" : "brand"} onClick={() => onGo("defects")} />
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <section aria-label="Needs attention" className="rounded-xl border border-line bg-surface p-4">
          <h2 className="mb-2 text-sm font-extrabold">Needs attention</h2>
          {attention.length === 0 ? <p className="text-sm text-fg-muted">{filtered ? "Nothing in these dates is waiting on you." : "Nothing is waiting on you."}</p> : (
            <ul className="space-y-1.5">
              {attention.map((row) => (
                <li key={row.key}>
                  <button type="button" onClick={row.open} className="flex w-full items-start gap-3 rounded-lg px-2 py-1.5 text-left hover:bg-surface-muted">
                    <span className={`mt-1.5 h-2.5 w-2.5 flex-none rounded-full ${row.tone}`} aria-hidden="true" />
                    <span className="min-w-0"><span className="block text-sm font-semibold">{row.text}</span><span className="block truncate text-xs text-fg-muted">{row.sub}</span></span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-label="Recent inspections" className="rounded-xl border border-line bg-surface p-4">
          <h2 className="mb-2 text-sm font-extrabold">Recent inspections</h2>
          {s.recent.length === 0 ? <p className="text-sm text-fg-muted">{filtered ? "No inspections were requested in these dates." : "No inspection has been requested yet."}</p> : (
            <ul className="space-y-1.5">
              {s.recent.map((row) => (
                <li key={row.id}>
                  <button type="button" onClick={() => onOpenInspection(row.id)} className="flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left hover:bg-surface-muted">
                    <strong className="w-20 flex-none text-xs tabular-nums">{refNumber("ir", row.number)}</strong>
                    <span className="min-w-0 flex-1 truncate text-sm">{row.title}</span>
                    {row.score !== null ? <span className="text-xs font-bold tabular-nums">{row.score}%</span> : null}
                    <Chip tone={inspectionTone[row.status]}>{inspectionStatusLabels[row.status]}</Chip>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section aria-label="Quality by trade" className="rounded-xl border border-line bg-surface p-4">
        <div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-extrabold">Quality by trade</h2><button type="button" className={buttonSecondary + " !py-1 !text-xs"} onClick={print}>Print summary</button></div>
        {s.by_trade.length === 0 ? <p className="text-sm text-fg-muted">{filtered ? "No quality records in these dates." : "Appears after the first inspection."}</p> : (
          <ul className="space-y-3">
            {s.by_trade.map((row) => (
              <li key={row.trade} className="grid items-center gap-2 sm:grid-cols-[11rem_1fr_9rem]">
                <span className="text-sm font-semibold">{tradeLabels[row.trade]}</span>
                <Meter value={row.pass_rate ?? 0} tone={row.pass_rate === null ? "brand" : row.pass_rate >= ws.threshold ? "green" : "red"} label={`${tradeLabels[row.trade]} pass rate`} />
                <span className="text-xs text-fg-muted">{row.pass_rate === null ? "no result yet" : `${row.pass_rate}% pass`} • {row.open_defects} open NCR{row.open_defects === 1 ? "" : "s"}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

// ---------------------------------------------------------------- Inspections
export type InspectionKind = "work" | "stage"
// Work item QA = requested from a work item (FLOOR, WALL…); stage / hold point = a separate inspection of a stage. Never interchangeable.
// `dates` (QA register calendar filter) keeps inspections requested on those Manila days; search, filters and CSV follow it.
export function InspectionsPanel({ ws, onOpen, onNew, canRequest, kind: fixedKind, dates = allDates, mode = "foreman" }: { ws: QaWorkspace; onOpen: (id: string) => void; onNew: () => void; canRequest: boolean; kind?: InspectionKind; dates?: DateRange; mode?: QaMode }) {
  const submissionIndex=useQaSubmissionIndex(ws.projectId)
  const groups=useMemo(()=>checklistGroups(submissionIndex.rows),[submissionIndex.rows])
  const [checklist,setChecklist]=useState("")
  const matchedIds=useMemo(()=>new Set(groups.find(group=>group.key===checklist)?.rows.map(row=>row.inspection_id) ?? []),[groups,checklist])
  const namesByInspection=useMemo(()=>new Map(submissionIndex.rows.map(row=>[row.inspection_id,checklistNames(row)])),[submissionIndex.rows])
  const [status, setStatus] = useState<"all" | "open" | InspectionStatus>(mode === "engineer" ? "requested" : "all")
  useEffect(() => { setChecklist(""); setStatus(mode === "engineer" ? "requested" : "all") }, [ws.projectId, mode])
  // Keep Requested available even when caught up; retain a selected status if its last record changes.
  const statuses = (["requested", "in_progress", "passed", "conditional", "failed", "cancelled"] as const)
    .filter(value => mode !== "engineer" || value === "requested" || value === status || ws.inspections.some(row => row.status === value))
  const [trade, setTrade] = useState<"all" | Trade>("all")
  const [query, setQuery] = useState("")
  const [kindFilter, setKindFilter] = useState<"all" | InspectionKind>(fixedKind ?? "all")
  const kindOf = (id: string): InspectionKind => (namesByInspection.has(id) ? "work" : "stage")
  const list = useMemo(() => {
    const text = query.trim().toLowerCase()
    return ws.inspections.filter((row) => inRange(row.requested_at, dates) && (kindFilter === "all" || kindOf(row.id) === kindFilter) && (!checklist || matchedIds.has(row.id)) && (status === "all" || (status === "open" ? row.status === "requested" || row.status === "in_progress" : row.status === status)) && (trade === "all" || row.trade === trade) && (!text || `${refNumber("ir", row.number)} ${row.title} ${row.location ?? ""} ${(namesByInspection.get(row.id) ?? []).join(" ")}`.toLowerCase().includes(text)))
  }, [ws.inspections, status, trade, query,checklist,matchedIds,namesByInspection,kindFilter,dates]) // eslint-disable-line react-hooks/exhaustive-deps

  const exportCsv = () => downloadCsv(`inspections-${ws.project?.code ?? "project"}-${ws.today}.csv`, toCsv(["IR", "Type", "Title", "Work item(s)", "Trade", "Location", "Status", "Score %", "Pass mark %", "Requested by", "Requested", "Inspector", "Completed"], list.map((row) => [refNumber("ir", row.number), kindOf(row.id) === "work" ? "Work item QA" : "Stage / hold point", row.title, (namesByInspection.get(row.id) ?? []).join(" / "), tradeLabels[row.trade], row.location ?? "", inspectionStatusLabels[row.status], row.score ?? "", row.threshold ?? "", ws.nameOf(row.requested_by), row.requested_at.slice(0, 10), ws.nameOf(row.inspector_id), row.completed_at?.slice(0, 10) ?? ""]))) // eslint-disable-line

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search IR, work or work item name..." aria-label="Search inspections" className={`${inputClass} !w-64`} />
        {!fixedKind ? <select aria-label="Filter by request type" className={`${inputClass} !w-auto`} value={kindFilter} onChange={(event) => setKindFilter(event.target.value as typeof kindFilter)}><option value="all">All request types</option><option value="work">Work item QA</option><option value="stage">Stage / hold point</option></select> : null}
        {fixedKind !== "stage" ? <select aria-label="Filter by work item name" className={`${inputClass} !w-auto max-w-full`} value={checklist} disabled={submissionIndex.loading || Boolean(submissionIndex.error)} onChange={event=>setChecklist(event.target.value)}><option value="">All work items</option>{groups.map(group=><option key={group.key} value={group.key}>{group.name} ({group.rows.length} requests)</option>)}</select> : null}
        <select aria-label="Filter by status" className={`${inputClass} !w-auto`} value={status} onChange={(event) => setStatus(event.target.value as typeof status)}>
          {mode !== "engineer" ? <><option value="all">All statuses</option><option value="open">Waiting or in progress</option></> : null}
          {statuses.map((value) => <option key={value} value={value}>{inspectionStatusLabels[value]}</option>)}
          {mode === "engineer" ? <option value="all">All statuses</option> : null}
        </select>
        <select aria-label="Filter by trade" className={`${inputClass} !w-auto`} value={trade} onChange={(event) => setTrade(event.target.value as typeof trade)}><option value="all">All trades</option>{trades.map((value) => <option key={value} value={value}>{tradeLabels[value]}</option>)}</select>
        <span className="ml-auto flex gap-2">
          <button type="button" className={buttonSecondary} onClick={exportCsv} disabled={!list.length}>Export CSV</button>
          {canRequest && fixedKind !== "work" ? <button type="button" className={buttonPrimary} onClick={onNew}>Request stage / hold-point inspection</button> : null}
        </span>
      </div>
      {submissionIndex.error ? <p role="alert" className="text-sm text-danger-fg">{submissionIndex.error}<button type="button" className="ml-2 font-bold underline" onClick={()=>void submissionIndex.reload()}>Retry</button></p> : null}
      {ws.loading || submissionIndex.loading ? <SkeletonList rows={5} label="Loading inspections" /> : ws.inspections.length === 0 ? (
        <EmptyState title="No inspections yet" action={canRequest && fixedKind !== "work" ? <button type="button" className={buttonPrimary} onClick={onNew}>Request stage / hold-point inspection</button> : undefined}>Work items are submitted from the work item itself. Stage and hold-point inspections are requested here and recorded by the Engineer against their criteria.</EmptyState>
      ) : list.length === 0 ? <EmptyState title="Nothing matches">{isFiltered(dates) ? "Change the dates, the filters or the search." : "Change the filters or the search."}</EmptyState> : (
        <Table label="Inspections" head={["IR", "Inspection", "Trade", "Status", "Score", "Requested", "Target / owner", "Inspector"]}>
          {list.map((row: Inspection) => (
            <tr key={row.id} tabIndex={0} aria-label={`Open ${refNumber("ir", row.number)}: ${row.title}`} onClick={() => onOpen(row.id)} onKeyDown={event => { if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); onOpen(row.id) } }} className="cursor-pointer hover:bg-surface-muted/60 focus:bg-brand-soft focus-visible:outline-2 focus-visible:outline-brand">
              <td className="whitespace-nowrap px-3 py-2"><button type="button" className={rowButton} onClick={event => { event.stopPropagation(); onOpen(row.id) }}>{refNumber("ir", row.number)}</button></td>
              <td className="px-3 py-2"><span className="block font-semibold">{row.title}</span>{row.location ? <span className="block text-xs text-fg-muted">{row.location}</span> : null}<span className="block text-xs font-bold text-brand-text">{kindOf(row.id) === "work" ? `Work item QA · ${(namesByInspection.get(row.id) ?? []).join(" · ")}` : "Stage / hold point"}</span></td>
              <td className="px-3 py-2 text-xs">{tradeLabels[row.trade]}</td>
              <td className="px-3 py-2"><Chip tone={inspectionTone[row.status]}>{inspectionStatusLabels[row.status]}</Chip>{(ws.canActOn?.(row) ?? true) ? null : <span className="ml-1"><Chip tone="border border-line bg-surface-muted text-fg-muted">View only</Chip></span>}{row.reinspection_of ? <span className="ml-1 text-[11px] font-bold text-fg-muted">re-inspection</span> : null}</td>
              <td className="px-3 py-2 tabular-nums">{row.score === null ? "-" : `${row.score}%`}</td>
              <td className="whitespace-nowrap px-3 py-2 text-xs text-fg-muted">{day(row.requested_at)} • {ws.nameOf(row.requested_by)}</td>
              <td className="px-3 py-2 text-xs"><span className={row.target_at && Date.parse(row.target_at) < Date.now() && ["requested", "in_progress"].includes(row.status) ? "font-bold text-danger-fg" : "text-fg-muted"}>{row.target_at ? new Date(row.target_at).toLocaleString("en-PH", { timeZone: "Asia/Manila", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—"}</span><span className="block text-fg-muted">{ws.nameOf(row.escalation_owner ?? null)}</span></td>
              <td className="whitespace-nowrap px-3 py-2 text-xs text-fg-muted">{row.inspector_id ? ws.nameOf(row.inspector_id) : "-"}</td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- Defects (NCR register)
// `dates` (QA register calendar filter) keeps NCRs raised on those Manila days; search, filters and CSV follow it.
export function DefectsPanel({ ws, mode, onOpen, onNew, scope, dates = allDates }: { ws: QaWorkspace; mode: QaMode; onOpen: (id: string) => void; onNew: (() => void) | null; scope?: (defect: Defect) => boolean; dates?: DateRange }) {
  const { profile } = useAuth()
  const [status, setStatus] = useState<"all" | "open_all" | "late" | DefectStatus>(mode === "foreman" ? "open_all" : "all")
  const [severity, setSeverity] = useState<"all" | "critical" | "major" | "minor">("all")
  const [trade, setTrade] = useState<"all" | Trade>("all")
  const [mine, setMine] = useState(mode === "foreman")
  const [query, setQuery] = useState("")
  const list = useMemo(() => {
    const text = query.trim().toLowerCase()
    return ws.defects.filter((row) => {
      if (scope && !scope(row)) return false
      if (!inRange(row.raised_at, dates)) return false
      if (status === "open_all" ? row.status === "closed" : status === "late" ? dueState(row, ws.today).state !== "overdue" : status !== "all" && row.status !== status) return false
      if (severity !== "all" && row.severity !== severity) return false
      if (trade !== "all" && row.trade !== trade) return false
      if (mine && row.assigned_to !== profile?.id) return false
      return !text || `${refNumber("ncr", row.number)} ${row.title} ${row.description ?? ""} ${row.reference ?? ""}`.toLowerCase().includes(text)
    })
  }, [ws.defects, ws.today, status, severity, trade, mine, query, profile?.id, scope, dates])

  const exportCsv = () =>
    downloadCsv(`ncr-register-${ws.project?.code ?? "project"}-${ws.today}.csv`, toCsv(["NCR", "Title", "Class", "Category", "Trade", "Standard", "Status", "Responsible", "Raised", "Due", "Closed", "Root cause", "Corrective action", "Preventive action", "Closing note"], list.map((row) => [refNumber("ncr", row.number), row.title, qaSeverityLabels[row.severity], row.category, tradeLabels[row.trade], row.reference ?? "", defectStatusLabels[row.status], ws.nameOf(row.assigned_to), row.raised_at.slice(0, 10), row.due_date ?? "", row.closed_at?.slice(0, 10) ?? "", row.root_cause ?? "", row.corrective_action ?? "", row.closing_note ?? ""])))

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search defects..." aria-label="Search defects" className={`${inputClass} !w-52`} />
        <select aria-label="Filter by status" className={`${inputClass} !w-auto`} value={status} onChange={(event) => setStatus(event.target.value as typeof status)}>
          <option value="all">All statuses</option><option value="open_all">Not closed</option><option value="late">Overdue</option>
          {(["open", "in_progress", "for_verification", "closed"] as const).map((value) => <option key={value} value={value}>{defectStatusLabels[value]}</option>)}
        </select>
        <select aria-label="Filter by class" className={`${inputClass} !w-auto`} value={severity} onChange={(event) => setSeverity(event.target.value as typeof severity)}><option value="all">All classes</option>{severities.map((value) => <option key={value} value={value}>{qaSeverityLabels[value]}</option>)}</select>
        <select aria-label="Filter by trade" className={`${inputClass} !w-auto`} value={trade} onChange={(event) => setTrade(event.target.value as typeof trade)}><option value="all">All trades</option>{trades.map((value) => <option key={value} value={value}>{tradeLabels[value]}</option>)}</select>
        <label className="flex items-center gap-1.5 text-sm font-semibold"><input type="checkbox" checked={mine} onChange={(event) => setMine(event.target.checked)} /> Assigned to me</label>
        <span className="ml-auto flex gap-2">
          <button type="button" className={buttonSecondary} onClick={exportCsv} disabled={!list.length}>Export CSV</button>
          {onNew ? <button type="button" className={buttonPrimary} onClick={onNew}>Raise NCR</button> : null}
        </span>
      </div>
      {ws.loading ? <SkeletonList rows={5} label="Loading defects" /> : ws.defects.length === 0 ? (
        <EmptyState title="No non-conformances">When an inspection item fails, an NCR is raised automatically and assigned to the foreman. You can also raise one by hand.</EmptyState>
      ) : list.length === 0 ? <EmptyState title="Nothing matches">{isFiltered(dates) ? "Change the dates, the filters or the search." : "Change the filters or the search."}</EmptyState> : (
        <Table label="Non-conformance register" head={["NCR", "Defect", "Class", "Status", "Responsible", "Deadline"]}>
          {list.map((row: Defect) => {
            const due = dueState(row, ws.today)
            return (
              <tr key={row.id} tabIndex={0} aria-label={`Open ${refNumber("ncr", row.number)}: ${row.title}`} onClick={() => onOpen(row.id)} onKeyDown={event => { if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); onOpen(row.id) } }} className="cursor-pointer hover:bg-surface-muted/60 focus:bg-brand-soft">
                <td className="whitespace-nowrap px-3 py-2"><button type="button" className={rowButton} onClick={() => onOpen(row.id)}>{refNumber("ncr", row.number)}</button></td>
                <td className="px-3 py-2"><button type="button" className={rowButton} onClick={e => { e.stopPropagation(); onOpen(row.id) }}>{row.title}</button><span className="block text-xs text-fg-muted">{tradeLabels[row.trade]}{row.reference ? ` • ${row.reference}` : ""}</span></td>
                <td className="px-3 py-2"><Chip tone={severityTone[row.severity]}>{qaSeverityLabels[row.severity]}</Chip></td>
                <td className="px-3 py-2"><Chip tone={defectTone[row.status]}>{defectStatusLabels[row.status]}</Chip>{(ws.canActOn?.(row) ?? true) ? null : <span className="ml-1"><Chip tone="border border-line bg-surface-muted text-fg-muted">View only</Chip></span>}</td>
                <td className="whitespace-nowrap px-3 py-2 text-xs text-fg-muted">{ws.nameOf(row.assigned_to)}</td>
                <td className={`whitespace-nowrap px-3 py-2 text-xs font-bold ${dueTone[due.state]}`}>{dueText(row, ws.today)}</td>
              </tr>
            )
          })}
        </Table>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- Checklists
function Viewer({ template, canEdit, onClose, onDuplicate }: { template: Template; canEdit: boolean; onClose: () => void; onDuplicate: () => void }) {
  return (
    <Modal
      title={template.name}
      description={`${tradeLabels[template.trade]}${template.standards.length ? ` • ${template.standards.join(", ")}` : ""}`}
      size="xl"
      onClose={onClose}
      footer={<>{canEdit ? <button type="button" className={buttonSecondary} onClick={onDuplicate}>Copy to my project</button> : null}<button type="button" className={buttonSecondary} onClick={onClose}>Close</button></>}
    >
      {template.description ? <p className="mb-3 text-sm text-fg-muted">{template.description}</p> : null}
      <div className="mb-3"><ChecklistDocumentation standards={template.standards} items={template.qa_template_items} /></div>
      <ol className="space-y-2">
        {template.qa_template_items.map((item, index) => (
          <li key={item.id} className="rounded-lg border border-line bg-surface p-3">
            <p className="text-sm font-semibold"><span className="mr-2 text-fg-muted">{index + 1}.</span>{item.text}</p>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <SeverityChip severity={item.severity} />{item.hold_point ? <HoldChip /> : null}
              {item.requires_photo ? <Chip tone="bg-surface-muted text-fg-muted">Photo required</Chip> : null}
              {item.kind === "measure" ? <span className="text-xs text-fg-muted">Measure: {toleranceText(item)}</span> : null}
              {item.reference ? <span className="text-xs text-fg-muted">{item.reference}</span> : null}
            </div>
            <QaRequirements item={item} />
          </li>
        ))}
      </ol>
    </Modal>
  )
}

export function ChecklistsPanel({ ws, canEdit, canEditLibrary, onEdit }: { ws: QaWorkspace; canEdit: boolean; canEditLibrary: boolean; onEdit: (template: Template | null, scope: "project" | "library") => void }) {
  const toast = useToast()
  const confirm = useConfirm()
  const [viewing, setViewing] = useState<Template | null>(null)
  const [showArchived, setShowArchived] = useState(false)
  const [busy, setBusy] = useState(false)
  // A project's Checklist configuration lists only that project's added checklists (20261028150000); the library view stays below.
  if (ws.projectId) return <ProjectChecklists ws={ws} canEdit={canEdit} onEdit={onEdit} />
  const groups = [
    { name: "Company library", note: "Built in. Read-only; copy one to adapt it to your project.", list: ws.templates.filter((t) => t.project_id === null && (showArchived || !t.archived)) },
    { name: "This project", note: "Edited by the project's engineers.", list: ws.templates.filter((t) => t.project_id !== null && (showArchived || !t.archived)) },
  ]

  const duplicate = async (template: Template) => {
    if (!ws.projectId) return
    setBusy(true)
    const result = await qaActions.duplicateTemplate(template.id, ws.projectId)
    setBusy(false)
    if (!result.ok) return toast.error("Not copied", result.message)
    toast.success("Copied to this project", "Open it under This project to adapt it")
    setViewing(null)
    await ws.reloadTemplates()
  }
  const archive = async (template: Template) => {
    if (!template.archived && !(await confirm({ title: `Archive "${template.name}"?`, message: "It disappears from new requests. Inspections already created keep their list.", confirmLabel: "Archive" }))) return
    const result = await qaActions.archiveTemplate(template.id, !template.archived)
    if (!result.ok) return toast.error("Not changed", result.message)
    toast.success(template.archived ? "Checklist restored" : "Checklist archived")
    await ws.reloadTemplates()
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-1.5 text-sm font-semibold"><input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} /> Show archived</label>
        <span className="flex gap-2">
          {canEdit ? <button type="button" className={buttonPrimary} onClick={() => onEdit(null, "project")}>New checklist</button> : null}
          {canEditLibrary ? <button type="button" className={buttonPrimary} onClick={() => onEdit(null, "library")}>New library checklist</button> : null}
        </span>
      </div>
      {ws.loading ? <SkeletonList rows={4} label="Loading checklists" /> : groups.map((group) => group.name === "This project" && !ws.projectId ? null : (
        <section key={group.name} aria-label={group.name}>
          <h2 className="text-sm font-extrabold">{group.name}</h2>
          <p className="mb-2 text-xs text-fg-muted">{group.note}</p>
          {group.list.length === 0 ? <p className="rounded-xl border border-dashed border-line p-4 text-sm text-fg-muted">{group.name === "This project" ? "No project checklist yet. Copy one from the library or create your own." : "No checklist."}</p> : (
            <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {group.list.map((template) => {
                const holds = template.qa_template_items.filter((i) => i.hold_point).length
                const editable = template.project_id ? canEdit : canEditLibrary && !template.is_system
                return (
                  <li key={template.id} className={`flex flex-col rounded-xl border border-line bg-surface p-4 ${template.archived ? "opacity-60" : ""}`}>
                    <div className="flex items-start justify-between gap-2"><h3 className="text-sm font-extrabold">{template.name}</h3>{template.archived ? <Chip tone="bg-gray-200 text-gray-700 dark:bg-gray-700/60 dark:text-gray-200">Archived</Chip> : template.is_system ? <Chip tone="bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200">Built in</Chip> : null}</div>
                    <p className="mt-1 text-xs text-fg-muted">{tradeLabels[template.trade]} • {template.qa_template_items.length} items{holds ? ` • ${holds} hold point${holds === 1 ? "" : "s"}` : ""}</p>
                    {template.standards.length ? <p className="mt-1 text-xs font-semibold text-fg-muted">{template.standards.join(" • ")}</p> : null}
                    <div className="mt-auto flex flex-wrap gap-2 pt-3">
                      <button type="button" className={buttonSecondary + " !py-1 !text-xs"} onClick={() => setViewing(template)}>View</button>
                      {editable ? <button type="button" className={buttonSecondary + " !py-1 !text-xs"} onClick={() => onEdit(template, template.project_id ? "project" : "library")}>Edit</button> : null}
                      {canEdit && template.project_id === null && ws.projectId ? <button type="button" className={buttonSecondary + " !py-1 !text-xs"} disabled={busy} onClick={() => void duplicate(template)}>Copy to project</button> : null}
                      {(template.project_id ? canEdit : canEditLibrary) ? <button type="button" className={buttonSecondary + " !py-1 !text-xs"} onClick={() => void archive(template)}>{template.archived ? "Restore" : "Archive"}</button> : null}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      ))}
      {viewing ? <Viewer template={viewing} onClose={() => setViewing(null)} canEdit={canEdit && viewing.project_id === null && Boolean(ws.projectId)} onDuplicate={() => void duplicate(viewing)} /> : null}
    </div>
  )
}
