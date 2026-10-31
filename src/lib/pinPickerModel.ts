// The sheet -> pin -> checklist item choice used by every form that links a record to the blueprint. Pure, tested in `pnpm test:lib`.
// Only work pins of the form's project are offered; changing a wider choice clears the narrower ones that no longer fit.
// An empty pin means "Project-wide", which only some records allow (an NCR, a client report); location records require a pin.

export type PinLink = { sheetId: string; pinId: string; itemId: string }
export const emptyPinLink: PinLink = { sheetId: "", pinId: "", itemId: "" }
export type PickPin = { id: string; title: string; blueprint_id: string; project_id: string; category?: string; description?: string | null }
export type PickItem = { id: string; pin_id: string; text: string; position?: number }
export type PickSheet = { id: string; title: string; level?: string | null; project_id?: string }

const words = (value: string) => value.toLowerCase().split(/\s+/).filter(Boolean)
const matches = (query: string, ...fields: Array<string | null | undefined>) => {
  const haystack = fields.filter(Boolean).join(" ").toLowerCase()
  return words(query).every((word) => haystack.includes(word))
}

// Work pins of this project on the chosen sheet that match the search (title, description or sheet name), A to Z.
export function pinChoices(pins: PickPin[], input: { projectId: string; sheetId: string; query: string; sheetTitle?: (id: string) => string }): PickPin[] {
  return pins
    .filter((pin) => pin.project_id === input.projectId && pin.category !== "note" && (!input.sheetId || pin.blueprint_id === input.sheetId))
    .filter((pin) => !input.query.trim() || matches(input.query, pin.title, pin.description, input.sheetTitle?.(pin.blueprint_id)))
    .sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id))
}
export const itemChoices = (items: PickItem[], pinId: string): PickItem[] =>
  pinId ? items.filter((item) => item.pin_id === pinId).sort((a, b) => (a.position ?? 0) - (b.position ?? 0) || a.text.localeCompare(b.text)) : []

// A sheet clears a pin that is not on it; a pin sets its own sheet and clears the item; an item must belong to the pin.
export function changePinLink(link: PinLink, key: keyof PinLink, value: string, pins: PickPin[], items: PickItem[]): PinLink {
  if (key === "sheetId") {
    const pin = pins.find((row) => row.id === link.pinId)
    return pin && pin.blueprint_id === value ? { ...link, sheetId: value } : { sheetId: value, pinId: "", itemId: "" }
  }
  if (key === "pinId") {
    if (!value) return { ...link, pinId: "", itemId: "" }
    const pin = pins.find((row) => row.id === value)
    return pin ? { sheetId: pin.blueprint_id, pinId: value, itemId: "" } : link
  }
  if (!value) return { ...link, itemId: "" }
  return items.some((item) => item.id === value && item.pin_id === link.pinId) ? { ...link, itemId: value } : link
}

// A link that starts on a known pin (opened from a pin panel): its sheet and pin are already chosen.
export function startPinLink(pins: PickPin[], pinId?: string | null, itemId?: string | null): PinLink {
  const pin = pinId ? pins.find((row) => row.id === pinId) : undefined
  return pin ? { sheetId: pin.blueprint_id, pinId: pin.id, itemId: itemId ?? "" } : emptyPinLink
}

// Why the link cannot be saved yet ("" = fine). The database checks the same again.
// waitForChecklist: also wait while the chosen pin's checklist is loading or failed, so an item is never skipped by accident.
export function pinLinkProblem(link: PinLink, input: { projectId: string; pins: PickPin[]; items: PickItem[]; requirePin: boolean; itemsLoading?: boolean; itemsError?: string; waitForChecklist?: boolean }): string {
  if (!link.pinId) return input.requirePin ? "Choose the work pin this record belongs to." : ""
  const pin = input.pins.find((row) => row.id === link.pinId)
  if (!pin || pin.project_id !== input.projectId || pin.category === "note") return "Choose a work pin from this project."
  if (link.sheetId && pin.blueprint_id !== link.sheetId) return "The chosen pin is not on the chosen sheet."
  if (!link.itemId && !input.waitForChecklist) return ""
  if (input.itemsLoading) return "Loading this pin's tasks…"
  if (input.itemsError) return "Could not load this pin's tasks. Retry before saving."
  return !link.itemId || input.items.some((item) => item.id === link.itemId && item.pin_id === link.pinId) ? "" : "Choose a task of this work pin."
}
