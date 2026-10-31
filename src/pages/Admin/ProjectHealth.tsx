import { useEffect, useMemo, useState } from "react"
import { Meter } from "../../components/ui/PageParts"
import { SkeletonList } from "../../components/ui/Skeleton"
import type { Pin } from "../../lib/blueprints"
import { manilaToday, projectHealth, scheduleElapsed, summarize, type Health } from "../../lib/progress"
import { openProject, type Project } from "../../lib/projects"
import { supabase } from "../../lib/supabase"
import { fetchAll } from "../../lib/paging"
import { fetchProgressPins } from "../../lib/progressData"
import { useLiveReload } from "../../lib/realtime"
import { Panel, StatusBadge } from "./AdminShell"

type LitePin = Pick<Pin, "id" | "project_id" | "status" | "severity" | "category" | "due_date" | "tasks">
type LiteDefect = { project_id: string; status: string; severity: string; due_date: string | null }
type LiteInspection = { project_id: string; status: string; reinspection_of: string | null }

const healthText: Record<Health, { label: string; tone: "success" | "warning" | "danger" | "neutral" }> = {
  good: { label: "On track", tone: "success" },
  watch: { label: "Watch", tone: "warning" },
  risk: { label: "At risk", tone: "danger" },
  empty: { label: "No pins yet", tone: "neutral" },
}
const meterTone = { good: "green", watch: "amber", risk: "red", empty: "gray" } as const

// Per-project health from real pins: verified share against the schedule, late work, open issues.
export default function ProjectHealth({ projects }: { projects: Project[] }) {
  const [pins, setPins] = useState<LitePin[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [defects, setDefects] = useState<LiteDefect[]>([])
  const [inspections, setInspections] = useState<LiteInspection[]>([])
  const today = manilaToday()
  const [tick, setTick] = useState(0)
  useLiveReload([{ table: "pins" }, { table: "pin_checklist_items" }, { table: "qa_defects" }, { table: "qa_inspections" }], () => setTick((value) => value + 1), 800)

  useEffect(() => {
    let active = true
    Promise.all([
      fetchAll<LiteDefect>((from, to) => supabase.from("qa_defects").select("project_id,status,severity,due_date").order("id").range(from, to)),
      fetchAll<LiteInspection>((from, to) => supabase.from("qa_inspections").select("project_id,status,reinspection_of").order("id").range(from, to)),
      fetchProgressPins<LitePin>((from, to) => supabase.from("pins").select("id,project_id,status,severity,category,due_date").order("id").range(from, to), null),
    ]).then(([ncr, ir, pinRows]) => {
      if (!active) return
      setDefects(ncr.data)
      setInspections(ir.data)
      setFailed(pinRows.error)
      setPins(pinRows.data)
    })
    return () => {
      active = false
    }
  }, [tick])

  const rows = useMemo(
    () =>
      projects
        .filter((project) => project.status === "active" || project.status === "planning" || project.status === "on_hold")
        .map((project) => {
          const own = (pins ?? []).filter((pin) => pin.project_id === project.id)
          const totals = summarize(own, today)
          const elapsed = scheduleElapsed(project.start_date, project.end_date, today)
          const critical = own.filter((pin) => pin.status === "issue" && pin.severity === "critical").length
          const ncr = defects.filter((row) => row.project_id === project.id && row.status !== "closed")
          const first = inspections.filter((row) => row.project_id === project.id && !row.reinspection_of && ["passed", "conditional", "failed"].includes(row.status))
          const qa = {
            open: ncr.length,
            overdue: ncr.filter((row) => row.due_date && row.due_date.slice(0, 10) < today).length,
            critical: ncr.filter((row) => row.severity === "critical").length,
            passRate: first.length ? Math.round((1000 * first.filter((row) => row.status === "passed").length) / first.length) / 10 : null,
          }
          return { project, totals, elapsed, qa, health: projectHealth(totals, elapsed, critical + qa.critical) }
        })
        .sort((a, b) => ["risk", "watch", "good", "empty"].indexOf(a.health) - ["risk", "watch", "good", "empty"].indexOf(b.health)),
    [projects, pins, defects, inspections, today],
  )

  return (
    <Panel title="Project health" action={<span className="admin-panel-note">Verified work against the schedule, plus open quality defects</span>}>
      {pins === null ? (
        <SkeletonList rows={3} label="Loading project health" />
      ) : failed ? (
        <p className="text-sm text-fg-muted">Project health needs access to project pins. Ask a Super Admin to grant the Projects permission.</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-fg-muted">No open projects to measure.</p>
      ) : (
        <ul className="divide-y divide-line">
          {rows.map(({ project, totals, elapsed, qa, health }) => (
            <li key={project.id} className="py-3">
              <button type="button" onClick={() => openProject("admin", project.id)} className="block w-full text-left">
                <span className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm"><strong className="text-fg">{project.code}</strong> <span className="text-fg-muted">{project.name}</span></span>
                  <StatusBadge tone={healthText[health].tone}>{healthText[health].label}</StatusBadge>
                </span>
                <span className="mt-2 block"><Meter value={totals.percentVerified} tone={meterTone[health]} label={`${project.name} verified`} /></span>
                <span className="mt-1.5 flex flex-wrap gap-x-4 text-xs text-fg-muted">
                  <span>{totals.percentVerified}% verified{elapsed !== null ? ` • ${elapsed}% of time used` : ""}</span>
                  <span>{totals.for_review} to review</span>
                  {totals.issue ? <span className="font-semibold text-danger-fg">{totals.issue} issue{totals.issue === 1 ? "" : "s"}</span> : null}
                  {totals.overdue ? <span className="font-semibold text-danger-fg">{totals.overdue} overdue</span> : null}
                  {qa.passRate !== null ? <span>{qa.passRate}% inspections passed first time</span> : null}
                  {qa.open ? <span className={qa.critical || qa.overdue ? "font-semibold text-danger-fg" : ""}>{qa.open} open NCR{qa.open === 1 ? "" : "s"}{qa.critical ? `, ${qa.critical} critical` : ""}{qa.overdue ? `, ${qa.overdue} overdue` : ""}</span> : null}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}
