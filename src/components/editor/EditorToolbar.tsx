import type { ReactNode } from "react"
import Menu, { type MenuItem } from "../ui/Menu"
import {
  annotationColors,
  statusDot,
  statusLabels,
  type AnnotationColor,
  type Blueprint,
  type EditorTool,
  type PinStatus,
  type Revision,
  type ShapeKind,
} from "../../lib/blueprints"
import type { EditorPrefs } from "../../lib/editorPrefs"
import { symbolByKey, symbolGroups, symbolLibrary, type SymbolKey } from "../../lib/symbols"

const icons: Record<string, ReactNode> = {
  select: <path d="M5 3l14 8-6 2-2 6L5 3z" />,
  pin: <><path d="M12 22s7-6.2 7-12a7 7 0 10-14 0c0 5.8 7 12 7 12z" /><circle cx="12" cy="10" r="2.5" /></>,
  pen: <><path d="M4 20l1-5L16 4l4 4L9 19l-5 1z" /><path d="M14 6l4 4" /></>,
  highlighter: <><path d="M9 3l12 12-5 5L4 8l5-5z" opacity=".35" /><path d="M9 3l12 12-5 5L4 8l5-5z" /><path d="M3 21h7" /></>,
  shape: <><rect x="3" y="5" width="12" height="10" rx="1" /><circle cx="16" cy="15" r="5" /></>,
  text: <><path d="M5 6V4h14v2" /><path d="M12 4v16" /><path d="M9 20h6" /></>,
  note: <><path d="M4 4h16v12H9l-5 4V4z" /><path d="M8 9h8M8 12h5" /></>,
  arrow: <><path d="M4 20L19 5" /><path d="M10 5h9v9" /></>,
  cloud: <path d="M7 18a4 4 0 010-8 5 5 0 019.6-1A4.5 4.5 0 0117 18H7z" />,
  image: <><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="1.8" /><path d="M21 16l-5-5-8 8" /></>,
  symbol: <path d="M12 3l2.6 5.6 6 .7-4.4 4.1 1.2 6L12 16.4 6.6 19.4l1.2-6L3.4 9.3l6-.7L12 3z" />,
  dimension: <><path d="M3 12h18" /><path d="M3 7v10M21 7v10" /><path d="M8 9l-2.5 3L8 15M16 9l2.5 3L16 15" /></>,
  polyline: <><path d="M3 19l6-9 5 5 7-11" /><circle cx="3" cy="19" r="1.5" /><circle cx="9" cy="10" r="1.5" /><circle cx="14" cy="15" r="1.5" /><circle cx="21" cy="4" r="1.5" /></>,
  area: <><path d="M4 8l8-5 8 6-3 11H6L4 8z" /><path d="M9 11h6M9 15h4" opacity=".6" /></>,
  measure: <><path d="M3 17L17 3l4 4L7 21 3 17z" /><path d="M7 13l2 2M10 10l2 2M13 7l2 2" /></>,
  stamp: <><path d="M9 3h6v6a3 3 0 003 3v2H6v-2a3 3 0 003-3V3z" /><path d="M5 21h14" /></>,
  back: <path d="M15 5l-7 7 7 7" />,
  sheets: <><rect x="3" y="4" width="7" height="6" rx="1" /><rect x="3" y="14" width="7" height="6" rx="1" /><path d="M14 6h7M14 10h7M14 16h7M14 20h7" /></>,
  panel: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M15 4v16" /></>,
  upload: <><path d="M12 16V4M7 9l5-5 5 5" /><path d="M4 20h16" /></>,
  export: <><path d="M12 4v12M7 11l5 5 5-5" /><path d="M4 20h16" /></>,
  undo: <><path d="M9 14L4 9l5-5" /><path d="M4 9h10a6 6 0 010 12h-3" /></>,
  redo: <><path d="M15 14l5-5-5-5" /><path d="M20 9H10a6 6 0 000 12h3" /></>,
  history: <><path d="M3 12a9 9 0 109-9 9 9 0 00-7 3.4L3 8" /><path d="M3 3v5h5" /><path d="M12 7v5l3 2" /></>,
  lock: <><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 018 0v4" /></>,
  unlock: <><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 017.5-2" /></>,
  view: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9h18M9 9v11" /></>,
  focus: <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />,
  present: <><rect x="3" y="4" width="18" height="12" rx="1.5" /><path d="M8 21h8M12 16v5" /><path d="M10 8.5l4 2-4 2z" /></>,
  compare: <><rect x="3" y="4" width="8" height="16" rx="1" /><rect x="13" y="4" width="8" height="16" rx="1" /></>,
  search: <><circle cx="11" cy="11" r="6" /><path d="M16 16l5 5" /></>,
  keyboard: <><rect x="3" y="6" width="18" height="12" rx="2" /><path d="M7 10h.01M11 10h.01M15 10h.01M7 14h10" /></>,
  copy: <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V6a2 2 0 00-2-2H6a2 2 0 00-2 2v8a2 2 0 002 2h2" /></>,
  paste: <><rect x="6" y="5" width="12" height="16" rx="2" /><path d="M9 5V4h6v1" /></>,
  group: <><rect x="3" y="3" width="8" height="8" rx="1" strokeDasharray="2 2" /><rect x="13" y="13" width="8" height="8" rx="1" strokeDasharray="2 2" /><rect x="8" y="8" width="8" height="8" rx="1" /></>,
  trash: <><path d="M4 7h16M10 11v6M14 11v6" /><path d="M6 7l1 13h10l1-13M9 7V4h6v3" /></>,
  brush: <><path d="M14 4l6 6-8 8H6v-6l8-8z" /><path d="M13 5l6 6" /></>,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  alignLeft: <><path d="M4 3v18" /><rect x="7" y="6" width="12" height="4" rx="1" /><rect x="7" y="14" width="7" height="4" rx="1" /></>,
  alignCenter: <><path d="M12 3v18" /><rect x="5" y="6" width="14" height="4" rx="1" /><rect x="8" y="14" width="8" height="4" rx="1" /></>,
  alignRight: <><path d="M20 3v18" /><rect x="5" y="6" width="12" height="4" rx="1" /><rect x="10" y="14" width="7" height="4" rx="1" /></>,
  alignTop: <><path d="M3 4h18" /><rect x="6" y="7" width="4" height="12" rx="1" /><rect x="14" y="7" width="4" height="7" rx="1" /></>,
  alignMiddle: <><path d="M3 12h18" /><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="8" width="4" height="8" rx="1" /></>,
  alignBottom: <><path d="M3 20h18" /><rect x="6" y="5" width="4" height="12" rx="1" /><rect x="14" y="10" width="4" height="7" rx="1" /></>,
  distH: <><path d="M4 3v18M20 3v18" /><rect x="9.5" y="7" width="5" height="10" rx="1" /></>,
  distV: <><path d="M3 4h18M3 20h18" /><rect x="7" y="9.5" width="10" height="5" rx="1" /></>,
  qr: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><path d="M14 14h3v3h-3zM20 14v3M14 20h3M20 20h1" /></>,
  textLeft: <path d="M4 6h16M4 10h10M4 14h16M4 18h10" />,
  textCenter: <path d="M4 6h16M7 10h10M4 14h16M7 18h10" />,
  textRight: <path d="M4 6h16M10 10h10M4 14h16M10 18h10" />,
  textJustify: <path d="M4 6h16M4 10h16M4 14h16M4 18h16" />,
  listBullet: <><circle cx="5" cy="7" r="1.2" /><circle cx="5" cy="12" r="1.2" /><circle cx="5" cy="17" r="1.2" /><path d="M9 7h11M9 12h11M9 17h11" /></>,
  listNumber: <><path d="M10 7h10M10 12h10M10 17h10" /><path d="M4 5.5l1.5-1v4M4 14.5h2.5L4 18h2.5" /></>,
  spacing: <><path d="M4 4v16M20 4v16" /><path d="M8.5 16l3.5-8 3.5 8M9.8 13.5h4.4" /></>,
  filmstrip: <><rect x="3" y="4" width="18" height="10" rx="1.5" /><rect x="3" y="17" width="4.5" height="3.5" rx="1" /><rect x="9.75" y="17" width="4.5" height="3.5" rx="1" /><rect x="16.5" y="17" width="4.5" height="3.5" rx="1" /></>,
  forward: <><rect x="4" y="12" width="11" height="8" rx="1.5" opacity=".5" /><rect x="9" y="4" width="11" height="9" rx="1.5" /></>,
  backward: <><rect x="9" y="4" width="11" height="9" rx="1.5" opacity=".5" /><rect x="4" y="12" width="11" height="8" rx="1.5" /></>,
  layers: <><path d="M12 3l9 5-9 5-9-5 9-5z" /><path d="M3 13l9 5 9-5" /></>,
  opacity: <><path d="M12 3s6 6.2 6 11a6 6 0 11-12 0c0-4.8 6-11 6-11z" /><path d="M12 3v18" opacity=".5" /></>,
  more: <><circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" /></>,
  chevron: <path d="M6 9l6 6 6-6" />,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
  moon: <path d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z" />,
  zoomIn: <><circle cx="11" cy="11" r="6" /><path d="M16 16l5 5M11 8v6M8 11h6" /></>,
  zoomOut: <><circle cx="11" cy="11" r="6" /><path d="M16 16l5 5M8 11h6" /></>,
  fit: <><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /><rect x="8" y="8" width="8" height="8" rx="1" /></>,
  share: <><circle cx="6" cy="12" r="2.5" /><circle cx="18" cy="6" r="2.5" /><circle cx="18" cy="18" r="2.5" /><path d="M8.2 10.8l7.6-3.6M8.2 13.2l7.6 3.6" /></>,
  stroke: <><path d="M3 7h18" strokeWidth="1" /><path d="M3 12h18" strokeWidth="2.5" /><path d="M3 18h18" strokeWidth="4" /></>,
  rotate: <><path d="M20 12a8 8 0 10-2.5 5.8" /><path d="M20 5v5h-5" /></>,
  front: <><rect x="8" y="8" width="12" height="12" rx="1.5" /><path d="M4 16V4h12" /></>,
  sendBack: <><rect x="4" y="4" width="12" height="12" rx="1.5" /><path d="M20 8v12H8" /></>,
}

