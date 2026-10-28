/**
 * Credit profile and orders (migration 0012, task P1-06 part a): SAL-04, ORD-01 to ORD-03, ORD-10,
 * CTL-07, CTL-08; doc 09 §2 credit rules; doc 13 §9 discount thresholds; MJ decisions L-0157.
 *
 * Catalogue, territories, salons and credit profiles are committed with fresh ids. Every order runs
 * in one rolled-back transaction that opens the reps' day for today as postgres and then switches
 * persona step by step, so no rep day or order is left behind for the visits tests.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { errorOf, fx, MANAGER, OWNER, REP_A, run, sqlstate, type Who } from "./helpers/db";

const C = { commit: true };
const id = () => randomUUID();
const tag = () => randomUUID().slice(0, 8);
const one = async (who: Who, sql: string, params: unknown[] = []) => (await run(who, sql, params, C)).rows[0];
const TODAY = "(now() at time zone 'Asia/Karachi')::date";

const T_A = id(),
  T_B = id(),
  AREA_A = id(),
  AREA_B = id();
const S_NEW = id(), // no credit profile: cash only
  S_CRED = id(), // INST2, limit Rs 10,000
  S_BLOCK = id(), // INST4, limit Rs 50,000, blocked
  S_B = id(); // rep B's territory
const GROUP = id(),
  PRODUCT = id(),
  SKU1 = id(), // Rs 1,200
  SKU2 = id(), // Rs 500
  SKU_UNPRICED = id();

type P = "repA" | "repB" | "manager" | "owner";
const asUser = (k: P) => `
  reset role;
  select set_config('request.jwt.claims', '${JSON.stringify({ sub: fx[k].id, role: "authenticated", aal: k.startsWith("rep") ? "aal1" : "aal2" })}', true),
         set_config('request.headers', '${JSON.stringify({ "x-kiran-device": fx[k].device })}', true);
  set local role authenticated;`;
const openDays = ["repA", "repB"]
  .map(
    (k) => `insert into public.rep_day (rep_id, day) values ('${fx[k as P].id}', ${TODAY}) on conflict (rep_id, day) do nothing;`,
  )
  .join("\n");
/** Steps run in order in one rolled-back transaction; returns the rows of the last statement. */
const script = (steps: Array<[P | "postgres", string]>) =>
  `${openDays}\n${steps.map(([k, sql]) => `${k === "postgres" ? "reset role;" : asUser(k)}\n${sql}`).join("\n")}`;
type Multi = Array<{ rows: Array<Record<string, unknown>> }>;
const tx = async (steps: Array<[P | "postgres", string]>) => {
  const r = (await run("postgres", script(steps))) as unknown as Multi;
  return r.at(-1)?.rows ?? [];
};
const txError = (steps: Array<[P | "postgres", string]>) => errorOf("postgres", script(steps));

const lines = (l: Array<{ sku: string; qty: number; price?: number }>) =>
  `'${JSON.stringify(l.map((x) => ({ sku_id: x.sku, qty: x.qty, ...(x.price ? { unit_price_paisa: x.price } : {}) })))}'::jsonb`;
const order = (cid: string, salon: string, plan: string, l: string, mode = "bag_now") =>
  `select (app.create_order('${cid}', '${salon}', '${plan}', '${mode}', ${l})).*;`;
const byCid = (cid: string) => `(select id from public.sales_order where client_id = '${cid}')`;
const showOrder = (cid: string) =>
  `select status::text, plan::text, subtotal_paisa::int sub, discount_paisa::int disc, total_paisa::int total, hold_credit,
          hold_discount from public.sales_order where client_id = '${cid}';`;

