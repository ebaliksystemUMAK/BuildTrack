import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react"
import { createPortal } from "react-dom"
import BlueprintUploadDialog from "../BlueprintUploadDialog"
import Modal from "../Modal"
import { ContextMenu, type MenuItem } from "../ui/Menu"
import { Skeleton } from "../ui/Skeleton"
import CommandPalette, { type Command } from "./CommandPalette"
import CompareModal from "./CompareModal"
import ContextBar, { type StylePatch } from "./ContextBar"
import EditorToolbar, { Icon, ToolStrip, allowedTool, toolDefs, toolKeys, type ToolOptions } from "./EditorToolbar"
import ExportDialog, { type ExportRequest } from "./ExportDialog"
import FloatingPanel from "./FloatingPanel"
import PanelResizeHandle from "./PanelResizeHandle"
import Inspector, { type AnnotationPatch, type EditorRole, type InspectorProps, type LayerVisibility, type SelectionActions, type SheetTab } from "./Inspector"
import LabelDialog, { labelKinds } from "./LabelDialog"
import PinDetailsModal from "./PinDetailsModal"
import type { PinSection } from "../../lib/pinRecordsModel"
import PinQr from "./PinQr"
import { dbMessage, field } from "./PinParts"
import PresentationBar from "./PresentationBar"
import ShortcutsModal from "./ShortcutsModal"
import SheetFilmstrip from "./SheetFilmstrip"
import SheetSorter, { type SheetCount } from "./SheetSorter"
import StageCanvas, { type ContextTarget, type Measurement, type Pick, type Point, type Selection } from "./StageCanvas"
import { toArrange, useAnnotationOps } from "./useAnnotationOps"
import { canFormat, mergeFormat, resolveFormat, type TextFormat } from "../../lib/textFormat"
import { useAuth } from "../../lib/auth"
import { useTheme } from "../../lib/theme"
import {
  annotationColors,
  annotationKindLabels,
  categoryLabels,
  formatMeters,
  measureDistance,
  statusLabels,
  useAnnotations,
  useBlueprints,
  useProjectPins,
  useSheetHistory,
  signedUrl,
  useSignedUrl,
  type AnnotationColor,
  type EditorTool,
  type Pin,
  type PinCategory,
  type PinStatus,
  type ShapeKind,
} from "../../lib/blueprints"
import { useConfirm } from "../../lib/confirm"
import { bbox, type Pt } from "../../lib/geometry"
import { useEditorPrefs } from "../../lib/editorPrefs"
import { dockedPanelMaximum, panelWidth } from "../../lib/panelSize"
import { renderSheet, loadSheetImage } from "../../lib/exportSheet"
import type { LayerAction } from "../../lib/layers"
import { useProject, useProjectTeam } from "../../lib/projects"
import { useBlueprintAccess } from "../../lib/blueprintAccess"
import { canEditType, canWorkType, typeScopedRole, uploadTypes, type BlueprintType } from "../../lib/blueprintTypes"
import { supabase } from "../../lib/supabase"
import type { SymbolKey } from "../../lib/symbols"
import { useToast } from "../../lib/toast"
import { useUndoStack } from "../../lib/undoStack"
import { fitImageBox, itemBox, withGroupMembers, type AlignMode } from "../../lib/arrange"
import { IMAGE_ACCEPT, imageFilesFrom, prepareImage, uploadSheetImage } from "../../lib/sheetImages"
import { clientPinStatus } from "../../lib/clientPortalModel"
import { editorGuide } from "../../lib/pageGuides"
import { PageGuideModal } from "../shell/PageGuide"

const allStatuses = (Object.keys(statusLabels) as PinStatus[]).filter(status => status !== "for_review")
const secondary = "inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-line bg-surface px-4 py-2 text-sm font-semibold text-fg shadow-sm hover:border-brand/50 hover:text-brand-text disabled:opacity-60"
const primary = "inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-[#9e1f93] to-[#b4329f] px-4 py-2 text-sm font-bold text-white shadow-[0_8px_18px_-10px_rgba(158,31,147,0.85)] hover:from-[#8a1a80] hover:to-[#a52a92] disabled:opacity-60"
const HIGHLIGHT_OPACITY = 0.4
const NO_SELECTION: Selection = { pin: null, ann: [] }

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() => (typeof window !== "undefined" ? window.matchMedia(query).matches : false))
  useEffect(() => {
    const media = window.matchMedia(query)
    const update = () => setMatches(media.matches)
    update()
    media.addEventListener("change", update)
    return () => media.removeEventListener("change", update)
  }, [query])
  return matches
}

