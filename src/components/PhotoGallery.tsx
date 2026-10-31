import { useState } from "react"
import PhotoViewer from "./PhotoViewer"
import { MarkupLayer } from "./issues/MarkupLayer"
import { EmptyState } from "./ui/PageParts"
import { SkeletonCardGrid } from "./ui/Skeleton"
import { formatStamp, useSignedUrl } from "../lib/blueprints"
import type { GalleryPhoto } from "../lib/photoGalleryModel"
import { useAuth } from "../lib/auth"
import { photoPreviewBlocked } from "../lib/photoStamp"
import { photoTime } from "../lib/photoGalleryModel"

export type { GalleryPhoto } from "../lib/photoGalleryModel"

// Marked-up photos draw their markup cropped like the picture (object-cover = slice) and zoom with it on hover.
function Thumb({ photo, bucket, className, compact = false }: { photo: GalleryPhoto; bucket: "pin-photos" | "daily-photos"; className: string; compact?: boolean }) {
  const { profile } = useAuth()
  const [height, setHeight] = useState(750)
  const markup = photo.annotations ?? []
  const blocked = photoPreviewBlocked(profile?.role, photo)
  const { url, failed } = useSignedUrl(bucket, blocked ? null : photo.path)
  if (blocked) return <div className={`${className} flex items-center justify-center bg-danger-soft p-3 text-xs text-danger-fg`}>{compact ? "Image blocked" : "Image blocked: photo failed the site or time check. Ask the Foreman for valid evidence."}</div>
  if (failed) return <div className={`${className} flex items-center justify-center bg-surface-muted text-xs text-fg-muted`}>{compact ? "Unavailable" : "Photo unavailable"}</div>
  if (!url) return <div className={`${className} skeleton`} aria-hidden="true" />
  const alt = photo.caption || photo.checklist?.text || photo.label || "Site photo"
  if (!markup.length) return <img src={url} alt={alt} loading="lazy" className={className} />
  return (
    <span className={`relative block overflow-hidden ${className}`}>
      <img src={url} alt={alt} loading="lazy" className="h-full w-full object-cover" onLoad={(event) => setHeight((1000 * event.currentTarget.naturalHeight) / event.currentTarget.naturalWidth)} />
      <svg viewBox={`0 0 1000 ${height}`} preserveAspectRatio="xMidYMid slice" className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true"><MarkupLayer items={markup} height={height} /></svg>
      <span title="Marked up" className="absolute bottom-1 left-1 grid h-4 w-4 place-items-center rounded-full bg-black/70 text-white" aria-hidden="true"><svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 20h4L19 9l-4-4L4 16z" /></svg></span>
    </span>
  )
}

const tileDate = (iso: string) => new Date(iso).toLocaleDateString("en-PH", { timeZone: "Asia/Manila", month: "short", day: "numeric" })

