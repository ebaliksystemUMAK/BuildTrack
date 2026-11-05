export type BrowserDraft<S, V> = { version: 1; scope: S; revision: string; values: V }
export type BrowserDraftResult<S, V> = { draft: BrowserDraft<S, V> | null; persistent: boolean }
const pending = new Map<string, { draft: BrowserDraft<unknown, unknown>; baseRevision: string | null }>()
const MAX_DRAFT_CHARS = 2000000
let listening = false
const beforeUnload = (event: BeforeUnloadEvent) => {
  if (!pending.size) return
  event.preventDefault()
  event.returnValue = ""
}
const updateUnloadGuard = () => {
  if (typeof window === "undefined") return
  if (pending.size && !listening) { window.addEventListener("beforeunload", beforeUnload); listening = true }
  if (!pending.size && listening) { window.removeEventListener("beforeunload", beforeUnload); listening = false }
}

// Both task and QC checklist drafts use this storage lifecycle, including fallback and revision-safe cleanup.
export function createBrowserDraftStore<S, V>(keyOf: (scope: S) => string, valuesFrom: (value: unknown) => V | null) {
  const decode = (raw: string | null, scope: S): BrowserDraft<S, V> | null => {
    if (!raw || raw.length > MAX_DRAFT_CHARS) return null
    const value = JSON.parse(raw) as BrowserDraft<S, V>
    if (value?.version !== 1 || !value.scope || keyOf(value.scope) !== keyOf(scope) || typeof value.revision !== "string" || !value.revision || value.revision.length > 100) return null
    const values = valuesFrom(value.values)
    return values ? { version: 1, scope, revision: value.revision, values } : null
  }
  const load = (scope: S): BrowserDraftResult<S, V> => {
    const memory = pending.get(keyOf(scope))
    if (memory) return { draft: memory.draft as BrowserDraft<S, V>, persistent: false }
    try { return { draft: decode(localStorage.getItem(keyOf(scope)), scope), persistent: true } }
    catch { return { draft: null, persistent: false } }
  }
  const store = (scope: S, values: V): BrowserDraftResult<S, V> => {
    const key = keyOf(scope), prior = pending.get(key)
    let baseRevision = prior?.baseRevision ?? null
    if (!prior) { try { baseRevision = decode(localStorage.getItem(key), scope)?.revision ?? null } catch { /* storage is unavailable */ } }
    const draft: BrowserDraft<S, V> = { version: 1, scope, revision: crypto.randomUUID(), values }
    try {
      const raw = JSON.stringify(draft)
      if (raw.length > MAX_DRAFT_CHARS) throw new Error("The draft is too large for browser storage")
      localStorage.setItem(key, raw)
      pending.delete(key); updateUnloadGuard()
      return { draft, persistent: true }
    } catch {
      pending.set(key, { draft, baseRevision }); updateUnloadGuard()
      return { draft, persistent: false }
    }
  }
  const clear = (scope: S, revision: string | null): boolean => {
    if (!revision) return true
    const key = keyOf(scope), memory = pending.get(key)
    if (memory && memory.draft.revision !== revision) return true
    try {
      const disk = decode(localStorage.getItem(key), scope)
      if (disk && disk.revision === (memory ? memory.baseRevision : revision)) localStorage.removeItem(key)
      pending.delete(key); updateUnloadGuard()
      return true
    } catch { return false }
  }
  return { load, store, clear }
}
