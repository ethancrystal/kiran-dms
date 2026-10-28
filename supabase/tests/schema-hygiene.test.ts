/**
 * Structural guarantees that must hold for every table and function, now and in every
 * future migration (H-08, H-13, H-17, H-18, doc 07 §2).
 */
import { describe, expect, it } from "vitest";
import { run } from "./helpers/db";

const SCHEMAS = "('public', 'control', 'supplier_vault', 'app', 'vault_api')";
const notExtension = `not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')`;

// Guard queries for council findings 4 and 6 (B-26). Each returns the offending objects; the
// tests below assert it returns none, and that it does catch a planted violation.
const AUDIT_GAPS = `
  select n.nspname || '.' || c.relname t from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where c.relkind in ('r', 'p') and n.nspname in ${SCHEMAS}
    and n.nspname || '.' || c.relname not in ('control.audit_event', 'control.audit_chain_head')
    and not exists (select 1 from pg_trigger tg join pg_proc f on f.oid = tg.tgfoid
                    join pg_namespace fn on fn.oid = f.pronamespace
                    where tg.tgrelid = c.oid and not tg.tgisinternal
                      and fn.nspname = 'control' and f.proname = 'audit_row'
                      and tg.tgenabled in ('O', 'A')
                      and (tg.tgtype & 1) = 1 and (tg.tgtype & 2) = 0 and (tg.tgtype & 28) = 28
                      and tg.tgqual is null and tg.tgattr = ''::int2vector)`;
const VIEW_GAPS = `
  select n.nspname || '.' || c.relname t from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname in ${SCHEMAS}
    and (c.relkind in ('m', 'f')
         or (c.relkind = 'v' and not exists (
               select 1 from unnest(coalesce(c.reloptions, '{}')) o
               where o like 'security_invoker=%' and substr(o, 18)::boolean)))`;
const SCHEMA_GAPS = `
  select n.nspname t from pg_namespace n
  where (
    -- Any schema the migration role owns or could have created WITH AUTHORIZATION another role
    -- (or handed over with ALTER SCHEMA ... OWNER TO): both need membership in the owner role.
    (pg_has_role(current_user, n.nspowner, 'MEMBER')
     and left(n.nspname, 3) <> 'pg_' and n.nspname <> 'information_schema'
     and n.nspname not in ${SCHEMAS}
     and n.nspname not in ('auth', 'extensions', 'storage', 'graphql', 'graphql_public', 'realtime', '_realtime',
                           'vault', 'pgsodium', 'pgsodium_masks', 'net', 'cron', 'supabase_functions',
                           'supabase_migrations', 'pgbouncer', '_analytics', '_supavisor')
     and (exists (select 1 from pg_class c where c.relnamespace = n.oid)
          or exists (select 1 from pg_proc p where p.pronamespace = n.oid)))
    -- graphql_public is exposed through the API (config.toml) and holds the platform's graphql()
    -- function, but no table, view or sequence of any kind, whoever owns the schema.
    or (n.nspname = 'graphql_public'
        and exists (select 1 from pg_class c where c.relnamespace = n.oid
                    and c.relkind in ('r', 'p', 'v', 'm', 'f', 'S'))))`;
// Run setup statements and a guard in one rolled-back transaction; return the guard's rows.
const planted = async (setup: string, guard: string) => {
  const res = (await run("postgres", `${setup}; ${guard}`)) as unknown as Array<{ rows: Array<{ t: string }> }>;
  return res[res.length - 1].rows.map((r) => r.t);
};

