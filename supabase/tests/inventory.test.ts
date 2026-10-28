/**
 * Inventory (migration 0008, task P1-04): INV-01 to INV-06, CTL-05, DEM-01.
 *
 * Steps that need several personas commit (one persona per transaction, like the real
 * app); every id is fresh, so committed rows never collide with other files. Each check
 * tries to break a control, not only to use it.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { errorOf, MANAGER, MANAGER_AAL1, OWNER, OWNER_AAL1, REP_A, REP_A_WRONG_DEVICE, REP_B, run, sqlstate, SUSPENDED, type Who } from "./helpers/db";
import { fx } from "./helpers/db";

const C = { commit: true };
const id = () => randomUUID();
const code = () => `T-${randomUUID().slice(0, 8).toUpperCase()}`;

const GROUP = id(), OTHER_GROUP = id(), PRODUCT = id(), S1 = id(), S2 = id(), UNPRICED = id();
const WH = id(), BAG_A = id(), BAG_B = id();
const PRICE = 100_000; // Rs 1,000 per unit, in paisa

const one = async (who: Who, sql: string, params: unknown[] = []) => (await run(who, sql, params, C)).rows[0];
const onHand = async (loc: string, sku: string) =>
  Number((await run("postgres", "select app.on_hand($1, $2) n", [loc, sku])).rows[0].n);

/** Approval-gated adjustment: maker requests, checker decides, the office posts it. */
async function approvedAdjustment(sku: string, qtyDelta: number, maker: Who, checker: Who, checkerRole: "manager" | "owner") {
  const req = await one(maker,
    "select (app.request_approval($1, 'adjustment', 'stock_location', $2, $3, $4, $5::public.app_role)).id",
    [id(), WH, JSON.stringify({ sku_id: sku, qty_delta: qtyDelta }), "[Test] stock adjustment", checkerRole]);
  await one(checker, "select app.decide_approval($1, true, 'counted and checked')", [req.id]);
  return req.id as string;
}

beforeAll(async () => {
  await one(MANAGER, "select app.office_upsert_product_group($1, $2, 21)", [GROUP, `[Dummy] Color ${code()}`]);
  await one(MANAGER, "select app.office_upsert_product_group($1, $2, 30)", [OTHER_GROUP, `[Dummy] Bond ${code()}`]);
  await one(MANAGER, "select app.office_upsert_product($1, $2, '[Dummy] Kiran', '[Dummy] Permanent Color')", [PRODUCT, GROUP]);
  for (const s of [S1, S2, UNPRICED]) {
    await one(MANAGER, "select app.office_upsert_sku($1, $2, $3, '[Dummy] shade', 'ml', 100)", [s, PRODUCT, code()]);
  }
  for (const s of [S1, S2]) await one(OWNER, "select app.owner_set_sku_price($1, $2, 'dummy price list')", [s, PRICE]);
  await one(MANAGER, "select app.office_create_location($1, 'warehouse', '[Test] Main store')", [WH]);
  await one(OWNER, "select app.office_create_location($1, 'rep_bag', '[Test] Bag A', $2, 2000000)", [BAG_A, fx.repA.id]);
  await one(OWNER, "select app.office_create_location($1, 'rep_bag', '[Test] Bag B', $2, 150000)", [BAG_B, fx.repB.id]);
});

describe("catalogue and prices (INV-01)", () => {
  it("the manager structures the catalogue; only the owner sets prices (governance, doc 06 §2)", async () => {
    expect(await sqlstate(MANAGER, "select app.owner_set_sku_price($1, 1, 'try')", [S1])).toBe("42501");
    expect(await sqlstate(REP_A, "select app.office_upsert_sku($1, $2, $3, 'x', 'ml')", [id(), PRODUCT, code()])).toBe("42501");
    expect(await sqlstate(MANAGER_AAL1, "select app.office_upsert_sku($1, $2, $3, 'x', 'ml')", [id(), PRODUCT, code()])).toBe("42501");
    expect(await sqlstate(OWNER, "select app.owner_set_sku_price($1, 1, 'x')", [S1])).toBe("23514"); // reason too short
  });

  it("a rep bag must belong to an active rep and carry a value limit", async () => {
    expect(await sqlstate(OWNER, "select app.office_create_location($1, 'rep_bag', 'x bag', $2, 1000)", [id(), fx.manager.id])).toBe("22023");
    expect(await sqlstate(OWNER, "select app.office_create_location($1, 'rep_bag', 'x bag', $2)", [id(), fx.repA.id])).not.toBeNull();
  });

  it("only the owner creates rep bags and changes their value limit (A-08)", async () => {
    expect(await errorOf(MANAGER, "select app.office_create_location($1, 'rep_bag', 'x bag', $2, 9999999)", [id(), fx.repB.id])).toMatch(/owner/);
    expect(await sqlstate(MANAGER, "select app.owner_set_bag_limit($1, 99999999, 'raise it')", [BAG_A])).toBe("42501");
    expect(await sqlstate(OWNER_AAL1, "select app.owner_set_bag_limit($1, 99999999, 'raise it')", [BAG_A])).toBe("42501");
    const b = await one(OWNER, "select (app.owner_set_bag_limit($1, 2000000, 'probation over')).bag_value_limit_paisa l", [BAG_A]);
    expect(Number(b.l)).toBe(2000000);
  });
});

