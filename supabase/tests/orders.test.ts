/**
 * Credit profile and orders (migration 0012, task P1-06 part a): SAL-04, ORD-01 to ORD-03, ORD-10,
 * CTL-07, CTL-08; doc 09 §2 credit rules; doc 13 §9 discount thresholds; MJ decisions L-0163.
 *
 * D-30 (migration 20261104090000): reps no longer place orders. app.create_order refuses every caller;
 * the order engine (line checks, credit gate, discount approval, replay) now runs behind
 * app.office_create_order, so its assertions are made here with the manager as the order's creator
 * (and a second manager, hired inside the rolled-back transaction, as the checker where the original
 * test had the office approve a rep's discount). Assertions whose subject is the rep as an order's owner
 * (recheck, cancel its own draft, read its own orders) run on a legacy rep_visit order built by
 * helpers/legacy-order.ts, the shape the closed rep path left behind.
 *
 * Catalogue, territories, salons and credit profiles are committed with fresh ids. Every order runs
 * in one rolled-back transaction that opens the reps' day for today as postgres and then switches
 * persona step by step, so no rep day or order is left behind for the visits tests.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  errorOf,
  fx,
  MANAGER,
  MANAGER_AAL1,
  OWNER,
  REP_A,
  REP_A_WRONG_DEVICE,
  run,
  SUSPENDED,
  sqlstate,
  type Who,
} from "./helpers/db";
import { type LegacyStatus, legacyOrderSql } from "./helpers/legacy-order";

const C = { commit: true };
const TAG_LENGTH = 8;
const id = () => randomUUID();
const tag = () => randomUUID().slice(0, TAG_LENGTH);
const one = async (who: Who, sql: string, params: unknown[] = []) => (await run(who, sql, params, C)).rows[0];
const inSequence = async (tasks: Array<() => Promise<unknown>>) => {
  await tasks.reduce<Promise<unknown>>(async (done, task) => {
    await done;
    return task();
  }, Promise.resolve());
};
const TODAY = "(now() at time zone 'Asia/Karachi')::date";

const DENIED = "42501";
const BAD_INPUT = "22023";
const REP_PATH_CLOSED = "reps no longer place orders: record an order card (D-30)";

// Money in paisa (Rs 1 = 100 paisa).
const SKU1_PRICE = 120000; // Rs 1,200
const SKU2_PRICE = 50000; // Rs 500
const LIMIT_CRED = 1000000; // Rs 10,000 on INST2
const LIMIT_BLOCK = 5000000; // Rs 50,000 on INST4, blocked
const RAISE_MANAGER_MAX = 1500000; // +50%: the most a manager may raise LIMIT_CRED to
const RAISE_FROM_ZERO = 100000;
const RAISE_OWNER = 9000000;
const RAISE_ONE = 1100000;
const RAISE_TWO = 1200000;
const RAISE_THREE = 1300000;
const NEGATIVE_LIMIT = -1;
const TINY_LIMIT = 100;
const PRICE_ABOVE_LIST = SKU1_PRICE + 1;
const PRICE_5_PCT_OFF = 114000; // SKU1 at 5% off: a manager decides
const PRICE_SKU2_12_PCT_OFF = 44000; // above 10%: the owner decides
const PRICE_SKU1_DISCOUNTED = 110000; // SKU1 at Rs 100 off a unit

// Quantities of SKU1 (Rs 1,200) unless said otherwise.
const QTY_SINGLE = 1;
const QTY_PAIR = 2;
const QTY_CASH_SKU1 = 6;
const QTY_WITHIN_LIMIT = 5; // Rs 6,000 of Rs 10,000
const QTY_OVER_AFTER_WITHIN = 4; // + Rs 4,800 goes over
const QTY_OVER_LIMIT = 9; // Rs 10,800 > Rs 10,000
const QTY_MANAGER_RELEASE = 10; // Rs 12,000: 20% over, within a manager's 50%
const QTY_TOO_FAR_OVER = 13; // Rs 15,600: more than 50% over
const QTY_CAPPED = 11; // Rs 13,200 over the twice-raised Rs 12,000
const QTY_DISCOUNTED = 10;
const QTY_BULK_SMALL_PCT = 60; // Rs 6,000 off at 8.3%: the amount, not the percentage, sends it to the owner
const QTY = {
  single: QTY_SINGLE,
  pair: QTY_PAIR,
  cashSku1: QTY_CASH_SKU1,
  withinLimit: QTY_WITHIN_LIMIT,
  overAfterWithin: QTY_OVER_AFTER_WITHIN,
  overLimit: QTY_OVER_LIMIT,
  managerRelease: QTY_MANAGER_RELEASE,
  tooFarOver: QTY_TOO_FAR_OVER,
  capped: QTY_CAPPED,
  discounted: QTY_DISCOUNTED,
  bulkSmallPct: QTY_BULK_SMALL_PCT,
} as const;

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
  SKU1 = id(),
  SKU2 = id(),
  SKU_UNPRICED = id();
const GROUP_CYCLE_DAYS = 21;
const SKU_SIZE = 100;

// A second manager, hired inside a rolled-back transaction: the checker of the first manager's discount
// (a maker never approves its own request, SEC-11), as the office was the checker of a rep's discount.
const MANAGER_2 = id();
const HIRE_MANAGER_2: Array<[P | "postgres", string]> = [
  ["postgres", `insert into auth.users (id, email) values ('${MANAGER_2}', 'manager2-${MANAGER_2}@example.test');`],
  ["owner", `select app.owner_create_user('${MANAGER_2}', '[Test] Manager Two', 'manager');`],
];

type P = "repA" | "repB" | "manager" | "owner" | "manager2";
const asUser = (k: P) => {
  const sub = k === "manager2" ? MANAGER_2 : fx[k].id;
  const headers = k === "manager2" ? {} : { "x-kiran-device": fx[k].device };
  return `
  reset role;
  select set_config('request.jwt.claims', '${JSON.stringify({ sub, role: "authenticated", aal: k.startsWith("rep") ? "aal1" : "aal2" })}', true),
         set_config('request.headers', '${JSON.stringify(headers)}', true);
  set local role authenticated;`;
};
const openDays = [fx.repA.id, fx.repB.id]
  .map((rep) => `insert into public.rep_day (rep_id, day) values ('${rep}', ${TODAY}) on conflict (rep_id, day) do nothing;`)
  .join("\n");
type Step = [P | "postgres", string];
/** Steps run in order in one rolled-back transaction; returns the rows of the last statement. */
const script = (steps: Step[]) =>
  `${openDays}\n${steps.map(([k, sql]) => `${k === "postgres" ? "reset role;" : asUser(k)}\n${sql}`).join("\n")}`;
