import { useEffect, useRef, useState, type FormEvent } from "react"
import type { Pin } from "../../lib/blueprints"
import { supabase } from "../../lib/supabase"
import { useToast } from "../../lib/toast"
import { timelinePhases, type TimelinePlan } from "../../lib/projectTimelineModel"

type ProposalState = { draft: { proposal: TimelinePlan; reason: string; expected_revision: number } | null; can_propose: boolean; pending: number }
const field = "mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg"

// Private Engineer drafts are separate from the official pin/task dates visible to the project.
export default function PinScheduleProposal({ pin }: { pin: Pin }) {
  const toast = useToast()
  const generation = useRef(0)
  const [state, setState] = useState<ProposalState | null>(null)
  const [form, setForm] = useState({ start: "", end: "", phase: "Unassigned", reason: "" })
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    const run = ++generation.current
    setState(null); setError("")
    void supabase.rpc("get_pin_schedule_proposal", { p_pin: pin.id }).then(({ data, error: failure }) => {
      if (run !== generation.current) return
      if (failure) { setError(failure.message); return }
      const value = data as ProposalState
      setState(value)
      setForm({ start: value.draft?.proposal.planned_start ?? "", end: value.draft?.proposal.planned_end ?? "", phase: value.draft?.proposal.phase ?? "Unassigned", reason: value.draft?.reason ?? "" })
    }, () => { if (run === generation.current) setError("Could not load the schedule proposal. Retry when connected.") })
    return () => { generation.current++ }
  }, [pin.id, retry])
  const submit = async (event: FormEvent, send: boolean) => {
    event.preventDefault()
    if (!state || busy) return
    if (!form.start || !form.end || form.end < form.start) { setError("Enter a proposed start and deadline in the correct order."); return }
    if (form.reason.trim().length > 500) { setError("Keep the optional technical reason within 500 characters."); return }
    setBusy(true); setError("")
    try {
      const { data, error: failure } = await supabase.rpc(send ? "submit_pin_schedule_proposal" : "save_pin_schedule_draft", {
        p_pin: pin.id, p_start: form.start, p_end: form.end, p_phase: form.phase.trim(), p_reason: form.reason.trim(), p_expected: state.draft?.expected_revision ?? 0,
      })
      if (failure) { setError(failure.message); return }
      toast.success(send ? "Dates sent to the Project Manager" : "Schedule proposal draft saved", send ? `${data} current work task(s) awaiting schedule approval.` : "Official dates are unchanged.")
      setRetry(value => value + 1)
    } catch { setError("Could not save the proposal. Check your connection and retry.") }
    finally { setBusy(false) }
  }
  return <section className="rounded-xl border border-line bg-surface-muted/40 p-3" aria-label="Engineer schedule proposal">
    <h3 className="text-sm font-bold">Propose work dates</h3>
    <p className="text-xs text-fg-muted">Dates entered when adding the pin are sent automatically to the Project Manager. New tasks receive their own approval requests using the sent pin schedule while its proposer still has work access. Use this form to propose changes for all current tasks. The Project Manager approves dates and publishes the schedule.</p>
    {error ? <div role="alert" className="mb-3 text-xs text-danger-fg">{error}{!state ? <button type="button" className="ml-2 underline" onClick={() => setRetry(value => value + 1)}>Retry</button> : null}</div> : null}
    {!state && !error ? <p role="status" className="text-xs text-fg-muted">Loading schedule proposal...</p> : null}
    {state ? <form onSubmit={event => void submit(event, true)} className="space-y-3">
      {state.pending ? <p role="status" className="rounded-lg bg-brand-soft p-2 text-xs text-brand-text">{state.pending} schedule request(s) awaiting Project Manager review. Proposed dates are not official.</p> : null}
      <fieldset disabled={busy || !state.can_propose} className="space-y-3 disabled:opacity-60">
        <div className="grid grid-cols-2 gap-3">{([['start', 'Proposed start'], ['end', 'Proposed deadline']] as const).map(([key, label]) => <label key={key} className="block text-xs font-semibold">{label}<input type="date" min="1900-01-01" max="2199-12-31" required className={field} value={form[key]} onChange={event => setForm(current => ({ ...current, [key]: event.target.value }))} /></label>)}</div>
        <label className="block text-xs font-semibold">Proposed phase<input required maxLength={80} list={`pin-phases-${pin.id}`} className={field} value={form.phase} onChange={event => setForm(current => ({ ...current, phase: event.target.value }))} /><datalist id={`pin-phases-${pin.id}`}>{timelinePhases.map(name => <option key={name} value={name} />)}</datalist></label>
        <label className="block text-xs font-semibold">Technical reason (optional)<textarea maxLength={500} rows={2} className={field} value={form.reason} onChange={event => setForm(current => ({ ...current, reason: event.target.value }))} /></label>
        <div className="flex flex-wrap justify-end gap-2"><button type="button" onClick={event => void submit(event, false)} className="rounded-lg border border-line px-3 py-2 text-xs font-bold">Save proposal draft</button><button type="submit" className="rounded-lg bg-brand px-3 py-2 text-xs font-bold text-white">{busy ? "Saving..." : "Send dates for PM approval"}</button></div>
      </fieldset>
      {!state.can_propose ? <p className="text-xs text-fg-muted">This project is read-only.</p> : null}
    </form> : null}
  </section>
}
