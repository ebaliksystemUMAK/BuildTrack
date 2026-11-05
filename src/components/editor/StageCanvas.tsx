import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react"
import { clientPinStatus } from "../../lib/clientPortalModel"
import { CANVAS_ZOOM_STEP, MIN_CANVAS_SCALE as MIN_SCALE, MAX_CANVAS_SCALE as MAX_SCALE, canvasWheelFactor, fitCanvasView, zoomCanvasView } from "../../lib/canvasView"
import {
  annotationColors,
  formatMeters,
  isPointKind,
  measureDistance,
  statusDot,
  statusLabels,
  useSignedUrl,
  type Annotation,
  type AnnotationColor,
  type EditorTool,
  type Pin,
  type ShapeKind,
} from "../../lib/blueprints"
import { inRectangle, itemBox, resizeFromCorner, resizedPoints, shifted, unionBox, withGroupMembers, type ArrangeItem, type Corner } from "../../lib/arrange"
import { areaSquareMeters, bbox, centroid, formatArea, lengthMeters, limitPoints, pointsToPath, polygonAreaPx, polylineLengthPx, roundPct, simplify, type Pt } from "../../lib/geometry"
import { capsulePlacement, rotatedBounds, type Rect } from "../../lib/capsule"
import { sortByLayer } from "../../lib/layers"
import { Icon } from "./EditorToolbar"
import { imageFilesFrom } from "../../lib/sheetImages"
import { angleFromCenter, arrowHeadPx, cloudPath, constrainAngle, dimensionTickPx, rectCorners, snapAngle, toLocalAxes } from "../../lib/shapes"
import { symbolByKey, type SymbolKey } from "../../lib/symbols"
import { cssFont, displayLines, resolveFormat } from "../../lib/textFormat"

export type Point = { x: number; y: number }
export type Selection = { pin: string | null; ann: string[] }
export type Pick = { type: "pin" | "annotation"; id: string } | null
export type ContextTarget = { x: number; y: number; type: "pin" | "annotation" | "sheet"; id: string | null; at: Point | null } // at = where on the sheet (percent) the click happened
export type Measurement = { a: Point; b: Point }

type View = { scale: number; tx: number; ty: number }

type Gesture =
  | { type: "pan"; x: number; y: number; tx: number; ty: number; moved: boolean }
  | { type: "dragPin"; id: string; moved: boolean; offsetX: number; offsetY: number }
  | { type: "placePin"; id: string; x: number; y: number; moved: boolean }
  | { type: "dragAnn"; ids: string[]; start: Point; moved: boolean; target: string; reduce: boolean }
  | { type: "resize"; id: string; corner: Corner; x0: number; y0: number; orig: { x: number; y: number; w: number; h: number }; rotation: number; kind: Annotation["kind"]; moved: boolean }
  | { type: "rotate"; id: string; cx: number; cy: number; moved: boolean }
  | { type: "draw"; start: Point; moved: boolean }
  | { type: "line"; start: Point; moved: boolean }
  | { type: "measure"; start: Point; moved: boolean }
  | { type: "stroke"; moved: boolean }
  | { type: "marquee"; start: Point; additive: boolean; moved: boolean }
  | { type: "unlockTap"; id: string; x: number; y: number }

