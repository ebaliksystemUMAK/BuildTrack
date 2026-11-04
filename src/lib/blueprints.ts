import { useCallback, useEffect, useRef, useState } from "react"
import { asPoints, type Pt } from "./geometry"
import { sanitizeFormat, type TextFormat } from "./textFormat"
import type { Discipline } from "./projects"
import type { BlueprintType, ClassifiedType } from "./blueprintTypes"
import { supabase } from "./supabase"
import type { StampFlag } from "./photoStamp"
import type { IssueMarkup } from "./issueMarkup"
import { fetchAll } from "./paging"
import { fetchProgressPins } from "./progressData"
import type { ProgressTask } from "./taskProgress"
import { byColumn, byProject, useLiveReload } from "./realtime"

export type PinStatus = "not_started" | "in_progress" | "for_review" | "issue" | "verified"
export type PinCategory = "progress" | "quality" | "safety" | "note"
export type PinSeverity = "low" | "medium" | "high" | "critical"

export type Revision = {
  id: string
  blueprint_id: string
  project_id: string
  revision: number
  file_path: string
  file_name: string
  mime_type: string
  size_bytes: number
  preview_path: string
  preview_width: number
  preview_height: number
  thumb_path: string | null
  notes: string | null
  uploaded_by: string | null
  created_at: string
}

export type Blueprint = {
  id: string
  project_id: string
  title: string
  level: string | null
  discipline: Discipline | null // legacy (0009); the type below decides access since 20261028130000
  blueprint_type: BlueprintType
  scale_width_m: number | null
  base_locked: boolean
  created_at: string
  blueprint_revisions: Revision[]
}

export type Pin = {
  id: string
  tasks?: ProgressTask[]
  qa_template_id?: string | null
  qa_approved_by?: string | null
  project_id: string
  blueprint_id: string
  revision_id: string | null
  x: number
  y: number
  title: string
  description: string | null
  category: PinCategory
  discipline: Discipline | null
  status: PinStatus
  severity: PinSeverity
  assigned_to: string | null
  assigned_by?: string | null
  assigned_at?: string | null
  due_date: string | null
  planned_start?: string | null
  locked: boolean
  created_by: string | null
  verified_by: string | null
  verified_at: string | null
  created_at: string
  updated_at: string
}

// `annotations` = markup drawn over the photo (20261023073942); the stored file itself is the untouched original.
export type PinPhoto = { id: string; pin_id: string; checklist_item_id?: string | null; qa_attempt_id?: string | null; path: string; caption: string | null; uploaded_by: string | null; created_at: string; taken_at: string | null; stamp_flag: StampFlag | null; distance_m: number | null; annotations?: IssueMarkup[] }

export type TimelineEntry = {
  id: number
  created_at: string
  kind: "created" | "moved" | "edited" | "status" | "comment" | "photo" | "checklist" | "photo_removed" | "assigned"
  from_status: PinStatus | null
  to_status: PinStatus | null
  note: string | null
  actor_name: string
  actor_role: string | null
  from_name?: string | null // assignment entries: previous and new Foreman
  to_name?: string | null
}

export type EditorTool = "select" | "pin" | "pen" | "highlighter" | "shape" | "text" | "note" | "arrow" | "cloud" | "symbol" | "image" | "dimension" | "polyline" | "area" | "measure" | "stamp"
export type AnnotationColor = "magenta" | "orange" | "blue" | "green" | "red" | "gray" | "yellow" | "black"
export type AnnotationKind = "note" | "shape" | "text" | "draw" | "highlight" | "polyline" | "area" | "arrow" | "dimension" | "cloud" | "symbol" | "image"
export type ShapeKind = "rect" | "ellipse"

export type Annotation = {
  id: string
  project_id: string
  blueprint_id: string
  kind: AnnotationKind
  shape: ShapeKind | null
  x: number
  y: number
  w: number | null
  h: number | null
  text: string | null
  color: AnnotationColor
  points: Pt[] | null
  stroke: number | null // percent of the sheet width
  opacity: number
  z_index: number
  locked: boolean
  font_size: number | null // percent of the sheet width
  group_id: string | null
  symbol: string | null
  image_path: string | null
  rotation: number // degrees, clockwise
  format: TextFormat // text boxes and notes only
  created_by: string | null
  created_at: string
  updated_at: string
}

