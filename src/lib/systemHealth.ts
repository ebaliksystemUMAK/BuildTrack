import { supabase } from "./supabase"
import { invokeFunction } from "./functions"
import { isMissingFunction } from "./communicationsModel"
import { BUCKETS, FEATURES, TRACKED_MIGRATIONS, manifestItems } from "./healthManifest"
import { evaluateHealth, type EdgeAnswer, type EdgeMailConfig, type HealthCheck, type RawHealth } from "./healthModel"

// Calls for the System health screen. Reads only; sending the one test email is a separate, explicit action. Authorization is decided by the database
// function (Super Admin with the authenticator) and by the Edge Function, not here.
export type HealthRun = { checks: HealthCheck[]; raw: RawHealth | null; edge: EdgeAnswer; ranAt: string }

export async function runHealthChecks(): Promise<HealthRun> {
  const [report, edgeCall] = await Promise.all([
    supabase.rpc("get_system_health", { p_manifest: manifestItems() }),
    invokeFunction<EdgeMailConfig>("system-health", { action: "config" }),
  ])
  const edge: EdgeAnswer = edgeCall.data ? { ok: true, config: edgeCall.data } : { ok: false, reason: edgeCall.error ?? "The email settings could not be read." }
  const ranAt = new Date().toISOString()
  if (report.error) {
    if (isMissingFunction(report.error)) {
      return { raw: null, edge, ranAt, checks: [{ id: "database", group: "Database", title: "Health report", status: "warn", summary: "The health report is not installed on the database yet (migration 20261101120000_system_health_and_admin_digest).", action: "The owner reviews and runs that migration, then runs the checks again." }] }
    }
    return { raw: null, edge, ranAt, checks: evaluateHealth(null, edge, { now: new Date(), features: FEATURES, buckets: BUCKETS, tracked: TRACKED_MIGRATIONS }) }
  }
  const raw = report.data as RawHealth
  return { raw, edge, ranAt, checks: evaluateHealth(raw, edge, { now: new Date(), features: FEATURES, buckets: BUCKETS, tracked: TRACKED_MIGRATIONS }) }
}

export type DigestPreview = { run_date: string; recipients: Array<{ name: string; role: string; opted_out: boolean; total: number; body: string }> }

export async function previewDigest(): Promise<{ data: DigestPreview | null; error: string; setup: boolean }> {
  const { data, error } = await supabase.rpc("preview_admin_digest")
  if (error) return { data: null, error: isMissingFunction(error) ? "The digest is not installed on the database yet (migration 20261101120000_system_health_and_admin_digest)." : /Only a Super Admin|permission/i.test(error.message) ? "Only a Super Admin signed in with the authenticator app can preview the digest." : "Could not build the preview. Try again.", setup: isMissingFunction(error) }
  return { data: data as DigestPreview, error: "", setup: false }
}

export type TestEmailAnswer = { test_id: number; accepted: boolean; http_status: number | null; message_id: string | null; detail: string; delivery: "unconfirmed" }
export type DeliveryAnswer = { state: "delivered" | "failed" | "pending" | "unknown"; events: string[]; detail: string }

export const requestTestEmail = () => invokeFunction<TestEmailAnswer>("system-health", { action: "send_test_email" })
export const askProviderAboutTest = (testId: number) => invokeFunction<DeliveryAnswer>("system-health", { action: "check_test_email", test_id: testId })