beforeAll(async () => {
  await one(MANAGER, "select app.office_upsert_territory($1, $2)", [T_A, `[Test] Orders A ${tag()}`]);
  await one(MANAGER, "select app.office_upsert_territory($1, $2)", [T_B, `[Test] Orders B ${tag()}`]);
  await one(MANAGER, "select app.office_upsert_area($1, $2, '[Test] Orders area A')", [AREA_A, T_A]);
  await one(MANAGER, "select app.office_upsert_area($1, $2, '[Test] Orders area B')", [AREA_B, T_B]);
  await one(MANAGER, "select app.office_assign_territory($1, $2)", [fx.repA.id, T_A]);
  await one(MANAGER, "select app.office_assign_territory($1, $2)", [fx.repB.id, T_B]);
  for (const [who, sid, area] of [
    [REP_A, S_NEW, AREA_A],
    [REP_A, S_CRED, AREA_A],
    [REP_A, S_BLOCK, AREA_A],
    [{ as: "repB" } as Who, S_B, AREA_B],
  ] as const) {
    await one(who, "select app.create_salon($1, $2, 'ladies_parlor', $3, 'map_pin', null, 24.9, 67.1)", [
      sid,
      `[Test] Order salon ${tag()}`,
      area,
    ]);
  }
  await one(MANAGER, "select app.office_upsert_product_group($1, $2, 21)", [GROUP, `[Test] Order colour ${tag()}`]);
  await one(MANAGER, "select app.office_upsert_product($1, $2, '[Dummy] Kiran', '[Dummy] Order colour')", [PRODUCT, GROUP]);
  for (const s of [SKU1, SKU2, SKU_UNPRICED]) {
    await one(MANAGER, "select app.office_upsert_sku($1, $2, $3, '[Dummy] shade', 'ml', 100)", [
      s,
      PRODUCT,
      `T-ORD-${tag().toUpperCase()}`,
    ]);
  }
  await one(OWNER, "select app.owner_set_sku_price($1, 120000, 'dummy list price')", [SKU1]);
  await one(OWNER, "select app.owner_set_sku_price($1, 50000, 'dummy list price')", [SKU2]);
  await one(OWNER, "select app.owner_set_credit($1, 'INST2', 1000000, 'trusted salon, owner decision')", [S_CRED]);
  await one(OWNER, "select app.owner_set_credit($1, 'INST4', 5000000, 'large salon, owner decision')", [S_BLOCK]);
  await one(MANAGER, "select app.office_set_blocked($1, true, 'installment 31 days overdue on paper')", [S_BLOCK]);
});

afterAll(async () => {
  await one(MANAGER, "select app.office_end_territory($1, $2, 'orders tests finished')", [fx.repA.id, T_A]);
  await one(MANAGER, "select app.office_end_territory($1, $2, 'orders tests finished')", [fx.repB.id, T_B]);
});

