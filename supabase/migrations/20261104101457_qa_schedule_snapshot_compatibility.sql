-- PM scheduling metadata is not inspected evidence. Adding or approving dates must
-- not invalidate existing passed inspections. Do not rewrite historical snapshots
-- or auto-complete any task; the Engineer still explicitly completes each item.
create or replace function public.review_checklist_item(p_item uuid,p_accept boolean,p_reason text default null) returns void
language plpgsql security definer set search_path='' as $$
declare c public.pin_checklist_items; pn public.pins; s public.pin_qa_submissions; original jsonb;
begin
  select * into c from public.pin_checklist_items where id=p_item;
  select * into pn from public.pins where id=c.pin_id for update;
  select * into c from public.pin_checklist_items where id=p_item for update;
  if c.id is null or not public.can_edit_blueprints(c.project_id) then raise exception 'Only the project Engineer verifies checklist items'; end if;
  if exists(select 1 from public.qa_inspections where id=c.review_inspection_id and status in ('requested','in_progress')) then raise exception 'Finish the pending QA inspection first'; end if;
  if c.review_status='verified' and p_accept then raise exception 'This checklist item is already verified'; end if;
  if p_accept then
    if not c.done or c.review_status<>'for_review' or not exists(select 1 from public.qa_inspections where id=c.review_inspection_id and status='passed') then
      raise exception 'This item must be submitted and pass QA before Engineer verification'; end if;
    if exists(select 1 from public.qa_defects where id in (select public.item_defect_ids(c.id)) and status<>'closed') then
      raise exception 'Close the open NCRs linked to this work item first'; end if;
    select * into s from public.pin_qa_submissions where inspection_id=c.review_inspection_id;
    select x into original from jsonb_array_elements(s.checklist_snapshot) x where x->>'id'=c.id::text;
    -- Preserve compatibility with snapshots predating item-specific QC criteria.
    if original is not null and not (original ? 'qa_template_id') then original:=original||jsonb_build_object('qa_template_id',null); end if;
    -- Strip only review metadata and the two schedule columns on BOTH sides.
    -- All evidence, task identity, criteria and work-pin fields still have to match.
    if original is null or (original-array['review_status','review_inspection_id','verified_by','verified_at','planned_start','due_date']) is distinct from
      (to_jsonb(c)-array['review_status','review_inspection_id','verified_by','verified_at','planned_start','due_date']) or s.work_snapshot<>public.pin_qa_work(c.pin_id) then
      raise exception 'Work changed after inspection; submit again'; end if;
    if not exists(select 1 from public.pin_photos where checklist_item_id=c.id and public.photo_eligible(stamp_flag)) then raise exception 'Eligible photo evidence is required'; end if;
    update public.pin_checklist_items set review_status='verified',verified_by=auth.uid(),verified_at=now() where id=c.id;
  else
    if char_length(btrim(coalesce(p_reason,'')))<5 then raise exception 'Provide a correction reason (at least 5 characters)'; end if;
    update public.pin_checklist_items set review_status='returned',verified_by=null,verified_at=null where id=c.id;
    if pn.status='verified' then update public.pins set status='in_progress' where id=pn.id; end if;
  end if;
  insert into public.pin_events(pin_id,project_id,kind,note) values(c.pin_id,c.project_id,'comment',left(c.text||case when p_accept then ': item verified by Engineer.' else ': returned. '||p_reason end,2000));
  if not (p_accept and public.try_complete_work(c.pin_id))
    and not exists(select 1 from public.pin_checklist_items where pin_id=c.pin_id and review_status='for_review')
    and not exists(select 1 from public.qa_inspections where pin_id=c.pin_id and status in ('requested','in_progress')) then
    update public.pins set status='in_progress' where id=c.pin_id and status='for_review'; end if;
  perform public.notify_user(pn.assigned_to,'qa.item_review',case when p_accept then 'Checklist item verified' else 'Checklist correction required' end,
    left(c.text||coalesce(': '||p_reason,''),500),
    '/foreman/'||case when p_accept then 'quality-control' else 'issues' end||'?project='||c.project_id||'&item='||c.id,c.project_id,c.id);
end; $$;

-- The historical whole-pin path uses the same evidence boundary. Preserve row
-- order and every other field, including criteria, done flags and remarks.
create or replace function public.legacy_pin_qa_verification_problem(p_pin uuid) returns text
language plpgsql stable security definer set search_path='' as $$
declare s public.pin_qa_submissions; state text; original_checklist jsonb; current_checklist jsonb;
begin
  if not public.is_staff() or not exists (select 1 from public.pins where id = p_pin and public.can_view_project(project_id)) then return 'Access denied'; end if;
  if not exists(select 1 from public.pin_checklist_items where pin_id=p_pin) or exists(
    select 1 from public.pin_checklist_items where pin_id=p_pin and not done) then return 'Every checklist item must be completed by the Foreman before the work can be verified'; end if;
  if exists(select 1 from public.pin_checklist_items c where c.pin_id=p_pin and not exists(
    select 1 from public.pin_photos ph where ph.checklist_item_id=c.id)) then return 'Every checklist item requires photo evidence'; end if;
  if exists(select 1 from public.qa_inspections where pin_id=p_pin and status in ('requested','in_progress')) then return 'An inspection of this pin is still open'; end if;
  if exists(select 1 from public.qa_defects where pin_id=p_pin and status<>'closed') then return 'This pin still has open defects (NCRs)'; end if;
  select x.* into s from public.pin_qa_submissions x join public.qa_inspections i on i.id=x.inspection_id
    where x.pin_id=p_pin order by i.number desc limit 1;
  select status into state from public.qa_inspections where id=s.inspection_id;
  if s.id is null or state is distinct from 'passed' or not s.all_complete then return 'A complete work submission must pass Engineer inspection before verification'; end if;
  select jsonb_agg(x.value-array['planned_start','due_date'] order by x.position) into original_checklist
    from jsonb_array_elements(s.checklist_snapshot) with ordinality x(value,position);
  select jsonb_agg(x.value-array['planned_start','due_date'] order by x.position) into current_checklist
    from jsonb_array_elements(public.pin_qa_checklist(p_pin)) with ordinality x(value,position);
  if original_checklist is distinct from current_checklist or s.work_snapshot<>public.pin_qa_work(p_pin) then
    return 'Work changed after inspection; submit again for Engineer inspection'; end if;
  if exists(with recursive resolved as (
    select id,reinspection_of from public.qa_inspections where pin_id=p_pin and status='passed'
    union select i.id,i.reinspection_of from public.qa_inspections i join resolved r on i.id=r.reinspection_of
  ) select 1 from public.qa_inspections i where i.pin_id=p_pin and i.status in ('failed','conditional')
    and not exists(select 1 from resolved r where r.id=i.id)) then return 'A required inspection failed or is conditional; a linked re-inspection must pass'; end if;
  return null;
end; $$;

revoke all on function public.review_checklist_item(uuid,boolean,text) from public,anon;
grant execute on function public.review_checklist_item(uuid,boolean,text) to authenticated;
revoke all on function public.legacy_pin_qa_verification_problem(uuid) from public,anon,authenticated;
