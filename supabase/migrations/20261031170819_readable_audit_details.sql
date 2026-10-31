-- Complete, readable audit details without changing the stored history or access rules.
create or replace function public.audit_reference_id(value text)
returns uuid language sql immutable security invoker set search_path = '' as $$
  select case when value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then value::uuid end;
$$;

-- Do not expand credentials or biometric identifiers into the audit viewer/export.
create or replace function public.audit_display_details(value jsonb)
returns jsonb language plpgsql immutable security invoker set search_path = '' as $$
declare result jsonb; entry record;
begin
  if jsonb_typeof(value) = 'object' then
    result := '{}'::jsonb;
    for entry in select * from jsonb_each(value) loop
      if entry.key !~* '(password|secret|token|(^|_)hash($|_)|biometric_uid|fingerprint|id_number)' then
        result := result || jsonb_build_object(entry.key, public.audit_display_details(entry.value));
      end if;
    end loop;
    return result;
  elsif jsonb_typeof(value) = 'array' then
    select coalesce(jsonb_agg(public.audit_display_details(element)), '[]'::jsonb) into result from jsonb_array_elements(value) element;
    return result;
  end if;
  return value;
end;
$$;

-- Private lookup, executed only inside the permission-checked viewer. Names are
-- current reference labels; recorded field values remain in details unchanged.
create or replace function public.audit_log_context(event text, details jsonb)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  r jsonb := coalesce(details->'row', details, '{}'::jsonb);
  refs jsonb := '{}'::jsonb;
  context jsonb := '{}'::jsonb;
  entity text := split_part(event, '.', 1);
  project_id uuid; pin_id uuid; sheet_id uuid; item_id uuid; report_id uuid; inspection_id uuid;
  found_row jsonb; ref record; label text; subject text;
