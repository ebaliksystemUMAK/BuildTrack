import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { ROLE_ORDER, ROLE_RULES, SUPER_ONLY_PAGES, SYSTEM_TABS, activityName, activitySummary, adminPageMatrix, areaMatrix, emailVerdict, formatBytes, isSystemTab, legacyTab, lockoutVerdict, manilaToIso, roleNames, tabLabels, windowProblem, windowStatusLabel } from "../src/lib/systemControlModel.ts"

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8")

// ---------------------------------------------------------------- tabs
assert.deepEqual([...SYSTEM_TABS], ["health", "maintenance", "logout", "banner", "email", "registration", "roles"])
for (const tab of SYSTEM_TABS) { assert.equal(isSystemTab(tab), true); assert.ok(tabLabels[tab]) }
for (const bad of ["", "records", "backup", null, undefined, 5, "HEALTH"]) assert.equal(isSystemTab(bad), false, String(bad))
assert.deepEqual(legacyTab, { "system-health": "health", "site-controls": "maintenance" })
assert.ok(!SYSTEM_TABS.includes("records"), "Records stays outside System Control")

// ---------------------------------------------------------------- sizes
assert.equal(formatBytes(0), "0 B"); assert.equal(formatBytes(1023), "1023 B"); assert.equal(formatBytes(1024), "1.0 KB"); assert.equal(formatBytes(1536), "1.5 KB")
assert.equal(formatBytes(5 * 1024 * 1024), "5.0 MB"); assert.equal(formatBytes(250 * 1024 ** 3), "250 GB"); assert.equal(formatBytes(2 * 1024 ** 4), "2.0 TB")
for (const bad of [-1, NaN, "abc", undefined, null]) assert.equal(formatBytes(bad), bad === null ? "0 B" : "unknown", String(bad))

// ---------------------------------------------------------------- system activity words
assert.equal(activityName("maintenance.on"), "Maintenance switched on"); assert.equal(activityName("some.unknown"), "some.unknown", "an unknown action is shown as it is, never hidden")
assert.equal(activitySummary({ action: "maintenance.on", details: { message: "Upgrading the database." } }), "Upgrading the database.")
assert.equal(activitySummary({ action: "feature.lock", details: { label: "Daily reports", audiences: ["foreman", "client"] } }), "Daily reports for foreman, client")
assert.equal(activitySummary({ action: "user.force_logout", details: { accounts: 1, reason: "Shared login" } }), "1 account: Shared login"); assert.equal(activitySummary({ action: "user.force_logout", details: { accounts: 12, reason: "x" } }), "12 accounts: x")
assert.equal(activitySummary({ action: "system.switch", details: { switch: "registration_closed", enabled: true } }), "Registration turned on (closed / paused)")
assert.equal(activitySummary({ action: "system.switch", details: { switch: "email_paused", enabled: false } }), "Email turned off (back to normal)")
assert.equal(activitySummary({ action: "system.emergency_off", details: { maintenance_was_on: true, features_unlocked: ["quality"], switches_off: ["email_paused", "registration_closed"] } }), "Switched off: maintenance, 1 feature pause(s), 2 switch(es)")
assert.equal(activitySummary({ action: "system.emergency_off", details: { maintenance_was_on: false, features_unlocked: [], switches_off: [] } }), "Nothing was on")
assert.equal(activitySummary({ action: "announcement.publish", details: { title: "Planned maintenance" } }), "Planned maintenance")
assert.equal(activitySummary({ action: "account.closed", details: { reason: "Left the company" } }), "Left the company")
assert.equal(activitySummary({ action: "maintenance.on", details: null }), ""); assert.equal(activitySummary({ action: "feature.lock", details: { label: 5 } }), "", "odd data never breaks the page")
assert.ok(activitySummary({ action: "maintenance.update", details: { message: "x".repeat(500) } }).length <= 120, "long text is shortened")

// ---------------------------------------------------------------- email verdict
const base = { sent_24h: 0, failed_24h: 0, last_sent_at: null, last_failed_at: null }
assert.equal(emailVerdict(base, true).tone, "warn"); assert.match(emailVerdict(base, true).text, /paused/i)
assert.equal(emailVerdict({ ...base, failed_24h: 4 }, false).tone, "bad"); assert.match(emailVerdict({ ...base, failed_24h: 4 }, false).text, /failing/)
assert.equal(emailVerdict({ ...base, sent_24h: 3, failed_24h: 1 }, false).tone, "warn")
assert.deepEqual(emailVerdict({ ...base, sent_24h: 1 }, false), { tone: "ok", text: "1 email sent in the last 24 hours, none failed." })
assert.match(emailVerdict(base, false).text, /No notification email has ever been sent/); assert.match(emailVerdict({ ...base, last_sent_at: "2026-11-01" }, false).text, /Nothing was sent in the last 24 hours/)

