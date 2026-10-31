import { photoTime, type GalleryPhoto } from "../lib/photoGalleryModel"
import { stampLabel } from "../lib/photoStamp"
import { reportDateLong } from "../lib/reportFormat"

export default function PhotoDetails({ photo, bucket }: { photo: GalleryPhoto; bucket: "pin-photos" | "daily-photos" | "qa-evidence" }) {
  const stamp = stampLabel({ taken_at: photo.taken_at ?? null, distance_m: photo.distance_m ?? null, stamp_flag: photo.stamp_flag ?? null })
  const fields = [
    ["Photo type", bucket === "daily-photos" ? "Daily report" : bucket === "qa-evidence" ? "QA / NCR evidence" : photo.checklist ? "Task evidence" : "Work progress"],
    ["Uploaded", `${photoTime(photo.created_at)} (Manila)`],
    ["Uploaded by", photo.uploaderName || (photo.uploaded_by ? "Team member (name unavailable)" : "Not recorded")],
    ["Phone-recorded time", photo.taken_at ? `${photoTime(photo.taken_at)} (Manila)` : "Not recorded"],
    ["Caption", photo.caption || "No caption"],
    ...(photo.annotations?.length ? [["Markup", `${photo.annotations.length} mark${photo.annotations.length === 1 ? "" : "s"} drawn over the photo. The original file is unchanged.`]] : []),
    ["File", photo.path.split("/").pop() ?? photo.path],
    ...(photo.requestLabel ? [["QA request",photo.requestLabel]] : []),
  ]
  return <aside aria-label="Photo details" className="min-w-0 space-y-5 rounded-xl border border-line bg-surface-muted p-4">
    <h3 className="text-base font-extrabold">Photo details</h3>
    <dl className="space-y-3 text-sm">
      {fields.map(([label, value]) => <div key={label}><dt className="text-xs font-bold text-fg-muted">{label}</dt><dd className="whitespace-pre-wrap break-words">{value}</dd></div>)}
    </dl>
    {photo.work ? <section className="space-y-1 border-t border-line pt-3">
      <h4 className="text-xs font-extrabold uppercase text-fg-muted">Linked work</h4>
      <p className="break-words text-sm font-bold">{photo.work.title}</p>
      <p className="text-xs capitalize text-fg-muted">Current status: {photo.work.status.replace(/_/g, " ")}</p>
      {photo.work.description ? <p className="whitespace-pre-wrap break-words text-sm">{photo.work.description}</p> : null}
    </section> : null}
    {photo.checklist ? <section className="space-y-2 border-t border-line pt-3" aria-label="Linked task">
      <h4 className="text-xs font-extrabold uppercase text-fg-muted">Task</h4>
      <p className="whitespace-pre-wrap break-words text-sm font-bold">{photo.checklist.text}</p>
      <span className="inline-flex rounded-full border border-line bg-surface px-2 py-1 text-xs font-bold">{photo.checklist.done ? "Completed" : "Not completed"}</span>
      {photo.checklist.done_at ? <p className="text-xs text-fg-muted">Completed: {photoTime(photo.checklist.done_at)} (Manila)</p> : null}
      <div><h5 className="text-xs font-bold text-fg-muted">Foreman's remark</h5><p className="whitespace-pre-wrap break-words text-sm">{photo.checklist.remark || "No remark recorded"}</p></div>
      <p className="text-xs text-fg-muted">{photo.recordState === "snapshot" ? "Historical task snapshot from this request. Later corrections do not change it." : "Shows the current task record, not a snapshot of its state when uploaded."}</p>
    </section> : null}
    {photo.report ? <section className="space-y-1 border-t border-line pt-3">
      <h4 className="text-xs font-extrabold uppercase text-fg-muted">Daily report</h4>
      <p className="text-sm font-bold">{reportDateLong(photo.report.report_date)}</p>
      <p className="text-xs capitalize text-fg-muted">{photo.report.status}</p>
      <p className="whitespace-pre-wrap break-words text-sm">{photo.report.work_done || "No work description yet"}</p>
    </section> : null}
    <section className="space-y-1 border-t border-line pt-3">
      <h4 className="text-xs font-extrabold uppercase text-fg-muted">Photo stamp</h4>
      <p className="text-sm font-bold">{stamp?.text ?? "Not recorded"}</p>
      {stamp ? <p className="text-xs text-fg-muted">{stamp.detail}</p> : null}
    </section>
  </aside>
}
