import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { SkeletonList } from "../../components/ui/Skeleton"
import type { AdminPermission, Profile } from "../../lib/auth"
import { useConfirm } from "../../lib/confirm"
import { invokeFunction } from "../../lib/functions"
import { supabase } from "../../lib/supabase"
import { useToast } from "../../lib/toast"

const permissions: Array<{ key: AdminPermission; label: string; short: string; note: string }> = [
  { key: "users.view", label: "View users", short: "View", note: "See the user list and the audit log" },
  { key: "users.create", label: "Create users", short: "Create", note: "Create accounts with a role" },
  { key: "users.edit", label: "Edit users", short: "Edit", note: "Change names, contacts and roles" },
  { key: "users.approve", label: "Review access requests", short: "Approve", note: "Decide registrations, ID checks, requests, whitelist" },
  { key: "users.disable", label: "Suspend / enable users", short: "Suspend", note: "Suspend or re-enable accounts" },
  { key: "users.impersonate", label: "Log in as a user", short: "Log in as", note: "See the app as another person (audited)" },
  { key: "biometrics.manage", label: "Biometric registration", short: "Biometrics", note: "Admin-only worker profiles, sensor enrollment IDs and device management" },
  { key: "projects.manage", label: "Project management", short: "Projects", note: "Create projects, assign Project Managers, view teams and export backups" },
  { key: "blueprints.manage", label: "Blueprint management", short: "Blueprints", note: "Upload and edit plans and QA" },
  { key: "photos.manage", label: "Site photo rules", short: "Photos", note: "Manage photo rules for Foreman and Engineer accounts (System settings > Site photos)" },
]

type Grants = Record<string, Set<AdminPermission>>

