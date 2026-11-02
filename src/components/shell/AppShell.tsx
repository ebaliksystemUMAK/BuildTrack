import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { PrivacyNoticeModal } from "../PrivacyNotice"
import MyDataModal from "../MyDataModal"
import NotificationBell from "../NotificationBell"
import { FeatureLockNotice } from "../SiteStatusNotice"
import AdminIcon, { type AdminIconName } from "../../pages/Admin/AdminIcon"
import CommandPalette, { type PaletteAction, type PaletteSearch } from "./CommandPalette"
import { PageGuideButton, PageGuideModal } from "./PageGuide"
import { guideFor } from "../../lib/pageGuides"
import { searchProject, type SearchRole } from "../../lib/projectSearch"
import { followLink } from "../../lib/notifications"
import { getSelectedProjectId } from "../../lib/projects"
import { useAuth, type AppRole } from "../../lib/auth"
import { identityStatusLabel, identityTone } from "../../lib/identityModel"
import { useTheme, type ThemeMode } from "../../lib/theme"
import logo from "../../assets/valencia/logo-source.png"

export type ShellNavItem = { key: string; label: string; icon: AdminIconName; badge?: number }
export type ShellNavGroup = { label: string; items: ShellNavItem[] }
// Each workspace has its own identity (accent, sidebar, page headers); the colours live in index.css under [data-persona].
export type ShellPersona = "admin" | "manager" | "engineer" | "foreman" | "client" | "user"

const roleName: Record<AppRole, string> = { super_admin: "Super Admin", admin: "Administrator", project_manager: "Project Manager", engineer: "Engineer", foreman: "Foreman", client: "Client", user: "Basic account" }
const COLLAPSE_KEY = "buildtrack.sidebar.collapsed"
const HIDDEN_KEY = "buildtrack.sidebar.hidden"

const initials = (value: string) => value.split(/\s+|@/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "BT"

function usePersistedCollapse(key: string = COLLAPSE_KEY): [boolean, (value: boolean) => void] {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(key) === "1"
    } catch {
      return false
    }
  })
  const update = (value: boolean) => {
    setCollapsed(value)
    try {
      localStorage.setItem(key, value ? "1" : "0")
    } catch {
      // The choice just is not remembered.
    }
  }
  return [collapsed, update]
}

function Avatar({ size = 36 }: { size?: number }) {
  const { profile } = useAuth()
  const name = profile?.full_name || profile?.email || "BuildTrack"
  return profile?.avatar_url ? (
    <img src={profile.avatar_url} alt="" referrerPolicy="no-referrer" style={{ width: size, height: size }} className="flex-none rounded-full object-cover ring-2 ring-white/20" />
  ) : (
    <span style={{ width: size, height: size }} className="bt-avatar flex flex-none items-center justify-center rounded-full text-xs font-extrabold text-white ring-2 ring-white/20" aria-hidden="true">{initials(name)}</span>
  )
}

const themeOptions: Array<{ mode: ThemeMode; label: string; icon: AdminIconName }> = [
  { mode: "light", label: "Light", icon: "sun" },
  { mode: "dark", label: "Dark", icon: "moon" },
  { mode: "system", label: "Auto", icon: "panel" },
]