export type ChecklistItem = {
  planned_start?: string | null
  due_date?: string | null
  qa_template_id?: string | null
  review_status?: "not_submitted" | "for_review" | "verified" | "returned"
  review_inspection_id?: string | null
  verified_by?: string | null
  verified_at?: string | null
  id: string
  pin_id: string
  project_id: string
  position: number
  text: string
  done: boolean
  done_by: string | null
  done_at: string | null
  remark: string | null // evidence: a remark or a photo of its own is needed before the item can be done
  remark_by: string | null
  remark_at: string | null
}

export const annotationColors: Record<AnnotationColor, string> = {
  magenta: "#9e1f93",
  orange: "#f18b00",
  blue: "#1a9fe5",
  green: "#1ca875",
  red: "#d93a3a",
  gray: "#6b7280",
  yellow: "#ffd400",
  black: "#1d1d1f",
}

export const annotationKindLabels: Record<AnnotationKind, string> = {
  note: "Note",
  shape: "Shape",
  text: "Text box",
  draw: "Freehand drawing",
  highlight: "Highlight",
  polyline: "Polyline",
  area: "Area",
  arrow: "Arrow",
  dimension: "Dimension line",
  cloud: "Revision cloud",
  symbol: "Symbol",
  image: "Image",
}

export const isPointKind = (kind: AnnotationKind) => kind === "draw" || kind === "highlight" || kind === "polyline" || kind === "area" || kind === "arrow" || kind === "dimension" || kind === "cloud"

// Database rows arrive with numeric columns as strings and points as raw jsonb.
export function normalizeAnnotation(row: Record<string, unknown>): Annotation {
  const item = row as unknown as Annotation
  const num = (value: unknown) => (value === null || value === undefined ? null : Number(value))
  return {
    ...item,
    x: Number(item.x),
    y: Number(item.y),
    w: num(item.w),
    h: num(item.h),
    points: item.points ? asPoints(item.points) : null,
    stroke: num(item.stroke),
    opacity: item.opacity === undefined || item.opacity === null ? 1 : Number(item.opacity),
    z_index: Number(item.z_index ?? 0),
    locked: Boolean(item.locked),
    font_size: num(item.font_size),
    group_id: item.group_id ?? null,
    symbol: item.symbol ?? null,
    image_path: item.image_path ?? null,
    rotation: item.rotation === undefined || item.rotation === null ? 0 : Number(item.rotation),
    format: sanitizeFormat(item.format),
  }
}

// Length between two points given in percent of the sheet, in metres when the sheet is calibrated.
export function measureDistance(a: { x: number; y: number }, b: { x: number; y: number }, width: number, height: number, scaleWidthM: number | null) {
  const px = Math.hypot(((b.x - a.x) / 100) * width, ((b.y - a.y) / 100) * height)
  if (!scaleWidthM) return { px, meters: null as number | null }
  return { px, meters: (px / width) * scaleWidthM }
}

export const formatMeters = (meters: number) => (meters >= 100 ? `${meters.toFixed(0)} m` : meters >= 10 ? `${meters.toFixed(1)} m` : meters >= 1 ? `${meters.toFixed(2)} m` : `${(meters * 100).toFixed(0)} cm`)

export const statusLabels: Record<PinStatus, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  for_review: "For review",
  issue: "Issue",
  verified: "Completed",
}

// Fixed status colors (the same meaning in light and dark mode).
export const statusDot: Record<PinStatus, string> = {
  not_started: "#1a9fe5",
  in_progress: "#f18b00",
  for_review: "#9e1f93",
  issue: "#d93a3a",
  verified: "#1ca875",
}

export const statusChip: Record<PinStatus, string> = {
  not_started: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200",
  in_progress: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  for_review: "bg-fuchsia-100 text-fuchsia-900 dark:bg-fuchsia-900/40 dark:text-fuchsia-200",
  issue: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200",
  verified: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200",
}

