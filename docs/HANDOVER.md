# BuildTrack handover

For the teammates who take the project from here. Read [README.md](../README.md) first, then this.

Workspace separation: `/pm/*` is Project Manager-only. Admins keep project creation, archive/restore and manager assignment in All projects; the Project operations shortcuts and Admin oversight mode were removed. This frontend boundary does not change existing database administrative privileges. See `audits/2026-10-29-admin-workspace-separation.md`.

## 1. How the pieces connect

One piece of work travels through the whole system. Follow a pin and you have seen most of it.

```
Engineer uploads a plan sheet  ->  places a PIN (the work, e.g. LAUNDRY) with WORK ITEMS (FLOOR, WALL...) and approves its inspection criteria
        |                                   |
        |                         assigns it to a FOREMAN  ->  notification (bell + email queue)
        |                                   |
        |            Foreman: photos per work item -> Ready -> submits it for QA (one open request per work)
        v                                   v
   Review inbox  <----  work item requested  ---->  EVIDENCE LOCK: submitted photos and remarks stay on record
        |
   Engineer inspects against the criteria -> Passed, or failed criteria raise NCRs (due dates by severity)
        |                                   |
        |               Foreman: ONE correction package (fix + new photos + the NCRs it answers) -> linked re-inspection
        |                                   |
   Engineer closes / sends back each NCR, then Accepts the work item (all inside the work item record)
        |
        +--> every item Accepted + every NCR / inspection clear = work COMPLETED: counts as PROGRESS (dashboards, S-curve, client portal, Project Health)
        +--> stage / hold-point inspections are separate requests; their results and NCRs also block completion
        +--> client sees plain-language progress; a client's "report a problem" can become an NCR
```

Everything the screens show is read from these tables, so numbers always agree: `pins`, `pin_events` (timeline), `pin_photos`, `qa_inspections` / `qa_inspection_items`, `qa_defects` / `qa_defect_events`, `daily_reports`, `client_snags`, `notifications`.

## 2. Rules the database enforces (not just the screens)

- Roles and status live in `profiles`; the browser is never trusted. Writes go through checked SQL functions (RPC); most tables are read-only to the API.
- Admins and Super Admins need TOTP (aal2) for every admin action.
- Project Managers (`project_managers`, assigned only by Admins) reach their assigned projects only; they write only on projects that are not archived and never do QA sign-off or company administration (`docs/audits/2026-10-29-project-manager-role.md`).
- Row Level Security decides who sees which project. Read policies use `viewable_project_ids()` (fast); copy that pattern for new tables.
- Evidence lock (0033): submitted or verified work and its photos cannot be deleted.
- Photo markup (client reports, site issues, inspection / NCR evidence) is a separate JSON overlay checked by `valid_issue_markup`; the stored photo is always the untouched original.
- Identity verification gates role requests; privacy consent is recorded; "delete my data" anonymises a person without breaking project records.
- Every migration has tests (`supabase/tests`). A migration is applied to the live project only after `pnpm test:sql` passes (see CONTRIBUTING).

## 3. Live data and screens that update by themselves

Supabase Realtime is on for 12 work tables (migration 0034). Data hooks call `useLiveReload` (`src/lib/realtime.ts`), so a foreman's report appears in the engineer's queue without a refresh. The blueprint editor deliberately does not (optimistic edits and undo).

Lists use `fetchAll` (`src/lib/paging.ts`) because Supabase returns at most 1,000 rows per request.

## 4. Where to find things

| I want to ... | Look at |
|---|---|
| Change what a role's menu shows | `src/pages/<Role>/<Role>Shell.tsx` (navigation only; the layout is `components/shell/AppShell.tsx`) |
| Change a role's colours or page-header style | The `[data-persona]` block at the end of `src/index.css` |
| Add a page | CONTRIBUTING, "Add a page" |
| Understand pin data | `src/lib/blueprints.ts`, `supabase/migrations/0010_pins.sql` |
| Understand QA rules | `src/lib/qaModel.ts` (pure, tested) and `0025_qa_module.sql`; keep both identical |
| See who changed what | `docs/audits/` (one note per change) and `docs/audits/migrations-log.md` |
| Check performance after a change | `pnpm test:load` |

## 5. Status

Built and tested: everything in the README table except biometrics. Live on the BuildTrack Supabase project: migrations 0001-0037, Edge Functions `admin-users`, `impersonate`, `oauth-gate`, `send-notifications`.

Sample data only (each page says so): Admin Biometrics registration, Foreman Biometric attendance. The public landing page still mentions biometric attendance; decide whether to build it, reword the page or hide it.

## 6. Open items only the project owner can do

- **Notification emails:** add `BREVO_API_KEY`, `MAIL_FROM_EMAIL`, `APP_URL` as Supabase secrets and a 5-minute cron (steps in `docs/BUILDTRACK_EMAIL_SETUP.md`). Until then the queue fills and nothing is sent.
- **Supabase Auth settings:** turn on leaked-password protection, set the sign-up code length to 6, apply the email templates in `supabase/email-templates/`, rotate any key that was ever pasted into a chat.
- **Google sign-in:** test with a real Google account (register, then login) once.
- **Privacy:** put the real data-protection contact and the retention period for ID photos in `src/lib/privacy.ts`, then raise `PRIVACY_VERSION`.
- **Decide biometrics:** build, reword or hide (see 5).

## 7. Ideas that were considered

`docs/BUILDTRACK_PANEL_FEATURES.md` (what to show and add) and `docs/BUILDTRACK_INTEGRITY_NOTES.md` (loopholes and anti-fraud features such as live GPS-stamped photos, an independent inspector role and payment milestones tied to verified work).
