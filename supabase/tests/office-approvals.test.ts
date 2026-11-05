/**
 * Slice 8 (P1-25), migration 20261105170000: app.office_pending_approvals, the office approvals queue.
 * The browser cannot read control.approval_request (the control schema is not exposed, B-18), so this
 * one read lists pending discount and adjustment requests and approved, unused adjustments on a
 * warehouse or a bag, with allow-listed fields only. Writes stay the existing functions; this file also
 * pins the paths the new screens use (decide, recheck, post) as real signed-in roles. Synthetic data.
 */
import { beforeAll, describe, expect, it } from "vitest";
import {
  fx,
  MANAGER,
  MANAGER_AAL1,
  OWNER,
  OWNER_AAL1,
  REP_A,
  REP_A_WRONG_DEVICE,
  REP_B,
  run,
  SUSPENDED,
  sqlstate,
  type Who,
} from "./helpers/db";
import { asLoginCode, newLogin, tag, uuid } from "./helpers/invite";

const C = { commit: true };
const DENIED = "42501";
const UNIT = 100_000; // Rs 1,000 list price, paisa
const DISCOUNTED = 95_000; // Rs 950: a 5% discount, under the 10% / Rs 5,000 owner threshold, so a manager checks it
const QTY = 2;
const CYCLE_DAYS = 30;
const OPENING_UNITS = 5; // 5 x Rs 1,000 = Rs 5,000: under the adjustment threshold (10 units, Rs 10,000)
const LIMIT = 200;
// A key the request's payload carries that the queue must never return.
const PAYLOAD_SECRET = "[Test] approvals-secret payload value";

const KEYS = [
  "checker_role_required",
  "created_at",
  "discount_paisa",
  "kind",
  "location_kind",
  "location_name",
  "made_by_me",
  "maker_name",
  "order_status",
  "qty_delta",
  "reason",
  "request_id",
  "salon_id",
  "salon_name",
  "sku_code",
  "sku_id",
  "status",
  "subject_id",
  "subject_type",
  "subtotal_paisa",
  "total_paisa",
];

const T = uuid(),
  AREA = uuid(),
  GROUP = uuid(),
  PRODUCT = uuid(),
  SKU = uuid(),
  SALON = uuid(),
  WAREHOUSE = uuid();
const SALON_NAME = `[Test] Approvals salon ${tag()}`;
const WAREHOUSE_NAME = `[Test] Approvals warehouse ${tag()}`;
let skuCode = "";

type Row = Record<string, unknown>;
const queue = async (who: Who) => (await run(who, "select * from app.office_pending_approvals()")).rows as Row[];
const byId = async (who: Who, id: string) => (await queue(who)).find((r) => r.request_id === id);

/** A manager's office order for SALON with a unit price below list: a draft held for a discount approval. */
async function discountedOrder() {
  const lines = JSON.stringify([{ sku_id: SKU, qty: QTY, unit_price_paisa: DISCOUNTED }]);
  const o = (
    await run(
      MANAGER,
      "select (o).id, (o).status, (o).hold_discount, (o).discount_approval_id from app.office_create_order($1, $2, 'CASH', $3::jsonb, null, null) o",
      [uuid(), SALON, lines],
      C,
    )
  ).rows[0];
  return o as { id: string; status: string; hold_discount: string | null; discount_approval_id: string };
}

/** The manager asks for opening stock in the warehouse (an adjustment request on the location). */
async function openingRequest(units = OPENING_UNITS) {
  const r = await run(
    MANAGER,
    "select (app.request_approval($1, 'adjustment', 'stock_location', $2, $3::jsonb, '[Test] opening stock')).id",
    [uuid(), WAREHOUSE, JSON.stringify({ sku_id: SKU, qty_delta: units, note: PAYLOAD_SECRET })],
    C,
  );
  return r.rows[0].id as string;
}

