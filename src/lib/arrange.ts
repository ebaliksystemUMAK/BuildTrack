// Pure helpers for selecting, aligning, distributing, copying and nudging several sheet items at once.
// Everything is in percent of the sheet; `ctx` is the sheet size in pixels because one percent of x is not as long as one percent of y.
// No React and no database: tested with `pnpm test:lib`.
import { bbox, type Pt } from "./geometry.ts"

export type ArrangeItem = {
  id: string
  kind: string
  x: number
  y: number
  w: number | null
  h: number | null
  points: Pt[] | null
  text?: string | null
  font_size?: number | null
}
export type Box = { x: number; y: number; w: number; h: number }
export type Ctx = { width: number; height: number }
export type Move = { id: string; x?: number; y?: number; points?: Pt[] }

const round = (value: number) => Math.round(value * 1000) / 1000
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

// The area an item covers. Notes are callouts drawn at a fixed screen size, so they count as a point.
export function itemBox(item: ArrangeItem, ctx: Ctx): Box {
  if (item.points && item.points.length) return bbox(item.points)
  if (item.kind === "symbol") return { x: item.x, y: item.y, w: item.w ?? 0, h: ((item.w ?? 0) * ctx.width) / ctx.height }
  if (item.kind === "text") {
    const fontPx = ((item.font_size ?? 1.6) / 100) * ctx.width
    const boxPx = ((item.w ?? 25) / 100) * ctx.width
    const lines = Math.max(1, (item.text ?? "").split("\n").reduce((sum, line) => sum + Math.max(1, Math.ceil((line.length * fontPx * 0.55) / boxPx)), 0))
    return { x: item.x, y: item.y, w: item.w ?? 25, h: ((lines * fontPx * 1.25) / ctx.height) * 100 }
  }
  return { x: item.x, y: item.y, w: item.w ?? 0, h: item.h ?? 0 }
}

