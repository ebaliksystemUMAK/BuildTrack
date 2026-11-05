import { useId, type PointerEvent, type ReactElement } from "react"
import { markupBox, markupCenter, type IssueMarkup } from "../../lib/issueMarkup"
import type { Corner } from "../../lib/arrange"

const turn = (item: IssueMarkup, height: number) => {
  if (!item.rotation) return undefined
  const centre = markupCenter(item, height)
  return `rotate(${item.rotation} ${centre.x} ${centre.y})`
}

// Saved photo markup as SVG shapes in a 1000-wide viewBox (coordinates are percentages of the photo). Text is rendered as
// SVG text, never HTML. Each mark turns around its own centre by `rotation`. Used by the editor, thumbnails, viewers and the
// slideshow strip; with `onSelect` (the editor) every mark also gets a wide invisible grab area, so thin lines and the
// space around text are easy to pick up.
export function MarkupLayer({ items, height, selected, onSelect }: { items: IssueMarkup[]; height: number; selected?: string; onSelect?: (id: string, event: PointerEvent<SVGGElement>) => void }) {
  const arrowId = useId().replace(/:/g, "")
  return <>
    <defs>{items.filter(item => item.kind === "arrow").map(item => <marker key={item.id} id={`${arrowId}-${item.id}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill={item.color} /></marker>)}</defs>
    {items.map(item => {
      const x = item.x * 10, y = item.y * height / 100, x2 = item.x2 * 10, y2 = item.y2 * height / 100
      const outline = (extra: Record<string, unknown> = {}): ReactElement => item.kind === "rectangle" ? <rect x={Math.min(x,x2)} y={Math.min(y,y2)} width={Math.abs(x2-x)} height={Math.abs(y2-y)} {...extra} />
        : item.kind === "ellipse" ? <ellipse cx={(x+x2)/2} cy={(y+y2)/2} rx={Math.abs(x2-x)/2} ry={Math.abs(y2-y)/2} {...extra} />
        : item.kind === "draw" ? <polyline points={item.points.map(p => `${p.x*10},${p.y*height/100}`).join(" ")} {...extra} />
        : <line x1={x} y1={y} x2={x2} y2={y2} {...extra} />
      const shape = item.kind === "text" ? <text x={x} y={y} fill={item.color} stroke="none" fontSize={item.fontSize} fontFamily="Arial, sans-serif" dominantBaseline="hanging">{item.text.split("\n").map((line, i) => <tspan key={i} x={x} dy={i ? "1.2em" : 0}>{line}</tspan>)}</text>
        : outline(item.kind === "arrow" ? { markerEnd: `url(#${arrowId}-${item.id})` } : {})
      const box = item.kind === "text" && onSelect ? markupBox(item, height) : null
      const grab = !onSelect ? null : box ? <rect data-grab x={box.x - 6} y={box.y - 6} width={box.width + 12} height={box.height + 12} fill="transparent" stroke="none" />
        : outline({ "data-grab": true, stroke: "transparent", strokeWidth: Math.max(item.stroke + 18, 24), markerEnd: undefined })
      return <g key={item.id} data-markup-id={item.id} transform={turn(item, height)} fill="none" stroke={item.color} strokeWidth={item.stroke} strokeLinecap="round" strokeLinejoin="round" style={{ cursor: onSelect ? "move" : undefined, filter: selected === item.id ? "drop-shadow(0 0 4px white) drop-shadow(0 0 2px #9e1f93)" : undefined }} onPointerDown={event => onSelect?.(item.id,event)}>{grab}{shape}</g>
    })}
  </>
}

// The selected mark's frame, turned with it, and the rotate handle above it (like the blueprint editor's). `unit` is the SVG
// length of one screen pixel, so the frame and handle keep the same on-screen size at every zoom.
export function SelectionFrame({ item, height, unit, onRotateStart, onResizeStart }: { item: IssueMarkup; height: number; unit: number; onRotateStart?: (event: PointerEvent<SVGCircleElement>) => void; onResizeStart?: (corner: Corner, event: PointerEvent<SVGRectElement>) => void }) {
  const box = markupBox(item, height)
  const pad = 6 * unit + (item.kind === "text" ? 0 : item.stroke / 2)
  const centre = markupCenter(item, height)
  const top = box.y - pad, stem = 26 * unit
  return (
    <g data-selection-frame transform={turn(item, height)} pointerEvents="none">
      <rect x={box.x - pad} y={top} width={box.width + 2 * pad} height={box.height + 2 * pad} fill="none" stroke="#9e1f93" strokeWidth={1.5 * unit} strokeDasharray={`${5 * unit} ${4 * unit}`} />
      {onResizeStart ? (["nw", "ne", "sw", "se"] as Corner[]).map(corner => <g key={corner} transform={`translate(${corner.includes("w") ? box.x - pad : box.x + box.width + pad} ${corner.includes("n") ? top : box.y + box.height + pad})`}>
        <rect data-resize-handle={corner} x={-12 * unit} y={-12 * unit} width={24 * unit} height={24 * unit} fill="transparent" pointerEvents="all" style={{ cursor: corner === "nw" || corner === "se" ? "nwse-resize" : "nesw-resize" }} onPointerDown={event => onResizeStart(corner, event)}><title>Drag to resize (Shift keeps proportions; text always scales)</title></rect>
        <rect x={-5 * unit} y={-5 * unit} width={10 * unit} height={10 * unit} fill="#9e1f93" stroke="white" strokeWidth={1.5 * unit} />
      </g>) : null}
      {onRotateStart ? <>
        <line x1={centre.x} y1={top} x2={centre.x} y2={top - stem} stroke="#9e1f93" strokeWidth={1.5 * unit} />
        <circle data-rotate-handle cx={centre.x} cy={top - stem} r={8 * unit} fill="#9e1f93" stroke="#ffffff" strokeWidth={2 * unit} pointerEvents="all" style={{ cursor: "grab" }} onPointerDown={onRotateStart}><title>Drag to rotate (Shift = 15 degree steps)</title></circle>
      </> : null}
    </g>
  )
}
