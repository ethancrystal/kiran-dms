/**
 * Receivables ageing (migration 0022, task P1-07): PAY-07 (per salon, per rep, per territory),
 * doc 09 section 9 (buckets: current, 1-7, 8-15, 16-30, 30+ days past due), doc 04
 * (v_receivables_ageing), doc 06 section 2 (the office sees all salons), ACTIVITY A-14 (who a
 * salon's receivable is counted under when grouped by rep).
 *
 * Each test delivers one INST4 order (four installments of UNIT, due on days 0, 10, 20 and 30) in a
 * rolled-back transaction, then moves the installments' due dates back with triggers off (as
 * routes.test.ts builds a past route), so the ageing is read on today's Karachi date. Grouped
 * totals are compared before and after in the same transaction, because other test files share
 * the database. All amounts are paisa.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fx, MANAGER, OWNER, run, sqlstate, type Who } from "./helpers/db";

const C = { commit: true };
const id = () => randomUUID();
const TAG_LENGTH = 8;
const tag = () => randomUUID().slice(0, TAG_LENGTH);
const one = async (who: Who, sql: string, params: unknown[] = []) => (await run(who, sql, params, C)).rows[0];
const TODAY = "(now() at time zone 'Asia/Karachi')::date";

const UNIT = 100000; // one unit lists at Rs 1,000; an INST4 order of four units has four installments of UNIT
const HALF_UNIT = 50000;
const ONE_AND_HALF = 150000;
const INST4_QTY = 4;
const ORDER_TOTAL = INST4_QTY * UNIT;
const STOCK_QTY = 1000;
const BAG_QTY = 40;
const BAG_LIMIT = 50000000;
const CREDIT_LIMIT = 100000000;
const GROUP_CYCLE_DAYS = 21;
const SKU_SIZE = 100;

// Days to move the installments back. Due on days 0, 10, 20 and 30, they are then SHIFT, SHIFT-10,
// SHIFT-20 and SHIFT-30 days late.
const DUE_TODAY = 0;
const LATE_1 = 1;
const LATE_7 = 7;
const LATE_8 = 8;
const LATE_15 = 15;
const LATE_16 = 16;
const LATE_30 = 30;
const LATE_31 = 31; // 31, 21, 11 and 1 days late: one installment in each overdue bucket
const ONE_SALON = 1;

const T_A = id(),
  AREA_A = id();
const SALON = id(), // territory A, owner-set INST4 credit
  SALON_X = id(); // territory A, never ordered
const GROUP = id(),
  PRODUCT = id(),
  SKU = id(),
  WH = id();
const BAG_A = `(select l.id from public.stock_location l where l.kind = 'rep_bag' and l.owner_user_id = '${fx.repA.id}')`;

type P = "repA" | "repB" | "manager" | "managerAal1" | "owner";
const asUser = (k: P) => {
  const who = k === "managerAal1" ? "manager" : k;
  const aal = k.startsWith("rep") || k === "managerAal1" ? "aal1" : "aal2";
  return `
  reset role;
  select set_config('request.jwt.claims', '${JSON.stringify({ sub: fx[who].id, role: "authenticated", aal })}', true),
         set_config('request.headers', '${JSON.stringify({ "x-kiran-device": fx[who].device })}', true);
  set local role authenticated;`;
};
type Step = [P | "postgres", string];
const prelude = `
  insert into public.rep_day (rep_id, day) values ('${fx.repA.id}', ${TODAY}) on conflict (rep_id, day) do nothing;
  ${asUser("owner")}
  select app.office_create_location('${id()}', 'rep_bag', '[Test] Ageing bag A', '${fx.repA.id}', ${BAG_LIMIT})
   where not exists (select 1 from public.stock_location l where l.kind = 'rep_bag' and l.owner_user_id = '${fx.repA.id}');
  reset role;
  insert into public.stock_movement (client_id, sku_id, qty, from_location_id, to_location_id, kind, actor_id)
  values (gen_random_uuid(), '${SKU}', ${BAG_QTY}, '${WH}', ${BAG_A}, 'issue_to_rep', '${fx.manager.id}');`;
const script = (steps: Step[]) =>
  `${prelude}\n${steps.map(([k, sql]) => `${k === "postgres" ? "reset role;" : asUser(k)}\n${sql}`).join("\n")}`;
type Multi = Array<{ rows: Array<Record<string, unknown>> }>;
// Every statement's rows, in order.
const results = async (steps: Step[]) => (await run("postgres", script(steps))) as unknown as Multi;
const tx = async (steps: Step[]) => (await results(steps)).at(-1)?.rows ?? [];
const txCode = (steps: Step[]) => sqlstate("postgres", script(steps));

// One INST4 order for SALON, delivered in full by rep A: one invoice, four installments.
const delivered = (): Step[] => {
  const [ocid, dcid] = [id(), id()];
  return [
    [
      "manager",
      `select app.office_create_order('${ocid}', '${SALON}', 'INST4', '${JSON.stringify([{ sku_id: SKU, qty: INST4_QTY }])}'::jsonb, '${fx.repA.id}');`,
    ],
    [
      "repA",
      `select app.rep_deliver('${dcid}', (select id from public.sales_order where client_id = '${ocid}'), 'Ayesha at the counter', 24.9, 67.1);`,
    ],
  ];
};
// Moves SALON's installments `days` earlier, with triggers off (installment rows are append-only).
const backdate = (days: number): Step => [
  "postgres",
  `set local session_replication_role = replica;
   update public.installment set due_on = due_on - ${days} where salon_id = '${SALON}';
   set local session_replication_role = origin;`,
];
const pay = (amount: number): Step => [
  "repA",
  `select (app.rep_record_payment('${id()}', '${SALON}', 'cash', ${amount}, 24.9, 67.1)).*;`,
];
const BUCKETS = ["current_paisa", "d1_7_paisa", "d8_15_paisa", "d16_30_paisa", "d31_plus_paisa"] as const;
const COLS = ["salons", ...BUCKETS, "overdue_paisa", "total_paisa"] as const;
const ageing = (group: string, key: string | null, who: P = "manager"): Step => [
  who,
  `select ${COLS.join(", ")} from app.office_receivables_ageing('${group}') where group_id ${key === null ? "is null" : `= '${key}'`};`,
];
const nums = (r: Record<string, unknown> | undefined) => (r ? COLS.map((c) => Number(r[c])) : null);
const buckets = (r: Record<string, unknown> | undefined) => (r ? BUCKETS.map((c) => Number(r[c])) : null);
const totalOf = (r: Record<string, unknown> | undefined) => Number(r?.total_paisa ?? 0);
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

const SALONS = [SALON, SALON_X];
beforeAll(async () => {
  await one(MANAGER, "select app.office_upsert_territory($1, $2)", [T_A, `[Test] Ageing A ${tag()}`]);
  await one(MANAGER, "select app.office_upsert_area($1, $2, '[Test] Ageing area A')", [AREA_A, T_A]);
  await one(MANAGER, "select app.office_assign_territory($1, $2)", [fx.repA.id, T_A]);
  await Promise.all(
    SALONS.map((s) =>
      one({ as: "repA" }, "select app.create_salon($1, $2, 'ladies_parlor', $3, 'map_pin', null, 24.9, 67.1)", [
        s,
        `[Test] Ageing salon ${tag()}`,
        AREA_A,
      ]),
    ),
  );
  await one(OWNER, "select app.owner_set_credit($1, 'INST4', $2, 'ageing tests, owner decision')", [SALON, CREDIT_LIMIT]);
  await one(MANAGER, "select app.office_upsert_product_group($1, $2, $3)", [
    GROUP,
    `[Test] Ageing colour ${tag()}`,
    GROUP_CYCLE_DAYS,
  ]);
  await one(MANAGER, "select app.office_upsert_product($1, $2, '[Dummy] Kiran', '[Dummy] Ageing colour')", [PRODUCT, GROUP]);
  await one(MANAGER, "select app.office_upsert_sku($1, $2, $3, '[Dummy] shade', 'ml', $4)", [
    SKU,
    PRODUCT,
    `T-AGE-${tag().toUpperCase()}`,
    SKU_SIZE,
  ]);
  await one(OWNER, "select app.owner_set_sku_price($1, $2, 'dummy list price')", [SKU, UNIT]);
  await one(MANAGER, "select app.office_create_location($1, 'warehouse', '[Test] Ageing store')", [WH]);
  await one(
    "postgres",
    `insert into public.stock_movement (client_id, sku_id, qty, to_location_id, kind, actor_id)
     values (gen_random_uuid(), $1, $2, $3, 'receipt', $4)`,
    [SKU, STOCK_QTY, WH, fx.manager.id],
  );
});

afterAll(async () => {
  await one(MANAGER, "select app.office_end_territory($1, $2, 'ageing tests finished')", [fx.repA.id, T_A]);
});

describe("buckets by days past due, Karachi date (PAY-07, doc 09 section 9)", () => {
  // [shift, expected number of installments in [current, 1-7, 8-15, 16-30, 31+]]
  const [ALL, THREE, TWO] = [INST4_QTY, INST4_QTY - 1, INST4_QTY - 1 - 1];
  const CASES: Array<[number, number[]]> = [
    [DUE_TODAY, [ALL, 0, 0, 0, 0]], // due today is current, not late
    [LATE_1, [THREE, 1, 0, 0, 0]],
    [LATE_7, [THREE, 1, 0, 0, 0]],
    [LATE_8, [THREE, 0, 1, 0, 0]],
    [LATE_15, [TWO, 1, 1, 0, 0]],
    [LATE_16, [TWO, 1, 0, 1, 0]],
    [LATE_30, [1, 0, 1, TWO, 0]],
    [LATE_31, [0, 1, 1, 1, 1]],
  ];
  it.each(CASES)("moved back %i days", async (shift, units) => {
    const rows = await tx([...delivered(), backdate(shift), ageing("salon", SALON)]);
    const [current, ...late] = units.map((u) => u * UNIT);
    expect(buckets(rows[0])).toEqual([current, ...late]);
    expect(Number(rows[0]?.overdue_paisa)).toBe(sum(late));
    expect(totalOf(rows[0])).toBe(ORDER_TOTAL);
  });

  it("a part payment clears the oldest installments first, and the ageing follows (PAY-11)", async () => {
    const rows = await tx([...delivered(), backdate(LATE_31), pay(ONE_AND_HALF), ageing("salon", SALON)]);
    // 31, 21, 11 and 1 days late before; 1.5 units pay off the 31+ one and half of the 16-30 one.
    expect(buckets(rows[0])).toEqual([0, UNIT, UNIT, HALF_UNIT, 0]);
  });

  it("a salon that owes nothing is not listed: never ordered, or paid in full", async () => {
    const [never, paid] = await Promise.all([
      tx([...delivered(), ageing("salon", SALON_X)]),
      tx([...delivered(), backdate(LATE_31), pay(ORDER_TOTAL), ageing("salon", SALON)]),
    ]);
    expect(never).toEqual([]);
    expect(paid).toEqual([]);
  });
});

describe("grouped by territory and by rep (PAY-07, A-14)", () => {
  it("territory: the salon's area's territory, counting the salon once", async () => {
    const rows = await tx([...delivered(), backdate(LATE_31), ageing("territory", T_A)]);
    expect(nums(rows[0])).toEqual([ONE_SALON, 0, UNIT, UNIT, UNIT, UNIT, ORDER_TOTAL, ORDER_TOTAL]);
  });

  it("rep: every rep currently assigned to the salon's territory carries it in full", async () => {
    const reps = [fx.repA.id, fx.repB.id];
    const steps = (extra: Step[]): Step[] => [
      ...extra,
      ["owner", `select app.office_assign_territory('${fx.repB.id}', '${T_A}');`],
      [
        "manager",
        `select group_id, total_paisa from app.office_receivables_ageing('rep') where group_id in ('${reps.join("', '")}');`,
      ],
    ];
    const totals = async (extra: Step[]) => {
      const rows = await tx(steps(extra));
      return reps.map((r) => totalOf(rows.find((x) => x.group_id === r)));
    };
    const [before, after] = await Promise.all([totals([]), totals([...delivered(), backdate(LATE_31)])]);
    expect(after.map((v, n) => v - before[n])).toEqual([ORDER_TOTAL, ORDER_TOTAL]);
  });

  it("rep: a salon in a territory with no current rep is listed under no rep (group_id null)", async () => {
    const steps = (extra: Step[]): Step[] => [
      ...extra,
      ["manager", `select app.office_end_territory('${fx.repA.id}', '${T_A}', 'ageing test: territory left without a rep');`],
      ageing("rep", null),
    ];
    const total = async (extra: Step[]) => totalOf((await tx(steps(extra)))[0]);
    const [before, after] = await Promise.all([total([]), total([...delivered(), backdate(LATE_31)])]);
    expect(after - before).toBe(ORDER_TOTAL);
  });
});

describe("who may read it (doc 06 section 2, SEC-02)", () => {
  // The territory names made in beforeAll: "[Test] Ageing A 1a2b3c4d" matches; "[Test] Ageing area A" does not.
  // https://regex101.com/?regex=%5E%5C%5BTest%5C%5D%20Ageing%20A%20&flavor=javascript
  const TERRITORY_NAME = /^\[Test\] Ageing A /;

  it.each(["manager", "owner"] as const)("%s with MFA reads it; the rows carry names", async (k) => {
    const rows = await tx([
      ...delivered(),
      [k, `select group_name, salons from app.office_receivables_ageing('territory') where group_id = '${T_A}';`],
    ]);
    expect(String(rows[0]?.group_name)).toMatch(TERRITORY_NAME);
    expect(Number(rows[0]?.salons)).toBe(ONE_SALON);
  });

  it.each(["repA", "repB", "managerAal1"] as const)("%s is refused (42501)", async (k) => {
    expect(await txCode([[k, "select * from app.office_receivables_ageing('salon');"]])).toBe("42501");
  });

  it.each(["region", "", "SALON"])("an unknown grouping %j is refused (22023)", async (g) => {
    expect(await txCode([["manager", `select * from app.office_receivables_ageing('${g}');`]])).toBe("22023");
  });

  it("a null grouping is refused (22023)", async () => {
    expect(await txCode([["manager", "select * from app.office_receivables_ageing(null);"]])).toBe("22023");
  });
});
