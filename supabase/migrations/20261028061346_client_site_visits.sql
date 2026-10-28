-- Client requests and Engineer decisions share one project-scoped record.
create table public.site_visit_requests (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  client_id uuid not null default auth.uid() references public.profiles(id),
  preferred_at timestamptz not null,
  purpose text not null check (char_length(btrim(purpose)) between 5 and 1000),
  visitors integer not null default 1 check (visitors between 1 and 50),
  status text not null default 'requested' check (status in ('requested', 'confirmed', 'declined', 'cancelled')),
  engineer_note text check (engineer_note is null or char_length(engineer_note) <= 2000),
  responded_by uuid references public.profiles(id),
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index site_visit_requests_project_idx on public.site_visit_requests(project_id, created_at desc);
create index site_visit_requests_client_idx on public.site_visit_requests(client_id);
create index site_visit_requests_responder_idx on public.site_visit_requests(responded_by);
create unique index site_visit_requests_slot_idx on public.site_visit_requests(project_id, client_id, preferred_at)
  where status in ('requested', 'confirmed');

alter table public.site_visit_requests enable row level security;
create policy "read own visits or assigned engineer visits" on public.site_visit_requests for select to authenticated
using (public.is_active() and exists (
  select 1 from public.project_members m join public.profiles p on p.id = m.user_id
  where m.project_id = site_visit_requests.project_id and m.user_id = (select auth.uid())
    and p.role = m.member_role and (p.role = 'engineer' or (p.role = 'client' and client_id = (select auth.uid())))
));
create policy "clients request site visits" on public.site_visit_requests for insert to authenticated
with check (client_id = (select auth.uid()) and public.is_active() and exists (
  select 1 from public.project_members m join public.profiles p on p.id = m.user_id
  where m.project_id = site_visit_requests.project_id and m.user_id = (select auth.uid())
    and m.member_role = 'client' and p.role = 'client'
));
create policy "respond to or cancel site visits" on public.site_visit_requests for update to authenticated
using (public.is_active() and public.is_project_member(project_id) and
  (client_id = (select auth.uid()) or exists (select 1 from public.project_members m join public.profiles p on p.id = m.user_id
    where m.project_id = site_visit_requests.project_id and m.user_id = (select auth.uid()) and m.member_role = 'engineer' and p.role = 'engineer')))
with check (public.is_active() and public.is_project_member(project_id) and
  (client_id = (select auth.uid()) or exists (select 1 from public.project_members m join public.profiles p on p.id = m.user_id
    where m.project_id = site_visit_requests.project_id and m.user_id = (select auth.uid()) and m.member_role = 'engineer' and p.role = 'engineer')));
revoke all on public.site_visit_requests from anon, authenticated;
grant select on public.site_visit_requests to authenticated;
grant insert(project_id, preferred_at, purpose, visitors) on public.site_visit_requests to authenticated;
grant update(status, engineer_note) on public.site_visit_requests to authenticated;

create function public.prepare_site_visit_request()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare actor_role public.app_role;
begin
  if auth.uid() is null or not public.is_active() then raise exception 'Active account required'; end if;
  select p.role into actor_role from public.project_members m join public.profiles p on p.id = m.user_id
    where m.project_id = new.project_id and m.user_id = auth.uid() and m.member_role = p.role;
  if tg_op = 'INSERT' then
    if actor_role is distinct from 'client'::public.app_role then raise exception 'Only assigned clients can request a visit'; end if;
    if new.preferred_at <= now() then raise exception 'Choose a future visit date and time'; end if;
    new.client_id := auth.uid();
    new.status := 'requested';
    new.purpose := btrim(new.purpose);
    new.engineer_note := null; new.responded_by := null; new.responded_at := null;
    new.created_at := now();
  else
    if (new.id, new.project_id, new.client_id, new.preferred_at, new.purpose, new.visitors, new.created_at)
       is distinct from (old.id, old.project_id, old.client_id, old.preferred_at, old.purpose, old.visitors, old.created_at) then
      raise exception 'Visit request details cannot change';
    end if;
    if old.preferred_at <= now() then raise exception 'This visit time has passed'; end if;
    if actor_role = 'client' and old.client_id = auth.uid() then
      if old.status not in ('requested', 'confirmed') or new.status <> 'cancelled' or new.engineer_note is distinct from old.engineer_note then
        raise exception 'Clients can only cancel their own pending or confirmed visits';
      end if;
      new.responded_by := old.responded_by; new.responded_at := old.responded_at;
    elsif actor_role = 'engineer' then
      if old.status <> 'requested' or new.status not in ('confirmed', 'declined') then raise exception 'This request has already been decided or cancelled'; end if;
      new.engineer_note := nullif(btrim(new.engineer_note), '');
      if new.status = 'declined' and new.engineer_note is null then raise exception 'Explain why this visit cannot be confirmed'; end if;
      new.responded_by := auth.uid(); new.responded_at := now();
    else raise exception 'You cannot change this visit request';
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
create trigger site_visit_request_prepare before insert or update on public.site_visit_requests
for each row execute function public.prepare_site_visit_request();
revoke execute on function public.prepare_site_visit_request() from public, anon, authenticated;

-- Privileged notification writes are internal trigger code, never an exposed callable RPC.
create schema if not exists private;
create function private.notify_site_visit_request()
returns trigger language plpgsql security definer set search_path = '' as $$
declare person record;
begin
  if tg_op = 'INSERT' or new.status = 'cancelled' then
    for person in select m.user_id from public.project_members m join public.profiles p on p.id = m.user_id
      where m.project_id = new.project_id and m.member_role = 'engineer' and p.role = 'engineer' and p.status = 'active'
    loop
      perform public.notify_user(person.user_id, 'visit.' || new.status,
        case when new.status = 'requested' then 'Client site visit requested' else 'Client site visit cancelled' end,
        to_char(new.preferred_at at time zone 'Asia/Manila', 'DD Mon YYYY HH24:MI') || ' (Manila) · ' || left(new.purpose, 200),
        '/engineer/reports?project=' || new.project_id || '&tab=visits&visit=' || new.id,
        new.project_id, new.id, 'visit-' || new.id || '-' || new.status);
    end loop;
  else
    perform public.notify_user(new.client_id, 'visit.' || new.status,
      case when new.status = 'confirmed' then 'Your site visit is confirmed' else 'Site visit request declined' end,
      to_char(new.preferred_at at time zone 'Asia/Manila', 'DD Mon YYYY HH24:MI') || ' (Manila)' || coalesce(' · ' || new.engineer_note, ''),
      '/client/communication?project=' || new.project_id || '&tab=visits&visit=' || new.id,
      new.project_id, new.id, 'visit-' || new.id || '-' || new.status);
  end if;
  return new;
end;
$$;
revoke all on function private.notify_site_visit_request() from public, anon, authenticated;
create trigger site_visit_request_notify after insert or update of status on public.site_visit_requests
for each row execute function private.notify_site_visit_request();
alter publication supabase_realtime add table public.site_visit_requests;
