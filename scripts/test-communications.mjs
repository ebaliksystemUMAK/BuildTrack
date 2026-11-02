import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import ts from "typescript"
import { emailCategory, buildEmail } from "../supabase/functions/_shared/emailModel.ts"
import { HIDDEN_KINDS, IN_APP_ONLY_KINDS, isHiddenKind, notificationCategory, safeInAppLink } from "../src/lib/notificationModel.ts"
import { DISMISS_KEY, REFRESH_MS, TITLE_MAX, canDismiss, isHidden, parseAnnouncement, readDismissed, toneClasses, TONES, validateAnnouncement } from "../src/lib/announcementModel.ts"
import { BODY_MAX, PER_SEND, PER_SEND_SUPER, addRecipients, capFor, channelLabel, friendlyMessageError, isMissingFunction, outcomeSummary, parsePreview, previewLines, recipientName, validateMessage } from "../src/lib/communicationsModel.ts"

// Everything here runs against fakes: no database, no network, no email is ever sent.
const url = (code) => "data:text/javascript;base64," + Buffer.from(code).toString("base64")
const fileUrl = (path) => new URL(path, import.meta.url).href
const settle = () => new Promise((resolve) => setImmediate(resolve))

// ---------------------------------------------------------------- shared rules: notification categories agree in the app, the email builder and the SQL list
{
  const kinds = {
    security: ["account.suspended", "account.reactivated", "security.new_device"],
    reminder: ["pin.due", "pin.overdue", "qa.defect_due", "qa.defect_overdue", "qa.overdue", "alert.overdue", "alert.escalation"],
    announcement: ["announcement.message", "announcement.email"],
    // somebody has to act, or is waiting outside the app
    activity: ["pin.assigned", "pin.review", "pin.returned", "pin.verified", "pin.issue", "pin.problem", "qa.requested", "qa.result", "qa.defect", "qa.defect_verify", "qa.defect_rejected", "qa.item_review", "access.request", "access.granted", "access.declined", "registration.new", "identity.new", "identity.approved", "identity.rejected", "privacy.erasure", "privacy.declined", "snag.new", "snag.accepted", "snag.declined", "snag.resolved", "question.new", "question.answered", "report.reopened", "project.manager_assigned", "attendance.concern", "visit.requested"],
    // the bell only
    inapp: ["pin.milestone", "pin.resumed", "report.submitted", "report.reviewed", "qa.defect_closed", "project.archived", "project.restored", "project.manager_removed", "attendance.concern_resolved"],
  }
  for (const [category, list] of Object.entries(kinds)) for (const kind of list) {
    assert.equal(notificationCategory(kind), category, kind)
    assert.equal(emailCategory(kind), category, "email builder: " + kind)
  }
  assert.deepEqual([...IN_APP_ONLY_KINDS].sort(), [...kinds.inapp].sort())
  // The SQL function carries the same lists (20261101090000 + 20261101220000); this keeps the copies from drifting apart.
  const sql = readFileSync(new URL("../supabase/migrations/20261101220000_email_only_needed_kinds.sql", import.meta.url), "utf8")
  const fn = sql.slice(sql.indexOf("create or replace function public.notification_email_category"), sql.indexOf("revoke execute on function public.notification_email_category"))
  for (const kind of [...kinds.reminder, ...kinds.inapp]) assert.ok(fn.includes(`'${kind}'`), "SQL lists " + kind)
  assert.equal(fn.match(/'inapp'/g).length, 1); assert.deepEqual([...fn.matchAll(/'([a-z]+\.[a-z_]+)'/g)].map((m) => m[1]).filter((k) => kinds.inapp.includes(k) || kinds.reminder.includes(k)).sort(), [...kinds.reminder, ...kinds.inapp].sort(), "no extra kind hides in the SQL lists")
  assert.match(fn, /like 'account\.%' or p_kind like 'security\.%'/); assert.match(fn, /like 'announcement\.%'/)
  // every kind the database creates is classified here, so a new kind cannot slip in unnoticed (it would be emailed by default)
  const classified = new Set([...Object.values(kinds).flat()])
  const created = new Set()
  const dir = new URL("../supabase/migrations/", import.meta.url)
  for (const file of readdirSync(dir)) {
    const body = readFileSync(new URL(file, dir), "utf8")
    for (const call of body.matchAll(/notify_user\(/g)) for (const literal of body.slice(call.index, call.index + 220).matchAll(/'([a-z]+\.[a-z_]+)'/g)) created.add(literal[1])
  }
  assert.ok(created.size > 40, "the scan found the kinds: " + created.size)
  assert.deepEqual([...created].filter((kind) => !classified.has(kind)).sort(), [], "classify every new notification kind: emailed (activity) or bell only (inapp)")
  assert.match(buildEmail({ id: "1", kind: "pin.assigned", title: "t", body: null, link: null, to_email: "a@b.co", to_name: null }, "https://app.example.test").text, /switch emails off/)
  assert.deepEqual(HIDDEN_KINDS, ["announcement.email"]); assert.equal(isHiddenKind("announcement.email"), true); assert.equal(isHiddenKind("announcement.message"), false)

  for (const good of ["/engineer/dashboard", "/engineer/qa?project=0b1c2d3e-0000-4000-8000-000000000000", "/pm/projects", "/user/home", "/"]) assert.equal(safeInAppLink(good), good, good)
  for (const bad of ["https://evil.example", "//evil.example", "javascript:alert(1)", "/Engineer/Dashboard", "/a b", "/x?y=<script>", "/x\\y", "evil", "", null, undefined, 5]) assert.equal(safeInAppLink(bad), null, String(bad))
}

// ---------------------------------------------------------------- email footers follow the category; the account notice says it is always sent
{
  const job = (kind) => ({ id: "1", kind, title: "A <b>title</b>", body: "Body & text", link: "/engineer/dashboard", to_email: "a@example.test", to_name: "Ana Cruz" })
  const mail = (kind) => buildEmail(job(kind), "https://app.example.test")
  assert.match(mail("pin.assigned").text, /switch emails off in the bell menu/)
  assert.match(mail("pin.due").text, /switch reminder emails off/)
  assert.match(mail("announcement.message").html, /switch announcement emails off/)
  assert.match(mail("account.suspended").text, /always sent/); assert.doesNotMatch(mail("account.suspended").text, /switch/)
  assert.doesNotMatch(mail("announcement.email").html, /<b>title<\/b>/, "an administrator's text is escaped in the email")
  assert.match(mail("announcement.email").html, /A &lt;b&gt;title&lt;\/b&gt;/)
  assert.match(mail("announcement.email").html, /Valencia Construction Services - BuildTrack/, "the branded layout is reused")
}

// ---------------------------------------------------------------- the banner rules
{
  const row = (extra = {}) => ({ title: " Planned maintenance ", message: " Back by 11. ", tone: "warning", revision: 3, ...extra })
  assert.deepEqual(parseAnnouncement(row()), { title: "Planned maintenance", message: "Back by 11.", tone: "warning", revision: 3 })
  for (const bad of [null, undefined, "x", 5, {}, row({ title: "  " }), row({ message: "" }), row({ tone: "rainbow" }), row({ revision: -1 }), row({ revision: 1.5 }), row({ revision: "3" })]) assert.equal(parseAnnouncement(bad), null, JSON.stringify(bad))
  assert.equal(parseAnnouncement(row({ title: "x".repeat(200) })).title.length, TITLE_MAX)

  assert.deepEqual(TONES, ["info", "success", "warning", "critical"]); assert.deepEqual(Object.keys(toneClasses), TONES)
  assert.equal(canDismiss({ tone: "critical" }), false); for (const tone of ["info", "success", "warning"]) assert.equal(canDismiss({ tone }), true)

  const a = parseAnnouncement(row())
  assert.equal(readDismissed(null), 0); assert.equal(readDismissed("abc"), 0); assert.equal(readDismissed("-2"), 0); assert.equal(readDismissed("3"), 3)
  assert.equal(isHidden(a, 0), false, "never dismissed")
  assert.equal(isHidden(a, 3), true, "dismissed this revision")
  assert.equal(isHidden({ ...a, revision: 4 }, 3), false, "an edited announcement (new revision) shows again")
  assert.equal(isHidden({ ...a, tone: "critical" }, 3), false, "a critical announcement is never hidden by an old dismissal")
  assert.equal(isHidden(null, 0), true)

  const ok = { title: "T", message: "M", tone: "info", enabled: true }
  assert.equal(validateAnnouncement(ok), null)
  assert.match(validateAnnouncement({ ...ok, title: " " }), /title and a message/); assert.match(validateAnnouncement({ ...ok, message: "" }), /title and a message/)
  assert.equal(validateAnnouncement({ ...ok, title: "", message: "", enabled: false }), null, "switching off needs no text")
  assert.match(validateAnnouncement({ ...ok, tone: "loud" }), /tone/); assert.match(validateAnnouncement({ ...ok, title: "x".repeat(81) }), /at most 80/); assert.match(validateAnnouncement({ ...ok, message: "x".repeat(501) }), /at most 500/)
}

// ---------------------------------------------------------------- the hub rules
{
  const person = (id, extra = {}) => ({ id, full_name: "Person " + id, email: id + "@example.test", role: "engineer", company: null, ...extra })
  assert.equal(capFor(false), PER_SEND); assert.equal(capFor(true), PER_SEND_SUPER); assert.equal(PER_SEND, 200); assert.equal(PER_SEND_SUPER, 500)
  assert.equal(recipientName({ full_name: "  ", email: "x@example.test" }), "x@example.test"); assert.equal(recipientName({ full_name: "Ana", email: "x@example.test" }), "Ana")

  const first = addRecipients([], [person("a"), person("b"), person("a")], 5)
  assert.deepEqual([first.list.map((p) => p.id), first.added, first.overLimit], [["a", "b"], 2, 0])
  const second = addRecipients(first.list, [person("b"), person("c"), person("d")], 3)
  assert.deepEqual([second.list.map((p) => p.id), second.added, second.overLimit], [["a", "b", "c"], 1, 1], "stops at the limit and says how many did not fit")
  assert.deepEqual(addRecipients(second.list, [], 3).list, second.list)

  const draft = { title: "Closed Friday", body: "The site is closed.", link: "", channel: "both", count: 3, isSuper: false }
  assert.equal(validateMessage(draft), null)
  assert.match(validateMessage({ ...draft, count: 0 }), /at least one person/); assert.match(validateMessage({ ...draft, count: 201 }), /at most 200/)
  assert.equal(validateMessage({ ...draft, count: 201, isSuper: true }), null); assert.match(validateMessage({ ...draft, count: 501, isSuper: true }), /at most 500/)
  assert.match(validateMessage({ ...draft, channel: "sms" }), /how to send/); assert.match(validateMessage({ ...draft, title: " " }), /title/); assert.match(validateMessage({ ...draft, body: "" }), /Write the message/)
  assert.match(validateMessage({ ...draft, body: "x".repeat(BODY_MAX + 1) }), /at most 500/); assert.match(validateMessage({ ...draft, title: "x".repeat(121) }), /at most 120/)
  for (const link of ["https://evil.example", "//evil.example", "javascript:alert(1)", "/Bad"]) assert.match(validateMessage({ ...draft, link }), /inside BuildTrack/, link)
  assert.equal(validateMessage({ ...draft, link: " /engineer/dashboard " }), null)

  assert.equal(parsePreview(null), null); assert.equal(parsePreview({ requested: 1 }), null); assert.equal(parsePreview({ requested: "1", eligible: 1, not_eligible: 0, will_email: 0, opted_out: 0 }), null)
  const preview = parsePreview({ requested: 7, eligible: 5, not_eligible: 2, will_email: 3, opted_out: 2, by_role: { engineer: 1, foreman: 4, bad: "x" }, sample: ["Ana", 5, "Ben"] })
  assert.deepEqual(preview, { requested: 7, eligible: 5, not_eligible: 2, will_email: 3, opted_out: 2, by_role: { engineer: 1, foreman: 4 }, sample: ["Ana", "Ben"] })
  assert.deepEqual(previewLines(preview, "app"), ["5 people will receive this message.", "2 chosen accounts cannot receive it (not active) and will be left out."])
  const both = previewLines(preview, "both")
  assert.ok(both.includes("3 emails will be queued for sending.") && both.some((line) => /2 people will get no email/.test(line)))
  assert.ok(previewLines({ ...preview, eligible: 1, not_eligible: 0, will_email: 1, opted_out: 0 }, "email").some((line) => line === "1 email will be queued for sending."))
  assert.ok(both.some((line) => /still get the bell message\.$/.test(line)), "in the app and by email: opted-out people keep the bell message")
  const emailOnly = previewLines(preview, "email")
  assert.ok(emailOnly.some((line) => /2 people will get no email .*, so they receive nothing\.$/.test(line)), "email only: opted-out people receive nothing, and the text says so")
  assert.ok(!emailOnly.some((line) => /bell message/.test(line)))

  const batch = { id: "b", created_at: "2026-11-01T00:00:00Z", sender_name: "A", title: "T", channel: "both", requested_count: 5, delivered_count: 4, skipped_count: 1, email_sent: 2, email_failed: 0, email_skipped: 1, email_waiting: 1 }
  assert.equal(outcomeSummary(batch), "4 of 5 people; email: 2 sent, 1 waiting, 1 skipped, 0 failed")
  assert.equal(outcomeSummary({ ...batch, channel: "app", requested_count: 1, delivered_count: 1 }), "1 of 1 person in the app")
  assert.equal(channelLabel("email"), "Email only")

  assert.equal(isMissingFunction({ code: "PGRST202" }), true); assert.equal(isMissingFunction({ message: "Could not find the function public.send_admin_message" }), true)
  assert.equal(isMissingFunction({ message: "Too many messages in the last hour" }), false); assert.equal(isMissingFunction(null), false)
  assert.match(friendlyMessageError({ code: "PGRST202" }), /migration 20261101090000_admin_communications/)
  assert.match(friendlyMessageError({ message: "Missing permission: users.edit" }), /do not have permission/)
  assert.match(friendlyMessageError({ message: "TypeError: Failed to fetch" }), /Network problem/)
  assert.equal(friendlyMessageError({ message: "Daily limit of 1000 recipients reached. Try again tomorrow" }), "Daily limit of 1000 recipients reached. Try again tomorrow")
}

// ---------------------------------------------------------------- a small harness that runs React hooks without a browser
function hooksHarness() {
  let state = [], effects = [], cursor = 0, pending = []
  const same = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]))
  const hooks = {
    useState(initial) { const n = cursor++; if (!(n in state)) state[n] = typeof initial === "function" ? initial() : initial; return [state[n], (value) => { state[n] = typeof value === "function" ? value(state[n]) : value }] },
    useRef(initial) { const n = cursor++; return state[n] ??= { current: initial } },
    useMemo(fn, deps) { const n = cursor++; if (!same(state[n]?.deps, deps)) state[n] = { deps, value: fn() }; return state[n].value },
    useCallback(fn, deps) { const n = cursor++; if (!same(state[n]?.deps, deps)) state[n] = { deps, fn }; return state[n].fn },
    useEffect(fn, deps) { const n = cursor++; if (!same(effects[n]?.deps, deps)) pending.push(() => { effects[n]?.cleanup?.(); effects[n] = { deps, cleanup: fn() } }) },
  }
  return { hooks, render(fn) { cursor = 0; const value = fn(); const work = pending; pending = []; work.forEach((run) => run()); return value }, unmount() { effects.forEach((effect) => effect?.cleanup?.()) } }
}
const transpile = (path, replacements) => {
  let source = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
  for (const [name, replacement] of Object.entries(replacements)) source = source.replaceAll(`from "${name}"`, `from ${JSON.stringify(replacement)}`)
  return source
}
const text = (node) => Array.isArray(node) ? node.map(text).join("") : typeof node === "object" && node ? text(node.props?.children) : node === undefined || node === null || typeof node === "boolean" ? "" : String(node)
const find = (node, predicate) => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap((child) => find(child, predicate)) : [...(predicate(node) ? [node] : []), ...find(node.props?.children, predicate)]

