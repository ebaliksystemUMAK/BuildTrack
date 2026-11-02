// Turns the raw system health report into plain results with a suggested action each (no network, no React). It only reads: nothing here repairs,
// re-runs or changes anything, and the report it reads has no secrets in it.
import type { BUCKETS as BucketList, FEATURES as FeatureList } from "./healthManifest.ts"

export type HealthStatus = "ok" | "info" | "unknown" | "warn" | "fail"
export type HealthCheck = { id: string; group: string; title: string; status: HealthStatus; summary: string; action?: string; details?: string[] }

export type RawObject = { kind: string; name: string; exists: boolean; public?: boolean }
export type RawJob = { name: string; schedule: string; active: boolean; last_status: string | null; last_run: string | null; last_message: string | null }
export type RawHealth = {
  checked_at: string
  database: { ok: boolean; version: number }
  migrations: { available: boolean; recorded?: number; latest_version?: string; latest_name?: string; names?: string[] }
  objects: RawObject[]
  buckets: Array<{ id: string; public: boolean; objects: number }>
  cron: { installed: boolean; jobs: RawJob[] }
  email_queue: { waiting: number; waiting_over_1d: number; sent_24h: number; failed_24h: number; skipped_24h: number }
  digest: { last_run: null | { run_date: string; started_at: string; finished_at: string | null; status: string; recipients: number; created: number; skipped_empty: number; skipped_opt_out: number; detail: string | null }; last_ok_at: string | null; failed_7d: number }
  email_tests: Array<{ id: number; created_at: string; status: string; provider_status: number | null }>
}

export type EdgeMailConfig = { brevo_api_key: boolean; mail_from_email: boolean; mail_from_name: boolean; app_url: { set: boolean; valid: boolean }; cron_secret: { set: boolean; strong: boolean }; can_send: boolean }
export type EdgeAnswer = { ok: true; config: EdgeMailConfig } | { ok: false; reason: string }

const rank: Record<HealthStatus, number> = { ok: 0, info: 1, unknown: 2, warn: 3, fail: 4 }
export const worst = (statuses: HealthStatus[]): HealthStatus => statuses.reduce<HealthStatus>((top, status) => (rank[status] > rank[top] ? status : top), "ok")
export const statusLabel: Record<HealthStatus, string> = { ok: "Working", info: "Not set up", unknown: "Cannot tell", warn: "Needs attention", fail: "Problem" }

const plural = (count: number, one: string, many = one + "s") => `${count} ${count === 1 ? one : many}`
const LATE_DIGEST_HOURS = 26

