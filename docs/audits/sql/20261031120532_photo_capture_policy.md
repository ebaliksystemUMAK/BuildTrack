# Photo capture policy (Super Admin switch for device uploads)

| Field | Value |
|---|---|
| File | `supabase/migrations/20261031120532_photo_capture_policy.sql` |
| Written / applied | 2026-10-31, applied and tracked as 20261031120532 (written as 20261031140000, renamed to the hosted version) |
| Depends on | `0039_photo_stamp.sql` (`stamp_evidence_photo`), `0041_daily_report_photos.sql`, `20261028064248_daily_report_camera_biometrics.sql` (`capture_source`, `require_daily_report_camera`), `20261028150000_project_checklists.sql` (`set_setting`) |
| Status | Applied; 545 SQL tests pass; live objects verified |
| Reversible | Yes, see Rollback. Turning the switch back on restores the earlier behaviour without any SQL |

## Purpose

An Admin asked for one switch that decides whether Foremen may upload photos from their device. When it is off, daily progress report photos and submitted evidence must be taken with the in-app camera at the project site.

## Objects and behavior

- `system_settings` row `photos.allow_device_upload`, seeded `true` (uploads allowed, which matches the behaviour before this migration). It is changed only through `set_setting`, which now accepts only a JSON boolean for this key.
- `capture_source` (`legacy` | `camera` | `upload`):
  - `pin_photos` and `qa_photos` get the column, `not null default 'legacy'`, so existing rows become `legacy`.
  - `daily_report_photos`: its check constraint gains `upload`.
  - `qa_photos` gets a column insert grant for `capture_source` (`pin_photos` already had a table-level insert grant).
- `photo_uploads_allowed()`: false only when the stored value is exactly `false`. A missing or malformed row counts as allowed.
- `enforce_photo_capture_policy()` runs from the new `BEFORE INSERT` triggers `<table>_stamp_policy` on all three photo tables. Triggers fire in name order, so it runs after `<table>_stamp` and sees the computed `stamp_flag` / `distance_m`.
  - **No check at all** while uploads are allowed, for service-role or backend inserts (`auth.uid()` null), and for `qa_photos` added by anyone who is not a Foreman (Engineers' own inspection photos).
  - **Otherwise** the photo must be `capture_source = 'camera'` with `stamp_flag = 'at_site'`. Each refusal has its own message: upload or legacy, no position, project without a site location, distance from the site (m / km), or untrusted phone time.
- `require_daily_report_camera()` now also lets `upload` through. While uploads are off, the policy trigger has already refused it. Rows without a source or a `taken_at` stay refused.

## Security

- The new functions are `SECURITY DEFINER` with an empty search path, and execution is revoked from `public` / `anon` / `authenticated` (live ACL: `postgres`, `service_role`).
- `set_setting` keeps its ACL and its Super Admin + MFA gate; the change is audited as `settings.update`.
- The browser can only claim `capture_source`. The flag and distance are still computed by the database, and the site check uses those computed values.
- A determined person can fake a camera stream or GPS position. This raises the bar, and the stamp records what the phone sent.

## Verification

- New suite `99-…-photo-capture-policy.cases.mjs` (8 cases): default allowed on all three tables; only Super Admin + aal2 can change it, only to a boolean, and the change is audited; while off, upload and legacy rows are refused, as are no position, 220 m / 2.6 km away, no site set and clock ahead; at-site camera photos and the 100 m accuracy allowance pass; Foreman QA photos are checked while the Engineer's are not; internal functions are denied to users; switching back on accepts uploads again. **545 tests pass** (537 earlier + 8).
- Before applying, the live `set_setting`, `require_daily_report_camera` and `stamp_evidence_photo` bodies had the same md5 as the repository; latest tracked migration was `20261031102813`.
- After applying:
  - setting `true`; three `*_stamp_policy` triggers present; daily check constraint includes `upload`.
  - existing rows untouched: 25/25 pin photos and 52/52 QA photos are `legacy`; daily photos keep `camera:1, legacy:4`.
  - ACLs as above; `qa_photos.capture_source` insert grant present.
- Security advisors: same three kinds of finding as before (1 info rls_enabled_no_policy, 1 authenticated-definer warning, 1 auth leaked-password warning). The new functions are not listed; `set_setting` was already listed before.

## Rollback

```sql
drop trigger pin_photos_stamp_policy on public.pin_photos;
drop trigger qa_photos_stamp_policy on public.qa_photos;
drop trigger daily_report_photos_stamp_policy on public.daily_report_photos;
drop function public.enforce_photo_capture_policy();
drop function public.photo_uploads_allowed();
```
Then restore `require_daily_report_camera()` from `20261028064248_daily_report_camera_biometrics.sql` and `set_setting()` from `20261028150000_project_checklists.sql`. Dropping the `capture_source` columns or the setting row deletes recorded data and needs the owner's approval; leaving them in place is harmless.
