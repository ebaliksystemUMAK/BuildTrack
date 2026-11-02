import { checkStatusChange, reactivationNotice, suspensionNotice, type StatusNotice } from "../_shared/accountStatus.ts"
import { audit, can, type Caller, corsHeaders, HttpError, json, requireCaller } from "../_shared/guard.ts"

// project_manager (20261029095839): any Admin with the matching users.* permission may give it; Admins assign their projects.
const ROLES = ["super_admin", "admin", "project_manager", "engineer", "foreman", "client", "user"]
const REQUESTABLE_ROLES = ["engineer", "foreman", "client"]
const PERMISSIONS = [
  "users.view", "users.create", "users.edit", "users.approve", "users.disable",
  "users.impersonate", "biometrics.manage", "projects.manage", "blueprints.manage", "photos.manage",
]
const DISCIPLINES = ["civil_structural", "architectural", "mep"]
const isPrivileged = (role: string) => role === "super_admin" || role === "admin"
const decisionNote = (value: unknown, required = false) => {
  const note = typeof value === "string" ? value.trim().slice(0, 500) : ""
  if (required && note.length < 5) throw new HttpError(400, "Give the person a reason (at least 5 characters)")
  return note || null
}

async function loadTarget(caller: Caller, id: unknown) {
  if (typeof id !== "string") throw new HttpError(400, "Missing user id")
  const { data } = await caller.admin.from("profiles").select("id, role, status, email").eq("id", id).single()
  if (!data) throw new HttpError(404, "User not found")
  // Only a Super Admin may touch Super Admins or Admins.
  if (isPrivileged(data.role ?? "") && caller.role !== "super_admin") {
    throw new HttpError(403, "Only a Super Admin can manage admin accounts")
  }
  return data
}

function assertAssignableRole(caller: Caller, role: unknown) {
  if (typeof role !== "string" || !ROLES.includes(role)) throw new HttpError(400, "Invalid role")
  if (isPrivileged(role) && caller.role !== "super_admin") {
    throw new HttpError(403, "Only a Super Admin can assign admin roles")
  }
}

async function setBan(caller: Caller, id: string, banned: boolean) {
  const { error } = await caller.admin.auth.admin.updateUserById(id, {
    ban_duration: banned ? "876000h" : "none",
  })
  if (error) throw new HttpError(500, error.message)
}

