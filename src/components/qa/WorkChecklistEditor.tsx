import { useId, useRef, useState } from "react"
import Modal from "../Modal"
import { buttonPrimary, buttonSecondary, inputClass } from "../ui/PageParts"
import { checklistProblem, useTemplates, type DraftItem, type Template } from "../../lib/qa"
import { pickableChecklists } from "../../lib/qaChecklists"
import ChecklistDocumentation from "./ChecklistDocumentation"
import type { ChecklistItem, Pin } from "../../lib/blueprints"
import { supabase } from "../../lib/supabase"
import { useToast } from "../../lib/toast"

const blank = (): DraftItem => ({ text: "", acceptance_criteria: "", evidence_requirement: "", reference: "", severity: "major", kind: "check", unit: "", min_value: "", max_value: "", requires_photo: false, hold_point: false })
const fromTemplate = (template?: Template): DraftItem[] => template?.qa_template_items.map(row => ({ ...row, unit: row.unit ?? "", min_value: row.min_value == null ? "" : String(row.min_value), max_value: row.max_value == null ? "" : String(row.max_value), reference: row.reference ?? "", acceptance_criteria: row.acceptance_criteria ?? "", evidence_requirement: row.evidence_requirement ?? "" })) ?? [blank()]

// Criteria and work item are saved atomically. There is no later approval step for the Foreman to chase.
export default function WorkChecklistEditor({ pin, item, onClose, onSaved }: { pin: Pin; item?: ChecklistItem; onClose: () => void; onSaved: () => void | Promise<void> }) {
  const { templates, loading, error } = useTemplates(pin.project_id)
  const selected = templates.find(row => row.id === item?.qa_template_id)
  return loading || error || item?.qa_template_id && !selected
    ? <Modal title="QC criteria" onClose={onClose}><p role="status">{error || (loading ? "Loading criteria…" : "The saved criteria could not be loaded. Close and try again.")}</p></Modal>
    : <Editor pin={pin} item={item} templates={templates} selected={selected} onClose={onClose} onSaved={onSaved} />
}

