import { useMemo } from "react"
import { useAuth } from "../../lib/auth"
import { accessMessageTabs, allowedTabs } from "../../lib/systemControlModel"
import AccessReview from "./AccessReview"
import AdminTabs, { useTabAddress } from "./AdminTabs"
import Communications from "./Communications"
import InviteCodes from "./InviteCodes"
import type { AdminPageProps } from "./types"

type AccessTab = "invitations" | "access" | "messages"

// Invitations, Global access review and Announcements & messages, as tabs of one page. Each is the same page as before (nothing was removed); a tab appears only for
// someone with its permission, and the old addresses (/admin/invites, /admin/access-review, /admin/communications) open the matching tab.
export default function AccessMessages({ initialTab = "invitations", ...pageProps }: AdminPageProps & { initialTab?: AccessTab }) {
  const { profile, permissions } = useAuth()
  const isSuper = profile?.role === "super_admin"
  const tabs = useMemo(() => allowedTabs(accessMessageTabs, (need) => isSuper || (permissions as string[]).includes(need), isSuper) as Array<{ key: AccessTab; label: string }>, [permissions, isSuper])
  const [tab, setTab] = useTabAddress<AccessTab>("/admin/access-messages", tabs, initialTab)
  return (
    <AdminTabs
      eyebrow="People & access"
      title="Access & messages"
      description="Invitation codes, accounts that have not signed in for a while, and messages and announcements to people. Open a tab for what you need."
      label="Access and messages sections"
      tabs={tabs}
      tab={tab}
      onTab={setTab}
      empty="Your account has none of the permissions these tabs need (Review access requests, View users, Edit users). Ask a Super Admin to grant one."
    >
      {tab === "invitations" ? <InviteCodes {...pageProps} /> : null}
      {tab === "access" ? <AccessReview {...pageProps} /> : null}
      {tab === "messages" ? <Communications {...pageProps} /> : null}
    </AdminTabs>
  )
}
