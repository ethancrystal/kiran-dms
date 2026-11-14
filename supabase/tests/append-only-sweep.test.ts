/**
 * Doc 06 section 10, criterion 2: no role can UPDATE or DELETE an append-only table (H-06, doc 04
 * invariant 1). The table list is read from the catalog, never typed by hand, so a table added by a
 * later migration is swept the day it appears and a table that loses its guard is reported.
 *
 * What proves what:
 *   - rep, manager, owner, anon (and service_role): UPDATE, DELETE and TRUNCATE are refused by the
 *     grants (no write privilege at all). `where false` is enough for that, because the privilege
 *     check runs before any row is read. The catalog check beside it states the same fact without
 *     running a statement.
 *   - postgres and any role that did hold a grant: only the trigger refuses. A statement with
 *     `where false` never fires a row trigger, so the trigger is proved by its catalog definition
 *     (enabled, BEFORE, FOR EACH ROW, UPDATE and DELETE, no WHEN clause, no column list) and, on a
 *     planted table with a real row, by the refusal itself.
 */
import { describe, expect, it } from "vitest";
import { errorOf, MANAGER, OWNER, REP_A, REP_B, run, sqlstate, type Who } from "./helpers/db";

const SCHEMAS = "('public', 'control', 'app', 'supplier_vault', 'vault_api')";
const DENIED = "42501";
// 46 tables at the time of writing; the floor only has to stop the list from collapsing to nothing.
const MIN_APPEND_ONLY_TABLES = 40;

// A trigger that calls control.forbid_mutation (the one append-only guard, foundation migration).
// tgtype bits: 1 row, 2 before, 4 insert, 8 delete, 16 update.
const GUARD_FN = `fn.nspname = 'control' and f.proname = 'forbid_mutation'`;
const triggersOf = (c: string) => `
  select tg.* from pg_trigger tg join pg_proc f on f.oid = tg.tgfoid join pg_namespace fn on fn.oid = f.pronamespace
  where tg.tgrelid = ${c}.oid and not tg.tgisinternal and ${GUARD_FN}`;
const ROW_BEFORE_UPDATE_DELETE = `(tgtype & 1) = 1 and (tgtype & 2) = 2 and (tgtype & 8) = 8 and (tgtype & 16) = 16`;

// Every table in our schemas with a row-level BEFORE UPDATE OR DELETE trigger calling the guard.
const APPEND_ONLY = `
  select n.nspname || '.' || c.relname t from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where c.relkind in ('r', 'p') and n.nspname in ${SCHEMAS}
    and exists (select 1 from (${triggersOf("c")}) g where ${ROW_BEFORE_UPDATE_DELETE})
  order by 1`;

// Tables that are append-only by their own account (the guard is on them in any shape, or their
// table comment says "Append-only") but whose guard is missing, disabled, partial, or conditional.
// A table that lost its trigger altogether is still found through its comment.
const APPEND_ONLY_GAPS = `
  select n.nspname || '.' || c.relname t from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where c.relkind in ('r', 'p') and n.nspname in ${SCHEMAS}
    and (obj_description(c.oid, 'pg_class') ~ 'Append-only'
         or exists (select 1 from (${triggersOf("c")}) g where (tgtype & 24) <> 0))
    and not exists (select 1 from (${triggersOf("c")}) g
                    where ${ROW_BEFORE_UPDATE_DELETE}
                      and tgenabled in ('O', 'A') and tgqual is null and tgattr = ''::int2vector)
  order by 1`;

/** Every append-only table, found by catalog in the five schemas. */
async function appendOnlyTables(): Promise<string[]> {
  return (await run("postgres", APPEND_ONLY)).rows.map((r) => r.t);
}

// Run setup statements and a guard in one rolled-back transaction; return the guard's rows.
const planted = async (setup: string, guard: string) => {
  const res = (await run("postgres", `${setup}; ${guard}`)) as unknown as Array<{ rows: Array<{ t: string }> }>;
  return res[res.length - 1].rows.map((r) => r.t);
};