// The workspace editor: sheet strip on the left, the sheet in the middle, an inspector on the right and a presentation-style
// toolbar on top. Every panel can be hidden, floated or docked; Focus mode hides everything; Presentation mode is a clean
// read-only show. `canEdit` is what the role may do; the database enforces it as well.
// `canUpload` (sheets and revisions) defaults to `canEdit`; Admins get uploads without editing (0040).
// `blueprintType` shows only that type's plans (Project > Blueprints > type); Engineers / Foremen additionally need the
// type's Assigned work access for any change (20261028130000), View only types open read-only.
export default function BlueprintEditor({ projectId, role, canEdit, canUpload = canEdit, blueprintType = null, onExit }: { projectId: string; role: EditorRole; canEdit: boolean; canUpload?: boolean; blueprintType?: BlueprintType | null; onExit: () => void }) {
  const { profile, can } = useAuth()
  const toast = useToast()
  const confirm = useConfirm()
  const { project, loading: projectLoading, notFound } = useProject(projectId)
  const { blueprints: allBlueprints, loading, error, reload: reloadBlueprints } = useBlueprints(projectId)
  const [typeFilter, setTypeFilter] = useState<BlueprintType | null>(blueprintType)
  const blueprints = useMemo(() => (typeFilter ? allBlueprints.filter((bp) => bp.blueprint_type === typeFilter) : allBlueprints), [allBlueprints, typeFilter])
  const access = useBlueprintAccess(typeScopedRole(role) ? projectId : null)
  const { team: projectTeam } = useProjectTeam(projectId)
  const { pins, setPins, loading: pinsLoading, reload: reloadPins } = useProjectPins(projectId)
  const undoStack = useUndoStack()
  const { prefs, update: setPrefs, reset: resetPrefs } = useEditorPrefs()
  const desktop = useMediaQuery("(min-width: 1024px)")
  const [viewportWidth, setViewportWidth] = useState(window.innerWidth)
  useEffect(() => {
    const resize = () => setViewportWidth(window.innerWidth)
    window.addEventListener("resize", resize)
    return () => window.removeEventListener("resize", resize)
  }, [])
  const panelMaximum = dockedPanelMaximum(viewportWidth)
  const inspectorWidth = panelWidth(prefs.panelWidth, panelMaximum)

  const [blueprintId, setBlueprintId] = useState<string | null>(new URLSearchParams(window.location.search).get("sheet"))
  const [revisionId, setRevisionId] = useState<string | null>(null)
  const [tool, setTool] = useState<EditorTool>("select")
  const [shapeKind, setShapeKind] = useState<ShapeKind>("rect")
  const [color, setColor] = useState<AnnotationColor>("orange")
  const [penSize, setPenSize] = useState(0.2)
  const [highlighterSize, setHighlighterSize] = useState(1.4)
  const [textSize, setTextSize] = useState(1.6)
  const [symbol, setSymbol] = useState<SymbolKey>("hazard")
  const [symbolSize, setSymbolSize] = useState(4)
  const [stampStatus, setStampStatus] = useState<PinStatus>("in_progress")
  const [selection, setSelection] = useState<Selection>(NO_SELECTION)
  const [hidden, setHidden] = useState<Set<PinStatus>>(new Set())
  const [layers, setLayers] = useState<LayerVisibility>({ pins: true, notes: true, shapes: true, drawings: true })
  const [measurements, setMeasurements] = useState<Measurement[]>([])
  const [draftPin, setDraftPin] = useState<Point | null>(null)
  const [draftNote, setDraftNote] = useState<Point | null>(null)
  const [draftText, setDraftText] = useState<Point | null>(null)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [detailsSection, setDetailsSection] = useState<PinSection>("details")
  // A link's ?pintab= (or older ?worktab=) opens that section of the linked pin's panel, once.
  const [pinLink, setPinLink] = useState<{ pinId: string; search: string } | null>(null)
  const [calibrating, setCalibrating] = useState(false)
  const [upload, setUpload] = useState<"new" | "revision" | null>(null)
  const [exporting, setExporting] = useState(false)
  const [comparing, setComparing] = useState(false)
  const [commands, setCommands] = useState(false)
  const [shortcuts, setShortcuts] = useState(false)
  const [guideOpen, setGuideOpen] = useState(false) // View > Page guide: how to use the editor for this role
  const [leftOpen, setLeftOpen] = useState(false)
  const [rightOpen, setRightOpen] = useState(false)
  const [sheetTab, setSheetTab] = useState<SheetTab>("pins")
  const [historyVersion, setHistoryVersion] = useState(0)
  const [focus, setFocus] = useState(false)
  const [present, setPresent] = useState(false)
  const [laser, setLaser] = useState(false)
  const [legend, setLegend] = useState(false)
  const [fitSignal, setFitSignal] = useState(0)
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set())
  const [hiddenPinIds, setHiddenPinIds] = useState<Set<string>>(new Set())
  const [showBase, setShowBase] = useState(true)
  const [imageBusy, setImageBusy] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const imageSources = useRef(new Map<string, CanvasImageSource>())
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null)
  const [styleClipboard, setStyleClipboard] = useState<Record<string, unknown> | null>(null)
  const zoom = useRef<{ fit: () => void; zoomIn: () => void; zoomOut: () => void } | null>(null)
  const [zoomPercent, setZoomPercent] = useState(100)
  const [qrOpen, setQrOpen] = useState(false)
  const [labelFor, setLabelFor] = useState<string | null>(null)
  const imageAt = useRef<Point | null>(null) // where "Add here > Picture" was chosen
  const issueAfter = useRef(false) // "Report an issue here": the new pin starts as an issue
  const { resolved: themeResolved, setMode: setThemeMode } = useTheme()
  const imageCache = useRef<{ url: string; bitmap: CanvasImageSource } | null>(null)

  const blueprint = blueprints.find((bp) => bp.id === blueprintId) ?? null
  const revisions = blueprint?.blueprint_revisions ?? []
  const revision = revisions.find((r) => r.id === revisionId) ?? revisions[0] ?? null
  const isLatest = !revision || revision.id === revisions[0]?.id
  const { annotations, setAnnotations, reload: reloadAnnotations } = useAnnotations(blueprint?.id ?? null)
  const { url } = useSignedUrl("blueprints", revision?.preview_path ?? null)

  // Per-type access: Admins and Clients keep their role rules; Engineers / Foremen need Assigned work on this sheet's type.
  const levelForType = (type: BlueprintType) => (typeScopedRole(role) ? access.levelFor(profile?.id, type) : "view")
  const sheetLevel = blueprint ? levelForType(blueprint.blueprint_type) : "none"
  const sheetCanEdit = canEdit && (!typeScopedRole(role) || canEditType(role, sheetLevel))
  const newSheetTypes = uploadTypes(role, levelForType, role === "admin" && canUpload).filter((type) => !typeFilter || type === typeFilter)
  const canAddSheet = canUpload && newSheetTypes.length > 0
  const canReviseSheet = canUpload && Boolean(blueprint) && (role === "admin" || canEditType(role, sheetLevel))
  const editable = sheetCanEdit && isLatest && !present
  // Admins read and upload sheets only; field reporting is for the project's Engineers and Foremen (0040) holding the type.
  const canReport = canWorkType(role, sheetLevel)
  const canStamp = (editable || (role === "foreman" && canReport && !present)) && !present
  // Foreman pickers only offer Foremen who may take work of this sheet's type (the database refuses the others).
  const team = useMemo(() => projectTeam.map((member) => (member.role === "foreman" && blueprint && access.grants.length ? { ...member, can_take_work: access.levelFor(member.user_id, blueprint.blueprint_type) === "assigned" } : member)), [projectTeam, blueprint, access.grants, access.levelFor])
  const canSeeHistory = role !== "client"
  const stampStatuses: PinStatus[] = editable ? allStatuses : ["in_progress"]
  const baseLocked = Boolean(blueprint?.base_locked)
  const sheet = useMemo(() => ({ width: revision?.preview_width ?? 1000, height: revision?.preview_height ?? 1000 }), [revision?.preview_width, revision?.preview_height])

  const sheetPins = useMemo(() => pins.filter((pin) => pin.blueprint_id === blueprint?.id), [pins, blueprint?.id])
  const visiblePins = useMemo(() => sheetPins.filter((pin) => !hidden.has(clientPinStatus(pin.status))), [sheetPins, hidden])
  const numberOf = useCallback((pin: Pin) => sheetPins.indexOf(pin) + 1, [sheetPins])
  const counts = useMemo(() => {
    const map = new Map<string, SheetCount>()
    for (const pin of pins) {
      const entry = map.get(pin.blueprint_id) ?? { total: 0, issues: 0, verified: 0 }
      entry.total++
      if (pin.status === "issue") entry.issues++
      if (pin.status === "verified") entry.verified++
      map.set(pin.blueprint_id, entry)
    }
    return map
  }, [pins])
  const selectedPin = selection.pin ? (pins.find((pin) => pin.id === selection.pin) ?? null) : null
  const selectedAnnotations = useMemo(() => annotations.filter((a) => selection.ann.includes(a.id)), [annotations, selection.ann])
  const selectedAnnotation = selectedAnnotations.length === 1 ? selectedAnnotations[0] : null
  const hasSelection = Boolean(selection.pin) || selection.ann.length > 0
  const scaleWidthM = blueprint?.scale_width_m ? Number(blueprint.scale_width_m) : null
  const { entries: historyEntries, loading: historyLoading, error: historyError } = useSheetHistory(blueprint?.id ?? null, canSeeHistory && sheetTab === "history" && !hasSelection, historyVersion)
  const touched = useCallback(() => setHistoryVersion((value) => value + 1), [])

  const ops = useAnnotationOps({ projectId, blueprintId: blueprint?.id ?? null, annotations, setAnnotations, reload: reloadAnnotations, undo: undoStack, toast, confirm, touched, sheet })

  // Keep a valid sheet selected.
  useEffect(() => {
    if (!blueprints.length) return setBlueprintId(null)
    if (!blueprintId || !blueprints.some((bp) => bp.id === blueprintId)) setBlueprintId(blueprints[0].id)
  }, [blueprints, blueprintId])

  useEffect(() => {
    setRevisionId(null)
    setSelection(NO_SELECTION)
    setMeasurements([])
    setDraftPin(null)
    setDraftNote(null)
    setDraftText(null)
    setHiddenIds(new Set())
    setHiddenPinIds(new Set())
    setShowBase(true)
    undoStack.clear()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blueprintId])

  useEffect(() => {
    if (!stampStatuses.includes(stampStatus)) setStampStatus(stampStatuses[0])
  }, [stampStatuses, stampStatus])

  const chooseTool = useCallback((next: EditorTool) => {
    if (next === "image") {
      fileInput.current?.click() // the picker opens at once; the tool itself stays on Select
      return
    }
    setTool(next)
    setDraftPin(null)
    if (next !== "select") setSelection(NO_SELECTION)
  }, [])

  // ---------- Selecting ----------
  const select = useCallback((next: Selection) => {
    setSelection(next)
    if (next.pin || next.ann.length) setRightOpen(true)
  }, [])

  // Deep link from other pages (verification queue, issue register): ?pin=<id> opens that pin on its own sheet, once.
  const pendingPin = useRef<string | null>(new URLSearchParams(window.location.search).get("pin"))
  const pendingSearch = useRef(window.location.search)
  const [pinLinkVersion, setPinLinkVersion] = useState(0)
  useEffect(() => {
    const changed = () => {
      const params=new URLSearchParams(window.location.search)
      pendingPin.current=params.get("pin")
      pendingSearch.current=window.location.search
      const sheetId=params.get("sheet")
      if(sheetId) setBlueprintId(sheetId)
      setPinLinkVersion(v => v + 1)
    }
    window.addEventListener("popstate", changed)
    return () => window.removeEventListener("popstate", changed)
  }, [])
  useEffect(() => {
    const id = pendingPin.current
    if (!id || loading || pinsLoading) return
    const target = pins.find((item) => item.id === id)
    if (!target) {
      pendingPin.current = null
      toast.info("That task is not available", "It may be on a blueprint type you do not have access to.")
      return
    }
    // A link to a pin on another type's plan switches the type shown (only types you may see are loaded at all).
    const targetSheet = allBlueprints.find((bp) => bp.id === target.blueprint_id)
    if (typeFilter && targetSheet && targetSheet.blueprint_type !== typeFilter) return setTypeFilter(targetSheet.blueprint_type)
    if (blueprintId !== target.blueprint_id) return setBlueprintId(target.blueprint_id)
    pendingPin.current = null
    setPinLink({ pinId: id, search: pendingSearch.current })
    select({ pin: id, ann: [] })
    const url = new URL(window.location.href)
    for (const key of ["pin", "pintab", "worktab"]) url.searchParams.delete(key)
    window.history.replaceState({}, "", url)
  }, [pins, allBlueprints, typeFilter, blueprintId, loading, pinsLoading, select, pinLinkVersion, toast])

  const pick = useCallback((target: Pick, additive: boolean) => {
    if (!target) {
      if (!additive) setSelection(NO_SELECTION)
      return
    }
    if (target.type === "pin") return select({ pin: target.id, ann: [] })
    const members = withGroupMembers(annotations, [target.id])
    if (additive) {
      setSelection((current) => {
        const has = current.ann.includes(target.id)
        const ann = has ? current.ann.filter((id) => !members.includes(id)) : [...new Set([...current.ann, ...members])]
        return { pin: null, ann }
      })
      setRightOpen(true)
    } else select({ pin: null, ann: members })
  }, [annotations, select])

  const marquee = useCallback((ids: string[], additive: boolean) => {
    const members = withGroupMembers(annotations, ids)
    setSelection((current) => ({ pin: null, ann: additive ? [...new Set([...current.ann, ...members])] : members }))
    if (members.length) setRightOpen(true)
  }, [annotations])

  const visibleAnnotations = useMemo(() => annotations.filter((a) => !a.locked && !hiddenIds.has(a.id) && (a.kind === "shape" ? layers.shapes : a.kind === "note" || a.kind === "text" || a.kind === "image" ? layers.notes : layers.drawings)), [annotations, layers, hiddenIds])
  const selectAll = useCallback(() => {
    setTool("select")
    setSelection({ pin: null, ann: visibleAnnotations.map((a) => a.id) })
  }, [visibleAnnotations])

  // ---------- Pins ----------
  const setStatus = async (pin: Pin, status: PinStatus) => {
    if (pin.status === status) return
    const before = pin.status
    setPins((current) => current.map((item) => (item.id === pin.id ? { ...item, status } : item)))
    const { data, error: updateError } = await supabase.from("pins").update({ status }).eq("id", pin.id).select("id")
    if (updateError || !data?.length) {
      setPins((current) => current.map((item) => (item.id === pin.id ? { ...item, status: before } : item)))
      return toast.error("Status not changed", updateError ? dbMessage(updateError) : "You may not be allowed to edit this pin.")
    }
    toast.success(`Marked ${statusLabels[status].toLowerCase()}`)
    void reloadPins()
    touched()
  }

  const report = async (pin: Pin, status: "in_progress" | "for_review", note: string) => {
    const { error: rpcError } = await supabase.rpc("report_pin_progress", { p_pin: pin.id, p_status: status, p_note: note.trim() || null })
    if (rpcError) throw new Error(rpcError.message.replace(/^.*?(Only a Foreman|Foremen can|A verified|This work is not assigned|Complete every checklist item)/i, "$1"))
    toast.success(status === "for_review" ? "Sent to the engineer for review" : "Marked as in progress")
    await reloadPins()
    touched()
  }

  const stamp = async (pinId: string) => {
    const pin = pins.find((item) => item.id === pinId)
    if (!pin) return
    if (editable) return setStatus(pin, stampStatus)
    if (pin.assigned_to !== profile?.id) return toast.info("Not your work", "Only the foreman this pin is assigned to can report on it.")
    if (stampStatus === "in_progress" || stampStatus === "for_review") {
      try {
        await report(pin, stampStatus, "")
      } catch (reportError) {
        toast.error("Could not stamp the pin", reportError instanceof Error ? reportError.message : undefined)
      }
    }
  }

  const createPin = async (title: string, category: PinCategory): Promise<string | null> => {
    if (!draftPin || !blueprint || !revision) return "Nothing to place the pin on."
    const { data, error: insertError } = await supabase
      .from("pins")
      .insert({ project_id: projectId, blueprint_id: blueprint.id, revision_id: revision.id, x: draftPin.x, y: draftPin.y, title, category, discipline: blueprint.discipline })
      .select("*")
      .single()
    if (insertError || !data) return insertError?.code === "42501" ? "You are not allowed to add pins to this project." : (insertError?.message ?? "Could not create the pin.")
    const created = { ...(data as Pin), x: Number((data as Pin).x), y: Number((data as Pin).y) }
    setPins((current) => [...current, created])
    setDraftPin(null)
    setTool("select")
    select({ pin: created.id, ann: [] })
    toast.success("Pin added", "Add details, a deadline and a task in the panel.")
    if (issueAfter.current) {
      issueAfter.current = false
      void setStatus(created, "issue")
    }
    touched()
    return null
  }

  const writePin = async (id: string, patch: Record<string, unknown>) => {
    const { data, error: patchError } = await supabase.from("pins").update(patch).eq("id", id).select("id")
    return !patchError && Boolean(data?.length)
  }

  const movePin = async (id: string, x: number, y: number) => {
    const before = pins.find((pin) => pin.id === id)
    if (!before) return
    setPins((current) => current.map((pin) => (pin.id === id ? { ...pin, x, y } : pin)))
    if (!(await writePin(id, { x, y }))) {
      setPins((current) => current.map((pin) => (pin.id === id ? before : pin)))
      return toast.error("The pin could not be moved", before.locked ? "It is locked. Unlock it first." : "You may not be allowed to edit it.")
    }
    const from = { x: before.x, y: before.y }
    undoStack.push({
      label: "Move pin",
      undo: async () => (await writePin(id, from)) && (await reloadPins(), true),
      redo: async () => (await writePin(id, { x, y })) && (await reloadPins(), true),
    })
    touched()
  }

  const deletePin = async (pin: Pin) => {
    if (pin.locked) return toast.error("This pin is locked", "Unlock it first, then delete it.")
    if (!(await confirm({ title: `Delete "${pin.title}"?`, message: "Its tasks, comments and photos are deleted too. This cannot be undone.", confirmLabel: "Delete pin", tone: "danger" }))) return
    const { data, error: deleteError } = await supabase.from("pins").delete().eq("id", pin.id).select("id")
    if (deleteError) return toast.error("Could not delete the pin", dbMessage(deleteError))
    if (!data?.length) return toast.error("Could not delete the pin", pin.status === "verified" ? "Verified work is evidence and cannot be deleted." : "You are not allowed to delete this pin.")
    setPins((current) => current.filter((item) => item.id !== pin.id))
    setSelection(NO_SELECTION)
    setDetailsOpen(false)
    toast.success("Pin deleted")
    touched()
  }

  const togglePinLock = async (pin: Pin) => {
    const next = !pin.locked
    setPins((current) => current.map((p) => (p.id === pin.id ? { ...p, locked: next } : p)))
    if (!(await writePin(pin.id, { locked: next }))) {
      setPins((current) => current.map((p) => (p.id === pin.id ? pin : p)))
      return toast.error("Could not change the lock", "You may not be allowed to edit this pin.")
    }
    undoStack.push({
      label: next ? "Lock pin" : "Unlock pin",
      undo: async () => (await writePin(pin.id, { locked: !next })) && (await reloadPins(), true),
      redo: async () => (await writePin(pin.id, { locked: next })) && (await reloadPins(), true),
    })
    touched()
  }

  // ---------- Creating things on the sheet ----------
  const afterCreate = (ids: string[], stayInTool = false) => {
    if (!stayInTool) setTool("select")
    if (ids.length) select({ pin: null, ann: ids })
  }

  const createNote = async (text: string, noteColor: AnnotationColor): Promise<string | null> => {
    if (!draftNote) return "Nothing to attach the note to."
    const { created, failure } = await ops.insert([{ kind: "note", x: draftNote.x, y: draftNote.y, text, color: noteColor }], "Add note")
    if (!created.length) return failure
    setDraftNote(null)
    afterCreate(created.map((a) => a.id))
    toast.success("Note added")
    return null
  }

  const createText = async (text: string, textColor: AnnotationColor): Promise<string | null> => {
    if (!draftText) return "Nothing to attach the text to."
    const { created, failure } = await ops.insert([{ kind: "text", x: draftText.x, y: draftText.y, w: Math.max(1, Math.min(28, 100 - draftText.x)), text, color: textColor, font_size: textSize }], "Add text")
    if (!created.length) return failure
    setDraftText(null)
    afterCreate(created.map((a) => a.id))
    return null
  }

  const createShape = async (shape: { shape: ShapeKind; x: number; y: number; w: number; h: number }) => {
    const { created, failure } = await ops.insert([{ kind: "shape", shape: shape.shape, x: shape.x, y: shape.y, w: Math.min(shape.w, 100 - shape.x), h: Math.min(shape.h, 100 - shape.y), color }], "Add shape")
    if (!created.length) return toast.error("Shape not added", failure)
    afterCreate(created.map((a) => a.id))
  }

  const createStroke = async (kind: "draw" | "highlight", points: Pt[]) => {
    const box = bbox(points)
    const { failure } = await ops.insert([{ kind, x: box.x, y: box.y, points, color, stroke: kind === "highlight" ? highlighterSize : penSize, opacity: kind === "highlight" ? HIGHLIGHT_OPACITY : 1 }], kind === "highlight" ? "Highlight" : "Pen stroke")
    if (failure) toast.error("The drawing was not saved", failure)
  }

  const createLine = async (kind: "arrow" | "dimension", points: Pt[]) => {
    const box = bbox(points)
    const { created, failure } = await ops.insert([{ kind, x: box.x, y: box.y, points, color }], kind === "arrow" ? "Arrow" : "Dimension line")
    if (!created.length) return toast.error("It was not saved", failure)
    afterCreate(created.map((a) => a.id))
    if (kind === "dimension" && !scaleWidthM) toast.info("Shown in pixels", canEdit ? "Set the sheet scale with the measuring tape to read metres." : "This sheet has no scale yet.")
  }

  const createPath = async (kind: "polyline" | "area" | "cloud", points: Pt[]) => {
    const box = bbox(points)
    const { created, failure } = await ops.insert([{ kind, x: box.x, y: box.y, points, color }], kind === "area" ? "Area measurement" : kind === "cloud" ? "Revision cloud" : "Path measurement")
    if (!created.length) return toast.error("It was not saved", failure)
    afterCreate(created.map((a) => a.id))
    if (kind !== "cloud" && !scaleWidthM) toast.info("Saved in pixels", canEdit ? "Set the sheet scale with the measuring tape to read metres." : "This sheet has no scale yet.")
  }

  const placeSymbol = async (point: Point) => {
    const x = Math.max(0, Math.min(point.x - symbolSize / 2, 100 - symbolSize))
    const heightPct = (symbolSize * sheet.width) / sheet.height
    const y = Math.max(0, Math.min(point.y - heightPct / 2, 100 - heightPct))
    const { created, failure } = await ops.insert([{ kind: "symbol", symbol, x, y, w: symbolSize, color }], "Add symbol")
    if (!created.length) return toast.error("The symbol was not added", failure)
    afterCreate(created.map((a) => a.id), true) // keep placing the same symbol; press V or Esc to stop
  }

  const resizeAnnotation = (id: string, box: { x: number; y: number; w: number; h: number }) => {
    const a = annotations.find((item) => item.id === id)
    if (a) void ops.patchEach([{ id, patch: a.kind === "text" || a.kind === "symbol" ? { w: box.w } : { x: box.x, y: box.y, w: box.w, h: box.h } }], "It could not be resized", "Resize")
  }

  const rotateAnnotation = (id: string, degrees: number) => {
    void ops.patchEach([{ id, patch: { rotation: degrees } }], "It could not be rotated", "Rotate")
  }

  // Pictures: from the Image tool, a file dropped on the sheet, or an image pasted from the clipboard.
  const addImages = async (files: File[], at: Point | null) => {
    if (!blueprint || !editable) return
    const list = files.slice(0, 10)
    if (files.length > list.length) toast.info("Adding the first 10 pictures", "Add the rest in a second batch.")
    setImageBusy(true)
    const made: string[] = []
    let failureText = ""
    for (const [index, file] of list.entries()) {
      try {
        const prepared = await prepareImage(file)
        const path = await uploadSheetImage(projectId, blueprint.id, prepared)
        const box = fitImageBox({ width: prepared.width, height: prepared.height }, sheet, 26, (at?.x ?? 50) + index * 3, (at?.y ?? 50) + index * 3)
        const caption = file.name.replace(/\.[^.]+$/, "").slice(0, 120).trim()
        const { created, failure } = await ops.insert([{ kind: "image", ...box, image_path: path, ...(caption ? { text: caption } : {}) }], "Add image")
        if (created.length) made.push(...created.map((a) => a.id))
        else failureText = failure
      } catch (problem) {
        failureText = problem instanceof Error ? problem.message : "The picture could not be added."
      }
    }
    setImageBusy(false)
    if (failureText) toast.error(made.length ? "Some pictures were not added" : "The picture was not added", failureText)
    if (made.length) {
      setTool("select")
      select({ pin: null, ann: made })
      toast.success(made.length === 1 ? "Picture added" : `${made.length} pictures added`, "Drag to move, the square handle resizes and the round handle rotates.")
    }
  }

  // ---------- Selection actions (toolbar, inspector, keyboard, context menu) ----------
  const ids = selection.ann
  const copySelection = () => {
    const n = ops.copy(ids)
    if (n) toast.info(`Copied ${n} item${n === 1 ? "" : "s"}`, "Ctrl+V pastes (also on another sheet).")
  }
  const cutSelection = async () => {
    if (!ops.copy(ids)) return
    await ops.remove(ids)
  }
  const pasteClipboard = async () => {
    const created = await ops.paste()
    if (created.length) {
      setTool("select")
      select({ pin: null, ann: created.map((a) => a.id) })
    }
  }
  const duplicateSelection = async () => {
    const created = await ops.duplicate(ids)
    if (created.length) select({ pin: null, ann: created.map((a) => a.id) })
  }
  const groupSelection = async () => {
    if (await ops.group(ids)) setSelection((current) => ({ ...current }))
  }
  const copyStyle = () => {
    const first = selectedAnnotations[0]
    if (!first) return
    setStyleClipboard(ops.styleOf(first))
    toast.info("Style copied", "Select other items and choose Apply style.")
  }
  const applyStyle = () => {
    if (styleClipboard && ids.length) void ops.applyStyle(ids, styleClipboard)
  }
  const lockSelection = (locked: boolean) => void ops.setLocked(ids, locked)

  // One item against the edges / centre of the sheet (several items align to each other with `align`).
  const alignToSheet = (mode: AlignMode) => {
    const items = selectedAnnotations
    if (!items.length) return
    const boxes = items.map((a) => itemBox(toArrange(a), sheet))
    const left = Math.min(...boxes.map((b) => b.x))
    const right = Math.max(...boxes.map((b) => b.x + b.w))
    const topEdge = Math.min(...boxes.map((b) => b.y))
    const bottom = Math.max(...boxes.map((b) => b.y + b.h))
    const dx = mode === "left" ? -left : mode === "right" ? 100 - right : mode === "center" ? 50 - (left + right) / 2 : 0
    const dy = mode === "top" ? -topEdge : mode === "bottom" ? 100 - bottom : mode === "middle" ? 50 - (topEdge + bottom) / 2 : 0
    if (Math.abs(dx) > 0.001 || Math.abs(dy) > 0.001) void ops.moveBy(ids, dx, dy, `Align ${mode} on the sheet`)
  }
  // Font, bold, alignment, list and spacing for text boxes and notes: each item keeps its own other settings.
  const formatSelection = (patch: TextFormat, label: string) => {
    const targets = selectedAnnotations.filter((a) => canFormat(a.kind))
    if (targets.length) void ops.patchEach(targets.map((a) => ({ id: a.id, patch: { format: mergeFormat(a.format, patch) } })), "Could not save the text format", label)
  }
  const styleSelection = (patch: StylePatch, label: string) => {
    const { rotation, ...style } = patch
    if (rotation !== undefined) void ops.patchMany(ids, { rotation }, "It could not be rotated", label)
    else void ops.applyStyle(ids, style, label)
  }
  const shareLink = async () => {
    const url = new URL(window.location.href)
    url.search = ""
    url.searchParams.set("project", projectId)
    if (selection.pin) url.searchParams.set("pin", selection.pin)
    try {
      await navigator.clipboard.writeText(url.toString())
      toast.success("Link copied", selection.pin ? "It opens this pin. People need access to the project." : "People need access to the project to open it.")
    } catch {
      toast.info("Copy this link", url.toString())
    }
  }

  const actions: SelectionActions = {
    align: (mode: AlignMode) => void ops.align(ids, mode),
    alignToSheet,
    distribute: (axis) => void ops.distribute(ids, axis),
    group: () => void groupSelection(),
    ungroup: () => void ops.ungroup(ids),
    copy: copySelection,
    duplicate: () => void duplicateSelection(),
    paste: () => void pasteClipboard(),
    remove: () => void ops.remove(ids).then((done) => done && setSelection(NO_SELECTION)),
    setLocked: lockSelection,
    layer: (action: LayerAction) => void ops.layer(ids, action),
    copyStyle,
    applyStyle,
    hasStyle: Boolean(styleClipboard),
    hasClipboard: ops.hasClipboard(),
  }

  const deleteSelection = async () => {
    if (selectedPin) return deletePin(selectedPin)
    if (ids.length && (await ops.remove(ids))) setSelection(NO_SELECTION)
  }

  // ---------- Removing a sheet ----------
  const canDeleteSheet = can("blueprints.manage")
  const deleteSheet = async () => {
    if (!blueprint) return
    const name = blueprint.title
    const revisionCount = blueprint.blueprint_revisions.length
    // Evidence lock (0033): work that was sent for review or verified keeps its record, so its sheet stays too.
    const evidence = sheetPins.filter((pin) => pin.status === "for_review" || pin.status === "verified" || pin.verified_at).length
    if (evidence) return toast.error("This sheet holds evidence", `${evidence} work pin${evidence === 1 ? " was" : "s were"} sent for review or verified. That record stays, so the sheet cannot be deleted. Upload a new revision instead.`)
    if (!(await confirm({
      title: `Delete the sheet "${name}"?`,
      message: `Its ${revisionCount} revision${revisionCount === 1 ? "" : "s"}, ${sheetPins.length} pin${sheetPins.length === 1 ? "" : "s"} (with their photos and comments) and ${annotations.length} drawn item${annotations.length === 1 ? "" : "s"} are removed for everyone. This cannot be undone.`,
      confirmLabel: "Delete sheet",
      tone: "danger",
    }))) return
    // Remember the files first: once the rows are gone there is nothing left to look them up by.
    const photos = sheetPins.length ? ((await supabase.from("pin_photos").select("path").in("pin_id", sheetPins.map((pin) => pin.id))).data ?? []).map((row) => String(row.path)) : []
    const files = [...blueprint.blueprint_revisions.flatMap((r) => [r.file_path, r.preview_path, r.thumb_path]), ...annotations.map((a) => a.image_path)].filter((path): path is string => Boolean(path))
    const { data, error: deleteError } = await supabase.from("blueprints").delete().eq("id", blueprint.id).select("id")
    if (deleteError) return toast.error("Could not delete the sheet", dbMessage(deleteError))
    if (!data?.length) return toast.error("Could not delete the sheet", "You are not allowed to delete sheets.")
    void supabase.storage.from("blueprints").remove([...new Set(files)]) // best effort: the sheet is already gone
    if (photos.length) void supabase.storage.from("pin-photos").remove(photos)
    setSelection(NO_SELECTION)
    setBlueprintId(null)
    toast.success("Sheet deleted", name)
    await Promise.all([reloadBlueprints(), reloadPins()])
    touched()
  }

  // ---------- Measuring tape (kept on screen only) ----------
  const measured = (a: Point, b: Point) => {
    setMeasurements((current) => [...current, { a, b }].slice(-8))
    if (revision) {
      const { px, meters } = measureDistance(a, b, revision.preview_width, revision.preview_height, scaleWidthM)
      toast.info(meters !== null ? `Length: ${formatMeters(meters)}` : `Length: ${Math.round(px)} px`, meters === null ? (canEdit ? "Set the scale to read it in metres." : "This sheet has no scale yet.") : undefined)
    }
  }

  const calibrate = async (realMeters: number): Promise<string | null> => {
    const last = measurements[measurements.length - 1]
    if (!last || !revision || !blueprint) return "Measure a known length first."
    const { px } = measureDistance(last.a, last.b, revision.preview_width, revision.preview_height, null)
    if (px < 5) return "That line is too short to calibrate."
    const width = (realMeters * revision.preview_width) / px
    if (!(width > 0 && width <= 100000)) return "That length gives an unrealistic sheet size. Check the number."
    const { data, error: saveError } = await supabase.from("blueprints").update({ scale_width_m: Math.round(width * 1000) / 1000 }).eq("id", blueprint.id).select("id")
    if (saveError || !data?.length) return saveError ? dbMessage(saveError) : "You may not be allowed to change the scale."
    await reloadBlueprints()
    toast.success("Scale saved", `The sheet is ${formatMeters(width)} wide.`)
    touched()
    return null
  }

  const toggleBaseLock = async () => {
    if (!blueprint) return
    const next = !blueprint.base_locked
    if (next && !(await confirm({ title: "Lock the base layer?", message: "No new revisions can be uploaded and the sheet scale cannot change until you unlock it again.", confirmLabel: "Lock base layer" }))) return
    const { data, error: lockError } = await supabase.from("blueprints").update({ base_locked: next }).eq("id", blueprint.id).select("id")
    if (lockError || !data?.length) return toast.error("Could not change the base layer lock", lockError ? dbMessage(lockError) : "You may not be allowed to.")
    await reloadBlueprints()
    toast.success(next ? "Base layer locked" : "Base layer unlocked")
    touched()
  }

  const lockAll = async (locked: boolean) => {
    if (!blueprint) return
    const { error: rpcError } = await supabase.rpc("set_sheet_items_locked", { p_blueprint: blueprint.id, p_locked: locked })
    if (rpcError) return toast.error("Could not change the locks", rpcError.message.replace(/^.*?(You are not allowed[^"]*)/i, "$1"))
    await Promise.all([reloadAnnotations(), reloadPins()])
    toast.success(locked ? "Every item is locked" : "Every item is unlocked")
    touched()
  }

  // ---------- Undo / redo ----------
  const runUndo = async (direction: "undo" | "redo") => {
    const result = await (direction === "undo" ? undoStack.undo() : undoStack.redo())
    if (!result) return
    if (!result.ok) toast.error(`Could not ${direction}: ${result.label}`, "The item may be locked or was changed by someone else.")
    else toast.info(`${direction === "undo" ? "Undid" : "Redid"}: ${result.label}`)
    touched()
  }

  // ---------- View modes ----------
  const fit = useCallback(() => zoom.current?.fit(), [])
  const toggleFocus = useCallback(() => {
    setFocus((value) => !value)
    setFitSignal((value) => value + 1)
  }, [])
  const startPresent = useCallback(() => {
    setFocus(false)
    setPresent(true)
    setTool("select")
    setSelection(NO_SELECTION)
    setFitSignal((value) => value + 1)
    void document.documentElement.requestFullscreen?.().catch(() => undefined)
  }, [])
  const stopPresent = useCallback(() => {
    setPresent(false)
    setLaser(false)
    setLegend(false)
    setFitSignal((value) => value + 1)
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined)
  }, [])
  const presentRef = useRef(present)
  presentRef.current = present
  useEffect(() => {
    const onChange = () => {
      if (!document.fullscreenElement && presentRef.current) {
        setPresent(false)
        setLaser(false)
        setFitSignal((value) => value + 1)
      }
    }
    document.addEventListener("fullscreenchange", onChange)
    return () => document.removeEventListener("fullscreenchange", onChange)
  }, [])

  const sheetIndex = blueprints.findIndex((bp) => bp.id === blueprintId)
  const goSheet = useCallback((delta: number) => {
    const next = blueprints[sheetIndex + delta]
    if (next) setBlueprintId(next.id)
  }, [blueprints, sheetIndex])

  // ---------- Export ----------
  const renderExport = useCallback(async (request: ExportRequest, maxSide?: number) => {
    if (!revision || !blueprint || !url) throw new Error("The sheet is not loaded yet.")
    if (imageCache.current?.url !== url) imageCache.current = { url, bitmap: await loadSheetImage(url) }
    const shown = annotations.filter((a) => !hiddenIds.has(a.id))
    const images = new Map<string, CanvasImageSource>()
    await Promise.all(shown.filter((a) => a.kind === "image" && a.image_path).map(async (a) => {
      const path = a.image_path as string
      let source = imageSources.current.get(path)
      if (!source) {
        const link = await signedUrl("blueprints", path)
        if (link) source = await loadSheetImage(link)
        if (source) imageSources.current.set(path, source)
      }
      if (source) images.set(path, source)
    }))
    return renderSheet({
      image: imageCache.current.bitmap,
      width: revision.preview_width,
      height: revision.preview_height,
      annotations: shown,
      images,
      showBase,
      pins: visiblePins.filter((pin) => !hiddenPinIds.has(pin.id)),
      numberOf,
      show: request.show,
      scaleWidthM,
      titleBlock: request.titleBlock,
      legend: request.legend,
      maxSide,
      info: { project: project ? `${project.code} • ${project.name}` : "Project", sheet: blueprint.title, revision: `Rev ${revision.revision}`, level: blueprint.level },
    })
  }, [revision, blueprint, url, annotations, hiddenIds, hiddenPinIds, showBase, visiblePins, numberOf, scaleWidthM, project])

  // ---------- Context menu ----------
  const openMenu = (target: ContextTarget) => {
    let items: MenuItem[] = []
    if (target.type === "pin" && target.id) {
      const pin = pins.find((p) => p.id === target.id)
      if (!pin) return
      select({ pin: pin.id, ann: [] })
      items = [
        { label: "Open details", icon: <Icon name="panel" size={14} />, onClick: () => setDetailsOpen(true) },
        ...(role !== "client" ? [{ label: "QR label", icon: <Icon name="qr" size={14} />, onClick: () => setQrOpen(true) } as MenuItem] : []),
        ...(editable ? [{ separator: true } as MenuItem, { label: pin.locked ? "Unlock pin" : "Lock pin", hint: "Alt Shift L", icon: <Icon name={pin.locked ? "unlock" : "lock"} size={14} />, onClick: () => void togglePinLock(pin) }, { separator: true } as MenuItem, { label: "Delete pin", hint: "Del", icon: <Icon name="trash" size={14} />, danger: true, disabled: pin.locked, onClick: () => void deletePin(pin) }] : []),
      ]
    } else if (target.type === "annotation" && target.id) {
      let current = selection.ann
      if (!current.includes(target.id)) {
        current = withGroupMembers(annotations, [target.id])
        select({ pin: null, ann: current })
      }
      const picked = annotations.filter((a) => current.includes(a.id))
      const locked = picked.every((a) => a.locked)
      const anyLocked = picked.some((a) => a.locked)
      const many = picked.length > 1
      const grouped = picked.some((a) => a.group_id)
      const first = picked[0]
      const centre = (() => {
        const b = itemBox(toArrange(first), sheet)
        return { x: Math.round((b.x + b.w / 2) * 100) / 100, y: Math.round((b.y + b.h / 2) * 100) / 100 }
      })()
      const align = (mode: AlignMode) => ({ label: `Align ${mode} on the page`, icon: <Icon name={({ left: "alignLeft", center: "alignCenter", right: "alignRight", top: "alignTop", middle: "alignMiddle", bottom: "alignBottom" } as const)[mode]} size={14} />, disabled: anyLocked, onClick: () => alignToSheet(mode) }) as MenuItem
      items = editable
        ? [
            { label: "Copy", hint: "Ctrl C", icon: <Icon name="copy" size={14} />, onClick: () => { ops.copy(current); toast.info("Copied") } },
            { label: "Copy style", hint: "Ctrl Alt C", icon: <Icon name="brush" size={14} />, onClick: () => { if (first) setStyleClipboard(ops.styleOf(first)); toast.info("Style copied", "Select other items and use Paste style.") } },
            { label: "Paste", hint: "Ctrl V", icon: <Icon name="paste" size={14} />, disabled: !ops.hasClipboard(), onClick: () => void pasteClipboard() },
            { label: "Paste style", hint: "Ctrl Alt V", disabled: !styleClipboard || anyLocked, onClick: () => styleClipboard && void ops.applyStyle(current, styleClipboard) },
            { label: "Duplicate", hint: "Ctrl D", icon: <Icon name="copy" size={14} />, onClick: () => void ops.duplicate(current).then((created) => created.length && select({ pin: null, ann: created.map((a) => a.id) })) },
            { label: many ? `Delete ${picked.length} items` : "Delete", hint: "Del", icon: <Icon name="trash" size={14} />, danger: true, disabled: anyLocked, onClick: () => void ops.remove(current).then((done) => done && setSelection(NO_SELECTION)) },
            { separator: true },
            {
              label: "Position",
              icon: <Icon name="layers" size={14} />,
              submenu: [
                { label: "Forward", icon: <Icon name="forward" size={14} />, onClick: () => void ops.layer(current, "forward") },
                { label: "Backward", icon: <Icon name="backward" size={14} />, onClick: () => void ops.layer(current, "backward") },
                { label: "To front", hint: "Ctrl ]", icon: <Icon name="front" size={14} />, onClick: () => void ops.layer(current, "front") },
                { label: "To back", hint: "Ctrl [", icon: <Icon name="sendBack" size={14} />, onClick: () => void ops.layer(current, "back") },
                { separator: true },
                align("center"),
                align("middle"),
                align("left"),
                align("right"),
                align("top"),
                align("bottom"),
              ],
            } as MenuItem,
            ...(many ? [{ label: "Group", hint: "Ctrl G", icon: <Icon name="group" size={14} />, disabled: anyLocked, onClick: () => void ops.group(current) } as MenuItem] : []),
            ...(grouped ? [{ label: "Ungroup", hint: "Ctrl Shift G", disabled: anyLocked, onClick: () => void ops.ungroup(current) } as MenuItem] : []),
            { separator: true },
            { label: locked ? "Unlock" : "Lock", hint: "Alt Shift L", icon: <Icon name={locked ? "unlock" : "lock"} size={14} />, onClick: () => void ops.setLocked(current, !locked) },
            { label: "Pin a task here", icon: <Icon name="pin" size={14} />, onClick: () => { issueAfter.current = false; setTool("select"); setDraftPin(centre) } },
            { label: "Report an issue here", icon: <Icon name="close" size={14} />, onClick: () => { issueAfter.current = true; setTool("select"); setDraftPin(centre) } },
            { label: "Alternative text / label", icon: <Icon name="note" size={14} />, disabled: many || !labelKinds.includes(first.kind) || anyLocked, onClick: () => setLabelFor(first.id) },
          ]
        : [{ label: "Select all", hint: "Ctrl A", onClick: selectAll }]
    } else {
      // Empty part of the sheet: things to add at the click point, the base layer, zoom and view.
      const at = target.at
      const openPanel = (tab: SheetTab) => { setSelection(NO_SELECTION); setSheetTab(tab); setRightOpen(true); if (prefs.inspector === "hidden") setPrefs({ inspector: "docked" }) }
      items = [
        ...(editable ? [{ label: "Paste", hint: "Ctrl V", icon: <Icon name="paste" size={14} />, disabled: !ops.hasClipboard(), onClick: () => void pasteClipboard() } as MenuItem] : []),
        { label: "Select all", hint: "Ctrl A", onClick: selectAll },
        ...(editable && at
          ? [
              { separator: true } as MenuItem,
              {
                label: "Add here",
                icon: <Icon name="pin" size={14} />,
                submenu: [
                  { label: "Pin", hint: "P", icon: <Icon name="pin" size={14} />, onClick: () => { issueAfter.current = false; setTool("select"); setDraftPin(at) } },
                  { label: "Note", hint: "N", icon: <Icon name="note" size={14} />, onClick: () => { setTool("select"); setDraftNote(at) } },
                  { label: "Text box", hint: "T", icon: <Icon name="text" size={14} />, onClick: () => { setTool("select"); setDraftText(at) } },
                  { label: "Picture...", hint: "I", icon: <Icon name="image" size={14} />, onClick: () => { imageAt.current = at; fileInput.current?.click() } },
                ],
              } as MenuItem,
            ]
          : []),
        { separator: true },
        ...(sheetCanEdit && blueprint ? [{ label: baseLocked ? "Unlock the base layer" : "Lock the base layer", icon: <Icon name={baseLocked ? "unlock" : "lock"} size={14} />, onClick: () => void toggleBaseLock() } as MenuItem] : []),
        { label: showBase ? "Hide the blueprint" : "Show the blueprint", icon: <Icon name="sheets" size={14} />, onClick: () => setShowBase((value) => !value) },
        { separator: true },
        {
          label: "Zoom",
          icon: <Icon name="zoomIn" size={14} />,
          submenu: [
            { label: "Fit to window", hint: "0", icon: <Icon name="fit" size={14} />, onClick: fit },
            { label: "Zoom in", icon: <Icon name="zoomIn" size={14} />, onClick: () => zoom.current?.zoomIn() },
            { label: "Zoom out", icon: <Icon name="zoomOut" size={14} />, onClick: () => zoom.current?.zoomOut() },
          ],
        } as MenuItem,
        {
          label: "View",
          icon: <Icon name="view" size={14} />,
          submenu: [
            { label: "Layers panel", icon: <Icon name="layers" size={14} />, onClick: () => openPanel("layers") },
            ...(canSeeHistory ? [{ label: "Edit history", icon: <Icon name="history" size={14} />, onClick: () => openPanel("history") } as MenuItem] : []),
            { separator: true },
            { label: "Focus mode", hint: "F", icon: <Icon name="focus" size={14} />, onClick: toggleFocus },
            { label: "Presentation mode", hint: "F5", icon: <Icon name="present" size={14} />, onClick: startPresent },
          ],
        } as MenuItem,
        { label: "Export...", icon: <Icon name="export" size={14} />, onClick: () => setExporting(true) },
      ]
    }
    setMenu({ x: target.x, y: target.y, items })
  }

  // ---------- Keyboard ----------
  const annotationsRef = useRef(annotations)
  annotationsRef.current = annotations
  const nudge = useRef<{ dx: number; dy: number; timer: ReturnType<typeof setTimeout> | null; ids: string[] }>({ dx: 0, dy: 0, timer: null, ids: [] })
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target
      if ((target instanceof Element && target.closest("input, textarea, select, [contenteditable=true]")) || document.querySelector("[data-bt-dialog]")) return
      const mod = event.ctrlKey || event.metaKey
      const key = event.key.toLowerCase()

      if (present) {
        if (event.key === "ArrowRight" || event.key === "PageDown" || event.key === " ") { event.preventDefault(); goSheet(1) }
        else if (event.key === "ArrowLeft" || event.key === "PageUp") { event.preventDefault(); goSheet(-1) }
        else if (event.key === "Escape") { event.preventDefault(); stopPresent() }
        else if (key === "l") setLaser((value) => !value)
        else if (key === "0") fit()
        return
      }

      if (mod && key === "k") { event.preventDefault(); setCommands(true); return }
      if (mod && !event.altKey) {
        if (key === "z" && !event.shiftKey) { event.preventDefault(); void runUndo("undo") }
        else if ((key === "z" && event.shiftKey) || key === "y") { event.preventDefault(); void runUndo("redo") }
        else if (key === "a") { event.preventDefault(); selectAll() }
        else if (editable && key === "c") { event.preventDefault(); copySelection() }
        else if (editable && key === "x") { event.preventDefault(); void cutSelection() }
        else if (editable && key === "d") { event.preventDefault(); void duplicateSelection() }
        else if (editable && key === "g") { event.preventDefault(); if (event.shiftKey) void ops.ungroup(ids); else void groupSelection() }
        else if (editable && key === "l") { event.preventDefault(); if (ids.length) lockSelection(!selectedAnnotations.every((a) => a.locked)) }
        else if (editable && (key === "b" || key === "i" || key === "u") && selectedAnnotations.length && selectedAnnotations.every((a) => canFormat(a.kind))) {
          event.preventDefault()
          const prop = key === "b" ? "bold" : key === "i" ? "italic" : "underline"
          const on = selectedAnnotations.every((a) => resolveFormat(a.kind, a.format)[prop])
          formatSelection({ [prop]: !on }, key === "b" ? "Bold" : key === "i" ? "Italic" : "Underline")
        }
        else if (editable && event.key === "]") { event.preventDefault(); void ops.layer(ids, "front") }
        else if (editable && event.key === "[") { event.preventDefault(); void ops.layer(ids, "back") }
        return
      }
      if (mod && event.altKey && editable) {
        if (key === "c") { event.preventDefault(); copyStyle() }
        else if (key === "v") { event.preventDefault(); applyStyle() }
        return
      }
      if (event.altKey && event.shiftKey && key === "l" && editable) {
        event.preventDefault()
        if (selectedPin) void togglePinLock(selectedPin)
        else if (ids.length) lockSelection(!selectedAnnotations.every((a) => a.locked))
        return
      }
      if (event.altKey) return

      if (event.key === "F5") { event.preventDefault(); startPresent(); return }
      if (event.key === "?") { event.preventDefault(); setShortcuts(true); return }
      if (key === "f") { event.preventDefault(); toggleFocus(); return }
      if (event.key === "0") { event.preventDefault(); fit(); return }
      const next = toolKeys[key]
      if (next && !event.shiftKey) {
        event.preventDefault()
        if (allowedTool(next, editable, canStamp)) chooseTool(next)
        return
      }
      if (event.key === "Escape") {
        if (focus) return toggleFocus()
        setTool("select")
        setSelection(NO_SELECTION)
        setDraftPin(null)
      } else if ((event.key === "Delete" || event.key === "Backspace") && editable) {
        void deleteSelection()
      } else if (editable && ids.length && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
        event.preventDefault()
        const step = event.shiftKey ? 1 : 0.1
        const n = nudge.current
        if (n.ids.join() !== ids.join()) { n.dx = 0; n.dy = 0 }
        n.ids = ids
        n.dx += event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0
        n.dy += event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0
        if (n.timer) clearTimeout(n.timer)
        n.timer = setTimeout(() => {
          const { dx, dy, ids: moving } = nudge.current
          nudge.current.dx = 0
          nudge.current.dy = 0
          nudge.current.timer = null
          const free = moving.filter((id) => !annotationsRef.current.find((a) => a.id === id)?.locked)
          if (free.length) void ops.moveBy(free, dx, dy, "Nudge")
          else toast.info("Locked", "Unlock the item first to move it with the arrow keys.")
        }, 260)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  })

  // Ctrl+V: a picture on the clipboard becomes an image on the sheet, anything else pastes the copied items.
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const target = event.target
      if ((target instanceof Element && target.closest("input, textarea, select, [contenteditable=true]")) || document.querySelector("[data-bt-dialog]") || !editable || present) return
      const files = imageFilesFrom(event.clipboardData?.items)
      event.preventDefault()
      if (files.length) void addImages(files, null)
      else void pasteClipboard()
    }
    window.addEventListener("paste", onPaste)
    return () => window.removeEventListener("paste", onPaste)
  })

  // The editor owns the page while it is open.
  useEffect(() => {
    const previous = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.body.style.overflow = previous
    }
  }, [])

  const selectFromList = (id: string, additive: boolean) => {
    setTool("select")
    pick({ type: "annotation", id }, additive)
    setRightOpen(true)
  }

  const inspector: InspectorProps | null = profile
    ? {
        role,
        canEdit: editable,
        canReport,
        meId: profile.id,
        team,
        blueprint,
        revision,
        revisions,
        onRevision: setRevisionId,
        sheetPins,
        numberOf,
        annotations,
        selectedPin,
        selectedAnnotation,
        selectedAnnotations,
        actions,
        onSelectPin: (id) => { select({ pin: id, ann: [] }); setTool("select") },
        onSelectAnnotation: selectFromList,
        sheetTab,
        onSheetTab: setSheetTab,
        hidden,
        onToggleStatus: (status) => setHidden((current) => { const next = new Set(current); if (next.has(status)) next.delete(status); else next.add(status); return next }),
        layers,
        onLayer: (key, value) => setLayers((current) => ({ ...current, [key]: value })),
        scaleWidthM,
        baseLocked,
        canLockBase: sheetCanEdit,
        onToggleBaseLock: () => void toggleBaseLock(),
        onMoveLayer: (id, action) => void ops.layer([id], action),
        onToggleLocked: (item) => {
          if (item.type === "pin") {
            const pin = pins.find((p) => p.id === item.id)
            if (pin) void togglePinLock(pin)
          } else {
            const a = annotations.find((x) => x.id === item.id)
            if (a) void ops.setLocked([a.id], !a.locked)
          }
        },
        onLockAll: (locked) => void lockAll(locked),
        hiddenIds,
        onToggleHidden: (id) => setHiddenIds((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next }),
        hiddenPinIds,
        onTogglePinHidden: (id) => setHiddenPinIds((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next }),
        showBase,
        onShowBase: setShowBase,
        onReorder: (ids) => void ops.reorder(ids),
        canDeleteSheet,
        onDeleteSheet: () => void deleteSheet(),
        canSeeHistory,
        history: historyEntries,
        historyLoading,
        historyError,
        onSetStatus: (pin, status) => void setStatus(pin, status),
        onReport: report,
        onOpenDetails: (section?: PinSection) => { setDetailsSection(section ?? "details"); setDetailsOpen(true) },
        pinLink,
        onDeletePin: () => selectedPin && void deletePin(selectedPin),
        onPinChanged: () => { void reloadPins(); touched() },
        onAnnotationPatch: (patch: AnnotationPatch) => {
          if (!selectedAnnotation) return
          const label = "rotation" in patch ? "Rotate" : "text" in patch ? "Edit text" : "color" in patch ? "Change color" : "opacity" in patch ? "Change opacity" : "stroke" in patch ? "Change thickness" : "font_size" in patch ? "Change text size" : "w" in patch ? "Resize" : "Edit"
          void ops.patchEach([{ id: selectedAnnotation.id, patch: patch as Record<string, unknown> }], "Could not save the change", label)
        },
        onDeleteAnnotation: () => void deleteSelection(),
      }
    : null

  // The floating capsule above the selection (comment / lock / duplicate / delete / more).
  const quick = editable && !present && (selectedPin || selectedAnnotations.length)
    ? {
        locked: selectedPin ? selectedPin.locked : selectedAnnotations.every((a) => a.locked),
        canDelete: selectedPin ? !selectedPin.locked : selectedAnnotations.every((a) => !a.locked),
        onComment: () => {
          if (selectedPin) return setDetailsOpen(true)
          const first = selectedAnnotations[0]
          if (!first || !labelKinds.includes(first.kind)) return toast.info("No label for this item", "Notes, text boxes, shapes, pictures, arrows and clouds can have one.")
          if (first.locked) return toast.info("Locked", "Unlock the item first to change its text.")
          setLabelFor(first.id)
        },
        onToggleLock: () => (selectedPin ? void togglePinLock(selectedPin) : lockSelection(!selectedAnnotations.every((a) => a.locked))),
        onDuplicate: selectedPin ? undefined : () => void duplicateSelection(),
        onDelete: () => void deleteSelection(),
        onMore: (x: number, y: number) => openMenu({ x, y, type: selectedPin ? "pin" : "annotation", id: selectedPin ? selectedPin.id : selectedAnnotations[0].id, at: null }),
      }
    : undefined

  const options: ToolOptions = {
    shapeKind, onShapeKind: setShapeKind, color, onColor: setColor,
    stampStatus, onStampStatus: setStampStatus, stampStatuses,
    penSize, onPenSize: setPenSize, highlighterSize, onHighlighterSize: setHighlighterSize, textSize, onTextSize: setTextSize,
    symbol, onSymbol: setSymbol, symbolSize, onSymbolSize: setSymbolSize,
    measurementCount: measurements.length, onClearMeasurements: () => setMeasurements([]), onCalibrate: () => setCalibrating(true),
    canCalibrate: editable && !baseLocked,
    scaleLabel: scaleWidthM ? `sheet is ${formatMeters(scaleWidthM)} wide` : "not set",
    boxSelect: prefs.boxSelect, onBoxSelect: (value) => setPrefs({ boxSelect: value }),
  }

  const commandList: Command[] = [
    ...toolDefs.map((def) => ({ id: `tool-${def.tool}`, label: `Tool: ${def.label}`, group: "Tools", hint: def.key, keywords: def.hint, disabled: !allowedTool(def.tool, editable, canStamp), run: () => chooseTool(def.tool) })),
    { id: "undo", label: "Undo", group: "Edit", hint: "Ctrl Z", disabled: !undoStack.canUndo, run: () => void runUndo("undo") },
    { id: "redo", label: "Redo", group: "Edit", hint: "Ctrl Shift Z", disabled: !undoStack.canRedo, run: () => void runUndo("redo") },
    { id: "select-all", label: "Select everything", group: "Edit", hint: "Ctrl A", run: selectAll },
    { id: "copy", label: "Copy selection", group: "Edit", hint: "Ctrl C", disabled: !editable || !ids.length, run: copySelection },
    { id: "paste", label: "Paste", group: "Edit", hint: "Ctrl V", disabled: !editable || !ops.hasClipboard(), run: () => void pasteClipboard() },
    { id: "duplicate", label: "Duplicate selection", group: "Edit", hint: "Ctrl D", disabled: !editable || !ids.length, run: () => void duplicateSelection() },
    { id: "delete", label: "Delete selection", group: "Edit", hint: "Del", disabled: !editable || !(ids.length || selectedPin), run: () => void deleteSelection() },
    { id: "group", label: "Group selection", group: "Arrange", hint: "Ctrl G", disabled: !editable || ids.length < 2, run: () => void groupSelection() },
    { id: "ungroup", label: "Ungroup", group: "Arrange", hint: "Ctrl Shift G", disabled: !editable || !selectedAnnotations.some((a) => a.group_id), run: () => void ops.ungroup(ids) },
    { id: "front", label: "Bring to front", group: "Arrange", hint: "Ctrl ]", disabled: !editable || !ids.length, run: () => void ops.layer(ids, "front") },
    { id: "back", label: "Send to back", group: "Arrange", hint: "Ctrl [", disabled: !editable || !ids.length, run: () => void ops.layer(ids, "back") },
    ...(["left", "center", "right", "top", "middle", "bottom"] as AlignMode[]).map((mode) => ({ id: `align-${mode}`, label: `Align ${mode}`, group: "Arrange", keywords: "align", disabled: !editable || ids.length < 2, run: () => void ops.align(ids, mode) })),
    { id: "dist-h", label: "Spread items across", group: "Arrange", keywords: "distribute", disabled: !editable || ids.length < 3, run: () => void ops.distribute(ids, "horizontal") },
    { id: "dist-v", label: "Spread items down", group: "Arrange", keywords: "distribute", disabled: !editable || ids.length < 3, run: () => void ops.distribute(ids, "vertical") },
    { id: "lock", label: "Lock selection", group: "Arrange", hint: "Ctrl L", disabled: !editable || !ids.length, run: () => lockSelection(true) },
    { id: "unlock", label: "Unlock selection", group: "Arrange", disabled: !editable || !ids.length, run: () => lockSelection(false) },
    { id: "lock-all", label: "Lock every item on this sheet", group: "Arrange", disabled: !sheetCanEdit, run: () => void lockAll(true) },
    { id: "unlock-all", label: "Unlock every item on this sheet", group: "Arrange", disabled: !sheetCanEdit, run: () => void lockAll(false) },
    { id: "base-lock", label: baseLocked ? "Unlock the base layer" : "Lock the base layer", group: "Sheet", disabled: !sheetCanEdit || !blueprint, run: () => void toggleBaseLock() },
    { id: "export", label: "Export sheet as PNG or PDF", group: "Sheet", keywords: "download print", disabled: !blueprint, run: () => setExporting(true) },
    { id: "compare", label: "Compare revisions", group: "Sheet", disabled: revisions.length < 2, run: () => setComparing(true) },
    { id: "add-image", label: "Add an image to the sheet", group: "Sheet", keywords: "picture photo logo spec upload", disabled: !editable, run: () => fileInput.current?.click() },
    { id: "show-base", label: showBase ? "Hide the blueprint (backdrop)" : "Show the blueprint (backdrop)", group: "View", run: () => setShowBase((value) => !value) },
    { id: "delete-sheet", label: "Delete this sheet", group: "Sheet", disabled: !canDeleteSheet || !blueprint, run: () => void deleteSheet() },
    { id: "upload", label: "Upload a new sheet", group: "Sheet", disabled: !canAddSheet, run: () => setUpload("new") },
    { id: "revision", label: "Upload a new revision", group: "Sheet", disabled: !canReviseSheet || baseLocked, run: () => setUpload("revision") },
    { id: "history", label: "Show the edit history", group: "View", disabled: !canSeeHistory, run: () => { setSelection(NO_SELECTION); setSheetTab("history"); setRightOpen(true); if (prefs.inspector === "hidden") setPrefs({ inspector: "docked" }) } },
    { id: "layers", label: "Show the layers panel", group: "View", run: () => { setSelection(NO_SELECTION); setSheetTab("layers"); setRightOpen(true); if (prefs.inspector === "hidden") setPrefs({ inspector: "docked" }) } },
    { id: "focus", label: "Focus mode", group: "View", hint: "F", keywords: "hide panels distraction", run: toggleFocus },
    { id: "present", label: "Presentation mode", group: "View", hint: "F5", keywords: "slideshow fullscreen", run: startPresent },
    { id: "fit", label: "Fit the sheet to the window", group: "View", hint: "0", run: fit },
    { id: "sheets-panel", label: prefs.sheets ? "Hide the sheets strip (left)" : "Show the sheets strip (left)", group: "View", run: () => setPrefs({ sheets: !prefs.sheets }) },
    { id: "pages-bar", label: prefs.filmstrip ? "Hide the pages bar (bottom)" : "Show the pages bar (bottom)", group: "View", keywords: "filmstrip slides thumbnails", run: () => setPrefs({ filmstrip: !prefs.filmstrip }) },
    { id: "inspector-docked", label: "Dock the inspector", group: "View", run: () => setPrefs({ inspector: "docked" }) },
    { id: "inspector-float", label: "Float the inspector", group: "View", run: () => setPrefs({ inspector: "floating" }) },
    { id: "inspector-hide", label: "Hide the inspector", group: "View", run: () => setPrefs({ inspector: "hidden" }) },
    { id: "palette", label: prefs.tools === "bar" ? "Move the tools to a floating palette" : "Put the tools back in the top bar", group: "View", run: () => setPrefs({ tools: prefs.tools === "bar" ? "palette" : "bar" }) },
    { id: "box-select", label: prefs.boxSelect ? "Turn Box select off" : "Turn Box select on", group: "View", run: () => setPrefs({ boxSelect: !prefs.boxSelect }) },
    { id: "reset-layout", label: "Reset the layout", group: "View", run: resetPrefs },
    { id: "shortcuts", label: "Keyboard shortcuts", group: "Help", hint: "?", run: () => setShortcuts(true) },
    { id: "guide", label: "Page guide", group: "Help", run: () => setGuideOpen(true) },
  ]

  const showToolbar = !focus && !present
  const showSheets = !focus && !present && (desktop ? prefs.sheets : leftOpen)
  const showFilmstrip = !focus && !present && prefs.filmstrip
  const showDocked = !focus && !present && (desktop ? prefs.inspector === "docked" : rightOpen)
  const showFloating = desktop && !focus && !present && prefs.inspector === "floating"
  const showPalette = desktop && !focus && !present && prefs.tools === "palette"
  const drawerShadow = !desktop && (leftOpen || rightOpen)

  const body = (
    <div className="fixed inset-0 z-[500] flex flex-col bg-surface-muted text-fg" role="application" aria-label="Blueprint editor">
      {showToolbar ? (
        <header className="z-20 border-b border-line bg-surface/95 shadow-sm backdrop-blur">
          <EditorToolbar
            projectTitle={project ? `${project.code} • ${project.name}` : "Project"}
            blueprint={blueprint}
            blueprints={blueprints}
            onSheet={setBlueprintId}
            revision={revision}
            revisions={revisions}
            onRevision={setRevisionId}
            canEdit={editable}
            canUpload={(canAddSheet || canReviseSheet) && !present}
            zoomPercent={zoomPercent}
            onZoomIn={() => zoom.current?.zoomIn()}
            onZoomOut={() => zoom.current?.zoomOut()}
            onFit={fit}
            canUndo={undoStack.canUndo}
            canRedo={undoStack.canRedo}
            undoLabel={undoStack.undoLabel}
            redoLabel={undoStack.redoLabel}
            onUndo={() => void runUndo("undo")}
            onRedo={() => void runUndo("redo")}
            canSeeHistory={canSeeHistory}
            onHistory={() => { setSelection(NO_SELECTION); setSheetTab("history"); setRightOpen(true); setLeftOpen(false); if (prefs.inspector === "hidden") setPrefs({ inspector: "docked" }) }}
            baseLocked={baseLocked}
            canLockBase={sheetCanEdit}
            onToggleBaseLock={() => void toggleBaseLock()}
            onUpload={() => setUpload("new")}
            onNewRevision={() => setUpload("revision")}
            onExport={() => setExporting(true)}
            onShare={() => void shareLink()}
            dark={themeResolved === "dark"}
            onToggleTheme={() => setThemeMode(themeResolved === "dark" ? "light" : "dark")}
            view={{ prefs, onPrefs: setPrefs, onFocus: toggleFocus, onPresent: startPresent, onCompare: () => setComparing(true), canCompare: revisions.length > 1, onFit: fit, onCommands: () => setCommands(true), onShortcuts: () => setShortcuts(true), onGuide: () => setGuideOpen(true), onResetLayout: resetPrefs }}
            sheetsShown={prefs.sheets}
            filmstripShown={prefs.filmstrip}
            onPanelFilmstrip={() => setPrefs({ filmstrip: !prefs.filmstrip })}
            inspectorShown={prefs.inspector !== "hidden"}
            onPanelSheets={() => setPrefs({ sheets: !prefs.sheets })}
            onPanelInspector={() => setPrefs({ inspector: prefs.inspector === "hidden" ? "docked" : "hidden" })}
            onToggleSheets={() => { setLeftOpen((value) => !value); setRightOpen(false) }}
            onToggleInspector={() => { setRightOpen((value) => !value); setLeftOpen(false) }}
            onExit={onExit}
          />
          <ContextBar
            tool={tool}
            onTool={chooseTool}
            canEdit={editable}
            canStamp={canStamp}
            toolsInBar={prefs.tools === "bar"}
            options={options}
            pin={selectedPin}
            pinNumber={selectedPin ? numberOf(selectedPin) : null}
            annotations={selectedAnnotations}
            actions={actions}
            onStyle={styleSelection}
            onFormat={formatSelection}
            pinStatuses={editable ? allStatuses : []}
            onSetPinStatus={(pin, status) => void setStatus(pin, status)}
            onTogglePinLock={(pin) => void togglePinLock(pin)}
            onOpenPinDetails={() => setDetailsOpen(true)}
            onDeletePin={() => selectedPin && void deletePin(selectedPin)}
            onPinQr={role === "client" ? undefined : () => setQrOpen(true)}
            layerProps={{
              annotations,
              selectedIds: ids,
              canEdit: editable,
              hiddenIds,
              onToggleHidden: (id) => setHiddenIds((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next }),
              onSelectAnnotation: selectFromList,
              onMoveLayer: (id, action) => void ops.layer([id], action),
              onToggleLocked: (item) => {
                const a = annotations.find((x) => x.id === item.id)
                if (a) void ops.setLocked([a.id], !a.locked)
              },
              onReorder: (order) => void ops.reorder(order),
              showBase,
              onShowBase: setShowBase,
              baseLocked,
              canLockBase: sheetCanEdit,
              onToggleBaseLock: () => void toggleBaseLock(),
              pinCount: sheetPins.length,
              anyUnlocked: annotations.some((a) => !a.locked) || sheetPins.some((p) => !p.locked),
              onLockAll: (locked) => void lockAll(locked),
            }}
          />
        </header>
      ) : null}

      <div className="relative flex min-h-0 flex-1">
        {showSheets ? (
          <div className={`flex-none ${desktop ? "static w-52 xl:w-60" : "absolute inset-y-0 left-0 z-30 w-60 shadow-2xl"}`}>
            <SheetSorter blueprints={blueprints} selectedId={blueprintId} counts={counts} loading={loading} canEdit={canAddSheet} onSelect={(id) => { setBlueprintId(id); setLeftOpen(false) }} onAdd={() => setUpload("new")} />
          </div>
        ) : null}

        <div className="flex min-w-0 flex-1 flex-col">
        {/* On a phone the sheet and its floating tools form their own layer, so an open panel or drawer is never covered by them */}
        <main className={`relative min-h-0 min-w-0 flex-1 ${desktop ? "" : "isolate"}`}>
          <h1 className="sr-only">{project ? `${project.name} blueprint editor` : "Blueprint editor"}</h1>
          {projectLoading || loading ? (
            <Skeleton className="h-full w-full rounded-none" />
          ) : notFound || !project ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
              <p className="text-fg">This project does not exist or is not assigned to you.</p>
              <button type="button" className={primary} onClick={onExit}>Back</button>
            </div>
          ) : error ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
              <p className="rounded-lg bg-danger-soft px-4 py-2 text-sm text-danger-fg">{error}</p>
              <button type="button" className={primary} onClick={() => void reloadBlueprints()}>Retry</button>
            </div>
          ) : !blueprint || !revision ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
              <p className="max-w-sm text-fg-muted">{blueprint ? "This sheet has no file yet." : canAddSheet ? "No sheet has been uploaded for this project yet. Upload the first plan to start placing pins." : "No sheet has been uploaded for this project yet."}</p>
              {(blueprint ? canReviseSheet : canAddSheet) ? <button type="button" className={primary} onClick={() => setUpload(blueprint ? "revision" : "new")}>{blueprint ? "Upload a file" : "Upload a sheet"}</button> : null}
            </div>
          ) : (
            <StageCanvas
              src={url}
              width={revision.preview_width}
              height={revision.preview_height}
              tool={tool}
              shapeKind={shapeKind}
              color={color}
              strokeWidth={tool === "highlighter" ? highlighterSize : penSize}
              symbol={symbol}
              symbolSize={symbolSize}
              pins={visiblePins}
              numberOf={numberOf}
              annotations={annotations}
              selection={selection}
              onPick={pick}
              onMarquee={marquee}
              canEdit={editable}
              canStamp={canStamp}
              readOnly={present}
              laser={laser}
              boxSelect={prefs.boxSelect}
              showPins={layers.pins}
              showNotes={layers.notes}
              showShapes={layers.shapes}
              showDrawings={layers.drawings}
              showBase={showBase}
              hiddenIds={hiddenIds}
              hiddenPinIds={hiddenPinIds}
              measurements={measurements}
              scaleWidthM={scaleWidthM}
              draftPin={draftPin}
              onPlacePin={setDraftPin}
              onPlaceNote={setDraftNote}
              onPlaceText={setDraftText}
              onPlaceSymbol={(point) => void placeSymbol(point)}
              onCreateShape={(shape) => void createShape(shape)}
              onCreateStroke={(kind, points) => void createStroke(kind, points)}
              onCreateLine={(kind, points) => void createLine(kind, points)}
              onCreatePath={(kind, points) => void createPath(kind, points)}
              onMovePin={(id, x, y) => void movePin(id, x, y)}
              onMoveMany={(moving, dx, dy) => void ops.moveBy(moving, dx, dy)}
              onResizeAnnotation={resizeAnnotation}
              onToggleLock={(id) => void ops.setLocked([id], false)}
              quick={quick}
              onViewScale={(scale) => setZoomPercent(Math.round(scale * 100))}
              onRotate={rotateAnnotation}
              onDropFiles={(files, at) => void addImages(files, at)}
              onStamp={(id) => void stamp(id)}
              onMeasure={measured}
              onBlocked={(message) => toast.info("Locked", message)}
              onContextMenu={openMenu}
              fitSignal={fitSignal}
              zoomApi={(api) => { zoom.current = api }}
            />
          )}
          {!isLatest && revision && !present ? <div className="pointer-events-none absolute inset-x-0 top-0 z-30 bg-accent px-3 py-1 text-center text-xs font-bold text-black">Older revision (Rev {revision.revision}): view only. Pick the latest revision to edit.</div> : null}
          {pinsLoading && blueprint && !present ? <div className="pointer-events-none absolute bottom-3 left-3 z-30 rounded-lg bg-[#211f20]/90 px-3 py-1.5 text-xs font-semibold text-white">Loading pins...</div> : null}

          {desktop && !focus && !present && !prefs.sheets ? (
            <button type="button" onClick={() => setPrefs({ sheets: true })} className="absolute left-3 top-3 z-30 flex items-center gap-1.5 rounded-full border border-line bg-surface/95 px-3 py-1.5 text-xs font-bold shadow-lg backdrop-blur hover:bg-surface-muted"><Icon name="sheets" size={14} />Sheets</button>
          ) : null}
          {desktop && !focus && !present && prefs.inspector === "hidden" ? (
            <button type="button" onClick={() => setPrefs({ inspector: "docked" })} className="absolute right-3 top-3 z-30 flex items-center gap-1.5 rounded-full border border-line bg-surface/95 px-3 py-1.5 text-xs font-bold shadow-lg backdrop-blur hover:bg-surface-muted"><Icon name="panel" size={14} />{hasSelection ? "Show details" : "Panel"}</button>
          ) : null}
          {focus ? (
            <div className="absolute right-3 top-3 z-50 flex items-center gap-2 rounded-full bg-[#211f20]/90 py-1 pl-4 pr-1 text-xs font-semibold text-white shadow-xl backdrop-blur">
              Focus mode{tool !== "select" ? ` • ${toolDefs.find((d) => d.tool === tool)?.label}` : ""}
              <button type="button" onClick={toggleFocus} className="rounded-full bg-white px-3 py-1 font-bold text-black hover:bg-white/90">Exit (F)</button>
            </div>
          ) : null}
          {present && blueprint ? (
            <PresentationBar
              title={blueprint.title}
              index={Math.max(0, sheetIndex)}
              total={blueprints.length}
              onPrev={() => goSheet(-1)}
              onNext={() => goSheet(1)}
              layers={layers}
              onLayer={(key, value) => setLayers((current) => ({ ...current, [key]: value }))}
              laser={laser}
              onLaser={() => setLaser((value) => !value)}
              legend={legend}
              onLegend={() => setLegend((value) => !value)}
              onFit={fit}
              onExit={stopPresent}
            />
          ) : null}
        </main>
        {showFilmstrip ? <SheetFilmstrip blueprints={blueprints} selectedId={blueprintId} counts={counts} loading={loading} canEdit={canAddSheet} onSelect={setBlueprintId} onAdd={() => setUpload("new")} onHide={() => setPrefs({ filmstrip: false })} /> : null}
        </div>

        {showDocked ? (
          <div className={`min-h-0 min-w-0 flex-none ${desktop ? "relative" : "absolute inset-y-0 right-0 z-30 w-[96vw] max-w-xl shadow-2xl"}`} style={desktop ? { width: inspectorWidth } : undefined}>
            {desktop ? <PanelResizeHandle width={inspectorWidth} maximum={panelMaximum} onResize={(width) => setPrefs({ panelWidth: width })} /> : null}
            {inspector ? (
              <div className="flex h-full flex-col border-l border-line bg-surface">
                {desktop ? (
                  <div className="flex flex-none items-center justify-between border-b border-line px-3 py-1">
                    <span className="text-[11px] font-extrabold uppercase tracking-wider text-fg-muted">Panel</span>
                    <span className="flex gap-0.5">
                      <button type="button" onClick={() => setPrefs({ inspector: "floating" })} title="Float this panel" aria-label="Float the panel" className="flex h-6 w-6 items-center justify-center rounded-md text-fg-muted hover:bg-surface-muted hover:text-fg"><Icon name="compare" size={13} /></button>
                      <button type="button" onClick={() => setPrefs({ inspector: "hidden" })} title="Hide this panel" aria-label="Hide the panel" className="flex h-6 w-6 items-center justify-center rounded-md text-fg-muted hover:bg-surface-muted hover:text-fg"><Icon name="close" size={13} /></button>
                    </span>
                  </div>
                ) : null}
                <div className="min-h-0 flex-1"><Inspector {...inspector} /></div>
              </div>
            ) : <Skeleton className="h-full w-full rounded-none" />}
          </div>
        ) : null}

        {drawerShadow ? <button type="button" aria-label="Close panel" className="absolute inset-0 z-20 bg-black/40" onClick={() => { setLeftOpen(false); setRightOpen(false) }} /> : null}
      </div>

      {showFloating && inspector ? (
        <FloatingPanel
          title={selectedPin ? "Pin" : selectedAnnotations.length > 1 ? `${selectedAnnotations.length} selected` : selectedAnnotation ? annotationKindLabels[selectedAnnotation.kind] : "Panel"}
          label="Inspector"
          x={prefs.panel.x}
          y={prefs.panel.y}
          width={prefs.panelWidth}
          onResize={(width) => setPrefs({ panelWidth: width })}
          onMove={(x, y) => setPrefs({ panel: { x, y } })}
          onClose={() => setPrefs({ inspector: "hidden" })}
          headerActions={<button type="button" onClick={() => setPrefs({ inspector: "docked" })} title="Dock this panel" aria-label="Dock the panel" className="flex h-6 w-6 items-center justify-center rounded-md text-fg-muted hover:bg-surface hover:text-fg"><Icon name="panel" size={14} /></button>}
        >
          <div className="h-[min(66vh,620px)]"><Inspector {...inspector} /></div>
        </FloatingPanel>
      ) : null}

      {showPalette ? (
        <FloatingPanel title="Tools" label="Tool palette" x={prefs.palette.x} y={prefs.palette.y} width={244} collapsed={prefs.palette.collapsed} onToggleCollapsed={() => setPrefs({ palette: { ...prefs.palette, collapsed: !prefs.palette.collapsed } })} onMove={(x, y) => setPrefs({ palette: { ...prefs.palette, x, y } })} onClose={() => setPrefs({ tools: "bar" })} maxHeight="80vh">
          <ToolStrip tool={tool} onTool={chooseTool} canEdit={editable} canStamp={canStamp} vertical />
        </FloatingPanel>
      ) : null}

      <input
        ref={fileInput}
        type="file"
        accept={IMAGE_ACCEPT}
        multiple
        className="hidden"
        aria-label="Choose pictures to add to the sheet"
        onChange={(event) => {
          const files = imageFilesFrom(event.target.files)
          event.target.value = ""
          const at = imageAt.current
          imageAt.current = null
          if (files.length) void addImages(files, at)
          else if (event.target.files?.length) toast.error("That is not a picture", "Use a PNG, JPEG, WebP, GIF, BMP or AVIF file.")
        }}
      />
      {imageBusy ? (
        <div role="status" className="fixed bottom-6 left-1/2 z-[620] flex -translate-x-1/2 items-center gap-2 rounded-full bg-[#211f20]/95 px-4 py-2 text-sm font-semibold text-white shadow-2xl backdrop-blur">
          <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" aria-hidden="true" />
          Adding the picture...
        </div>
      ) : null}
      {draftPin ? <NewPinDialog onClose={() => { issueAfter.current = false; setDraftPin(null) }} onCreate={createPin} /> : null}
      {draftNote ? <TextDialog title="New note" submit="Add note" placeholder="e.g. Verify beam depth against the structural drawing" rows={4} initialColor={color} onClose={() => setDraftNote(null)} onCreate={createNote} /> : null}
      {draftText ? <TextDialog title="New text box" submit="Add text" placeholder="Type the text to put on the sheet" rows={3} initialColor={color} onClose={() => setDraftText(null)} onCreate={createText} /> : null}
      {calibrating ? <CalibrateDialog onClose={() => setCalibrating(false)} onSave={async (meters) => { const failure = await calibrate(meters); if (!failure) setCalibrating(false); return failure }} /> : null}
      {detailsOpen && selectedPin && inspector ? <PinDetailsModal pin={selectedPin} inspector={inspector} section={detailsSection} onClose={() => { setDetailsOpen(false); setDetailsSection("details") }} onDelete={() => void deletePin(selectedPin)} /> : null}
      {exporting && blueprint && revision ? <ExportDialog sheetName={blueprint.title} revisionLabel={`Rev ${revision.revision}`} initialShow={layers} render={renderExport} onClose={() => setExporting(false)} onDone={(filename) => { setExporting(false); toast.success("Export ready", filename) }} /> : null}
      {comparing && blueprint ? <CompareModal revisions={revisions} initialNewer={revision?.id ?? null} onClose={() => setComparing(false)} /> : null}
      {commands ? <CommandPalette commands={commandList} onClose={() => setCommands(false)} /> : null}
      {shortcuts ? <ShortcutsModal onClose={() => setShortcuts(false)} /> : null}
      {guideOpen ? <PageGuideModal guide={editorGuide(role, canEdit)} note="Press ? for all keyboard shortcuts and Ctrl K for every editor command." onClose={() => setGuideOpen(false)} /> : null}
      {labelFor ? (() => {
        const target = annotations.find((a) => a.id === labelFor)
        return target ? <LabelDialog annotation={target} onClose={() => setLabelFor(null)} onSave={(text) => { setLabelFor(null); void ops.patchEach([{ id: target.id, patch: { text: text || null } }], "Could not save the text", "Edit text") }} /> : null
      })() : null}
      {qrOpen && selectedPin ? <PinQr pin={selectedPin} sheet={blueprint?.title ?? "Sheet"} project={project ? `${project.code} ${project.name}` : "Project"} onClose={() => setQrOpen(false)} /> : null}
      {menu ? <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} /> : null}
      {upload ? (
        <BlueprintUploadDialog
          projectId={projectId}
          existing={upload === "revision" ? blueprint : null}
          blueprintType={typeFilter}
          uploadTypes={newSheetTypes}
          onClose={() => setUpload(null)}
          onDone={(id) => {
            setUpload(null)
            setBlueprintId(id)
            setRevisionId(null)
            toast.success("Sheet uploaded")
            void reloadBlueprints()
            touched()
          }}
        />
      ) : null}
    </div>
  )

  return createPortal(body, document.body)
}