describe("adjustments need an approval, used once, owner above the threshold (doc 13 §9)", () => {
  it("opening stock goes in only through an approved adjustment", async () => {
    const appr = await approvedAdjustment(S1, 50, MANAGER, OWNER, "owner");
    const mv = await one(MANAGER, "select (app.office_post_adjustment($1, $2)).*", [id(), appr]);
    expect(mv.kind).toBe("adjustment");
    expect(await onHand(WH, S1)).toBe(50);
    // Single use: the same approval cannot post a second movement.
    expect(await errorOf(MANAGER, "select app.office_post_adjustment($1, $2)", [id(), appr])).toMatch(/already been used/);
    await approvedAdjustment(S2, 20, MANAGER, OWNER, "owner").then((a) => one(MANAGER, "select app.office_post_adjustment($1, $2)", [id(), a]));
    expect(await onHand(WH, S2)).toBe(20);
  });

  it("above the owner threshold a manager's approval is refused at posting, even if the maker asked for a manager", async () => {
    // 20 units > 10 units (approval.stock_adjustment.owner_above): needs the owner.
    const big = await approvedAdjustment(S1, 20, OWNER, MANAGER, "manager");
    expect(await errorOf(MANAGER, "select app.office_post_adjustment($1, $2)", [id(), big])).toMatch(/needs the owner/);
    // 5 units × Rs 1,000 = Rs 5,000: within the manager's authority.
    const small = await approvedAdjustment(S1, 5, OWNER, MANAGER, "manager");
    await one(MANAGER, "select app.office_post_adjustment($1, $2)", [id(), small]);
    expect(await onHand(WH, S1)).toBe(55);
  });

  it("an unpriced SKU's adjustment always needs the owner; a pending or wrong-kind request posts nothing", async () => {
    const unpriced = await approvedAdjustment(UNPRICED, 1, OWNER, MANAGER, "manager");
    expect(await errorOf(MANAGER, "select app.office_post_adjustment($1, $2)", [id(), unpriced])).toMatch(/needs the owner/);
    const pending = await one(MANAGER, "select (app.request_approval($1, 'adjustment', 'stock_location', $2, $3, 'pending one')).id",
      [id(), WH, JSON.stringify({ sku_id: S1, qty_delta: 1 })]);
    expect(await errorOf(OWNER, "select app.office_post_adjustment($1, $2)", [id(), pending.id])).toMatch(/not approved/);
    const wrong = await one(MANAGER, "select (app.request_approval($1, 'write_off', 'stock_location', $2, $3, 'wrong kind')).id",
      [id(), WH, JSON.stringify({ sku_id: S1, qty_delta: 1 })]);
    await one(OWNER, "select app.decide_approval($1, true, 'approved anyway')", [wrong.id]);
    expect(await errorOf(MANAGER, "select app.office_post_adjustment($1, $2)", [id(), wrong.id])).toMatch(/approved stock adjustment/);
  });

  it("reps cannot request or post adjustments", async () => {
    expect(await sqlstate(REP_A, "select app.request_approval($1, 'adjustment', 'stock_location', $2, '{}', 'rep tries')", [id(), WH])).toBe("42501");
    expect(await sqlstate(REP_A, "select app.office_post_adjustment($1, $2)", [id(), id()])).toBe("42501");
  });
});

