import { useEffect, useMemo, useState } from "react"
import SCurveChart from "../../components/SCurveChart"
import ProjectContextBar from "../../components/ProjectContextBar"
import { EmptyState, Meter, PageHead, StatCard, buttonSecondary } from "../../components/ui/PageParts"
import { SkeletonCardGrid } from "../../components/ui/Skeleton"
import { statusDot, statusLabels, type Pin, type PinStatus } from "../../lib/blueprints"
import { followLink } from "../../lib/notifications"
import { STATUSES, byZone, daysBetween, downloadCsv, isDueSoon, isOverdue, scheduleElapsed, summarize, toCsv, type Totals } from "../../lib/progress"
import { disciplineLabels, getSelectedProjectId } from "../../lib/projects"
import { useProjectWork } from "../../lib/projectWork"
import type { EngineerPageProps } from "./types"
import { zonePlanPath } from "../../lib/issueMarkup"
import DateRangeFilter from "../../components/ui/DateRangeFilter"
import { isFiltered, rangeProblem, rangeSearch, rangeText, readRange, schedulePresets, type DateRange } from "../../lib/dateRangeModel"
import { approvedInPeriod, periodProgress, type PeriodTotals } from "../../lib/periodProgress"

export function StackedBar({ totals }: { totals: Totals }) {
  if (!totals.total) return <div className="h-2.5 rounded-full bg-surface-muted" aria-label="No pins yet" />
  return (
    <div className="flex h-2.5 overflow-hidden rounded-full bg-surface-muted" role="img" aria-label={STATUSES.map((status) => `${totals[status]} ${statusLabels[status].toLowerCase()}`).join(", ")}>
      {STATUSES.filter((status) => totals[status] > 0).map((status) => (
        <span key={status} title={`${statusLabels[status]}: ${totals[status]}`} style={{ width: `${(totals[status] / totals.total) * 100}%`, background: statusDot[status] }} />
      ))}
    </div>
  )
}

export function StatusLegend() {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-muted" aria-label="Legend">
      {STATUSES.map((status) => (
        <li key={status} className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: statusDot[status] }} />{statusLabels[status]}</li>
      ))}
    </ul>
  )
}

const tasksOf = (pins: Pin[]) => pins.flatMap((pin) => pin.tasks ?? [])
const signed = (value: number) => `${value > 0 ? "+" : ""}${value} pts`
const day = (value: string) => rangeText({ from: value, to: value })
const LIST_LIMIT = 25

