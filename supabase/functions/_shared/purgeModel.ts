// Pure rules for the permanent project deletion function (no Deno or network APIs here, so they are unit-tested in Node by `pnpm test:recycle-bin`):
// who may use it, the phrase that must be typed, and how the file list is handled. The database decides again whether a project may be deleted at all.

export const PURGE_BUCKET = "blueprints" // the only private bucket a deletable project can hold files in (it may hold no photos, reports or QA evidence)
export const MAX_PURGE_FILES = 5000
export const PURGE_CHUNK = 100

export const purgePhrase = (code: string) => `DELETE FOREVER ${code}`

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const isUuid = (value: unknown): value is string => typeof value === "string" && uuid.test(value)

// A Super Admin whose session passed the authenticator (requireCaller already enforced the session and the active account), and a well-formed request.
export function authorizePurge(role: string | null | undefined, body: unknown): { ok: true; projectId: string; confirm: string } | { ok: false; status: number; message: string } {
  const value = body && typeof body === "object" ? (body as Record<string, unknown>) : {}
  if (role !== "super_admin") return { ok: false, status: 403, message: "Only a Super Admin can permanently delete a project" }
  if (!isUuid(value.project_id)) return { ok: false, status: 400, message: "Missing project" }
  if (typeof value.confirm !== "string" || value.confirm.length > 100) return { ok: false, status: 400, message: "Type the confirmation phrase" }
  return { ok: true, projectId: value.project_id, confirm: value.confirm }
}

export function chunk<T>(items: T[], size: number): T[][] {
  const parts: T[][] = []
  for (let index = 0; index < items.length; index += size) parts.push(items.slice(index, index + size))
  return parts
}

// Storage listings return files (with an id) and folders (without one). Only paths inside the project's own folder are ever returned.
export type StorageEntry = { name: string; id?: string | null }
export function splitEntries(prefix: string, entries: StorageEntry[]): { files: string[]; folders: string[] } {
  const files: string[] = []
  const folders: string[] = []
  for (const entry of entries) {
    if (!entry?.name || entry.name.includes("..") || entry.name.includes("/")) continue
    const path = `${prefix}/${entry.name}`
    if (entry.id) files.push(path)
    else folders.push(path)
  }
  return { files, folders }
}
