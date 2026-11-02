-- Delete protection and Super Admin-only permanent deletion (additive: nothing is moved, rewritten or deleted by this file).
--   A. Work, QA and attendance records can no longer be erased by a side effect:
--        * a pin with inspections, defects, site issues, client reports or QA attempts cannot be deleted by anybody signed in (those records would be
--          detached or cascade-deleted); a pin with recorded progress (status, comments, photos, ticks, linked daily reports) only by a Super Admin;
--        * a checklist item that was ticked, remarked, reviewed or photographed only by a Super Admin;
--        * QA evidence photos cannot be removed once the inspection is concluded or the defect is sent for verification / closed;
--        * deleting a USER ACCOUNT can no longer cascade into that person's daily reports, client reports and questions (they now block the deletion;
--          privacy erasure anonymises the account and is unaffected).
--   B. Direct DELETE grants that anon never needed are revoked (no policy ever allowed anon to delete).
--   C. Permanent deletion of a project that is in the recycle bin: Super Admin with the authenticator, after 30 days in the bin, only if it holds NO real
--      records (no evidence pins, pins with work, inspections, defects, site issues, client reports, questions, daily reports, photos, attendance). The Edge
--      Function `purge-project` calls these functions and also removes the project's plan files from storage.
-- Verification, the SQL fallback and what was deliberately left out: docs/audits/sql/20261101190000_delete_protection_and_purge.md.

-- ---------------------------------------------------------------- A. records that must not be erased by a side effect
create or replace function public.pin_has_records(p_pin uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.qa_inspections where pin_id = p_pin)
      or exists (select 1 from public.qa_defects where pin_id = p_pin)
      or exists (select 1 from public.qa_work_attempts where pin_id = p_pin)
      or exists (select 1 from public.pin_qa_submissions where pin_id = p_pin)
      or exists (select 1 from public.site_issue_reports where pin_id = p_pin)
      or exists (select 1 from public.client_snags where pin_id = p_pin)
      or exists (select 1 from public.project_questions where pin_id = p_pin);
$$;
revoke execute on function public.pin_has_records(uuid) from public, anon, authenticated;

create or replace function public.pin_has_work(p_pin uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.pins where id = p_pin and status <> 'not_started')
      or exists (select 1 from public.pin_events where pin_id = p_pin and kind in ('status', 'photo', 'photo_removed', 'checklist', 'comment'))
      or exists (select 1 from public.pin_photos where pin_id = p_pin)
      or exists (select 1 from public.pin_checklist_items where pin_id = p_pin and (done or remark is not null or coalesce(review_status, 'not_submitted') <> 'not_submitted'))
      or exists (select 1 from public.daily_reports where linked_work @> jsonb_build_array(jsonb_build_object('pin_id', p_pin)));
$$;
revoke execute on function public.pin_has_work(uuid) from public, anon, authenticated;

-- The backend (no signed-in user: devices, jobs, the purge function, the SQL editor) is never restricted by these three guards.
create or replace function public.guard_pin_work_delete()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then return old; end if;
  if public.pin_has_records(old.id) then
    raise exception 'This pin has inspection, defect, site issue or client records. They stay attached to it, so it cannot be deleted' using errcode = '42501', hint = 'records_locked';
  end if;
  if public.pin_has_work(old.id) and not public.is_super_admin() then
    raise exception 'This pin has recorded work (progress, comments, photos or checklist ticks). Only a Super Admin can delete it' using errcode = '42501', hint = 'work_locked';
  end if;
  return old;
end;
$$;
revoke execute on function public.guard_pin_work_delete() from public, anon, authenticated;
drop trigger if exists pins_work_lock on public.pins;
create trigger pins_work_lock before delete on public.pins for each row execute function public.guard_pin_work_delete();

create or replace function public.guard_checklist_work_delete()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then return old; end if;
  if (old.done or old.remark is not null or coalesce(old.review_status, 'not_submitted') <> 'not_submitted' or exists (select 1 from public.pin_photos where checklist_item_id = old.id))
     and not public.is_super_admin() then
    raise exception 'This checklist item has recorded work (ticked, remarked, reviewed or photographed). Only a Super Admin can delete it' using errcode = '42501', hint = 'work_locked';
  end if;
  return old;
end;
$$;
revoke execute on function public.guard_checklist_work_delete() from public, anon, authenticated;
drop trigger if exists pin_checklist_items_work_lock on public.pin_checklist_items;
create trigger pin_checklist_items_work_lock before delete on public.pin_checklist_items for each row execute function public.guard_checklist_work_delete();