describe("two-party issue to a rep bag (CTL-05)", () => {
  let issue: string;

  it("nothing moves until the rep confirms; pending units are reserved", async () => {
    const r = await one(MANAGER, "select (app.office_propose_stock_issue($1, 'to_rep', $2, $3, $4, current_date + 1)).*",
      [id(), WH, BAG_A, JSON.stringify([{ sku_id: S1, qty: 6 }, { sku_id: S1, qty: 4 }])]);
    issue = r.id;
    expect(r.status).toBe("pending");
    expect(r.lines).toEqual([{ sku_id: S1, qty: 10 }]); // duplicates summed
    expect(await onHand(BAG_A, S1)).toBe(0);
    expect(await onHand(WH, S1)).toBe(55);
    const avail = (await run(REP_A, "select available from app.warehouse_availability() where sku_id = $1", [S1])).rows[0];
    expect(Number(avail.available)).toBe(45);
  });

  it("another rep cannot confirm it, nor can the office", async () => {
    expect(await errorOf(REP_B, "select app.rep_confirm_stock_issue($1, $2)", [issue, JSON.stringify([{ sku_id: S1, qty: 10 }])])).toMatch(/not for your bag/);
    expect(await sqlstate(MANAGER, "select app.rep_confirm_stock_issue($1, $2)", [issue, JSON.stringify([{ sku_id: S1, qty: 10 }])])).toBe("42501");
    expect(await sqlstate(REP_A_WRONG_DEVICE, "select app.rep_confirm_stock_issue($1, $2)", [issue, JSON.stringify([{ sku_id: S1, qty: 10 }])])).toBe("42501");
  });

  it("a matching count moves the stock; a replay changes nothing", async () => {
    const r = await one(REP_A, "select (app.rep_confirm_stock_issue($1, $2)).*", [issue, JSON.stringify([{ sku_id: S1, qty: 10 }])]);
    expect(r.status).toBe("confirmed");
    expect(r.decided_by).toBe(fx.repA.id);
    expect(await onHand(BAG_A, S1)).toBe(10);
    expect(await onHand(WH, S1)).toBe(45);
    await one(REP_A, "select app.rep_confirm_stock_issue($1, $2)", [issue, JSON.stringify([{ sku_id: S1, qty: 10 }])]);
    expect(await onHand(BAG_A, S1)).toBe(10);
    const mine = (await run(REP_A, "select sku_id, on_hand from app.my_bag()")).rows;
    expect(mine.map((m) => [m.sku_id, Number(m.on_hand)])).toEqual([[S1, 10]]);
  });

  it("a different count disputes the issue and moves nothing; the office then cancels it", async () => {
    const p = await one(MANAGER, "select (app.office_propose_stock_issue($1, 'to_rep', $2, $3, $4)).id",
      [id(), WH, BAG_A, JSON.stringify([{ sku_id: S2, qty: 5 }])]);
    const r = await one(REP_A, "select (app.rep_confirm_stock_issue($1, $2)).status", [p.id, JSON.stringify([{ sku_id: S2, qty: 4 }])]);
    expect(r.status).toBe("disputed");
    expect(await onHand(BAG_A, S2)).toBe(0);
    expect(await sqlstate(MANAGER, "select app.office_cancel_stock_issue($1, 'x')", [p.id])).toBe("23514");
    const c = await one(OWNER, "select (app.office_cancel_stock_issue($1, 'recount at the counter')).status", [p.id]);
    expect(c.status).toBe("cancelled");
    expect(await errorOf(REP_A, "select app.rep_confirm_stock_issue($1, $2)", [p.id, JSON.stringify([{ sku_id: S2, qty: 5 }])])).toMatch(/already decided/);
  });

  it("the bag value limit and warehouse availability cap every issue", async () => {
    // Bag B limit Rs 1,500: two units at Rs 1,000 exceed it.
    expect(await errorOf(MANAGER, "select app.office_propose_stock_issue($1, 'to_rep', $2, $3, $4)",
      [id(), WH, BAG_B, JSON.stringify([{ sku_id: S1, qty: 2 }])])).toMatch(/bag value limit exceeded/);
    expect(await errorOf(MANAGER, "select app.office_propose_stock_issue($1, 'to_rep', $2, $3, $4)",
      [id(), WH, BAG_A, JSON.stringify([{ sku_id: S1, qty: 1000 }])])).toMatch(/insufficient available stock/);
    expect(await errorOf(MANAGER, "select app.office_propose_stock_issue($1, 'to_rep', $2, $3, $4)",
      [id(), WH, BAG_A, JSON.stringify([{ sku_id: UNPRICED, qty: 1 }])])).toMatch(/priced SKUs/);
    expect(await sqlstate(MANAGER, "select app.office_propose_stock_issue($1, 'to_rep', $2, $3, $4)",
      [id(), WH, BAG_A, JSON.stringify([{ sku_id: S1, qty: 1.5 }])])).toBe("22023");
    expect(await sqlstate(REP_A, "select app.office_propose_stock_issue($1, 'to_rep', $2, $3, $4)",
      [id(), WH, BAG_A, JSON.stringify([{ sku_id: S1, qty: 1 }])])).toBe("42501");
  });

  it("stock returns to the warehouse only when the rep confirms the same count", async () => {
    const p = await one(MANAGER, "select (app.office_propose_stock_issue($1, 'to_warehouse', $2, $3, $4)).id",
      [id(), WH, BAG_A, JSON.stringify([{ sku_id: S1, qty: 3 }])]);
    expect(await onHand(BAG_A, S1)).toBe(10);
    await one(REP_A, "select app.rep_confirm_stock_issue($1, $2)", [p.id, JSON.stringify([{ sku_id: S1, qty: 3 }])]);
    expect(await onHand(BAG_A, S1)).toBe(7);
    expect(await onHand(WH, S1)).toBe(48);
  });
});

