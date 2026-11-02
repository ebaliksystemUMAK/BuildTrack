import { useEffect, useRef, useState, type ReactNode } from "react"
import type { Page } from "../App"
import { adminPagePermission } from "../pages/Admin/AdminShell"
import type { AdminPageKey } from "../pages/Admin/types"
import { SkeletonPage } from "./ui/Skeleton"
import MfaPage from "../pages/Auth/MfaPage"
import { useAuth, type AppRole } from "../lib/auth"
import { invokeFunction } from "../lib/functions"
import { GATE_FAILED_MESSAGE, NO_ACCOUNT_MESSAGE, clearOAuthIntent, readOAuthIntent, setLoginNotice } from "../lib/oauthIntent"
import { endRecovery, useRecovering } from "../lib/passwordRecovery"
import { PM_WORKSPACE_ROLES, adminToPmPath } from "../lib/projectRoutes"
import { supabase } from "../lib/supabase"

const homeFor = (role: AppRole | null): Page => {
  if (role === "super_admin" || role === "admin") return "admin/dashboard"
  if (role === "project_manager") return "pm/projects"
  if (role === "engineer") return "engineer/projects"
  if (role === "foreman") return "foreman/projects"
  if (role === "client") return "client/overview"
  if (role === "user") return "user/home"
  return "login"
}

const areaOf = (page: Page) => page.split("/")[0]

const RETURN_KEY = "buildtrack.returnTo"

export const rolesForArea: Record<string, AppRole[]> = {
  attendance: ["super_admin", "admin", "engineer", "foreman"],
  "pin-link": ["super_admin", "admin", "project_manager", "engineer", "foreman", "client", "user"],
  admin: ["super_admin", "admin"],
  pm: [...PM_WORKSPACE_ROLES],
  engineer: ["engineer"],
  foreman: ["foreman"],
  client: ["client"],
  user: ["user"],
}

function Screen({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-brand-soft p-6">
      <div className="w-full max-w-md rounded-2xl bg-surface p-8 text-center shadow-lg">{children}</div>
    </div>
  )
}

function ImpersonationBanner() {
  const { impersonation, stopImpersonation } = useAuth()
  if (!impersonation) return null
  return (
    <div className="fixed inset-x-0 top-0 z-[1000] flex items-center justify-center gap-4 bg-accent px-4 py-2 text-sm font-semibold text-black">
      <span>
        Viewing as {impersonation.targetName} (signed in by {impersonation.adminName})
      </span>
      <button
        className="rounded-md bg-white px-3 py-1 text-[#68135f]"
        onClick={() => void stopImpersonation()}
      >
        Return to my account
      </button>
    </div>
  )
}

