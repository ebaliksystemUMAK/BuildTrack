// The decisions of the `account-control` Edge Function (Super Admin only): look at what deleting an account would do, then delete it.
// Everything it talks to is passed in, so a test can run every path without Deno, a database or a real authenticator. index.ts only wires the real ones in.
//
// Deleting an account never deletes what the person did. The DATABASE decides the outcome from the account's records:
//   delete : no records anywhere -> the sign-in and the profile are removed completely;
//   close  : records exist       -> the account is anonymised and locked; every record stays.
import type { StepUp } from "./stepUp.ts"

export type Reply = { status: number; body: Record<string, unknown> }
const fail = (status: number, error: string): Reply => ({ status, body: { error } })

export const deletePhrase = (email: string) => `DELETE ${email.trim().toLowerCase()}`
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const REASON_MIN = 5
export const REASON_MAX = 300

export type Preview = {
  id: string
  email: string
  full_name: string | null
  role: string | null
  status: string
  already_closed: boolean
  mode: "delete" | "close"
  records: Record<string, number>
  record_total: number
  memberships: number
  managed_projects: number
  open_work: number
}

// Why this account may not be deleted right now (null = it may).
export function deleteBlocker(caller: { id: string; role: string }, target: Preview): string | null {
  if (target.id === caller.id) return "You cannot delete your own account."
  if (target.role === "super_admin") return "A Super Admin account cannot be deleted here."
  if (target.already_closed) return "This account is already deleted."
  return null
}

type Rpc = (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message?: string } | null }>
export type AccountDeps = {
  caller: { id: string; role: string }
  rpc: Rpc
  removeFiles: (bucket: string, paths: string[]) => Promise<number>
  listAvatars: (userId: string) => Promise<string[]>
  deleteAuthUser: (id: string) => Promise<{ message: string } | null>
  lockAuthUser: (id: string) => Promise<{ message: string } | null>
  audit: (action: string, targetId: string | null, details: Record<string, unknown>) => Promise<void>
  stepUp: (code: unknown) => Promise<StepUp>
}

const dbMessage = (error: { message?: string }) => (error.message ?? "").replace(/^.*?(This account[^"]*|A Super Admin[^"]*|You cannot[^"]*|That account[^"]*)$/s, "$1").slice(0, 300)

export async function handleAccountControl(body: unknown, deps: AccountDeps): Promise<Reply> {
  const value = (body && typeof body === "object" ? body : {}) as Record<string, unknown>
  const { caller } = deps
  if (caller.role !== "super_admin") return fail(403, "Only a Super Admin can delete accounts")
  if (value.action !== "preview" && value.action !== "delete") return fail(400, "Unknown action")
  if (typeof value.id !== "string" || !uuid.test(value.id)) return fail(400, "Missing account")

  const { data, error } = await deps.rpc("account_delete_preview", { p_user: value.id })
  if (error) return fail(500, "The account could not be checked, so nothing was changed")
  if (!data) return fail(404, "That account does not exist")
  const preview = data as Preview
  const blocker = deleteBlocker(caller, preview)

  if (value.action === "preview") return { status: 200, body: { ...preview, blocker, phrase: deletePhrase(preview.email) } }

  // ---- the deletion itself: every check first, nothing changes until all of them pass
  if (blocker) return fail(409, blocker)
  const reason = typeof value.reason === "string" ? value.reason.trim() : ""
  if (reason.length < REASON_MIN || reason.length > REASON_MAX) return fail(400, `Write the reason (${REASON_MIN}-${REASON_MAX} characters).`)
  if (typeof value.confirm !== "string" || value.confirm.trim().toLowerCase() !== deletePhrase(preview.email).toLowerCase()) return fail(400, `Type ${deletePhrase(preview.email)} exactly to confirm`)
  const step = await deps.stepUp(value.totp)
  if (!step.ok) return fail(step.status, step.message)

  if (preview.mode === "delete") {
    const { data: prepared, error: prepareError } = await deps.rpc("account_delete_prepare", { p_user: preview.id, p_actor: caller.id })
    if (prepareError || !prepared) return fail(409, dbMessage(prepareError ?? {}) || "The account could not be deleted")
    const result = prepared as { paths: string[]; snapshot: Record<string, unknown> }
    await deps.audit("account.delete_requested", preview.id, { reason, mode: "delete", snapshot: result.snapshot })
    const avatars = await deps.listAvatars(preview.id)
    const removed = (await deps.removeFiles("identity-docs", result.paths)) + (await deps.removeFiles("avatars", avatars))
    const failure = await deps.deleteAuthUser(preview.id)
    if (failure) return fail(500, "The account could not be deleted: " + failure.message)
    await deps.audit("account.deleted", null, { mode: "delete", reason, snapshot: result.snapshot, files_removed: removed })
    return { status: 200, body: { ok: true, mode: "delete", files_removed: removed } }
  }

  const { data: closed, error: closeError } = await deps.rpc("close_account", { p_user: preview.id, p_actor: caller.id, p_reason: reason })
  if (closeError || !closed) return fail(409, dbMessage(closeError ?? {}) || "The account could not be closed")
  const paths = ((closed as { paths?: string[] }).paths ?? [])
  const avatars = await deps.listAvatars(preview.id)
  const removed = (await deps.removeFiles("identity-docs", paths)) + (await deps.removeFiles("avatars", avatars))
  const locked = await deps.lockAuthUser(preview.id)
  if (locked) return fail(500, "The records were kept and the profile was cleared, but the sign-in could not be locked: " + locked.message)
  return { status: 200, body: { ok: true, mode: "close", files_removed: removed } }
}
