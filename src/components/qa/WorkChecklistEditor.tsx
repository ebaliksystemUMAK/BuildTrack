import { useId, useRef, useState } from "react"
import Modal from "../Modal"
import { buttonPrimary, buttonSecondary, inputClass } from "../ui/PageParts"
import { checklistProblem, useTemplates, type DraftItem, type Template } from "../../lib/qa"
import { pickableChecklists } from "../../lib/qaChecklists"
import ChecklistDocumentation from "./ChecklistDocumentation"
import type { ChecklistItem, Pin } from "../../lib/blueprints"
import { supabase } from "../../lib/supabase"
import { useToast } from "../../lib/toast"
import { useAuth } from "../../lib/auth"
import { useConfirm } from "../../lib/confirm"
import { clearTaskDraft, loadTaskDraft, storeTaskDraft, type TaskDraftValues } from "../../lib/workChecklistDraft"

const blank = (): DraftItem => ({ text: "", acceptance_criteria: "", evidence_requirement: "", reference: "", severity: "major", kind: "check", unit: "", min_value: "", max_value: "", requires_photo: false, hold_point: false })
const fromTemplate = (template?: Template): DraftItem[] => template?.qa_template_items.map(row => ({ ...row, requires_photo: false, unit: row.unit ?? "", min_value: row.min_value == null ? "" : String(row.min_value), max_value: row.max_value == null ? "" : String(row.max_value), reference: row.reference ?? "", acceptance_criteria: row.acceptance_criteria ?? "", evidence_requirement: row.evidence_requirement ?? "" })) ?? [blank()]

// Criteria and work item are saved atomically. There is no later approval step for the Foreman to chase.
export default function WorkChecklistEditor({ pin, item, onClose, onSaved }: { pin: Pin; item?: ChecklistItem; onClose: () => void; onSaved: () => void | Promise<void> }) {
  const { profile } = useAuth()
  const { templates, loading, error } = useTemplates(pin.project_id)
  const selected = templates.find(row => row.id === item?.qa_template_id)
  return !profile?.id || loading || error || item?.qa_template_id && !selected
    ? <Modal title="QC criteria" onClose={onClose}><p role="status">{!profile?.id ? "Sign in to restore your task draft." : error || (loading ? "Loading criteria…" : "The saved criteria could not be loaded. Close and try again.")}</p></Modal>
    : <Editor key={`${profile.id}:${pin.project_id}:${pin.id}:${item?.id ?? "new"}`} userId={profile.id} pin={pin} item={item} templates={templates} selected={selected} onClose={onClose} onSaved={onSaved} />
}

