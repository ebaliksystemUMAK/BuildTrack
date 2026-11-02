import { audit, corsHeaders, HttpError, json, requireCaller, type Caller } from "../_shared/guard.ts"
import { MAX_PURGE_FILES, PURGE_BUCKET, PURGE_CHUNK, authorizePurge, chunk, purgePhrase, splitEntries } from "../_shared/purgeModel.ts"

// Permanent deletion of a project that is in the recycle bin (verify_jwt stays ON). Only a Super Admin whose session passed the authenticator may call it.
// The database decides whether the project may be deleted at all (30 days in the bin, no evidence, work, QA, reports, photos or attendance); this function
// then deletes it and removes the project's plan files from storage. The files are listed BEFORE the rows go and removed AFTER, so a failure can only leave
// harmless unused files, never a project whose files are gone.

async function listFiles(caller: Caller, prefix: string, depth = 0): Promise<string[]> {
  if (depth > 4) return []
  const files: string[] = []
  for (let offset = 0; ; offset += 100) {
    const { data, error } = await caller.admin.storage.from(PURGE_BUCKET).list(prefix, { limit: 100, offset })
    if (error) throw new HttpError(500, "The project's files could not be listed, so nothing was deleted")
    const { files: here, folders } = splitEntries(prefix, data ?? [])
    files.push(...here)
    for (const folder of folders) files.push(...(await listFiles(caller, folder, depth + 1)))
    if (files.length > MAX_PURGE_FILES) throw new HttpError(409, "This project has too many files to delete here. Nothing was deleted")
    if (!data || data.length < 100) break
  }
  return files
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })
  try {
    const caller = await requireCaller(req) // signed in, active, Admin or Super Admin, authenticator verified
    const body = await req.json().catch(() => ({}))
    const decision = authorizePurge(caller.role, body)
    if (!decision.ok) throw new HttpError(decision.status, decision.message)

    const { data: check, error: checkError } = await caller.admin.rpc("project_purge_check", { p_project: decision.projectId })
    if (checkError || !check) throw new HttpError(500, "The project could not be checked, so nothing was deleted")
    if (!check.ok) throw new HttpError(409, `This project cannot be deleted forever: ${(check.reasons as string[]).join("; ")}`)
    if (decision.confirm !== purgePhrase(String(check.code))) throw new HttpError(400, `Type ${purgePhrase(String(check.code))} exactly to confirm`)

    const files = await listFiles(caller, decision.projectId)
    const { data: done, error: purgeError } = await caller.admin.rpc("purge_project_rows", { p_project: decision.projectId, p_actor: caller.id })
    if (purgeError || !done) throw new HttpError(409, (purgeError?.message ?? "The project could not be deleted").replace(/^.*?(This project[^"]*|Only a Super Admin[^"]*)$/, "$1").slice(0, 300))

    let removed = 0
    let failed = 0
    for (const part of chunk(files, PURGE_CHUNK)) {
      const { error } = await caller.admin.storage.from(PURGE_BUCKET).remove(part)
      if (error) failed += part.length
      else removed += part.length
    }
    await audit(caller, "project.purge_files", null, { project_id: decision.projectId, code: check.code, files_found: files.length, files_removed: removed, files_failed: failed })
    return json({ purged: true, code: check.code, files_removed: removed, files_failed: failed })
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.message }, err.status)
    console.error(err)
    return json({ error: "Server error" }, 500)
  }
})
