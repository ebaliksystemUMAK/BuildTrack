-- Project recycle bin (additive; no record is moved, rewritten or deleted by this file).
--   * A removed project keeps every row, file and relationship it has. It is only HIDDEN: the few functions that decide project access say "no" for it, so every
--     table that reads through them (plans, pins, evidence, QA, reports, attendance ...) disappears from ordinary lists at once, without touching those tables.
--   * Removing needs an ARCHIVED project, a written reason and the typed project code. Restoring puts the project back as ARCHIVED (read-only) so nothing becomes
--     editable by surprise, and handles a code that another project has taken in the meantime.
--   * Direct hard deletes of a project by a signed-in account are refused (the old Delete button cascaded into reports, inspections and defects). Permanent
--     deletion and automatic expiry are NOT built: the owner decides that separately.
--   * Biometric devices and other backend writes keep working for a removed project (scans are evidence); they reappear when the project is restored.
-- Design, scope and what was left out on purpose: docs/audits/2026-11-01-project-recycle-bin.md. Verification and the SQL fallback: docs/audits/sql/20261101180000_project_recycle_bin.md.

-- ---------------------------------------------------------------- columns
alter table public.projects add column if not exists deleted_at timestamptz;
alter table public.projects add column if not exists deleted_by uuid references auth.users (id) on delete set null;
alter table public.projects add column if not exists deleted_reason text;
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.projects'::regclass and conname = 'projects_deleted_reason_check') then
    alter table public.projects add constraint projects_deleted_reason_check check (deleted_reason is null or (deleted_at is not null and char_length(deleted_reason) between 5 and 300));
  end if;
end;
$$;
create index if not exists projects_removed_idx on public.projects (deleted_at) where deleted_at is not null;

create or replace function public.project_is_removed(pid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.projects where id = pid and deleted_at is not null);
$$;
revoke execute on function public.project_is_removed(uuid) from public, anon;
grant execute on function public.project_is_removed(uuid) to authenticated;

