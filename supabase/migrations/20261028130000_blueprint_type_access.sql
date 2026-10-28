-- Blueprint types and per-type access for Engineers and Foremen.
--   * blueprints.blueprint_type: architectural | civil_structural | electrical | mechanical | plumbing_sanitary,
--     Older sheets: discipline 'architectural' stays Architectural; everything else ('civil_structural', 'mep', empty) becomes
--     Civil / Structural (owner decision 2026-10-28: no Unclassified group). An Admin with blueprints.manage can move a sheet later.
--     The legacy discipline column is kept untouched; new sheets fill it from the type when it is empty.
--   * project_blueprint_access: one row per project member and type, 'view' or 'assigned' (no row = No access).
--     Written only through set_blueprint_access (Admin, projects.manage + MFA). Membership alone grants no type.
--   * Engineers / Foremen only read sheets, pins, checklists, QA records, evidence files and timelines of types they hold,
--     and only write (directly or through any RPC) with Assigned work access. Admins and Clients keep their existing rules.
--   * Notifications about a typed record only reach Engineers / Foremen with Assigned work access to that type.
--   * Transition: every existing Engineer / Foreman member gets Assigned work on the types their project already has sheets in
--     so nobody loses today's access. New members start with No access.
-- Details: docs/audits/2026-10-28-blueprint-type-access.md

-- ---------- 1. Sheet type ----------
alter table public.blueprints add column blueprint_type text;
update public.blueprints set blueprint_type = case when discipline = 'architectural' then 'architectural' else 'civil_structural' end;
alter table public.blueprints
  alter column blueprint_type set not null,
  add constraint blueprints_blueprint_type_check
    check (blueprint_type in ('architectural', 'civil_structural', 'electrical', 'mechanical', 'plumbing_sanitary'));
create index blueprints_project_type_idx on public.blueprints (project_id, blueprint_type);

create function public.blueprint_type_label(p_type text)
returns text language sql immutable set search_path = '' as $$
  select case p_type
    when 'architectural' then 'Architectural'
    when 'civil_structural' then 'Civil / Structural'
    when 'electrical' then 'Electrical'
    when 'mechanical' then 'Mechanical'
    when 'plumbing_sanitary' then 'Plumbing / Sanitary'
    else coalesce(p_type, 'project-wide') end;
$$;

-- Only an Admin with blueprints.manage changes a sheet's type (revisions, pins and history stay with the sheet).
create function public.guard_blueprint_type()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    -- Older app versions upload without a type: file it like the backfill above (the current app always sends one).
    if new.blueprint_type is null then
      new.blueprint_type := case when new.discipline = 'architectural' then 'architectural' else 'civil_structural' end;
    end if;
    if new.discipline is null then
      new.discipline := case new.blueprint_type when 'architectural' then 'architectural' when 'civil_structural' then 'civil_structural'
        else 'mep' end;
    end if;
  elsif new.blueprint_type is distinct from old.blueprint_type then
    if auth.uid() is not null and not public.has_permission('blueprints.manage') then
      raise exception 'Only an Admin with the Blueprints permission can change the blueprint type' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
create trigger blueprints_type_rules before insert or update of blueprint_type on public.blueprints
  for each row execute function public.guard_blueprint_type();

-- ---------- 2. Access per member and type ----------
create table public.project_blueprint_access (
  project_id uuid not null,
  user_id uuid not null,
  blueprint_type text not null
    check (blueprint_type in ('architectural', 'civil_structural', 'electrical', 'mechanical', 'plumbing_sanitary')),
  access_level text not null check (access_level in ('view', 'assigned')),
  granted_by uuid references auth.users (id) on delete set null,
  granted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (project_id, user_id, blueprint_type),
  -- Leaving the project removes the grants; their history stays in the audit log.
  foreign key (project_id, user_id) references public.project_members (project_id, user_id) on delete cascade
);
create index project_blueprint_access_user_idx on public.project_blueprint_access (user_id, project_id);
alter table public.project_blueprint_access enable row level security;
-- Project staff see who may work on which type (assignment pickers); writes only through set_blueprint_access.
create policy "project staff read blueprint access" on public.project_blueprint_access for select to authenticated
  using (user_id = (select auth.uid()) or ((select public.is_staff()) and project_id in (select public.viewable_project_ids())));
-- Audited with the person as target so the Admin activity feed names them.
create function public.log_blueprint_access_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.audit_log (actor_id, target_id, action, details)
  values (auth.uid(), coalesce(new.user_id, old.user_id), 'project_blueprint_access.' || lower(tg_op),
    jsonb_build_object('row', to_jsonb(coalesce(new, old)), 'before', case when tg_op = 'UPDATE' then to_jsonb(old) end));
  return coalesce(new, old);
end;
$$;
create trigger project_blueprint_access_audit after insert or update or delete on public.project_blueprint_access
  for each row execute function public.log_blueprint_access_change();

