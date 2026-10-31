# Photo upload rules per account + Site photos permission

| Field | Value |
|---|---|
| File | `supabase/migrations/20261031123546_photo_upload_rules.sql` |
| Written / applied | 2026-10-31, applied and tracked as 20261031123546 (written as 20261031150000, renamed to the hosted version) |
| Depends on | `20261031120532_photo_capture_policy.sql` (switch, `enforce_photo_capture_policy`, `set_setting`), `0002_admin_mfa_aal2.sql` (`has_permission`) |
| Status | Applied; 552 SQL tests pass; live objects verified. Edge Function `admin-users` v8 with the new permission deployed and verified 2026-11-01 (JWT enabled) |
| Reversible | Yes, see Rollback |

## Purpose

The owner asked for two things, both shown in System settings rather than User management:
- per-account control over device photo uploads;
- a way for Admins, not only the Super Admin, to manage the photo rules.

## Objects and behavior

- **`admin_permissions` check constraint** gains `photos.manage` ("Site photo rules" in the Permission matrix). New Admins do not get it by default.
- **`photo_upload_overrides`** (`user_id` PK → profiles, `mode` `allow` | `camera_only`, `updated_by`, `updated_at`):
  - RLS is on. Signed-in users have `select` only, and the policy shows a person their own row; Admins with `photos.manage` or `users.view` see every row.
  - No insert, update or delete for API roles.
- **`set_photo_upload_rule(p_user, p_mode)`** (`photos.manage` + MFA through `has_permission`; the Super Admin always qualifies):
  - `p_mode` null removes the row, so the person follows the company setting.
  - Only Foreman and Engineer accounts can have a rule.
  - Each real change writes the audit row `photos.account_rule` with `{before, after}`.
- **`get_photo_upload_accounts()`** (`photos.manage` or `users.view`): active Foremen and Engineers with their rule, in a stable order (paged with `fetchAll`).
- **`enforce_photo_capture_policy()`**: the person's own rule now comes first:
  - `allow`: always accepted.
  - `camera_only`: in-app camera at the site, also for that person's QA photos, including an Engineer's inspection photos.
  - No rule: as in 20261031120532.
- **`set_setting`**: `photos.allow_device_upload` can now be changed by `has_permission('photos.manage')`. Every other key stays `is_super_admin()` only.

## Security

- **New functions:** `SECURITY DEFINER` with an empty search path, `public` / `anon` revoked. The two RPCs are executable by `authenticated` and check the permission themselves; the trigger function stays private.
- **Permission grants** still go only through the Super Admin, via Edge Function `admin-users` `set_permissions`.
- **Edge Function:** `photos.manage` was added to `PERMISSIONS` and deployed on 2026-11-01 as `admin-users` v8 ACTIVE with JWT verification enabled. Hosted sources match the repository; the existing Admin/MFA/Super Admin grant guards are unchanged. The October 31 deployment blocker is resolved; see `../2026-11-01-photo-rules-follow-up.md`.

## Verification

- **Tests:** new suite `99-…-photo-upload-rules.cases.mjs` (7 cases):
  - the constraint accepts the new permission;
  - an Admin with photos.manage + aal2 changes the switch but not another setting; aal1, users.view-only and no-permission Admins are refused;
  - rules are only for Foremen / Engineers, only the three choices, and are audited once per real change;
  - a person reads only their own row; the list RPC works for photos.manage / users.view only; there are no direct writes;
  - `allow` beats switch off; `camera_only` beats switch on, including Engineer QA photos; no rule behaves as before.
  - **552 tests pass** (545 + 7).
- **Before applying:** the live `set_setting` and `enforce_photo_capture_policy` bodies had the same md5 as `20261031120532`.
- **After applying:**
  - tracked as 20261031123546;
  - the constraint lists 10 permissions; existing permission rows untouched (8);
  - table RLS on, policy `read photo rules`, `authenticated` = SELECT only, no `anon` grant, 0 rows;
  - company switch still `true`; ACLs as described.
- **Security advisors:** same three kinds of finding. The two new RPCs appear in the existing authenticated-definer warning (intended; gated inside). The table is not flagged.

## Rollback

```sql
drop function public.get_photo_upload_accounts();
drop function public.set_photo_upload_rule(uuid, text);
```
Then:
- Restore `enforce_photo_capture_policy()` and `set_setting()` from `20261031120532_photo_capture_policy.sql`.
- Dropping `photo_upload_overrides` or narrowing the permission constraint deletes recorded rules and grants. It needs the owner's approval, and any `photos.manage` rows must be removed first.
