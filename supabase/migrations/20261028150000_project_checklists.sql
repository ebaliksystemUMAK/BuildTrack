-- Project checklists and the documentation of cited standards.
--   * save_work_checklist_item stores each work item's criteria as a hidden copy named "<work> / <item>". Those copies belong to
--     their work item (and its QA history), not to the project's checklist set: they are flagged (qa_templates.work_item_criteria)
--     so Checklist configuration and the checklist pickers show only the checklists the Engineer added to the project.
--   * Copies nothing refers to any more (left behind each time a work item was saved again) are removed, and a new save removes the
--     copy it replaces when nothing refers to it. Copies used by a submission or an inspection are kept with their history.
--   * A flagged copy changes only by saving its work item again, never through the checklist functions.
--   * A work item keeps the cited standards of the project checklist its criteria were copied from (optional p_standards).
--   * Standards catalog entries may carry an official source link (documentation of the cited standard); the sources documented
--     in docs/audits/2026-10-19-philippine-qa-standards.md are filled in. Titles, order and custom entries are kept.
-- Details: docs/audits/2026-10-28-project-checklists.md

-- ---------- 1. Work item criteria are not project checklists ----------
alter table public.qa_templates add column work_item_criteria boolean not null default false;
update public.qa_templates set work_item_criteria = true
where project_id is not null and description = 'Criteria defined by the Engineer with the work checklist item';

delete from public.qa_templates t
where t.work_item_criteria
  and not exists (select 1 from public.pins p where p.qa_template_id = t.id)
  and not exists (select 1 from public.pin_checklist_items c where c.qa_template_id = t.id)
  and not exists (select 1 from public.qa_inspections i where i.template_id = t.id)
  and not exists (select 1 from public.pin_qa_submissions s where s.template_id = t.id);

create function public.guard_work_item_criteria()
returns trigger language plpgsql set search_path = '' as $$
begin
  -- updated_at moves on every save / archive; a cleared created_by (deleted account) is still allowed.
  if old.work_item_criteria and (new.updated_at is distinct from old.updated_at
      or (new.name, new.trade, new.description, new.standards, new.archived, new.project_id, new.is_system, new.work_item_criteria)
         is distinct from (old.name, old.trade, old.description, old.standards, old.archived, old.project_id, old.is_system, old.work_item_criteria)) then
    raise exception 'These criteria belong to a work item. Change them on the plan by editing that work item.' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger qa_templates_work_item_criteria before update on public.qa_templates
  for each row execute function public.guard_work_item_criteria();

-- ---------- 2. Saving a work item (rules of 20261020072554 unchanged) ----------
drop function public.save_work_checklist_item(uuid, uuid, text, jsonb);
create function public.save_work_checklist_item(p_pin uuid, p_item uuid, p_text text, p_criteria jsonb, p_standards text[] default '{}')
returns uuid language plpgsql security definer set search_path = '' as $$
declare pn public.pins; c public.pin_checklist_items; criterion jsonb; template uuid; item_id uuid; code text;
  cited text[] := array(select btrim(x) from unnest(coalesce(p_standards, '{}')) x);
begin
  select * into pn from public.pins where id=p_pin for update;
  if pn.id is null or not public.can_edit_blueprints(pn.project_id) then raise exception 'Only the project Engineer creates checklist items and their criteria'; end if;
  if pn.status='verified' then raise exception 'Completed work must be reopened by the Engineer'; end if;
  if char_length(btrim(coalesce(p_text,''))) not between 3 and 200 then raise exception 'Enter a work item name (3 to 200 characters)'; end if;
  if p_item is not null then
    select * into c from public.pin_checklist_items where id=p_item and pin_id=p_pin for update;
    if c.id is null then raise exception 'Checklist item not found on this work'; end if;
    if c.review_status in ('verified','for_review') or exists(select 1 from public.pin_qa_submissions s,jsonb_array_elements(s.checklist_snapshot) x where s.pin_id=p_pin and x->>'id'=p_item::text) then
      raise exception 'Submitted criteria are preserved with QA history; create a new checklist item for a different scope'; end if;
  end if;
  if p_criteria is null or jsonb_typeof(p_criteria)<>'array' or jsonb_array_length(p_criteria) not between 1 and 60 then
    raise exception 'Add between 1 and 60 inspection criteria before saving the checklist item'; end if;
  for criterion in select value from jsonb_array_elements(p_criteria) loop
    if char_length(btrim(coalesce(criterion->>'text',''))) not between 3 and 500 or char_length(btrim(coalesce(criterion->>'acceptance_criteria',''))) not between 5 and 1000 then
      raise exception 'Each criterion needs a test/check and a specific passing requirement'; end if;
    if char_length(coalesce(criterion->>'reference',''))>200 or char_length(coalesce(criterion->>'evidence_requirement',''))>1000 then raise exception 'Criterion reference or evidence instructions are too long'; end if;
  end loop;
  if cardinality(cited) > 10 then raise exception 'Cite at most 10 standards'; end if;
  foreach code in array cited loop
    if char_length(code) not between 2 and 40 then raise exception 'Each cited standard needs a code of 2 to 40 characters'; end if;
  end loop;
  template:=public.save_qa_template(null,pn.project_id,left(pn.title||' / '||btrim(p_text),120),'general',
    'Criteria defined by the Engineer with the work checklist item',cited,p_criteria);
  update public.qa_templates set work_item_criteria = true where id = template;
  if p_item is null then
    insert into public.pin_checklist_items(pin_id,project_id,text,qa_template_id) values(p_pin,pn.project_id,btrim(p_text),template) returning id into item_id;
  else
    update public.pin_checklist_items set text=btrim(p_text),qa_template_id=template where id=p_item returning id into item_id;
  end if;
  insert into public.pin_events(pin_id,project_id,kind,note) values(p_pin,pn.project_id,'comment','Engineer saved checklist item and inspection criteria: '||btrim(p_text));
  return item_id;