// Ends every session of the person (refresh tokens and sessions) so they cannot keep browsing; data access is also cut at once because the
// database only serves active accounts. Returns how many sessions were removed.
async function revokeSessions(caller: Caller, id: string): Promise<number> {
  const { data, error } = await caller.admin.rpc("revoke_user_sessions", { p_user: id })
  if (error) throw new HttpError(500, "Could not end the person's sessions")
  return Number(data ?? 0)
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })
  try {
    const caller = await requireCaller(req)
    const body = await req.json()
    const { action } = body

    if (action === "create") {
      if (!can(caller, "users.create")) throw new HttpError(403, "Missing permission: users.create")
      assertAssignableRole(caller, body.role)
      const email = String(body.email ?? "").trim().toLowerCase()
      const password = String(body.password ?? "")
      if (!/^\S+@\S+\.\S+$/.test(email)) throw new HttpError(400, "Invalid email")
      if (password.length < 10) throw new HttpError(400, "Password must be at least 10 characters")
      const { data, error } = await caller.admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: {
          full_name: body.full_name,
          phone: body.phone,
          company: body.company,
          position: body.position,
        },
      })
      if (error || !data.user) throw new HttpError(400, error?.message ?? "Could not create user")
      const { error: profileError } = await caller.admin.from("profiles").update({
        role: body.role,
        status: "active",
        discipline: DISCIPLINES.includes(body.discipline) ? body.discipline : null,
        approved_by: caller.id,
        approved_at: new Date().toISOString(),
      }).eq("id", data.user.id)
      if (profileError) throw new HttpError(500, profileError.message)
      await audit(caller, "user.create", data.user.id, { role: body.role, email })
      return json({ id: data.user.id })
    }

    if (action === "update") {
      if (!can(caller, "users.edit")) throw new HttpError(403, "Missing permission: users.edit")
      const target = await loadTarget(caller, body.id)
      if (target.id === caller.id) throw new HttpError(400, "You cannot change your own account from User Management")
      const patch: Record<string, unknown> = {}
      for (const key of ["full_name", "phone", "company", "position"]) {
        if (typeof body[key] === "string") patch[key] = body[key].trim()
      }
      if (body.discipline !== undefined) {
        patch.discipline = DISCIPLINES.includes(body.discipline) ? body.discipline : null
      }
      if (body.role !== undefined && body.role !== target.role) {
        assertAssignableRole(caller, body.role)
        patch.role = body.role
      }
      const { error } = await caller.admin.from("profiles").update(patch).eq("id", target.id)
      if (error) throw new HttpError(500, error.message)
      await audit(caller, patch.role === "admin" && target.role !== "admin" ? "user.promote_admin" : "user.update", target.id, patch)
      return json({ ok: true })
    }

    if (action === "approve" || action === "reject") {
      if (!can(caller, "users.approve")) throw new HttpError(403, "Missing permission: users.approve")
      const target = await loadTarget(caller, body.id)
      if (target.id === caller.id) throw new HttpError(400, "You cannot approve or reject your own account")
      if (target.status !== "pending") throw new HttpError(400, "User is not pending")
      const patch: Record<string, unknown> = {
        status: action === "approve" ? "active" : "rejected",
        approved_by: caller.id,
        approved_at: new Date().toISOString(),
      }
      if (action === "approve") {
        const { data: asked } = await caller.admin.from("profiles").select("requested_role").eq("id", target.id).single()
        const role = body.role ?? asked?.requested_role
        assertAssignableRole(caller, role)
        patch.role = role
        if (DISCIPLINES.includes(body.discipline)) patch.discipline = body.discipline
      }
      const note = decisionNote(body.note, action === "reject")
      const { error } = await caller.admin.from("profiles").update(patch).eq("id", target.id)
      if (error) throw new HttpError(500, error.message)
      const revoked = action === "reject" ? await revokeSessions(caller, target.id) : 0
      await audit(caller, `user.${action}`, target.id, { role: patch.role ?? null, decision_note: note, sessions_revoked: revoked })
      return json({ ok: true })
    }

    // Decide a user's "request elevated access". Admins only step in here: sign-up itself needs no approval.
    if (action === "approve_request" || action === "reject_request") {
      if (!can(caller, "users.approve")) throw new HttpError(403, "Missing permission: users.approve")
      if (typeof body.request_id !== "string") throw new HttpError(400, "Missing request id")
      const { data: request } = await caller.admin.from("access_requests").select("*").eq("id", body.request_id).single()
      if (!request) throw new HttpError(404, "Request not found")
      if (request.status !== "pending") throw new HttpError(400, "This request was already handled")
      const { data: target } = await caller.admin.from("profiles").select("id, role, status").eq("id", request.user_id).single()
      if (!target || target.status !== "active") throw new HttpError(400, "The account is not active")
      if (target.role !== "user") throw new HttpError(400, "This account no longer has a basic role")
      if (target.id === caller.id) throw new HttpError(400, "You cannot decide your own access request")

      const approving = action === "approve_request"
      const role = approving ? String(body.role ?? request.requested_role) : null
      if (approving && !REQUESTABLE_ROLES.includes(role!)) throw new HttpError(400, "Choose Engineer, Foreman or Client")
      const note = decisionNote(body.note, !approving)

      // Claim the request first so two admins cannot decide it twice.
      const { data: claimed, error: claimError } = await caller.admin.from("access_requests")
        .update({ status: approving ? "approved" : "rejected", decided_by: caller.id, decided_at: new Date().toISOString(), decision_note: note })
        .eq("id", request.id).eq("status", "pending").select("id")
      if (claimError) throw new HttpError(500, claimError.message)
      if (!claimed?.length) throw new HttpError(400, "This request was already handled")

      if (approving) {
        const discipline = DISCIPLINES.includes(body.discipline) ? body.discipline : request.discipline
        const { error } = await caller.admin.from("profiles").update({
          role,
          discipline: discipline ?? null,
          approved_by: caller.id,
          approved_at: new Date().toISOString(),
        }).eq("id", target.id)
        if (error) {
          await caller.admin.from("access_requests").update({ status: "pending", decided_by: null, decided_at: null, decision_note: null }).eq("id", request.id)
          throw new HttpError(500, error.message)
        }
      }
      await audit(caller, approving ? "access.approve" : "access.reject", target.id, { role, requested: request.requested_role })
      return json({ ok: true })
    }

    // Whitelist: the person gets this role the moment their email is confirmed (database trigger, migration 0015).
    if (action === "whitelist_add") {
      if (!can(caller, "users.approve")) throw new HttpError(403, "Missing permission: users.approve")
      const role = String(body.role ?? "")
      if (!["engineer", "foreman", "client", "project_manager", "admin"].includes(role)) throw new HttpError(400, "Choose Engineer, Foreman, Client, Project Manager or Admin")
      if (role === "admin" && caller.role !== "super_admin") throw new HttpError(403, "Only a Super Admin can pre-approve an Admin")
      const raw: unknown[] = Array.isArray(body.emails) ? body.emails : []
      const emails = [...new Set(raw.map((e) => String(e).trim().toLowerCase()).filter(Boolean))]
      if (!emails.length) throw new HttpError(400, "Enter at least one email")
      if (emails.length > 50) throw new HttpError(400, "Add at most 50 emails at a time")
      const bad = emails.filter((e) => e.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e))
      if (bad.length) throw new HttpError(400, `Not a valid email: ${bad[0]}`)
      const note = typeof body.note === "string" ? body.note.trim().slice(0, 200) || null : null
      const discipline = DISCIPLINES.includes(body.discipline) ? body.discipline : null
      const { data: existing } = await caller.admin.from("whitelisted_emails").select("email").in("email", emails)
      const taken = new Set((existing ?? []).map((r: { email: string }) => r.email))
      // Super Admin / Admin accounts are never re-assigned through the whitelist.
      const { data: privileged } = await caller.admin.from("profiles").select("email").in("email", emails).in("role", ["super_admin", "admin"])
      const skipped = new Set((privileged ?? []).map((r: { email: string }) => r.email))
      const fresh = emails.filter((e) => !taken.has(e) && !skipped.has(e))
      if (fresh.length) {
        const { error } = await caller.admin.from("whitelisted_emails")
          .insert(fresh.map((email) => ({ email, assigned_role: role, discipline, note, created_by: caller.id })))
        if (error) throw new HttpError(500, error.message)
      }
      await audit(caller, "whitelist.add", null, { count: fresh.length, role })
      return json({ added: fresh.length, already_listed: emails.filter((e) => taken.has(e)), skipped_admins: [...skipped] })
    }

    if (action === "whitelist_remove") {
      if (!can(caller, "users.approve")) throw new HttpError(403, "Missing permission: users.approve")
      if (typeof body.id !== "string") throw new HttpError(400, "Missing id")
      const { data: entry } = await caller.admin.from("whitelisted_emails").select("id, email, assigned_role, used_at").eq("id", body.id).single()
      if (!entry) throw new HttpError(404, "Entry not found")
      if (entry.used_at) throw new HttpError(400, "This entry was already used and is kept as history")
      if (entry.assigned_role === "admin" && caller.role !== "super_admin") throw new HttpError(403, "Only a Super Admin can remove an Admin entry")
      const { error } = await caller.admin.from("whitelisted_emails").delete().eq("id", entry.id).is("used_at", null)
      if (error) throw new HttpError(500, error.message)
      await audit(caller, "whitelist.remove", null, { email: entry.email, role: entry.assigned_role })
      return json({ ok: true })
    }

    // A rejected registration can be looked at again: it goes back to pending.
    if (action === "reopen") {
      if (!can(caller, "users.approve")) throw new HttpError(403, "Missing permission: users.approve")
      const target = await loadTarget(caller, body.id)
      if (target.id === caller.id) throw new HttpError(400, "You cannot reconsider your own account")
      if (target.status !== "rejected") throw new HttpError(400, "Only a rejected account can be reconsidered")
      const { error } = await caller.admin.from("profiles").update({ status: "pending", approved_by: null, approved_at: null }).eq("id", target.id)
      if (error) throw new HttpError(500, error.message)
      await audit(caller, "user.reopen", target.id)
      return json({ ok: true })
    }

    if (action === "set_enabled") {
      if (!can(caller, "users.disable")) throw new HttpError(403, "Missing permission: users.disable")
      const target = await loadTarget(caller, body.id)
      const enable = body.enabled === true
      // The rules (not yourself, Admins only by a Super Admin, suspend only active accounts, enable only suspended ones, written reason) live in
      // _shared/accountStatus.ts and are tested in Node; the caller was already required to be an active account by requireCaller.
      const check = checkStatusChange({ id: caller.id, role: caller.role }, { id: target.id, role: target.role, status: target.status }, enable, body.reason)
      if (!check.ok) throw new HttpError(check.status, check.message)
      await setBan(caller, target.id, !enable)
      const { error } = await caller.admin.from("profiles")
        .update({ status: enable ? "active" : "disabled" }).eq("id", target.id)
      if (error) throw new HttpError(500, error.message)
      const revoked = enable ? 0 : await revokeSessions(caller, target.id)
      await audit(caller, enable ? "user.enable" : "user.disable", target.id, enable ? {} : { reason: check.reason, sessions_revoked: revoked })
      // The person's notice goes through the normal notifications table (bell, and email when it is set up). A failure here never undoes the decision.
      const notice: StatusNotice = enable ? reactivationNotice() : suspensionNotice(check.reason ?? "")
      const { error: noticeError } = await caller.admin.from("notifications").insert({ user_id: target.id, kind: notice.kind, title: notice.title, body: notice.body })
      return json({ ok: true, notified: !noticeError })
    }

    if (action === "set_permissions") {
      if (caller.role !== "super_admin") throw new HttpError(403, "Only a Super Admin can grant permissions")
      const target = await loadTarget(caller, body.id)
      if (target.id === caller.id) throw new HttpError(400, "You cannot change your own permissions")
      if (target.role !== "admin") throw new HttpError(400, "Permissions apply to Admin accounts only")
      const list = Array.isArray(body.permissions) ? body.permissions : []
      if (!list.every((p: unknown) => typeof p === "string" && PERMISSIONS.includes(p))) {
        throw new HttpError(400, "Unknown permission")
      }
      await caller.admin.from("admin_permissions").delete().eq("user_id", target.id)
      if (list.length) {
        const { error } = await caller.admin.from("admin_permissions")
          .insert(list.map((permission: string) => ({ user_id: target.id, permission, granted_by: caller.id })))
        if (error) throw new HttpError(500, error.message)
      }
      await audit(caller, "user.set_permissions", target.id, { permissions: list })
      return json({ ok: true })
    }

    // Right to erasure: clears the person's personal data (database function), deletes their ID photos and avatar files, and
    // replaces the sign-in email so the account cannot be used again. Work records stay, shown as "Deleted account".
    if (action === "erase_user") {
      if (!can(caller, "users.approve")) throw new HttpError(403, "Missing permission: users.approve")
      if (typeof body.request_id !== "string") throw new HttpError(400, "Missing request id")
      const { data: request } = await caller.admin.from("data_requests").select("id, user_id, status").eq("id", body.request_id).single()
      if (!request || request.status !== "open") throw new HttpError(400, "This request is not waiting any more")
      const target = await loadTarget(caller, request.user_id)
      if (target.id === caller.id) throw new HttpError(400, "You cannot erase your own account")
      const { data, error } = await caller.admin.rpc("erase_user_data", { p_user: target.id, p_request: request.id, p_actor: caller.id })
      if (error) throw new HttpError(400, error.message)
      const paths: string[] = Array.isArray(data?.paths) ? data.paths : []
      let removed = 0
      if (paths.length) {
        const { data: gone } = await caller.admin.storage.from("identity-docs").remove(paths)
        removed += gone?.length ?? 0
      }
      const { data: avatars } = await caller.admin.storage.from("avatars").list(target.id)
      if (avatars?.length) {
        const { data: gone } = await caller.admin.storage.from("avatars").remove(avatars.map((file) => `${target.id}/${file.name}`))
        removed += gone?.length ?? 0
      }
      const { error: authError } = await caller.admin.auth.admin.updateUserById(target.id, {
        email: `deleted-${target.id}@erased.invalid`,
        user_metadata: {},
        ban_duration: "876000h",
      })
      if (authError) throw new HttpError(500, "Data cleared, but the sign-in email could not be replaced: " + authError.message)
      await audit(caller, "privacy.erase_files", target.id, { files_removed: removed })
      return json({ ok: true, files_removed: removed })
    }

    throw new HttpError(400, "Unknown action")
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.message }, err.status)
    console.error(err)
    return json({ error: "Server error" }, 500)
  }
})
