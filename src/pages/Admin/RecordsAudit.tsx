import { useMemo } from "react"
import { useAuth } from "../../lib/auth"
import { allowedTabs, recordsAuditTabs } from "../../lib/systemControlModel"
import AdminTabs, { useTabAddress } from "./AdminTabs"
import AuditLog from "./AuditLog"
import RecordsPage from "./Records"
import type { AdminPageProps } from "./types"

type RecordsTab = "audit" | "records"

// The Company audit log and Records (reversible removal of reports) as tabs of one page. Same pages as before: the audit log needs View users, Records is Super Admin
// only. The old addresses (/admin/audit-log, /admin/records) open the matching tab.
export default function RecordsAudit({ initialTab = "audit", ...pageProps }: AdminPageProps & { initialTab?: RecordsTab }) {
  const { profile, permissions } = useAuth()
  const isSuper = profile?.role === "super_admin"
  const tabs = useMemo(() => allowedTabs(recordsAuditTabs, (need) => isSuper || (permissions as string[]).includes(need), isSuper) as Array<{ key: RecordsTab; label: string }>, [permissions, isSuper])
  const [tab, setTab] = useTabAddress<RecordsTab>("/admin/records-audit", tabs, initialTab)
  return (
    <AdminTabs
      eyebrow="Company"
      title="Company Records and Audits"
      description="The full audit trail of what happened in the system, and the Super Admin tool to remove a report from view and restore it. Nothing here is ever edited or deleted."
      label="Records and audits sections"
      tabs={tabs}
      tab={tab}
      onTab={setTab}
      empty="You need the View users permission to read the audit log. Ask a Super Admin to grant it."
    >
      {tab === "audit" ? <AuditLog {...pageProps} /> : null}
      {tab === "records" ? <RecordsPage {...pageProps} /> : null}
    </AdminTabs>
  )
}
