import { useAuth } from "../../lib/auth"
import { useWorkQaHistory } from "../../lib/qaAttempts"
import { itemAttempts } from "../../lib/workItemModel"
import { submittedChecklistItems } from "../../lib/qaChecklistModel"
import type { Inspection } from "../../lib/qa"
import EvidenceCompare from "./EvidenceCompare"

export default function InspectionEvidenceComparisons({ inspection }: { inspection: Inspection }) {
  const { profile } = useAuth()
  const history = useWorkQaHistory(inspection.pin_id)
  if (!inspection.pin_id) return null
  if (history.loading) return <p role="status" className="text-sm text-fg-muted">Loading original and resubmitted photos…</p>
  if (history.error) return <p role="alert" className="text-sm text-danger-fg">Photo comparison unavailable: {history.error}</p>
  const submissions = history.submissions.filter(row => row.pin_id === inspection.pin_id)
  const selected = submissions.find(row => row.inspection_id === inspection.id)
  if (!selected) return null
  return <section aria-label="Request photo comparisons" className="space-y-4">
    <p className="text-sm text-fg-muted">Compare the original evidence with photos saved with this request before deciding QA. Later requests and unsent corrections are excluded.</p>
    {submittedChecklistItems(selected).map(item => {
      const attempts = itemAttempts(item.id, submissions, history.inspections)
      const index = attempts.findIndex(row => row.submission.id === selected.id)
      if (index < 1) return null
      // An old request must never show photos from a later resubmission.
      return <EvidenceCompare key={item.id} itemId={item.id} label={item.text} role={profile?.role} afterLabel="This request" attempts={[attempts[0].submission, selected]} />
    })}
  </section>
}
