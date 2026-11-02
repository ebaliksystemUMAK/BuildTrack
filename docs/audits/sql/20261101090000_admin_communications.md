# Admin communications (email choices, claim lease, announcement banner, communications hub)

| Field | Value |
|---|---|
| File | `supabase/migrations/20261101090000_admin_communications.sql` |
| Written | 2026-11-01 Manila |
| Status | **APPLIED 2026-11-01** to the BuildTrack project only (recorded in the live history as `20261101041911_admin_communications`; the file keeps its repository name). Owner approved in chat. |
| Dependencies | 0020 notifications, 0028 email queue, 20261029 Project Manager role (no change to them) |
| Reversible | Yes, additive; drop statements are at the end of the file |

Additive only: two new columns with defaults, one new column, two new tables with no direct API access, nine new functions, and replacements of `claim_email_batch` and `mark_email_result` that keep their signatures and grants.

| Object | Change |
|---|---|
| `notification_prefs.email_reminders`, `.email_announcements` | New, `not null default true`. Column grants extended so a person can set only their own. The master switch `email_enabled` still wins: with it off nothing optional is emailed. |
| `notifications.email_claimed_at` | New, a 10-minute claim lease. |
| `notification_email_category(kind)` | `security` (`account.*`, `security.*`: always emailed), `reminder` (7 listed kinds), `announcement` (`announcement.*`), else `activity`. Same list in `src/lib/notificationModel.ts` and `_shared/emailModel.ts` (a test compares them). |
| `claim_email_batch`, `mark_email_result` | Category-aware choices; claim lease (two overlapping runs can no longer hand out the same row, which could email a person twice); a repeated or late result is ignored; a suspended person still receives their `account.suspended` notice. The daily cap and opt-outs do not apply to security notices. |
| `mark_all_notifications_read()` | Marks every unread notification of the caller (not only the 50 in the bell). |
| `site_announcement` (single row) | No direct API access. `get_active_announcement()` is open to visitors; `get_announcement_settings()` and `set_announcement()` are Super Admin with MFA, audit `announcement.publish / update / disable`. Revision rises when the text or tone changes or a disabled banner is published again. |
| `message_batches` | One row per send (its id is the idempotency key), no direct API access. |
| `search_message_recipients`, `preview_message_audience`, `send_admin_message`, `get_message_batches` | Super Admin or Admin holding `users.edit` (search also needs `users.view`), with MFA. Active accounts only; 200 people per send (Super Admin 500), 10 sends per hour, 1,000 people per day (Super Admin 2,000); audit `message.send` (without the text). Email goes through the existing queue as `announcement.message` (in-app and email) or the hidden `announcement.email` (email only). |

Not changed: `notify_user`, every existing policy, the `notifications` and `email_log` grants, the Edge Function contract.

## Before running (done)
1. `get_project_url` must be `https://ruimjlhsfpaezkgfphsz.supabase.co`.
2. `pnpm test:sql` passes (596 cases including `zz-communications.cases.mjs`).
3. Take the normal backup. Nothing is deleted by this file.

## Result of the live verification (2026-11-01)
- Live `claim_email_batch` and `mark_email_result` matched 0028 exactly before they were replaced.
- Counts before and after were identical: 143 notifications (all still waiting for email, none leased), 0 preferences, 0 email log lines, 335 audit rows, 11 profiles.
- New columns present with default true; lease column present; banner row `false / revision 0`; no messages sent.
- Privileges: `anon` can execute only `get_active_announcement`; `claim_email_batch` and `mark_email_result` only `service_role`; `authenticated` can execute the six user-facing functions; neither new table can be read or written directly; RLS is on for both.
- Security advisor: 4 findings, all expected (the new tables have RLS and no policy on purpose; the banner read is open to visitors on purpose; signed-in users can call functions that check their caller inside; leaked-password protection, an owner setting already known).

## Verification queries (read-only; the ones used are above, kept here for re-runs)
```sql
-- new columns
select table_name, column_name, column_default from information_schema.columns
where table_schema = 'public' and (table_name, column_name) in (('notification_prefs','email_reminders'),('notification_prefs','email_announcements'),('notifications','email_claimed_at'));
-- existing preferences are untouched and default to on
select count(*) filter (where email_enabled) as master_on, count(*) filter (where email_reminders and email_announcements) as new_choices_on, count(*) as total from public.notification_prefs;
-- the single banner row exists and is switched off
select id, enabled, revision from public.site_announcement;
-- function privileges: nobody anonymous can send or read settings; only the banner read is open to visitors
select p.proname, has_function_privilege('anon', p.oid, 'execute') as anon, has_function_privilege('authenticated', p.oid, 'execute') as authenticated, has_function_privilege('service_role', p.oid, 'execute') as service_role
from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
and p.proname in ('get_active_announcement','get_announcement_settings','set_announcement','search_message_recipients','preview_message_audience','send_admin_message','get_message_batches','mark_all_notifications_read','claim_email_batch','mark_email_result','notification_email_category');
-- no direct table access
select has_table_privilege('anon','public.site_announcement','select') as a1, has_table_privilege('authenticated','public.site_announcement','select') as a2, has_table_privilege('authenticated','public.message_batches','select') as a3;
-- the queue still has nothing unexpected waiting
select count(*) as waiting from public.notifications where emailed_at is null;
```
Expected: `anon` is true only for `get_active_announcement`; `claim_email_batch` and `mark_email_result` are true only for `service_role`; the three table checks are false.

Then run the Supabase security advisor. The known pattern (security-definer functions callable by signed-in users) is expected for the new functions, which check their caller inside.

## Rollback
The comment block at the end of the migration. Restore `claim_email_batch` and `mark_email_result` from 0028 before dropping the new columns.
