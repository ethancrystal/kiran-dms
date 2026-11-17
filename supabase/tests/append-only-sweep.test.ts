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

// A table that says so itself: its table comment calls it append-only or immutable (any case; the
// migrations use both words, e.g. "Append-only" on visit, "Immutable" on invoice and delivery).
const DECLARED = `obj_description(c.oid, 'pg_class') ~* 'append[- ]only|immutable'`;

// Tables that are append-only by their own account (the guard is on them in any shape, or their
// table comment says append-only or immutable) but whose guard is missing, disabled, partial, or
// conditional. Two arms: the trigger arm sees a guard that was damaged; the comment arm sees a table
// that lost its trigger altogether (a trigger-only search cannot see an absence).
const APPEND_ONLY_GAPS = `
  select n.nspname || '.' || c.relname t from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where c.relkind in ('r', 'p') and n.nspname in ${SCHEMAS}
    and (${DECLARED}
         or exists (select 1 from (${triggersOf("c")}) g where (tgtype & 24) <> 0))
    and not exists (select 1 from (${triggersOf("c")}) g
                    where ${ROW_BEFORE_UPDATE_DELETE}
                      and tgenabled in ('O', 'A') and tgqual is null and tgattr = ''::int2vector)
  order by 1`;

// Every table in our schemas whose comment says append-only or immutable, guarded or not.
const DECLARED_TABLES = `
  select n.nspname || '.' || c.relname t from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where c.relkind in ('r', 'p') and n.nspname in ${SCHEMAS} and ${DECLARED}
  order by 1`;

// Functions in our schemas whose body talks about append-only or immutable: candidates for an
// append-only guard. Seen from the catalog, so a new one cannot hide.
const GUARD_FUNCTIONS = `
  select n.nspname || '.' || p.proname t from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ${SCHEMAS} and p.prosrc ~* 'append[- ]only|immutable'
  order by 1`;

// Trigger functions that raise "immutable" for a narrower rule than append-only: they freeze identity
// columns or a decided row and let the permitted updates through. A function of this kind is not an
// append-only guard, so the tables it guards are not swept as append-only. This is a list of
// functions (twelve, reviewed), not of tables; a new one fails the test below until it is reviewed.
const IDENTITY_GUARDS = [
  "control.approval_guard",
  "control.device_guard",
  "control.investor_guard",
  "control.invitation_guard",
  "control.master_row_guard",
  "control.sales_order_guard",
  "control.salon_contact_guard",
  "control.salon_guard",
  "control.salon_membership_guard",
  "control.salon_signup_request_guard",
  "control.stock_issue_guard",
  "control.user_profile_guard",
];

/** Every append-only table, found by catalog in the five schemas. */
async function appendOnlyTables(): Promise<string[]> {
  return (await run("postgres", APPEND_ONLY)).rows.map((r) => r.t);
}

