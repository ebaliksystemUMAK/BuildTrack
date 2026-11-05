import { useEffect, useId, useMemo, useRef, useState } from "react"
import Modal from "../Modal"
import EvidenceCompare from "./EvidenceCompare"
import LimitedTimeline from "../ui/LimitedTimeline"
import { SkeletonList } from "../ui/Skeleton"
import { buttonDanger, buttonPrimary, buttonSecondary, inputClass } from "../ui/PageParts"
import { ChecklistUploadButton, PinPhotos, dbMessage, field } from "../editor/PinParts"
import WorkChecklistEditor from "./WorkChecklistEditor"
import QaRequirements from "./QaRequirements"
import CorrectionForm from "./CorrectionForm"
import DefectDetail from "./DefectDetail"
import OpenOnBlueprint from "../OpenOnBlueprint"
import InspectionDetail from "./InspectionDetail"
import QaAttemptHistory from "./QaAttemptHistory"
import SubmittedEvidence from "./SubmittedEvidence"
import { Chip, SeverityChip } from "./QaBits"
import { NextActionCard, StageRail } from "./WorkItemParts"
import { useAuth } from "../../lib/auth"
import { useConfirm } from "../../lib/confirm"
import { useToast } from "../../lib/toast"
import { formatStamp, type PinPhoto } from "../../lib/blueprints"
import { photoEligible } from "../../lib/photoStamp"
import { manilaToday } from "../../lib/progress"
import { useProject, useProjectTeam } from "../../lib/projects"
import { usePinTypeAccess } from "../../lib/blueprintAccess"
import { defectStatusLabels, defectTone, dueText, inspectionStatusLabels, inspectionTone, qaActions, useInspectionItems, useTemplates, type Defect, type Inspection } from "../../lib/qa"
import { useSettings } from "../../lib/settings"
import { supabase } from "../../lib/supabase"
import { useDefectHistory, useWorkItem } from "../../lib/workItem"
import { completionProblem, connectedHistory, irRef, ncrRef, pinLevelDefects, readWorkItemTab, type SubmissionRef, type WorkItemTab } from "../../lib/workItemModel"

type Tab = WorkItemTab
const tabNames: Record<Tab, string> = { inspection: "Inspection", corrections: "Corrections & NCRs", evidence: "Evidence", history: "Attempts & history" }
const heading = "mb-2 text-xs font-extrabold uppercase tracking-wider text-fg-muted"
const resultTone: Record<string, string> = { pass: "bg-green-100 text-green-900 dark:bg-green-900/40 dark:text-green-100", fail: "bg-red-100 text-red-900 dark:bg-red-900/40 dark:text-red-100", na: "bg-surface-muted text-fg-muted", pending: "bg-surface-muted text-fg-muted" }
const resultWord: Record<string, string> = { pass: "Pass", fail: "Fail", na: "N/A", pending: "Not judged" }

