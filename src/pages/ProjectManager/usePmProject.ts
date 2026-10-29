import { useAuth } from "../../lib/auth"
import { myDesignation, pmAccess } from "../../lib/projectManagerModel"
import { useProjectManagers } from "../../lib/projectManagers"
import { getSelectedProjectId, useProject } from "../../lib/projects"

// The selected project of the Project Manager workspace and what the signed-in person may do on it (UI hint only: the
// database re-checks every change). Only the Project Manager role enters this workspace.
export function usePmProject() {
  const { profile } = useAuth()
  const projectId = getSelectedProjectId()
  const { project, loading, notFound } = useProject(projectId)
  const { managers, loading: managersLoading, reload: reloadManagers } = useProjectManagers(projectId)
  const designation = project ? myDesignation(managers, project.id, profile?.id) : null
  const access = pmAccess({ role: profile?.role, designation, archived: Boolean(project?.archived_at) })
  return {
    projectId,
    project: project && project.id === projectId ? project : null,
    loading: loading || managersLoading,
    notFound,
    managers,
    reloadManagers,
    designation,
    archived: Boolean(project?.archived_at),
    canManage: access.manage && !managersLoading,
    note: managersLoading ? null : access.note,
  }
}
