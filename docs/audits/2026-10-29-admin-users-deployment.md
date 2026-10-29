# 2026-10-29 admin-users deployment

The owner authorized deploying the backend update needed for Project Manager account management. BuildTrack's project URL was verified as `https://ruimjlhsfpaezkgfphsz.supabase.co` before deployment.

The live `admin-users` function was ACTIVE v6 and did not include `project_manager` in assignable roles or the whitelist. Deployed the committed repository entrypoint (`supabase/functions/admin-users/index.ts`, commit `8a711fe`) and its relative dependency (`supabase/functions/_shared/guard.ts`) through the Supabase connector. No other function was deployed. The shared authentication guard was identical to production before deployment.

Result: ACTIVE v7, `verify_jwt=true`, bundle SHA-256 `07c92e1d78751ae2a32986917b6b2259b001d7ee36bee6935d88e5c069d99902`. Retrieved the deployed source and verified both files match the repository (line endings ignored). Existing JWT validation, active Admin/Super Admin checks, TOTP aal2 and action-specific permissions remain in place. This also publishes the repository's existing self-account protections and decision-note audit handling that were newer than v6.

Verification:

- Full `pnpm check` passed immediately before the preceding Git push: type-check, model/UI tests, all 531 SQL cases and production build. No source changes since that check.
- Live POST with a harmless unknown action and no session: HTTP 401.
- Live POST with the same action and an invalid JWT: HTTP 401.
- Live CORS OPTIONS: HTTP 200.
- Database counts before/after: 10 profiles, 7 memberships, 1 Project Manager assignment, 0 whitelist entries. No user-management mutation or email was triggered by the probes.

An authenticated Admin/MFA role-change flow was not executed against a real account. Frontend source is already pushed to GitHub; Vercel deployment status was not inspected or changed in this task. The backend deployment is complete.
