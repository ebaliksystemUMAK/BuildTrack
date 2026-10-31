import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { supabase } from "./supabase"
import { fetchAll } from "./paging"
import { byColumn, byProject, useLiveReload } from "./realtime"
import { useChecklist, usePinPhotos, type ChecklistItem, type Pin, type PinPhoto } from "./blueprints"
import { photoEligible } from "./photoStamp"
import { usePinQa } from "./pinQa"
import type { Defect, DefectEvent, Inspection } from "./qa"
import { useQaSubmissionIndex, useWorkQaHistory } from "./qaAttempts"
import type { WorkQaAttempt } from "./qaAttemptsModel"
import { itemAttempts, linkedDefects, workItemStage, type StageView, type SubmissionRef } from "./workItemModel"

type DraftRow = Pick<WorkQaAttempt, "id" | "item_id" | "pin_id" | "remarks" | "submitted_inspection_id">
const isOpen = (row: { status: string }) => row.status === "requested" || row.status === "in_progress"

// Criteria count as approved when the Engineer approved them, or already inspected this work against them (same as SQL).
export const criteriaApproved = (pin: Pin, inspections: Inspection[], item?: ChecklistItem) => Boolean(item?.qa_template_id || pin.qa_template_id && (pin.qa_approved_by
  || inspections.some((row) => row.pin_id === pin.id && row.template_id === pin.qa_template_id && row.started_at && ["passed", "failed", "conditional"].includes(row.status))))

// The stage of one item from already-loaded rows. Photo counts are optional (boards do not load photos; the workspace does).
export function stageOf(input: {
  item: ChecklistItem; pin: Pin; pinItems: ChecklistItem[]; submissions: SubmissionRef[]; inspections: Inspection[]; defects: Defect[]
  draft: DraftRow | null; photos?: PinPhoto[]
}) {
  const { item, pin, submissions, inspections, defects, draft, photos } = input
  const attempts = itemAttempts(item.id, submissions, inspections)
  const current = inspections.find((row) => row.id === item.review_inspection_id) ?? attempts[attempts.length - 1]?.inspection ?? null
  const ncrs = linkedDefects(item.id, pin.id, submissions, defects)
  const open = current && isOpen(current) ? current : null
  const eligible = (rows: PinPhoto[]) => rows.filter(photoEligible).length
  const view: StageView = workItemStage({
    item,
    attempts: attempts.length,
    current: current ? { number: current.number, status: current.status } : null,
    ncrs,
    draft: draft ? { remarks: draft.remarks, photos: photos ? eligible(photos.filter((photo) => photo.qa_attempt_id === draft.id)) : null } : null,
    eligiblePhotos: photos ? eligible(photos.filter((photo) => photo.checklist_item_id === item.id && !photo.qa_attempt_id)) : null,
    criteriaApproved: criteriaApproved(pin, inspections, item),
    pinCompleted: pin.status === "verified",
  })
  return { view, attempts, current, ncrs, open }
}

export type WorkItemRow = { item: ChecklistItem; pin: Pin; view: StageView; current: Inspection | null; ncrs: Defect[]; attempts: number }

