import { refNumber, toleranceText } from "../../lib/qa"
import type { PriorQaCheck } from "../../lib/qaReinspection"

const priorResult = { pass: "Pass", fail: "Fail", na: "N/A", pending: "Pending" }
const priorTone = { pass: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200", fail: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200", na: "bg-surface-muted text-fg-muted", pending: "bg-surface-muted text-fg-muted" }

export default function ReinspectionScope({ rows, loading, error, onChanged, onOpenInspection, fullChecklist = true, nameOf }: {
  rows: PriorQaCheck[]; loading: boolean; error: string
  onChanged: () => Promise<void>; onOpenInspection?: (id: string) => void
  fullChecklist?: boolean; nameOf?: (id: string | null) => string
}) {
  return <section aria-label="Reinspection scope" className="space-y-3 rounded-xl border border-brand/40 bg-brand-soft/30 p-3">
    <h3 className="text-sm font-extrabold">{fullChecklist ? "Full QC checklist reinspection" : "Reinspection reference"}</h3>
    <p className="text-xs leading-relaxed text-fg-muted">{fullChecklist ? "Every check in this QC checklist needs a fresh result, including previously passed checks, because the repair may affect other work. Required measurements, tests and photos must be recorded again. This does not resubmit unrelated QC checklists or the whole project." : "The current QC Checklist tab defines what must be reinspected. The earlier checks below are reference only; their results are not carried into this request."}</p>
    <p className="text-xs leading-relaxed text-fg-muted">Earlier results and evidence remain unchanged as history. They do not count as results for this new inspection. Linked correction NCRs close automatically only when their own finding has a fresh signed-off Pass; completing the task remains a separate manual action.</p>
    {loading ? <p role="status" className="text-xs">Loading earlier checks…</p> : error ? <p role="alert" className="text-sm text-danger-fg">{error} <button type="button" className="underline" onClick={() => void onChanged()}>Retry</button></p> : rows.length ? <div className="space-y-3">
      <h4 className="text-sm font-bold">Previous inspection results — reference only ({rows.length})</h4>
      <ul className="space-y-3">{rows.map(row => <li key={row.id} className="space-y-2 rounded-xl border border-line bg-surface p-3 text-sm">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <p className="min-w-0 flex-1 font-bold">{row.text}</p>
          <span className={`rounded-md px-2 py-1 text-xs font-extrabold ${priorTone[row.result]}`}>Previous {priorResult[row.result]}</span>
        </div>
        <p className="text-xs text-fg-muted">{refNumber("ir", row.source_number)} · {fullChecklist ? "Must be checked again in this inspection" : "Reference only — see the current QC Checklist for reinspection scope"}</p>
        {row.kind === "measure" ? <p className="text-xs"><strong>Recorded measurement:</strong> {row.measured_value ?? "Not recorded"}{row.measured_value !== null && row.unit ? ` ${row.unit}` : ""} · Required: {toleranceText(row)}</p> : null}
        {row.remarks ? <p className="whitespace-pre-wrap rounded-lg bg-surface-muted p-2 text-sm"><strong>Previous remarks:</strong> {row.remarks}</p> : null}
        {row.acceptance_criteria ? <p className="whitespace-pre-wrap text-xs"><strong>Requirement:</strong> {row.acceptance_criteria}</p> : null}
        {row.checked_at ? <p className="text-xs text-fg-muted">Recorded {new Date(row.checked_at).toLocaleString("en-PH", { timeZone: "Asia/Manila", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}{row.checked_by && nameOf ? ` · ${nameOf(row.checked_by)}` : ""}</p> : null}
        {onOpenInspection ? <button type="button" className="text-xs font-bold text-brand-text underline" onClick={() => onOpenInspection(row.inspection_id)}>View original result and evidence</button> : null}
      </li>)}</ul>
    </div> : <p className="text-xs text-fg-muted">No earlier check results are available. Earlier records remain available in the linked inspection history.</p>}
  </section>
}
