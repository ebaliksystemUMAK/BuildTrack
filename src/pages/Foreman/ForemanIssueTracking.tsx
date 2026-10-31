import { useEffect, useMemo, useRef, useState } from "react"
import ProjectContextBar from "../../components/ProjectContextBar"
import { DefectsPanel } from "../../components/qa/QaPanels"
import DefectDetail from "../../components/qa/DefectDetail"
import InspectionDetail from "../../components/qa/InspectionDetail"
import WorkItemBoard, { type BoardExtra, type BoardFilter } from "../../components/qa/WorkItemBoard"
import WorkItemWorkspace from "../../components/qa/WorkItemWorkspace"
import { EmptyState, PageHead, buttonPrimary, buttonSecondary } from "../../components/ui/PageParts"
import { useAuth } from "../../lib/auth"
import { severityChip, severityLabels, statusChip, statusLabels, type Pin } from "../../lib/blueprints"
import { getSelectedProjectId } from "../../lib/projects"
import { useQaWorkspace } from "../../lib/qaWorkspace"
import { useItemParam, useWorkItems } from "../../lib/workItem"
import ReportModal from "./ReportModal"
import type { ForemanPageProps } from "./types"
import IssueDetails from "../../components/issues/IssueDetails"
import { useIssueRegister } from "../../lib/siteIssues"
import { correctionGroup, correctionRecordMatches } from "../../lib/foremanCorrectionsModel"
import type { Defect } from "../../lib/qa"

