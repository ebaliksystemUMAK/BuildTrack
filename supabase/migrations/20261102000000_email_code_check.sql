-- Checks a typed emailed code WITHOUT using it up, so the Forgot password screen can confirm the code on its own step before asking for the new password.
-- Same rules as consume_email_code (20261101210000): newest unused unexpired code for that address and purpose, 5 wrong tries then locked, a wrong try is counted.
-- The only difference: a right code is NOT marked used. The password change (verify_reset) still consumes it, so a code can never be used twice and nothing is
-- changed by this function except the wrong-try counter. Service role only. Additive: no table, column or existing function is changed.

create or replace function public.check_email_code(p_email text, p_purpose text, p_hash text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_email text := lower(btrim(coalesce(p_email, ''))); c public.email_codes;
begin
  perform pg_advisory_xact_lock(hashtext(v_email || ':' || p_purpose));
  select * into c from public.email_codes where email = v_email and purpose = p_purpose and used_at is null and expires_at > now() order by created_at desc limit 1 for update;
  if c.id is null then return jsonb_build_object('ok', false, 'reason', 'invalid'); end if;
  if c.attempts >= 5 then return jsonb_build_object('ok', false, 'reason', 'locked'); end if;
  if c.code_hash = p_hash then return jsonb_build_object('ok', true); end if;
  update public.email_codes set attempts = attempts + 1 where id = c.id;
  return jsonb_build_object('ok', false, 'reason', case when c.attempts + 1 >= 5 then 'locked' else 'invalid' end);
end;
$$;
revoke execute on function public.check_email_code(text, text, text) from public, anon, authenticated;
grant execute on function public.check_email_code(text, text, text) to service_role;

-- Rollback: drop function public.check_email_code(text, text, text);
