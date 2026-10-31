type Values = Record<string, unknown>
export type AuditEntry = { action: string; target_name: string | null; summary: string | null }
export type AuditField = { label: string; value: string; before?: string }

const object = (value: unknown): Values => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Values : {}
const words = (value: string) => value.replace(/_/g, " ").replace(/\./g, " · ")
const title = (value: string) => words(value).replace(/^./, char => char.toUpperCase())
const uuid = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i
const sensitive = /password|secret|token|(^|_)hash($|_)|biometric_uid|fingerprint|id_number/i
const fieldLabels: Record<string, string> = {
  id: "Record ID", project_id: "Project", pin_id: "Pin", item_id: "Task", item_ids: "Tasks", text: "Task",
  blueprint_id: "Blueprint", revision_id: "Blueprint revision", report_id: "Daily report",
  inspection_id: "Inspection", previous_inspection_id: "Previous inspection", submitted_inspection_id: "Submitted inspection",
  assigned_to: "Assigned to", qa_approved_by: "QA approved by", qa_approved_at: "QA approved at",
  user_id: "Account", x: "Position X (%)", y: "Position Y (%)", done: "QC complete", review_status: "QA status",
  all_complete: "All tasks QC complete", checklist_snapshot: "Submitted tasks", photos_snapshot: "Submitted photos",
  work_snapshot: "Submitted work", fields: "Edited fields", before: "Previous value", after: "New value",
}
const enums: Record<string, string> = {
  not_started: "Not started", in_progress: "In progress", for_review: "For review", verified: "Completed",
  issue: "Issue", pending: "Pending", approved: "Approved", rejected: "Rejected", passed: "Passed", failed: "Failed",
  submitted: "Submitted", draft: "Draft", active: "Active", disabled: "Disabled", super_admin: "Super Admin",
  project_manager: "Project Manager", engineer: "Engineer", foreman: "Foreman", client: "Client", admin: "Admin", user: "Basic user",
}
const entities: Record<string, string> = {
  pins: "pin", pin_checklist_items: "task", qa_work_attempts: "task correction", pin_qa_submissions: "QA submission",
  daily_report_photos: "report photo", daily_reports: "daily report", pin_photos: "pin photo",
  qa_inspections: "inspection", qa_defects: "NCR", blueprints: "blueprint", blueprint_revisions: "blueprint revision",
  blueprint_annotations: "blueprint annotation", attendance_workers: "worker", attendance_schedules: "attendance schedule",
  biometric_daily_totals: "attendance total", site_issue_reports: "site issue", site_issue_photos: "site issue photo",
}
export const auditActionLabel = (action: string) => {
  if (action === "photos.account_rule") return "Changed account photo rule"
  const [entity, operation] = action.split(".")
  const verb: Record<string, string> = { insert: "Created", update: "Updated", delete: "Deleted" }
  if (verb[operation] && entities[entity]) return `${verb[operation]} ${entities[entity]}`
  return title(action)
}

