-- Engineers propose; assigned Project Managers own the approved schedule. No QA states change.
alter table public.pins add column planned_start date;
alter table public.pin_checklist_items add column planned_start date, add column due_date date;

-- Dates are scheduling metadata, not QA evidence. Keep every existing evidence check intact.
create or replace function public.guard_work_evidence() returns trigger
language plpgsql security definer set search_path='' as $$
declare pid uuid; cid uuid; pn public.pins; c public.pin_checklist_items; review_only boolean:=false; photo_id uuid;
begin
  pid:=case when tg_op='DELETE' then old.pin_id else new.pin_id end;
  select * into pn from public.pins where id=pid for update;
  if tg_table_name='pin_checklist_items' then
    cid:=case when tg_op='DELETE' then old.id else new.id end;
    if tg_op='UPDATE' then
      review_only:=(to_jsonb(new)-array['review_status','review_inspection_id','verified_by','verified_at','planned_start','due_date'])=(to_jsonb(old)-array['review_status','review_inspection_id','verified_by','verified_at','planned_start','due_date']);
      if not review_only and old.review_status='verified' then raise exception 'Reopen the checklist item before changing verified evidence'; end if;
      if not review_only and old.review_status='for_review' then raise exception 'Awaiting Engineer inspection: this checklist item and its evidence are locked'; end if;
      if not review_only and (new.done is distinct from old.done or new.text is distinct from old.text or new.remark is distinct from old.remark) then
        new.review_status:=case when old.review_inspection_id is null then 'not_submitted' else 'returned' end;
        new.review_inspection_id:=old.review_inspection_id; new.verified_at:=null; new.verified_by:=null;
      end if;
    end if;
  else
    cid:=case when tg_op='DELETE' then old.checklist_item_id else new.checklist_item_id end;
    if tg_op='UPDATE' and (new.checklist_item_id,new.qa_attempt_id) is distinct from (old.checklist_item_id,old.qa_attempt_id) then
      raise exception 'Evidence cannot move between checklist items or attempts'; end if;
    if tg_op in ('UPDATE','DELETE') then
      photo_id:=old.id;
      if exists(select 1 from public.pin_qa_submissions s,jsonb_array_elements(s.photos_snapshot) ph where s.pin_id=pid and ph->>'id'=photo_id::text) then
        raise exception 'Submitted photo evidence is immutable'; end if;
    end if;
  end if;
  select * into c from public.pin_checklist_items where id=cid;
  if not review_only and (pn.status='verified' or (cid is null and pn.status='for_review') or c.review_status in ('for_review','verified')) then
    raise exception 'Awaiting Engineer inspection or verified: this item and its evidence are locked'; end if;
  if not review_only and cid is not null and exists(select 1 from public.qa_inspections i join public.pin_qa_submissions s on s.inspection_id=i.id
    where i.pin_id=pid and i.status in ('requested','in_progress') and (cid=any(s.item_ids) or (s.item_ids is null and exists(
      select 1 from jsonb_array_elements(s.checklist_snapshot) x where x->>'id'=cid::text and (x->>'done')::boolean)))) then
    raise exception 'Awaiting Engineer inspection: this checklist item is locked'; end if;
  if tg_op='UPDATE' and new.pin_id is distinct from old.pin_id then raise exception 'Evidence cannot move between work items'; end if;
  if tg_op='DELETE' and tg_table_name='pin_checklist_items' and exists(select 1 from public.pin_qa_submissions s,jsonb_array_elements(s.checklist_snapshot) x
    where s.pin_id=pid and x->>'id'=old.id::text) then raise exception 'Submitted checklist history cannot be deleted'; end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end; $$;

create or replace function public.timeline_rows(p_project uuid) returns jsonb
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
      coalesce(c.text,p.title) title, b.title location, case when c.id is null then p.due_date else c.due_date end due_date,
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
-- Preserve existing inherited deadlines without inventing task starts or accepting a schedule.
update public.pin_checklist_items c set due_date=p.due_date from public.pins p where p.id=c.pin_id and p.due_date is not null;
alter table public.project_timeline_requests add column approved_plan jsonb;
alter table public.project_timeline_requests drop constraint project_timeline_requests_status_check;
alter table public.project_timeline_requests add constraint project_timeline_requests_status_check check(status in ('draft','pending','approved','rejected'));

