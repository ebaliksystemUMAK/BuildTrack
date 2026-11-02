// Pure rules for the Super Admin "Records" screen (no network, no React): the three kinds of record that can be removed, how answers are read and the
// checks before a removal. The database enforces everything again (Super Admin with the authenticator, reason, exact phrase).
import { REASON_LIMITS, cleanReason } from "./recycleBinModel"

export type RecordKind = "daily_report" | "site_issue" | "client_report"
export const RECORD_KINDS: RecordKind[] = ["daily_report", "site_issue", "client_report"]
export const kindLabels: Record<RecordKind, string> = { daily_report: "Daily reports", site_issue: "Site issues", client_report: "Client reports" }
export const kindNames: Record<RecordKind, string> = { daily_report: "daily report", site_issue: "site issue", client_report: "client report" }
export const isRecordKind = (value: unknown): value is RecordKind => typeof value === "string" && (RECORD_KINDS as string[]).includes(value)

export type RemovableRecord = { id: string; label: string; title: string; status: string; created_at: string; project_code: string; project_name: string }
export type RemovedRecord = { kind: RecordKind; id: string; label: string; title: string; project_code: string; project_name: string; removed_at: string; removed_by: string | null; reason: string | null }
export type RecordPreview = { kind: RecordKind; id: string; label: string; title: string; status: string; project_code: string; project_name: string; project_removed: boolean; confirm_phrase: string }

const text = (value: unknown, fallback = "") => (typeof value === "string" ? value : fallback)

export function parseRemovable(raw: unknown): RemovableRecord[] | null {
  if (!Array.isArray(raw)) return null
  const rows: RemovableRecord[] = []
  for (const item of raw) {
    if (!item || typeof item !== "object") continue
    const row = item as Record<string, unknown>
    if (typeof row.id !== "string" || typeof row.label !== "string") continue
    rows.push({ id: row.id, label: row.label, title: text(row.title), status: text(row.status), created_at: text(row.created_at), project_code: text(row.project_code), project_name: text(row.project_name) })
  }
  return rows
}

export function parseRemoved(raw: unknown): RemovedRecord[] | null {
  if (!Array.isArray(raw)) return null
  const rows: RemovedRecord[] = []
  for (const item of raw) {
    if (!item || typeof item !== "object") continue
    const row = item as Record<string, unknown>
    if (!isRecordKind(row.kind) || typeof row.id !== "string" || typeof row.removed_at !== "string") continue
    rows.push({ kind: row.kind, id: row.id, label: text(row.label, row.id.slice(0, 8)), title: text(row.title), project_code: text(row.project_code), project_name: text(row.project_name), removed_at: row.removed_at, removed_by: typeof row.removed_by === "string" ? row.removed_by : null, reason: typeof row.reason === "string" ? row.reason : null })
  }
  return rows
}

export function parseRecordPreview(raw: unknown): RecordPreview | null {
  if (!raw || typeof raw !== "object") return null
  const value = raw as Record<string, unknown>
  if (!isRecordKind(value.kind) || typeof value.id !== "string" || typeof value.label !== "string" || typeof value.confirm_phrase !== "string") return null
  return { kind: value.kind, id: value.id, label: value.label, title: text(value.title), status: text(value.status), project_code: text(value.project_code), project_name: text(value.project_name), project_removed: value.project_removed === true, confirm_phrase: value.confirm_phrase }
}

// The last step before a record is removed. The phrase must match exactly (case and spacing included).
export function recordRemovalProblem(input: { preview: RecordPreview | null; reason: string; typed: string }): string | null {
  const { preview } = input
  if (!preview) return "Check the record first."
  if (preview.project_removed) return "Its project is in the recycle bin. Restore the project first."
  const reason = cleanReason(input.reason)
  if (reason.length < REASON_LIMITS.min || reason.length > REASON_LIMITS.max) return `Give a reason of ${REASON_LIMITS.min} to ${REASON_LIMITS.max} characters.`
  if (input.typed !== preview.confirm_phrase) return `Type ${preview.confirm_phrase} exactly to confirm.`
  return null
}

export const RECORDS_NOT_INSTALLED = "Record removal is not installed on the database yet (migration 20261101200000_record_removal). The owner reviews and runs it first."

export function recordError(error: { message?: string; code?: string } | null | undefined): { message: string; setup: boolean } {
  const message = error?.message ?? ""
  if (error?.code === "PGRST202" || error?.code === "42883" || /could not find the function|does not exist/i.test(message)) return { message: RECORDS_NOT_INSTALLED, setup: true }
  if (/Only a Super Admin|permission denied/i.test(message)) return { message: "Only a Super Admin, signed in with the authenticator app, can remove or restore records.", setup: false }
  if (/fetch|network/i.test(message)) return { message: "Network problem. Check your connection and try again.", setup: false }
  return { message: message || "That did not work. Try again.", setup: false } // the database messages are written to be read
}
