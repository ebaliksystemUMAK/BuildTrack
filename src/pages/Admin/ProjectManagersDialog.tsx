import { useState } from "react"
import Modal from "../../components/Modal"
import { buttonPrimary, buttonSecondary, inputClass } from "../../components/ui/PageParts"
import { useConfirm } from "../../lib/confirm"
import { slotChange, slotLabels, slotsOf, type ManagerSlot, type ProjectManagerRow } from "../../lib/projectManagerModel"
import { assignProjectManager, removeProjectManager } from "../../lib/projectManagers"
import type { Project } from "../../lib/projects"
import { useToast } from "../../lib/toast"

type Person = { id: string; full_name: string | null; email: string }
const nameOf = (person: Person | undefined) => person?.full_name || person?.email || "Unknown account"

// Assign, replace or remove the primary and backup Project Manager of one project (Admins with the Projects permission + MFA;
// assign_project_manager / remove_project_manager re-check it). Choosing the current backup as primary swaps the two.
export default function ProjectManagersDialog({ project, managers, people, onChanged, onClose }: {
  project: Project
  managers: ProjectManagerRow[]
  people: Person[]
  onChanged: () => Promise<void>
  onClose: () => void
}) {
  const toast = useToast()
  const confirm = useConfirm()
  const slots = slotsOf(managers, project.id)
  const [choice, setChoice] = useState<Record<ManagerSlot, string>>({ primary: slots.primary?.user_id ?? "", backup: slots.backup?.user_id ?? "" })
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState("")

  const save = async (slot: ManagerSlot) => {
    const userId = choice[slot]
    if (!userId) return
    const change = slotChange(managers, project.id, userId, slot)
    if (change.kind === "unchanged") return
    const who = nameOf(people.find((person) => person.id === userId))
    if (change.kind === "replace" || change.kind === "swap") {
      const ok = await confirm({
        title: change.kind === "swap" ? `Swap the Project Managers of ${project.code}?` : `Replace ${change.replaced?.full_name}?`,
        message: change.kind === "swap"
          ? `${who} becomes the ${slot} Project Manager and ${change.replaced?.full_name} becomes the ${slot === "primary" ? "backup" : "primary"}. Both keep access.`
          : `${who} becomes the ${slot} Project Manager. ${change.replaced?.full_name} loses access to ${project.code} at once and is notified.`,
        confirmLabel: change.kind === "swap" ? "Swap" : "Replace",
        tone: change.kind === "replace" ? "danger" : undefined,
      })
      if (!ok) return
    }
    setBusy(true)
    setFailure("")
    try {
      await assignProjectManager(project.id, userId, slot)
      await onChanged()
      toast.success(`${who} is the ${slot} Project Manager`, "They were notified and see the project under My projects.")
    } catch (error) {
      setFailure((error as Error).message)
    }
    setBusy(false)
  }

  const remove = async (row: ProjectManagerRow) => {
    const ok = await confirm({ title: `Remove ${row.full_name} from ${project.code}?`, message: "They lose access to this project at once and are notified. Records they made keep their name.", confirmLabel: "Remove", tone: "danger" })
    if (!ok) return
    setBusy(true)
    setFailure("")
    try {
      await removeProjectManager(project.id, row.user_id)
      setChoice((current) => ({ ...current, [row.designation]: "" }))
      await onChanged()
      toast.success(`${row.full_name} removed`)
    } catch (error) {
      setFailure((error as Error).message)
    }
    setBusy(false)
  }

  return (
    <Modal title={`Project Managers: ${project.code}`} size="lg" onClose={() => (busy ? undefined : onClose())}>
      <div className="space-y-4">
        <p className="text-sm text-fg-muted">{project.name}. A project has one primary and, when needed, one backup Project Manager. Both run its day-to-day operations; neither can change the other's access.</p>
        {failure ? <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger-fg">{failure}</p> : null}
        {people.length === 0 ? <p role="status" className="rounded-lg bg-amber-100 px-3 py-2 text-sm text-amber-950 dark:bg-amber-900/40 dark:text-amber-100">No active Project Manager account yet. Give someone the Project Manager role in User Management first.</p> : null}
        {(["primary", "backup"] as const).map((slot) => {
          const current = slots[slot]
          const change = choice[slot] ? slotChange(managers, project.id, choice[slot], slot) : null
          return (
            <section key={slot} className="rounded-xl border border-line p-3" aria-labelledby={`pm-slot-${slot}`}>
              <h3 id={`pm-slot-${slot}`} className="text-sm font-extrabold text-fg">{slotLabels[slot]}</h3>
              <p className="mt-0.5 text-xs text-fg-muted">{current ? <>Now: <strong className="text-fg">{current.full_name}</strong>{!current.active ? " (account not active)" : ""}</> : "Not assigned"}</p>
              <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center">
                <select value={choice[slot]} disabled={busy || !people.length} onChange={(event) => setChoice({ ...choice, [slot]: event.target.value })} aria-label={`Choose the ${slot} Project Manager`} className={`min-h-10 ${inputClass}`}>
                  <option value="">Choose a Project Manager</option>
                  {people.map((person) => <option key={person.id} value={person.id}>{nameOf(person)}{person.full_name ? ` • ${person.email}` : ""}</option>)}
                </select>
                <button type="button" className={buttonPrimary} disabled={busy || !change || change.kind === "unchanged"} onClick={() => void save(slot)}>
                  {!change || change.kind === "unchanged" ? "Assigned" : change.kind === "swap" ? "Swap" : change.kind === "replace" ? "Replace" : "Assign"}
                </button>
                {current ? <button type="button" className="min-h-10 rounded-xl px-3 text-sm font-bold text-danger-fg hover:bg-danger-soft disabled:opacity-60" disabled={busy} onClick={() => void remove(current)}>Remove</button> : null}
              </div>
            </section>
          )
        })}
        <div className="flex justify-end border-t border-line pt-3"><button type="button" className={buttonSecondary} disabled={busy} onClick={onClose}>Done</button></div>
      </div>
    </Modal>
  )
}