export function Icon({ name, size = 18 }: { name: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {icons[name]}
    </svg>
  )
}

export type ToolDef = { tool: EditorTool; label: string; key: string; hint: string }
export const toolGroups: Array<{ label: string; tools: ToolDef[] }> = [
  {
    label: "Select",
    tools: [
      { tool: "select", label: "Select", key: "V", hint: "Select, move and pan" },
      { tool: "pin", label: "Pin", key: "P", hint: "Drop a pin" },
      { tool: "stamp", label: "Stamp", key: "K", hint: "Stamp a progress status on a pin" },
    ],
  },
  {
    label: "Draw",
    tools: [
      { tool: "pen", label: "Pen", key: "D", hint: "Draw freehand" },
      { tool: "highlighter", label: "Highlight", key: "H", hint: "Highlighter" },
      { tool: "shape", label: "Shape", key: "S", hint: "Rectangle or ellipse" },
      { tool: "arrow", label: "Arrow", key: "R", hint: "Arrow / leader line" },
      { tool: "cloud", label: "Cloud", key: "C", hint: "Revision cloud" },
      { tool: "text", label: "Text", key: "T", hint: "Text box" },
      { tool: "note", label: "Note", key: "N", hint: "Note / callout" },
      { tool: "symbol", label: "Symbol", key: "Y", hint: "Construction symbol" },
      { tool: "image", label: "Image", key: "I", hint: "Add a photo, vendor spec or logo" },
    ],
  },
  {
    label: "Measure",
    tools: [
      { tool: "dimension", label: "Dimension", key: "E", hint: "Dimension line" },
      { tool: "polyline", label: "Polyline", key: "L", hint: "Measure a path (length)" },
      { tool: "area", label: "Area", key: "A", hint: "Measure an area" },
      { tool: "measure", label: "Tape", key: "M", hint: "Measuring tape" },
    ],
  },
]
export const toolDefs: ToolDef[] = toolGroups.flatMap((group) => group.tools)
export const toolKeys: Record<string, EditorTool> = Object.fromEntries(toolDefs.map((def) => [def.key.toLowerCase(), def.tool]))