begin
  if jsonb_typeof(r) <> 'object' then r := '{}'::jsonb; end if;
  project_id := public.audit_reference_id(case when entity = 'projects' then r->>'id' else r->>'project_id' end);
  pin_id := public.audit_reference_id(case when entity = 'pins' then r->>'id' else r->>'pin_id' end);
  sheet_id := public.audit_reference_id(case when entity = 'blueprints' then r->>'id' else r->>'blueprint_id' end);
  item_id := public.audit_reference_id(case when entity = 'pin_checklist_items' then r->>'id' else r->>'item_id' end);
  report_id := public.audit_reference_id(case when entity = 'daily_reports' then r->>'id' else r->>'report_id' end);
  inspection_id := public.audit_reference_id(case when entity = 'qa_inspections' then r->>'id' else coalesce(r->>'inspection_id', r->>'submitted_inspection_id', r->>'previous_inspection_id') end);
  subject := coalesce(nullif(r->>'title', ''), nullif(r->>'text', ''), nullif(r->>'full_name', ''), nullif(r->>'name', ''));

  if item_id is not null then
    select to_jsonb(i) into found_row from public.pin_checklist_items i where i.id = item_id;
    if found_row is not null then
      label := found_row->>'text'; refs := refs || jsonb_build_object(item_id::text, label);
      context := context || jsonb_build_object('task', label); subject := coalesce(subject, label);
      pin_id := coalesce(pin_id, public.audit_reference_id(found_row->>'pin_id'));
    end if;
  end if;
  if inspection_id is not null then
    select to_jsonb(i) into found_row from public.qa_inspections i where i.id = inspection_id;
    if found_row is not null then
      label := 'IR-' || lpad(found_row->>'number', 4, '0') || ' ' || (found_row->>'title');
      refs := refs || jsonb_build_object(inspection_id::text, label);
      context := context || jsonb_build_object('inspection', label); subject := coalesce(subject, label);
      pin_id := coalesce(pin_id, public.audit_reference_id(found_row->>'pin_id'));
      project_id := coalesce(project_id, public.audit_reference_id(found_row->>'project_id'));
    end if;
  end if;
  if report_id is not null then
    select to_jsonb(d) into found_row from public.daily_reports d where d.id = report_id;
    if found_row is not null then
      label := 'Daily report Â· ' || (found_row->>'report_date');
      refs := refs || jsonb_build_object(report_id::text, label);
      context := context || jsonb_build_object('report', label); subject := coalesce(subject, label);
      project_id := coalesce(project_id, public.audit_reference_id(found_row->>'project_id'));
    end if;
  end if;
  if pin_id is not null then
    select to_jsonb(p) into found_row from public.pins p where p.id = pin_id;
    if found_row is not null then
      label := found_row->>'title'; refs := refs || jsonb_build_object(pin_id::text, label);
      context := context || jsonb_build_object('pin', label); subject := coalesce(subject, label);
      project_id := coalesce(project_id, public.audit_reference_id(found_row->>'project_id'));
      sheet_id := coalesce(sheet_id, public.audit_reference_id(found_row->>'blueprint_id'));
    end if;
  end if;
  if sheet_id is not null then
    select to_jsonb(b) into found_row from public.blueprints b where b.id = sheet_id;
    if found_row is not null then
      label := found_row->>'title'; refs := refs || jsonb_build_object(sheet_id::text, label);
      context := context || jsonb_build_object('sheet', label); subject := coalesce(subject, label);
      project_id := coalesce(project_id, public.audit_reference_id(found_row->>'project_id'));
    end if;
  end if;
  if project_id is not null then
    select p.code || ' Â· ' || p.name into label from public.projects p where p.id = project_id;
    if label is not null then
      refs := refs || jsonb_build_object(project_id::text, label);
      context := context || jsonb_build_object('project', label); subject := coalesce(subject, label);
    end if;
  end if;

  for ref in select value #>> '{}' as id from jsonb_array_elements(case when jsonb_typeof(r->'item_ids') = 'array' then r->'item_ids' else '[]'::jsonb end) loop
    select i.text into label from public.pin_checklist_items i where i.id = public.audit_reference_id(ref.id);
    if label is not null then refs := refs || jsonb_build_object(ref.id, label); end if;
  end loop;

  -- Resolve people on both sides of an edit, so reassignments show both names.
  for ref in
    select distinct e.value #>> '{}' as id
    from jsonb_each(r || '{}'::jsonb) e
    where e.key in ('assigned_to','user_id','created_by','updated_by','verified_by','approved_by','reviewed_by','assigned_by','requested_by','inspector_id','raised_by','resolved_by','author_id','submitted_by','qa_approved_by','done_by','remark_by','lead_engineer_id','lead_foreman_id')
    union
    select e.value #>> '{}' from jsonb_each(case when jsonb_typeof(details->'before') = 'object' then details->'before' else '{}'::jsonb end) e
    where e.key in ('assigned_to','user_id','created_by','updated_by','verified_by','approved_by','reviewed_by','assigned_by','requested_by','inspector_id','raised_by','resolved_by','author_id','submitted_by','qa_approved_by','done_by','remark_by','lead_engineer_id','lead_foreman_id')
  loop
    select coalesce(nullif(p.full_name, ''), p.email) into label from public.profiles p where p.id = public.audit_reference_id(ref.id);
    if label is not null then refs := refs || jsonb_build_object(ref.id, label); end if;
  end loop;
  return context || jsonb_build_object('subject', subject, 'references', refs);
end;
$$;

