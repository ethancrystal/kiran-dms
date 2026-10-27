/**
 * RLS matrix (NFR-12, H-13, doc 06 §4 + §10.1): role × table × operation.
 *
 * Every table appears here with an expectation for every persona. Adding a table in a
 * migration without adding it to MATRIX fails `every table is covered by the matrix`.
 *
 * Reps on an unapproved device and suspended users see nothing (doc 04 invariant 7);
 * the app reads their status through app.my_session() instead.
 *
 * SELECT expectation: "denied" (no privilege) or a SQL predicate. The persona must see
 * exactly the rows the predicate selects (evaluated as postgres). Writes: every
 * application role (anon, authenticated personas, service_role) must be refused for
 * direct INSERT / UPDATE / DELETE — all writes go through app.* functions (H-08).
 */
import { describe, expect, it } from "vitest";
import { fx, run, sqlstate, type Who, OWNER, OWNER_AAL1, MANAGER, MANAGER_AAL1, REP_A, REP_A_WRONG_DEVICE, REP_B, SUSPENDED } from "./helpers/db";

type Sel = "denied" | string;
interface Row {
  table: string;
  writeCol: string;
  select: Record<string, Sel>;
}

const P: Record<string, Who> = {
  anon: "anon",
  repA: REP_A,
  repAWrongDevice: REP_A_WRONG_DEVICE,
  repB: REP_B,
  manager: MANAGER,
  managerAal1: MANAGER_AAL1,
  owner: OWNER,
  ownerAal1: OWNER_AAL1,
  suspended: SUSPENDED,
  service_role: "service_role",
};

const me = (k: keyof typeof fx) => `'${fx[k].id}'`;

const MATRIX: Row[] = [
  {
    table: "public.user_profile",
    writeCol: "full_name",
    select: {
      anon: "denied",
      repA: `id = ${me("repA")}`,
      repAWrongDevice: "false",
      repB: `id = ${me("repB")}`,
      manager: "true",
      managerAal1: `id = ${me("manager")}`,
      owner: "true",
      ownerAal1: `id = ${me("owner")}`,
      suspended: "false",
      service_role: "true",
    },
  },
  {
    table: "public.device",
    writeCol: "label",
    select: {
      anon: "denied",
      repA: `user_id = ${me("repA")}`,
      repAWrongDevice: "false",
      repB: `user_id = ${me("repB")}`,
      manager: "true",
      managerAal1: `user_id = ${me("manager")}`,
      owner: "true",
      ownerAal1: `user_id = ${me("owner")}`,
      suspended: "false",
      service_role: "true",
    },
  },
  {
    table: "public.app_config",
    writeCol: "note",
    select: {
      anon: "denied",
      repA: "rep_visible",
      repAWrongDevice: "false",
      repB: "rep_visible",
      manager: "true",
      // Without MFA an office user is treated like any active user: rep-visible lists only,
      // never governance values (credit rules, thresholds).
      managerAal1: "rep_visible",
      owner: "true",
      ownerAal1: "rep_visible",
      suspended: "false",
      service_role: "true",
    },
  },
  {
    table: "control.approval_request",
    writeCol: "reason",
    select: {
      anon: "denied",
      repA: `maker_id = ${me("repA")}`,
      repAWrongDevice: "false",
      repB: `maker_id = ${me("repB")}`,
      manager: "true",
      managerAal1: `maker_id = ${me("manager")}`,
      owner: "true",
      ownerAal1: `maker_id = ${me("owner")}`,
      suspended: "false",
      service_role: "true",
    },
  },
  {
    table: "control.audit_event",
    writeCol: "purpose",
    select: {
      anon: "denied",
      repA: "false",
      repAWrongDevice: "false",
      repB: "false",
      manager: "false",
      managerAal1: "false",
      owner: "true",
      ownerAal1: "false",
      suspended: "false",
      service_role: "denied",
    },
  },
  {
    table: "control.audit_chain_head",
    writeCol: "last_hash",
    select: Object.fromEntries(Object.keys(P).map((k) => [k, "denied"])),
  },
  {
    table: "control.doc_counter",
    writeCol: "last_no",
    select: Object.fromEntries(Object.keys(P).map((k) => [k, "denied"])),
  },
];

// Every relation (table, view, materialized view, foreign table) in our five schemas.
const COVERAGE = `select n.nspname || '.' || c.relname as t from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where c.relkind in ('r', 'p', 'v', 'm', 'f')
    and n.nspname in ('public', 'control', 'supplier_vault', 'app', 'vault_api') order by 1`;

describe("RLS matrix", () => {
  it("every table, view, materialized view and foreign table in our five schemas is covered by the matrix", async () => {
    // Views and the API-exposed schemas app and vault_api count too: a view or a table there
    // would otherwise escape the role-by-role checks below (council finding 4, B-26).
    const { rows } = await run<{ t: string }>("postgres", COVERAGE);
    expect(rows.map((r) => r.t).sort()).toEqual(MATRIX.map((m) => m.table).sort());
  });

  it("the coverage query sees a planted view in an exposed schema and a planted table in public", async () => {
    const res = (await run("postgres", `create view app.zz_planted with (security_invoker = true) as select 1 as x;
      create table public.zz_planted_t (id int); ${COVERAGE}`)) as unknown as Array<{ rows: Array<{ t: string }> }>;
    const seen = res[res.length - 1].rows.map((r) => r.t);
    expect(seen).toContain("app.zz_planted");
    expect(seen).toContain("public.zz_planted_t");
  });

  for (const row of MATRIX) {
    describe(row.table, () => {
      for (const [name, who] of Object.entries(P)) {
        const exp = row.select[name];
        it(`${name} SELECT → ${exp === "denied" ? "denied" : `rows where ${exp}`}`, async () => {
          if (exp === "denied") {
            expect(await sqlstate(who, `select count(*) from ${row.table}`)).toBe("42501");
            return;
          }
          const want = await run("postgres", `select count(*)::int as n from ${row.table} where ${exp}`);
          const got = await run(who, `select count(*)::int as n from ${row.table}`);
          expect(got.rows[0].n).toBe(want.rows[0].n);
        });

        for (const [op, sql] of [
          ["INSERT", `insert into ${row.table} default values`],
          ["UPDATE", `update ${row.table} set ${row.writeCol} = ${row.writeCol}`],
          ["DELETE", `delete from ${row.table}`],
        ] as const) {
          it(`${name} ${op} → denied`, async () => {
            expect(await sqlstate(who, sql)).toBe("42501");
          });
        }
      }
    });
  }
});
