import { useMemo, useState } from "react"

const criteriaCount = (n: number) => `${n} ${n === 1 ? "criterion" : "criteria"}`
import Modal from "../Modal"
import { EmptyState, buttonPrimary, buttonSecondary, inputClass } from "../ui/PageParts"
import { SkeletonList } from "../ui/Skeleton"
import { Chip, HoldChip, SeverityChip } from "./QaBits"
import QaRequirements from "./QaRequirements"
import ChecklistDocumentation from "./ChecklistDocumentation"
import { qaActions, toleranceText, tradeLabels, type Template } from "../../lib/qa"
import { addedToProject, libraryChecklists, projectChecklists } from "../../lib/qaChecklists"
import type { QaWorkspace } from "../../lib/qaWorkspace"
import { useConfirm } from "../../lib/confirm"
import { useToast } from "../../lib/toast"

const small = `${buttonSecondary} !min-h-8 !py-1 !text-xs`

// A checklist with its criteria and documentation. `onAdd` = it is a library checklist that can be added to the project.
function ChecklistViewer({ template, onClose, onAdd, added }: { template: Template; onClose: () => void; onAdd?: () => void; added?: boolean }) {
  return (
    <Modal
      title={template.name}
      description={`${tradeLabels[template.trade]} • ${criteriaCount(template.qa_template_items.length)}`}
      size="xl"
      onClose={onClose}
      footer={<>{onAdd ? <button type="button" className={buttonPrimary} disabled={added} onClick={onAdd}>{added ? "Already in this project" : "Add to this project"}</button> : null}<button type="button" className={buttonSecondary} onClick={onClose}>Close</button></>}
    >
      <div className="space-y-3">
        {template.description ? <p className="text-sm text-fg-muted">{template.description}</p> : null}
        <ChecklistDocumentation standards={template.standards} items={template.qa_template_items} emptyText="No standard or clause is cited yet. Edit the checklist to cite the standards and exact clauses it is based on." />
        <ol className="space-y-2">
          {template.qa_template_items.map((item, index) => (
            <li key={item.id} className="rounded-lg border border-line bg-surface p-3">
              <p className="text-sm font-semibold"><span className="mr-2 text-fg-muted">{index + 1}.</span>{item.text}</p>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                <SeverityChip severity={item.severity} />{item.hold_point ? <HoldChip /> : null}
                {item.requires_photo ? <Chip tone="bg-surface-muted text-fg-muted">Photo required</Chip> : null}
                {item.kind === "measure" ? <span className="text-xs text-fg-muted">Measure: {toleranceText(item)}</span> : null}
                {item.reference ? <span className="text-xs text-fg-muted">{item.reference}</span> : null}
              </div>
              <QaRequirements item={item} />
            </li>
          ))}
        </ol>
      </div>
    </Modal>
  )
}

