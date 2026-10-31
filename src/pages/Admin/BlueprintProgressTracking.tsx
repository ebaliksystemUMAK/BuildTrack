import { useMemo } from "react"
import AdminProjectSelect, { useAdminProject } from "../../components/AdminProjectSelect"
import SCurveChart from "../../components/SCurveChart"
import { EmptyState, Meter, StatCard } from "../../components/ui/PageParts"
import { SkeletonCardGrid } from "../../components/ui/Skeleton"
import { byZone, scheduleElapsed, summarize } from "../../lib/progress"
import { disciplineLabels } from "../../lib/projects"
import { useProjectWork } from "../../lib/projectWork"
import { StackedBar, StatusLegend } from "../Engineer/EngineerProgress"
import { PageIntro, Panel } from "./AdminShell"
import type { AdminPageProps } from "./types"

// Verified progress for a project, per sheet, against the schedule. Only work the engineer has approved counts.
export default function BlueprintProgressTracking(_: AdminPageProps) {
  const { projects, project, projectId, choose, loading: projectsLoading } = useAdminProject()
  const work = useProjectWork(projectId)
  const totals = useMemo(() => summarize(work.pins, work.today), [work.pins, work.today])
  const zones = useMemo(() => byZone(work.blueprints, work.pins, work.today), [work.blueprints, work.pins, work.today])
  const elapsed = project ? scheduleElapsed(project.start_date, project.end_date, work.today) : null
  const loading = projectsLoading || work.loading

  return (
    <div className="admin-page">
      <PageIntro eyebrow="Progress" title="Progress tracking" description="Verified work per sheet and zone, against the planned schedule." />
      <div className="mb-4"><AdminProjectSelect projects={projects} value={projectId} onChange={choose} /></div>
      {loading ? (
        <SkeletonCardGrid count={3} label="Loading progress" />
      ) : work.error ? (
        <p role="alert" className="rounded-lg bg-danger-soft p-4 text-sm text-danger-fg">{work.error} <button type="button" className="underline" onClick={() => void work.reload()}>Retry</button></p>
      ) : totals.total === 0 ? (
        <EmptyState title="No work pins yet">Pins placed on the sheets appear here as soon as they exist. Notes do not count as work.</EmptyState>
      ) : (
        <>
          <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Verified" value={`${totals.percentVerified}%`} tone="green" note={`${totals.approvedTasks} of ${totals.totalTasks} tasks approved`} />
            <StatCard label="Time used" value={elapsed === null ? "n/a" : `${elapsed}%`} tone="sky" note={elapsed === null ? "Set the project dates" : "of the planned duration"} />
            <StatCard label="Waiting for the engineer" value={totals.for_review} tone="amber" />
            <StatCard label="Late or problem" value={totals.overdue + totals.issue} tone={totals.overdue + totals.issue ? "red" : "green"} note={`${totals.overdue} overdue, ${totals.issue} issue${totals.issue === 1 ? "" : "s"}`} />
          </div>
          <Panel title="Whole project">
            <Meter value={totals.percentVerified} tone="green" label="Approved task progress" />
            <p className="mb-1 mt-3 text-xs font-bold text-fg-muted">Pin statuses</p>
            <StackedBar totals={totals} />
            <div className="mt-3"><StatusLegend /></div>
            {elapsed !== null ? (
              <div className="mt-4">
                <div className="mb-1 flex justify-between text-xs text-fg-muted"><span>Verified {totals.percentVerified}%</span><span>Time used {elapsed}%</span></div>
                <Meter value={totals.percentVerified} tone="green" label="Verified share" />
              </div>
            ) : null}
          </Panel>
          <Panel title="Planned vs verified (S-curve)">
            <SCurveChart pins={work.pins} start={project?.start_date ?? null} end={project?.end_date ?? null} today={work.today} />
          </Panel>
          <Panel title="By sheet">
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead><tr><th>Sheet</th><th>Level</th><th>Discipline</th><th>Pins</th><th>Verified</th><th>To review</th><th>Issues</th><th>Overdue</th><th className="w-48">Progress</th></tr></thead>
                <tbody>
                  {zones.map((zone) => (
                    <tr key={zone.blueprintId}>
                      <td className="is-strong">{zone.title}</td>
                      <td className="is-muted">{zone.level ?? "—"}</td>
                      <td className="is-muted">{zone.discipline ? disciplineLabels[zone.discipline as keyof typeof disciplineLabels] : "—"}</td>
                      <td>{zone.totals.total}</td>
                      <td>{zone.totals.verified}</td>
                      <td>{zone.totals.for_review}</td>
                      <td>{zone.totals.issue}</td>
                      <td>{zone.totals.overdue}</td>
                      <td><Meter value={zone.totals.percentVerified} tone="green" label={`${zone.title} approved tasks`} /><span className="mt-1 block text-xs text-fg-muted">{zone.totals.percentVerified}% · {zone.totals.approvedTasks}/{zone.totals.totalTasks} tasks approved</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </>
      )}
    </div>
  )
}
