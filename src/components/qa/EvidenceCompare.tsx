import BeforeAfter from "../BeforeAfter"
import type { PinPhoto } from "../../lib/blueprints"
import { photoPreviewBlocked } from "../../lib/photoStamp"

// Compare saved evidence for one permanent task, independently of inspection/completion status.
export default function EvidenceCompare({ itemId, label, attempts, draftPhotos = [], role, afterLabel = "Latest request" }: { itemId: string; label: string; attempts: Array<{ photos_snapshot: PinPhoto[] }>; draftPhotos?: PinPhoto[]; role?: string | null; afterLabel?: string }) {
  const corrections = draftPhotos.filter(photo => photo.checklist_item_id === itemId)
  if (attempts.length < 2 && !corrections.length) return null
  const first = attempts[0]?.photos_snapshot.find(photo => photo.checklist_item_id === itemId) ?? null
  const latest = corrections[corrections.length - 1] ?? [...attempts].reverse().map(row => row.photos_snapshot.filter(photo => photo.checklist_item_id === itemId).pop()).find(Boolean) ?? null
  if (!first || !latest || first.id === latest.id || photoPreviewBlocked(role, first) || photoPreviewBlocked(role, latest)) return null
  return <div className="max-w-xl space-y-2">
    <h3 className="text-xs font-extrabold uppercase tracking-wider text-fg-muted">Before and after · {label}</h3>
    <BeforeAfter bucket="pin-photos" labels={["Original request", corrections.length ? "Correction" : afterLabel]} before={{ path: first.path, at: first.created_at, caption: first.caption, photo: { ...first, label: `${label} · Original request` } }} after={{ path: latest.path, at: latest.created_at, caption: latest.caption, photo: { ...latest, label: `${label} · ${afterLabel}` } }} />
  </div>
}