create or replace function public.can_manage_timeline(p_project uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and public.is_active() and public.can_view_project(p_project)
    and (public.is_super_admin() or public.is_project_manager(p_project))
    and exists(select 1 from public.projects where id=p_project and archived_at is null and deleted_at is null);
$$;

-- Effective database role, not a caller-set flag: ordinary API updates cannot forge official dates.
-- Checked SECURITY DEFINER schedule entry points perform the synchronized updates as the owner.
create function public.guard_official_schedule_dates() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if current_user in ('authenticated','anon') and
    ((tg_op='INSERT' and (new.planned_start is not null or new.due_date is not null)) or
     (tg_op='UPDATE' and (new.planned_start,new.due_date) is distinct from (old.planned_start,old.due_date))) then
    raise exception 'Official dates are set through Project Manager schedule approval. Propose dates instead.' using errcode='42501';
  end if;
  return new;
end;
$$;
create trigger aa_official_dates before insert or update on public.pins for each row execute function public.guard_official_schedule_dates();
create trigger aa_official_dates before insert or update on public.pin_checklist_items for each row execute function public.guard_official_schedule_dates();

create function public.sync_approved_schedule_dates() returns trigger
language plpgsql security definer set search_path='' as $$
declare p_id uuid; first_day date; last_day date;
begin
  p_id:=coalesce(new.pin_id,old.pin_id);
  if p_id is null then return null; end if;
  if tg_op<>'DELETE' and new.item_id is not null then
    update public.pin_checklist_items set planned_start=new.planned_start,due_date=new.planned_end
      where id=new.item_id and pin_id=p_id and project_id=new.project_id;
  end if;
  if exists(select 1 from public.pin_checklist_items where pin_id=p_id) then
    select min(c.planned_start),max(c.due_date) into first_day,last_day
      from public.pin_checklist_items c where c.pin_id=p_id and c.planned_start is not null;
  else
    select planned_start,planned_end into first_day,last_day from public.project_timeline_items where pin_id=p_id and work_key='pin:'||p_id;
  end if;
  -- A pin covers the range of its approved task schedules; its tasks retain their individual dates.
  update public.pins set planned_start=first_day,due_date=last_day where id=p_id and
    (planned_start,due_date) is distinct from (first_day,last_day);
  return null;
end;
$$;
create trigger timeline_dates_sync after insert or update or delete on public.project_timeline_items for each row execute function public.sync_approved_schedule_dates();
-- Synchronize schedules already approved through the existing PM Gantt workflow.
update public.pin_checklist_items c set planned_start=s.planned_start,due_date=s.planned_end from public.project_timeline_items s where s.item_id=c.id;
update public.pins p set planned_start=q.first_day,due_date=q.last_day from (
  select s.pin_id,min(s.planned_start) first_day,max(s.planned_end) last_day from public.project_timeline_items s
  where s.pin_id is not null and s.planned_start is not null group by s.pin_id
) q where p.id=q.pin_id;

-- Draft proposals live in the existing private request table, not in client-readable pins.
create function public.get_pin_schedule_proposal(p_pin uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare pn public.pins; draft public.project_timeline_requests;
begin
  select * into pn from public.pins where id=p_pin;
  if auth.uid() is null or not public.is_active() or pn.id is null or not public.can_edit_blueprints(pn.project_id)
    or not public.can_view_project(pn.project_id) or pn.id not in(select public.scoped_pin_ids(true)) then
    raise exception 'Schedule proposal unavailable' using errcode='42501';
  end if;
  select * into draft from public.project_timeline_requests where project_id=pn.project_id and work_key='pin:'||p_pin and requested_by=auth.uid() and status='draft';
  return jsonb_build_object('draft',case when draft.id is not null then to_jsonb(draft) end,
    'can_propose',exists(select 1 from public.projects where id=pn.project_id and archived_at is null and deleted_at is null),
    'pending',(select count(*) from public.project_timeline_requests r where r.project_id=pn.project_id and r.requested_by=auth.uid() and r.status='pending' and (r.work_key='pin:'||p_pin or r.work_key in(select 'task:'||c.id from public.pin_checklist_items c where c.pin_id=p_pin))));
end;
$$;
create function public.save_pin_schedule_draft(p_pin uuid,p_start date,p_end date,p_phase text,p_reason text,p_expected integer) returns void
language plpgsql security definer set search_path='' as $$
declare pn public.pins; draft public.project_timeline_requests; plan jsonb;
begin
  perform public.get_pin_schedule_proposal(p_pin);
  select * into pn from public.pins where id=p_pin;
  perform 1 from public.projects where id=pn.project_id for update;
  if pn.category='note' or not exists(select 1 from public.projects where id=pn.project_id and archived_at is null and deleted_at is null) then raise exception 'Only open project work can be scheduled'; end if;
  if p_start is null or p_end is null or p_end<p_start or p_start<'1900-01-01' or p_end>'2199-12-31' then raise exception 'Enter a valid proposed start date and deadline'; end if;
  if char_length(btrim(coalesce(p_phase,''))) not between 1 and 80 or char_length(btrim(coalesce(p_reason,''))) not between 5 and 500 then raise exception 'Enter a phase and a reason of 5 to 500 characters'; end if;
  select * into draft from public.project_timeline_requests where project_id=pn.project_id and work_key='pin:'||p_pin and requested_by=auth.uid() and status='draft' for update;
  if p_expected is distinct from coalesce(draft.expected_revision,0) then raise exception 'This proposal changed. Reload before saving.'; end if;
  plan:=jsonb_build_object('title',pn.title,'phase',btrim(p_phase),'planned_start',p_start,'planned_end',p_end,'actual_start',null,'actual_end',null,'predecessors','[]'::jsonb);
  if draft.id is null then
    insert into public.project_timeline_requests(project_id,work_key,proposal,expected_revision,reason,requested_by,status) values(pn.project_id,'pin:'||p_pin,plan,1,btrim(p_reason),auth.uid(),'draft');
  else
    update public.project_timeline_requests set proposal=plan,reason=btrim(p_reason),expected_revision=expected_revision+1 where id=draft.id;
  end if;
end;
$$;
create function public.create_pin_with_schedule_proposal(p_blueprint uuid,p_revision uuid,p_x numeric,p_y numeric,p_title text,p_category public.pin_category,p_start date default null,p_end date default null,p_phase text default 'Unassigned',p_reason text default '') returns public.pins
language plpgsql security invoker set search_path='' as $$
declare pn public.pins; bp public.blueprints;
begin
  select * into bp from public.blueprints where id=p_blueprint;
  if bp.id is null or not public.can_edit_blueprints(bp.project_id) then raise exception 'Only the project Engineer can add work pins' using errcode='42501'; end if;
  if not exists(select 1 from public.projects where id=bp.project_id and archived_at is null and deleted_at is null) then raise exception 'Project is read-only'; end if;
  insert into public.pins(project_id,blueprint_id,revision_id,x,y,title,category,discipline) values(bp.project_id,bp.id,p_revision,p_x,p_y,p_title,p_category,bp.discipline) returning * into pn;
  if p_start is not null or p_end is not null then perform public.save_pin_schedule_draft(pn.id,p_start,p_end,p_phase,p_reason,0); end if;
  return pn;
end;
$$;
create function public.submit_pin_schedule_proposal(p_pin uuid,p_start date,p_end date,p_phase text,p_reason text,p_expected integer) returns integer
language plpgsql security definer set search_path='' as $$
declare pn public.pins; row record; pending public.project_timeline_requests; plan jsonb; total integer:=0;
begin
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
  return total;
end;
$$;

-- PM may adjust a proposal before approving it; the Engineer's original proposal is retained.
create function public.decide_timeline_request(p_request uuid,p_approve boolean,p_note text,p_plan jsonb default null) returns void
language plpgsql security definer set search_path='' as $$
declare req public.project_timeline_requests; approved jsonb;
begin
  select * into req from public.project_timeline_requests where id=p_request;
  if req.id is null or not public.can_manage_timeline(req.project_id) then raise exception 'Schedule request unavailable. Only the assigned Project Manager can review.' using errcode='42501'; end if;
  perform 1 from public.projects where id=req.project_id for update;
  select * into req from public.project_timeline_requests where id=p_request for update;
  if req.status<>'pending' then raise exception 'This request has already been reviewed or is only a draft'; end if;
  if p_note is null or char_length(btrim(p_note)) not between 5 and 500 then raise exception 'Give a review note of 5 to 500 characters'; end if;
  if p_approve and not exists (
    select 1 from public.pins pn join public.blueprints b on b.id=pn.blueprint_id join public.profiles pr on pr.id=req.requested_by
    join public.project_members m on m.project_id=pn.project_id and m.user_id=pr.id and m.member_role=pr.role
    left join public.pin_checklist_items c on c.pin_id=pn.id
    where pn.project_id=req.project_id and pr.status='active' and pr.role in ('engineer','foreman')
      and (req.work_key='pin:'||pn.id or req.work_key='task:'||c.id)
      and public.blueprint_access_level(pr.id,req.project_id,b.blueprint_type)<>'none'
      and (pr.role<>'foreman' or (pn.assigned_to=pr.id and public.blueprint_access_level(pr.id,req.project_id,b.blueprint_type)='assigned'))
  ) then raise exception 'Requester no longer has access to this work'; end if;
  approved:=coalesce(p_plan,req.proposal);
  if p_approve then perform public.write_timeline_item(req.project_id,req.work_key,approved,req.expected_revision,p_note); end if;
  update public.project_timeline_requests set status=case when p_approve then 'approved' else 'rejected' end,approved_plan=case when p_approve then approved end,reviewed_by=auth.uid(),reviewed_at=now(),review_note=btrim(p_note) where id=p_request;
  insert into public.audit_log(actor_id,action,details) values(auth.uid(),'project_timeline.reviewed',jsonb_build_object('project_id',req.project_id,'request_id',p_request,'approved',p_approve,'proposal',req.proposal,'approved_plan',case when p_approve then approved end,'note',btrim(p_note)));
end;
$$;
create or replace function public.review_timeline_change(p_request uuid,p_approve boolean,p_note text) returns void
language plpgsql security definer set search_path='' as $$
begin perform public.decide_timeline_request(p_request,p_approve,p_note,null); end;
$$;

revoke all on function public.guard_official_schedule_dates(),public.sync_approved_schedule_dates() from public,anon,authenticated;
revoke all on function public.get_pin_schedule_proposal(uuid),public.save_pin_schedule_draft(uuid,date,date,text,text,integer),public.create_pin_with_schedule_proposal(uuid,uuid,numeric,numeric,text,public.pin_category,date,date,text,text),public.submit_pin_schedule_proposal(uuid,date,date,text,text,integer),public.decide_timeline_request(uuid,boolean,text,jsonb) from public,anon;
grant execute on function public.get_pin_schedule_proposal(uuid),public.save_pin_schedule_draft(uuid,date,date,text,text,integer),public.create_pin_with_schedule_proposal(uuid,uuid,numeric,numeric,text,public.pin_category,date,date,text,text),public.submit_pin_schedule_proposal(uuid,date,date,text,text,integer),public.decide_timeline_request(uuid,boolean,text,jsonb) to authenticated;

create or replace function public.get_project_timeline(p_project uuid) returns jsonb
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
    where r.status<>'draft' and r.project_id=p_project and (can_edit or r.requested_by=auth.uid())
      and exists(select 1 from jsonb_array_elements(rows) x where x->>'key'=r.work_key);
  return jsonb_build_object('items',rows,'baseline',baseline,'requests',requests,'can_edit',can_edit,
    'can_request',role_name in ('engineer','foreman') and exists(select 1 from public.projects where id=p_project and archived_at is null),
    'version',coalesce(latest.version,0),'published_at',latest.published_at);
end;
$$;
