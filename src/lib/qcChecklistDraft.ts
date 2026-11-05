import { createBrowserDraftStore } from "./browserDraft.ts"
import { trades, type DraftItem, type Trade } from "./qaModel.ts"

export type QcDraftScope = { userId: string; projectId: string | null; templateId: string | null }
export type QcDraftValues = { name: string; trade: Trade; description: string; cited: string[]; items: DraftItem[] }
export const qcDraftKey = (scope: QcDraftScope) => "buildtrack.qc-checklist-draft.v1:" + [scope.userId, scope.projectId ?? "library", scope.templateId ?? "new"].map(encodeURIComponent).join(":")

const valuesFrom = (value: unknown): QcDraftValues | null => {
  if (!value || typeof value !== "object") return null
  const v = value as QcDraftValues
  if (typeof v.name !== "string" || v.name.length > 120 || !trades.includes(v.trade) || typeof v.description !== "string" || v.description.length > 500 || !Array.isArray(v.cited) || v.cited.length > 10 || v.cited.some(code => typeof code !== "string" || code.length > 40) || !Array.isArray(v.items) || !v.items.length || v.items.length > 60) return null
  const items: DraftItem[] = []
  for (const item of v.items) {
    if (!item || !["minor", "major", "critical"].includes(item.severity) || !["check", "measure"].includes(item.kind) || typeof item.requires_photo !== "boolean" || typeof item.hold_point !== "boolean") return null
    for (const [key, max] of Object.entries({ text: 300, unit: 20, min_value: Infinity, max_value: Infinity, reference: 200, acceptance_criteria: 1000, evidence_requirement: 1000 })) {
      const raw = item[key as keyof DraftItem]
      const text = key === "acceptance_criteria" || key === "evidence_requirement" ? raw ?? "" : raw
      if (typeof text !== "string" || text.length > max) return null
    }
    // Company/project checklists retain their Photo required option; task-specific criteria have a different rule.
    items.push({ text: item.text, severity: item.severity, kind: item.kind, unit: item.unit, min_value: item.min_value, max_value: item.max_value, reference: item.reference, acceptance_criteria: item.acceptance_criteria ?? "", evidence_requirement: item.evidence_requirement ?? "", requires_photo: item.requires_photo, hold_point: item.hold_point })
  }
  return { name: v.name, trade: v.trade, description: v.description, cited: [...v.cited], items }
}
const drafts = createBrowserDraftStore(qcDraftKey, valuesFrom)
export const loadQcDraft = drafts.load
export const storeQcDraft = drafts.store
export const clearQcDraft = drafts.clear
