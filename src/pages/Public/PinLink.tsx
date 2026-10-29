import { useEffect } from "react"
import { SkeletonPage } from "../../components/ui/Skeleton"
import { useAuth, type AppRole } from "../../lib/auth"

// Where each role should land when someone scans a pin's QR code (or opens a shared /pin link). The project and pin ride along.
const target: Record<AppRole, string> = {
  super_admin: "/admin/project-overview",
  admin: "/admin/project-overview",
  project_manager: "/pm/blueprints",
  engineer: "/engineer/annotation",
  foreman: "/foreman/dashboard",
  client: "/client/blueprint",
  user: "/user/home",
}

// Sends the signed-in person from /pin?project=..&pin=.. to the right screen for their role.
export default function PinLink() {
  const { profile } = useAuth()
  const role = profile?.role ?? null
  useEffect(() => {
    if (!role) return
    const project = new URLSearchParams(window.location.search).get("project")
    try {
      if (project) sessionStorage.setItem("buildtrack.project", project)
    } catch {
      // The ?project= parameter still carries it.
    }
    window.history.replaceState({}, "", `${target[role]}${window.location.search}`)
    window.dispatchEvent(new PopStateEvent("popstate"))
  }, [role])
  return (
    <div className="min-h-screen bg-surface-muted">
      <SkeletonPage />
    </div>
  )
}