create or replace function public.guard_qa_photo_delete()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_inspection text; v_defect text;
begin
  if auth.uid() is null then return old; end if;
  select i.status into v_inspection from public.qa_inspections i
    where i.id = coalesce(old.inspection_id, (select it.inspection_id from public.qa_inspection_items it where it.id = old.item_id));
  select d.status into v_defect from public.qa_defects d where d.id = old.defect_id;
  if v_inspection in ('passed', 'conditional', 'failed', 'cancelled') or v_defect in ('for_verification', 'closed') then
    raise exception 'This photo is inspection or defect evidence and cannot be removed once the inspection is concluded or the defect is sent for verification' using errcode = '42501', hint = 'evidence_locked';
  end if;
  return old;
end;
$$;
revoke execute on function public.guard_qa_photo_delete() from public, anon, authenticated;
drop trigger if exists qa_photos_evidence_lock on public.qa_photos;
create trigger qa_photos_evidence_lock before delete on public.qa_photos for each row execute function public.guard_qa_photo_delete();

-- Deleting an account must not take that person's work with it: the account is not deletable while it authored these records (privacy erasure anonymises instead).
alter table public.daily_reports drop constraint daily_reports_author_id_fkey;
alter table public.daily_reports add constraint daily_reports_author_id_fkey foreign key (author_id) references auth.users (id) on delete restrict;
alter table public.client_snags drop constraint client_snags_author_id_fkey;
alter table public.client_snags add constraint client_snags_author_id_fkey foreign key (author_id) references auth.users (id) on delete restrict;
alter table public.project_questions drop constraint project_questions_author_id_fkey;
alter table public.project_questions add constraint project_questions_author_id_fkey foreign key (author_id) references auth.users (id) on delete restrict;

-- ---------------------------------------------------------------- B. grants nobody needs
revoke delete on public.blueprint_annotations, public.blueprint_revisions, public.blueprints, public.pin_checklist_items, public.pin_events, public.pin_photos, public.pins,
  public.project_blueprint_access, public.project_members, public.projects from anon;

-- ---------------------------------------------------------------- C. what is inside a project (replaces the version of 20261101180000; same keys plus the protected ones)
create or replace function public.project_contents(p_project uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'plans', (select count(*) from public.blueprints where project_id = p_project),
    'pins', (select count(*) from public.pins where project_id = p_project),
    'pins_with_work', (select count(*) from public.pins where project_id = p_project and public.pin_has_work(id)),
    'evidence_pins', (select count(*) from public.pins where project_id = p_project and (status in ('for_review', 'verified') or verified_at is not null)),
    'team', (select count(*) from public.project_members where project_id = p_project),
    'daily_reports', (select count(*) from public.daily_reports where project_id = p_project),
    'inspections', (select count(*) from public.qa_inspections where project_id = p_project),
    'defects', (select count(*) from public.qa_defects where project_id = p_project),
    'site_issues', (select count(*) from public.site_issue_reports where project_id = p_project),
    'client_reports', (select count(*) from public.client_snags where project_id = p_project),
    'questions', (select count(*) from public.project_questions where project_id = p_project),
    'photos', (select count(*) from public.pin_photos where project_id = p_project) + (select count(*) from public.daily_report_photos where project_id = p_project)
            + (select count(*) from public.qa_photos where project_id = p_project) + (select count(*) from public.snag_photos where project_id = p_project)
            + (select count(*) from public.site_issue_photos where project_id = p_project),
    'devices', (select count(*) from public.attendance_devices where project_id = p_project and active),
    'scans', (select count(*) from public.biometric_attendance_events where project_id = p_project),
    'attendance_workers', (select count(*) from public.attendance_workers where project_id = p_project),
    'devices_total', (select count(*) from public.attendance_devices where project_id = p_project));
$$;
revoke execute on function public.project_contents(uuid) from public, anon, authenticated;