beforeAll(async () => {
  await run(MANAGER, "select app.office_upsert_territory($1, $2)", [T, `[Test] Approvals ${tag()}`], C);
  await run(MANAGER, "select app.office_upsert_area($1, $2, '[Test] Approvals area')", [AREA, T], C);
  await run(MANAGER, "select app.office_upsert_product_group($1, $2, $3)", [GROUP, `[Test] Approvals ${tag()}`, CYCLE_DAYS], C);
  await run(
    MANAGER,
    "select app.office_upsert_product($1, $2, '[Dummy] Kiran', '[Dummy] Approvals colour', true, '[Dummy] A test shade.')",
    [PRODUCT, GROUP],
    C,
  );
  skuCode = `T-AP-${tag().toUpperCase()}`;
  await run(MANAGER, "select app.office_upsert_sku($1, $2, $3, '[Dummy] shade', 'ml', 100)", [SKU, PRODUCT, skuCode], C);
  await run(MANAGER, "select app.office_set_sku_price($1, $2, $3, '[Test] approvals list price')", [uuid(), SKU, UNIT], C);
  await run(MANAGER, "select app.create_salon($1, $2, 'unisex', $3, 'map_pin')", [SALON, SALON_NAME, AREA], C);
  await run(MANAGER, "select app.office_create_location($1, 'warehouse', $2)", [WAREHOUSE, WAREHOUSE_NAME], C);
});

describe("app.office_pending_approvals: who may read it", () => {
  const refused: Array<[string, Who]> = [
    ["anon", "anon"],
    ["rep A", REP_A],
    ["rep B", REP_B],
    ["rep A on a wrong device", REP_A_WRONG_DEVICE],
    ["a suspended rep", SUSPENDED],
    ["manager without MFA", MANAGER_AAL1],
    ["owner without MFA", OWNER_AAL1],
  ];
  it.each(refused)("%s is refused (42501)", async (_n, who) => {
    expect(await sqlstate(who, "select * from app.office_pending_approvals()")).toBe(DENIED);
  });

  it("a salon login and a login with nothing redeemed are refused (42501)", async () => {
    const l = await newLogin();
    expect(await asLoginCode(l, "select * from app.office_pending_approvals();")).toBe(DENIED);
  });

  it("the manager and the owner may read it; the fields are the allow-list", async () => {
    const id = await openingRequest();
    const rows = await queue(MANAGER);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThanOrEqual(LIMIT);
    expect(Object.keys(rows[0]).sort()).toEqual(KEYS);
    expect(await byId(OWNER, id)).toBeDefined();
    // Cleared so later tests see only their own requests as pending from this warehouse.
    await run(MANAGER, "select app.cancel_approval($1, '[Test] done')", [id], C);
  });
});

describe("discount approvals", () => {
  it("a held order is listed with the order's own figures; the maker is flagged and cannot approve", async () => {
    const o = await discountedOrder();
    expect(o.status).toBe("draft");
    expect(o.hold_discount).toBe("pending");
    const mine = await byId(MANAGER, o.discount_approval_id);
    expect(mine).toMatchObject({
      kind: "discount",
      status: "pending",
      subject_type: "sales_order",
      subject_id: o.id,
      made_by_me: true,
      maker_name: "[Test] Manager",
      checker_role_required: "manager",
      order_status: "draft",
      salon_id: SALON,
      salon_name: SALON_NAME,
      location_name: null,
      sku_code: null,
      qty_delta: null,
    });
    expect(Number(mine?.subtotal_paisa)).toBe(UNIT * QTY);
    expect(Number(mine?.discount_paisa)).toBe((UNIT - DISCOUNTED) * QTY);
    expect(Number(mine?.total_paisa)).toBe(DISCOUNTED * QTY);
    expect((await byId(OWNER, o.discount_approval_id))?.made_by_me).toBe(false);
    // Maker != checker (H-12): the manager's own approval is refused and nothing changes.
    expect(await sqlstate(MANAGER, "select app.decide_approval($1, true, '[Test] mine')", [o.discount_approval_id])).toBe(DENIED);
  });

  it("the owner approves, the order still reads draft until rechecked, then confirms; the row leaves the queue", async () => {
    const o = await discountedOrder();
    await run(OWNER, "select app.decide_approval($1, true, '[Test] checked the price')", [o.discount_approval_id], C);
    // decide_approval re-runs nothing: the page must recheck the order (app.recheck_order).
    const before = (await run("postgres", "select status from public.sales_order where id = $1", [o.id])).rows[0];
    expect(before.status).toBe("draft");
    expect(await byId(OWNER, o.discount_approval_id)).toBeUndefined();
    const after = (await run(OWNER, "select (app.recheck_order($1)).status", [o.id], C)).rows[0];
    expect(after.status).toBe("confirmed");
  });

  it("a refused discount leaves the queue and the order stays held (rejected)", async () => {
    const o = await discountedOrder();
    await run(OWNER, "select app.decide_approval($1, false, '[Test] too low')", [o.discount_approval_id], C);
    expect(await byId(MANAGER, o.discount_approval_id)).toBeUndefined();
    const r = (await run(MANAGER, "select (app.recheck_order($1)).*", [o.id], C)).rows[0];
    expect(r.status).toBe("draft");
    expect(r.hold_discount).toBe("rejected");
  });

  it("reps cannot decide or recheck an office order", async () => {
    const o = await discountedOrder();
    expect(await sqlstate(REP_A, "select app.decide_approval($1, true, '[Test] rep')", [o.discount_approval_id])).toBe(DENIED);
    expect(await sqlstate(REP_A, "select app.recheck_order($1)", [o.id])).toBe(DENIED);
  });
});

