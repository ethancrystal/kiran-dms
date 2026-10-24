/**
 * RLS matrix (NFR-12, H-13, doc 06 §4 + §10.1): role × table × operation.
 *
 * Every table appears here with an expectation for every persona. Adding a table in a
 * migration without adding it to MATRIX fails `every table is covered by the matrix`.
 *
 * SELECT expectation: "denied" (no privilege) or a SQL predicate. The persona must see
 * exactly the rows the predicate selects (evaluated as postgres). Writes: every
 * application role (anon, authenticated personas, service_role) must be refused for
 * direct INSERT / UPDATE / DELETE — all writes go through app.* functions (H-08).
 */
import { describe, expect, it } from "vitest";
import { fx, run, sqlstate, type Who, OWNER, OWNER_AAL1, MANAGER, MANAGER_AAL1, REP_A, REP_B, SUSPENDED } from "./helpers/db";

type Sel = "denied" | string;
interface Row {
  table: string;
  writeCol: string;
  select: Record<string, Sel>;
}

const P: Record<string, Who> = {
  anon: "anon",
  repA: REP_A,
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
      repB: `id = ${me("repB")}`,
      manager: "true",
      managerAal1: `id = ${me("manager")}`,
      owner: "true",
      ownerAal1: `id = ${me("owner")}`,
      suspended: `id = ${me("suspendedRep")}`,
      service_role: "true",
    },
  },
  {
    table: "public.device",
    writeCol: "label",
    select: {
      anon: "denied",
      repA: `user_id = ${me("repA")}`,
      repB: `user_id = ${me("repB")}`,
      manager: "true",
      managerAal1: `user_id = ${me("manager")}`,
      owner: "true",
      ownerAal1: `user_id = ${me("owner")}`,
      suspended: `user_id = ${me("suspendedRep")}`,
      service_role: "true",
    },
  },
  {
    table: "public.app_config",
    writeCol: "note",
    select: {
      anon: "denied",
      repA: "rep_visible",
      repB: "rep_visible",
      manager: "true",
      managerAal1: "false",
      owner: "true",
      ownerAal1: "false",
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
      repB: `maker_id = ${me("repB")}`,
      manager: "true",
      managerAal1: `maker_id = ${me("manager")}`,
      owner: "true",
      ownerAal1: `maker_id = ${me("owner")}`,
      suspended: `maker_id = ${me("suspendedRep")}`,
      service_role: "true",
    },
  },
  {
    table: "control.audit_event",
    writeCol: "purpose",
    select: {
      anon: "denied",
      repA: "false",
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

describe("RLS matrix", () => {
  it("every table in public, control and supplier_vault is covered by the matrix", async () => {
    const { rows } = await run<{ t: string }>(
      "postgres",
      `select n.nspname || '.' || c.relname as t from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where c.relkind in ('r', 'p') and n.nspname in ('public', 'control', 'supplier_vault') order by 1`,
    );
    expect(rows.map((r) => r.t).sort()).toEqual(MATRIX.map((m) => m.table).sort());
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