export const colorTools: EditorTool[] = ["shape", "note", "pen", "highlighter", "text", "arrow", "cloud", "symbol", "dimension", "polyline", "area"] // image has no color
const button = "flex h-9 flex-none items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:cursor-not-allowed disabled:opacity-40"
const textSizes: Array<{ label: string; value: number }> = [{ label: "S", value: 1 }, { label: "M", value: 1.6 }, { label: "L", value: 2.4 }, { label: "XL", value: 3.6 }]
const symbolSizes: Array<{ label: string; value: number }> = [{ label: "S", value: 2.5 }, { label: "M", value: 4 }, { label: "L", value: 6.5 }, { label: "XL", value: 10 }]

export function ToolButton({ def, active, ok, onClick, compact = false, vertical = false }: { def: ToolDef; active: boolean; ok: boolean; onClick: () => void; compact?: boolean; vertical?: boolean }) {
  return (
    <button
      type="button"
      disabled={!ok}
      aria-pressed={active}
      title={`${def.hint} (${def.key})${ok ? "" : ", not available for your role"}`}
      onClick={onClick}
      className={`${button} ${vertical ? "w-full justify-start" : ""} ${active ? "bg-brand text-white shadow" : "text-fg hover:bg-surface"}`}
    >
      <Icon name={def.tool} />
      <span className={compact ? "hidden 2xl:inline" : ""}>{def.label}</span>
      {vertical ? <kbd className={`ml-auto rounded border px-1 text-[11px] font-bold ${active ? "border-white/40 text-white/90" : "border-line text-fg-muted"}`}>{def.key}</kbd> : null}
    </button>
  )
}

