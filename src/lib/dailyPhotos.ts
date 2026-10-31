import { useCallback, useEffect, useRef, useState } from "react"
import { photoDateBounds, type PhotoDates, type GalleryPhoto, type PhotoScope } from "./photoGalleryModel"
import { fetchAll } from "./paging"
import { reportDateLong } from "./reportFormat"
import { byProject, useLiveReload, usePeriodicReload } from "./realtime"
import { supabase } from "./supabase"

export type PhotoTab = "daily" | "checklist"
// Daily report photos and work item (checklist) evidence. Separate "progress" pin photos were removed (2026-10-19).
export const photoTabs = [["daily", "Daily report"], ["checklist", "Tasks"]] as const
export const readPhotoTab = (): PhotoTab => {
  const value = new URLSearchParams(window.location.search).get("tab")
  return value === "checklist" ? value : "daily"
}
type PhotoRow = GalleryPhoto & { daily_reports?: GalleryPhoto["report"]; pins?: GalleryPhoto["work"]; pin_checklist_items?: GalleryPhoto["checklist"] }

export function useEvidencePhotos(projectId: string | null, tab: PhotoTab, reportId?: string | null, dates?: PhotoDates, scope?: PhotoScope) {
  const from = dates?.from ?? ""
  const to = dates?.to ?? ""
  // Sheet / pin / work item apply to pin photos only (daily report photos belong to a report, not a pin).
  const sheet = tab === "daily" ? "" : scope?.sheet ?? ""
  const pin = tab === "daily" ? "" : scope?.pin ?? ""
  const item = tab === "daily" ? "" : scope?.item ?? ""
  const [photos, setPhotos] = useState<GalleryPhoto[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const sequence = useRef(0)
  const reload = useCallback(async () => {
    const run = ++sequence.current
    if (!projectId || reportId === null) { setPhotos([]); setLoading(false); setError(""); return }
    const bounds = photoDateBounds({ from, to })
    if (bounds.error) { setPhotos([]); setLoading(false); setError(bounds.error); return }
    const daily = tab === "daily"
    let query = supabase.from(daily ? "daily_report_photos" : "pin_photos")
      .select(daily ? "*,daily_reports(report_date,status,work_done)" : `*,pins${sheet ? "!inner" : ""}(title,description,status,blueprint_id),pin_checklist_items(id,text,done,remark,done_at)`)
      .eq("project_id", projectId)
    if (reportId) query = query.eq("report_id", reportId)
    if (!daily) query = query.not("checklist_item_id", "is", null)
    if (sheet) query = query.eq("pins.blueprint_id", sheet)
    if (pin) query = query.eq("pin_id", pin)
    if (item) query = query.eq("checklist_item_id", item)
    // Apply calendar bounds in the database BEFORE the newest-200 limit.
    if (bounds.start) query = query.gte("created_at", bounds.start)
    if (bounds.end) query = query.lt("created_at", bounds.end)
    const result = await query.order("created_at", { ascending: false }).order("id").limit(200)
    if (run !== sequence.current) return
    setError(result.error ? "Could not load photos. Please retry." : "")
    setPhotos(((result.data ?? []) as unknown as PhotoRow[]).map((photo) => ({ ...photo,
      checklist: photo.pin_checklist_items, work: photo.pins, report: photo.daily_reports, label: daily
      ? reportDateLong(photo.daily_reports?.report_date ?? "")
      : [photo.pins?.title ?? "Task", tab === "checklist" ? photo.pin_checklist_items?.text : null].filter(Boolean).join(" — ") })))
    setLoading(false)
  }, [projectId, tab, reportId, from, to, sheet, pin, item])
  useEffect(() => {
    setPhotos([]); setLoading(true); void reload()
    return () => { sequence.current++ }
  }, [reload])
  useLiveReload([
    ...byProject(tab === "daily" ? "daily_report_photos" : "pin_photos", projectId),
    ...byProject("daily_reports", projectId), ...byProject("pins", projectId), ...byProject("pin_checklist_items", projectId),
  ], () => void reload())
  usePeriodicReload(projectId && reportId !== null ? `photos:${projectId}:${tab}:${reportId ?? "all"}` : null, () => void reload())
  return { photos, loading, error, reload }
}

// Work items of a project for the photo filter (names repeat across pins, so each option carries its pin).
export type WorkItemOption = { id: string; pin_id: string; text: string; position: number; done: boolean; review_status: string | null }
export function useProjectWorkItems(projectId: string | null, enabled: boolean) {
  const [items, setItems] = useState<WorkItemOption[]>([])
  const [loadedFor, setLoadedFor] = useState<string | null>(null)
  const sequence = useRef(0)
  const reload = useCallback(async () => {
    const run = ++sequence.current
    if (!projectId || !enabled) { setItems([]); setLoadedFor(null); return }
    const result = await fetchAll<WorkItemOption>((from, to) => supabase.from("pin_checklist_items").select("id,pin_id,text,position,done,review_status").eq("project_id", projectId).order("pin_id").order("position").order("id").range(from, to)).catch(() => ({ data: [] as WorkItemOption[], error: true }))
    if (run !== sequence.current) return
    setItems(result.error ? [] : result.data); setLoadedFor(projectId)
  }, [projectId, enabled])
  useEffect(() => {
    setItems([]); void reload()
    return () => { sequence.current++ }
  }, [reload])
  useLiveReload(enabled ? byProject("pin_checklist_items", projectId) : [], () => void reload())
  usePeriodicReload(projectId && enabled ? `report-items:${projectId}` : null, () => void reload())
  return enabled && loadedFor === projectId ? items : []
}
