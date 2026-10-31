import type { ReactNode } from "react"
import { stageLabels, stageTone, type ItemStage, type StageView } from "../../lib/workItemModel"

export function StageChip({ stage }: { stage: ItemStage }) {
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-bold ${stageTone[stage]}`}>{stageLabels[stage]}</span>
}

// Submission declares the work finished; no separate Ready tick.
const rail: Array<{ key: string; label: string; help: string }> = [
  { key: "submitted", label: "Submitted", help: "The Foreman submitted the evidence for QA Review" },
  { key: "passed", label: "Passed", help: "The QC checklist passed" },
  { key: "completed", label: "Completed", help: "The Engineer completed this task after passed QA and closure of its linked NCRs" },
]
const reached = (stage: ItemStage, completed: boolean): number =>
  completed || stage === "completed" ? 3 : stage === "passed" ? 2 : stage === "requested" || stage === "inspecting" || stage === "correction" ? 1 : 0

export function StageRail({ stage, completed }: { stage: ItemStage; completed: boolean }) {
  const done = reached(stage, completed)
  return (
    <ol className="grid grid-cols-3 gap-1" aria-label="Task progress">
      {rail.map((step, index) => (
        <li key={step.key} title={step.help} aria-current={index === done - 1 ? "step" : undefined} className={`rounded-lg border px-2 py-1.5 text-center text-xs font-bold ${index < done ? "border-green-600/50 bg-green-50 text-green-900 dark:bg-green-900/30 dark:text-green-100" : "border-line text-fg-muted"}`}>
          {index < done ? "✓ " : ""}{step.label}
        </li>
      ))}
    </ol>
  )
}

// Current stage, the person who must act, what blocks them and the one next action.
export function NextActionCard({ view, responsible, children }: { view: StageView; responsible: string; children?: ReactNode }) {
  return (
    <section aria-label="Next action" className="space-y-2 rounded-2xl border border-line bg-surface-muted p-4">
      <div className="flex flex-wrap items-center gap-2">
        <StageChip stage={view.stage} />
        <span className="text-xs font-semibold text-fg-muted">Responsible: <span className="text-fg">{view.owner ? responsible : view.stage === "completed" ? "No one: completed" : "Nobody yet (blocked)"}</span></span>
      </div>
      <p className="text-sm font-semibold">{view.status}</p>
      {view.blocker ? <p role="status" className="rounded-lg bg-amber-100 px-3 py-2 text-xs font-semibold text-amber-950 dark:bg-amber-900/40 dark:text-amber-100">Blocker: {view.blocker}</p> : null}
      <p className="text-sm"><strong>Next action:</strong> {view.next}</p>
      {children}
    </section>
  )
}
