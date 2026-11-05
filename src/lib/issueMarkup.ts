import { normalizeAngle } from "./shapes.ts"
import { resizeFromCorner, type Corner } from "./arrange.ts"

export const ISSUE_PHOTO_LIMIT = 40
export const MARKUP_LIMIT = 150
export const MARKUP_POINT_LIMIT = 500
export const markupTools = ["select", "text", "line", "arrow", "rectangle", "ellipse", "draw"] as const
export type MarkupTool = typeof markupTools[number]
export type MarkupPoint = { x: number; y: number }
export type IssueMarkup = {
  id: string; kind: Exclude<MarkupTool, "select">; x: number; y: number; x2: number; y2: number
  color: string; stroke: number; fontSize: number; text: string; points: MarkupPoint[]
  rotation?: number // degrees around the mark's own centre (markupBox); absent = 0. valid_issue_markup allows -360..360
}

export const clampCoordinate = (value: number) => Math.max(0, Math.min(100, value))
const coordinate = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100
export function markupProblem(value: unknown): string {
  if (!Array.isArray(value) || value.length > MARKUP_LIMIT) return `Use at most ${MARKUP_LIMIT} annotations per photo.`
  const ids = new Set<string>()
  for (const item of value) {
    const keys = item && typeof item === "object" ? Object.keys(item).sort().join(",") : ""
    if (keys !== "color,fontSize,id,kind,points,stroke,text,x,x2,y,y2" && keys !== "color,fontSize,id,kind,points,rotation,stroke,text,x,x2,y,y2") return "Invalid annotation fields."
    if ("rotation" in item && (typeof item.rotation !== "number" || !Number.isFinite(item.rotation) || Math.abs(item.rotation) > 360)) return "Invalid annotation rotation."
    if (typeof item.id !== "string" || !/^[a-zA-Z0-9-]{1,64}$/.test(item.id) || ids.has(item.id)) return "Invalid or duplicate annotation ID."
    ids.add(item.id)
    if (!markupTools.slice(1).includes(item.kind) || ![item.x, item.y, item.x2, item.y2].every(coordinate)) return "Invalid annotation coordinates or type."
    if (typeof item.color !== "string" || !/^#[a-fA-F0-9]{6}$/.test(item.color)) return "Choose a valid annotation color."
    if (!Number.isFinite(item.stroke) || item.stroke < 1 || item.stroke > 12 || !Number.isFinite(item.fontSize) || item.fontSize < 12 || item.fontSize > 72) return "Invalid annotation size."
    if (typeof item.text !== "string" || item.text.length > 300 || (item.kind === "text" && !item.text.trim())) return "Text needs 1 to 300 characters."
    if (!Array.isArray(item.points) || item.points.length > MARKUP_POINT_LIMIT || (item.kind === "draw" && item.points.length < 2) || item.points.some((p: MarkupPoint) => !p || Object.keys(p).sort().join(",") !== "x,y" || !coordinate(p.x) || !coordinate(p.y))) return "Invalid drawing points."
  }
  return ""
}

// Move without clipping any part of the geometry; normalized coordinates work on portrait and landscape photos.
export function moveMarkup(item: IssueMarkup, dx: number, dy: number): IssueMarkup {
  const points = [{ x: item.x, y: item.y }, { x: item.x2, y: item.y2 }, ...item.points]
  const x = Math.max(-Math.min(...points.map(p => p.x)), Math.min(100 - Math.max(...points.map(p => p.x)), dx))
  const y = Math.max(-Math.min(...points.map(p => p.y)), Math.min(100 - Math.max(...points.map(p => p.y)), dy))
  return { ...item, x: item.x + x, y: item.y + y, x2: item.x2 + x, y2: item.y2 + y, points: item.points.map(p => ({ x: p.x + x, y: p.y + y })) }
}

// The unrotated box of a mark in the photo's SVG units (1000 wide; `height` = 1000 x photo height / width). Text is not
// measured in the browser, so its box is estimated from the font size and the longest line; it is the turning centre and the
// selection frame, so it only has to be stable, not exact.
export function markupBox(item: IssueMarkup, height: number): { x: number; y: number; width: number; height: number } {
  const sx = (value: number) => value * 10, sy = (value: number) => (value * height) / 100
  if (item.kind === "text") {
    const lines = item.text.split("\n")
    return { x: sx(item.x), y: sy(item.y), width: Math.max(...lines.map((line) => line.length), 1) * item.fontSize * 0.56, height: lines.length * item.fontSize * 1.2 }
  }
  const xs = item.kind === "draw" && item.points.length ? item.points.map((p) => sx(p.x)) : [sx(item.x), sx(item.x2)]
  const ys = item.kind === "draw" && item.points.length ? item.points.map((p) => sy(p.y)) : [sy(item.y), sy(item.y2)]
  const left = Math.min(...xs), top = Math.min(...ys)
  return { x: left, y: top, width: Math.max(...xs) - left, height: Math.max(...ys) - top }
}
export function markupCenter(item: IssueMarkup, height: number) {
  const box = markupBox(item, height)
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

// Local SVG delta, anchored at the opposite corner; retain rotation and valid saved coordinates.
export function resizeMarkup(item: IssueMarkup, corner: Corner, dx: number, dy: number, height: number, lockAspect = false): IssueMarkup {
  if (!Number.isFinite(dx + dy + height) || height <= 0 || (!dx && !dy)) return item
  const bounds = markupBox(item, height)
  const box = { x: bounds.x / 10, y: bounds.y / height * 100, w: bounds.width / 10, h: bounds.height / height * 100 }
  let target = resizeFromCorner(box, corner, dx, dy, item.rotation ?? 0, { width: 1000, height }, lockAspect || item.kind === "text")
  if (item.kind === "text") {
    const scale = Math.max(12 / item.fontSize, Math.min(72 / item.fontSize, target.w / box.w))
    target = resizeFromCorner(box, corner, (corner.includes("e") ? 1 : -1) * bounds.width * (scale - 1), (corner.includes("s") ? 1 : -1) * bounds.height * (scale - 1), item.rotation ?? 0, { width: 1000, height }, true)
    const fontSize = Math.max(12, Math.min(72, item.fontSize * target.w / box.w))
    return { ...item, x: target.x, y: target.y, x2: target.x, y2: target.y, fontSize }
  }
  const map = (p: MarkupPoint) => ({
    x: clampCoordinate(target.x + (box.w ? (p.x - box.x) / box.w : 0.5) * target.w),
    y: clampCoordinate(target.y + (box.h ? (p.y - box.y) / box.h : 0.5) * target.h),
  })
  const first = map(item), last = map({ x: item.x2, y: item.y2 })
  return { ...item, ...first, x2: last.x, y2: last.y, points: item.points.map(map) }
}
// Sets the turn in -180..180 degrees; a mark turned back to 0 drops the key so it matches an unturned mark exactly.
export function withRotation(item: IssueMarkup, degrees: number): IssueMarkup {
  const { rotation: _previous, ...rest } = item
  const value = normalizeAngle(Number.isFinite(degrees) ? degrees : 0)
  return value ? { ...rest, rotation: value } : rest
}

export function issuePhotoProblem(file: Pick<File, "type" | "size">): string {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) return "Use JPEG, PNG or WebP photos."
  if (!file.size || file.size > 8 * 1024 * 1024) return "Each photo must be between 1 byte and 8 MB."
  return ""
}

export const issueTab = (status: string) => status === "verified" ? "resolved" : status === "issue" ? "open" : "following_up"
export const zonePlanPath = (role: "engineer" | "foreman", project: string, sheet: string) => `/${role}/${role === "engineer" ? "annotation" : "daily-work"}?project=${encodeURIComponent(project)}&sheet=${encodeURIComponent(sheet)}`
