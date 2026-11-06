-- A PIC may save a task schedule without explaining the change. A supplied reason remains limited and audited.
create or replace function public.save_timeline_item(p_project uuid,p_key text,p_plan jsonb,p_expected integer,p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  p_reason:=btrim(coalesce(p_reason,''));
  if not public.can_manage_timeline(p_project) then raise exception 'Only project schedule managers can edit this timeline' using errcode='42501'; end if;
  if char_length(p_reason)>500 then raise exception 'Keep the optional schedule reason within 500 characters'; end if;
  perform public.write_timeline_item(p_project,p_key,p_plan,p_expected,p_reason);
end;
$$;