-- 'assigned' | 'view' | 'none' for an active Engineer / Foreman member. p_type null = any type (records with no plan).
create function public.blueprint_access_level(p_user uuid, p_project uuid, p_type text)
returns text language sql stable security definer set search_path = '' as $$
  select coalesce((
    select case when bool_or(a.access_level = 'assigned') then 'assigned' else 'view' end
    from public.project_blueprint_access a
    join public.project_members m on m.project_id = a.project_id and m.user_id = a.user_id
    join public.profiles p on p.id = a.user_id
    where a.user_id = p_user and a.project_id = p_project and (p_type is null or a.blueprint_type = p_type)
      and p.status = 'active' and p.role in ('engineer', 'foreman') and m.member_role = p.role
    having count(*) > 0), 'none');
$$;

-- Engineers and Foremen are the roles whose sheets and records follow the per-type grants.
create function public.type_scoped_user(p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = p_user and role in ('engineer', 'foreman'));
$$;
create function public.type_scoped()
returns boolean language sql stable security definer set search_path = '' as $$
  select public.type_scoped_user(auth.uid());
$$;

create function public.my_blueprint_grants()
returns table (project_id uuid, blueprint_type text, access_level text)
language sql stable security definer set search_path = '' as $$
  select a.project_id, a.blueprint_type, a.access_level
  from public.project_blueprint_access a
  join public.project_members m on m.project_id = a.project_id and m.user_id = a.user_id
  join public.profiles p on p.id = a.user_id
  where a.user_id = auth.uid() and p.status = 'active' and p.role in ('engineer', 'foreman') and m.member_role = p.role;
$$;

-- Sets used by the read rules (computed once per query). p_work = only Assigned work access.
create function public.scoped_project_ids(p_work boolean)
returns setof uuid language sql stable security definer set search_path = '' as $$
  select distinct g.project_id from public.my_blueprint_grants() g where not p_work or g.access_level = 'assigned';
$$;
create function public.scoped_blueprint_ids(p_work boolean)
returns setof uuid language sql stable security definer set search_path = '' as $$
  select b.id from public.blueprints b
  join public.my_blueprint_grants() g on g.project_id = b.project_id and g.blueprint_type = b.blueprint_type
  where not p_work or g.access_level = 'assigned';
$$;
create function public.scoped_pin_ids(p_work boolean)
returns setof uuid language sql stable security definer set search_path = '' as $$
  select pn.id from public.pins pn where pn.blueprint_id in (select public.scoped_blueprint_ids(p_work));
$$;
-- QA records without a pin are project-wide: some access (or some Assigned work access) to the project is enough.
create function public.scoped_inspection_ids(p_work boolean)
returns setof uuid language sql stable security definer set search_path = '' as $$
  select i.id from public.qa_inspections i
  where i.project_id in (select public.scoped_project_ids(p_work))
    and (i.pin_id is null or i.pin_id in (select public.scoped_pin_ids(p_work)));
$$;
create function public.scoped_inspection_item_ids(p_work boolean)
returns setof uuid language sql stable security definer set search_path = '' as $$
  select ii.id from public.qa_inspection_items ii where ii.inspection_id in (select public.scoped_inspection_ids(p_work));
$$;
create function public.scoped_defect_ids(p_work boolean)
returns setof uuid language sql stable security definer set search_path = '' as $$
  select d.id from public.qa_defects d
  where d.project_id in (select public.scoped_project_ids(p_work))
    and case when d.pin_id is not null then d.pin_id in (select public.scoped_pin_ids(p_work))
             when d.inspection_id is not null then d.inspection_id in (select public.scoped_inspection_ids(p_work))
             else true end;
$$;
create function public.scoped_site_issue_ids(p_work boolean)
returns setof uuid language sql stable security definer set search_path = '' as $$
  select r.id from public.site_issue_reports r where r.pin_id in (select public.scoped_pin_ids(p_work));
$$;

-- Projects where the caller's grants cover every type that has sheets: nothing to narrow there (the usual case).
create function public.unrestricted_project_ids()
returns setof uuid language sql stable security definer set search_path = '' as $$
  with g as (select project_id, blueprint_type from public.my_blueprint_grants())
  select distinct g.project_id from g
  where not exists (
    select 1 from public.blueprints b
    where b.project_id = g.project_id
      and not exists (select 1 from g g2 where g2.project_id = b.project_id and g2.blueprint_type = b.blueprint_type));
$$;

-- ---------- 3. Read rules (restrictive: they narrow the existing rules, never widen them) ----------
-- Each rule: not an Engineer / Foreman, or a project with nothing to narrow, or the record's own sheet / pin / parent is
-- visible. Parents are checked with an indexed exists() under their own rules, never by building a project-wide set.
-- Sheets compare (project, type) so a sheet being inserted (insert ... returning) is judged on its own values.
create policy "blueprint type access" on public.blueprints as restrictive for select to authenticated
  using ((select not public.type_scoped())
    or (project_id, blueprint_type) in (select g.project_id, g.blueprint_type from public.my_blueprint_grants() g));
create policy "blueprint type access" on public.blueprint_revisions as restrictive for select to authenticated
  using ((select not public.type_scoped()) or project_id in (select public.unrestricted_project_ids())
    or blueprint_id in (select public.scoped_blueprint_ids(false)));