export const allowedTool = (tool: EditorTool, canEdit: boolean, canStamp: boolean) => (tool === "select" || tool === "measure" ? true : tool === "stamp" ? canStamp : canEdit)

// The tool buttons in groups. Horizontal in the top bar, vertical inside the floating palette.
export function ToolStrip({ tool, onTool, canEdit, canStamp, vertical = false }: { tool: EditorTool; onTool: (tool: EditorTool) => void; canEdit: boolean; canStamp: boolean; vertical?: boolean }) {
  return (
    <div className={vertical ? "space-y-2 p-2" : "flex items-stretch gap-1"} role="toolbar" aria-label="Tools" aria-orientation={vertical ? "vertical" : "horizontal"}>
      {toolGroups.map((group, index) => (
        <div key={group.label} className={vertical ? "" : `flex flex-none items-center gap-1 ${index ? "border-l border-line pl-1" : ""}`}>
          {vertical ? <p className="px-2 pb-1 text-[11px] font-extrabold uppercase tracking-wider text-fg-muted">{group.label}</p> : null}
          <div className={vertical ? "grid grid-cols-2 gap-1" : "flex items-center gap-1"}>
            {group.tools.map((def) => (
              <ToolButton key={def.tool} def={def} active={tool === def.tool} ok={allowedTool(def.tool, canEdit, canStamp)} onClick={() => onTool(def.tool)} compact={!vertical} />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

export type ToolOptions = {
  shapeKind: ShapeKind
  onShapeKind: (kind: ShapeKind) => void
  color: AnnotationColor
  onColor: (color: AnnotationColor) => void
  stampStatus: PinStatus
  onStampStatus: (status: PinStatus) => void
  stampStatuses: PinStatus[]
  penSize: number
  onPenSize: (size: number) => void
  highlighterSize: number
  onHighlighterSize: (size: number) => void
  textSize: number
  onTextSize: (size: number) => void
  symbol: SymbolKey
  onSymbol: (symbol: SymbolKey) => void
  symbolSize: number
  onSymbolSize: (size: number) => void
  measurementCount: number
  onClearMeasurements: () => void
  onCalibrate: () => void
  canCalibrate: boolean
  scaleLabel: string
  boxSelect: boolean
  onBoxSelect: (value: boolean) => void
}

export function ToolOptionsRow({ tool, options: o }: { tool: EditorTool; options: ToolOptions }) {
  const sizeValue = tool === "pen" ? o.penSize : o.highlighterSize
  if (!colorTools.includes(tool) && tool !== "stamp" && tool !== "measure") return null
  return (
    <div className="flex min-h-10 flex-wrap items-center gap-3 border-t border-line bg-surface-muted/40 px-4 py-1.5 text-sm">
      {tool === "shape" ? (
        <>
          <span className="text-xs font-bold uppercase tracking-wider text-fg-muted">Shape</span>
          {(["rect", "ellipse"] as ShapeKind[]).map((kind) => (
            <button key={kind} type="button" onClick={() => o.onShapeKind(kind)} aria-pressed={o.shapeKind === kind} className={`rounded-md border px-2 py-1 text-xs font-semibold ${o.shapeKind === kind ? "border-brand bg-brand-soft text-brand-text" : "border-line hover:bg-surface"}`}>
              {kind === "rect" ? "Rectangle" : "Ellipse"}
            </button>
          ))}
        </>
      ) : null}
      {colorTools.includes(tool) ? (
        <div className="flex items-center gap-1.5" role="radiogroup" aria-label="Color">
          <span className="text-xs font-bold uppercase tracking-wider text-fg-muted">Color</span>
          {(Object.keys(annotationColors) as AnnotationColor[]).map((name) => (
            <button key={name} type="button" role="radio" aria-checked={o.color === name} aria-label={name} onClick={() => o.onColor(name)} className={`h-5 w-5 rounded-full border-2 transition ${o.color === name ? "scale-110 border-fg" : "border-line"}`} style={{ background: annotationColors[name] }} />
          ))}
        </div>
      ) : null}
      {tool === "pen" || tool === "highlighter" ? (
        <label className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-fg-muted">
          Size
          <input type="range" min={tool === "pen" ? 0.05 : 0.4} max={tool === "pen" ? 1 : 3} step={0.05} value={sizeValue} onChange={(e) => (tool === "pen" ? o.onPenSize(Number(e.target.value)) : o.onHighlighterSize(Number(e.target.value)))} className="w-28 accent-[#9e1f93]" aria-label="Stroke size" />
          <span className="inline-block w-12 rounded-full" style={{ background: annotationColors[o.color], height: Math.max(2, Math.min(16, sizeValue * 8)), opacity: tool === "highlighter" ? 0.4 : 1 }} aria-hidden="true" />
        </label>
      ) : null}
      {tool === "text" ? (
        <div className="flex items-center gap-1" role="radiogroup" aria-label="Text size">
          <span className="text-xs font-bold uppercase tracking-wider text-fg-muted">Size</span>
          {textSizes.map((size) => (
            <button key={size.label} type="button" role="radio" aria-checked={o.textSize === size.value} onClick={() => o.onTextSize(size.value)} className={`rounded-md border px-2 py-1 text-xs font-semibold ${o.textSize === size.value ? "border-brand bg-brand-soft text-brand-text" : "border-line hover:bg-surface"}`}>{size.label}</button>
          ))}
        </div>
      ) : null}
      {tool === "symbol" ? (
        <>
          <div className="flex flex-wrap items-center gap-1" role="radiogroup" aria-label="Symbol">
            {symbolGroups.map((group) => (
              <div key={group} className="flex items-center gap-1 border-l border-line pl-2 first:border-l-0 first:pl-0">
                <span className="hidden text-[11px] font-extrabold uppercase tracking-wider text-fg-muted lg:inline">{group}</span>
                {symbolLibrary.filter((symbol) => symbol.group === group).map((symbol) => (
                  <button key={symbol.key} type="button" role="radio" aria-checked={o.symbol === symbol.key} title={symbol.label} aria-label={symbol.label} onClick={() => o.onSymbol(symbol.key)} className={`flex h-8 w-8 items-center justify-center rounded-md border transition ${o.symbol === symbol.key ? "border-brand bg-brand-soft" : "border-line bg-surface hover:bg-surface-muted"}`}>
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke={annotationColors[o.color]} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      {symbolByKey[symbol.key].paths.map((path, index) => <path key={index} d={path.d} fill={path.fill ? annotationColors[o.color] : "none"} />)}
                    </svg>
                  </button>
                ))}
              </div>
            ))}
          </div>
          <div className="flex items-center gap-1" role="radiogroup" aria-label="Symbol size">
            <span className="text-xs font-bold uppercase tracking-wider text-fg-muted">Size</span>
            {symbolSizes.map((size) => (
              <button key={size.label} type="button" role="radio" aria-checked={o.symbolSize === size.value} onClick={() => o.onSymbolSize(size.value)} className={`rounded-md border px-2 py-1 text-xs font-semibold ${o.symbolSize === size.value ? "border-brand bg-brand-soft text-brand-text" : "border-line hover:bg-surface"}`}>{size.label}</button>
            ))}
          </div>
        </>
      ) : null}
      {tool === "polyline" || tool === "area" || tool === "dimension" ? <span className="text-xs font-semibold text-fg-muted">Scale: {o.scaleLabel}</span> : null}
      {tool === "stamp" ? (
        <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="Status stamp">
          <span className="text-xs font-bold uppercase tracking-wider text-fg-muted">Stamp</span>
          {o.stampStatuses.map((status) => (
            <button key={status} type="button" role="radio" aria-checked={o.stampStatus === status} onClick={() => o.onStampStatus(status)} className={`flex items-center gap-1 rounded-full border px-2 py-1 text-xs font-semibold ${o.stampStatus === status ? "border-transparent text-white" : "border-line hover:bg-surface"}`} style={o.stampStatus === status ? { background: statusDot[status] } : undefined}>
              <span className="h-2 w-2 rounded-full" style={{ background: statusDot[status] }} />
              {statusLabels[status]}
            </button>
          ))}
          <span className="text-xs text-fg-muted">then click pins on the sheet</span>
        </div>
      ) : null}
      {tool === "measure" ? (
        <>
          <span className="text-xs font-semibold text-fg-muted">Scale: {o.scaleLabel}</span>
          {o.measurementCount ? <button type="button" onClick={o.onClearMeasurements} className="rounded-md border border-line px-2 py-1 text-xs font-semibold hover:bg-surface">Clear ({o.measurementCount})</button> : null}
          {o.canCalibrate && o.measurementCount ? <button type="button" onClick={o.onCalibrate} className="rounded-md bg-accent px-2 py-1 text-xs font-bold text-black hover:opacity-90">Set scale from last line</button> : null}
        </>
      ) : null}
    </div>
  )
}

export type ViewActions = {
  prefs: EditorPrefs
  onPrefs: (patch: Partial<EditorPrefs>) => void
  onFocus: () => void
  onPresent: () => void
  onCompare: () => void
  canCompare: boolean
  onFit: () => void
  onCommands: () => void
  onShortcuts: () => void
  onGuide: () => void
  onResetLayout: () => void
}

export default function EditorToolbar({
  projectTitle,
  blueprint,
  blueprints,
  onSheet,
  revision,
  revisions,
  onRevision,
  canEdit,
  canUpload = canEdit,
  zoomPercent,
  onZoomIn,
  onZoomOut,
  onFit,
  canUndo,
  canRedo,
  undoLabel,
  redoLabel,
  onUndo,
  onRedo,
  canSeeHistory,
  onHistory,
  baseLocked,
  canLockBase,
  onToggleBaseLock,
  onUpload,
  onNewRevision,
  onExport,
  onShare,
  dark,
  onToggleTheme,
  view,
  onToggleSheets,
  onToggleInspector,
  sheetsShown,
  filmstripShown,
  inspectorShown,
  onPanelSheets,
  onPanelFilmstrip,
  onPanelInspector,
  onExit,
}: {
  projectTitle: string
  blueprint: Blueprint | null
  blueprints: Blueprint[]
  onSheet: (id: string) => void
  revision: Revision | null
  revisions: Revision[]
  onRevision: (id: string) => void
  canEdit: boolean
  canUpload?: boolean // sheets and revisions; defaults to canEdit
  zoomPercent: number
  onZoomIn: () => void
  onZoomOut: () => void
  onFit: () => void
  canUndo: boolean
  canRedo: boolean
  undoLabel: string
  redoLabel: string
  onUndo: () => void
  onRedo: () => void
  canSeeHistory: boolean
  onHistory: () => void
  baseLocked: boolean
  canLockBase: boolean
  onToggleBaseLock: () => void
  onUpload: () => void
  onNewRevision: () => void
  onExport: () => void
  onShare: () => void
  dark: boolean
  onToggleTheme: () => void
  view: ViewActions
  onToggleSheets: () => void
  onToggleInspector: () => void
  sheetsShown: boolean
  filmstripShown: boolean
  inspectorShown: boolean
  onPanelSheets: () => void
  onPanelFilmstrip: () => void
  onPanelInspector: () => void
  onExit: () => void
}) {
  const { prefs } = view
  const viewItems: MenuItem[] = [
    { heading: "Panels" },
    { label: "Sheets strip (left)", checked: prefs.sheets, onClick: () => view.onPrefs({ sheets: !prefs.sheets }) },
    { label: "Pages bar (bottom)", checked: prefs.filmstrip, onClick: () => view.onPrefs({ filmstrip: !prefs.filmstrip }) },
    { label: "Inspector docked", checked: prefs.inspector === "docked", onClick: () => view.onPrefs({ inspector: "docked" }) },
    { label: "Inspector floating", checked: prefs.inspector === "floating", onClick: () => view.onPrefs({ inspector: "floating" }) },
    { label: "Inspector hidden", checked: prefs.inspector === "hidden", onClick: () => view.onPrefs({ inspector: "hidden" }) },
    { separator: true },
    { heading: "Tools" },
    { label: "Tools in the top bar", checked: prefs.tools === "bar", onClick: () => view.onPrefs({ tools: "bar" }) },
    { label: "Tools in a floating palette", checked: prefs.tools === "palette", onClick: () => view.onPrefs({ tools: "palette" }) },
    { label: "Box select", checked: prefs.boxSelect, onClick: () => view.onPrefs({ boxSelect: !prefs.boxSelect }) },
    { separator: true },
    { label: "Focus mode (hide everything)", hint: "F", icon: <Icon name="focus" size={14} />, onClick: view.onFocus },
    { label: "Presentation mode", hint: "F5", icon: <Icon name="present" size={14} />, onClick: view.onPresent },
    { label: "Compare revisions", icon: <Icon name="compare" size={14} />, onClick: view.onCompare, disabled: !view.canCompare },
    { separator: true },
    { label: "Command palette", hint: "Ctrl K", icon: <Icon name="search" size={14} />, onClick: view.onCommands },
    { label: "Keyboard shortcuts", hint: "?", icon: <Icon name="keyboard" size={14} />, onClick: view.onShortcuts },
    { label: "Page guide", onClick: view.onGuide },
    { label: "Reset layout", onClick: view.onResetLayout },
  ]
  const sheetItems: MenuItem[] = blueprints.map((sheet) => ({ label: `${sheet.title}${sheet.level ? ` (${sheet.level})` : ""}`, checked: sheet.id === blueprint?.id, onClick: () => onSheet(sheet.id) }))
  const iconButton = `${button} w-9 justify-center px-0 text-fg hover:bg-surface-muted`

  return (
    <div className="z-20 text-fg">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2 xl:h-14 xl:flex-nowrap xl:py-0">
        <button type="button" onClick={onExit} className={`${button} text-fg hover:bg-surface-muted`} aria-label="Back" title="Back to the project">
          <Icon name="back" />
          <span className="hidden sm:inline">Back</span>
        </button>
        <button type="button" onClick={onPanelSheets} aria-pressed={sheetsShown} className={`${iconButton} hidden lg:flex ${sheetsShown ? "bg-brand-soft text-brand-text" : ""}`} title={sheetsShown ? "Hide the sheets strip for more room" : "Show the sheets strip"} aria-label="Toggle the sheets strip"><Icon name="sheets" /></button>
        <button type="button" onClick={onPanelFilmstrip} aria-pressed={filmstripShown} className={`${iconButton} ${filmstripShown ? "bg-brand-soft text-brand-text" : ""}`} title={filmstripShown ? "Hide the pages bar under the sheet" : "Show the pages bar under the sheet"} aria-label="Toggle the pages bar"><Icon name="filmstrip" /></button>
        <button type="button" onClick={onToggleSheets} className={`${iconButton} lg:hidden`} aria-label="Show sheets" title="Show sheets"><Icon name="sheets" /></button>
        <div className="min-w-0 flex-1 leading-tight xl:max-w-[26rem] xl:flex-none">
          <p className="truncate text-[11px] font-bold uppercase tracking-wider text-brand-text">{projectTitle}</p>
          {blueprints.length > 1 ? (
            <Menu label="Switch sheet" items={[{ heading: "Sheets" }, ...sheetItems]} className="flex max-w-full items-center gap-1 rounded-md text-left text-sm font-extrabold hover:text-brand-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">
              <span className="truncate">{blueprint ? blueprint.title : "No sheet yet"}</span>
              <Icon name="chevron" size={14} />
            </Menu>
          ) : (
            <p className="truncate text-sm font-extrabold">{blueprint ? blueprint.title : "No sheet yet"}</p>
          )}
        </div>
        {revisions.length > 1 ? (
          <select value={revision?.id ?? ""} onChange={(e) => onRevision(e.target.value)} aria-label="Revision" title="Revision" className="hidden h-9 rounded-lg border border-line bg-surface px-2 text-xs font-semibold sm:block">
            {revisions.map((r, index) => <option key={r.id} value={r.id}>Rev {r.revision}{index === 0 ? " (latest)" : ""}</option>)}
          </select>
        ) : revision ? <span className="hidden rounded-full bg-surface-muted px-2.5 py-1 text-xs font-semibold text-fg-muted sm:block">Rev {revision.revision}</span> : null}

        <div className="order-last hidden items-center gap-0.5 rounded-xl border border-line bg-surface-muted/60 p-0.5 lg:order-none lg:mx-auto lg:flex" role="group" aria-label="Zoom">
          <button type="button" onClick={onZoomOut} className={iconButton} aria-label="Zoom out" title="Zoom out (-)"><Icon name="zoomOut" /></button>
          <span className="w-14 text-center text-sm font-bold tabular-nums" aria-live="off" title="Zoom level">{zoomPercent}%</span>
          <button type="button" onClick={onZoomIn} className={iconButton} aria-label="Zoom in" title="Zoom in (+)"><Icon name="zoomIn" /></button>
          <button type="button" onClick={onFit} className={`${button} text-fg hover:bg-surface`} title="Fit the sheet to the window (0)"><Icon name="fit" /><span className="hidden 2xl:inline">Fit</span></button>
        </div>

        <div className="ml-auto flex items-center gap-0.5 xl:ml-0">
          <button type="button" onClick={onUndo} disabled={!canUndo} className={iconButton} title={canUndo ? `Undo: ${undoLabel} (Ctrl+Z)` : "Nothing to undo"} aria-label="Undo"><Icon name="undo" /></button>
          <button type="button" onClick={onRedo} disabled={!canRedo} className={iconButton} title={canRedo ? `Redo: ${redoLabel} (Ctrl+Y)` : "Nothing to redo"} aria-label="Redo"><Icon name="redo" /></button>
          {canSeeHistory ? <button type="button" onClick={onHistory} className={iconButton} title="Edit history" aria-label="Edit history"><Icon name="history" /></button> : null}
          {canLockBase && blueprint ? (
            <button type="button" onClick={onToggleBaseLock} aria-pressed={baseLocked} className={`${button} w-9 justify-center px-0 ${baseLocked ? "bg-accent text-black" : "text-fg hover:bg-surface-muted"}`} title={baseLocked ? "Base layer locked: no new revisions or scale changes. Click to unlock" : "Lock the base layer (blueprint file and scale)"} aria-label="Lock the base layer">
              <Icon name={baseLocked ? "lock" : "unlock"} />
            </button>
          ) : null}
          <span className="mx-1 hidden h-6 w-px bg-line sm:block" aria-hidden="true" />
          {canUpload ? (
            <>
              <button type="button" onClick={onUpload} className={iconButton} title="Upload a new sheet" aria-label="Upload a new sheet"><Icon name="upload" /></button>
              {blueprint ? <button type="button" onClick={onNewRevision} disabled={baseLocked} className={`${button} hidden text-fg hover:bg-surface-muted 2xl:flex`} title={baseLocked ? "The base layer is locked" : "Upload a new revision of this sheet"}>New revision</button> : null}
            </>
          ) : null}
          <button type="button" onClick={onShare} disabled={!blueprint} className={iconButton} title="Copy a link to this sheet" aria-label="Share: copy a link"><Icon name="share" /></button>
          <button type="button" onClick={onExport} disabled={!blueprint} className={`${button} bg-brand text-white shadow-sm hover:bg-brand-hover`} title="Export this sheet as PNG or PDF"><Icon name="export" /><span className="hidden xl:inline">Export</span></button>
          <span className="mx-1 hidden h-6 w-px bg-line sm:block" aria-hidden="true" />
          <button type="button" onClick={onToggleTheme} className={iconButton} aria-label={dark ? "Switch to light mode" : "Switch to dark mode"} title={dark ? "Light mode" : "Dark mode"}><Icon name={dark ? "sun" : "moon"} /></button>
          <Menu label="View and layout" items={viewItems} align="end" className={`${button} w-9 justify-center px-0 text-fg hover:bg-surface-muted`}>
            <Icon name="view" />
          </Menu>
          <button type="button" onClick={onPanelInspector} aria-pressed={inspectorShown} className={`${iconButton} hidden lg:flex ${inspectorShown ? "bg-brand-soft text-brand-text" : ""}`} title={inspectorShown ? "Hide the panel for more room" : "Show the panel"} aria-label="Toggle the inspector panel"><Icon name="panel" /></button>
          <button type="button" onClick={onToggleInspector} className={`${iconButton} lg:hidden`} aria-label="Show inspector" title="Show inspector"><Icon name="panel" /></button>
        </div>
      </div>
    </div>
  )
}
