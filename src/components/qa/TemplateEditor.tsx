import { useEffect, useRef, useState } from "react"
import Modal from "../Modal"
import { buttonPrimary, buttonSecondary, inputClass } from "../ui/PageParts"
import { checklistProblem, qaActions, qaSeverityLabels, severities, trades, tradeLabels, type DraftItem, type QaSeverity, type Template, type Trade } from "../../lib/qa"
import { useToast } from "../../lib/toast"
import { useAuth } from "../../lib/auth"
import { useConfirm } from "../../lib/confirm"
import { clearQcDraft, loadQcDraft, qcDraftKey, storeQcDraft, type QcDraftValues } from "../../lib/qcChecklistDraft"

const label = "mb-1 block text-xs font-extrabold uppercase tracking-wider text-fg-muted"
const blank = (): DraftItem => ({ text: "", severity: "major", kind: "check", unit: "", min_value: "", max_value: "", reference: "", acceptance_criteria: "", evidence_requirement: "", requires_photo: false, hold_point: false })
const fromTemplate = (template: Template | null): DraftItem[] =>
  template?.qa_template_items.length
    ? template.qa_template_items.map((item) => ({ text: item.text, severity: item.severity, kind: item.kind, unit: item.unit ?? "", min_value: item.min_value === null ? "" : String(item.min_value), max_value: item.max_value === null ? "" : String(item.max_value), reference: item.reference ?? "", acceptance_criteria: item.acceptance_criteria ?? "", evidence_requirement: item.evidence_requirement ?? "", requires_photo: item.requires_photo, hold_point: item.hold_point }))
    : [blank()]

// Create or edit an inspection checklist (an Inspection and Test Plan sheet). The built-in lists cannot be edited: duplicate one first.
// Clause numbers are typed by the engineer from the project's own specification, they are never pre-filled.
export default function TemplateEditor({ template, projectId, standards, onClose, onSaved }: { template: Template | null; projectId: string | null; standards: Array<{ code: string; title: string }>; onClose: () => void; onSaved: () => void | Promise<void> }) {
  const { profile } = useAuth()
  if (!profile?.id) return <Modal title="QC checklist" onClose={onClose}><p role="status">Sign in to restore your checklist draft.</p></Modal>
  return <ChecklistForm key={qcDraftKey({ userId: profile.id, projectId, templateId: template?.id ?? null })} userId={profile.id} template={template} projectId={projectId} standards={standards} onClose={onClose} onSaved={onSaved} />
}

