import { isOverdue } from "./progress.ts"

// Manila has a fixed UTC+08 offset; use a half-open interval for exact daily photo counts.
export function manilaDayRange(day: string) {
  const start = new Date(`${day}T00:00:00+08:00`)
  return { start: start.toISOString(), end: new Date(start.getTime() + 86_400_000).toISOString() }
}
export function reportStatusLabel(statuses: string[], projectSelected: boolean) {
  if (!statuses.length) return "None"
  if (projectSelected) return statuses[0] === "submitted" ? "Submitted" : "Draft"
  return `${statuses.filter((status) => status === "draft").length} draft / ${statuses.filter((status) => status === "submitted").length} submitted`
}

// ---- Foreman task list: one detailed list with short filters (each task belongs to exactly one filter) ----
export type TaskFilter = "all" | "sent_back" | "overdue" | "issue" | "ncr" | "doing" | "to_start" | "waiting"
export const taskFilters: Array<[TaskFilter, string]> = [["all", "All"], ["sent_back", "Sent back"], ["overdue", "Overdue"], ["issue", "Issues"], ["ncr", "NCRs"], ["doing", "Doing"], ["to_start", "To start"], ["waiting", "Waiting"]]
export type TaskPin = { id: string; project_id: string; title: string; status: string; category: string; due_date: string | null }
export type TaskNcr = { id: string; project_id: string; number: number; title: string; status: string; due_date: string | null }
export type TaskInspection = { id: string; project_id: string; number: number; title: string; status: string }
export type ForemanTask = { key: string; filter: Exclude<TaskFilter, "all">; kind: "pin" | "ncr" | "inspection"; id: string; projectId: string; title: string; hint: string; due: string | null; weight: number }

const hints: Record<Exclude<TaskFilter, "all">, string> = {
  sent_back: "Sent back by the engineer: open it, read the reason and correct it.",
  overdue: "Past its due date.",
  issue: "A problem was reported on this work: fix it and report.",
  ncr: "Correct it and send it for verification.",
  doing: "In progress: finish the tasks and submit them for QA Review.",
  to_start: "Not started yet.",
  waiting: "Waiting for the engineer.",
}

export function foremanTasks(input: { pins: TaskPin[]; sentBack: Set<string>; ncrs: TaskNcr[]; inspections: TaskInspection[]; today: string }): ForemanTask[] {
  const tasks: ForemanTask[] = []
  const add = (task: Omit<ForemanTask, "hint">) => tasks.push({ ...task, hint: hints[task.filter] })
  for (const pin of input.pins) {
    if (pin.category === "note" || pin.status === "verified") continue
    const filter = pin.status === "for_review" ? "waiting" : pin.status === "issue" ? "issue"
      : pin.status === "in_progress" && input.sentBack.has(pin.id) ? "sent_back"
      : isOverdue(pin as Parameters<typeof isOverdue>[0], input.today) ? "overdue" : pin.status === "in_progress" ? "doing" : "to_start"
    const weight = { sent_back: 6, issue: 5, overdue: 4, doing: 2, to_start: 1, waiting: 0 }[filter]
    add({ key: `pin-${pin.id}`, filter, kind: "pin", id: pin.id, projectId: pin.project_id, title: pin.title, due: pin.due_date, weight })
  }
  for (const ncr of input.ncrs) {
    if (ncr.status === "closed") continue
    const late = Boolean(ncr.due_date) && (ncr.due_date as string).slice(0, 10) < input.today
    add({ key: `ncr-${ncr.id}`, filter: ncr.status === "for_verification" ? "waiting" : "ncr", kind: "ncr", id: ncr.id, projectId: ncr.project_id,
      title: `NCR-${String(ncr.number).padStart(4, "0")} ${ncr.title}`, due: ncr.due_date, weight: ncr.status === "for_verification" ? 0 : late ? 6 : 3 })
  }
  for (const row of input.inspections) {
    if (row.status !== "requested" && row.status !== "in_progress") continue
    add({ key: `ir-${row.id}`, filter: "waiting", kind: "inspection", id: row.id, projectId: row.project_id, title: `IR-${String(row.number).padStart(4, "0")} ${row.title}`, due: null, weight: 0 })
  }
  return tasks.sort((a, b) => b.weight - a.weight || (a.due ?? "9999").localeCompare(b.due ?? "9999") || a.title.localeCompare(b.title))
}

export function taskCounts(tasks: ForemanTask[]): Record<TaskFilter, number> {
  const counts = Object.fromEntries(taskFilters.map(([key]) => [key, 0])) as Record<TaskFilter, number>
  counts.all = tasks.length
  for (const task of tasks) counts[task.filter] += 1
  return counts
}
