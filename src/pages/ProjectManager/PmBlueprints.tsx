import { useEffect, useState } from "react"
import SelectedProjectWorkspace from "../../components/SelectedProjectWorkspace"
import { PageHead } from "../../components/ui/PageParts"
import BlueprintMapping from "../Admin/BlueprintMapping"
import BlueprintProgressTracking from "../Admin/BlueprintProgressTracking"
import BlueprintVersionControl from "../Admin/BlueprintVersionControl"
import type { AdminPageKey } from "../Admin/types"
import { usePmProject } from "./usePmProject"
import type { PmPageProps } from "./types"

type Tab = "sheets" | "mapping" | "versions" | "progress"
const tabs: Array<[Tab, string]> = [["sheets", "Sheets & revisions"], ["mapping", "Mapping"], ["versions", "Version history"], ["progress", "Progress tracking"]]
const readTab = (search: string): Tab => {
  const params = new URLSearchParams(search)
  if (params.get("pin") || params.get("sheet")) return "sheets"
  const tab = params.get("tab")
  return tabs.some(([key]) => key === tab) ? (tab as Tab) : "sheets"
}

// Blueprints of the selected project: upload sheets and revisions by type (and move a sheet to another type), the mapping of work on
// each sheet, every revision kept as uploaded, and verified progress per sheet. Plans open read-only in the editor: Engineers place and
// edit the work. Deleting a sheet stays with Admins.
export default function PmBlueprints(_: PmPageProps) {
  const pm = usePmProject()
  const [tab, setTab] = useState<Tab>(() => readTab(window.location.search))
  useEffect(() => {
    const follow = () => setTab(readTab(window.location.search))
    window.addEventListener("popstate", follow)
    return () => window.removeEventListener("popstate", follow)
  }, [])
  const choose = (next: Tab) => {
    setTab(next)
    const url = new URL(window.location.href)
    url.searchParams.set("tab", next)
    if (next !== "sheets") for (const key of ["pin", "sheet", "btype", "pintab"]) url.searchParams.delete(key)
    window.history.replaceState(window.history.state, "", url)
  }
  const fromAdminPage = (key: AdminPageKey) => { if (key === "blueprint-upload") choose("sheets") }

  return (
    <>
      <div className="admin-page !pb-0">
        <div className="mb-4 inline-flex max-w-full flex-wrap gap-0.5 rounded-xl border border-line bg-surface p-1 shadow-sm" role="tablist" aria-label="Blueprint sections">
          {tabs.map(([key, label]) => (
            <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => choose(key)} className={`rounded-lg px-3.5 py-1.5 text-sm font-bold transition ${tab === key ? "bg-brand text-white" : "text-fg-muted hover:bg-surface-muted hover:text-fg"}`}>{label}</button>
          ))}
        </div>
      </div>
      {tab === "sheets" ? (
        <div className="admin-page">
          <PageHead eyebrow={`${pm.project?.code ?? "Project"} • Blueprints`} title="Blueprints"
            description={pm.canManage ? "Upload plans by blueprint type, add revisions and move a sheet to the right type. Engineers and Foremen only see the types you give them in Team & work access." : "The plans of this project by blueprint type. Plans open read-only."} />
          {pm.note ? <p role="status" className="mb-4 rounded-lg bg-surface-muted px-4 py-2 text-sm text-fg">{pm.note}</p> : null}
          {pm.project ? <SelectedProjectWorkspace key={pm.project.id} role="admin" canEdit={false} canUpload={pm.canManage} /> : null}
        </div>
      ) : tab === "mapping" ? <BlueprintMapping onNavigate={fromAdminPage} />
        : tab === "versions" ? <BlueprintVersionControl onNavigate={fromAdminPage} />
          : <BlueprintProgressTracking onNavigate={fromAdminPage} />}
    </>
  )
}
