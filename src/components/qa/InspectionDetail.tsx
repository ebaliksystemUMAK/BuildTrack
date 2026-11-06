import { useEffect, useId, useMemo, useRef, useState } from "react"
import Modal from "../Modal"
import { buttonPrimary, buttonSecondary, inputClass } from "../ui/PageParts"
import { SkeletonList } from "../ui/Skeleton"
import { Chip, EvidenceStrip, HoldChip, ScoreBar, SeverityChip } from "./QaBits"
import { useAuth } from "../../lib/auth"
import { useConfirm } from "../../lib/confirm"
import { printHtml } from "../../lib/printReport"
import {
  inspectionStatusLabels, inspectionTone, measureVerdict, previewScore, qaActions, refNumber, toleranceText, tradeLabels, useInspectionItems, useQaPhotos,
  type Defect, type Inspection, type InspectionItem, type ItemResult, type QaPhoto, type Weights,
} from "../../lib/qa"
import { inspectionReportHtml } from "../../lib/qaPrint"
import { useToast } from "../../lib/toast"
import WorkSubmissionEvidence, { useWorkSubmission } from "./WorkSubmissionEvidence"
import { photoEligible } from "../../lib/photoStamp"
import InspectionSchedule from "./InspectionSchedule"
import QaRequirements from "./QaRequirements"
import { useInspectionTimeline } from "../../lib/qaAttempts"
import { submittedChecklistItems } from "../../lib/qaChecklistModel"
import { workItemPath } from "../../lib/workItemModel"
import { followLink } from "../../lib/notifications"
import OpenOnBlueprint from "../OpenOnBlueprint"
import LimitedTimeline from "../ui/LimitedTimeline"
import { usePinQa } from "../../lib/pinQa"
import { useChecklist } from "../../lib/blueprints"
import { useReinspectionContext } from "../../lib/qaReinspection"
import ReinspectionScope from "./ReinspectionScope"
import InspectionEvidenceComparisons from "./InspectionEvidenceComparisons"

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-PH", { timeZone: "Asia/Manila", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "-")

const edge: Record<ItemResult, string> = { pending: "border-l-line", pass: "border-l-green-600", fail: "border-l-red-600", na: "border-l-gray-400" }
const resultChip: Record<ItemResult, string> = {
  pending: "bg-surface-muted text-fg-muted",
  pass: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200",
  fail: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200",
  na: "bg-gray-200 text-gray-700 dark:bg-gray-700/60 dark:text-gray-200",
}
const resultWord: Record<ItemResult, string> = { pending: "Pending", pass: "Pass", fail: "Fail", na: "N/A" }
type InspectionTab = "checklist" | "evidence" | "previous" | "details" | "ncrs" | "history"
const inspectionTabNames: Record<InspectionTab, string> = { checklist: "QC Checklist", evidence: "Submitted evidence", previous: "Previous results", details: "Details & schedule", ncrs: "NCRs", history: "History" }

type SaveItem = (input: { itemId: string; result: ItemResult; measured: number | null; remarks: string }) => Promise<string>

