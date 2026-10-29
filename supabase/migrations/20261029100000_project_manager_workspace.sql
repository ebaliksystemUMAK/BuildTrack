-- BuildTrack: Project Manager workspace (part 2 of 2; the project_manager_role migration added the role).
--   * project_managers: an Admin (projects.manage + MFA) assigns one primary and, when needed, one backup Project Manager per
--     project through assign_project_manager / remove_project_manager. Nobody else writes the table, so a Project Manager can
--     never assign themselves or change another Project Manager's access. A Project Manager may manage many projects.
--   * A Project Manager reads everything staff can read on their projects only (can_view_project / is_staff now include them)
--     and is never limited by blueprint type. Unassigned projects stay invisible, also through the API.
--   * On an assigned project that is not archived a Project Manager may: edit dates, location, client details, phase, status
--     and the Engineer / Foreman in charge (guard_project_manager_edit refuses every other column); add / remove active
--     Engineers, Foremen and Clients; set blueprint-type access; upload sheets and revisions and change a sheet's type;
--     reassign work items between Foremen (assign_work_item); export the project; read its audit log; flag attendance concerns.
--   * Technical inspection, verification and sign-off stay with Engineers (no QA write path was opened).
--   * Admins can archive / restore a project (set_project_archived). An archived project is read-only for its Project Managers.
--     Field roles keep today's behaviour.
--   * Notifications: assignment / replacement / removal and archive go to the Project Managers; serious late-work escalations
--     reach the project's Project Managers; attendance concerns reach Admins with biometrics.manage.
-- Details: docs/audits/2026-10-29-project-manager-role.md

-- ---------- 1. Archive flag ----------
alter table public.projects
  add column archived_at timestamptz,
  add column archived_by uuid references auth.users (id);

-- ---------- 2. Assignments ----------
create table public.project_managers (
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  designation text not null check (designation in ('primary', 'backup')),
  assigned_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (project_id, user_id),
  unique (project_id, designation)
);
create index project_managers_user_idx on public.project_managers (user_id);
create trigger project_managers_touch before update on public.project_managers
  for each row execute function public.touch_updated_at();

-- Only an active Project Manager account can hold a slot.
create function public.check_project_manager()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.profiles where id = new.user_id and status = 'active' and role = 'project_manager') then
    raise exception 'Only an active Project Manager account can manage a project';
  end if;
  return new;
end $$;
create trigger project_managers_check before insert or update on public.project_managers
  for each row execute function public.check_project_manager();

create function public.log_project_manager_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.audit_log (actor_id, target_id, action, details)
  values (auth.uid(), coalesce(new.user_id, old.user_id), 'project_managers.' || lower(tg_op),
    jsonb_build_object('project_id', coalesce(new.project_id, old.project_id), 'row', to_jsonb(coalesce(new, old)),
      'before', case when tg_op = 'UPDATE' then to_jsonb(old) end));
  return coalesce(new, old);
end $$;
create trigger project_managers_audit after insert or update or delete on public.project_managers
  for each row execute function public.log_project_manager_change();

-- ---------- 3. Helpers ----------
create function public.is_project_manager(pid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.project_managers pm join public.profiles p on p.id = pm.user_id
    where pm.project_id = pid and pm.user_id = auth.uid() and p.role = 'project_manager' and p.status = 'active');
$$;

