-- Project Gantt timeline. Work names, ownership and verified progress remain canonical pin/task data.
-- All tables are private; checked RPCs are the only access. A Client reads an explicit projection
-- of the last publication, never working schedules, requests, staff identities or report percentages.
create table public.project_timeline_items (
  project_id uuid not null references public.projects(id) on delete cascade,
  work_key text not null,
  pin_id uuid references public.pins(id) on delete cascade,
  item_id uuid references public.pin_checklist_items(id) on delete cascade,
  title text not null default '' check (char_length(title) <= 160),
  phase text not null default 'Unassigned' check (char_length(phase) between 1 and 80),
  planned_start date,
  planned_end date,
  actual_start date,
  actual_end date,
  predecessors text[] not null default '{}',
  revision integer not null default 1,
  updated_at timestamptz not null default now(),
  primary key(project_id, work_key),
  check ((planned_start is null and planned_end is null) or (planned_start is not null and planned_end is not null and planned_end >= planned_start)),
  check (actual_end is null or (actual_start is not null and actual_end >= actual_start)),
  check (planned_start is null or planned_start between '1900-01-01' and '2199-12-31'),
  check (planned_end is null or planned_end between '1900-01-01' and '2199-12-31'),
  check (actual_start is null or actual_start between '1900-01-01' and '2199-12-31'),
  check (actual_end is null or actual_end between '1900-01-01' and '2199-12-31'),
  check (cardinality(predecessors) <= 20)
);
create table public.project_timeline_publications (
  id bigint generated always as identity primary key,
  project_id uuid not null references public.projects(id) on delete cascade,
  version integer not null,
  snapshot jsonb not null,
  reason text not null check (char_length(reason) between 5 and 500),
  published_by uuid references public.profiles(id),
  published_at timestamptz not null default now(),
  unique(project_id, version)
);
create table public.project_timeline_requests (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  work_key text not null,
  proposal jsonb not null,
  expected_revision integer not null,
  reason text not null check (char_length(reason) between 5 and 500),
  requested_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  status text not null default 'pending' check(status in ('pending', 'approved', 'rejected')),
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  review_note text
);
create index project_timeline_requests_project_idx on public.project_timeline_requests(project_id, status);
create index project_timeline_items_pin_idx on public.project_timeline_items(pin_id);
create index project_timeline_items_item_idx on public.project_timeline_items(item_id);
create index project_timeline_publications_actor_idx on public.project_timeline_publications(published_by);
create index project_timeline_requests_actor_idx on public.project_timeline_requests(requested_by);
create index project_timeline_requests_reviewer_idx on public.project_timeline_requests(reviewed_by);
alter table public.project_timeline_items enable row level security;
alter table public.project_timeline_publications enable row level security;
alter table public.project_timeline_requests enable row level security;
revoke all on public.project_timeline_items, public.project_timeline_publications, public.project_timeline_requests from public, anon, authenticated;
create trigger zz_site_guard before insert or update or delete on public.project_timeline_items for each statement execute function public.site_guard('');
create trigger zz_site_guard before insert or update or delete on public.project_timeline_publications for each statement execute function public.site_guard('');
create trigger zz_site_guard before insert or update or delete on public.project_timeline_requests for each statement execute function public.site_guard('');

