// A small shared poller: several components read one value that is refreshed on a timer, so the page costs one request set, not one per component.
// No Supabase import: the fetcher is passed in, which keeps it testable in Node.
export type PollingStore<T> = { get: () => T | null; subscribe: (listener: () => void) => () => void; refresh: () => Promise<void> }

export function createPollingStore<T>(
  fetchValue: () => Promise<T | null>,
  options: { intervalMs?: number; isVisible?: () => boolean; setTimer?: (run: () => void, ms: number) => unknown; clearTimer?: (id: unknown) => void } = {},
): PollingStore<T> {
  const intervalMs = options.intervalMs ?? 30_000
  const isVisible = options.isVisible ?? (() => true)
  const setTimer = options.setTimer ?? ((run, ms) => setInterval(run, ms))
  const clearTimer = options.clearTimer ?? ((id) => clearInterval(id as ReturnType<typeof setInterval>))
  const listeners = new Set<() => void>()
  let value: T | null = null
  let inFlight: Promise<void> | null = null
  let timer: unknown = null

  const refresh = () => {
    if (inFlight) return inFlight // callers that ask while a request runs share it
    inFlight = fetchValue()
      .then((next) => {
        // A failed or unreadable answer keeps the last good value: a network blip must not remove a notice that was showing.
        if (next !== null) {
          value = next
          listeners.forEach((listener) => listener())
        }
      })
      .catch(() => undefined)
      .finally(() => { inFlight = null })
    return inFlight
  }

  return {
    get: () => value,
    refresh,
    subscribe(listener) {
      listeners.add(listener)
      if (listeners.size === 1) {
        void refresh()
        timer = setTimer(() => { if (isVisible()) void refresh() }, intervalMs)
      }
      return () => {
        listeners.delete(listener)
        if (listeners.size === 0 && timer !== null) {
          clearTimer(timer)
          timer = null
        }
      }
    },
  }
}
