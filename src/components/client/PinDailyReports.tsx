import { useState } from "react"
import { useDailyReports, reportDateLong, weatherLabels, type DailyReport } from "../../lib/reports"
import { useEvidencePhotos, useProjectWorkItems } from "../../lib/dailyPhotos"
import { useSignedUrl, type Pin } from "../../lib/blueprints"
import { useProjectTeam } from "../../lib/projects"
import { reportsForPin } from "../../lib/clientPortalModel"
import type { GalleryPhoto } from "../../lib/photoGalleryModel"
import PhotoViewer from "../PhotoViewer"
import Modal from "../Modal"
import { buttonSecondary } from "../ui/PageParts"
import { SkeletonList } from "../ui/Skeleton"
import { inRange, isFiltered, rangeText, type DateRange } from "../../lib/dateRangeModel"

export function DetailsIcon() {
  return <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7v1" /></svg>
}

// Daily progress reports that explicitly link this pin (linked_work). The pin panel passes the pin's own reports (already loaded
// for its counts); otherwise the project's reports are read here. Clients only ever get submitted reports; staff also see their
// own drafts (Row Level Security), marked as drafts.
export default function PinDailyReports({ pin, reports: given, loading: givenLoading, error: givenError, onRetry, staff = false, dates }: { pin: Pin; reports?: DailyReport[]; loading?: boolean; error?: string; onRetry?: () => void | Promise<void>; staff?: boolean; dates?: DateRange }) {
  const project = useDailyReports(given ? null : pin.project_id)
  const reports = given ?? project.reports
  const loading = given ? Boolean(givenLoading) : project.loading
  const error = given ? givenError ?? "" : project.error
  const reload = given ? async () => { await onRetry?.() } : project.reload
  const { team } = useProjectTeam(pin.project_id)
  const items = useProjectWorkItems(pin.project_id, true)
  const [detailId, setDetailId] = useState<string | null>(null)
  const linked = (staff ? reports.filter(report => report.project_id === pin.project_id && report.linked_work?.some(link => link.pin_id === pin.id)) : reportsForPin(reports, pin.project_id, pin.id))
    .filter(report => !dates || inRange(report.report_date, dates))
    .sort((a, b) => b.report_date.localeCompare(a.report_date) || b.id.localeCompare(a.id))
  const detail = linked.find(report => report.id === detailId)
  const nameOf = (id: string) => team.find(member => member.user_id === id)?.full_name ?? "Project Foreman"
  if (loading) return <SkeletonList rows={2} label="Loading linked daily reports" />
  if (error) return <p role="alert" className="text-sm text-danger-fg">{error} <button type="button" onClick={() => void reload()} className="underline">Retry</button></p>
  return <section aria-label="Daily reports linked to this pin" className="min-w-0 space-y-4">
    <div><h3 className="text-sm font-extrabold">Foreman daily progress</h3><p className="mt-1 text-xs leading-relaxed text-fg-muted">{staff ? "Reports that link this pin or one of its tasks." : "Submitted reports explicitly linked to this pin."} Photos belong to the whole daily report, not necessarily only this pin.</p></div>
    {!linked.length ? <p className="rounded-xl border border-dashed border-line p-4 text-sm text-fg-muted">{dates && isFiltered(dates) ? `No ${staff ? "daily report" : "submitted daily report"} is linked to this pin for ${rangeText(dates)}. Choose another date or All dates to view earlier reports.` : staff ? "No daily report links this pin yet." : "No submitted daily report is linked to this pin yet."}</p> : <ul className="space-y-4">{linked.map(report => <li key={report.id} className="min-w-0 overflow-hidden rounded-xl border border-line bg-surface">
      <div className="flex items-start justify-between gap-3 border-b border-line p-3"><div className="min-w-0"><h4 className="text-sm font-bold">{reportDateLong(report.report_date)}{report.status !== "submitted" ? <span className="ml-2 rounded-full bg-surface-muted px-2 py-0.5 text-[11px] font-bold text-fg-muted">Draft</span> : null}</h4><p className="mt-1 break-words text-xs text-fg-muted">{nameOf(report.author_id)}{(report.linked_work ?? []).some(link => link.pin_id === pin.id && link.item_id) ? ` · ${(report.linked_work ?? []).filter(link => link.pin_id === pin.id).map(link => link.item_id ? items.find(item => item.id === link.item_id)?.text ?? "Task" : "Whole work pin").join(", ")}` : ""}</p></div><button type="button" className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-line hover:bg-surface-muted" aria-label={`Report details for ${report.report_date}`} title="Report details" onClick={() => setDetailId(report.id)}><DetailsIcon /></button></div>
      <div className="space-y-3 p-3"><p className="line-clamp-3 whitespace-pre-wrap break-words text-sm">{report.work_done}</p><ReportSlideshow key={report.id} report={report} authorName={nameOf(report.author_id)} /></div>
    </li>)}</ul>}
    {detail ? <Modal title={`Daily progress · ${reportDateLong(detail.report_date)}`} description={`Prepared by ${nameOf(detail.author_id)}`} size="lg" onClose={() => setDetailId(null)} footer={<button type="button" className={buttonSecondary} onClick={() => setDetailId(null)}>Close details</button>}>
      <div className="space-y-4 text-sm"><dl className="grid grid-cols-2 gap-4"><div><dt className="text-xs text-fg-muted">Weather</dt><dd>{weatherLabels[detail.weather]}</dd></div><div><dt className="text-xs text-fg-muted">Workers reported</dt><dd>{detail.workers_count}</dd></div><div><dt className="text-xs text-fg-muted">Submitted (Manila)</dt><dd>{detail.submitted_at ? new Date(detail.submitted_at).toLocaleString("en-PH", { timeZone: "Asia/Manila" }) : "Not recorded"}</dd></div><div><dt className="text-xs text-fg-muted">Engineer review</dt><dd className="capitalize">{detail.review_state ?? "pending"}</dd></div></dl>
        {[["Work accomplished", detail.work_done], ["Issues", detail.issues], ["Delays", detail.delays], ["Safety", detail.safety]].filter(([, value]) => value).map(([label, value]) => <section key={label}><h3 className="font-bold">{label}</h3><p className="mt-1 whitespace-pre-wrap break-words">{value}</p></section>)}
        <section className="border-t border-line pt-3"><h3 className="font-bold">Linked tasks on {pin.title}</h3><ul className="mt-2 space-y-1">{(detail.linked_work ?? []).filter(link => link.pin_id === pin.id).map((link, index) => <li key={`${link.item_id}-${index}`}>{link.item_id ? items.find(item => item.id === link.item_id && item.pin_id === pin.id)?.text ?? "Task unavailable" : "Whole work pin"}</li>)}</ul></section>
      </div>
    </Modal> : null}
  </section>
}