describe("counts (INV-05, CTL-05)", () => {
  it("the rep's daily close records the variance and never changes stock", async () => {
    const r = await one(REP_A, "select (app.record_count($1, $2, 'daily_close', $3)).*", [id(), BAG_A, JSON.stringify([{ sku_id: S1, qty: 6 }])]);
    expect(r.variance_units).toBe(1);
    expect(r.lines).toEqual([{ sku_id: S1, expected: 7, counted: 6 }]);
    expect(await onHand(BAG_A, S1)).toBe(7);
    const empty = await one(REP_A, "select (app.record_count($1, $2, 'daily_close', '[]')).variance_units v", [id(), BAG_A]);
    expect(empty.v).toBe(7);
  });

  it("reps count only their own bag's daily close; the office spot-checks; nobody else closes for the rep", async () => {
    expect(await sqlstate(REP_B, "select app.record_count($1, $2, 'daily_close', '[]')", [id(), BAG_A])).toBe("42501");
    expect(await sqlstate(REP_A, "select app.record_count($1, $2, 'spot_check', '[]')", [id(), BAG_A])).toBe("42501");
    expect(await sqlstate(MANAGER, "select app.record_count($1, $2, 'daily_close', '[]')", [id(), BAG_A])).toBe("42501");
    const s = await one(MANAGER, "select (app.record_count($1, $2, 'spot_check', $3)).variance_units v", [id(), BAG_A, JSON.stringify([{ sku_id: S1, qty: 7 }])]);
    expect(s.v).toBe(0);
    // Reps do not see spot checks of their bag (office only).
    const seen = (await run(REP_A, "select kind from public.stock_count where location_id = $1", [BAG_A])).rows.map((x) => x.kind);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((k) => k === "daily_close")).toBe(true);
  });
});

describe("lost demand (DEM-01, D-18)", () => {
  const tap = id();
  it("a rep records demand it could not serve; a replay returns the same row; different content is refused", async () => {
    const a = await one(REP_A, "select (app.record_demand($1, $2, null, 3, 'not_in_bag')).*", [tap, S2]);
    expect(a.source).toBe("visit_tap");
    expect(a.location_id).toBe(BAG_A);
    const b = await one(REP_A, "select (app.record_demand($1, $2, null, 3, 'not_in_bag')).id", [tap, S2]);
    expect(b.id).toBe(a.id);
    expect(await sqlstate(REP_A, "select app.record_demand($1, $2, null, 4, 'not_in_bag')", [tap, S2])).toBe("23505");
    expect(await sqlstate(REP_B, "select app.record_demand($1, $2, null, 3, 'not_in_bag')", [tap, S2])).toBe("23505");
  });

  it("an item Kiran does not carry is recorded by product group, never as free text (H-27)", async () => {
    const g = await one(REP_A, "select (app.record_demand($1, null, $2, 2, 'not_in_catalogue')).product_group_id g", [id(), OTHER_GROUP]);
    expect(g.g).toBe(OTHER_GROUP);
    expect(await sqlstate(REP_A, "select app.record_demand($1, $2, null, 2, 'not_in_catalogue')", [id(), S1])).toBe("23514");
    expect(await sqlstate(REP_A, "select app.record_demand($1, null, null, 2, 'out_of_stock')", [id()])).toBe("23514");
  });

  it("supply shortages are recorded by the office, not reps; blocked sessions record nothing", async () => {
    expect(await sqlstate(REP_A, "select app.record_demand($1, $2, null, 1, 'supply_short')", [id(), S1])).toBe("42501");
    await one(MANAGER, "select app.record_demand($1, $2, null, 40, 'supply_short')", [id(), S1]);
    expect(await sqlstate(REP_A_WRONG_DEVICE, "select app.record_demand($1, $2, null, 1, 'out_of_stock')", [id(), S1])).toBe("42501");
    expect(await sqlstate(SUSPENDED, "select app.record_demand($1, $2, null, 1, 'out_of_stock')", [id(), S1])).toBe("42501");
  });

  it("each rep sees only its own records; the office sees all", async () => {
    const b = (await run(REP_B, "select count(*) n from public.demand_signal where client_id = $1", [tap])).rows[0];
    expect(Number(b.n)).toBe(0);
    const m = (await run(MANAGER, "select count(*) n from public.demand_signal where client_id = $1", [tap])).rows[0];
    expect(Number(m.n)).toBe(1);
  });
});