type Props = {
  src: string | null
  width: number
  height: number
  tool: EditorTool
  shapeKind: ShapeKind
  color: AnnotationColor
  strokeWidth: number // percent of the sheet width (pen / highlighter)
  symbol: SymbolKey
  symbolSize: number // percent of the sheet width
  pins: Pin[]
  numberOf: (pin: Pin) => number
  annotations: Annotation[]
  selection: Selection
  onPick: (target: Pick, additive: boolean) => void
  onMarquee: (ids: string[], additive: boolean) => void
  canEdit: boolean
  canStamp: boolean
  readOnly: boolean // presentation mode: only pan and zoom
  laser: boolean
  boxSelect: boolean
  showPins: boolean
  showNotes: boolean
  showShapes: boolean
  showDrawings: boolean
  showBase: boolean
  hiddenIds: Set<string>
  hiddenPinIds: Set<string>
  measurements: Measurement[]
  scaleWidthM: number | null
  draftPin: Point | null
  onPlacePin: (point: Point) => void
  onPlaceNote: (point: Point) => void
  onPlaceText: (point: Point) => void
  onPlaceSymbol: (point: Point) => void
  onCreateShape: (shape: { shape: ShapeKind; x: number; y: number; w: number; h: number }) => void
  onCreateStroke: (kind: "draw" | "highlight", points: Pt[]) => void
  onCreateLine: (kind: "arrow" | "dimension", points: Pt[]) => void
  onCreatePath: (kind: "polyline" | "area" | "cloud", points: Pt[]) => void
  onMovePin: (id: string, x: number, y: number) => void
  movingPinId?: string | null
  onCancelPinMove?: () => void
  onMoveMany: (ids: string[], dx: number, dy: number) => void
  onResizeAnnotation: (id: string, box: { x: number; y: number; w: number; h: number }) => void
  onToggleLock: (id: string) => void
  // Quick actions for the selection, shown as a floating capsule above its box (hidden while it is being moved or resized).
  quick?: { locked: boolean; canDelete: boolean; onComment: () => void; onToggleLock: () => void; onDuplicate?: () => void; onMovePin?: () => void; onDelete: () => void; onMore: (x: number, y: number) => void }
  onViewScale?: (scale: number) => void
  onRotate: (id: string, degrees: number) => void
  onDropFiles: (files: File[], at: Point | null) => void
  onStamp: (pinId: string) => void
  onMeasure: (a: Point, b: Point) => void
  onBlocked: (message: string) => void
  onContextMenu: (target: ContextTarget) => void
  fitSignal?: number // changes when the caller wants the sheet re-fitted (for example entering presentation mode)
  zoomApi?: (api: { fit: () => void; zoomIn: () => void; zoomOut: () => void }) => void
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
const round = (value: number) => Math.round(value * 10000) / 10000
const PIN_Z = 100000
const HIGHLIGHT_OPACITY = 0.4
const PATH_TOOLS: EditorTool[] = ["polyline", "area", "cloud"]

const toArrange = (a: Annotation): ArrangeItem => ({ id: a.id, kind: a.kind, x: a.x, y: a.y, w: a.w, h: a.h, points: a.points, text: a.text, font_size: a.font_size })

// The stage of the editor: the sheet with pan / zoom (wheel, drag, pinch) and every tool drawn on top of it.
// Everything on the sheet is positioned in percent of the image, so it stays exact at any zoom and on any screen;
// markers and callouts are scaled back so they keep a readable on-screen size, while drawings, symbols and text boxes
// scale with the plan (they are part of the drawing). Annotations are stacked by their z_index (layer order).
export default function StageCanvas(props: Props) {
  const { src, width, height, tool, shapeKind, color, pins, numberOf, annotations, selection, canEdit, canStamp, scaleWidthM, strokeWidth, readOnly } = props
  const box = useRef<HTMLDivElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const [view, setView] = useState<View>({ scale: 1, tx: 0, ty: 0 })
  const viewRef = useRef(view)
  const adjusted = useRef(false) // true once the user zooms or pans; until then the sheet re-fits when the window changes
  viewRef.current = view
  const propsRef = useRef(props)
  propsRef.current = props
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const gesture = useRef<Gesture | null>(null)
  const pinch = useRef<{ dist: number; scale: number; tx: number; ty: number; mid: { x: number; y: number } } | null>(null)
  const hit = useRef<{ kind: "pin" | "ann" | "handle" | null; id: string }>({ kind: null, id: "" })
  const lastTap = useRef<{ time: number; x: number; y: number } | null>(null)
  const strokeRef = useRef<Pt[]>([])
  const [dragging, setDragging] = useState<{ type: "pin"; id: string; x: number; y: number } | { type: "ann"; ids: string[]; dx: number; dy: number } | { type: "resize"; id: string; x: number; y: number; w: number; h: number } | { type: "rotate"; id: string; deg: number } | null>(null)
  const [drawing, setDrawing] = useState<{ a: Point; b: Point; mode: "shape" | "measure" | "cloud" | "arrow" | "dimension" } | null>(null)
  const [marquee, setMarquee] = useState<{ a: Point; b: Point } | null>(null)
  const [measureStart, setMeasureStart] = useState<Point | null>(null)
  const [hover, setHover] = useState<Point | null>(null)
  const [livePen, setLivePen] = useState<Pt[] | null>(null)
  const [pathPts, setPathPts] = useState<Pt[]>([])
  const [dropActive, setDropActive] = useState(false)
  const [laserAt, setLaserAt] = useState<{ x: number; y: number } | null>(null)
  const pathRef = useRef<Pt[]>([])
  pathRef.current = pathPts
  const ctxSize = useMemo(() => ({ width, height }), [width, height])

  const fit = useCallback(() => {
    const element = box.current
    if (!element || !width || !height) return
    if (element.clientWidth < 40 || element.clientHeight < 40) return // layout not ready yet
    adjusted.current = false
    setView(fitCanvasView({width,height},{width:element.clientWidth,height:element.clientHeight}))
  }, [width, height])

  useLayoutEffect(() => {
    fit()
  }, [fit, src, props.fitSignal])

  // Re-fit when the surrounding panels open or close.
  useEffect(() => {
    const element = box.current
    if (!element || typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(() => {
      if (!adjusted.current) fit()
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [fit])

  const zoomAt = useCallback((factor: number, point?: { x: number; y: number }) => {
    const element = box.current
    if (!element) return
    const current = viewRef.current
    const center = point ?? { x: element.clientWidth / 2, y: element.clientHeight / 2 }
    adjusted.current = true
    setView(zoomCanvasView(current,factor,center))
  }, [])

  useEffect(() => {
    props.onViewScale?.(view.scale)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.scale])

  useEffect(() => {
    props.zoomApi?.({ fit, zoomIn: () => zoomAt(CANVAS_ZOOM_STEP), zoomOut: () => zoomAt(1 / CANVAS_ZOOM_STEP) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fit, zoomAt])

  useEffect(() => {
    const element = box.current
    if (!element) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const rect = element.getBoundingClientRect()
      zoomAt(canvasWheelFactor(event.deltaY), { x: event.clientX - rect.left, y: event.clientY - rect.top })
    }
    element.addEventListener("wheel", onWheel, { passive: false })
    return () => element.removeEventListener("wheel", onWheel)
  }, [zoomAt])

  const finishPath = useCallback((points: Pt[]) => {
    const p = propsRef.current
    const kind = p.tool === "area" ? "area" : p.tool === "cloud" ? "cloud" : "polyline"
    const needed = kind === "polyline" ? 2 : 3
    if (points.length >= needed) p.onCreatePath(kind, limitPoints(points, kind === "cloud" ? 60 : 300))
    setPathPts([])
    setHover(null)
  }, [])

  // Esc abandons a half-finished shape, stroke, path or measurement; Enter completes a polyline / area / cloud.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (document.querySelector("[data-bt-dialog]")) return
      const target = event.target
      if (target instanceof Element && target.closest("input, textarea, select, [contenteditable=true]")) return
      if (event.key === "Escape") {
        setMeasureStart(null)
        setDrawing(null)
        setLivePen(null)
        setMarquee(null)
        setPathPts([])
        strokeRef.current = []
        gesture.current = null
      } else if (event.key === "Enter") {
        if (pathRef.current.length) finishPath(pathRef.current)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [finishPath])

  useEffect(() => {
    setMeasureStart(null)
    setDrawing(null)
    setHover(null)
    setLivePen(null)
    setMarquee(null)
    setPathPts([])
    strokeRef.current = []
  }, [tool, src])

  const toPercent = (clientX: number, clientY: number): Point | null => {
    const rect = stage.current?.getBoundingClientRect()
    if (!rect || !rect.width || !rect.height) return null
    return { x: clamp(round(((clientX - rect.left) / rect.width) * 100), 0, 100), y: clamp(round(((clientY - rect.top) / rect.height) * 100), 0, 100) }
  }

  const annById = (id: string) => annotations.find((item) => item.id === id)
  const isVisible = useCallback((a: Annotation) => !props.hiddenIds.has(a.id) && (a.kind === "shape" ? props.showShapes : a.kind === "note" || a.kind === "text" || a.kind === "image" ? props.showNotes : props.showDrawings), [props.showShapes, props.showNotes, props.showDrawings, props.hiddenIds])

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 && event.pointerType === "mouse") return
    event.currentTarget.setPointerCapture(event.pointerId)
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    const target = event.target as Element
    const pinId = target.closest<HTMLElement>("[data-pin-id]")?.dataset.pinId
    const rawAnnId = target.closest<Element>("[data-ann-id]")?.getAttribute("data-ann-id") ?? undefined
    // A locked item can be selected (to see its lock badge and unlock it) but it never moves: dragging it pans the sheet.
    const annId = rawAnnId
    const handleId = target.closest<HTMLElement>("[data-handle]")?.dataset.handle
    hit.current = handleId ? { kind: "handle", id: handleId } : pinId ? { kind: "pin", id: pinId } : annId ? { kind: "ann", id: annId } : { kind: null, id: "" }

    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      const rect = box.current!.getBoundingClientRect()
      const current = viewRef.current
      pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, scale: current.scale, tx: current.tx, ty: current.ty, mid: { x: (a.x + b.x) / 2 - rect.left, y: (a.y + b.y) / 2 - rect.top } }
      gesture.current = null
      setDrawing(null)
      setLivePen(null)
      setMarquee(null)
      strokeRef.current = []
      return
    }
    if (pointers.current.size !== 1) return

    const point = toPercent(event.clientX, event.clientY)
    const current = viewRef.current
    const panGesture: Gesture = { type: "pan", x: event.clientX, y: event.clientY, tx: current.tx, ty: current.ty, moved: false }
    const additive = event.shiftKey || event.ctrlKey || event.metaKey
    const pressedPin = hit.current.kind === "pin" ? pins.find((item) => item.id === hit.current.id) : undefined
    const pressedAnn = hit.current.kind === "ann" ? annById(hit.current.id) : undefined

    if (readOnly) {
      gesture.current = panGesture
      return
    }

    const relocating = props.movingPinId ? pins.find(pin => pin.id === props.movingPinId) : null
    if (canEdit && tool === "select" && relocating && !relocating.locked && props.showPins && !props.hiddenPinIds.has(relocating.id) && point) {
      event.preventDefault()
      gesture.current = { type: "placePin", id: relocating.id, x: event.clientX, y: event.clientY, moved: false }
      return
    }

    if (hit.current.kind === "handle" && canEdit && point) {
      const ann = selection.ann.length === 1 ? annById(selection.ann[0]) : undefined
      if (ann && ann.locked && hit.current.id === "unlock") gesture.current = { type: "unlockTap", id: ann.id, x: event.clientX, y: event.clientY }
      else if (!ann || ann.locked) gesture.current = panGesture
      else if (hit.current.id === "rotate") {
        const element = stage.current?.querySelector<HTMLElement>(`[data-ann-id="${ann.id}"]`)
        const rect = element?.getBoundingClientRect()
        gesture.current = rect ? { type: "rotate", id: ann.id, cx: rect.left + rect.width / 2, cy: rect.top + rect.height / 2, moved: false } : panGesture
      } else if (ann.w !== null || isPointKind(ann.kind)) gesture.current = { type: "resize", id: ann.id, corner: (["nw", "ne", "sw", "se"].includes(hit.current.id) ? hit.current.id : "se") as Corner, x0: event.clientX, y0: event.clientY, orig: itemBox(toArrange(ann), ctxSize), rotation: isPointKind(ann.kind) ? 0 : ann.rotation, kind: ann.kind, moved: false }
      else gesture.current = panGesture
      return
    }

    // Select tool: pressing an item selects it straight away, and dragging moves it (and the rest of the selection / group).
    if (tool === "select") {
      if (pressedPin) {
        props.onPick({ type: "pin", id: pressedPin.id }, false)
        gesture.current = canEdit && !pressedPin.locked && point ? { type: "dragPin", id: pressedPin.id, moved: false, offsetX: pressedPin.x - point.x, offsetY: pressedPin.y - point.y } : panGesture
        return
      }
      if (pressedAnn) {
        if (additive) {
          props.onPick({ type: "annotation", id: pressedAnn.id }, true)
          gesture.current = panGesture
          return
        }
        const already = selection.ann.includes(pressedAnn.id)
        const ids = already ? selection.ann : withGroupMembers(annotations, [pressedAnn.id])
        if (!already) props.onPick({ type: "annotation", id: pressedAnn.id }, false)
        const anyLocked = ids.some((id) => annById(id)?.locked)
        if (!canEdit) gesture.current = panGesture
        else if (anyLocked) gesture.current = panGesture
        else if (point) gesture.current = { type: "dragAnn", ids, start: point, moved: false, target: pressedAnn.id, reduce: already && ids.length > 1 }
        else gesture.current = panGesture
        return
      }
      if (point && (event.shiftKey || props.boxSelect)) {
        gesture.current = { type: "marquee", start: point, additive: event.shiftKey || event.ctrlKey || event.metaKey, moved: false }
        return
      }
      gesture.current = panGesture
      return
    }

    if ((tool === "pen" || tool === "highlighter") && canEdit && point) {
      strokeRef.current = [[point.x, point.y]]
      setLivePen([[point.x, point.y]])
      gesture.current = { type: "stroke", moved: false }
    } else if (tool === "shape" && canEdit && hit.current.kind === null && point) {
      gesture.current = { type: "draw", start: point, moved: false }
    } else if ((tool === "arrow" || tool === "dimension") && canEdit && point) {
      gesture.current = { type: "line", start: point, moved: false }
    } else if (tool === "cloud" && canEdit && point && hit.current.kind === null) {
      gesture.current = { type: "draw", start: point, moved: false }
    } else if (tool === "measure" && hit.current.kind === null && point) {
      gesture.current = { type: "measure", start: point, moved: false }
    } else {
      gesture.current = panGesture
    }
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (props.laser) {
      const rect = box.current?.getBoundingClientRect()
      if (rect) setLaserAt({ x: event.clientX - rect.left, y: event.clientY - rect.top })
    }
    if ((tool === "measure" && measureStart && !pointers.current.has(event.pointerId)) || (PATH_TOOLS.includes(tool) && pathPts.length && !pointers.current.has(event.pointerId))) {
      const raw = toPercent(event.clientX, event.clientY)
      const last = pathPts[pathPts.length - 1]
      setHover(raw && last && event.shiftKey && tool === "polyline" ? ((p) => ({ x: p[0], y: p[1] }))(constrainAngle(last, [raw.x, raw.y], width, height)) : raw)
      return
    }
    if (!pointers.current.has(event.pointerId)) return
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (pinch.current && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()]
      const start = pinch.current
      const scale = clamp(start.scale * (Math.hypot(a.x - b.x, a.y - b.y) / start.dist), MIN_SCALE, MAX_SCALE)
      const ratio = scale / start.scale
      adjusted.current = true
      setView({ scale, tx: start.mid.x - (start.mid.x - start.tx) * ratio, ty: start.mid.y - (start.mid.y - start.ty) * ratio })
      return
    }
    const g = gesture.current
    if (!g) return
    const point = toPercent(event.clientX, event.clientY)
    if (g.type === "placePin") {
      if (Math.hypot(event.clientX - g.x, event.clientY - g.y) > 6) g.moved = true
    } else if (g.type === "pan") {
      const dx = event.clientX - g.x
      const dy = event.clientY - g.y
      if (Math.abs(dx) + Math.abs(dy) > 4) g.moved = true
      if (g.moved) {
        adjusted.current = true
        setView({ ...viewRef.current, tx: g.tx + dx, ty: g.ty + dy })
      }
    } else if (g.type === "dragPin" && point) {
      g.moved = true
      setDragging({ type: "pin", id: g.id, x: clamp(point.x + g.offsetX, 0, 100), y: clamp(point.y + g.offsetY, 0, 100) })
    } else if (g.type === "dragAnn" && point) {
      const moved = Math.abs(point.x - g.start.x) + Math.abs(point.y - g.start.y) > 0.3
      if (moved) g.moved = true
      if (g.moved) {
        const items = g.ids.map(annById).filter((a): a is Annotation => !!a).map(toArrange)
        const all = unionBox(items.map((item) => itemBox(item, ctxSize)))
        const dx = clamp(point.x - g.start.x, -all.x, 100 - (all.x + all.w))
        const dy = clamp(point.y - g.start.y, -all.y, 100 - (all.y + all.h))
        setDragging({ type: "ann", ids: g.ids, dx, dy })
      }
    } else if (g.type === "resize") {
      const scale = viewRef.current.scale
      const local = toLocalAxes((event.clientX - g.x0) / scale, (event.clientY - g.y0) / scale, g.rotation)
      const dxPct = (local.x / width) * 100
      const dyPct = (local.y / height) * 100
      g.moved = true
      if (g.kind === "text" || g.kind === "symbol") {
        const max = g.kind === "symbol" ? Math.min(30, 100 - g.orig.x) : 100 - g.orig.x
        setDragging({ type: "resize", id: g.id, x: g.orig.x, y: g.orig.y, w: clamp(g.orig.w + dxPct, g.kind === "symbol" ? 0.5 : 1, max), h: 0 })
      } else {
        const lock = g.kind === "image" ? !event.shiftKey : event.shiftKey
        setDragging({ type: "resize", id: g.id, ...resizeFromCorner(g.orig, g.corner, local.x, local.y, g.rotation, { width, height }, lock) })
      }
    } else if (g.type === "rotate") {
      g.moved = true
      const raw = angleFromCenter(g.cx, g.cy, event.clientX, event.clientY)
      setDragging({ type: "rotate", id: g.id, deg: event.shiftKey ? snapAngle(raw, 15) : Math.round(raw * 10) / 10 })
    } else if (g.type === "stroke" && point) {
      const last = strokeRef.current[strokeRef.current.length - 1]
      if (!last || Math.hypot(((point.x - last[0]) / 100) * width, ((point.y - last[1]) / 100) * height) >= 1.2 / viewRef.current.scale) {
        strokeRef.current.push([point.x, point.y])
        g.moved = true
        setLivePen([...strokeRef.current])
      }
    } else if (g.type === "marquee" && point) {
      if (Math.abs(point.x - g.start.x) + Math.abs(point.y - g.start.y) > 0.4) g.moved = true
      if (g.moved) setMarquee({ a: g.start, b: point })
    } else if (g.type === "line" && point) {
      if (Math.abs(point.x - g.start.x) + Math.abs(point.y - g.start.y) > 0.5) g.moved = true
      if (g.moved) {
        const end = event.shiftKey ? ((p) => ({ x: p[0], y: p[1] }))(constrainAngle([g.start.x, g.start.y], [point.x, point.y], width, height)) : point
        setDrawing({ a: g.start, b: end, mode: propsRef.current.tool === "dimension" ? "dimension" : "arrow" })
      }
    } else if ((g.type === "draw" || g.type === "measure") && point) {
      if (Math.abs(point.x - g.start.x) + Math.abs(point.y - g.start.y) > 0.5) g.moved = true
      if (g.moved) setDrawing({ a: g.start, b: point, mode: g.type === "measure" ? "measure" : propsRef.current.tool === "cloud" ? "cloud" : "shape" })
    }
  }

  const tapPath = (point: Point, event: ReactPointerEvent<HTMLDivElement>) => {
    const p = propsRef.current
    const now = Date.now()
    const previous = lastTap.current
    lastTap.current = { time: now, x: event.clientX, y: event.clientY }
    const doubleTap = previous && now - previous.time < 380 && Math.hypot(event.clientX - previous.x, event.clientY - previous.y) < 10
    const first = pathPts[0]
    const closing = p.tool !== "polyline" && pathPts.length >= 3 && first && Math.hypot(((point.x - first[0]) / 100) * width * viewRef.current.scale, ((point.y - first[1]) / 100) * height * viewRef.current.scale) < 14
    if (doubleTap || closing) return finishPath(pathPts)
    let next: Pt = [point.x, point.y]
    const last = pathPts[pathPts.length - 1]
    if (event.shiftKey && last && p.tool === "polyline") next = constrainAngle(last, next, width, height)
    setPathPts([...pathPts, next])
  }

  const finish = (event: ReactPointerEvent<HTMLDivElement>) => {
    const wasSingle = pointers.current.size === 1
    pointers.current.delete(event.pointerId)
    if (pointers.current.size < 2) pinch.current = null
    const g = gesture.current
    if (pointers.current.size === 0) gesture.current = null
    if (!g || !wasSingle) return
    const p = propsRef.current
    const point = toPercent(event.clientX, event.clientY)
    const pressed = hit.current

    if (g.type === "placePin") {
      const pin = p.pins.find(row => row.id === g.id)
      if (!g.moved && point && p.movingPinId === g.id && p.canEdit && !p.readOnly && p.tool === "select" && pin && !pin.locked && p.showPins && !p.hiddenPinIds.has(pin.id)) p.onMovePin(g.id, point.x, point.y)
      return
    }

    if (g.type === "unlockTap") {
      if (Math.hypot(event.clientX - g.x, event.clientY - g.y) < 6) p.onToggleLock(g.id)
      return
    }
    if (g.type === "stroke") {
      const raw = strokeRef.current
      strokeRef.current = []
      setLivePen(null)
      if (raw.length >= 2) {
        const tolerance = Math.max(0.6, 1.4 / viewRef.current.scale)
        const points = limitPoints(simplify(raw, tolerance, width, height), 600).map(([x, y]) => [roundPct(x), roundPct(y)] as Pt)
        if (points.length >= 2) p.onCreateStroke(p.tool === "highlighter" ? "highlight" : "draw", points)
      }
      return
    }
    if (g.type === "marquee") {
      setMarquee(null)
      if (g.moved && point) {
        const rect = { x: Math.min(g.start.x, point.x), y: Math.min(g.start.y, point.y), w: Math.abs(point.x - g.start.x), h: Math.abs(point.y - g.start.y) }
        const ids = inRectangle(annotations.filter((a) => isVisible(a) && !a.locked).map(toArrange), rect, ctxSize, "touch")
        p.onMarquee(ids, g.additive)
      } else p.onPick(null, false)
      return
    }
    if (g.type === "dragPin") {
      const pin = p.pins.find(row => row.id === g.id)
      if (g.moved && dragging?.type === "pin" && p.canEdit && !p.readOnly && p.tool === "select" && pin && !pin.locked) p.onMovePin(g.id, dragging.x, dragging.y)
      setDragging(null)
      return
    }
    if (g.type === "dragAnn") {
      if (g.moved && dragging?.type === "ann") p.onMoveMany(g.ids, dragging.dx, dragging.dy)
      else if (!g.moved && g.reduce) p.onPick({ type: "annotation", id: g.target }, false)
      setDragging(null)
      return
    }
    if (g.type === "resize") {
      if (dragging?.type === "resize") p.onResizeAnnotation(g.id, { x: dragging.x, y: dragging.y, w: dragging.w, h: dragging.h })
      setDragging(null)
      return
    }
    if (g.type === "rotate") {
      if (dragging?.type === "rotate") p.onRotate(g.id, dragging.deg)
      setDragging(null)
      return
    }
    if (g.type === "line") {
      setDrawing(null)
      if (g.moved && point) {
        const end: Pt = event.shiftKey ? constrainAngle([g.start.x, g.start.y], [point.x, point.y], width, height) : [point.x, point.y]
        if (Math.hypot(((end[0] - g.start.x) / 100) * width, ((end[1] - g.start.y) / 100) * height) >= 6 / viewRef.current.scale) p.onCreateLine(p.tool === "dimension" ? "dimension" : "arrow", [[g.start.x, g.start.y], end])
      }
      return
    }
    if (g.type === "draw") {
      setDrawing(null)
      if (g.moved && point) {
        const x = Math.min(g.start.x, point.x)
        const y = Math.min(g.start.y, point.y)
        const w = Math.abs(point.x - g.start.x)
        const h = Math.abs(point.y - g.start.y)
        if (p.tool === "cloud") {
          if (w >= 1 && h >= 1) p.onCreatePath("cloud", rectCorners([g.start.x, g.start.y], [point.x, point.y]))
        } else if (w >= 1 && h >= 1) p.onCreateShape({ shape: shapeKind, x, y, w, h })
      } else if (!g.moved && point && p.tool === "cloud") tapPath(point, event)
      return
    }
    if (g.type === "measure") {
      setDrawing(null)
      if (g.moved && point) {
        setMeasureStart(null)
        p.onMeasure(g.start, point)
      } else if (point) {
        if (!measureStart) setMeasureStart(point)
        else {
          p.onMeasure(measureStart, point)
          setMeasureStart(null)
          setHover(null)
        }
      }
      return
    }
    if (g.type === "pan" && !g.moved) {
      // A tap / click that did not drag.
      if (readOnly) return
      if (point && canEdit && (p.tool === "polyline" || p.tool === "area" || p.tool === "cloud")) return tapPath(point, event)
      if (point && canEdit && p.tool === "text") return p.onPlaceText(point)
      if (point && canEdit && p.tool === "symbol") return p.onPlaceSymbol(point)
      if (p.tool === "select") {
        if (pressed.kind === null) p.onPick(null, false)
        return
      }
      if (pressed.kind === "pin") return p.tool === "stamp" && canStamp ? p.onStamp(pressed.id) : p.onPick({ type: "pin", id: pressed.id }, false)
      if (pressed.kind === "ann") return p.onPick({ type: "annotation", id: pressed.id }, false)
      if (point && canEdit && p.tool === "pin") return p.onPlacePin(point)
      if (point && canEdit && p.tool === "note") return p.onPlaceNote(point)
      p.onPick(null, false)
    }
  }

  const onContextMenu = (event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault()
    if (readOnly) return
    const target = event.target as Element
    const pinId = target.closest<HTMLElement>("[data-pin-id]")?.dataset.pinId
    const annId = target.closest<Element>("[data-ann-id]")?.getAttribute("data-ann-id")
    props.onContextMenu({ x: event.clientX, y: event.clientY, type: pinId ? "pin" : annId ? "annotation" : "sheet", id: pinId ?? annId ?? null, at: toPercent(event.clientX, event.clientY) })
  }

  const livePin = (pin: Pin) => (dragging?.type === "pin" && dragging.id === pin.id ? { x: dragging.x, y: dragging.y } : pin)
  const liveAnn = (ann: Annotation): Annotation => {
    if (dragging?.type === "ann" && dragging.ids.includes(ann.id)) {
      const move = shifted(toArrange(ann), dragging.dx, dragging.dy, ctxSize)
      if (move.points) {
        const b = bbox(move.points)
        return { ...ann, x: b.x, y: b.y, points: move.points }
      }
      return { ...ann, x: move.x ?? ann.x, y: move.y ?? ann.y }
    }
    if (dragging?.type === "resize" && dragging.id === ann.id) return isPointKind(ann.kind) && ann.points ? { ...ann, points: resizedPoints(ann.points, dragging) } : { ...ann, x: dragging.x, y: dragging.y, w: dragging.w, h: ann.h === null ? null : dragging.h }
    if (dragging?.type === "rotate" && dragging.id === ann.id) return { ...ann, rotation: dragging.deg }
    return ann
  }
  const inverse = 1 / view.scale
  const px = (point: Point) => ({ x: (point.x / 100) * width, y: (point.y / 100) * height })
  const relocatingPin = canEdit && !readOnly && tool === "select" && props.showPins ? pins.find(pin => pin.id === props.movingPinId && !pin.locked && !props.hiddenPinIds.has(pin.id)) : null
  const cursor = readOnly ? (props.laser ? "cursor-none" : "cursor-grab") : relocatingPin ? "cursor-crosshair" : tool === "select" ? "cursor-grab" : tool === "stamp" ? "cursor-pointer" : "cursor-crosshair"

  const measureLabel = (a: Point, b: Point) => {
    const { px: distance, meters } = measureDistance(a, b, width, height, scaleWidthM)
    return meters !== null ? formatMeters(meters) : `${Math.round(distance)} px (no scale)`
  }
  const lengthLabel = (points: Pt[], closed = false) => {
    const px2 = polylineLengthPx(points, width, height, closed)
    const meters = lengthMeters(px2, width, scaleWidthM)
    return meters !== null ? formatMeters(meters) : `${Math.round(px2)} px`
  }
  const areaLabel = (points: Pt[]) => {
    const px2 = polygonAreaPx(points, width, height)
    const m2 = areaSquareMeters(px2, width, scaleWidthM)
    return m2 !== null ? formatArea(m2) : `${Math.round(px2).toLocaleString("en-PH")} px²`
  }

  // Everything drawn by users, bottom to top. Hidden layers still keep their rank so the order never changes when toggled.
  const ordered = useMemo(() => sortByLayer(annotations), [annotations])
  const halo = { paintOrder: "stroke" as const, stroke: "#fff", strokeWidth: 4 * inverse, strokeLinejoin: "round" as const }
  const penColor = annotationColors[color]
  const penPx = (strokeWidth / 100) * width
  const cloudBump = (strokePx: number) => Math.max(strokePx * 6, width * 0.0117)
  const selectedAnn = selection.ann.map(annById).filter((a): a is Annotation => !!a).map(liveAnn)
  const lockedSelected = useMemo(() => {
    if (selection.ann.length !== 1) return null
    const a = annotations.find((item) => item.id === selection.ann[0])
    return a && a.locked ? { id: a.id, box: itemBox(toArrange(a), ctxSize) } : null
  }, [selection.ann, annotations, ctxSize])

  // Floating capsule above the selection.
  const [boxSize, setBoxSize] = useState({ w: 0, h: 0 })
  useEffect(() => {
    const element = box.current
    if (!element || typeof ResizeObserver === "undefined") return
    const measure = () => setBoxSize({ w: element.clientWidth, h: element.clientHeight })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const quickCount = props.quick ? 4 + (props.quick.onDuplicate ? 1 : 0) : 0
  const capsule = useMemo(() => {
    if (!props.quick || readOnly || tool !== "select" || dragging || boxSize.w < 160) return null
    let target: Rect | null = null
    let lift = 0
    if (selection.pin) {
      const pin = pins.find((item) => item.id === selection.pin)
      if (!pin) return null
      target = { x: (pin.x / 100) * width, y: (pin.y / 100) * height, w: 0, h: 0 }
      lift = 16
    } else if (selection.ann.length) {
      const items = annotations.filter((a) => selection.ann.includes(a.id) && !props.hiddenIds.has(a.id))
      if (!items.length) return null
      const rects = items.map((a) => {
        const b = itemBox(toArrange(a), ctxSize)
        const sheetBox = { x: (b.x / 100) * width, y: (b.y / 100) * height, w: (b.w / 100) * width, h: (b.h / 100) * height }
        return a.rotation && (a.kind === "shape" || a.kind === "text" || a.kind === "symbol" || a.kind === "image") ? rotatedBounds(sheetBox, a.rotation) : sheetBox
      })
      const left = Math.min(...rects.map((r) => r.x))
      const top = Math.min(...rects.map((r) => r.y))
      target = { x: left, y: top, w: Math.max(...rects.map((r) => r.x + r.w)) - left, h: Math.max(...rects.map((r) => r.y + r.h)) - top }
      if (items.length === 1 && items[0].kind === "note") lift = 96 // a note draws its callout above its anchor point
    }
    if (!target) return null
    return capsulePlacement(target, view, { width: boxSize.w, height: boxSize.h }, { width: quickCount * 36 + 20, height: 44 }, { lift })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.quick, readOnly, tool, dragging, boxSize, selection, annotations, pins, view, quickCount, ctxSize, width, height, props.hiddenIds])

  const selectionBox = selectedAnn.length >= 2 ? unionBox(selectedAnn.map((a) => itemBox(toArrange(a), ctxSize))) : null

  return (
    <div
      ref={box}
      className={`relative h-full min-h-[240px] w-full select-none overflow-hidden bg-[#2b2830] ${cursor}`}
      style={{ touchAction: "none" }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finish}
      onPointerCancel={event => {
        if (gesture.current?.type === "resize" || gesture.current?.type === "dragPin" || gesture.current?.type === "placePin") {
          pointers.current.delete(event.pointerId)
          gesture.current = null
          setDragging(null)
        } else finish(event)
      }}
      onPointerLeave={() => props.laser && setLaserAt(null)}
      onContextMenu={onContextMenu}
      onDragOver={(event) => {
        if (readOnly || !canEdit || !Array.from(event.dataTransfer.types).includes("Files")) return
        event.preventDefault()
        setDropActive(true)
      }}
      onDragLeave={() => setDropActive(false)}
      onDrop={(event) => {
        setDropActive(false)
        if (readOnly || !canEdit) return
        const files = imageFilesFrom(event.dataTransfer.files)
        if (!files.length) return
        event.preventDefault()
        props.onDropFiles(files, toPercent(event.clientX, event.clientY))
      }}
    >
      {src ? (
        <div ref={stage} className="absolute left-0 top-0 origin-top-left shadow-2xl" style={{ width, height, transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})` }}>
          <img src={src} alt="Blueprint sheet" draggable={false} className="pointer-events-none block h-full w-full max-w-none bg-white" style={{ opacity: props.showBase ? 1 : 0 }} />

          {ordered.map((raw, rank) => {
            if (!isVisible(raw)) return null
            const a = liveAnn(raw)
            const isSelected = selection.ann.includes(a.id)
            const hex = annotationColors[a.color]
            const z = rank + 1
            const movable = isSelected && canEdit && tool === "select" && !a.locked && !readOnly
            const cursorStyle = a.locked ? "default" : movable ? "move" : "pointer"
            const outline = isSelected ? `${2 * inverse}px dashed ${hex}` : undefined
            const turn = a.rotation ? `rotate(${a.rotation}deg)` : undefined
            const handles = isSelected && canEdit && !a.locked && selection.ann.length === 1 && !readOnly
            const handleColor = a.kind === "image" ? "#9e1f93" : hex
            const cornerHandles = (color: string) =>
              handles
                ? (["nw", "ne", "sw", "se"] as Corner[]).map((corner) => (
                    <span key={corner} data-handle={corner} title="Drag to resize (Shift: shape / free)" className="absolute rounded-sm border-2 border-white shadow" style={{ width: 24 * inverse, height: 24 * inverse, [corner.includes("n") ? "top" : "bottom"]: -12 * inverse, [corner.includes("w") ? "left" : "right"]: -12 * inverse, background: color, cursor: corner === "nw" || corner === "se" ? "nwse-resize" : "nesw-resize" }} />
                  ))
                : null
            const rotateHandle = handles ? (
              <>
                <span className="pointer-events-none absolute left-1/2 w-px -translate-x-1/2 bg-current" style={{ top: -26 * inverse, height: 26 * inverse, color: handleColor }} />
                <span data-handle="rotate" title="Drag to rotate (Shift = 15 degree steps)" className="absolute left-1/2 rounded-full border-2 border-white shadow" style={{ width: 16 * inverse, height: 16 * inverse, top: -36 * inverse, background: handleColor, cursor: "grab", transform: "translateX(-50%)" }} />
              </>
            ) : null

            if (a.kind === "shape") {
              return (
                <div
                  key={a.id}
                  data-ann-id={a.id}
                  className={`absolute ${a.shape === "ellipse" ? "rounded-[50%]" : ""}`}
                  style={{ zIndex: z, opacity: a.opacity, left: `${a.x}%`, top: `${a.y}%`, width: `${a.w}%`, height: `${a.h}%`, transform: turn, border: `${(isSelected ? 3 : 2) * inverse}px ${isSelected ? "dashed" : "solid"} ${hex}`, background: `${hex}2e`, cursor: cursorStyle }}
                >
                  {a.text ? <span className="pointer-events-none absolute left-0 top-0 origin-top-left whitespace-nowrap rounded-br px-1 font-bold text-white" style={{ background: hex, fontSize: 12, transform: `scale(${inverse})` }}>{a.text}</span> : null}
                  {cornerHandles(hex)}
                  {rotateHandle}
                </div>
              )
            }

            if (a.kind === "note") {
              return (
                <div
                  key={a.id}
                  data-ann-id={a.id}
                  className={`absolute w-44 origin-bottom-left rounded-md border bg-white px-2 py-1.5 text-left text-xs leading-snug text-[#1d1d1f] shadow-lg ${isSelected ? "ring-4 ring-black/25" : ""}`}
                  style={{ zIndex: z, opacity: a.opacity, left: `${a.x}%`, top: `${a.y}%`, borderColor: hex, borderLeftWidth: 5, transform: `translate(0, -100%) scale(${inverse})`, cursor: cursorStyle }}
                >
                  <span className="line-clamp-4 block whitespace-pre-wrap" style={cssFont(resolveFormat("note", a.format))}>{displayLines(a.text, resolveFormat("note", a.format)).join("\n")}</span>
                  <span className="absolute -bottom-1.5 left-2 h-3 w-3 rotate-45 border-b border-r bg-white" style={{ borderColor: hex }} />
                </div>
              )
            }

            if (a.kind === "text") {
              const fontPx = ((a.font_size ?? 1.6) / 100) * width
              const look = resolveFormat("text", a.format)
              return (
                <div
                  key={a.id}
                  data-ann-id={a.id}
                  className="absolute whitespace-pre-wrap break-words"
                  style={{ ...cssFont(look), zIndex: z, opacity: a.opacity, left: `${a.x}%`, top: `${a.y}%`, width: a.w ? `${a.w}%` : "max-content", transform: turn, color: hex, fontSize: fontPx, textShadow: a.color === "black" ? "0 0 4px #fff, 0 0 4px #fff" : "0 0 3px #fff, 0 0 3px #fff, 0 0 1px #000", outline, outlineOffset: 3 * inverse, cursor: cursorStyle }}
                >
                  {displayLines(a.text, look).join("\n")}
                  {handles && a.w ? <span data-handle="se" className="absolute rounded-sm border-2 border-white" style={{ width: 12 * inverse, height: 12 * inverse, right: -6 * inverse, bottom: -6 * inverse, background: hex, cursor: "ew-resize" }} /> : null}
                  {rotateHandle}
                </div>
              )
            }

            if (a.kind === "symbol") {
              const def = a.symbol ? symbolByKey[a.symbol as SymbolKey] : undefined
              if (!def) return null
              return (
                <div
                  key={a.id}
                  data-ann-id={a.id}
                  className="absolute rounded-md bg-white/85 shadow-sm"
                  style={{ zIndex: z, opacity: a.opacity, left: `${a.x}%`, top: `${a.y}%`, width: `${a.w}%`, height: `${((a.w ?? 4) * width) / height}%`, transform: turn, outline, outlineOffset: 3 * inverse, cursor: cursorStyle }}
                  title={def.label}
                >
                  <svg viewBox="0 0 24 24" className="pointer-events-none h-full w-full" fill="none" stroke={hex} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    {def.paths.map((path, index) => <path key={index} d={path.d} fill={path.fill ? hex : "none"} />)}
                  </svg>
                  {handles ? <span data-handle="se" className="absolute rounded-sm border-2 border-white" style={{ width: 12 * inverse, height: 12 * inverse, right: -6 * inverse, bottom: -6 * inverse, background: hex, cursor: "nwse-resize" }} /> : null}
                  {rotateHandle}
                </div>
              )
            }

            if (a.kind === "image" && a.image_path) {
              return (
                <div
                  key={a.id}
                  data-ann-id={a.id}
                  className="absolute"
                  style={{ zIndex: z, opacity: a.opacity, left: `${a.x}%`, top: `${a.y}%`, width: `${a.w}%`, height: `${a.h}%`, transform: turn, outline: isSelected ? `${2 * inverse}px solid #9e1f93` : undefined, outlineOffset: 2 * inverse, boxShadow: "0 2px 10px rgba(0,0,0,0.28)", cursor: cursorStyle }}
                  title={a.text ?? "Image"}
                >
                  <SheetImage path={a.image_path} alt={a.text ?? "Image on the sheet"} />
                  {cornerHandles("#9e1f93")}
                  {rotateHandle}
                </div>
              )
            }

            if (isPointKind(a.kind) && a.points && a.points.length >= 2) {
              const closed = a.kind === "area"
              const strokePx = ((a.stroke ?? 0.2) / 100) * width
              const pts = a.points
              const box2 = bbox(pts)
              const strokeW = Math.max(strokePx, a.kind === "arrow" || a.kind === "dimension" || a.kind === "cloud" ? 1.5 * inverse : 0)
              let d = pointsToPath(pts, width, height, closed)
              let label: string | null = null
              let labelAt: Pt = pts[pts.length - 1]
              let extra: React.ReactNode = null
              if (a.kind === "cloud") {
                d = cloudPath(pts, width, height, cloudBump(strokePx))
                label = a.text
                labelAt = centroid(pts)
              } else if (a.kind === "arrow") {
                const head = arrowHeadPx(pts[0], pts[1], width, height, Math.max(strokePx * 5, 10))
                extra = <polygon points={head.map((q) => q.join(",")).join(" ")} fill={hex} stroke={hex} strokeWidth={strokePx * 0.5} strokeLinejoin="round" />
                label = a.text
                labelAt = pts[0]
              } else if (a.kind === "dimension") {
                const ticks = (["a", "b"] as const).map((end) => dimensionTickPx(pts[0], pts[1], end, width, height, 7 * inverse))
                extra = ticks.map((t, index) => <line key={index} x1={t[0][0]} y1={t[0][1]} x2={t[1][0]} y2={t[1][1]} stroke={hex} strokeWidth={strokeW} strokeLinecap="round" />)
                label = lengthLabel(pts)
                labelAt = [(pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2]
              } else if (a.kind === "area") {
                label = areaLabel(pts)
                labelAt = centroid(pts)
              } else if (a.kind === "polyline") label = lengthLabel(pts)
              const fillShape = closed || a.kind === "cloud"
              return (
                <svg key={a.id} className="pointer-events-none absolute left-0 top-0 overflow-visible" width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ zIndex: z, opacity: a.opacity }} aria-hidden="true">
                  <path d={d} fill={fillShape ? `${hex}${a.kind === "cloud" ? "1f" : "33"}` : "none"} stroke={hex} strokeWidth={strokeW} strokeLinecap={a.kind === "highlight" ? "butt" : "round"} strokeLinejoin="round" strokeDasharray={a.kind === "polyline" || closed ? `${strokePx * 3} ${strokePx * 2}` : undefined} />
                  {extra}
                  <path d={a.kind === "cloud" ? pointsToPath(pts, width, height, true) : d} data-ann-id={a.id} fill={fillShape ? "transparent" : "none"} stroke="transparent" strokeWidth={Math.max(strokePx, 14 * inverse)} strokeLinecap="round" strokeLinejoin="round" style={{ pointerEvents: fillShape ? "all" : "stroke", cursor: cursorStyle }} />
                  {label ? (
                    <text x={(labelAt[0] / 100) * width} y={(labelAt[1] / 100) * height - 8 * inverse} textAnchor="middle" fontSize={14 * inverse} fontWeight="700" fill="#111" {...halo}>
                      {label}
                    </text>
                  ) : null}
                  {isSelected ? <rect x={(box2.x / 100) * width - 6 * inverse} y={(box2.y / 100) * height - 6 * inverse} width={(box2.w / 100) * width + 12 * inverse} height={(box2.h / 100) * height + 12 * inverse} fill="none" stroke={hex} strokeWidth={2 * inverse} strokeDasharray={`${6 * inverse} ${4 * inverse}`} /> : null}
                  {handles && tool === "select" ? (["nw", "ne", "sw", "se"] as Corner[]).map(corner => <g key={corner} transform={`translate(${(box2.x + (corner.includes("e") ? box2.w : 0)) / 100 * width} ${(box2.y + (corner.includes("s") ? box2.h : 0)) / 100 * height})`}>
                    <rect data-handle={corner} data-ann-id={a.id} x={-12 * inverse} y={-12 * inverse} width={24 * inverse} height={24 * inverse} fill="transparent" style={{ pointerEvents: "all", cursor: corner === "nw" || corner === "se" ? "nwse-resize" : "nesw-resize" }}><title>Drag to resize drawing (Shift keeps proportions)</title></rect>
                    <rect x={-5 * inverse} y={-5 * inverse} width={10 * inverse} height={10 * inverse} fill={hex} stroke="white" strokeWidth={1.5 * inverse} />
                  </g>) : null}
                </svg>
              )
            }
            return null
          })}

          {lockedSelected && canEdit && !readOnly && tool === "select" ? (
            <button
              type="button"
              data-handle="unlock"
              title="Locked. Click to unlock"
              aria-label="Locked. Click to unlock"
              className="absolute flex items-center justify-center rounded-full border-2 border-white bg-[#211f20] text-white shadow-lg"
              style={{ zIndex: PIN_Z + 5, left: `${lockedSelected.box.x + lockedSelected.box.w}%`, top: `${lockedSelected.box.y}%`, width: 26, height: 26, transform: `translate(-50%, -50%) scale(${inverse})`, cursor: "pointer" }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 018 0v4" /></svg>
            </button>
          ) : null}

          <svg className="pointer-events-none absolute left-0 top-0 overflow-visible" style={{ zIndex: PIN_Z - 10 }} width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
            {selectionBox ? (
              <g>
                <rect x={(selectionBox.x / 100) * width - 8 * inverse} y={(selectionBox.y / 100) * height - 8 * inverse} width={(selectionBox.w / 100) * width + 16 * inverse} height={(selectionBox.h / 100) * height + 16 * inverse} fill="rgba(158,31,147,0.06)" stroke="#9e1f93" strokeWidth={1.8 * inverse} strokeDasharray={`${7 * inverse} ${4 * inverse}`} rx={4 * inverse} />
                <g transform={`translate(${(selectionBox.x / 100) * width - 8 * inverse} ${(selectionBox.y / 100) * height - 8 * inverse - 24 * inverse})`}>
                  <rect width={86 * inverse} height={20 * inverse} rx={10 * inverse} fill="#9e1f93" />
                  <text x={43 * inverse} y={14 * inverse} textAnchor="middle" fontSize={11 * inverse} fontWeight="700" fill="#fff">{selectedAnn.length} selected</text>
                </g>
              </g>
            ) : null}
            {marquee ? <rect x={(Math.min(marquee.a.x, marquee.b.x) / 100) * width} y={(Math.min(marquee.a.y, marquee.b.y) / 100) * height} width={(Math.abs(marquee.b.x - marquee.a.x) / 100) * width} height={(Math.abs(marquee.b.y - marquee.a.y) / 100) * height} fill="rgba(158,31,147,0.10)" stroke="#9e1f93" strokeWidth={1.5 * inverse} strokeDasharray={`${5 * inverse} ${3 * inverse}`} /> : null}
            {[...props.measurements, ...(measureStart && hover && tool === "measure" ? [{ a: measureStart, b: hover }] : []), ...(drawing?.mode === "measure" ? [{ a: drawing.a, b: drawing.b }] : [])].map((m, index) => {
              const a = px(m.a)
              const b = px(m.b)
              return (
                <g key={index}>
                  <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#f18b00" strokeWidth={2.5 * inverse} strokeDasharray={`${8 * inverse} ${5 * inverse}`} />
                  <circle cx={a.x} cy={a.y} r={4.5 * inverse} fill="#f18b00" stroke="#fff" strokeWidth={1.5 * inverse} />
                  <circle cx={b.x} cy={b.y} r={4.5 * inverse} fill="#f18b00" stroke="#fff" strokeWidth={1.5 * inverse} />
                  <text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - 8 * inverse} textAnchor="middle" fontSize={14 * inverse} fontWeight="700" fill="#111" {...halo}>
                    {measureLabel(m.a, m.b)}
                  </text>
                </g>
              )
            })}
            {measureStart && !hover && tool === "measure" ? <circle cx={px(measureStart).x} cy={px(measureStart).y} r={5 * inverse} fill="#f18b00" stroke="#fff" strokeWidth={1.5 * inverse} /> : null}
            {drawing?.mode === "shape" ? (
              shapeKind === "ellipse" ? (
                <ellipse cx={px({ x: (drawing.a.x + drawing.b.x) / 2, y: (drawing.a.y + drawing.b.y) / 2 }).x} cy={px({ x: (drawing.a.x + drawing.b.x) / 2, y: (drawing.a.y + drawing.b.y) / 2 }).y} rx={(Math.abs(drawing.b.x - drawing.a.x) / 200) * width} ry={(Math.abs(drawing.b.y - drawing.a.y) / 200) * height} fill={`${penColor}33`} stroke={penColor} strokeWidth={2 * inverse} strokeDasharray={`${6 * inverse}`} />
              ) : (
                <rect x={px({ x: Math.min(drawing.a.x, drawing.b.x), y: 0 }).x} y={px({ x: 0, y: Math.min(drawing.a.y, drawing.b.y) }).y} width={(Math.abs(drawing.b.x - drawing.a.x) / 100) * width} height={(Math.abs(drawing.b.y - drawing.a.y) / 100) * height} fill={`${penColor}33`} stroke={penColor} strokeWidth={2 * inverse} strokeDasharray={`${6 * inverse}`} />
              )
            ) : null}
            {drawing?.mode === "cloud" ? <path d={cloudPath(rectCorners([drawing.a.x, drawing.a.y], [drawing.b.x, drawing.b.y]), width, height, cloudBump(0.2 * width / 100))} fill={`${penColor}1f`} stroke={penColor} strokeWidth={Math.max(1.5 * inverse, 0.002 * width)} /> : null}
            {drawing && (drawing.mode === "arrow" || drawing.mode === "dimension") ? (
              <g>
                <line x1={px(drawing.a).x} y1={px(drawing.a).y} x2={px(drawing.b).x} y2={px(drawing.b).y} stroke={penColor} strokeWidth={Math.max(1.5 * inverse, 0.0025 * width)} strokeLinecap="round" />
                {drawing.mode === "arrow" ? <polygon points={arrowHeadPx([drawing.a.x, drawing.a.y], [drawing.b.x, drawing.b.y], width, height, Math.max(0.0125 * width, 10)).map((q) => q.join(",")).join(" ")} fill={penColor} /> : (
                  <text x={(px(drawing.a).x + px(drawing.b).x) / 2} y={(px(drawing.a).y + px(drawing.b).y) / 2 - 8 * inverse} textAnchor="middle" fontSize={14 * inverse} fontWeight="700" fill="#111" {...halo}>{lengthLabel([[drawing.a.x, drawing.a.y], [drawing.b.x, drawing.b.y]])}</text>
                )}
              </g>
            ) : null}

            {livePen && livePen.length >= 2 ? (
              <path d={pointsToPath(livePen, width, height)} fill="none" stroke={penColor} strokeWidth={penPx} strokeLinecap={tool === "highlighter" ? "butt" : "round"} strokeLinejoin="round" opacity={tool === "highlighter" ? HIGHLIGHT_OPACITY : 1} />
            ) : null}

            {pathPts.length ? (
              <g>
                <path d={tool === "cloud" && pathPts.length >= 3 ? cloudPath(pathPts, width, height, cloudBump(0.2 * width / 100)) : pointsToPath(hover && pathPts.length ? [...pathPts, [hover.x, hover.y]] : pathPts, width, height, tool !== "polyline" && pathPts.length >= 2 && !!hover)} fill={tool === "polyline" ? "none" : `${penColor}22`} stroke={penColor} strokeWidth={2.5 * inverse} strokeDasharray={tool === "cloud" && pathPts.length >= 3 ? undefined : `${8 * inverse} ${5 * inverse}`} strokeLinejoin="round" />
                {pathPts.map(([x, y], index) => (
                  <circle key={index} cx={(x / 100) * width} cy={(y / 100) * height} r={(index === 0 && tool !== "polyline" ? 6.5 : 4.5) * inverse} fill={index === 0 && tool !== "polyline" ? "#fff" : penColor} stroke={index === 0 && tool !== "polyline" ? penColor : "#fff"} strokeWidth={1.8 * inverse} />
                ))}
                {(() => {
                  const live: Pt[] = hover ? [...pathPts, [hover.x, hover.y]] : pathPts
                  if (live.length < 2 || tool === "cloud") return null
                  const end = live[live.length - 1]
                  const text = tool === "area" ? (live.length >= 3 ? `${areaLabel(live)} • ${lengthLabel(live, true)} around` : lengthLabel(live)) : lengthLabel(live)
                  return (
                    <text x={(end[0] / 100) * width} y={(end[1] / 100) * height - 12 * inverse} textAnchor="middle" fontSize={14 * inverse} fontWeight="700" fill="#111" {...halo}>
                      {text}
                    </text>
                  )
                })()}
              </g>
            ) : null}
          </svg>

          {props.showPins
            ? pins.filter((pin) => !props.hiddenPinIds.has(pin.id)).map((pin) => {
                const p = livePin(pin)
                const isSelected = selection.pin === pin.id
                return (
                  <button
                    key={pin.id}
                    type="button"
                    tabIndex={-1}
                    data-pin-id={pin.id}
                    title={`${pin.title} (${statusLabels[clientPinStatus(pin.status)]})${pin.locked ? " - locked" : ""}`}
                    aria-label={`Pin ${numberOf(pin)}: ${pin.title}, ${statusLabels[clientPinStatus(pin.status)]}${pin.locked ? ", locked" : ""}`}
                    className="absolute h-11 w-8 border-0 bg-transparent p-0 transition-none"
                    style={{ zIndex: PIN_Z + (isSelected ? 1 : 0), left: `${p.x}%`, top: `${p.y}%`, transformOrigin: "50% 100%", transform: `translate(-50%, -100%) scale(${(isSelected ? 1.2 : 1) * inverse})`, filter: isSelected ? "drop-shadow(0 0 3px #111)" : "drop-shadow(0 2px 2px #0005)", cursor: pin.locked && tool === "select" ? "default" : tool === "stamp" ? "pointer" : isSelected && canEdit && tool === "select" && !readOnly ? "move" : "pointer" }}
                  >
                    <svg viewBox="0 0 32 44" className="pointer-events-none h-full w-full" aria-hidden="true">
                      <path d="M16 44 3.8 24A15 15 0 1 1 28.2 24Z" fill={statusDot[clientPinStatus(pin.status)]} stroke="white" strokeWidth="1" />
                      <circle cx="16" cy="16" r="8.5" fill="white" />
                      <text x="16" y="16" dy=".35em" textAnchor="middle" fill="#211f20" fontWeight="800" fontSize={numberOf(pin) > 99 ? 8 : 11}>{numberOf(pin)}</text>
                    </svg>
                    {pin.locked ? <span className="absolute -right-1.5 -top-1.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-[#211f20] text-[8px] leading-none" aria-hidden="true">🔒</span> : null}
                  </button>
                )
              })
            : null}

          {props.draftPin ? (
            <svg viewBox="0 0 32 44" className="pointer-events-none absolute h-11 w-8 opacity-70" style={{ zIndex: PIN_Z + 2, left: `${props.draftPin.x}%`, top: `${props.draftPin.y}%`, transformOrigin: "50% 100%", transform: `translate(-50%, -100%) scale(${inverse})` }}><path d="M16 43 3.8 24A15 15 0 1 1 28.2 24Z" fill="#9e1f93" stroke="white" /><circle cx="16" cy="16" r="8.5" fill="white" /></svg>
          ) : null}
        </div>
      ) : (
        <div className="flex h-full items-center justify-center text-sm text-white/70">Loading the sheet...</div>
      )}

      {relocatingPin ? <div role="status" className="absolute left-3 right-3 top-3 z-40 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-brand bg-surface px-4 py-3 text-sm text-fg shadow-lg" onPointerDown={event => event.stopPropagation()} onPointerUp={event => event.stopPropagation()}>
        <div className="space-y-1"><p>Click or tap the new location for <strong>{relocatingPin.title}</strong>. Press Esc to cancel.</p><p className="text-xs text-fg-muted">Moving a pin after QA submission can require resubmission.</p></div>
        <button type="button" className="min-h-9 rounded-lg border border-line px-3 py-1 font-bold hover:bg-surface-muted" onClick={props.onCancelPinMove}>Cancel move</button>
      </div> : null}

      {props.laser && laserAt ? (
        <span className="pointer-events-none absolute z-50 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-red-500 shadow-[0_0_18px_8px_rgba(239,68,68,0.55)]" style={{ left: laserAt.x, top: laserAt.y }} aria-hidden="true" />
      ) : null}

      {dropActive ? (
        <div className="pointer-events-none absolute inset-3 z-50 flex items-center justify-center rounded-2xl border-2 border-dashed border-white/80 bg-[#9e1f93]/25 text-lg font-extrabold text-white backdrop-blur-[1px]">Drop the picture on the sheet</div>
      ) : null}

      {capsule && props.quick ? (
        <div
          role="toolbar"
          aria-label="Quick actions"
          className="bt-pop absolute z-40 flex items-center gap-0.5 rounded-full border border-line bg-surface px-1.5 py-1 text-fg shadow-xl"
          style={{ left: capsule.left, top: capsule.top, transform: "translateX(-50%)" }}
          onPointerDown={(event) => event.stopPropagation()}
          onPointerUp={(event) => event.stopPropagation()}
          onContextMenu={(event) => {
            event.preventDefault()
            event.stopPropagation()
          }}
        >
          <button type="button" title="Add a note or label" aria-label="Add a note or label" className="flex h-9 w-9 items-center justify-center rounded-full transition hover:bg-surface-muted" onClick={props.quick.onComment}><Icon name="note" size={18} /></button>
          {props.quick.onMovePin ? <button type="button" className="min-h-9 rounded-full px-3 text-xs font-bold hover:bg-surface-muted" onClick={props.quick.onMovePin}>Move pin</button> : null}
          <button type="button" title={props.quick.locked ? "Unlock (Alt+Shift+L)" : "Lock (Alt+Shift+L)"} aria-label={props.quick.locked ? "Unlock" : "Lock"} aria-pressed={props.quick.locked} className={`flex h-9 w-9 items-center justify-center rounded-full transition ${props.quick.locked ? "bg-brand text-white" : "hover:bg-surface-muted"}`} onClick={props.quick.onToggleLock}><Icon name={props.quick.locked ? "lock" : "unlock"} size={18} /></button>
          {props.quick.onDuplicate ? <button type="button" title="Duplicate (Ctrl+D)" aria-label="Duplicate" className="flex h-9 w-9 items-center justify-center rounded-full transition hover:bg-surface-muted" onClick={props.quick.onDuplicate}><Icon name="copy" size={18} /></button> : null}
          <button type="button" title={props.quick.canDelete ? "Delete (Del)" : "Unlock before deleting"} aria-label="Delete" disabled={!props.quick.canDelete} className="flex h-9 w-9 items-center justify-center rounded-full text-danger-fg transition hover:bg-danger-soft disabled:opacity-40" onClick={props.quick.onDelete}><Icon name="trash" size={18} /></button>
          <button
            type="button"
            title="More actions"
            aria-label="More actions"
            aria-haspopup="menu"
            className="flex h-9 w-9 items-center justify-center rounded-full transition hover:bg-surface-muted"
            onClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect()
              props.quick?.onMore(rect.left, rect.bottom + 6)
            }}
          ><Icon name="more" size={18} /></button>
        </div>
      ) : null}

      {readOnly ? null : (
        <div className="absolute bottom-3 right-3 z-40 flex items-center gap-1 rounded-lg border border-line bg-surface p-1 text-sm text-fg shadow-lg" onPointerDown={(event) => event.stopPropagation()} onPointerUp={(event) => event.stopPropagation()}>
          <button type="button" className="h-8 w-8 rounded hover:bg-surface-muted" aria-label="Zoom out" onClick={() => zoomAt(1 / CANVAS_ZOOM_STEP)}>-</button>
          <span className="w-12 text-center text-xs text-fg-muted" aria-live="off">{Math.round(view.scale * 100)}%</span>
          <button type="button" className="h-8 w-8 rounded hover:bg-surface-muted" aria-label="Zoom in" onClick={() => zoomAt(CANVAS_ZOOM_STEP)}>+</button>
          <button type="button" className="h-8 rounded px-2 text-xs font-semibold hover:bg-surface-muted" onClick={fit}>Fit</button>
        </div>
      )}

      {!readOnly && hintFor(tool, { canEdit, shapeKind, scaleWidthM, measureStart: !!measureStart, pathCount: pathPts.length, boxSelect: props.boxSelect }) ? (
        <div className="pointer-events-none absolute left-3 top-3 z-40 max-w-[80%] rounded-lg bg-[#211f20]/90 px-3 py-1.5 text-xs font-semibold text-white shadow">
          {hintFor(tool, { canEdit, shapeKind, scaleWidthM, measureStart: !!measureStart, pathCount: pathPts.length, boxSelect: props.boxSelect })}
        </div>
      ) : null}
    </div>
  )
}