describe("schema hygiene", () => {
  it("every table has RLS enabled AND forced (H-13)", async () => {
    const { rows } = await run("postgres", `
      select n.nspname || '.' || c.relname t from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where c.relkind in ('r', 'p') and n.nspname in ${SCHEMAS}
        and not (c.relrowsecurity and c.relforcerowsecurity)`);
    expect(rows).toEqual([]);
  });

  it("every table except the audit chain itself has an enabled AFTER ROW INSERT/UPDATE/DELETE audit trigger calling control.audit_row (H-17)", async () => {
    // Not just "a trigger named audit_row exists": a disabled trigger, a statement-level or
    // BEFORE trigger, one that skips an operation, or a look-alike function in another schema
    // all fail (council finding 6, B-26). So does a trigger with a WHEN clause (tgqual) or an
    // UPDATE OF column list (tgattr), which can skip rows or columns (L-0116 D1).
    // tgtype bits: 1 row, 2 before, 4 insert, 8 delete, 16 update.
    expect((await run("postgres", AUDIT_GAPS)).rows).toEqual([]);
  });

  it("every view in our schemas runs with the caller's rights (security_invoker), and none is materialized or foreign", async () => {
    // A view owned by postgres without security_invoker reads base tables past RLS; a
    // materialized view or foreign table has no RLS at all (council finding 4, B-26).
    // Postgres stores the option as written (1, yes, On, t ...); the guard reads it with
    // Postgres's own boolean parser, so every spelling Postgres treats as true passes and
    // nothing else does (L-0116 FP1).
    expect((await run("postgres", VIEW_GAPS)).rows).toEqual([]);
  });

  it("no schema created by our migrations is missing from the guarded list", async () => {
    // A new schema (exposed through the API or not) would escape every guard in this file.
    // Platform schemas are excluded by name; any other schema with objects whose owner the
    // migration role owns or is a member of (so it could have been created WITH AUTHORIZATION
    // that role) must be one of ours (council finding 4, B-26; L-0116 D3). graphql_public is
    // exposed through the API: it may hold the platform's functions, but no relation at all.
    expect((await run("postgres", SCHEMA_GAPS)).rows).toEqual([]);
  });

  it("each of those guards catches a planted violation (the guards are tested, not just run)", async () => {
    expect(await planted("alter table public.app_config disable trigger audit", AUDIT_GAPS)).toEqual(["public.app_config"]);
    expect(await planted(`drop trigger audit on public.app_config;
      create trigger audit after insert or update on public.app_config for each row execute function control.audit_row()`, AUDIT_GAPS)).toEqual(["public.app_config"]);
    expect(await planted("create view public.zz_planted as select 1 as x", VIEW_GAPS)).toEqual(["public.zz_planted"]);
    expect(await planted("create view app.zz_planted with (security_invoker = true) as select 1 as x", VIEW_GAPS)).toEqual([]);
    expect(await planted("create materialized view public.zz_planted_m as select 1 as x", VIEW_GAPS)).toEqual(["public.zz_planted_m"]);
    expect(await planted("create schema zz_planted; create table zz_planted.t (id int)", SCHEMA_GAPS)).toEqual(["zz_planted"]);
  });

  it("AUDIT_GAPS refuses an audit trigger with a WHEN clause or an UPDATE OF column list (L-0116 D1)", async () => {
    const swap = (spec: string, when = "") => `drop trigger audit on public.app_config;
      create trigger audit ${spec} on public.app_config for each row ${when}execute function control.audit_row()`;
    expect(await planted(swap("after insert or update or delete", "when (false) "), AUDIT_GAPS)).toEqual(["public.app_config"]);
    expect(await planted(swap("after insert or update or delete", "when (true) "), AUDIT_GAPS)).toEqual(["public.app_config"]);
    expect(await planted(swap("after insert or update of note or delete"), AUDIT_GAPS)).toEqual(["public.app_config"]);
    // The same trigger declared plainly is accepted, so the planted cases fail for the clause alone.
    expect(await planted(swap("after insert or update or delete"), AUDIT_GAPS)).toEqual([]);
  });

  it("VIEW_GAPS accepts every spelling Postgres reads as security_invoker true, and nothing else (L-0116 FP1)", async () => {
    const view = (opt: string) => `create view public.zz_planted_v with (${opt}) as select 1 as x`;
    for (const opt of ["security_invoker", "security_invoker = true", "security_invoker = TRUE", "security_invoker = on",
                       "security_invoker = ON", "security_invoker = 1", "security_invoker = yes", "security_invoker = Yes",
                       "security_invoker = y", "security_invoker = t", "security_invoker = tru", "security_invoker = ye",
                       "security_invoker = 'tRuE'"]) {
      expect(await planted(view(opt), VIEW_GAPS), opt).toEqual([]);
    }
    for (const opt of ["security_invoker = false", "security_invoker = off", "security_invoker = 0", "security_invoker = no",
                       "security_invoker = n", "security_invoker = f", "security_invoker = of", "security_barrier = true",
                       "security_barrier = true, security_invoker = off"]) {
      expect(await planted(view(opt), VIEW_GAPS), opt).toEqual(["public.zz_planted_v"]);
    }
    // Turning the option off later is caught too.
    expect(await planted(`${view("security_invoker = on")}; alter view public.zz_planted_v set (security_invoker = off)`, VIEW_GAPS))
      .toEqual(["public.zz_planted_v"]);
    expect(await planted(`${view("security_invoker = on")}; alter view public.zz_planted_v reset (security_invoker)`, VIEW_GAPS))
      .toEqual(["public.zz_planted_v"]);
  });

  it("SCHEMA_GAPS catches a schema created WITH AUTHORIZATION another role, and any relation in graphql_public (L-0116 D3)", async () => {
    expect(await planted("create schema zz_planted_o authorization service_role; create table zz_planted_o.t (id int)", SCHEMA_GAPS))
      .toEqual(["zz_planted_o"]);
    expect(await planted("create schema zz_planted_a; create table zz_planted_a.t (id int); alter schema zz_planted_a owner to authenticated", SCHEMA_GAPS))
      .toEqual(["zz_planted_a"]);
    const gql = "create schema if not exists graphql_public";
    expect(await planted(`${gql}; create table graphql_public.zz_planted_t (id int)`, SCHEMA_GAPS)).toEqual(["graphql_public"]);
    expect(await planted(`${gql}; create view graphql_public.zz_planted_v with (security_invoker) as select 1 as x`, SCHEMA_GAPS)).toEqual(["graphql_public"]);
    expect(await planted(`${gql}; create sequence graphql_public.zz_planted_s`, SCHEMA_GAPS)).toEqual(["graphql_public"]);
    expect(await planted(`${gql} authorization service_role; create table graphql_public.zz_planted_t (id int)`, SCHEMA_GAPS)).toEqual(["graphql_public"]);
    // A function there (the platform's graphql() on the Supabase stack) is not flagged.
    expect(await planted(`${gql}; create function graphql_public.zz_planted_f() returns int language sql as 'select 1'`, SCHEMA_GAPS)).toEqual([]);
  });

  it("anon can execute no function in our schemas", async () => {
    const { rows } = await run("postgres", `
      select n.nspname || '.' || p.proname f from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ${SCHEMAS} and ${notExtension} and has_function_privilege('anon', p.oid, 'execute')`);
    expect(rows).toEqual([]);
  });

  it("every SECURITY DEFINER function pins search_path (H-08)", async () => {
    const { rows } = await run("postgres", `
      select n.nspname || '.' || p.proname f from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ${SCHEMAS} and ${notExtension} and p.prosecdef
        and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')`);
    expect(rows).toEqual([]);
  });

  it("supplier_vault is unreachable for every application role (doc 07 §5.1)", async () => {
    const { rows } = await run("postgres", `
      select r.rolname, has_schema_privilege(r.rolname, 'supplier_vault', 'usage') u
      from pg_roles r where r.rolname in ('anon', 'authenticated', 'service_role')`);
    expect(rows.every((r) => r.u === false)).toBe(true);
  });

  it("no foreign key leaves supplier_vault except to public.sku (doc 04 invariant 9)", async () => {
    const { rows } = await run("postgres", `
      select conname from pg_constraint c join pg_namespace n on n.oid = c.connamespace
      where c.contype = 'f' and n.nspname = 'supplier_vault'
        and c.confrelid::regclass::text not like 'supplier_vault.%'
        and c.confrelid::regclass::text <> 'public.sku'`);
    expect(rows).toEqual([]);
  });

  it("no public column name hints at supplier or cost data (H-01, H-27)", async () => {
    const { rows } = await run("postgres", `
      select table_schema || '.' || table_name || '.' || column_name c from information_schema.columns
      where table_schema in ('public', 'control')
        and column_name ~* '(supplier|manufacturer|vendor|unit_cost|cost_price|landed_cost|margin)'`);  // activity-log-check:allow-supplier-pattern
    expect(rows).toEqual([]);
  });
});
