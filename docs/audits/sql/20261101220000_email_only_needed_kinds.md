# Email only what is needed

| Field | Value |
|---|---|
| File | `supabase/migrations/20261101220000_email_only_needed_kinds.sql` |
| Applied | 2026-11-01 via the connector, live version `20261101135623`, verified (profile fingerprint, audit-log count and privileges checked; security advisor: only the intended INFO for the new service-role-only table) |
| Dependencies | `20261101090000_admin_communications` (`notification_email_category`, `claim_email_batch`) |
| Reversible | Yes: restore both functions from `20261101090000_admin_communications.sql`. No table or column changes |

| Object | Effect |
|---|---|
| `notification_email_category` | New category `inapp` for nine kinds that stay in the bell only: `pin.milestone`, `pin.resumed`, `report.submitted`, `report.reviewed`, `qa.defect_closed`, `project.archived`, `project.restored`, `project.manager_removed`, `attendance.concern_resolved`. Everything else is unchanged; an unlisted kind is still emailed. |
| `claim_email_batch` | Same signature and rules; first closes unsent `inapp` rows (`emailed_at = now()`) without an email and without a log line. Service role only, as before. |

## Verification queries (read-only)
```sql
select kind, public.notification_email_category(kind) from (values ('qa.result'),('qa.requested'),('pin.milestone'),('report.submitted'),('account.suspended'),('pin.due')) v(kind);
-- expected: activity, activity, inapp, inapp, security, reminder
select has_function_privilege('authenticated', 'public.claim_email_batch(integer)', 'execute') as auth_can_claim; -- expected false
```
