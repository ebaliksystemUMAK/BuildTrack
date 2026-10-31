// The work item (a checklist item of a work pin, e.g. LAUNDRY -> FLOOR) is the QA record. Pure rules, tested in `pnpm test:lib`.
// Keep linkedDefects identical to SQL item_defect_ids and the completion gate identical to review_checklist_item.
//   Submitted = the Foreman declares the item finished and sends its photos for QA (no Ready tick).
//   Passed    = its inspection criteria passed.
//   Completed = the Engineer manually completes the item after passed QA and closed linked NCRs.
//   The work pin completes when every item is completed and every NCR / inspection on the pin is clear.
import { submittedChecklistItems, type ChecklistRef } from "./qaChecklistModel.ts"

export type ItemStage = "preparing" | "ready" | "requested" | "inspecting" | "passed" | "correction" | "completed"
export type Owner = "Foreman" | "Engineer"
export type StageAction = "add_evidence" | "submit" | "approve_criteria" | "start_correction" | "submit_correction" | "inspect" | "review_ncrs" | "open_ncr" | "complete"

export const stageLabels: Record<ItemStage, string> = {
  preparing: "Preparing", ready: "Ready", requested: "QA requested", inspecting: "Being inspected", passed: "Passed", correction: "Needs correction", completed: "Completed",
}
export const stageTone: Record<ItemStage, string> = {
  preparing: "bg-surface-muted text-fg-muted",
  ready: "bg-sky-100 text-sky-900 dark:bg-sky-900/40 dark:text-sky-100",
  requested: "bg-fuchsia-100 text-fuchsia-900 dark:bg-fuchsia-900/40 dark:text-fuchsia-100",
  inspecting: "bg-fuchsia-100 text-fuchsia-900 dark:bg-fuchsia-900/40 dark:text-fuchsia-100",
  passed: "bg-amber-100 text-amber-950 dark:bg-amber-900/40 dark:text-amber-100",
  correction: "bg-red-100 text-red-900 dark:bg-red-900/40 dark:text-red-100",
  completed: "bg-green-100 text-green-900 dark:bg-green-900/40 dark:text-green-100",
}

export type ItemRef = { id: string; text: string; done: boolean; review_status?: string | null; review_inspection_id?: string | null }
export type SubmissionRef = { id: string; inspection_id: string; pin_id: string; item_ids: string[] | null; checklist_snapshot: ChecklistRef[]; submitted_at: string }
export type InspectionRef = { id: string; number: number; status: string; reinspection_of?: string | null; pin_id?: string | null }
export type DefectRef = { id: string; number: number; status: string; inspection_id: string | null; pin_id: string | null }
export type DraftRef = { id: string; item_id: string; remarks: string; submitted_inspection_id: string | null }