create policy "blueprint type access" on public.blueprint_annotations as restrictive for select to authenticated
  using ((select not public.type_scoped()) or project_id in (select public.unrestricted_project_ids())
    or blueprint_id in (select public.scoped_blueprint_ids(false)));
create policy "blueprint type access" on public.pins as restrictive for select to authenticated
  using ((select not public.type_scoped()) or project_id in (select public.unrestricted_project_ids())
    or blueprint_id in (select public.scoped_blueprint_ids(false)));
create policy "blueprint type access" on public.pin_events as restrictive for select to authenticated
  using ((select not public.type_scoped()) or project_id in (select public.unrestricted_project_ids())
    or exists (select 1 from public.pins pn where pn.id = pin_events.pin_id));
create policy "blueprint type access" on public.pin_photos as restrictive for select to authenticated
  using ((select not public.type_scoped()) or project_id in (select public.unrestricted_project_ids())
    or exists (select 1 from public.pins pn where pn.id = pin_photos.pin_id));
create policy "blueprint type access" on public.pin_checklist_items as restrictive for select to authenticated
  using ((select not public.type_scoped()) or project_id in (select public.unrestricted_project_ids())
    or exists (select 1 from public.pins pn where pn.id = pin_checklist_items.pin_id));
create policy "blueprint type access" on public.qa_work_attempts as restrictive for select to authenticated
  using ((select not public.type_scoped()) or project_id in (select public.unrestricted_project_ids())
    or exists (select 1 from public.pins pn where pn.id = qa_work_attempts.pin_id));
create policy "blueprint type access" on public.pin_qa_submissions as restrictive for select to authenticated
  using ((select not public.type_scoped()) or project_id in (select public.unrestricted_project_ids())
    or exists (select 1 from public.pins pn where pn.id = pin_qa_submissions.pin_id));
create policy "blueprint type access" on public.site_issue_reports as restrictive for select to authenticated
  using ((select not public.type_scoped()) or project_id in (select public.unrestricted_project_ids())
    or exists (select 1 from public.pins pn where pn.id = site_issue_reports.pin_id));
create policy "blueprint type access" on public.site_issue_photos as restrictive for select to authenticated
  using ((select not public.type_scoped()) or project_id in (select public.unrestricted_project_ids())
    or exists (select 1 from public.site_issue_reports r where r.id = site_issue_photos.report_id));
create policy "blueprint type access" on public.site_issue_photo_revisions as restrictive for select to authenticated
  using ((select not public.type_scoped()) or project_id in (select public.unrestricted_project_ids())
    or exists (select 1 from public.site_issue_photos ph where ph.id = site_issue_photo_revisions.photo_id));
create policy "blueprint type access" on public.qa_inspections as restrictive for select to authenticated
  using ((select not public.type_scoped()) or project_id in (select public.unrestricted_project_ids())
    or (pin_id is null and project_id in (select public.scoped_project_ids(false)))
    or exists (select 1 from public.pins pn where pn.id = qa_inspections.pin_id));
create policy "blueprint type access" on public.qa_inspection_items as restrictive for select to authenticated
  using ((select not public.type_scoped()) or project_id in (select public.unrestricted_project_ids())
    or exists (select 1 from public.qa_inspections i where i.id = qa_inspection_items.inspection_id));
create policy "blueprint type access" on public.qa_inspection_events as restrictive for select to authenticated
  using ((select not public.type_scoped()) or project_id in (select public.unrestricted_project_ids())
    or exists (select 1 from public.qa_inspections i where i.id = qa_inspection_events.inspection_id));
create policy "blueprint type access" on public.qa_defects as restrictive for select to authenticated
  using ((select not public.type_scoped()) or project_id in (select public.unrestricted_project_ids())
    or case when pin_id is not null then exists (select 1 from public.pins pn where pn.id = qa_defects.pin_id)
            when inspection_id is not null then exists (select 1 from public.qa_inspections i where i.id = qa_defects.inspection_id)
            else project_id in (select public.scoped_project_ids(false)) end);
create policy "blueprint type access" on public.qa_defect_events as restrictive for select to authenticated
  using ((select not public.type_scoped()) or project_id in (select public.unrestricted_project_ids())
    or exists (select 1 from public.qa_defects d where d.id = qa_defect_events.defect_id));
create policy "blueprint type access" on public.qa_photos as restrictive for select to authenticated
  using ((select not public.type_scoped()) or project_id in (select public.unrestricted_project_ids()) or (
    (inspection_id is null or exists (select 1 from public.qa_inspections i where i.id = qa_photos.inspection_id))
    and (defect_id is null or exists (select 1 from public.qa_defects d where d.id = qa_photos.defect_id))
    and (item_id is null or exists (select 1 from public.qa_inspection_items ii where ii.id = qa_photos.item_id))));
create policy "blueprint type access" on public.client_snags as restrictive for select to authenticated
  using ((select not public.type_scoped()) or project_id in (select public.unrestricted_project_ids())
    or (pin_id is null and project_id in (select public.scoped_project_ids(false)))
    or exists (select 1 from public.pins pn where pn.id = client_snags.pin_id));
