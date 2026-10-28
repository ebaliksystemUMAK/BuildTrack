import ProjectContextBar from "../../components/ProjectContextBar"
import QaView from "../../components/qa/QaView"
import { PageHead } from "../../components/ui/PageParts"
import { getSelectedProjectId } from "../../lib/projects"
import { useQaWorkspace } from "../../lib/qaWorkspace"
import type { EngineerPageProps } from "./types"

// Checklist configuration: the inspection criteria (measurements, material checks, workmanship) that work items and stage /
// hold-point inspections are inspected against. Configuration only: requests and reviews happen elsewhere.
export default function EngineerChecklists(_: EngineerPageProps) {
  const projectId = getSelectedProjectId()
  const ws = useQaWorkspace(projectId)
  return (
    <div className="engineer-page">
      <ProjectContextBar listPath="/engineer/projects" listLabel="My projects" />
      <PageHead eyebrow="Quality assurance" title="Checklist configuration"
        description="The checklists this project uses: add them from the company library and adapt them, or create your own, with the standards they cite. Only these are offered when you set a work item's criteria on the plan or request an inspection. The Foreman adds evidence and submits directly for QA." />
      {projectId ? <QaView ws={ws} mode="engineer" tabs={["checklists"]} /> : null}
    </div>
  )
}
