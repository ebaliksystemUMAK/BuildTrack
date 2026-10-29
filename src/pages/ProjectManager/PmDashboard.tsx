import { useMemo } from "react"
import SCurveChart from "../../components/SCurveChart"
import { EmptyState, Meter, PageHead, StatCard, buttonPrimary, buttonSecondary } from "../../components/ui/PageParts"
import { SkeletonCardGrid, SkeletonList } from "../../components/ui/Skeleton"
import { activityLabel, formatDate, formatTime, roleLabel } from "../../lib/admin"
import { followLink } from "../../lib/notifications"
import { pinPlanPath } from "../../lib/pinRecordsModel"
import { scheduleElapsed } from "../../lib/progress"
import { dashboardSummary, slotLabels } from "../../lib/projectManagerModel"
import { useProjectAudit } from "../../lib/projectManagers"
import { phaseLabels, statusLabels } from "../../lib/projects"
import { useProjectWork } from "../../lib/projectWork"
import { useDefects, useInspections } from "../../lib/qa"
import { qaRecordPath } from "../../lib/qaAttemptsModel"
import { Panel } from "../Admin/AdminShell"
import { usePmProject } from "./usePmProject"
import type { PmPageProps } from "./types"

const kindChip = { work: "bg-sky-100 text-sky-900 dark:bg-sky-900/40 dark:text-sky-100", ncr: "bg-red-100 text-red-900 dark:bg-red-900/40 dark:text-red-100", milestone: "bg-brand-soft text-brand-text" }
const kindName = { work: "Work", ncr: "NCR", milestone: "Milestone" }
const dateText = (day: string) => new Date(`${day}T00:00:00`).toLocaleDateString("en-PH", { day: "numeric", month: "short", year: "numeric" })

