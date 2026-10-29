import type { ChecklistItem, PinPhoto } from "./blueprints"
import type { Inspection } from "./qa"

export type WorkQaSubmission = { id: string; pin_id: string; inspection_id: string; submitted_by: string; submitted_at: string; all_complete: boolean; item_ids: string[] | null; checklist_snapshot: ChecklistItem[]; photos_snapshot: PinPhoto[] }
export type WorkQaAttempt = { id: string; item_id: string; pin_id: string; previous_inspection_id: string; submitted_inspection_id: string | null; remarks: string; created_by: string; created_at: string; updated_at: string }
export type QaEvent = { id: number; inspection_id: string; actor_id: string | null; kind: string; note: string; created_at: string }
export function itemSubmissions(rows: WorkQaSubmission[], itemId: string) {
  return rows.filter(row => row.checklist_snapshot.some(item => item.id === itemId && item.done))
}
export function currentAttemptPhotos(photos: PinPhoto[], itemId: string, previous: boolean, draft?: WorkQaAttempt) {
  return photos.filter(photo => photo.checklist_item_id === itemId && (draft ? photo.qa_attempt_id === draft.id : !previous && !photo.qa_attempt_id))
}
export function qaRecordPath(role: "engineer" | "foreman" | "project_manager", projectId: string, kind: "inspection" | "defect", id: string) {
  if (role === "project_manager") return `/pm/quality?project=${encodeURIComponent(projectId)}&tab=${kind === "defect" ? "defects" : "inspections"}&${kind}=${encodeURIComponent(id)}`
  const page = role === "engineer" ? "qa" : kind === "defect" ? "issues" : "quality-control"
  return `/${role}/${page}?project=${encodeURIComponent(projectId)}&tab=${kind === "defect" ? "defects" : "inspections"}&${kind}=${encodeURIComponent(id)}`
}
export const inspectionOf = (inspections: Inspection[], id: string) => inspections.find(row => row.id === id)