describe("reads and reorder points (INV-04, INV-06)", () => {
  it("a rep sees its own bag's movements only", async () => {
    const b = (await run(REP_B, "select count(*) n from public.stock_movement where to_location_id = $1 or from_location_id = $1", [BAG_A])).rows[0];
    expect(Number(b.n)).toBe(0);
    const a = (await run(REP_A, "select count(*) n from public.stock_movement where to_location_id = $1 or from_location_id = $1", [BAG_A])).rows[0];
    expect(Number(a.n)).toBe(2);
    expect((await run(REP_B, "select * from app.my_bag()")).rows).toEqual([]);
  });

  it("office stock views; low stock against manual reorder points; reps cannot call them", async () => {
    await one(MANAGER, "select app.office_set_reorder_point($1, 100)", [S1]);
    await one(MANAGER, "select app.office_set_reorder_point($1, 5)", [S2]);
    const low = (await run(MANAGER, "select sku_id, on_hand, reorder_point from app.low_stock() where sku_id in ($1, $2)", [S1, S2])).rows;
    expect(low.map((l) => [l.sku_id, Number(l.on_hand), l.reorder_point])).toEqual([[S1, 55, 100]]);
    const wh = (await run(MANAGER, "select sku_id, on_hand from app.stock_on_hand($1) order by sku_id", [WH])).rows;
    expect(Object.fromEntries(wh.map((w) => [w.sku_id, Number(w.on_hand)]))).toEqual({ [S1]: 48, [S2]: 20 });
    expect(await sqlstate(REP_A, "select * from app.stock_on_hand()")).toBe("42501");
    expect(await sqlstate(REP_A, "select * from app.low_stock()")).toBe("42501");
  });

  it("the audit chain still verifies after all of the above (H-17)", async () => {
    const r = (await run("postgres", "select ok from control.verify_audit_chain()")).rows[0];
    expect(r.ok).toBe(true);
  });
});

describe("stock integrity in the schema (doc 10 §3, H-06); runs last so every table has rows", () => {
  it("no movement may leave a location below zero, whoever inserts it", async () => {
    expect(await errorOf("postgres", `insert into public.stock_movement (client_id, sku_id, qty, from_location_id, kind, actor_id)
      values ($1, $2, 8, $3, 'sale', $4)`, [id(), S1, BAG_A, fx.manager.id])).toMatch(/insufficient stock: 7 on hand, 8 requested/);
    expect(await sqlstate("postgres", `insert into public.stock_movement (client_id, sku_id, qty, from_location_id, kind, actor_id)
      values ($1, $2, 7, $3, 'sale', $4)`, [id(), S1, BAG_A, fx.manager.id])).toBeNull(); // rolled back
  });

  it("an adjustment movement without an approval is refused by the schema", async () => {
    expect(await sqlstate("postgres", `insert into public.stock_movement (client_id, sku_id, qty, to_location_id, kind, actor_id)
      values ($1, $2, 1, $3, 'adjustment', $4)`, [id(), S1, WH, fx.manager.id])).toBe("23514");
  });

  it("movements, counts and lost demand are append-only for every role, including postgres", async () => {
    for (const t of ["public.stock_movement", "public.stock_count", "public.demand_signal"]) {
      expect(await sqlstate("postgres", `update ${t} set created_at = created_at`), t).toBe("42501");
      expect(await sqlstate("postgres", `delete from ${t}`), t).toBe("42501");
      expect(await sqlstate("postgres", `truncate ${t} cascade`), t).toBe("42501");
    }
    expect(await sqlstate("postgres", "delete from public.stock_issue")).toBe("42501");
    expect(await sqlstate("postgres", "update public.stock_issue set status = 'pending' where status = 'confirmed'")).toBe("42501");
    expect(await sqlstate("postgres", "delete from public.sku")).toBe("42501");
    expect(await sqlstate("postgres", "update public.stock_location set owner_user_id = null where kind = 'rep_bag'")).toBe("42501");
  });
});