create policy "blueprint type access" on public.snag_photos as restrictive for select to authenticated
  using ((select not public.type_scoped()) or project_id in (select public.unrestricted_project_ids())
    or exists (select 1 from public.client_snags s where s.id = snag_photos.snag_id));

-- ---------- 4. Write rule: every write by an Engineer / Foreman, direct or inside any RPC ----------
-- Which project and type a row belongs to (type null = project-wide record without a plan).
create function public.record_blueprint_scope(p_table text, r jsonb)
returns table (project_id uuid, blueprint_type text)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_sheet uuid;
  v_pin uuid;
  v_ir uuid;
begin
  case p_table
    when 'blueprints' then
      return query select (r ->> 'project_id')::uuid, r ->> 'blueprint_type';
      return;
    when 'blueprint_revisions', 'blueprint_annotations', 'pins' then
      v_sheet := (r ->> 'blueprint_id')::uuid;
    when 'pin_checklist_items', 'pin_photos', 'pin_events', 'qa_work_attempts', 'pin_qa_submissions', 'site_issue_reports', 'client_snags', 'qa_inspections' then
      v_pin := (r ->> 'pin_id')::uuid;
    when 'qa_inspection_items', 'qa_inspection_events' then
      select i.pin_id into v_pin from public.qa_inspections i where i.id = (r ->> 'inspection_id')::uuid;
    when 'qa_defects' then
      v_pin := coalesce((r ->> 'pin_id')::uuid, (select i.pin_id from public.qa_inspections i where i.id = (r ->> 'inspection_id')::uuid));
    when 'qa_defect_events' then
      select coalesce(d.pin_id, i.pin_id) into v_pin
      from public.qa_defects d left join public.qa_inspections i on i.id = d.inspection_id where d.id = (r ->> 'defect_id')::uuid;
    when 'qa_photos' then
      if r ->> 'defect_id' is not null then
        select coalesce(d.pin_id, i.pin_id) into v_pin
        from public.qa_defects d left join public.qa_inspections i on i.id = d.inspection_id where d.id = (r ->> 'defect_id')::uuid;
      else
        v_ir := coalesce((r ->> 'inspection_id')::uuid,
          (select ii.inspection_id from public.qa_inspection_items ii where ii.id = (r ->> 'item_id')::uuid));
        select i.pin_id into v_pin from public.qa_inspections i where i.id = v_ir;
      end if;
    when 'site_issue_photos' then
      select rp.pin_id into v_pin from public.site_issue_reports rp where rp.id = (r ->> 'report_id')::uuid;
    else
      null;
  end case;
  if v_sheet is null and v_pin is not null then
    select pn.blueprint_id into v_sheet from public.pins pn where pn.id = v_pin;
  end if;
  if v_sheet is not null then
    return query select b.project_id, b.blueprint_type from public.blueprints b where b.id = v_sheet;
    if found then return; end if;
  end if;
  -- No plan (project-wide record), or the parent is already gone in a cascade: decide at project level.
  return query select (r ->> 'project_id')::uuid, null::text;
end;
$$;

create function public.guard_blueprint_type_work()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  checked jsonb[];
  r jsonb;
  old_row jsonb;
  col text;
  target uuid;
  v_project uuid;
  v_type text;
begin
  if me is null then
    return coalesce(new, old); -- service role, cron and migrations
  end if;

  -- Whoever does it: work can only be handed to an Engineer / Foreman with Assigned work access to that type.
  if tg_op <> 'DELETE' and tg_table_name in ('pins', 'qa_defects', 'qa_inspections') then
    r := to_jsonb(new);
    old_row := case when tg_op = 'UPDATE' then to_jsonb(old) else '{}'::jsonb end;
    foreach col in array case when tg_table_name = 'qa_inspections' then array['inspector_id', 'escalation_owner'] else array['assigned_to'] end loop
      target := (r ->> col)::uuid;
      if target is not null and target is distinct from (old_row ->> col)::uuid and public.type_scoped_user(target) then
        select s.project_id, s.blueprint_type into v_project, v_type from public.record_blueprint_scope(tg_table_name, r) s;
        if public.blueprint_access_level(target, v_project, v_type) <> 'assigned' then
          raise exception 'That person does not have Assigned work access to % plans on this project', public.blueprint_type_label(v_type)
            using errcode = '42501';
        end if;
      end if;
    end loop;
  end if;

  if not public.type_scoped() then
    return coalesce(new, old); -- Admins and Clients keep their existing rules
  end if;

  checked := case tg_op when 'INSERT' then array[to_jsonb(new)] when 'DELETE' then array[to_jsonb(old)] else array[to_jsonb(old), to_jsonb(new)] end;
  foreach r in array checked loop
    select s.project_id, s.blueprint_type into v_project, v_type from public.record_blueprint_scope(tg_table_name, r) s;
    -- People outside the project are refused by the existing project rules (RLS / RPC checks); this narrows members only.
    if not exists (select 1 from public.project_members m where m.project_id = v_project and m.user_id = me) then
      continue;
    end if;
    if public.blueprint_access_level(me, v_project, v_type) <> 'assigned' then
      raise exception '%', case when v_type is null
          then 'You need Assigned work access to at least one blueprint type on this project to do that'
          else 'You need Assigned work access to ' || public.blueprint_type_label(v_type) || ' plans to do that' end
        using errcode = '42501';
    end if;
  end loop;
  return coalesce(new, old);
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['blueprints', 'blueprint_revisions', 'blueprint_annotations', 'pins', 'pin_checklist_items', 'pin_photos',
    'pin_events', 'qa_inspections', 'qa_inspection_items', 'qa_inspection_events', 'qa_defects', 'qa_defect_events', 'qa_photos',
    'qa_work_attempts', 'pin_qa_submissions', 'site_issue_reports', 'site_issue_photos', 'client_snags'] loop
    execute format('create trigger %I before insert or update or delete on public.%I for each row execute function public.guard_blueprint_type_work()',
      t || '_type_work', t);
  end loop;
