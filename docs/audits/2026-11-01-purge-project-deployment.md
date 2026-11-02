# 2026-11-01 purge-project Edge Function deployment and the two migrations

The owner asked for the project recycle bin, Super Admin-only permanent deletion and delete protection to be applied "if safe". BuildTrack's project URL was verified as `https://ruimjlhsfpaezkgfphsz.supabase.co` first.

## Gates before applying
- `pnpm check` green: 145 lib tests, all script suites, 655 SQL cases, build. The 5,000-pin load test timings were the same as without the changes.
- A read-only pre-check on the live database: no name collisions, all referenced tables and constraints present.
- A fingerprint (row count and an md5 of ids / statuses) of 17 work tables (projects, members, plans, markups, pins, pin events / photos / checklist, daily reports, inspections, defects, QA photos, attendance workers, biometric events, profiles, notifications) and of the 106 storage objects, taken before and after each migration. **All identical.** No project is removed.

## Applied
| Migration | Live version |
|---|---|
| `20261101180000_project_recycle_bin` | `20261101081342` |
| `20261101190000_delete_protection_and_purge` | `20261101081428` |

Verified afterwards: function privileges as designed (internal functions not executable by anon / signed-in accounts; the purge functions service role only), six triggers, five restrictive policies, the three author keys now `restrict`, no delete grant left for `anon`, security advisors show no new category (only the signed-in RPCs, each checking its permission inside).

## Edge Function
`purge-project` v1, ACTIVE, `verify_jwt = true`, bundle SHA-256 `e6def917716468e457139559a3e9aed28b2bb3f56dcc9854d531e6d8d1ae3531`. The deployed files were read back and match the repository. Probes with no real account: no session -> 401, malformed token -> 401, CORS -> 200. It needs a Super Admin session that passed the authenticator, asks the database whether the project may be deleted (30 days in the bin, no real records), requires the typed phrase `DELETE FOREVER <code>`, lists the project's plan files, deletes the rows through a service-role-only function, then removes the files. No project qualifies today (none is in the bin), so nothing can be deleted by it yet.

## Not done
- Nothing was committed or pushed. The screens (Recycle bin, Remove, Delete forever, sheet / checklist confirmations) are on the branch and reach people only after it is merged and deployed.
- An authenticated end-to-end run (remove, restore, delete forever) was not made against the real database: it needs a Super Admin session with the authenticator code and a throwaway project, and a delete forever additionally needs 30 days in the bin. It was tested with the in-memory database (every rule, refusal and audit row) and mocked screens.

## Rollback
Edge Function: delete `purge-project` in Supabase. Migrations: the rollback blocks at the end of each file (restore every removed project first).