type Multi = Array<{ rows: Array<Record<string, unknown>> }>;
const tx = async (steps: Step[]) => {
  const r = (await run("postgres", script(steps))) as unknown as Multi;
  return r.at(-1)?.rows ?? [];
};
const txError = (steps: Step[]) => errorOf("postgres", script(steps));
const txCode = (steps: Step[]) => sqlstate("postgres", script(steps));
/** The SQLSTATE and message of a failure, or null when the statement succeeded. */
const failureOf = async (who: Who, sql: string) => {
  try {
    await run(who, sql);
    return null;
  } catch (e) {
    const err = e as { code?: string; message: string };
    return { code: err.code, message: err.message };
  }
};

const lines = (l: Array<{ sku: string; qty: number; price?: number }>) =>
  `'${JSON.stringify(l.map((x) => ({ sku_id: x.sku, qty: x.qty, ...(x.price ? { unit_price_paisa: x.price } : {}) })))}'::jsonb`;
/** The office path (D-30): the manager (by default) makes the order; no assigned rep, so it is a warehouse order. */
const order = (cid: string, salon: string, plan: string, l: string, who: P = "manager"): Step => [
  who,
  `select (app.office_create_order('${cid}', '${salon}', '${plan}', ${l})).*;`,
];
/** A legacy rep_visit order of rep A (the shape the closed rep path left), SKU1 at list price. */
const legacy = (cid: string, salon: string, plan: string, qty: number, status: LegacyStatus = "confirmed"): Step => [
  "postgres",
  legacyOrderSql({ clientId: cid, salonId: salon, skuId: SKU1, qty, unitPaisa: SKU1_PRICE, repId: fx.repA.id, plan, status }),
];
const byCid = (cid: string) => `(select id from public.sales_order where client_id = '${cid}')`;
const showOrder = (cid: string): Step => [
  "postgres",
  `select status::text, plan::text, subtotal_paisa::int sub, discount_paisa::int disc, total_paisa::int total, hold_credit,
          hold_discount from public.sales_order where client_id = '${cid}';`,
];
const approvalOf = (cid: string) => `(select discount_approval_id from public.sales_order where client_id = '${cid}')`;

