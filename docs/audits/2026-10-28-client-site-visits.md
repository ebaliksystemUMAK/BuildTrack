# Client site visits — 2026-10-28

## Delivered

Client Communication has Questions and Site visits tabs. Visit requests store the preferred date/time (Manila), purpose and visitor count. Clients see only their own project requests, the Engineer's response and upcoming cancellation actions. Existing question forms, links and answers remain available.

Engineers receive an in-app notification linking to Site Logs & Reports → Site visits, where they can confirm the proposed time or decline with a required explanation. Decisions notify the client and link to the exact request. Client cancellation notifies project Engineers. No separate calendar events, automatic confirmations, email delivery promise or visit-completion tracking were introduced.

## Data and security

- `site_visit_requests` is the canonical record. RLS restricts reads to the requesting active assigned Client and active assigned Engineers. Foremen, unrelated Clients, unassigned staff and anonymous users cannot read these requests.
- The caller cannot supply identity, status, server timestamps or response identity on insert. Request details are immutable; the only granted update columns are status and Engineer note.
- An invoker trigger validates membership/profile-role parity, future timestamps and legal transitions. Clients only cancel upcoming requested/confirmed visits. Engineers only decide requested visits; declines require a note. Conditional updates compare the previously observed status to reject stale decisions.
- Notification code is a private-schema trigger with direct execution revoked. Public notification inserts, deletes of visit history and forged metadata remain denied. Realtime publishes the new table under the same RLS.
- Reads are project-filtered, paginated, updated live and periodically refreshed. Generation checks and project masking discard late responses from a previous project.

## Deployment

Applied on BuildTrack project `ruimjlhsfpaezkgfphsz` via the Supabase connector as `20261028061346_client_site_visits`. The CLI-generated local filename was aligned with the recorded remote version. Existing migration files were not changed.

Verified live: migration record; RLS enabled; three policies; publication membership; anonymous SELECT, authenticated DELETE, forged client INSERT and direct notification execution all denied.

A live authenticated transaction selected an existing assigned Client/Engineer pair, requested a visit, verified the Engineer notification, confirmed it as the Engineer, read the response/notification as the Client, cancelled it as the Client and rolled back. Result: `SITE_VISIT_SMOKE_OK_ROLLED_BACK`. Test visit and notification records were not retained.

Security advisor counts were unchanged before/after: 4 INFO (existing intentionally internal policy-free tables), 94 callable-definer WARN findings and 1 existing Auth warning. No site-visit findings were added. Existing advisor references: [function exposure](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable), [password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

## Verification

- `pnpm check`: passed TypeScript, the existing component/helper regressions, all 473 SQL cases and production build.
- `node scripts/test-site-visits.mjs`: passed validation/timezone, own/project privacy, duplicate-click prevention, cancellation confirmation, required decline message, canonical writes, stale-decision handling, paging, read errors and late-project-response tests. Added to future `pnpm check` runs.
- `test-client-portal`: includes Questions → Site visits navigation while preserving the selected project and existing question behavior.
- `git diff --check`: passed.
- No signed-in browser visual inspection was performed. SQL/UI tests and build success do not constitute a manual browser acceptance test.
