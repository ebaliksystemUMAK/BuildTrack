import ProjectContextBar from "../../components/ProjectContextBar"
import WorkItemBoard from "../../components/qa/WorkItemBoard"
import WorkItemWorkspace from "../../components/qa/WorkItemWorkspace"
import { PageHead, buttonSecondary } from "../../components/ui/PageParts"
import { useAuth } from "../../lib/auth"
import { getSelectedProjectId } from "../../lib/projects"
import { useQaWorkspace } from "../../lib/qaWorkspace"
import { useItemParam, useWorkItems } from "../../lib/workItem"
import type { ForemanPageProps } from "./types"

// QA requests, one tile per work item (LAUNDRY → FLOOR): ready to submit, waiting for the Engineer, completed. Corrections have their
// own page. This page contains checklist QA only; historical inspections remain in the QA register.
export default function ForemanQualityControl({ onNavigate }: ForemanPageProps) {
  const { profile } = useAuth()
  const projectId = getSelectedProjectId()
  const ws = useQaWorkspace(projectId)
  const work = useWorkItems(projectId, ws.work.pins, ws.inspections, ws.defects)
  const [itemId, setItemId] = useItemParam()
  const mine = work.rows.filter((row) => row.pin.assigned_to === profile?.id)
  const corrections = mine.filter((row) => row.view.stage === "correction" || row.view.action === "open_ncr").length
  const groups = [
    { key: "submit", short: "To do", title: "Assigned tasks", hint: "Open an assigned task, add its photos and submit it for QA review. No Ready tick is needed.", rows: mine.filter((row) => row.view.action === "submit") },
    { key: "engineer", short: "Waiting", title: "Waiting for the Engineer", hint: "Requested, being inspected, or passed and waiting for the Engineer's decision.", rows: mine.filter((row) => row.view.owner === "Engineer" && row.view.stage !== "correction") },
    { key: "preparing", short: "Add evidence", title: "Photos needed", hint: "Open the item to add its photos, then submit for QA Review.", rows: mine.filter((row) => row.view.action === "add_evidence") },
    { key: "completed", short: "Completed", title: "Completed tasks", rows: mine.filter((row) => row.view.stage === "completed") },
  ]
  return (
    <div className="foreman-page">
      <ProjectContextBar listPath="/foreman/projects" listLabel="My projects" />
      <PageHead eyebrow="Quality assurance" title="Tasks"
        description="Open each item, add photos and submit for QA Review. The Engineer records the inspection, closes linked NCRs and manually completes the task. Earlier requests and corrections stay on record."
        actions={corrections ? <button type="button" className={buttonSecondary} onClick={() => onNavigate("issues")}>{corrections} correction{corrections === 1 ? "" : "s"} to do</button> : undefined} />
      {projectId ? <>
        <WorkItemBoard key={`${projectId}:${profile?.id}`} groups={groups} loading={work.loading || ws.loading} error={work.error} nameOf={ws.nameOf} sheetOf={ws.work.sheetOf} onOpen={setItemId}
          emptyTitle="No tasks assigned to you" emptyText="When the Engineer assigns work with tasks (e.g. FLOOR, WALL), each item appears here with its next action." />
      </> : null}
      {itemId ? <WorkItemWorkspace itemId={itemId} onClose={() => setItemId(null)} onChanged={async () => { await Promise.all([ws.reloadAll(), work.reload()]) }} /> : null}
    </div>
  )
}
