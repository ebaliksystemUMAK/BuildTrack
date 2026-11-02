export type AdminPageKey = "dashboard" | "user-management" | "biometrics" | "project-management" | "blueprint-upload" | "blueprint-mapping" | "blueprint-progress" | "blueprint-version" | "project-overview" | "invites" | "audit-log" | "settings" | "access-review" | "communications" | "access-messages" | "records-audit" | "system-logs" | "system-control" | "system-health" | "site-controls" | "records" | "backup" | "qa-checklists" | "calendar"

export type AdminNavigate = (page: AdminPageKey, search?: string) => void

export type AdminPageProps = {
  onNavigate: AdminNavigate
}