// Every work item of a project with its stage, for the QA boards. Pins, inspections and NCRs come from the page's QA workspace.
export function useWorkItems(projectId: string | null, pins: Pin[], inspections: Inspection[], defects: Defect[]) {
  const submissions = useQaSubmissionIndex(projectId)
  const [items, setItems] = useState<ChecklistItem[]>([])
  const [drafts, setDrafts] = useState<DraftRow[]>([])
  const [loading, setLoading] = useState(Boolean(projectId))
  const [error, setError] = useState("")
  const sequence = useRef(0)
  const reload = useCallback(async () => {
    const run = ++sequence.current
    if (!projectId) { setItems([]); setDrafts([]); setLoading(false); return }
    const [itemRows, draftRows] = await Promise.all([
      fetchAll<ChecklistItem>((from, to) => supabase.from("pin_checklist_items").select("*").eq("project_id", projectId).order("pin_id").order("position").order("id").range(from, to)),
      fetchAll<DraftRow>((from, to) => supabase.from("qa_work_attempts").select("id,item_id,pin_id,remarks,submitted_inspection_id").eq("project_id", projectId).is("submitted_inspection_id", null).order("id").range(from, to)),
    ])
    if (run !== sequence.current) return
    setError(itemRows.error || draftRows.error ? "Could not load the tasks. Refresh to retry." : "")
    if (!itemRows.error) setItems(itemRows.data)
    if (!draftRows.error) setDrafts(draftRows.data)
    setLoading(false)
  }, [projectId])
  useEffect(() => {
    setItems([]); setDrafts([]); setError(""); setLoading(Boolean(projectId)); void reload()
    return () => { sequence.current++ }
  }, [reload, projectId])
  useLiveReload([...byProject("pin_checklist_items", projectId), ...byProject("qa_work_attempts", projectId)], () => void reload())

  const rows = useMemo(() => {
    const pinById = new Map(pins.filter((pin) => pin.category !== "note").map((pin) => [pin.id, pin]))
    const byPin = new Map<string, ChecklistItem[]>()
    for (const item of items) byPin.set(item.pin_id, [...(byPin.get(item.pin_id) ?? []), item])
    const draftOf = new Map(drafts.map((row) => [row.item_id, row]))
    const result: WorkItemRow[] = []
    for (const item of items) {
      const pin = pinById.get(item.pin_id)
      if (!pin) continue
      const stage = stageOf({ item, pin, pinItems: byPin.get(pin.id) ?? [], submissions: submissions.rows as SubmissionRef[], inspections, defects, draft: draftOf.get(item.id) ?? null })
      result.push({ item, pin, view: stage.view, current: stage.current, ncrs: stage.ncrs, attempts: stage.attempts.length })
    }
    return result
  }, [items, drafts, pins, inspections, defects, submissions.rows])

  const workInspectionIds = useMemo(() => new Set(submissions.rows.map((row) => row.inspection_id)), [submissions.rows])
  return { rows, workInspectionIds, loading: loading || submissions.loading, error: error || submissions.error, reload: async () => { await Promise.all([reload(), submissions.reload()]) } }
}

