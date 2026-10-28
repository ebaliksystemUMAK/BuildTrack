# Daily time record: Time in / Time out, On time / Late / Absent — 2026-10-28

## Request

Check why there are so many clock-in and clock-out records. Rename them to Time in / Time out, and add On time, Absent and Late.

## Why there were many records (live data, 2026-10-27, one worker)

| Philippine time | Record | Cause |
|---|---|---|
| 7:21:08 PM, 7:21:47 PM | IN, IN | Old firmware; the scanner switch decided (before the scan fix) |
| 8:03:56 PM | OUT | Rule: every scan outside the repeat window flips IN → OUT → IN … |
| 11:48:49 PM | IN ("Back on site") | Same rule: re-entry after an OUT was allowed |
| 11:54:51 PM | OUT | Only 6 minutes later: the Admin's repeat window is **1 minute** |

Five repeat scans in between were correctly ignored. Existing rows were not changed.

## Changes

### Database: `20261028010000_attendance_daily_status.sql` (NOT APPLIED, see below)

Details: [sql/20261028010000_attendance_daily_status.md](sql/20261028010000_attendance_daily_status.md).

- **One Time in and one Time out per worker per day.** A scan after Time out is logged as an ignored repeat, so the scanner shows "ALREADY TIMED OUT" and the screen pops up "Already timed OUT … Only one time in and one time out per day". The receiver and firmware are unchanged.
- **Working days** on the schedule.
- **`attendance_daily_status`:** On time, Late (minutes), Absent (no time in on a working day once time out has passed), Not in yet, Rest day, No fingerprint, No schedule, Present. Day summary counts are added.

### Website

- **Wording:** Time in / Time out everywhere (site screen, Foreman records and worker detail, report print and CSV). Tests assert no "Clock" remains on those screens.
- **Site attendance screen:** cards On time / Late / Absent / Not in yet.
- **Foreman → Attendance records:** new **Daily attendance** table (Worker, Time in, Time out, Status, Undertime) with counts, above **Scan records**. A row opens the worker.
- **Worker detail:** Time in, Time out, Status, Undertime.
- **Admin → Attendance schedule:** working-day checkboxes (at least one), with the rules explained. The summary line starts with the days ("Mon–Sat · …"). The text recommends a 10–15 minute repeat window.
- **Report:** a **Daily time record** with absent workers, plus on time / late / absent worker-day totals. It falls back to the scan summary when the database status is unavailable.

## Go live

1. Run the migration in the Supabase SQL Editor: `begin;` + the file + `insert into supabase_migrations.schema_migrations(version, name) values ('20261028010000', 'attendance_daily_status'); commit;`. The connector call was blocked by Claude Code auto mode.
2. Deploy the web app.
3. Admin: set the working days, and raise the repeat window from 1 to 10–15 minutes.

## Verification

- `pnpm test:sql`: 466 passed (5 new). **Deliberate break:** removing the "already timed out" rule failed 5 cases; restored.
- `test:attendance`, `test:foreman-attendance` (Daily attendance table, worker status, row opens worker, no Clock wording), `test:attendance-reports` (status labels, working days, daily time record and fallback) and `test:worker-enrollment` (working days sent, none blocked) all pass.
- `pnpm check` passed.
- **Not verified:** the live database (not applied), a browser check, or a physical scan with the new rules. The load test does not cover attendance.

## Applied (2026-10-28)

The owner ran the migration in the SQL Editor.

- **Verified read-only:** history row, `work_days` column, one 6-argument `set_attendance_schedule`, all four function bodies identical to the file, grants, and security advisors unchanged.
- **Live status check:** Oct 27 GILBERT = Present (scans before the schedule); Oct 28 GILBERT = On time with Early out 16 h 40 min (midnight test scans); a worker without a fingerprint = No fingerprint.
- **Still to do:**
  - deploy the web app;
  - the Admin raises the repeat window from 1 minute to 10–15 minutes and checks the working days.