end $$;

-- Inspection requests are routed to an Engineer with Assigned work on the type (the lead Engineer first). Runs before
-- a_one_open_inspection, which otherwise picks the project's first Engineer whoever they are.
create function public.pick_inspection_owner()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_type text;
begin
  if new.escalation_owner is null then
    select s.blueprint_type into v_type from public.record_blueprint_scope('qa_inspections', to_jsonb(new)) s;
    select m.user_id into new.escalation_owner
    from public.project_members m
    join public.profiles p on p.id = m.user_id
    where m.project_id = new.project_id and m.member_role = 'engineer' and p.role = 'engineer' and p.status = 'active'
      and public.blueprint_access_level(m.user_id, new.project_id, v_type) = 'assigned'
    order by (m.user_id is not distinct from (select pr.lead_engineer_id from public.projects pr where pr.id = new.project_id)) desc, m.user_id
    limit 1;
    if new.escalation_owner is null and exists (
      select 1 from public.project_members m where m.project_id = new.project_id and m.member_role = 'engineer') then
      raise exception 'No Engineer has Assigned work access to % plans on this project yet. Ask an Admin to grant it in Project Management > Team & access.',
        public.blueprint_type_label(v_type);
    end if;
  end if;
  return new;
end;
$$;
create trigger a_0_inspection_type_owner before insert on public.qa_inspections
  for each row execute function public.pick_inspection_owner();

-- A Foreman who loses Assigned work on a type hands back the open work of that type (same as leaving the project).
-- Completed work keeps its Foreman; the timeline keeps every assignment.
create function public.release_revoked_type_work()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.access_level = 'assigned' and (tg_op = 'DELETE' or new.access_level <> 'assigned') then
    update public.pins pn set assigned_to = null
    from public.blueprints b
    where b.id = pn.blueprint_id and pn.project_id = old.project_id and b.blueprint_type = old.blueprint_type
      and pn.assigned_to = old.user_id and pn.status <> 'verified';
  end if;
  return coalesce(new, old);
end;
$$;
create trigger project_blueprint_access_release after update or delete on public.project_blueprint_access
  for each row execute function public.release_revoked_type_work();