describe("credit profile (SAL-04, MJ L-0157)", () => {
  it("only the owner sets plan and limit, with a reason; each change is a credit event", async () => {
    expect(await sqlstate(MANAGER, "select app.owner_set_credit($1, 'INST2', 100, 'manager tries')", [S_NEW])).toBe("42501");
    expect(await sqlstate(REP_A, "select app.owner_set_credit($1, 'INST2', 100, 'rep tries')", [S_NEW])).toBe("42501");
    expect(await sqlstate(OWNER, "select app.owner_set_credit($1, 'INST2', 100, '')", [S_NEW])).toBe("23514");
    expect(await sqlstate(OWNER, "select app.owner_set_credit($1, 'INST2', -1, 'negative')", [S_NEW])).toBe("22023");
    const ev = await run(
      MANAGER,
      "select kind::text, new_plan::text, new_limit_paisa::int lim, actor_role::text from public.credit_event where salon_id = $1",
      [S_CRED],
    );
    expect(ev.rows).toEqual([{ kind: "owner_set", new_plan: "INST2", lim: 1000000, actor_role: "owner" }]);
  });

  it("the profile never changes without an event, and events never change, for postgres too", async () => {
    expect(
      await errorOf("postgres", "update public.salon_credit set credit_limit_paisa = 99999999 where salon_id = $1", [S_CRED]),
    ).toMatch(/only with a credit_event/);
    expect(await sqlstate("postgres", "delete from public.salon_credit")).toBe("42501");
    expect(await sqlstate("postgres", "update public.credit_event set reason = 'rewritten'")).toBe("42501");
    expect(await sqlstate("postgres", "truncate public.credit_event cascade")).toBe("42501");
  });

  it("a manager raises a limit by at most 50%, never from zero; the owner by any amount", async () => {
    const raise = (who: P, salon: string, to: number) =>
      [who, `select (app.office_raise_limit('${salon}', ${to}, 'good payer')).credit_limit_paisa::int lim;`] as [P, string];
    expect(await tx([raise("manager", S_CRED, 1500000)])).toEqual([{ lim: 1500000 }]);
    expect(await txError([raise("manager", S_CRED, 1500001)])).toMatch(/at most the configured percentage/);
    expect(await txError([raise("manager", S_NEW, 100000)])).toMatch(/existing limit/);
    expect(await tx([raise("owner", S_CRED, 9000000)])).toEqual([{ lim: 9000000 }]);
    expect(await txError([raise("repA", S_CRED, 1100000)])).toMatch(/owner or manager/);
  });

  it("manager overrides are capped at 2 per salon per month (CTL-08); the owner is not capped", async () => {
    const r = (to: number) => `select app.office_raise_limit('${S_CRED}', ${to}, 'season demand');`;
    expect(
      await txError([
        ["manager", r(1100000)],
        ["manager", r(1200000)],
        ["manager", r(1300000)],
      ]),
    ).toMatch(/cap/);
    expect(
      await tx([
        ["manager", r(1100000)],
        ["manager", r(1200000)],
        ["owner", `select (app.office_raise_limit('${S_CRED}', 1300000, 'owner decision')).credit_limit_paisa::int lim;`],
      ]),
    ).toEqual([{ lim: 1300000 }]);
  });

  it("any office user blocks; a manager's unblock counts toward the cap", async () => {
    expect(
      await txError([
        ["manager", `select app.office_raise_limit('${S_CRED}', 1100000, 'one');`],
        ["manager", `select app.office_raise_limit('${S_CRED}', 1200000, 'two');`],
        ["manager", `select app.office_set_blocked('${S_BLOCK}', false, 'paid in full');`],
      ]),
    ).toBeNull(); // different salon: S_BLOCK has its own cap
    expect(
      await txError([
        ["manager", `select app.office_set_blocked('${S_BLOCK}', false, 'paid in full');`],
        ["manager", `select app.office_set_blocked('${S_BLOCK}', true, 'late again');`],
        ["manager", `select app.office_set_blocked('${S_BLOCK}', false, 'paid again');`],
        ["manager", `select app.office_set_blocked('${S_BLOCK}', true, 'late once more');`],
        ["manager", `select app.office_set_blocked('${S_BLOCK}', false, 'third unblock');`],
      ]),
    ).toMatch(/cap/);
    expect(await sqlstate(REP_A, "select app.office_set_blocked($1, true, 'rep tries')", [S_CRED])).toBe("42501");
  });

  it("reps read a reachable salon's terms through the function, never the tables", async () => {
    const st = await run(
      REP_A,
      "select plan_eligibility::text p, credit_limit_paisa::int lim, exposure_paisa::int e, available_paisa::int a, blocked from app.salon_credit_status($1)",
      [S_CRED],
    );
    expect(st.rows).toEqual([{ p: "INST2", lim: 1000000, e: 0, a: 1000000, blocked: false }]);
    expect((await run(REP_A, "select * from app.salon_credit_status($1)", [S_B])).rows).toEqual([]);
    expect(
      (await run(REP_A, "select plan_eligibility::text p, credit_limit_paisa::int lim from app.salon_credit_status($1)", [S_NEW]))
        .rows,
    ).toEqual([{ p: "CASH", lim: 0 }]);
    expect((await run(REP_A, "select count(*)::int n from public.salon_credit")).rows[0].n).toBe(0);
    expect((await run(REP_A, "select count(*)::int n from public.credit_event")).rows[0].n).toBe(0);
  });
});