-- Manager permission is checked against current profile and project membership, never user_metadata.
create function public.can_manage_timeline(p_project uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and public.is_active() and public.can_view_project(p_project)
    and (public.has_permission('projects.manage') or public.is_project_manager(p_project))
    and exists(select 1 from public.projects where id=p_project and archived_at is null and deleted_at is null);
$$;

-- Private helper; callers run through checked RPCs. One row for each canonical checklist task,
-- or the work pin itself while it has no tasks. An absent start is never guessed from creation time.
create function public.timeline_rows(p_project uuid) returns jsonb
language plpgsql stable set search_path = '' as $$
declare result jsonb; reports jsonb := '[]';
begin
  -- Older deployments have only report-level links. Do not require an unrelated report migration
  -- to use scheduling; task percentages appear automatically when task-entry reports are installed.
  if to_regclass('public.daily_report_entries') is not null then
    execute $reports$
      select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (
        select distinct on (e.pin_id,e.item_id) e.pin_id,e.item_id,e.percent,e.report_id,d.report_date,
          min(d.report_date) filter(where e.percent>0) over(partition by e.pin_id,e.item_id) reported_start,
          case when e.percent=100 then d.report_date end reported_end
        from public.daily_report_entries e join public.daily_reports d on d.id=e.report_id
        where e.project_id=$1 and d.status='submitted' and d.removed_at is null
          and coalesce(d.review_state,'pending')<>'returned' and e.percent is not null
        order by e.pin_id,e.item_id,d.report_date desc,d.submitted_at desc nulls last,e.id desc
      ) x
    $reports$ into reports using p_project;
  end if;
  with work as (
    select case when c.id is null then 'pin:'||p.id else 'task:'||c.id end as work_key,
      p.id pin_id, c.id item_id, p.blueprint_id, p.assigned_to, p.title pin_title,
      coalesce(c.text,p.title) title, b.title location, p.due_date,
      case when c.id is null then p.status='verified' else c.done and c.review_status='verified' end verified,
      p.status='issue' blocked
    from public.pins p join public.blueprints b on b.id=p.blueprint_id
    left join public.pin_checklist_items c on c.pin_id=p.id and c.project_id=p.project_id
    where p.project_id=p_project and p.category<>'note'
      and (not public.type_scoped() or p.id in (select public.scoped_pin_ids(false)))
      and (not exists(select 1 from public.profiles where id=auth.uid() and role='foreman') or p.assigned_to=auth.uid())
  ), all_rows as (
    select w.work_key, jsonb_build_object(
      'key',w.work_key,'kind','work','title',w.title,'pin_title',w.pin_title,'pin_id',w.pin_id,'item_id',w.item_id,
      'blueprint_id',w.blueprint_id,'location',w.location,'assigned_to',w.assigned_to,
      'owner',coalesce(pr.full_name,pr.email,'Unassigned'),'verified',w.verified,'blocked',w.blocked,
      'phase',coalesce(s.phase,'Unassigned'),'planned_start',s.planned_start,'planned_end',coalesce(s.planned_end,w.due_date),
      'actual_start',s.actual_start,'actual_end',s.actual_end,'predecessors',coalesce(s.predecessors,'{}'::text[]),
      'revision',coalesce(s.revision,0),'reported_percent',r.percent,'report_id',r.report_id,'report_date',r.report_date,
      'reported_start',r.reported_start,'reported_end',r.reported_end
    ) value
    from work w left join public.project_timeline_items s on s.project_id=p_project and s.work_key=w.work_key
    left join public.profiles pr on pr.id=w.assigned_to
    left join jsonb_to_recordset(reports) r(pin_id uuid,item_id uuid,percent integer,report_id uuid,report_date date,reported_start date,reported_end date)
      on r.pin_id=w.pin_id and r.item_id is not distinct from w.item_id
    union all
    select s.work_key,jsonb_build_object('key',s.work_key,'kind','milestone','title',s.title,'phase',s.phase,
      'planned_start',s.planned_start,'planned_end',s.planned_end,'actual_start',s.actual_start,'actual_end',s.actual_end,
      'predecessors',s.predecessors,'revision',s.revision,'verified',false,'blocked',false)
    from public.project_timeline_items s where s.project_id=p_project and s.work_key like 'milestone:%'
  ) select coalesce(jsonb_agg(value order by value->>'phase',value->>'planned_start',value->>'title',work_key),'[]') into result from all_rows;
  return result;
end;
$$;

create function public.get_project_timeline(p_project uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare rows jsonb; baseline jsonb; latest public.project_timeline_publications; role_name text; can_edit boolean; requests jsonb;
begin
  if auth.uid() is null or not public.is_active() or not public.can_view_project(p_project) then raise exception 'Project unavailable' using errcode='42501'; end if;
  select role::text into role_name from public.profiles where id=auth.uid();
  if role_name in ('admin','super_admin') and not public.is_aal2() then raise exception 'Complete two-step verification' using errcode='42501'; end if;
  select * into latest from public.project_timeline_publications where project_id=p_project order by version desc limit 1;
  if role_name='client' then
    -- Explicit allow-list: published planned dates and verified state only. No staff or unapproved actuals/progress.
    select coalesce(jsonb_agg(jsonb_build_object('key',x->>'key','kind',x->>'kind','title',x->>'title','phase',x->>'phase',
      'planned_start',x->>'planned_start','planned_end',x->>'planned_end','predecessors',x->'predecessors',
      'pin_id',x->>'pin_id','item_id',x->>'item_id','blueprint_id',x->>'blueprint_id','location',x->>'location',
      'verified',coalesce(x->'verified','false'::jsonb))), '[]') into rows from jsonb_array_elements(coalesce(latest.snapshot,'[]')) x;
    return jsonb_build_object('items',rows,'baseline',rows,'requests','[]'::jsonb,'can_edit',false,'can_request',false,'version',coalesce(latest.version,0),'published_at',latest.published_at);
  end if;
  rows:=public.timeline_rows(p_project);
  -- A scoped field user never receives names/links from hidden baseline work or dependencies.
  select coalesce(jsonb_agg(x),'[]') into baseline from jsonb_array_elements(coalesce(latest.snapshot,'[]')) x
    where exists(select 1 from jsonb_array_elements(rows) y where y->>'key'=x->>'key');
  select coalesce(jsonb_agg(jsonb_set(x,'{predecessors}',coalesce((select jsonb_agg(d) from jsonb_array_elements_text(x->'predecessors') d
    where exists(select 1 from jsonb_array_elements(rows) y where y->>'key'=d)),'[]'::jsonb))),'[]') into rows from jsonb_array_elements(rows) x;
  can_edit:=public.can_manage_timeline(p_project);
  select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at desc),'[]') into requests from public.project_timeline_requests r
    where r.project_id=p_project and (can_edit or r.requested_by=auth.uid())
      and exists(select 1 from jsonb_array_elements(rows) x where x->>'key'=r.work_key);
  return jsonb_build_object('items',rows,'baseline',baseline,'requests',requests,'can_edit',can_edit,
    'can_request',role_name in ('engineer','foreman') and exists(select 1 from public.projects where id=p_project and archived_at is null),
    'version',coalesce(latest.version,0),'published_at',latest.published_at);
