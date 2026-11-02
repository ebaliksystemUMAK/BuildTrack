-- Super Admin removal of three kinds of records, reversibly (additive: nothing is moved, rewritten or deleted by this file).
--   daily reports (any status), site issue reports and client problem reports can be REMOVED by a Super Admin with the authenticator, with a reason and a typed
--   confirmation. A removed record is hidden (not deleted) from every list and screen, with its photos and history; it can be restored. Every removal and restore
--   is audited. Inspections, defect reports, attendance records and the audit log are NOT included: pin verification and completion depend on the first two,
--   attendance is biometric evidence, and the audit log is the proof of who removed what.
-- Design and limits: docs/audits/2026-11-01-record-removal.md. Verification and the SQL fallback: docs/audits/sql/20261101200000_record_removal.md.

-- ---------------------------------------------------------------- columns
alter table public.daily_reports add column if not exists removed_at timestamptz;
alter table public.daily_reports add column if not exists removed_by uuid references auth.users (id) on delete set null;
alter table public.daily_reports add column if not exists removed_reason text;
alter table public.site_issue_reports add column if not exists removed_at timestamptz;
alter table public.site_issue_reports add column if not exists removed_by uuid references auth.users (id) on delete set null;
alter table public.site_issue_reports add column if not exists removed_reason text;
alter table public.client_snags add column if not exists removed_at timestamptz;
alter table public.client_snags add column if not exists removed_by uuid references auth.users (id) on delete set null;
alter table public.client_snags add column if not exists removed_reason text;
do $$
declare t text;
begin
  foreach t in array array['daily_reports', 'site_issue_reports', 'client_snags'] loop
    if not exists (select 1 from pg_constraint where conrelid = format('public.%I', t)::regclass and conname = t || '_removed_reason_check') then
      execute format('alter table public.%I add constraint %I check (removed_reason is null or (removed_at is not null and char_length(removed_reason) between 5 and 300))', t, t || '_removed_reason_check');
    end if;
    execute format('create index if not exists %I on public.%I (removed_at) where removed_at is not null', t || '_removed_idx', t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------- hiding
create or replace function public.record_is_removed(p_kind text, p_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select case p_kind
    when 'daily_report' then exists (select 1 from public.daily_reports where id = p_id and removed_at is not null)
    when 'site_issue' then exists (select 1 from public.site_issue_reports where id = p_id and removed_at is not null)
    when 'client_report' then exists (select 1 from public.client_snags where id = p_id and removed_at is not null)
    else false end;
$$;
revoke execute on function public.record_is_removed(text, uuid) from public, anon;
grant execute on function public.record_is_removed(text, uuid) to authenticated;

create or replace function public.site_photo_is_removed(p_photo uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.site_issue_photos ph join public.site_issue_reports r on r.id = ph.report_id where ph.id = p_photo and r.removed_at is not null);
$$;
revoke execute on function public.site_photo_is_removed(uuid) from public, anon;
grant execute on function public.site_photo_is_removed(uuid) to authenticated;

-- Restrictive policies only narrow what the existing ones allow. A Super Admin reads removed records through get_removed_records(), not through the tables.
drop policy if exists "removed reports are hidden" on public.daily_reports;
create policy "removed reports are hidden" on public.daily_reports as restrictive for select using (removed_at is null);
drop policy if exists "removed site issues are hidden" on public.site_issue_reports;
create policy "removed site issues are hidden" on public.site_issue_reports as restrictive for select using (removed_at is null);
drop policy if exists "removed client reports are hidden" on public.client_snags;
create policy "removed client reports are hidden" on public.client_snags as restrictive for select using (removed_at is null);
drop policy if exists "removed report photos are hidden" on public.daily_report_photos;
create policy "removed report photos are hidden" on public.daily_report_photos as restrictive for select using (not public.record_is_removed('daily_report', report_id));
drop policy if exists "removed report history is hidden" on public.daily_report_revisions;
create policy "removed report history is hidden" on public.daily_report_revisions as restrictive for select using (not public.record_is_removed('daily_report', report_id));
drop policy if exists "removed site issue photos are hidden" on public.site_issue_photos;
create policy "removed site issue photos are hidden" on public.site_issue_photos as restrictive for select using (not public.record_is_removed('site_issue', report_id));
drop policy if exists "removed site issue photo history is hidden" on public.site_issue_photo_revisions;
create policy "removed site issue photo history is hidden" on public.site_issue_photo_revisions as restrictive for select using (not public.site_photo_is_removed(photo_id));
drop policy if exists "removed client report photos are hidden" on public.snag_photos;
create policy "removed client report photos are hidden" on public.snag_photos as restrictive for select using (not public.record_is_removed('client_report', snag_id));

-- The removal columns change only through the functions below; the backend / SQL editor (no signed-in user) is not restricted.
create or replace function public.guard_record_removal()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or coalesce(current_setting('buildtrack.record_bin', true), '') = 'on' then return new; end if;
  if tg_op = 'INSERT' then
    if new.removed_at is not null or new.removed_by is not null or new.removed_reason is not null then
      raise exception 'A record cannot be created in the recycle bin' using errcode = '42501';
    end if;
  elsif (new.removed_at, new.removed_by, new.removed_reason) is distinct from (old.removed_at, old.removed_by, old.removed_reason) then
    raise exception 'Use Remove and Restore in Records to change this' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke execute on function public.guard_record_removal() from public, anon, authenticated;
drop trigger if exists daily_reports_guard_removal on public.daily_reports;
create trigger daily_reports_guard_removal before insert or update on public.daily_reports for each row execute function public.guard_record_removal();
drop trigger if exists site_issue_reports_guard_removal on public.site_issue_reports;
create trigger site_issue_reports_guard_removal before insert or update on public.site_issue_reports for each row execute function public.guard_record_removal();
drop trigger if exists client_snags_guard_removal on public.client_snags;
create trigger client_snags_guard_removal before insert or update on public.client_snags for each row execute function public.guard_record_removal();

-- ---------------------------------------------------------------- what a record is (internal)
create or replace function public.record_info(p_kind text, p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v jsonb;
begin
  if p_kind = 'daily_report' then
    select jsonb_build_object('found', true, 'kind', p_kind, 'id', r.id, 'project_id', r.project_id, 'label', to_char(r.report_date, 'YYYY-MM-DD'),
      'title', left(coalesce(nullif(btrim(r.work_done), ''), '(no work description)'), 100), 'status', r.status, 'removed', r.removed_at is not null, 'created_at', r.created_at)
      into v from public.daily_reports r where r.id = p_id;
  elsif p_kind = 'site_issue' then
    select jsonb_build_object('found', true, 'kind', p_kind, 'id', r.id, 'project_id', r.project_id, 'label', upper(left(r.id::text, 8)),
      'title', left(btrim(r.description), 100), 'status', r.severity, 'removed', r.removed_at is not null, 'created_at', r.created_at)
      into v from public.site_issue_reports r where r.id = p_id;
  elsif p_kind = 'client_report' then
    select jsonb_build_object('found', true, 'kind', p_kind, 'id', r.id, 'project_id', r.project_id, 'label', 'SR-' || lpad(r.number::text, 4, '0'),
      'title', left(btrim(r.title), 100), 'status', r.status, 'removed', r.removed_at is not null, 'created_at', r.created_at)
      into v from public.client_snags r where r.id = p_id;
  else
    raise exception 'Unknown record kind';
  end if;
  return coalesce(v, jsonb_build_object('found', false));
end;
$$;
revoke execute on function public.record_info(text, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- the screen's functions (Super Admin with the authenticator)
create or replace function public.search_removable_records(p_kind text, p_query text default '')
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_q text := '%' || lower(btrim(coalesce(p_query, ''))) || '%'; v jsonb;
begin
  if not public.is_super_admin() then raise exception 'Only a Super Admin can remove records' using errcode = '42501'; end if;
  if p_kind not in ('daily_report', 'site_issue', 'client_report') then raise exception 'Unknown record kind'; end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc), '[]'::jsonb) into v from (
    select s.id::text as id, s.label, s.title, s.status, s.created_at, pr.code as project_code, pr.name as project_name
    from (
      select id, project_id, created_at, to_char(report_date, 'YYYY-MM-DD') as label, left(coalesce(nullif(btrim(work_done), ''), '(no work description)'), 100) as title, status
        from public.daily_reports where p_kind = 'daily_report' and removed_at is null
      union all select id, project_id, created_at, upper(left(id::text, 8)), left(btrim(description), 100), severity
        from public.site_issue_reports where p_kind = 'site_issue' and removed_at is null
      union all select id, project_id, created_at, 'SR-' || lpad(number::text, 4, '0'), left(btrim(title), 100), status
        from public.client_snags where p_kind = 'client_report' and removed_at is null
    ) s
    join public.projects pr on pr.id = s.project_id and pr.deleted_at is null
    where lower(s.label || ' ' || s.title || ' ' || pr.code || ' ' || pr.name) like v_q
    order by s.created_at desc limit 50) x;
  return v;
end;
$$;
revoke execute on function public.search_removable_records(text, text) from public, anon;
grant execute on function public.search_removable_records(text, text) to authenticated;

create or replace function public.preview_record_removal(p_kind text, p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v jsonb; p public.projects;
begin
  if not public.is_super_admin() then raise exception 'Only a Super Admin can remove records' using errcode = '42501'; end if;
  v := public.record_info(p_kind, p_id);
  if not (v ->> 'found')::boolean then raise exception 'Record not found'; end if;
  select * into p from public.projects where id = (v ->> 'project_id')::uuid;
  return v || jsonb_build_object('project_code', p.code, 'project_name', p.name, 'project_removed', p.deleted_at is not null, 'confirm_phrase', 'REMOVE ' || (v ->> 'label'));
end;
$$;
revoke execute on function public.preview_record_removal(text, uuid) from public, anon;
grant execute on function public.preview_record_removal(text, uuid) to authenticated;

create or replace function public.remove_record(p_kind text, p_id uuid, p_reason text, p_confirm text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v jsonb; v_reason text := btrim(regexp_replace(coalesce(p_reason, ''), '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]', '', 'g'));
begin
  if not public.is_super_admin() then raise exception 'Only a Super Admin can remove records' using errcode = '42501'; end if;
  v := public.record_info(p_kind, p_id);
  if not (v ->> 'found')::boolean then raise exception 'Record not found'; end if;
  if (v ->> 'removed')::boolean then raise exception 'This record is already removed'; end if;
  if public.project_is_removed((v ->> 'project_id')::uuid) then raise exception 'Its project is in the recycle bin. Restore the project first'; end if;
  if char_length(v_reason) < 5 or char_length(v_reason) > 300 then raise exception 'Give a reason of 5 to 300 characters'; end if;
  if p_confirm is distinct from 'REMOVE ' || (v ->> 'label') then raise exception 'Type the confirmation exactly: REMOVE %', v ->> 'label'; end if;
  perform set_config('buildtrack.record_bin', 'on', true);
  if p_kind = 'daily_report' then update public.daily_reports set removed_at = now(), removed_by = auth.uid(), removed_reason = v_reason where id = p_id;
  elsif p_kind = 'site_issue' then update public.site_issue_reports set removed_at = now(), removed_by = auth.uid(), removed_reason = v_reason where id = p_id;
  else update public.client_snags set removed_at = now(), removed_by = auth.uid(), removed_reason = v_reason where id = p_id; end if;
  perform set_config('buildtrack.record_bin', '', true);
  insert into public.audit_log (actor_id, target_id, action, details)
  values (auth.uid(), null, 'record.removed', jsonb_build_object('kind', p_kind, 'record_id', p_id, 'label', v ->> 'label', 'title', v ->> 'title', 'status', v ->> 'status', 'project_id', v ->> 'project_id', 'reason', v_reason));
  return jsonb_build_object('removed', true, 'label', v ->> 'label');
end;
$$;
revoke execute on function public.remove_record(text, uuid, text, text) from public, anon;
grant execute on function public.remove_record(text, uuid, text, text) to authenticated;

create or replace function public.restore_record(p_kind text, p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v jsonb;
begin
  if not public.is_super_admin() then raise exception 'Only a Super Admin can remove records' using errcode = '42501'; end if;
  v := public.record_info(p_kind, p_id);
  if not (v ->> 'found')::boolean then raise exception 'Record not found'; end if;
  if not (v ->> 'removed')::boolean then raise exception 'This record is not removed'; end if;
  if public.project_is_removed((v ->> 'project_id')::uuid) then raise exception 'Its project is in the recycle bin. Restore the project first'; end if;
  perform set_config('buildtrack.record_bin', 'on', true);
  if p_kind = 'daily_report' then update public.daily_reports set removed_at = null, removed_by = null, removed_reason = null where id = p_id;
  elsif p_kind = 'site_issue' then update public.site_issue_reports set removed_at = null, removed_by = null, removed_reason = null where id = p_id;
  else update public.client_snags set removed_at = null, removed_by = null, removed_reason = null where id = p_id; end if;
  perform set_config('buildtrack.record_bin', '', true);
  insert into public.audit_log (actor_id, target_id, action, details)
  values (auth.uid(), null, 'record.restored', jsonb_build_object('kind', p_kind, 'record_id', p_id, 'label', v ->> 'label', 'title', v ->> 'title', 'project_id', v ->> 'project_id'));
  return jsonb_build_object('restored', true, 'label', v ->> 'label');
end;
$$;
revoke execute on function public.restore_record(text, uuid) from public, anon;
grant execute on function public.restore_record(text, uuid) to authenticated;

create or replace function public.get_removed_records()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_super_admin() then raise exception 'Only a Super Admin can remove records' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(row_to_json(x)::jsonb order by x.removed_at desc) from (
      select u.kind, u.id::text as id, public.record_info(u.kind, u.id) ->> 'label' as label, public.record_info(u.kind, u.id) ->> 'title' as title,
             pr.code as project_code, pr.name as project_name, u.removed_at, case when u.removed_by is null then null else public.display_name(u.removed_by) end as removed_by, u.removed_reason as reason
      from (select 'daily_report' as kind, id, project_id, removed_at, removed_by, removed_reason from public.daily_reports where removed_at is not null
            union all select 'site_issue', id, project_id, removed_at, removed_by, removed_reason from public.site_issue_reports where removed_at is not null
            union all select 'client_report', id, project_id, removed_at, removed_by, removed_reason from public.client_snags where removed_at is not null) u
      join public.projects pr on pr.id = u.project_id
      order by u.removed_at desc limit 200) x), '[]'::jsonb);
end;
$$;
revoke execute on function public.get_removed_records() from public, anon;
grant execute on function public.get_removed_records() to authenticated;

-- ---------------------------------------------------------------- Rollback notes (not executed)
--   Restore every removed record first (or as the owner: update the three tables set removed_at = null, removed_by = null, removed_reason = null where removed_at is not null).
--   drop the three triggers *_guard_removal, the eight policies named "removed ... are hidden", then
--   drop function public.get_removed_records(), public.restore_record(text, uuid), public.remove_record(text, uuid, text, text), public.preview_record_removal(text, uuid),
--     public.search_removable_records(text, text), public.record_info(text, uuid), public.guard_record_removal(), public.site_photo_is_removed(uuid), public.record_is_removed(text, uuid);
--   alter table public.daily_reports / site_issue_reports / client_snags drop column removed_reason, drop column removed_by, drop column removed_at;
