export type ClientPageKey = "projects" | "overview" | "blueprint" | "ticket" | "site-logs" | "communication" | "calendar"
export type ClientNavigate = (page: ClientPageKey) => void
export type ClientPageProps = { onNavigate: ClientNavigate }
