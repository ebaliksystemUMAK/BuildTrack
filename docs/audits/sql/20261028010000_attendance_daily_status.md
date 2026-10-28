# 20261028010000_attendance_daily_status

- **File:** `supabase/migrations/20261028010000_attendance_daily_status.sql` (SHA-256 `b212a46c8eda79e8f42fb0ca78d764f766230e7f5e25c8d7f858384394d5f5ed`)
- **Status:** **Applied 2026-10-28** by the owner in the Supabase SQL Editor (with its `schema_migrations` row; the connector call had been blocked by auto mode). Verified read-only: history row, `work_days` column (default Mon–Sat), a single 6-argument `set_attendance_schedule` (definer, authenticated only), all four function bodies identical to the file, grants unchanged. Security advisors unchanged (4 info / 94 warn / 1 auth). Status function checked on live data. `pnpm test:sql` 466 passed.
- **Audit:** [daily time record](../2026-10-28-attendance-daily-time-record.md)

## What it changes

- **`attendance_schedules.work_days`:** ISO weekdays, default `{1,2,3,4,5,6}` (Mon–Sat).
- **`set_attendance_schedule`:** dropped and re-created with a 6th parameter `p_work_days` (default Mon–Sat): sorted, distinct, 1–7, at least one day. Rights are unchanged (`biometrics.manage` + MFA, definer, authenticated only).
- **`record_biometric_scan`** (same signature and answer shape):
  - the first scan of the day is Time IN;
  - after the repeat window, the next scan is Time OUT;
  - once a Time OUT exists, every later scan is logged as an ignored `repeat` pointing at the Time OUT ("already timed out");
  - `returned` is no longer produced.
  - The receiver and firmware need no change.
- **`attendance_daily_status(project, from, to)`:** invoker, granted to authenticated and service_role; at most 63 days and never after today. One row per worker and day:
  - active workers from their creation day, plus anyone who scanned;
  - time_in, time_out, status, late_minutes (from the time-in flag), early_minutes (from the time-out flag).
  - Statuses:
    - `absent`: a working day whose time out has passed with no Time IN;
    - `not_in_yet`: today before time out;
    - `rest_day`: a day off;
    - `not_enrolled`: no fingerprint yet;
    - `no_schedule`: no schedule set;
    - `present`: a Time IN without a schedule flag.
- **`attendance_day_summary`:** adds `on_time`, `absent`, `not_in_yet`. `late` now counts workers late.

## Tests

`99-zzzzzzzzzzzzzzzzzzzzzzzz-daily-status.cases.mjs` (5 cases):
- working days, validation and the old 5-argument call;
- one Time IN / Time OUT, already timed out, next day;
- the status matrix (on time, late, absent, rest day, not enrolled, workers registered later, inactive workers);
- today not in yet, future days cut, range limit;
- summary counts; clients and outsiders see nothing.

Updated earlier cases: the lunch break scenario and the summary keys. **Deliberate break:** removing the "already timed out" rule failed 5 cases; restored byte-for-byte.

## After applying

1. Read-only checks: column, one 6-argument `set_attendance_schedule`, function grants.
2. Security advisors.
3. Deploy the web app. No receiver or firmware change is needed.