export const categoryLabels: Record<PinCategory, string> = {
  progress: "Progress",
  quality: "Quality",
  safety: "Safety",
  note: "Note",
}

export const severityLabels: Record<PinSeverity, string> = { low: "Low", medium: "Medium", high: "High", critical: "Critical" }
export const severityRank: Record<PinSeverity, number> = { low: 0, medium: 1, high: 2, critical: 3 }
export const severityChip: Record<PinSeverity, string> = {
  low: "bg-gray-200 text-gray-700 dark:bg-gray-700/50 dark:text-gray-200",
  medium: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  high: "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-200",
  critical: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200",
}

export const MAX_BLUEPRINT_BYTES = 25 * 1024 * 1024
export const BLUEPRINT_ACCEPT = "application/pdf,image/png,image/jpeg,image/webp"
const BLUEPRINT_TYPES = BLUEPRINT_ACCEPT.split(",")

const dateFmt = { timeZone: "Asia/Manila" } as const
export const formatStamp = (iso: string) =>
  new Date(iso).toLocaleString("en-PH", { ...dateFmt, month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })

// ---------- Loading ----------
export function useBlueprints(projectId: string | null) {
  const [blueprints, setBlueprints] = useState<Blueprint[]>([])
  const [loading, setLoading] = useState(Boolean(projectId))
  const [error, setError] = useState("")
  const sequence = useRef(0)

  const reload = useCallback(async () => {
    const current = ++sequence.current
    if (!projectId) {
      setBlueprints([])
      setLoading(false)
      return
    }
    const { data, error: loadError } = await supabase
      .from("blueprints")
      .select("*, blueprint_revisions(*)")
      .eq("project_id", projectId)
      .order("created_at", { ascending: true })
    if(current !== sequence.current) return
    setError(loadError ? "Could not load blueprints. Check your connection and try again." : "")
    const rows = ((data as Blueprint[] | null) ?? []).map((bp) => ({
      ...bp,
      blueprint_revisions: [...(bp.blueprint_revisions ?? [])].sort((a, b) => b.revision - a.revision),
    }))
    setBlueprints(rows)
    setLoading(false)
  }, [projectId])

  useEffect(() => {
    setBlueprints([])
    setError("")
    setLoading(Boolean(projectId))
    void reload()
    return () => {sequence.current++}
  }, [reload, projectId])

  return { blueprints, loading, error, reload }
}

export function usePins(blueprintId: string | null) {
  const [pins, setPins] = useState<Pin[]>([])
  const [loading, setLoading] = useState(Boolean(blueprintId))
  const [error, setError] = useState("")

  const reload = useCallback(async () => {
    if (!blueprintId) {
      setPins([])
      setLoading(false)
      return
    }
    const { data, error: loadError } = await supabase
      .from("pins")
      .select("*")
      .eq("blueprint_id", blueprintId)
      .order("created_at", { ascending: true })
    setError(loadError ? "Could not load pins. Check your connection and try again." : "")
    setPins(((data as Pin[] | null) ?? []).map((pin) => ({ ...pin, x: Number(pin.x), y: Number(pin.y) })))
    setLoading(false)
  }, [blueprintId])

  useEffect(() => {
    setLoading(Boolean(blueprintId))
    void reload()
  }, [reload, blueprintId])

  return { pins, setPins, loading, error, reload }
}

// All pins of a project (used for the sheet strip counts and the pin list; switching sheets needs no refetch). Every row is read
// (paged), so progress never stops at 1,000 pins. `live` reloads on database changes; the editor leaves it off (optimistic edits).
export function useProjectPins(projectId: string | null, live = false, withTasks = false) {
  const [pins, setPins] = useState<Pin[]>([])
  const [loading, setLoading] = useState(Boolean(projectId))
  const [error, setError] = useState("")
  const sequence = useRef(0)

  const reload = useCallback(async () => {
    const current=++sequence.current
    if (!projectId) {
      setPins([])
      setLoading(false)
      return
    }
    const page = (from: number, to: number) => supabase.from("pins").select("*").eq("project_id", projectId).order("created_at", { ascending: true }).order("id").range(from, to)
    const { data, error: loadError } = await (withTasks ? fetchProgressPins<Pin>(page, projectId) : fetchAll<Pin>(page))
    if(current!==sequence.current) return
    setError(loadError ? `Could not load ${withTasks ? "pins and task progress" : "pins"}. Check your connection and try again.` : "")
    setPins(data.map((pin) => ({ ...pin, x: Number(pin.x), y: Number(pin.y) })))
    setLoading(false)
  }, [projectId, withTasks])

  useEffect(() => {
    setPins([])
    setError("")
    setLoading(Boolean(projectId))
    void reload()
    return () => {sequence.current++}
  }, [reload, projectId])
  useLiveReload(live ? [...byProject("pins", projectId), ...(withTasks ? byProject("pin_checklist_items", projectId) : [])] : [], reload)

  return { pins, setPins, loading, error, reload }
}

