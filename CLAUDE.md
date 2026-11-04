# BuildTrack (Valencia Construction Services)

Construction progress and QA web app: React 19, TypeScript, Vite 8, Tailwind v4; Supabase Auth/Postgres/RLS/Storage/Realtime/Deno functions. Custom routing in `src/App.tsx`. Package manager: pnpm.

## Working efficiently
- Work only in this BuildTrack repository. Never access E-Balik, its services or configuration.
- Follow the owner's latest instructions and applicable AGENTS.md. During the admin phases, also read `CLAUDE_SESSION_SAFETY.md` once if present.
- Start with git status. Preserve all existing modified/untracked work; never reset, discard, automatically stash or overwrite others' edits. Pull with `git pull --ff-only` when requested or starting new work; do not interrupt an active phase by switching branches/pulling. Never commit/push without authorization.
- Search with targeted `rg`/`rg --files`, then read relevant ranges. Follow dependencies only as needed. Do not scan the repository, dump long output or reread unchanged files. Cache findings during the session; recheck changed files before editing.
- Complete the requested scope with small edits. Reuse existing implementations; no unrelated refactors, dependencies, mass formatting or duplicate systems. Ask only for missing information that materially affects correctness or risk.
- Read historical context only when needed: search `docs/CLAUDE_REFERENCE.md`, `codex.md` or the relevant audit, then read the matching section. Do NOT load them all at startup. Current source/tests and newer verified records take precedence over old notes.

## Task map (paths below are relative to src/ unless stated)
| Task | Start here |
|---|---|
| Routing/auth/permissions | App.tsx, components/RouteGuard.tsx, lib/auth.tsx, lib/access.ts; backend guards/RLS |
| Admin/accounts/settings | pages/Admin/, lib/admin.ts; supabase/functions/admin-users/ |
| PM/team/access | pages/ProjectManager/, lib/projectManagers.ts, lib/projectManagerModel.ts, lib/projectRoutes.ts |
| Plans/editor | components/editor/, lib/blueprints.ts; geometry/layers/exportSheet/useAnnotationOps for drawing or undo changes |
| QA/corrections | components/qa/WorkItemWorkspace.tsx, lib/workItem.ts, lib/workItemModel.ts, lib/qa.ts; codex.md current QA section |
| Photos/site rules | lib/photoPolicy.ts, lib/photoStamp.ts, components/issues/IssuePhotoEditor.tsx |
| Attendance/biometrics | search attendance/biometric/enrollment filenames; codex.md workforce section |
| Reports/progress | lib/taskProgress.ts, lib/periodProgress.ts, lib/weeklyReport.ts, lib/attendanceReport* |
| Notifications/email | lib/notifications.ts, components/NotificationBell.tsx, supabase/functions/send-notifications/ |
| Admin controls/deletion/recovery | search siteControls, recycleBin, recordRemoval, passwordRecovery; matching latest audit |
| Paper/Sheets/Canva/manuals | DOCUMENTATION_GUIDE.md, relevant part of docs/DOCUMENTATION_HANDOFF.md; no application/database edits |

## Non-negotiable behaviour
- Roles/status come from the database, not browser claims. Super Admin has system/recovery authority; Admin has permitted account/biometric functions, project governance and PM appointments. Assigned PMs manage open-project teams/access/leads/assignments; they do not appoint PMs or make Engineer QA decisions. Engineer retains technical QA; Foreman works only on assigned work; Clients never receive internal QA/evidence access. Preserve MFA, blueprint-type access and archived/removed-project restrictions.
- Enforce privileges on the backend, not just buttons/RouteGuard. Preserve authenticated device-token receivers; never weaken authentication or change JWT verification merely to bypass an error.
- Work-item QA and whole-pin completion are distinct. Preserve explicit Engineer decisions, correction/reinspection history, immutable evidence and current completion checks. Ready/Passed/Accepted labels or old automatic-completion notes are not sufficient authority: inspect current code. Progress uses approved tasks; final pin acceptance is separate. Mirror pure TS rules and SQL.
- Preserve project/pin/item relationships, privacy confirmations, private storage and recorded audit history. New personal-data forms use the existing DataConfirmModal flow. Never fabricate standards, results, data or deployment status.
- New project-access functions must respect removed projects (`deleted_at`). New work tables may need site-control guards, realtime registration, export coverage and purge/reference checks: inspect the relevant existing pattern.
- Never delete evidence casually. Account deletion preserves referenced work through closure/anonymization; record removal is reversible for supported types. Permanent project purge has strict eligibility/age/step-up checks. Read the matching audit before changing these paths.
- Offline queue is account-scoped IndexedDB, not a full offline backend. Preserve pending items, retry order and maintenance pauses (`BT503`). Do not clear queued evidence during logout. Supabase data is not service-worker cached. Full local-server/cloud synchronization is future work unless subsequently verified.
- Photo source/location/age rules are backend enforced. Account overrides take priority; displayed Both retains legacy company/default semantics. Preserve camera-only site checks and photo eligibility; do not trust browser flags.
- Use stable pagination (`lib/paging.ts` fetchAll) for complete registers/counts; ordinary selects may be capped. Preserve intentionally limited galleries. Use Manila date boundaries and existing safe CSV/HTML helpers.