function Editor({ userId, pin, item, templates, selected, onClose, onSaved }: { userId: string; pin: Pin; item?: ChecklistItem; templates: Template[]; selected?: Template; onClose: () => void; onSaved: () => void | Promise<void> }) {
  const toast = useToast()
  const confirm = useConfirm()
  const id = useId()
  const scope = { userId, projectId: pin.project_id, pinId: pin.id, itemId: item?.id ?? null }
  const initialValues = (): TaskDraftValues => ({ name: item?.text ?? "", criteria: fromTemplate(selected), standards: selected?.standards ?? [], sourceTemplateId: "" })
  const [draftState, setDraftState] = useState(() => {
    const stored = loadTaskDraft(scope)
    return { values: stored.draft?.values ?? initialValues(), revision: stored.draft?.revision ?? null, persistent: stored.persistent, restored: Boolean(stored.draft) }
  })
  const current = useRef(draftState)
  const { name, criteria, standards } = draftState.values
  const choices = pickableChecklists(templates, pin.project_id)
  const [busy, setBusy] = useState(false)
  const pending = useRef(false)
  const problemFor = (values: TaskDraftValues) => checklistProblem(values.name, values.criteria, "task") || (values.name.trim().length > 200 ? "Keep the name under 200 characters." : "") || (values.criteria.some(row => (row.acceptance_criteria?.trim().length ?? 0) < 5) ? "Enter a specific passing requirement for every criterion." : "")
  const problem = problemFor(draftState.values)
  const updateDraft = (change: (value: TaskDraftValues) => TaskDraftValues) => {
    if (pending.current) return
    const values = change(current.current.values)
    // Save in the input event itself, before navigation or page exit can unmount this form.
    const stored = storeTaskDraft(scope, values)
    current.current = { values, revision: stored.draft?.revision ?? current.current.revision, persistent: stored.persistent, restored: current.current.restored }
    setDraftState(current.current)
  }
  const setCriteria = (change: (rows: DraftItem[]) => DraftItem[]) => updateDraft(value => ({ ...value, criteria: change(value.criteria) }))
  const patch = (index: number, change: Partial<DraftItem>) => setCriteria(rows => rows.map((row, at) => at === index ? { ...row, ...change } : row))
  const discard = async () => {
    if (pending.current || !current.current.revision || !await confirm({ title: "Discard task draft?", message: "Remove your unfinished changes for this task from this browser?", confirmLabel: "Discard draft", tone: "danger" })) return
    if (!clearTaskDraft(scope, current.current.revision)) return toast.error("Draft not discarded", "Browser storage is unavailable. Your changes are still in this form.")
    current.current = { values: initialValues(), revision: null, persistent: true, restored: false }
    setDraftState(current.current)
  }
  const save = async () => {
    if (pending.current || problemFor(current.current.values)) return
    const submitted = current.current
    pending.current = true; setBusy(true)
    try {
      const payload: Record<string, unknown> = { p_pin: pin.id, p_item: item?.id ?? null, p_text: submitted.values.name.trim(), p_criteria: submitted.values.criteria }
      if (submitted.values.standards.length) payload.p_standards = submitted.values.standards
      let { error } = await supabase.rpc("save_work_checklist_item", payload)
      // A database without 20261028150000 does not know p_standards yet: save the item without its citations.
      if (error?.code === "PGRST202" && "p_standards" in payload) {
        delete payload.p_standards
        ;({ error } = await supabase.rpc("save_work_checklist_item", payload))
      }
      if (error) throw error
      if (!clearTaskDraft(scope, submitted.revision)) toast.info("Task saved", "The browser draft could not be cleared. Discard that draft if it appears again.")
      toast.success("Task and QC criteria saved", "The Foreman can add evidence and submit directly for QA Review.")
      onClose()
      try { await onSaved() } catch { toast.info("Task saved", "Refresh the task list to see it. Avoid submitting it again.") }
    } catch (error) { toast.error("Task not saved", (error as Error).message) }
    finally { pending.current = false; setBusy(false) }
  }
  return <Modal title={item ? `Edit ${item.text} and QC criteria` : "Add task and QC criteria"} size="lg" onClose={busy ? () => undefined : onClose}
    description="Define the checks now. The Foreman adds photos and submits; no Ready tick or separate criteria approval."
    footer={<>{problem ? <p role="status" className="mr-auto text-xs text-danger-fg">{problem}</p> : null}{draftState.revision ? <button type="button" className="min-h-9 px-2 text-xs font-bold text-danger-fg" disabled={busy} onClick={() => void discard()}>Discard draft</button> : null}<button type="button" className={buttonSecondary} disabled={busy} onClick={onClose}>Close</button><button type="button" className={buttonPrimary} disabled={busy || Boolean(problem)} onClick={() => void save()}>{busy ? "Saving…" : "Save task and QC criteria"}</button></>}>
    <fieldset disabled={busy} className="min-w-0 space-y-4">
      <p role={draftState.persistent ? "status" : "alert"} className={`rounded-lg border p-3 text-xs ${draftState.persistent ? "border-line bg-surface-muted text-fg-muted" : "border-danger-fg text-danger-fg"}`}>
        {draftState.persistent ? `${draftState.restored ? "Draft restored. " : ""}${draftState.revision ? "Changes saved automatically in this browser." : "Your changes will be saved automatically in this browser."} Close and reopen this task form to continue.` : "Browser draft storage is unavailable. Your changes are kept while this app stays open; keep this browser open until you save the task."}
      </p>
      <label className="block text-sm font-bold">Task name<input className={inputClass + " mt-1"} value={name} maxLength={200} onChange={event => updateDraft(value => ({ ...value, name: event.target.value }))} placeholder="For example: FLOOR" /></label>
      <label className="block text-sm">Copy criteria from a QC checklist added to this project (optional)
        <select aria-label="Copy criteria from project checklist" className={inputClass + " mt-1"} value={draftState.values.sourceTemplateId ?? ""} disabled={!choices.length} onChange={event => { const template = choices.find(row => row.id === event.target.value); if (template) updateDraft(value => ({ ...value, criteria: fromTemplate(template), standards: template.standards, sourceTemplateId: template.id })) }}>
          <option value="" disabled>{choices.length ? "Select only an applicable QC checklist" : "No QC checklist added to this project yet"}</option>{choices.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}
          {draftState.values.sourceTemplateId && !choices.some(row => row.id === draftState.values.sourceTemplateId) ? <option value={draftState.values.sourceTemplateId} disabled>Previously copied checklist (draft criteria retained)</option> : null}
        </select>
      </label>
      <p className="text-xs text-fg-muted">{choices.length ? "Only checklists added under QC Checklists are listed. " : "Add checklists under QC Checklists, or write the criteria below. "}Use the approved project specification for test conditions and limits. Copying a QC checklist does not confirm that it applies to this task.</p>
      <ChecklistDocumentation standards={standards} items={criteria} />
      {standards.length ? <button type="button" className="inline-flex min-h-6 items-center" onClick={() => updateDraft(value => ({ ...value, standards: [] }))}><span className="text-xs font-bold text-brand-text hover:underline">Remove the cited standards from this item</span></button> : null}
      {criteria.map((row, index) => <fieldset key={index} className="space-y-2 rounded-xl border border-line p-3">
        <legend className="px-1 text-sm font-bold">Criterion {index + 1}</legend>
        <label className="block text-sm" htmlFor={`${id}-${index}-test`}>Test / check<input id={`${id}-${index}-test`} className={inputClass + " mt-1"} value={row.text} maxLength={500} onChange={event => patch(index, { text: event.target.value })} /></label>
        <label className="block text-sm" htmlFor={`${id}-${index}-pass`}>Passing requirement<textarea id={`${id}-${index}-pass`} className={inputClass + " mt-1"} rows={2} value={row.acceptance_criteria} maxLength={1000} onChange={event => patch(index, { acceptance_criteria: event.target.value })} /></label>
        <details className="text-sm"><summary className="cursor-pointer font-semibold">Reference, evidence and measurement options</summary><div className="mt-2 space-y-2">
          <label className="block">Reference / specification clause<input className={inputClass} maxLength={200} value={row.reference} onChange={event => patch(index, { reference: event.target.value })} /></label>
          <label className="block">Evidence / test instructions (optional)<textarea className={inputClass} rows={2} maxLength={1000} value={row.evidence_requirement} onChange={event => patch(index, { evidence_requirement: event.target.value })} /></label>
          <label className="block">Severity<select className={inputClass} value={row.severity} onChange={event => patch(index, { severity: event.target.value as DraftItem["severity"] })}><option value="minor">Minor</option><option value="major">Major</option><option value="critical">Critical</option></select></label>
          <label className="block">Result type<select className={inputClass} value={row.kind} onChange={event => patch(index, { kind: event.target.value as DraftItem["kind"] })}><option value="check">Pass / fail</option><option value="measure">Measured value</option></select></label>
          {row.kind === "measure" ? <div className="grid grid-cols-3 gap-2">{(["unit", "min_value", "max_value"] as const).map(key => <label key={key}>{key === "unit" ? "Unit" : key === "min_value" ? "Minimum" : "Maximum"}<input className={inputClass} type={key === "unit" ? "text" : "number"} step="any" value={row[key]} onChange={event => patch(index, { [key]: event.target.value })} /></label>)}</div> : null}
          <p className="text-xs text-fg-muted">Engineer inspection photos are optional. You can attach them during inspection.</p>
          <label className="flex items-center gap-2"><input type="checkbox" checked={row.hold_point} onChange={event => patch(index, { hold_point: event.target.checked })} />Hold point</label>
        </div></details>
        <button type="button" className="text-xs font-bold text-danger-fg" disabled={criteria.length === 1} onClick={() => setCriteria(rows => rows.filter((_, at) => at !== index))}>Remove criterion {index + 1}</button>
      </fieldset>)}
      <button type="button" className={buttonSecondary} disabled={criteria.length >= 60} onClick={() => setCriteria(rows => [...rows, blank()])}>Add criterion</button>
    </fieldset>
  </Modal>
}