export function useAnnotations(blueprintId: string | null) {
  const [annotations, setAnnotations] = useState<Annotation[]>([])
  const [loading, setLoading] = useState(Boolean(blueprintId))

  const reload = useCallback(async () => {
    if (!blueprintId) {
      setAnnotations([])
      setLoading(false)
      return
    }
    const { data } = await supabase.from("blueprint_annotations").select("*").eq("blueprint_id", blueprintId).order("z_index", { ascending: true }).order("created_at", { ascending: true })
    setAnnotations(((data as Array<Record<string, unknown>> | null) ?? []).map(normalizeAnnotation))
    setLoading(false)
  }, [blueprintId])

  useEffect(() => {
    setLoading(Boolean(blueprintId))
    void reload()
  }, [reload, blueprintId])

  return { annotations, setAnnotations, loading, reload }
}

export function useChecklist(pinId: string | null) {
  const [items, setItems] = useState<ChecklistItem[]>([])
  const [loading, setLoading] = useState(Boolean(pinId))
  const [error, setError] = useState("")
  const sequence = useRef(0)

  const reload = useCallback(async () => {
    const run = ++sequence.current
    if (!pinId) {
      setItems([])
      setError("")
      setLoading(false)
      return
    }
    const { data, error: loadError } = await supabase.from("pin_checklist_items").select("*").eq("pin_id", pinId).order("position", { ascending: true })
    if (run !== sequence.current) return
    setError(loadError ? "Could not load the tasks. Refresh and retry before submitting or reviewing." : "")
    setItems((data as ChecklistItem[] | null) ?? [])
    setLoading(false)
  }, [pinId])

  useEffect(() => {
    setItems([])
    setLoading(Boolean(pinId))
    void reload()
    return () => { sequence.current++ }
  }, [reload, pinId])
  useLiveReload(byColumn("pin_checklist_items", "pin_id", pinId), () => void reload())

  return { items, setItems, loading, error, reload }
}

export type HistoryEntry = {
  id: string
  created_at: string
  actor_name: string
  actor_role: string | null
  action: string
  item_type: "pin" | "annotation" | "sheet"
  item_id: string | null
  summary: string
}

// Edit history of a sheet (Engineers, Foremen, admins). Reloaded whenever `version` changes (after every edit).
export function useSheetHistory(blueprintId: string | null, enabled: boolean, version: number) {
  const [entries, setEntries] = useState<HistoryEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    if (!blueprintId || !enabled) return
    let active = true
    setLoading(true)
    supabase.rpc("get_sheet_history", { p_blueprint: blueprintId, p_limit: 120 }).then(({ data, error: loadError }) => {
      if (!active) return
      setError(loadError ? "Could not load the history." : "")
      setEntries((data as HistoryEntry[] | null) ?? [])
      setLoading(false)
    })
    return () => {
      active = false
    }
  }, [blueprintId, enabled, version])

  return { entries, loading, error }
}

export function usePinTimeline(pinId: string | null) {
  const [entries, setEntries] = useState<TimelineEntry[]>([])
  const [loading, setLoading] = useState(Boolean(pinId))

  const reload = useCallback(async () => {
    if (!pinId) {
      setEntries([])
      setLoading(false)
      return
    }
    const { data } = await supabase.rpc("get_pin_timeline", { p_pin: pinId })
    setEntries((data as TimelineEntry[] | null) ?? [])
    setLoading(false)
  }, [pinId])

  useEffect(() => {
    setLoading(Boolean(pinId))
    void reload()
  }, [reload, pinId])
  useLiveReload(byColumn("pin_events", "pin_id", pinId), reload)

  return { entries, loading, reload }
}