// One work item with everything its workspace shows. Loads the item first, then its work (pin) by id.
export function useWorkItem(itemId: string) {
  const [pinId, setPinId] = useState<string | null>(null)
  const [pin, setPin] = useState<Pin | null>(null)
  const [missing, setMissing] = useState(false)
  const [defects, setDefects] = useState<Defect[]>([])
  const [templateName, setTemplateName] = useState<string | null>(null)
  const [workError, setWorkError] = useState("")
  const sequence = useRef(0)
  useEffect(() => {
    let active = true
    setPinId(null); setPin(null); setMissing(false)
    void supabase.from("pin_checklist_items").select("pin_id").eq("id", itemId).maybeSingle().then(({ data }) => {
      if (!active) return
      if (data) setPinId(data.pin_id as string)
      else setMissing(true)
    })
    return () => { active = false }
  }, [itemId])

  const checklist = useChecklist(pinId)
  const { photos, reload: reloadPhotos } = usePinPhotos(pinId)
  const history = useWorkQaHistory(pinId)
  const qa = usePinQa(pinId ?? "")
  const reloadWork = useCallback(async () => {
    const run = ++sequence.current
    if (!pinId) return
    const [pinRow, defectRows] = await Promise.all([
      supabase.from("pins").select("*").eq("id", pinId).maybeSingle(),
      fetchAll<Defect>((from, to) => supabase.from("qa_defects").select("*").eq("pin_id", pinId).order("number").range(from, to)),
    ])
    if (run !== sequence.current) return
    setWorkError(pinRow.error ? "Could not load the work record. Reload before reviewing." : defectRows.error ? "Could not load NCRs. Reload before reviewing corrections." : "")
    if (pinRow.data) setPin(pinRow.data as Pin)
    else if (!pinRow.error) setMissing(true)
    if (!defectRows.error) setDefects(defectRows.data)
    const { data: itemRow } = await supabase.from("pin_checklist_items").select("qa_template_id").eq("id", itemId).maybeSingle()
    const template = itemRow?.qa_template_id ?? (pinRow.data as Pin | null)?.qa_template_id
    if (template) {
      const { data } = await supabase.from("qa_templates").select("name").eq("id", template).maybeSingle()
      if (run === sequence.current) setTemplateName((data?.name as string | undefined) ?? null)
    } else setTemplateName(null)
  }, [pinId, itemId])
  useEffect(() => { setWorkError(""); void reloadWork(); return () => { sequence.current++ } }, [reloadWork])
  useLiveReload([...byColumn("pins", "id", pinId), ...byColumn("qa_defects", "pin_id", pinId)], () => void reloadWork())

  const item = checklist.items.find((row) => row.id === itemId) ?? null
  const draft = history.attempts.find((row) => row.item_id === itemId && !row.submitted_inspection_id) ?? null
  const stage = useMemo(() => item && pin
    ? stageOf({ item, pin, pinItems: checklist.items, submissions: history.submissions as SubmissionRef[], inspections: history.inspections, defects, draft, photos })
    : null, [item, pin, checklist.items, history.submissions, history.inspections, defects, draft, photos])

  const reload = useCallback(async () => {
    await Promise.all([checklist.reload(), reloadPhotos(), history.reload(), qa.reload(), reloadWork()])
  }, [checklist, reloadPhotos, history, qa, reloadWork])

  return {
    item, pin, missing, stage, draft, photos, defects, templateName, history, qa,
    pinItems: checklist.items,
    loading: !missing && (!item || !pin || history.loading),
    error: checklist.error || history.error || qa.error || workError,
    reload,
  }
}

// NCRs of one work (pin), live.
export function usePinDefects(pinId: string | null) {
  const [defects, setDefects] = useState<Defect[]>([])
  const sequence = useRef(0)
  const reload = useCallback(async () => {
    const run = ++sequence.current
    if (!pinId) { setDefects([]); return }
    const result = await fetchAll<Defect>((from, to) => supabase.from("qa_defects").select("*").eq("pin_id", pinId).order("number").range(from, to))
    if (run === sequence.current && !result.error) setDefects(result.data)
  }, [pinId])
  useEffect(() => { void reload(); return () => { sequence.current++ } }, [reload])
  useLiveReload(byColumn("qa_defects", "pin_id", pinId), () => void reload())
  return defects
}

export function useDefectHistory(defectIds: string[]) {
  const key = defectIds.join(",")
  const [events, setEvents] = useState<DefectEvent[]>([])
  useEffect(() => {
    let active = true
    if (!key) { setEvents([]); return }
    void fetchAll<DefectEvent>((from, to) => supabase.from("qa_defect_events").select("*").in("defect_id", key.split(",")).order("id").range(from, to)).then((result) => {
      if (active && !result.error) setEvents(result.data)
    })
    return () => { active = false }
  }, [key])
  return events
}

// ?item=<checklist item id> opens a work item's workspace on any QA page (links from notifications, inspections and NCRs).
export function useItemParam() {
  const read = () => new URLSearchParams(window.location.search).get("item")
  const [itemId, setItemId] = useState<string | null>(read)
  useEffect(() => {
    const changed = () => setItemId(read())
    window.addEventListener("popstate", changed)
    return () => window.removeEventListener("popstate", changed)
  }, [])
  const set = useCallback((id: string | null) => {
    const url = new URL(window.location.href)
    if (id) url.searchParams.set("item", id)
    else url.searchParams.delete("item")
    url.searchParams.delete("tasktab")
    window.history.replaceState({}, "", url)
    setItemId(id)
  }, [])
  return [itemId, set] as const
}
