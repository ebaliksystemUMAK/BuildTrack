import { useEffect, useMemo, useState } from "react"
import { EmptyState, Meter, PageHead, StatCard, buttonSecondary } from "../../components/ui/PageParts"
import { SkeletonCardGrid } from "../../components/ui/Skeleton"
import { severityChip, severityLabels, type Pin } from "../../lib/blueprints"
import { useAuth } from "../../lib/auth"
import { followLink } from "../../lib/notifications"
import { daysBetween, isOverdue, manilaToday, summarize } from "../../lib/progress"
import { getSelectedProjectId, phaseLabels, statusColor, statusLabels, useProject } from "../../lib/projects"
import { useQaLite, type QaLiteDefect, type QaLiteInspection } from "../../lib/qaLite"
import { refNumber, severityTone } from "../../lib/qaModel"
import { supabase } from "../../lib/supabase"
import { fetchAll } from "../../lib/paging"
import { byProject, useLiveReload } from "../../lib/realtime"
import type { EngineerPageKey, EngineerPageProps } from "./types"

type LitePin = Pick<Pin, "id" | "project_id" | "title" | "status" | "severity" | "category" | "due_date" | "updated_at" | "assigned_to">

// One project's dashboard (the Engineer works one project at a time): what needs a decision now and how the project is going.
export default function EngineerDashboard({ onNavigate }: EngineerPageProps) {
  const { profile } = useAuth()
  const projectId = getSelectedProjectId()
  const { project } = useProject(projectId)
  const [pins, setPins] = useState<LitePin[]>([])
  const [pinsLoading, setPinsLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const today = manilaToday()
  const qaAll = useQaLite("dashboard")
  const [tick, setTick] = useState(0)
  useLiveReload([...byProject("pins", projectId), ...byProject("pin_events", projectId)], () => setTick((value) => value + 1))

  useEffect(() => {
    let active = true
    if (!projectId) return
    fetchAll<LitePin>((from, to) => supabase.from("pins").select("id,project_id,title,status,severity,category,due_date,updated_at,assigned_to").eq("project_id", projectId).order("id").range(from, to)).then(({ data, error }) => {
      if (!active) return
      setFailed(error)
      setPins(data)
      setPinsLoading(false)
    })
    return () => {
      active = false
    }
  }, [tick, projectId])

  const qa = useMemo(() => ({ inspections: qaAll.inspections.filter((row) => row.project_id === projectId), defects: qaAll.defects.filter((row) => row.project_id === projectId) }), [qaAll.inspections, qaAll.defects, projectId])
  const totals = useMemo(() => summarize(pins, today), [pins, today])
  const loading = pinsLoading
  const qaToDo = qa.inspections.filter((row) => row.status === "requested").length + qa.defects.filter((row) => row.status === "for_verification").length
  const go = (path: string) => (projectId ? followLink(`/engineer/${path.replace("?", `?project=${projectId}&`)}${path.includes("?") ? "" : `?project=${projectId}`}`, projectId) : undefined)

  const attention = useMemo(() => {
    const items: Array<{ key: string; pin: LitePin | null; defect?: QaLiteDefect; inspection?: QaLiteInspection; reason: string; tone: string; path: string; weight: number }> = []
    for (const pin of pins) {
      if (pin.category === "note") continue
      if (pin.status === "for_review") items.push({ key: `r${pin.id}`, pin, reason: `Waiting for review ${Math.max(0, daysBetween(pin.updated_at.slice(0, 10), today))} d`, tone: "bg-fuchsia-100 text-fuchsia-900 dark:bg-fuchsia-900/40 dark:text-fuchsia-200", path: "verification", weight: 2 })
      else if (pin.status === "issue") items.push({ key: `i${pin.id}`, pin, reason: `${severityLabels[pin.severity]} issue`, tone: severityChip[pin.severity], path: "report-issue", weight: pin.severity === "critical" ? 4 : pin.severity === "high" ? 3 : 1 })
      else if (isOverdue(pin, today)) items.push({ key: `o${pin.id}`, pin, reason: `${-daysBetween(today, pin.due_date as string)} d overdue`, tone: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200", path: "progress", weight: 1 })
    }
    for (const defect of qa.defects) {
      const late = Boolean(defect.due_date) && (defect.due_date as string).slice(0, 10) < today
      if (defect.status === "for_verification") items.push({ key: `v${defect.id}`, pin: null, defect, reason: "Verify the repair", tone: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200", path: `qa?tab=defects&defect=${defect.id}`, weight: 3 })
      else if (late) items.push({ key: `d${defect.id}`, pin: null, defect, reason: `${refNumber("ncr", defect.number)} overdue`, tone: severityTone[defect.severity], path: `qa?tab=defects&defect=${defect.id}`, weight: defect.severity === "critical" ? 5 : 2 })
    }
    for (const row of qa.inspections) if (row.status === "requested") items.push({ key: `q${row.id}`, pin: null, inspection: row, reason: "Inspection requested", tone: "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200", path: `qa?tab=inspections&inspection=${row.id}`, weight: 3 })
    return items.sort((a, b) => b.weight - a.weight).slice(0, 8)
  }, [pins, qa.defects, qa.inspections, today])

  const first = (profile?.full_name || "Engineer").split(" ")[0]
  const links: Array<[EngineerPageKey, string]> = [["annotation", "Plans"], ["qa", `QA register${qaToDo ? ` (${qaToDo})` : ""}`], ["progress", "Progress"], ["assignments", "Assign"]]

  return (
    <div className="engineer-page">
      <PageHead
        eyebrow={project ? project.code : "Engineer"}
        title={`Good day, ${first}`}
        description={project ? `What needs your decision on ${project.name}, and how it is going.` : "What needs your decision on this project, and how it is going."}
      />

      {failed ? <p role="alert" className="mb-4 rounded-lg bg-danger-soft px-4 py-2 text-sm text-danger-fg">Could not load this project's pins. Check your connection and refresh.</p> : null}

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <StatCard label="Completed" value={loading ? "-" : `${totals.percentVerified}%`} tone="green" note={`${totals.verified} of ${totals.total} work pins`} />
        <StatCard label="To review" value={loading ? "-" : totals.for_review} tone="amber" onClick={() => onNavigate("verification")} note="In the review inbox" />
        <StatCard label="Open issues" value={loading ? "-" : totals.issue} tone={totals.issue ? "red" : "green"} onClick={() => onNavigate("report-issue")} />
        <StatCard label="Overdue" value={loading ? "-" : totals.overdue} tone={totals.overdue ? "red" : "green"} note="Past their deadline" />
        <StatCard label="QA to action" value={loading || qaAll.loading ? "-" : qaToDo} tone={qaToDo ? "amber" : "green"} onClick={() => onNavigate("qa")} note="Inspections and repairs to verify" />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
        <section>
          <h2 className="mb-2 border-l-4 border-accent pl-3 text-base font-extrabold text-brand-strong">Needs your attention</h2>
          {loading ? (
            <SkeletonCardGrid count={2} label="Loading" />
          ) : attention.length === 0 ? (
            <EmptyState title="Nothing needs you right now">Reviews, issues and late work on this project show up here.</EmptyState>
          ) : (
            <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
              {attention.map(({ key, pin, defect, inspection, reason, tone, path }) => {
                const title = pin ? pin.title : defect ? `${refNumber("ncr", defect.number)} ${defect.title}` : `${refNumber("ir", inspection!.number)} ${inspection!.title}`
                return (
                  <li key={key}>
                    <button type="button" onClick={() => go(path)} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-surface-muted">
                      <span className="min-w-0 truncate text-sm font-bold">{title}</span>
                      <span className={`flex-none rounded px-2 py-0.5 text-xs font-bold ${tone}`}>{reason}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        <section>
          <h2 className="mb-2 border-l-4 border-accent pl-3 text-base font-extrabold text-brand-strong">This project</h2>
          {!project ? <SkeletonCardGrid count={1} label="Loading" /> : (
            <div className="rounded-xl border border-line bg-surface p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs font-bold uppercase tracking-wider text-brand-text">{project.code}</p>
                  <h3 className="truncate text-sm font-extrabold">{project.name}</h3>
                  <p className="text-xs text-fg-muted">{phaseLabels[project.phase]}{project.location ? ` • ${project.location}` : ""}</p>
                </div>
                <span className={`flex-none rounded-full px-2 py-0.5 text-xs font-semibold ${statusColor[project.status]}`}>{statusLabels[project.status]}</span>
              </div>
              <div className="mt-3 flex items-center gap-3">
                <div className="flex-1"><Meter value={totals.percentVerified} tone="green" label={`${project.name} completed`} /></div>
                <span className="text-sm font-extrabold">{totals.percentVerified}%</span>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {links.map(([page, label]) => <button key={page} type="button" className={buttonSecondary + " !px-3 !py-1 !text-xs"} onClick={() => onNavigate(page)}>{label}</button>)}
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
