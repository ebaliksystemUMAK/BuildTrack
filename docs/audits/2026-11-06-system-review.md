# BuildTrack system review — 2026-11-06

Read-only review of the current workspace and the BuildTrack Supabase project `ruimjlhsfpaezkgfphsz`. No production records, settings, migrations, sessions or email were changed. Application fixes were not made during this review. Existing QA comparison/resize work remains uncommitted. Browser visual and real-device/inbox verification remain outstanding.

## Findings, in priority order

### 1. P1 — Project ZIP backups omit important project records and files

Evidence: `src/lib/projectExport.ts:8` (table lists), `:83` (file buckets), `:104` (photo collection).

The export does include daily task entries, QA submission snapshots, corrections and report revisions. It does not export `project_timeline_items`, `project_timeline_requests` or `project_timeline_publications`. The hosted database currently has 8 schedule items, 26 requests and 2 publications, so this is already relevant to stored work. Site-issue reports/photos, Client snag reports/photos, project QC templates/items, PM assignments and blueprint-access grants also have no dedicated export in these lists. `team.json` is a display RPC result, not a replacement for the missing source tables. The file loop cannot include site-issue or snag-photo buckets.

Impact: a successful ZIP can still be insufficient to reconstruct the current project, its approved/published timeline, linked findings or access setup. The manifest does not identify these missing categories. A project export must not be treated as a complete disaster-recovery backup.

Next action: define the supported backup scope, add checked export access for private timeline/governance records and all corresponding files, update restore ordering/documentation, and perform a restore rehearsal in a disposable database. Do not grant general table access merely to make exports work.

### 2. P2 — Schedule-only history is absent from permanent-delete eligibility

Evidence: `supabase/migrations/20261101190000_delete_protection_and_purge.sql:102` (`project_contents`), `:127` (`project_purge_check`); `20261104042538_project_gantt_timeline.sql:5`, `:29`, `:39` (project cascade foreign keys). The same behavior is installed in the hosted database.

Local reproduction against every migration: create a project containing one milestone and one published schedule, age its recycle-bin fixture to 35 days, run the real eligibility check and service-role purge. Eligibility returns `ok: true`; the milestone and publication are both cascaded away. Only the local fixture's age was set directly. No real project was deleted.

Impact: the system's protected-work check does not treat official schedule history as a protected record and does not list it in the deletion summary. Existing Super Admin/MFA/age/confirmation requirements still apply; this is a retention-policy gap, not an unauthorized-delete bypass.

Next action: explicitly decide whether published schedules and decisions must survive. The safer default is to block permanent purge when they exist, and display their counts in preview/audit records. Keep existing work/evidence protection intact.

### 3. P2 — An offline photo retry can duplicate a saved photo

Evidence: `src/lib/offlineQueue.ts:91–100`; `supabase/migrations/0010_pins.sql:72`. Live indexes confirm that `pin_photos.path` has no uniqueness constraint and the insert uses a new default ID each time.

Reproduction with the real queue sender and a fake provider/database response: the first metadata insert commits but its HTTP response is lost; the retry accepts “file already exists” and inserts metadata again. One queued operation produces two records. The existing storage delete policy protects files already referenced by metadata. The live database currently has zero duplicate paths; the bug is reproducible under connection loss rather than evidence of existing corruption.

Next action: give each queued photo a persistent metadata ID/idempotency key; confirm an existing matching record before retrying; distinguish an uncertain commit from a rejected insert. Add a lost-response regression test and account/session checks before each queued write.

### 4. P2 — Some editor lists still read only one API page

Evidence: `src/lib/blueprints.ts:362` (`useAnnotations`) and `:476` (`usePinPhotos`). Both use an ordinary ordered select without range pagination. They also omit explicit request errors and request-generation guards.

Impact: a plan or pin exceeding the API row limit can silently lose later annotations/photos from the visible editor. A late response from a previously selected sheet/pin can overwrite the current hook state. Many newer project/progress loaders already use stable paging and generation guards, so these hooks should follow that pattern.

Next action: use stable `fetchAll` paging with a unique ID tiebreaker; clear/mask data by the requested pin/sheet; expose loading/errors; ignore obsolete responses. Test more than one page and rapid selection changes.

### 5. P2 — The custom migration runner does not match current hosted history

Evidence: `scripts/db-migrate.mjs:72`, `:99`, `:150`.

