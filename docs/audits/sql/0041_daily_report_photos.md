# 0041 — Daily report photos

| Field | Value |
|---|---|
| Migration | `supabase/migrations/0041_daily_report_photos.sql` |
| Written | 2026-10-15 |
| Applied | **Already present live** — verified 2026-10-18 and 2026-10-28; historical handover must not be rerun |
| Depends on | 0001–0040 (reports, stamp/audit helpers, optimized RLS, realtime, role split) |
| SHA-256 | `22518834cb45e34b1f47f2c569ceec113d447457d9c8c87203576f7159d4919d` |
| Handover | [Complete SQL Editor script](0041_daily_report_photos.apply.sql) |
| Reversible | Additive; rollback would delete evidence, so export it first and obtain owner approval |

## Purpose and objects

Daily reports previously had no evidence photos. This migration adds `daily_report_photos`, its indexes, three triggers (prepare/stamp/audit), `prepare_daily_report_photo()`, `daily_photo_in_use(text)`, a private 8 MB JPEG/PNG/WebP `daily-photos` bucket and storage/RLS policies. It also publishes daily_report_photos and pin_checklist_items for live updates.

## Security

Only the report's author can insert into a draft (and must pass can_report_on_project). A locked parent report serializes photo inserts and submission; maximum 10 rows, including multi-row inserts. Folder must be exactly project UUID / report UUID / filename. The DB overwrites project and uploader. Browser grants exclude computed stamps and identity/timestamps; no update grant. Signed-in readers must see the project and parent report; draft photos therefore remain private. Own-photo deletion is allowed only while the report is draft. Direct submitted-photo deletion fails even as database owner; nested parent deletion can cascade as specified. Reopening uses the existing Engineer RPC.

Storage upload must target the author's draft folder. Readers are the uploader or readers of the corresponding photo row. Delete requires uploader ownership and no referencing row; the definer helper checks hidden rows too. All trigger-only functions are noncallable by API roles. Existing auth/RLS is not weakened.

## Apply

Confirm migrations 0001–0040 are applied and take your normal backup. Paste the **entire** `.apply.sql` file into BuildTrack's SQL Editor. It contains `BEGIN`, the exact migration body, tracking table compatibility setup, the tracking insert, `COMMIT`, and ends with `NOTIFY pgrst, 'reload schema';`. Do not run both the migration and the apply script. If any object/version already exists, stop and inspect partial deployment instead of ignoring errors. Do not use `db:apply` for this owner handoff.

The tracking insert is:

```sql
insert into supabase_migrations.schema_migrations (version, name, checksum)
values ('0041', 'daily_report_photos', '22518834cb45e34b1f47f2c569ceec113d447457d9c8c87203576f7159d4919d');
```

## Verify after owner application

```sql
select version, name, checksum from supabase_migrations.schema_migrations where version = '0041';
select column_name from information_schema.columns where table_schema = 'public' and table_name = 'daily_report_photos';
select policyname from pg_policies where schemaname = 'public' and tablename = 'daily_report_photos';
select id, public, file_size_limit, allowed_mime_types from storage.buckets where id = 'daily-photos';
select tablename from pg_publication_tables where pubname = 'supabase_realtime'
  and tablename in ('daily_report_photos','pin_checklist_items');
select has_function_privilege('authenticated','public.prepare_daily_report_photo()','execute'); -- false
```

Local tests cover author insert; other Foreman, Engineer, Client, outsider rejection; draft privacy; submitted viewing; upload/delete locks; reopen; limit; invalid folders/GPS; protected columns; referenced storage deletion; whole-draft cascade; bucket/function privileges; realtime publication. Browser follow-up: first photo saves a draft, 10 photos cap, submit/read on Engineer and Client, reopen, tab URL refresh, dashboard scope and live count updates. No live changes were made by the agent.

## Rollback and operational limits

Roll back the UI first. Preserve all daily photo rows and files before considering schema removal. Owner-reviewed rollback would remove the three `daily photos:*` storage policies, remove daily_report_photos and pin_checklist_items from the publication, drop daily_report_photos (including its triggers/indexes), then its two helper functions. Do not delete the bucket until evidence is safely exported and unused objects are cleaned through the Storage API. Do not erase the migration tracking row as a routine rollback; follow the project's migration repair process.

Signed URLs already issued can live until expiry. Offline photo queuing is not added. The frontend cleans unused files after failed inserts or row/draft deletion; interrupted cleanups and backend cascades can leave orphan files. Test harness is PGlite, not live Storage/Realtime or a concurrent multi-connection Postgres test.
