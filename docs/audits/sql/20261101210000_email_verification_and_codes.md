# Email verification and emailed codes

| Field | Value |
|---|---|
| File | `supabase/migrations/20261101210000_email_verification_and_codes.sql` |
| Applied | 2026-11-01 via the connector, live version `20261101135551`, verified (profile fingerprint, audit-log count and privileges checked; security advisor: only the intended INFO for the new service-role-only table) |
| Dependencies | `profiles`, `auth.users`, `complete_registration`, `prepare_access_request`, `redeem_invite` (replaced, same signatures) |
| Reversible | Yes (rollback block at the end of the file). The only data written is the new column and its back-fill |

| Object | Effect |
|---|---|
| `profiles.email_verified_at` | Null = the address was never proven to BuildTrack. Back-filled only for accounts whose email sign-up code was typed (confirmation later than 5 seconds after creation). Nobody can write it from the browser (column grant revoked, trigger). |
| `sync_email_verified()` + trigger on `auth.users` | Sets the flag when `email_confirmed_at` changes from null to a time (typing the sign-up code). |
| `email_codes` | One row per address and purpose; stores only an HMAC, never the code. No API grants. |
| `issue_email_code`, `consume_email_code`, `mark_email_verified` | Service role only. 60 s between codes, 5 an hour, 5 tries, 10 minutes, single use; limits count every address alike. |
| `complete_registration`, `prepare_access_request`, `redeem_invite` | Refuse with "Verify your email first" (invite: reason `email_not_verified`) until the flag is set. |

## Verification queries (read-only)
```sql
select count(*) total, count(email_verified_at) verified from public.profiles;
select p.proname, has_function_privilege('anon', p.oid, 'execute') anon, has_function_privilege('authenticated', p.oid, 'execute') auth, has_function_privilege('service_role', p.oid, 'execute') svc
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('issue_email_code','consume_email_code','mark_email_verified');
-- expected: anon false, authenticated false, service_role true
select tgname from pg_trigger where tgrelid = 'auth.users'::regclass and tgname = 'auth_users_email_verified';
```

## Notes
- Existing active members keep working: the gate is only on registration, access requests and invitation codes.
- The two pending Google accounts must confirm their address (card on the registration screen) before their details can be sent.