// prepBy: the Foreman preparing a requested inspection may upload a photo on each item (and remove their own) before the engineer starts.
function ItemRow({ item, index, editable, prepBy, photos, projectId, onSave, onPhotosChanged }: { item: InspectionItem; index: number; editable: boolean; prepBy?: string | null; photos: QaPhoto[]; projectId: string; onSave: SaveItem; onPhotosChanged: () => void | Promise<void> }) {
  const [remarks, setRemarks] = useState(item.remarks ?? "")
  const [value, setValue] = useState(item.measured_value === null ? "" : String(item.measured_value))
  const [pending, setPending] = useState<ItemResult | null>(null)
  const [problem, setProblem] = useState("")
  const [saving, setSaving] = useState(false)
  const remarksBox = useRef<HTMLTextAreaElement>(null)
  const valueBox = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setRemarks(item.remarks ?? "")
    setValue(item.measured_value === null ? "" : String(item.measured_value))
    setPending(null)
    setProblem("")
  }, [item.result, item.remarks, item.measured_value])

  const shown = pending ?? item.result
  const myPhotos = photos.filter((photo) => photo.item_id === item.id)
  const number = value.trim() === "" ? null : Number(value)
  const verdict = measureVerdict(item, number)

  const commit = async (result: ItemResult, text = remarks, measured = number) => {
    setSaving(true)
    setProblem("")
    const message = await onSave({ itemId: item.id, result, measured, remarks: text.trim() })
    setSaving(false)
    if (message) setProblem(message)
  }

  const choose = (result: ItemResult) => {
    setProblem("")
    if (result === "pending") return void commit("pending", "", null)
    if (item.kind === "measure" && result !== "na") {
      if (number === null || !Number.isFinite(number)) {
        setProblem("Enter the measured value first.")
        valueBox.current?.focus()
        return
      }
      const decided = measureVerdict(item, number) ?? result
      if (decided === "fail") {
        setPending("fail")
        setTimeout(() => remarksBox.current?.focus(), 0)
        return
      }
      return void commit(decided)
    }
    if (result === "fail" || result === "na") {
      setPending(result)
      setTimeout(() => remarksBox.current?.focus(), 0)
      return
    }
    void commit("pass")
  }

  const saveRemarks = () => {
    const result = pending ?? item.result
    if (result === "pending" || result === "pass") return
    if (result === "fail" && remarks.trim().length < 5) return setProblem("Say what is wrong (at least 5 characters).")
    if (result === "na" && remarks.trim().length < 3) return setProblem("Say why this item does not apply.")
    void commit(result)
  }

  const onValueCommit = () => {
    if (!editable || item.kind !== "measure" || value.trim() === "") return
    if (number === null || !Number.isFinite(number)) return setProblem("The measured value must be a number.")
    if (number === item.measured_value && item.result !== "pending") return
    const decided = measureVerdict(item, number)
    if (decided === "pass") void commit("pass")
    else if (decided === "fail") {
      setPending("fail")
      setTimeout(() => remarksBox.current?.focus(), 0)
    }
  }

  const needsPhoto = item.requires_photo && !myPhotos.some(photoEligible) && (shown === "pass" || shown === "fail")
  const showRemarks = shown === "fail" || shown === "na" || Boolean(item.remarks)

  return (
    <li className={`rounded-xl border border-l-4 border-line bg-surface p-3 ${edge[shown]}`}>
      <div className="flex flex-wrap items-start gap-3">
        <span className="mt-0.5 flex h-6 w-6 flex-none items-center justify-center rounded-full bg-surface-muted text-xs font-extrabold text-fg-muted">{index + 1}</span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{item.text}</p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <SeverityChip severity={item.severity} />
            {item.hold_point ? <HoldChip /> : null}
            {item.requires_photo ? <Chip tone="bg-surface-muted text-fg-muted" title="A photo is required as evidence">Photo required</Chip> : null}
            {item.reference ? <span className="text-xs text-fg-muted">{item.reference}</span> : null}
          </div>
          <QaRequirements item={item} />
          {item.kind === "measure" ? (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
              <label htmlFor={`m-${item.id}`} className="font-bold text-fg-muted">Measured</label>
              {editable ? (
                <input
                  id={`m-${item.id}`}
                  ref={valueBox}
                  inputMode="decimal"
                  value={value}
                  onChange={(event) => { setValue(event.target.value); setProblem("") }}
                  onBlur={onValueCommit}
                  onKeyDown={(event) => { if (event.key === "Enter") onValueCommit() }}
                  className={`${inputClass} !w-28 !py-1 tabular-nums ${verdict === "fail" ? "!border-red-600" : verdict === "pass" ? "!border-green-600" : ""}`}
                  aria-describedby={`t-${item.id}`}
                />
              ) : (
                <strong className="tabular-nums">{item.measured_value ?? "-"}</strong>
              )}
              {item.unit ? <span className="text-fg-muted">{item.unit}</span> : null}
              <span id={`t-${item.id}`} className="text-fg-muted">Required: {toleranceText(item)}</span>
              {editable && verdict ? <span className={`font-extrabold ${verdict === "pass" ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400"}`}>{verdict === "pass" ? "Within tolerance" : "Out of tolerance"}</span> : null}
            </div>
          ) : null}
        </div>
        {editable ? (
          <div role="group" aria-label={`Result for item ${index + 1}`} className="flex flex-none overflow-hidden rounded-lg border border-line text-xs font-extrabold">
            {(["pass", "fail", "na"] as const).map((result) => (
              <button
                key={result}
                type="button"
                disabled={saving}
                aria-pressed={shown === result}
                onClick={() => (shown === result && item.result === result ? choose("pending") : choose(result))}
                className={`px-3 py-1.5 transition disabled:opacity-60 ${shown === result ? (result === "pass" ? "bg-green-600 text-white" : result === "fail" ? "bg-red-600 text-white" : "bg-gray-600 text-white") : "bg-surface text-fg hover:bg-surface-muted"}`}
              >
                {resultWord[result]}
              </button>
            ))}
          </div>
        ) : (
          <Chip tone={resultChip[item.result]}>{resultWord[item.result]}</Chip>
        )}
      </div>

      {showRemarks ? (
        <div className="mt-2 pl-9">
          {editable ? (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
              <label className="sr-only" htmlFor={`r-${item.id}`}>{shown === "na" ? "Why this does not apply" : "What is wrong"}</label>
              <textarea id={`r-${item.id}`} ref={remarksBox} rows={2} maxLength={500} value={remarks} onChange={(event) => { setRemarks(event.target.value); setProblem("") }} placeholder={shown === "na" ? "Why this does not apply" : "What is wrong, and where"} className={`${inputClass} flex-1`} />
              {pending || remarks.trim() !== (item.remarks ?? "") ? <button type="button" className={buttonPrimary + " !py-1.5 sm:self-start"} disabled={saving} onClick={saveRemarks}>{saving ? "Saving..." : "Save"}</button> : null}
            </div>
          ) : (
            <p className="whitespace-pre-wrap rounded-lg bg-surface-muted px-3 py-2 text-sm">{item.remarks}</p>
          )}
        </div>
      ) : null}

      {problem ? <p role="alert" className="mt-2 pl-9 text-xs font-bold text-danger-fg">{problem}</p> : null}
      {needsPhoto && editable ? <p className="mt-2 pl-9 text-xs font-bold text-amber-800 dark:text-amber-300">This item needs a photo before the inspection can be completed.</p> : null}

      {editable || prepBy || myPhotos.length ? (
        <div className="mt-2 pl-9">
          {prepBy && !myPhotos.length ? <p className="mb-1 text-xs font-semibold text-fg-muted">Upload a photo showing this item is ready for inspection.</p> : null}
          <EvidenceStrip projectId={projectId} photos={myPhotos} target={{ itemId: item.id }} canAdd={editable || Boolean(prepBy)} canRemove={(photo) => editable || (Boolean(prepBy) && photo.uploaded_by === prepBy)} onChanged={onPhotosChanged} label={`Criterion ${index + 1}`} compact />
        </div>
      ) : null}
    </li>
  )
}