-- ---------- 5. Admin: change one person's access to one or more types ----------
-- p_levels = {"electrical": "assigned", "architectural": "view", "mechanical": "none"}; types left out stay as they are.
create function public.set_blueprint_access(p_project uuid, p_user uuid, p_levels jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  k text;
  v text;
  n integer := 0;
begin
  if not public.has_permission('projects.manage') then
    raise exception 'Only an Admin with the Projects permission can change blueprint access' using errcode = '42501';
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

-- ---------- 6. Files in private buckets follow the same rule as their records ----------
create function public.storage_type_allowed(p_bucket text, p_name text, p_work boolean)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  folder text := split_part(p_name, '/', 2);
  kind text := substring(folder from '^(item|ir|ncr)-');
  id_text text := regexp_replace(folder, '^(item|ir|ncr)-', '');
  v_id uuid;
begin
  if id_text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  v_id := id_text::uuid;
  return case
    when p_bucket = 'blueprints' then v_id in (select public.scoped_blueprint_ids(p_work))
    when p_bucket in ('pin-photos', 'issue-photos') then v_id in (select public.scoped_pin_ids(p_work))
    when p_bucket = 'qa-evidence' and kind = 'item' then v_id in (select public.scoped_inspection_item_ids(p_work))
    when p_bucket = 'qa-evidence' and kind = 'ir' then v_id in (select public.scoped_inspection_ids(p_work))
    when p_bucket = 'qa-evidence' and kind = 'ncr' then v_id in (select public.scoped_defect_ids(p_work))
    else false end;
end;
$$;
create policy "blueprint type access: read files" on storage.objects as restrictive for select to authenticated
  using (bucket_id not in ('blueprints', 'pin-photos', 'issue-photos', 'qa-evidence')
    or (select not public.type_scoped()) or public.storage_type_allowed(bucket_id, name, false));
create policy "blueprint type access: add files" on storage.objects as restrictive for insert to authenticated
  with check (bucket_id not in ('blueprints', 'pin-photos', 'issue-photos', 'qa-evidence')
    or (select not public.type_scoped()) or public.storage_type_allowed(bucket_id, name, true));
create policy "blueprint type access: change files" on storage.objects as restrictive for update to authenticated
  using (bucket_id not in ('blueprints', 'pin-photos', 'issue-photos', 'qa-evidence')
    or (select not public.type_scoped()) or public.storage_type_allowed(bucket_id, name, true));
create policy "blueprint type access: remove files" on storage.objects as restrictive for delete to authenticated
  using (bucket_id not in ('blueprints', 'pin-photos', 'issue-photos', 'qa-evidence')
    or (select not public.type_scoped()) or public.storage_type_allowed(bucket_id, name, true));

-- ---------- 7. Notifications: typed records only reach people with Assigned work access to that type ----------
create or replace function public.notify_user(p_user uuid, p_kind text, p_title text, p_body text, p_link text, p_project uuid, p_entity uuid, p_dedupe text default null)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  n integer;
  v_project uuid;
  v_pin uuid;
  v_type text;
begin
  if p_entity is not null and public.type_scoped_user(p_user) then
    select x.project_id, x.pin_id into v_project, v_pin from (
      select pn.project_id, pn.id as pin_id from public.pins pn where pn.id = p_entity
      union all select i.project_id, i.pin_id from public.qa_inspections i where i.id = p_entity
      union all select d.project_id, coalesce(d.pin_id, (select i.pin_id from public.qa_inspections i where i.id = d.inspection_id))
        from public.qa_defects d where d.id = p_entity
      union all select c.project_id, c.pin_id from public.pin_checklist_items c where c.id = p_entity
      union all select s.project_id, s.pin_id from public.client_snags s where s.id = p_entity
      union all select r.project_id, r.pin_id from public.site_issue_reports r where r.id = p_entity
      union all select w.project_id, w.pin_id from public.qa_work_attempts w where w.id = p_entity
    ) x limit 1;
    if v_project is not null then
      select b.blueprint_type into v_type from public.pins pn join public.blueprints b on b.id = pn.blueprint_id where pn.id = v_pin;
      if public.blueprint_access_level(p_user, v_project, v_type) <> 'assigned' then
        return false;
      end if;
    end if;
  end if;
  insert into public.notifications (user_id, kind, title, body, link, project_id, entity_id, dedupe_key)
  select p.id, p_kind, left(p_title, 160), left(p_body, 500), p_link, p_project, p_entity, p_dedupe
  from public.profiles p where p.id = p_user and p.status = 'active'
  on conflict (user_id, dedupe_key) where dedupe_key is not null do nothing;
  get diagnostics n = row_count;
  return n > 0;
end;
$$;

-- Late-work digests count only the work an Engineer may act on.
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
  if me.id is null or me.status <> 'active' or me.role not in ('engineer', 'admin', 'super_admin') then
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
           '/admin/project-overview?project=' || r.project_id, r.project_id, null, 'escalate:' || r.project_id || ':' || day_key) then
        total := total + 1;
      end if;
    end if;
  end loop;
  return total;
end;
$$;

-- ---------- 8. Read functions that bypass RLS apply the same rule ----------
create or replace function public.get_pin_timeline(p_pin uuid)
returns table (id bigint, created_at timestamptz, kind text, from_status public.pin_status, to_status public.pin_status, note text,
               actor_name text, actor_role public.app_role, from_name text, to_name text)
language sql stable security definer set search_path = '' as $$
  select e.id, e.created_at, e.kind, e.from_status, e.to_status, e.note,
         coalesce(p.full_name, p.email, 'System'), p.role,
         case when e.from_user is not null then coalesce(f.full_name, f.email) end,
         case when e.to_user is not null then coalesce(t.full_name, t.email) end
  from public.pin_events e
  left join public.profiles p on p.id = e.actor_id
  left join public.profiles f on f.id = e.from_user
  left join public.profiles t on t.id = e.to_user
  where e.pin_id = p_pin
    and public.can_view_project(e.project_id)
    and not public.is_project_client(e.project_id)
    and (not public.type_scoped() or exists (select 1 from public.pins pn where pn.id = p_pin and pn.blueprint_id in (select public.scoped_blueprint_ids(false))))
  order by e.id;
$$;

