import { createContext, useContext, type ReactNode } from "react"
import SampleNotice from "../../components/SampleNotice"
import AppShell, { type ShellNavGroup } from "../../components/shell/AppShell"
import { useReviewCount } from "../../lib/admin"
import { useAuth, type AdminPermission } from "../../lib/auth"
import { getSelectedProjectId, phaseLabels, useProject } from "../../lib/projects"
import logo from "../../assets/valencia/logo-source.png"
import AdminIcon, { type AdminIconName } from "./AdminIcon"
import type { AdminNavigate, AdminPageKey } from "./types"

export const pageTitles: Record<AdminPageKey, string> = {
  dashboard: "Company Dashboard",
  "user-management": "User Management & Approval",
  biometrics: "Biometric Management",
  "project-management": "All Projects",
  "blueprint-upload": "Blueprint Management",
  "blueprint-mapping": "Blueprint Mapping Monitor",
  "blueprint-progress": "Blueprint Progress Tracking",
  "blueprint-version": "Blueprint Version Control",
  "project-overview": "Project Overview",
  calendar: "Project Calendar",
  invites: "Invitations",
  "audit-log": "Company Audit Log",
  settings: "System Settings",
  "access-review": "Global Access Review",
  communications: "Announcements & Messages",
  "system-control": "System Control",
  "access-messages": "Access & Messages",
  "records-audit": "Company Records and Audits",
  "system-logs": "System Logs",
  "system-health": "System Health",
  "site-controls": "Site Controls",
  records: "Records",
  backup: "Full Backup & Export",
  "qa-checklists": "Company QC Checklist Library",
}

const PM_WORKSPACE_LINK = "pm-workspace"
// The older addresses still open (their content moved into tabs of another page) and light up the entry that now holds them.
const MENU_ENTRY_OF: Partial<Record<AdminPageKey, AdminPageKey>> = {
  "system-health": "system-control",
  "site-controls": "system-control",
  invites: "access-messages",
  "access-review": "access-messages",
  communications: "access-messages",
  "audit-log": "records-audit",
  records: "records-audit",
  "qa-checklists": "settings",
}
const navItems: Array<{
  key: AdminPageKey
  label: string
  icon: "grid" | "users" | "fingerprint" | "building" | "blueprint" | "pin" | "chart" | "history"
}> = [
  { key: "dashboard", label: "Company dashboard", icon: "grid" },
  { key: "user-management", label: "User management", icon: "users" },
  { key: "invites", label: "Invitations", icon: "users" },
  { key: "audit-log", label: "Company audit log", icon: "history" },
  { key: "access-review", label: "Global access review", icon: "users" },
  { key: "communications", label: "Announcements & messages", icon: "history" },
  { key: "access-messages", label: "Access & messages", icon: "users" },
  { key: "records-audit", label: "Company Records and Audits", icon: "history" },
  { key: "system-control", label: "System Control", icon: "grid" },
  { key: "system-logs", label: "System Logs", icon: "history" },
  { key: "system-health", label: "System health", icon: "chart" },
  { key: "site-controls", label: "Site controls", icon: "grid" },
  { key: "records", label: "Records", icon: "grid" },
  { key: "biometrics", label: "Biometric management", icon: "fingerprint" },
  { key: "project-management", label: "All projects", icon: "building" },
  { key: "project-overview", label: "Project Overview", icon: "building" },
  { key: "blueprint-mapping", label: "Blueprint Mapping", icon: "pin" },
  { key: "blueprint-progress", label: "Progress Tracking", icon: "chart" },
  { key: "blueprint-version", label: "Version Control", icon: "history" },
  { key: "qa-checklists", label: "QC checklist library", icon: "blueprint" },
  { key: "backup", label: "Full backup & export", icon: "history" },
  { key: "settings", label: "Company Configuration", icon: "grid" },
]

const samplePages: AdminPageKey[] = []

// The pages of the Admin menu, in order, for the Role access overview in System Control.
export const adminMenuPages = ["dashboard", "project-management", "user-management", "access-messages", "records-audit", "biometrics", "settings", "system-control", "system-logs", "backup"].map((key) => ({ key, label: navItems.find((item) => item.key === key)?.label ?? key }))