// One inspection: the request, the checklist with results and photos, the score and the sign-off. The inspector (an engineer of the
// project) records results here; everyone else on the team reads them.
export default function InspectionDetail({
  inspection,
  project,
  weights,
  threshold,
  defects,
  canInspect,
  canRequest,
  viewOnly = false,
  viewOnlyType = null,
  nameOf,
  onClose,
  onChanged,
  onOpenDefect,
  onOpenInspection,
  onPlan = false,
}: {
  inspection: Inspection
  project: { id: string; name: string; code: string; location?: string | null }
  weights: Weights
  threshold: number
  defects: Defect[]
  canInspect: boolean
  canRequest: boolean
  // View only access to this record's blueprint type (20261028130000): readable, no action buttons.
  viewOnly?: boolean
  viewOnlyType?: string | null
  nameOf: (id: string | null) => string
  onClose: () => void
  onChanged: () => void | Promise<void>
  onOpenDefect?: (defect: Defect) => void
  onOpenInspection?: (id: string) => void
  onPlan?: boolean // opened from the pin panel on the blueprint: no link back to the plan
}) {
  const { profile } = useAuth()
  const toast = useToast()
  const confirm = useConfirm()
  const { items, setItems, loading, error, reload: reloadItems } = useInspectionItems(inspection.id)
  const scope = useReinspectionContext(inspection.reinspection_of ? inspection.id : null)
  const reloadScope = async () => { await Promise.all([reloadItems(), scope.reload(), onChanged()]) }
  const { photos, reload: reloadPhotos } = useQaPhotos({ inspectionId: inspection.id })
  const [summary, setSummary] = useState("")
  const [busy, setBusy] = useState(false)
  const [reason, setReason] = useState("")
  const [reasonProblem, setReasonProblem] = useState("")
  const [asking, setAsking] = useState<"cancel" | "reinspect" | null>(null)
  const reasonPending = useRef(false)
  const startPending = useRef(false)
  const tabId = useId()
  const [selectedTab, setSelectedTab] = useState<{ id: string; tab: InspectionTab }>({ id: inspection.id, tab: "checklist" })

  const done = inspection.status === "passed" || inspection.status === "conditional" || inspection.status === "failed"
  const reinspection = Boolean(inspection.reinspection_of || inspection.full_checklist_reinspection)
  const tabs: InspectionTab[] = reinspection ? ["checklist", "evidence", "previous", "details", "ncrs", "history"] : ["checklist", "evidence", "details", "ncrs", "history"]
  const tab = selectedTab.id === inspection.id && tabs.includes(selectedTab.tab) ? selectedTab.tab : "checklist"
  const selectTab = (next: InspectionTab) => setSelectedTab({ id: inspection.id, tab: next })
  const isInspector = inspection.status === "in_progress" && inspection.inspector_id === profile?.id && canInspect
  // Before the engineer starts, the project's Foremen upload a photo on each checklist item (the database allows exactly this, 0040).
  const workSubmission = useWorkSubmission(inspection.id)
  const currentTasks = useChecklist(!canInspect && canRequest && workSubmission.submission ? inspection.pin_id : null)
  const pinQa = usePinQa(inspection.pin_id ?? "")
  const retryBlocked=Boolean(inspection.pin_id && (!pinQa.state || pinQa.error || pinQa.state.submissionProblem))
  const timeline = useInspectionTimeline(inspection.id)
  const prepBy = !workSubmission.loading && !workSubmission.error && !workSubmission.submission && inspection.status === "requested" && !canInspect && !viewOnly && profile?.role === "foreman" ? profile.id : null
  const usedWeights = inspection.weights ?? weights
  const usedThreshold = inspection.threshold ?? threshold
  const preview = useMemo(() => previewScore(items, usedWeights, usedThreshold), [items, usedWeights, usedThreshold])
  const mine = defects.filter((defect) => defect.inspection_id === inspection.id)
  const photosMissing = items.filter((item) => item.requires_photo && (item.result === "pass" || item.result === "fail") && !photos.some((photo) => photo.item_id === item.id && photoEligible(photo))).length
  const ref = refNumber("ir", inspection.number)
  // A work item request (submitted from a work item) or a stage / hold-point inspection: they are never interchangeable.
  const workItems = workSubmission.submission ? submittedChecklistItems(workSubmission.submission) : []
  // The snapshot remains failed after resubmission. Offer corrections only for a task still returned on this request.
  const correctionTask = !currentTasks.loading && !currentTasks.error ? workItems.find(submitted => currentTasks.items.some(task =>
    task.id === submitted.id && task.pin_id === inspection.pin_id && task.review_status === "returned" && task.review_inspection_id === inspection.id)) : undefined
  const workActionItem = canInspect ? workItems[0] : correctionTask
  const role = canInspect || profile?.role === "engineer" ? "engineer" : "foreman"
  const canCancel = (inspection.status === "requested" || inspection.status === "in_progress") && canRequest
    && !workSubmission.loading && !workSubmission.error && (!workSubmission.submission || canInspect)
  const openItem = (id: string) => {
    const correction = inspection.status === "failed" || inspection.status === "conditional"
    onClose()
    followLink(workItemPath(role, inspection.project_id, id, !canInspect && correction ? "issues" : undefined, correction ? "corrections" : undefined), inspection.project_id)
  }

  const save: SaveItem = async ({ itemId, result, measured, remarks }) => {
    const outcome = await qaActions.saveItem({ itemId, result, measured, remarks })
    if (!outcome.ok) return outcome.message
    setItems((current) => current.map((item) => (item.id === itemId ? { ...item, result: outcome.data, measured_value: measured, remarks: remarks || null } : item)))
    void reloadItems()
    return ""
  }

  const start = async () => {
    if (!canInspect || busy || startPending.current || !["requested", "cancelled"].includes(inspection.status)) return
    if (inspection.full_checklist_reinspection && (scope.loading || scope.error)) return toast.error("Reinspection history unavailable", scope.error || "Wait for the earlier checks to load.")
    const continuing = inspection.status === "cancelled"
    startPending.current = true
    try {
      if (continuing && !await confirm({
        title: `Continue ${ref}?`,
        message: "Continue this cancelled inspection with its recorded QC checklist results and original evidence. Linked correction NCRs will return to verification. The cancellation stays in History. A newer submission, correction draft or changed work prevents continuing this old request.",
        confirmLabel: "Continue inspection",
      })) return
      setBusy(true)
      const outcome = await qaActions.start(inspection.id)
      if (!outcome.ok) return toast.error(continuing ? "Could not continue" : "Could not start", outcome.message)
      toast.success(continuing ? "Inspection continued" : "Inspection started", ref)
      try { await onChanged() } catch { toast.error("Inspection updated", "Reopen the inspection to see its current status.") }
    } catch (error) {
      toast.error(continuing ? "Could not continue" : "Could not start", (error as Error).message)
    } finally { startPending.current = false; setBusy(false) }
  }

  const complete = async () => {
    if (preview.pending) { selectTab("checklist"); return toast.error("Every item needs a result", `${preview.pending} still pending`) }
    if (photosMissing) { selectTab("checklist"); return toast.error("Photos are missing", `${photosMissing} item${photosMissing === 1 ? "" : "s"} need a photo`) }
    const expected = preview.result === "passed" ? "PASSED" : preview.result === "conditional" ? "CONDITIONAL (items to fix, work may continue)" : "FAILED"
    const ok = await confirm({
      title: `Sign off ${ref}?`,
      message: `Result: ${expected} with ${preview.score ?? 0}%. ${preview.failed ? `${preview.failed} failed check${preview.failed === 1 ? "" : "s"} will create new NCRs or update the same open findings. ` : ""}${reinspection ? "Linked correction NCRs whose own finding passes will close automatically. Failed or N/A findings stay open. Task completion remains separate. " : ""}Results cannot be changed after sign-off.`,
      confirmLabel: "Complete inspection",
    })
    if (!ok) return
    setBusy(true)
    const outcome = await qaActions.complete(inspection.id, summary.trim())
    setBusy(false)
    if (!outcome.ok) return toast.error("Could not complete", outcome.message)
    const r = outcome.data
    toast.success(`${ref} ${r.result}`, `${r.score}%${r.defects ? ` - ${r.defects} NCR${r.defects === 1 ? "" : "s"} raised` : ""}`)
    await onChanged()
  }

  const submitReason = async () => {
    if (!asking || busy || reasonPending.current || (asking === "cancel" && (!canCancel || reason.trim().length < 5))) return
    const action = asking
    reasonPending.current = true
    setReasonProblem("")
    setBusy(true)
    try {
      if (action === "reinspect" && inspection.pin_id) {
        const why = await pinQa.preflight()
        if (why) throw new Error(why)
      }
      const outcome = action === "cancel" ? await qaActions.cancel(inspection.id, reason.trim()) : await qaActions.reinspect(inspection.id, reason.trim())
      if (!outcome.ok) throw new Error(outcome.message)
      toast.success(action === "cancel" ? "Inspection cancelled" : "Re-inspection requested", action === "cancel" ? ref : "The engineer is notified")
      setAsking(null)
      setReason("")
      try { await onChanged() } catch { toast.error("Inspection updated", "The action was saved, but the page could not refresh. Reopen the inspection to see its current status.") }
      if (action === "reinspect" && onOpenInspection) onOpenInspection(outcome.data as string)
    } catch (error) {
      setReasonProblem((error as Error).message)
      toast.error(action === "cancel" ? "Not cancelled" : "Not requested", (error as Error).message)
    } finally { reasonPending.current = false; setBusy(false) }
  }

  const print = () => {
    if (!printHtml(inspectionReportHtml({ inspection, items, defects: mine, project, nameOf }))) toast.error("Could not open the print dialog")
  }

  const footer = (
    <>
      {done || inspection.status === "cancelled" ? <button type="button" className={buttonSecondary} onClick={print}>Print / PDF</button> : null}
      {(inspection.status === "failed" || inspection.status === "conditional") && canRequest ? workItems.length ? (
        workActionItem ? <button type="button" className={buttonPrimary} onClick={() => openItem(workActionItem.id)}>{canInspect ? "Open the task" : "Open the correction form"}</button> : null
      ) : <button type="button" className={buttonSecondary} disabled={workSubmission.loading || Boolean(workSubmission.error)} onClick={() => setAsking("reinspect")}>Request re-inspection</button> : null}
      {inspection.pin_id && !workItems.length && !onPlan ? <OpenOnBlueprint projectId={inspection.project_id} pinId={inspection.pin_id} section="issues" /> : null}
      {canCancel ? <button type="button" className={buttonSecondary} disabled={busy} onClick={() => { if (!reasonPending.current) { setReason(""); setReasonProblem(""); setAsking("cancel") } }}>Cancel inspection</button> : null}
      {(inspection.status === "requested" || inspection.status === "cancelled") && canInspect ? <button type="button" className={buttonPrimary} disabled={busy || Boolean(inspection.full_checklist_reinspection && (scope.loading || scope.error))} onClick={() => void start()}>{busy ? "Starting..." : inspection.status === "cancelled" ? "Continue inspection" : "Start inspection"}</button> : null}
      {isInspector ? <button type="button" className={buttonPrimary} disabled={busy || loading} onClick={() => void complete()}>{busy ? "Signing off..." : "Complete inspection"}</button> : null}
      <button type="button" className={buttonSecondary} onClick={onClose}>Close</button>
    </>
  )

  return (
    <Modal title={`${ref}  ${inspection.title}`} description={`${tradeLabels[inspection.trade]}${inspection.location ? ` • ${inspection.location}` : ""}`} size="2xl" onClose={onClose} footer={footer}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Chip tone={inspectionTone[inspection.status]}>{inspectionStatusLabels[inspection.status]}</Chip>
          <Chip tone="bg-surface-muted text-fg">{workSubmission.loading ? "…" : workItems.length ? "Task QA" : "Stage / hold point"}</Chip>
          {inspection.reinspection_of ? <Chip tone="bg-fuchsia-100 text-fuchsia-900 dark:bg-fuchsia-900/40 dark:text-fuchsia-200">Re-inspection</Chip> : null}
        </div>
        {!canInspect && canRequest && workItems.length > 0 && currentTasks.error ? <p role="alert" className="text-sm text-danger-fg">{currentTasks.error} <button type="button" className="font-bold underline" onClick={() => void currentTasks.reload()}>Retry task status</button></p> : null}
        <div className="sticky top-0 z-10 flex flex-wrap gap-1 border-b border-line bg-surface py-2" role="tablist" aria-label="Inspection sections">
          {tabs.map(key => <button key={key} type="button" role="tab" id={`${tabId}-tab-${key}`} aria-selected={tab === key} aria-controls={`${tabId}-panel-${key}`} tabIndex={tab === key ? 0 : -1}
            onClick={() => selectTab(key)} onKeyDown={event => {
              const index = tabs.indexOf(key)
              const next = event.key === "ArrowRight" ? tabs[(index + 1) % tabs.length] : event.key === "ArrowLeft" ? tabs[(index + tabs.length - 1) % tabs.length] : event.key === "Home" ? tabs[0] : event.key === "End" ? tabs[tabs.length - 1] : null
              if (next) { event.preventDefault(); selectTab(next); event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(`[id="${tabId}-tab-${next}"]`)?.focus() }
            }} className={`rounded-lg px-3 py-2 text-sm font-bold transition focus-visible:outline-2 focus-visible:outline-brand ${tab === key ? "bg-brand text-white" : "text-fg-muted hover:bg-surface-muted hover:text-fg"}`}>
            {inspectionTabNames[key]}
          </button>)}
        </div>

        {inspection.status === "cancelled" && canInspect ? <p role="status" className="rounded-xl border border-line bg-surface-muted p-3 text-sm text-fg-muted">You can continue this cancelled inspection using its saved results and evidence, unless newer work or a correction draft has replaced it. The cancellation remains in History.</p> : null}

        {/* Keep panels mounted so switching tabs never discards an unsaved item measurement or remark. */}
        <section hidden={tab !== "checklist"} role="tabpanel" id={`${tabId}-panel-checklist`} aria-labelledby={`${tabId}-tab-checklist`} tabIndex={0} className="space-y-4">

        {items.length ? (
          <div className="rounded-xl border border-line bg-surface p-3">
            <ScoreBar score={done ? inspection.score : preview.score} threshold={usedThreshold} label={done ? "Final score" : "Score so far"} />
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-fg-muted">
              <span><strong className="text-fg">{preview.passed}</strong> pass</span>
              <span><strong className="text-fg">{preview.failed}</strong> fail</span>
              <span><strong className="text-fg">{preview.na}</strong> N/A</span>
              {preview.pending ? <span><strong className="text-fg">{preview.pending}</strong> still to judge</span> : null}
              {!done && preview.result ? <span className="ml-auto font-extrabold text-fg">Expected result: {inspectionStatusLabels[preview.result]}</span> : null}
              {preview.criticalFailed ? <span className="font-extrabold text-red-700 dark:text-red-400">A critical item failed</span> : null}
              {preview.holdFailed ? <span className="font-extrabold text-red-700 dark:text-red-400">A hold point failed</span> : null}
            </div>
          </div>
        ) : null}

        {viewOnly ? <p role="status" className="rounded-lg border border-line bg-surface-muted px-3 py-2 text-sm text-fg"><strong>View only.</strong> You can read this inspection; an Engineer with Assigned work access to {viewOnlyType ? `${viewOnlyType} plans` : "a blueprint type of this project"} handles it.</p> : null}
        {inspection.status === "requested" && !canInspect && !viewOnly ? <p className="rounded-lg bg-sky-50 px-3 py-2 text-sm text-sky-900 dark:bg-sky-900/30 dark:text-sky-100">Waiting for the engineer. The QC checklist below is what will be inspected{prepBy ? ": upload a photo on each item to show the work is ready." : ", so the work can be made ready."}</p> : null}
        {inspection.status === "in_progress" && !isInspector && !viewOnly ? <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-900/30 dark:text-amber-100">{canInspect ? `${nameOf(inspection.inspector_id)} is inspecting. Only the inspector can record results.` : "The engineer is inspecting now."}</p> : null}

        {loading ? (
          <SkeletonList rows={5} label="Loading the QC checklist" />
        ) : error ? (
          <p role="alert" className="rounded-lg bg-danger-soft px-4 py-2 text-sm text-danger-fg">{error}</p>
        ) : (
          <ol className="space-y-2">
            {items.map((item, index) => (
              <ItemRow key={item.id} item={item} index={index} editable={isInspector} prepBy={prepBy} photos={photos} projectId={inspection.project_id} onSave={save} onPhotosChanged={reloadPhotos} />
            ))}
          </ol>
        )}

        {isInspector ? (
          <div>
            <label className="mb-1 block text-xs font-extrabold uppercase tracking-wider text-fg-muted" htmlFor="qa-summary">{reinspection ? "Remarks (optional)" : "Inspector's summary (optional)"}</label>
            <textarea id="qa-summary" rows={3} maxLength={1000} value={summary} onChange={(event) => setSummary(event.target.value)} className={inputClass} placeholder={reinspection ? "What was checked, what passed, or what still needs correction" : "Overall finding, instructions to the contractor, conditions for proceeding"} />
            {reinspection ? <p className="mt-1 text-xs text-fg-muted">At sign-off, linked correction NCRs close automatically when their own finding passes. Failed or N/A findings stay open. These remarks are saved with the inspection and any automatic NCR closure.</p> : null}
          </div>
        ) : inspection.summary ? (
          <div className="rounded-lg bg-surface-muted px-3 py-2 text-sm"><p className="text-xs font-extrabold uppercase tracking-wider text-fg-muted">{reinspection ? "Remarks" : "Inspector's summary"}</p><p className="mt-1 whitespace-pre-wrap">{inspection.summary}</p></div>
        ) : null}
        </section>

        <section hidden={tab !== "evidence"} role="tabpanel" id={`${tabId}-panel-evidence`} aria-labelledby={`${tabId}-tab-evidence`} tabIndex={0} className="space-y-4">
          {tab === "evidence" && inspection.pin_id ? <InspectionEvidenceComparisons key={inspection.id} inspection={inspection} /> : null}
          <WorkSubmissionEvidence key={inspection.id} record={workSubmission} />
          {!workSubmission.loading && !workSubmission.error && !workSubmission.submission ? <p className="text-sm text-fg-muted">No Foreman submission snapshot is attached to this request. Each check's inspection photos are available in QC Checklist.</p> : null}
        </section>

        {reinspection ? <section hidden={tab !== "previous"} role="tabpanel" id={`${tabId}-panel-previous`} aria-labelledby={`${tabId}-tab-previous`} tabIndex={0} className="space-y-4">
          <ReinspectionScope rows={scope.rows} loading={scope.loading} error={scope.error} fullChecklist={Boolean(inspection.full_checklist_reinspection)} nameOf={nameOf} onChanged={reloadScope} onOpenInspection={onOpenInspection} />
        </section> : null}

        <section hidden={tab !== "details"} role="tabpanel" id={`${tabId}-panel-details`} aria-labelledby={`${tabId}-tab-details`} tabIndex={0} className="space-y-4">
          <dl className="grid gap-3 rounded-xl border border-line p-3 text-sm sm:grid-cols-2">
            <div><dt className="text-xs font-bold text-fg-muted">Requested by</dt><dd>{nameOf(inspection.requested_by)} · {when(inspection.requested_at)}</dd></div>
            <div><dt className="text-xs font-bold text-fg-muted">Inspector</dt><dd>{inspection.inspector_id ? nameOf(inspection.inspector_id) : "Not started"}</dd></div>
            {inspection.started_at ? <div><dt className="text-xs font-bold text-fg-muted">Started</dt><dd>{when(inspection.started_at)}</dd></div> : null}
            {inspection.completed_at ? <div><dt className="text-xs font-bold text-fg-muted">{inspection.status === "cancelled" ? "Cancelled" : "Signed off"}</dt><dd>{when(inspection.completed_at)}</dd></div> : null}
          </dl>
          {inspection.standards.length ? <p className="text-sm"><strong>Standards:</strong> {inspection.standards.join(", ")}</p> : null}
          {inspection.request_note ? <p className="rounded-lg bg-surface-muted px-3 py-2 text-sm"><strong>Note from the requester:</strong> {inspection.request_note}</p> : null}
          {workItems.length ? <p className="flex flex-wrap items-center gap-2 text-sm"><span className="font-bold">Task{workItems.length === 1 ? "" : "s"} in this request:</span>{workItems.map(row => <button key={row.id} type="button" className={buttonSecondary + " !py-1 !text-xs"} onClick={() => openItem(row.id)}>{inspection.title} → {row.text}</button>)}<span className="text-xs text-fg-muted">Earlier attempts, corrections and NCRs are in the task record.</span></p> : null}
          <InspectionSchedule inspection={inspection} canEdit={canInspect} onChanged={onChanged} />
        </section>

        <section hidden={tab !== "ncrs"} role="tabpanel" id={`${tabId}-panel-ncrs`} aria-labelledby={`${tabId}-tab-ncrs`} tabIndex={0} className="space-y-4">
        {mine.length ? (
          <div>
            <h3 className="mb-2 text-xs font-extrabold uppercase tracking-wider text-fg-muted">Non-conformances raised</h3>
            <ul className="space-y-1.5">
              {mine.map((defect) => (
                <li key={defect.id}>
                  <button type="button" onClick={() => onOpenDefect?.(defect)} disabled={!onOpenDefect} className="flex w-full items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-left text-sm hover:bg-surface-muted disabled:cursor-default">
                    <strong className="tabular-nums">{refNumber("ncr", defect.number)}</strong>
                    <span className="min-w-0 flex-1 truncate">{defect.title}</span>
                    <SeverityChip severity={defect.severity} />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : <p className="text-sm text-fg-muted">No NCRs were raised by this inspection. Earlier NCRs and corrections remain in the linked task record.</p>}
        </section>

        <section hidden={tab !== "history"} role="tabpanel" id={`${tabId}-panel-history`} aria-labelledby={`${tabId}-tab-history`} tabIndex={0} className="space-y-4">
          <h3 className="text-sm font-bold">This request's timeline</h3>
          <LimitedTimeline entries={[...timeline.events].reverse()} resetKey={inspection.id} label="Inspection timeline" entryKey={e => e.id} renderEntry={e => <><strong className="text-xs">{when(e.created_at)} · {nameOf(e.actor_id)}</strong><p className="whitespace-pre-wrap text-xs">{e.note}</p></>} />
          {timeline.error ? <p role="alert" className="text-xs text-danger-fg">{timeline.error}</p> : null}
          {!timeline.events.length && !timeline.error ? <p className="text-sm text-fg-muted">No timeline entries are available yet.</p> : null}
        </section>

        {asking === "reinspect" ? (
          <div className="rounded-xl border border-brand bg-surface p-3">
            <label className="mb-1 block text-sm font-bold" htmlFor="qa-reason">What was done to correct the failed items?</label>
            <textarea id="qa-reason" rows={2} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} className={inputClass} placeholder="Optional: tell the engineer what changed" />
            <div className="mt-2 flex justify-end gap-2">
              <button type="button" className={buttonSecondary} onClick={() => { setAsking(null); setReason("") }}>Back</button>
              <button type="button" className={buttonPrimary} disabled={busy || retryBlocked} onClick={() => void submitReason()}>{busy ? "Sending..." : "Request re-inspection"}</button>
            </div>
            {asking === "reinspect" && retryBlocked ? <p role="status" className="mt-2 text-sm text-fg-muted">{pinQa.error || pinQa.state?.submissionProblem || "Checking pending requests…"}</p> : null}
          </div>
        ) : null}
      </div>
      {asking === "cancel" && canCancel ? <Modal title={`Cancel ${ref}?`} size="md" closeOnBackdrop={false} onClose={() => { if (!reasonPending.current) { setAsking(null); setReason("") } }}
        footer={<><button type="button" className={buttonSecondary} disabled={busy} onClick={() => { if (!reasonPending.current) { setAsking(null); setReason("") } }}>Keep inspection</button>
          <button type="button" className={buttonPrimary} disabled={busy || reason.trim().length < 5} onClick={() => void submitReason()}>{busy ? "Cancelling..." : "Cancel the inspection"}</button></>}>
        <p className="mb-3 text-sm">Cancel this inspection without deleting its results or evidence. Submitted work returns for correction and any linked NCR remains open.</p>
        <label className="mb-1 block text-sm font-bold" htmlFor="qa-cancel-reason">Cancellation reason</label>
        <textarea id="qa-cancel-reason" rows={3} maxLength={500} value={reason} disabled={busy} onChange={event => { setReason(event.target.value); setReasonProblem("") }} className={inputClass} placeholder="Explain why this inspection is being cancelled (at least 5 characters)" />
        {reasonProblem ? <p role="alert" className="mt-2 text-sm text-danger-fg">{reasonProblem}</p> : null}
      </Modal> : null}
    </Modal>
  )
}