export default function RouteGuard({
  page,
  navigate,
  children,
}: {
  page: Page
  navigate: (page: Page) => void
  children: ReactNode
}) {
  const { session, profile, loading, can, signOut, mfaRequired } = useAuth()
  const isPublic = page === "home" || page === "login" || page === "register" || page === "forgot-password" || page === "reset-password"
  // A reset link or code signs the person in with a one-time session: until a new password is saved they stay on the reset screen, never in a workspace.
  const recovering = useRecovering() && Boolean(session)
  const active = profile?.status === "active"
  // A Google account that has not submitted its registration yet has no access: it can only finish registering.
  const unregistered = Boolean(session) && profile?.status === "pending" && !profile.registration_completed_at
  // Right after Google sign-in from the LOGIN page: check the account before showing anything (see lib/oauthIntent.ts).
  const [gate, setGate] = useState<"idle" | "checking">(() => (readOAuthIntent() === "login" ? "checking" : "idle"))
  const gateRan = useRef(false)
  const pendingExitRan = useRef(false)

  useEffect(() => {
    if (loading || gateRan.current) return
    const intent = readOAuthIntent()
    if (!intent) {
      setGate("idle")
      return
    }
    if (!session) {
      // Google was cancelled or failed: forget the note.
      clearOAuthIntent()
      setGate("idle")
      return
    }
    gateRan.current = true
    clearOAuthIntent()
    if (intent === "register") {
      setGate("idle")
      return
    }
    const leave = async (message: string) => {
      setLoginNotice(message)
      await supabase.auth.signOut()
      window.location.assign("/login")
    }
    void (async () => {
      if (!profile) return leave(GATE_FAILED_MESSAGE)
      if (unregistered) {
        const { data, error } = await invokeFunction<{ removed: boolean }>("oauth-gate", {})
        if (error || !data) return leave(GATE_FAILED_MESSAGE)
        if (data.removed) return leave(NO_ACCOUNT_MESSAGE)
      }
      setGate("idle")
    })()
  }, [loading, session, profile, unregistered])
  const area = areaOf(page)
  const allowed = !isPublic && active && !!profile?.role && rolesForArea[area]?.includes(profile.role)

  useEffect(() => {
    if (loading || gate === "checking") return
    if (recovering) {
      if (page !== "reset-password") navigate("reset-password")
      return
    }
    if (session && unregistered && page !== "register") {
      navigate("register")
      return
    }
    if (!session && !isPublic) {
      // A pin link opened while signed out: remember it and finish it after sign-in.
      if (page === "pin-link" || page === "attendance") {
        try {
          sessionStorage.setItem(RETURN_KEY, window.location.pathname + window.location.search)
        } catch {
          // Without storage the person lands on their home screen after signing in.
        }
      }
      navigate("login")
    } else if (session && active && (page === "login" || page === "register" || page === "forgot-password" || page === "reset-password")) {
      let back: string | null = null
      try {
        back = sessionStorage.getItem(RETURN_KEY)
        sessionStorage.removeItem(RETURN_KEY)
      } catch {
        back = null
      }
      if (back && (back.startsWith("/pin") || back === "/attendance" || back.startsWith("/attendance?"))) {
        window.history.replaceState({}, "", back)
        window.dispatchEvent(new PopStateEvent("popstate"))
      } else navigate(homeFor(profile?.role ?? null))
    }
    else if (session && active && !isPublic && !allowed) {
      // A Project Manager opening an Admin project link (shared plan or pin link) continues in their own workspace.
      const pmTarget = profile?.role === "project_manager" && area === "admin" ? adminToPmPath(window.location.pathname, window.location.search) : null
      if (pmTarget) {
        window.history.replaceState({}, "", pmTarget)
        window.dispatchEvent(new PopStateEvent("popstate"))
      } else navigate(homeFor(profile?.role ?? null))
    }
  }, [loading, gate, session, unregistered, active, isPublic, allowed, page, profile, navigate, area, recovering])

  // A completed pending registration never gets a workspace or the old full-page approval screen.
  // An incomplete Google registration is the one exception: it must stay signed in long enough to
  // finish the registration form. Once completed, its session is ended and it returns to Login.
  useEffect(() => {
    if (loading || pendingExitRan.current || !session || profile?.status !== "pending" || unregistered || recovering) return
    pendingExitRan.current = true
    setLoginNotice("Your registration is awaiting administrator approval. You will be able to sign in after your access is approved.")
    void supabase.auth.signOut().finally(() => window.location.assign("/login"))
  }, [loading, session, profile?.status, unregistered, recovering])

  if (loading || (gate === "checking" && Boolean(session))) {
    return (
      <div className="min-h-screen bg-surface-muted" role="status" aria-label="Checking your account">
        <SkeletonPage />
      </div>
    )
  }

  if (session && profile?.status === "pending" && !unregistered && !recovering) {
    return <div className="min-h-screen bg-surface-muted" role="status" aria-label="Returning to login"><SkeletonPage /></div>
  }

  if (recovering && page !== "reset-password") {
    return <div className="min-h-screen bg-surface-muted" role="status" aria-label="Opening password reset"><SkeletonPage /></div>
  }

  if (session && unregistered && page !== "register" && !recovering) {
    return <div className="min-h-screen bg-surface-muted" role="status" aria-label="Opening registration"><SkeletonPage /></div>
  }

  let content: ReactNode = children
  if (session && mfaRequired && page !== "home") {
    content = <MfaPage />
  } else if (unregistered && page === "register") {
    content = children
  } else if (session && !active && (!isPublic || page === "login" || page === "register")) {
    const status = profile?.status
    const screen =
      status === "rejected"
          ? {
              title: "Registration not approved",
              tone: "#d93a3a",
              message: "An administrator did not approve this registration. If you think this is a mistake, contact Valencia Construction Services and ask them to review it.",
            }
          : status === "disabled"
            ? {
                title: "Account suspended",
                tone: "#d93a3a",
                message: "Your account has been suspended, so you cannot use BuildTrack for now. Contact your administrator to have access restored.",
              }
            : {
                title: "Profile unavailable",
                tone: "#d93a3a",
                message: "We could not load your profile. Please sign out and try again.",
              }
    content = (
      <Screen>
        <div
          className="mx-auto mb-4 h-2 w-16 rounded-full"
          style={{ backgroundColor: screen.tone }}
          aria-hidden="true"
        />
        <h1 className="mb-1 text-xl font-extrabold text-brand-strong">{screen.title}</h1>
        <p className="mb-1 text-xs text-fg-muted">{profile?.email}</p>
        <p className="mb-6 mt-3 text-sm text-fg">{screen.message}</p>
        <button
          className="rounded-lg bg-brand px-5 py-2 font-semibold text-white hover:bg-brand-hover"
          onClick={() => void signOut()}
        >
          Sign out
        </button>
      </Screen>
    )
  } else if (!isPublic && (!session || !allowed)) {
    content = null
  } else if (allowed && area === "admin") {
    const key = page.replace("admin/", "") as AdminPageKey
    const need = adminPagePermission[key]
    if (need && !can(need)) {
      content = (
        <Screen>
          <h1 className="mb-3 text-xl font-bold text-brand-strong">No access</h1>
          <p className="mb-6 text-sm text-fg">
            Your account does not have permission to open this page. Ask a Super Admin to grant it.
          </p>
          <button
            className="rounded-lg bg-brand px-5 py-2 font-semibold text-white"
            onClick={() => navigate("admin/dashboard")}
          >
            Back to dashboard
          </button>
        </Screen>
      )
    }
  }

  return (
    <>
      <ImpersonationBanner />
      {content}
    </>
  )
}
