// Pure rules for the site announcement banner (no network, no React): what a valid banner looks like, who can dismiss it and when it shows again.

export type AnnouncementTone = "info" | "success" | "warning" | "critical"
export type Announcement = { title: string; message: string; tone: AnnouncementTone; revision: number }

export const TONES: AnnouncementTone[] = ["info", "success", "warning", "critical"]
export const toneLabels: Record<AnnouncementTone, string> = { info: "Information", success: "Good news", warning: "Warning", critical: "Critical" }
export const TITLE_MAX = 80
export const MESSAGE_MAX = 500
export const REFRESH_MS = 30_000
export const DISMISS_KEY = "buildtrack.announcement.dismissed"

// Colours come from the same pairs the status chips use; text is -900 on -100 (dark mode the reverse) so contrast stays well above 4.5:1.
export const toneClasses: Record<AnnouncementTone, string> = {
  info: "border-sky-300 bg-sky-100 text-sky-950 dark:border-sky-700 dark:bg-sky-950 dark:text-sky-50",
  success: "border-green-300 bg-green-100 text-green-950 dark:border-green-700 dark:bg-green-950 dark:text-green-50",
  warning: "border-amber-300 bg-amber-100 text-amber-950 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-50",
  critical: "border-red-400 bg-red-100 text-red-950 dark:border-red-700 dark:bg-red-950 dark:text-red-50",
}

// A critical announcement cannot be dismissed: it stays until a Super Admin switches it off or edits it.
export const canDismiss = (announcement: Pick<Announcement, "tone">) => announcement.tone !== "critical"

// Reads one row of get_active_announcement. Anything that is not a complete, valid banner is treated as "no banner".
export function parseAnnouncement(row: unknown): Announcement | null {
  if (row === null || typeof row !== "object") return null
  const value = row as Record<string, unknown>
  const title = typeof value.title === "string" ? value.title.trim() : ""
  const message = typeof value.message === "string" ? value.message.trim() : ""
  const revision = typeof value.revision === "number" && Number.isInteger(value.revision) ? value.revision : -1
  const tone = TONES.find((candidate) => candidate === value.tone)
  if (!title || !message || !tone || revision < 0) return null
  return { title: title.slice(0, TITLE_MAX), message: message.slice(0, MESSAGE_MAX), tone, revision }
}

// What this browser remembers: the highest revision the person dismissed. A new revision (any edit, or publishing again) is higher, so it shows again.
export function readDismissed(raw: string | null | undefined): number {
  const value = Number(raw)
  return Number.isInteger(value) && value > 0 ? value : 0
}

export function isHidden(announcement: Announcement | null, dismissedRevision: number): boolean {
  if (!announcement) return true
  return canDismiss(announcement) && dismissedRevision >= announcement.revision
}

export type AnnouncementForm = { title: string; message: string; tone: string; enabled: boolean }

// What the Super Admin may save. Switching off needs no text; publishing needs both.
export function validateAnnouncement(form: AnnouncementForm): string | null {
  const title = form.title.trim()
  const message = form.message.trim()
  if (!TONES.some((tone) => tone === form.tone)) return "Choose a tone."
  if (title.length > TITLE_MAX) return `The title can be at most ${TITLE_MAX} characters.`
  if (message.length > MESSAGE_MAX) return `The message can be at most ${MESSAGE_MAX} characters.`
  if (form.enabled && (!title || !message)) return "Write a title and a message before publishing."
  return null
}
