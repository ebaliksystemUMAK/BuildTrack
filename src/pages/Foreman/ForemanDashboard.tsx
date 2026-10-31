import { useEffect, useMemo, useRef, useState } from "react"
import { EmptyState, PageHead, StatCard, buttonPrimary, buttonSecondary } from "../../components/ui/PageParts"
import { SkeletonList } from "../../components/ui/Skeleton"
import { categoryLabels, severityChip, severityLabels, statusChip, statusLabels, type Pin, type PinStatus } from "../../lib/blueprints"
import { useAuth } from "../../lib/auth"
import { useOfflineQueue } from "../../lib/offlineQueue"
import { manilaToday } from "../../lib/progress"
import { getSelectedProjectId, useProjects } from "../../lib/projects"
import { useForemanDashboard } from "../../lib/foremanDashboard"
import { foremanTasks, reportStatusLabel, taskCounts, taskFilters, type ForemanTask, type TaskFilter } from "../../lib/foremanDashboardModel"
import { defectStatusLabels, defectTone, dueState, dueText, inspectionStatusLabels, inspectionTone, qaSeverityLabels, severityTone } from "../../lib/qaModel"
import ReportModal from "./ReportModal"
import type { ForemanPageProps } from "./types"

const edge: Record<ForemanTask["filter"], string> = {
  sent_back: "border-l-orange-500", overdue: "border-l-red-600", issue: "border-l-red-600", ncr: "border-l-amber-500",
  doing: "border-l-amber-400", to_start: "border-l-sky-500", waiting: "border-l-fuchsia-600",
}
const kindLabel: Record<ForemanTask["kind"], string> = { pin: "Work", ncr: "NCR", inspection: "Inspection" }
const shortDate = (day: string) => new Date(`${day.slice(0, 10)}T00:00:00`).toLocaleDateString("en-PH", { day: "numeric", month: "short" })
const go = (path: string) => { window.history.pushState({}, "", path); window.dispatchEvent(new PopStateEvent("popstate")) }

