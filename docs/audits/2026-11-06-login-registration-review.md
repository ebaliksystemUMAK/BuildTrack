# Login and registration review — 2026-11-06

Reviewed main at `4513852630a0ca9204b54fc177db6c5cb4a43276`. This was a review, with isolated reproductions and read-only checks against the confirmed BuildTrack project `ruimjlhsfpaezkgfphsz`. No application code, accounts, authentication settings, schema, or deployed functions were changed. No messages were sent.

## Follow-up: first three findings implemented

The owner subsequently requested fixes for findings 1–3. The original findings below describe the reviewed version before those fixes.

- AuthProvider now invalidates profile requests immediately on session events and commits a matching account's profile, MFA assurance and permissions together. Account changes clear the old snapshot and wait for the new one. Late initial-session responses, older same-account reads, stale permissions and unmounted reads cannot overwrite current state; failed reads exit loading safely.
- Login and registration actions share immediate pending guards within their respective forms. Conflicting actions and inputs are disabled, errors allow retry, OAuth failures clear the intent, and successful OAuth launches stay locked until redirect. Google retains `prompt: "select_account"`. Google registration completion and account switching also share a pending guard.
- Signup and successful code resends start a visible 60-second cooldown. Resend and verification cannot run together. Countdown timers stop on expiry or navigation; errors restore controls, with a cooldown on rate-limit responses.
- The signup code is a controlled numeric field limited to six digits, with matching UI and submit validation. Existing signup verification, privacy confirmation, pending-account approval, MFA and password recovery gates remain in place.
- Added `pnpm test:auth-flows` to the full `pnpm check` chain. It exercises the real components with isolated responses, including the original race and action-overlap scenarios. No live sign-ins, account creation, emails, database changes or hosted configuration changes are required for these UI fixes.
- Follow-up validation passed: `pnpm test:auth-flows`, `pnpm test:password-recovery`, and the complete `pnpm check`, including TypeScript, the authentication regression checks, 757 SQL cases and the production build.

Contact Support and the hosted leaked-password-protection setting remain outside this follow-up's requested scope. Actual Google redirects and inbox delivery remain unverified.

## Findings

### 1. P2 — An old profile response can overwrite the current authentication state

`src/lib/auth.tsx:107–142`: `loadProfile` commits profile, assurance and permissions without checking that its request still belongs to the current account. Sign-out clears the profile through another asynchronous callback but does not invalidate earlier requests. Initial loading only protects the first load; subsequent account changes do not wait for a matching profile.

Reproduced using the real transpiled AuthProvider with fake Supabase responses: begin loading account A; emit `SIGNED_OUT`; allow the null-profile callback to finish; then resolve A's earlier profile response. The provider ends with `session = null` and A's active profile restored. Account changes can likewise race between responses. This can show stale account information or choose the wrong workspace until a later refresh. This reproduction establishes a UI state bug, not a bypass of database authorization.

Recommended fix: invalidate in-flight loads on every session identity change; commit only responses belonging to the current identity and request generation; clear account-specific state and show loading while resolving a new identity. Keep Supabase calls deferred outside the auth callback.

### 2. P2 — Authentication actions are not coordinated while a request is pending

`src/pages/Auth/RegisterPage.tsx:249–257,292`: Resend code has neither an in-flight guard nor a disabled/cooldown state. Two normal button clicks issue two pending resend calls. It also remains available during verification. Repeated requests can hit service rate limits and produce confusing messages.

`src/pages/Auth/LoginPage.tsx:56–75,135–140` and `src/pages/Auth/RegisterPage.tsx:233–246,305`: Google buttons remain enabled while password sign-in or registration is underway; the Google handlers have no shared pending guard. Password and OAuth attempts can overlap. The password submit button itself is disabled while busy, so the programmatic duplicate-submit reproduction alone is not evidence that ordinary repeated browser clicks bypass that disabled button.

Recommended fix: use one immediate pending guard for mutually exclusive authentication actions, disable conflicting controls, and provide an in-flight state plus a resend cooldown. Preserve server-side limits and `prompt: "select_account"`.

### 3. P3 — Signup code input and validation disagree with the six-digit instructions

`src/pages/Auth/RegisterPage.tsx:286–289`: code state strips nondigits but retains up to ten digits, and Verify is enabled for any length of six or more. The underlying FormField is uncontrolled and does not receive a maximum length or numeric input mode here, so displayed text can differ from the cleaned state. A ten-digit value enabled Verify in the isolated reproduction. The server still validates the token; no verification bypass was found.

Recommended fix: align the controlled value, allowed length, input mode and submit validation with the actual hosted signup OTP length. The current instructions and email copy say six digits; this review did not retrieve the hosted Auth OTP-length configuration.

### 4. P3 — Contact Support is a nonfunctional button

`src/pages/Auth/LoginPage.tsx:145–147`: the button has no click handler or link. People awaiting approval receive no contact route. Confirmed in the rendered component fixture.

Recommended fix: connect it to the existing public contact route or an owner-provided support destination.

### 5. Existing security configuration — leaked-password protection is disabled

The live Supabase security advisor still reports `auth_leaked_password_protection`. Client strength checks do not check the breached-password list. This is a hosted configuration item, not a newly introduced login regression. Supabase documents this option for Pro plans and above: [Password security](https://supabase.com/docs/guides/auth/password-security). No setting was changed.

## Verification and limits

- Passed: `pnpm test:password-recovery`, `pnpm test:email-codes`, `pnpm test:account-status`, `pnpm test:system-control`.
- The preceding implementation's full `pnpm check` passed at this same application source, including 757 SQL cases and the production build; no application source changed during this review.
- Isolated real-component fixtures reproduced findings 1–4 without network calls, account creation, emails or actual sign-in/sign-out. The temporary reproduction file was removed after the review.
- Current Google login and registration both request `prompt: "select_account"`.
- Reviewed the database-derived profile/role handling, pending-registration gate, MFA gate and recovery routing. An unverified app email flag on older/Google accounts is not by itself evidence of a broken signup: the existing email-verification migration intentionally distinguishes BuildTrack verification from provider confirmation.
- Read-only logs in the default preceding-24-hour window showed successful responses and redirects plus one `refresh_token_not_found`, four `user_not_found` and one `session_not_found`. These do not establish a broad Auth outage or prove which UI interaction caused them.
- Provider account selection, a new user's actual signup email, inbox delivery and a complete browser sign-in were not tested. No access credentials were requested or used.

Fix order: profile-response consistency, action coordination/resend controls, code input, support link. Hosted leaked-password protection depends on the project's plan and owner configuration.