// One work item (e.g. LAUNDRY -> FLOOR) as one record: next action, current inspection, corrections and linked NCRs, evidence,
// and every attempt with one connected history. The Foreman prepares and corrects here; the Engineer inspects, decides NCRs and
// manually completes the checklist here. Every write is a checked database function.
export default function WorkItemWorkspace({ itemId, onClose, onChanged, fromPlan = false }: { itemId: string; onClose: () => void; onChanged?: () => void | Promise<void>; fromPlan?: boolean }) {
  const { profile } = useAuth()
  const toast = useToast()
  const confirm = useConfirm()
  const formId = useId().replace(/:/g, "")
  const data = useWorkItem(itemId)
  const { item, pin, stage, draft, photos, defects, history, qa } = data
  const { project } = useProject(pin?.project_id ?? null)
  const { team } = useProjectTeam(pin?.project_id ?? null)
  const { settings } = useSettings()
  const [tab, setTab] = useState<Tab | null>(() => typeof window === "undefined" ? null : readWorkItemTab(window.location.search, itemId))
  const [busy, setBusy] = useState(false)
  const pending = useRef(false)
  const [inspectionOpen, setInspectionOpen] = useState<string | null>(null)
  const [defectOpen, setDefectOpen] = useState<string | null>(null)
  const [returning, setReturning] = useState(false)
  const [editingCriteria, setEditingCriteria] = useState(false)
  const draftRemark = useRef<string | null>(null)
  const { templates } = useTemplates(pin?.project_id ?? null)
  useEffect(() => {
    draftRemark.current = null
    setTab(readWorkItemTab(window.location.search, itemId))
    setInspectionOpen(null)
    setDefectOpen(null)
    setReturning(false)
    setEditingCriteria(false)
  }, [itemId])
  // A link back to this same task must still dismiss its child dialogs and select the requested section.
  useEffect(() => {
    const navigate = () => {
      const requested = readWorkItemTab(window.location.search, itemId)
      if (!requested) return
      setInspectionOpen(null)
      setDefectOpen(null)
      setReturning(false)
      setEditingCriteria(false)
      setTab(requested)
    }
    window.addEventListener("popstate", navigate)
    return () => window.removeEventListener("popstate", navigate)
  }, [itemId])

  const nameOf = (id: string | null) => (id ? team.find((member) => member.user_id === id)?.full_name ?? "Someone on the team" : "Unassigned")
  // Per-type access (20261028130000): with View only on this plan's type the work item is readable, without action buttons.
  // Without the access hook (isolated renders) the role rules alone apply, as before.
  const { canAct, viewOnly, typeLabel } = usePinTypeAccess(pin ?? null, profile?.role, profile?.id) ?? { canAct: true, viewOnly: false, typeLabel: null }
  const engineer = profile?.role === "engineer" && canAct
  const foreman = Boolean(pin && profile?.role === "foreman" && profile.status === "active" && pin.assigned_to === profile.id) && canAct
  const view = stage?.view ?? null
  const current = stage?.current ?? null
  const showReturnAction = engineer && !stage?.open && (item?.review_status === "verified"
    || (item?.review_status === "for_review" && current?.status !== "passed"))
  useEffect(() => { if (!showReturnAction) setReturning(false) }, [showReturnAction])
  const submissions = history.submissions as unknown as SubmissionRef[]
  const ncrs = stage?.ncrs ?? []
  const otherNcrs = pin ? pinLevelDefects(pin.id, submissions, defects) : []
  const previousIr = stage?.attempts.length ? stage.attempts[stage.attempts.length - 1].inspection?.number ?? null : null

  // Open on the tab where the next action happens.
  useEffect(() => {
    if (tab || !view) return
    setTab(view.stage === "correction" || view.action === "review_ncrs" || view.action === "open_ncr" ? "corrections"
      : view.stage === "preparing" || view.stage === "ready" ? "evidence" : view.stage === "completed" ? "history" : "inspection")
  }, [view, tab])

  const reload = async () => { await data.reload(); await onChanged?.() }
  const run = async (action: () => Promise<{ ok: true } | { ok: false; message: string }>, failure: string, success: string, detail?: string) => {
    if (pending.current) return false
    pending.current = true
    setBusy(true)
    try {
      if (!navigator.onLine) throw new Error("Connect to the internet first. QA steps are not queued offline.")
      const outcome = await action()
      if (!outcome.ok) throw new Error(outcome.message)
      toast.success(success, detail)
      await reload()
      return true
    } catch (error) {
      toast.error(failure, (error as Error).message)
      await data.reload()
      return false
    } finally { pending.current = false; setBusy(false) }
  }

  if (data.missing) {
    return <Modal title="Task not found" onClose={onClose} footer={<button type="button" className={buttonSecondary} onClick={onClose}>Close</button>}>
      <p className="text-sm">This task was removed, or it is not part of a project you can open.</p>
    </Modal>
  }
  if (!item || !pin || !view || !stage) {
    return <Modal title="Opening the task" size="2xl" onClose={onClose}><SkeletonList rows={4} label="Loading the task" /></Modal>
  }

  const name = item.text
  const responsible = view.owner === "Foreman" ? nameOf(pin.assigned_to) : current?.inspector_id ? nameOf(current.inspector_id) : current?.escalation_owner ? nameOf(current.escalation_owner) : "Project Engineer"
  const template = templates.find(row => row.id === (item.qa_template_id ?? pin.qa_template_id))
  const openNcrs = ncrs.filter((row) => row.status !== "closed").length
  const completionBlock = completionProblem({ loading: history.loading || data.loading, error: data.error, open: Boolean(stage.open), inspectionStatus: current?.status, openItemNcrs: openNcrs })
  const firstToFix = ncrs.find((row) => row.status === "open" || row.status === "in_progress")

  const submitFirst = async () => {
    const problem = await qa.preflight(item.id).catch((error: Error) => error.message)
    if (problem) return toast.error("QA request not sent", problem)
    if (!(await confirm({ title: `Submit ${name} for QA Review?`, message: `${pin.title} → ${name}. The Engineer inspects it against the approved criteria. Its photos and remark are locked while the request is open.`, confirmLabel: "Submit for QA Review" }))) return
    await run(async () => {
      if (draftRemark.current !== null && draftRemark.current.trim() !== (item.remark ?? "")) {
        const { data: rows, error } = await supabase.from("pin_checklist_items").update({ remark: draftRemark.current.trim() || null }).eq("id", item.id).select("id")
        if (error || !rows?.length) return { ok: false as const, message: error ? dbMessage(error) : "The remark could not be saved. Try again." }
      }
      return qaActions.submitItems(pin.id, [item.id])
    }, "QA request not sent", "QA requested", "The project Engineer has been notified.")
  }
  const startCorrection = async () => {
    if (await run(() => qaActions.beginCorrection(item.id), "Could not start the correction", "Correction started", "Describe the fix, add new photos and choose the NCRs it answers.")) setTab("corrections")
  }
  const complete = async () => {
    if (completionBlock) return toast.error("Task cannot be completed", completionBlock)
    if (!(await confirm({ title: `Complete ${name}?`, message: `The inspection passed and every NCR linked to ${name} is closed. This completes the task. The work pin completes when every item is completed and no NCR or inspection remains open.`, confirmLabel: "Complete task" }))) return
    await run(() => qaActions.completeItem(item.id), "Task not completed", `${name} completed`)
  }

  const primary = (() => {
    if (foreman) {
      if (view.action === "add_evidence") return <button type="button" className={buttonPrimary} onClick={() => setTab("evidence")}>Add photos</button>
      if (view.action === "submit") return <button type="button" className={buttonPrimary} disabled={busy} onClick={() => void submitFirst()}>Submit {name} for QA Review</button>
      if (view.action === "start_correction") return <button type="button" className={buttonPrimary} disabled={busy} onClick={() => void startCorrection()}>Start correction</button>
      if (view.action === "submit_correction") return tab === "corrections"
        ? <button type="submit" form={formId} className={buttonPrimary} disabled={busy}>{busy ? "Sending…" : "Submit correction & request reinspection"}</button>
        : <button type="button" className={buttonPrimary} onClick={() => setTab("corrections")}>Open correction form</button>
      if (view.action === "open_ncr" && firstToFix) return <button type="button" className={buttonPrimary} onClick={() => setDefectOpen(firstToFix.id)}>Correct {ncrRef(firstToFix.number)}</button>
    }
    if (engineer) {
      if (view.action === "inspect" && current) return <button type="button" className={buttonPrimary} onClick={() => setInspectionOpen(current.id)}>{current.status === "requested" ? "Start inspection" : "Record results"}</button>
    }
    return null
  })()

  const footer = <>
    <button type="button" className={buttonSecondary} onClick={onClose}>Close</button>
    {!fromPlan ? <OpenOnBlueprint projectId={pin.project_id} pinId={pin.id} sheetId={pin.blueprint_id} section="checklist" /> : null}
    {showReturnAction ? <button type="button" className={buttonSecondary} disabled={busy} onClick={() => setReturning(true)}>{item.review_status === "verified" ? `Reopen ${name}` : `Return ${name}`}</button> : null}
    {primary}
    {engineer && item.review_status === "for_review" && current?.status === "passed" ? <button type="button" className={buttonPrimary} disabled={busy || Boolean(completionBlock)} title={completionBlock || undefined} onClick={() => void complete()}>Complete task</button> : null}
  </>

  return (
    <Modal title={`${pin.title} → ${name}`} description={`QC Checklist: ${data.templateName ?? "not approved yet"} · Foreman: ${nameOf(pin.assigned_to)}`} size="2xl" onClose={busy ? () => undefined : onClose} footer={footer}>
      <p className="mb-3 rounded-lg border border-line bg-surface-muted px-3 py-2 text-xs text-fg-muted">PM-approved task schedule: {item.planned_start ?? "Start not approved"} → {item.due_date ?? "No deadline"}. Task dates can differ from the pin's overall range. Schedule changes do not approve QA.</p>
      <div className="min-w-0 space-y-4">
        {viewOnly ? <p role="status" className="rounded-lg border border-line bg-surface-muted px-3 py-2 text-sm text-fg"><strong>View only.</strong> You can read this task; people with Assigned work access to {typeLabel ?? "this"} plans act on it.</p> : null}
        <NextActionCard view={view} responsible={responsible}>
          {engineer && !stage.attempts.length && !stage.open && pin.status !== "verified" ? <button type="button" className={buttonSecondary} onClick={() => setEditingCriteria(true)}>{item.qa_template_id ? "Edit task & QC checklist" : "Add QC checklist to this task"}</button> : null}
        </NextActionCard>
        <StageRail stage={view.stage} completed={pin.status === "verified"} />
        {engineer && item.review_status === "for_review" && current?.status === "passed" && completionBlock ? <p role="status" className="rounded-lg bg-amber-100 px-3 py-2 text-xs font-semibold text-amber-950 dark:bg-amber-900/40 dark:text-amber-100">Cannot complete task: {completionBlock}</p> : null}
        {data.error ? <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger-fg">{data.error}</p> : null}

        <div className="flex flex-wrap gap-1 border-b border-line pb-2" role="tablist" aria-label="Task sections">
          {(Object.keys(tabNames) as Tab[]).map((key) => (
            <button key={key} type="button" role="tab" id={`${formId}-tab-${key}`} aria-selected={tab === key} aria-controls={`${formId}-panel-${key}`} onClick={() => setTab(key)} className={`rounded-lg px-3.5 py-1.5 text-sm font-bold ${tab === key ? "bg-brand text-white" : "text-fg-muted hover:bg-surface-muted"}`}>
              {tabNames[key]}{key === "corrections" && openNcrs ? <span className={`ml-1.5 rounded-full px-1.5 text-[11px] ${tab === key ? "bg-white/25" : "bg-surface-muted"}`}>{openNcrs}</span> : null}
            </button>
          ))}
        </div>

        <section hidden={tab !== "inspection"} role="tabpanel" id={`${formId}-panel-inspection`} aria-labelledby={`${formId}-tab-inspection`}>
          {current ? <CurrentInspection inspection={current} attemptLabel={stage.attempts[stage.attempts.length - 1]?.label ?? ""} nameOf={nameOf} onOpen={() => setInspectionOpen(current.id)} />
            : <p className="text-sm text-fg-muted">Not submitted yet. The Foreman submits {name} when it is ready; the Engineer then inspects it against the criteria.</p>}
        </section>

        <section hidden={tab !== "corrections"} role="tabpanel" id={`${formId}-panel-corrections`} aria-labelledby={`${formId}-tab-corrections`} className="space-y-4">
          <div>
            <h3 className={heading}>NCRs linked to {name}</h3>
            {history.loading ? <p role="status" className="text-sm text-fg-muted">Loading corrections and NCRs…</p> : data.error ? <p role="alert" className="text-sm text-danger-fg">NCR information is unavailable. Reload the task before reviewing corrections.</p> : !ncrs.length ? <div role="status" className="space-y-1 rounded-xl border border-line bg-surface-muted p-4 text-sm">
              <p className="font-bold">No NCR recorded for {name}.</p>
              <p className="text-fg-muted">{current?.status === "passed" && view.stage !== "correction" ? "The current inspection passed without a linked NCR. No NCR correction is required." : "NCRs appear here when a failed inspection criterion or a recorded defect is linked to this item."}</p>
            </div> : <>
              <p className="mb-2 text-xs text-fg-muted">{openNcrs} open · {ncrs.length - openNcrs} closed. Closed NCRs remain in this record.</p>
              <ul className="space-y-2">{ncrs.map((row) => <NcrRow key={row.id} defect={row} today={manilaToday()} onOpen={() => setDefectOpen(row.id)} />)}</ul>
            </>}
          </div>
          {foreman && view.stage === "correction" ? (
            <CorrectionForm formId={formId} item={item} pin={pin} draft={draft} previousIr={previousIr} pinItems={data.pinItems} attempts={history.attempts} photos={photos} defects={defects} submissions={submissions} onChanged={data.reload} onBusy={setBusy} />
          ) : view.stage === "correction" ? <p className="text-sm text-fg-muted">The Foreman records the correction here once: remarks, new photos and the NCRs it answers. You then review the re-inspection and those NCRs together.</p> : null}
          {otherNcrs.length ? <div>
            <h3 className={heading}>Other NCRs on {pin.title} (block completion only)</h3>
            <ul className="space-y-1.5">{otherNcrs.map((row) => <li key={row.id}><button type="button" onClick={() => setDefectOpen(row.id)} className="flex w-full flex-wrap items-center gap-2 rounded-lg border border-line px-3 py-2 text-left text-sm hover:bg-surface-muted"><strong>{ncrRef(row.number)}</strong><span className="min-w-0 flex-1 truncate">{row.title}</span>{row.checklist_item_id === item.id ? <span className="rounded-full bg-brand-soft px-2 py-0.5 text-[11px] font-bold text-brand-text">Raised on this item</span> : row.checklist_name ? <span className="text-[11px] text-fg-muted">{row.checklist_name}</span> : null}<Chip tone={defectTone[row.status]}>{defectStatusLabels[row.status]}</Chip></button></li>)}</ul>
          </div> : null}
        </section>

        <section hidden={tab !== "evidence"} role="tabpanel" id={`${formId}-panel-evidence`} aria-labelledby={`${formId}-tab-evidence`} className="space-y-4">
          {stage.attempts.length > 0 || history.loading || history.error ? <SubmittedEvidence key={`${pin.id}:${item.id}`} itemId={item.id} pinId={pin.id} submissions={history.submissions} inspections={history.inspections} loading={history.loading} error={history.error} nameOf={nameOf} /> : null}
          {!stage.attempts.length ? <div><h3 className={heading}>QC Checklist for {name}</h3>{template ? <ul className="space-y-2">{template.qa_template_items.map(row => <li key={row.id} className="rounded-lg border border-line p-3 text-sm"><strong>{row.text}</strong>{row.reference ? <p className="mt-1 text-xs text-fg-muted">Reference: {row.reference}</p> : null}<QaRequirements item={row} /></li>)}</ul> : <p className="text-sm text-fg-muted">The Engineer must add the criteria to this item.</p>}</div> : null}
          <EvidenceCompare itemId={item.id} label={`${pin.title} → ${name}`} attempts={stage.attempts.map((row) => row.submission as unknown as { photos_snapshot: PinPhoto[] })} draftPhotos={draft ? photos.filter((photo) => photo.qa_attempt_id === draft.id) : []} role={profile?.role} />
          {!stage.attempts.length ? <InitialEvidence item={item} pin={pin} canWork={foreman && !stage.open && item.review_status !== "for_review" && item.review_status !== "verified" && pin.status !== "verified"} meId={profile?.id ?? ""} onRemarkChange={value => { draftRemark.current = value }} onChanged={data.reload} />
            : draft ? <div><h3 className={heading}>Correction photos (next request)</h3><PinPhotos pin={pin} checklistItemId={item.id} attemptId={draft.id} canAdd={false} canRemoveAny={false} meId={profile?.id ?? ""} columns={3} /><p className="mt-1 text-xs text-fg-muted">Add or remove them in the correction form under Corrections &amp; NCRs.</p></div>
            : null}
        </section>

        <section hidden={tab !== "history"} role="tabpanel" id={`${formId}-panel-history`} aria-labelledby={`${formId}-tab-history`} className="space-y-4">
          <QaAttemptHistory history={history} projectId={pin.project_id} itemId={item.id} currentInspectionId={current?.id} onOpen={(id) => setInspectionOpen(id)} />
          {!stage.attempts.length ? <p className="text-sm text-fg-muted">No request yet.</p> : null}
          <ConnectedHistory inspections={stage.attempts.flatMap((row) => row.inspection ? [row.inspection] : [])} events={history.events} ncrs={ncrs} nameOf={nameOf} />
        </section>
      </div>

      {inspectionOpen && project ? (() => {
        const inspection = history.inspections.find((row) => row.id === inspectionOpen)
        return inspection ? <InspectionDetail key={inspection.id} inspection={inspection} project={project} weights={settings.weights} threshold={settings.threshold} defects={defects} canInspect={engineer} canRequest={engineer || foreman} viewOnly={viewOnly} viewOnlyType={typeLabel}
          nameOf={nameOf} onClose={() => setInspectionOpen(null)} onChanged={reload} onOpenDefect={(row) => { setInspectionOpen(null); setDefectOpen(row.id) }} onOpenInspection={setInspectionOpen} /> : null
      })() : null}
      {defectOpen && project ? (() => {
        const defect = defects.find((row) => row.id === defectOpen)
        return defect ? <DefectDetail key={defect.id} defect={defect} project={project} foremen={team.filter((member) => member.role === "foreman")} today={manilaToday()} canWork={profile?.role !== "engineer" && canAct} canVerify={engineer} viewOnly={viewOnly} viewOnlyType={typeLabel}
          nameOf={nameOf} onClose={() => setDefectOpen(null)} onChanged={reload} onOpenInspection={(id) => { setDefectOpen(null); setInspectionOpen(id) }} /> : null
      })() : null}
      {returning && showReturnAction ? <ReturnDialog name={name} reopen={item.review_status === "verified"} busy={busy} onClose={() => setReturning(false)} onSubmit={async (reason) => { if (await run(() => qaActions.reviewItem(item.id, false, reason), "Not returned", `${name} returned for correction`)) setReturning(false) }} /> : null}
      {editingCriteria ? <WorkChecklistEditor pin={pin} item={item} onClose={() => setEditingCriteria(false)} onSaved={reload} /> : null}
    </Modal>
  )
}

function CurrentInspection({ inspection, attemptLabel, nameOf, onOpen }: { inspection: Inspection; attemptLabel: string; nameOf: (id: string | null) => string; onOpen: () => void }) {
  const { items, loading } = useInspectionItems(inspection.id)
  const done = ["passed", "failed", "conditional"].includes(inspection.status)
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <strong>{irRef(inspection.number)}</strong>
        <Chip tone={inspectionTone[inspection.status]}>{inspectionStatusLabels[inspection.status]}</Chip>
        {attemptLabel ? <span className="text-xs font-semibold text-fg-muted">{attemptLabel}</span> : null}
        {inspection.score !== null ? <span className="text-xs font-bold tabular-nums">{inspection.score}%</span> : null}
        <span className="text-xs text-fg-muted">Requested {formatStamp(inspection.requested_at)}{inspection.inspector_id ? ` · Inspector ${nameOf(inspection.inspector_id)}` : ""}{inspection.completed_at ? ` · Signed off ${formatStamp(inspection.completed_at)}` : ""}</span>
        <button type="button" className={buttonSecondary + " ml-auto !py-1 !text-xs"} onClick={onOpen}>Open inspection record</button>
      </div>
      {inspection.summary ? <p className="rounded-lg bg-surface-muted px-3 py-2 text-sm"><strong>Inspector's summary:</strong> {inspection.summary}</p> : null}
      <h3 className={heading}>QC Checklist{done ? " and results" : ""}</h3>
      {loading ? <SkeletonList rows={3} label="Loading the criteria" /> : (
        <ol className="space-y-1.5">
          {items.map((row) => (
            <li key={row.id} className="flex flex-wrap items-start gap-2 rounded-lg border border-line p-2 text-sm">
              <span className={`rounded px-1.5 py-0.5 text-[11px] font-extrabold uppercase ${resultTone[row.result]}`}>{resultWord[row.result]}</span>
              <span className="min-w-0 flex-1">{row.text}{row.measured_value !== null ? <span className="text-fg-muted"> · measured {row.measured_value}{row.unit ? ` ${row.unit}` : ""}</span> : null}{row.remarks ? <span className="block text-xs text-fg-muted">{row.remarks}</span> : null}</span>
              <SeverityChip severity={row.severity} />
            </li>
          ))}
        </ol>
      )}
      <p className="text-xs text-fg-muted">Submitting evidence is not an inspection result: only the Engineer records Pass or Fail against these criteria.</p>
    </div>
  )
}

// Summary only. Package NCRs open their linked inspection for verification; standalone NCRs keep their own decision form.
function NcrRow({ defect, today, onOpen }: { defect: Defect; today: string; onOpen: () => void }) {
  return (
    <li className="space-y-2 rounded-xl border border-line p-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <strong>{ncrRef(defect.number)}</strong>
        <span className="min-w-0 flex-1">{defect.title}</span>
        <SeverityChip severity={defect.severity} />
        <Chip tone={defectTone[defect.status]}>{defectStatusLabels[defect.status]}</Chip>
        <span className="text-xs text-fg-muted">{dueText(defect, today)}</span>
        <button type="button" className="text-xs font-bold text-brand-text underline" onClick={onOpen}>Open NCR record</button>
      </div>
      {defect.corrective_action ? <p className="text-sm"><span className="font-bold">Corrective action{defect.correction_attempt_id ? " (from the correction package)" : ""}:</span> {defect.corrective_action}</p> : null}
    </li>
  )
}

// First request photo against the latest correction photo of the same item.
// Photos and remarks live inside the opened item. Submission saves the remark and declares the work finished.
function InitialEvidence({ item, pin, canWork, meId, onRemarkChange, onChanged }: { item: NonNullable<ReturnType<typeof useWorkItem>["item"]>; pin: NonNullable<ReturnType<typeof useWorkItem>["pin"]>; canWork: boolean; meId: string; onRemarkChange: (value: string) => void; onChanged: () => Promise<void> }) {
  const toast = useToast()
  const [remark, setRemark] = useState(item.remark ?? "")
  const [saving, setSaving] = useState(false)
  useEffect(() => { setRemark(item.remark ?? "") }, [item.remark])
  const save = async () => {
    setSaving(true)
    const { data, error } = await supabase.from("pin_checklist_items").update({ remark: remark.trim() || null }).eq("id", item.id).select("id")
    setSaving(false)
    if (error || !data?.length) return toast.error("Remark not saved", error ? dbMessage(error) : "Only the Foreman assigned to this work can add evidence.")
    toast.success("Remark saved")
    await onChanged()
  }
  return <div className="space-y-3">
    <h3 className={heading}>Evidence for the first request</h3>
    {canWork ? <span className="flex flex-wrap gap-3"><ChecklistUploadButton pin={pin} itemId={item.id} label={item.text} onAdded={() => void onChanged()} /></span> : null}
    <PinPhotos pin={pin} checklistItemId={item.id} attemptId={null} canAdd={false} canRemoveAny={false} unsubmitted={canWork} meId={meId} columns={3} onChanged={() => void onChanged()} />
    {canWork ? <div>
      <label className="block text-[11px] font-bold uppercase tracking-wider text-fg-muted" htmlFor={`remark-${item.id}`}>Remark</label>
      <textarea id={`remark-${item.id}`} className={field} rows={2} maxLength={1000} value={remark} onChange={(event) => { setRemark(event.target.value); onRemarkChange(event.target.value) }} placeholder="What was done or measured" />
      <p className="mt-1 text-xs text-fg-muted">Your remark is saved when you submit for QA Review. You can also save it before submitting.</p>
      <button type="button" disabled={saving || remark.trim() === (item.remark ?? "")} onClick={() => void save()} className={buttonSecondary + " mt-1 !py-1 !text-xs"}>{saving ? "Saving…" : "Save remark"}</button>
    </div> : item.remark ? <p className="whitespace-pre-wrap text-sm"><strong>Remark:</strong> {item.remark}</p> : null}
  </div>
}

function ConnectedHistory({ inspections, events, ncrs, nameOf }: { inspections: Inspection[]; events: Array<{ id: number; inspection_id: string; actor_id: string | null; note: string; created_at: string }>; ncrs: Defect[]; nameOf: (id: string | null) => string }) {
  const defectEvents = useDefectHistory(ncrs.map((row) => row.id))
  const entries = useMemo(() => {
    const ids = new Set(inspections.map((row) => row.id))
    return connectedHistory(events.filter((row) => ids.has(row.inspection_id)), defectEvents,
      (id) => { const row = inspections.find((candidate) => candidate.id === id); return row ? irRef(row.number) : "Inspection" },
      (id) => { const row = ncrs.find((candidate) => candidate.id === id); return row ? ncrRef(row.number) : "NCR" })
  }, [inspections, events, defectEvents, ncrs])
  if (!entries.length) return null
  return <section aria-label="Connected history" className="space-y-2">
    <h3 className={heading}>Connected history (inspections and NCRs)</h3>
    <LimitedTimeline entries={entries} entryKey={(row) => row.key} label="Task history" renderEntry={(row) => <><strong className="text-xs">{formatStamp(row.at)} · {row.ref} · {nameOf(row.actor)}</strong><p className="whitespace-pre-wrap text-xs">{row.text}</p></>} />
  </section>
}

function ReturnDialog({ name, reopen, busy, onClose, onSubmit }: { name: string; reopen: boolean; busy: boolean; onClose: () => void; onSubmit: (reason: string) => Promise<void> }) {
  const [reason, setReason] = useState("")
  return <Modal title={reopen ? `Reopen ${name}` : `Return ${name} for correction`} onClose={busy ? () => undefined : onClose} footer={<>
    <button type="button" className={buttonSecondary} disabled={busy} onClick={onClose}>Cancel</button>
    <button type="button" className={buttonDanger} disabled={busy || reason.trim().length < 5} onClick={() => void onSubmit(reason)}>{reopen ? "Reopen item" : "Return item"}</button>
  </>}>
    <label className="block text-sm font-semibold">What must be corrected? *
      <textarea className={`${inputClass} mt-1`} rows={3} maxLength={1000} autoFocus value={reason} onChange={(event) => setReason(event.target.value)} placeholder="At least 5 characters" />
    </label>
    <p className="mt-2 text-xs text-fg-muted">The Foreman is notified and corrects {name} through its correction form.</p>
  </Modal>
}