/** The append-only tables plus every table that calls itself append-only or immutable. */
async function sweptTables(): Promise<string[]> {
  const declared = (await run("postgres", DECLARED_TABLES)).rows.map((r) => r.t);
  return [...new Set([...(await appendOnlyTables()), ...declared])].sort();
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

  it("control.forbid_mutation is the only function that raises an append-only or immutable error for a whole row", async () => {
    // A second append-only guard function would hide tables from appendOnlyTables(); it must be added there.
    const { rows } = await run("postgres", GUARD_FUNCTIONS);
    const unreviewed = rows.map((r) => r.t).filter((f) => !IDENTITY_GUARDS.includes(f));
    expect(unreviewed).toEqual(["control.forbid_mutation"]);
    // Nothing in the reviewed list has gone away unnoticed either.
    expect(IDENTITY_GUARDS.filter((f) => !rows.some((r) => r.t === f))).toEqual([]);
  });

  it("the function detector sees a new guard function that raises 'immutable' or 'append only'", async () => {
    const make = (name: string, message: string) =>
      `create function public.${name}() returns trigger language plpgsql as $f$ begin raise exception '${message}'; end $f$`;
    expect(await planted(make("zz_planted_guard", "rows are immutable"), GUARD_FUNCTIONS)).toContain("public.zz_planted_guard");
    expect(await planted(make("zz_planted_guard", "table is append only"), GUARD_FUNCTIONS)).toContain("public.zz_planted_guard");
    expect(await planted(make("zz_planted_guard", "no way"), GUARD_FUNCTIONS)).not.toContain("public.zz_planted_guard");
  });

  it("every append-only table has an enabled, unconditional BEFORE UPDATE OR DELETE row trigger", async () => {
    expect((await run("postgres", APPEND_ONLY_GAPS)).rows).toEqual([]);
  });

  it("every table that calls itself append-only or immutable has the trigger, and the list is not vacuous", async () => {
    const declared = (await run("postgres", DECLARED_TABLES)).rows.map((r) => r.t);
    const tables = await appendOnlyTables();
    expect(declared.length).toBeGreaterThan(0);
    expect(declared.filter((t) => !tables.includes(t))).toEqual([]);
    // The two words used in the migrations are both seen.
    expect(declared).toContain("public.visit");
    expect(declared).toContain("public.invoice");
  });

  it("no application role holds an UPDATE, DELETE or TRUNCATE privilege on any append-only or immutable table", async () => {
    const tables = await sweptTables();
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
    const tables = await sweptTables();
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

  it("the comment arm: a table that calls itself append-only or immutable, in any wording, but has no guard", async () => {
    const commented = (text: string) =>
      `create table public.zz_planted_ao (id int primary key, v int); comment on table public.zz_planted_ao is '${text}'`;
    const wordings = [
      "Planted. Append-only.",
      "Immutable (doc 04): corrections are credit notes.",
      "planted. append-only history",
      "APPEND ONLY",
      "Fixed at issue. Immutable: what has been paid is derived.",
    ];
    const found = await wordings.reduce(
      async (done, text) => [...(await done), [text, await planted(commented(text), APPEND_ONLY_GAPS)] as const],
      Promise.resolve([] as Array<readonly [string, string[]]>),
    );
    expect(found).toEqual(wordings.map((text) => [text, ["public.zz_planted_ao"]]));
    // A comment that is about something else is left alone.
    expect(await planted(commented("Planted. A list of things."), APPEND_ONLY_GAPS)).toEqual([]);
  });

  it("the trigger arm alone: a damaged guard on a table with NO comment is still reported", async () => {
    // No comment, so the comment arm cannot see these tables; only the trigger arm can.
    const bare = "create table public.zz_planted_ao (id int primary key, v int)";
    const trig = (spec: string) =>
      `create trigger append_only ${spec} on public.zz_planted_ao for each row execute function control.forbid_mutation()`;
    const flagged = ["public.zz_planted_ao"];
    // Control: a correct guard on the same bare table is accepted, so the cases below fail for the damage alone.
    expect(await planted(`${bare}; ${trig("before update or delete")}`, APPEND_ONLY_GAPS)).toEqual([]);

    const broken: Array<[string, string]> = [
      ["only BEFORE UPDATE", `${bare}; ${trig("before update")}`],
      ["only BEFORE DELETE", `${bare}; ${trig("before delete")}`],
      ["disabled", `${bare}; ${trig("before update or delete")}; alter table public.zz_planted_ao disable trigger append_only`],
      ["AFTER trigger", `${bare}; ${trig("after update or delete")}`],
    ];
    const found = await broken.reduce(
      async (done, [why, setup]) => [...(await done), [why, await planted(setup, APPEND_ONLY_GAPS)] as const],
      Promise.resolve([] as Array<readonly [string, string[]]>),
    );
    expect(found).toEqual(broken.map(([why]) => [why, flagged]));
  });
});
