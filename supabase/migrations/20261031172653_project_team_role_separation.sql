-- Admins create projects and appoint their managers; Project Managers operate
-- their teams. Super Admin retains recovery authority. Existing assignments stay.
alter policy "manage memberships insert" on public.project_members
  with check ((select public.is_super_admin()));
alter policy "manage memberships update" on public.project_members
  using ((select public.is_super_admin())) with check ((select public.is_super_admin()));
alter policy "manage memberships delete" on public.project_members
  using ((select public.is_super_admin()));

-- The lead fields automatically enroll people through sync_project_leads.
-- Guard that alternate path as well as direct project_members writes.
create function public.guard_project_team_assignment()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare changed boolean;
begin
  if auth.uid() is null or public.is_super_admin() then return new; end if;
  if tg_op = 'INSERT' then
    changed := new.lead_engineer_id is not null or new.lead_foreman_id is not null;
  else
    changed := new.lead_engineer_id is distinct from old.lead_engineer_id
      or new.lead_foreman_id is distinct from old.lead_foreman_id;
    -- Account disable/role changes and member removals must still clear leads.
    if pg_trigger_depth() > 1
      and (new.lead_engineer_id is null or new.lead_engineer_id is not distinct from old.lead_engineer_id)
      and (new.lead_foreman_id is null or new.lead_foreman_id is not distinct from old.lead_foreman_id) then
      return new;
    end if;
  end if;
  if changed and not public.manages_open_project(new.id) then
    raise exception 'Only this project''s Project Managers can assign its Engineer and Foreman in charge. Super Admin retains recovery access.' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger projects_guard_team_assignment before insert or update of lead_engineer_id, lead_foreman_id on public.projects
  for each row execute function public.guard_project_team_assignment();
revoke all on function public.guard_project_team_assignment() from public, anon, authenticated;

create or replace function public.set_blueprint_access(p_project uuid, p_user uuid, p_levels jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare k text; v text; n integer := 0;
begin
  if not (public.is_super_admin() or public.manages_open_project(p_project)) then
    raise exception 'Only this project''s Project Managers can change blueprint access. Super Admin retains recovery access.' using errcode = '42501';
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
    if k not in ('architectural', 'civil_structural', 'electrical', 'mechanical', 'plumbing_sanitary') then raise exception 'Unknown blueprint type: %', k; end if;
    if v is null or v not in ('none', 'view', 'assigned') then raise exception 'Access must be No access, View only or Assigned work access'; end if;
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

create or replace function public.assign_work_item(p_pin uuid, p_foreman uuid, p_expected timestamptz default null)
returns public.pins language plpgsql security definer set search_path = '' as $$
declare pn public.pins;
begin
  select * into pn from public.pins where id = p_pin for update;
  if pn.id is null or not (public.manages_open_project(pn.project_id) or public.is_super_admin()) then
    raise exception 'Only the project''s Project Managers can reassign this work. Super Admin retains recovery access.' using errcode = '42501';
  end if;
  if pn.category = 'note' then raise exception 'Notes are not assignable work'; end if;
  if p_expected is not null and pn.updated_at is distinct from p_expected then raise exception 'This work changed since you opened it. Review the current record before trying again.'; end if;
  if pn.locked then raise exception 'This pin is locked on the plan. Ask the Engineer to unlock it before reassigning it.'; end if;
  if pn.status in ('for_review', 'verified') then raise exception 'Work awaiting Engineer review or already completed keeps its Foreman.'; end if;
  if pn.assigned_to is not distinct from p_foreman then return pn; end if;
  update public.pins set assigned_to = p_foreman where id = p_pin returning * into pn;
  return pn;
end;
$$;
revoke execute on function public.set_blueprint_access(uuid, uuid, jsonb), public.assign_work_item(uuid, uuid, timestamptz) from public, anon;
grant execute on function public.set_blueprint_access(uuid, uuid, jsonb), public.assign_work_item(uuid, uuid, timestamptz) to authenticated;