// ---------------------------------------------------------------- the banner hook: polling, dismissal per revision, critical, errors, storage, other tabs
{
  const harness = hooksHarness()
  globalThis.__bannerHooks = harness.hooks
  const timers = new Map(); let nextTimer = 0
  const listeners = { window: {}, document: {} }
  const store = new Map(); let storageBroken = false
  const rpcCalls = []; let rpcAnswer = { data: [], error: null }
  globalThis.__bannerRpc = (name) => { rpcCalls.push(name); return Promise.resolve(rpcAnswer) }
  const saved = { window: globalThis.window, document: globalThis.document, localStorage: globalThis.localStorage }
  globalThis.window = { setInterval: (fn, ms) => { const id = ++nextTimer; timers.set(id, { fn, ms }); return id }, clearInterval: (id) => timers.delete(id), addEventListener: (type, fn) => (listeners.window[type] = fn), removeEventListener: (type) => delete listeners.window[type] }
  globalThis.document = { visibilityState: "visible", addEventListener: (type, fn) => (listeners.document[type] = fn), removeEventListener: (type) => delete listeners.document[type] }
  globalThis.localStorage = { getItem: (key) => { if (storageBroken) throw new Error("blocked"); return store.get(key) ?? null }, setItem: (key, value) => { if (storageBroken) throw new Error("blocked"); store.set(key, value) } }
  const source = transpile("../src/lib/announcements.ts", { react: url("export const {useState,useEffect,useCallback}=globalThis.__bannerHooks;"), "./supabase": url("export const supabase={rpc:(...a)=>globalThis.__bannerRpc(...a)};"), "./announcementModel": fileUrl("../src/lib/announcementModel.ts") })
  const { useActiveAnnouncement } = await import(url(source))
  const row = (extra = {}) => ({ title: "Planned maintenance", message: "Back by 11.", tone: "warning", revision: 2, ...extra })
  const render = () => harness.render(() => useActiveAnnouncement())
  const tick = async () => { timers.forEach(({ fn }) => fn()); await settle() }

  let view = render(); await settle(); assert.equal(view.announcement, null, "nothing before the first answer")
  assert.deepEqual(rpcCalls, ["get_active_announcement"])
  rpcAnswer = { data: [row()], error: null }; await tick(); view = render()
  assert.equal(view.announcement.title, "Planned maintenance")
  assert.equal([...timers.values()][0].ms, REFRESH_MS); assert.equal(REFRESH_MS, 30_000, "about every 30 seconds")

  const callsBefore = rpcCalls.length
  globalThis.document.visibilityState = "hidden"; await tick(); assert.equal(rpcCalls.length, callsBefore, "no request while the page is hidden")
  globalThis.document.visibilityState = "visible"; listeners.document.visibilitychange(); await settle(); assert.equal(rpcCalls.length, callsBefore + 1, "asks again when the tab becomes visible")

  view.dismiss(); view = render()
  assert.equal(view.announcement, null, "dismissed"); assert.equal(store.get(DISMISS_KEY), "2")
  rpcAnswer = { data: [row({ revision: 2 })], error: null }; await tick(); view = render(); assert.equal(view.announcement, null, "still dismissed after a refresh of the same revision")
  rpcAnswer = { data: [row({ revision: 3, message: "Back by midnight." })], error: null }; await tick(); view = render()
  assert.equal(view.announcement.message, "Back by midnight.", "an edited announcement appears again")

  rpcAnswer = { data: [row({ revision: 4, tone: "critical" })], error: null }; await tick(); view = render()
  view.dismiss(); view = render(); assert.equal(view.announcement.tone, "critical", "a critical announcement cannot be dismissed"); assert.equal(store.get(DISMISS_KEY), "2", "and nothing was stored")

  rpcAnswer = { data: null, error: { message: "network" } }; await tick(); view = render()
  assert.equal(view.announcement.revision, 4, "a failed read keeps what was shown")
  rpcAnswer = { data: [], error: null }; await tick(); view = render(); assert.equal(view.announcement, null, "switched off: it disappears")
  rpcAnswer = { data: [{ title: "", message: "x", tone: "info", revision: 1 }], error: null }; await tick(); view = render(); assert.equal(view.announcement, null, "an incomplete row is ignored")
  rpcAnswer = { data: [row({ revision: 9, tone: "info" })], error: null }; await tick(); view = render(); assert.equal(view.announcement.revision, 9)

  store.set(DISMISS_KEY, "9"); listeners.window.storage({ key: DISMISS_KEY }); view = render(); assert.equal(view.announcement, null, "dismissing in another tab hides it here")
  listeners.window.storage({ key: "other" }); view = render(); assert.equal(view.announcement, null)

  storageBroken = true; rpcAnswer = { data: [row({ revision: 10 })], error: null }; await tick(); view = render(); view.dismiss(); view = render()
  assert.equal(view.announcement, null, "with blocked storage the dismissal still works for this page"); storageBroken = false

  harness.unmount(); assert.equal(timers.size, 0, "the timer stops when the page unmounts"); assert.equal(Object.keys(listeners.window).length + Object.keys(listeners.document).length, 0, "and the listeners are removed")
  Object.assign(globalThis, saved); if (saved.window === undefined) delete globalThis.window; if (saved.document === undefined) delete globalThis.document; if (saved.localStorage === undefined) delete globalThis.localStorage
  delete globalThis.__bannerHooks; delete globalThis.__bannerRpc
}

