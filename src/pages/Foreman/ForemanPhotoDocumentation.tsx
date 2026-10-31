import { useEffect, useMemo, useState } from "react"
import { PhotoGrid } from "../../components/PhotoGallery"
import WorkFilters from "../../components/WorkFilters"
import ProjectContextBar from "../../components/ProjectContextBar"
import { PageHead, buttonSecondary, inputClass } from "../../components/ui/PageParts"
import { useBlueprints, useProjectPins } from "../../lib/blueprints"
import { getSelectedProjectId, useProjectTeam } from "../../lib/projects"
import { manilaToday } from "../../lib/progress"
import { reportDateLong } from "../../lib/reportFormat"
import {
  changePhotoScope, defaultPhotoDates, emptyPhotoScope, photoRangeDates, photoRangeOf, photoRanges, readPhotoDates, readPhotoScope,
  type PhotoDates, type PhotoRange, type PhotoScope,
} from "../../lib/photoGalleryModel"
import { photoTabs, readPhotoTab, useEvidencePhotos, useProjectWorkItems, type PhotoTab } from "../../lib/dailyPhotos"
import type { ForemanPageProps } from "./types"

const tabHint: Record<PhotoTab, string> = {
  daily: "Photos attached to your daily progress reports.",
  checklist: "Evidence photos of the tasks (FLOOR, WALL…) submitted for QA Review.",
}
const pill = (active: boolean) => `rounded-lg px-3 py-1.5 text-sm font-bold transition ${active ? "bg-brand text-white shadow-sm" : "text-fg-muted hover:bg-surface-muted hover:text-fg"}`
const select = `${inputClass} mt-1 !py-1.5`
const label = "min-w-0 text-xs font-bold text-fg-muted"