function NewPinDialog({ onClose, onCreate }: { onClose: () => void; onCreate: (title: string, category: PinCategory) => Promise<string | null> }) {
  const [title, setTitle] = useState("")
  const [category, setCategory] = useState<PinCategory>("progress")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (title.trim().length < 2 || title.trim().length > 120) return setError("Enter a title between 2 and 120 characters.")
    setBusy(true)
    const failure = await onCreate(title.trim(), category)
    setBusy(false)
    if (failure) setError(failure)
  }
  return (
    <Modal title="New pin" description="Say what is tracked here. You can add details, a deadline and a task next." size="sm" onClose={busy ? () => undefined : onClose} footer={<><button type="button" className={secondary} onClick={onClose} disabled={busy}>Cancel</button><button type="submit" form="new-pin-form" className={primary} disabled={busy}>{busy ? "Adding..." : "Add pin"}</button></>}>
      <form id="new-pin-form" className="space-y-3" noValidate onSubmit={(event) => void submit(event)}>
        {error ? <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger-fg">{error}</p> : null}
        <label className="block text-sm font-semibold">What is here? *<input className={field} maxLength={120} placeholder="e.g. Column C4 rebar" value={title} onChange={(e) => setTitle(e.target.value)} /></label>
        <label className="block text-sm font-semibold">Category
          <select className={field} value={category} onChange={(e) => setCategory(e.target.value as PinCategory)}>
            {(Object.keys(categoryLabels) as PinCategory[]).map((c) => <option key={c} value={c}>{categoryLabels[c]}</option>)}
          </select>
        </label>
      </form>
    </Modal>
  )
}

