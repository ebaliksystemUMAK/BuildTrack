-- Work completed is now written per task. daily_reports.work_done stays the report's summary (client site logs, Engineer review, prints and the
-- submission rule all read it), and save_daily_report builds it from the tasks, so the client reads what was written in those boxes. The rest of
-- an entry stays with the project team. A report without task text (older reports, no assigned work, older queued saves) keeps the summary it was given.
alter table public.daily_report_entries add column work_done text not null default '' check (char_length(work_done) <= 2000);

-- Same rule as the report's own summary, for each task.
create or replace function public.require_complete_report_entries()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'submitted' and old.status = 'draft' then
    if exists (select 1 from public.daily_report_entries e where e.report_id = new.id and e.percent is null) then
      raise exception 'Enter the percentage completed for every task before submitting';
    end if;
    if exists (select 1 from public.daily_report_entries e where e.report_id = new.id and char_length(btrim(e.work_done)) < 5) then
      raise exception 'Describe the work completed on every task before submitting';
    end if;
  end if;
  return new;
end;
$$;

-- Same function as 20261104120000, plus work_done on each entry and the summary built from it.
create or replace function public.save_daily_report(p_project uuid, p_date date, p_weather text, p_work_done text, p_status text, p_entries jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_report public.daily_reports;
  v_entry jsonb;
  v_id uuid; v_pin uuid; v_item uuid; v_percent numeric; v_manpower numeric; v_work text; v_line text;
  v_ids uuid[] := '{}';
  v_seen text[] := '{}';
  v_links jsonb := '[]'::jsonb;
  v_summary text := '';
begin
  -- This function runs with the owner's rights, so it applies the report's write policies itself.
  if auth.uid() is null or not public.is_active() or not public.can_report_on_project(p_project) then
    raise exception 'You are not allowed to write a report for this project' using errcode = '42501';
  end if;
  if coalesce(p_status, '') not in ('draft', 'submitted') then raise exception 'Save the report as a draft or submit it'; end if;
  if jsonb_typeof(p_entries) is distinct from 'array' then raise exception 'Task entries must be a list'; end if;
  if jsonb_array_length(p_entries) > 100 then raise exception 'Add at most 100 task entries to one report'; end if;
  select * into v_report from public.daily_reports r where r.project_id = p_project and r.report_date = p_date and r.author_id = auth.uid() for update;
  if found and v_report.status <> 'draft' then raise exception 'A submitted report cannot be edited. Ask an engineer to reopen it'; end if;

  for v_entry in select * from jsonb_array_elements(p_entries) loop
    if jsonb_typeof(v_entry) <> 'object' then raise exception 'A task entry must be an object'; end if;
    if exists (select 1 from jsonb_object_keys(v_entry) k where k not in ('id', 'pin_id', 'item_id', 'work_done', 'percent', 'notes', 'issues', 'manpower', 'materials')) then
      raise exception 'A task entry keeps only its task, pin, work completed, percentage, notes, issues, manpower and materials';
    end if;
    v_id := (v_entry->>'id')::uuid; v_pin := (v_entry->>'pin_id')::uuid; v_item := (v_entry->>'item_id')::uuid;
    if v_id is null or v_pin is null then raise exception 'Choose the task for each entry'; end if;
    if v_id = any (v_ids) then raise exception 'A task entry was sent twice'; end if;
    if exists (select 1 from public.daily_report_entries e where e.id = v_id and e.report_id is distinct from v_report.id) then
      raise exception 'That task entry belongs to another report';
    end if;
    if not exists (select 1 from public.pins p where p.id = v_pin and p.project_id = p_project and p.category <> 'note') then
      raise exception 'Linked work must belong to this project';
    end if;
    if v_item is not null then
      if not exists (select 1 from public.pin_checklist_items c where c.id = v_item and c.pin_id = v_pin) then
        raise exception 'Choose a checklist item of the linked work pin';
      end if;
    elsif exists (select 1 from public.pin_checklist_items c where c.pin_id = v_pin) then
      raise exception 'Choose the checklist item worked on for each linked work pin';
    end if;
    if not public.can_work_on_pin(v_pin) and not coalesce(v_report.linked_work @> jsonb_build_array(jsonb_build_object('pin_id', v_pin)), false) then
      raise exception 'You can only report progress on work assigned to you';
    end if;
    v_percent := (v_entry->>'percent')::numeric; v_manpower := (v_entry->>'manpower')::numeric;
    if v_percent is not null and (v_percent <> trunc(v_percent) or v_percent not between 0 and 100) then
      raise exception 'Percentage completed must be a whole number from 0 to 100';
    end if;
    if v_manpower is not null and (v_manpower <> trunc(v_manpower) or v_manpower not between 0 and 5000) then
      raise exception 'Manpower must be a whole number from 0 to 5000';
    end if;
    v_work := v_pin::text || ':' || coalesce(v_item::text, '');
    if v_work = any (v_seen) then raise exception 'This task already has an entry in this report'; end if;
    v_ids := v_ids || v_id; v_seen := v_seen || v_work;
    v_links := v_links || jsonb_build_object('pin_id', v_pin, 'item_id', v_item);
    if btrim(coalesce(v_entry->>'work_done', '')) <> '' then
      select p.title || coalesce(' → ' || c.text, '') into v_line from public.pins p left join public.pin_checklist_items c on c.id = v_item and c.pin_id = p.id where p.id = v_pin;
      v_summary := v_summary || case when v_summary = '' then '' else E'\n' end || v_line || ': ' || btrim(v_entry->>'work_done');
    end if;
  end loop;
  -- The report's summary is limited to 4000 characters; each entry keeps its full text.
  v_summary := case when v_summary = '' then coalesce(p_work_done, '') else left(v_summary, 4000) end;

  if v_report.id is null then
    insert into public.daily_reports (project_id, report_date, weather, work_done, status, linked_work)
      values (p_project, p_date, p_weather, v_summary, 'draft', v_links) returning * into v_report;
  else
    update public.daily_reports set weather = p_weather, work_done = v_summary, linked_work = v_links where id = v_report.id;
  end if;
  delete from public.daily_report_entries e where e.report_id = v_report.id and e.id <> all (v_ids);
  insert into public.daily_report_entries (id, report_id, project_id, pin_id, item_id, position, work_done, percent, notes, issues, manpower, materials)
    select (t.entry->>'id')::uuid, v_report.id, p_project, (t.entry->>'pin_id')::uuid, (t.entry->>'item_id')::uuid, t.n - 1, btrim(coalesce(t.entry->>'work_done', '')),
      (t.entry->>'percent')::numeric::integer, btrim(coalesce(t.entry->>'notes', '')), btrim(coalesce(t.entry->>'issues', '')),
      (t.entry->>'manpower')::numeric::integer, btrim(coalesce(t.entry->>'materials', ''))
    from jsonb_array_elements(p_entries) with ordinality as t(entry, n)
  on conflict (id) do update set pin_id = excluded.pin_id, item_id = excluded.item_id, position = excluded.position, work_done = excluded.work_done, percent = excluded.percent,
    notes = excluded.notes, issues = excluded.issues, manpower = excluded.manpower, materials = excluded.materials, updated_at = now();
  -- Last, so the submission rules and the revision snapshot see the entries just saved.
  if p_status = 'submitted' then update public.daily_reports set status = 'submitted' where id = v_report.id; end if;
  return v_report.id;
end;
$$;

-- Rollback: restore both functions from 20261104120000, then: alter table public.daily_report_entries drop column work_done;