`state()` matches local filename versions only and requires stored checksums. Connector-applied migrations have different hosted timestamps: for example, local `20261104172610` is installed as `20261104174312` under `schedule_email_notifications`. The current hosted tracking table has no `checksum`, `applied_at` or `baselined` columns. Even `db:status` calls `ensureTracking()` and attempts schema writes before returning status. It was intentionally not executed in this read-only review.

Impact: the runner can describe installed migrations as pending or changed. Running a blanket apply based on those statuses is unsafe. Recent schedule/report migrations are present by their hosted names; old 0041/0042 history gaps do not establish absent schema.

Next action: make status read-only, reconcile known local/hosted identities and verified source checksums, and require explicit review of unknown entries. Never resolve this by replaying historical migrations.

### 6. P2 — Default CI skips important scheduling UI tests

Evidence: `package.json:40`, `:41`, `:51`; `.github/workflows/ci.yml` runs `pnpm check`.

`test:project-timeline` and `test:schedule-proposals` exist but are not called by `check`. The global SQL suite does cover scheduling backend cases; that does not execute these component tests. Both omitted scripts were run separately during this review and passed.

Next action: include both scripts in the default check/CI command so later UI regressions fail the pull-request gate.

### 7. P2 — Leaked-password protection remains disabled

The current live security advisor reports `auth_leaked_password_protection`. This is an Auth configuration issue, not a missing SQL migration. Enable the setting if the project plan supports it; [Supabase documents the feature and its Pro-or-above requirement](https://supabase.com/docs/guides/auth/password-security). No setting was changed.

## Lower-priority follow-up

- Refresh `docs/audits/2026-11-01-owner-setup-checklist.md`: it still claims Cron is missing and no emails have been sent. Live read-only checks show the email job active every five minutes and maintenance job every minute, plus 42 provider-accepted sends. Historical failed attempts remain 42. Latest accepted send: Nov 4, 18:50 Manila. No schedule-email events have occurred yet, so the new schedule recipients have not been exercised in a real inbox.
- Verify actual inbox delivery/bounces separately from provider acceptance. The existing sender records Brevo acceptance as sent; no real email was sent during this review. Digest scheduling is still optional and has no active Cron job.
- Pin the Supabase CLI and review deployment commands before unattended use: `functions:deploy` uses unversioned `npx supabase` without unattended confirmation flags. The [Nov 4 CLI changelog](https://supabase.com/changelog) describes v3's hosted confirmation and target changes. No deploy command was executed.
- Profile the busiest queries before index/RLS tuning. Current performance advisors list 100 unindexed foreign keys, 26 per-row auth policy checks, 6 multiple-policy groups and 29 unused-index findings. These are optimization candidates, not proof of a user-visible outage or grounds to add/drop every index.
- Commit/push the already-requested QA comparison and resize work when ready, then verify the actual deployed frontend. The current GitHub main commit remains the earlier `ba907b1`; this review did not push or deploy.

## Checks and limits

- Reused the immediately preceding unchanged full-check baseline: TypeScript, application tests, all **757 SQL cases** and the production build passed. The final resize geometry/real editor tests also passed after their last functional adjustment.
- Additional Gantt and schedule-proposal component tests: passed.
- Production dependency audit queried during this review: **0 known vulnerabilities** at all reported severities.
- Latest schedule/report hosted migration names checked; live schema/guard/cascade/index metadata checked. No recent pending schedule migration found. Legacy history was not blindly replayed.
- Public tables checked: none without RLS. No public-schema views found. Only the avatars bucket is public; project/evidence buckets remain private.
- Live security advisors: 16 internal RLS-without-policy tables, 3 anonymous definer RPCs, 172 authenticated definer RPCs and the leaked-password setting finding. Definer RPC counts alone are not an access-control vulnerability; the application's checked RPC model intentionally uses them.
- New local reproductions confirmed the schedule-only purge and lost-response photo duplication. They used disposable PGlite/fake-server data only. No existing duplicate photo paths were found live.
- This is a source/configuration/test review of the major modules, not proof that every screen, physical scanner, provider or browser interaction is defect-free. Browser automation remains unavailable; inbox delivery, hardware and Vercel deployment were not certified.

Recommended next implementation order: complete backup coverage, settle schedule-history deletion protection, make photo retries idempotent, fix editor paging/stale loads, reconcile migration tooling, and add missing CI tests. Handle the password setting separately in the supported Auth plan.
