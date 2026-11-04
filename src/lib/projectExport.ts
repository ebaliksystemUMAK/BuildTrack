import { supabase } from "./supabase"
import { buildZip, textBytes, type ZipEntry } from "./zipWriter"

// Everything about one project as a single ZIP: the data as JSON (one file per table) and, optionally, the files (plan sheets,
// pictures on sheets, pin photos) under the same paths they have in storage. Built in the admin's browser from what that admin may read;
// the database only records that it happened (log_project_export). See docs/BUILDTRACK_BACKUP_RESTORE.md for putting it back.

export const EXPORT_TABLES = ["project_members", "blueprints", "blueprint_revisions", "pins", "pin_events", "pin_checklist_items", "pin_photos", "blueprint_annotations", "daily_reports", "daily_report_entries", "daily_report_photos", "project_questions", "qa_inspections", "qa_inspection_items", "qa_defects", "qa_defect_events", "qa_photos", "pin_qa_submissions"] as const
const REVIEW_EXPORT_TABLES = ["daily_report_revisions", "biometric_daily_totals", "qa_work_attempts", "qa_inspection_events"]
const MAX_FILE_BYTES = 450 * 1024 * 1024 // keeps the archive inside what a browser tab can hold

export type ExportProgress = { step: string; done: number; total: number }
export type ExportResult = { blob: Blob; filename: string; rows: number; files: number; missing: string[]; skippedForSize: number }

type Row = Record<string, unknown>

async function fetchAll(table: string, column: string, value: string): Promise<Row[]> {
  const rows: Row[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from(table).select("*").eq(column, value).order(table === "project_members" ? "user_id" : "id", { ascending: true }).range(from, from + 999)
    if (error) throw new Error(`Could not read ${table}: ${error.message}`)
    rows.push(...((data as Row[] | null) ?? []))
    if (!data || data.length < 1000) break
  }
  return rows
}

const json = (value: unknown) => textBytes(JSON.stringify(value, null, 2))
const safe = (text: string) => text.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "project"

export function backupReadme(project: { code: string; name: string }, exportedAt: string, withFiles: boolean) {
  return [
    `BuildTrack backup: ${project.name} (${project.code})`,
    `Exported: ${exportedAt}`,
    "",
    "WHAT IS INSIDE",
    "data/project.json          the project row",
    "data/<table>.json          one file per table (members, sheets, revisions, pins, timeline, checklists, photos, drawings, daily reports and their task entries, client questions)",
    "data/team.json             names and roles of the team at the time of the backup",
    "data/manifest.json         counts, file list and anything that could not be included",
    withFiles ? "files/<bucket>/...       the plan files, pictures and photos, under the same paths they have in storage" : "(files were not included in this backup)",
    "",
    "HOW TO RESTORE",
    "See docs/BUILDTRACK_BACKUP_RESTORE.md in the BuildTrack repository. In short: insert the rows back with jsonb_populate_recordset (parents first),",
    "then upload the files to the same bucket and path. The backup holds project data only, not user accounts or passwords.",
    "",
    "Keep this file private: it contains the project's plans, photos and the names of its team.",
  ].join("\n")
}

export async function exportProject(projectId: string, options: { withFiles: boolean; onProgress?: (progress: ExportProgress) => void; cancel?: { cancelled: boolean } }): Promise<ExportResult> {
  const report = options.onProgress ?? (() => undefined)
  const stopped = () => {
    if (options.cancel?.cancelled) throw new Error("The backup was cancelled.")
  }
  const { data: project, error: projectError } = await supabase.from("projects").select("*").eq("id", projectId).maybeSingle()
  if (projectError || !project) throw new Error("The project could not be read. You may not have access to it.")

  const entries: ZipEntry[] = []
  const counts: Record<string, number> = {}
  let rows = 1
  entries.push({ name: "data/project.json", data: json(project) })

  const tables: Record<string, Row[]> = {}
  for (let index = 0; index < EXPORT_TABLES.length; index += 1) {
    stopped()
    const table = EXPORT_TABLES[index]
    report({ step: `Reading ${table.replace(/_/g, " ")}`, done: index, total: EXPORT_TABLES.length })
    tables[table] = await fetchAll(table, "project_id", projectId)
    counts[table] = tables[table].length
    rows += tables[table].length
    entries.push({ name: `data/${table}.json`, data: json(tables[table]) })
  }
  const { data: team } = await supabase.rpc("get_project_team", { pid: projectId })
  for (const table of REVIEW_EXPORT_TABLES) {
    const records = await fetchAll(table, "project_id", projectId)
    counts[table] = records.length
    rows += records.length
    entries.push({ name: `data/${table}.json`, data: json(records) })
  }
  entries.push({ name: "data/team.json", data: json(team ?? []) })

  const files: Array<{ bucket: "blueprints" | "pin-photos" | "qa-evidence" | "daily-photos"; path: string }> = []
  const missing: string[] = []
  let skippedForSize = 0
  let fileBytes = 0
  const downloaded: Array<{ path: string; bytes: number }> = []
  if (options.withFiles) {
    const seen = new Set<string>()
    const add = (bucket: "blueprints" | "pin-photos" | "qa-evidence" | "daily-photos", path: unknown) => {
      if (typeof path !== "string" || !path) return
      const key = `${bucket}/${path}`
      if (!seen.has(key)) {
        seen.add(key)
        files.push({ bucket, path })
      }
    }
    for (const revision of tables.blueprint_revisions) {
      add("blueprints", revision.file_path)
      add("blueprints", revision.preview_path)
      add("blueprints", revision.thumb_path)
    }
    for (const annotation of tables.blueprint_annotations) add("blueprints", annotation.image_path)
    for (const photo of tables.pin_photos) add("pin-photos", photo.path)
    for (const photo of tables.daily_report_photos) add("daily-photos", photo.path)
    for (const photo of tables.qa_photos) add("qa-evidence", photo.path)

    for (let index = 0; index < files.length; index += 1) {
      stopped()
      const { bucket, path } = files[index]
      report({ step: `Downloading files (${index + 1} of ${files.length})`, done: index, total: files.length })
      const { data, error } = await supabase.storage.from(bucket).download(path)
      if (error || !data) {
        missing.push(`${bucket}/${path}`)
        continue
      }
      if (fileBytes + data.size > MAX_FILE_BYTES) {
        skippedForSize += 1
        missing.push(`${bucket}/${path} (left out: the backup would be too large for the browser)`)
        continue
      }
      fileBytes += data.size
      entries.push({ name: `files/${bucket}/${path}`, data: new Uint8Array(await data.arrayBuffer()) })
      downloaded.push({ path: `files/${bucket}/${path}`, bytes: data.size })
    }
  }

  stopped()
  report({ step: "Packing the archive", done: 1, total: 1 })
  const exportedAt = new Date().toISOString()
  const info = project as { code: string; name: string }
  entries.unshift({ name: "README.txt", data: textBytes(backupReadme(info, exportedAt, options.withFiles)) })
  entries.push({ name: "data/manifest.json", data: json({ format: 1, exported_at: exportedAt, project: { id: projectId, code: info.code, name: info.name }, counts, files: downloaded, missing, with_files: options.withFiles }) })
  const zip = buildZip(entries)
  return {
    blob: new Blob([zip as BlobPart], { type: "application/zip" }),
    filename: `buildtrack-${safe(info.code)}-backup-${exportedAt.slice(0, 10)}${options.withFiles ? "" : "-data-only"}.zip`,
    rows,
    files: downloaded.length,
    missing,
    skippedForSize,
  }
}
