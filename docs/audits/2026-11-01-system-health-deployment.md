# 2026-11-01 system-health Edge Function deployment

The owner asked for `system-health` to be deployed safely. BuildTrack's project URL was verified as `https://ruimjlhsfpaezkgfphsz.supabase.co` first. The function did not exist before, so nothing live was replaced.

Deployed through the connector (the CLI has no access token here): `system-health/index.ts` plus `_shared/{guard,healthModel,emailTest,emailModel}.ts`, copied from the repository. Result: **ACTIVE v1, `verify_jwt = true`**, bundle SHA-256 `8fa529155c065f7b4c53048d1c5c03128ef7244cd6ef608f067f58aa096f6041`. The deployed files were read back and match the repository.

Why it is safe to have deployed:
- Needs a signed-in, active **Super Admin whose session passed the authenticator** (`requireCaller` + `authorizeHealthCaller`). Admins and everyone else get 403.
- The test email goes **only to the caller's own address** (never read from the request), at most 3 an hour and 10 a day (`begin_email_test`).
- The mail settings are reported as yes / no only; no value is ever returned. Provider text is sanitised (`sanitizeProviderText`).
- With no mail secrets saved (today's state) it **cannot send anything**: `can_send` is false and the test returns "Email is not set up".
- Nothing is scheduled by it and it changes no data except one `email_test_log` row and one `email.test` audit row per test.

Probes (no real account, no data written): POST without a session -> HTTP 401; POST with a malformed token -> HTTP 401; CORS OPTIONS -> HTTP 200. An authenticated Super Admin call was not made from here (it needs the authenticator code); the first one is the System health page itself, after the frontend is deployed.

Rollback: delete the function in Supabase (Edge Functions > system-health). The System health page then shows "not deployed yet" for the mail checks and everything else keeps working.