-- Write paths of a Project Manager: their project, and only while it is not archived.
create function public.manages_open_project(pid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_project_manager(pid) and exists (select 1 from public.projects where id = pid and archived_at is null);
$$;

create function public.managed_project_ids()
returns setof uuid language sql stable security definer set search_path = '' as $$
  select pm.project_id from public.project_managers pm join public.profiles p on p.id = pm.user_id
  where pm.user_id = auth.uid() and p.role = 'project_manager' and p.status = 'active';
$$;

create or replace function public.can_view_project(pid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.has_permission('projects.manage')
      or public.has_permission('blueprints.manage')
      or public.is_project_member(pid)
      or public.is_project_manager(pid);
$$;

-- Staff reads (QA, site issues, attendance, evidence) combine this with can_view_project, so a Project Manager only gets them
-- on their own projects. No write path uses is_staff().
create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = auth.uid() and status = 'active'
    and role in ('engineer', 'foreman', 'project_manager', 'admin', 'super_admin'));
$$;

-- ---------- 4. Projects and team ----------
drop policy "view assigned or managed projects" on public.projects;
create policy "view assigned or managed projects" on public.projects
  for select to authenticated
  using (public.has_permission('projects.manage') or public.is_project_member(id) or public.is_project_manager(id));
create policy "project managers update their projects" on public.projects
  for update to authenticated
  using (public.is_project_manager(id)) with check (public.is_project_manager(id));

-- A Project Manager changes the day-to-day details only, and nothing on an archived project.
create function public.guard_project_manager_edit()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  allowed text[] := array['location', 'client_name', 'description', 'phase', 'status', 'start_date', 'end_date',
    'lead_engineer_id', 'lead_foreman_id', 'site_lat', 'site_lng', 'site_radius_m', 'updated_at'];
begin
  -- Backend, nested trigger updates (e.g. the lead cleared when a member leaves) and Admins with the Projects permission.
  if auth.uid() is null or pg_trigger_depth() > 1 or public.has_permission('projects.manage') then
    return new;
  end if;
  if old.archived_at is not null then
    raise exception 'This project is archived. Ask an Admin to restore it before changing it' using errcode = '42501';
  end if;
  if (to_jsonb(new) - allowed) is distinct from (to_jsonb(old) - allowed) then
    raise exception 'Project Managers can change the dates, location, client details, phase, status and the Engineer / Foreman in charge only'
      using errcode = '42501';
  end if;
  return new;
end $$;
create trigger projects_guard_manager_edit before update on public.projects
  for each row execute function public.guard_project_manager_edit();

drop policy "view own or managed memberships" on public.project_members;
create policy "view own or managed memberships" on public.project_members
  for select to authenticated
  using (public.has_permission('projects.manage') or user_id = auth.uid() or public.is_project_member(project_id)
    or public.is_project_manager(project_id));
-- check_project_member still limits the team to active Engineers, Foremen and Clients.
create policy "project managers add team members" on public.project_members
  for insert to authenticated with check (public.manages_open_project(project_id));
create policy "project managers remove team members" on public.project_members
  for delete to authenticated using (public.manages_open_project(project_id));

-- Admins choosing a Project Manager need to see Project Manager accounts (without the broad users.view permission).
drop policy "project managers view assignable profiles" on public.profiles;
create policy "project managers view assignable profiles" on public.profiles
  for select to authenticated
  using (
    public.has_permission('projects.manage')
    and status = 'active' and role in ('engineer', 'foreman', 'client', 'project_manager')
  );

-- Who a Project Manager (or an Admin) can add to a project: names and roles of active field accounts, no other profile data.
create function public.get_assignable_people(p_project uuid)
returns table (id uuid, full_name text, email text, role public.app_role, discipline text)
language sql stable security definer set search_path = '' as $$
  select p.id, p.full_name, p.email, p.role, p.discipline
  from public.profiles p
  where (public.has_permission('projects.manage') or public.is_project_manager(p_project))
    and p.status = 'active' and p.role in ('engineer', 'foreman', 'client')
  order by coalesce(p.full_name, p.email);
$$;

create or replace function public.get_project_team(pid uuid)
returns table (user_id uuid, full_name text, role public.app_role, is_lead boolean)
language sql stable security definer set search_path = '' as $$
  select pm.user_id,
         coalesce(pr.full_name, pr.email),
         pm.member_role,
         (pm.user_id = p.lead_engineer_id or pm.user_id = p.lead_foreman_id)
  from public.project_members pm
  join public.projects p on p.id = pm.project_id
  join public.profiles pr on pr.id = pm.user_id
  where pm.project_id = pid
    and (public.has_permission('projects.manage') or public.is_project_member(pid) or public.is_project_manager(pid))
  order by pm.member_role, 2;
$$;

-- The Project Managers of one project (anyone who can see the project), or of every project the caller manages / administers.
create function public.get_project_managers(p_project uuid default null)
returns table (project_id uuid, user_id uuid, full_name text, email text, designation text, active boolean, assigned_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select pm.project_id, pm.user_id, coalesce(p.full_name, p.email),
         case when public.is_staff() then p.email end,
         pm.designation, (p.status = 'active' and p.role = 'project_manager'), pm.created_at
  from public.project_managers pm
  join public.profiles p on p.id = pm.user_id
  where case when p_project is null
          then public.has_permission('projects.manage') or pm.project_id in (select public.managed_project_ids())
          else pm.project_id = p_project and public.can_view_project(p_project) end
  order by pm.project_id, pm.designation desc;
$$;

alter table public.project_managers enable row level security;
create policy "read project managers" on public.project_managers
  for select to authenticated
  using (user_id = (select auth.uid()) or (select public.has_permission('projects.manage'))
    or project_id in (select public.viewable_project_ids()));
revoke all on public.project_managers from anon;
revoke insert, update, delete, truncate on public.project_managers from authenticated;

-- Assign (or replace) the primary or backup Project Manager. Choosing the current backup as primary swaps the two.
create function public.assign_project_manager(p_project uuid, p_user uuid, p_designation text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_project public.projects;
  v_current text;
  v_holder uuid;
  v_label text := case p_designation when 'primary' then 'primary' else 'backup' end;
  v_result text;
begin
  if not public.has_permission('projects.manage') then
    raise exception 'Only an Admin with the Projects permission can assign Project Managers' using errcode = '42501';
  end if;
  if p_designation is null or p_designation not in ('primary', 'backup') then
    raise exception 'Choose primary or backup';
  end if;
  select * into v_project from public.projects where id = p_project for update;
  if v_project.id is null then
    raise exception 'Project not found';
  end if;
  if not exists (select 1 from public.profiles where id = p_user and status = 'active' and role = 'project_manager') then
    raise exception 'Choose an active Project Manager account';
  end if;
  select designation into v_current from public.project_managers where project_id = p_project and user_id = p_user;
  select user_id into v_holder from public.project_managers where project_id = p_project and designation = p_designation;
  if v_current = p_designation then
    return 'unchanged';
  end if;

  if v_holder is not null and v_current is not null then
    -- Swap: the person moves to the other slot.
    delete from public.project_managers where project_id = p_project and user_id in (p_user, v_holder);
    insert into public.project_managers (project_id, user_id, designation, assigned_by)
    values (p_project, p_user, p_designation, auth.uid()), (p_project, v_holder, v_current, auth.uid());
    perform public.notify_user(v_holder, 'project.manager_assigned', v_project.code || ': you are now the ' || v_current || ' Project Manager',
      v_project.name || ' • changed by an Admin.', '/pm/dashboard?project=' || p_project, p_project, p_project, null);
    v_result := 'swapped';
  else
    if v_holder is not null then
      delete from public.project_managers where project_id = p_project and user_id = v_holder;
      perform public.notify_user(v_holder, 'project.manager_removed', v_project.code || ': you no longer manage this project',
        v_project.name || ' • an Admin assigned another ' || v_label || ' Project Manager.', '/pm/projects', p_project, p_project, null);
    end if;
    if v_current is not null then
      update public.project_managers set designation = p_designation, assigned_by = auth.uid() where project_id = p_project and user_id = p_user;
    else
      insert into public.project_managers (project_id, user_id, designation, assigned_by) values (p_project, p_user, p_designation, auth.uid());
    end if;
    v_result := case when v_holder is not null then 'replaced' else 'assigned' end;
  end if;
  perform public.notify_user(p_user, 'project.manager_assigned', v_project.code || ': you are the ' || v_label || ' Project Manager',
    v_project.name || case when v_project.archived_at is not null then ' • archived, read-only.' else ' • open it from My projects.' end,
    '/pm/dashboard?project=' || p_project, p_project, p_project, null);
  return v_result;
end $$;

create function public.remove_project_manager(p_project uuid, p_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_code text;
begin
  if not public.has_permission('projects.manage') then
    raise exception 'Only an Admin with the Projects permission can remove Project Managers' using errcode = '42501';
  end if;
  delete from public.project_managers where project_id = p_project and user_id = p_user;
  if not found then
    raise exception 'That person does not manage this project';
  end if;
  select code into v_code from public.projects where id = p_project;
  perform public.notify_user(p_user, 'project.manager_removed', v_code || ': you no longer manage this project',
    'An Admin removed you as Project Manager.', '/pm/projects', p_project, p_project, null);
end $$;

-- A Project Manager account that changes to another role leaves its projects.
create function public.clear_manager_assignments()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.role = 'project_manager' and new.role is distinct from old.role then
    delete from public.project_managers where user_id = new.id;
  end if;
  return new;
end $$;
create trigger profiles_clear_manager_assignments after update of role on public.profiles
  for each row execute function public.clear_manager_assignments();

-- ---------- 5. Archive ----------
create function public.set_project_archived(p_project uuid, p_archived boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_project public.projects;
  r record;
begin
  if not public.has_permission('projects.manage') then
    raise exception 'Only an Admin with the Projects permission can archive projects' using errcode = '42501';
  end if;
  update public.projects
    set archived_at = case when p_archived then coalesce(archived_at, now()) end,
        archived_by = case when p_archived then coalesce(archived_by, auth.uid()) end
    where id = p_project
    returning * into v_project;
  if v_project.id is null then
    raise exception 'Project not found';
  end if;
  insert into public.audit_log (actor_id, action, details)
  values (auth.uid(), case when p_archived then 'project.archived' else 'project.restored' end,
    jsonb_build_object('project_id', p_project, 'code', v_project.code));
  for r in select user_id from public.project_managers where project_id = p_project loop
    perform public.notify_user(r.user_id, case when p_archived then 'project.archived' else 'project.restored' end,
      v_project.code || case when p_archived then ' was archived' else ' was restored' end,
      case when p_archived then 'The project is now read-only in your workspace.' else 'You can manage the project again.' end,
      '/pm/dashboard?project=' || p_project, p_project, p_project, null);
  end loop;
end $$;

-- ---------- 6. Blueprints, access and work ----------
create or replace function public.can_upload_blueprints(pid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.has_permission('blueprints.manage') or public.can_edit_blueprints(pid) or public.manages_open_project(pid);
$$;

create or replace function public.guard_blueprint_type()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    -- Older app versions upload without a type: file it like the backfill (the current app always sends one).
    if new.blueprint_type is null then
      new.blueprint_type := case when new.discipline = 'architectural' then 'architectural' else 'civil_structural' end;
    end if;
    if new.discipline is null then
      new.discipline := case new.blueprint_type when 'architectural' then 'architectural' when 'civil_structural' then 'civil_structural'
        else 'mep' end;
    end if;
  elsif new.blueprint_type is distinct from old.blueprint_type then
    if auth.uid() is not null and not (public.has_permission('blueprints.manage') or public.manages_open_project(new.project_id)) then
      raise exception 'Only an Admin with the Blueprints permission or the project''s Project Manager can change the blueprint type'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.set_blueprint_access(p_project uuid, p_user uuid, p_levels jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  k text;
  v text;
  n integer := 0;
begin
  if not (public.has_permission('projects.manage') or public.manages_open_project(p_project)) then
    raise exception 'Only an Admin with the Projects permission or the project''s Project Manager can change blueprint access'
      using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.project_members m join public.profiles p on p.id = m.user_id
    where m.project_id = p_project and m.user_id = p_user and m.member_role in ('engineer', 'foreman') and p.role = m.member_role) then
    raise exception 'Add this Engineer or Foreman to the project team first';
  end if;
  if p_levels is null or jsonb_typeof(p_levels) <> 'object' or p_levels = '{}'::jsonb then
    raise exception 'Choose at least one blueprint type';
  end if;
  for k, v in select e.key, e.value #>> '{}' from jsonb_each(p_levels) e loop
    if k not in ('architectural', 'civil_structural', 'electrical', 'mechanical', 'plumbing_sanitary') then
      raise exception 'Unknown blueprint type: %', k;
    end if;
    if v is null or v not in ('none', 'view', 'assigned') then
      raise exception 'Access must be No access, View only or Assigned work access';
    end if;
    if v = 'none' then
      delete from public.project_blueprint_access where project_id = p_project and user_id = p_user and blueprint_type = k;
    else
      insert into public.project_blueprint_access (project_id, user_id, blueprint_type, access_level, granted_by)
      values (p_project, p_user, k, v, auth.uid())
      on conflict (project_id, user_id, blueprint_type) do update
        set access_level = excluded.access_level, granted_by = excluded.granted_by, updated_at = now()
        where public.project_blueprint_access.access_level <> excluded.access_level;
    end if;
    n := n + 1;
  end loop;
  return n;
end;
$$;

create or replace function public.guard_pin_assignment()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  f public.profiles;
begin
  if tg_op = 'UPDATE' and new.assigned_to is not distinct from old.assigned_to then
    new.assigned_by := old.assigned_by;
    new.assigned_at := old.assigned_at;
    return new;
  end if;
  if tg_op = 'INSERT' and new.assigned_to is null then
    new.assigned_by := null;
    new.assigned_at := null;
    return new;
  end if;
  -- Allowed without an Engineer: the backend (no signed-in user), and the automatic unassignment when a Foreman leaves the
  -- project (an update issued by another trigger that only clears the assignee). Project Managers and Admins with the Projects
  -- permission reassign through assign_work_item.
  if me is not null and not (pg_trigger_depth() > 1 and new.assigned_to is null)
     and not (public.can_edit_blueprints(new.project_id) or public.manages_open_project(new.project_id)
       or public.has_permission('projects.manage')) then
    raise exception 'Only an Engineer assigned to this project (or its Project Manager) can assign or reassign its work';
  end if;
  if tg_op = 'UPDATE' and old.status = 'verified' then
    raise exception 'Verified work keeps the Foreman who did it; reopen the pin before reassigning it';
  end if;
  if new.assigned_to is not null then
    select * into f from public.profiles where id = new.assigned_to;
    if f.id is null or f.status <> 'active' or f.role is distinct from 'foreman' or not exists (
         select 1 from public.project_members
         where project_id = new.project_id and user_id = new.assigned_to and member_role = 'foreman') then
      raise exception 'A pin can only be assigned to an active Foreman on this project';
    end if;
  end if;
  new.assigned_by := me;
  new.assigned_at := now();
  return new;
end;
$$;

-- Work assignment for Project Managers (and Admins intervening). Same rules as the Engineer's assignment board: notes, locked
-- pins, work awaiting review and completed work keep their Foreman. The Foreman also needs Assigned work access to the sheet's type.
create function public.assign_work_item(p_pin uuid, p_foreman uuid, p_expected timestamptz default null)
returns public.pins language plpgsql security definer set search_path = '' as $$
declare
  pn public.pins;
begin
  select * into pn from public.pins where id = p_pin for update;
  if pn.id is null or not (public.manages_open_project(pn.project_id) or public.has_permission('projects.manage')) then
    raise exception 'Only the project''s Project Manager can reassign this work here' using errcode = '42501';
  end if;
  if pn.category = 'note' then
    raise exception 'Notes are not assignable work';
  end if;
  if p_expected is not null and pn.updated_at is distinct from p_expected then
    raise exception 'This work changed since you opened it. Review the current record before trying again.';
  end if;
  if pn.locked then
    raise exception 'This pin is locked on the plan. Ask the Engineer to unlock it before reassigning it.';
  end if;
  if pn.status in ('for_review', 'verified') then
    raise exception 'Work awaiting Engineer review or already completed keeps its Foreman.';
  end if;
  if pn.assigned_to is not distinct from p_foreman then
    return pn;
  end if;
  update public.pins set assigned_to = p_foreman where id = p_pin returning * into pn;
  return pn;
end $$;

-- ---------- 7. Export, audit log, activity ----------
create or replace function public.log_project_export(p_project uuid, p_with_files boolean, p_rows integer)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not (public.has_permission('projects.manage') or public.is_project_manager(p_project)) then
    raise exception 'Missing permission: projects.manage';
  end if;
  if not exists (select 1 from public.projects where id = p_project) then
    raise exception 'Project not found';
  end if;
  insert into public.audit_log (actor_id, action, details)
  values (auth.uid(), 'project.export', jsonb_build_object('project_id', p_project, 'with_files', coalesce(p_with_files, false), 'rows', greatest(coalesce(p_rows, 0), 0)));
end;
$$;

-- Which project an audit entry belongs to (rows written by the project / team / access triggers, exports, assignments).
create function public.audit_project_key(p_action text, p_details jsonb)
returns text language sql immutable set search_path = '' as $$
  select coalesce(p_details ->> 'project_id', p_details -> 'row' ->> 'project_id',
    case when p_action like 'projects.%' then p_details -> 'row' ->> 'id' end);
$$;
create index audit_log_project_key_idx on public.audit_log (public.audit_project_key(action, details));

-- Read-only history of one project for its Project Managers (and Admins).
create function public.get_project_audit_log(p_project uuid, p_search text default null, p_limit integer default 50, p_offset integer default 0)
returns table (id bigint, created_at timestamptz, actor_name text, actor_role public.app_role, action text, subject text, total bigint)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if p_project is null or not (public.is_project_manager(p_project) or public.has_permission('projects.manage') or public.has_permission('users.view')) then
    raise exception 'You cannot read the history of this project' using errcode = '42501';
  end if;
  return query
  with entries as (
    select a.id, a.created_at, coalesce(ap.full_name, ap.email, 'System') as actor_name, ap.role as actor_role, a.action,
           coalesce(
             case when a.action like 'projects.%' then nullif(concat_ws(' ', a.details -> 'row' ->> 'code', a.details -> 'row' ->> 'name'), '') end,
             (select coalesce(tp.full_name, tp.email) from public.profiles tp where tp.id = a.target_id),
             a.details ->> 'code',
             a.details -> 'row' ->> 'title') as subject
    from public.audit_log a
    left join public.profiles ap on ap.id = a.actor_id
    where public.audit_project_key(a.action, a.details) = p_project::text
  )
  select r.id, r.created_at, r.actor_name, r.actor_role, r.action, r.subject, count(*) over ()
  from entries r
  where p_search is null or btrim(p_search) = '' or r.action ilike '%' || p_search || '%' or r.actor_name ilike '%' || p_search || '%'
    or coalesce(r.subject, '') ilike '%' || p_search || '%'
  order by r.created_at desc, r.id desc
  limit least(greatest(coalesce(p_limit, 50), 1), 200) offset greatest(coalesce(p_offset, 0), 0);
end $$;

-- ---------- 8. Attendance concerns ----------
create table public.attendance_concerns (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  work_date date not null,
  worker_id uuid references public.attendance_workers (id) on delete set null,
  category text not null check (category in ('absence', 'late', 'headcount', 'device', 'other')),
  note text not null check (char_length(btrim(note)) between 5 and 500),
  status text not null default 'open' check (status in ('open', 'resolved')),
  raised_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  resolved_by uuid references public.profiles (id),
  resolved_at timestamptz,
  resolution_note text check (resolution_note is null or char_length(resolution_note) <= 500)
);
create index attendance_concerns_project_idx on public.attendance_concerns (project_id, status, work_date desc);
alter table public.attendance_concerns enable row level security;
create policy "managers and admins read attendance concerns" on public.attendance_concerns
  for select to authenticated
  using (project_id in (select public.managed_project_ids())
    or (select public.has_permission('biometrics.manage')) or (select public.has_permission('projects.manage')));
revoke all on public.attendance_concerns from anon;
revoke insert, update, delete, truncate on public.attendance_concerns from authenticated;

create function public.flag_attendance_concern(p_project uuid, p_day date, p_worker uuid, p_category text, p_note text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_code text;
  v_note text := btrim(coalesce(p_note, ''));
  r record;
begin
  if not (public.manages_open_project(p_project) or public.has_permission('projects.manage')) then
    raise exception 'Only the project''s Project Manager can flag attendance concerns' using errcode = '42501';
  end if;
  if p_day is null or p_day > (now() at time zone 'Asia/Manila')::date or p_day < (now() at time zone 'Asia/Manila')::date - 120 then
    raise exception 'Choose a day in the last 120 days, up to today';
  end if;
  if p_category is null or p_category not in ('absence', 'late', 'headcount', 'device', 'other') then
    raise exception 'Choose what kind of concern it is';
  end if;
  if p_worker is not null and not exists (select 1 from public.attendance_workers where id = p_worker and project_id = p_project) then
    raise exception 'That worker is not registered on this project';
  end if;
  if char_length(v_note) < 5 or char_length(v_note) > 500 then
    raise exception 'Describe the concern in 5 to 500 characters';
  end if;
  if (select count(*) from public.attendance_concerns where raised_by = auth.uid() and created_at > now() - interval '1 day') >= 30 then
    raise exception 'You have flagged 30 concerns in the last day. Try again later.';
  end if;
  insert into public.attendance_concerns (project_id, work_date, worker_id, category, note, raised_by)
  values (p_project, p_day, p_worker, p_category, v_note, auth.uid())
  returning id into v_id;
  select code into v_code from public.projects where id = p_project;
  insert into public.audit_log (actor_id, action, details)
  values (auth.uid(), 'attendance.concern_flagged', jsonb_build_object('project_id', p_project, 'concern', v_id, 'day', p_day, 'category', p_category));
  for r in
    select p.id from public.profiles p
    where p.status = 'active' and (p.role = 'super_admin' or (p.role = 'admin'
      and exists (select 1 from public.admin_permissions ap where ap.user_id = p.id and ap.permission = 'biometrics.manage')))
    union
    select pm.user_id from public.project_managers pm where pm.project_id = p_project and pm.user_id is distinct from auth.uid()
  loop
    perform public.notify_user(r.id, 'attendance.concern', v_code || ': attendance concern for ' || to_char(p_day, 'DD Mon YYYY'),
      left(v_note, 300), case when exists (select 1 from public.profiles where id = r.id and role = 'project_manager')
        then '/pm/attendance?project=' || p_project else '/admin/biometrics?project=' || p_project end,
      p_project, v_id, null);
  end loop;
  return v_id;
end $$;

create function public.resolve_attendance_concern(p_id uuid, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  c public.attendance_concerns;
begin
  select * into c from public.attendance_concerns where id = p_id for update;
  if c.id is null or not (public.manages_open_project(c.project_id) or public.has_permission('biometrics.manage')
      or public.has_permission('projects.manage')) then
    raise exception 'Concern not found' using errcode = '42501';
  end if;
  if c.status = 'resolved' then
    return;
  end if;
  update public.attendance_concerns
    set status = 'resolved', resolved_by = auth.uid(), resolved_at = now(), resolution_note = left(nullif(btrim(coalesce(p_note, '')), ''), 500)
    where id = p_id;
  insert into public.audit_log (actor_id, action, details)
  values (auth.uid(), 'attendance.concern_resolved', jsonb_build_object('project_id', c.project_id, 'concern', p_id));
  if c.raised_by is distinct from auth.uid() then
    perform public.notify_user(c.raised_by, 'attendance.concern_resolved', 'Attendance concern resolved',
      coalesce(left(nullif(btrim(coalesce(p_note, '')), ''), 300), 'The concern you flagged was marked resolved.'),
      '/pm/attendance?project=' || c.project_id, c.project_id, p_id, null);
  end if;
end $$;

-- ---------- 9. Accounts: home page, role notices, invitations, whitelist, access review ----------
create or replace function public.role_home(p_role public.app_role)
returns text language sql immutable set search_path = '' as $$
  select case p_role
    when 'super_admin' then '/admin/dashboard' when 'admin' then '/admin/dashboard'
    when 'engineer' then '/engineer/dashboard' when 'foreman' then '/foreman/dashboard'
    when 'project_manager' then '/pm/projects'
    when 'client' then '/client/overview' else '/user/home' end;
$$;

create or replace function public.trg_notify_role_granted()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.role is not distinct from new.role then
    return new;
  end if;
  if coalesce(old.role::text, 'user') = 'user' and new.role in ('engineer', 'foreman', 'client', 'admin', 'project_manager') then
    perform public.notify_user(new.id, 'access.granted',
      'You now have ' || case when new.role = 'project_manager' then 'Project Manager' else initcap(new.role::text) end || ' access',
      case when new.role = 'project_manager' then 'An Admin assigns your projects; they appear under My projects.' else 'Open your dashboard to start working.' end,
      public.role_home(new.role), null, new.id);
  end if;
  return new;
end;
$$;

alter table public.invite_codes drop constraint if exists invite_codes_assigned_role_check;
alter table public.invite_codes add constraint invite_codes_assigned_role_check
  check (assigned_role in ('engineer', 'foreman', 'client', 'project_manager'));

create or replace function public.create_invite(p_role public.app_role, p_discipline text default null, p_note text default null, p_max_uses integer default 1, p_days integer default 14)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_code text;
  v_try integer := 0;
begin
  if not public.has_permission('users.approve') then
    raise exception 'Missing permission: users.approve';
  end if;
  if p_role not in ('engineer', 'foreman', 'client', 'project_manager') then
    raise exception 'Invitations can give Engineer, Foreman or Client access, or Project Manager access';
  end if;
  if p_days not between 1 and 90 then
    raise exception 'Choose between 1 and 90 days';
  end if;
  loop
    v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));
    exit when not exists (select 1 from public.invite_codes where code = v_code);
    v_try := v_try + 1;
    exit when v_try > 5;
  end loop;
  insert into public.invite_codes (code, assigned_role, discipline, note, max_uses, expires_at, created_by)
  values (v_code, p_role, p_discipline, nullif(btrim(p_note), ''), p_max_uses, now() + make_interval(days => p_days), auth.uid());
  insert into public.audit_log (actor_id, action, details)
  values (auth.uid(), 'invite.create', jsonb_build_object('role', p_role, 'max_uses', p_max_uses, 'days', p_days));
  return v_code;
end;
$$;

alter table public.whitelisted_emails drop constraint if exists whitelisted_emails_assigned_role_check;
alter table public.whitelisted_emails add constraint whitelisted_emails_assigned_role_check
  check (assigned_role in ('engineer', 'foreman', 'client', 'admin', 'project_manager'));

create or replace function public.get_inactive_users(p_days integer default null)
returns table (id uuid, full_name text, email text, role public.app_role, status public.user_status, last_sign_in_at timestamptz, created_at timestamptz, days_inactive integer)
language plpgsql stable security definer set search_path = '' as $$
declare
  d integer := coalesce(p_days, (select (value #>> '{}')::integer from public.system_settings where key = 'access.inactive_days'), 60);
begin
  if not public.has_permission('users.view') then
    raise exception 'Missing permission: users.view';
  end if;
  return query
  select p.id, p.full_name, p.email, p.role, p.status, u.last_sign_in_at, p.created_at,
         floor(extract(epoch from (now() - coalesce(u.last_sign_in_at, p.created_at))) / 86400)::integer
  from public.profiles p
  join auth.users u on u.id = p.id
  where p.status = 'active'
    and p.role in ('engineer', 'foreman', 'client', 'project_manager', 'user')
    and coalesce(u.last_sign_in_at, p.created_at) < now() - make_interval(days => d)
  order by coalesce(u.last_sign_in_at, p.created_at) asc
  limit 500;
end;
$$;

-- ---------- 10. Escalations also reach the project's Project Managers ----------
create or replace function public.generate_escalations()
returns integer language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  r record;
  total integer := 0;
  day_key text := to_char(current_date, 'YYYYMMDD');
  my_pins uuid[];
  my_defects uuid[];
begin
  select * into me from public.profiles where id = auth.uid();
  if me.id is null or me.status <> 'active' or me.role not in ('engineer', 'project_manager', 'admin', 'super_admin') then
    return 0;
  end if;
  if me.role = 'engineer' then
    my_pins := array(select public.scoped_pin_ids(true));
    my_defects := array(select public.scoped_defect_ids(true));
  end if;

  for r in
    select p.id as project_id, p.code, p.name,
           (select count(*) from public.pins pn
             where pn.project_id = p.id and pn.category <> 'note' and pn.status <> 'verified' and pn.due_date is not null and pn.due_date <= current_date - 3
               and (my_pins is null or pn.id = any (my_pins))) as pins_late,
           (select count(*) from public.pins pn
             where pn.project_id = p.id and pn.category <> 'note' and pn.status <> 'verified' and pn.due_date is not null and pn.due_date <= current_date - 7
               and (my_pins is null or pn.id = any (my_pins))) as pins_very_late,
           (select count(*) from public.qa_defects d
             where d.project_id = p.id and d.status <> 'closed' and d.due_date is not null and d.due_date < current_date
               and (my_defects is null or d.id = any (my_defects))) as ncr_late,
           (select count(*) from public.qa_defects d
             where d.project_id = p.id and d.status <> 'closed' and d.severity = 'critical' and d.due_date is not null and d.due_date < current_date
               and (my_defects is null or d.id = any (my_defects))) as ncr_critical_late,
           (select count(*) from public.qa_defects d
             where d.project_id = p.id and d.status <> 'closed' and d.due_date is not null and d.due_date <= current_date - 5
               and (my_defects is null or d.id = any (my_defects))) as ncr_very_late
    from public.projects p
    where p.status in ('planning', 'active', 'on_hold')
      and ((me.role = 'engineer' and exists (select 1 from public.project_members m where m.project_id = p.id and m.user_id = me.id and m.member_role = 'engineer'))
        or (me.role = 'project_manager' and p.archived_at is null and public.is_project_manager(p.id))
        or (me.role in ('admin', 'super_admin') and public.has_permission('projects.manage')))
  loop
    if me.role = 'engineer' then
      if r.pins_late + r.ncr_late > 0 then
        if public.notify_user(me.id, 'alert.overdue',
             r.code || ': work is running late',
             case when r.pins_late > 0 then r.pins_late || ' work item' || case when r.pins_late = 1 then ' is' else 's are' end || ' 3 or more days late' else '' end
               || case when r.pins_late > 0 and r.ncr_late > 0 then ' and ' else '' end
               || case when r.ncr_late > 0 then r.ncr_late || ' defect report' || case when r.ncr_late = 1 then ' is' else 's are' end || ' past the deadline' else '' end || '.',
             '/engineer/dashboard?project=' || r.project_id, r.project_id, null, 'late:' || r.project_id || ':' || day_key) then
          total := total + 1;
        end if;
      end if;
    elsif r.ncr_critical_late + r.ncr_very_late + r.pins_very_late > 0 then
      if public.notify_user(me.id, 'alert.escalation',
           r.code || ': needs your attention',
           concat_ws('; ',
             case when r.ncr_critical_late > 0 then r.ncr_critical_late || ' critical defect report' || case when r.ncr_critical_late = 1 then '' else 's' end || ' past the deadline' end,
             case when r.ncr_very_late > 0 then r.ncr_very_late || ' defect report' || case when r.ncr_very_late = 1 then '' else 's' end || ' overdue by 5 or more days' end,
             case when r.pins_very_late > 0 then r.pins_very_late || ' work item' || case when r.pins_very_late = 1 then '' else 's' end || ' 7 or more days late' end) || '.',
           case when me.role = 'project_manager' then '/pm/dashboard?project=' else '/admin/project-overview?project=' end || r.project_id,
           r.project_id, null, 'escalate:' || r.project_id || ':' || day_key) then
        total := total + 1;
      end if;
    end if;
  end loop;
  return total;
end;
$$;

-- ---------- 11. Grants ----------
revoke all on function public.check_project_manager(), public.log_project_manager_change(), public.guard_project_manager_edit(),
  public.clear_manager_assignments() from public, anon, authenticated;
revoke all on function public.is_project_manager(uuid), public.manages_open_project(uuid), public.managed_project_ids(),
  public.get_assignable_people(uuid), public.get_project_managers(uuid), public.assign_project_manager(uuid, uuid, text),
  public.remove_project_manager(uuid, uuid), public.set_project_archived(uuid, boolean), public.assign_work_item(uuid, uuid, timestamptz),
  public.get_project_audit_log(uuid, text, integer, integer), public.flag_attendance_concern(uuid, date, uuid, text, text),
  public.resolve_attendance_concern(uuid, text) from public, anon;
grant execute on function public.is_project_manager(uuid), public.manages_open_project(uuid), public.managed_project_ids(),
  public.get_assignable_people(uuid), public.get_project_managers(uuid), public.assign_project_manager(uuid, uuid, text),
  public.remove_project_manager(uuid, uuid), public.set_project_archived(uuid, boolean), public.assign_work_item(uuid, uuid, timestamptz),
  public.get_project_audit_log(uuid, text, integer, integer), public.flag_attendance_concern(uuid, date, uuid, text, text),
  public.resolve_attendance_concern(uuid, text) to authenticated;
grant execute on function public.audit_project_key(text, jsonb) to authenticated;
