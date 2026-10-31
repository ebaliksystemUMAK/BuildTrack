import { addDays } from "./progress.ts"
import { manilaDayOf, type DateRange } from "./dateRangeModel.ts"
import { progressPercent, taskApproved, type ProgressTask } from "./taskProgress.ts"

// Progress MADE in a period (Manila days, inclusive) for Progress by zone, read from each task's Engineer approval date, so work
// without a due date counts too. "At end" = tasks approved by the last day of the period (today while the period is still running)
// over the tasks that existed that day; "at start" = the same on the day before the period. Only approvals that still stand carry
// a date: an approval that was later withdrawn no longer counts anywhere. Pure, tested in `pnpm test:lib`.
export type PeriodTotals = {
  end: string
  approvedInPeriod: number
  approvedAtStart: number
  tasksAtStart: number
  approvedAtEnd: number
  tasksAtEnd: number
  percentAtStart: number
  percentAtEnd: number
  change: number // percentage points
}

// The last day that can be measured: the period's end, never after today (and never before the period starts).
export function periodEnd(range: DateRange, today: string): string {
  const end = range.to && range.to < today ? range.to : today
  return range.from && end < range.from ? addDays(range.from, -1) : end
}

// The day an approved task was approved, or null (not approved, or approved before approval dates were recorded).
const approvedOn = (task: ProgressTask) => (taskApproved(task) ? manilaDayOf(task.verified_at) : null)
const inPeriod = (day: string, range: DateRange, end: string) => (!range.from || day >= range.from) && day <= end

export function periodProgress(tasks: ProgressTask[], range: DateRange, today: string): PeriodTotals {
  const end = periodEnd(range, today)
  const before = range.from ? addDays(range.from, -1) : null
  const totals = { approvedInPeriod: 0, approvedAtStart: 0, tasksAtStart: 0, approvedAtEnd: 0, tasksAtEnd: 0 }
  for (const task of tasks) {
    const created = manilaDayOf(task.created_at)
    const day = approvedOn(task)
    if (!created || created <= end) totals.tasksAtEnd++
    if (before && (!created || created <= before)) totals.tasksAtStart++
    if (day) {
      if (day <= end) totals.approvedAtEnd++
      if (before && day <= before) totals.approvedAtStart++
      if (inPeriod(day, range, end)) totals.approvedInPeriod++
    } else if (taskApproved(task) && end === today) totals.approvedAtEnd++ // approved, date unknown: it counts today
  }
  const percentAtEnd = progressPercent(totals.approvedAtEnd, totals.tasksAtEnd)
  const percentAtStart = before ? progressPercent(totals.approvedAtStart, totals.tasksAtStart) : 0
  return { end, ...totals, percentAtStart, percentAtEnd, change: Math.round((percentAtEnd - percentAtStart) * 10) / 10 }
}

// The tasks approved in the period, newest first, with the day they were approved.
export function approvedInPeriod<T extends ProgressTask>(tasks: T[], range: DateRange, today: string): Array<{ task: T; day: string }> {
  const end = periodEnd(range, today)
  return tasks
    .map((task) => ({ task, day: approvedOn(task) }))
    .filter((row): row is { task: T; day: string } => Boolean(row.day) && inPeriod(row.day as string, range, end))
    .sort((a, b) => b.day.localeCompare(a.day) || a.task.text.localeCompare(b.task.text))
}