// Which admin function unlocks which page. Pages not listed are open to every admin.
export const adminPagePermission: Partial<Record<AdminPageKey, AdminPermission>> = {
  "user-management": "users.view",
  invites: "users.approve",
  "audit-log": "users.view",
  "access-review": "users.view",
  communications: "users.edit",
  backup: "projects.manage",
  biometrics: "biometrics.manage",
  "project-management": "projects.manage",
  "project-overview": "projects.manage",
  "blueprint-upload": "blueprints.manage",
  "blueprint-mapping": "blueprints.manage",
  "blueprint-progress": "blueprints.manage",
  "blueprint-version": "blueprints.manage",
}

type AdminShellProps = {
  activePage: AdminPageKey
  onNavigate: AdminNavigate
  children: ReactNode
}

export function AdminBrand() {
  return (
    <div className="admin-brand">
      <img src={logo} alt="Valencia Construction Services" />
      <div>
        <strong>VALENCIA CONSTRUCTION</strong>
        <strong>SERVICES</strong>
        <small>POWERED BY BUILDTRACK</small>
      </div>
    </div>
  )
}

export function AdminButton({
  children,
  variant = "primary",
  icon,
  onClick,
  type = "button",
  className = "",
}: {
  children: ReactNode
  variant?: "primary" | "dark" | "outline" | "ghost" | "danger" | "success"
  icon?: AdminIconName
  onClick?: () => void
  type?: "button" | "submit"
  className?: string
}) {
  return (
    <button
      className={`admin-button admin-button--${variant} ${className}`}
      onClick={onClick}
      type={type}
    >
      {icon ? <AdminIcon name={icon} /> : null}
      {children}
    </button>
  )
}

export function StatusBadge({
  children,
  tone = "neutral",
}: {
  children: ReactNode
  tone?: "success" | "warning" | "danger" | "info" | "neutral"
}) {
  return (
    <span className={`admin-status admin-status--${tone}`}>{children}</span>
  )
}

export function AdminSelect({
  children,
  value,
  onChange,
  className = "",
  label,
}: {
  children: ReactNode
  value?: string
  onChange?: (value: string) => void
  className?: string
  label?: string
}) {
  return (
    <div className={`admin-select ${className}`}>
      <select
        aria-label={label}
        value={value}
        onChange={(event) => onChange?.(event.target.value)}
      >
        {children}
      </select>
      <AdminIcon name="chevron" />
    </div>
  )
}

export function Panel({
  children,
  className = "",
  title,
  action,
}: {
  children: ReactNode
  className?: string
  title?: ReactNode
  action?: ReactNode
}) {
  return (
    <section className={`admin-panel ${className}`}>
      {title || action ? (
        <div className="admin-panel__heading">
          {title ? <h2>{title}</h2> : <span />}
          {action}
        </div>
      ) : null}
      {children}
    </section>
  )
}

// A page shown as a tab of another page (Access & messages, Company Records and Audits, System Logs, Company Configuration) keeps its whole header, description and
// buttons, but as a compact sub-heading, so the page still has exactly one main heading.
export const EmbeddedPageContext = createContext(false)

export function PageIntro({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string
  title: string
  description?: string
  action?: ReactNode
}) {
  const embedded = useContext(EmbeddedPageContext)
  if (embedded) {
    return (
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-extrabold text-fg">{title}</h2>
          {description ? <p className="mt-1 max-w-3xl text-sm text-fg-muted">{description}</p> : null}
        </div>
        {action}
      </div>
    )
  }
  return (
    <div className="admin-page-intro">
      <div>
        {eyebrow ? <div className="admin-eyebrow">{eyebrow}</div> : null}
        <h1>{title}</h1>
        {description ? <p>{description}</p> : null}
      </div>
      {action}
    </div>
  )
}