end;
$$;

-- Internal transactional writer. Project lock serializes dependency edits, publications and approvals.
create function public.write_timeline_item(p_project uuid,p_key text,p_plan jsonb,p_expected integer,p_reason text) returns void
language plpgsql set search_path = '' as $$
declare old_row public.project_timeline_items; next_row public.project_timeline_items; p_id uuid; i_id uuid; dep text;
begin
  perform 1 from public.projects where id=p_project for update;
  select * into old_row from public.project_timeline_items where project_id=p_project and work_key=p_key;
  if p_expected is distinct from coalesce(old_row.revision,0) then raise exception 'Schedule changed. Reload before saving or reviewing this request.'; end if;
  if p_reason is null or char_length(btrim(p_reason)) not between 5 and 500 then raise exception 'Give a reason of 5 to 500 characters'; end if;
  if p_plan is null or jsonb_typeof(p_plan)<>'object' or exists(select 1 from jsonb_object_keys(p_plan) k where k not in ('title','phase','planned_start','planned_end','actual_start','actual_end','predecessors')) then raise exception 'Invalid schedule fields'; end if;
  select * into next_row from jsonb_populate_record(null::public.project_timeline_items,p_plan);
  if p_key like 'task:%' then
    select c.id,c.pin_id into i_id,p_id from public.pin_checklist_items c join public.pins p on p.id=c.pin_id where c.id::text=substring(p_key from 6) and c.project_id=p_project and p.project_id=p_project and p.category<>'note';
  elsif p_key like 'pin:%' then
    select id into p_id from public.pins p where p.id::text=substring(p_key from 5) and p.project_id=p_project and p.category<>'note' and not exists(select 1 from public.pin_checklist_items c where c.pin_id=p.id);
  elsif p_key ~ '^milestone:[0-9a-f-]{36}$' then
    if char_length(btrim(coalesce(next_row.title,''))) not between 1 and 160 then raise exception 'Enter a milestone title'; end if;
    if next_row.planned_start is null or next_row.planned_start is distinct from next_row.planned_end then raise exception 'A milestone needs one planned date'; end if;
  else raise exception 'Choose an existing work task or milestone'; end if;
  if p_key not like 'milestone:%' and p_id is null then raise exception 'Work task no longer exists in this project'; end if;
  if char_length(btrim(coalesce(next_row.phase,''))) not between 1 and 80 then raise exception 'Enter a phase of 1 to 80 characters'; end if;
  next_row.predecessors:=coalesce(next_row.predecessors,'{}');
  if cardinality(next_row.predecessors)>20 or cardinality(next_row.predecessors)<>(select count(distinct x) from unnest(next_row.predecessors) x) then raise exception 'Choose up to 20 distinct predecessors'; end if;
  foreach dep in array next_row.predecessors loop
    if dep=p_key or next_row.planned_start is null or not exists(select 1 from public.project_timeline_items s where s.project_id=p_project and s.work_key=dep and s.planned_start is not null and s.planned_end<next_row.planned_start) then
      raise exception 'Dependencies must be scheduled in this project and finish before this task starts';
    end if;
  end loop;
  if exists(select 1 from public.project_timeline_items s where s.project_id=p_project and s.work_key<>p_key and p_key=any(s.predecessors) and (next_row.planned_end is null or next_row.planned_end>=s.planned_start)) then raise exception 'This change conflicts with a dependent task. Update its dependencies first.'; end if;
  insert into public.project_timeline_items(project_id,work_key,pin_id,item_id,title,phase,planned_start,planned_end,actual_start,actual_end,predecessors,revision)
    values(p_project,p_key,p_id,i_id,coalesce(btrim(next_row.title),''),btrim(next_row.phase),next_row.planned_start,next_row.planned_end,next_row.actual_start,next_row.actual_end,next_row.predecessors,coalesce(old_row.revision,0)+1)
  on conflict(project_id,work_key) do update set title=excluded.title,phase=excluded.phase,planned_start=excluded.planned_start,planned_end=excluded.planned_end,actual_start=excluded.actual_start,actual_end=excluded.actual_end,predecessors=excluded.predecessors,revision=excluded.revision,updated_at=now();
  insert into public.audit_log(actor_id,action,details) values(auth.uid(),'project_timeline.updated',jsonb_build_object('project_id',p_project,'work_key',p_key,'reason',btrim(p_reason),'before',to_jsonb(old_row),'after',p_plan));
