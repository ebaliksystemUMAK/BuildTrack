import AssignedProjects from "../../components/AssignedProjects"
import { PageHead } from "../../components/ui/PageParts"

export default function ClientProjects({ notice }: { notice?: string }) {
  return <div className="client-page">
    <PageHead eyebrow="Client portal" title="My projects" description="Choose a project to open its own overview, plans, calendar, site logs and communication." />
    {notice ? <p role="status" className="mb-4 rounded-lg border border-line bg-surface-muted px-4 py-3 text-sm text-fg-muted">{notice}</p> : null}
    <AssignedProjects title="Assigned to you" />
  </div>
}
