import { useId, useState } from "react"
import { inputClass } from "./PageParts"
import { changePinLink, itemChoices, pinChoices, type PickItem, type PickPin, type PickSheet, type PinLink } from "../../lib/pinPickerModel"

const field = `${inputClass} mt-1 !text-sm !font-normal !normal-case !tracking-normal`
const label = "block min-w-0 text-xs font-extrabold uppercase tracking-wider text-fg-muted"

// Where a record belongs on the blueprint: sheet -> searchable work pin -> optional checklist item, all of the form's project.
// Changing a wider choice clears narrower ones that no longer fit (rules in pinPickerModel). "Project-wide" exists only when
// the record may apply to the whole project; a location record must name its pin. The checklist comes from the caller
// (`useChecklist(link.pinId)`), which also validates with `pinLinkProblem` before saving.
export default function PinLinkPicker({ projectId, sheets, pins, value, onChange, checklist, allowProjectWide = false, showItem = true, disabled = false, pinLabel = "Work pin" }: {
  projectId: string
  sheets: PickSheet[]
  pins: PickPin[]
  value: PinLink
  onChange: (link: PinLink) => void
  checklist?: { items: PickItem[]; loading: boolean; error: string; reload?: () => void | Promise<void> }
  allowProjectWide?: boolean
  showItem?: boolean
  disabled?: boolean
  pinLabel?: string
}) {
  const id = useId().replace(/:/g, "")
  const [query, setQuery] = useState("")
  const items = checklist?.items ?? []
  const sheetTitle = (sheetId: string) => sheets.find((sheet) => sheet.id === sheetId)?.title ?? "Sheet"
  const projectSheets = sheets.filter((sheet) => !sheet.project_id || sheet.project_id === projectId)
  const choices = pinChoices(pins, { projectId, sheetId: value.sheetId, query, sheetTitle })
  const selected = pins.find((pin) => pin.id === value.pinId)
  const shown = selected && !choices.some((pin) => pin.id === selected.id) ? [selected, ...choices] : choices
  const total = pinChoices(pins, { projectId, sheetId: value.sheetId, query: "" }).length
  const change = (key: keyof PinLink, next: string) => onChange(changePinLink(value, key, next, pins, items))
  const pinItems = itemChoices(items, value.pinId)

  return (
    <fieldset disabled={disabled} className="grid min-w-0 gap-3 rounded-xl border border-line bg-surface-muted/40 p-3 sm:grid-cols-2">
      <legend className="px-1 text-xs font-extrabold uppercase tracking-wider text-brand-text">Where on the blueprint</legend>
      <label className={label} htmlFor={`${id}-sheet`}>Sheet
        <select id={`${id}-sheet`} className={field} value={value.sheetId} onChange={(event) => change("sheetId", event.target.value)}>
          <option value="">All sheets</option>
          {projectSheets.map((sheet) => <option key={sheet.id} value={sheet.id}>{sheet.title}{sheet.level ? ` (${sheet.level})` : ""}</option>)}
        </select>
      </label>
      <label className={label} htmlFor={`${id}-find`}>Find a pin
        <input id={`${id}-find`} type="search" className={field} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Pin name, description or sheet" autoComplete="off" />
      </label>
      <label className={`${label} sm:col-span-2`} htmlFor={`${id}-pin`}>{pinLabel}{allowProjectWide ? "" : " *"}
        <select id={`${id}-pin`} className={field} value={value.pinId} onChange={(event) => change("pinId", event.target.value)} aria-describedby={`${id}-count`}>
          {allowProjectWide ? <option value="">Project-wide (not one pin)</option> : <option value="" disabled>Choose a work pin</option>}
          {shown.map((pin) => <option key={pin.id} value={pin.id}>{pin.title} · {sheetTitle(pin.blueprint_id)}</option>)}
        </select>
        <span id={`${id}-count`} className="mt-1 block text-[11px] font-semibold normal-case tracking-normal text-fg-muted">
          {query.trim() ? `${choices.length} of ${total} pins match "${query.trim()}"` : `${total} work pin${total === 1 ? "" : "s"}${value.sheetId ? " on this sheet" : " in this project"}`}
        </span>
      </label>
      {showItem ? (
        <label className={`${label} sm:col-span-2`} htmlFor={`${id}-item`}>Task
          <select id={`${id}-item`} className={field} value={value.itemId} disabled={!value.pinId || checklist?.loading || Boolean(checklist?.error)} onChange={(event) => change("itemId", event.target.value)}>
            <option value="">{value.pinId ? "Whole work pin (no specific item)" : "Choose a pin first"}</option>
            {pinItems.map((item) => <option key={item.id} value={item.id}>{item.text}</option>)}
          </select>
          {checklist?.error && value.pinId ? <span role="alert" className="mt-1 block text-[11px] normal-case tracking-normal text-danger-fg">{checklist.error} {checklist.reload ? <button type="button" className="font-bold underline" onClick={() => void checklist.reload?.()}>Retry</button> : null}</span>
            : value.pinId && !checklist?.loading && !pinItems.length ? <span className="mt-1 block text-[11px] font-semibold normal-case tracking-normal text-fg-muted">This pin has no tasks yet.</span> : null}
        </label>
      ) : null}
    </fieldset>
  )
}
