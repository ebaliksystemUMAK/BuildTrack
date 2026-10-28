import { PageIntro } from "./AdminShell"
import type { AdminPageProps } from "./types"
import SelectedProjectWorkspace from "../../components/SelectedProjectWorkspace"
import { useAuth } from "../../lib/auth"
import { getSelectedProjectId } from "../../lib/projects"

// Always shown inside ProjectWorkspace, which already names the project, links back to all projects and to the
// project's other sections, and shows the project list when none is selected.
export default function BlueprintUpload(_props: AdminPageProps) {
  const { can } = useAuth()
  const projectId = getSelectedProjectId()

  return (
    <div className="admin-page">
      <PageIntro
        eyebrow="Blueprints • Admin"
        title="Blueprint Management"
        description="Upload plans by blueprint type and add revisions. Engineers and Foremen only see the types they are given in Project Management > Team & access."
      />
      {projectId ? <SelectedProjectWorkspace key={projectId} role="admin" canEdit={false} canUpload={can("blueprints.manage")} /> : null}
    </div>
  )
}
