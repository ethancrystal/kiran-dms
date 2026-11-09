/**
 * app.my_pending_issues (migration 20261107010000, REP-05 / CTL-05): the rep's stock count stays blind.
 * The rep reads its pending issues through the function, which names the SKUs to count and never a
 * quantity, and no longer reads public.stock_issue directly.
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
const WH = id();
// One bag per rep: other files share this database and may have made it already, so create it only
// if absent and look the id up (the same approach as audit-fixes.test.ts).
let BAG_A = "",
  BAG_B = "";
let ISSUE_A = "";
const CODES = { active: code(), deactivated: code(), unrelated: code() };
// Rs 100 per unit, in paisa: three units stay far below the smallest bag limit another file may have set (Rs 1,500).
const PRICE = 10_000;
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

const pending = async (who: Who) =>
  (await run(who, "select id, direction, decision_note, created_at, sku_ids from app.my_pending_issues() order by created_at"))
    .rows;

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
  const bagOf = async (rep: string, name: string) => {
    await one(
      OWNER,
      "select app.office_create_location($1, 'rep_bag', $3, $2, 2000000) where not exists (select 1 from public.stock_location l where l.kind = 'rep_bag' and l.owner_user_id = $2)",
      [id(), rep, name],
    );
    return (await run("postgres", "select id from public.stock_location where kind = 'rep_bag' and owner_user_id = $1", [rep]))
      .rows[0].id as string;
  };
  BAG_A = await bagOf(fx.repA.id, "[Test] Bag A");
  BAG_B = await bagOf(fx.repB.id, "[Test] Bag B");
  await openingStock(ACTIVE_SKU, STOCK);
  await openingStock(DEACTIVATED_SKU, STOCK);
  await openingStock(UNRELATED_SKU, STOCK);
  const issueA = await one(MANAGER, "select (app.office_propose_stock_issue($1, 'to_rep', $2, $3, $4)).id", [
    id(),
    WH,
    BAG_A,
    JSON.stringify([
      { sku_id: ACTIVE_SKU, qty: ISSUED },
      { sku_id: DEACTIVATED_SKU, qty: ISSUED },
    ]),
  ]);
  ISSUE_A = issueA.id;
  await one(MANAGER, "select app.office_propose_stock_issue($1, 'to_rep', $2, $3, $4)", [
    id(),
    WH,
    BAG_B,
    JSON.stringify([{ sku_id: UNRELATED_SKU, qty: ISSUED }]),
  ]);
});

describe("app.my_pending_issues (REP-05, CTL-05)", () => {
  // Other files share this database and may leave their own pending issues, so each check is about
  // this file's issue only.
  const mine = async (who: Who) => (await pending(who)).filter((r) => r.id === ISSUE_A);

  it("gives the rep the issue's SKUs, and no quantity", async () => {
    const [issue] = await mine(REP_A);
    expect([...issue.sku_ids].sort()).toEqual([ACTIVE_SKU, DEACTIVATED_SKU].sort());
    expect(issue.direction).toBe("to_rep");
    // The columns that leave the function: none of them can hold the office's figure.
    expect(Object.keys(issue).sort()).toEqual(["created_at", "decision_note", "direction", "id", "sku_ids"]);
    expect(JSON.stringify(issue)).not.toContain(`"qty"`);
  });

  it("the rep no longer reads the issue table: no row, so no quantity", async () => {
    expect((await run(REP_A, "select id, lines from public.stock_issue where id = $1", [ISSUE_A])).rows).toEqual([]);
    expect((await run(REP_A, "select count(*)::int n from public.stock_issue")).rows[0].n).toBe(0);
  });

  it("the office still reads the issue with its quantities", async () => {
    const r = await run(MANAGER, "select lines from public.stock_issue where id = $1", [ISSUE_A]);
    expect(r.rows[0].lines).toEqual(
      expect.arrayContaining([
        { sku_id: ACTIVE_SKU, qty: ISSUED },
        { sku_id: DEACTIVATED_SKU, qty: ISSUED },
      ]),
    );
  });

  it("another rep never sees rep A's issue", async () => {
    expect(await mine(REP_B)).toEqual([]);
    expect((await pending(REP_B)).some((r) => (r.sku_ids as string[]).includes(UNRELATED_SKU))).toBe(true);
  });

  it("is empty for the office, for an unapproved phone and for a suspended rep; refused to anonymous", async () => {
    expect(await pending(MANAGER)).toEqual([]);
    expect(await pending(MANAGER_AAL1)).toEqual([]);
    expect(await pending(REP_A_WRONG_DEVICE)).toEqual([]);
    expect(await pending(SUSPENDED)).toEqual([]);
    expect(await sqlstate("anon", "select * from app.my_pending_issues()")).toBe("42501");
  });

  it("the count still posts when the rep counts what the office sent, with no quantity read first", async () => {
    const r = await one(REP_A, "select app.rep_confirm_stock_issue($1, $2) as r", [
      ISSUE_A,
      JSON.stringify([
        { sku_id: ACTIVE_SKU, qty: ISSUED },
        { sku_id: DEACTIVATED_SKU, qty: ISSUED },
      ]),
    ]);
    expect(r.r.status).toBe("confirmed");
    // The answer names the issue and its outcome only: never the office's lines or the count.
    expect(Object.keys(r.r).sort()).toEqual(["decided_at", "id", "status"]);
    expect(await mine(REP_A)).toEqual([]);
  });

  it("a wrong count (a dispute) does not reveal the office's quantities either", async () => {
    const clientId = id();
    await one(MANAGER, "select app.office_propose_stock_issue($1, 'to_rep', $2, $3, $4)", [
      clientId,
      WH,
      BAG_A,
      JSON.stringify([{ sku_id: UNRELATED_SKU, qty: 1 }]),
    ]);
    const row = await one("postgres", "select id from public.stock_issue where client_id = $1", [clientId]);
    const r = await one(REP_A, "select app.rep_confirm_stock_issue($1, $2) as r", [row.id, "[]"]);
    expect(r.r.status).toBe("disputed");
    expect(Object.keys(r.r).sort()).toEqual(["decided_at", "id", "status"]);
    expect(JSON.stringify(r.r)).not.toContain("qty");
  });
});
