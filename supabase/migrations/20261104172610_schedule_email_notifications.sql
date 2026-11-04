-- Future schedule events use the existing bell/email queue. Never backfill historical mail.
begin;
create function public.schedule_notice_allowed(p_user uuid,p_kind text,p_project uuid,p_entity uuid,p_key text) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare pr public.profiles; req public.project_timeline_requests; pn public.pins; plan_type text; work_id uuid;
begin
  select * into pr from public.profiles where id=p_user and status='active';
  if pr.id is null or not exists(select 1 from public.projects where id=p_project and archived_at is null and deleted_at is null) then return false; end if;
  if p_kind='timeline.published' then
    return coalesce(pr.role='client' and p_entity=p_project and exists(select 1 from public.project_members where project_id=p_project and user_id=p_user and member_role='client')
      and exists(select 1 from public.project_timeline_publications pub where pub.project_id=p_project and p_key='timeline.published:'||pub.id
        and not exists(select 1 from public.project_timeline_publications later where later.project_id=p_project and later.version>pub.version)),false);
  end if;
  select * into req from public.project_timeline_requests where id=p_entity and project_id=p_project;
  if req.id is null or p_key is distinct from p_kind||':'||req.id then return false; end if;
  if split_part(req.work_key,':',2) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return false; end if;
  work_id:=split_part(req.work_key,':',2)::uuid;
  if req.work_key='pin:'||work_id then
    select * into pn from public.pins where id=work_id and project_id=p_project and category<>'note';
  elsif req.work_key='task:'||work_id then
    select p.* into pn from public.pin_checklist_items c join public.pins p on p.id=c.pin_id
      where c.id=work_id and c.project_id=p_project and p.project_id=p_project and p.category<>'note';
  else return false; end if;
  if pn.id is null then return false; end if;
  select blueprint_type into plan_type from public.blueprints where id=pn.blueprint_id and project_id=p_project;
  if p_kind='timeline.requested' then
    return req.status='pending' and pr.role='project_manager'
      and exists(select 1 from public.project_managers where project_id=p_project and user_id=p_user and designation in ('primary','backup'))
      and exists(select 1 from public.profiles author where author.id=req.requested_by and author.status='active'
        and ((author.role='engineer' and public.blueprint_access_level(author.id,p_project,plan_type)<>'none')
          or (author.role='foreman' and pn.assigned_to=author.id and public.blueprint_access_level(author.id,p_project,plan_type)='assigned')));
  end if;
  if (p_kind='timeline.approved' and req.status='approved') or (p_kind='timeline.rejected' and req.status='rejected') then
    return (pr.role='engineer' and pr.id=req.requested_by and public.blueprint_access_level(pr.id,p_project,plan_type)<>'none')
      or (pr.role='foreman' and pr.id=pn.assigned_to and public.blueprint_access_level(pr.id,p_project,plan_type)='assigned');
  end if;
  return false;
end;
$$;

create function public.notify_schedule_request() returns trigger
language plpgsql security definer set search_path='' as $$
declare recipient record; code text; notice_kind text; notice_key text; target text; work_title text;
begin
  select p.code into code from public.projects p where p.id=new.project_id;
  work_title:=left(coalesce(new.proposal->>'title','Work schedule'),120);
  if new.status='pending' then
    notice_kind:='timeline.requested'; notice_key:=notice_kind||':'||new.id;
    for recipient in select user_id from public.project_managers where project_id=new.project_id loop
      if public.schedule_notice_allowed(recipient.user_id,notice_kind,new.project_id,new.id,notice_key) then
        perform public.notify_user(recipient.user_id,notice_kind,code||': schedule approval requested',
          work_title||'. Proposed work dates are waiting for Project Manager review.',
          '/pm/calendar?project='||new.project_id||'&tab=gantt&ganttview=requests',new.project_id,new.id,notice_key);
      end if;
    end loop;
  elsif tg_op='UPDATE' and old.status='pending' and new.status in ('approved','rejected') then
    notice_kind:='timeline.'||new.status; notice_key:=notice_kind||':'||new.id;
    for recipient in
      select p.id user_id,p.role from public.profiles p where p.id=new.requested_by or p.id in (
        select pn.assigned_to from public.pins pn where pn.project_id=new.project_id and
          (new.work_key='pin:'||pn.id or exists(select 1 from public.pin_checklist_items c where c.pin_id=pn.id and c.project_id=new.project_id and new.work_key='task:'||c.id)))
    loop
      if public.schedule_notice_allowed(recipient.user_id,notice_kind,new.project_id,new.id,notice_key) then
        target:=case when recipient.role='engineer' then '/engineer/calendar?project='||new.project_id||'&tab=gantt&ganttview=history' else '/foreman/calendar?project='||new.project_id||'&tab=gantt' end;
        -- Do not email private proposal/review notes or unapproved dates to the Foreman.
        perform public.notify_user(recipient.user_id,notice_kind,code||': schedule '||new.status,
          work_title||case when new.status='approved' then '. The Project Manager approved the schedule. Open Gantt Timeline for the current approved dates.' else '. The Project Manager did not approve the proposed schedule. Official dates are unchanged; coordinate the next proposal with the Engineer.' end,
          target,new.project_id,new.id,notice_key);
      end if;
    end loop;
  end if;
  return new;