export default function ForemanPhotoDocumentation({ onNavigate }: ForemanPageProps) {
  const projectId = getSelectedProjectId()
  const today = manilaToday()
  const [tab, setTab] = useState(readPhotoTab)
  // An explicit ?from / ?to in the link wins; otherwise each tab opens on its own default (daily report: today).
  const [dates, setDates] = useState<PhotoDates>(() => {
    const search = new URLSearchParams(window.location.search)
    return search.has("from") || search.has("to") ? readPhotoDates(window.location.search) : defaultPhotoDates(readPhotoTab(), manilaToday())
  })
  const [scope, setScope] = useState<PhotoScope>(() => readPhotoScope(window.location.search))
  const [picking, setPicking] = useState(false)
  const pinTab = tab !== "daily"
  const { photos, loading, error, reload } = useEvidencePhotos(projectId, tab, undefined, dates, scope)
  const { team } = useProjectTeam(projectId)
  const { blueprints } = useBlueprints(pinTab ? projectId : null)
  const { pins } = useProjectPins(pinTab ? projectId : null)
  const items = useProjectWorkItems(projectId, tab === "checklist")
  const range = photoRangeOf(dates, today)

  const workPins = useMemo(() => pins.filter((pin) => pin.category !== "note"), [pins])
  const sheetOfPin = useMemo(() => new Map(workPins.map((pin) => [pin.id, pin.blueprint_id])), [workPins])
  const pinTitle = useMemo(() => new Map(workPins.map((pin) => [pin.id, pin.title])), [workPins])

  useEffect(() => {
    const change = () => { setTab(readPhotoTab()); setDates(readPhotoDates(window.location.search)); setScope(readPhotoScope(window.location.search)) }
    window.addEventListener("popstate", change)
    return () => window.removeEventListener("popstate", change)
  }, [])
  const writeUrl = (nextTab: PhotoTab, value: PhotoDates, nextScope: PhotoScope) => {
    const url = new URL(window.location.href)
    url.searchParams.set("tab", nextTab)
    const params: Array<[string, string]> = [["from", value.from], ["to", value.to], ["sheet", nextScope.sheet], ["pin", nextScope.pin], ["item", nextScope.item]]
    for (const [key, val] of params) {
      if (val) url.searchParams.set(key, val)
      else url.searchParams.delete(key)
    }
    window.history.replaceState({}, "", url)
  }
  const choose = (value: PhotoTab) => {
    const next = defaultPhotoDates(value, today)
    setTab(value); setDates(next); setPicking(false); writeUrl(value, next, scope)
  }
  const filterDates = (value: PhotoDates) => { setDates(value); writeUrl(tab, value, scope) }
  const pickRange = (value: PhotoRange | "custom") => {
    if (value === "custom") return setPicking(true)
    setPicking(false)
    filterDates(photoRangeDates(value, today))
  }
  const filterScope = (key: keyof PhotoScope, value: string) => {
    const next = changePhotoScope(scope, key, value, (id) => sheetOfPin.get(id))
    setScope(next); writeUrl(tab, dates, next)
  }
  const clearScope = () => { setScope(emptyPhotoScope); writeUrl(tab, dates, emptyPhotoScope) }

  const showing = range === "all" ? "all dates"
    : range === "today" ? `today, ${reportDateLong(today)}`
    : range === "yesterday" ? "yesterday"
    : range === "week" ? "the last 7 days"
    : range === "month" ? "this month"
    : [dates.from ? reportDateLong(dates.from) : "the start", dates.to ? reportDateLong(dates.to) : "today"].join(" to ")
  const where = [scope.sheet && pinTab ? blueprints.find((sheet) => sheet.id === scope.sheet)?.title : "", scope.pin && pinTab ? pinTitle.get(scope.pin) : "",
    scope.item && pinTab ? items.find((item) => item.id === scope.item)?.text : ""].filter(Boolean).join(" → ")

  return <div className="foreman-page">
    <ProjectContextBar listPath="/foreman/projects" listLabel="My projects" />
    <PageHead eyebrow="Evidence" title="Photo documentation" description="Daily report and task photos of this project, by date, sheet, pin and task. Open a photo to see its details and linked work."
      actions={<button type="button" className="rounded-lg bg-brand px-4 py-2 text-sm font-bold text-white hover:bg-brand-hover" onClick={() => onNavigate("dashboard")}>Go to my work</button>} />
    {projectId ? <>
      <div className="mb-3 space-y-3 rounded-2xl border border-line bg-surface p-3 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-wrap gap-0.5 rounded-xl bg-surface-muted p-1" role="tablist" aria-label="Kind of photo">
            {photoTabs.map(([key, name]) => <button key={key} id={`photo-tab-${key}`} aria-controls="photo-panel" type="button" role="tab" aria-selected={tab === key} onClick={() => choose(key)} className={pill(tab === key)}>{name}</button>)}
          </div>
          <label className={`${label} w-full sm:w-48`}>Upload date
            <select className={select} value={picking ? "custom" : range} onChange={(event) => pickRange(event.target.value as PhotoRange | "custom")}>
              {photoRanges.map(([key, name]) => <option key={key} value={key}>{name}</option>)}
              <option value="custom">Pick dates…</option>
            </select>
          </label>
        </div>
        {picking || range === "custom" ? <div className="flex flex-wrap items-end gap-3 border-t border-line pt-3">
          <label className={label}>From<input type="date" value={dates.from} max={dates.to || today} onChange={(e) => filterDates({ ...dates, from: e.target.value })} className={`${select} !w-auto`} /></label>
          <label className={label}>To<input type="date" value={dates.to} min={dates.from || undefined} max={today} onChange={(e) => filterDates({ ...dates, to: e.target.value })} className={`${select} !w-auto`} /></label>
          {picking ? <button type="button" className={buttonSecondary + " !py-1.5"} onClick={() => setPicking(false)}>Done</button> : null}
        </div> : null}
        {pinTab ? <div className="border-t border-line pt-3"><WorkFilters label="Filter photos" sheets={blueprints} pins={pins} items={items} scope={scope} onChange={filterScope} onClear={clearScope} /></div> : null}
      </div>
      <p className="mb-3 text-xs text-fg-muted"><span className="font-bold text-fg">Showing {showing}{where ? ` · ${where}` : ""}</span> · Manila time · newest 200. {tabHint[tab]}</p>
      <div role="tabpanel" id="photo-panel" aria-labelledby={`photo-tab-${tab}`}>
        {error ? <p role="alert" className="text-danger-fg">{error} <button type="button" className="min-h-6 underline" onClick={() => void reload()}>Retry</button></p>
          : <PhotoGrid key={`${projectId}:${tab}:${dates.from}:${dates.to}:${scope.sheet}:${scope.pin}:${scope.item}`} photos={photos.map((photo) => ({ ...photo, uploaderName: team.find((person) => person.user_id === photo.uploaded_by)?.full_name }))} bucket={tab === "daily" ? "daily-photos" : "pin-photos"} loading={loading}
              emptyHint={`No ${photoTabs.find(([key]) => key === tab)?.[1].toLowerCase()} photos for ${showing}${where ? ` on ${where}` : ""}. Try another date or filter.`} />}
      </div>
    </> : null}
  </div>
}
