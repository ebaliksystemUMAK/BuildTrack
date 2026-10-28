-- Resume the same request, never rewrite its submitted evidence or recorded checks.
-- Reuse the Engineer-only RPC and its existing authenticated-only grant.
create or replace function public.start_inspection(p_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare
  i public.qa_inspections; s public.pin_qa_submissions; c public.pin_checklist_items;
  d public.qa_defects; original jsonb; selected uuid[]; event_note text;
  lifecycle text[] := array['review_status','review_inspection_id','verified_by','verified_at'];
begin
  select * into i from public.qa_inspections where id=p_id;
  if i.id is null or not public.can_edit_blueprints(i.project_id) then
    raise exception 'Inspection not found or you are not allowed to start it'; end if;
  -- Match work submission/correction lock order. Re-read after locking the parent.
  if i.pin_id is not null then
    perform 1 from public.pins where id=i.pin_id for update;
  else
    perform 1 from public.projects where id=i.project_id for update;
  end if;
  select * into i from public.qa_inspections where id=p_id for update;
  if i.status not in ('requested','cancelled') then
    raise exception 'Only a requested or cancelled inspection can be started'; end if;
  if i.status='requested' then
    update public.qa_inspections set status='in_progress',inspector_id=auth.uid(),started_at=now(),updated_at=now() where id=i.id;
    return;
  end if;

  if exists(select 1 from public.pins where id=i.pin_id and status='verified') then
    raise exception 'This work is already completed; use its current inspection instead'; end if;
  select * into s from public.pin_qa_submissions where inspection_id=i.id;
  if s.id is not null then
    selected:=coalesce(s.item_ids,(select array_agg((x->>'id')::uuid) from jsonb_array_elements(s.checklist_snapshot) x where (x->>'done')::boolean));
    if coalesce(cardinality(selected),0)=0 or s.work_snapshot is distinct from public.pin_qa_work(i.pin_id) then
      raise exception 'Work changed after cancellation; use a new submission instead'; end if;
    if (select count(*) from public.pin_checklist_items where id=any(selected) and pin_id=i.pin_id)<>cardinality(selected) then
      raise exception 'Submitted checklist changed; use a new submission instead'; end if;
    for c in select * from public.pin_checklist_items where id=any(selected) order by id for update loop
      select x into original from jsonb_array_elements(s.checklist_snapshot) x where x->>'id'=c.id::text;
      if original is not null and not(original ? 'qa_template_id') then original:=original||jsonb_build_object('qa_template_id',null); end if;
      if original is null or (original-lifecycle) is distinct from (to_jsonb(c)-lifecycle)
        or c.review_status='verified' or c.review_inspection_id is distinct from i.id then
        raise exception 'Checklist changed or a newer submission exists; continue the current request instead'; end if;
      if exists(select 1 from public.qa_work_attempts a where a.item_id=c.id and a.submitted_inspection_id is null) then
        raise exception 'A newer correction draft exists; finish and submit that correction instead'; end if;
    end loop;
  else
    -- Stage requests have no frozen work submission. Never revive a superseded stage.
    if exists(select 1 from public.qa_inspections newer where newer.project_id=i.project_id and newer.number>i.number and
      ((i.pin_id is not null and newer.pin_id=i.pin_id) or
       (i.pin_id is null and newer.pin_id is null and newer.template_id is not distinct from i.template_id
        and newer.title=i.title and newer.location is not distinct from i.location))) then
      raise exception 'A newer inspection exists; continue the current request instead'; end if;
  end if;

  -- Only reverse the exact cancellation return. A later NCR decision is not undone.
  for d in select finding.* from public.qa_defects finding join public.qa_work_attempts a on a.id=finding.correction_attempt_id
    where a.submitted_inspection_id=i.id and finding.project_id=i.project_id and finding.pin_id=i.pin_id
    order by finding.number for update of finding loop
    select e.note into event_note from public.qa_defect_events e where e.defect_id=d.id order by e.id desc limit 1;
    if d.status<>'in_progress' or event_note is null or event_note not like
      ('Reinspection IR-'||lpad(i.number::text,4,'0')||' cancelled.%') then
      raise exception 'A linked NCR changed after cancellation; submit a fresh correction instead'; end if;
  end loop;

  -- Existing open-request triggers also reject overlapping work/stage requests.
  update public.qa_inspections set status='in_progress',inspector_id=auth.uid(),
    started_at=coalesce(started_at,now()),completed_at=null,summary=null,updated_at=now() where id=i.id;
  if s.id is not null then
    update public.pin_checklist_items set review_status='for_review',review_inspection_id=i.id,verified_by=null,verified_at=null where id=any(selected);
    update public.pins set status='for_review' where id=i.pin_id;
  end if;
  for d in select finding.* from public.qa_defects finding join public.qa_work_attempts a on a.id=finding.correction_attempt_id
    where a.submitted_inspection_id=i.id and finding.project_id=i.project_id and finding.pin_id=i.pin_id order by finding.number loop
    update public.qa_defects set status='for_verification',fixed_at=s.submitted_at,fixed_by=s.submitted_by,updated_at=now() where id=d.id;
    insert into public.qa_defect_events(defect_id,project_id,actor_id,kind,from_status,to_status,note)
      values(d.id,d.project_id,auth.uid(),'status',d.status,'for_verification',
        'Cancelled reinspection IR-'||lpad(i.number::text,4,'0')||' continued by Engineer; original correction evidence retained.');
  end loop;
  insert into public.qa_inspection_events(project_id,inspection_id,actor_id,kind,note)
    values(i.project_id,i.id,auth.uid(),'resumed','Cancelled inspection continued; recorded checks and evidence retained. Previous cancellation: '||coalesce(i.summary,'Not recorded'));
  if i.pin_id is not null then
    insert into public.pin_events(pin_id,project_id,kind,note) values(i.pin_id,i.project_id,'comment',
      'Engineer continued cancelled inspection IR-'||lpad(i.number::text,4,'0')||'; original evidence retained.');
  end if;
end; $$;
revoke all on function public.start_inspection(uuid) from public,anon;
grant execute on function public.start_inspection(uuid) to authenticated;
