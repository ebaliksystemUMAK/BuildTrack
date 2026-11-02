// The rules of the offline queue, kept apart from the browser so they can be tested: what counts as "no connection",
// whether a failed item should be tried again, and in which order the saved work is sent. No React, no IndexedDB.

export type QueueKind = "pin_progress" | "daily_report" | "pin_photo"
export type QueueStatus = "pending" | "failed"

export type QueueItem = {
  id: string
  userId: string
  kind: QueueKind
  label: string
  payload: Record<string, unknown>
  createdAt: number
  attempts: number
  status: QueueStatus
  error?: string
  nextAt?: number // do not try again before this time (ms), set after a lost connection
}

// Only a missing connection is worth retrying. A refusal from the server (permission, validation, "already submitted") will not
// get better by waiting, so that item is marked as failed and shown to the person.
export function isNetworkProblem(error: unknown): boolean {
  const message = typeof error === "string" ? error : error && typeof error === "object" && "message" in error ? String((error as { message: unknown }).message) : ""
  const code = error && typeof error === "object" && "code" in error ? String((error as { code: unknown }).code ?? "") : ""
  if (code && /^(P|PGRST|BT|2|4|5)/i.test(code) && !/^PGRST000/.test(code)) return false // a database / API answer, not a dropped connection
  return /failed to fetch|networkerror|network error|load failed|network request failed|fetch failed|timeout|timed out|offline|err_internet|err_network/i.test(message)
}

export const MAX_ATTEMPTS = 8

// An administrator paused saving (maintenance, or a feature switched off for this person's role): the database refuses the write with code BT503.
// That is not a failure of the saved work: it is kept exactly as it is and sent after the pause, without using up its attempts.
export const SITE_PAUSE_CODE = "BT503"
export const PAUSE_RETRY_SECONDS = 300
export function isSitePause(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && String((error as { code: unknown }).code ?? "") === SITE_PAUSE_CODE)
}

export type Verdict = "sent" | "retry" | "paused" | "failed"

// What to do with an item after one attempt. `error` is null on success.
export function verdictFor(error: unknown, attempts: number): Verdict {
  if (error === null || error === undefined) return "sent"
  if (isSitePause(error)) return "paused"
  if (isNetworkProblem(error) && attempts < MAX_ATTEMPTS) return "retry"
  return "failed"
}

// Oldest first, so a report is sent before the photo that belongs to it and edits keep their order.
export const sendOrder = (items: QueueItem[]): QueueItem[] => [...items].filter((item) => item.status === "pending").sort((a, b) => a.createdAt - b.createdAt)

// Wait before the next automatic attempt (seconds): 15, 30, 60 ... capped at 10 minutes.
export const backoffSeconds = (attempts: number) => Math.min(600, 15 * 2 ** Math.max(0, attempts - 1))

export const kindLabel: Record<QueueKind, string> = { pin_progress: "Progress report", daily_report: "Daily report", pin_photo: "Photo" }

export function summarizeQueue(items: QueueItem[]) {
  const pending = items.filter((item) => item.status === "pending").length
  const failed = items.filter((item) => item.status === "failed").length
  return { pending, failed, total: items.length }
}
