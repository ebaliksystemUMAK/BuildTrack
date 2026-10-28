import { useCallback, useEffect, useRef, useState } from "react"
import { prepareImage } from "./sheetImages"
import { supabase } from "./supabase"
import { stampFields, type PhotoStamp, type StampFlag } from "./photoStamp"
import { markupProblem, type IssueMarkup } from "./issueMarkup"
import { fetchAll } from "./paging"
import { byColumn, byProject, useLiveReload, type LiveSource } from "./realtime"
import type { DefectCategory, DefectStatus, InspectionStatus, ItemResult, QaSeverity, Trade } from "./qaModel"

export * from "./qaModel"

export type TemplateItem = {
  id: string
  template_id: string
  position: number
  text: string
  severity: QaSeverity
  kind: "check" | "measure"
  unit: string | null
  min_value: number | null
  max_value: number | null
  reference: string | null
  acceptance_criteria?: string | null
  evidence_requirement?: string | null
  requires_photo: boolean
  hold_point: boolean
}

export type Template = {
  id: string
  project_id: string | null
  name: string
  trade: Trade
  description: string | null
  standards: string[]
  is_system: boolean
  archived: boolean
  work_item_criteria?: boolean // a work item's own criteria copy, not a project checklist (20261028150000)
  updated_at: string
  qa_template_items: TemplateItem[]
}

export type Inspection = {
  full_checklist_reinspection?: boolean
  target_at?: string
  escalation_owner?: string | null
  id: string
  project_id: string
  number: number
  template_id: string | null
  title: string
  trade: Trade
  pin_id: string | null
  location: string | null
  status: InspectionStatus
  requested_by: string | null
  requested_at: string
  request_note: string | null
  inspector_id: string | null
  started_at: string | null
  completed_at: string | null
  score: number | null
  threshold: number | null
  weights: { critical: number; major: number; minor: number } | null
  summary: string | null
  standards: string[]
  reinspection_of: string | null
}

export type InspectionItem = {
  origin_item_id?: string | null
  id: string
  inspection_id: string
  project_id: string
  position: number
  text: string
  severity: QaSeverity
  kind: "check" | "measure"
  unit: string | null
  min_value: number | null
  max_value: number | null
  reference: string | null
  acceptance_criteria?: string | null
  evidence_requirement?: string | null
  requires_photo: boolean
  hold_point: boolean
  result: ItemResult
  measured_value: number | null
  remarks: string | null
  checked_by: string | null
  checked_at: string | null
}

export type Defect = {
  id: string
  project_id: string
  number: number
  inspection_id: string | null
  inspection_item_id: string | null
  pin_id: string | null
  title: string
  description: string | null
  category: DefectCategory
  severity: QaSeverity
  trade: Trade
  reference: string | null
  status: DefectStatus
  raised_by: string | null
  raised_at: string
  assigned_to: string | null
  due_date: string | null
  root_cause: string | null
  corrective_action: string | null
  preventive_action: string | null
  fixed_at: string | null
  fixed_by: string | null
  closed_at: string | null
  closed_by: string | null
  closing_note: string | null
  correction_attempt_id?: string | null // the correction package (remarks + photos) that answered it
  checklist_item_id?: string | null // raised directly on one checklist item (20261024090000); inspection NCRs link through their request
  checklist_name?: string | null // the item's name when the NCR was raised
}

export type DefectEvent = { id: number; defect_id: string; actor_id: string | null; kind: "raised" | "edited" | "status" | "rejected" | "closed"; from_status: string | null; to_status: string | null; note: string | null; created_at: string }
// `annotations` = markup drawn over the photo (20261021111736); the stored file itself is the untouched original.
export type QaPhoto = { id: string; project_id: string; inspection_id: string | null; item_id: string | null; defect_id: string | null; path: string; caption: string | null; uploaded_by: string | null; created_at: string; taken_at: string | null; stamp_flag: StampFlag | null; distance_m: number | null; annotations?: IssueMarkup[] }

export type QaSummary = {
  staff: boolean
  inspections: { total: number; requested: number; in_progress: number; passed: number; conditional: number; failed: number; first_pass_rate: number | null; average_score: number | null }
  defects: { open: number; critical_open: number; major_open: number; minor_open: number; overdue: number; for_verification: number; closed: number; average_days_to_close: number | null }
  items: { checked: number; failed: number; defects_per_100_items: number | null }
  by_trade: Array<{ trade: Trade; inspections: number; pass_rate: number | null; open_defects: number }>
  recent: Array<{ id: string; number: number; title: string; trade: Trade; status: InspectionStatus; score: number | null; completed_at: string | null; requested_at: string }>
}

