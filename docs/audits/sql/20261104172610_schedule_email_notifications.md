# Schedule request, decision and publication emails

| Field | Value |
| --- | --- |
| File | `supabase/migrations/20261104172610_schedule_email_notifications.sql` |
| Applied | 2026-11-05 Manila, hosted `20261104174312` (UTC Nov 4), BuildTrack `ruimjlhsfpaezkgfphsz` |
| Depends on | Existing Gantt requests/publications, notifications, email preferences/queue and System Control email pause |

Future schedule requests notify the project's active primary/backup PMs. Approval and rejection notify the original requesting Engineer and the pin's current assigned Foreman; a Foreman requesting their own dates receives one decision notice. Publishing a schedule notifies active Clients assigned to that project. Drafts and superseded requests are not emailed as new decisions. There is no migration backfill or historical resend.

The existing `notify_user`/notification table and five-minute Brevo worker handle the messages. Schedule kinds use the existing activity category, email preference, limits and retry policy. Dedupe keys permit one request notice per pending request/PM and one decision notice per recipient/action. Re-saving the same pending request does not generate repeated email. New requests and new publication versions have separate identities.

Private trigger functions create notices in the same transaction as the existing work actions. No new public mutation API, table, RLS grant, approval permission or QA decision is introduced. An internal eligibility helper rechecks active profiles, open/nonremoved projects, PM assignments, requester blueprint scope, current Foreman assignment/work access and Client membership before queue dispatch. Superseded parent requests and older unsent publication versions are skipped. Lookup uses indexed request, pin and task IDs. The queue routine was reviewed against the deployed definition; only this schedule eligibility condition was added. Its maintenance pause, mandatory security notices, preferences, 20/day limit, two-day age bound, three attempts and ten-minute claim lease are retained.

Messages contain work context and a role-specific link, not private proposal/review notes or unapproved dates for the Foreman. Client publication messages expose only project/version context; internal schedules/evidence are not copied into emails. PM links open Pending requests, Engineer decisions open Request history, and Foreman/Client links open their permitted Gantt timeline. An already-open Gantt handles notification navigation through the existing browser history event. Clients cannot use a section parameter to open internal tabs.

Queue validation happens when a batch is claimed; an email already handed to the provider cannot be recalled. Actual delivery remains the existing provider's responsibility. No test email or fabricated production schedule is sent during deployment; tests use local PGlite/fake provider models.

Verification: `pnpm check` passed, including TypeScript, component/model checks, all 757 SQL cases and the production build. All 38 focused schedule/QA SQL cases passed against the final migration, including role/project isolation, private drafts, dedupe, superseded requests, independent QA/publication, safe decision/publication content, NULL publication identity, current access/assignment, opt-out and email pause. The 5,000-pin load check passed. Component/model checks verify deep links, notification categories and email rendering. Browser visual verification is unavailable. Current workspace wording edits are retained, with tests/guide text aligned to QA, Progress % and Chart labels.

Hosted verification: all four function bodies match the local migration (MD5 of trimmed LF body); all use an empty search path and deny execution to `anon`/`authenticated`. The queue remains service-role only. Both triggers are present. Existing request/publication fingerprints and the 204 notifications remained unchanged, with zero historical schedule notices created. The existing worker remains active every five minutes. Security-advisor counts are unchanged: 16 RLS-without-policy internal tables, 3 anonymous and 172 authenticated definer RPC findings, and 1 leaked-password-protection setting finding. No real email was sent as a deployment test.

| Function | Verified body MD5 |
| --- | --- |
| `schedule_notice_allowed` | `c45c8fd619aea119d785848b820adf16` |
| `notify_schedule_request` | `dc1b1cf3e0975a40b9714fa1c689b529` |
| `notify_schedule_publication` | `7b5f7b24c6bf4673da26992f95a0bafa` |
| `claim_email_batch` | `86ad45a7c9bcbb83c669833bfc084470` |

Read-only email investigation found existing provider-accepted sends, most recently Nov 4 at 18:50 Manila. Earlier invalid-key failures are historical; inbox delivery was not checked. This change uses the existing configured sender and does not replay failed historical notifications or activate digests.

Rollback requires a new migration removing the two schedule triggers and restoring the previous queue routine. Retain generated notifications, schedule decisions, snapshots and audit history. Do not automatically replay old queued notices or rerun historical migrations.
