# Super Admin account deletion

| Field | Value |
|---|---|
| File | `supabase/migrations/20261101230000_account_deletion.sql` |
| Applied | 2026-11-01 via the connector, live version `20261101135657`, verified (profile fingerprint, audit-log count and privileges checked; security advisor: only the intended INFO for the new service-role-only table) |
| Dependencies | `20261101210000` (`profiles.email_verified_at`), `revoke_user_sessions`, `identity_verifications`, `data_requests` |
| Reversible | Yes: drop the four functions (block at the end of the file). No table, column or existing function is changed |

| Object | Effect |
|---|---|
| `account_record_counts(uuid)` | Counts, from the catalog, every row in every table whose foreign key points at the account and would be emptied or refused by a delete (logs excluded). Service role only. |
| `account_delete_preview(uuid)` | For the confirmation screen: `mode` = `delete` (no records) or `close` (records exist), the record counts, memberships, managed projects, unfinished work. |
| `account_delete_prepare(uuid, uuid)` | Step 1 of a complete deletion: refuses when records exist, yourself or a Super Admin; returns the ID-photo paths and an audit snapshot. |
| `close_account(uuid, uuid, text)` | Wipes personal data (name, email, phone, company, photos, ID records, notifications, requests, permissions), disables the profile, ends sessions, writes `account.closed`. Records are never touched. |

The Edge Function `account-control` (Super Admin + authenticator, fresh code, typed phrase, reason) calls these with the service role and removes the stored files / the sign-in.

## Verification queries (read-only)
```sql
select p.proname, has_function_privilege('anon', p.oid, 'execute') anon, has_function_privilege('authenticated', p.oid, 'execute') auth, has_function_privilege('service_role', p.oid, 'execute') svc
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('account_record_counts','account_delete_preview','account_delete_prepare','close_account');
-- expected: anon false, authenticated false, service_role true
select public.account_record_counts(id) from public.profiles limit 3; -- run as the SQL editor owner; does not change anything
```