create or replace function public.get_audit_log(p_search text default null, p_action text default null, p_from timestamptz default null, p_to timestamptz default null, p_limit integer default 100, p_offset integer default 0)
returns table (id bigint, created_at timestamptz, actor_name text, actor_email text, action text, target_name text, summary text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.has_permission('users.view') then raise exception 'Missing permission: users.view'; end if;
  return query
  with search_ids as materialized (
    select coalesce(array_agg(ref.id), array[]::text[]) as ids from (
      select p.id::text from public.projects p where concat_ws(' Â· ', p.code, p.name) ilike '%' || p_search || '%'
      union select p.id::text from public.pins p where p.title ilike '%' || p_search || '%'
      union select i.id::text from public.pin_checklist_items i where i.text ilike '%' || p_search || '%'
      union select b.id::text from public.blueprints b where b.title ilike '%' || p_search || '%'
      union select p.id::text from public.profiles p where p.full_name ilike '%' || p_search || '%' or p.email ilike '%' || p_search || '%'
      union select d.id::text from public.daily_reports d where 'Daily report Â· ' || d.report_date::text ilike '%' || p_search || '%'
      union select i.id::text from public.qa_inspections i where 'IR-' || lpad(i.number::text, 4, '0') || ' ' || i.title ilike '%' || p_search || '%'
    ) ref where p_search is not null and p_search <> ''
  ), matching as (
    select l.*, coalesce(nullif(a.full_name, ''), a.email, 'System') as actor_name, a.email as actor_email,
      coalesce(nullif(t.full_name, ''), t.email) as target_name
    from public.audit_log l
    left join public.profiles a on a.id = l.actor_id
    left join public.profiles t on t.id = l.target_id
    where (p_action is null or p_action = '' or l.action = p_action)
      and (p_from is null or l.created_at >= p_from) and (p_to is null or l.created_at < p_to)
  ), page as materialized (
    select l.* from matching l cross join search_ids s
    where p_search is null or p_search = '' or l.action ilike '%' || p_search || '%'
      or l.actor_name ilike '%' || p_search || '%' or l.actor_email ilike '%' || p_search || '%'
      or l.target_name ilike '%' || p_search || '%'
      or (l.details::text ilike '%' || p_search || '%' and public.audit_display_details(l.details)::text ilike '%' || p_search || '%')
      or exists (
        select 1 from (
          select e.value from jsonb_each_text(case when jsonb_typeof(l.details->'row') = 'object' then l.details->'row' when jsonb_typeof(l.details) = 'object' then l.details else '{}'::jsonb end) e
          union all select e.value from jsonb_each_text(case when jsonb_typeof(l.details->'before') = 'object' then l.details->'before' else '{}'::jsonb end) e
        ) ref where ref.value = any(s.ids)
      )
      or coalesce(l.details->'row'->'item_ids', '[]'::jsonb) ?| s.ids
    order by l.created_at desc, l.id desc
    limit least(greatest(coalesce(p_limit, 100), 1), 500) offset greatest(coalesce(p_offset, 0), 0)
  )
  select l.id, l.created_at, l.actor_name, l.actor_email, l.action,
    coalesce(l.target_name, c.context->>'subject'),
    jsonb_build_object('version', 1, 'details', public.audit_display_details(l.details), 'context', c.context)::text
  from page l cross join lateral (select public.audit_log_context(l.action, l.details) as context offset 0) c
  order by l.created_at desc, l.id desc;
end;
$$;

-- Preserve original row payload; capture the genuine previous values for future updates.
create or replace function public.log_row_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_row jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
begin
  insert into public.audit_log (actor_id, action, details)
  values (auth.uid(), tg_table_name || '.' || lower(tg_op),
    jsonb_build_object('row', v_row) || case when tg_op = 'UPDATE' then jsonb_build_object('before', to_jsonb(old)) else '{}'::jsonb end);
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
create or replace function public.log_project_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_row jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
begin
  insert into public.audit_log (actor_id, target_id, action, details)
  values (auth.uid(), case when tg_table_name = 'project_members' then (v_row->>'user_id')::uuid else null end,
    tg_table_name || '.' || lower(tg_op),
    jsonb_build_object('row', v_row) || case when tg_op = 'UPDATE' then jsonb_build_object('before', to_jsonb(old)) else '{}'::jsonb end);
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function public.audit_reference_id(text), public.audit_display_details(jsonb), public.audit_log_context(text, jsonb),
  public.log_row_change(), public.log_project_change() from public, anon, authenticated;
revoke all on function public.get_audit_log(text, text, timestamptz, timestamptz, integer, integer) from public, anon;
grant execute on function public.get_audit_log(text, text, timestamptz, timestamptz, integer, integer) to authenticated;
