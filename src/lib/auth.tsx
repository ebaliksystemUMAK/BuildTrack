import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import type { Session } from "@supabase/supabase-js"
import { invokeFunction } from "./functions"
import { setLoginNotice } from "./oauthIntent"
import { beginRecovery } from "./passwordRecovery"
import { FORCED_LOGOUT_NOTICE, shouldForceSignOut } from "./siteStatusModel"
import { supabase } from "./supabase"

export type AppRole = "super_admin" | "admin" | "project_manager" | "engineer" | "foreman" | "client" | "user"
export type UserStatus = "pending" | "active" | "rejected" | "disabled"
export type AdminPermission =
  | "users.view"
  | "users.create"
  | "users.edit"
  | "users.approve"
  | "users.disable"
  | "users.impersonate"
  | "biometrics.manage"
  | "projects.manage"
  | "blueprints.manage"
  | "photos.manage"

export type Discipline = "civil_structural" | "architectural" | "mep"

export type Profile = {
  id: string
  email: string
  full_name: string | null
  phone: string | null
  company: string | null
  position: string | null
  avatar_url: string | null
  discipline: Discipline | null
  role: AppRole | null
  status: UserStatus
  requested_role: "engineer" | "foreman" | "client" | null
  signup_provider: "email" | "google" | "admin" | null
  registration_completed_at: string | null
  email_verified_at?: string | null
  identity_status: "unverified" | "pending" | "verified" | "rejected"
  identity_verified_at: string | null
  force_logout_at?: string | null
  created_at: string
}

export type Impersonation = { adminName: string; targetName: string }

type AuthContextValue = {
  session: Session | null
  profile: Profile | null
  permissions: AdminPermission[]
  loading: boolean
  mfaRequired: boolean
  impersonation: Impersonation | null
  can: (permission: AdminPermission) => boolean
  signOut: () => Promise<void>
  refreshProfile: () => Promise<void>
  startImpersonation: (userId: string) => Promise<string | null>
  stopImpersonation: () => Promise<void>
}

const IMPERSONATION_KEY = "buildtrack.impersonation"

type SavedImpersonation = Impersonation & { access_token: string; refresh_token: string }

const readSaved = (): SavedImpersonation | null => {
  try {
    const raw = sessionStorage.getItem(IMPERSONATION_KEY)
    return raw ? (JSON.parse(raw) as SavedImpersonation) : null
  } catch {
    return null
  }
}