export const irRef = (number: number) => `IR-${String(number).padStart(4, "0")}`
export const ncrRef = (number: number) => `NCR-${String(number).padStart(4, "0")}`
const refs = (rows: Array<{ number: number }>) => rows.map((row) => ncrRef(row.number)).join(", ")
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`

// Every request (original and resubmissions) that contained this item, oldest first, by the item's permanent id.
export function itemAttempts<S extends SubmissionRef, I extends InspectionRef>(itemId: string, submissions: S[], inspections: I[]) {
  const byId = new Map(inspections.map((row) => [row.id, row]))
  return submissions
    .filter((row) => submittedChecklistItems(row, itemId).length > 0)
    .map((submission) => ({ submission, inspection: byId.get(submission.inspection_id) ?? null }))
    .sort((a, b) => (a.inspection?.number ?? 0) - (b.inspection?.number ?? 0) || a.submission.submitted_at.localeCompare(b.submission.submitted_at))
    .map((row, index) => ({ ...row, label: index === 0 ? "Original request" : `Resubmission ${index}` }))
}

// NCRs raised by an inspection whose request contained this item (same rule as SQL item_defect_ids).
export function linkedDefects<D extends DefectRef>(itemId: string, pinId: string, submissions: SubmissionRef[], defects: D[]): D[] {
  const inspectionIds = new Set(submissions.filter((row) => row.pin_id === pinId && submittedChecklistItems(row, itemId).length > 0).map((row) => row.inspection_id))
  return defects.filter((row) => row.pin_id === pinId && row.inspection_id !== null && inspectionIds.has(row.inspection_id)).sort((a, b) => a.number - b.number)
}

// NCRs on the work that belong to no work-item request (site findings, stage / hold-point inspections): they block completion only.
export function pinLevelDefects<D extends DefectRef>(pinId: string, submissions: SubmissionRef[], defects: D[]): D[] {
  const workInspections = new Set(submissions.filter((row) => row.pin_id === pinId).map((row) => row.inspection_id))
  return defects.filter((row) => row.pin_id === pinId && (row.inspection_id === null || !workInspections.has(row.inspection_id))).sort((a, b) => a.number - b.number)
}

export type StageInput = {
  item: ItemRef
  attempts: number
  current: { number: number; status: string } | null
  ncrs: Array<{ number: number; status: string }>
  draft: { remarks: string; photos: number | null } | null
  eligiblePhotos: number | null
  criteriaApproved: boolean
  pinCompleted: boolean
}
export type StageView = { stage: ItemStage; label: string; owner: Owner | null; status: string; blocker: string; next: string; action: StageAction | null }

const view = (stage: ItemStage, owner: Owner | null, status: string, next: string, action: StageAction | null, blocker = ""): StageView => ({ stage, label: stageLabels[stage], owner, status, blocker, next, action })
const outcome: Record<string, string> = { failed: "failed", conditional: "was conditional", cancelled: "was cancelled", passed: "passed" }

// Current stage, who must act, what blocks them and the one next action.
export function workItemStage(input: StageInput): StageView {
  const { item, current, ncrs } = input
  const name = item.text.trim() || "this item"
  const open = ncrs.filter((row) => row.status !== "closed")
  const toVerify = open.filter((row) => row.status === "for_verification")
  const toFix = open.filter((row) => row.status === "open" || row.status === "in_progress")

  if (item.review_status === "verified") {
    return view("completed", null, `${name} completed by the Engineer.${input.pinCompleted ? " Work completed." : ""}`,
      input.pinCompleted ? "No action needed." : "No action on this item. The work pin completes when every item is completed and all NCRs and inspections are clear.", null)
  }
  if (current && current.status === "requested") return view("requested", "Engineer", `QA requested (${irRef(current.number)}).${toVerify.length ? ` ${refs(toVerify)} correction waits to be reviewed with it.` : ""}`, "Engineer starts the inspection.", "inspect")
  if (current && current.status === "in_progress") return view("inspecting", "Engineer", `Being inspected (${irRef(current.number)}).`, "Engineer records the inspection results and signs off.", "inspect")

  if (item.review_status === "for_review" && current?.status === "passed") {
    if (!open.length) return view("passed", "Engineer", ncrs.length ? "Inspection passed. NCRs closed." : "Inspection passed.", `Engineer completes ${name}.`, "complete")
    const status = `Inspection passed. ${plural(open.length, "NCR")} still ${open.length === 1 ? "needs" : "need"} closure.`
    if (toVerify.length) return view("passed", "Engineer", status, `Engineer reviews the correction and closes ${refs(toVerify)}.`, "review_ncrs", toFix.length ? `${refs(toFix)} has no corrective action yet.` : "")
    return view("passed", "Foreman", status, `Foreman submits corrective action for ${refs(toFix)}.`, "open_ncr")
  }

  const returned = item.review_status === "returned" || item.review_status === "for_review" || input.attempts > 0
  if (returned) {
    const head = current ? `Inspection ${outcome[current.status] ?? current.status} (${irRef(current.number)}).` : "Returned for correction."
    const status = `${head}${toFix.length ? ` ${plural(toFix.length, "NCR")} to correct.` : ""}${toVerify.length ? ` ${refs(toVerify)} awaits the Engineer's decision.` : ""}`
    if (!input.draft) return view("correction", "Foreman", status, `Foreman starts the correction for ${name}: describe the fix and add new photos.`, "start_correction")
    const minimum = toFix.length ? 10 : 5
    const missing = [
      input.draft.remarks.trim().length < minimum ? `correction remarks (at least ${minimum} characters)` : "",
      input.draft.photos === 0 ? "a new eligible photo" : "",
    ].filter(Boolean)
    return view("correction", "Foreman", status, "Foreman submits the correction package.", "submit_correction", missing.length ? `Still needed: ${missing.join(" and ")}.` : "")
  }

  if (!input.criteriaApproved) return view("preparing", "Engineer", "QC Checklist needed.", `Engineer adds the QC checklist to ${name}.`, "approve_criteria")
  if (input.eligiblePhotos === 0) return view("preparing", "Foreman", "Evidence needed.", `Foreman adds photos of ${name}, then submits for QA Review.`, "add_evidence", "No eligible photo: photos with a wrong phone clock or older than 3 days do not count.")
  return view("preparing", "Foreman", "Not submitted.", `Foreman submits ${name} for QA Review.`, "submit")
}

export const headline = (stage: StageView) => `${stage.status} Next action: ${stage.next}`

// Manual completion gate shown to the Engineer (same order as SQL review_checklist_item).
export function completionProblem(input: { loading: boolean; error: string; open: boolean; inspectionStatus?: string; openItemNcrs: number }): string {
  if (input.error) return "QA information is unavailable. Refresh before completing the task."
  if (input.loading) return "Checking inspection results…"
  if (input.open) return "Finish the pending QA inspection first."
  if (input.inspectionStatus !== "passed") return "This item's QA inspection must pass before completion."
  if (input.openItemNcrs) return `Close the ${plural(input.openItemNcrs, "open NCR")} linked to this task first.`
  return ""
}

// Inspection and NCR events of one work item, newest first: one connected history instead of a timeline per record.
export type HistoryEntry = { key: string; at: string; actor: string | null; ref: string; text: string }
export function connectedHistory(
  inspectionEvents: Array<{ id: number; inspection_id: string; actor_id: string | null; note: string; created_at: string }>,
  defectEvents: Array<{ id: number; defect_id: string; actor_id: string | null; kind: string; note: string | null; to_status: string | null; created_at: string }>,
  inspectionRef: (id: string) => string,
  defectRef: (id: string) => string,
): HistoryEntry[] {
  const defectText: Record<string, string> = { raised: "NCR raised", closed: "NCR closed", rejected: "Correction sent back", edited: "NCR edited", status: "Status changed" }
  return [
    ...inspectionEvents.map((row) => ({ key: `ir-${row.id}`, at: row.created_at, actor: row.actor_id, ref: inspectionRef(row.inspection_id), text: row.note })),
    ...defectEvents.map((row) => ({ key: `ncr-${row.id}`, at: row.created_at, actor: row.actor_id, ref: defectRef(row.defect_id),
      text: [row.kind === "status" && row.to_status ? `Now ${row.to_status.replace(/_/g, " ")}` : defectText[row.kind] ?? row.kind, row.note].filter(Boolean).join(": ") })),
  ].sort((a, b) => b.at.localeCompare(a.at) || b.key.localeCompare(a.key))
}

export type WorkItemTab = "inspection" | "corrections" | "evidence" | "history"

export function readWorkItemTab(search: string, itemId: string): WorkItemTab | null {
  const params = new URLSearchParams(search)
  const tab = params.get("tasktab")
  return params.get("item") === itemId && (tab === "inspection" || tab === "corrections" || tab === "evidence" || tab === "history") ? tab : null
}

export function workItemPath(role: "engineer" | "foreman", projectId: string, itemId: string, page?: string, tab?: WorkItemTab) {
  const target = page ?? (role === "engineer" ? "verification" : "quality-control")
  return `/${role}/${target}?project=${encodeURIComponent(projectId)}&item=${encodeURIComponent(itemId)}${tab ? `&tasktab=${tab}` : ""}`
}
