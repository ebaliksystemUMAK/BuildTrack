import QaView from "../../components/qa/QaView"
import { PageHead } from "../../components/ui/PageParts"
import { useQaWorkspace } from "../../lib/qaWorkspace"
import { usePmProject } from "./usePmProject"
import type { PmPageProps } from "./types"

// Quality monitoring for the Project Manager: inspections, the project's checklists, NCRs and the corrective work on them, with the
// same registers Engineers use, opened read-only. Inspection, verification and sign-off stay with the Engineers.
export default function PmQuality(_: PmPageProps) {
  const pm = usePmProject()
  const ws = useQaWorkspace(pm.project?.id ?? null)
  return (
    <div className="admin-page">
      <PageHead eyebrow={`${pm.project?.code ?? "Project"} • Quality & QA`} title="Quality & QA"
        description="Follow inspections, project checklists, NCRs and corrective work. Engineers inspect, verify and close; Foremen correct. This view is read-only." />
      <QaView ws={ws} mode="engineer" tabs={["overview", "inspections", "defects", "checklists"]} dateFilter readOnly />
    </div>
  )
}
