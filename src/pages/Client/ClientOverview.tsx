import { useMemo, useState } from "react"
import SCurveChart from "../../components/SCurveChart"
import WeeklyReportModal from "../../components/WeeklyReportModal"
import { EmptyState, Meter, PageHead, StatCard, buttonPrimary, buttonSecondary } from "../../components/ui/PageParts"
import { SkeletonCardGrid } from "../../components/ui/Skeleton"
import { useQaSummary } from "../../lib/qa"
import { byZone, scheduleElapsed, summarize } from "../../lib/progress"
import { getSelectedProjectId } from "../../lib/projects"
import { useProjectWork } from "../../lib/projectWork"
import { reportDateLong, useDailyReports, useQuestions, weatherLabels } from "../../lib/reports"
import type { ClientPageProps } from "./types"

const longDate = (iso: string | null) => (iso ? new Date(iso.length === 10 ? iso + "T00:00:00" : iso).toLocaleDateString("en-PH", { day: "numeric", month: "long", year: "numeric" }) : "Not set")

// Plain-language view of the project: how much the engineer has checked off, whether the schedule holds, what was finished lately.
export default function ClientOverview({ onNavigate }: ClientPageProps) {
  const projectId = getSelectedProjectId()
  const work = useProjectWork(projectId)
  const { reports } = useDailyReports(projectId)
  const { questions } = useQuestions(projectId)
  const [weekly, setWeekly] = useState(false)
  const { summary: quality } = useQaSummary(projectId)
  const totals = useMemo(() => summarize(work.pins, work.today), [work.pins, work.today])
  const areas = useMemo(() => byZone(work.blueprints, work.pins, work.today).filter((zone) => zone.totals.total > 0).sort((a, b) => b.totals.percentVerified - a.totals.percentVerified), [work.blueprints, work.pins, work.today])
  const finished = useMemo(() => work.pins.filter((pin) => pin.status === "verified" && pin.verified_at && pin.category !== "note").sort((a, b) => (b.verified_at ?? "").localeCompare(a.verified_at ?? "")).slice(0, 8), [work.pins])
  const elapsed = work.project ? scheduleElapsed(work.project.start_date, work.project.end_date, work.today) : null
  const gap = elapsed === null ? null : totals.percentVerified - elapsed
  const latestLog = reports.find((report) => report.status === "submitted") ?? null

  const message = gap === null ? "Set dates are needed to compare with the schedule." : gap >= 0 ? "The project is on or ahead of its schedule." : gap > -15 ? "The project is a little behind its schedule. The team is working to catch up." : "The project is behind its schedule. Ask the team for the recovery plan."

  return (
    <div className="client-page">
      {projectId ? (
        <>
          <PageHead
            eyebrow="Client portal"
            title="Project overview"
            description="Only work that the engineer has checked and approved counts as done."
            actions={
              <>
                <button type="button" className={buttonSecondary} onClick={() => setWeekly(true)} disabled={work.loading || Boolean(work.error) || totals.totalTasks === 0}>Weekly summary</button>
                <button type="button" className={buttonSecondary} onClick={() => onNavigate("blueprint")}>View plans</button>
                <button type="button" className={buttonPrimary} onClick={() => onNavigate("communication")}>Ask the team</button>
              </>
            }
          />
          {work.loading ? (
            <SkeletonCardGrid count={3} label="Loading the project" />
          ) : work.error ? (
            <p role="alert" className="rounded-lg bg-danger-soft p-4 text-sm text-danger-fg">{work.error} <button type="button" className="underline" onClick={() => void work.reload()}>Retry</button></p>
          ) : totals.total === 0 ? (
            <EmptyState title="Work has not been mapped yet">When the engineer adds work pins and tasks to the plans, your progress appears here.</EmptyState>
          ) : (
            <>
              <section className="mb-5 rounded-2xl border border-line bg-surface p-6 shadow-sm">
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <p className="text-xs font-extrabold uppercase tracking-wider text-fg-muted">Checked and approved</p>
                    <p className="text-5xl font-extrabold leading-none text-brand-text">{totals.percentVerified}%</p>
                  </div>
                  <p className="max-w-md text-sm text-fg-muted">{totals.approvedTasks} of {totals.totalTasks} tasks are approved by the engineer. {totals.verified} of {totals.total} pins are fully completed.</p>
                </div>
                <div className="mt-4"><Meter value={totals.percentVerified} tone="green" label="Approved work" /></div>
                <p className={`mt-3 text-sm font-semibold ${gap !== null && gap < -15 ? "text-danger-fg" : ""}`}>{message}</p>
              </section>

              <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <StatCard label="Target completion" value={work.project?.end_date ? new Date(work.project.end_date + "T00:00:00").toLocaleDateString("en-PH", { day: "numeric", month: "short" }) : "n/a"} tone="sky" note={work.project?.end_date ? longDate(work.project.end_date) : "Not set yet"} />
                <StatCard label="Time used" value={elapsed === null ? "n/a" : `${elapsed}%`} tone="brand" note="Of the planned duration" />
                <StatCard label="Being worked on" value={totals.in_progress} tone="amber" note="In progress now" />
                <StatCard label="Waiting for approval" value={totals.for_review} tone="amber" note="Done, being checked" />
              </div>

              <section className="mb-5 rounded-2xl border border-line bg-surface p-5 shadow-sm" aria-labelledby="client-curve">
                <h2 id="client-curve" className="text-base font-extrabold">Plan against approved work</h2>
                <p className="mb-3 text-xs text-fg-muted">The dashed line is what the team planned to finish by each date. The solid line is the work the engineer has checked and approved.</p>
                <SCurveChart pins={work.pins} start={work.project?.start_date ?? null} end={work.project?.end_date ?? null} today={work.today} />
              </section>

              {quality && quality.inspections.passed + quality.inspections.conditional + quality.inspections.failed + quality.defects.open + quality.defects.closed > 0 ? (
                <section className="mb-5" aria-label="Quality checks">
                  <h2 className="mb-2 border-l-4 border-accent pl-3 text-base font-extrabold text-brand-strong">Quality checks</h2>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <StatCard label="Checks passed first time" value={quality.inspections.first_pass_rate === null ? "n/a" : `${quality.inspections.first_pass_rate}%`} tone="green" note={`${quality.inspections.passed + quality.inspections.conditional + quality.inspections.failed} inspections by the engineer`} />
                    <StatCard label="Problems being fixed" value={quality.defects.open} tone={quality.defects.critical_open ? "red" : "amber"} note={quality.defects.overdue ? `${quality.defects.overdue} past the agreed deadline` : "All within the agreed deadline"} />
                    <StatCard label="Problems fixed and checked" value={quality.defects.closed} tone="green" note="Closed after the engineer verified the repair" />
                  </div>
                </section>
              ) : null}

              <div className="grid gap-5 lg:grid-cols-2">
                <section>
                  <h2 className="mb-2 border-l-4 border-accent pl-3 text-base font-extrabold text-brand-strong">Progress by area</h2>
                  <ul className="space-y-3 rounded-xl border border-line bg-surface p-4">
                    {areas.map((area) => (
                      <li key={area.blueprintId}>
                        <div className="mb-1 flex items-center justify-between text-sm"><span className="font-semibold">{area.title}{area.level ? ` (level ${area.level})` : ""}</span><span className="text-fg-muted">{area.totals.percentVerified}%</span></div>
                        <Meter value={area.totals.percentVerified} tone="green" label={`${area.title} approved`} />
                        <p className="mt-1 text-xs text-fg-muted">{area.totals.approvedTasks}/{area.totals.totalTasks} tasks approved</p>
                      </li>
                    ))}
                  </ul>
                </section>
                <section>
                  <h2 className="mb-2 border-l-4 border-accent pl-3 text-base font-extrabold text-brand-strong">Recently finished</h2>
                  {finished.length === 0 ? (
                    <p className="rounded-xl border border-dashed border-line bg-surface p-5 text-center text-sm text-fg-muted">Nothing has been approved yet.</p>
                  ) : (
                    <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
                      {finished.map((pin) => (
                        <li key={pin.id} className="flex items-start justify-between gap-3 px-4 py-2.5 text-sm">
                          <span><span className="mr-1.5 text-green-600" aria-hidden="true">✓</span><span className="font-semibold">{pin.title}</span><span className="block pl-5 text-xs text-fg-muted">{work.sheetOf(pin.blueprint_id)}</span></span>
                          <span className="flex-none text-xs text-fg-muted">{pin.verified_at ? new Date(pin.verified_at).toLocaleDateString("en-PH", { day: "numeric", month: "short" }) : ""}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              </div>

              {latestLog ? (
                <section className="mt-5 rounded-xl border border-line bg-surface p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h2 className="text-base font-extrabold">Latest site log • {reportDateLong(latestLog.report_date)}</h2>
                    <button type="button" className="text-sm font-bold text-brand-text hover:underline" onClick={() => onNavigate("site-logs")}>All logs</button>
                  </div>
                  <p className="mt-1 text-xs text-fg-muted">{weatherLabels[latestLog.weather]} • {latestLog.workers_count} workers on site</p>
                  <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-sm">{latestLog.work_done}</p>
                </section>
              ) : null}
            </>
          )}
        </>
      ) : null}
      {weekly && work.project ? (
        <WeeklyReportModal audience="client" project={work.project} pins={work.pins} start={work.project.start_date} end={work.project.end_date} logs={reports} questions={questions} nameOf={work.nameOf} sheetOf={work.sheetOf} onClose={() => setWeekly(false)} />
      ) : null}
    </div>
  )
}
