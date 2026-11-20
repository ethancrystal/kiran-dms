/**
 * Office stock receipt (INV-03) and restock suggestions (INV-07 estimate):
 * migration 20261121010000.
 *
 * One persona per transaction, fresh ids, and every check tries to break a control:
 * who may receive stock, replay behaviour (H-08), input bounds, and the estimate's
 * arithmetic against recorded history only.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import {
  fx,
  MANAGER,
  MANAGER_AAL1,
  OWNER,
  OWNER_AAL1,
  REP_A,
  run,
  sqlstate,
  type Who,
} from "./helpers/db";

const C = { commit: true };
const id = () => randomUUID();
const code = () => `T-${randomUUID().slice(0, 8).toUpperCase()}`;

const GROUP = id(),
  PRODUCT = id(),
  S1 = id(), // received heavily; rule 10; suggestion must be 0
  S2 = id(), // received 25; outward 14/28d; open order 3; rule 4; suggestion must be 0
  S3 = id(); // never received; outward 14/28d; open order 3; rule 4; suggestion must be 14
const WH = id(),
  BAG = id(),
  TERRITORY = id(),
  AREA = id(),
  SALON = id(),
  REP_DAY = id(),
  ORDER_S2 = id(),
  ORDER_S3 = id();
let repDayId = "";
const PRICE = 100_000;

const one = async (who: Who, sql: string, params: unknown[] = []) => (await run(who, sql, params, C)).rows[0];
const onHand = async (loc: string, sku: string) =>
  Number((await run("postgres", "select app.on_hand($1, $2) n", [loc, sku])).rows[0].n);

beforeAll(async () => {
  await one(MANAGER, "select app.office_upsert_product_group($1, $2, 30)", [GROUP, `[Test] restock group ${code()}`]);
  await one(MANAGER, "select app.office_upsert_product($1, $2, '[Dummy] Kiran', '[Dummy] Hair oil')", [PRODUCT, GROUP]);
  for (const s of [S1, S2, S3])
    await one(MANAGER, "select app.office_upsert_sku($1, $2, $3, '[Dummy] 100 ml', 'ml', 100)", [s, PRODUCT, code()]);
  for (const s of [S1, S2, S3]) await one(OWNER, "select app.owner_set_sku_price($1, $2, 'dummy price list')", [s, PRICE]);
  await one(MANAGER, "select app.office_create_location($1, 'warehouse', '[Test] Restock store')", [WH]);
  await one(OWNER, "select app.office_create_location($1, 'rep_bag', '[Test] Restock bag', $2, 2000000)", [BAG, fx.repA.id]);
  await one(MANAGER, "select app.office_upsert_territory($1, $2)", [TERRITORY, `[Test] restock territory ${code()}`]);
  await one(MANAGER, "select app.office_upsert_area($1, $2, $3)", [AREA, TERRITORY, `[Test] restock area ${code()}`]);
  await one(OWNER, "select app.create_salon($1, $2, 'ladies_parlor', $3, 'manual')", [SALON, `[Test] Restock salon ${code()}`, AREA]);
  await run(
    "postgres",
    `insert into public.rep_day (id, rep_id, day)
     values ($1, $2, (now() at time zone 'Asia/Karachi')::date)
     on conflict (rep_id, day) do nothing`,
    [REP_DAY, fx.repA.id],
    C,
  );
  const repDay = (
    await run("postgres", "select id from public.rep_day where rep_id = $1 and day = (now() at time zone 'Asia/Karachi')::date", [fx.repA.id], C)
  ).rows[0];
  repDayId = repDay.id;
  await one(OWNER, "select app.office_set_reorder_point($1, $2)", [S1, 10]);
  await one(OWNER, "select app.office_set_reorder_point($1, $2)", [S2, 4]);
  await one(OWNER, "select app.office_set_reorder_point($1, $2)", [S3, 4]);
});

describe("office stock receipt (INV-03)", () => {
  it("the office receives stock into a warehouse and on-hand rises; the audit chain still verifies", async () => {
    const r = (await one(OWNER, "select app.office_receive_stock($1, $2, $3, $4) r", [
      id(),
      WH,
      JSON.stringify([{ sku_id: S1, qty: 50 }]),
      "[Test] goods received from a supplier delivery",
    ])).r;
    expect(r).toEqual({ replay: false, lines: 1, units: 50 });
    expect(await onHand(WH, S1)).toBe(50);
    const r2 = (await one(MANAGER, "select app.office_receive_stock($1, $2, $3, $4) r", [
      id(),
      WH,
      JSON.stringify([{ sku_id: S1, qty: 10 }]),
      "[Test] a later carton of the same delivery",
    ])).r;
    expect(r2).toEqual({ replay: false, lines: 1, units: 10 });
    expect(await onHand(WH, S1)).toBe(60);
    expect((await run("postgres", "select ok from control.verify_audit_chain()")).rows[0].ok).toBe(true);
  });

  it("a replayed batch id changes nothing (H-08)", async () => {
    const batch = id();
    const lines = JSON.stringify([{ sku_id: S2, qty: 25 }]);
    await one(OWNER, "select app.office_receive_stock($1, $2, $3, $4)", [batch, WH, lines, "[Test] first receipt of the batch"]);
    expect(await onHand(WH, S2)).toBe(25);
    const replay = (await one(OWNER, "select app.office_receive_stock($1, $2, $3, $4) r", [
      batch,
      WH,
      lines,
      "[Test] first receipt of the batch",
    ])).r;
    expect(replay).toEqual({ replay: true, client_id: batch });
    expect(await onHand(WH, S2)).toBe(25);
    expect((await run("postgres", "select ok from control.verify_audit_chain()")).rows[0].ok).toBe(true);
  });

  it("reps, anonymous and AAL1 office sessions are refused", async () => {
    const lines = JSON.stringify([{ sku_id: S1, qty: 1 }]);
    expect(await sqlstate(REP_A, "select app.office_receive_stock($1, $2, $3, $4)", [id(), WH, lines, "[Test] rep tries goods-in"])).toBe("42501");
    expect(await sqlstate("anon", "select app.office_receive_stock($1, $2, $3, $4)", [id(), WH, lines, "[Test] anonymous goods-in"])).toBe("42501");
    expect(await sqlstate(OWNER_AAL1, "select app.office_receive_stock($1, $2, $3, $4)", [id(), WH, lines, "[Test] aal1 goods-in"])).toBe("42501");
    expect(await sqlstate(MANAGER_AAL1, "select app.office_receive_stock($1, $2, $3, $4)", [id(), WH, lines, "[Test] aal1 goods-in"])).toBe("42501");
  });

  it("stock is refused anywhere but an active warehouse, and bad input is refused", async () => {
    expect(
      await sqlstate(OWNER, "select app.office_receive_stock($1, $2, $3, $4)", [
        id(),
        BAG,
        JSON.stringify([{ sku_id: S1, qty: 5 }]),
        "[Test] straight into a rep bag",
      ]),
    ).toBe("42501");
    expect(await sqlstate(OWNER, "select app.office_receive_stock($1, $2, $3, $4)", [id(), WH, JSON.stringify([{ sku_id: S1, qty: 0 }]), "[Test] zero qty"])).toBe(
      "22023",
    );
    expect(await sqlstate(OWNER, "select app.office_receive_stock($1, $2, $3, $4)", [id(), WH, JSON.stringify([{ sku_id: id(), qty: 5 }]), "[Test] unknown sku"])).toBe(
      "22023",
    );
    expect(await sqlstate(OWNER, "select app.office_receive_stock($1, $2, $3, $4)", [id(), WH, JSON.stringify([]), "[Test] empty lines"])).toBe("22023");
    expect(await sqlstate(OWNER, "select app.office_receive_stock($1, $2, $3, $4)", [id(), WH, JSON.stringify([{ sku_id: S1, qty: 5 }]), "no"])).toBe("42501");
    expect(
      await sqlstate(OWNER, "select app.office_receive_stock($1, $2, $3, $4)", [id(), WH, JSON.stringify([{ sku_id: S1, qty: 5 }]), "x".repeat(301)]),
    ).toBe("42501");
  });
});

describe("restock suggestions (INV-07 estimate)", () => {
  beforeAll(async () => {
    // S3 must hold stock before outward rows can exist: the movement guard refuses
    // anything that would take a location below zero, even backdated history.
    await one(OWNER, "select app.office_receive_stock($1, $2, $3, $4)", [
      id(),
      WH,
      JSON.stringify([{ sku_id: S3, qty: 20 }]),
      "[Test] opening stock for the suggestion history",
    ]);
    // Outward history: 14 units leaving the warehouse per sku over the last 14 of 28
    // days (backdated rows as postgres, the way the database tests seed history).
    await run(
      "postgres",
      `insert into public.stock_movement (client_id, sku_id, qty, from_location_id, kind, actor_id, created_at)
       values ($1, $2, 7, $3, 'sale', $4, now() - interval '7 days'),
              ($5, $2, 7, $3, 'sale', $4, now() - interval '14 days')`,
      [id(), S2, WH, fx.manager.id, id()],
      C,
    );
    await run(
      "postgres",
      `insert into public.stock_movement (client_id, sku_id, qty, from_location_id, kind, actor_id, created_at)
       values ($1, $2, 7, $3, 'sale', $4, now() - interval '7 days'),
              ($5, $2, 7, $3, 'sale', $4, now() - interval '14 days')`,
      [id(), S3, WH, fx.manager.id, id()],
      C,
    );
    // Confirmed orders with nothing delivered: open demand of 3 per sku.
    for (const [order, sku] of [
      [ORDER_S2, S2],
      [ORDER_S3, S3],
    ] as const) {
      await run(
        "postgres",
        `insert into public.sales_order (id, client_id, salon_id, rep_id, rep_day_id, plan, delivery_mode, status,
                                         confirmed_at, subtotal_paisa, total_paisa)
         values ($1, $2, $3, $4, $5, 'CASH', 'bag_now', 'confirmed', now(), $6, $6)`,
        [order, id(), SALON, fx.repA.id, repDayId, 3 * PRICE],
        C,
      );
      await run(
        "postgres",
        `insert into public.sales_order_line (order_id, line_no, sku_id, qty, list_price_paisa, unit_price_paisa, line_total_paisa)
         values ($1, 1, $2, 3, $3, $3, $4)`,
        [order, sku, PRICE, 3 * PRICE],
        C,
      );
    }
  });

  it("the estimate follows the recorded history: outward average, open orders, reorder point, on hand", async () => {
    const rows = (await run(MANAGER, "select * from app.office_restock_suggestions()")).rows;
    const s3 = rows.find((r: { sku_id: string }) => r.sku_id === S3);
    expect(s3).toBeDefined();
    expect(Number(s3.weekly_avg)).toBe(3.5); // 14 outward units over 28 days
    expect(Number(s3.open_demand)).toBe(3);
    expect(Number(s3.reorder_point)).toBe(4);
    expect(Number(s3.on_hand)).toBe(6); // 20 received, 14 sold out
    // ceil(14 x 14 / 28) + 3 + 4 - 6 = 7 + 7 - 6 = 8
    expect(Number(s3.suggested_qty)).toBe(8);
    const s2 = rows.find((r: { sku_id: string }) => r.sku_id === S2);
    expect(Number(s2.on_hand)).toBe(11); // 25 received, 14 sold out
    // 7 + 3 + 4 - 11 = 3
    expect(Number(s2.suggested_qty)).toBe(3);
    const s1 = rows.find((r: { sku_id: string }) => r.sku_id === S1);
    expect(Number(s1.on_hand)).toBe(60);
    expect(Number(s1.suggested_qty)).toBe(0);
  });

  it("every row is worded as an estimate, never a purchase order", async () => {
    const rows = (await run(OWNER, "select * from app.office_restock_suggestions(14, 28)")).rows;
    expect(rows.length).toBeGreaterThanOrEqual(3);
    for (const r of rows) expect(String(r.reasoning)).toContain("estimate");
  });

  it("reps and anonymous are refused, and the parameter bounds hold", async () => {
    expect(await sqlstate(REP_A, "select * from app.office_restock_suggestions()")).toBe("42501");
    expect(await sqlstate("anon", "select * from app.office_restock_suggestions()")).toBe("42501");
    expect(await sqlstate(OWNER, "select * from app.office_restock_suggestions(0, 28)")).toBe("42501");
    expect(await sqlstate(OWNER, "select * from app.office_restock_suggestions(181, 28)")).toBe("42501");
    expect(await sqlstate(OWNER, "select * from app.office_restock_suggestions(14, 6)")).toBe("42501");
    expect(await sqlstate(OWNER, "select * from app.office_restock_suggestions(14, 366)")).toBe("42501");
    expect(await sqlstate(OWNER, "select * from app.office_restock_suggestions(null, 28)")).toBe("42501");
  });
});