// Project dashboard: progress against the schedule, deadlines, what waits for the Engineer's review, and the quality issues still open.
export default function PmDashboard({ onNavigate }: PmPageProps) {
  const pm = usePmProject()
  const work = useProjectWork(pm.projectId)
  const { inspections, loading: inspectionsLoading } = useInspections(pm.projectId)
  const { defects, loading: defectsLoading } = useDefects(pm.projectId)
  const activity = useProjectAudit(pm.projectId, "", 0, 8)
  const project = work.project
  const summary = useMemo(() => project ? dashboardSummary({ pins: work.pins, inspections, defects, project, today: work.today }) : null, [project, work.pins, inspections, defects, work.today])
  const elapsed = project ? scheduleElapsed(project.start_date, project.end_date, work.today) : null
  const loading = work.loading || inspectionsLoading || defectsLoading
  const counts = { engineer: 0, foreman: 0, client: 0 }
  for (const member of work.team) counts[member.role] += 1
  const lead = (role: "engineer" | "foreman") => work.team.find((member) => member.role === role && member.is_lead)?.full_name ?? "Not assigned"

  const openDeadline = (id: string) => {
    if (!project) return
    const [kind, recordId] = id.split(":")
    if (kind === "work") {
      const pin = work.pins.find((row) => row.id === recordId)
      if (pin) followLink(pinPlanPath("project_manager", { projectId: project.id, pinId: pin.id, sheetId: pin.blueprint_id }), project.id)
    } else if (kind === "ncr") followLink(qaRecordPath("project_manager", project.id, "defect", recordId), project.id)
    else onNavigate("details")
  }

  if (!project || !summary) return <div className="admin-page"><SkeletonCardGrid count={4} label="Loading the project dashboard" /></div>
  return (
    <div className="admin-page">
      <PageHead
        eyebrow={`${project.code} • Project dashboard`}
        title={project.name}
        description={`${statusLabels[project.status]} • ${phaseLabels[project.phase]}${project.client_name ? ` • Client: ${project.client_name}` : ""}${project.location ? ` • ${project.location}` : ""}`}
        actions={<>
          <button type="button" className={buttonSecondary} onClick={() => onNavigate("details")}>{pm.canManage ? "Edit details" : "View details"}</button>
          <button type="button" className={buttonPrimary} onClick={() => onNavigate("quality")}>Quality & QA</button>
        </>}
      />
      {pm.note ? <p role="status" className="mb-4 rounded-lg bg-surface-muted px-4 py-2 text-sm text-fg">{pm.note}</p> : null}
      {work.error ? <p role="alert" className="mb-3 rounded-lg bg-danger-soft px-4 py-2 text-sm text-danger-fg">{work.error} <button type="button" className="font-bold underline" onClick={() => void work.reload()}>Retry</button></p> : null}

      {loading ? <SkeletonCardGrid count={4} label="Loading project figures" /> : (
        <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <StatCard label="Verified progress" value={`${summary.totals.percentVerified}%`} note={`${summary.totals.verified} of ${summary.totals.total} work items accepted by the Engineer`} tone="green" />
          <StatCard label="Schedule elapsed" value={elapsed === null ? "—" : `${elapsed}%`} note={project.end_date ? `Target completion ${dateText(project.end_date)}` : "Set the dates in Project details"} tone="sky" onClick={() => onNavigate("calendar")} />
          <StatCard label="Waiting for review" value={summary.reviewsWaiting} note={`${summary.pendingReviews} work items • ${summary.openInspections} inspections • ${summary.ncrForVerification} NCR fixes`} tone="amber" onClick={() => onNavigate("quality")} />
          <StatCard label="Open quality issues" value={summary.openNcrs} note={summary.overdueNcrs ? `${summary.overdueNcrs} past the deadline` : "None past the deadline"} tone={summary.overdueNcrs ? "red" : "brand"} onClick={() => onNavigate("quality", "tab=defects")} />
          <StatCard label="Late work" value={summary.totals.overdue} note={summary.totals.issue ? `${summary.totals.issue} work items with issues` : "No work items with issues"} tone={summary.totals.overdue ? "red" : "gray"} />
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Panel title="Progress against the plan">
          {loading ? <SkeletonList rows={3} /> : summary.totals.total ? <>
            <Meter value={summary.totals.percentVerified} label="Verified progress" />
            <div className="mt-4"><SCurveChart pins={work.pins} start={project.start_date} end={project.end_date} today={work.today} /></div>
          </> : <EmptyState title="No work items yet">Engineers place work pins on the plans; progress appears here once they exist.</EmptyState>}
        </Panel>
        <Panel title="Deadlines (late and next 14 days)">
          {loading ? <SkeletonList rows={4} /> : summary.deadlines.length === 0 ? <p className="text-sm text-fg-muted">Nothing is due in the next 14 days and nothing is late.</p> : (
            <ul className="divide-y divide-line">
              {summary.deadlines.slice(0, 12).map((row) => (
                <li key={row.id}>
                  <button type="button" onClick={() => openDeadline(row.id)} className="flex w-full items-center gap-3 py-2 text-left text-sm hover:bg-surface-muted">
                    <span className={`flex-none rounded px-1.5 py-0.5 text-[11px] font-bold ${kindChip[row.kind]}`}>{kindName[row.kind]}</span>
                    <span className="min-w-0 flex-1 truncate font-semibold text-fg">{row.title}</span>
                    <span className={`flex-none text-xs font-semibold ${row.late ? "text-red-700 dark:text-red-300" : "text-fg-muted"}`}>{row.late ? "Late • " : ""}{dateText(row.date)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {summary.deadlines.length > 12 ? <p className="mt-2 text-xs text-fg-muted">{summary.deadlines.length - 12} more in Schedule & calendar.</p> : null}
        </Panel>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Panel title="Quality issues">
          <dl className="grid grid-cols-2 gap-3 text-sm">
            {([["Critical", summary.bySeverity.critical ?? 0], ["Major", summary.bySeverity.major ?? 0], ["Minor", summary.bySeverity.minor ?? 0], ["In correction", summary.correction]] as const).map(([label, value]) => (
              <div key={label} className="rounded-xl border border-line p-3"><dt className="text-xs font-bold uppercase tracking-wide text-fg-muted">{label}</dt><dd className="mt-1 text-xl font-extrabold text-fg tabular-nums">{value}</dd></div>
            ))}
          </dl>
          <p className="mt-3 text-xs text-fg-muted">Engineers inspect, verify and close NCRs. Foremen correct the work. Follow them in Quality & QA.</p>
        </Panel>
        <Panel title="Who runs this project">
          <dl className="divide-y divide-line text-sm">
            {(["primary", "backup"] as const).map((slot) => {
              const row = pm.managers.find((item) => item.designation === slot)
              return <div key={slot} className="flex justify-between gap-3 py-2"><dt className="text-fg-muted">{slotLabels[slot]}</dt><dd className="text-right font-semibold text-fg">{row ? row.full_name : "Not assigned"}</dd></div>
            })}
            <div className="flex justify-between gap-3 py-2"><dt className="text-fg-muted">Engineer in charge</dt><dd className="text-right font-semibold text-fg">{lead("engineer")}</dd></div>
            <div className="flex justify-between gap-3 py-2"><dt className="text-fg-muted">Foreman in charge</dt><dd className="text-right font-semibold text-fg">{lead("foreman")}</dd></div>
            <div className="flex justify-between gap-3 py-2"><dt className="text-fg-muted">Team</dt><dd className="text-right font-semibold text-fg">{counts.engineer} Engineers • {counts.foreman} Foremen • {counts.client} Clients</dd></div>
          </dl>
          <button type="button" className="mt-3 min-h-6 text-sm font-bold text-brand-text hover:underline" onClick={() => onNavigate("team")}>Team & work access →</button>
        </Panel>
        <Panel title="Recent activity">
          {activity.loading ? <SkeletonList rows={3} /> : activity.error ? <p role="alert" className="text-sm text-danger-fg">{activity.error}</p> : activity.entries.length === 0 ? <p className="text-sm text-fg-muted">No activity recorded yet.</p> : (
            <ul className="divide-y divide-line text-sm">
              {activity.entries.map((entry) => (
                <li key={entry.id} className="py-2">
                  <p className="font-semibold text-fg">{activityLabel(entry.action)}{entry.subject ? <span className="font-normal text-fg-muted"> • {entry.subject}</span> : null}</p>
                  <p className="text-xs text-fg-muted">{entry.actor_name}{entry.actor_role ? ` (${roleLabel[entry.actor_role]})` : ""} • {formatDate(entry.created_at)} {formatTime(entry.created_at)}</p>
                </li>
              ))}
            </ul>
          )}
          <button type="button" className="mt-3 min-h-6 text-sm font-bold text-brand-text hover:underline" onClick={() => onNavigate("audit")}>Project audit log →</button>
        </Panel>
      </div>
    </div>
  )
}