function ThemeSwitch() {
  const { mode, setMode } = useTheme()
  return (
    <div role="radiogroup" aria-label="Color theme" className="flex gap-1 rounded-xl bg-surface-muted p-1">
      {themeOptions.map((option) => (
        <button key={option.mode} type="button" role="radio" aria-checked={mode === option.mode} onClick={() => setMode(option.mode)} className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-bold ${mode === option.mode ? "bg-surface text-brand-text shadow-sm" : "text-fg-muted hover:text-fg"}`}>
          <span className="h-3.5 w-3.5 [&>svg]:h-3.5 [&>svg]:w-3.5"><AdminIcon name={option.icon} /></span>
          {option.label}
        </button>
      ))}
    </div>
  )
}

function UserMenu({ onPrivacy, onMyData }: { onPrivacy: () => void; onMyData: () => void }) {
  const { profile, signOut } = useAuth()
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => !root.current?.contains(event.target as Node) && setOpen(false)
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false)
    document.addEventListener("mousedown", onDown)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("mousedown", onDown)
      document.removeEventListener("keydown", onKey)
    }
  }, [open])
  if (!profile) return null
  const name = profile.full_name || profile.email
  return (
    <div ref={root} className="relative">
      <button type="button" onClick={() => setOpen((value) => !value)} aria-haspopup="menu" aria-expanded={open} aria-label="Account menu" className="flex items-center gap-2 rounded-xl p-1 pr-2 transition hover:bg-surface-muted">
        <Avatar size={34} />
        <span className="hidden max-w-[10rem] text-left leading-tight xl:block"><span className="block truncate text-sm font-bold">{name}</span><span className="block truncate text-[11px] text-fg-muted">{roleName[profile.role ?? "user"]}</span></span>
      </button>
      {open ? (
        <div role="menu" className="bt-pop absolute right-0 top-12 z-50 w-72 overflow-hidden rounded-2xl border border-line bg-surface text-fg shadow-2xl">
          <div className="flex items-center gap-3 border-b border-line p-4">
            <Avatar size={44} />
            <div className="min-w-0"><p className="truncate text-sm font-extrabold">{name}</p><p className="truncate text-xs text-fg-muted">{profile.email}</p>
              <div className="mt-1 flex flex-wrap gap-1.5"><span className="rounded-full bg-brand-soft px-2 py-0.5 text-[11px] font-extrabold text-brand-text">{roleName[profile.role ?? "user"]}</span><span className={`rounded-full px-2 py-0.5 text-[11px] font-extrabold ${identityTone[profile.identity_status]}`}>{identityStatusLabel[profile.identity_status]}</span></div>
            </div>
          </div>
          <div className="space-y-2 p-3"><p className="text-[11px] font-extrabold uppercase tracking-wider text-fg-muted">Appearance</p><ThemeSwitch /></div>
          <div className="border-t border-line p-1.5">
            <button type="button" role="menuitem" onClick={() => { setOpen(false); onPrivacy() }} className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm font-semibold hover:bg-surface-muted"><span className="h-4 w-4 [&>svg]:h-4 [&>svg]:w-4"><AdminIcon name="shield" /></span>Data privacy</button>
            {profile.role === "super_admin" || profile.role === "admin" ? null : <button type="button" role="menuitem" onClick={() => { setOpen(false); onMyData() }} className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm font-semibold hover:bg-surface-muted"><span className="h-4 w-4 [&>svg]:h-4 [&>svg]:w-4"><AdminIcon name="trash" /></span>Delete my data</button>}
            <button type="button" role="menuitem" onClick={() => void signOut()} className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm font-semibold text-danger-fg hover:bg-surface-muted"><span className="h-4 w-4 [&>svg]:h-4 [&>svg]:w-4"><AdminIcon name="logout" /></span>Sign out</button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

// One premium layout for every signed-in workspace: a dark navigation rail (collapsible), a frosted top bar with search (Ctrl+K), a
// notification bell and an account menu, a phone drawer and a bottom tab bar. Each role only supplies its navigation and context.
export default function AppShell({
  persona,
  workspace,
  groups,
  active,
  onNavigate,
  project,
  projectEmpty = "No project selected",
  mobileTabs = [],
  banner,
  topExtra,
  onAllProjects,
  children,
}: {
  persona: ShellPersona
  workspace: string
  groups: ShellNavGroup[]
  active: string
  onNavigate: (key: string) => void
  project?: { code: string; name: string; sub?: string } | null
  projectEmpty?: string
  mobileTabs?: string[]
  banner?: ReactNode
  topExtra?: ReactNode
  // Set by workspaces that work one project at a time: the rail starts with that project and a way back to the list.
  onAllProjects?: () => void
  children: ReactNode
}) {
  const { profile, signOut } = useAuth()
  const { mode, setMode } = useTheme()
  const [collapsed, setCollapsed] = usePersistedCollapse()
  // The whole sidebar can slide away like a drawer on a computer (the top bar button brings it back); "collapsed" is the narrower icons-only rail.
  const [hidden, setHidden] = usePersistedCollapse(HIDDEN_KEY)
  const [drawer, setDrawer] = useState(false)
  const [palette, setPalette] = useState(false)
  const [privacy, setPrivacy] = useState(false)
  const [myData, setMyData] = useState(false)
  const [guideOpen, setGuideOpen] = useState(false)

  const all = useMemo(() => groups.flatMap((group) => group.items), [groups])
  const current = all.find((item) => item.key === active)
  // Instructions for the open page (lib/pageGuides.ts), for every workspace.
  const guide = guideFor(persona, active)
  const go = useCallback((key: string) => {
    setDrawer(false)
    onNavigate(key)
  }, [onNavigate])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault()
        setPalette((value) => !value)
      } else if (event.key === "Escape") setDrawer(false)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  const canEraseOwn = Boolean(profile) && profile?.role !== "super_admin" && profile?.role !== "admin"
  const actions: PaletteAction[] = useMemo(() => [
    { id: "guide", label: "Guide for this page", icon: "help", run: () => setGuideOpen(true) },
    { id: "theme", label: mode === "dark" ? "Switch to the light theme" : "Switch to the dark theme", icon: mode === "dark" ? "sun" : "moon", run: () => setMode(mode === "dark" ? "light" : "dark") },
    { id: "privacy", label: "Read the data privacy notice", icon: "shield", run: () => setPrivacy(true) },
    ...(canEraseOwn ? [{ id: "mydata", label: "Delete my data", icon: "trash" as const, run: () => setMyData(true) }] : []),
    { id: "signout", label: "Sign out", icon: "logout", run: () => void signOut() },
  ], [mode, setMode, signOut, canEraseOwn])

  // Search inside the selected project for roles that work in one (admins have no per-project screens for these).
  const searchRole = profile?.role === "engineer" || profile?.role === "foreman" || profile?.role === "client" ? (profile.role as SearchRole) : null
  const projectId = palette ? getSelectedProjectId() : null
  const projectLabel = project?.name ?? null
  const paletteSearch = useMemo<PaletteSearch | undefined>(
    () => (searchRole && projectId ? { projectName: projectLabel, run: (text) => searchProject(projectId, text, searchRole), open: (hit) => followLink(hit.path, projectId) } : undefined),
    [searchRole, projectId, projectLabel],
  )

  const tabs = mobileTabs.map((key) => all.find((item) => item.key === key)).filter((item): item is ShellNavItem => Boolean(item))
  const side = hidden ? "0rem" : collapsed ? "4.75rem" : "17rem"

  const projectHeader = (compact: boolean) => (onAllProjects && project ? (
    compact ? (
      <div className="px-3 pb-2">
        <button type="button" onClick={() => { setDrawer(false); onAllProjects() }} title={`${project.code} • ${project.name}. Back to all projects`} aria-label="Back to all projects" className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl bg-white/10 text-[11px] font-extrabold text-white/85 hover:bg-white/20">{project.code.slice(-3)}</button>
      </div>
    ) : (
      <div className="mx-3 mb-1 rounded-xl border border-white/10 bg-white/[0.06] p-3">
        <button type="button" onClick={() => { setDrawer(false); onAllProjects() }} className="mb-2 inline-flex min-h-6 items-center gap-1 text-[11px] font-extrabold uppercase tracking-wider text-white/70 hover:text-white">
          <span aria-hidden="true">←</span> All projects
        </button>
        <p className="bt-persona-light text-[11px] font-extrabold uppercase tracking-wider">{project.code}</p>
        <p className="mt-0.5 line-clamp-2 text-sm font-bold text-white">{project.name}</p>
        {project.sub ? <p className="truncate text-xs text-white/60">{project.sub}</p> : null}
      </div>
    )
  ) : null)

  const nav = (compact: boolean) => (
    <nav aria-label={`${workspace} navigation`} className="flex-1 space-y-5 overflow-y-auto px-3 py-2">
      {groups.map((group) => (
        <div key={group.label}>
          {!compact ? <p className="mb-1.5 px-3 text-[11px] font-extrabold uppercase tracking-[0.14em] text-white/55">{group.label}</p> : <div className="mx-3 mb-2 h-px bg-white/10" aria-hidden="true" />}
          <ul className="space-y-0.5">
            {group.items.map((item) => {
              const isActive = item.key === active
              return (
                <li key={item.key}>
                  <button
                    type="button"
                    onClick={() => go(item.key)}
                    aria-current={isActive ? "page" : undefined}
                    title={compact ? item.label : undefined}
                    className={`group relative flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[13px] font-semibold transition ${compact ? "justify-center" : ""} ${isActive ? "bt-nav-active text-white" : "text-white/80 hover:bg-white/[0.07] hover:text-white"}`}
                  >
                    {isActive ? <span className="bt-nav-bar absolute inset-y-2 left-0 w-[3px] rounded-full" aria-hidden="true" /> : null}
                    <span className={`h-[18px] w-[18px] flex-none [&>svg]:h-[18px] [&>svg]:w-[18px] ${isActive ? "bt-persona-light" : "text-white/65 group-hover:text-white"}`}><AdminIcon name={item.icon} /></span>
                    {!compact ? <span className="min-w-0 flex-1 truncate">{item.label}</span> : null}
                    {item.badge ? (
                      compact ? <span className="absolute right-2 top-1.5 h-2.5 w-2.5 rounded-full bg-[#F18B00] ring-2 ring-[#15101a]" aria-label={`${item.badge} waiting`} /> : <span className="min-w-[22px] rounded-full bg-[#F18B00] px-1.5 py-0.5 text-center text-[11px] font-extrabold leading-none text-black">{item.badge > 99 ? "99+" : item.badge}</span>
                    ) : null}
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </nav>
  )

  const brand = (compact: boolean) => (
    <div className={`flex items-center gap-3 px-4 py-4 ${compact ? "justify-center" : ""}`}>
      <img src={logo} alt="Valencia Construction Services" className="h-10 w-10 flex-none rounded-full border-2 border-white/25 object-cover" />
      {!compact ? <div className="min-w-0 leading-tight"><p className="truncate text-[15px] font-extrabold tracking-tight text-white">BuildTrack</p><p className="bt-persona-light truncate text-[11px] font-extrabold uppercase tracking-[0.12em]">{workspace}</p></div> : null}
    </div>
  )

  const footer = (compact: boolean, withRailControls = false) => (
    <div className="space-y-3 border-t border-white/10 p-3">
      {project !== undefined && !onAllProjects ? (
        compact ? (
          <div title={project ? `${project.code} • ${project.name}` : projectEmpty} className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl bg-white/10 text-[11px] font-extrabold text-white/80">{project ? project.code.slice(-3) : "-"}</div>
        ) : (
          <div className="rounded-xl border border-white/10 bg-white/[0.06] p-3">
            <p className="bt-persona-light text-[11px] font-extrabold uppercase tracking-wider">Active project</p>
            {project ? <><p className="mt-1 truncate text-sm font-bold text-white">{project.name}</p><p className="truncate text-xs text-white/60">{project.code}{project.sub ? ` • ${project.sub}` : ""}</p></> : <p className="mt-1 text-xs text-white/60">{projectEmpty}</p>}
          </div>
        )
      ) : null}
      <div className={`flex items-center gap-3 ${compact ? "justify-center" : ""}`}>
        <Avatar size={36} />
        {!compact ? <div className="min-w-0 flex-1 leading-tight"><p className="truncate text-[13px] font-bold text-white">{profile?.full_name || profile?.email}</p><p className="truncate text-[11px] text-white/60">{workspace}</p></div> : null}
      </div>
      {withRailControls ? (
        <div className={`flex gap-2 ${compact ? "flex-col items-center" : ""}`}>
          <button type="button" onClick={() => setCollapsed(!collapsed)} aria-pressed={collapsed} title={collapsed ? "Show the full menu" : "Show icons only"} aria-label={collapsed ? "Show the full menu" : "Show icons only"} className="inline-flex min-h-8 flex-1 items-center justify-center rounded-lg border border-white/15 px-2 text-[11px] font-bold text-white/80 hover:bg-white/10">{compact ? "»" : "Icons only"}</button>
          <button type="button" onClick={() => setHidden(true)} title="Hide the menu" aria-label="Hide the menu" className="inline-flex min-h-8 flex-1 items-center justify-center rounded-lg border border-white/15 px-2 text-[11px] font-bold text-white/80 hover:bg-white/10">{compact ? "«" : "Hide menu"}</button>
        </div>
      ) : null}
    </div>
  )

  const railClasses = "bt-rail"

  return (
    <div data-persona={persona} className="bt-workspace min-h-dvh bg-surface-muted text-fg" style={{ ["--bt-side" as string]: side }}>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[200] focus:rounded-lg focus:bg-brand focus:px-4 focus:py-2 focus:text-sm focus:font-bold focus:text-white">Skip to content</a>

      {/* Desktop rail */}
      <aside aria-label="Sidebar" aria-hidden={hidden} inert={hidden} className={`fixed inset-y-0 left-0 z-40 hidden flex-col border-r border-white/10 text-white transition-[width,transform] duration-200 lg:flex ${railClasses} ${hidden ? "pointer-events-none -translate-x-full" : "translate-x-0"}`} style={{ width: hidden ? "17rem" : side }}>
        {brand(collapsed)}
        {projectHeader(collapsed)}
        {nav(collapsed)}
        {footer(collapsed, true)}
      </aside>

      {/* Phone drawer */}
      <div className={`fixed inset-0 z-50 lg:hidden ${drawer ? "" : "pointer-events-none"}`} aria-hidden={!drawer}>
        <button type="button" tabIndex={drawer ? 0 : -1} aria-label="Close menu" onClick={() => setDrawer(false)} className={`absolute inset-0 bg-black/55 transition-opacity ${drawer ? "opacity-100" : "opacity-0"}`} />
        <aside className={`absolute inset-y-0 left-0 flex w-[min(20rem,86vw)] flex-col text-white shadow-2xl transition-transform duration-200 ${railClasses} ${drawer ? "translate-x-0" : "-translate-x-full"}`}>
          {brand(false)}
          {projectHeader(false)}
          {nav(false)}
          {footer(false)}
        </aside>
      </div>

      <div className="min-w-0 overflow-x-clip lg:pl-[var(--bt-side)] lg:transition-[padding] lg:duration-200">
        <header className="bt-topbar sticky top-0 z-30 flex h-16 items-center gap-2 border-b border-line bg-surface/85 px-3 backdrop-blur-xl sm:px-5 lg:px-8">
          <button type="button" onClick={() => setDrawer(true)} aria-label="Open menu" className="grid h-10 w-10 place-items-center rounded-xl hover:bg-surface-muted lg:hidden"><span className="h-5 w-5 [&>svg]:h-5 [&>svg]:w-5"><AdminIcon name="menu" /></span></button>
          <button type="button" onClick={() => setHidden(!hidden)} aria-label={hidden ? "Show the menu" : "Hide the menu"} aria-pressed={hidden} title={hidden ? "Show the menu" : "Hide the menu"} className="hidden h-10 w-10 place-items-center rounded-xl text-fg-muted hover:bg-surface-muted hover:text-fg lg:grid"><span className="h-5 w-5 [&>svg]:h-5 [&>svg]:w-5"><AdminIcon name="panel" /></span></button>
          <div className="min-w-0 flex-1 leading-tight">
            <p className="bt-persona-text truncate text-[11px] font-extrabold uppercase tracking-wider">{onAllProjects && project ? `${workspace} · ${project.code}` : workspace}</p>
            <p className="truncate text-base font-extrabold sm:text-lg">{current?.label ?? "BuildTrack"}</p>
          </div>
          {topExtra}
          <PageGuideButton title={guide.title} onOpen={() => setGuideOpen(true)} />
          <button type="button" onClick={() => setPalette(true)} className="hidden h-10 w-64 items-center gap-2 rounded-xl border border-line bg-surface-muted px-3 text-sm text-fg-muted transition hover:border-brand md:flex" aria-label="Search or jump to a page (Ctrl K)">
            <span className="h-4 w-4 [&>svg]:h-4 [&>svg]:w-4"><AdminIcon name="search" /></span>
            <span className="flex-1 text-left">Jump to...</span>
            <kbd className="rounded border border-line bg-surface px-1.5 py-0.5 text-[11px] font-bold">Ctrl K</kbd>
          </button>
          <button type="button" onClick={() => setPalette(true)} aria-label="Search" className="grid h-10 w-10 place-items-center rounded-xl hover:bg-surface-muted md:hidden"><span className="h-5 w-5 [&>svg]:h-5 [&>svg]:w-5"><AdminIcon name="search" /></span></button>
          <NotificationBell onSurface />
          <UserMenu onPrivacy={() => setPrivacy(true)} onMyData={() => setMyData(true)} />
        </header>

        <main id="main" tabIndex={-1} className="px-[clamp(12px,2vw,32px)] pb-28 pt-5 outline-none lg:pb-10">
          {banner}
          <FeatureLockNotice persona={persona} page={active} />
          {children}
        </main>
      </div>

      {tabs.length ? (
        <nav aria-label="Quick navigation" className="bt-tabbar fixed inset-x-0 bottom-0 z-40 flex border-t border-white/10 pb-[env(safe-area-inset-bottom)] text-white shadow-[0_-8px_24px_-12px_rgba(0,0,0,0.6)] backdrop-blur-xl lg:hidden">
          {tabs.map((item) => (
            <button key={item.key} type="button" aria-current={active === item.key ? "page" : undefined} onClick={() => go(item.key)} className={`relative flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-bold ${active === item.key ? "bt-persona-light" : "text-white/80"}`}>
              <span className="h-5 w-5 [&>svg]:h-5 [&>svg]:w-5"><AdminIcon name={item.icon} /></span>
              {item.label.split(" ")[0]}
              {item.badge ? <span className="absolute right-[28%] top-1.5 min-w-[16px] rounded-full bg-[#F18B00] px-1 text-center text-[11px] font-extrabold leading-4 text-black">{item.badge}</span> : null}
            </button>
          ))}
          <button type="button" onClick={() => setDrawer(true)} className="flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-bold text-white/80"><span className="h-5 w-5 [&>svg]:h-5 [&>svg]:w-5"><AdminIcon name="menu" /></span>More</button>
        </nav>
      ) : null}

      {palette ? <CommandPalette items={all} actions={actions} onGo={(key) => { setPalette(false); go(key) }} onClose={() => setPalette(false)} search={paletteSearch} /> : null}
      {privacy ? <PrivacyNoticeModal scope="general" onClose={() => setPrivacy(false)} /> : null}
      {myData ? <MyDataModal onClose={() => setMyData(false)} /> : null}
      {guideOpen ? <PageGuideModal guide={guide} onClose={() => setGuideOpen(false)} /> : null}
    </div>
  )
}
