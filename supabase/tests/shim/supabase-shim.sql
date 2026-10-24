-- Test-only shim: reproduces the parts of a Supabase database that Kiran DMS
-- migrations depend on, so they can be applied to a plain Postgres 17 (embedded-postgres)
-- for the RLS matrix suite. NEVER applied to a real Supabase project: every object is
-- created only if missing, so on supabase/postgres (CI) this file is a no-op.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then
    create role authenticator login noinherit;
  end if;
end $$;

grant anon, authenticated, service_role to authenticator;

create schema if not exists extensions;
create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;

create table if not exists auth.users (
  id uuid primary key,
  email text,
  phone text,
  created_at timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'auth' and p.proname = 'uid') then
    execute $f$
      create function auth.uid() returns uuid language sql stable as
      $b$ select nullif(coalesce(current_setting('request.jwt.claim.sub', true),
                                 (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')), '')::uuid $b$;
    $f$;
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'auth' and p.proname = 'jwt') then
    execute $f$
      create function auth.jwt() returns jsonb language sql stable as
      $b$ select coalesce(nullif(current_setting('request.jwt.claim', true), ''),
                          nullif(current_setting('request.jwt.claims', true), ''))::jsonb $b$;
    $f$;
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'auth' and p.proname = 'role') then
    execute $f$
      create function auth.role() returns text language sql stable as
      $b$ select nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') $b$;
    $f$;
  end if;
end $$;

grant execute on function auth.uid(), auth.jwt(), auth.role() to anon, authenticated, service_role;

-- Supabase grants these by default on public; mirror it so the migrations' explicit
-- REVOKEs are exercised exactly as they will be on the real platform.
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