export function ReportSlideshow({ report, authorName }: { report: DailyReport; authorName: string }) {
  const { photos, loading, error, reload } = useEvidencePhotos(report.project_id, "daily", report.id)
  const [index, setIndex] = useState(0)
  const [viewing, setViewing] = useState(false)
  const [details, setDetails] = useState(false)
  const at = Math.min(index, Math.max(0, photos.length - 1))
  const photo = photos[at]
  const slide: GalleryPhoto | undefined = photo ? { ...photo, uploaderName: authorName } : undefined
  const prev = at > 0 ? () => setIndex(at - 1) : undefined
  const next = at + 1 < photos.length ? () => setIndex(at + 1) : undefined
  if (loading) return <div className="skeleton h-36 rounded-lg" aria-label="Loading report photos" />
  if (error) return <p role="alert" className="text-xs text-danger-fg">{error} <button type="button" className="underline" onClick={() => void reload()}>Retry</button></p>
  if (!slide) return <p className="text-xs text-fg-muted">No photos attached to this report.</p>
  return <div className="min-w-0 space-y-2" aria-label="Daily report photo slideshow">
    <button type="button" className="block w-full overflow-hidden rounded-lg border border-line bg-surface-muted" aria-label="Open report photo slideshow" onClick={() => { setDetails(false); setViewing(true) }}><ReportImage photo={slide} /></button>
    <div className="flex items-center justify-between gap-2"><button type="button" aria-label="Previous report photo" className={buttonSecondary + " !px-3 !py-1"} disabled={!prev} onClick={prev}>‹</button><span className="text-xs font-semibold" aria-live="polite">{at + 1} / {photos.length}</span><button type="button" aria-label="Photo details" title="Photo details" className="grid h-8 w-8 place-items-center rounded-lg border border-line hover:bg-surface-muted" onClick={() => { setDetails(true); setViewing(true) }}><DetailsIcon /></button><button type="button" aria-label="Next report photo" className={buttonSecondary + " !px-3 !py-1"} disabled={!next} onClick={next}>›</button></div>
    {viewing ? <PhotoViewer photo={slide} bucket="daily-photos" detailsToggle initialDetails={details} onClose={() => setViewing(false)} onPrev={prev} onNext={next} position={`${at + 1} of ${photos.length}`} /> : null}
  </div>
}

function ReportImage({ photo }: { photo: GalleryPhoto }) {
  const { url, failed } = useSignedUrl("daily-photos", photo.path)
  if (failed) return <span className="block p-8 text-xs text-fg-muted">Photo unavailable</span>
  if (!url) return <span className="skeleton block h-40" />
  return <img src={url} alt={photo.caption || photo.label || "Daily progress photo"} className="aspect-[4/3] w-full object-contain" />
}