export function usePinPhotos(pinId: string | null) {
  const [photos, setPhotos] = useState<PinPhoto[]>([])
  const reload = useCallback(async () => {
    if (!pinId) {
      setPhotos([])
      return
    }
    const { data } = await supabase.from("pin_photos").select("*").eq("pin_id", pinId).order("created_at", { ascending: true })
    setPhotos((data as PinPhoto[] | null) ?? [])
  }, [pinId])

  useEffect(() => {
    void reload()
  }, [reload])
  useLiveReload(byColumn("pin_photos", "pin_id", pinId), reload)

  return { photos, reload }
}

// Evidence lock (0033): once a pin was sent for review or verified (now or ever), it and its photos cannot be deleted.
// The database decides; this only lets the screen hide buttons that would be refused.
export function usePinEvidence(pinId: string | null, status: Pin["status"] | null) {
  const [locked, setLocked] = useState(false)
  useEffect(() => {
    if (!pinId) return setLocked(false)
    if (status === "for_review" || status === "verified") return setLocked(true)
    let active = true
    supabase.rpc("pin_has_evidence", { p_pin: pinId }).then(({ data }) => {
      if (active) setLocked(data === true)
    })
    return () => {
      active = false
    }
  }, [pinId, status])
  return locked
}

// Private files need a short-lived signed link. Cached so panning/zooming never re-requests it.
const urlCache = new Map<string, { url: string; expires: number }>()

export async function signedUrl(bucket: "blueprints" | "pin-photos" | "qa-evidence" | "snag-photos" | "identity-docs" | "daily-photos" | "issue-photos", path: string): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession()
  const key = `${session?.user.id ?? "anonymous"}/${bucket}/${path}`
  if (["pin-photos", "qa-evidence", "daily-photos"].includes(bucket)) {
    const allowed = await supabase.rpc("evidence_image_allowed", { p_bucket: bucket, p_path: path })
    if (allowed.error || !allowed.data) return null
  }
  const hit = urlCache.get(key)
  if (hit && hit.expires > Date.now() + 60_000) return hit.url
  const lifetime = ["pin-photos", "qa-evidence", "daily-photos"].includes(bucket) ? 300 : 3600
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, lifetime)
  if (error || !data) return null
  urlCache.set(key, { url: data.signedUrl, expires: Date.now() + lifetime * 1000 })
  return data.signedUrl
}

export function useSignedUrl(bucket: "blueprints" | "pin-photos" | "qa-evidence" | "snag-photos" | "identity-docs" | "daily-photos" | "issue-photos", path: string | null) {
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let active = true
    setUrl(null)
    setFailed(false)
    if (!path) return
    signedUrl(bucket, path).then((link) => {
      if (!active) return
      if (link) setUrl(link)
      else setFailed(true)
    })
    return () => {
      active = false
    }
  }, [bucket, path])

  return { url, failed }
}

// ---------- Images and PDF previews (done in the browser) ----------
const canvasToBlob = (canvas: HTMLCanvasElement, type: string, quality?: number) =>
  new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Could not create the image."))), type, quality),
  )

export type BlueprintPreview = { blob: Blob | null; width: number; height: number; ext: string }

