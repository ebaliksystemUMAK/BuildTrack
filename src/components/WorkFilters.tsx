import { useMemo } from "react"
import { buttonSecondary, inputClass } from "./ui/PageParts"
import type { PhotoScope } from "../lib/photoGalleryModel"

const select = `${inputClass} mt-1 !py-1.5`
const label = "min-w-[10rem] flex-1 text-xs font-bold text-fg-muted"

export type FilterSheet = { id: string; title: string; level?: string | null }
export type FilterPin = { id: string; title: string; blueprint_id: string; category?: string }
export type FilterItem = { id: string; pin_id: string; text: string; position: number }

// One filter bar used everywhere (photo pages, pin panel, QA boards): Sheet → Pin → Checklist item, then Clear filters.
// Narrower choices follow the wider ones (rules in changePhotoScope). Fields share a row when there is room and wrap otherwise.
export default function WorkFilters({ sheets, pins, items, scope, onChange, onClear, canClear, label: groupLabel = "Filters", showSheet = true, showPin = true, showItem = true, itemLabel = "Task" }: {
  sheets: FilterSheet[]; pins: FilterPin[]; items: FilterItem[]; scope: PhotoScope
  onChange: (key: keyof PhotoScope, value: string) => void; onClear: () => void; canClear?: boolean; label?: string
  showSheet?: boolean; showPin?: boolean; showItem?: boolean; itemLabel?: string
}) {
  const work = useMemo(() => pins.filter((pin) => pin.category !== "note"), [pins])
  const pinTitle = useMemo(() => new Map(work.map((pin) => [pin.id, pin.title])), [work])
  const sheetOfPin = useMemo(() => new Map(work.map((pin) => [pin.id, pin.blueprint_id])), [work])
  const pinChoices = work.filter((pin) => !scope.sheet || pin.blueprint_id === scope.sheet).sort((a, b) => a.title.localeCompare(b.title))
  const itemChoices = items.filter((item) => (scope.pin ? item.pin_id === scope.pin : !scope.sheet || sheetOfPin.get(item.pin_id) === scope.sheet))
    .sort((a, b) => (pinTitle.get(a.pin_id) ?? "").localeCompare(pinTitle.get(b.pin_id) ?? "") || a.position - b.position)
  return (
    <div className="flex flex-wrap items-end gap-3" role="group" aria-label={groupLabel}>
      {showSheet ? <label className={label}>Sheet
        <select className={select} value={scope.sheet} onChange={(event) => onChange("sheet", event.target.value)}>
          <option value="">All sheets</option>
          {sheets.map((sheet) => <option key={sheet.id} value={sheet.id}>{sheet.title}{sheet.level ? ` (${sheet.level})` : ""}</option>)}
        </select>
      </label> : null}
      {showPin ? <label className={label}>Pin
        <select className={select} value={scope.pin} onChange={(event) => onChange("pin", event.target.value)}>
          <option value="">{scope.sheet ? "All pins on this sheet" : "All pins"}</option>
          {pinChoices.map((pin) => <option key={pin.id} value={pin.id}>{pin.title}</option>)}
        </select>
      </label> : null}
      {showItem ? <label className={label}>{itemLabel}
        <select className={select} value={scope.item} onChange={(event) => onChange("item", event.target.value)}>
          <option value="">All {itemLabel.toLowerCase()}s</option>
          {itemChoices.map((item) => <option key={item.id} value={item.id}>{scope.pin ? item.text : `${pinTitle.get(item.pin_id) ?? "Pin"} → ${item.text}`}</option>)}
        </select>
      </label> : null}
      {(showSheet || showPin || showItem) ? <button type="button" className={buttonSecondary + " !py-1.5"} disabled={!(canClear ?? Boolean(scope.sheet || scope.pin || scope.item))} onClick={onClear}>Clear filters</button> : null}
    </div>
  )
}