// ---------------------------------------------------------------- the banner component: plain text, role, dismiss button
{
  const source = transpile("../src/components/AnnouncementBanner.tsx", { "../lib/announcements": url("export const useActiveAnnouncement=()=>globalThis.__bannerState;"), "../lib/announcementModel": fileUrl("../src/lib/announcementModel.ts"), "react/jsx-runtime": import.meta.resolve("react/jsx-runtime") })
  const { default: AnnouncementBanner, AnnouncementView } = await import(url(source))
  const hostile = { title: "<img src=x onerror=alert(1)>", message: "Line one\nLine <b>two</b>", tone: "info", revision: 1 }
  const view = AnnouncementView({ announcement: hostile, onDismiss: () => {} })
  assert.equal(view.props.role, "status"); assert.equal(view.props["aria-label"], "Announcement")
  const body = text(view)
  assert.ok(body.includes("<img src=x onerror=alert(1)>") && body.includes("Line <b>two</b>"), "markup in an announcement stays text (React escapes it)")
  assert.ok(find(view, (node) => typeof node.type === "string" && /^(img|script|iframe|a)$/.test(node.type)).length === 0, "no element is created from the text")
  assert.equal(find(view, (node) => node.type === "button").length, 1, "an info banner can be dismissed")
  const critical = AnnouncementView({ announcement: { ...hostile, tone: "critical" }, onDismiss: () => {} })
  assert.equal(critical.props.role, "alert"); assert.equal(find(critical, (node) => node.type === "button").length, 0, "a critical banner has no close button")
  assert.equal(find(AnnouncementView({ announcement: hostile }), (node) => node.type === "button").length, 0, "the admin preview has no working close button")
  globalThis.__bannerState = { announcement: null, dismiss() {} }; assert.equal(AnnouncementBanner(), null, "nothing is drawn without an active announcement")
  let dismissed = 0
  globalThis.__bannerState = { announcement: hostile, dismiss: () => dismissed++ }
  const shown = AnnouncementBanner() // an element for AnnouncementView: draw it, then press its close button
  find(shown.type(shown.props), (node) => node.type === "button")[0].props.onClick(); assert.equal(dismissed, 1)
  delete globalThis.__bannerState
}