// Keep one PDF worker open while the upload form labels/previews several pages.
export async function openBlueprintPdf(file: File) {
  const pdfjs = await import("pdfjs-dist")
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString()
  const task = pdfjs.getDocument({ data: await file.arrayBuffer() })
  const doc = await task.promise.catch(async error => { await task.destroy(); throw error })
  return {
    numPages: doc.numPages,
    destroy: () => task.destroy(),
    async renderPage(pageNumber: number, longestEdge = 3200): Promise<BlueprintPreview> {
      if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > doc.numPages) throw new Error(`Choose a page between 1 and ${doc.numPages}.`)
      const page = await doc.getPage(pageNumber)
      const base = page.getViewport({ scale: 1 })
      const viewport = page.getViewport({ scale: Math.min(6, longestEdge / Math.max(base.width, base.height)) })
      const canvas = document.createElement("canvas")
      canvas.width = Math.max(1, Math.round(viewport.width))
      canvas.height = Math.max(1, Math.round(viewport.height))
      try {
        const context = canvas.getContext("2d")
        if (!context) throw new Error("Your browser cannot draw the plan.")
        context.fillStyle = "#ffffff"
        context.fillRect(0, 0, canvas.width, canvas.height)
        await page.render({ canvasContext: context, viewport, canvas }).promise
        return { blob: await canvasToBlob(canvas, "image/png"), width: canvas.width, height: canvas.height, ext: "png" }
      } finally {
        canvas.width = 0; canvas.height = 0
        page.cleanup()
      }
    },
  }
}

export async function renderPdfPage(file: File, pageNumber: number) {
  const doc = await openBlueprintPdf(file)
  try { return await doc.renderPage(pageNumber) }
  finally { await doc.destroy() }
}

export async function imagePreview(file: File) {
  const bitmap = await createImageBitmap(file)
  const longest = Math.max(bitmap.width, bitmap.height)
  if (longest <= 4000) return { blob: null, width: bitmap.width, height: bitmap.height, ext: "" }
  const ratio = 4000 / longest
  const canvas = document.createElement("canvas")
  canvas.width = Math.round(bitmap.width * ratio)
  canvas.height = Math.round(bitmap.height * ratio)
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  return { blob: await canvasToBlob(canvas, "image/webp", 0.9), width: canvas.width, height: canvas.height, ext: "webp" }
}

// Photos from phones are 3-8 MB; the stored copy is at most 1600 px on the long side (JPEG).
export async function compressPhoto(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  const ratio = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement("canvas")
  canvas.width = Math.round(bitmap.width * ratio)
  canvas.height = Math.round(bitmap.height * ratio)
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  return canvasToBlob(canvas, "image/jpeg", 0.82)
}

// 360 px wide WebP for the left sheet strip.
async function makeThumbnail(source: Blob): Promise<Blob | null> {
  try {
    const bitmap = await createImageBitmap(source)
    const ratio = Math.min(1, 360 / bitmap.width)
    const canvas = document.createElement("canvas")
    canvas.width = Math.max(1, Math.round(bitmap.width * ratio))
    canvas.height = Math.max(1, Math.round(bitmap.height * ratio))
    const context = canvas.getContext("2d")
    if (!context) return null
    context.fillStyle = "#ffffff"
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    return await canvasToBlob(canvas, "image/webp", 0.8)
  } catch {
    return null // a missing thumbnail only means the strip falls back to the preview
  }
}

export function validateBlueprintFile(file: File | null): string {
  if (!file) return "Choose a file."
  if (!BLUEPRINT_TYPES.includes(file.type)) {
    return /\.(dwg|dxf)$/i.test(file.name)
      ? "DWG/DXF cannot be shown in the browser. In your CAD program, export the sheet as PDF or PNG and upload that."
      : "Use a PDF, PNG, JPEG or WebP file."
  }
  if (file.size > MAX_BLUEPRINT_BYTES) return `That file is ${(file.size / 1048576).toFixed(1)} MB. The limit is 25 MB.`
  if (file.size === 0) return "That file is empty."
  return ""
}

export type UploadInput = {
  projectId: string
  blueprintId?: string
  title: string
  level: string
  blueprintType: ClassifiedType // new plans only; a revision keeps its plan's type
  file: File
  page: number
  notes: string
  preparedPreview?: BlueprintPreview
  revisionId?: string // stable across a failed/uncertain save so a retry cannot duplicate a revision
  onCreated?: (blueprintId: string) => void
}