// The foreman's day in the selected project: their assigned work, report and evidence, and every task in one filtered list.
export default function ForemanDashboard({ onNavigate }: ForemanPageProps) {
  const { profile } = useAuth()
  const { projects } = useProjects()
  const { items: queued } = useOfflineQueue(profile?.id ?? null)
  const [reporting, setReporting] = useState<Pin | null>(null)
  const [today, setToday] = useState(manilaToday)
  const [filter, setFilter] = useState<TaskFilter>("all")
  const projectId = getSelectedProjectId()
  const { pins, sentBack, loading, failed, load, reports, checklistLeft, photosToday, inspections, defects } = useForemanDashboard(profile?.id ?? null, projectId, today)
  const unavailable = loading || failed
  useEffect(() => {
    const timer = window.setInterval(() => setToday(manilaToday()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  // ?pin=<id> (from a QR code or a shared link) opens that pin's report dialog once.
  const wanted = useRef(new URLSearchParams(window.location.search).get("pin"))
  useEffect(() => {
    if (!wanted.current || loading) return
    const target = pins.find((item) => item.id === wanted.current)
    wanted.current = null
    if (target) setReporting(target)
    const url = new URL(window.location.href)
    url.searchParams.delete("pin")
    window.history.replaceState({}, "", url)
  }, [loading, pins])

  // Reports saved offline show at once with their new status, marked "waiting to send".
  const waitingStatus = useMemo(() => {
    const map = new Map<string, PinStatus>()
    for (const item of queued) if (item.kind === "pin_progress" && item.status === "pending") map.set(item.payload.pinId as string, item.payload.status as PinStatus)
    return map
  }, [queued])
  const mine = useMemo(() => pins.filter((pin) => pin.assigned_to === profile?.id).map((pin) => (waitingStatus.has(pin.id) ? { ...pin, status: waitingStatus.get(pin.id) as PinStatus } : pin)), [pins, profile?.id, waitingStatus])
  const projectName = useMemo(() => new Map(projects.map((project) => [project.id, project.name])), [projects])
  const tasks = useMemo(() => foremanTasks({ pins: mine, sentBack, ncrs: defects, inspections, today }), [mine, sentBack, defects, inspections, today])
  const counts = taskCounts(tasks)
  const shown = filter === "all" ? tasks : tasks.filter((task) => task.filter === filter)
  const toDo = mine.filter((pin) => pin.status === "not_started" || pin.status === "in_progress").length
  const doneCount = mine.filter((pin) => pin.status === "verified").length
  const first = (profile?.full_name || "Foreman").split(" ")[0]
  const show = (next: TaskFilter) => { setFilter(next); document.getElementById("my-tasks")?.scrollIntoView({ behavior: "smooth", block: "start" }) }
  const openReport = () => (projectId ? go(`/foreman/daily-report?project=${encodeURIComponent(projectId)}`) : onNavigate("daily-report"))

  const row = (task: ForemanTask) => {
    const pin = task.kind === "pin" ? mine.find((item) => item.id === task.id) : undefined
    const ncr = task.kind === "ncr" ? defects.find((item) => item.id === task.id) : undefined
    const ir = task.kind === "inspection" ? inspections.find((item) => item.id === task.id) : undefined
    const status = pin ? <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${statusChip[pin.status]}`}>{statusLabels[pin.status]}</span>
      : ncr ? <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${defectTone[ncr.status]}`}>{defectStatusLabels[ncr.status]}</span>
      : ir ? <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${inspectionTone[ir.status]}`}>{inspectionStatusLabels[ir.status]}</span> : null
    const late = pin ? task.filter === "overdue" || (Boolean(pin.due_date) && (pin.due_date as string) < today) : ncr ? dueState(ncr, today).state === "overdue" : false
    const due = pin ? (pin.due_date ? `${late ? "Overdue" : "Due"} ${shortDate(pin.due_date)}` : "No due date") : ncr ? dueText(ncr, today) : "Requested by you"
    const action = pin ? <button type="button" className={buttonPrimary + " !px-3 !py-1.5 !text-xs"} onClick={() => setReporting(pin)}>{pin.status === "for_review" ? "View" : "Report"}</button>
      : ncr ? <button type="button" className={(ncr.status === "for_verification" ? buttonSecondary : buttonPrimary) + " !px-3 !py-1.5 !text-xs"} onClick={() => go(`/foreman/issues?project=${ncr.project_id}&defect=${ncr.id}`)}>{ncr.status === "for_verification" ? "View" : "Fix it"}</button>
      : ir ? <button type="button" className={buttonSecondary + " !px-3 !py-1.5 !text-xs"} onClick={() => go(`/foreman/quality-control?project=${ir.project_id}&tab=inspections&inspection=${ir.id}`)}>View</button> : null
    return (
      <li key={task.key} className={`grid gap-2 border-l-4 px-4 py-3 md:grid-cols-[minmax(0,1fr)_9.5rem_9rem_6rem] md:items-center ${edge[task.filter]}`}>
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2">
            <span className="rounded bg-surface-muted px-1.5 py-0.5 text-[11px] font-extrabold uppercase text-fg-muted">{kindLabel[task.kind]}</span>
            <span className="min-w-0 break-words text-sm font-extrabold">{task.title}</span>
            {pin ? <span className={`rounded px-1.5 py-0.5 text-[11px] font-extrabold uppercase ${severityChip[pin.severity]}`}>{severityLabels[pin.severity]}</span> : null}
            {ncr ? <span className={`rounded px-1.5 py-0.5 text-[11px] font-extrabold uppercase ${severityTone[ncr.severity]}`}>{qaSeverityLabels[ncr.severity]}</span> : null}
            {pin && waitingStatus.has(pin.id) ? <span className="rounded-full bg-surface-muted px-2 py-0.5 text-[11px] font-semibold text-fg-muted">Waiting to send</span> : null}
          </p>
          <p className="mt-0.5 text-xs text-fg-muted">{projectName.get(task.projectId) ?? "Project"}{pin ? ` • ${categoryLabels[pin.category]}` : ""}</p>
          <p className="mt-0.5 text-xs">{task.hint}</p>
        </div>
        <div>{status}</div>
        <div className={`text-xs font-semibold ${late ? "text-red-700 dark:text-red-300" : "text-fg-muted"}`}>{due}</div>
        <div className="md:text-right">{action}</div>
      </li>
    )
  }

  return (
    <div className="foreman-page">
      <PageHead
        eyebrow="Foreman"
        title={`Good day, ${first}`}
        description="Your work for today on this project. Open a task to report it, add photos and submit the tasks for QA Review."
        actions={<button type="button" className={buttonSecondary} onClick={() => onNavigate("daily-work")}>Site plan</button>}
      />
      {failed ? <p role="alert" className="mb-4 rounded-lg bg-danger-soft px-4 py-2 text-sm text-danger-fg">Could not refresh your work. Any work below is the last loaded snapshot; totals are unavailable. Check your connection and refresh.</p> : null}

      <div className="mb-6 grid auto-rows-fr grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="To do" value={unavailable ? "-" : toDo} tone="sky" note="Not started or in progress" onClick={() => show("all")} />
        <StatCard label="Sent back" value={unavailable ? "-" : counts.sent_back} tone={counts.sent_back ? "amber" : "green"} note="Needs more work" onClick={() => show("sent_back")} />
        <StatCard label="Overdue" value={unavailable ? "-" : counts.overdue} tone={counts.overdue ? "red" : "green"} note="Past the deadline" onClick={() => show("overdue")} />
        <StatCard label="Waiting" value={unavailable ? "-" : counts.waiting} tone="brand" note="For the engineer" onClick={() => show("waiting")} />
        <StatCard label="Completed" value={unavailable ? "-" : doneCount} tone="green" note="Completed work pins" />
        <StatCard label="Today's daily report" value={unavailable ? "-" : reportStatusLabel(reports, Boolean(projectId))} tone="sky" note="Open today's report · Manila date" onClick={openReport} />
        <StatCard label="Tasks left" value={unavailable ? "-" : checklistLeft} tone="amber" note="Not ready yet on your work" />
        <StatCard label="Photos today" value={unavailable ? "-" : photosToday} tone="green" note="Your uploads · Manila date" />
      </div>

      <section id="my-tasks" aria-labelledby="my-tasks-title" className="scroll-mt-20">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 id="my-tasks-title" className="border-l-4 border-accent pl-3 text-base font-extrabold text-brand-strong">My tasks <span className="text-sm font-semibold text-fg-muted">({counts.all})</span></h2>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter tasks">
            {taskFilters.map(([key, label]) => (
              <button key={key} type="button" aria-pressed={filter === key} onClick={() => setFilter(key)} className={`rounded-full border px-3 py-1 text-xs font-bold transition ${filter === key ? "border-brand bg-brand text-white" : "border-line bg-surface text-fg hover:bg-surface-muted"}`}>
                {label}{counts[key] ? <span className={`ml-1.5 ${filter === key ? "text-white/85" : "text-fg-muted"}`}>{counts[key]}</span> : null}
              </button>
            ))}
          </div>
        </div>
        {loading ? <SkeletonList rows={4} label="Loading your tasks" />
          : failed && !tasks.length ? null
          : !tasks.length ? <EmptyState title="No tasks for you yet">When an engineer assigns work to you, it shows here and you get a notification.</EmptyState>
          : !shown.length ? <EmptyState title="Nothing here" action={<button type="button" className={buttonSecondary} onClick={() => setFilter("all")}>Show all tasks</button>}>No task matches this filter.</EmptyState>
          : <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">{shown.map(row)}</ul>}
      </section>

      <p className="mt-8 text-xs text-fg-muted">Worker biometric registration is handled by Admin only. <button type="button" className="inline-flex min-h-6 items-center font-bold text-brand-text underline" onClick={() => onNavigate("attendance")}>Open workforce management</button></p>

      {reporting ? <ReportModal pin={reporting} onClose={() => setReporting(null)} onSaved={async () => { setReporting(null); await load() }} /> : null}
    </div>
  )
}
