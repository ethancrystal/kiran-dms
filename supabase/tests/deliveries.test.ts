/**
 * Deliveries and invoices (migration 0013, task P1-06 part b): ORD-03, ORD-04, ADM-03; doc 02
 * (3 orders → active regular); doc 09 §8 numbering; MJ L-0163 (receiver's name + GPS).
 *
 * Catalogue, territories, salons, a warehouse and its opening stock are committed with fresh ids.
 * Each test runs in one rolled-back transaction that opens the reps' day, gives rep A a bag when it
 * has none and loads it from the warehouse, then switches persona step by step. No bag, day, order
 * or invoice is left behind (the inventory tests create rep A's bag themselves, later in name order).
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { approveSalon, errorOf, fx, MANAGER, OWNER, REP_A, run, sqlstate, type Who } from "./helpers/db";
import { submitApproveSql } from "./helpers/submit-approve";

const C = { commit: true };
const id = () => randomUUID();
const tag = () => randomUUID().slice(0, 8);
const one = async (who: Who, sql: string, params: unknown[] = []) => (await run(who, sql, params, C)).rows[0];
const TODAY = "(now() at time zone 'Asia/Karachi')::date";

const T_A = id(),
  AREA_A = id(),
  T_B = id(),
  AREA_B = id();
const SALON = id(),
  SALON_B = id();
const GROUP = id(),
  PRODUCT = id(),
  SKU1 = id(), // Rs 1,200
  SKU2 = id(); // Rs 500
const WH = id();
const BAG_A = `(select l.id from public.stock_location l where l.kind = 'rep_bag' and l.owner_user_id = '${fx.repA.id}')`;

type P = "repA" | "repB" | "manager" | "owner";
const asUser = (k: P) => `
  reset role;
  select set_config('request.jwt.claims', '${JSON.stringify({ sub: fx[k].id, role: "authenticated", aal: k.startsWith("rep") ? "aal1" : "aal2" })}', true),
         set_config('request.headers', '${JSON.stringify({ "x-kiran-device": fx[k].device })}', true);
  set local role authenticated;`;
// Rep A's day open, a bag for rep A (created here only when it has none), 20 of each SKU in it.
const prelude = `
  insert into public.rep_day (rep_id, day) values ('${fx.repA.id}', ${TODAY}), ('${fx.repB.id}', ${TODAY}) on conflict (rep_id, day) do nothing;
  ${asUser("owner")}
  select app.office_create_location('${id()}', 'rep_bag', '[Test] Delivery bag A', '${fx.repA.id}', 50000000)
   where not exists (select 1 from public.stock_location l where l.kind = 'rep_bag' and l.owner_user_id = '${fx.repA.id}');
  reset role;
  insert into public.stock_movement (client_id, sku_id, qty, from_location_id, to_location_id, kind, actor_id)
  values (gen_random_uuid(), '${SKU1}', 20, '${WH}', ${BAG_A}, 'issue_to_rep', '${fx.manager.id}'),
         (gen_random_uuid(), '${SKU2}', 20, '${WH}', ${BAG_A}, 'issue_to_rep', '${fx.manager.id}');`;
type Step = [P | "postgres", string];
const script = (steps: Step[]) =>
  `${prelude}\n${steps.map(([k, sql]) => `${k === "postgres" ? "reset role;" : asUser(k)}\n${sql}`).join("\n")}`;
type Multi = Array<{ rows: Array<Record<string, unknown>> }>;
const tx = async (steps: Step[]) => ((await run("postgres", script(steps))) as unknown as Multi).at(-1)?.rows ?? [];
const txError = (steps: Step[]) => errorOf("postgres", script(steps));

const lines = (l: Array<[string, number]>) => `'${JSON.stringify(l.map(([sku_id, qty]) => ({ sku_id, qty })))}'::jsonb`;
// The office makes the order and names rep A to deliver it (D-30): delivery mode bag_now, delivered from rep A's bag.
const order = (cid: string, l: Array<[string, number]>, salon = SALON): Step => [
  "manager",
  `select app.office_create_order('${cid}', '${salon}', 'CASH', ${lines(l)}, '${fx.repA.id}');`,
];
const oid = (cid: string) => `(select id from public.sales_order where client_id = '${cid}')`;
// A rep's delivery (D-32): `who` submits it and the manager approves it; returns the invoice row.
const deliver = (dcid: string, ocid: string, l: Array<[string, number]> | null = null, who: P = "repA"): Step => [
  "postgres",
  submitApproveSql(asUser, { clientId: dcid, orderExpr: oid(ocid), rep: who, approver: "manager", lines: l ? lines(l) : null }),
];
const num = (n: unknown) => Number(String(n).slice(-6));

beforeAll(async () => {
  await one(MANAGER, "select app.office_upsert_territory($1, $2)", [T_A, `[Test] Deliveries A ${tag()}`]);
  await one(MANAGER, "select app.office_upsert_territory($1, $2)", [T_B, `[Test] Deliveries B ${tag()}`]);
  await one(MANAGER, "select app.office_upsert_area($1, $2, '[Test] Deliveries area A')", [AREA_A, T_A]);
  await one(MANAGER, "select app.office_upsert_area($1, $2, '[Test] Deliveries area B')", [AREA_B, T_B]);
  await one(MANAGER, "select app.office_assign_territory($1, $2)", [fx.repA.id, T_A]);
  await one(MANAGER, "select app.office_assign_territory($1, $2)", [fx.repB.id, T_B]);
  await one(REP_A, "select app.create_salon($1, $2, 'ladies_parlor', $3, 'map_pin', null, 24.9, 67.1)", [
    SALON,
    `[Test] Delivery salon ${tag()}`,
    AREA_A,
  ]);
  await one({ as: "repB" }, "select app.create_salon($1, $2, 'ladies_parlor', $3, 'map_pin', null, 24.9, 67.1)", [
    SALON_B,
    `[Test] Delivery salon B ${tag()}`,
    AREA_B,
  ]);
  // D-35 (slice 7): a rep's salon is a proposal; the office approves both before any order.
  await approveSalon(SALON);
  await approveSalon(SALON_B);
  await one(MANAGER, "select app.office_upsert_product_group($1, $2, 21)", [GROUP, `[Test] Delivery colour ${tag()}`]);
  await one(MANAGER, "select app.office_upsert_product($1, $2, '[Dummy] Kiran', '[Dummy] Delivery colour')", [PRODUCT, GROUP]);
  for (const s of [SKU1, SKU2]) {
    await one(MANAGER, "select app.office_upsert_sku($1, $2, $3, '[Dummy] shade', 'ml', 100)", [
      s,
      PRODUCT,
      `T-DEL-${tag().toUpperCase()}`,
    ]);
  }
  await one(OWNER, "select app.owner_set_sku_price($1, 120000, 'dummy list price')", [SKU1]);
  await one(OWNER, "select app.owner_set_sku_price($1, 50000, 'dummy list price')", [SKU2]);
  await one(MANAGER, "select app.office_create_location($1, 'warehouse', '[Test] Delivery store')", [WH]);
  // Opening stock (goods receipts arrive with the vault, P1-05): 100 of each, as a receipt row.
  await one(
    "postgres",
    `insert into public.stock_movement (client_id, sku_id, qty, to_location_id, kind, actor_id)
     values (gen_random_uuid(), $1, 100, $3, 'receipt', $4), (gen_random_uuid(), $2, 100, $3, 'receipt', $4)`,
    [SKU1, SKU2, WH, fx.manager.id],
  );
});

afterAll(async () => {
  await one(MANAGER, "select app.office_end_territory($1, $2, 'deliveries tests finished')", [fx.repA.id, T_A]);
  await one(MANAGER, "select app.office_end_territory($1, $2, 'deliveries tests finished')", [fx.repB.id, T_B]);
});

describe("delivering from the bag (ORD-04, MJ L-0163)", () => {
  it("a full delivery moves the stock, issues one numbered invoice and completes the order", async () => {
    const o = id(),
      d = id();
    const r = await tx([
      order(o, [
        [SKU1, 6],
        [SKU2, 2],
      ]),
      deliver(d, o),
      [
        "postgres",
        `select i.number ~ ('^INV-' || lpad(app.fiscal_year((now() at time zone 'Asia/Karachi')::date)::text, 2, '0') || '-[0-9]{6}$') numbered, i.subtotal_paisa::int sub, i.total_paisa::int total, i.plan::text plan,
                o.status::text order_status, dl.status::text delivery_status, dl.received_by_name, dl.distance_from_pin_m dist,
                app.on_hand(${BAG_A}, '${SKU1}')::int bag_sku1,
                (select count(*)::int from public.stock_movement m where m.source_type = 'delivery' and m.source_id = dl.id and m.kind = 'sale') moves
         from public.invoice i join public.delivery dl on dl.id = i.delivery_id join public.sales_order o on o.id = i.order_id
         where o.client_id = '${o}';`,
      ],
    ]);
    expect(r).toEqual([
      {
        numbered: true,
        sub: 820000,
        total: 820000,
        plan: "CASH",
        order_status: "delivered",
        delivery_status: "full",
        received_by_name: "Ayesha at the counter",
        dist: 0,
        bag_sku1: 14,
        moves: 2,
      },
    ]);
  });

  it("a replay returns the same invoice; the same client_id on another order is refused", async () => {
    const o = id(),
      o2 = id(),
      d = id();
    const base: Step[] = [order(o, [[SKU1, 1]]), order(o2, [[SKU2, 1]]), deliver(d, o)];
    expect(
      await tx([
        ...base,
        deliver(d, o),
        ["postgres", `select count(*)::int invoices from public.invoice where order_id = ${oid(o)};`],
      ]),
    ).toEqual([{ invoices: 1 }]);
    expect(await txError([...base, deliver(d, o2)])).toMatch(/different content/);
  });

  it("part deliveries: each takes what is given, gets its own consecutive number, and the order completes on the last", async () => {
    const o = id();
    const r = await tx([
      order(o, [
        [SKU1, 5],
        [SKU2, 4],
      ]),
      deliver(id(), o, [
        [SKU1, 2],
        [SKU2, 4],
      ]),
      ["repA", `select status::text s from public.sales_order where client_id = '${o}';`],
    ]);
    expect(r).toEqual([{ s: "partially_delivered" }]);
    const both = await tx([
      order(o, [
        [SKU1, 5],
        [SKU2, 4],
      ]),
      deliver(id(), o, [[SKU1, 2]]),
      deliver(id(), o),
      [
        "postgres",
        `select array_agg(i.number order by i.number) numbers, array_agg(d.status::text order by i.number) statuses,
                (select status::text from public.sales_order where client_id = '${o}') order_status,
                (select sum(remaining)::int from app.order_lines_left(${oid(o)})) left_over
         from public.invoice i join public.delivery d on d.id = i.delivery_id where i.order_id = ${oid(o)};`,
      ],
    ]);
    const row = both[0] as { numbers: string[]; statuses: string[]; order_status: string; left_over: number };
    expect(num(row.numbers[1]) - num(row.numbers[0])).toBe(1);
    expect(row.statuses).toEqual(["partial", "full"]);
    expect(row.order_status).toBe("delivered");
    expect(row.left_over).toBe(0);
  });

  it("refuses lines not on the order, more than is left, a missing name or GPS", async () => {
    const o = id();
    const base: Step[] = [order(o, [[SKU1, 3]])];
    expect(await txError([...base, deliver(id(), o, [[SKU2, 1]])])).toMatch(/SKU of this order/);
    expect(await txError([...base, deliver(id(), o, [[SKU1, 4]])])).toMatch(/at most what is left/);
    expect(await txError([...base, ["repA", `select app.rep_submit_delivery('${id()}', ${oid(o)}, ' ', 24.9, 67.1);`]])).toMatch(
      /name of the person/,
    );
    expect(
      await txError([...base, ["repA", `select app.rep_submit_delivery('${id()}', ${oid(o)}, 'Ayesha', null, null);`]]),
    ).toMatch(/GPS is required/);
  });

  it("refuses an order that is not confirmed: held, cancelled, or already delivered", async () => {
    const held = id(),
      gone = id(),
      done = id();
    expect(
      await txError([
        [
          "manager",
          `select app.office_create_order('${held}', '${SALON}', 'CASH', '[{"sku_id": "${SKU1}", "qty": 1, "unit_price_paisa": 100000}]'::jsonb, '${fx.repA.id}');`,
        ],
        deliver(id(), held),
      ]),
    ).toMatch(/only a confirmed order/);
    expect(
      await txError([
        order(gone, [[SKU1, 1]]),
        ["manager", `select app.cancel_order(${oid(gone)}, 'salon closed today');`],
        deliver(id(), gone),
      ]),
    ).toMatch(/only a confirmed order/);
    expect(await txError([order(done, [[SKU1, 1]]), deliver(id(), done), deliver(id(), done)])).toMatch(/only a confirmed order/);
  });

  it("a bag short of stock refuses the delivery, and the refused delivery takes no invoice number", async () => {
    const big = id(),
      a = id(),
      b = id();
    expect(await txError([order(big, [[SKU1, 21]]), deliver(id(), big)])).toMatch(/insufficient stock/);
    const r = await tx([
      order(a, [[SKU1, 1]]),
      order(big, [[SKU1, 21]]),
      order(b, [[SKU2, 1]]),
      deliver(id(), a),
      // A refused delivery inside the same transaction, caught so the transaction goes on.
      [
        "repA",
        `do $$ begin perform app.rep_submit_delivery('${id()}', ${oid(big)}, 'Ayesha', 24.9, 67.1); exception when others then null; end $$;`,
      ],
      deliver(id(), b),
      ["postgres", `select array_agg(number order by number) n from public.invoice where order_id in (${oid(a)}, ${oid(b)});`],
    ]);
    const n = (r[0] as { n: string[] }).n;
    expect(num(n[1]) - num(n[0])).toBe(1);
  });

  it("only the order's rep, checked in, delivers from its own bag; the office cannot use the rep path", async () => {
    const o = id();
    const base: Step[] = [order(o, [[SKU1, 1]])];
    expect(await txError([...base, deliver(id(), o, null, "repB")])).toMatch(/own orders/);
    expect(await txError([...base, deliver(id(), o, null, "manager")])).toMatch(/office uses office_deliver/);
    expect(
      await txError([
        ...base,
        [
          "postgres",
          `update public.rep_day set status = 'force_closed', check_out_at = now(), closed_by = '${fx.manager.id}', close_reason = 'test close'
           where rep_id = '${fx.repA.id}' and day = ${TODAY};`,
        ],
        deliver(id(), o),
      ]),
    ).toMatch(/check in before delivering/);
  });
});

describe("delivering from the warehouse (office, doc 06 on behalf)", () => {
  it("the office delivers from an active warehouse, GPS optional; reps and bags are refused", async () => {
    const o = id(),
      d = id();
    const call = (who: P, loc: string): Step => [
      who,
      `select (app.office_deliver('${d}', ${oid(o)}, ${loc}, 'Driver handed to owner')).number;`,
    ];
    expect(
      await tx([
        order(o, [[SKU2, 3]]),
        call("manager", `'${WH}'`),
        [
          "postgres",
          `select d.delivered_by_role::text r, d.rep_day_id is null no_day, d.lat is null no_gps, app.on_hand('${WH}', '${SKU2}')::int wh
           from public.delivery d where d.client_id = '${d}';`,
        ],
      ]),
    ).toEqual([{ r: "manager", no_day: true, no_gps: true, wh: 77 }]);
    expect(await txError([order(o, [[SKU2, 3]]), call("manager", BAG_A)])).toMatch(/active warehouse/);
    expect(await txError([order(o, [[SKU2, 3]]), call("repA", `'${WH}'`)])).toMatch(/owner or manager/);
  });
});

describe("what a delivery changes elsewhere", () => {
  it("the salon's cycle estimate is now kept by deliveries; the opening date no longer applies", async () => {
    const o = id();
    const base: Step[] = [
      ["manager", `select app.office_set_last_purchase('${SALON}', '${GROUP}', ${TODAY} - 30);`],
      order(o, [[SKU1, 1]]),
      deliver(id(), o),
    ];
    expect(
      await tx([
        ...base,
        [
          "postgres",
          `select basis::text, basis_orders, last_order_on = ${TODAY} today from public.cycle_estimate where salon_id = '${SALON}' and product_group_id = '${GROUP}';`,
        ],
      ]),
    ).toEqual([{ basis: "orders", basis_orders: 1, today: true }]);
    expect(
      await txError([...base, ["manager", `select app.office_set_last_purchase('${SALON}', '${GROUP}', ${TODAY} - 5);`]]),
    ).toMatch(/kept by deliveries/);
  });

  it("a third delivered order makes an active salon a regular one (doc 02)", async () => {
    const [a, b, c] = [id(), id(), id()];
    const stage = ["postgres", `select stage::text from public.salon where id = '${SALON}';`] as Step;
    expect(await tx([order(a, [[SKU1, 1]]), deliver(id(), a), order(b, [[SKU1, 1]]), deliver(id(), b), stage])).toEqual([
      { stage: "active_new" },
    ]);
    expect(
      await tx([
        order(a, [[SKU1, 1]]),
        deliver(id(), a),
        order(b, [[SKU1, 1]]),
        deliver(id(), b),
        order(c, [[SKU1, 1]]),
        deliver(id(), c),
        stage,
      ]),
    ).toEqual([{ stage: "active_regular" }]);
  });

  it("a delivered or part-delivered order can no longer be cancelled", async () => {
    const o = id();
    expect(
      await txError([
        order(o, [[SKU1, 2]]),
        deliver(id(), o, [[SKU1, 1]]),
        ["manager", `select app.cancel_order(${oid(o)}, 'salon changed its mind');`],
      ]),
    ).toMatch(/before delivery/);
  });
});

describe("reads and history (H-06, H-07, H-14)", () => {
  it("reps see the deliveries and invoices of their own orders only; what is left is read through the function", async () => {
    const o = id();
    const base: Step[] = [
      order(o, [
        [SKU1, 3],
        [SKU2, 1],
      ]),
      deliver(id(), o, [[SKU1, 1]]),
    ];
    expect(
      await tx([
        ...base,
        [
          "repB",
          `select (select count(*)::int from public.invoice where order_id in (select id from public.sales_order where client_id = '${o}')) i,
                  (select count(*)::int from app.order_remaining((select id from public.sales_order where client_id = '${o}'))) left_rows;`,
        ],
      ]),
    ).toEqual([{ i: 0, left_rows: 0 }]);
    expect(
      await tx([
        ...base,
        ["repA", `select sku_id, ordered, delivered, remaining from app.order_remaining(${oid(o)}) order by line_no;`],
      ]),
    ).toEqual([
      { sku_id: SKU1, ordered: 3, delivered: 1, remaining: 2 },
      { sku_id: SKU2, ordered: 1, delivered: 0, remaining: 1 },
    ]);
  });

  it("deliveries, their lines and invoices never change, for postgres too", async () => {
    const o = id();
    const base: Step[] = [order(o, [[SKU1, 1]]), deliver(id(), o)];
    for (const stmt of [
      `update public.invoice set total_paisa = 1 where order_id = ${oid(o)};`,
      `delete from public.invoice where order_id = ${oid(o)};`,
      `update public.delivery set received_by_name = 'someone else' where order_id = ${oid(o)};`,
      `update public.delivery_line set qty = 2;`,
    ]) {
      expect(await txError([...base, ["postgres", stmt]])).toMatch(/append-only/);
    }
    expect(await sqlstate("postgres", "truncate public.invoice cascade")).toBe("42501");
    expect(await sqlstate("postgres", "truncate public.delivery cascade")).toBe("42501");
  });

  it("the audit chain still verifies (H-17)", async () => {
    expect((await run("postgres", "select ok from control.verify_audit_chain()")).rows[0].ok).toBe(true);
  });
});
