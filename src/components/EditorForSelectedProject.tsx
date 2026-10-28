import BlueprintEditor from "./editor/BlueprintEditor"
import type { EditorRole } from "./editor/Inspector"
import SelectedProjectWorkspace from "./SelectedProjectWorkspace"
import { PageHead, buttonSecondary } from "./ui/PageParts"
import { Skeleton } from "./ui/Skeleton"
import { getSelectedProjectId, useProject } from "../lib/projects"

// A plan page (Engineer annotation, Client blueprint). A link to a pin or sheet opens the full-window editor at once (it
// switches to that plan's type); otherwise the page starts at Blueprints > type > plans like every other plan view.
export default function EditorForSelectedProject({ role, canEdit, onExit, listLabel }: { role: EditorRole; canEdit: boolean; onExit: () => void; listLabel: string }) {
  const projectId = getSelectedProjectId()
  const { project, loading, notFound } = useProject(projectId)
  const params = new URLSearchParams(window.location.search)
  const deepLink = Boolean(params.get("pin") || params.get("sheet"))

  if (loading) return <Skeleton className="m-6 h-[70vh] rounded-xl" />
  if (!projectId || notFound || !project) {
    return (
      <div className="m-6 rounded-2xl border border-dashed border-line bg-surface p-10 text-center text-fg">
        <p className="mb-3">{notFound ? "This project does not exist or is not assigned to you." : "No project selected. Pick one of your projects to open its plans."}</p>
        <button type="button" onClick={onExit} className="rounded-lg bg-brand px-4 py-2 text-sm font-bold text-white hover:bg-brand-hover">{listLabel}</button>
      </div>
    )
  }
  if (deepLink) return <BlueprintEditor projectId={project.id} role={role} canEdit={canEdit} onExit={onExit} />
  return (
    <div className="mx-auto w-full max-w-[1840px] p-4 sm:p-6">
      <PageHead
        eyebrow={`${project.code} • Plans`}
        title="Blueprints"
        description={canEdit ? "Open a blueprint type, then a plan. You can edit the types an Admin gave you Assigned work access to; View only types open read-only." : "Open a blueprint type, then a plan, to follow the work on it."}
        actions={<button type="button" className={buttonSecondary} onClick={onExit}>{listLabel}</button>}
      />
      <SelectedProjectWorkspace role={role} canEdit={canEdit} />
    </div>
  )
}
