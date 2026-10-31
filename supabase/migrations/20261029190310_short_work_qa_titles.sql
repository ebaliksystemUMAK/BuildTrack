-- Pins allow two-character area names (for example CR), while inspection titles
-- require at least three trimmed characters. Normalize only the internal generated
-- title so both first submissions and correction packages satisfy that constraint.
-- Keep the pin name, public RPC signatures, evidence checks and grants unchanged.
create or replace function public.request_work_item_inspection(p_project uuid, p_template uuid, p_title text, p_pin uuid, p_items uuid[], p_note text)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  t public.qa_templates;
  v_id uuid;
  v_title text;
  n integer;
  r record;
begin
  if not public.can_work_on_pin(p_pin) then raise exception 'Only the assigned active Foreman submits checklist QA'; end if;
  if not public.can_report_on_project(p_project) then raise exception 'You are not allowed to request inspections on this project'; end if;
  select * into t from public.qa_templates where id = p_template and not archived and (project_id is null or project_id = p_project);
  if t.id is null then raise exception 'That checklist is not available for this project'; end if;
  if p_pin is not null and not exists (select 1 from public.pins where id = p_pin and project_id = p_project) then raise exception 'That pin is not part of this project'; end if;
  v_title := left(btrim(coalesce(p_title, '')), 160);
  if char_length(v_title) < 3 then
    v_title := 'QA inspection' || case when v_title <> '' then ': ' || v_title else '' end;
  end if;
  n := public.next_qa_number(p_project, 'ir');
  insert into public.qa_inspections (project_id, number, template_id, title, trade, pin_id, location, request_note, standards,work_item_ids)
  values (p_project, n, t.id, v_title, t.trade, p_pin, null, nullif(btrim(coalesce(p_note, '')), ''), t.standards,p_items)
  returning id into v_id;
  insert into public.qa_inspection_items (inspection_id, project_id, position, text, severity, kind, unit, min_value, max_value, reference, requires_photo, hold_point, acceptance_criteria, evidence_requirement)
  select v_id, p_project, position, text, severity, kind, unit, min_value, max_value, reference, requires_photo, hold_point, acceptance_criteria, evidence_requirement from public.qa_template_items where template_id = t.id order by position;
  for r in select pm.user_id from public.project_members pm where pm.project_id = p_project and pm.member_role = 'engineer' and pm.user_id is distinct from auth.uid() loop
    perform public.notify_user(r.user_id, 'qa.requested', 'Inspection requested: ' || left(v_title, 120), 'IR-' || lpad(n::text, 4, '0') || ' - ' || t.name,
      '/engineer/qa?project=' || p_project || '&inspection=' || v_id, p_project, v_id);
  end loop;
  return v_id;
end;
$$;

revoke all on function public.request_work_item_inspection(uuid,uuid,text,uuid,uuid[],text) from public,anon,authenticated;