export function evaluateHealth(raw: RawHealth | null, edge: EdgeAnswer, options: { now: Date; features: typeof FeatureList; buckets: typeof BucketList; tracked: string[] }): HealthCheck[] {
  if (!raw) {
    return [{ id: "database", group: "Database", title: "Database connection", status: "fail", summary: "The report could not be read. The database may be unreachable, or this sign-in is not a verified Super Admin session.",
      action: "Check your connection, then sign in again and verify with the authenticator app. If it keeps failing, look at the project in the Supabase dashboard." }]
  }
  const checks: HealthCheck[] = []
  const exists = new Map(raw.objects.map((item) => [`${item.kind}:${item.name}`, item]))
  checks.push({ id: "database", group: "Database", title: "Database connection", status: raw.database?.ok ? "ok" : "fail", summary: raw.database?.ok ? `Connected (PostgreSQL ${raw.database.version}). Checked ${new Date(raw.checked_at).toISOString()}.` : "The database answered, but reported a problem.", action: raw.database?.ok ? undefined : "Look at the project in the Supabase dashboard." })

  // Migration history. Only the migrations tracked since 18 Oct 2026 are compared; older ones are covered by the schema checks.
  if (!raw.migrations?.available) {
    checks.push({ id: "migrations", group: "Migrations", title: "Migration history", status: "unknown", summary: "The database's migration history cannot be read here.", action: "Open Database > Migrations in the Supabase dashboard to see what was applied." })
  } else {
    const names = new Set(raw.migrations.names ?? [])
    const missing = options.tracked.filter((name) => !names.has(name))
    checks.push(missing.length === 0
      ? { id: "migrations", group: "Migrations", title: "Migration history", status: "ok", summary: `All ${options.tracked.length} tracked migrations are recorded. Latest recorded: ${raw.migrations.latest_name} (${raw.migrations.latest_version}). Older, numbered migrations were run in the SQL Editor and are checked through the schema below.` }
      : { id: "migrations", group: "Migrations", title: "Migration history", status: "warn", summary: `${plural(missing.length, "tracked migration is", "tracked migrations are")} not in the history. A missing record does not prove the schema is missing: look at the schema checks below.`,
          action: "If a feature below is also missing, the owner reviews and runs that migration. Never re-run one that is already applied.", details: missing })
  }

  // Required schema, one result per feature.
  for (const feature of options.features) {
    const gone = feature.needs.filter((item) => !exists.get(`${item.kind}:${item.name}`)?.exists)
    checks.push(gone.length === 0
      ? { id: `schema:${feature.key}`, group: "Required schema", title: feature.label, status: "ok", summary: `All ${feature.needs.length} required parts are present.` }
      : { id: `schema:${feature.key}`, group: "Required schema", title: feature.label, status: "fail", summary: `${plural(gone.length, "required part is", "required parts are")} missing, so this feature may fail.`, action: feature.action, details: gone.map((item) => `${item.kind} ${item.name}`) })
  }

  // Storage.
  const found = new Map(raw.buckets.map((bucket) => [bucket.id, bucket]))
  const storageDetails: string[] = []
  const storageStatuses: HealthStatus[] = []
  const storageProblems: string[] = []
  for (const expected of options.buckets) {
    const bucket = found.get(expected.id)
    if (!bucket) { storageStatuses.push("fail"); storageProblems.push(`${expected.id} is missing`); storageDetails.push(`${expected.id}: missing`); continue }
    storageDetails.push(`${expected.id}: ${bucket.public ? "public" : "private"}, ${plural(bucket.objects, "file")}`)
    if (!expected.public && bucket.public) { storageStatuses.push("fail"); storageProblems.push(`${expected.id} is public but must be private`) }
    else if (expected.public && !bucket.public) { storageStatuses.push("warn"); storageProblems.push(`${expected.id} is private but should be public`) }
  }
  const storage = worst(storageStatuses)
  checks.push({ id: "storage", group: "Storage", title: "File storage buckets", status: storage, details: storageDetails,
    summary: storage === "ok" ? `All ${options.buckets.length} buckets exist with the right visibility.` : storageProblems.join("; ") + ".",
    action: storage === "ok" ? undefined : "Open Storage in the Supabase dashboard. A private bucket that is public exposes its files: fix that first." })

  // Email configuration (known only to the Edge Function).
  const config = edge.ok ? edge.config : null
  if (!config) {
    checks.push({ id: "email-config", group: "Email", title: "Email settings", status: "unknown", summary: edge.ok ? "" : edge.reason, action: "The owner deploys the system-health function (pnpm functions:deploy after review). Until then the email settings cannot be read from here." })
  } else if (!config.can_send) {
    checks.push({ id: "email-config", group: "Email", title: "Email settings", status: "info", summary: "Email is not set up: " + [!config.brevo_api_key ? "the mail key is missing" : "", !config.mail_from_email ? "the sender address is missing or invalid" : ""].filter(Boolean).join(" and ") + ". Notifications still work inside the app.",
      action: "The owner saves BREVO_API_KEY and MAIL_FROM_EMAIL (and APP_URL) as Supabase secrets, then sets up the schedule. Steps: docs/BUILDTRACK_EMAIL_SETUP.md." })
  } else {
    const gaps = [!config.app_url.valid ? "APP_URL is missing or not https, so emails will have no Open button" : "", !config.cron_secret.strong ? "no strong CRON_SECRET is set (the schedule can use the service key instead)" : ""].filter(Boolean)
    checks.push({ id: "email-config", group: "Email", title: "Email settings", status: gaps.length && !config.app_url.valid ? "warn" : "ok", summary: gaps.length ? `Email can be sent. ${gaps.join("; ")}.` : "The mail key, sender address and app address are present (values are never shown).", action: !config.app_url.valid ? "Save APP_URL (for example https://your-site.example) as a Supabase secret." : undefined })
  }

  // Email queue.
  const queue = raw.email_queue
  const queueDetails = [`Waiting: ${queue.waiting}`, `Waiting over a day: ${queue.waiting_over_1d}`, `Sent in the last 24 h: ${queue.sent_24h}`, `Failed in the last 24 h: ${queue.failed_24h}`, `Skipped in the last 24 h: ${queue.skipped_24h}`]
  if (queue.failed_24h > 0) checks.push({ id: "email-queue", group: "Email", title: "Email delivery queue", status: "warn", summary: `${plural(queue.failed_24h, "email")} failed in the last 24 hours.`, action: "Send yourself a test email below and read the provider's answer. Check the sender address and the mail key.", details: queueDetails })
  else if (queue.waiting_over_1d > 0) checks.push({ id: "email-queue", group: "Email", title: "Email delivery queue", status: config?.can_send ? "warn" : "info", summary: `${plural(queue.waiting_over_1d, "notification has", "notifications have")} waited over a day to be emailed. ${config?.can_send ? "Email is set up, so the schedule that sends them is not running." : "Email is not set up, so nothing is being sent."}`,
    action: config?.can_send ? "The owner turns on the schedule (Supabase Cron calling send-notifications every 5 minutes)." : "Finish the email setup first (see Email settings).", details: queueDetails })
  else checks.push({ id: "email-queue", group: "Email", title: "Email delivery queue", status: "ok", summary: queue.waiting ? `${plural(queue.waiting, "notification")} waiting, none for more than a day.` : "Nothing is waiting.", details: queueDetails })

  // Scheduled jobs (only where the database has them).
  const jobs = raw.cron?.jobs ?? []
  if (!raw.cron?.installed) {
    checks.push({ id: "schedule", group: "Scheduled jobs", title: "Scheduled jobs", status: queue.waiting_over_1d > 0 ? "warn" : "info", summary: "No scheduler is installed (Supabase Cron is off), so nothing runs by itself: no email sending and no daily digest.", action: "When the owner is ready: Integrations > Cron in the Supabase dashboard. Nothing is switched on by this screen." })
  } else if (jobs.length === 0) {
    checks.push({ id: "schedule", group: "Scheduled jobs", title: "Scheduled jobs", status: "warn", summary: "Cron is installed but has no jobs.", action: "Create the send-notifications job (and, when approved, the daily digest job). See docs/BUILDTRACK_EMAIL_SETUP.md." })
  } else {
    const lines = jobs.map((job) => `${job.name} (${job.schedule}) ${job.active ? "" : "inactive "}last run: ${job.last_run ? new Date(job.last_run).toISOString() : "never"} ${job.last_status ?? ""}${job.last_status === "failed" && job.last_message ? ": " + job.last_message : ""}`.replace(/\s+/g, " ").trim())
    const failed = jobs.filter((job) => job.last_status === "failed")
    const idle = jobs.filter((job) => !job.active)
    checks.push({ id: "schedule", group: "Scheduled jobs", title: "Scheduled jobs", status: failed.length ? "fail" : idle.length ? "warn" : "ok", details: lines,
      summary: failed.length ? `${plural(failed.length, "job")} failed on the last run: ${failed.map((job) => job.name).join(", ")}.` : idle.length ? `${plural(idle.length, "job is", "jobs are")} switched off.` : `${plural(jobs.length, "job")} scheduled, the last runs succeeded.`,
      action: failed.length ? "Read the job's message above, fix the cause, and let it run again. Nothing was re-run for you." : idle.length ? "Switch the job on in Integrations > Cron if it should run." : undefined })
  }

  // Daily admin digest.
  const digest = raw.digest
  const digestJob = jobs.find((job) => /digest/i.test(job.name))
  if (!digest?.last_run) {
    checks.push({ id: "digest", group: "Daily admin digest", title: "Daily admin digest", status: "info", summary: "No digest has been generated yet. It is not scheduled.", action: "Review the preview below. When approved, the owner schedules it with the SQL in docs/audits/sql/20261101120000_system_health_and_admin_digest.md." })
  } else if (digest.last_run.status === "failed") {
    checks.push({ id: "digest", group: "Daily admin digest", title: "Daily admin digest", status: "fail", summary: `The last digest run (${digest.last_run.run_date}) failed: ${digest.last_run.detail ?? "no details"}.`, action: "Fix the cause, then the next scheduled run creates the digest. Nothing is sent twice." })
  } else {
    const hours = digest.last_ok_at ? (options.now.getTime() - new Date(digest.last_ok_at).getTime()) / 3_600_000 : Infinity
    const late = Boolean(digestJob) && hours > LATE_DIGEST_HOURS
    checks.push({ id: "digest", group: "Daily admin digest", title: "Daily admin digest", status: late || digest.failed_7d > 0 ? "warn" : "ok",
      summary: late ? `The digest job exists but the last successful run was ${Math.floor(hours)} hours ago.` : `Last run ${digest.last_run.run_date}: ${plural(digest.last_run.created, "digest")} created, ${digest.last_run.skipped_empty} with nothing to report, ${digest.last_run.skipped_opt_out} opted out.${digest.failed_7d ? ` ${plural(digest.failed_7d, "run")} failed in the last 7 days.` : ""}`,
      action: late ? "Check the job's last message under Scheduled jobs." : undefined })
  }

  // Latest email tests.
  const test = raw.email_tests?.[0]
  checks.push({ id: "email-test", group: "Email", title: "Latest email test", status: !test ? "info" : test.status === "accepted" ? "ok" : test.status === "failed" ? "warn" : "info",
    summary: !test ? "No test email has been sent yet." : test.status === "accepted" ? `The provider accepted the last test (${new Date(test.created_at).toISOString()}). Acceptance is not confirmation of delivery: use "Ask the provider" below.` : test.status === "failed" ? `The last test failed (${new Date(test.created_at).toISOString()}${test.provider_status ? `, HTTP ${test.provider_status}` : ""}).` : "A test was started but has no result.",
    action: test?.status === "failed" ? "Send a new test and read the provider's answer." : undefined })
  return checks
}

export function summarize(checks: HealthCheck[]) {
  const counts: Record<HealthStatus, number> = { ok: 0, info: 0, unknown: 0, warn: 0, fail: 0 }
  for (const check of checks) counts[check.status]++
  return { counts, overall: worst(checks.map((check) => check.status)) }
}

// The SQL the owner would run to switch the daily digest on. The app only shows it; it never runs it.
export const DIGEST_SCHEDULE_SQL = `-- Needs the Supabase Cron integration (pg_cron). 00:00 UTC = 08:00 in Manila.
select cron.schedule('buildtrack-admin-digest', '0 0 * * *', $$select public.generate_admin_digest()$$);

-- To switch it off again:
-- select cron.unschedule('buildtrack-admin-digest');`
