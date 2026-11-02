# Owner setup checklist (admin phases 1-4 and after)

Things only the owner can do, or must approve, collected from the phase reports. Tick them off here; nothing in this list was done by the assistant. Updated 2026-11-01.

## Done so far (for reference)
- `admin-users` v9 deployed (phase 1). Migration `admin_communications` applied (phase 2).
- Migrations `system_health_and_admin_digest` and `site_controls` applied; Edge Function `system-health` v1 deployed (see `2026-11-01-system-health-deployment.md`).

## 1. Put the new screens live (most important)
- [ ] Merge the admin work (branch `feature/admin-phase4` carries phases 1-4, uncommitted) into `main` and let Vercel deploy. Coordinate with the teammate who is editing on another laptop before committing or pushing.
- [ ] Until then: the live app cannot suspend accounts (`admin-users` v9 requires a written reason that only the new screen sends), the Site controls and System health pages do not exist, and the live app does not understand a maintenance message.

## 2. Email (not working yet): the one blocker is the Brevo API key
**Diagnosed 2026-11-01:** Cron runs every 5 minutes and the sender reaches Brevo, but all 42 attempts failed with `Brevo 401: Key not found`. The only Brevo key in `.env.secrets` is the SMTP key (`xsmtpsib-...`), which works for Supabase Auth only. Create a real **API key** (Brevo > SMTP & API > API Keys, starts with `xkeysib-`) and save it as the Supabase secret `BREVO_API_KEY`. Until then registration codes and reset codes answer "could not send the code right now" (on purpose), so a Google sign-up cannot finish its email step.

Findings of 2026-11-01 (read-only): the database has 144 notifications and **none has ever been emailed**; `email_log` has 0 rows; the Edge Function `send-notifications` (v3) was not called at all in the last 24 hours; neither Cron (`pg_cron`) nor `pg_net` is installed. So **nothing ever asks the function to send**, whatever Brevo settings exist. Sign-up codes (OTP) are a separate path (Supabase Auth's own SMTP settings); the last 24 hours of Auth logs show only Google logins, so that path was not exercised and cannot be judged from here.
- [ ] Save Supabase secrets: `BREVO_API_KEY`, `MAIL_FROM_EMAIL` (a sender verified in Brevo), `APP_URL` (the live https address); optional `MAIL_FROM_NAME`, `CRON_SECRET` (16+ characters). Guide: `docs/BUILDTRACK_EMAIL_SETUP.md`.
- [ ] Open Admin > System health > send the test email to yourself; check the inbox.
- [ ] About 143 notifications are waiting; anything older than 2 days is never emailed, and each person gets at most 20 emails a day.

## 3. Scheduling (Cron is not installed on this project)
- [ ] Install the Supabase Cron integration, then schedule the email sender (`send-notifications`, see the email guide).
- [ ] Optionally schedule the daily admin digest (command in `sql/20261101120000_system_health_and_admin_digest.md`; 08:00 Manila). Without it nothing is sent.

## 4. Site controls: try them carefully
- [ ] First test feature isolation for the role "Basic users" only (affects nobody in practice).
- [ ] Keep any maintenance test under a minute and say it is a test in the message. Do not test forced logout on real accounts.
- [ ] Keep the switch-off SQL (`sql/20261101150000_site_controls.md`) somewhere reachable in case the Super Admin's authenticator is lost.
- [ ] A new work table is not guarded automatically: add it to the list in the migration (new migration) when one is created.

## 5. Supabase settings
- [ ] **Paste the link-only reset email** (Authentication > Emails > Templates > Reset password): `supabase/email-templates/reset-password.html`. The 6-digit code no longer depends on this template (it is BuildTrack's own email).
- [ ] **Add redirect URLs** (Authentication > URL Configuration): `https://valencia-buildtrack.vercel.app/reset-password` and `http://localhost:8443/reset-password`.
- [ ] Confirm Email OTP Expiration 600 and Email OTP Length 6; then test a reset with an account you own (link, code, wrong code).
- [ ] Turn on leaked-password protection (Auth settings); the security advisor still reports it as off.

## 6. Not verified from here
- [ ] An authenticated end-to-end run of: suspend / re-enable with reason, announcement publish, Communications send, System health test email, maintenance on/off, forced logout. These need a real Super Admin session with the authenticator code, so they were tested only with mocked screens and the in-memory database.
- [ ] Vercel deployment status of the earlier Project Manager work was never inspected.

## 7. Project recycle bin and permanent deletion (applied; screens not yet live)
- [x] `20261101180000_project_recycle_bin` and `20261101190000_delete_protection_and_purge` applied and verified; Edge Function `purge-project` deployed (2026-11-01).
- [ ] **Deploy the screens now** (merge the branch): until then the live app still shows the old Delete button on projects, which the database now refuses with "archive it, then move it to the recycle bin", and the Recycle bin / Delete forever screens do not exist. Nothing is lost in the meantime.
- [x] Permanent deletion: Super Admin only, 30 days in the bin, only projects with no real records (built). To actually delete one you also need a throwaway archived project that has sat in the bin for 30 days.
- [ ] Decide: do you want **automatic expiry** of the bin? Not built. Default: removed projects stay until a Super Admin deletes them or restores them.
- [ ] Check retention duties (construction records, personnel data, Data Privacy Act) with the school/company before deleting any real project data.
- [ ] Decide whether plans/pins need a narrower recycle bin (not built; reasons in the audit note).
- [ ] After the first real removal, check Admin > Audit log for `project.removed` and test Restore on a throwaway archived project.