export function BlueprintCanvas({
  compact = false,
  selected = "Room B",
  onSelect,
}: {
  compact?: boolean
  selected?: string
  onSelect?: (room: string) => void
}) {
  const rooms = [
    {
      name: "Room A",
      detail: "Wall Install",
      tone: "green",
      x: "15%",
      y: "19%",
    },
    {
      name: "Room B",
      detail: "Electrical",
      tone: "yellow",
      x: "61%",
      y: "19%",
    },
    { name: "Room C", detail: "Plumbing", tone: "gray", x: "15%", y: "61%" },
    { name: "Room D", detail: "HVAC Duct", tone: "red", x: "61%", y: "61%" },
  ] as const

  return (
    <div
      className={`blueprint-canvas ${
        compact ? "blueprint-canvas--compact" : ""
      }`}
    >
      <div className="blueprint-canvas__topline">
        GROUND FLOOR <span>•</span> ROOM LAYOUT{" "}
        <span className="blueprint-canvas__code">VCB-024</span>
      </div>
      <div className="blueprint-canvas__building">
        <div className="blueprint-canvas__core" />
        {rooms.map((room) => (
          <button
            className={`blueprint-room blueprint-room--${room.tone} ${
              selected === room.name ? "is-selected" : ""
            }`}
            key={room.name}
            style={{ left: room.x, top: room.y }}
            onClick={() => onSelect?.(room.name)}
          >
            <span>{room.name}</span>
            <small>({room.detail})</small>
            <i />
          </button>
        ))}
      </div>
      <span className="blueprint-canvas__scale">Scale 1:100</span>
    </div>
  )
}

export function ProgressBar({
  value,
  tone = "gold",
}: {
  value: number
  tone?: "gold" | "green" | "red" | "blue"
}) {
  return (
    <span className={`admin-progress admin-progress--${tone}`}>
      <i style={{ width: `${value}%` }} />
    </span>
  )
}

export default function AdminShell({
  activePage,
  onNavigate,
  children,
}: AdminShellProps) {
  const { profile, can } = useAuth()
  const { project } = useProject(getSelectedProjectId())
  const reviewCount = useReviewCount(can("users.approve"))

  const visible = navItems.filter((item) => {
    if ((item.key === "system-control" || item.key === "system-logs" || item.key === "system-health" || item.key === "site-controls" || item.key === "records") && profile?.role !== "super_admin") return false // Super Admin only (the database checks it again)
    if (["project-overview", "blueprint-mapping", "blueprint-progress", "blueprint-version"].includes(item.key)) return false
    if (item.key === "access-messages") return can("users.approve") || can("users.view") || can("users.edit") // its tabs each need their own permission
    if (item.key === "records-audit") return can("users.view") || profile?.role === "super_admin"
    const need = adminPagePermission[item.key]
    return !need || can(need)
  })
  const group = (label: string, keys: AdminPageKey[]): ShellNavGroup => ({
    label,
    items: visible.filter((item) => keys.includes(item.key)).map((item) => ({ key: item.key, label: item.label, icon: item.icon, badge: item.key === "user-management" ? reviewCount : undefined })),
  })
  // Company administration; Project Managers use their own workspace for daily operations.
  const groups = [
    group("Overview", ["dashboard"]),
    group("Projects", ["project-management"]),
    group("People & access", ["user-management", "access-messages"]),
    group("Company", ["records-audit", "biometrics", "settings"]),
    group("System", ["system-control", "system-logs", "backup"]),
  ].filter((entry) => entry.items.length)
  // Super Admin has every workspace: a link into the Project Manager workspace (changes there stay with the assigned Project Manager; the database re-checks every one).
  if (profile?.role === "super_admin") groups.find((entry) => entry.label === "Projects")?.items.push({ key: PM_WORKSPACE_LINK, label: "Project Manager workspace", icon: "building" })

  return (
    <AppShell
      persona="admin"
      workspace="Control center"
      groups={groups}
      active={MENU_ENTRY_OF[activePage] ?? activePage}
      onNavigate={(key) => {
        if (key === PM_WORKSPACE_LINK) {
          window.history.pushState({}, "", "/pm/projects")
          window.dispatchEvent(new PopStateEvent("popstate"))
          return
        }
        onNavigate(key as AdminPageKey)
      }}
      project={project ? { code: project.code, name: project.name, sub: phaseLabels[project.phase] } : null}
      projectEmpty="All projects (pick one in All projects)"
      mobileTabs={["dashboard", "user-management", "project-management", "audit-log"]}
      banner={samplePages.includes(activePage) ? <SampleNotice /> : null}
    >
      {children}
    </AppShell>
  )
}
