import type { DraftItem } from "./qaModel.ts"
import { createBrowserDraftStore, type BrowserDraft, type BrowserDraftResult } from "./browserDraft.ts"

export type TaskDraftScope = { userId: string; projectId: string; pinId: string; itemId: string | null }
export type TaskDraftValues = { name: string; criteria: DraftItem[]; standards: string[]; sourceTemplateId?: string }
export type TaskDraft = BrowserDraft<TaskDraftScope, TaskDraftValues>
export type TaskDraftResult = BrowserDraftResult<TaskDraftScope, TaskDraftValues>

export const taskDraftKey = (scope: TaskDraftScope) => "buildtrack.task-draft.v1:" + [scope.userId, scope.projectId, scope.pinId, scope.itemId ?? "new"].map(encodeURIComponent).join(":")

// Incomplete fields are valid drafts. Only validate the storage shape; server validation still applies on Save.
const valuesFrom = (value: unknown): TaskDraftValues | null => {
  if (!value || typeof value !== "object") return null
  const v = value as TaskDraftValues
  if (typeof v.name !== "string" || v.name.length > 200 || !Array.isArray(v.criteria) || v.criteria.length < 1 || v.criteria.length > 60 || !Array.isArray(v.standards) || v.standards.length > 10 || v.standards.some(s => typeof s !== "string" || s.length > 40)) return null
  if (v.sourceTemplateId !== undefined && (typeof v.sourceTemplateId !== "string" || v.sourceTemplateId.length > 100)) return null
  const criteria: DraftItem[] = []
  for (const row of v.criteria) {
    if (!row || !["minor", "major", "critical"].includes(row.severity) || !["check", "measure"].includes(row.kind) || typeof row.hold_point !== "boolean") return null
    const limits = { text: 500, unit: Infinity, min_value: Infinity, max_value: Infinity, reference: 200, acceptance_criteria: 1000, evidence_requirement: 1000 }
    for (const [key, limit] of Object.entries(limits)) {
      const raw = row[key as keyof DraftItem]
      const text = key === "acceptance_criteria" || key === "evidence_requirement" ? raw ?? "" : raw
      if (typeof text !== "string" || text.length > limit) return null
    }
    criteria.push({ text: row.text, severity: row.severity, kind: row.kind, unit: row.unit, min_value: row.min_value, max_value: row.max_value, reference: row.reference, acceptance_criteria: row.acceptance_criteria ?? "", evidence_requirement: row.evidence_requirement ?? "", requires_photo: false, hold_point: row.hold_point })
  }
  return { name: v.name, criteria, standards: [...v.standards], sourceTemplateId: v.sourceTemplateId ?? "" }
}

const drafts = createBrowserDraftStore(taskDraftKey, valuesFrom)
export const loadTaskDraft = drafts.load
export const storeTaskDraft = drafts.store
export const clearTaskDraft = drafts.clear