// One dialog for notes and text boxes: some text and a color.
function TextDialog({ title, submit: submitLabel, placeholder, rows, initialColor, onClose, onCreate }: { title: string; submit: string; placeholder: string; rows: number; initialColor: AnnotationColor; onClose: () => void; onCreate: (text: string, color: AnnotationColor) => Promise<string | null> }) {
  const [text, setText] = useState("")
  const [color, setColor] = useState<AnnotationColor>(initialColor)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const formId = `text-dialog-${title.replace(/\s+/g, "-").toLowerCase()}`
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!text.trim()) return setError("Write something first.")
    setBusy(true)
    const failure = await onCreate(text.trim(), color)
    setBusy(false)
    if (failure) setError(failure)
  }
  return (
    <Modal title={title} size="sm" onClose={busy ? () => undefined : onClose} footer={<><button type="button" className={secondary} onClick={onClose} disabled={busy}>Cancel</button><button type="submit" form={formId} className={primary} disabled={busy}>{busy ? "Adding..." : submitLabel}</button></>}>
      <form id={formId} className="space-y-3" noValidate onSubmit={(event) => void submit(event)}>
        {error ? <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger-fg">{error}</p> : null}
        <label className="block text-sm font-semibold">Text<textarea className={field} rows={rows} maxLength={500} value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder} autoFocus /></label>
        <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Color">
          {(Object.keys(annotationColors) as AnnotationColor[]).map((name) => (
            <button key={name} type="button" role="radio" aria-checked={color === name} aria-label={name} onClick={() => setColor(name)} className={`h-6 w-6 rounded-full border-2 ${color === name ? "scale-110 border-fg" : "border-line"}`} style={{ background: annotationColors[name] }} />
          ))}
        </div>
      </form>
    </Modal>
  )
}

function CalibrateDialog({ onClose, onSave }: { onClose: () => void; onSave: (meters: number) => Promise<string | null> }) {
  const [value, setValue] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const meters = Number(value.replace(",", "."))
    if (!Number.isFinite(meters) || meters <= 0) return setError("Enter the real length as a positive number of metres.")
    setBusy(true)
    const failure = await onSave(meters)
    setBusy(false)
    if (failure) setError(failure)
  }
  return (
    <Modal title="Set the sheet scale" description="Measure something whose real length you know (a wall, a grid spacing), then enter that length." size="sm" onClose={busy ? () => undefined : onClose} footer={<><button type="button" className={secondary} onClick={onClose} disabled={busy}>Cancel</button><button type="submit" form="calibrate-form" className={primary} disabled={busy}>{busy ? "Saving..." : "Save scale"}</button></>}>
      <form id="calibrate-form" className="space-y-3" noValidate onSubmit={(event) => void submit(event)}>
        {error ? <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger-fg">{error}</p> : null}
        <label className="block text-sm font-semibold">Real length of the last line you measured (metres)<input className={field} inputMode="decimal" placeholder="e.g. 6.5" value={value} onChange={(e) => setValue(e.target.value)} /></label>
      </form>
    </Modal>
  )
}