export function unionBox(boxes: Box[]): Box {
  const minX = Math.min(...boxes.map((b) => b.x))
  const minY = Math.min(...boxes.map((b) => b.y))
  const maxX = Math.max(...boxes.map((b) => b.x + b.w))
  const maxY = Math.max(...boxes.map((b) => b.y + b.h))
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

// Shift an item by (dx, dy) percent, clamped so the whole item stays on the sheet. Returns the database fields to write.
export function shifted(item: ArrangeItem, dx: number, dy: number, ctx: Ctx): Move {
  const box = itemBox(item, ctx)
  const sx = clamp(dx, -box.x, 100 - (box.x + box.w))
  const sy = clamp(dy, -box.y, 100 - (box.y + box.h))
  if (item.points) return { id: item.id, points: item.points.map(([px, py]) => [round(px + sx), round(py + sy)] as Pt) }
  return { id: item.id, x: round(item.x + sx), y: round(item.y + sy) }
}

// Moves a whole selection by the same amount; the selection is clamped as one block so relative positions never change.
export function shiftedTogether(items: ArrangeItem[], dx: number, dy: number, ctx: Ctx): Move[] {
  if (!items.length) return []
  const all = unionBox(items.map((item) => itemBox(item, ctx)))
  const sx = clamp(dx, -all.x, 100 - (all.x + all.w))
  const sy = clamp(dy, -all.y, 100 - (all.y + all.h))
  return items.map((item) => shifted(item, sx, sy, ctx))
}

export type AlignMode = "left" | "center" | "right" | "top" | "middle" | "bottom"

// Moves every item so it lines up with the edge or centre of the whole selection.
export function alignMoves(items: ArrangeItem[], mode: AlignMode, ctx: Ctx): Move[] {
  if (items.length < 2) return []
  const boxes = items.map((item) => itemBox(item, ctx))
  const all = unionBox(boxes)
  return items.map((item, index) => {
    const box = boxes[index]
    let dx = 0
    let dy = 0
    if (mode === "left") dx = all.x - box.x
    else if (mode === "right") dx = all.x + all.w - (box.x + box.w)
    else if (mode === "center") dx = all.x + all.w / 2 - (box.x + box.w / 2)
    else if (mode === "top") dy = all.y - box.y
    else if (mode === "bottom") dy = all.y + all.h - (box.y + box.h)
    else dy = all.y + all.h / 2 - (box.y + box.h / 2)
    return shifted(item, dx, dy, ctx)
  })
}

// Spreads three or more items so the gaps between neighbours are equal; the outer two stay where they are.
export function distributeMoves(items: ArrangeItem[], axis: "horizontal" | "vertical", ctx: Ctx): Move[] {
  if (items.length < 3) return []
  const horizontal = axis === "horizontal"
  const entries = items.map((item) => ({ item, box: itemBox(item, ctx) })).sort((a, b) => (horizontal ? a.box.x - b.box.x : a.box.y - b.box.y))
  const size = (b: Box) => (horizontal ? b.w : b.h)
  const start = (b: Box) => (horizontal ? b.x : b.y)
  const first = entries[0].box
  const last = entries[entries.length - 1].box
  const span = start(last) + size(last) - start(first)
  const gap = (span - entries.reduce((sum, e) => sum + size(e.box), 0)) / (entries.length - 1)
  let cursor = start(first) + size(first) + gap
  const moves: Move[] = [shifted(entries[0].item, 0, 0, ctx)]
  for (let i = 1; i < entries.length - 1; i++) {
    const { item, box } = entries[i]
    const delta = cursor - start(box)
    moves.push(horizontal ? shifted(item, delta, 0, ctx) : shifted(item, 0, delta, ctx))
    cursor += size(box) + gap
  }
  moves.push(shifted(entries[entries.length - 1].item, 0, 0, ctx))
  return moves
}

// True when applying the moves would change nothing (so no request and no undo step are needed).
export function isNoop(items: ArrangeItem[], moves: Move[]): boolean {
  const byId = new Map(items.map((item) => [item.id, item]))
  return moves.every((move) => {
    const item = byId.get(move.id)
    if (!item) return true
    if (move.points) return !!item.points && move.points.every(([x, y], i) => Math.abs(x - item.points![i][0]) < 0.0005 && Math.abs(y - item.points![i][1]) < 0.0005)
    return Math.abs((move.x ?? item.x) - item.x) < 0.0005 && Math.abs((move.y ?? item.y) - item.y) < 0.0005
  })
}

// Items whose area touches (or, in "contain" mode, lies inside) a rectangle: the box-select marquee.
export function inRectangle(items: ArrangeItem[], rect: Box, ctx: Ctx, mode: "touch" | "contain" = "touch"): string[] {
  return items
    .filter((item) => {
      const b = itemBox(item, ctx)
      if (mode === "contain") return b.x >= rect.x && b.y >= rect.y && b.x + b.w <= rect.x + rect.w && b.y + b.h <= rect.y + rect.h
      const pad = 0.4 // thin lines and points still count when the rectangle touches them
      return b.x - pad <= rect.x + rect.w && b.x + b.w + pad >= rect.x && b.y - pad <= rect.y + rect.h && b.y + b.h + pad >= rect.y
    })
    .map((item) => item.id)
}

// Expands a set of ids to everything that shares a group with any of them.
export function withGroupMembers<T extends { id: string; group_id?: string | null }>(all: T[], ids: string[]): string[] {
  const groups = new Set(all.filter((item) => ids.includes(item.id) && item.group_id).map((item) => item.group_id as string))
  return all.filter((item) => ids.includes(item.id) || (item.group_id && groups.has(item.group_id))).map((item) => item.id)
}

// ---- Images ----
// Size and place a picture on the sheet. `widthPct` is the wanted width as percent of the sheet; the height keeps the picture's
// proportions (one percent of x is not as long as one percent of y). The box is centred on (atX, atY) and kept on the sheet.
export function fitImageBox(img: { width: number; height: number }, sheet: Ctx, widthPct: number, atX = 50, atY = 50): { x: number; y: number; w: number; h: number } {
  const ratio = (sheet.width / sheet.height) * (img.height / img.width)
  let w = clamp(widthPct, 1, 100)
  let h = w * ratio
  if (h > 90) {
    w = (w * 90) / h
    h = 90
  }
  if (w > 100) {
    h = (h * 100) / w
    w = 100
  }
  return { x: round(clamp(atX - w / 2, 0, 100 - w)), y: round(clamp(atY - h / 2, 0, 100 - h)), w: round(w), h: round(h) }
}

// New size while a corner handle is dragged. `dxPct` / `dyPct` are the pointer movement in the item's own axes, in percent of
// the sheet. With `lockAspect` the picture keeps its shape; the box never leaves the sheet and never gets smaller than 1 %.
export function resizedBox(orig: { x: number; y: number; w: number; h: number }, dxPct: number, dyPct: number, lockAspect: boolean): { w: number; h: number } {
  if (!lockAspect) return { w: round(clamp(orig.w + dxPct, 1, 100 - orig.x)), h: round(clamp(orig.h + dyPct, 1, 100 - orig.y)) }
  const ratio = orig.h / orig.w
  const maxW = Math.min(100 - orig.x, (100 - orig.y) / ratio)
  const w = clamp(orig.w + dxPct, Math.min(1, maxW), maxW)
  return { w: round(w), h: round(w * ratio) }
}

export type Corner = "nw" | "ne" | "sw" | "se"

// Scale every vertex together. Flat strokes remain flat without divisions by zero.
export function resizedPoints(points: Pt[], target: Box): Pt[] {
  const orig = bbox(points)
  return points.map(([x, y]) => [
    round(clamp(target.x + (orig.w ? (x - orig.x) / orig.w : 0.5) * target.w, 0, 100)),
    round(clamp(target.y + (orig.h ? (y - orig.y) / orig.h : 0.5) * target.h, 0, 100)),
  ])
}

// Resizing from any corner of a (possibly rotated) box. The opposite corner stays where it is on the sheet, whatever the rotation.
// `dx` / `dy` are the pointer movement in the item's own axes, in pixels of the sheet. Returns the new box in percent of the
// sheet; it never goes below 1 % and never leaves the sheet (the size is reduced until the unrotated box fits).
export function resizeFromCorner(
  orig: { x: number; y: number; w: number; h: number },
  corner: Corner,
  dx: number,
  dy: number,
  rotationDeg: number,
  sheet: { width: number; height: number },
  lockAspect: boolean,
): { x: number; y: number; w: number; h: number } {
  const { width: W, height: H } = sheet
  const sx = corner === "ne" || corner === "se" ? 1 : -1
  const sy = corner === "sw" || corner === "se" ? 1 : -1
  const bw = (orig.w / 100) * W
  const bh = (orig.h / 100) * H
  const minW = 0.01 * W
  const minH = 0.01 * H
  let tw = bw ? Math.max(minW, bw + sx * dx) : 0
  let th = bh ? Math.max(minH, bh + sy * dy) : 0
  if (lockAspect && bw > 0 && bh > 0) {
    const ratio = bh / bw
    tw = Math.max(minW, minH / ratio, tw)
    th = tw * ratio
  }
  const t = (rotationDeg * Math.PI) / 180
  const cos = Math.cos(t)
  const sin = Math.sin(t)
  const rotate = (u: number, v: number) => ({ x: u * cos - v * sin, y: u * sin + v * cos })
  const centre = { x: (orig.x / 100) * W + bw / 2, y: (orig.y / 100) * H + bh / 2 }
  const anchorOffset = rotate((-sx * bw) / 2, (-sy * bh) / 2)
  const anchor = { x: centre.x + anchorOffset.x, y: centre.y + anchorOffset.y }
  const boxAt = (k: number) => {
    const w = bw + (tw - bw) * k
    const h = bh + (th - bh) * k
    const offset = rotate((sx * w) / 2, (sy * h) / 2)
    const c = { x: anchor.x + offset.x, y: anchor.y + offset.y }
    return { x: ((c.x - w / 2) / W) * 100, y: ((c.y - h / 2) / H) * 100, w: (w / W) * 100, h: (h / H) * 100 }
  }
  const fits = (b: { x: number; y: number; w: number; h: number }) => b.x >= -1e-6 && b.y >= -1e-6 && b.x + b.w <= 100 + 1e-6 && b.y + b.h <= 100 + 1e-6
  let k = 1
  if (!fits(boxAt(1))) {
    let lo = 0
    let hi = 1
    for (let step = 0; step < 24; step += 1) {
      const mid = (lo + hi) / 2
      if (fits(boxAt(mid))) lo = mid
      else hi = mid
    }
    k = lo
  }
  const b = boxAt(k)
  return { x: round(Math.max(0, b.x)), y: round(Math.max(0, b.y)), w: round(b.w), h: round(b.h) }
}
