-- Marker placement is layout metadata, not a change to the work or its submitted evidence.
-- Only coordinate-only updates by an active project Engineer get the QA-lock exception.
-- Existing row access, blueprint-type access, movement locks, site controls, history and audit triggers still run.
begin;

create or replace function public.guard_work_qa_config() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if tg_op='UPDATE' and (new.x,new.y) is distinct from (old.x,old.y)
    and (to_jsonb(new)-array['x','y','updated_at']) = (to_jsonb(old)-array['x','y','updated_at'])
    and public.can_edit_blueprints(new.project_id)
    and exists(select 1 from public.profiles where id=auth.uid() and role='engineer' and status='active') then
    return new;
  end if;
  if tg_op='UPDATE' and (new.qa_approved_by,new.qa_approved_at) is distinct from (old.qa_approved_by,old.qa_approved_at) then
    if not public.can_edit_blueprints(new.project_id) then raise exception 'Only the project Engineer approves the QA checklist'; end if;
    new.qa_approved_by:=auth.uid(); new.qa_approved_at:=now();
  end if;
  if (tg_op='INSERT' and new.qa_template_id is not null) or (tg_op='UPDATE' and new.qa_template_id is distinct from old.qa_template_id) then
    if not public.can_edit_blueprints(new.project_id) then raise exception 'Only the project Engineer approves the QA checklist'; end if;
    new.qa_approved_by:=case when new.qa_template_id is not null then auth.uid() end;
    new.qa_approved_at:=case when new.qa_template_id is not null then now() end;
    if new.qa_template_id is not null and not exists(select 1 from public.qa_templates t where t.id=new.qa_template_id and not t.archived
      and (t.project_id is null or t.project_id=new.project_id) and exists(select 1 from public.qa_template_items where template_id=t.id)) then
      raise exception 'Select an available QA checklist with inspection items for this project';
    end if;
    if tg_op='UPDATE' and (old.status='verified' or exists(select 1 from public.qa_inspections where pin_id=old.id and status in ('requested','in_progress'))
       or exists(select 1 from public.pin_checklist_items where pin_id=old.id and review_status='verified')) then
      raise exception 'Reopen reviewed work before changing its approved QA checklist';
    end if;
  end if;
  if tg_op='UPDATE' and exists(select 1 from public.pin_qa_submissions s join public.qa_inspections i on i.id=s.inspection_id
      where s.pin_id=old.id and i.status in ('requested','in_progress')) then
    if new.status<>'for_review' or (to_jsonb(new)-array['status','updated_at','verified_by','verified_at','due_date','severity','locked'])
      is distinct from (to_jsonb(old)-array['status','updated_at','verified_by','verified_at','due_date','severity','locked']) then
      raise exception 'Awaiting Engineer inspection: complete or cancel the inspection before changing this work';
    end if;
  end if;
  if tg_op='UPDATE' and old.status='for_review' and new.status not in ('for_review','verified') and exists(
    select 1 from public.pin_checklist_items where pin_id=old.id and review_status='for_review') then
    raise exception 'Verify or return each submitted checklist item before reopening this work'; end if;
  if tg_op='UPDATE' and old.status='verified' and new.status='verified' and
      (to_jsonb(new)-array['updated_at','due_date','severity','locked']) is distinct from (to_jsonb(old)-array['updated_at','due_date','severity','locked']) then
    raise exception 'The Engineer must reopen completed work before changing it';
  end if;
  return new;
end; $$;

create or replace function public.reset_changed_work_reviews() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  -- Moving only the marker must never return submitted or already verified tasks.
  if (to_jsonb(new)-array['x','y','updated_at']) = (to_jsonb(old)-array['x','y','updated_at']) then
    return new;
  end if;
  if (new.title,new.description,new.assigned_to,new.blueprint_id,new.revision_id,new.qa_template_id,new.x,new.y,new.category,new.discipline)
      is distinct from (old.title,old.description,old.assigned_to,old.blueprint_id,old.revision_id,old.qa_template_id,old.x,old.y,old.category,old.discipline)
    or (old.status='verified' and new.status<>'verified' and not exists(select 1 from public.pin_checklist_items where pin_id=new.id and review_status='returned')) then
    update public.pin_checklist_items set review_status='returned',verified_by=null,verified_at=null
      where pin_id=new.id and review_status in ('verified','for_review');
  end if;
  return new;
end; $$;

-- Keep historical snapshots untouched. Compare inspected work without marker coordinates
-- when completing a task, checking a legacy whole-pin submission or resuming an inspection.
-- Every identity, assignment, criteria and evidence comparison is otherwise retained.
do $$
declare target record; definition text;
begin
  for target in select * from (values
    ('public.review_checklist_item(uuid,boolean,text)',
      's.work_snapshot<>public.pin_qa_work(c.pin_id)',
      '(s.work_snapshot-array[''x'',''y'']) is distinct from (public.pin_qa_work(c.pin_id)-array[''x'',''y''])'),
    ('public.legacy_pin_qa_verification_problem(uuid)',
      's.work_snapshot<>public.pin_qa_work(p_pin)',
      '(s.work_snapshot-array[''x'',''y'']) is distinct from (public.pin_qa_work(p_pin)-array[''x'',''y''])'),
    ('public.start_inspection(uuid)',
      's.work_snapshot is distinct from public.pin_qa_work(i.pin_id)',
      '(s.work_snapshot-array[''x'',''y'']) is distinct from (public.pin_qa_work(i.pin_id)-array[''x'',''y''])')
  ) as changes(signature,previous,replacement) loop
    definition:=pg_get_functiondef(target.signature::regprocedure);
    if strpos(definition,target.previous)=0 then
      raise exception 'Unexpected work snapshot comparison in %',target.signature;
    end if;
    execute replace(definition,target.previous,target.replacement);
  end loop;
end; $$;

commit;