// ---------------------------------------------------------------- the notification hooks: accurate unread count, mark all, hidden rows, email choices
{
  const harness = hooksHarness()
  globalThis.__noteHooks = harness.hooks
  const log = []
  let rows = [], unread = 0, rpcErrors = new Set(), prefsRow = null, prefsColumnsMissing = false
  const builder = (table) => {
    const q = { ops: [], then: (resolve, reject) => Promise.resolve(answer(q)).then(resolve, reject) }
    for (const name of ["select", "not", "is", "order", "limit", "range", "eq", "update", "insert", "maybeSingle"]) q[name] = (...args) => { q.ops.push([name, ...args]); return q }
    q.table = table
    return q
  }
  const has = (q, name) => q.ops.find((op) => op[0] === name)
  const answer = (q) => {
    log.push(q)
    if (q.table === "notifications") return has(q, "select")[2]?.head ? { count: unread, error: null } : { data: rows, error: null }
    if (q.table === "notification_prefs") {
      if (has(q, "update") || has(q, "insert")) return { error: null }
      const columns = has(q, "select")[1]
      if (columns.includes("email_reminders") && prefsColumnsMissing) return { data: null, error: { message: "column does not exist" } }
      return { data: prefsRow ? Object.fromEntries(columns.split(",").filter((c) => c in prefsRow).map((c) => [c, prefsRow[c]])) : null, error: null }
    }
    return { data: null, error: null }
  }
  const rpcCalls = []
  globalThis.__noteSupabase = { from: builder, rpc: (name, args) => { rpcCalls.push([name, args]); return Promise.resolve({ data: 0, error: rpcErrors.has(name) ? { message: "missing" } : null }) } }
  const savedWindow = globalThis.window, savedDocument = globalThis.document, savedSession = globalThis.sessionStorage
  const timers = new Map(); let nextTimer = 0
  globalThis.window = { setInterval: (fn) => { timers.set(++nextTimer, fn); return nextTimer }, clearInterval: (id) => timers.delete(id), addEventListener() {}, removeEventListener() {}, history: { pushState: (...args) => navigations.push(args) }, scrollTo() {}, dispatchEvent() {} }
  globalThis.PopStateEvent = class {}
  globalThis.document = { visibilityState: "visible" }
  globalThis.sessionStorage = { getItem: () => String(Date.now()), setItem() {} } // reminders were just requested: skip them in this test
  const navigations = []
  const source = transpile("../src/lib/notifications.ts", { react: url("export const useState=(...a)=>globalThis.__noteHooks.useState(...a),useEffect=(...a)=>globalThis.__noteHooks.useEffect(...a),useCallback=(...a)=>globalThis.__noteHooks.useCallback(...a),useRef=(...a)=>globalThis.__noteHooks.useRef(...a);"), "./supabase": url("export const supabase=globalThis.__noteSupabase;"), "./realtime": url("export const useLiveReload=()=>{};"), "./notificationModel": fileUrl("../src/lib/notificationModel.ts") })
  const notifications = await import(url(source))
  const item = (id, read) => ({ id, kind: "pin.assigned", title: "Task " + id, body: null, link: "/foreman/dashboard", project_id: null, entity_id: null, created_at: "2026-11-01T00:00:00Z", read_at: read ? "2026-11-01T01:00:00Z" : null })

  // unread count comes from a count query over ALL notifications, not from the 50 on screen; email-only rows are excluded from both queries
  rows = [item("a", false), item("b", true)]; unread = 120
  let view = harness.render(() => notifications.useNotifications()); await settle(); await settle(); view = harness.render(() => notifications.useNotifications())
  assert.equal(view.unread, 120, "the badge counts every unread notification")
  assert.equal(view.items.length, 2)
  const listQuery = log.find((q) => q.table === "notifications" && !has(q, "select")[2]?.head), countQuery = log.find((q) => q.table === "notifications" && has(q, "select")[2]?.head)
  for (const q of [listQuery, countQuery]) assert.deepEqual(has(q, "not").slice(1), ["kind", "in", "(announcement.email)"], "email-only messages never reach the bell")
  assert.deepEqual(has(countQuery, "is").slice(1), ["read_at", null])

  // mark all read: one database call for every unread row; falls back to the loaded ones when the function is not installed
  await view.markAllRead(); view = harness.render(() => notifications.useNotifications())
  assert.equal(rpcCalls.at(-1)[0], "mark_all_notifications_read"); assert.equal(view.unread, 0); assert.ok(view.items.every((n) => n.read_at))
  rows = [item("c", false), item("d", false)]; unread = 2; rpcErrors = new Set(["mark_all_notifications_read"]); rpcCalls.length = 0
  await settle(); await view.reload(); view = harness.render(() => notifications.useNotifications())
  await view.markAllRead()
  assert.deepEqual(rpcCalls.map((call) => call[0]), ["mark_all_notifications_read", "mark_notifications_read"], "falls back to marking the loaded rows")
  assert.deepEqual(rpcCalls[1][1].p_ids.sort(), ["c", "d"]); rpcErrors.clear()

  // links: only BuildTrack pages are ever followed
  notifications.followLink("https://evil.example/login", null); notifications.followLink("//evil.example", "p1"); notifications.followLink("javascript:alert(1)", null)
  assert.equal(navigations.length, 0, "nothing outside the app is opened")
  for (const bad of ["/\\evil.example", "/x y", "evil", "", null]) notifications.followLink(bad, null)
  assert.equal(navigations.length, 0, "backslash, spaces and relative text are not in-app paths either")
  notifications.followLink("/engineer/qa?project=p1", "p1"); assert.equal(navigations.length, 1); assert.equal(navigations[0][2], "/engineer/qa?project=p1")
  // paths the app builds itself (encoded ids, mixed case) must keep working: followLink is not the strict notification-link check
  notifications.followLink("/engineer/qa?project=a%20b&tab=Inspections&item=Item-1", null); assert.equal(navigations.length, 2, "code-built links with % and capitals still navigate")
  harness.unmount()

  // email choices: master + reminders + announcements; with the old database only the master switch exists
  const prefs = hooksHarness(); globalThis.__noteHooks = prefs.hooks
  prefsRow = { email_enabled: true, email_reminders: false, email_announcements: true }; log.length = 0
  let choice = prefs.render(() => notifications.useEmailPreference("u1")); await settle(); await settle(); choice = prefs.render(() => notifications.useEmailPreference("u1"))
  assert.deepEqual([choice.enabled, choice.reminders, choice.announcements, choice.categories], [true, false, true, true])
  assert.equal(await choice.changeReminders(true), null)
  const write = log.filter((q) => q.table === "notification_prefs").at(-1)
  assert.deepEqual(has(write, "update").slice(1), [{ email_reminders: true }], "only the changed choice is written")
  choice = prefs.render(() => notifications.useEmailPreference("u1")); assert.equal(choice.reminders, true)
  prefsRow = null; prefs.unmount()
  const fresh = hooksHarness(); globalThis.__noteHooks = fresh.hooks
  choice = fresh.render(() => notifications.useEmailPreference("u2")); await settle(); await settle(); choice = fresh.render(() => notifications.useEmailPreference("u2"))
  assert.deepEqual([choice.enabled, choice.reminders, choice.announcements], [true, true, true], "everything is on until the person chooses")
  await choice.changeAnnouncements(false)
  assert.deepEqual(has(log.filter((q) => q.table === "notification_prefs").at(-1), "insert").slice(1), [{ user_id: "u2", email_announcements: false }], "the row is created with the chosen value only")
  fresh.unmount()
  const old = hooksHarness(); globalThis.__noteHooks = old.hooks
  prefsColumnsMissing = true; prefsRow = { email_enabled: false }
  choice = old.render(() => notifications.useEmailPreference("u3")); await settle(); await settle(); await settle(); choice = old.render(() => notifications.useEmailPreference("u3"))
  assert.deepEqual([choice.enabled, choice.categories], [false, false], "without the migration only the master switch is offered and its value is still read")
  old.unmount()

  Object.assign(globalThis, { window: savedWindow, document: savedDocument, sessionStorage: savedSession })
  for (const key of ["window", "document", "sessionStorage"]) if (globalThis[key] === undefined) delete globalThis[key]
  delete globalThis.PopStateEvent; delete globalThis.__noteHooks; delete globalThis.__noteSupabase
}