end;
$$;

create function public.notify_schedule_publication() returns trigger
language plpgsql security definer set search_path='' as $$
declare recipient record; code text; notice_key text:='timeline.published:'||new.id;
begin
  select p.code into code from public.projects p where p.id=new.project_id;
  for recipient in select user_id from public.project_members where project_id=new.project_id and member_role='client' loop
    if public.schedule_notice_allowed(recipient.user_id,'timeline.published',new.project_id,new.project_id,notice_key) then
      perform public.notify_user(recipient.user_id,'timeline.published',code||': project schedule published',
        'Schedule version '||new.version||' is now published. Open your project''s Gantt Timeline to view the published schedule.',
        '/client/calendar?project='||new.project_id||'&tab=gantt',new.project_id,new.project_id,notice_key);
    end if;
  end loop;
  return new;
end;
$$;
revoke all on function public.schedule_notice_allowed(uuid,text,uuid,uuid,text),public.notify_schedule_request(),public.notify_schedule_publication() from public,anon,authenticated;
create trigger schedule_request_notices after insert or update of status,proposal,reason,requested_by on public.project_timeline_requests for each row execute function public.notify_schedule_request();
create trigger schedule_publication_notices after insert on public.project_timeline_publications for each row execute function public.notify_schedule_publication();

-- Preserve the current deployed queue, adding only the schedule eligibility check.
CREATE OR REPLACE FUNCTION public.claim_email_batch(p_limit integer DEFAULT 25)
 RETURNS TABLE(id uuid, user_id uuid, kind text, title text, body text, link text, to_email text, to_name text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
begin
  if public.system_switch_on('email_paused') then return; end if;
  update public.notifications n set emailed_at = now()
  where n.emailed_at is null and public.notification_email_category(n.kind) = 'inapp';

  with decided as (
    select n.id, n.user_id,
      case
        when n.kind in ('timeline.requested','timeline.approved','timeline.rejected','timeline.published') and public.schedule_notice_allowed(n.user_id,n.kind,n.project_id,n.entity_id,n.dedupe_key) is not true then 'Schedule notice no longer current or accessible'
        when not exists (
          select 1 from public.profiles p
          where p.id = n.user_id and nullif(btrim(p.email), '') is not null
            and (p.status = 'active' or (p.status = 'disabled' and n.kind = 'account.suspended'))
        ) then 'not active, or no email address'
        when c.cat <> 'security' and not coalesce((
          select np.email_enabled and case c.cat when 'reminder' then np.email_reminders when 'announcement' then np.email_announcements else true end
          from public.notification_prefs np where np.user_id = n.user_id
        ), true) then 'opted out of this kind of email'
        when c.cat <> 'security' and (select count(*) from public.email_log l where l.user_id = n.user_id and l.status = 'sent' and l.created_at > now() - interval '24 hours') >= 20
          then 'daily limit reached'
      end as reason
    from public.notifications n
    cross join lateral (select public.notification_email_category(n.kind) as cat) c
    where n.emailed_at is null and n.created_at > now() - interval '2 days'
      and (n.email_claimed_at is null or n.email_claimed_at < now() - interval '10 minutes')
  ), skipped as (
    update public.notifications n set emailed_at = now()
    from decided d where n.id = d.id and d.reason is not null and n.emailed_at is null
    returning n.id, n.user_id, d.reason
  )
  insert into public.email_log (notification_id, user_id, status, detail)
  select s.id, s.user_id, 'skipped', s.reason from skipped s;
  update public.notifications n set emailed_at = now() where n.emailed_at is null and n.created_at <= now() - interval '2 days';

  return query
  with picked as (
    select n.id from public.notifications n
    where n.emailed_at is null and n.email_attempts < 3
      and (n.email_claimed_at is null or n.email_claimed_at < now() - interval '10 minutes')
    order by n.created_at limit greatest(1, least(p_limit, 100))
    for update skip locked
  ), bumped as (
    update public.notifications n set email_attempts = n.email_attempts + 1, email_claimed_at = now() from picked where n.id = picked.id
    returning n.id, n.user_id, n.kind, n.title, n.body, n.link
  )
  select b.id, b.user_id, b.kind, b.title, b.body, b.link, p.email, p.full_name
  from bumped b join public.profiles p on p.id = b.user_id;
end;
$$;
notify pgrst,'reload schema';
commit;
