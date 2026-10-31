import { useRef, useState } from "react"
import { useAuth } from "../../lib/auth"
import { useConfirm } from "../../lib/confirm"
import { useToast } from "../../lib/toast"
import { qaActions, useTemplates } from "../../lib/qa"
import { supabase } from "../../lib/supabase"
import { qaSubmissionMessage, submitAfterConfirmation } from "../../lib/pinQaModel"
import type { usePinQa } from "../../lib/pinQa"
import type { Pin, ChecklistItem } from "../../lib/blueprints"
import { buttonPrimary, inputClass } from "../ui/PageParts"

// The inspection criteria (a QA template) that every work item of this pin is inspected against. Only the Engineer approves them.
export function CriteriaApproval({ pin, qa, compact = false, onChanged }: { pin: Pin; qa: ReturnType<typeof usePinQa>; compact?: boolean; onChanged?: () => void | Promise<void> }) {
  const { profile } = useAuth()
  const { templates } = useTemplates(pin.project_id)
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const pending = useRef(false)
  const state = qa.state
  const usable = templates.filter((t) => !t.archived && t.qa_template_items.length)
  const template = usable.find((t) => t.id === state?.templateId)
  const locked = !state || state.open || state.status === "for_review" || state.status === "verified"
  const configure = async (id: string) => {
    if (pending.current || !id) return
    pending.current = true
    setBusy(true)
    try {
      const { error } = await supabase.rpc("approve_pin_qa_checklist", { p_pin: pin.id, p_template: id })
      if (error) throw error
      await qa.reload()
      await onChanged?.()
      toast.success("QC Checklist approved", usable.find((t) => t.id === id)?.name)
    } catch (error) {
      toast.error("QC Checklist not saved", (error as { message?: string }).message)
    } finally { setBusy(false); pending.current = false }
  }
  if (profile?.role !== "engineer") {
    return <p className="text-xs text-fg-muted">{template && state?.approved ? <>QC Checklist: <strong>{template.name}</strong> (approved by the Engineer)</> : "The project Engineer must approve the QC checklist before tasks can be submitted."}</p>
  }
  return <label className="block text-xs font-semibold">{compact ? "QC Checklist" : "QC Checklist for every task of this work"}
    <select className={`${inputClass} mt-1`} value={state?.templateId ?? ""} disabled={busy || locked} onChange={(e) => void configure(e.target.value)}>
      <option value="" disabled>Select the criteria</option>
      {usable.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
    </select>
    {template && !state?.approved ? <button type="button" className={buttonPrimary + " mt-2"} disabled={busy || locked} onClick={() => void configure(template.id)}>Approve these criteria</button> : null}
    {!usable.length ? <span role="status" className="mt-1 block">No QC checklists are available. Add a project or company checklist under QC Checklists first.</span> : null}
    {!compact ? <span className="mt-1 block font-normal text-fg-muted">Tasks (FLOOR, WALL…) are what the Foreman prepares; QC checklists define the measurements, material checks and workmanship requirements used to inspect each task.</span> : null}
  </label>
}

// Pin-level panel under the work items: the criteria, and the Foreman's "submit every ready item" shortcut for FIRST requests.
// Corrections are never sent from here: each returned item goes through its own correction package (one form, linked NCRs).
export default function PinQaSubmission({ pin, qa, items, firstTimeReady, onChanged, note }: {
  pin: Pin; qa: ReturnType<typeof usePinQa>; items: ChecklistItem[]; firstTimeReady: ChecklistItem[]
  onChanged?: () => void | Promise<void>; note?: string
}) {
  const { profile } = useAuth()
  const confirm = useConfirm()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const pending = useRef(false)
  const state = qa.state
  const assigned = profile?.role === "foreman" && profile.status === "active" && pin.assigned_to === profile.id
  const reason = qa.error ? `QA unavailable: ${qa.error}` : !state ? "Checking QA requirements…"
    : state.status === "verified" ? "This work is Completed."
    : state.submissionProblem ? state.submissionProblem
    : !state.templateId || !state.approved ? "The Engineer must approve the QC checklist first."
    : !firstTimeReady.length ? "No ready item is waiting for its first QA request." : ""
  const submit = async () => {
    if (pending.current || reason) return
    pending.current = true
    setBusy(true)
    try {
      const problem = await qa.preflight()
      if (problem) throw new Error(problem)
      await submitAfterConfirmation(() => confirm({
        title: `Submit ${firstTimeReady.length} ready item${firstTimeReady.length === 1 ? "" : "s"} for QA Review?`,
        message: `${firstTimeReady.map((item) => item.text).join(", ")}. ${qaSubmissionMessage(items.filter((item) => item.done).length, items.length)}`,
        confirmLabel: "Submit for inspection", cancelLabel: "Cancel",
      }), async () => {
        if (!navigator.onLine) throw new Error("Connect to the internet to request QA. This request is not queued offline.")
        const outcome = await qaActions.submitItems(pin.id, firstTimeReady.map((item) => item.id), note)
        if (!outcome.ok) throw new Error(outcome.message)
        toast.success("QA requested", "The project Engineer has been notified. Evidence is locked while the request is open.")
        await qa.reload()
        await onChanged?.()
      })
    } catch (error) {
      toast.error("QA request not sent", (error as Error).message)
      await qa.reload()
    } finally { setBusy(false); pending.current = false }
  }
  if (profile?.role === "client" || profile?.role === "user") return null
  return <section className="space-y-2 rounded-xl border border-line p-3" aria-label="QC Checklist and QA requests">
    <h4 className="text-sm font-bold">QC Checklist</h4>
    <CriteriaApproval pin={pin} qa={qa} />
    {assigned ? <>
      <button type="button" className={buttonPrimary} disabled={busy || Boolean(reason)} onClick={() => void submit()}>{busy ? "Please wait…" : `Submit all ready tasks for QA Review${firstTimeReady.length ? ` (${firstTimeReady.length})` : ""}`}</button>
      <p role="status" className="text-xs text-fg-muted">{reason || "Each item is inspected, corrected if needed and completed by the Engineer after its NCRs are closed. Open an item to follow it."}</p>
    </> : qa.error ? <p role="alert" className="text-sm text-danger-fg">{qa.error}</p> : null}
  </section>
}