// ---------------------------------------------------------------- maintenance windows (Manila time)
assert.equal(manilaToIso("2026-11-05T22:00"), "2026-11-05T14:00:00.000Z", "a date-time box value is Manila time (UTC+8)")
for (const bad of ["", "2026-11-05", "2026-11-05T22:00:00", "not a date", "2026-13-45T99:99"]) assert.equal(manilaToIso(bad), null, bad)
const now = Date.UTC(2026, 10, 5, 0, 0) // 2026-11-05 08:00 in Manila
const ok = { start: "2026-11-05T22:00", end: "2026-11-06T02:00", message: "Planned upgrade of the database." }
assert.equal(windowProblem(ok, now), null)
assert.match(windowProblem({ ...ok, start: "2026-11-05T08:00" }, now), /in the future/); assert.match(windowProblem({ ...ok, start: "2026-12-20T22:00", end: "2026-12-20T23:00" }, now), /30 days/)
assert.match(windowProblem({ ...ok, end: "2026-11-05T21:00" }, now), /after the start/); assert.match(windowProblem({ ...ok, end: "2026-11-06T23:00" }, now), /at most 24 hours/); assert.match(windowProblem({ ...ok, end: "2026-11-05T22:03" }, now), /at least 5 minutes/)
assert.match(windowProblem({ ...ok, message: "no" }, now), /message/); assert.match(windowProblem({ ...ok, start: "" }, now), /Choose when/)
assert.deepEqual(Object.keys(windowStatusLabel).sort(), ["active", "cancelled", "done", "scheduled", "skipped"])
assert.match(activitySummary({ action: "maintenance.schedule", details: { starts_at: "2026-11-05T14:00:00Z", ends_at: "2026-11-05T18:00:00Z", message: "Upgrade" } }), /Nov 5.*to.*Nov 6.*Upgrade/); assert.equal(activityName("maintenance.scheduled_on"), "Scheduled maintenance started")
// ---------------------------------------------------------------- lockout verdict
const calm = { locked_codes: [], invite_attempts: [], blocked_signins_7d: 0, wrong_tries_24h: 2 }
assert.equal(lockoutVerdict(calm).tone, "ok")
assert.match(lockoutVerdict({ ...calm, locked_codes: [{ still_locked: true }, { still_locked: false }] }).text, /1 code locked now/)
assert.match(lockoutVerdict({ ...calm, invite_attempts: [{ locked: true }] }).text, /1 account locked out of invitation codes/); assert.match(lockoutVerdict({ ...calm, blocked_signins_7d: 3 }).text, /3 blocked Google sign-ins/); assert.match(lockoutVerdict({ ...calm, wrong_tries_24h: 40 }).text, /40 wrong code tries/)
assert.equal(lockoutVerdict({ ...calm, blocked_signins_7d: 1 }).tone, "warn")

// ---------------------------------------------------------------- role access overview
const table = { admin: ["super_admin", "admin"], pm: ["project_manager", "super_admin"], engineer: ["engineer"], foreman: ["foreman"], client: ["client"], user: ["user"], attendance: ["super_admin", "admin", "engineer", "foreman"], "pin-link": [...ROLE_ORDER], other: ["engineer"] }
const matrix = areaMatrix(table)
assert.deepEqual(matrix.map((row) => row.key), ["admin", "pm", "engineer", "foreman", "client", "user", "attendance", "pin-link"], "only known workspaces are listed")
const row = (key) => matrix.find((entry) => entry.key === key).roles
assert.equal(row("admin").super_admin, true); assert.equal(row("admin").admin, true); assert.equal(row("admin").engineer, false)
assert.equal(row("pm").super_admin, true, "the Super Admin may open the Project Manager workspace"); assert.equal(row("pm").admin, false, "a regular Admin may not")
assert.ok(ROLE_ORDER.every((role) => row("pin-link")[role]))
const pages = adminPageMatrix([{ key: "user-management", label: "User management" }, { key: "dashboard", label: "Company dashboard" }, { key: "system-control", label: "System Control" }, { key: "records", label: "Records" }], { "user-management": "users.view" })
assert.deepEqual(pages.map((page) => page.need), ["Admin permission: users.view", "Any Admin", "Super Admin only", "Super Admin only"])
assert.ok(SUPER_ONLY_PAGES.includes("system-control") && SUPER_ONLY_PAGES.includes("system-health") && SUPER_ONLY_PAGES.includes("site-controls"))
assert.deepEqual(ROLE_RULES.map((rule) => rule.role), [...ROLE_ORDER]); for (const role of ROLE_ORDER) assert.ok(roleNames[role])