// The company library, opened from "Add from library": adding copies a checklist into this project, where it can be adapted.
function LibraryPicker({ library, project, busy, onAdd, onClose }: { library: Template[]; project: Template[]; busy: boolean; onAdd: (template: Template) => void; onClose: () => void }) {
  const [query, setQuery] = useState("")
  const [viewing, setViewing] = useState<Template | null>(null)
  const shown = library.filter((t) => `${t.name} ${tradeLabels[t.trade]} ${t.standards.join(" ")}`.toLowerCase().includes(query.trim().toLowerCase()))
  return (
    <Modal title="Add a checklist from the company library" size="xl" onClose={onClose} description="Added checklists are copied into this project: adapt them to the project's specification there. Only checklists added to the project can be used on its work items and inspection requests.">
      <div className="space-y-3">
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by name, trade or cited standard" aria-label="Search the library" className={`min-h-10 ${inputClass}`} />
        {shown.length === 0 ? <p className="rounded-xl border border-dashed border-line p-4 text-sm text-fg-muted">No library checklist matches.</p> : (
          <ul className="divide-y divide-line rounded-xl border border-line">
            {shown.map((template) => {
              const added = addedToProject(template, project)
              return (
                <li key={template.id} className="grid gap-2 px-3 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-extrabold text-fg">{template.name}{template.is_system ? <Chip tone="bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200">Built in</Chip> : null}</p>
                    <p className="text-xs text-fg-muted">{tradeLabels[template.trade]} • {criteriaCount(template.qa_template_items.length)}{template.standards.length ? ` • Cites ${template.standards.join(", ")}` : ""}</p>
                  </div>
                  <div className="flex flex-wrap gap-2 sm:justify-end">
                    <button type="button" className={small} onClick={() => setViewing(template)}>View</button>
                    <button type="button" className={`${buttonPrimary} !min-h-8 !py-1 !text-xs`} disabled={busy || added} onClick={() => onAdd(template)}>{added ? "Added" : "Add to this project"}</button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
      {viewing ? <ChecklistViewer template={viewing} added={addedToProject(viewing, project)} onAdd={() => { onAdd(viewing); setViewing(null) }} onClose={() => setViewing(null)} /> : null}
    </Modal>
  )
}

// Checklist configuration of one project: only the checklists the Engineer added (from the library or new). Each work item's
// own criteria live with the work item on the plan and are not listed here (20261028150000).
export default function ProjectChecklists({ ws, canEdit, onEdit }: { ws: QaWorkspace; canEdit: boolean; onEdit: (template: Template | null, scope: "project" | "library") => void }) {
  const toast = useToast()
  const confirm = useConfirm()
  const [showArchived, setShowArchived] = useState(false)
  const [viewing, setViewing] = useState<Template | null>(null)
  const [picking, setPicking] = useState(false)
  const [busy, setBusy] = useState(false)
  const list = useMemo(() => projectChecklists(ws.templates, ws.projectId, showArchived), [ws.templates, ws.projectId, showArchived])
  const live = useMemo(() => projectChecklists(ws.templates, ws.projectId), [ws.templates, ws.projectId])
  const library = useMemo(() => libraryChecklists(ws.templates), [ws.templates])

  const add = async (template: Template) => {
    if (!ws.projectId) return
    setBusy(true)
    const result = await qaActions.duplicateTemplate(template.id, ws.projectId, template.name)
    setBusy(false)
    if (!result.ok) return toast.error("Not added", result.message)
    toast.success(`${template.name} added to this project`, "Edit it to match the project's specification.")
    await ws.reloadTemplates()
  }
  const archive = async (template: Template) => {
    if (!template.archived && !(await confirm({ title: `Archive "${template.name}"?`, message: "It is no longer offered for work items or inspection requests. Inspections already made keep their criteria.", confirmLabel: "Archive" }))) return
    const result = await qaActions.archiveTemplate(template.id, !template.archived)
    if (!result.ok) return toast.error("Not changed", result.message)
    toast.success(template.archived ? "Checklist restored" : "Checklist archived")
    await ws.reloadTemplates()
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-extrabold text-fg">This project's checklists ({live.length})</h2>
          <p className="text-xs text-fg-muted">Only these are offered when criteria are set on a work item or a stage / hold-point inspection is requested.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="mr-1 flex min-h-8 items-center gap-1.5 text-sm font-semibold"><input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} /> Show archived</label>
          {canEdit ? <button type="button" className={buttonSecondary} onClick={() => setPicking(true)}>Add from library</button> : null}
          {canEdit ? <button type="button" className={buttonPrimary} onClick={() => onEdit(null, "project")}>New checklist</button> : null}
        </div>
      </div>

      {ws.loading ? <SkeletonList rows={4} label="Loading checklists" /> : list.length === 0 ? (
        <EmptyState
          title="No checklist added to this project yet"
          action={canEdit ? <span className="flex flex-wrap justify-center gap-2"><button type="button" className={buttonSecondary} onClick={() => setPicking(true)}>Add from library</button><button type="button" className={buttonPrimary} onClick={() => onEdit(null, "project")}>New checklist</button></span> : undefined}
        >
          Add the checklists this project uses. Work items and inspection requests can only use checklists added here.
        </EmptyState>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {list.map((template) => {
            const holds = template.qa_template_items.filter((item) => item.hold_point).length
            return (
              <li key={template.id} className={`flex flex-col rounded-xl border border-line bg-surface p-4 ${template.archived ? "opacity-60" : ""}`}>
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-sm font-extrabold">{template.name}</h3>
                  {template.archived ? <Chip tone="bg-gray-200 text-gray-700 dark:bg-gray-700/60 dark:text-gray-200">Archived</Chip> : null}
                </div>
                <p className="mt-1 text-xs text-fg-muted">{tradeLabels[template.trade]} • {criteriaCount(template.qa_template_items.length)}{holds ? ` • ${holds} hold point${holds === 1 ? "" : "s"}` : ""}</p>
                <p className="mt-1 text-xs font-semibold text-fg-muted">{template.standards.length ? `Cites ${template.standards.join(" • ")}` : "No standard cited yet"}</p>
                <div className="mt-auto flex flex-wrap gap-2 pt-3">
                  <button type="button" className={small} onClick={() => setViewing(template)}>View</button>
                  {canEdit ? <button type="button" className={small} onClick={() => onEdit(template, "project")}>Edit</button> : null}
                  {canEdit ? <button type="button" className={small} onClick={() => void archive(template)}>{template.archived ? "Restore" : "Archive"}</button> : null}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {viewing ? <ChecklistViewer template={viewing} onClose={() => setViewing(null)} /> : null}
      {picking ? <LibraryPicker library={library} project={live} busy={busy} onAdd={(template) => void add(template)} onClose={() => setPicking(false)} /> : null}
    </div>
  )
}
