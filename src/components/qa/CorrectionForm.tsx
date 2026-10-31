import { useEffect, useMemo, useRef, useState, type FormEvent } from "react"
import { ChecklistUploadButton, PinPhotos } from "../editor/PinParts"
import { SeverityChip } from "./QaBits"
import { useAuth } from "../../lib/auth"
import { useConfirm } from "../../lib/confirm"
import { useToast } from "../../lib/toast"
import { photoEligible } from "../../lib/photoStamp"
import { defectStatusLabels, qaActions, type Defect } from "../../lib/qa"
import type { ChecklistItem, Pin, PinPhoto } from "../../lib/blueprints"
import type { WorkQaAttempt } from "../../lib/qaAttemptsModel"
import { irRef, linkedDefects, ncrRef, type SubmissionRef } from "../../lib/workItemModel"
import { inputClass } from "../ui/PageParts"

const label = "mb-1 block text-xs font-extrabold uppercase tracking-wider text-fg-muted"

// One correction package: describe the fix once, add new photos once, choose the NCRs it answers, submit. The database re-submits
// the item(s) for a linked re-inspection and sends the chosen NCRs for verification with the same remarks and photos, atomically.
export default function CorrectionForm({ formId, item, pin, draft, previousIr, pinItems, attempts, photos, defects, submissions, onChanged, onBusy }: {
  formId: string; item: ChecklistItem; pin: Pin; draft: WorkQaAttempt | null; previousIr: number | null
  pinItems: ChecklistItem[]; attempts: WorkQaAttempt[]; photos: PinPhoto[]; defects: Defect[]; submissions: SubmissionRef[]
  onChanged: () => Promise<void>; onBusy: (busy: boolean) => void
}) {
  const { profile } = useAuth()
  const confirm = useConfirm()
  const toast = useToast()
  const pending = useRef(false)
  const [remarks, setRemarks] = useState(draft?.remarks ?? "")
  const [root, setRoot] = useState("")
  const [preventive, setPreventive] = useState("")
  const [also, setAlso] = useState<string[]>([])
  const eligibleOf = (attemptId: string) => photos.filter((photo) => photo.qa_attempt_id === attemptId && photoEligible(photo)).length

  // Only corrections from the same earlier request and criteria can share a package. Independent requests stay separate.
  const others = useMemo(() => pinItems.filter((row) => row.id !== item.id && row.review_status !== "verified" && row.review_status !== "for_review"
    && (row.qa_template_id ?? pin.qa_template_id) === (item.qa_template_id ?? pin.qa_template_id)).flatMap((row) => {
    const other = attempts.find((attempt) => attempt.item_id === row.id && !attempt.submitted_inspection_id)
    return other && other.previous_inspection_id === draft?.previous_inspection_id ? [{ item: row, draft: other, ready: other.remarks.trim().length >= 5 && eligibleOf(other.id) > 0 }] : []
  }), [pinItems, attempts, photos, item.id, item.qa_template_id, pin.qa_template_id, draft?.previous_inspection_id]) // eslint-disable-line react-hooks/exhaustive-deps
  const included = [item.id, ...also]
  const ncrs = useMemo(() => {
    const seen = new Map<string, Defect>()
    for (const id of included) for (const row of linkedDefects(id, pin.id, submissions, defects)) seen.set(row.id, row)
    return [...seen.values()].sort((a, b) => a.number - b.number)
  }, [included.join(","), pin.id, submissions, defects]) // eslint-disable-line react-hooks/exhaustive-deps
  const answerable = ncrs.filter((row) => row.status === "open" || row.status === "in_progress")
  const [selected, setSelected] = useState<string[]>([])
  const answerableKey = answerable.map((row) => row.id).join(",")
  useEffect(() => { setSelected(answerableKey ? answerableKey.split(",") : []) }, [answerableKey])
  useEffect(() => { setRemarks(draft?.remarks ?? "") }, [draft?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const minimum = selected.length ? 10 : 5
  const newPhotos = draft ? eligibleOf(draft.id) : 0
  const problem = !draft ? "Start the correction first."
    : answerable.length > 0 && selected.length === 0 ? "Select at least one NCR finding this correction actually answers."
    : remarks.trim().length < minimum ? `Describe what was corrected (at least ${minimum} characters).`
    : !newPhotos ? "Add at least one new eligible photo of the corrected work."
    : ""

  const saveRemarks = async (quiet = false) => {
    if (!draft || remarks.trim() === draft.remarks) return true
    const outcome = await qaActions.saveCorrection(draft.id, remarks.trim())
    if (!outcome.ok) { toast.error("Correction remarks not saved", outcome.message); return false }
    if (!quiet) toast.success("Correction draft saved")
    await onChanged()
    return true
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (pending.current) return
    if (problem) return toast.error("Correction package not ready", problem)
    pending.current = true
    onBusy(true)
    try {
      if (!navigator.onLine) throw new Error("Connect to the internet to submit a correction. It is not queued offline.")
      if (!(await saveRemarks(true))) return
      const names = pinItems.filter((row) => included.includes(row.id)).map((row) => row.text).join(", ")
      const chosen = ncrs.filter((row) => selected.includes(row.id))
      const ok = await confirm({
        title: "Submit correction?",
        size: "md",
        message: `${names}: the full recorded QC checklist will be reinspected${previousIr ? ` (follows ${irRef(previousIr)})` : ""}, including previously passed checks. ${chosen.length ? `${chosen.map((row) => ncrRef(row.number)).join(", ")} will be sent for verification with these correction remarks and new photos. ` : ""}Original results and evidence stay unchanged. Selecting NCRs identifies the repairs; it does not narrow inspection scope. Each NCR still requires Engineer verification and closure.`,
        confirmLabel: "Submit request",
      })
      if (!ok) return
      const outcome = await qaActions.submitCorrection({ itemIds: included, defectIds: selected, rootCause: root, preventive })
      if (!outcome.ok) throw new Error(outcome.message)
      toast.success("Correction package sent", "The Engineer reviews the re-inspection and the NCRs together.")
      setAlso([])
      await onChanged()
    } catch (error) {
      toast.error("Correction package not sent", (error as Error).message)
    } finally { pending.current = false; onBusy(false) }
  }

  if (!draft) {
    return <div className="space-y-2 rounded-xl border border-dashed border-brand/60 p-3 text-sm">
      <p className="font-bold">Correction</p>
      <p className="text-fg-muted">Start the correction to describe the fix and add new photos. You fill this in once: it answers the inspection and the selected NCRs together. The earlier request{previousIr ? ` (${irRef(previousIr)})` : ""} and its photos stay unchanged.</p>
    </div>
  }

  return (
    <form id={formId} noValidate onSubmit={(event) => void submit(event)} className="space-y-4 rounded-xl border-2 border-brand/60 bg-brand-soft/40 p-3">
      <div>
        <p className="text-sm font-extrabold">Correction package · {item.text}</p>
        <p className="text-xs leading-relaxed text-fg-muted">These remarks and photos belong to this correction only{previousIr ? `; ${irRef(previousIr)} keeps its own` : ""}. Select the NCR findings actually corrected. The entire {item.text} QC checklist will be reinspected, including previously passed checks, because a repair may affect other work. NCR selection does not reduce that scope. Unrelated QC checklists and the whole project are not resubmitted. Open findings still block completion.</p>
      </div>
      <div>
        <label className={label} htmlFor={`${formId}-remarks`}>What was corrected *</label>
        <textarea id={`${formId}-remarks`} rows={3} maxLength={1000} className={inputClass} value={remarks} onChange={(event) => setRemarks(event.target.value)} onBlur={() => void saveRemarks(true)} placeholder="e.g. Re-levelled the slab and ground the high spots; checked with a 3 m straightedge" />
        <p className="mt-1 text-xs text-fg-muted">At least {minimum} characters. Used as the corrective action of every NCR you select below. Saved automatically when you leave the field.</p>
      </div>
      <div className="space-y-2">
        <p className={label}>New photos of the corrected work *</p>
        <span className="flex flex-wrap gap-3"><ChecklistUploadButton pin={pin} itemId={item.id} attemptId={draft.id} label={`${item.text} correction`} onAdded={() => void onChanged()} /></span>
        <PinPhotos pin={pin} checklistItemId={item.id} attemptId={draft.id} canAdd={false} canRemoveAny={false} meId={profile?.id ?? ""} columns={3} onChanged={() => void onChanged()} />
        <p className="text-xs text-fg-muted">{newPhotos} eligible new photo{newPhotos === 1 ? "" : "s"}. Photos from the earlier request do not count; photos with a wrong phone clock or older than 3 days stay on record but do not count. Photos away from the site count.</p>
      </div>
      <fieldset className="space-y-2">
        <legend className={label}>NCRs this correction answers</legend>
        {!ncrs.length ? <p className="text-xs text-fg-muted">No NCR is linked to {included.length > 1 ? "these items" : "this item"}.</p> : (
          <ul className="space-y-1.5">
            {ncrs.map((row) => {
              const choosable = row.status === "open" || row.status === "in_progress"
              return <li key={row.id}>
                <label className={`flex items-start gap-2 rounded-lg border border-line bg-surface p-2 text-sm ${choosable ? "cursor-pointer" : "opacity-80"}`}>
                  <input type="checkbox" className="mt-1 h-4 w-4 accent-[#9e1f93]" disabled={!choosable} checked={selected.includes(row.id)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, row.id] : current.filter((id) => id !== row.id))} />
                  <span className="min-w-0 flex-1"><strong>{ncrRef(row.number)}</strong> {row.title}<span className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-fg-muted"><SeverityChip severity={row.severity} />{choosable ? defectStatusLabels[row.status] : row.status === "closed" ? "Closed" : "Already sent: waiting for the Engineer"}</span></span>
                </label>
              </li>
            })}
          </ul>
        )}
        {answerable.length > selected.length ? <p role="status" className="text-xs font-semibold text-amber-800 dark:text-amber-300">{answerable.length - selected.length} linked NCR{answerable.length - selected.length === 1 ? " is" : "s are"} not selected. {item.text} cannot be completed until every linked NCR is closed.</p> : null}
      </fieldset>
      {selected.length ? <div className="grid gap-3 sm:grid-cols-2">
        <div><label className={label} htmlFor={`${formId}-root`}>Root cause (optional)</label><textarea id={`${formId}-root`} rows={2} maxLength={1000} className={inputClass} value={root} onChange={(event) => setRoot(event.target.value)} placeholder="Why did it happen?" /></div>
        <div><label className={label} htmlFor={`${formId}-prev`}>Preventive action (optional)</label><textarea id={`${formId}-prev`} rows={2} maxLength={1000} className={inputClass} value={preventive} onChange={(event) => setPreventive(event.target.value)} placeholder="What stops it happening again?" /></div>
      </div> : null}
      {others.length ? <fieldset className="space-y-1.5">
        <legend className={label}>Include other corrections on this work</legend>
        <p className="text-xs text-fg-muted">Only items with the same criteria and earlier request can share this package. Other corrections are submitted independently; unrelated pending QA does not block them.</p>
        {others.map((row) => <label key={row.item.id} className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="h-4 w-4 accent-[#9e1f93]" disabled={!row.ready} checked={also.includes(row.item.id)} onChange={(event) => setAlso((current) => event.target.checked ? [...current, row.item.id] : current.filter((id) => id !== row.item.id))} />
          {row.item.text}{row.ready ? "" : <span className="text-xs text-fg-muted"> (needs remarks and a new photo in its own correction first)</span>}
        </label>)}
      </fieldset> : null}
      {problem ? <p role="status" className="text-xs font-semibold text-fg-muted">{problem}</p> : <p className="text-xs font-semibold text-fg">Ready to submit: {included.length > 1 ? `${included.length} tasks` : item.text} for re-inspection{selected.length ? ` and ${selected.length} NCR${selected.length === 1 ? "" : "s"} for verification` : ""}.</p>}
    </form>
  )
}
