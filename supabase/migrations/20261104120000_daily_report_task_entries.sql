-- Daily report task progress: one report can carry a progress entry per task worked on that day (percentage completed, daily notes,
-- issues, manpower, materials and photos). The Foreman's record of the day only: nothing here touches a task's done / review state,
-- so official progress still comes from Engineer-approved tasks and QA stays with the task.
-- Entries live in their own table, not in linked_work, because every project member (Clients included) can read a submitted
-- daily_reports row: Clients must not receive the team's task issues, manpower, materials or unapproved percentages.
-- linked_work keeps the plain pin / task links (client site logs, pin records and delete protection read it) and is written from the entries.

-- ---------------------------------------------------------------- entries
create table public.daily_report_entries (
  id uuid primary key default gen_random_uuid(), -- chosen by the browser: a retried save and a photo attached to the entry keep pointing at the same row
  report_id uuid not null references public.daily_reports (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  pin_id uuid not null references public.pins (id), -- pin_has_records already protects pins with linked reports; purging a project clears both together
  item_id uuid, -- like linked_work, not a foreign key: the record of the day neither blocks deleting a task nor loses which task it was
  position integer not null default 0,
  percent integer check (percent between 0 and 100),
  notes text not null default '' check (char_length(notes) <= 2000),
  issues text not null default '' check (char_length(issues) <= 2000),
  manpower integer check (manpower between 0 and 5000), -- workers on this task as reported by the Foreman; attendance stays with the biometric headcount
  materials text not null default '' check (char_length(materials) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index daily_report_entries_report_idx on public.daily_report_entries (report_id, position, id);
create index daily_report_entries_project_idx on public.daily_report_entries (project_id, id);
create index daily_report_entries_pin_idx on public.daily_report_entries (pin_id);

alter table public.daily_report_entries enable row level security;
revoke all on public.daily_report_entries from anon, authenticated;
grant select on public.daily_report_entries to authenticated; -- written only by save_daily_report
-- The report's own policies still decide which reports the caller sees (drafts, returned reports, removed reports). Clients never read entries.
create policy "team reads task entries" on public.daily_report_entries for select to authenticated
  using ((select public.is_staff()) and project_id in (select public.viewable_project_ids())
    and project_id not in (select public.client_project_ids())
    and exists (select 1 from public.daily_reports r where r.id = report_id));

create trigger zz_site_guard before insert or update or delete on public.daily_report_entries
  for each statement execute function public.site_guard('daily_reports');

-- ---------------------------------------------------------------- photos of an entry
-- Removing an entry from a draft never deletes evidence: its photos stay on the report as general report photos.
alter table public.daily_report_photos add column entry_id uuid references public.daily_report_entries (id) on delete set null;
create index daily_report_photos_entry_idx on public.daily_report_photos (entry_id) where entry_id is not null;
grant insert (entry_id) on public.daily_report_photos to authenticated;

create function public.check_daily_photo_entry()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.entry_id is not null and not exists (select 1 from public.daily_report_entries e where e.id = new.entry_id and e.report_id = new.report_id) then
    raise exception 'Attach the photo to a task entry of this report';
  end if;
  return new;
end;
$$;
create trigger daily_report_photos_entry before insert on public.daily_report_photos
  for each row execute function public.check_daily_photo_entry();
revoke all on function public.check_daily_photo_entry() from public, anon, authenticated;

-- ---------------------------------------------------------------- submitting
-- However a report is submitted, each of its entries needs a percentage. Reports without entries (older ones) are unaffected.
create function public.require_complete_report_entries()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'submitted' and old.status = 'draft' and exists (select 1 from public.daily_report_entries e where e.report_id = new.id and e.percent is null) then
    raise exception 'Enter the percentage completed for every task before submitting';
  end if;
  return new;
end;
$$;
create trigger daily_reports_entries_complete before update of status on public.daily_reports
  for each row execute function public.require_complete_report_entries();
revoke all on function public.require_complete_report_entries() from public, anon, authenticated;

-- Revisions keep the entries as they were submitted (same function as 20261018124654 plus task_entries). Staff and the author read revisions; Clients do not.
create or replace function public.snapshot_daily_report() returns trigger
language plpgsql security definer set search_path='' as $$
declare action text;
begin
  if new.status='submitted' and (tg_op='INSERT' or old.status='draft') then action:='submitted';
  elsif tg_op='UPDATE' and new.review_state is distinct from old.review_state and new.review_state in ('reviewed','returned') then action:=new.review_state;
  else return new; end if;
  insert into public.daily_report_revisions(project_id,report_id,revision,event,actor_id,snapshot,photos_snapshot)
    select new.project_id,new.id,new.revision,action,auth.uid(),
      to_jsonb(new)||jsonb_build_object('task_entries',coalesce((select jsonb_agg(to_jsonb(e) order by e.position,e.id) from public.daily_report_entries e where e.report_id=new.id),'[]'::jsonb)),
      coalesce((select jsonb_agg(to_jsonb(p) order by p.id) from public.daily_report_photos p where p.report_id=new.id),'[]'::jsonb);
  return new;
end; $$;

-- ---------------------------------------------------------------- saving
-- Saves the caller's report for that day and all its entries together, as a draft or submitted. Every existing report trigger still runs on
-- the writes below (dates, review state, biometric headcount, notifications, site controls, removal guard). A Foreman adds entries for work
-- assigned to them; work this report already links stays valid when it is reassigned later, so a returned report can still be corrected.
create function public.save_daily_report(p_project uuid, p_date date, p_weather text, p_work_done text, p_status text, p_entries jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_report public.daily_reports;
  v_entry jsonb;
  v_id uuid; v_pin uuid; v_item uuid; v_percent numeric; v_manpower numeric; v_work text;
  v_ids uuid[] := '{}';
  v_seen text[] := '{}';
  v_links jsonb := '[]'::jsonb;
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
    if exists (select 1 from jsonb_object_keys(v_entry) k where k not in ('id', 'pin_id', 'item_id', 'percent', 'notes', 'issues', 'manpower', 'materials')) then
      raise exception 'A task entry keeps only its task, pin, percentage, notes, issues, manpower and materials';
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
  end loop;

  if v_report.id is null then
    insert into public.daily_reports (project_id, report_date, weather, work_done, status, linked_work)
      values (p_project, p_date, p_weather, coalesce(p_work_done, ''), 'draft', v_links) returning * into v_report;
  else
    update public.daily_reports set weather = p_weather, work_done = coalesce(p_work_done, ''), linked_work = v_links where id = v_report.id;
  end if;
  delete from public.daily_report_entries e where e.report_id = v_report.id and e.id <> all (v_ids);
  insert into public.daily_report_entries (id, report_id, project_id, pin_id, item_id, position, percent, notes, issues, manpower, materials)
    select (t.entry->>'id')::uuid, v_report.id, p_project, (t.entry->>'pin_id')::uuid, (t.entry->>'item_id')::uuid, t.n - 1,
      (t.entry->>'percent')::numeric::integer, btrim(coalesce(t.entry->>'notes', '')), btrim(coalesce(t.entry->>'issues', '')),
      (t.entry->>'manpower')::numeric::integer, btrim(coalesce(t.entry->>'materials', ''))
    from jsonb_array_elements(p_entries) with ordinality as t(entry, n)
  on conflict (id) do update set pin_id = excluded.pin_id, item_id = excluded.item_id, position = excluded.position, percent = excluded.percent,
    notes = excluded.notes, issues = excluded.issues, manpower = excluded.manpower, materials = excluded.materials, updated_at = now();
  -- Last, so the submission rules and the revision snapshot see the entries just saved.
  if p_status = 'submitted' then update public.daily_reports set status = 'submitted' where id = v_report.id; end if;
  return v_report.id;
end;
$$;
revoke all on function public.save_daily_report(uuid, date, text, text, text, jsonb) from public, anon;
grant execute on function public.save_daily_report(uuid, date, text, text, text, jsonb) to authenticated;

-- Rollback (nothing else depends on these):
--   drop function public.save_daily_report(uuid, date, text, text, text, jsonb);
--   drop trigger daily_reports_entries_complete on public.daily_reports; drop function public.require_complete_report_entries();
--   drop trigger daily_report_photos_entry on public.daily_report_photos; drop function public.check_daily_photo_entry();
--   alter table public.daily_report_photos drop column entry_id; drop table public.daily_report_entries;
--   then restore snapshot_daily_report from 20261018124654.
