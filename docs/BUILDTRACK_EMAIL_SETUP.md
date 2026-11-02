# Turning on notification emails (owner steps)

The code, the database queue and the Edge Function `send-notifications` are in place. Emails start flowing when you do these four things in the Supabase dashboard of the BuildTrack project (never paste keys in chat or commit them):

1. **Brevo API key.** In Brevo: SMTP & API > API keys > create one. In Supabase: Edge Functions > Secrets, add `BREVO_API_KEY` with that value. (The SMTP login/key already in `.env.secrets` are for Supabase Auth only; Edge Functions cannot use SMTP.)
2. **Sender.** Add secret `MAIL_FROM_EMAIL` = an address you have verified as a sender in Brevo (Senders & IP), and optionally `MAIL_FROM_NAME` (default "BuildTrack").
3. **App address.** Add secret `APP_URL` = the public address of the app, for example `https://your-domain`. Without it the emails have no button, only text.
4. **Schedule.** Integrations > Cron > new job, type "Supabase Edge Function", function `send-notifications`, method POST, every 5 minutes, header `Authorization: Bearer <service role key>` (or set a secret `CRON_SECRET` of 16+ characters and send it as header `x-cron-secret`).

Check it: call the function once by hand. `{"configured":false}` means a secret is missing; `{"configured":true,"claimed":N,"sent":N}` means it works. Each person can switch emails off in the bell menu. Outcomes are in the table `email_log` (SQL editor only).

After the four steps, open **Admin > System health** (Super Admin) to see the email settings (present / missing, never the values), the queue and the scheduled jobs, and to send yourself one test email. "Accepted" there means the mail provider took the message; use "Ask the provider" for its delivery report. The page needs the `system-health` Edge Function deployed (`npx supabase functions deploy system-health --project-ref ruimjlhsfpaezkgfphsz --use-api`). The daily admin digest is a separate, optional schedule: see `docs/audits/sql/20261101120000_system_health_and_admin_digest.md`.

Limits by design: at most 20 emails per person per 24 hours, three attempts per notification, nothing older than 2 days is sent, only active accounts are emailed.