/** Formats only values actually recorded in an entry. Reference labels may be current names. */
export function auditDetails(entry: AuditEntry) {
  let parsed: unknown
  try { parsed = entry.summary ? JSON.parse(entry.summary) : {} } catch {
    const raw = entry.summary?.trim() ?? ""
    const message = /^[\[{]/.test(raw) ? "The saved details are incomplete. Reload to retrieve the complete entry." : raw || "No additional details were recorded."
    return { about: entry.target_name || "Company", summary: message, fields: [{ label: "Details", value: message }] as AuditField[], context: [] as AuditField[], changes: false }
  }
  const envelope = object(parsed)
  const details = envelope.version === 1 ? object(envelope.details) : envelope
  const context = envelope.version === 1 ? object(envelope.context) : {}
  const references = object(context.references)
  const hasPair = "before" in details && "after" in details
  const record = details.row ? object(details.row) : hasPair && typeof details.after === "object" && !Array.isArray(details.after) ? object(details.after) : details
  const before = object(details.before)
  const photoRule = entry.action === "photos.account_rule"
  const labelFor = (key: string) => fieldLabels[key] ?? title(key.replace(/_id$/, ""))
  const format = (key: string, value: unknown): string => {
    if (value === null || value === undefined || value === "") return "Not set"
    if (typeof value === "boolean") return value ? "Yes" : "No"
    if (typeof value === "number") return String(value)
    if (Array.isArray(value)) return value.length ? value.map(item => format(key, item)).join("; ") : "None"
    if (typeof value === "object") return Object.entries(object(value)).filter(([k]) => !sensitive.test(k)).map(([k, v]) => `${labelFor(k)}: ${format(k, v)}`).join("; ") || "None"
    const text = String(value)
    if (photoRule && (key === "before" || key === "after")) return ({ company: "Both", allow: "Allow uploads", camera_only: "Camera only", deny: "Camera only" } as Record<string, string>)[text] ?? title(text)
    if (uuid.test(text)) return typeof references[text] === "string" ? String(references[text]) : `Record ${text} (name unavailable)`
    if (key === "fields") return labelFor(text)
    if (/status|role|severity|review_state/.test(key) || (["before", "after", "old", "new"].includes(key) && /role_changed|status_changed/.test(entry.action))) {
      if (text === "verified" && (key !== "status" || !entry.action.startsWith("pins."))) return "Verified"
      return enums[text] ?? title(text)
    }
    if (/(?:_at|_time)$/.test(key) && /^\d{4}-\d{2}-\d{2}T/.test(text) && Number.isFinite(Date.parse(text))) return new Date(text).toLocaleString("en-PH", { timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short" }) + " PHT"
    return text
  }
  const fields: AuditField[] = []
  const changes = Object.keys(before).length > 0 && (Boolean(details.row) || hasPair)
  const add = (key: string, value: unknown, previous?: unknown, changed = false, prefix = "") => {
    if (sensitive.test(key)) return
    const nested = object(value), old = object(previous)
    if (Object.keys(nested).length || (changed && Object.keys(old).length)) {
      for (const child of new Set([...Object.keys(nested), ...(changed ? Object.keys(old) : [])])) {
        if (!changed || JSON.stringify(nested[child]) !== JSON.stringify(old[child])) add(child, nested[child], old[child], changed, `${prefix}${labelFor(key)} · `)
      }
    } else fields.push({ label: prefix + labelFor(key), value: format(key, value), ...(changed ? { before: format(key, previous) } : {}) })
  }
  if (hasPair && !changes) {
    fields.push({ label: photoRule ? "Photo rule" : String(details.key || "Value"), before: format("before", details.before), value: format("after", details.after) })
    for (const [key, value] of Object.entries(details)) if (!["before", "after"].includes(key)) add(key, value)
  } else {
    for (const key of new Set([...Object.keys(record), ...(changes ? Object.keys(before) : [])])) {
      if (["row", "before"].includes(key)) continue
      if (changes && (key === "updated_at" || JSON.stringify(record[key]) === JSON.stringify(before[key]))) continue
      add(key, record[key], before[key], changes)
    }
  }
  const contextFields: AuditField[] = ["project", "sheet", "pin", "task", "inspection", "report"].filter(key => typeof context[key] === "string").map(key => ({ label: title(key), value: String(context[key]) }))
  const about = entry.target_name || String(context.subject || record.title || record.text || record.full_name || record.name || context.project || "Company")
  const important = fields.filter(field => !/Record ID|Created at|Updated at|Created by|Blueprint revision/.test(field.label) && field.value !== "Not set")
  const selected = important.length ? important : fields
  const summary = selected.slice(0, 3).map(field => `${field.label}: ${field.before !== undefined ? `${field.before} → ` : ""}${field.value}`).join(" · ") || "No additional details were recorded."
  return { about, summary, fields, context: contextFields, changes: changes || hasPair }
}

export function auditDetailsText(entry: AuditEntry) {
  const details = auditDetails(entry)
  return [...details.context, ...details.fields].map(field => `${field.label}: ${field.before !== undefined ? `${field.before} → ` : ""}${field.value}`).join("\n") || details.summary
}