describe("taking an order (ORD-01, ORD-10)", () => {
  it("needs an open day; office users do not take orders in Phase 1", async () => {
    expect(
      await errorOf(REP_A, `select app.create_order($1, $2, 'CASH', 'bag_now', ${lines([{ sku: SKU1, qty: 1 }])})`, [
        id(),
        S_NEW,
      ]),
    ).toMatch(/check in before/);
    expect(await txError([["manager", order(id(), S_NEW, "CASH", lines([{ sku: SKU1, qty: 1 }]))]])).toMatch(/only reps/);
  });

  it("a cash order at list price is confirmed at once and makes the salon active; a replay returns it", async () => {
    const cid = id();
    const l = lines([
      { sku: SKU1, qty: 6 },
      { sku: SKU2, qty: 2 },
    ]);
    const r = await tx([
      ["repA", order(cid, S_NEW, "CASH", l)],
      ["repA", order(cid, S_NEW, "CASH", l)],
      [
        "postgres",
        `select (select count(*)::int from public.sales_order where client_id = '${cid}') n,
                           (select stage::text from public.salon where id = '${S_NEW}') stage,
                           (select count(*)::int from public.sales_order_line where order_id = ${byCid(cid)}) lines;`,
      ],
    ]);
    expect(r).toEqual([{ n: 1, stage: "active_new", lines: 2 }]);
    expect(
      await tx([
        ["repA", order(cid, S_NEW, "CASH", l)],
        ["repA", showOrder(cid)],
      ]),
    ).toEqual([
      { status: "confirmed", plan: "CASH", sub: 820000, disc: 0, total: 820000, hold_credit: null, hold_discount: null },
    ]);
    expect(
      await txError([
        ["repA", order(cid, S_NEW, "CASH", l)],
        ["repA", order(cid, S_NEW, "INST2", l)],
      ]),
    ).toMatch(/different content/);
  });

  it("refuses another territory's salon and every bad line", async () => {
    const one1 = lines([{ sku: SKU1, qty: 1 }]);
    expect(await txError([["repA", order(id(), S_B, "CASH", one1)]])).toMatch(/own territories/);
    for (const bad of [
      lines([{ sku: SKU_UNPRICED, qty: 1 }]),
      lines([{ sku: SKU1, qty: 0 }]),
      lines([{ sku: SKU1, qty: 1, price: 120001 }]),
      lines([{ sku: id(), qty: 1 }]),
      lines([
        { sku: SKU1, qty: 1 },
        { sku: SKU1, qty: 2 },
      ]),
      "'[]'::jsonb",
      `'{"sku_id": "${SKU1}"}'::jsonb`,
    ]) {
      expect(await txError([["repA", order(id(), S_NEW, "CASH", bad)]])).toMatch(/line|SKU/);
    }
  });
});

