-- Approval and publication explanations are optional. PM decisions remain explicit and audited.
begin;
alter table public.project_timeline_publications drop constraint project_timeline_publications_reason_check;
alter table public.project_timeline_publications add constraint project_timeline_publications_reason_check check(char_length(reason) between 0 and 500);

create or replace function public.write_timeline_item(p_project uuid,p_key text,p_plan jsonb,p_expected integer,p_reason text) returns void
language plpgsql set search_path = '' as $$
declare old_row public.project_timeline_items; next_row public.project_timeline_items; p_id uuid; i_id uuid; dep text;
begin
  p_reason:=btrim(coalesce(p_reason,''));
  perform 1 from public.projects where id=p_project for update;
  select * into old_row from public.project_timeline_items where project_id=p_project and work_key=p_key;
  if p_expected is distinct from coalesce(old_row.revision,0) then raise exception 'Schedule changed. Reload before saving or reviewing this request.'; end if;
  if char_length(p_reason)>500 then raise exception 'Keep the schedule reason within 500 characters'; end if;
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

create or replace function public.save_timeline_item(p_project uuid,p_key text,p_plan jsonb,p_expected integer,p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.can_manage_timeline(p_project) then raise exception 'Only project schedule managers can edit this timeline' using errcode='42501'; end if;
  if p_reason is null or char_length(btrim(p_reason)) not between 5 and 500 then raise exception 'Give a reason of 5 to 500 characters'; end if;
  perform public.write_timeline_item(p_project,p_key,p_plan,p_expected,p_reason);
end;
$$;

create or replace function public.decide_timeline_request(p_request uuid,p_approve boolean,p_note text,p_plan jsonb default null) returns void
language plpgsql security definer set search_path='' as $$
declare req public.project_timeline_requests; approved jsonb;
begin
  p_note:=btrim(coalesce(p_note,''));
  select * into req from public.project_timeline_requests where id=p_request;
  if req.id is null or not public.can_manage_timeline(req.project_id) then raise exception 'Schedule request unavailable. Only the assigned Project Manager can review.' using errcode='42501'; end if;
  perform 1 from public.projects where id=req.project_id for update;
  select * into req from public.project_timeline_requests where id=p_request for update;
  if req.status<>'pending' then raise exception 'This request has already been reviewed or is only a draft'; end if;
  if char_length(p_note)>500 or (p_approve is not true and char_length(p_note)<5) then raise exception 'Approval reason is optional (maximum 500 characters); rejection needs a review note of 5 to 500 characters'; end if;
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

create or replace function public.publish_project_timeline(p_project uuid,p_reason text) returns integer
language plpgsql security definer set search_path = '' as $$
declare rows jsonb; next_version integer;
begin
  p_reason:=btrim(coalesce(p_reason,''));
  if not public.can_manage_timeline(p_project) then raise exception 'Only project schedule managers can publish' using errcode='42501'; end if;
  if char_length(p_reason)>500 then raise exception 'Keep the optional publication reason within 500 characters'; end if;
  perform 1 from public.projects where id=p_project for update;
  select coalesce(jsonb_agg(x),'[]') into rows from jsonb_array_elements(public.timeline_rows(p_project)) x where x->>'planned_start' is not null and x->>'planned_end' is not null;
  if jsonb_array_length(rows)=0 then raise exception 'Schedule at least one task or milestone before publishing'; end if;
  select coalesce(max(version),0)+1 into next_version from public.project_timeline_publications where project_id=p_project;
  insert into public.project_timeline_publications(project_id,version,snapshot,reason,published_by) values(p_project,next_version,rows,btrim(p_reason),auth.uid());
  insert into public.audit_log(actor_id,action,details) values(auth.uid(),'project_timeline.published',jsonb_build_object('project_id',p_project,'version',next_version,'reason',btrim(p_reason)));
  return next_version;
end;
$$;

commit;
