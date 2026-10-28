# Daily progress report camera evidence and biometric headcount

Date: 2026-10-28. Supersedes earlier guidance that report headcount must always be typed manually.

## Foreman workflow

The Daily Progress Report now explains the selected report date, linked work, camera evidence and biometric headcount. Work descriptions say “on this report date” rather than always “today”. The submit action names the daily progress report explicitly.

Headcount is read-only and comes from distinct workers with an accepted biometric Time IN in the selected project's Manila day. Workers who later Time OUT still count once. Other projects, other dates, OUT-only records, imported manual totals, ignored scans and unregistered fingerprint attempts do not contribute. Zero means no recorded Time IN, not proof that nobody physically worked.

The display refreshes on accepted scan changes and periodically. Errors show unavailable rather than a fabricated zero and block submission. The database independently recalculates on draft save, first save for a photo and submission. Offline draft payloads no longer contain a manually typed count; the server derives it when they synchronize. Existing queued payloads are also subject to the server trigger.

Submitted/historical reports retain their saved headcounts. Engineer review/return does not rewrite them. A returned draft refreshes its count when the Foreman next saves/resubmits, while the original revision remains unchanged. Existing reports receive source `manual` without recalculating historical worker counts.

## Photos

- Daily report photos use a live `getUserMedia` video frame, with no file input or gallery fallback. The rear camera is preferred and audio is never requested.
- The shutter creates a JPEG and captures the timestamp/location before annotation. Camera tracks are released after capture, navigation, cancellation or late permission responses.
- Capture opens the existing photo annotation editor immediately. Arrows, lines, text, shapes and drawings remain overlays; the unannotated captured JPEG is stored unchanged. Captions and annotations are recorded together with the original.
- An unsaved capture disables report submission and report-date switching until saved/discarded. Saving requires connectivity; a failed save retains the capture for retry. Retry uses the same path and checks committed metadata before sending again.
- New metadata inserts require `capture_source='camera'` and a capture timestamp, and annotation JSON is validated. This is a browser workflow restriction and client provenance claim, **not cryptographic proof** that an untrusted API caller used a physical camera. Existing photos are retained as `legacy`. Metadata cannot be edited once recorded; submitted revision evidence stays protected.
- Private storage, author/draft restrictions, evidence locks, existing read policies and the 50-photo limit remain in force.

## Deployment and security

Applied to BuildTrack `ruimjlhsfpaezkgfphsz` through the connector as migration `20261028064248_daily_report_camera_biometrics`. The CLI-created local migration was renamed to match the recorded version. Existing applied migrations were not edited.

All new functions are security invoker. Only active authorized project staff can call the headcount read; anonymous access is revoked. Source/sync fields have no authenticated write grants. Trigger functions have direct execution revoked, and no new exposed definer RPC was added.

Live verification checked the migration record, trigger names, function security mode and grants. An authenticated Foreman rollback smoke derived a count despite a caller-supplied 4999, refused photo metadata without camera provenance, saved validated annotation metadata, submitted and checked the count/photo revision snapshot, then rolled back. Result: `DAILY_REPORT_CAMERA_BIOMETRICS_SMOKE_OK_ROLLED_BACK`. No test reports, evidence records or notifications were retained; no real biometric scan was created.

Security advisors unchanged: four existing INFO findings, 94 existing callable-definer findings and one existing Auth warning. No findings for the new functions. References: [RLS lint](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy), [function exposure lint](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable), [password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

## Verification

- Full `pnpm check` passed: TypeScript, all helper/component scripts, 479 SQL cases and production build.
- Worker camera tests now also simulate daily report rear-camera capture, no file input, shutter metadata, permission denial, encoding and cancelled late-stream cleanup.
- Photo markup tests verify daily report capture → editor → caption/overlay → unchanged original/private save, duplicate-safe retries and unsaved-photo submission locking.
- Project record tests verify project/date-scoped biometric reads, stale responses, error handling, read-only count and preservation of historical report counts.
- Six new SQL cases verify Manila day edges, worker deduplication, Time OUT behavior, project/role isolation, forged headcount rejection, camera metadata, invalid annotation rejection and preserved submitted/reopened revision history.
- `git diff --check` passed. No manual browser/physical-camera verification was performed; simulated browser tests do not establish hardware permission/support on the user's device. Camera capture needs HTTPS or localhost and camera permission.
