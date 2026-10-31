import { fetchAll, ROW_CAP } from "./paging"
import { supabase } from "./supabase"
import type { ProgressTask } from "./taskProgress"

async function completeRows<T>(page: Parameters<typeof fetchAll<T>>[0]) {
  try {
    const result = await fetchAll<T>(page)
    if (!result.error && result.data.length === ROW_CAP) {
      const more = await page(ROW_CAP, ROW_CAP)
      if (more.error || more.data?.length) return { data: [] as T[], error: true }
    }
    return result
  } catch {
    return { data: [] as T[], error: true }
  }
}

// Page tasks separately from pins: embedded rows can be truncated, hiding tasks from the progress denominator.
export async function fetchProgressPins<T extends { id: string }>(page: Parameters<typeof fetchAll<T>>[0], projectId: string | null) {
  const [pins, tasks] = await Promise.all([
    completeRows<T>(page),
    completeRows<ProgressTask>((from, to) => {
      let query = supabase.from("pin_checklist_items").select("id,pin_id,text,done,review_status,verified_at,created_at")
      if (projectId) query = query.eq("project_id", projectId)
      return query.order("id").range(from, to)
    }),
  ])
  const byPin = new Map<string, ProgressTask[]>()
  for (const task of tasks.data) {
    const list = byPin.get(task.pin_id) ?? []
    list.push(task)
    byPin.set(task.pin_id, list)
  }
  const error = pins.error || tasks.error
  return { data: error ? [] : pins.data.map(pin => ({ ...pin, tasks: byPin.get(pin.id) ?? [] })), error }
}