end;
$$;
create function public.save_timeline_item(p_project uuid,p_key text,p_plan jsonb,p_expected integer,p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.can_manage_timeline(p_project) then raise exception 'Only project schedule managers can edit this timeline' using errcode='42501'; end if;
  perform public.write_timeline_item(p_project,p_key,p_plan,p_expected,p_reason);
end;
$$;
create function public.request_timeline_change(p_project uuid,p_key text,p_plan jsonb,p_expected integer,p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare role_name text; rows jsonb;
begin
  if auth.uid() is null or not public.is_active() or not public.can_view_project(p_project) or not exists(select 1 from public.projects where id=p_project and archived_at is null) then raise exception 'Project unavailable' using errcode='42501'; end if;
  select role::text into role_name from public.profiles where id=auth.uid();
  rows:=public.timeline_rows(p_project);
  if role_name not in ('engineer','foreman') or not exists(select 1 from jsonb_array_elements(rows) x where x->>'key'=p_key and x->>'kind'='work') then raise exception 'Request a change only for work you can access' using errcode='42501'; end if;
  if role_name='foreman' and not exists(select 1 from public.pins p where p.id::text=(select row_json.value->>'pin_id' from jsonb_array_elements(rows) as row_json(value) where row_json.value->>'key'=p_key) and public.can_work_on_pin(p.id) and p.id in (select public.scoped_pin_ids(true))) then raise exception 'This work is not assigned to you' using errcode='42501'; end if;
  if p_reason is null or char_length(btrim(p_reason)) not between 5 and 500 then raise exception 'Give a reason of 5 to 500 characters'; end if;
  if p_plan is null or jsonb_typeof(p_plan)<>'object' or pg_column_size(p_plan)>12000 or exists(select 1 from jsonb_object_keys(p_plan) k where k not in ('title','phase','planned_start','planned_end','actual_start','actual_end','predecessors')) then raise exception 'Invalid schedule fields'; end if;
  if p_expected is distinct from coalesce((select revision from public.project_timeline_items where project_id=p_project and work_key=p_key),0) then raise exception 'Schedule changed. Reload before requesting.'; end if;
  if exists(select 1 from jsonb_array_elements_text(coalesce(p_plan->'predecessors','[]')) d where not exists(select 1 from jsonb_array_elements(rows) x where x->>'key'=d)) then raise exception 'Choose a visible predecessor'; end if;
  if exists(select 1 from public.project_timeline_requests where project_id=p_project and work_key=p_key and requested_by=auth.uid() and status='pending') then raise exception 'You already have a pending request for this task'; end if;
  insert into public.project_timeline_requests(project_id,work_key,proposal,expected_revision,reason,requested_by) values(p_project,p_key,p_plan,p_expected,btrim(p_reason),auth.uid());
  insert into public.audit_log(actor_id,action,details) values(auth.uid(),'project_timeline.requested',jsonb_build_object('project_id',p_project,'work_key',p_key,'reason',btrim(p_reason)));
end;
$$;
create function public.review_timeline_change(p_request uuid,p_approve boolean,p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare req public.project_timeline_requests;
begin
  select * into req from public.project_timeline_requests where id=p_request;
  if req.id is null or not public.can_manage_timeline(req.project_id) then raise exception 'Schedule request unavailable' using errcode='42501'; end if;
  perform 1 from public.projects where id=req.project_id for update;
  select * into req from public.project_timeline_requests where id=p_request for update;
  if req.status<>'pending' then raise exception 'This request has already been reviewed'; end if;
  if p_note is null or char_length(btrim(p_note)) not between 5 and 500 then raise exception 'Give a review note of 5 to 500 characters'; end if;
  -- Assignment/access may have been revoked since submission. Do not approve an orphaned request.
  if not exists(select 1 from public.profiles p join public.project_members m on m.user_id=p.id and m.project_id=req.project_id
      where p.id=req.requested_by and p.status='active' and p.role=m.member_role and p.role in ('engineer','foreman')) then raise exception 'Requester no longer has access to this project'; end if;
  if p_approve and not exists (
    select 1 from public.pins pn join public.blueprints b on b.id=pn.blueprint_id join public.profiles pr on pr.id=req.requested_by
    left join public.pin_checklist_items c on c.pin_id=pn.id
    where pn.project_id=req.project_id and (req.work_key='pin:'||pn.id or req.work_key='task:'||c.id)
      and public.blueprint_access_level(req.requested_by,req.project_id,b.blueprint_type)<>'none'
      and (pr.role<>'foreman' or (pn.assigned_to=req.requested_by and public.blueprint_access_level(req.requested_by,req.project_id,b.blueprint_type)='assigned'))
  ) then raise exception 'Requester no longer has access to this work'; end if;
  if p_approve then perform public.write_timeline_item(req.project_id,req.work_key,req.proposal,req.expected_revision,p_note); end if;
  update public.project_timeline_requests set status=case when p_approve then 'approved' else 'rejected' end,reviewed_by=auth.uid(),reviewed_at=now(),review_note=btrim(p_note) where id=p_request;
  insert into public.audit_log(actor_id,action,details) values(auth.uid(),'project_timeline.reviewed',jsonb_build_object('project_id',req.project_id,'request_id',p_request,'approved',p_approve,'note',btrim(p_note)));
end;
$$;
create function public.publish_project_timeline(p_project uuid,p_reason text) returns integer
language plpgsql security definer set search_path = '' as $$
declare rows jsonb; next_version integer;
begin
  if not public.can_manage_timeline(p_project) then raise exception 'Only project schedule managers can publish' using errcode='42501'; end if;
  if p_reason is null or char_length(btrim(p_reason)) not between 5 and 500 then raise exception 'Give a publication reason of 5 to 500 characters'; end if;
  perform 1 from public.projects where id=p_project for update;
  select coalesce(jsonb_agg(x),'[]') into rows from jsonb_array_elements(public.timeline_rows(p_project)) x where x->>'planned_start' is not null and x->>'planned_end' is not null;
  if jsonb_array_length(rows)=0 then raise exception 'Schedule at least one task or milestone before publishing'; end if;
  select coalesce(max(version),0)+1 into next_version from public.project_timeline_publications where project_id=p_project;
  insert into public.project_timeline_publications(project_id,version,snapshot,reason,published_by) values(p_project,next_version,rows,btrim(p_reason),auth.uid());
  insert into public.audit_log(actor_id,action,details) values(auth.uid(),'project_timeline.published',jsonb_build_object('project_id',p_project,'version',next_version,'reason',btrim(p_reason)));
  return next_version;
end;
$$;
revoke all on function public.timeline_rows(uuid), public.write_timeline_item(uuid,text,jsonb,integer,text) from public,anon,authenticated;
revoke all on function public.can_manage_timeline(uuid),public.get_project_timeline(uuid),public.save_timeline_item(uuid,text,jsonb,integer,text),public.request_timeline_change(uuid,text,jsonb,integer,text),public.review_timeline_change(uuid,boolean,text),public.publish_project_timeline(uuid,text) from public,anon;
grant execute on function public.can_manage_timeline(uuid),public.get_project_timeline(uuid),public.save_timeline_item(uuid,text,jsonb,integer,text),public.request_timeline_change(uuid,text,jsonb,integer,text),public.review_timeline_change(uuid,boolean,text),public.publish_project_timeline(uuid,text) to authenticated;
