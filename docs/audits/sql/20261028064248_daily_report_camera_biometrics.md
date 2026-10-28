# Daily report camera evidence and biometric headcount

| Field | Value |
|---|---|
| File | `supabase/migrations/20261028064248_daily_report_camera_biometrics.sql` |
| Written / applied | 2026-10-28 / 2026-10-28 |
| Depends on | Daily report revisions, biometric attendance, valid issue markup validator |
| Status | Applied via connector; live authenticated rollback smoke verified |
| Reversible | Additive; disable new UI first and preserve counts/source/annotations before rollback |

## Purpose

Daily progress reports use recorded biometric presence for their headcount and camera-captured photos with separately stored annotations. Historical reports and evidence are retained.

## Objects created or changed

| Object | Change |
|---|---|
| `daily_reports.workers_source`, `workers_synced_at` | Historical/manual or biometric origin and server sync time; no caller write grants |
| `daily_report_photos.annotations`, `capture_source` | Validated overlay and camera/legacy provenance; annotations/provenance may be supplied on insert only |
| `daily_report_biometric_headcount(uuid,date)` | Invoker; distinct accepted Time IN workers within the project's Manila report day |
| `sync_daily_report_headcount()` and before-write trigger | Recalculate draft/submission count server-side; skip updates of already-submitted rows |
| `require_daily_report_camera()` and before-insert trigger | Require camera marker and shutter timestamp for new metadata records |

## Security and RLS

Existing report/photo/storage RLS and immutable evidence rules remain. The headcount RPC requires active project staff and uses RLS-protected events. Trigger functions are invoker and cannot be directly executed by public/anon/authenticated users. Caller-supplied counts cannot override the derived value. Source/time fields cannot be forged through authenticated column grants. Camera provenance remains a client claim; it does not attest hardware origin against a malicious custom API client.

## Verification

Six new SQL cases; 479 total SQL cases pass. Full application check/build pass. Live migration, invoker/grants/triggers and rollback-only Foreman request/save/submit/revision checks pass. Security advisor counts unchanged. See [full audit](../2026-10-28-daily-report-camera-biometrics.md).

## Rollback

Disable the new UI and snapshot/export new source and annotation fields before any removal. Prefer preserving the columns and historical evidence. If explicitly approved, a new migration can remove the new two triggers and three functions and revert new inserts to the previous workflow; retain all recorded report/photo/history rows. Do not drop the original report/photo preparation, stamping, revision or storage protections. No rollback was executed.

## Notes / limits

No imported attendance totals or rejected scans contribute to headcount. A submitted report snapshots the scans available at save time; later scans do not rewrite it. The browser requires a real available camera, HTTPS/localhost and permission. Existing photos have empty overlay/legacy provenance and remain readable.