// The picture itself: private file, short-lived signed link, a quiet placeholder while it loads.
function SheetImage({ path, alt }: { path: string; alt: string }) {
  const { url, failed } = useSignedUrl("blueprints", path)
  if (url) return <img src={url} alt={alt} draggable={false} className="pointer-events-none h-full w-full select-none object-fill" />
  return <div className="flex h-full w-full items-center justify-center bg-white/70 text-[11px] font-semibold text-[#67676d]">{failed ? "Image not available" : <span className="h-full w-full animate-pulse bg-black/10" />}</div>
}

function hintFor(tool: EditorTool, s: { canEdit: boolean; shapeKind: ShapeKind; scaleWidthM: number | null; measureStart: boolean; pathCount: number; boxSelect: boolean }): string {
  const need = (text: string) => (s.canEdit ? text : "Only engineers can draw on the sheet")
  switch (tool) {
    case "select":
      return s.boxSelect ? "Drag to select several items. Turn off Box select to pan." : ""
    case "measure":
      return `${s.measureStart ? "Click the second point (Esc to cancel)" : "Click two points, or drag, to measure"}${!s.scaleWidthM ? " • Not calibrated yet" : ""}`
    case "pin":
      return need("Click the sheet to drop a pin")
    case "note":
      return need("Click the sheet to drop a note")
    case "text":
      return need("Click the sheet to place a text box")
    case "symbol":
      return need("Click the sheet to place the symbol")
    case "image":
      return need("Choose a picture, or drag one from your computer onto the sheet")
    case "shape":
      return need(`Drag to draw a ${s.shapeKind === "rect" ? "rectangle" : "ellipse"}`)
    case "pen":
      return need("Drag to draw freehand")
    case "highlighter":
      return need("Drag to highlight")
    case "arrow":
      return need("Drag to draw an arrow. Hold Shift for straight angles")
    case "dimension":
      return need(`Drag to draw a dimension line${s.scaleWidthM ? "" : " (set the scale to read metres)"}`)
    case "cloud":
      return need(s.pathCount ? `${s.pathCount} point${s.pathCount === 1 ? "" : "s"} • click the first point, double-click or Enter to close, Esc to cancel` : "Drag a box, or click the corners, to draw a revision cloud")
    case "polyline":
      return need(s.pathCount ? `${s.pathCount} point${s.pathCount === 1 ? "" : "s"} • double-click or Enter to finish, Esc to cancel` : `Click to start a polyline (Shift = straight angles)${s.scaleWidthM ? "" : " • set the scale to read metres"}`)
    case "area":
      return need(s.pathCount ? `${s.pathCount} point${s.pathCount === 1 ? "" : "s"} • click the first point, double-click or Enter to close, Esc to cancel` : `Click the corners of the area${s.scaleWidthM ? "" : " (set the scale to read m²)"}`)
    case "stamp":
      return "Click a pin to stamp its status"
    default:
      return ""
  }
}