// ---------------------------------------------------------------- the wiring (the page is Super Admin only and nothing was removed)
const shell = read("../src/pages/Admin/AdminShell.tsx")
assert.match(shell, /item\.key === "system-control" \|\| item\.key === "system-logs" \|\| item\.key === "system-health" \|\| item\.key === "site-controls" \|\| item\.key === "records"\) && profile\?\.role !== "super_admin"/, "System Control and System Logs are hidden from everyone but the Super Admin")
assert.match(shell, /group\("People & access", \["user-management", "access-messages"\]\)/); assert.match(shell, /group\("Company", \["records-audit", "biometrics", "settings"\]\)/); assert.match(shell, /group\("System", \["system-control", "system-logs", "backup"\]\)/, "ten menu entries in five groups")
assert.match(shell, /MENU_ENTRY_OF\[activePage\] \?\? activePage/, "the older addresses light up the entry that now holds them")
const app = read("../src/App.tsx")
for (const key of ["system-control", "system-health", "site-controls"]) assert.match(app, new RegExp(`"${key}",[\r\n]`), key + " is a valid address")
assert.match(app, /"system-health": <SystemControl \{\.\.\.pageProps\} initialTab="health" \/>/); assert.match(app, /"site-controls": <SystemControl \{\.\.\.pageProps\} initialTab="maintenance" \/>/)
// every older address still opens, on the tab of the page that now holds it
for (const [key, page, tab] of [["invites", "AccessMessages", "invitations"], ["access-review", "AccessMessages", "access"], ["communications", "AccessMessages", "messages"], ["audit-log", "RecordsAudit", "audit"], ["records", "RecordsAudit", "records"], ["qa-checklists", "SystemSettings", "qc"]]) assert.match(app, new RegExp(`${key.includes("-") ? `"${key}"` : key}: <${page} \\{\\.\\.\\.pageProps\\} initialTab="${tab}"`), key + " opens the " + tab + " tab")
for (const key of ["access-messages", "records-audit", "system-logs"]) assert.match(app, new RegExp(`"${key}": <`), key + " is a page")
const page = read("../src/pages/Admin/SystemControl.tsx")
assert.match(page, /Only a Super Admin can open System Control/); assert.match(page, /SchedulePanel/); assert.doesNotMatch(page, /Records|ProjectBackup/, "no role features inside System Control")
for (const tab of SYSTEM_TABS) assert.ok(page.includes(`tab === "${tab}"`), "tab " + tab)
assert.doesNotMatch(page, /LockoutPanel|ActivityPanel/, "the logs moved to System Logs")
const guides = read("../src/lib/pageGuides.ts")
assert.match(guides, /"system-control": \{\s+title: "System Control"/); assert.match(guides, /"site-controls": \{/); assert.match(guides, /"system-health": \{/, "the older guides are kept")
const register = read("../src/pages/Auth/RegisterPage.tsx")
assert.match(register, /loadRegistrationStatus/); assert.match(register, /Registration is closed/)
assert.match(read("../src/lib/profileTools.ts"), /registration_closed: "New registrations are closed/)
const sql = read("../supabase/migrations/20261102100000_system_control.sql")
for (const name of ["get_system_switches", "set_system_switch", "site_emergency_off", "get_email_delivery", "get_storage_capacity", "get_system_activity"]) assert.match(sql, new RegExp(`create or replace function public\\.${name}\\([^)]*\\)[\\s\\S]*?if not public\\.is_super_admin\\(\\)`), name + " checks for a Super Admin first")
assert.match(sql, /system_switch_on\('email_paused'\)/); assert.equal((sql.match(/system_switch_on\('registration_closed'\)/g) ?? []).length, 3, "the three registration gates")
assert.doesNotMatch(sql, /delete from|truncate/i, "the migration deletes nothing")

// ---------------------------------------------------------------- the rearranged menu: tabs by permission, old addresses, System Logs
const logs = await import("../src/lib/systemControlModel.ts")
assert.deepEqual([...logs.SYSTEM_LOG_TABS], ["transactions", "email", "lockouts"]); assert.equal(logs.isSystemLogTab("email"), true); assert.equal(logs.isSystemLogTab("activity"), false)
assert.equal(logs.logReference(7), "LOG-00007"); assert.equal(logs.logReference(123456), "LOG-123456"); assert.deepEqual([...logs.LOG_CATEGORIES], ["", "accounts", "system", "data", "other"])
assert.equal(activityName("user.create"), "Account created"); assert.equal(activityName("profile.role_changed"), "Role changed"); assert.equal(activityName("oauth.blocked"), "Google sign-in blocked")
assert.equal(activitySummary({ action: "profile.role_changed", details: { from: "user", to: "client", email: "a@b.co" } }), "user to client · a@b.co")
assert.equal(activitySummary({ action: "user.disable", details: { reason: "Shared login", sessions_revoked: 0 } }), "Shared login"); assert.equal(activitySummary({ action: "photos.account_rule", details: { before: "company", after: "allow" } }), "company to allow")
assert.equal(activitySummary({ action: "user.set_permissions", details: { permissions: ["a", "b", "c"] } }), "3 permission(s)"); assert.equal(activitySummary({ action: "oauth.enroll", details: { email: "g@x.co", requested_role: "client", status: "pending" } }), "client · g@x.co")
const has = (granted) => (permission) => granted.includes(permission)
const keys = (rules) => rules.map((rule) => rule.key)
assert.deepEqual(keys(logs.allowedTabs(logs.accessMessageTabs, has([]), false)), [], "no permission, no tab")
assert.deepEqual(keys(logs.allowedTabs(logs.accessMessageTabs, has(["users.view"]), false)), ["access"]); assert.deepEqual(keys(logs.allowedTabs(logs.accessMessageTabs, has(["users.approve", "users.edit"]), false)), ["invitations", "messages"])
assert.deepEqual(keys(logs.allowedTabs(logs.accessMessageTabs, has([]), true)), ["invitations", "access", "messages"], "the Super Admin has them all")
assert.deepEqual(keys(logs.allowedTabs(logs.recordsAuditTabs, has(["users.view"]), false)), ["audit"], "Records is Super Admin only"); assert.deepEqual(keys(logs.allowedTabs(logs.recordsAuditTabs, has([]), true)), ["audit", "records"])
assert.deepEqual(logs.movedPages.invites, { page: "access-messages", tab: "invitations" }); assert.deepEqual(logs.movedPages["qa-checklists"], { page: "settings", tab: "qc" }); assert.equal(Object.keys(logs.movedPages).length, 6)
for (const [file, needs] of [["AccessMessages", ["InviteCodes", "AccessReview", "Communications"]], ["RecordsAudit", ["AuditLog", "RecordsPage"]], ["SystemLogs", ["TransactionsPanel", "EmailDeliveryPanel", "LockoutPanel", "Only a Super Admin can open the system logs"]]]) { const source = read(`../src/pages/Admin/${file}.tsx`); for (const need of needs) assert.ok(source.includes(need), file + " holds " + need) }
const settingsPage = read("../src/pages/Admin/SystemSettings.tsx"); assert.match(settingsPage, /title="Company Configuration"/); assert.match(settingsPage, /AdminQaChecklists/); assert.match(settingsPage, /\{ key: "qc", label: "QC checklist library" \}/)
const intro = read("../src/pages/Admin/AdminShell.tsx"); assert.match(intro, /EmbeddedPageContext/); assert.match(intro, /<h2 className="text-lg font-extrabold text-fg">\{title\}<\/h2>/, "inside a tab a page keeps its header, as a sub-heading (one main heading per page)")
const logSql = read("../supabase/migrations/20261102140000_system_logs.sql"); assert.match(logSql, /get_system_log[\s\S]*?if not public\.is_super_admin\(\)/); assert.doesNotMatch(logSql, /delete from|truncate table|truncate public|update public/i, "the system log is read only")

console.log("System Control: tabs, sizes, activity words, email verdict, role access overview, the rearranged menu and the Super Admin-only wiring passed")
