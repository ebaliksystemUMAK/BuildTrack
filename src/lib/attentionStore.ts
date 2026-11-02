// One shared set of "waiting for an administrator" counts, so the sidebar badge and the dashboard read the same numbers from ONE request set
// (not one per menu item, not one per component). No Supabase import: the fetcher is passed in, which keeps this testable in Node.

export type AttentionCounts = { registrations: number; ids: number; erasures: number; requests: number }

export type AttentionStore = {
  get: () => AttentionCounts | null
  subscribe: (listener: () => void) => () => void
  refresh: () => Promise<void>
}

export function createAttentionStore(
  fetchCounts: () => Promise<AttentionCounts>,
  options: { intervalMs?: number; isVisible?: () => boolean; setTimer?: (run: () => void, ms: number) => unknown; clearTimer?: (id: unknown) => void } = {},
): AttentionStore {
  const intervalMs = options.intervalMs ?? 60_000
  const isVisible = options.isVisible ?? (() => true)
  const setTimer = options.setTimer ?? ((run, ms) => setInterval(run, ms))
  const clearTimer = options.clearTimer ?? ((id) => clearInterval(id as ReturnType<typeof setInterval>))
  const listeners = new Set<() => void>()
  let data: AttentionCounts | null = null
  let inFlight: Promise<void> | null = null
  let timer: unknown = null

  const refresh = () => {
    // Callers that ask while a request is running share it.
    if (inFlight) return inFlight
    inFlight = fetchCounts()
      .then((next) => {
        data = next
        listeners.forEach((listener) => listener())
      })
      // A failed read keeps the last good numbers instead of turning into zeros that look real.
      .catch(() => undefined)
      .finally(() => { inFlight = null })
    return inFlight
  }

  return {
    get: () => data,
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

// ---------- Pure counts for the Admin overview ----------
export type ProjectLike = { id: string; status: string; archived_at?: string | null }
export type ManagerLike = { project_id: string; designation: string; active: boolean }

export const isOpenProject = (project: ProjectLike) => project.status !== "completed" && project.status !== "cancelled" && !project.archived_at

// Open projects that have no active primary Project Manager (an Admin appoints one; team and access are then managed by that person).
export function projectsWithoutPrimaryManager<P extends ProjectLike>(projects: P[], managers: ManagerLike[]): P[] {
  const covered = new Set(managers.filter((manager) => manager.designation === "primary" && manager.active).map((manager) => manager.project_id))
  return projects.filter((project) => isOpenProject(project) && !covered.has(project.id))
}

// The number on the User management menu item: everything that waits for an administrator's decision, in one figure that matches the dashboard band.
export const decisionTotal = (counts: AttentionCounts | null) => (counts ? counts.registrations + counts.ids + counts.erasures + counts.requests : 0)
