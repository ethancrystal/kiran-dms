/**
 * app.my_issue_skus (migration 20261106040000, REP-14 / L1): the SKU names a rep needs for the
 * pending stock issues of its own bag, including a SKU the office has deactivated since.
 *
 * Steps that need several personas commit (one persona per transaction, like the real app); every
 * id is fresh, so committed rows never collide with other files.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import {
  fx,
  MANAGER,
  MANAGER_AAL1,
  OWNER,
  REP_A,
  REP_A_WRONG_DEVICE,
  REP_B,
  run,
  SUSPENDED,
  sqlstate,
  type Who,
} from "./helpers/db";

const C = { commit: true };
const id = () => randomUUID();
const CODE_SUFFIX = 8;
const code = () => `T-${randomUUID().slice(0, CODE_SUFFIX).toUpperCase()}`;
/** Runs one async step per item, in order (the steps commit, so they must not interleave). */
const inOrder = <T>(items: T[], step: (item: T) => Promise<unknown>) =>
  items.reduce<Promise<unknown>>((done, item) => done.then(() => step(item)), Promise.resolve());

const GROUP = id(),
  PRODUCT = id(),
  ACTIVE_SKU = id(),
  DEACTIVATED_SKU = id(),
  UNRELATED_SKU = id();
const WH = id(),
  BAG_A = id(),
  BAG_B = id();
const CODES = { active: code(), deactivated: code(), unrelated: code() };
const PRICE = 100_000; // Rs 1,000 per unit, in paisa
const STOCK = 5;
const ISSUED = 3;

const one = async (who: Who, sql: string, params: unknown[] = []) => (await run(who, sql, params, C)).rows[0];

/** Opening stock goes in only through an approved adjustment (maker requests, checker decides, office posts). */
async function openingStock(sku: string, units: number) {
  const req = await one(
    MANAGER,
    "select (app.request_approval($1, 'adjustment', 'stock_location', $2, $3, $4, 'owner'::public.app_role)).id",
    [id(), WH, JSON.stringify({ sku_id: sku, qty_delta: units }), "[Test] opening stock"],
  );
  await one(OWNER, "select app.decide_approval($1, true, 'counted and checked')", [req.id]);
  await one(MANAGER, "select app.office_post_adjustment($1, $2)", [id(), req.id]);
}

const names = async (who: Who) => (await run(who, "select sku_id, code, variant from app.my_issue_skus() order by code")).rows;

beforeAll(async () => {
  await one(MANAGER, "select app.office_upsert_product_group($1, $2, 21)", [GROUP, `[Dummy] Color ${code()}`]);
  await one(MANAGER, "select app.office_upsert_product($1, $2, '[Dummy] Kiran', '[Dummy] Permanent Color')", [PRODUCT, GROUP]);
  const skus: [string, string][] = [
    [ACTIVE_SKU, CODES.active],
    [DEACTIVATED_SKU, CODES.deactivated],
    [UNRELATED_SKU, CODES.unrelated],
  ];
  await inOrder(skus, async ([s, c]) => {
    await one(MANAGER, "select app.office_upsert_sku($1, $2, $3, '[Dummy] shade', 'ml', 100)", [s, PRODUCT, c]);
    await one(OWNER, "select app.owner_set_sku_price($1, $2, 'dummy price list')", [s, PRICE]);
  });
  await one(MANAGER, "select app.office_create_location($1, 'warehouse', '[Test] Main store')", [WH]);
  await one(OWNER, "select app.office_create_location($1, 'rep_bag', '[Test] Bag A', $2, 2000000)", [BAG_A, fx.repA.id]);
  await one(OWNER, "select app.office_create_location($1, 'rep_bag', '[Test] Bag B', $2, 2000000)", [BAG_B, fx.repB.id]);
  await openingStock(ACTIVE_SKU, STOCK);
  await openingStock(DEACTIVATED_SKU, STOCK);
  await openingStock(UNRELATED_SKU, STOCK);
  // A pending issue to rep A names two SKUs; a pending issue to rep B names the unrelated one.
  await one(MANAGER, "select app.office_propose_stock_issue($1, 'to_rep', $2, $3, $4)", [
    id(),
    WH,
    BAG_A,
    JSON.stringify([
      { sku_id: ACTIVE_SKU, qty: ISSUED },
      { sku_id: DEACTIVATED_SKU, qty: ISSUED },
    ]),
  ]);
  await one(MANAGER, "select app.office_propose_stock_issue($1, 'to_rep', $2, $3, $4)", [
    id(),
    WH,
    BAG_B,
    JSON.stringify([{ sku_id: UNRELATED_SKU, qty: ISSUED }]),
  ]);
  // The office deactivates one of rep A's SKUs while the issue still waits for the rep's count.
  await one(MANAGER, "select app.office_upsert_sku($1, $2, $3, '[Dummy] shade', 'ml', 100, null, null, false)", [
    DEACTIVATED_SKU,
    PRODUCT,
    CODES.deactivated,
  ]);
});

describe("app.my_issue_skus (REP-14, L1)", () => {
  it("the rep cannot read a deactivated SKU from the table, which is why the function exists", async () => {
    const direct = await run(REP_A, "select id from public.sku where id = $1", [DEACTIVATED_SKU]);
    expect(direct.rows).toEqual([]);
  });

  it("names every SKU of the rep's own pending issue, the deactivated one included, and nothing else", async () => {
    const got = await names(REP_A);
    expect(got.map((r) => [r.sku_id, r.code]).sort()).toEqual(
      [
        [ACTIVE_SKU, CODES.active],
        [DEACTIVATED_SKU, CODES.deactivated],
      ].sort(),
    );
    // Only id, code and variant: no quantity and no price leave through this function.
    expect(Object.keys(got[0]).sort()).toEqual(["code", "sku_id", "variant"]);
  });

  it("another rep sees only the SKUs of its own bag's issue, never rep A's", async () => {
    const got = await names(REP_B);
    expect(got.map((r) => r.sku_id)).toEqual([UNRELATED_SKU]);
  });

  it("the office reads the table directly and is given no rows here; a manager at AAL1 neither", async () => {
    expect(await names(MANAGER)).toEqual([]);
    expect(await names(MANAGER_AAL1)).toEqual([]);
  });

  it("is refused to anonymous, to an unapproved phone and to a suspended rep", async () => {
    expect(await sqlstate("anon", "select * from app.my_issue_skus()")).toBe("42501");
    expect(await names(REP_A_WRONG_DEVICE)).toEqual([]);
    expect(await names(SUSPENDED)).toEqual([]);
  });

  it("a settled issue no longer names its SKUs", async () => {
    // Cancel rep A's pending issue; nothing is pending any more.
    const pending = await run("postgres", "select id from public.stock_issue where bag_id = $1 and status = 'pending'", [BAG_A]);
    await inOrder(pending.rows, (row) => one(MANAGER, "select app.office_cancel_stock_issue($1, 'no longer needed')", [row.id]));
    expect(await names(REP_A)).toEqual([]);
  });
});