// label, persona, database role it runs as
const ROLES: Array<[string, Who, string]> = [
  ["rep", REP_A, "authenticated"],
  ["second rep", REP_B, "authenticated"],
  ["manager", MANAGER, "authenticated"],
  ["owner", OWNER, "authenticated"],
  ["anon", "anon", "anon"],
  ["service_role", "service_role", "service_role"],
];

const ATTACKS: Array<[string, (t: string, col: string) => string]> = [
  ["update", (t, col) => `update ${t} set ${col} = ${col} where false`],
  ["delete", (t) => `delete from ${t} where false`],
  ["truncate", (t) => `truncate ${t}`],
];

describe("append-only sweep (doc 06 10.2)", () => {
  it("finds the append-only tables by catalog, and the list is not vacuous", async () => {
    const tables = await appendOnlyTables();
    const known = [
      "control.audit_event",
      "control.phone_reveal",
      "public.invoice",
      "public.visit",
      "public.payment",
      "public.stock_movement",
    ];
    expect(known.filter((t) => !tables.includes(t))).toEqual([]);
    expect(tables.length).toBeGreaterThanOrEqual(MIN_APPEND_ONLY_TABLES);
  });

  it("control.forbid_mutation is the only function that raises the append-only error", async () => {
    // A second append-only function would hide tables from appendOnlyTables(); it must be added there.
    const { rows } = await run(
      "postgres",
      `select n.nspname || '.' || p.proname f from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname in ${SCHEMAS} and p.prosrc ~* 'append-only' order by 1`,
    );
    expect(rows.map((r) => r.f)).toEqual(["control.forbid_mutation"]);
  });

  it("every append-only table has an enabled, unconditional BEFORE UPDATE OR DELETE row trigger", async () => {
    expect((await run("postgres", APPEND_ONLY_GAPS)).rows).toEqual([]);
  });

  it("no application role holds an UPDATE, DELETE or TRUNCATE privilege on any append-only table", async () => {
    const tables = await appendOnlyTables();
    const held = await Promise.all(
      ROLES.map(async ([label, , role]) => {
        const { rows } = await run(
          "postgres",
          `select t from unnest($1::text[]) t
           where has_table_privilege($2, t::regclass, 'update, delete, truncate')
              or has_any_column_privilege($2, t::regclass, 'update')`,
          [tables, role],
        );
        return rows.map((r) => `${label}: ${r.t}`);
      }),
    );
    expect(held.flat()).toEqual([]);
  });

  it.each(ROLES)("%s: UPDATE, DELETE and TRUNCATE on every append-only table are refused (42501)", async (_label, who) => {
    const tables = await appendOnlyTables();
    const { rows: cols } = await run(
      "postgres",
      `select distinct on (a.attrelid) n.nspname || '.' || c.relname t, quote_ident(a.attname) c
       from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
       where a.attrelid = any (select t::regclass from unnest($1::text[]) t) and a.attnum > 0 and not a.attisdropped
       order by a.attrelid, a.attnum`,
      [tables],
    );
    const firstColumn = new Map(cols.map((r) => [r.t as string, r.c as string]));
    expect(tables.filter((t) => !firstColumn.has(t))).toEqual([]);
    const outcomes = await Promise.all(
      tables.flatMap((t) =>
        ATTACKS.map(async ([op, sql]) => {
          const code = await sqlstate(who, sql(t, firstColumn.get(t) as string));
          return code === DENIED ? null : `${t} ${op}: ${code ?? "succeeded"}`;
        }),
      ),
    );
    expect(outcomes.filter((o) => o !== null)).toEqual([]);
  });

  it("the refusal for an application role is a grant denial, before any row is read", async () => {
    // States what the sweep above proves for these roles: no privilege, so the trigger never matters.
    const messages = await Promise.all(
      ROLES.flatMap(([, who]) => [
        errorOf(who, "update public.invoice set id = id where false"),
        errorOf(who, "delete from control.audit_event where false"),
      ]),
    );
    expect(messages.filter((m) => !m?.includes("permission denied"))).toEqual([]);
  });

  it("the table owner is stopped by the trigger when a row exists (planted table with a real row)", async () => {
    // postgres holds every grant, so only the guard refuses.
    const setup = `create table public.zz_planted_ao (id int primary key, v int);
      insert into public.zz_planted_ao values (1, 1);
      create trigger append_only before update or delete on public.zz_planted_ao
        for each row execute function control.forbid_mutation()`;
    const refused = (sql: string) =>
      `begin ${sql}; raise exception 'not refused'; exception when insufficient_privilege then null; end;`;
    const probe = `do $$ begin
      ${refused("update public.zz_planted_ao set v = 2")}
      ${refused("delete from public.zz_planted_ao")}
    end $$`;
    expect(await planted(`${setup}; ${probe}`, APPEND_ONLY_GAPS)).toEqual([]);
    // Without the trigger the same statements go through: the refusal above was the trigger's alone.
    const off = "alter table public.zz_planted_ao disable trigger append_only";
    await expect(run("postgres", `${setup}; ${off}; ${probe}`)).rejects.toThrow("not refused");
  });

  it("the guard reports a planted table whose trigger is missing, disabled, partial or conditional", async () => {
    const table = `create table public.zz_planted_ao (id int primary key, v int);
      comment on table public.zz_planted_ao is 'Planted. Append-only.'`;
    const trig = (spec: string, when = "") =>
      `create trigger append_only ${spec} on public.zz_planted_ao for each row ${when}execute function control.forbid_mutation()`;
    const flagged = ["public.zz_planted_ao"];
    const guarded = `${table}; ${trig("before update or delete")}`;

    // Declared append-only (comment) and never guarded: found by its comment.
    expect(await planted(table, APPEND_ONLY_GAPS)).toEqual(flagged);
    // Guarded properly: not reported, and listed as append-only.
    expect(await planted(guarded, APPEND_ONLY_GAPS)).toEqual([]);
    expect((await planted(guarded, APPEND_ONLY)).filter((t) => t.includes("zz_planted"))).toEqual(flagged);

    const broken: Array<[string, string]> = [
      ["trigger removed", `${guarded}; drop trigger append_only on public.zz_planted_ao`],
      ["trigger disabled", `${guarded}; alter table public.zz_planted_ao disable trigger append_only`],
      ["replica-only trigger", `${guarded}; alter table public.zz_planted_ao enable replica trigger append_only`],
      ["update only", `${table}; ${trig("before update")}`],
      ["delete only", `${table}; ${trig("before delete")}`],
      ["after trigger", `${table}; ${trig("after update or delete")}`],
      ["when clause", `${table}; ${trig("before update or delete", "when (false) ")}`],
      ["column list", `${table}; ${trig("before update of v or delete")}`],
      [
        "statement trigger",
        `${table}; create trigger append_only before update or delete on public.zz_planted_ao for each statement execute function control.forbid_mutation()`,
      ],
      [
        "look-alike function in another schema",
        `${table}; create function public.zz_forbid() returns trigger language plpgsql as $f$ begin raise exception 'x'; end $f$;
         create trigger append_only before update or delete on public.zz_planted_ao for each row execute function public.zz_forbid()`,
      ],
    ];
    // One after another: every case creates the same table name, so they must not overlap.
    const found = await broken.reduce(
      async (done, [why, setup]) => [...(await done), [why, await planted(setup, APPEND_ONLY_GAPS)] as const],
      Promise.resolve([] as Array<readonly [string, string[]]>),
    );
    expect(found).toEqual(broken.map(([why]) => [why, flagged]));

    // An unrelated table with neither comment nor guard is not an append-only table.
    expect(await planted("create table public.zz_planted_plain (id int)", APPEND_ONLY_GAPS)).toEqual([]);
  });
});