end; $$;

-- A copy nothing refers to any more is removed: when its work item gets new criteria or is deleted.
create function public.remove_unused_work_item_criteria()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.qa_template_id is not null and (tg_op = 'DELETE' or new.qa_template_id is distinct from old.qa_template_id) then
    delete from public.qa_templates t
    where t.id = old.qa_template_id and t.work_item_criteria
      and not exists (select 1 from public.pins p where p.qa_template_id = t.id)
      and not exists (select 1 from public.pin_checklist_items c where c.qa_template_id = t.id)
      and not exists (select 1 from public.qa_inspections i where i.template_id = t.id)
      and not exists (select 1 from public.pin_qa_submissions s where s.template_id = t.id);
  end if;
  return null;
end;
$$;
create trigger pin_checklist_items_unused_criteria after update of qa_template_id or delete on public.pin_checklist_items
  for each row execute function public.remove_unused_work_item_criteria();

-- ---------- 3. Documentation of cited standards ----------
-- Same validation as 0022, plus: a standard may carry an official source link (https, up to 300 characters).
create or replace function public.set_setting(p_key text, p_value jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v jsonb := p_value;
  code text;
  seen text[] := '{}';
  item jsonb;
begin
  if not public.is_super_admin() then
    raise exception 'Only a Super Admin (with MFA) can change settings';
  end if;
  if not exists (select 1 from public.system_settings where key = p_key) then
    raise exception 'Unknown setting: %', p_key;
  end if;

  if p_key = 'qa.acceptance_threshold' then
    if jsonb_typeof(v) <> 'number' or (v #>> '{}')::numeric <> trunc((v #>> '{}')::numeric) or (v #>> '{}')::numeric not between 50 and 100 then
      raise exception 'The acceptance threshold is a whole number from 50 to 100';
    end if;
  elsif p_key = 'qa.weights' then
    if jsonb_typeof(v) <> 'object' or not (v ?& array['critical', 'major', 'minor']) or (select count(*) from jsonb_object_keys(v)) <> 3 then
      raise exception 'Weights need exactly critical, major and minor';
    end if;
    foreach code in array array['critical', 'major', 'minor'] loop
      if jsonb_typeof(v -> code) <> 'number' or (v ->> code)::numeric <> trunc((v ->> code)::numeric) or (v ->> code)::numeric not between 1 and 20 then
        raise exception 'Each weight is a whole number from 1 to 20';
      end if;
    end loop;
    if (v ->> 'critical')::int < (v ->> 'major')::int or (v ->> 'major')::int < (v ->> 'minor')::int then
      raise exception 'A critical item must weigh at least as much as a major one, and a major at least as much as a minor one';
    end if;
  elsif p_key = 'work.hours' then
    if jsonb_typeof(v) <> 'object' or (v ->> 'start') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or (v ->> 'end') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
      raise exception 'Working hours need a start and an end time (HH:MM)';
    end if;
    if (v ->> 'start') >= (v ->> 'end') then raise exception 'The end time must be after the start time'; end if;
    if jsonb_typeof(v -> 'days') <> 'array' or jsonb_array_length(v -> 'days') not between 1 and 7 then
      raise exception 'Pick at least one working day';
    end if;
    for item in select * from jsonb_array_elements(v -> 'days') loop
      if jsonb_typeof(item) <> 'number' or (item #>> '{}') !~ '^[1-7]$' or (item #>> '{}') = any (seen) then
        raise exception 'Working days are the numbers 1 to 7, each once';
      end if;
      seen := seen || (item #>> '{}');
    end loop;
  elsif p_key = 'standards' then
    if jsonb_typeof(v) <> 'array' or jsonb_array_length(v) > 30 then raise exception 'Up to 30 standards'; end if;
    for item in select * from jsonb_array_elements(v) loop
      if jsonb_typeof(item) <> 'object' or char_length(coalesce(item ->> 'code', '')) not between 2 and 40 or char_length(coalesce(item ->> 'title', '')) not between 2 and 120 then
        raise exception 'Each standard needs a code (2-40 characters) and a title (2-120 characters)';
      end if;
      if item ? 'source' and (jsonb_typeof(item -> 'source') <> 'string' or char_length(item ->> 'source') > 300
          or (item ->> 'source') !~ '^https://[^[:space:]]{4,}$') then
        raise exception 'An official source must be an https:// link of up to 300 characters';
      end if;
      if lower(item ->> 'code') = any (seen) then raise exception 'Each standard code can appear once'; end if;
      seen := seen || lower(item ->> 'code');
    end loop;
  elsif p_key = 'access.inactive_days' then
    if jsonb_typeof(v) <> 'number' or (v #>> '{}')::numeric <> trunc((v #>> '{}')::numeric) or (v #>> '{}')::numeric not between 14 and 365 then
      raise exception 'Inactive days is a whole number from 14 to 365';
    end if;
  end if;

  update public.system_settings set value = v, updated_by = auth.uid(), updated_at = now() where key = p_key;
  insert into public.audit_log (actor_id, action, details) values (auth.uid(), 'settings.update', jsonb_build_object('key', p_key, 'value', v));
end;
$$;

-- Official sources checked on 2026-10-19 (docs/audits/2026-10-19-philippine-qa-standards.md). Only missing links are added.
create function public.fill_documented_standard_sources()
returns integer language plpgsql security definer set search_path = '' as $$
declare
  catalog jsonb;
  updated jsonb;
  added integer;
begin
  select value into catalog from public.system_settings where key = 'standards' for update;
  if catalog is null or jsonb_typeof(catalog) <> 'array' or jsonb_array_length(catalog) = 0 then
    return 0;
  end if;
  select jsonb_agg(case when e ? 'source' or src.url is null then e else e || jsonb_build_object('source', src.url) end order by ord),
         count(*) filter (where not e ? 'source' and src.url is not null)
  into updated, added
  from jsonb_array_elements(catalog) with ordinality x(e, ord)
  left join (values
    ('pns 07:2018', 'https://bps.dti.gov.ph/component/content/article?Itemid=111&id=83'),
    ('pns astm c90:2019 amd. 1:2019', 'https://bps.dti.gov.ph/index.php/press-releases/23-2019/183-dti-bps-adopts-international-standards-on-masonry-units'),
    ('pns astm c129:2019 amd. 1:2019', 'https://bps.dti.gov.ph/index.php/press-releases/23-2019/183-dti-bps-adopts-international-standards-on-masonry-units'),
    ('pns astm c140/c140m:2019', 'https://bps.dti.gov.ph/index.php/press-releases/23-2019/183-dti-bps-adopts-international-standards-on-masonry-units'),
    ('pns 67:2014', 'https://bps.dti.gov.ph/component/content/article?Itemid=111&id=267'),
    ('pgbc 2015', 'https://www.dpwh.gov.ph/DPWH/sites/default/files/laws_codes_orders/PgbcBooklet23March.pdf'),
    ('pns 49:2020', 'https://bps.dti.gov.ph/component/content/article?Itemid=111&id=84')
  ) src(code, url) on src.code = lower(btrim(e ->> 'code'));
  if added > 0 then
    update public.system_settings set value = updated, updated_at = now(), updated_by = null where key = 'standards';
  end if;
  return added;
end;
$$;
select public.fill_documented_standard_sources();

-- ---------- 4. Who may call what ----------
revoke all on function public.guard_work_item_criteria(), public.remove_unused_work_item_criteria(), public.fill_documented_standard_sources()
  from public, anon, authenticated;
revoke all on function public.save_work_checklist_item(uuid, uuid, text, jsonb, text[]) from public, anon;
grant execute on function public.save_work_checklist_item(uuid, uuid, text, jsonb, text[]) to authenticated;
revoke execute on function public.set_setting(text, jsonb) from public, anon;
grant execute on function public.set_setting(text, jsonb) to authenticated;