// ---------------------------------------------------------------- the hub page: review before sending, one batch id per send, publishing asks first
{
  const harness = hooksHarness()
  globalThis.__pageHooks = harness.hooks
  const delegate = (name) => `${name}=(...a)=>globalThis.__pageHooks.${name}(...a)`
  const calls = { search: [], preview: [], send: [], save: [], toast: [], confirm: [] }
  let sendAnswer = { error: "", setup: false, data: { batch_id: "x", duplicate: false, delivered: 3, skipped: 0 } }
  let previewAnswer = { error: "", setup: false, data: { requested: 3, eligible: 3, not_eligible: 0, will_email: 2, opted_out: 1, by_role: { engineer: 3 }, sample: ["Ana", "Ben", "Cy"] } }
  let confirmAnswer = true
  let settings = { enabled: false, title: "", message: "", tone: "info", revision: 0, updated_at: "2026-11-01T00:00:00Z", updated_by_name: null }
  const people = ["a", "b", "c"].map((id) => ({ id, full_name: "Person " + id, email: id + "@example.test", role: "engineer", company: null }))
  globalThis.__pageApi = {
    searchRecipients: async (query, roles, limit) => { calls.search.push([query, roles, limit]); return { error: "", setup: false, data: people } },
    previewAudience: async (ids, channel) => { calls.preview.push([ids, channel]); return previewAnswer },
    sendMessage: async (input) => { calls.send.push(input); return sendAnswer },
    listBatches: async () => ({ error: "", setup: false, data: [] }),
    loadAnnouncementSettings: async () => ({ error: "", setup: false, data: settings }),
    saveAnnouncement: async (input) => { calls.save.push(input); return { error: "", setup: false, data: 1 } },
  }
  globalThis.__pageToast = { error: (...a) => calls.toast.push(["error", ...a]), success: (...a) => calls.toast.push(["success", ...a]) }
  globalThis.__pageConfirm = async (options) => { calls.confirm.push(options); return confirmAnswer }
  const timeouts = new Map(); let nextTimeout = 0
  const savedWindow = globalThis.window
  globalThis.window = { setTimeout: (fn) => { timeouts.set(++nextTimeout, fn); return nextTimeout }, clearTimeout: (id) => timeouts.delete(id) }
  const noop = "export default function X(){return null}"
  const source = transpile("../src/pages/Admin/Communications.tsx", {
    react: url(`export const ${delegate("useState")},${delegate("useEffect")},${delegate("useCallback")},${delegate("useMemo")},${delegate("useRef")};`),
    "react/jsx-runtime": import.meta.resolve("react/jsx-runtime"),
    "../../components/AnnouncementBanner": url("export const AnnouncementView=function AnnouncementView(){return null};"),
    "../../components/Modal": url(noop),
    "../../components/ui/PageParts": url("export const EmptyState=function EmptyState(){return null},buttonPrimary='primary',buttonSecondary='secondary',inputClass='input';"),
    "../../components/ui/Skeleton": url("export const Skeleton=function Skeleton(){return null},SkeletonRows=function SkeletonRows(){return null};"),
    "../../lib/admin": url("export const formatDate=(x)=>x,formatTime=(x)=>x,roleLabel={engineer:'Engineer',foreman:'Foreman',client:'Client',project_manager:'Project Manager'};"),
    "../../lib/announcementModel": fileUrl("../src/lib/announcementModel.ts"),
    "../../lib/auth": url("export const useAuth=()=>({profile:{role:'admin'},can:()=>true});"),
    "../../lib/communications": url("export const searchRecipients=(...a)=>globalThis.__pageApi.searchRecipients(...a),previewAudience=(...a)=>globalThis.__pageApi.previewAudience(...a),sendMessage=(...a)=>globalThis.__pageApi.sendMessage(...a),listBatches=(...a)=>globalThis.__pageApi.listBatches(...a),loadAnnouncementSettings=(...a)=>globalThis.__pageApi.loadAnnouncementSettings(...a),saveAnnouncement=(...a)=>globalThis.__pageApi.saveAnnouncement(...a);"),
    "../../lib/communicationsModel": fileUrl("../src/lib/communicationsModel.ts"),
    "../../lib/confirm": url("export const useConfirm=()=>globalThis.__pageConfirm;"),
    "../../lib/toast": url("export const useToast=()=>globalThis.__pageToast;"),
    "./AdminShell": url("export const PageIntro=function PageIntro(){return null},Panel=function Panel(){return null};"),
  })
  const page = await import(url(source))
  const all = (node, predicate) => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap((child) => all(child, predicate)) : [...(predicate(node) ? [node] : []), ...all(node.props?.children, predicate), ...all(node.props?.footer, predicate), ...all(node.props?.action, predicate)]
  const button = (tree, wording) => all(tree, (node) => node.type === "button" && text(node).includes(wording))[0]
  const field = (tree, predicate) => all(tree, (node) => (node.type === "input" || node.type === "textarea") && predicate(node.props))[0]
  const click = async (element) => { element.props.onClick(); await settle(); await settle() } // handlers start their work without returning it, so let it finish
  const draw = () => harness.render(() => page.MessagePanel({ isSuper: false, onSent: () => calls.sent = (calls.sent ?? 0) + 1 }))

  let tree = draw()
  await click(button(tree, "All Engineers")); tree = draw()
  assert.deepEqual(calls.search[0], ["", ["engineer"], 201], "a whole group is loaded up to the limit")
  assert.equal(all(tree, (node) => node.type === "li" && node.props["aria-label"] === undefined && text(node).includes("Person a")).length >= 1, true)
  assert.match(text(tree), /3 chosen/)

  // not ready: nothing is previewed
  await click(button(tree, "Review and send"))
  assert.equal(calls.preview.length, 0, "no preview without a title and a message"); assert.equal(calls.toast.at(-1)[0], "error")
  field(tree, (props) => props.maxLength === 120).props.onChange({ target: { value: "Site closed" } })
  field(tree, (props) => props.maxLength === 500).props.onChange({ target: { value: "Closed on Friday." } })
  tree = draw()
  all(tree, (node) => node.type === "input" && node.props.type === "radio")[2].props.onChange() // in the app and by email
  tree = draw()
  await click(button(tree, "Review and send")); tree = draw()
  assert.deepEqual(calls.preview[0], [["a", "b", "c"], "both"], "the audience is previewed before anything is sent")
  assert.equal(calls.send.length, 0, "and still nothing was sent")
  const modal = all(tree, (node) => node.props?.title === "Send this message?")[0]
  assert.ok(modal, "the confirmation dialog is open"); assert.match(modal.props.description, /3 people/)
  assert.match(text(modal), /3 people will receive this message\./); assert.match(text(modal), /2 emails will be queued/); assert.match(text(modal), /1 person will get no email/)

  // a failed send keeps the same batch id, so pressing Send again cannot create a duplicate
  sendAnswer = { error: "Too many messages in the last hour. Try again later", setup: false, data: null }
  await click(button(modal, "Send to 3 people")); tree = draw()
  assert.equal(calls.send.length, 1); assert.equal(calls.toast.at(-1)[1], "Not sent"); assert.ok(all(tree, (node) => node.props?.title === "Send this message?").length, "the dialog stays open after a failure")
  sendAnswer = { error: "", setup: false, data: { batch_id: "x", duplicate: false, delivered: 3, skipped: 0 } }
  await button(all(tree, (node) => node.props?.title === "Send this message?")[0], "Send to 3 people").props.onClick(); tree = draw()
  assert.equal(calls.send.length, 2); assert.equal(calls.send[1].batch, calls.send[0].batch, "the retry carries the same batch id")
  assert.deepEqual(calls.send[1].ids, ["a", "b", "c"]); assert.equal(calls.send[1].channel, "both"); assert.equal(calls.send[1].title, "Site closed")
  assert.equal(calls.toast.at(-1)[1], "Sent to 3 people"); assert.equal(calls.sent, 1, "the history is refreshed")
  assert.match(text(tree), /0 chosen/); assert.equal(all(tree, (node) => node.props?.title === "Send this message?").length, 0)

  // the next message gets its own batch id
  await click(button(tree, "All Engineers")); tree = draw()
  field(tree, (props) => props.maxLength === 120).props.onChange({ target: { value: "Second" } }); field(tree, (props) => props.maxLength === 500).props.onChange({ target: { value: "Another message." } }); tree = draw()
  await click(button(tree, "Review and send")); tree = draw()
  await button(all(tree, (node) => node.props?.title === "Send this message?")[0], "Send to 3 people").props.onClick()
  assert.notEqual(calls.send[2].batch, calls.send[0].batch, "a new message is a new batch")

  // nobody eligible: nothing to confirm
  previewAnswer = { error: "", setup: false, data: { requested: 1, eligible: 0, not_eligible: 1, will_email: 0, opted_out: 0, by_role: {}, sample: [] } }
  tree = draw(); await click(button(tree, "All Engineers")); tree = draw()
  field(tree, (props) => props.maxLength === 120).props.onChange({ target: { value: "Third" } }); field(tree, (props) => props.maxLength === 500).props.onChange({ target: { value: "Nobody." } }); tree = draw()
  await click(button(tree, "Review and send")); tree = draw()
  assert.equal(all(tree, (node) => node.props?.title === "Send this message?").length, 0); assert.equal(calls.toast.at(-1)[1], "Nobody can receive this")
  harness.unmount()

  // the banner panel: validation first, then a confirmation that says who will see it, then the save with trimmed text
  const banner = hooksHarness(); globalThis.__pageHooks = banner.hooks
  let panel = banner.render(() => page.AnnouncementPanel()); await settle(); await settle(); panel = banner.render(() => page.AnnouncementPanel())
  await click(button(panel, "Publish announcement"))
  assert.equal(calls.save.length, 0, "an empty banner is never published (the button is disabled)")
  assert.equal(button(panel, "Publish announcement").props.disabled, true)
  all(panel, (node) => node.type === "input" && node.props.maxLength === 80)[0].props.onChange({ target: { value: "  Planned maintenance  " } })
  all(panel, (node) => node.type === "textarea")[0].props.onChange({ target: { value: "Saturday 10 pm.  " } }); panel = banner.render(() => page.AnnouncementPanel())
  confirmAnswer = false
  await click(button(panel, "Publish announcement"))
  assert.equal(calls.save.length, 0, "declining the confirmation saves nothing"); assert.match(calls.confirm.at(-1).message, /every page for everyone, including visitors who are not signed in/)
  confirmAnswer = true
  await click(button(panel, "Publish announcement"))
  assert.deepEqual(calls.save[0], { title: "  Planned maintenance  ", message: "Saturday 10 pm.  ", tone: "info", enabled: true }, "the page sends the text; the database trims and validates it again")
  assert.equal(calls.confirm.at(-1).confirmLabel, "Publish")
  banner.unmount()
  Object.assign(globalThis, { window: savedWindow }); if (savedWindow === undefined) delete globalThis.window
  for (const key of ["__pageHooks", "__pageApi", "__pageToast", "__pageConfirm"]) delete globalThis[key]
}

console.log("Communications: notification categories and links, email footers, banner rules, hook, component and dismissal, hub rules, notification and preference hooks, and the hub page passed")