function ChecklistForm({ userId, template, projectId, standards, onClose, onSaved }: { userId: string; template: Template | null; projectId: string | null; standards: Array<{ code: string; title: string }>; onClose: () => void; onSaved: () => void | Promise<void> }) {
  const toast = useToast()
  const confirm = useConfirm()
  const scope = { userId, projectId, templateId: template?.id ?? null }
  const initialValues = (): QcDraftValues => ({ name: template?.name ?? "", trade: template?.trade ?? "structural", description: template?.description ?? "", cited: template?.standards ?? [], items: fromTemplate(template) })
  const [draftState, setDraftState] = useState(() => {
    const stored = loadQcDraft(scope)
    return { values: stored.draft?.values ?? initialValues(), revision: stored.draft?.revision ?? null, persistent: stored.persistent, restored: Boolean(stored.draft) }
  })
  const current = useRef(draftState)
  const { name, trade, description, cited, items } = draftState.values
  const [busy, setBusy] = useState(false)
  const pending = useRef(false)
  const focusNewItem = useRef(false)
  const lastItemInput = useRef<HTMLInputElement>(null)
  const problem = checklistProblem(name, items)
  const updateDraft = (change: (value: QcDraftValues) => QcDraftValues) => {
    if (pending.current) return
    const values = change(current.current.values), stored = storeQcDraft(scope, values)
    current.current = { values, revision: stored.draft?.revision ?? current.current.revision, persistent: stored.persistent, restored: current.current.restored }
    setDraftState(current.current)
  }
  const setItems = (change: (value: DraftItem[]) => DraftItem[]) => updateDraft(value => ({ ...value, items: change(value.items) }))
  const addItem = () => {
    if (pending.current || current.current.values.items.length >= 60) return
    focusNewItem.current = true
    setItems(value => [...value, blank()])
  }
  useEffect(() => {
    if (!focusNewItem.current) return
    focusNewItem.current = false
    lastItemInput.current?.focus({ preventScroll: true })
    lastItemInput.current?.scrollIntoView({ block: "nearest" })
  }, [items.length])
  const discard = async () => {
    if (pending.current || !current.current.revision || !await confirm({ title: "Discard QC checklist draft?", message: "Remove your unfinished checklist changes from this browser?", confirmLabel: "Discard draft", tone: "danger" })) return
    if (!clearQcDraft(scope, current.current.revision)) return toast.error("Draft not discarded", "Browser storage is unavailable. Your changes are still in this form.")
    current.current = { values: initialValues(), revision: null, persistent: true, restored: false }
    setDraftState(current.current)
  }

  const patch = (index: number, change: Partial<DraftItem>) => setItems((current) => current.map((item, at) => (at === index ? { ...item, ...change } : item)))
  const move = (index: number, by: number) => setItems((current) => {
    const to = index + by
    if (to < 0 || to >= current.length) return current
    const next = [...current]
    ;[next[index], next[to]] = [next[to], next[index]]
    return next
  })

  const save = async () => {
    if (pending.current || checklistProblem(current.current.values.name, current.current.values.items)) return
    const submitted = current.current
    pending.current = true
    setBusy(true)
    const payload = submitted.values.items.map((item) => ({
      text: item.text.trim(),
      severity: item.severity,
      kind: item.kind,
      unit: item.kind === "measure" ? item.unit.trim() : "",
      min_value: item.kind === "measure" ? item.min_value.trim() : "",
      max_value: item.kind === "measure" ? item.max_value.trim() : "",
      reference: item.reference.trim(),
      acceptance_criteria: item.acceptance_criteria?.trim() ?? "",
      evidence_requirement: item.evidence_requirement?.trim() ?? "",
      requires_photo: item.requires_photo,
      hold_point: item.hold_point,
    }))
    try {
      const result = await qaActions.saveTemplate({ id: template?.id ?? null, projectId, name: submitted.values.name.trim(), trade: submitted.values.trade, description: submitted.values.description.trim(), standards: submitted.values.cited, items: payload })
      if (!result.ok) return toast.error("QC Checklist not saved", result.message)
      if (!clearQcDraft(scope, submitted.revision)) toast.info("QC Checklist saved", "The browser draft could not be cleared. Discard it if it appears again.")
      toast.success("QC Checklist saved", submitted.values.name.trim())
      onClose()
      try { await onSaved() } catch { toast.info("QC Checklist saved", "Refresh the checklist list to see it. Avoid submitting it again.") }
    } catch (error) { toast.error("QC Checklist not saved", error instanceof Error ? error.message : "Check your connection and try again.") }
    finally { pending.current = false; setBusy(false) }
  }

  return (
    <Modal
      title={template ? "Edit QC checklist" : "New QC checklist"}
      description={projectId ? "Used for this project only. Inspections already requested keep the list they were created with." : "Company library: every project can use it. Only a Super Admin edits it."}
      size="2xl"
      onClose={busy ? () => undefined : onClose}
      footer={
        <>
          {problem ? <span className="mr-auto text-xs font-bold text-danger-fg" role="status">{problem}</span> : null}
          {draftState.revision ? <button type="button" className="min-h-9 px-2 text-xs font-bold text-danger-fg" disabled={busy} onClick={() => void discard()}>Discard draft</button> : null}
          <button type="button" className={buttonSecondary} disabled={busy} onClick={onClose}>Close</button>
          <button type="button" className={buttonPrimary} disabled={busy || Boolean(problem)} onClick={() => void save()}>{busy ? "Saving..." : "Save QC checklist"}</button>
        </>
      }
    >
      <fieldset disabled={busy} className="min-w-0 space-y-4">
        <p role={draftState.persistent ? "status" : "alert"} className={`rounded-lg border p-3 text-xs ${draftState.persistent ? "border-line bg-surface-muted text-fg-muted" : "border-danger-fg text-danger-fg"}`}>
          {draftState.persistent ? `${draftState.restored ? "Draft restored. " : ""}${draftState.revision ? "Changes saved automatically in this browser." : "Your changes will be saved automatically in this browser."} Reopen the same checklist form to continue.` : "Browser draft storage is unavailable. Your changes are kept while this app stays open; keep this browser open until you save the checklist."}
        </p>
        <p className="rounded-lg bg-surface-muted p-3 text-xs text-fg-muted">References are not automatic proof of compliance. Record the applicable edition and exact clause, acceptance criteria, and required evidence or test for each item. The Engineer can copy applicable criteria while creating each task. Existing inspections keep their original criteria.</p>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="sm:col-span-2"><label className={label} htmlFor="t-name">Name</label><input id="t-name" className={inputClass} maxLength={120} value={name} onChange={(event) => updateDraft(value => ({ ...value, name: event.target.value }))} placeholder="e.g. Slab pre-pour inspection" /></div>
          <div><label className={label} htmlFor="t-trade">Trade</label><select id="t-trade" className={inputClass} value={trade} onChange={(event) => updateDraft(value => ({ ...value, trade: event.target.value as Trade }))}>{trades.map((t) => <option key={t} value={t}>{tradeLabels[t]}</option>)}</select></div>
        </div>
        <div><label className={label} htmlFor="t-desc">Description</label><input id="t-desc" className={inputClass} maxLength={500} value={description} onChange={(event) => updateDraft(value => ({ ...value, description: event.target.value }))} placeholder="When this inspection is used" /></div>
        {standards.length ? (
          <fieldset>
            <legend className={label}>Standards cited</legend>
            <div className="flex flex-wrap gap-2">
              {[...standards, ...cited.filter(code => !standards.some(standard => standard.code === code)).map(code => ({ code, title: "Previously cited reference (retained)" }))].map((standard) => {
                const on = cited.includes(standard.code)
                return <button key={standard.code} type="button" aria-pressed={on} title={standard.title} onClick={() => updateDraft(value => ({ ...value, cited: value.cited.includes(standard.code) ? value.cited.filter(code => code !== standard.code) : [...value.cited, standard.code].slice(0, 10) }))} className={`rounded-full border px-3 py-1 text-xs font-bold transition ${on ? "border-brand bg-brand-soft text-brand-text" : "border-line text-fg-muted hover:bg-surface-muted"}`}>{standard.code}</button>
              })}
            </div>
          </fieldset>
        ) : null}

        <div>
          <h3 className={label}>Items ({items.length}/60)</h3>
          <ol className="space-y-2">
            {items.map((item, index) => (
              <li key={index} className="rounded-xl border border-line bg-surface p-3">
                <div className="flex items-start gap-2">
                  <span className="mt-2 flex h-6 w-6 flex-none items-center justify-center rounded-full bg-surface-muted text-xs font-extrabold text-fg-muted">{index + 1}</span>
                  <div className="min-w-0 flex-1 space-y-2">
                    <input ref={index === items.length - 1 ? lastItemInput : undefined} aria-label={`Item ${index + 1} text`} className={inputClass} maxLength={300} value={item.text} onChange={(event) => patch(index, { text: event.target.value })} placeholder="What is checked, in plain words" />
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <select aria-label={`Item ${index + 1} class`} className={inputClass + " !w-auto !py-1"} value={item.severity} onChange={(event) => patch(index, { severity: event.target.value as QaSeverity })}>{severities.map((s) => <option key={s} value={s}>{qaSeverityLabels[s]}</option>)}</select>
                      <select aria-label={`Item ${index + 1} type`} className={inputClass + " !w-auto !py-1"} value={item.kind} onChange={(event) => patch(index, { kind: event.target.value as "check" | "measure" })}><option value="check">Pass / fail</option><option value="measure">Measured value</option></select>
                      <label className="flex items-center gap-1 font-semibold"><input type="checkbox" checked={item.hold_point} onChange={(event) => patch(index, { hold_point: event.target.checked })} /> Hold point</label>
                      <label className="flex items-center gap-1 font-semibold"><input type="checkbox" checked={item.requires_photo} onChange={(event) => patch(index, { requires_photo: event.target.checked })} /> Photo required</label>
                    </div>
                    {item.kind === "measure" ? (
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <input aria-label={`Item ${index + 1} unit`} className={inputClass + " !w-24 !py-1"} maxLength={20} value={item.unit} onChange={(event) => patch(index, { unit: event.target.value })} placeholder="Unit (mm)" />
                        <input aria-label={`Item ${index + 1} lowest value`} inputMode="decimal" className={inputClass + " !w-28 !py-1"} value={item.min_value} onChange={(event) => patch(index, { min_value: event.target.value })} placeholder="Lowest" />
                        <input aria-label={`Item ${index + 1} highest value`} inputMode="decimal" className={inputClass + " !w-28 !py-1"} value={item.max_value} onChange={(event) => patch(index, { max_value: event.target.value })} placeholder="Highest" />
                        <span className="text-fg-muted">Leave both empty to record a value without a limit.</span>
                      </div>
                    ) : null}
                    <label className="block text-xs font-bold">Standard, edition and exact clause
                      <input aria-label={`Item ${index + 1} requirement`} className={inputClass + " mt-1 !py-1"} maxLength={200} value={item.reference} onChange={(event) => patch(index, { reference: event.target.value })} placeholder="Copy the applicable code, edition and clause from the approved specification" />
                    </label>
                    <label className="block text-xs font-bold">Acceptance criteria
                      <textarea aria-label={`Item ${index + 1} acceptance criteria`} rows={2} className={inputClass + " mt-1 !py-1"} maxLength={1000} value={item.acceptance_criteria ?? ""} onChange={(event) => patch(index, { acceptance_criteria: event.target.value })} placeholder="Engineer-defined pass/fail requirement; use the approved specification, not an assumed limit" />
                    </label>
                    <label className="block text-xs font-bold">Required evidence / test
                      <textarea aria-label={`Item ${index + 1} required evidence or test`} rows={2} className={inputClass + " mt-1 !py-1"} maxLength={1000} value={item.evidence_requirement ?? ""} onChange={(event) => patch(index, { evidence_requirement: event.target.value })} placeholder="Required photos, certificates, sampling/test method and report references" />
                    </label>
                  </div>
                  <div className="flex flex-none flex-col gap-1">
                    <button type="button" aria-label={`Move item ${index + 1} up`} disabled={index === 0} onClick={() => move(index, -1)} className="rounded border border-line px-2 text-xs hover:bg-surface-muted disabled:opacity-40">↑</button>
                    <button type="button" aria-label={`Move item ${index + 1} down`} disabled={index === items.length - 1} onClick={() => move(index, 1)} className="rounded border border-line px-2 text-xs hover:bg-surface-muted disabled:opacity-40">↓</button>
                    <button type="button" aria-label={`Remove item ${index + 1}`} disabled={items.length === 1} onClick={() => setItems((current) => current.filter((_, at) => at !== index))} className="rounded border border-line px-2 text-xs text-danger-fg hover:bg-surface-muted disabled:opacity-40">×</button>
                  </div>
                </div>
              </li>
            ))}
          </ol>
          <button type="button" className={buttonSecondary + " mt-3"} disabled={items.length >= 60} onClick={addItem}>Add item</button>
        </div>
      </fieldset>
    </Modal>
  )
}
