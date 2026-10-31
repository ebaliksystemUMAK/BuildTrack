import QaView from "../../components/qa/QaView"
import { PageHead } from "../../components/ui/PageParts"
import { useAuth } from "../../lib/auth"
import { useQaWorkspace } from "../../lib/qaWorkspace"
import type { AdminPageProps } from "./types"

// The company library of inspection checklists (Inspection and Test Plan sheets). Every project can use or copy them; only a Super
// Admin who has passed the authenticator check can add to or change the library. The built-in lists are read-only.
export default function AdminQaChecklists(_: AdminPageProps) {
  const { profile } = useAuth()
  const ws = useQaWorkspace(null)
  return (
    <div className="admin-page">
      <PageHead
        eyebrow="Quality assurance"
        title="QC Checklist Library"
        description="The company library every project can use. Engineers copy a list into their project to adapt it with the exact clauses of that project's specification. The pass mark, weights and standards are set under System Settings."
      />
      <QaView ws={ws} mode="engineer" tabs={["checklists"]} canEditLibrary={profile?.role === "super_admin"} />
    </div>
  )
}