// Where the project stands: share verified overall, per sheet (floor / zone) and per discipline, against the schedule.
// With a period chosen it shows the progress made in it: tasks approved on those dates (every work pin counts, with or without a
// due date), progress at the end of the period and the change; cards, zones, disciplines and CSV follow.
export default function EngineerProgress({ onNavigate }: EngineerPageProps) {
  const projectId = getSelectedProjectId()
  const work = useProjectWork(projectId)
  const [range, setRange] = useState<DateRange>(() => readRange(window.location.search))
  useEffect(() => {
    const sync = () => setRange(readRange(window.location.search))
    sync()
    window.addEventListener("popstate", sync)
    return () => window.removeEventListener("popstate", sync)
  }, [projectId])
  const filtered = isFiltered(range)
  const dateProblem = rangeProblem(range)
  const changeRange = (next: DateRange) => {
    setRange(next)
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${rangeSearch(window.location.search, next)}${window.location.hash}`)
  }
  const workPins = useMemo(() => work.pins.filter((pin) => pin.category !== "note"), [work.pins])
  const pins = useMemo(() => (dateProblem ? [] : workPins), [workPins, dateProblem])
  const totals = useMemo(() => summarize(pins, work.today), [pins, work.today])
  const allZones = useMemo(() => byZone(work.blueprints, pins, work.today), [work.blueprints, pins, work.today])
  const zones = filtered ? allZones.filter((zone) => zone.totals.total > 0) : allZones // a period lists the sheets that have work
  const elapsed = work.project ? scheduleElapsed(work.project.start_date, work.project.end_date, work.today) : null
  const gap = elapsed === null || filtered ? null : totals.percentVerified - elapsed

  // Progress made in the period: every work pin, by task approval date.
  const period = useMemo(() => (filtered && !dateProblem ? periodProgress(tasksOf(workPins), range, work.today) : null), [filtered, dateProblem, workPins, range, work.today])
  const zonePeriod = useMemo(() => {
    if (!period) return null
    return new Map(work.blueprints.map((sheet) => [sheet.id, periodProgress(tasksOf(workPins.filter((pin) => pin.blueprint_id === sheet.id)), range, work.today)]))
  }, [period, work.blueprints, workPins, range, work.today])
  const approvedRows = useMemo(() => {
    if (!period) return []
    const rows = workPins.flatMap((pin) => (pin.tasks ?? []).map((task) => ({ ...task, pinTitle: pin.title, sheetId: pin.blueprint_id })))
    return approvedInPeriod(rows, range, work.today)
  }, [period, workPins, range, work.today])

  const disciplines = useMemo(() => {
    const groups = new Map<string, Pin[]>()
    for (const pin of pins) {
      const sheet = work.blueprints.find((bp) => bp.id === pin.blueprint_id)
      const key = pin.discipline ?? sheet?.discipline ?? "none"
      groups.set(key, [...(groups.get(key) ?? []), pin])
    }
    return [...groups.entries()].map(([key, pins]) => ({
      key, label: key === "none" ? "Not set" : disciplineLabels[key as keyof typeof disciplineLabels], totals: summarize(pins, work.today),
      period: period ? periodProgress(tasksOf(pins), range, work.today) : null,
    })).filter((row) => row.totals.total > 0)
  }, [pins, work.blueprints, work.today, period, range])

  const deadlines = useMemo(
    () =>
      pins
        .filter((pin) => isOverdue(pin, work.today) || isDueSoon(pin, work.today, 7))
        .sort((a, b) => (a.due_date ?? "").localeCompare(b.due_date ?? ""))
        .slice(0, 8),
    [pins, work.today],
  )

  const exportCsv = () => {
    if (dateProblem || work.loading || work.error) return
    const code = work.project?.code ?? "project"
    const level = (zone: (typeof zones)[number]) => [zone.title, zone.level ?? "", zone.discipline ? disciplineLabels[zone.discipline as keyof typeof disciplineLabels] : ""]
    if (period && zonePeriod) {
      const header = ["Sheet", "Level", "Discipline", "Tasks approved in period", "Approved by end of period", "Tasks at end of period", "% at end of period", "% before period", "Change (pts)"]
      const rows = zones.map((zone) => { const row = zonePeriod.get(zone.blueprintId) as PeriodTotals; return [...level(zone), row.approvedInPeriod, row.approvedAtEnd, row.tasksAtEnd, row.percentAtEnd, row.percentAtStart, row.change] })
      return downloadCsv(`progress-${code}-${work.today}-made-${range.from || "start"}-to-${period.end}.csv`, toCsv(header, rows))
    }
    const header = ["Sheet", "Level", "Discipline", "Work pins", "Completed pins", "For review", "In progress", "Not started", "Issues", "Overdue", "Approved tasks", "Total tasks", "% approved tasks"]
    const rows = zones.map((zone) => [...level(zone), zone.totals.total, zone.totals.verified, zone.totals.for_review, zone.totals.in_progress, zone.totals.not_started, zone.totals.issue, zone.totals.overdue, zone.totals.approvedTasks, zone.totals.totalTasks, zone.totals.percentVerified])
    downloadCsv(`progress-${code}-${work.today}.csv`, toCsv(header, rows))
  }

  return (
    <div className="engineer-page">
      <ProjectContextBar listPath="/engineer/projects" listLabel="My projects" />
      <PageHead
        eyebrow="Progress"
        title="Progress by zone"
        description="Progress is approved tasks divided by all tasks. A pin completes after all its tasks are approved and its NCRs and inspections are clear."
        actions={<><button type="button" className={buttonSecondary} onClick={()=>void work.reload()} disabled={work.loading}>Refresh database data</button><button type="button" className={buttonSecondary} onClick={exportCsv} disabled={work.loading || !zones.length || Boolean(work.error || dateProblem)}>Export CSV</button></>}
      />

      {projectId && !work.error ? (
        <div className="mb-4 space-y-2 rounded-2xl border border-line bg-surface p-3 shadow-sm">
          <DateRangeFilter label="Period" range={range} presets={schedulePresets} today={work.today} onChange={changeRange} />
          {!dateProblem ? <p className="text-xs text-fg-muted">{period
            ? <><span className="font-bold text-fg">Progress made {rangeText(range)}</span> · {period.approvedInPeriod} task{period.approvedInPeriod === 1 ? "" : "s"} approved on these dates. Every work pin counts, with or without a due date; percentages show progress at the end of the period (by {day(period.end)}).</>
            : "Showing the whole project as it stands now. Choose a period to see the progress made in it (tasks approved on those dates)."}</p> : null}
        </div>
      ) : null}

      {!projectId ? null : work.loading ? (
        <SkeletonCardGrid count={3} />
      ) : work.error ? (
        <p role="alert" className="rounded-lg bg-danger-soft p-4 text-sm text-danger-fg">{work.error} <button type="button" className="underline" onClick={()=>void work.reload()}>Retry</button></p>
      ) : dateProblem ? (
        <p role="alert" className="rounded-lg bg-danger-soft p-4 text-sm text-danger-fg">{dateProblem}</p>
      ) : workPins.length === 0 ? (
        <EmptyState title="No work pins yet">Add pins on the plan to track work here. Notes do not count as work.</EmptyState>
      ) : (
        <>
          {period ? (
            <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard label="Approved in period" value={period.approvedInPeriod} tone="green" note={`task${period.approvedInPeriod === 1 ? "" : "s"} approved ${rangeText(range)}`} />
              <StatCard label="Progress at end of period" value={`${period.percentAtEnd}%`} tone="green" note={`${period.approvedAtEnd} of ${period.tasksAtEnd} tasks approved by ${day(period.end)}`} />
              <StatCard label="Change in period" value={signed(period.change)} tone={period.change > 0 ? "green" : "sky"} note={`from ${period.percentAtStart}% to ${period.percentAtEnd}%`} />
              <StatCard label="Awaiting review" value={totals.for_review} tone="amber" onClick={() => onNavigate("verification")} note="Now, in the review queue" />
            </div>
          ) : (
            <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard label="Verified" value={`${totals.percentVerified}%`} tone="green" note={`${totals.approvedTasks} of ${totals.totalTasks} tasks approved`} />
              <StatCard label="Schedule" value={elapsed === null ? "n/a" : `${elapsed}%`} tone="sky" note={elapsed === null ? "Set start and end dates on the project" : "of the project time has passed"} />
              <StatCard label="Awaiting review" value={totals.for_review} tone="amber" onClick={() => onNavigate("verification")} note="Open the queue" />
              <StatCard label="Late or problem" value={totals.overdue + totals.issue} tone={totals.overdue + totals.issue ? "red" : "green"} note={`${totals.overdue} overdue, ${totals.issue} issue${totals.issue === 1 ? "" : "s"}`} onClick={() => onNavigate("report-issue")} />
            </div>
          )}

          {period ? (
            <section className="mb-6 rounded-2xl border border-line bg-surface p-5 shadow-sm">
              <h2 className="text-base font-extrabold">Progress made {rangeText(range)}</h2>
              <p className="mt-1 text-sm text-fg-muted">From {period.percentAtStart}% before the period to {period.percentAtEnd}% by {day(period.end)} ({signed(period.change)}): {period.approvedInPeriod} task{period.approvedInPeriod === 1 ? "" : "s"} approved.</p>
              <div className="mt-3"><Meter value={period.percentAtEnd} tone="green" label="Approved task progress at the end of the period" /></div>
              <h3 className="mb-2 mt-5 text-sm font-extrabold">Tasks approved {rangeText(range)}</h3>
              {approvedRows.length === 0 ? (
                <p className="rounded-xl border border-dashed border-line p-4 text-center text-sm text-fg-muted">No task was approved on these dates.</p>
              ) : (
                <>
                  <ul className="divide-y divide-line rounded-xl border border-line">
                    {approvedRows.slice(0, LIST_LIMIT).map(({ task, day: approvedDay }) => (
                      <li key={task.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                        <span className="min-w-0"><span className="block truncate font-semibold">{task.pinTitle} · {task.text}</span><span className="text-xs text-fg-muted">{work.sheetOf(task.sheetId)}</span></span>
                        <span className="flex-none rounded bg-green-100 px-2 py-0.5 text-xs font-bold text-green-800 dark:bg-green-900/40 dark:text-green-200">{day(approvedDay)}</span>
                      </li>
                    ))}
                  </ul>
                  {approvedRows.length > LIST_LIMIT ? <p className="mt-2 text-xs text-fg-muted">Showing the newest {LIST_LIMIT} of {approvedRows.length} approved tasks.</p> : null}
                </>
              )}
            </section>
          ) : (
            <section className="mb-6 rounded-2xl border border-line bg-surface p-5 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-base font-extrabold">Whole project</h2>
                {gap !== null ? (
                  <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${gap >= 0 ? "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200" : gap > -15 ? "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200" : "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200"}`}>
                    {gap >= 0 ? `On or ahead of schedule (+${gap} pts)` : `${Math.abs(gap)} pts behind schedule`}
                  </span>
                ) : null}
              </div>
              <div className="mt-3"><Meter value={totals.percentVerified} tone="green" label="Approved task progress" /></div>
              <p className="mt-3 mb-1 text-xs font-bold text-fg-muted">Pin statuses</p>
              <StackedBar totals={totals} />
              <div className="mt-3"><StatusLegend /></div>
              {elapsed !== null && !filtered ? (
                <div className="mt-4">
                  <div className="mb-1 flex justify-between text-xs text-fg-muted"><span>Verified {totals.percentVerified}%</span><span>Time passed {elapsed}%</span></div>
                  <div className="relative"><Meter value={totals.percentVerified} tone="green" label="Verified share" /><span className="absolute -top-1 h-4 w-0.5 bg-fg" style={{ left: `${elapsed}%` }} title={`Schedule: ${elapsed}%`} /></div>
                </div>
              ) : null}
            </section>
          )}

          <section className="mb-6 rounded-2xl border border-line bg-surface p-5 shadow-sm" aria-labelledby="s-curve-title">
            <h2 id="s-curve-title" className="text-base font-extrabold">Planned vs verified (S-curve)</h2>
            <p className="mb-3 text-xs text-fg-muted">Each task inherits its pin's due date; verified follows the task's Engineer approval date.{period ? " The curve always shows the whole project." : ""}</p>
            <SCurveChart pins={pins} start={work.project?.start_date ?? null} end={work.project?.end_date ?? null} today={work.today} />
          </section>

          <section className="mb-6">
            <h2 className="mb-2 border-l-4 border-accent pl-3 text-base font-extrabold text-brand-strong">Sheets and zones</h2>
            <div className="grid gap-3 md:grid-cols-2">
              {zones.map((zone) => {
                const made = zonePeriod?.get(zone.blueprintId) ?? null
                const percent = made ? made.percentAtEnd : zone.totals.percentVerified
                return (
                  <article key={zone.blueprintId} className="rounded-xl border border-line bg-surface p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h3 className="truncate text-sm font-extrabold">{zone.title}</h3>
                        <p className="text-xs text-fg-muted">{[zone.level ? `Level ${zone.level}` : null, zone.discipline ? disciplineLabels[zone.discipline as keyof typeof disciplineLabels] : null].filter(Boolean).join(" • ") || "No level or discipline set"}</p>
                      </div>
                      <span className="text-2xl font-extrabold leading-none text-fg">{percent}%</span>
                    </div>
                    <div className="mt-3"><Meter value={percent} tone="green" label={`${zone.title} approved task progress`} /></div>
                    {made ? (
                      <p className="mt-1 text-xs text-fg-muted"><span className="font-bold text-fg">{made.approvedInPeriod} task{made.approvedInPeriod === 1 ? "" : "s"} approved in this period</span> ({signed(made.change)}) · {made.approvedAtEnd}/{made.tasksAtEnd} tasks approved by {day(made.end)}</p>
                    ) : (
                      <p className="mt-1 text-xs text-fg-muted">{zone.totals.approvedTasks}/{zone.totals.totalTasks} tasks approved · {zone.totals.verified}/{zone.totals.total} pins completed</p>
                    )}
                    <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-muted">
                      <span>{zone.totals.total} pins</span>
                      {zone.totals.for_review ? <span className="font-bold text-fuchsia-700 dark:text-fuchsia-300">{zone.totals.for_review} to review</span> : null}
                      {zone.totals.issue ? <span className="font-bold text-red-700 dark:text-red-300">{zone.totals.issue} issue{zone.totals.issue === 1 ? "" : "s"}</span> : null}
                      {zone.totals.overdue ? <span className="font-bold text-red-700 dark:text-red-300">{zone.totals.overdue} overdue</span> : null}
                      <button type="button" className="inline-flex min-h-6 items-center font-bold text-brand-text hover:underline" onClick={() => followLink(`/engineer/report-issue?project=${projectId}&sheet=${zone.blueprintId}`, projectId)}>Issue register</button>
                      <button type="button" className="ml-auto inline-flex min-h-6 items-center font-bold text-brand-text hover:underline" onClick={() => followLink(zonePlanPath("engineer",projectId!,zone.blueprintId), projectId)}>Open this sheet</button>
                    </div>
                  </article>
                )
              })}
            </div>
          </section>

          <div className="grid gap-6 lg:grid-cols-2">
            <section>
              <h2 className="mb-2 border-l-4 border-accent pl-3 text-base font-extrabold text-brand-strong">By discipline</h2>
              <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
                {disciplines.map((row) => (
                  <li key={row.key} className="px-4 py-3">
                    <div className="mb-1.5 flex items-center justify-between text-sm"><span className="font-bold">{row.label}</span><span className="text-fg-muted">{row.period ? `${row.period.percentAtEnd}% · ${row.period.approvedInPeriod} approved in period` : `${row.totals.percentVerified}% · ${row.totals.approvedTasks}/${row.totals.totalTasks} tasks`}</span></div>
                    <Meter value={row.period ? row.period.percentAtEnd : row.totals.percentVerified} tone="green" label={`${row.label} approved tasks`} />
                  </li>
                ))}
              </ul>
            </section>
            <section>
              <h2 className="mb-2 border-l-4 border-accent pl-3 text-base font-extrabold text-brand-strong">Deadlines</h2>
              {deadlines.length === 0 ? (
                <p className="rounded-xl border border-dashed border-line bg-surface p-5 text-center text-sm text-fg-muted">Nothing is late or due in the next 7 days.</p>
              ) : (
                <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
                  {deadlines.map((pin) => {
                    const days = daysBetween(work.today, pin.due_date as string)
                    const late = days < 0
                    return (
                      <li key={pin.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                        <span className="min-w-0"><span className="block truncate font-semibold">{pin.title}</span><span className="text-xs text-fg-muted">{work.sheetOf(pin.blueprint_id)} • {work.nameOf(pin.assigned_to)} • {statusLabels[pin.status as PinStatus]}</span></span>
                        <span className={`flex-none rounded px-2 py-0.5 text-xs font-bold ${late ? "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200" : "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200"}`}>{late ? `${-days} d late` : days === 0 ? "today" : `in ${days} d`}</span>
                      </li>
                    )
                  })}
                </ul>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  )
}