describe("adjustment approvals (opening stock on the Stock page)", () => {
  it("a pending request shows the location, SKU and quantity, never the payload's other keys", async () => {
    const id = await openingRequest();
    const row = await byId(OWNER, id);
    expect(row).toMatchObject({
      kind: "adjustment",
      status: "pending",
      subject_type: "stock_location",
      subject_id: WAREHOUSE,
      location_name: WAREHOUSE_NAME,
      location_kind: "warehouse",
      sku_id: SKU,
      sku_code: skuCode,
      made_by_me: false,
      order_status: null,
      salon_name: null,
    });
    expect(Number(row?.qty_delta)).toBe(OPENING_UNITS);
    const text = JSON.stringify(await queue(OWNER));
    expect(text).not.toContain(PAYLOAD_SECRET);
    await run(MANAGER, "select app.cancel_approval($1, '[Test] done')", [id], C);
  });

  it("approved by another office user, it stays listed as approved until posted, then leaves; stock arrives once", async () => {
    const id = await openingRequest();
    await run(OWNER, "select app.decide_approval($1, true, '[Test] counted')", [id], C);
    expect((await byId(MANAGER, id))?.status).toBe("approved");
    const key = uuid();
    await run(MANAGER, "select app.office_post_adjustment($1, $2)", [key, id], C);
    // A replay with the same key returns the same movement and posts nothing new.
    await run(MANAGER, "select app.office_post_adjustment($1, $2)", [key, id], C);
    expect(await byId(MANAGER, id)).toBeUndefined();
    const onHand = (await run(MANAGER, "select on_hand from app.stock_on_hand($1) where sku_id = $2", [WAREHOUSE, SKU])).rows[0];
    expect(Number(onHand.on_hand)).toBe(OPENING_UNITS);
    // A second post with a new key is refused: an approval is used once.
    expect(await sqlstate(MANAGER, "select app.office_post_adjustment($1, $2)", [uuid(), id])).toBe(DENIED);
  });

  it("cancelled and refused requests are not listed", async () => {
    const a = await openingRequest();
    await run(MANAGER, "select app.cancel_approval($1, '[Test] typo')", [a], C);
    const b = await openingRequest();
    await run(OWNER, "select app.decide_approval($1, false, '[Test] not counted')", [b], C);
    expect(await byId(MANAGER, a)).toBeUndefined();
    expect(await byId(MANAGER, b)).toBeUndefined();
  });
});

describe("integrity", () => {
  it("reading writes no audit row", async () => {
    const head = async () => (await run("postgres", "select max(seq)::text s from control.audit_event")).rows[0].s;
    const before = await head();
    await queue(MANAGER);
    await queue(OWNER);
    expect(await head()).toBe(before);
  });

  it("is security definer with an empty search_path and granted to authenticated only", async () => {
    const r = (
      await run(
        "postgres",
        `select p.prosecdef, p.proconfig, has_function_privilege('anon', p.oid, 'execute') anon,
                has_function_privilege('authenticated', p.oid, 'execute') auth
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'app' and p.proname = 'office_pending_approvals'`,
      )
    ).rows[0];
    expect(r.prosecdef).toBe(true);
    expect(r.proconfig).toContain('search_path=""');
    expect(r.anon).toBe(false);
    expect(r.auth).toBe(true);
    expect(fx.manager.id).toBeTruthy();
  });
});
