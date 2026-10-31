-- Correct only the UTF-8 separator in the two audit display functions.
-- The initial Windows deployment decoded UTF-8 as Windows text; stored audit
-- records, permissions, signatures and all function logic remain unchanged.
do $$
declare signature text; definition text;
begin
  foreach signature in array array['public.audit_log_context(text,jsonb)', 'public.get_audit_log(text,text,timestamptz,timestamptz,integer,integer)'] loop
    definition := pg_get_functiondef(signature::regprocedure);
    definition := replace(definition, chr(194) || chr(183), chr(183));
    execute definition;
  end loop;
end;
$$;
