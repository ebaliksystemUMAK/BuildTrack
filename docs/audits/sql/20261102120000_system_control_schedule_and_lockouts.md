# System Control: maintenance schedule and lockout watch

| Field | Value |
|---|---|
| File | `supabase/migrations/20261102120000_system_control_schedule_and_lockouts.sql` |
| Applied | 2026-11-02 via the connector, live version `20261102031428`, verified (privileges, Cron job, dry run did nothing, profile fingerprint unchanged; advisor: only the intended items) |
| Dependencies | `site_controls`, `audit_log`, `email_codes`, `invite_attempts`, 20261102100000_system_control |
| Reversible | Yes, block at the end of the file. Existing maintenance functions are not changed |

| Object | Effect |
|---|---|
| `maintenance_windows` | Start, end, message, status (scheduled, active, done, cancelled, skipped); no API grants |
| `get_maintenance_windows`, `schedule_maintenance`, `cancel_maintenance_window` | Super Admin + authenticator; audited |
| `apply_maintenance_windows()` | Service role / Cron only. Switches maintenance on at the start and off at the end of a window, never touching maintenance set by hand |
| Cron job `buildtrack-maintenance-windows` | Every minute: `select public.apply_maintenance_windows()` |
| `get_lockout_watch` | Read-only: locked codes, invitation lockouts, blocked Google sign-ins |

## Verification queries (read-only)
```sql
select jobname, schedule, active from cron.job;                        -- expected: send-notification and buildtrack-maintenance-windows, both active
select status, count(*) from public.maintenance_windows group by 1;    -- expected: nothing until a window is scheduled
select p.proname, has_function_privilege('authenticated', p.oid, 'execute') auth, has_function_privilege('service_role', p.oid, 'execute') svc
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'apply_maintenance_windows';  -- expected: false, true
```

## If a window left maintenance on and System Control is unreachable (owner, SQL editor)
```sql
select cron.unschedule('buildtrack-maintenance-windows');
update public.site_controls set maintenance_on = false, maintenance_returns_at = null where id = 1;
update public.maintenance_windows set status = 'cancelled' where status in ('scheduled', 'active');
```
