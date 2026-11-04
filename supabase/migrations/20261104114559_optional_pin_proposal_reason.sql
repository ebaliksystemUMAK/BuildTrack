-- Optional Engineer proposal explanations. Keep PM approval/publication reasons required.
-- No existing records, grants, RLS or official dates are changed.
begin;
alter table public.project_timeline_requests drop constraint project_timeline_requests_reason_check;
alter table public.project_timeline_requests add constraint project_timeline_requests_reason_check check(char_length(reason) between 0 and 500);

create or replace function public.save_pin_schedule_draft(p_pin uuid,p_start date,p_end date,p_phase text,p_reason text,p_expected integer) returns void
language plpgsql security definer set search_path='' as $$
declare pn public.pins; draft public.project_timeline_requests; plan jsonb;
begin
  p_reason:=btrim(coalesce(p_reason,''));
  perform public.get_pin_schedule_proposal(p_pin);
  select * into pn from public.pins where id=p_pin;
  perform 1 from public.projects where id=pn.project_id for update;
  if pn.category='note' or not exists(select 1 from public.projects where id=pn.project_id and archived_at is null and deleted_at is null) then raise exception 'Only open project work can be scheduled'; end if;
  if p_start is null or p_end is null or p_end<p_start or p_start<'1900-01-01' or p_end>'2199-12-31' then raise exception 'Enter a valid proposed start date and deadline'; end if;
  if char_length(btrim(coalesce(p_phase,''))) not between 1 and 80 or char_length(p_reason)>500 then raise exception 'Enter a phase and keep the optional technical reason within 500 characters'; end if;
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

create or replace function public.request_timeline_change(p_project uuid,p_key text,p_plan jsonb,p_expected integer,p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare role_name text; rows jsonb;
begin
  p_reason:=btrim(coalesce(p_reason,''));
  if auth.uid() is null or not public.is_active() or not public.can_view_project(p_project) or not exists(select 1 from public.projects where id=p_project and archived_at is null) then raise exception 'Project unavailable' using errcode='42501'; end if;
  select role::text into role_name from public.profiles where id=auth.uid();
  rows:=public.timeline_rows(p_project);
  if role_name not in ('engineer','foreman') or not exists(select 1 from jsonb_array_elements(rows) x where x->>'key'=p_key and x->>'kind'='work') then raise exception 'Request a change only for work you can access' using errcode='42501'; end if;
  if role_name='foreman' and not exists(select 1 from public.pins p where p.id::text=(select row_json.value->>'pin_id' from jsonb_array_elements(rows) as row_json(value) where row_json.value->>'key'=p_key) and public.can_work_on_pin(p.id) and p.id in (select public.scoped_pin_ids(true))) then raise exception 'This work is not assigned to you' using errcode='42501'; end if;
  if char_length(p_reason)>500 then raise exception 'Keep the optional technical reason within 500 characters'; end if;
  if p_plan is null or jsonb_typeof(p_plan)<>'object' or pg_column_size(p_plan)>12000 or exists(select 1 from jsonb_object_keys(p_plan) k where k not in ('title','phase','planned_start','planned_end','actual_start','actual_end','predecessors')) then raise exception 'Invalid schedule fields'; end if;
  if p_expected is distinct from coalesce((select revision from public.project_timeline_items where project_id=p_project and work_key=p_key),0) then raise exception 'Schedule changed. Reload before requesting.'; end if;
  if exists(select 1 from jsonb_array_elements_text(coalesce(p_plan->'predecessors','[]')) d where not exists(select 1 from jsonb_array_elements(rows) x where x->>'key'=d)) then raise exception 'Choose a visible predecessor'; end if;
  if exists(select 1 from public.project_timeline_requests where project_id=p_project and work_key=p_key and requested_by=auth.uid() and status='pending') then raise exception 'You already have a pending request for this task'; end if;
  insert into public.project_timeline_requests(project_id,work_key,proposal,expected_revision,reason,requested_by) values(p_project,p_key,p_plan,p_expected,btrim(p_reason),auth.uid());
  insert into public.audit_log(actor_id,action,details) values(auth.uid(),'project_timeline.requested',jsonb_build_object('project_id',p_project,'work_key',p_key,'reason',btrim(p_reason)));
end;
$$;

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
  return total;
end;
$$;

commit;