// Small loader shared by the hooks: runs the query, keeps loading / error state, exposes reload and reloads on live changes.
function useLoad<T>(enabled: boolean, empty: T, fetcher: () => Promise<{ data: T | null; error: boolean }>, deps: unknown[], live: LiveSource[] = []) {
  const [data, setData] = useState<T>(empty)
  const [loading, setLoading] = useState(enabled)
  const [error, setError] = useState("")
  const sequence = useRef(0)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(fetcher, deps)
  const reload = useCallback(async () => {
    const request = ++sequence.current
    if (!enabled) {
      setData(empty)
      setLoading(false)
      return
    }
    const result = await run()
    if (request !== sequence.current) return
    setError(result.error ? "Could not load this. Check your connection and try again." : "")
    if (result.data !== null) setData(result.data)
    setLoading(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, run])
  useEffect(() => {
    setData(empty)
    setError("")
    setLoading(enabled)
    void reload()
    return () => { sequence.current++ }
  }, [reload, enabled])
  useLiveReload(enabled ? live : [], reload)
  return { data, setData, loading, error, reload }
}

export function useTemplates(projectId: string | null, includeLibrary = true) {
  const { data, ...rest } = useLoad<Template[]>(
    Boolean(projectId) || includeLibrary,
    [],
    async () => {
      let query = supabase.from("qa_templates").select("*, qa_template_items(*)").order("name")
      query = projectId ? query.or(`project_id.is.null,project_id.eq.${projectId}`) : query.is("project_id", null)
      const { data: rows, error } = await query
      const list = ((rows as Template[] | null) ?? []).map((template) => ({ ...template, qa_template_items: [...(template.qa_template_items ?? [])].sort((a, b) => a.position - b.position) }))
      return { data: error ? null : list, error: Boolean(error) }
    },
    [projectId],
  )
  return { templates: data, ...rest }
}

export function useInspections(projectId: string | null) {
  const { data, ...rest } = useLoad<Inspection[]>(
    Boolean(projectId),
    [],
    async () => {
      const { data: rows, error } = await fetchAll<Inspection>((from, to) => supabase.from("qa_inspections").select("*").eq("project_id", projectId as string).order("number", { ascending: false }).range(from, to))
      return { data: error ? null : rows, error }
    },
    [projectId],
    byProject("qa_inspections", projectId),
  )
  return { inspections: data, ...rest }
}

export function useInspectionItems(inspectionId: string | null) {
  const { data, setData, ...rest } = useLoad<InspectionItem[]>(
    Boolean(inspectionId),
    [],
    async () => {
      const { data: rows, error } = await supabase.from("qa_inspection_items").select("*").eq("inspection_id", inspectionId as string).order("position")
      return { data: error ? null : ((rows as InspectionItem[] | null) ?? []), error: Boolean(error) }
    },
    [inspectionId],
    byColumn("qa_inspection_items", "inspection_id", inspectionId),
  )
  return { items: data, setItems: setData, ...rest }
}

export function useDefects(projectId: string | null) {
  const { data, ...rest } = useLoad<Defect[]>(
    Boolean(projectId),
    [],
    async () => {
      const { data: rows, error } = await fetchAll<Defect>((from, to) => supabase.from("qa_defects").select("*").eq("project_id", projectId as string).order("number", { ascending: false }).range(from, to))
      return { data: error ? null : rows, error }
    },
    [projectId],
    byProject("qa_defects", projectId),
  )
  return { defects: data, ...rest }
}

export function useDefectEvents(defectId: string | null) {
  const { data, ...rest } = useLoad<DefectEvent[]>(
    Boolean(defectId),
    [],
    async () => {
      const { data: rows, error } = await supabase.from("qa_defect_events").select("*").eq("defect_id", defectId as string).order("id")
      return { data: error ? null : ((rows as DefectEvent[] | null) ?? []), error: Boolean(error) }
    },
    [defectId],
    byColumn("qa_defect_events", "defect_id", defectId),
  )
  return { events: data, ...rest }
}

// Evidence photos of one inspection (all its items) or one defect.
export function useQaPhotos(scope: { inspectionId?: string | null; defectId?: string | null }) {
  const key = scope.inspectionId ?? scope.defectId ?? null
  const { data, ...rest } = useLoad<QaPhoto[]>(
    Boolean(key),
    [],
    async () => {
      let query = supabase.from("qa_photos").select("*").order("created_at")
      if (scope.inspectionId) {
        const { data: items } = await supabase.from("qa_inspection_items").select("id").eq("inspection_id", scope.inspectionId)
        const ids = ((items as Array<{ id: string }> | null) ?? []).map((row) => row.id)
        query = query.or([`inspection_id.eq.${scope.inspectionId}`, ...(ids.length ? [`item_id.in.(${ids.join(",")})`] : [])].join(","))
      } else query = query.eq("defect_id", scope.defectId as string)
      const { data: rows, error } = await query
      return { data: error ? null : ((rows as QaPhoto[] | null) ?? []), error: Boolean(error) }
    },
    [key, Boolean(scope.inspectionId)],
    // Item photos carry the item, not always the inspection, so an inspection listens to all photos it may read.
    scope.defectId ? byColumn("qa_photos", "defect_id", scope.defectId) : key ? [{ table: "qa_photos" }] : [],
  )
  return { photos: data, ...rest }
}

export function useQaSummary(projectId: string | null) {
  const [summary, setSummary] = useState<QaSummary | null>(null)
  const [loading, setLoading] = useState(Boolean(projectId))
  const [error, setError] = useState("")
  const reload = useCallback(async () => {
    if (!projectId) {
      setSummary(null)
      setLoading(false)
      return
    }
    const { data, error: rpcError } = await supabase.rpc("get_qa_summary", { p_project: projectId })
    setError(rpcError ? "Could not load the quality summary." : "")
    if (!rpcError) setSummary(data as QaSummary)
    setLoading(false)
  }, [projectId])
  useEffect(() => {
    setLoading(Boolean(projectId))
    void reload()
  }, [reload, projectId])
  useLiveReload([...byProject("qa_inspections", projectId), ...byProject("qa_defects", projectId)], reload)
  return { summary, loading, error, reload }
}

// ---------- Photos ----------
export type PhotoTarget = { inspectionId?: string; itemId?: string; defectId?: string }

export const QA_CAPTION_LIMIT = 200 // qa_photos.caption check

// Shrinks a chosen picture once, BEFORE it is shown for markup, so the drawing sits on exactly the pixels that are stored.
export async function prepareQaPhoto(file: File): Promise<File> {
  const image = await prepareImage(file)
  return new File([image.blob], `${file.name.replace(/\.[^.]*$/, "") || "photo"}.${image.ext}`, { type: image.blob.type, lastModified: file.lastModified })
}

// Stores a picture made by prepareQaPhoto in the private `qa-evidence` bucket inside the project folder and records it with its
// caption and markup (an overlay: the file is never drawn on). The database refuses it if the inspection is not in progress or
// the defect is closed; the stored file is then removed again.
export async function uploadQaPhoto(projectId: string, target: PhotoTarget, photo: { file: File; caption?: string; annotations?: IssueMarkup[] }, stamp?: PhotoStamp | null): Promise<void> {
  const annotations = photo.annotations ?? []
  const problem = markupProblem(annotations)
  if (problem) throw new Error(problem)
  const ext = photo.file.type === "image/webp" ? "webp" : photo.file.type === "image/jpeg" ? "jpg" : "png"
  const folder = target.itemId ? `item-${target.itemId}` : target.inspectionId ? `ir-${target.inspectionId}` : `ncr-${target.defectId}`
  const path = `${projectId}/${folder}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${ext}`
  const stored = await supabase.storage.from("qa-evidence").upload(path, photo.file, { contentType: photo.file.type, upsert: false })
  if (stored.error) throw new Error(/row-level security|not allowed|403/i.test(stored.error.message) ? "You are not allowed to add photos to this project." : stored.error.message)
  const { error } = await supabase.from("qa_photos").insert({
    project_id: projectId,
    inspection_id: target.inspectionId ?? null,
    item_id: target.itemId ?? null,
    defect_id: target.defectId ?? null,
    path,
    caption: photo.caption?.trim().slice(0, QA_CAPTION_LIMIT) || null,
    ...(annotations.length ? { annotations } : {}),
    ...stampFields(stamp),
  })
  if (error) {
    await supabase.storage.from("qa-evidence").remove([path])
    throw new Error(error.message)
  }
}

export async function removeQaPhoto(photo: QaPhoto): Promise<string> {
  const { error } = await supabase.from("qa_photos").delete().eq("id", photo.id)
  if (error) return error.message
  await supabase.storage.from("qa-evidence").remove([photo.path])
  return ""
}

// ---------- Actions (each one is a checked database function; the message is already readable) ----------
type Result<T = void> = { ok: true; data: T } | { ok: false; message: string }

async function call<T = void>(name: string, args: Record<string, unknown>): Promise<Result<T>> {
  const { data, error } = await supabase.rpc(name, args)
  if (error) return { ok: false, message: error.message.replace(/^new row for relation.*violates check constraint.*$/i, "Check the values you entered.") }
  return { ok: true, data: data as T }
}

export const qaActions = {
  requestInspection: (input: { projectId: string; templateId: string; title: string; pinId?: string | null; location?: string; note?: string }) =>
    call<string>("request_inspection", { p_project: input.projectId, p_template: input.templateId, p_title: input.title, p_pin: input.pinId ?? null, p_location: input.location ?? null, p_note: input.note ?? null }),
  start: (id: string) => call("start_inspection", { p_id: id }),
  saveItem: (input: { itemId: string; result: ItemResult; measured?: number | null; remarks?: string }) =>
    call<ItemResult>("save_inspection_item", { p_item: input.itemId, p_result: input.result, p_measured: input.measured ?? null, p_remarks: input.remarks ?? null }),
  complete: (id: string, summary: string) => call<{ result: "passed" | "conditional" | "failed"; score: number; threshold: number; defects: number; critical_failed: boolean; hold_point_failed: boolean }>("complete_inspection", { p_id: id, p_summary: summary || null }),
  reinspect: (id: string, note: string) => call<string>("request_reinspection", { p_id: id, p_note: note || null }),
  cancel: (id: string, reason: string) => call("cancel_inspection", { p_id: id, p_reason: reason }),
  // The 11-argument form (20261024090000) also records the checklist item; the database validates pin, item and project together.
  raiseDefect: (input: { projectId: string; title: string; description: string; category: DefectCategory; severity: QaSeverity; trade: Trade; reference?: string; pinId?: string | null; checklistItemId?: string | null; assignedTo?: string | null; due?: string | null }) =>
    call<string>("raise_defect", { p_project: input.projectId, p_title: input.title, p_description: input.description, p_category: input.category, p_severity: input.severity, p_trade: input.trade, p_reference: input.reference ?? null, p_pin: input.pinId ?? null, p_assigned_to: input.assignedTo ?? null, p_due: input.due ?? null, p_checklist_item: input.checklistItemId ?? null }),
  editDefect: (input: { id: string; title: string; description: string; category: DefectCategory; severity: QaSeverity; reference: string; assignedTo: string | null; due: string | null }) =>
    call("edit_defect", { p_id: input.id, p_title: input.title, p_description: input.description, p_category: input.category, p_severity: input.severity, p_reference: input.reference, p_assigned_to: input.assignedTo, p_due: input.due }),
  updateDefect: (input: { id: string; status: "open" | "in_progress" | "for_verification"; corrective?: string; rootCause?: string; preventive?: string; note?: string }) =>
    call("update_defect", { p_id: input.id, p_status: input.status, p_corrective_action: input.corrective ?? null, p_root_cause: input.rootCause ?? null, p_preventive_action: input.preventive ?? null, p_note: input.note ?? null }),
  verifyDefect: (id: string, close: boolean, note: string) => call("verify_defect", { p_id: id, p_close: close, p_note: note }),
  // Manual completion uses the existing checked RPC; verified is the stored Completed state.
  submitItems: (pinId: string, itemIds: string[], note?: string) => call<string>("submit_checklist_qa", { p_pin: pinId, p_items: itemIds, p_note: note?.trim() || null }),
  beginCorrection: (itemId: string) => call<string>("begin_checklist_resubmission", { p_item: itemId }),
  saveCorrection: (attemptId: string, remarks: string) => call("save_checklist_attempt", { p_attempt: attemptId, p_remarks: remarks }),
  submitCorrection: (input: { itemIds: string[]; defectIds: string[]; rootCause?: string; preventive?: string }) =>
    call<string>("submit_correction_package", { p_items: input.itemIds, p_defects: input.defectIds, p_root_cause: input.rootCause?.trim() || null, p_preventive: input.preventive?.trim() || null }),
  reviewItem: (itemId: string, accept: boolean, reason?: string) => call("review_checklist_item", { p_item: itemId, p_accept: accept, p_reason: reason?.trim() || null }),
  completeItem: (itemId: string) => call("review_checklist_item", { p_item: itemId, p_accept: true, p_reason: null }),
  saveTemplate: (input: { id: string | null; projectId: string | null; name: string; trade: Trade; description: string; standards: string[]; items: unknown[] }) =>
    call<string>("save_qa_template", { p_id: input.id, p_project: input.projectId, p_name: input.name, p_trade: input.trade, p_description: input.description, p_standards: input.standards, p_items: input.items }),
  duplicateTemplate: (templateId: string, projectId: string | null, name?: string) => call<string>("duplicate_qa_template", { p_template: templateId, p_project: projectId, p_name: name ?? null }),
  archiveTemplate: (id: string, archived: boolean) => call("archive_qa_template", { p_id: id, p_archived: archived }),
}