// Shared thumbnails and viewer for pin evidence and private daily-report photos. "tiles" = compact squares for narrow panels.
export function PhotoGrid({ photos, bucket, loading = false, emptyHint, onRemove, variant = "cards" }: { photos: GalleryPhoto[]; bucket: "pin-photos" | "daily-photos"; loading?: boolean; emptyHint: string; onRemove?: (photo: GalleryPhoto) => void; variant?: "cards" | "tiles" | "details" }) {
  const [viewingId, setViewingId] = useState<string | null>(null)
  const index = photos.findIndex((photo) => photo.id === viewingId)
  const viewing = index >= 0 ? photos[index] : undefined
  // ‹ › in the viewer step through this same list (stays within the current filters).
  const viewer = viewing ? <PhotoViewer photo={viewing} bucket={bucket} onClose={() => setViewingId(null)} position={`${index + 1} of ${photos.length}`}
    onPrev={index > 0 ? () => setViewingId(photos[index - 1].id) : undefined} onNext={index < photos.length - 1 ? () => setViewingId(photos[index + 1].id) : undefined} /> : null

  if (loading) return <SkeletonCardGrid count={4} label="Loading photos" />
  if (photos.length === 0) return <EmptyState title="No photos yet">{emptyHint}</EmptyState>
  if (variant === "tiles") return (
    <>
      <ul className="grid min-w-0 gap-2" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(min(100%,6.5rem),1fr))" }}>
        {photos.map((photo) => {
          const name = photo.checklist?.text || photo.caption || photo.work?.title || photo.label
          return (
            <li key={photo.id} className="min-w-0">
              <button type="button" onClick={() => setViewingId(photo.id)} title={`${name} · ${formatStamp(photo.created_at)}`} aria-label={`Open photo: ${name}, ${formatStamp(photo.created_at)}`} className="group relative block w-full overflow-hidden rounded-lg border border-line bg-surface-muted transition hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">
                <Thumb photo={photo} bucket={bucket} compact className="aspect-square w-full object-cover transition group-hover:scale-[1.04]" />
                <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/55 to-transparent px-1.5 pb-1 pt-5 text-left text-[11px] font-bold leading-tight text-white">
                  <span className="block truncate">{name}</span>
                  <span className="block truncate font-semibold text-white/85">{tileDate(photo.created_at)}</span>
                </span>
              </button>
              {onRemove ? <button type="button" className="min-h-6 text-xs font-bold text-danger-fg underline" aria-label={`Remove photo: ${name}`} onClick={() => onRemove(photo)}>Remove</button> : null}
            </li>
          )
        })}
      </ul>
      {viewer}
    </>
  )
  return (
    <>
      <ul className="grid min-w-0 gap-3" style={{gridTemplateColumns:variant === "details" ? "minmax(0,1fr)" : "repeat(auto-fill,minmax(min(100%,13rem),1fr))"}}>
        {photos.map((photo) => (
          <li key={photo.id} className="min-w-0">
            <button type="button" onClick={() => setViewingId(photo.id)} className="group block w-full overflow-hidden rounded-xl border border-line bg-surface text-left transition hover:shadow-md">
              <div className="overflow-hidden"><Thumb photo={photo} bucket={bucket} className="aspect-[4/3] w-full object-cover transition group-hover:scale-[1.02]" /></div>
              <span className="block space-y-1 px-3 py-2">
                <span className={`${variant === "details" ? "block whitespace-pre-wrap" : "line-clamp-2"} break-words text-sm font-semibold`}>{photo.caption || photo.work?.title || photo.label}</span>
                {photo.checklist ? <span className="block rounded-lg bg-surface-muted p-2 text-xs">
                  <span className="block font-bold text-brand-text">Task</span>
                  <span className={`${variant === "details" ? "block" : "line-clamp-2"} whitespace-pre-wrap break-words`}>{photo.checklist.text}</span>
                  <span className="mt-1 block font-semibold text-fg-muted">{photo.checklist.done ? "Completed" : "Not completed"}</span>
                  {variant === "details" && photo.checklist.remark ? <span className="mt-1 block whitespace-pre-wrap break-words">Remarks: {photo.checklist.remark}</span> : null}
                </span> : null}
                {variant === "details" ? <span className="grid gap-2 border-t border-line pt-2 text-xs" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,9rem),1fr))" }}>
                  <span className="min-w-0"><span className="block font-semibold text-fg-muted">Uploaded</span>{photoTime(photo.created_at)}</span>
                  <span className="min-w-0"><span className="block font-semibold text-fg-muted">Uploaded by</span><span className="break-words">{photo.uploaderName || "Team member"}</span></span>
                  <span className="min-w-0"><span className="block font-semibold text-fg-muted">Captured</span>{photoTime(photo.taken_at)}</span>
                  <span className="min-w-0"><span className="block font-semibold text-fg-muted">Evidence</span>{photo.qa_attempt_id ? "Correction submission" : "Original submission"}</span>
                  {photo.work?.title ? <span className="min-w-0"><span className="block font-semibold text-fg-muted">Work pin</span><span className="break-words">{photo.work.title}</span></span> : null}
                </span> : <span className="block text-xs text-fg-muted">{formatStamp(photo.created_at)}</span>}
                <span className="block text-xs font-bold text-brand-text">View photo and details</span>
              </span>
            </button>
            {onRemove ? <button type="button" className="min-h-6 text-xs font-bold text-danger-fg underline" aria-label={`Remove photo: ${photo.label}`} onClick={() => onRemove(photo)}>Remove photo</button> : null}
          </li>
        ))}
      </ul>
      {viewer}
    </>
  )
}
