import SelectedProjectWorkspace from "../../components/SelectedProjectWorkspace"
import ProjectContextBar from "../../components/ProjectContextBar"
import { PageHead } from "../../components/ui/PageParts"
import AdminIcon, { type AdminIconName } from "../Admin/AdminIcon"
import type { ForemanPageKey, ForemanPageProps } from "./types"

const steps: { key: ForemanPageKey; icon: AdminIconName; title: string; text: string }[] = [
  { key: "daily-report", icon: "file", title: "Daily progress report", text: "Weather, crew head count, work done and problems met today." },
  { key: "photo-documentation", icon: "camera", title: "Photo documentation", text: "Daily report, task and work progress photos for this project." },
  { key: "quality-control", icon: "clipboard", title: "QA requests", text: "Each task with its next action, inspection and completion status." },
  { key: "issues", icon: "edit", title: "Corrections", text: "Fix returned tasks and their NCRs with one correction form." },
]

// The foreman's site plan: open a pin to report progress, then use the shortcuts for the day's paperwork.
export default function ForemanDailyWorkManagement({ onNavigate }: ForemanPageProps) {
  return (
    <div className="foreman-page">
      <PageHead
        eyebrow="Today on site"
        title="My work"
        description="Open your assigned work and its tasks (FLOOR, WALL…). Add photos and submit each item for QA Review. The Engineer completes each task after passed QA and closure of its linked NCRs. The work pin completes when all tasks are completed and all NCRs and inspections are clear."
      />
      <ProjectContextBar listPath="/foreman/projects" listLabel="My projects" />

      <section aria-label="Site plan and pins" className="mb-6">
        <SelectedProjectWorkspace role="foreman" canEdit={false} />
      </section>

      <section aria-labelledby="daily-steps">
        <h2 id="daily-steps" className="mb-3 text-base font-extrabold text-fg">The rest of today's paperwork</h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {steps.map((step) => (
            <button
              key={step.key}
              type="button"
              onClick={() => onNavigate(step.key)}
              className="group flex items-start gap-3 rounded-2xl border border-line bg-surface p-4 text-left shadow-[var(--bt-shadow)] transition hover:-translate-y-0.5 hover:border-brand/40 hover:shadow-[var(--bt-shadow-hover)]"
            >
              <span className="grid h-10 w-10 flex-none place-items-center rounded-xl bg-brand-soft text-brand-text [&>svg]:h-5 [&>svg]:w-5">
                <AdminIcon name={step.icon} />
              </span>
              <span className="min-w-0">
                <span className="block font-extrabold text-fg group-hover:text-brand-text">{step.title}</span>
                <span className="mt-0.5 block text-sm leading-snug text-fg-muted">{step.text}</span>
              </span>
            </button>
          ))}
        </div>
      </section>
    </div>
  )
}