// Corrections: one place for everything the Foreman must fix. Work items that failed inspection or were returned are corrected with
// ONE correction package (remarks + new photos once, the NCRs it answers, re-inspection). NCRs that belong to no work item (site
// findings, stage / hold-point inspections) keep their own form; site issues on a pin keep the progress report.
export default function ForemanIssueTracking(_: ForemanPageProps) {
  const { profile } = useAuth()
  const projectId = getSelectedProjectId()
  const ws = useQaWorkspace(projectId)
  const work = useWorkItems(projectId, ws.work.pins, ws.inspections, ws.defects)
  const [itemId, setItemId] = useItemParam()
  const [reporting, setReporting] = useState<Pin | null>(null)
  const [issueId, setIssueId] = useState<string | null>(null)
  const [defectId, setDefectId] = useState<string | null>(null)
  const [inspectionId, setInspectionId] = useState<string | null>(null)
  const [search, setSearch] = useState(window.location.search)
  const deepLinked = useRef("")
  const [linkError, setLinkError] = useState("")
  useEffect(() => { const changed = () => setSearch(window.location.search); window.addEventListener("popstate", changed); return () => window.removeEventListener("popstate", changed) }, [])
  const issueRegister=useIssueRegister(projectId)
  const mine = work.rows.filter((row) => row.pin.assigned_to === profile?.id)
  const linked = useMemo(() => new Set(work.rows.flatMap((row) => row.ncrs.map((ncr) => ncr.id))), [work.rows])
  const scope = useMemo(() => (defect: { id: string }) => !linked.has(defect.id), [linked])
  const issues = ws.work.pins.filter((pin) => (pin.status === "issue" || (issueRegister.everRaised.has(pin.id) && pin.status!=="verified")) && pin.assigned_to === profile?.id)
  const groups = [
    { key: "fix", short: "To fix", title: "Corrections to submit", hint: "Open the item, describe the fix once, add new photos, tick the NCRs it answers and submit one correction package.", rows: mine.filter(row => correctionGroup(row) === "fix") },
    { key: "review", short: "In review", title: "Corrections the Engineer is reviewing", hint: "Correction packages awaiting reinspection, NCR verification or manual task completion.", rows: mine.filter(row => correctionGroup(row) === "review") },
    { key: "completed", short: "Completed", title: "Completed tasks", always: true, hint: "Manually completed by the Engineer after QA passed and all linked NCRs were closed. Earlier corrections remain in the record.", rows: mine.filter(row => correctionGroup(row) === "completed") },
  ]
  // The other lists join the board's chips, so choosing To fix (or any chip) shows only that list; All shows them all.
  // Other NCRs counts the open ones assigned to you (what its register shows first) and stays available at 0, because it is
  // also where closed NCRs are looked up.
  const otherNcrs = ws.defects.filter(scope)
  const pinsById = new Map(ws.work.pins.map(pin => [pin.id, pin]))
  const ncrMatches = (defect: Defect, filters: BoardFilter) => {
    const pin = defect.pin_id ? pinsById.get(defect.pin_id) : undefined
    return correctionRecordMatches({ pinId: defect.pin_id, sheetId: pin?.blueprint_id, itemIds: defect.checklist_item_id ? [defect.checklist_item_id] : [],
      text: `NCR-${String(defect.number).padStart(4, "0")} ${defect.title} ${defect.description ?? ""} ${defect.checklist_name ?? ""} ${pin?.title ?? ""} ${pin ? ws.work.sheetOf(pin.blueprint_id) : ""}` }, filters)
  }
  const issueMatches = (pin: Pin, filters: BoardFilter) => {
    const reports = issueRegister.reports.filter(report => report.pin_id === pin.id)
    // Search and checklist item must match the same observation, not two unrelated reports on a pin.
    return reports.some(report => correctionRecordMatches({ pinId: pin.id, sheetId: pin.blueprint_id, itemIds: report.checklist_item_id ? [report.checklist_item_id] : [],
      text: `${pin.title} ${ws.work.sheetOf(pin.blueprint_id)} ${report.description} ${report.checklist_name ?? ""}` }, filters))
      || (!filters.scope.item && correctionRecordMatches({ pinId: pin.id, sheetId: pin.blueprint_id, itemIds: [], text: `${pin.title} ${ws.work.sheetOf(pin.blueprint_id)}` }, filters))
  }
  const siteIssueList = (list: Pin[]) => list.length ? <ul className="space-y-3">
    {list.map(pin => <li key={pin.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line border-l-4 border-l-red-600 bg-surface p-4">
      <span className="min-w-0"><span className="block text-sm font-extrabold">{pin.title}</span><span className="text-xs text-fg-muted">{ws.work.sheetOf(pin.blueprint_id)}</span></span>
      <span className="flex flex-wrap items-center gap-2 text-[11px]">
        <span className={`rounded px-1.5 py-0.5 font-extrabold uppercase ${severityChip[pin.severity]}`}>{severityLabels[pin.severity]}</span>
        <span className={`rounded-full px-2 py-0.5 font-bold ${statusChip[pin.status]}`}>{statusLabels[pin.status]}</span>
        <button type="button" className={buttonPrimary + " !px-3 !py-1.5 !text-xs"} onClick={() => setIssueId(pin.id)}>Details / photos</button>
        <button type="button" className={buttonSecondary + " !px-3 !py-1.5 !text-xs"} onClick={() => setReporting(pin)}>{pin.status === "for_review" ? "View work / QA" : "Fix and report"}</button>
      </span>
    </li>)}
  </ul> : <EmptyState title="Nothing matches">No site issue matches these filters.</EmptyState>
  const filterPins = ws.work.pins.filter(pin => issues.some(issue => issue.id === pin.id) || otherNcrs.some(ncr => ncr.pin_id === pin.id))
  const filterItems = work.rows.filter(row => filterPins.some(pin => pin.id === row.pin.id)).map(row => row.item)
  const ncrContent = (filters?: BoardFilter) => <DefectsPanel ws={ws} mode="foreman" onNew={null} onOpen={setDefectId} scope={defect => scope(defect) && (!filters || ncrMatches(defect, filters))} />
  const extras: BoardExtra[] = [
    { key: "other-ncrs", short: "Other NCRs", title: "Other NCRs", hint: "Raised on site or by a stage / hold-point inspection, not by a task. Record the corrective action and a photo in the NCR itself.",
      count: otherNcrs.filter((defect) => defect.status !== "closed" && defect.assigned_to === profile?.id).length, always: otherNcrs.length > 0,
      filterPins, filterItems, content: ncrContent(), filter: filters => {
        const list = otherNcrs.filter(defect => ncrMatches(defect, filters))
        return { count: list.filter(defect => defect.status !== "closed" && defect.assigned_to === profile?.id).length, hasMatches: list.length > 0, content: ncrContent(filters) }
      } },
    { key: "site-issues", short: "Site issues", title: "Site issues on your work", hint: "Problems the Engineer logged on your work pins. Fix them and report the progress.", count: issues.length,
      filterPins, filterItems, content: siteIssueList(issues), filter: filters => {
        const list = issues.filter(pin => issueMatches(pin, filters))
        return { count: list.length, hasMatches: list.length > 0, content: siteIssueList(list) }
      } },
  ]
  const loading = work.loading || ws.loading || issueRegister.loading
  const error = work.error || ws.error || ws.work.error || issueRegister.error || ""
  const reload = async () => { await Promise.all([ws.reloadAll(), ws.work.reload(), work.reload(), issueRegister.reload()]) }
  // Deep links open independently of the selected list/filters (the default is no longer All).
  useEffect(() => {
    const key = `${projectId}:${search}`
    if (deepLinked.current === key || loading || error) return
    setDefectId(null); setInspectionId(null); setIssueId(null); setReporting(null); setLinkError("")
    const params = new URLSearchParams(search)
    const defect = params.get("defect"), issue = params.get("issue"), inspection = params.get("inspection")
    if (defect && ws.defects.some(row => row.id === defect)) setDefectId(defect)
    else if (inspection && ws.inspections.some(row => row.id === inspection)) setInspectionId(inspection)
    else if (issue) {
      const pinId = issueRegister.reports.find(report => report.id === issue)?.pin_id ?? issue
      if (ws.work.pins.some(pin => pin.id === pinId && pin.assigned_to === profile?.id)) setIssueId(pinId)
      else setLinkError("This linked issue is unavailable in the selected project, or your access has changed.")
    } else if (defect || inspection) setLinkError("This linked QA record is unavailable in the selected project, or your access has changed.")
    deepLinked.current = key
  }, [projectId, search, loading, error, ws.defects, ws.inspections, ws.work.pins, issueRegister.reports, profile?.id])
  const defect = ws.defects.find(row => row.id === defectId)
  const inspection = ws.inspections.find(row => row.id === inspectionId)
  const issuePin = ws.work.pins.find(pin => pin.id === issueId && pin.assigned_to === profile?.id)
  const reportPin = ws.work.pins.find(pin => pin.id === reporting?.id && pin.assigned_to === profile?.id)
  return (
    <div className="foreman-page">
      <ProjectContextBar listPath="/foreman/projects" listLabel="My projects" />
      <PageHead eyebrow="Quality assurance" title="Corrections"
        description="Tasks sent back, corrections in review and completed tasks, in one place. Submit one correction package for full QC checklist reinspection. Only the Engineer closes an NCR and completes the task."
        actions={<button type="button" className={buttonSecondary} onClick={() => void reload()}>Refresh</button>} />
      {linkError ? <p role="alert" className="mb-3 text-sm text-danger-fg">{linkError}</p> : null}
      {projectId ? <>
        <WorkItemBoard key={`${projectId}:${profile?.id}`} groups={groups} extras={extras} loading={Boolean(loading)} error={error} nameOf={ws.nameOf} sheetOf={ws.work.sheetOf} onOpen={setItemId}
          emptyTitle="Nothing to correct" emptyText="When an inspection fails or the Engineer returns a task, it appears here with its NCRs." />
      </> : null}
      {itemId ? <WorkItemWorkspace itemId={itemId} onClose={() => setItemId(null)} onChanged={reload} /> : null}
      {reportPin ? <ReportModal key={reportPin.id} pin={reportPin} onClose={() => setReporting(null)} onSaved={async () => { setReporting(null); await reload() }} /> : null}
      {issuePin ? <IssueDetails key={issuePin.id} pin={issuePin} nameOf={ws.nameOf} onClose={() => setIssueId(null)} /> : null}
      {defect && ws.project ? <DefectDetail key={defect.id} defect={defect} project={ws.project} foremen={ws.foremen} today={ws.today} canWork canVerify={false} nameOf={ws.nameOf}
        onClose={() => setDefectId(null)} onChanged={reload} onOpenInspection={id => { setDefectId(null); setInspectionId(id) }} /> : null}
      {inspection && ws.project ? <InspectionDetail key={inspection.id} inspection={inspection} project={ws.project} weights={ws.weights} threshold={ws.threshold} defects={ws.defects}
        canInspect={false} canRequest nameOf={ws.nameOf} onClose={() => setInspectionId(null)} onChanged={reload}
        onOpenDefect={row => { setInspectionId(null); setDefectId(row.id) }} onOpenInspection={setInspectionId} /> : null}
    </div>
  )
}
