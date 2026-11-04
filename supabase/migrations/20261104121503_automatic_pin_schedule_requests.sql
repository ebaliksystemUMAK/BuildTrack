-- Add Pin sends its proposed schedule atomically. PM remains the only approval authority.
begin;
alter table public.project_timeline_requests add column auto_task_proposals boolean not null default false;
alter table public.project_timeline_requests drop constraint project_timeline_requests_status_check;
alter table public.project_timeline_requests add constraint project_timeline_requests_status_check check(status in ('draft','pending','approved','rejected','superseded'));
create index timeline_auto_pin_requests_idx on public.project_timeline_requests(project_id,work_key,requested_by,created_at desc) where auto_task_proposals;

create or replace function public.submit_pin_schedule_proposal(p_pin uuid,p_start date,p_end date,p_phase text,p_reason text,p_expected integer) returns integer
language plpgsql security definer set search_path='' as $$
declare pn public.pins; row record; pending public.project_timeline_requests; plan jsonb; total integer:=0;
begin
  p_reason:=btrim(coalesce(p_reason,''));
  perform public.save_pin_schedule_draft(p_pin,p_start,p_end,p_phase,p_reason,p_expected);
  select * into pn from public.pins where id=p_pin;
  for row in
    select 'task:'||c.id key,c.text title from public.pin_checklist_items c where c.pin_id=p_pin
    union all select 'pin:'||p_pin,pn.title where not exists(select 1 from public.pin_checklist_items c where c.pin_id=p_pin)
  loop
    select jsonb_build_object('title',row.title,'phase',btrim(p_phase),'planned_start',p_start,'planned_end',p_end,
      'actual_start',s.actual_start,'actual_end',s.actual_end,'predecessors',coalesce(to_jsonb(s.predecessors),'[]'::jsonb)) into plan
      from (select 1) one left join public.project_timeline_items s on s.project_id=pn.project_id and s.work_key=row.key;
    select * into pending from public.project_timeline_requests where project_id=pn.project_id and work_key=row.key and requested_by=auth.uid() and status='pending' for update;
    if pending.id is not null then
      update public.project_timeline_requests set proposal=plan,reason=btrim(p_reason),expected_revision=coalesce((select revision from public.project_timeline_items where project_id=pn.project_id and work_key=row.key),0) where id=pending.id;
      insert into public.audit_log(actor_id,action,details) values(auth.uid(),'project_timeline.proposal_updated',jsonb_build_object('project_id',pn.project_id,'request_id',pending.id,'before',pending.proposal,'after',plan));
    else
      perform public.request_timeline_change(pn.project_id,row.key,plan,coalesce((select revision from public.project_timeline_items where project_id=pn.project_id and work_key=row.key),0),p_reason);
    end if;
    total:=total+1;
  end loop;
  -- A sent pin schedule is a template for approval requests on later tasks.
  if not exists(select 1 from public.pin_checklist_items where pin_id=p_pin) then
    update public.project_timeline_requests set auto_task_proposals=true
      where project_id=pn.project_id and work_key='pin:'||p_pin and requested_by=auth.uid() and status='pending';
  end if;
  return total;
end;
$$;

create or replace function public.create_pin_with_schedule_proposal(p_blueprint uuid,p_revision uuid,p_x numeric,p_y numeric,p_title text,p_category public.pin_category,p_start date default null,p_end date default null,p_phase text default 'Unassigned',p_reason text default '') returns public.pins
language plpgsql security invoker set search_path='' as $$
declare pn public.pins; bp public.blueprints;
begin
  select * into bp from public.blueprints where id=p_blueprint;
  if bp.id is null or not public.can_edit_blueprints(bp.project_id) then raise exception 'Only the project Engineer can add work pins' using errcode='42501'; end if;
  if not exists(select 1 from public.projects where id=bp.project_id and archived_at is null and deleted_at is null) then raise exception 'Project is read-only'; end if;
  insert into public.pins(project_id,blueprint_id,revision_id,x,y,title,category,discipline) values(bp.project_id,bp.id,p_revision,p_x,p_y,p_title,p_category,bp.discipline) returning * into pn;
  if p_start is not null or p_end is not null then perform public.submit_pin_schedule_proposal(pn.id,p_start,p_end,p_phase,p_reason,0); end if;
  return pn;
end;
$$;

-- Authorized new tasks inherit requests from a sent pin template, retaining its requester.
-- The inserting Engineer never receives another author's private proposal or explanation.
create function public.request_new_task_schedule() returns trigger
language plpgsql security definer set search_path='' as $$
declare source public.project_timeline_requests; plan jsonb;
begin
  if auth.uid() is null or not public.is_active() or not public.can_edit_blueprints(new.project_id)
    or not public.can_view_project(new.project_id) or new.pin_id not in(select public.scoped_pin_ids(true)) then return new; end if;
  if not exists(select 1 from public.project_timeline_requests r where r.project_id=new.project_id and r.work_key='pin:'||new.pin_id
    and r.auto_task_proposals and r.status in ('pending','approved','superseded')) then return new; end if;
  perform 1 from public.projects where id=new.project_id for update;
  select * into source from public.project_timeline_requests r where r.project_id=new.project_id and r.work_key='pin:'||new.pin_id
    and r.auto_task_proposals and r.status in ('pending','approved','superseded')
    order by r.created_at desc,r.id desc limit 1 for update;
  if source.id is null then return new; end if;
  if not exists(select 1 from public.profiles pr join public.pins pn on pn.id=new.pin_id
    join public.blueprints b on b.id=pn.blueprint_id where pr.id=source.requested_by and pr.status='active' and pr.role='engineer'
      and public.blueprint_access_level(pr.id,new.project_id,b.blueprint_type)='assigned') then return new; end if;
  plan:=jsonb_set(coalesce(source.approved_plan,source.proposal),'{title}',to_jsonb(new.text));
  perform public.request_timeline_change(new.project_id,'task:'||new.id,plan,0,source.reason);
  update public.project_timeline_requests set requested_by=source.requested_by
    where project_id=new.project_id and work_key='task:'||new.id and requested_by=auth.uid() and status='pending';
  -- Keep the original proposal and its author/history. This is not a PM rejection or approval.
  update public.project_timeline_requests set status='superseded' where id=source.id and status='pending';
  insert into public.audit_log(actor_id,action,details) values(auth.uid(),'project_timeline.auto_task_requested',
    jsonb_build_object('project_id',new.project_id,'pin_id',new.pin_id,'item_id',new.id,'source_request_id',source.id,'source_status',source.status,'requested_by',source.requested_by));
  return new;
end;
$$;
revoke all on function public.request_new_task_schedule() from public,anon,authenticated;
create trigger zz_request_new_task_schedule after insert on public.pin_checklist_items for each row execute function public.request_new_task_schedule();
commit;