function Editor({ pin, item, templates, selected, onClose, onSaved }: { pin: Pin; item?: ChecklistItem; templates: Template[]; selected?: Template; onClose: () => void; onSaved: () => void | Promise<void> }) {
  const toast = useToast()
  const id = useId()
  const [name, setName] = useState(item?.text ?? "")
  const [criteria, setCriteria] = useState(() => fromTemplate(selected))
  // The standards cited by the project checklist the criteria came from are saved with the item (its documentation).
  const [standards, setStandards] = useState<string[]>(() => selected?.standards ?? [])
  const choices = pickableChecklists(templates, pin.project_id)
  const [busy, setBusy] = useState(false)
  const pending = useRef(false)
  const problem = checklistProblem(name, criteria, "task") || (name.trim().length > 200 ? "Keep the name under 200 characters." : "") || (criteria.some(row => (row.acceptance_criteria?.trim().length ?? 0) < 5) ? "Enter a specific passing requirement for every criterion." : "")
  const patch = (index: number, change: Partial<DraftItem>) => setCriteria(rows => rows.map((row, at) => at === index ? { ...row, ...change } : row))
  const save = async () => {
    if (pending.current || problem) return
    pending.current = true; setBusy(true)
    try {
      const payload: Record<string, unknown> = { p_pin: pin.id, p_item: item?.id ?? null, p_text: name.trim(), p_criteria: criteria }
      if (standards.length) payload.p_standards = standards
      let { error } = await supabase.rpc("save_work_checklist_item", payload)
      // A database without 20261028150000 does not know p_standards yet: save the item without its citations.
      if (error?.code === "PGRST202" && "p_standards" in payload) {
        delete payload.p_standards
        ;({ error } = await supabase.rpc("save_work_checklist_item", payload))
      }
      if (error) throw error
      await onSaved()
      toast.success("Task and QC criteria saved", "The Foreman can add evidence and submit directly for QA Review.")
      onClose()
    } catch (error) { toast.error("Task not saved", (error as Error).message) }
    finally { pending.current = false; setBusy(false) }
  }
  return <Modal title={item ? `Edit ${item.text} and QC criteria` : "Add task and QC criteria"} size="lg" onClose={busy ? () => undefined : onClose}
    description="Define the checks now. The Foreman adds photos and submits; no Ready tick or separate criteria approval."
    footer={<>{problem ? <p role="status" className="mr-auto text-xs text-danger-fg">{problem}</p> : null}<button type="button" className={buttonSecondary} disabled={busy} onClick={onClose}>Cancel</button><button type="button" className={buttonPrimary} disabled={busy || Boolean(problem)} onClick={() => void save()}>{busy ? "Saving…" : "Save task and QC criteria"}</button></>}>
    <div className="space-y-4">
      <label className="block text-sm font-bold">Task name<input className={inputClass + " mt-1"} value={name} maxLength={200} onChange={event => setName(event.target.value)} placeholder="For example: FLOOR" /></label>
      <label className="block text-sm">Copy criteria from a QC checklist added to this project (optional)
        <select className={inputClass + " mt-1"} defaultValue="" disabled={!choices.length} onChange={event => { const template = choices.find(row => row.id === event.target.value); if (template) { setCriteria(fromTemplate(template)); setStandards(template.standards) } }}>
          <option value="" disabled>{choices.length ? "Select only an applicable QC checklist" : "No QC checklist added to this project yet"}</option>{choices.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}
        </select>
      </label>
      <p className="text-xs text-fg-muted">{choices.length ? "Only checklists added under QC Checklists are listed. " : "Add checklists under QC Checklists, or write the criteria below. "}Use the approved project specification for test conditions and limits. Copying a QC checklist does not confirm that it applies to this task.</p>
      <ChecklistDocumentation standards={standards} items={criteria} />
      {standards.length ? <button type="button" className="inline-flex min-h-6 items-center" onClick={() => setStandards([])}><span className="text-xs font-bold text-brand-text hover:underline">Remove the cited standards from this item</span></button> : null}
      {criteria.map((row, index) => <fieldset key={index} className="space-y-2 rounded-xl border border-line p-3">
        <legend className="px-1 text-sm font-bold">Criterion {index + 1}</legend>
        <label className="block text-sm" htmlFor={`${id}-${index}-test`}>Test / check<input id={`${id}-${index}-test`} className={inputClass + " mt-1"} value={row.text} maxLength={500} onChange={event => patch(index, { text: event.target.value })} /></label>
        <label className="block text-sm" htmlFor={`${id}-${index}-pass`}>Passing requirement<textarea id={`${id}-${index}-pass`} className={inputClass + " mt-1"} rows={2} value={row.acceptance_criteria} maxLength={1000} onChange={event => patch(index, { acceptance_criteria: event.target.value })} /></label>
        <details className="text-sm"><summary className="cursor-pointer font-semibold">Reference, evidence and measurement options</summary><div className="mt-2 space-y-2">
          <label className="block">Reference / specification clause<input className={inputClass} maxLength={200} value={row.reference} onChange={event => patch(index, { reference: event.target.value })} /></label>
          <label className="block">Required evidence / test instructions<textarea className={inputClass} rows={2} maxLength={1000} value={row.evidence_requirement} onChange={event => patch(index, { evidence_requirement: event.target.value })} /></label>
          <label className="block">Severity<select className={inputClass} value={row.severity} onChange={event => patch(index, { severity: event.target.value as DraftItem["severity"] })}><option value="minor">Minor</option><option value="major">Major</option><option value="critical">Critical</option></select></label>
          <label className="block">Result type<select className={inputClass} value={row.kind} onChange={event => patch(index, { kind: event.target.value as DraftItem["kind"] })}><option value="check">Pass / fail</option><option value="measure">Measured value</option></select></label>
          {row.kind === "measure" ? <div className="grid grid-cols-3 gap-2">{(["unit", "min_value", "max_value"] as const).map(key => <label key={key}>{key === "unit" ? "Unit" : key === "min_value" ? "Minimum" : "Maximum"}<input className={inputClass} type={key === "unit" ? "text" : "number"} step="any" value={row[key]} onChange={event => patch(index, { [key]: event.target.value })} /></label>)}</div> : null}
          <label className="flex items-center gap-2"><input type="checkbox" checked={row.requires_photo} onChange={event => patch(index, { requires_photo: event.target.checked })} />Engineer must attach inspection evidence</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={row.hold_point} onChange={event => patch(index, { hold_point: event.target.checked })} />Hold point</label>
        </div></details>
        <button type="button" className="text-xs font-bold text-danger-fg" disabled={criteria.length === 1} onClick={() => setCriteria(rows => rows.filter((_, at) => at !== index))}>Remove criterion {index + 1}</button>
      </fieldset>)}
      <button type="button" className={buttonSecondary} disabled={criteria.length >= 60} onClick={() => setCriteria(rows => [...rows, blank()])}>Add criterion</button>
    </div>
  </Modal>
}