-- Can this removed project be deleted forever? Internal; the answer is re-checked by purge_project_rows. 30 days in the bin is the minimum.
create or replace function public.project_purge_check(p_project uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v public.projects; c jsonb; v_reasons text[] := array[]::text[]; v_days integer; v_min constant integer := 30;
  r record;
begin
  select * into v from public.projects where id = p_project;
  if v.id is null then return jsonb_build_object('ok', false, 'reasons', jsonb_build_array('Project not found'), 'min_days', v_min); end if;
  c := public.project_contents(p_project);
  if v.deleted_at is null then
    v_reasons := v_reasons || 'It is not in the recycle bin. Archive it and move it to the recycle bin first'::text;
  else
    v_days := floor(extract(epoch from (now() - v.deleted_at)) / 86400)::integer;
    if v_days < v_min then v_reasons := v_reasons || format('It must stay in the recycle bin for at least %s days (%s more)', v_min, v_min - v_days); end if;
  end if;
  for r in select * from (values
    ('evidence_pins', 'pin(s) were sent for review or verified (evidence)'), ('pins_with_work', 'pin(s) have recorded work'),
    ('inspections', 'inspection(s)'), ('defects', 'defect report(s)'), ('site_issues', 'site issue(s)'), ('client_reports', 'client report(s)'),
    ('questions', 'client question(s)'), ('daily_reports', 'daily report(s)'), ('photos', 'photo(s)'), ('scans', 'biometric scan(s)'),
    ('attendance_workers', 'registered attendance worker(s)'), ('devices_total', 'attendance device(s)')) as t(k, label) loop
    if coalesce((c ->> r.k)::integer, 0) > 0 then v_reasons := v_reasons || ((c ->> r.k) || ' ' || r.label); end if;
  end loop;
  return jsonb_build_object('ok', cardinality(v_reasons) = 0, 'reasons', to_jsonb(v_reasons), 'code', v.code, 'name', v.name, 'removed_at', v.deleted_at,
    'removed_by', case when v.deleted_by is null then null else public.display_name(v.deleted_by) end, 'removal_reason', v.deleted_reason,
    'days_in_bin', v_days, 'min_days', v_min, 'contents', c);
end;
$$;
revoke execute on function public.project_purge_check(uuid) from public, anon, authenticated;
grant execute on function public.project_purge_check(uuid) to service_role;

-- Super Admin's preview for the screen (what would block it, how long it must still wait). Changes nothing.
create or replace function public.preview_project_purge(p_project uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_super_admin() then raise exception 'Only a Super Admin can permanently delete a project' using errcode = '42501'; end if;
  return public.project_purge_check(p_project);
end;
$$;
revoke execute on function public.preview_project_purge(uuid) from public, anon;
grant execute on function public.preview_project_purge(uuid) to authenticated;

-- The deletion itself: service role only (the Edge Function `purge-project`, which has already checked that the caller is a Super Admin with the authenticator
-- and removes the plan files). It re-checks everything, then deletes the project; the audit log keeps who, when, why and what it held.
create or replace function public.purge_project_rows(p_project uuid, p_actor uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v public.projects; v_check jsonb;
begin
  if not exists (select 1 from public.profiles where id = p_actor and role = 'super_admin' and status = 'active') then
    raise exception 'Only a Super Admin can permanently delete a project' using errcode = '42501';
  end if;
  select * into v from public.projects where id = p_project for update;
  if v.id is null then raise exception 'Project not found'; end if;
  v_check := public.project_purge_check(p_project);
  if not (v_check ->> 'ok')::boolean then
    raise exception 'This project cannot be deleted forever: %', (select string_agg(x, '; ') from jsonb_array_elements_text(v_check -> 'reasons') x) using errcode = '42501';
  end if;
  insert into public.audit_log (actor_id, target_id, action, details)
  values (p_actor, null, 'project.purged', jsonb_build_object('project_id', p_project, 'code', v.code, 'name', v.name, 'removed_at', v.deleted_at,
    'removed_by', v_check -> 'removed_by', 'removal_reason', v.deleted_reason, 'days_in_bin', v_check -> 'days_in_bin', 'contents', v_check -> 'contents'));
  begin
    delete from public.projects where id = p_project;
  exception when foreign_key_violation then
    raise exception 'This project still has attendance or other protected records, so it cannot be deleted forever' using errcode = '42501';
  end;
  return jsonb_build_object('purged', true, 'code', v.code, 'project_id', p_project);
end;
$$;
revoke execute on function public.purge_project_rows(uuid, uuid) from public, anon, authenticated;
grant execute on function public.purge_project_rows(uuid, uuid) to service_role;

-- ---------------------------------------------------------------- Rollback notes (not executed)
--   drop function public.purge_project_rows(uuid, uuid), public.preview_project_purge(uuid), public.project_purge_check(uuid), public.pin_has_work(uuid), public.pin_has_records(uuid),
--     public.guard_pin_work_delete(), public.guard_checklist_work_delete(), public.guard_qa_photo_delete();  (drop the three triggers first:
--     pins_work_lock on pins, pin_checklist_items_work_lock on pin_checklist_items, qa_photos_evidence_lock on qa_photos)
--   Put project_contents back to the version in 20261101180000_project_recycle_bin.sql.
--   The three author_id foreign keys can be returned to ON DELETE CASCADE (not recommended: it lets an account deletion erase reports).
--   grant delete on the revoked tables back to anon if ever needed (no policy ever allowed anon to delete).