-- ---------------------------------------------------------------- the access functions (the only change: a removed project answers "no")
create or replace function public.can_view_project(pid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select not exists (select 1 from public.projects x where x.id = pid and x.deleted_at is not null)
     and (public.has_permission('projects.manage')
      or public.has_permission('blueprints.manage')
      or public.is_project_member(pid)
      or public.is_project_manager(pid));
$$;

create or replace function public.viewable_project_ids()
returns setof uuid language sql stable security definer set search_path = '' as $$
  select p.id from public.projects p where p.deleted_at is null and public.can_view_project(p.id);
$$;

create or replace function public.is_project_member(pid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_active() and exists (
    select 1 from public.project_members where project_id = pid and user_id = auth.uid() )
    and not exists (select 1 from public.projects x where x.id = pid and x.deleted_at is not null);
$$;

create or replace function public.is_project_manager(pid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.project_managers pm join public.profiles p on p.id = pm.user_id
    where pm.project_id = pid and pm.user_id = auth.uid() and p.role = 'project_manager' and p.status = 'active')
    and not exists (select 1 from public.projects x where x.id = pid and x.deleted_at is not null);
$$;

create or replace function public.is_project_client(pid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.project_members where project_id = pid and user_id = auth.uid() and member_role = 'client')
    and not exists (select 1 from public.projects x where x.id = pid and x.deleted_at is not null);
$$;

create or replace function public.can_edit_blueprints(pid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.project_members m join public.profiles p on p.id = m.user_id
    where m.project_id = pid and m.user_id = auth.uid() and m.member_role = 'engineer' and p.role = 'engineer' and p.status = 'active')
    and not exists (select 1 from public.projects x where x.id = pid and x.deleted_at is not null);
$$;

create or replace function public.can_report_on_project(pid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.project_members m join public.profiles p on p.id = m.user_id
    where m.project_id = pid and m.user_id = auth.uid() and m.member_role in ('engineer', 'foreman') and p.role = m.member_role and p.status = 'active')
    and not exists (select 1 from public.projects x where x.id = pid and x.deleted_at is not null);
$$;

create or replace function public.can_work_on_pin(p_pin uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.pins pn
    where pn.id = p_pin and pn.assigned_to = auth.uid()
      and exists (
        select 1 from public.project_members m join public.profiles p on p.id = m.user_id
        where m.project_id = pn.project_id and m.user_id = auth.uid() and m.member_role = 'foreman'
          and p.role = 'foreman' and p.status = 'active')
      and not exists (select 1 from public.projects x where x.id = pn.project_id and x.deleted_at is not null));
$$;

create or replace function public.manages_open_project(pid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_project_manager(pid) and exists (select 1 from public.projects where id = pid and archived_at is null and deleted_at is null);
$$;

-- ---------------------------------------------------------------- hiding the rows that do not go through those functions
-- Restrictive policies are ANDed with the existing ones, so nothing is widened. Only a SELECT is restricted; the existing write rules still apply on top.
drop policy if exists "removed projects are hidden" on public.projects;
create policy "removed projects are hidden" on public.projects as restrictive for select using (deleted_at is null);
drop policy if exists "removed project memberships are hidden" on public.project_members;
create policy "removed project memberships are hidden" on public.project_members as restrictive for select using (not public.project_is_removed(project_id));
drop policy if exists "removed project visits are hidden" on public.site_visit_requests;
create policy "removed project visits are hidden" on public.site_visit_requests as restrictive for select using (not public.project_is_removed(project_id));
drop policy if exists "removed project concerns are hidden" on public.attendance_concerns;
create policy "removed project concerns are hidden" on public.attendance_concerns as restrictive for select using (not public.project_is_removed(project_id));
drop policy if exists "removed project notifications are hidden" on public.notifications;
create policy "removed project notifications are hidden" on public.notifications as restrictive for select using (project_id is null or not public.project_is_removed(project_id));

-- No new reminder or alert is created about a removed project (the reminder jobs and the pin triggers all end in this table).
create or replace function public.skip_removed_project_notification()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.project_id is not null and public.project_is_removed(new.project_id) then return null; end if;
  return new;
end;
$$;
revoke execute on function public.skip_removed_project_notification() from public, anon, authenticated;
drop trigger if exists notifications_skip_removed_project on public.notifications;
create trigger notifications_skip_removed_project before insert on public.notifications for each row execute function public.skip_removed_project_notification();

-- ---------------------------------------------------------------- guards on the projects table
-- The bin columns change only through the functions below (they set a transaction-local flag). The backend / SQL editor (no signed-in user) is not restricted.
create or replace function public.guard_project_bin()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or coalesce(current_setting('buildtrack.bin', true), '') = 'on' then return new; end if;
  if tg_op = 'INSERT' then
    if new.deleted_at is not null or new.deleted_by is not null or new.deleted_reason is not null then
      raise exception 'A project cannot be created in the recycle bin' using errcode = '42501';
    end if;
  elsif (new.deleted_at, new.deleted_by, new.deleted_reason) is distinct from (old.deleted_at, old.deleted_by, old.deleted_reason) then
    raise exception 'Use Remove project and Restore from the recycle bin to change this' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke execute on function public.guard_project_bin() from public, anon, authenticated;
drop trigger if exists projects_guard_bin on public.projects;
create trigger projects_guard_bin before insert or update on public.projects for each row execute function public.guard_project_bin();

-- A signed-in account can no longer hard-delete a project (that cascaded into daily reports, inspections, defects and site issues). The backend can.
create or replace function public.guard_project_hard_delete()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null then
    raise exception 'A project cannot be deleted directly. Archive it, then move it to the recycle bin' using errcode = '42501';
  end if;
  return old;
end;
$$;
revoke execute on function public.guard_project_hard_delete() from public, anon, authenticated;
drop trigger if exists projects_guard_hard_delete on public.projects;
create trigger projects_guard_hard_delete before delete on public.projects for each row execute function public.guard_project_hard_delete();

-- ---------------------------------------------------------------- what is inside a project (internal; counts only)
create or replace function public.project_contents(p_project uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'plans', (select count(*) from public.blueprints where project_id = p_project),
    'pins', (select count(*) from public.pins where project_id = p_project),
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
    'scans', (select count(*) from public.biometric_attendance_events where project_id = p_project));
$$;
revoke execute on function public.project_contents(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- the screens' functions (Admin with the Projects permission, or Super Admin, with the authenticator)
create or replace function public.preview_project_removal(p_project uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v public.projects;
begin
  if not public.has_permission('projects.manage') then raise exception 'Only an Admin with the Projects permission can manage the recycle bin' using errcode = '42501'; end if;
  select * into v from public.projects where id = p_project;
  if v.id is null then raise exception 'Project not found'; end if;
  return jsonb_build_object('id', v.id, 'code', v.code, 'name', v.name, 'archived', v.archived_at is not null, 'removed', v.deleted_at is not null, 'contents', public.project_contents(v.id));
end;
$$;
revoke execute on function public.preview_project_removal(uuid) from public, anon;
grant execute on function public.preview_project_removal(uuid) to authenticated;

create or replace function public.remove_project(p_project uuid, p_reason text, p_confirm text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v public.projects;
  v_reason text := btrim(regexp_replace(coalesce(p_reason, ''), '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]', '', 'g'));
  v_contents jsonb;
begin
  if not public.has_permission('projects.manage') then raise exception 'Only an Admin with the Projects permission can manage the recycle bin' using errcode = '42501'; end if;
  select * into v from public.projects where id = p_project for update;
  if v.id is null then raise exception 'Project not found'; end if;
  if v.deleted_at is not null then raise exception 'This project is already in the recycle bin'; end if;
  if v.archived_at is null then raise exception 'Archive the project first. Only an archived project can be moved to the recycle bin'; end if;
  if char_length(v_reason) < 5 or char_length(v_reason) > 300 then raise exception 'Give a reason of 5 to 300 characters'; end if;
  if p_confirm is distinct from v.code then raise exception 'Type the project code exactly to confirm'; end if;
  v_contents := public.project_contents(p_project);
  perform set_config('buildtrack.bin', 'on', true);
  update public.projects set deleted_at = now(), deleted_by = auth.uid(), deleted_reason = v_reason where id = p_project;
  perform set_config('buildtrack.bin', '', true);
  insert into public.audit_log (actor_id, target_id, action, details)
  values (auth.uid(), null, 'project.removed', jsonb_build_object('project_id', p_project, 'code', v.code, 'name', v.name, 'reason', v_reason, 'contents', v_contents));
  return jsonb_build_object('removed', true, 'code', v.code);
end;
$$;
revoke execute on function public.remove_project(uuid, text, text) from public, anon;
grant execute on function public.remove_project(uuid, text, text) to authenticated;

-- Restores a removed project as ARCHIVED (read-only). Its code stays reserved while it is in the bin (the code is unique), so a new code is optional; a code another
-- project already uses is refused. Nothing else about the project changes.
create or replace function public.restore_removed_project(p_project uuid, p_new_code text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v public.projects; v_code text; v_inactive integer; v_manager boolean;
begin
  if not public.has_permission('projects.manage') then raise exception 'Only an Admin with the Projects permission can manage the recycle bin' using errcode = '42501'; end if;
  select * into v from public.projects where id = p_project for update;
  if v.id is null then raise exception 'Project not found'; end if;
  if v.deleted_at is null then raise exception 'This project is not in the recycle bin'; end if;
  v_code := coalesce(nullif(upper(btrim(p_new_code)), ''), v.code);
  if v_code <> v.code and v_code !~ '^[A-Z0-9][A-Z0-9-]{1,29}$' then raise exception 'Use 2-30 characters: letters, numbers and dashes (for example VCB-024)'; end if;
  if exists (select 1 from public.projects where code = v_code and id <> p_project) then
    raise exception 'The project code % is now used by another project. Enter a new code to restore it', v_code using errcode = '23505';
  end if;
  perform set_config('buildtrack.bin', 'on', true);
  update public.projects set deleted_at = null, deleted_by = null, deleted_reason = null, code = v_code where id = p_project;
  perform set_config('buildtrack.bin', '', true);
  select count(*)::integer into v_inactive from public.project_members m join public.profiles p on p.id = m.user_id where m.project_id = p_project and (p.status <> 'active' or p.role::text <> m.member_role::text);
  select exists (select 1 from public.project_managers pm join public.profiles p on p.id = pm.user_id where pm.project_id = p_project and pm.designation = 'primary' and p.status = 'active' and p.role = 'project_manager') into v_manager;
  insert into public.audit_log (actor_id, target_id, action, details)
  values (auth.uid(), null, 'project.recovered', jsonb_build_object('project_id', p_project, 'code', v_code, 'previous_code', v.code, 'removed_at', v.deleted_at, 'removed_reason', v.deleted_reason, 'removed_by', v.deleted_by));
  return jsonb_build_object('restored', true, 'code', v_code, 'code_changed', v_code <> v.code, 'still_archived', v.archived_at is not null, 'inactive_members', v_inactive, 'has_primary_manager', v_manager);
end;
$$;
revoke execute on function public.restore_removed_project(uuid, text) from public, anon;
grant execute on function public.restore_removed_project(uuid, text) to authenticated;

create or replace function public.get_recycle_bin()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.has_permission('projects.manage') then raise exception 'Only an Admin with the Projects permission can manage the recycle bin' using errcode = '42501'; end if;
  return jsonb_build_object('projects', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', x.id, 'code', x.code, 'name', x.name, 'removed_at', x.deleted_at, 'removed_by', case when x.deleted_by is null then null else public.display_name(x.deleted_by) end,
      'reason', x.deleted_reason, 'archived_at', x.archived_at,
      'contents', public.project_contents(x.id)) order by x.deleted_at desc)
    from (select * from public.projects where deleted_at is not null order by deleted_at desc limit 200) x), '[]'::jsonb));
end;
$$;
revoke execute on function public.get_recycle_bin() from public, anon;
grant execute on function public.get_recycle_bin() to authenticated;

-- ---------------------------------------------------------------- Rollback notes (not executed)
--   Restore every removed project first (or: update public.projects set deleted_at = null, deleted_by = null, deleted_reason = null where deleted_at is not null; as the owner).
--   drop trigger projects_guard_hard_delete on public.projects; drop trigger projects_guard_bin on public.projects; drop trigger notifications_skip_removed_project on public.notifications;
--   drop policy "removed projects are hidden" on public.projects; drop policy "removed project memberships are hidden" on public.project_members;
--   drop policy "removed project visits are hidden" on public.site_visit_requests; drop policy "removed project concerns are hidden" on public.attendance_concerns;
--   drop policy "removed project notifications are hidden" on public.notifications;
--   Re-create the nine access functions without the removed-project test (their previous bodies are in 20261029100000_project_manager_workspace.sql and the earlier migrations).
--   drop function public.get_recycle_bin(), public.restore_removed_project(uuid, text), public.remove_project(uuid, text, text), public.preview_project_removal(uuid),
--     public.project_contents(uuid), public.guard_project_hard_delete(), public.guard_project_bin(), public.skip_removed_project_notification(), public.project_is_removed(uuid);
--   alter table public.projects drop column deleted_reason, drop column deleted_by, drop column deleted_at;