create or replace function public.get_sheet_history(p_blueprint uuid, p_limit integer default 100)
returns table (id text, created_at timestamptz, actor_name text, actor_role public.app_role, action text, item_type text, item_id uuid, summary text)
language sql stable security definer set search_path = '' as $$
  with bp as (
    select b.id, b.project_id from public.blueprints b
    where b.id = p_blueprint and public.can_view_project(b.project_id) and not public.is_project_client(b.project_id)
      and (not public.type_scoped() or b.id in (select public.scoped_blueprint_ids(false)))
  )
  select t.id, t.created_at, t.actor_name, t.actor_role, t.action, t.item_type, t.item_id, t.summary
  from (
    select 'h' || h.id::text as id, h.created_at, coalesce(p.full_name, p.email, 'System') as actor_name, p.role as actor_role,
           h.action, h.item_type, h.item_id, h.summary, h.id as sort_id
    from public.sheet_history h
    join bp on bp.id = h.blueprint_id
    left join public.profiles p on p.id = h.actor_id
    union all
    select 'e' || e.id::text, e.created_at, coalesce(p.full_name, p.email, 'System'), p.role, e.kind, 'pin', e.pin_id,
           case e.kind
             when 'created' then 'Added pin "' || pn.title || '"'
             when 'moved' then 'Moved pin "' || pn.title || '"'
             when 'edited' then 'Edited pin "' || pn.title || '"'
             when 'status' then 'Pin "' || pn.title || '" is now ' || replace(e.to_status::text, '_', ' ')
             when 'comment' then 'Commented on pin "' || pn.title || '"'
             when 'photo' then 'Added a photo to pin "' || pn.title || '"'
             when 'photo_removed' then 'Removed a photo from pin "' || pn.title || '"'
             when 'checklist' then 'Checklist of pin "' || pn.title || '": ' || coalesce(e.note, 'updated')
             else 'Updated pin "' || pn.title || '"'
           end,
           e.id
    from public.pin_events e
    join public.pins pn on pn.id = e.pin_id
    join bp on bp.id = pn.blueprint_id
    left join public.profiles p on p.id = e.actor_id
  ) t
  order by t.created_at desc, t.sort_id desc
  limit least(greatest(coalesce(p_limit, 100), 1), 300);
$$;

