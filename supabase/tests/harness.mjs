// Shared in-memory database for the SQL tests and the load test: PGlite with a minimal stand-in for Supabase's `auth` and
// `storage` schemas and the realtime publication, then every migration in supabase/migrations applied in order.
import { PGlite } from "@electric-sql/pglite"
import { readdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(here, "..", "migrations")

export async function createDatabase({ upto = Infinity, quiet = false } = {}) {
  const db = new PGlite()

  // ---- Minimal Supabase stand-in ----
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth;
    create table auth.users (
      id uuid primary key default gen_random_uuid(),
      email text unique,
      raw_user_meta_data jsonb not null default '{}'::jsonb,
      raw_app_meta_data jsonb not null default '{}'::jsonb,
      email_confirmed_at timestamptz,
      created_at timestamptz not null default now(),
      last_sign_in_at timestamptz
    );
    create table auth.sessions (id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users (id) on delete cascade);
    create table auth.refresh_tokens (id bigserial primary key, user_id varchar, session_id uuid);
    create function auth.uid() returns uuid language sql stable as
      $$ select (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid $$;
    create function auth.jwt() returns jsonb language sql stable as
      $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
    create schema storage;
    create table storage.buckets (id text primary key, name text not null, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets (id), name text not null, owner uuid, created_at timestamptz default now(), metadata jsonb);
    alter table storage.objects enable row level security;
    create function storage.foldername(name text) returns text[] language sql immutable as
      $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
    grant usage on schema storage to anon, authenticated;
    grant all on storage.objects to anon, authenticated;
    grant select on storage.buckets to anon, authenticated;
    grant usage on schema auth, public, storage to service_role;
    grant usage on schema auth, public to anon, authenticated;
    grant execute on all functions in schema auth to anon, authenticated;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant execute on functions to service_role;
    alter default privileges in schema public grant all on sequences to anon, authenticated;
    alter default privileges in schema public grant execute on functions to anon, authenticated; -- Supabase default, why the advisor flags definer functions
    create publication supabase_realtime; -- Supabase creates it empty; 0034 adds the live tables
  `)

  const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort()
  for (const file of files) {
    const number = Number(file.slice(0, 4))
    if (number > upto) continue
    try {
      await db.exec(readFileSync(join(migrationsDir, file), "utf8"))
      if (!quiet) console.log(`  applied ${file}`)
    } catch (error) {
      console.error(`  MIGRATION FAILED ${file}: ${error.message}`)
      process.exit(2)
    }
  }
  // Test-only fixture (20261028130000 blueprint type access): older suites were written when project membership gave every
  // Engineer / Foreman the whole project, so new members here get Assigned work on every type. Production does not.
  // 99-…-blueprint-type-access.cases.mjs turns it off (set_config('buildtrack.test_type_access', 'strict', false)).
  const hasTypeAccess = (await db.query("select to_regclass('public.project_blueprint_access') is not null as ok")).rows[0].ok
  if (hasTypeAccess) {
    await db.exec(`
      create function public.test_grant_all_blueprint_types() returns trigger language plpgsql security definer set search_path = '' as $$
      begin
        if coalesce(current_setting('buildtrack.test_type_access', true), '') <> 'strict' and new.member_role in ('engineer', 'foreman') then
          insert into public.project_blueprint_access (project_id, user_id, blueprint_type, access_level)
          select new.project_id, new.user_id, t, 'assigned'
          from unnest(array['architectural', 'civil_structural', 'electrical', 'mechanical', 'plumbing_sanitary']) t
          on conflict do nothing;
        end if;
        return new;
      end $$;
      create trigger zz_test_grant_all_blueprint_types after insert on public.project_members
        for each row execute function public.test_grant_all_blueprint_types();
      -- Keep the older audit / activity expectations unchanged: the fixture's grants are not what they test.
      create function public.test_hide_fixture_access_audit() returns trigger language plpgsql security definer set search_path = '' as $$
      begin
        if coalesce(current_setting('buildtrack.test_type_access', true), '') <> 'strict' then
          delete from public.audit_log where id = new.id;
        end if;
        return null;
      end $$;
      create trigger zz_test_hide_fixture_access_audit after insert on public.audit_log
        for each row when (new.action like 'project_blueprint_access.%') execute function public.test_hide_fixture_access_audit();
    `)
  }
  return db
}
