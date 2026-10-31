// Progress is earned by approved tasks; pin status is the separate final acceptance of the whole pin.
export type ProgressTask = {
  id: string
  pin_id: string
  text: string
  done: boolean
  review_status?: string | null
  verified_at?: string | null
  created_at?: string | null // when the task was added (progress at the end of a past period counts only tasks that existed then)
}

export const taskApproved = (task: Pick<ProgressTask, "done" | "review_status">) => task.done && task.review_status === "verified"
export const progressPercent = (approved: number, total: number) => total ? Math.round((approved / total) * 1000) / 10 : 0

export function taskProgress(tasks: Pick<ProgressTask, "done" | "review_status">[]) {
  const approved = tasks.filter(taskApproved).length
  return { approved, total: tasks.length, percent: progressPercent(approved, tasks.length) }
}

// Each task inherits its pin's planned due date. Never substitute the pin's final approval date for a task's approval.
export function scheduledTasks(pins: { category: string; due_date: string | null; tasks?: ProgressTask[] }[]) {
  return pins.filter(pin => pin.category !== "note").flatMap(pin => (pin.tasks ?? []).map(task => ({ ...task, due_date: pin.due_date })))
}
