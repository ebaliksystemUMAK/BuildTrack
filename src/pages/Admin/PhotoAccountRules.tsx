import { useEffect, useMemo, useState } from "react"
import { EmptyState, buttonPrimary, buttonSecondary, inputClass } from "../../components/ui/PageParts"
import { SkeletonList } from "../../components/ui/Skeleton"
import { useConfirm } from "../../lib/confirm"
import { setPhotoRule, usePhotoAccounts, type PhotoAccount } from "../../lib/photoPolicy"
import { cameraOnlyFor, photoRuleLabels, type PhotoRule } from "../../lib/photoPolicyModel"
import { useToast } from "../../lib/toast"
import { Panel } from "./AdminShell"

type Choice = PhotoRule | "company"
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-PH", { timeZone: "Asia/Manila", day: "numeric", month: "short", year: "numeric" }) : "")

// System settings > Site photos: each active Foreman / Engineer either follows the company switch or has their own choice
// (Allow uploads / Camera only at site), which wins over the switch. Changes are staged and saved together; the database
// (set_photo_upload_rule, photos.manage + MFA) checks and audits every change.
export default function PhotoAccountRules({ canEdit, canView, companyAllows, onDirtyChange }: { canEdit: boolean; canView: boolean; companyAllows: boolean; onDirtyChange?: (dirty: boolean) => void }) {
  const { accounts, loading, error, reload } = usePhotoAccounts(canView)
  const toast = useToast()
  const confirm = useConfirm()
  const [draft, setDraft] = useState<Record<string, Choice>>({})
  const [query, setQuery] = useState("")
  const [role, setRole] = useState<"all" | "foreman" | "engineer">("all")
  const [busy, setBusy] = useState(false)

  const saved = (account: PhotoAccount): Choice => account.mode ?? "company"
  const chosen = (account: PhotoAccount): Choice => draft[account.user_id] ?? saved(account)
  const changes = accounts.filter((account) => chosen(account) !== saved(account))
  useEffect(() => { onDirtyChange?.(changes.length > 0) }, [changes.length, onDirtyChange])
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return accounts.filter((account) => (role === "all" || account.role === role) && (!needle || `${account.full_name ?? ""} ${account.email}`.toLowerCase().includes(needle)))
  }, [accounts, query, role])

  // What applies to this person now (with the staged choice): field photos and, for Engineers, their inspection photos.
  const effect = (account: PhotoAccount) => {
    const choice = chosen(account)
    const rule = choice === "company" ? null : choice
    const field = cameraOnlyFor("field", companyAllows, rule, account.role)
    const qa = cameraOnlyFor("qa", companyAllows, rule, account.role)
    if (field === qa) return field ? "Camera only, at the site" : "Uploads allowed"
    return "Camera only for reports and task photos; inspection photos can be uploaded"
  }

  const save = async () => {
    if (!changes.length || busy) return
    const list = changes.map((account) => `${account.full_name || account.email}: ${photoRuleLabels[chosen(account)]}`)
    if (!(await confirm({ title: `Save ${changes.length} photo rule${changes.length === 1 ? "" : "s"}?`, message: `${list.join("; ")}. It applies to their next photo.`, confirmLabel: "Save" }))) return
    setBusy(true)
    const failed: string[] = []
    let reason = ""
    for (const account of changes) {
      const choice = chosen(account)
      const problem = await setPhotoRule(account.user_id, choice === "company" ? null : choice)
      if (problem) {
        failed.push(account.user_id)
        reason ||= problem
      }
    }
    await reload()
    setDraft((current) => Object.fromEntries(Object.entries(current).filter(([id]) => failed.includes(id))))
    setBusy(false)
    if (failed.length) toast.error(`${failed.length} rule${failed.length === 1 ? " was" : "s were"} not saved`, reason)
    else toast.success(changes.length === 1 ? "Photo rule saved" : `${changes.length} photo rules saved`)
  }

  return (
    <Panel title="Per-account choices">
      <p className="mb-4 text-sm text-fg-muted">
        Choose a photo rule for each Foreman or Engineer. <strong className="text-fg">Camera only</strong> requires photos taken with the BuildTrack camera at the project site, including an Engineer's inspection photos.
      </p>
      {!canView ? (
        <p className="rounded-lg bg-surface-muted px-4 py-3 text-sm text-fg-muted">You need the Site photos or View users permission to see the per-account choices. A Super Admin can grant it in User management &gt; Permissions.</p>
      ) : loading ? (
        <SkeletonList rows={4} label="Loading accounts" />
      ) : error ? (
        <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger-fg">{error} <button type="button" className="underline" onClick={() => void reload()}>Retry</button></p>
      ) : accounts.length === 0 ? (
        <EmptyState title="No Foreman or Engineer accounts yet">Active Foreman and Engineer accounts appear here.</EmptyState>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-end gap-2">
            <label className="block min-w-[14rem] flex-1 text-xs font-bold uppercase tracking-wider text-fg-muted">Search
              <input className={`${inputClass} mt-1 normal-case`} type="search" value={query} placeholder="Name or email" onChange={(event) => setQuery(event.target.value)} />
            </label>
            <label className="block text-xs font-bold uppercase tracking-wider text-fg-muted">Role
              <select className={`${inputClass} mt-1 normal-case`} value={role} onChange={(event) => setRole(event.target.value as typeof role)}>
                <option value="all">Foremen and Engineers</option>
                <option value="foreman">Foremen</option>
                <option value="engineer">Engineers</option>
              </select>
            </label>
            <span className="pb-2 text-xs text-fg-muted">{shown.length} of {accounts.length} accounts</span>
          </div>
          <div className="overflow-x-auto rounded-xl border border-line">
            <table className="w-full min-w-[40rem] text-left text-sm">
              <thead className="bg-surface-muted text-xs uppercase tracking-wider text-fg-muted">
                <tr>
                  <th scope="col" className="px-3 py-2 font-extrabold">Account</th>
                  <th scope="col" className="px-3 py-2 font-extrabold">Photo rule</th>
                  <th scope="col" className="px-3 py-2 font-extrabold">What applies now</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((account) => {
                  const name = account.full_name || account.email
                  const changed = chosen(account) !== saved(account)
                  return (
                    <tr key={account.user_id} className={`border-t border-line ${changed ? "bg-brand-soft" : ""}`}>
                      <th scope="row" className="px-3 py-2 font-semibold">
                        <span className="block">{name}</span>
                        <span className="block text-xs font-normal text-fg-muted">{account.role === "foreman" ? "Foreman" : "Engineer"} · {account.email}</span>
                      </th>
                      <td className="px-3 py-2">
                        <select className={inputClass} aria-label={`Photo rule for ${name}`} value={chosen(account)} disabled={!canEdit || busy} onChange={(event) => setDraft((current) => ({ ...current, [account.user_id]: event.target.value as Choice }))}>
                          {(["company", "allow", "camera_only"] as const).map((choice) => <option key={choice} value={choice}>{photoRuleLabels[choice]}</option>)}
                        </select>
                        {account.mode && account.updated_at ? <span className="mt-1 block text-xs text-fg-muted">Set {when(account.updated_at)}</span> : null}
                      </td>
                      <td className="px-3 py-2 text-fg-muted">{effect(account)}{changed ? <span className="block text-xs font-semibold text-brand-text">Not saved yet</span> : null}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {shown.length === 0 ? <p className="px-3 py-4 text-sm text-fg-muted">No account matches the search.</p> : null}
          </div>
          {canEdit ? (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
              <span className="text-xs text-fg-muted">{changes.length ? `${changes.length} change${changes.length === 1 ? "" : "s"} not saved` : "Every change is written to the audit log."}</span>
              <span className="flex gap-2">
                <button type="button" className={buttonSecondary} disabled={!changes.length || busy} onClick={() => setDraft({})}>Reset</button>
                <button type="button" className={buttonPrimary} disabled={!changes.length || busy} onClick={() => void save()}>{busy ? "Saving..." : "Save"}</button>
              </span>
            </div>
          ) : null}
        </>
      )}
    </Panel>
  )
}
