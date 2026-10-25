/**
 * Structural guarantees that must hold for every table and function, now and in every
 * future migration (H-08, H-13, H-17, H-18, doc 07 §2).
 */
import { describe, expect, it } from "vitest";
import { run } from "./helpers/db";

const SCHEMAS = "('public', 'control', 'supplier_vault', 'app', 'vault_api')";
const notExtension = `not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')`;

describe("schema hygiene", () => {
  it("every table has RLS enabled AND forced (H-13)", async () => {
    const { rows } = await run("postgres", `
      select n.nspname || '.' || c.relname t from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where c.relkind in ('r', 'p') and n.nspname in ${SCHEMAS}
        and not (c.relrowsecurity and c.relforcerowsecurity)`);
    expect(rows).toEqual([]);
  });

  it("every table except the audit chain itself has the audit trigger (H-17)", async () => {
    const { rows } = await run("postgres", `
      select n.nspname || '.' || c.relname t from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where c.relkind in ('r', 'p') and n.nspname in ${SCHEMAS}
        and n.nspname || '.' || c.relname not in ('control.audit_event', 'control.audit_chain_head')
        and not exists (select 1 from pg_trigger tg join pg_proc f on f.oid = tg.tgfoid
                        where tg.tgrelid = c.oid and f.proname = 'audit_row' and not tg.tgisinternal)`);
    expect(rows).toEqual([]);
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
