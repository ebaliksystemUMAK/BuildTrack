# 2026-11-01: Complete the photo-rules review follow-up

## Completed

- `usePhotoPolicy` refreshes on visible pages each minute and on window focus, returning to the tab or reconnecting. Policy/site reads share cached and in-flight requests. Expired pending requests can be retried; older responses cannot replace a newer account's policy. Failed reads retain only that account's remembered policy. Unmount removes timers/listeners and ignores late results. Database enforcement remains authoritative.
- System settings mounts per-account choices when Site photos is first opened, then preserves that component while other tabs are selected. Staged choices, search, partial-save retries and busy state survive tab switches. The Site photos unsaved indicator includes both the company switch and per-account choices; Reset/successful saves clear their respective changes.
- `pnpm build` uses `vite build --configLoader bundle`, resolving the config runner's CommonJS `picomatch` failure. No dependency installation was needed.
- `CLAUDE.md` now describes the actual QC Checklists label, implemented biometric attendance, passing attendance-report tests and the completed deployment.

## Edge Function deployment

- Project verified before deployment: `https://ruimjlhsfpaezkgfphsz.supabase.co`.
- Deployed only `admin-users`: v7 -> **v8 ACTIVE**, with **`verify_jwt=true`**.
- The sole source change is adding `photos.manage` to the existing permission whitelist. `_shared/guard.ts` is unchanged; existing session, active Admin, MFA, Super Admin-only permission grants, self-change and target-role checks remain.
- After deployment, both hosted files match the local files after line-ending normalization.
- Deployment artifact SHA-256: `625edef151444e61e90cae9846509d5e2717261441e8508d2220129127e6d228`.
- Read-only HTTP probes: OPTIONS/CORS 200; missing session POST 401; invalid session POST 401. No account permissions were granted or revoked during verification.
- The three October 31 migrations remain present in hosted migration history; this follow-up required no new SQL migration.

## Verification

- Full `pnpm check` passed: TypeScript, all registered frontend/helper suites, **552 SQL cases**, and the standard production build.
- New `test:photo-settings` exercises the actual policy hook and settings components with mocked I/O: automatic/resume refresh, shared reads, background polling suppression, offline recovery, expired requests, account changes, stale-result cleanup, preserved tab drafts, unsaved markers, confirmation cancellation and partial-save retry.
- Existing attendance-report, photo markup, camera, QA and role tests pass through the full check.

## Historical notes resolved

The October 31 photo-upload audit's outstanding `admin-users` deployment is complete. Its attendance-report failure note was recorded during separate ongoing edits; the current attendance suite passes and includes weekly/monthly/date-range totals per worker.