describe("the credit check (ORD-02, doc 09 §2, MJ L-0157)", () => {
  it("installments within the limit are confirmed; over the limit or above eligibility the order is held", async () => {
    const ok = id(),
      over = id(),
      noplan = id();
    const r = await tx([
      ["repA", order(ok, S_CRED, "INST2", lines([{ sku: SKU1, qty: 5 }]))], // Rs 6,000 of Rs 10,000
      ["repA", order(over, S_CRED, "INST2", lines([{ sku: SKU1, qty: 4 }]))], // + Rs 4,800 → over
      ["repA", order(noplan, S_NEW, "INST2", lines([{ sku: SKU2, qty: 1 }]))], // cash-only salon
      [
        "repA",
        `select client_id, status::text, hold_credit from public.sales_order where client_id in ('${ok}', '${over}', '${noplan}') order by sales_order.status, hold_credit;`,
      ],
    ]);
    expect(r).toEqual([
      { client_id: over, status: "draft", hold_credit: "over_limit" },
      { client_id: noplan, status: "draft", hold_credit: "plan_not_allowed" },
      { client_id: ok, status: "confirmed", hold_credit: null },
    ]);
    const exp = await tx([
      ["repA", order(ok, S_CRED, "INST2", lines([{ sku: SKU1, qty: 5 }]))],
      ["repA", `select exposure_paisa::int e, available_paisa::int a from app.salon_credit_status('${S_CRED}');`],
    ]);
    expect(exp).toEqual([{ e: 600000, a: 400000 }]);
  });

  it("a blocked salon still buys cash on delivery, but gets no installments", async () => {
    const cash = id(),
      inst = id();
    const r = await tx([
      ["repA", order(cash, S_BLOCK, "CASH", lines([{ sku: SKU2, qty: 1 }]))],
      ["repA", order(inst, S_BLOCK, "INST2", lines([{ sku: SKU2, qty: 1 }]))],
      [
        "repA",
        `select status::text, hold_credit from public.sales_order where client_id in ('${cash}', '${inst}') order by status;`,
      ],
    ]);
    expect(r).toEqual([
      { status: "confirmed", hold_credit: null },
      { status: "draft", hold_credit: "blocked" },
    ]);
  });

  it("the check is rerun on sync: a raised limit releases a held order (ORD-10)", async () => {
    const cid = id();
    const r = await tx([
      ["repA", order(cid, S_CRED, "INST2", lines([{ sku: SKU1, qty: 9 }]))], // Rs 10,800 > Rs 10,000
      ["owner", `select app.office_raise_limit('${S_CRED}', 1100000, 'owner agrees');`],
      ["repA", `select (app.recheck_order(${byCid(cid)})).status::text;`],
    ]);
    expect(r).toEqual([{ status: "confirmed" }]);
    expect(
      await txError([
        ["repA", order(cid, S_CRED, "INST2", lines([{ sku: SKU1, qty: 9 }]))],
        ["repB", `select app.recheck_order(${byCid(cid)});`],
      ]),
    ).toMatch(/only the order's rep/);
  });

  it("the office releases a credit hold with a reason; a manager only within 50% and never above eligibility", async () => {
    const over = id(),
      far = id(),
      noplan = id();
    const release = (who: P, cid: string) =>
      [who, `select (app.office_release_credit_hold(${byCid(cid)}, 'known salon, owner told by phone')).status::text;`] as [
        P,
        string,
      ];
    expect(await tx([["repA", order(over, S_CRED, "INST2", lines([{ sku: SKU1, qty: 10 }]))], release("manager", over)])).toEqual(
      [{ status: "confirmed" }],
    );
    expect(
      await tx([
        ["repA", order(over, S_CRED, "INST2", lines([{ sku: SKU1, qty: 10 }]))],
        release("manager", over),
        [
          "manager",
          `select kind::text, order_id is not null has_order from public.credit_event where salon_id = '${S_CRED}' and kind = 'order_override';`,
        ],
      ]),
    ).toEqual([{ kind: "order_override", has_order: true }]);
    expect(
      await txError([["repA", order(far, S_CRED, "INST2", lines([{ sku: SKU1, qty: 13 }]))], release("manager", far)]),
    ).toMatch(/configured percentage/);
    expect(
      await txError([["repA", order(noplan, S_NEW, "INST2", lines([{ sku: SKU2, qty: 1 }]))], release("manager", noplan)]),
    ).toMatch(/only the owner/);
    expect(await tx([["repA", order(noplan, S_NEW, "INST2", lines([{ sku: SKU2, qty: 1 }]))], release("owner", noplan)])).toEqual(
      [{ status: "confirmed" }],
    );
    expect(
      await txError([["repA", order(over, S_CRED, "INST2", lines([{ sku: SKU1, qty: 10 }]))], release("repA", over)]),
    ).toMatch(/owner or manager/);
  });

  it("a manager cannot release a blocked order that also asks for a plan above eligibility", async () => {
    // The recorded hold is only the first that failed ("blocked"); the plan check must still apply.
    const cid = id();
    const steps: Array<[P | "postgres", string]> = [
      ["manager", `select app.office_set_blocked('${S_CRED}', true, 'late installment');`],
      ["repA", order(cid, S_CRED, "INST4", lines([{ sku: SKU2, qty: 1 }]))],
    ];
    expect(await tx([...steps, ["repA", `select hold_credit from public.sales_order where client_id = '${cid}';`]])).toEqual([
      { hold_credit: "blocked" },
    ]);
    expect(
      await txError([...steps, ["manager", `select app.office_release_credit_hold(${byCid(cid)}, 'unblock this one');`]]),
    ).toMatch(/only the owner/);
  });

  it("a manager's release counts toward the monthly cap", async () => {
    const o1 = id();
    expect(
      await txError([
        ["manager", `select app.office_raise_limit('${S_CRED}', 1100000, 'one');`],
        ["manager", `select app.office_raise_limit('${S_CRED}', 1200000, 'two');`],
        ["repA", order(o1, S_CRED, "INST2", lines([{ sku: SKU1, qty: 11 }]))],
        ["manager", `select app.office_release_credit_hold(${byCid(o1)}, 'third override');`],
      ]),
    ).toMatch(/cap/);
  });
});

describe("discounts (CTL-07, doc 13 §9)", () => {
  it("a price below list holds the order until a manager approves; the rep cannot approve its own", async () => {
    const cid = id();
    const steps: Array<[P | "postgres", string]> = [
      ["repA", order(cid, S_NEW, "CASH", lines([{ sku: SKU1, qty: 10, price: 114000 }]))],
    ];
    expect(await tx([...steps, ["repA", showOrder(cid)]])).toEqual([
      { status: "draft", plan: "CASH", sub: 1200000, disc: 60000, total: 1140000, hold_credit: null, hold_discount: "pending" },
    ]);
    const appr = `(select discount_approval_id from public.sales_order where client_id = '${cid}')`;
    expect(
      await tx([...steps, ["manager", `select checker_role_required::text r from control.approval_request where id = ${appr};`]]),
    ).toEqual([{ r: "manager" }]);
    expect(await txError([...steps, ["repA", `select app.decide_approval(${appr}, true, 'self approve');`]])).toMatch(
      /owner or manager/,
    );
    expect(
      await tx([
        ...steps,
        ["manager", `select app.decide_approval(${appr}, true, 'matches the competitor price');`],
        ["repA", `select (app.recheck_order(${byCid(cid)})).status::text;`],
      ]),
    ).toEqual([{ status: "confirmed" }]);
    expect(
      await tx([
        ...steps,
        ["manager", `select app.decide_approval(${appr}, false, 'no discount this month');`],
        ["repA", `select (app.recheck_order(${byCid(cid)})).hold_discount;`],
      ]),
    ).toEqual([{ hold_discount: "rejected" }]);
  });

  it("above 10% or Rs 5,000 the owner decides", async () => {
    const pct = id(),
      amount = id();
    const appr = (cid: string) => `(select discount_approval_id from public.sales_order where client_id = '${cid}')`;
    const r = await tx([
      ["repA", order(pct, S_NEW, "CASH", lines([{ sku: SKU2, qty: 1, price: 44000 }]))], // 12%
      ["repA", order(amount, S_NEW, "CASH", lines([{ sku: SKU1, qty: 60, price: 110000 }]))], // Rs 6,000 at 8.3%
      [
        "manager",
        `select checker_role_required::text r from control.approval_request where id in (${appr(pct)}, ${appr(amount)});`,
      ],
    ]);
    expect(r).toEqual([{ r: "owner" }, { r: "owner" }]);
    expect(
      await txError([
        ["repA", order(pct, S_NEW, "CASH", lines([{ sku: SKU2, qty: 1, price: 44000 }]))],
        ["manager", `select app.decide_approval(${appr(pct)}, true, 'manager tries');`],
      ]),
    ).toMatch(/owner's decision/);
  });
});

describe("cancelling (ORD-03)", () => {
  it("the rep cancels its own draft with a reason; the pending discount request is cancelled too", async () => {
    const cid = id();
    const r = await tx([
      ["repA", order(cid, S_NEW, "CASH", lines([{ sku: SKU1, qty: 1, price: 110000 }]))],
      ["repA", `select app.cancel_order(${byCid(cid)}, 'salon changed its mind');`],
      [
        "manager",
        `select o.status::text o, a.status::text a from public.sales_order o join control.approval_request a on a.id = o.discount_approval_id where o.client_id = '${cid}';`,
      ],
    ]);
    expect(r).toEqual([{ o: "cancelled", a: "cancelled" }]);
  });

  it("only the office cancels a confirmed order; a cancelled order is final", async () => {
    const cid = id();
    const steps: Array<[P | "postgres", string]> = [["repA", order(cid, S_NEW, "CASH", lines([{ sku: SKU1, qty: 1 }]))]];
    expect(await txError([...steps, ["repA", `select app.cancel_order(${byCid(cid)}, 'rep tries');`]])).toMatch(
      /cancels only its own draft/,
    );
    expect(await txError([...steps, ["repB", `select app.cancel_order(${byCid(cid)}, 'other rep tries');`]])).toMatch(
      /unknown order/, // rep B cannot even see rep A's order
    );
    expect(await txError([...steps, ["manager", `select app.cancel_order(${byCid(cid)}, '');`]])).toMatch(/reason/);
    expect(
      await tx([
        ...steps,
        ["manager", `select app.cancel_order(${byCid(cid)}, 'stock not available');`],
        [
          "postgres",
          `select status::text, cancelled_by = '${fx.manager.id}' by_manager from public.sales_order where client_id = '${cid}';`,
        ],
      ]),
    ).toEqual([{ status: "cancelled", by_manager: true }]);
    expect(
      await txError([
        ...steps,
        ["manager", `select app.cancel_order(${byCid(cid)}, 'stock not available');`],
        ["postgres", `update public.sales_order set status = 'confirmed' where client_id = '${cid}';`],
      ]),
    ).toMatch(/final/);
  });
});

describe("orders cannot be rewritten (H-06, H-07)", () => {
  const cid = id();
  const base: Array<[P | "postgres", string]> = [["repA", order(cid, S_NEW, "CASH", lines([{ sku: SKU1, qty: 2 }]))]];
  it("amounts, parties and lines are fixed for every role, including postgres", async () => {
    expect(
      await txError([
        ...base,
        ["postgres", `update public.sales_order set total_paisa = 1, subtotal_paisa = 1 where client_id = '${cid}';`],
      ]),
    ).toMatch(/immutable/);
    expect(
      await txError([...base, ["postgres", `update public.sales_order set status = 'draft' where client_id = '${cid}';`]]),
    ).toMatch(/not allowed/);
    expect(
      await txError([...base, ["postgres", `update public.sales_order_line set qty = 1 where order_id = ${byCid(cid)};`]]),
    ).toMatch(/append-only|not allowed|never/i);
    expect(await txError([...base, ["postgres", `delete from public.sales_order where client_id = '${cid}';`]])).toMatch(
      /never deleted/,
    );
    expect(await sqlstate("postgres", "truncate public.sales_order cascade")).toBe("42501");
  });

  it("reps see only their own orders; my_orders lists them", async () => {
    const r = await tx([
      ...base,
      [
        "repB",
        `select (select count(*)::int from public.sales_order where client_id = '${cid}') o, (select count(*)::int from public.sales_order_line where order_id in (select id from public.sales_order where client_id = '${cid}')) l;`,
      ],
    ]);
    expect(r).toEqual([{ o: 0, l: 0 }]);
    const mine = await tx([
      ...base,
      [
        "repA",
        `select status::text, total_paisa::int t, salon_name is not null named from app.my_orders() where salon_id = '${S_NEW}';`,
      ],
    ]);
    expect(mine).toEqual([{ status: "confirmed", t: 240000, named: true }]);
  });

  it("the audit chain still verifies (H-17)", async () => {
    expect((await run("postgres", "select ok from control.verify_audit_chain()")).rows[0].ok).toBe(true);
  });
});