beforeAll(async () => {
  await one(MANAGER, "select app.office_upsert_territory($1, $2)", [T_A, `[Test] Orders A ${tag()}`]);
  await one(MANAGER, "select app.office_upsert_territory($1, $2)", [T_B, `[Test] Orders B ${tag()}`]);
  await one(MANAGER, "select app.office_upsert_area($1, $2, '[Test] Orders area A')", [AREA_A, T_A]);
  await one(MANAGER, "select app.office_upsert_area($1, $2, '[Test] Orders area B')", [AREA_B, T_B]);
  await one(MANAGER, "select app.office_assign_territory($1, $2)", [fx.repA.id, T_A]);
  await one(MANAGER, "select app.office_assign_territory($1, $2)", [fx.repB.id, T_B]);
  const salons: Array<[Who, string, string]> = [
    [REP_A, S_NEW, AREA_A],
    [REP_A, S_CRED, AREA_A],
    [REP_A, S_BLOCK, AREA_A],
    [{ as: "repB" }, S_B, AREA_B],
  ];
  await inSequence(
    salons.map(
      ([who, sid, area]) =>
        () =>
          one(who, "select app.create_salon($1, $2, 'ladies_parlor', $3, 'map_pin', null, 24.9, 67.1)", [
            sid,
            `[Test] Order salon ${tag()}`,
            area,
          ]),
    ),
  );
  await one(MANAGER, "select app.office_upsert_product_group($1, $2, $3)", [
    GROUP,
    `[Test] Order colour ${tag()}`,
    GROUP_CYCLE_DAYS,
  ]);
  await one(MANAGER, "select app.office_upsert_product($1, $2, '[Dummy] Kiran', '[Dummy] Order colour')", [PRODUCT, GROUP]);
  await inSequence(
    [SKU1, SKU2, SKU_UNPRICED].map(
      (s) => () =>
        one(MANAGER, "select app.office_upsert_sku($1, $2, $3, '[Dummy] shade', 'ml', $4)", [
          s,
          PRODUCT,
          `T-ORD-${tag().toUpperCase()}`,
          SKU_SIZE,
        ]),
    ),
  );
  await one(OWNER, "select app.owner_set_sku_price($1, $2, 'dummy list price')", [SKU1, SKU1_PRICE]);
  await one(OWNER, "select app.owner_set_sku_price($1, $2, 'dummy list price')", [SKU2, SKU2_PRICE]);
  await one(OWNER, "select app.owner_set_credit($1, 'INST2', $2, 'trusted salon, owner decision')", [S_CRED, LIMIT_CRED]);
  await one(OWNER, "select app.owner_set_credit($1, 'INST4', $2, 'large salon, owner decision')", [S_BLOCK, LIMIT_BLOCK]);
  await one(MANAGER, "select app.office_set_blocked($1, true, 'installment 31 days overdue on paper')", [S_BLOCK]);
});

afterAll(async () => {
  await one(MANAGER, "select app.office_end_territory($1, $2, 'orders tests finished')", [fx.repA.id, T_A]);
  await one(MANAGER, "select app.office_end_territory($1, $2, 'orders tests finished')", [fx.repB.id, T_B]);
});