export const roleHomePath = (role: AppRole | null): string => {
  if (role === "super_admin" || role === "admin") return "/admin/dashboard"
  if (role === "project_manager") return "/pm/projects"
  if (role === "engineer") return "/engineer/projects"
  if (role === "foreman") return "/foreman/projects"
  if (role === "client") return "/client/projects"
  if (role === "user") return "/user/home"
  return "/login"
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [permissions, setPermissions] = useState<AdminPermission[]>([])
  const [loading, setLoading] = useState(true)
  const [aal, setAal] = useState<"aal1" | "aal2" | null>(null)
  const [impersonation, setImpersonation] = useState<Impersonation | null>(() => {
    const saved = readSaved()
    return saved ? { adminName: saved.adminName, targetName: saved.targetName } : null
  })

  const loadProfile = useCallback(async (userId: string | null) => {
    if (!userId) {
      setProfile(null)
      setPermissions([])
      setAal(null)
      return
    }
    const { data: assurance } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
    setAal((assurance?.currentLevel as "aal1" | "aal2" | null) ?? null)
    const { data } = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle()
    const loaded = (data as Profile | null) ?? null
    setProfile(loaded)
    if (loaded?.role === "admin") {
      const { data: rows } = await supabase
        .from("admin_permissions")
        .select("permission")
        .eq("user_id", userId)
      setPermissions((rows ?? []).map((row) => row.permission as AdminPermission))
    } else {
      setPermissions([])
    }
  }, [])

  useEffect(() => {
    let active = true
    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return
      setSession(data.session)
      await loadProfile(data.session?.user.id ?? null)
      if (active) setLoading(false)
    })
    const { data: listener } = supabase.auth.onAuthStateChange((event, next) => {
      if (event === "PASSWORD_RECOVERY") beginRecovery() // a reset link was opened: choose a new password before anything else
      setSession(next)
      // Defer: calling supabase inside this callback can deadlock the auth lock.
      setTimeout(() => void loadProfile(next?.user.id ?? null), 0)
    })
    return () => {
      active = false
      listener.subscription.unsubscribe()
    }
  }, [loadProfile])

  // The account can be approved, suspended or rejected by an administrator at any moment. Re-read it every 30 seconds and when the tab
  // gets focus: the screens react at once (and if the sessions were revoked, the next refresh signs the person out).
  const userId = session?.user.id ?? null
  useEffect(() => {
    if (!userId) return
    const refresh = () => {
      if (document.visibilityState === "visible") void loadProfile(userId)
    }
    const timer = window.setInterval(refresh, 30_000)
    window.addEventListener("focus", refresh)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener("focus", refresh)
    }
  }, [userId, loadProfile])

  // A Super Admin can sign non-admin accounts out (database function force_logout). The saved sign-in is already gone; this signs the open page out within
  // about 30 seconds (the profile is re-read above) instead of waiting for the next token refresh. Local sign-out only: nothing on the device is erased, so
  // anything saved offline stays in this device's queue and is sent after the same person signs in again.
  const forced = useRef(false)
  useEffect(() => {
    if (forced.current || !session || !profile) return
    if (!shouldForceSignOut(profile.force_logout_at, session.user.last_sign_in_at)) return
    forced.current = true
    setLoginNotice(FORCED_LOGOUT_NOTICE)
    void supabase.auth.signOut({ scope: "local" }).finally(() => window.location.assign("/login"))
  }, [session, profile])

  const signOut = useCallback(async () => {
    sessionStorage.removeItem(IMPERSONATION_KEY)
    sessionStorage.removeItem("buildtrack.project") // the next person starts on their own project list
    setImpersonation(null)
    await supabase.auth.signOut()
    window.location.assign("/login")
  }, [])

  const refreshProfile = useCallback(
    () => loadProfile(session?.user.id ?? null),
    [loadProfile, session],
  )

  const startImpersonation = useCallback(
    async (userId: string): Promise<string | null> => {
      const { data: current } = await supabase.auth.getSession()
      if (!current.session) return "Not signed in"
      const { data, error } = await invokeFunction<{
        token_hash: string
        target: { id: string; email: string; full_name: string | null; role: AppRole }
      }>("impersonate", { id: userId })
      if (error || !data) return error ?? "Impersonation failed"
      const saved: SavedImpersonation = {
        adminName: profile?.full_name ?? profile?.email ?? "Admin",
        targetName: data.target.full_name ?? data.target.email,
        access_token: current.session.access_token,
        refresh_token: current.session.refresh_token,
      }
      const { error: verifyError } = await supabase.auth.verifyOtp({
        token_hash: data.token_hash,
        type: "magiclink",
      })
      if (verifyError) return verifyError.message
      sessionStorage.setItem(IMPERSONATION_KEY, JSON.stringify(saved))
      window.location.assign(roleHomePath(data.target.role))
      return null
    },
    [profile],
  )

  const stopImpersonation = useCallback(async () => {
    const saved = readSaved()
    sessionStorage.removeItem(IMPERSONATION_KEY)
    if (saved) {
      await supabase.auth.setSession({
        access_token: saved.access_token,
        refresh_token: saved.refresh_token,
      })
    }
    window.location.assign("/admin/user-management")
  }, [])

  const isAdminRole = profile?.role === "super_admin" || profile?.role === "admin"
  const mfaRequired = profile?.status === "active" && isAdminRole && aal !== "aal2"

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      profile,
      permissions,
      loading,
      mfaRequired,
      impersonation,
      can: (permission) =>
        profile?.status === "active" &&
        !mfaRequired &&
        (profile.role === "super_admin" || (profile.role === "admin" && permissions.includes(permission))),
      signOut,
      refreshProfile,
      startImpersonation,
      stopImpersonation,
    }),
    [session, profile, permissions, loading, mfaRequired, impersonation, signOut, refreshProfile, startImpersonation, stopImpersonation],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (!context) throw new Error("useAuth must be used inside <AuthProvider>")
  return context
}
