# 2026-10-31: Per-account photo rules, Site photos permission, System settings tabs

## Request

"Add an option to enable and disable the uploading of photos on other accounts" (both per account and for chosen Admins, all in System settings, not User management) and "separate contents on System settings by tab".

## What changed

- **System settings tabs:** Quality scoring, Working hours, Standards and codes, Access review, Site photos.
  - The tab bar is brand-filled when active and bordered, like User management; a dot marks a tab with unsaved changes.
  - Each card keeps its own Save / Reset.
- **Site photos tab:**
  - **Company setting:** the existing switch.
  - **Per-account choices:** a searchable list of active Foremen and Engineers. Each is set to Follow company setting, Allow uploads or Camera only (at site), and the row shows what applies now. Changes are staged and saved together after a confirmation; every change is audited (`photos.account_rule`).
  - A person's own choice always wins over the company setting. Camera only also covers an Engineer's own inspection photos.
- **New Admin permission "Site photo rules" (`photos.manage`)** in User management > Permissions (Super Admin only grants it).
  - With MFA it lets an Admin change the company switch and the per-account choices.
  - Admins with View users can see the list read-only.
  - All other system settings remain Super Admin only.
- **Field screens** use the person's own choice: `usePhotoPolicy` reads `photo_upload_overrides` for the signed-in user (own row only), and pure rules in `lib/photoPolicyModel.ts` match the SQL.

## Files

- Migration `supabase/migrations/20261031123546_photo_upload_rules.sql` (doc `sql/20261031123546_photo_upload_rules.md`), SQL suite `99-…-photo-upload-rules.cases.mjs`.
- `src/lib/photoPolicyModel.ts` (pure, tested in `pnpm test:lib`), `src/lib/photoPolicy.ts` (own rule, list + save helpers).
- `src/pages/Admin/SystemSettings.tsx` (tabs), `src/pages/Admin/PhotoAccountRules.tsx` (list), `src/components/qa/QaBits.tsx` (`qaCameraOnly`).
- Permission lists: `src/lib/auth.tsx`, `src/pages/Admin/PermissionMatrix.tsx`, `src/pages/Admin/UserManagement.tsx`, `supabase/functions/admin-users/index.ts`.
- Tests: `scripts/test-lib.mjs`, `scripts/test-qa-photo-markup.mjs`.

## Deployment completed 2026-11-01

The October 31 deployment blocker is resolved. `admin-users` v8 is ACTIVE with JWT verification enabled and accepts `photos.manage` in `set_permissions`. Both hosted files match the local source; the authorization guard is unchanged.

The new permission can now be selected in the Permission matrix and accepted by the deployed function. Missing and invalid sessions return 401; CORS returns 200. No existing account grants were changed during verification. See [the verified follow-up](2026-11-01-photo-rules-follow-up.md).

## Checks

- 552 SQL tests, 129 lib tests, photo markup, worker camera, and every other check script pass; the build passes.
- Follow-up on 2026-11-01: the full `pnpm check`, including attendance-report tests and the standard build, passes. `test:photo-settings` covers refresh, account races, preserved tab drafts, unsaved markers and partial-save retry.
- The original October 31 UI work was not browser-checked; the follow-up uses the actual hook/components with mocked I/O for behavior verification.