// Creates the blueprint (if new), stores the original + preview privately, then records the revision.
// The database decides the revision number and checks the folder; every failure is turned into a readable message.
export async function uploadBlueprintRevision(input: UploadInput, onStep: (message: string) => void): Promise<string> {
  const problem = validateBlueprintFile(input.file)
  if (problem) throw new Error(problem)

  const readSaved = async () => {
    if (!input.revisionId) return null
    const { data, error } = await supabase.from("blueprint_revisions").select("blueprint_id,project_id").eq("id", input.revisionId).maybeSingle()
    if (error) throw new Error("Could not confirm whether this page was saved. Retry when the connection is available.")
    if (data && (data.project_id !== input.projectId || (input.blueprintId && data.blueprint_id !== input.blueprintId))) throw new Error("This upload belongs to another plan.")
    return data?.blueprint_id as string | undefined
  }
  const saved = await readSaved()
  if (saved) return saved

  onStep("Preparing the preview...")
  const isPdf = input.file.type === "application/pdf"
  const preview = input.preparedPreview ?? (isPdf ? await renderPdfPage(input.file, input.page) : await imagePreview(input.file))

  let blueprintId = input.blueprintId
  if (!blueprintId) {
    onStep("Creating the blueprint...")
    const { data, error } = await supabase
      .from("blueprints")
      .insert({ project_id: input.projectId, title: input.title.trim(), level: input.level.trim() || null, blueprint_type: input.blueprintType })
      .select("id")
      .single()
    if (error || !data) throw new Error(error?.code === "42501" ? (error.message.includes("Assigned work") ? error.message : "You are not allowed to add blueprints to this project.") : (error?.message ?? "Could not create the blueprint."))
    blueprintId = data.id as string
    input.onCreated?.(blueprintId)
  }

  const stamp = Date.now()
  const safeName = input.file.name.replace(/[^\w.-]+/g, "_").slice(-80)
  const filePath = `${input.projectId}/${blueprintId}/${stamp}-${safeName}`
  const previewPath = preview.blob ? `${input.projectId}/${blueprintId}/${stamp}-preview.${preview.ext}` : filePath
  const uploaded: string[] = []
  let savingRevision = false

  try {
    onStep("Uploading the file...")
    const original = await supabase.storage.from("blueprints").upload(filePath, input.file, { contentType: input.file.type, upsert: false })
    if (original.error) throw new Error(original.error.message)
    uploaded.push(filePath)
    if (preview.blob) {
      onStep("Uploading the preview...")
      const copy = await supabase.storage.from("blueprints").upload(previewPath, preview.blob, { contentType: preview.blob.type, upsert: false })
      if (copy.error) throw new Error(copy.error.message)
      uploaded.push(previewPath)
    }
    onStep("Making the thumbnail...")
    let thumbPath: string | null = null
    const thumb = await makeThumbnail(preview.blob ?? input.file)
    if (thumb) {
      const candidate = `${input.projectId}/${blueprintId}/${stamp}-thumb.webp`
      const sent = await supabase.storage.from("blueprints").upload(candidate, thumb, { contentType: "image/webp", upsert: false })
      if (!sent.error) {
        thumbPath = candidate
        uploaded.push(candidate)
      }
    }
    onStep("Saving the revision...")
    savingRevision = true
    const { error } = await supabase.from("blueprint_revisions").insert({
      ...(input.revisionId ? { id: input.revisionId } : {}),
      blueprint_id: blueprintId,
      project_id: input.projectId,
      revision: 1, // replaced by the database
      file_path: filePath,
      file_name: input.file.name,
      mime_type: input.file.type,
      size_bytes: input.file.size,
      preview_path: previewPath,
      preview_width: preview.width,
      preview_height: preview.height,
      thumb_path: thumbPath,
      notes: input.notes.trim() || null,
    })
    if (error) throw new Error(error.message)
  } catch (error) {
    if (savingRevision && input.revisionId) {
      // A connection can fail after Postgres committed. Confirm before removing files;
      // an inconclusive read retains them and the next retry checks the same revision id.
      const saved = await readSaved()
      if (saved) return saved
    }
    if (uploaded.length) await supabase.storage.from("blueprints").remove(uploaded) // best effort
    throw new Error(
      error instanceof Error && /fetch|network/i.test(error.message)
        ? "The upload was interrupted by a network problem. Please try again."
        : error instanceof Error
          ? error.message
          : "Upload failed.",
    )
  }
  return blueprintId
}