describe("credit profile (SAL-04, MJ L-0163)", () => {
  it("only the owner sets plan and limit, with a reason; each change is a credit event", async () => {
    const set = "select app.owner_set_credit($1, 'INST2', $2, $3)";
    expect(await sqlstate(MANAGER, set, [S_NEW, TINY_LIMIT, "manager tries"])).toBe(DENIED);
    expect(await sqlstate(REP_A, set, [S_NEW, TINY_LIMIT, "rep tries"])).toBe(DENIED);
    expect(await sqlstate(OWNER, set, [S_NEW, TINY_LIMIT, ""])).toBe("23514");
    expect(await sqlstate(OWNER, set, [S_NEW, NEGATIVE_LIMIT, "negative"])).toBe(BAD_INPUT);
    const ev = await run(
      MANAGER,
      "select kind::text, new_plan::text, new_limit_paisa::int lim, actor_role::text from public.credit_event where salon_id = $1",
      [S_CRED],
    );
    expect(ev.rows).toEqual([{ kind: "owner_set", new_plan: "INST2", lim: LIMIT_CRED, actor_role: "owner" }]);
  });

  it("the profile never changes without an event, and events never change, for postgres too", async () => {
    expect(
      await errorOf("postgres", "update public.salon_credit set credit_limit_paisa = 99999999 where salon_id = $1", [S_CRED]),
    ).toContain("only with a credit_event");
    expect(await sqlstate("postgres", "delete from public.salon_credit")).toBe(DENIED);
    expect(await sqlstate("postgres", "update public.credit_event set reason = 'rewritten'")).toBe(DENIED);
    expect(await sqlstate("postgres", "truncate public.credit_event cascade")).toBe(DENIED);
  });

  it("a manager raises a limit by at most 50%, never from zero; the owner by any amount", async () => {
    const raise = (who: P, salon: string, to: number): Step => [
      who,
      `select (app.office_raise_limit('${salon}', ${to}, 'good payer')).credit_limit_paisa::int lim;`,
    ];
    expect(await tx([raise("manager", S_CRED, RAISE_MANAGER_MAX)])).toEqual([{ lim: RAISE_MANAGER_MAX }]);
    expect(await txError([raise("manager", S_CRED, RAISE_MANAGER_MAX + 1)])).toContain("at most the configured percentage");
    expect(await txError([raise("manager", S_NEW, RAISE_FROM_ZERO)])).toContain("existing limit");
    expect(await tx([raise("owner", S_CRED, RAISE_OWNER)])).toEqual([{ lim: RAISE_OWNER }]);
    expect(await txError([raise("repA", S_CRED, RAISE_ONE)])).toContain("owner or manager");
  });

  it("manager overrides are capped at 2 per salon per month (CTL-08); the owner is not capped", async () => {
    const r = (to: number) => `select app.office_raise_limit('${S_CRED}', ${to}, 'season demand');`;
    expect(
      await txError([
        ["manager", r(RAISE_ONE)],
        ["manager", r(RAISE_TWO)],
        ["manager", r(RAISE_THREE)],
      ]),
    ).toContain("override cap");
    expect(
      await tx([
        ["manager", r(RAISE_ONE)],
        ["manager", r(RAISE_TWO)],
        ["owner", `select (app.office_raise_limit('${S_CRED}', ${RAISE_THREE}, 'owner decision')).credit_limit_paisa::int lim;`],
      ]),
    ).toEqual([{ lim: RAISE_THREE }]);
  });

  it("any office user blocks; a manager's unblock counts toward the cap", async () => {
    expect(
      await txError([
        ["manager", `select app.office_raise_limit('${S_CRED}', ${RAISE_ONE}, 'one');`],
        ["manager", `select app.office_raise_limit('${S_CRED}', ${RAISE_TWO}, 'two');`],
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
    ).toContain("override cap");
    expect(await sqlstate(REP_A, "select app.office_set_blocked($1, true, 'rep tries')", [S_CRED])).toBe(DENIED);
  });

  it("reps read a reachable salon's terms through the function, never the tables", async () => {
    const st = await run(
      REP_A,
      "select plan_eligibility::text p, credit_limit_paisa::int lim, exposure_paisa::int e, available_paisa::int a, blocked from app.salon_credit_status($1)",
      [S_CRED],
    );
    expect(st.rows).toEqual([{ p: "INST2", lim: LIMIT_CRED, e: 0, a: LIMIT_CRED, blocked: false }]);
    expect((await run(REP_A, "select * from app.salon_credit_status($1)", [S_B])).rows).toEqual([]);
    expect(
      (await run(REP_A, "select plan_eligibility::text p, credit_limit_paisa::int lim from app.salon_credit_status($1)", [S_NEW]))
        .rows,
    ).toEqual([{ p: "CASH", lim: 0 }]);
    expect((await run(REP_A, "select count(*)::int n from public.salon_credit")).rows[0].n).toBe(0);
    expect((await run(REP_A, "select count(*)::int n from public.credit_event")).rows[0].n).toBe(0);
  });
});

describe("the rep order path is closed (D-30)", () => {
  const repPath = (salon = S_NEW) =>
    `select app.create_order('${id()}', '${salon}', 'CASH', 'bag_now', ${lines([{ sku: SKU1, qty: QTY.single }])});`;
  // The personas the rep-path tests used to refuse for their own reasons (no day, other territory,
  // office caller, suspended, unapproved device, no MFA) now all get the one D-30 refusal, first.
  const cases: Array<[string, Who, string]> = [
    ["rep A on its open day", "postgres", script([["repA", repPath()]])],
    ["rep A with no open day", REP_A, repPath()],
    ["rep B for a salon of its own territory", "postgres", script([["repB", repPath(S_B)]])],
    ["rep A for another territory's salon", "postgres", script([["repA", repPath(S_B)]])],
    ["the manager", "postgres", script([["manager", repPath()]])],
    ["the owner", "postgres", script([["owner", repPath()]])],
    ["a suspended rep", SUSPENDED, repPath()],
    ["rep A on an unapproved device", REP_A_WRONG_DEVICE, repPath()],
    ["the manager without MFA (aal1)", MANAGER_AAL1, repPath()],
  ];
  it.each(cases)("a rep cannot create an order (D-30): %s is refused 42501", async (_label, who, sql) => {
    expect(await failureOf(who, sql)).toEqual({ code: DENIED, message: REP_PATH_CLOSED });
  });

  it("anon is refused 42501 before the function body runs (no EXECUTE grant, so not the D-30 message)", async () => {
    const f = await failureOf("anon", repPath());
    expect(f?.code).toBe(DENIED);
    expect(f?.message).toContain("permission denied");
  });

  // The call is caught inside a block (a savepoint), so this proves the discounted call is refused, not
  // that a partial write would be undone: afterwards neither an order nor a discount request exists.
  it("a discounted rep-path call is refused too: no order and no discount request exist afterwards", async () => {
    const cid = id();
    const discounted = lines([{ sku: SKU1, qty: QTY.single, price: PRICE_SKU1_DISCOUNTED }]);
    const r = await tx([
      [
        "repA",
        `do $closed$ begin perform app.create_order('${cid}', '${S_NEW}', 'CASH', 'bag_now', ${discounted});
         exception when insufficient_privilege then null; end $closed$;`,
      ],
      [
        "postgres",
        `select (select count(*)::int from public.sales_order where client_id = '${cid}') orders,
                (select count(*)::int from control.approval_request where maker_id = '${fx.repA.id}' and kind = 'discount'
                   and created_at = now()) approvals;`,
      ],
    ]);
    expect(r).toEqual([{ orders: 0, approvals: 0 }]);
  });

  it("a legacy helper call for a rep with no rep day today raises instead of inserting nothing", async () => {
    const sql = legacyOrderSql({
      clientId: id(),
      salonId: S_NEW,
      skuId: SKU1,
      qty: QTY.single,
      unitPaisa: SKU1_PRICE,
      repId: fx.suspendedRep.id,
      plan: "CASH",
    });
    expect(await errorOf("postgres", sql)).toContain("has no rep day today");
  });
});

describe("taking an order (ORD-01, ORD-10), on the office path", () => {
  it("a cash order at list price is confirmed at once and makes the salon active; a replay returns it", async () => {
    const cid = id();
    const l = lines([
      { sku: SKU1, qty: QTY.cashSku1 },
      { sku: SKU2, qty: QTY.pair },
    ]);
    const total = QTY.cashSku1 * SKU1_PRICE + QTY.pair * SKU2_PRICE;
    const r = await tx([
      order(cid, S_NEW, "CASH", l),
      order(cid, S_NEW, "CASH", l),
      [
        "postgres",
        `select (select count(*)::int from public.sales_order where client_id = '${cid}') n,
                           (select stage::text from public.salon where id = '${S_NEW}') stage,
                           (select count(*)::int from public.sales_order_line where order_id = ${byCid(cid)}) lines;`,
      ],
    ]);
    expect(r).toEqual([{ n: 1, stage: "active_new", lines: QTY.pair }]);
    expect(await tx([order(cid, S_NEW, "CASH", l), showOrder(cid)])).toEqual([
      { status: "confirmed", plan: "CASH", sub: total, disc: 0, total, hold_credit: null, hold_discount: null },
    ]);
    expect(await txError([order(cid, S_NEW, "CASH", l), order(cid, S_NEW, "INST2", l)])).toContain("different content");
  });

  it("every bad line is refused 22023 with the order engine's message (the valid line is accepted)", async () => {
    expect(await txCode([order(id(), S_NEW, "CASH", lines([{ sku: SKU1, qty: QTY.single }]))])).toBeNull();
  });

  const LINE_RULE = "every line needs an active, priced SKU";
  const LINE_COUNT = "an order has 1 to 50 lines";
  const SKU_ONCE = "a SKU appears once in an order";
  const badLines: Array<[string, string, string]> = [
    ["an unpriced SKU", lines([{ sku: SKU_UNPRICED, qty: QTY.single }]), LINE_RULE],
    ["a zero quantity", lines([{ sku: SKU1, qty: 0 }]), LINE_RULE],
    ["a price above list", lines([{ sku: SKU1, qty: QTY.single, price: PRICE_ABOVE_LIST }]), LINE_RULE],
    ["an unknown SKU", lines([{ sku: id(), qty: QTY.single }]), LINE_RULE],
    [
      "a SKU twice",
      lines([
        { sku: SKU1, qty: QTY.single },
        { sku: SKU1, qty: QTY.pair },
      ]),
      SKU_ONCE,
    ],
    ["no lines", "'[]'::jsonb", LINE_COUNT],
    ["an object instead of a list", `'{"sku_id": "${SKU1}"}'::jsonb`, LINE_COUNT],
  ];
  it.each(badLines)("refuses %s", async (_label, bad, message) => {
    const steps = [order(id(), S_NEW, "CASH", bad)];
    expect(await txCode(steps)).toBe(BAD_INPUT);
    expect(await txError(steps)).toContain(message);
  });

  it("the office orders for a salon of any territory (rep territory reach applied only to the closed rep path)", async () => {
    const cid = id();
    expect(await tx([order(cid, S_B, "CASH", lines([{ sku: SKU1, qty: QTY.single }])), showOrder(cid)])).toEqual([
      expect.objectContaining({ status: "confirmed" }),
    ]);
  });
});

describe("the credit check (ORD-02, doc 09 §2, MJ L-0163)", () => {
  it("installments within the limit are confirmed; over the limit or above eligibility the order is held", async () => {
    const ok = id(),
      over = id(),
      noplan = id();
    const r = await tx([
      order(ok, S_CRED, "INST2", lines([{ sku: SKU1, qty: QTY.withinLimit }])),
      order(over, S_CRED, "INST2", lines([{ sku: SKU1, qty: QTY.overAfterWithin }])),
      order(noplan, S_NEW, "INST2", lines([{ sku: SKU2, qty: QTY.single }])), // cash-only salon
      [
        "manager",
        `select client_id, status::text, hold_credit from public.sales_order where client_id in ('${ok}', '${over}', '${noplan}') order by sales_order.status, hold_credit;`,
      ],
    ]);
    expect(r).toEqual([
      { client_id: over, status: "draft", hold_credit: "over_limit" },
      { client_id: noplan, status: "draft", hold_credit: "plan_not_allowed" },
      { client_id: ok, status: "confirmed", hold_credit: null },
    ]);
    const used = QTY.withinLimit * SKU1_PRICE;
    const exp = await tx([
      order(ok, S_CRED, "INST2", lines([{ sku: SKU1, qty: QTY.withinLimit }])),
      ["repA", `select exposure_paisa::int e, available_paisa::int a from app.salon_credit_status('${S_CRED}');`],
    ]);
    expect(exp).toEqual([{ e: used, a: LIMIT_CRED - used }]);
  });

  it("a blocked salon still buys cash on delivery, but gets no installments", async () => {
    const cash = id(),
      inst = id();
    const r = await tx([
      order(cash, S_BLOCK, "CASH", lines([{ sku: SKU2, qty: QTY.single }])),
      order(inst, S_BLOCK, "INST2", lines([{ sku: SKU2, qty: QTY.single }])),
      [
        "manager",
        `select status::text, hold_credit from public.sales_order where client_id in ('${cash}', '${inst}') order by status;`,
      ],
    ]);
    expect(r).toEqual([
      { status: "confirmed", hold_credit: null },
      { status: "draft", hold_credit: "blocked" },
    ]);
  });

  it("the check is rerun on a recheck: a raised limit releases a held office order (ORD-10)", async () => {
    const cid = id();
    const r = await tx([
      order(cid, S_CRED, "INST2", lines([{ sku: SKU1, qty: QTY.overLimit }])),
      ["owner", `select app.office_raise_limit('${S_CRED}', ${RAISE_ONE}, 'owner agrees');`],
      ["manager", `select (app.recheck_order(${byCid(cid)})).status::text;`],
    ]);
    expect(r).toEqual([{ status: "confirmed" }]);
  });

  it("the rep's own recheck still releases its held legacy order; another rep's recheck is refused", async () => {
    const cid = id();
    const held = legacy(cid, S_CRED, "INST2", QTY.overLimit, "draft");
    expect(
      await tx([
        held,
        ["owner", `select app.office_raise_limit('${S_CRED}', ${RAISE_ONE}, 'owner agrees');`],
        ["repA", `select (app.recheck_order(${byCid(cid)})).status::text;`],
      ]),
    ).toEqual([{ status: "confirmed" }]);
    expect(await txError([held, ["repB", `select app.recheck_order(${byCid(cid)});`]])).toContain("only the order's rep");
  });

  it("the office releases a credit hold with a reason; a manager only within 50% and never above eligibility", async () => {
    const over = id(),
      far = id(),
      noplan = id();
    const release = (who: P, cid: string): Step => [
      who,
      `select (app.office_release_credit_hold(${byCid(cid)}, 'known salon, owner told by phone')).status::text;`,
    ];
    const overOrder = order(over, S_CRED, "INST2", lines([{ sku: SKU1, qty: QTY.managerRelease }]));
    const noplanOrder = order(noplan, S_NEW, "INST2", lines([{ sku: SKU2, qty: QTY.single }]));
    expect(await tx([overOrder, release("manager", over)])).toEqual([{ status: "confirmed" }]);
    expect(
      await tx([
        overOrder,
        release("manager", over),
        [
          "manager",
          `select kind::text, order_id is not null has_order from public.credit_event where salon_id = '${S_CRED}' and kind = 'order_override';`,
        ],
      ]),
    ).toEqual([{ kind: "order_override", has_order: true }]);
    expect(
      await txError([order(far, S_CRED, "INST2", lines([{ sku: SKU1, qty: QTY.tooFarOver }])), release("manager", far)]),
    ).toContain("configured percentage");
    expect(await txError([noplanOrder, release("manager", noplan)])).toContain("only the owner");
    expect(await tx([noplanOrder, release("owner", noplan)])).toEqual([{ status: "confirmed" }]);
    expect(await txError([overOrder, release("repA", over)])).toContain("owner or manager");
  });

  it("a manager cannot release a blocked order that also asks for a plan above eligibility", async () => {
    // The recorded hold is only the first that failed ("blocked"); the plan check must still apply.
    const cid = id();
    const steps: Step[] = [
      ["manager", `select app.office_set_blocked('${S_CRED}', true, 'late installment');`],
      order(cid, S_CRED, "INST4", lines([{ sku: SKU2, qty: QTY.single }])),
    ];
    expect(await tx([...steps, ["manager", `select hold_credit from public.sales_order where client_id = '${cid}';`]])).toEqual([
      { hold_credit: "blocked" },
    ]);
    expect(
      await txError([...steps, ["manager", `select app.office_release_credit_hold(${byCid(cid)}, 'unblock this one');`]]),
    ).toContain("only the owner");
  });

  it("a manager's release counts toward the monthly cap", async () => {
    const o1 = id();
    expect(
      await txError([
        ["manager", `select app.office_raise_limit('${S_CRED}', ${RAISE_ONE}, 'one');`],
        ["manager", `select app.office_raise_limit('${S_CRED}', ${RAISE_TWO}, 'two');`],
        order(o1, S_CRED, "INST2", lines([{ sku: SKU1, qty: QTY.capped }])),
        ["manager", `select app.office_release_credit_hold(${byCid(o1)}, 'third override');`],
      ]),
    ).toContain("override cap");
  });
});

describe("discounts (CTL-07, doc 13 §9), on the office path", () => {
  it("a price below list holds the order until another manager approves; the maker and a rep cannot approve it", async () => {
    const cid = id();
    const steps: Step[] = [
      ...HIRE_MANAGER_2,
      order(cid, S_NEW, "CASH", lines([{ sku: SKU1, qty: QTY.discounted, price: PRICE_5_PCT_OFF }])),
    ];
    const sub = QTY.discounted * SKU1_PRICE;
    const total = QTY.discounted * PRICE_5_PCT_OFF;
    expect(await tx([...steps, showOrder(cid)])).toEqual([
      { status: "draft", plan: "CASH", sub, disc: sub - total, total, hold_credit: null, hold_discount: "pending" },
    ]);
    expect(
      await tx([
        ...steps,
        ["manager", `select checker_role_required::text r from control.approval_request where id = ${approvalOf(cid)};`],
      ]),
    ).toEqual([{ r: "manager" }]);
    expect(
      await txError([...steps, ["manager", `select app.decide_approval(${approvalOf(cid)}, true, 'self approve');`]]),
    ).toContain("maker cannot approve their own request");
    expect(
      await txError([...steps, ["repA", `select app.decide_approval(${approvalOf(cid)}, true, 'rep approves');`]]),
    ).toContain("owner or manager");
    expect(
      await tx([
        ...steps,
        ["manager2", `select app.decide_approval(${approvalOf(cid)}, true, 'matches the competitor price');`],
        ["manager", `select (app.recheck_order(${byCid(cid)})).status::text;`],
      ]),
    ).toEqual([{ status: "confirmed" }]);
    expect(
      await tx([
        ...steps,
        ["manager2", `select app.decide_approval(${approvalOf(cid)}, false, 'no discount this month');`],
        ["manager", `select (app.recheck_order(${byCid(cid)})).hold_discount;`],
      ]),
    ).toEqual([{ hold_discount: "rejected" }]);
  });

  it("above 10% or Rs 5,000 the owner decides; another manager is refused", async () => {
    const pct = id(),
      amount = id();
    const pctOrder = order(pct, S_NEW, "CASH", lines([{ sku: SKU2, qty: QTY.single, price: PRICE_SKU2_12_PCT_OFF }]));
    const r = await tx([
      pctOrder,
      order(amount, S_NEW, "CASH", lines([{ sku: SKU1, qty: QTY.bulkSmallPct, price: PRICE_SKU1_DISCOUNTED }])),
      [
        "manager",
        `select checker_role_required::text r from control.approval_request where id in (${approvalOf(pct)}, ${approvalOf(amount)});`,
      ],
    ]);
    expect(r).toEqual([{ r: "owner" }, { r: "owner" }]);
    expect(
      await txError([
        ...HIRE_MANAGER_2,
        pctOrder,
        ["manager2", `select app.decide_approval(${approvalOf(pct)}, true, 'manager tries');`],
      ]),
    ).toContain("owner's decision");
  });
});

describe("cancelling (ORD-03)", () => {
  it("the office cancels a draft with a reason; the pending discount request is cancelled too", async () => {
    const cid = id();
    const r = await tx([
      order(cid, S_NEW, "CASH", lines([{ sku: SKU1, qty: QTY.single, price: PRICE_SKU1_DISCOUNTED }])),
      ["manager", `select app.cancel_order(${byCid(cid)}, 'salon changed its mind');`],
      [
        "manager",
        `select o.status::text o, a.status::text a from public.sales_order o join control.approval_request a on a.id = o.discount_approval_id where o.client_id = '${cid}';`,
      ],
    ]);
    expect(r).toEqual([{ o: "cancelled", a: "cancelled" }]);
  });

  it("the rep cancels its own legacy draft with a reason; rep B cannot even see it", async () => {
    const cid = id();
    const held = legacy(cid, S_CRED, "INST2", QTY.overLimit, "draft");
    expect(
      await tx([
        held,
        ["repA", `select app.cancel_order(${byCid(cid)}, 'salon changed its mind');`],
        [
          "postgres",
          `select status::text, cancelled_by = '${fx.repA.id}' by_rep from public.sales_order where client_id = '${cid}';`,
        ],
      ]),
    ).toEqual([{ status: "cancelled", by_rep: true }]);
    expect(await txError([held, ["repB", `select app.cancel_order(${byCid(cid)}, 'other rep tries');`]])).toContain(
      "unknown order",
    );
  });

  it("only the office cancels a confirmed order; a cancelled order is final", async () => {
    const cid = id();
    const steps: Step[] = [legacy(cid, S_NEW, "CASH", QTY.single)];
    expect(await txError([...steps, ["repA", `select app.cancel_order(${byCid(cid)}, 'rep tries');`]])).toContain(
      "cancels only its own draft",
    );
    expect(await txError([...steps, ["repB", `select app.cancel_order(${byCid(cid)}, 'other rep tries');`]])).toContain(
      "unknown order", // rep B cannot even see rep A's order
    );
    expect(await txError([...steps, ["manager", `select app.cancel_order(${byCid(cid)}, '');`]])).toContain("reason");
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
    ).toContain("final");
  });
});

describe("orders cannot be rewritten (H-06, H-07)", () => {
  const cid = id();
  const base: Step[] = [order(cid, S_NEW, "CASH", lines([{ sku: SKU1, qty: QTY.pair }]))];
  it("amounts, parties and lines are fixed for every role, including postgres", async () => {
    expect(
      await txError([
        ...base,
        ["postgres", `update public.sales_order set total_paisa = 1, subtotal_paisa = 1 where client_id = '${cid}';`],
      ]),
    ).toContain("immutable");
    expect(
      await txError([...base, ["postgres", `update public.sales_order set status = 'draft' where client_id = '${cid}';`]]),
    ).toContain("not allowed");
    expect(
      await txError([...base, ["postgres", `update public.sales_order_line set qty = 1 where order_id = ${byCid(cid)};`]]),
    ).toContain("append-only");
    expect(await txError([...base, ["postgres", `delete from public.sales_order where client_id = '${cid}';`]])).toContain(
      "never deleted",
    );
    expect(await sqlstate("postgres", "truncate public.sales_order cascade")).toBe(DENIED);
  });

  it("reps see only their own legacy orders; my_orders lists them", async () => {
    const own = id();
    const repOrder: Step = legacy(own, S_NEW, "CASH", QTY.pair);
    const r = await tx([
      repOrder,
      [
        "repB",
        `select (select count(*)::int from public.sales_order where client_id = '${own}') o, (select count(*)::int from public.sales_order_line where order_id in (select id from public.sales_order where client_id = '${own}')) l;`,
      ],
    ]);
    expect(r).toEqual([{ o: 0, l: 0 }]);
    const mine = await tx([
      repOrder,
      [
        "repA",
        `select status::text, total_paisa::int t, salon_name is not null named from app.my_orders() where salon_id = '${S_NEW}';`,
      ],
    ]);
    expect(mine).toEqual([{ status: "confirmed", t: QTY.pair * SKU1_PRICE, named: true }]);
  });

  it("an office order with no assigned rep is seen by no rep", async () => {
    const r = await tx([...base, ["repA", `select count(*)::int o from public.sales_order where client_id = '${cid}';`]]);
    expect(r).toEqual([{ o: 0 }]);
  });

  it("the audit chain still verifies (H-17)", async () => {
    expect((await run("postgres", "select ok from control.verify_audit_chain()")).rows[0].ok).toBe(true);
  });
});
