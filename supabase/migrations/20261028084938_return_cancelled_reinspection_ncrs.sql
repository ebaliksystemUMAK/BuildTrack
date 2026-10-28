-- Cancelling a correction inspection must not strand its package NCRs For verification.
-- CLI-generated filename aligned to the hosted connector version after application.
-- Existing cancellation permissions, item return, timeline and immutable evidence stay authoritative.
create function public.return_cancelled_reinspection_ncrs() returns trigger
language plpgsql security invoker set search_path='' as $$
declare finding record; return_note text;
begin
  if new.status<>'cancelled' or old.status not in ('requested','in_progress') then return new; end if;
  return_note:='Reinspection IR-' || lpad(new.number::text,4,'0') || ' cancelled. NCR remains open for correction. '
    || coalesce(new.summary,'');
  for finding in
    select d.id from public.qa_defects d
      join public.qa_work_attempts a on a.id=d.correction_attempt_id
    where a.submitted_inspection_id=new.id and d.project_id=new.project_id and d.pin_id=new.pin_id
      and d.status='for_verification'
    order by d.number for update of d
  loop
    -- Reuses active Engineer authorization, rejection history and assigned Foreman notification.
    perform public.verify_defect(finding.id,false,return_note);
  end loop;
  return new;
end; $$;
revoke all on function public.return_cancelled_reinspection_ncrs() from public,anon,authenticated;
create trigger zz_return_cancelled_reinspection_ncrs after update of status on public.qa_inspections
  for each row when (old.status is distinct from new.status) execute function public.return_cancelled_reinspection_ncrs();

-- No changes to already-cancelled inspections, existing NCRs, results or evidence.
notify pgrst,'reload schema';