## Database, deployment and secrets
- Do not read/print/copy .env* or credentials; never expose service-role, email or OAuth secrets to frontend/logs/docs.
- Hosted mutations/deployments require authorization under the current task/session. Verify the connected project is BuildTrack: `https://ruimjlhsfpaezkgfphsz.supabase.co`. Never touch another project. Destructive operations require explicit approval.
- Migrations live in supabase/migrations/. Preserve applied files, existing data, permissions/RLS, triggers and relationships. Test new migrations locally. Check docs/audits/migrations-log.md and the relevant SQL audit before hosted execution; legacy missing history entries do NOT prove missing schema. Never rerun historical 0041/0042 or the already-installed blueprint-type migration from old notes.
- After authorized backend deployment, verify schema/function parity and security findings as appropriate; record actual hosted versions, verification and remaining owner actions. Do not infer Vercel deployment from a local build or push.
- Backend changes need one concise topic audit; migration status belongs in existing migration-log/SQL index. Keep detailed history out of this file. Paper-only work follows DOCUMENTATION_GUIDE.md, not new technical audit-file proliferation.

## Current cautions (recorded 2026-11-01; verify only if relevant)
- Admin phases have substantial uncommitted local changes. Do not restart/reimplement them from an old feature list. Some hosted migrations/functions are already applied while frontend changes are not yet merged/deployed; inspect the relevant audit.
- Latest account/email-code audit supersedes the earlier reset-template description. Password recovery must not become general sign-in. Preserve verified-email gates, one-use/rate-limited codes and step-up account controls.
- Read-only email verification on 2026-11-05 found provider-accepted sends after the historical invalid-key failures; inbox delivery is unverified. See the schedule-email SQL audit. Auth SMTP credentials are separate from the Edge Function API key; never expose or request secrets in chat. Digest scheduling remains owner setup unless later verified.
- Maintenance is non-admin read-only; privileged/service-role device/jobs are exempt. Forced logout does not instantly invalidate existing access tokens. Preserve documented limitations instead of promising immediate revocation.

## UI conventions
Reuse AppShell, PageHead/StatCard/PageParts, Modal, useConfirm, Skeleton and useToast. Preserve role personas, semantic theme tokens, responsive layouts, labelled controls, 11px minimum text, 24px minimum targets and accessible contrast in light/dark themes. Tailwind for new JSX; retain existing CSS. Match existing syntax (no semicolons, valid JSX, default-export components). Editor mutations must retain optimistic state/undo, locks and matching canvas/export drawing. Update the affected page guide when behaviour changes.

## Checks and handoff
- Dev server normally already runs on 8443; do not start a duplicate. Commands: `pnpm dev`, `pnpm build`, `npx tsc --noEmit`, `pnpm check`; actual scripts in package.json are authoritative.
- Run focused tests for affected behaviour. SQL: `pnpm test:sql` uses local PGlite and supabase/tests/*.cases.mjs; new backend rules need role/denial tests. Run `pnpm test:load` after RLS/query changes. Run full `pnpm check` for implementation baseline/completion or required gates, not repeatedly after every small edit; reuse a valid unchanged baseline. Identify pre-existing failures separately.
- Verify interactive changes in the browser when relevant. Never claim tests, physical hardware, email delivery or hosted deployment were verified without evidence. Configuration-only context edits do not need an app test run.
- Final report: concise changes, verification, remaining risks/setup. Finish the requested scope; do not start another phase automatically.

Keep this file compact. Update durable rules/current blockers here; put implementation details in the existing topic audit or on-demand reference, never an expanding startup change log.