// One screen for who can do what: admins down the side, the permissions across the top. Changes are staged, shown as a list of
// exactly what will change, and saved together (Super Admin only; the database and the Edge Function check this again).
export default function PermissionMatrix({ admins, onSaved }: { admins: Profile[]; onSaved: () => void | Promise<void> }) {
  const toast = useToast()
  const confirm = useConfirm()
  const [saved, setSaved] = useState<Grants | null>(null)
  const [draft, setDraft] = useState<Grants>({})
  const [busy, setBusy] = useState(false)

  // `admins` is a new array on every render of the parent; reload only when the set of admins really changes.
  const adminKey = admins.map((admin) => admin.id).join(",")
  const adminsRef = useRef(admins)
  adminsRef.current = admins
  const load = useCallback(async () => {
    const { data } = await supabase.from("admin_permissions").select("user_id, permission")
    const grants: Grants = {}
    for (const admin of adminsRef.current) grants[admin.id] = new Set()
    for (const row of (data as Array<{ user_id: string; permission: AdminPermission }> | null) ?? []) grants[row.user_id]?.add(row.permission)
    setSaved(grants)
    setDraft(Object.fromEntries(Object.entries(grants).map(([id, set]) => [id, new Set(set)])))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminKey])
  useEffect(() => {
    void load()
  }, [load])

  const changes = useMemo(() => {
    const list: Array<{ admin: Profile; added: AdminPermission[]; removed: AdminPermission[] }> = []
    if (!saved) return list
    for (const admin of admins) {
      const before = saved[admin.id] ?? new Set<AdminPermission>()
      const after = draft[admin.id] ?? new Set<AdminPermission>()
      const added = permissions.map((p) => p.key).filter((key) => after.has(key) && !before.has(key))
      const removed = permissions.map((p) => p.key).filter((key) => before.has(key) && !after.has(key))
      if (added.length || removed.length) list.push({ admin, added, removed })
    }
    return list
  }, [saved, draft, admins])

  const toggle = (adminId: string, key: AdminPermission) =>
    setDraft((current) => {
      const next = new Set(current[adminId] ?? [])
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return { ...current, [adminId]: next }
    })

  const setColumn = (key: AdminPermission, on: boolean) =>
    setDraft((current) => Object.fromEntries(admins.map((admin) => {
      const next = new Set(current[admin.id] ?? [])
      if (on) next.add(key)
      else next.delete(key)
      return [admin.id, next]
    })))

  const save = async () => {
    const label = (key: AdminPermission) => permissions.find((p) => p.key === key)?.label ?? key
    const summary = changes.map((change) => `${change.admin.full_name || change.admin.email}: ${[...change.added.map((k) => `+ ${label(k)}`), ...change.removed.map((k) => `- ${label(k)}`)].join(", ")}`).join("\n")
    if (!(await confirm({ title: `Save changes for ${changes.length} admin${changes.length === 1 ? "" : "s"}?`, message: summary, confirmLabel: "Save permissions" }))) return
    setBusy(true)
    let failed = 0
    for (const change of changes) {
      const { error } = await invokeFunction("admin-users", { action: "set_permissions", id: change.admin.id, permissions: [...(draft[change.admin.id] ?? [])] })
      if (error) {
        failed++
        toast.error(`Not saved for ${change.admin.full_name || change.admin.email}`, error)
      }
    }
    setBusy(false)
    if (!failed) toast.success("Permissions saved", `${changes.length} admin${changes.length === 1 ? "" : "s"} updated`)
    await load()
    await onSaved()
  }

  if (!saved) return <SkeletonList rows={4} label="Loading permissions" />
  if (!admins.length) return <p className="rounded-xl border border-dashed border-line p-8 text-center text-sm text-fg-muted">There are no Admin accounts yet. Create one under "All users", then set what they may do here. A Super Admin always has every permission.</p>

  return (
    <section aria-label="Permission matrix" className="rounded-2xl border border-line bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div><h2 className="text-sm font-extrabold">Who can do what</h2><p className="text-xs text-fg-muted">Tick what each admin may do. Nothing changes until you save. A Super Admin always has every permission.</p></div>
        <div className="flex gap-2">
          <button type="button" className="rounded-lg border border-line px-3 py-1.5 text-sm font-semibold hover:bg-surface-muted disabled:opacity-60" disabled={!changes.length || busy} onClick={() => setDraft(Object.fromEntries(Object.entries(saved).map(([id, set]) => [id, new Set(set)])))}>Discard</button>
          <button type="button" className="rounded-lg bg-brand px-4 py-1.5 text-sm font-bold text-white hover:bg-brand-hover disabled:opacity-60" disabled={!changes.length || busy} onClick={() => void save()}>{busy ? "Saving..." : `Save${changes.length ? ` (${changes.length})` : ""}`}</button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="text-xs uppercase tracking-wider text-fg-muted">
            <tr>
              <th scope="col" className="sticky left-0 bg-surface px-4 py-3 font-extrabold">Admin</th>
              {permissions.map((p) => (
                <th key={p.key} scope="col" className="px-2 py-3 text-center font-extrabold" title={p.note}>
                  <span className="block">{p.short}</span>
                  <span className="mt-1 flex justify-center gap-1 text-[11px] font-bold normal-case tracking-normal"><button type="button" className="underline hover:text-fg" onClick={() => setColumn(p.key, true)} aria-label={`Allow everyone: ${p.label}`}>all</button><span aria-hidden="true">/</span><button type="button" className="underline hover:text-fg" onClick={() => setColumn(p.key, false)} aria-label={`Allow no one: ${p.label}`}>none</button></span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {admins.map((admin) => {
              const before = saved[admin.id] ?? new Set<AdminPermission>()
              const after = draft[admin.id] ?? new Set<AdminPermission>()
              return (
                <tr key={admin.id} className="hover:bg-surface-muted/50">
                  <th scope="row" className="sticky left-0 bg-surface px-4 py-2.5 font-semibold"><span className="block truncate">{admin.full_name || admin.email}</span><span className="block truncate text-xs font-normal text-fg-muted">{admin.email}{admin.status !== "active" ? ` • ${admin.status}` : ""}</span></th>
                  {permissions.map((p) => {
                    const changed = before.has(p.key) !== after.has(p.key)
                    return (
                      <td key={p.key} className={`px-2 py-2.5 text-center ${changed ? "bg-brand-soft" : ""}`}>
                        <input type="checkbox" className="h-4 w-4 accent-[#9E1F93]" checked={after.has(p.key)} onChange={() => toggle(admin.id, p.key)} aria-label={`${admin.full_name || admin.email}: ${p.label}`} />
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {changes.length ? (
        <div className="border-t border-line px-4 py-3 text-xs" role="status">
          <p className="font-extrabold uppercase tracking-wider text-fg-muted">Pending changes</p>
          <ul className="mt-1 space-y-0.5">{changes.map((change) => <li key={change.admin.id}><strong>{change.admin.full_name || change.admin.email}</strong>: {[...change.added.map((k) => `+ ${permissions.find((p) => p.key === k)?.label}`), ...change.removed.map((k) => `- ${permissions.find((p) => p.key === k)?.label}`)].join(", ")}</li>)}</ul>
        </div>
      ) : null}
    </section>
  )
}