create or replace function public.qa_ncr_reinspection_state(p_defect uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare d public.qa_defects; verified uuid; linked uuid; i public.qa_inspections;
begin
  select * into d from public.qa_defects where id=p_defect;
  if d.id is null or not public.is_staff() or not public.can_view_project(d.project_id)
     or (public.type_scoped() and d.id not in (select public.scoped_defect_ids(false))) then
    raise exception 'NCR not found or access denied'; end if;
  verified:=public.qa_ncr_verified_inspection(d.id);
  if d.correction_attempt_id is not null then select submitted_inspection_id into linked from public.qa_work_attempts where id=d.correction_attempt_id;
  else linked:=verified; end if;
  select * into i from public.qa_inspections where id=linked;
  return jsonb_build_object('id',i.id,'status',i.status,'number',i.number,'ready',verified is not null);
end; $$;

create or replace function public.qa_reinspection_context(p_inspection uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare i public.qa_inspections;
begin
  select * into i from public.qa_inspections where id=p_inspection;
  if i.id is null or not public.is_staff() or not public.can_view_project(i.project_id)
     or (public.type_scoped() and i.id not in (select public.scoped_inspection_ids(false))) then
    raise exception 'Inspection not found or access denied'; end if;
  return coalesce((select jsonb_agg(to_jsonb(x)||jsonb_build_object('source_number',source.number) order by x.position,x.id)
    from public.qa_prior_criteria(i.id) x join public.qa_inspections source on source.id=x.inspection_id),'[]'::jsonb);
end; $$;

create or replace function public.get_qa_summary(p_project uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  staff boolean := public.is_staff();
  out jsonb;
  -- Engineers / Foremen: only the inspections and NCRs of the types they hold (null = no narrowing).
  narrow boolean := public.type_scoped() and p_project not in (select public.unrestricted_project_ids());
  irs uuid[] := case when narrow then array(select public.scoped_inspection_ids(false)) end;
  ncrs uuid[] := case when narrow then array(select public.scoped_defect_ids(false)) end;
begin
  if not public.can_view_project(p_project) then raise exception 'Project not found'; end if;
  select jsonb_build_object(
    'inspections', jsonb_build_object(
      'total', count(*) filter (where status <> 'cancelled'),
      'requested', count(*) filter (where status = 'requested'),
      'in_progress', count(*) filter (where status = 'in_progress'),
      'passed', count(*) filter (where status = 'passed'),
      'conditional', count(*) filter (where status = 'conditional'),
      'failed', count(*) filter (where status = 'failed'),
      'first_pass_rate', (select case when count(*) = 0 then null else round(100.0 * count(*) filter (where status = 'passed') / count(*), 1) end
                          from public.qa_inspections a where a.project_id = p_project and (irs is null or a.id = any (irs))
                            and a.reinspection_of is null and a.status in ('passed', 'conditional', 'failed')),
      'average_score', round(avg(score) filter (where status in ('passed', 'conditional', 'failed')), 1)))
  into out from public.qa_inspections where project_id = p_project and (irs is null or id = any (irs));
  out := out || (select jsonb_build_object('defects', jsonb_build_object(
      'open', count(*) filter (where status <> 'closed'),
      'critical_open', count(*) filter (where status <> 'closed' and severity = 'critical'),
      'major_open', count(*) filter (where status <> 'closed' and severity = 'major'),
      'minor_open', count(*) filter (where status <> 'closed' and severity = 'minor'),
      'overdue', count(*) filter (where status <> 'closed' and due_date < current_date),
      'for_verification', count(*) filter (where status = 'for_verification'),
      'closed', count(*) filter (where status = 'closed'),
      'average_days_to_close', round(avg(extract(epoch from (closed_at - raised_at)) / 86400) filter (where status = 'closed'), 1)))
    from public.qa_defects where project_id = p_project and (ncrs is null or id = any (ncrs)));
  out := out || jsonb_build_object('items', (select jsonb_build_object(
      'checked', count(*) filter (where i.result in ('pass', 'fail')),
      'failed', count(*) filter (where i.result = 'fail'),
      'defects_per_100_items', case when count(*) filter (where i.result in ('pass', 'fail')) = 0 then null else round(100.0 * count(*) filter (where i.result = 'fail') / count(*) filter (where i.result in ('pass', 'fail')), 1) end)
    from public.qa_inspection_items i join public.qa_inspections a on a.id = i.inspection_id
    where a.project_id = p_project and (irs is null or a.id = any (irs)) and a.status in ('passed', 'conditional', 'failed')));
  out := out || jsonb_build_object('by_trade', coalesce((select jsonb_agg(row_to_json(t) order by t.trade) from (
      select a.trade, count(*) filter (where a.status in ('passed', 'conditional', 'failed')) as inspections,
             case when count(*) filter (where a.status in ('passed', 'conditional', 'failed')) = 0 then null else round(100.0 * count(*) filter (where a.status = 'passed') / count(*) filter (where a.status in ('passed', 'conditional', 'failed')), 1) end as pass_rate,
             (select count(*) from public.qa_defects d where d.project_id = p_project and (ncrs is null or d.id = any (ncrs)) and d.trade = a.trade and d.status <> 'closed') as open_defects
      from public.qa_inspections a where a.project_id = p_project and (irs is null or a.id = any (irs)) and a.status <> 'cancelled' group by a.trade) t), '[]'::jsonb));
  out := out || jsonb_build_object('recent', coalesce((select jsonb_agg(row_to_json(x)) from (
      select a.id, a.number, a.title, a.trade, a.status, a.score, a.completed_at, a.requested_at from public.qa_inspections a
      where a.project_id = p_project and (irs is null or a.id = any (irs)) and a.status <> 'cancelled'
      order by coalesce(a.completed_at, a.requested_at) desc limit 8) x), '[]'::jsonb));
  return out || jsonb_build_object('staff', staff);
end;
$$;

-- ---------- 9. Transition: keep today's access for the current team ----------
-- Each existing Engineer / Foreman member gets Assigned work on every type their project already has sheets in.
-- Kept as an internal function so the SQL tests can prove it; never callable through the API.
create function public.backfill_blueprint_access()
returns integer language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  insert into public.project_blueprint_access (project_id, user_id, blueprint_type, access_level, granted_by)
  select distinct m.project_id, m.user_id, b.blueprint_type, 'assigned', null::uuid
  from public.project_members m
  join public.profiles p on p.id = m.user_id and p.role = m.member_role
  join public.blueprints b on b.project_id = m.project_id
  where m.member_role in ('engineer', 'foreman')
  on conflict (project_id, user_id, blueprint_type) do nothing;
  get diagnostics n = row_count;
  return n;
end;
$$;
select public.backfill_blueprint_access();

-- ---------- 10. Who may call what ----------
revoke all on function public.guard_blueprint_type(), public.guard_blueprint_type_work(), public.pick_inspection_owner(), public.log_blueprint_access_change(), public.release_revoked_type_work(),
  public.backfill_blueprint_access(), public.record_blueprint_scope(text, jsonb), public.blueprint_access_level(uuid, uuid, text),
  public.type_scoped_user(uuid)
  from public, anon, authenticated;
-- Used inside the read rules, so the signed-in caller needs them.
revoke all on function public.type_scoped(), public.my_blueprint_grants(), public.unrestricted_project_ids(), public.scoped_project_ids(boolean), public.scoped_blueprint_ids(boolean),
  public.scoped_pin_ids(boolean), public.scoped_inspection_ids(boolean), public.scoped_inspection_item_ids(boolean),
  public.scoped_defect_ids(boolean), public.scoped_site_issue_ids(boolean), public.storage_type_allowed(text, text, boolean),
  public.set_blueprint_access(uuid, uuid, jsonb), public.blueprint_type_label(text)
  from public, anon;
grant execute on function public.type_scoped(), public.my_blueprint_grants(), public.unrestricted_project_ids(), public.scoped_project_ids(boolean), public.scoped_blueprint_ids(boolean),
  public.scoped_pin_ids(boolean), public.scoped_inspection_ids(boolean), public.scoped_inspection_item_ids(boolean),
  public.scoped_defect_ids(boolean), public.scoped_site_issue_ids(boolean), public.storage_type_allowed(text, text, boolean),
  public.set_blueprint_access(uuid, uuid, jsonb), public.blueprint_type_label(text)
  to authenticated;
