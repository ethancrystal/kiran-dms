/**
 * The office sheet upload's write path (MJ, 2026-11-20, ruling 5; workstream D, first slice).
 *
 * The page (apps/web/app/office/(shell)/products/upload/page.tsx) parses the CSV in the browser and
 * then writes through the functions that already exist, with exactly these arguments:
 * app.office_upsert_product, app.office_upsert_sku, app.office_set_sku_price and
 * app.office_receive_stock. This file proves that sequence works, and that a retry of the same file
 * changes nothing twice (H-08): one batch id for the file, ids and a price key derived from it.
 *
 * One persona per transaction, fresh ids, synthetic values only.
 */
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { MANAGER, MANAGER_AAL1, OWNER, REP_A, run, sqlstate, type Who } from "./helpers/db";

const C = { commit: true };
const id = () => randomUUID();
const suffix = () => randomUUID().slice(0, 8).toUpperCase();
// The batch id the page makes per file, and the ids it derives per row (lib/sheet-import.ts rowKey).
const batch = id();
const PRICE_PAISA = 150_000;
const PRICE_REASON = "sheet upload";
const QTY = 12;
// A code in the shape the page generates when the sheet leaves sku_code empty.
const GENERATED_CODE = `SH-${suffix()}`;

const GROUP = id(),
  PRODUCT = id(),
  SKU = id(),
  WH = id();
const PRICE_KEY = id();

const one = async (who: Who, sql: string, params: unknown[] = []) => (await run(who, sql, params, C)).rows[0];
const onHand = async (loc: string, sku: string) =>
  Number((await run("postgres", "select app.on_hand($1, $2) n", [loc, sku])).rows[0].n);

// What the page sends for one row that names no code and no existing product.
async function applyRow(who: Who) {
  await one(who, "select app.office_upsert_product($1, $2, $3, $4, true, null, null)", [
    PRODUCT,
    GROUP,
    "[Dummy] Sheet group",
    "[Dummy] Sheet shampoo",
  ]);
  await one(who, "select app.office_upsert_sku($1, $2, $3, $4, $5, $6, null, null, true)", [
    SKU,
    PRODUCT,
    GENERATED_CODE,
    "[Dummy] Regular",
    "ml",
    400,
  ]);
  await one(who, "select app.office_set_sku_price($1, $2, $3, $4)", [PRICE_KEY, SKU, PRICE_PAISA, PRICE_REASON]);
  return (
    await one(who, "select app.office_receive_stock($1, $2, $3, $4) r", [
      batch,
      WH,
      JSON.stringify([{ sku_id: SKU, qty: QTY }]),
      "sheet upload",
    ])
  ).r;
}

describe("a sheet row through the office functions", () => {
  it("creates the product, the SKU and the price, receives the units, and a retry of the same file changes nothing", async () => {
    // Setup the office did before the upload (the page only reads groups and the warehouse).
    await one(OWNER, "select app.office_upsert_product_group($1, $2, 30)", [GROUP, `[Dummy] Sheet group ${suffix()}`]);
    await one(OWNER, "select app.office_create_location($1, 'warehouse', $2)", [WH, `[Test] Sheet store ${suffix()}`]);

    expect(await applyRow(MANAGER)).toEqual({ replay: false, lines: 1, units: QTY });
    expect(await onHand(WH, SKU)).toBe(QTY);

    const product = (await run("postgres", "select name, brand_label, active from public.product where id = $1", [PRODUCT]))
      .rows[0];
    // The sheet has no brand column: the group's name is the label the page sends.
    expect(product.brand_label).toBe("[Dummy] Sheet group");
    expect(product.active).toBe(true);
    const sku = (await run("postgres", "select code, unit, size_value, list_price_paisa from public.sku where id = $1", [SKU]))
      .rows[0];
    // pg returns bigint (paisa) as a string.
    expect(sku).toEqual({ code: GENERATED_CODE, unit: "ml", size_value: "400.000", list_price_paisa: String(PRICE_PAISA) });

    // The retry: the same ids, the same price key, the same batch id. Nothing doubles.
    expect(await applyRow(MANAGER)).toEqual({ replay: true, client_id: batch });
    expect(await onHand(WH, SKU)).toBe(QTY);
    const counts = (
      await run(
        "postgres",
        `select (select count(*)::int from public.product where id = $1) products,
                (select count(*)::int from public.sku where id = $2) skus,
                (select count(*)::int from public.sku_price_change where client_id = $3) prices,
                (select count(*)::int from public.stock_movement where source_type = 'stock_receipt' and source_id = $4) receipts`,
        [PRODUCT, SKU, PRICE_KEY, batch],
      )
    ).rows[0];
    expect(counts).toEqual({ products: 1, skus: 1, prices: 1, receipts: 1 });
    expect((await run("postgres", "select ok from control.verify_audit_chain()")).rows[0].ok).toBe(true);
  });

  it("refuses a rep, an anonymous session and an AAL1 office session", async () => {
    const lines = JSON.stringify([{ sku_id: SKU, qty: 1 }]);
    expect(await sqlstate(REP_A, "select app.office_receive_stock($1, $2, $3, $4)", [id(), WH, lines, "sheet upload"])).toBe(
      "42501",
    );
    expect(await sqlstate(REP_A, "select app.office_set_sku_price($1, $2, $3, $4)", [id(), SKU, PRICE_PAISA, PRICE_REASON])).toBe(
      "42501",
    );
    expect(
      await sqlstate(MANAGER_AAL1, "select app.office_receive_stock($1, $2, $3, $4)", [id(), WH, lines, "sheet upload"]),
    ).toBe("42501");
    expect(
      await sqlstate("anon", "select app.office_set_sku_price($1, $2, $3, $4)", [id(), SKU, PRICE_PAISA, PRICE_REASON]),
    ).toBe("42501");
  });

  it("refuses a quantity the sheet parser would have caught, at the database too", async () => {
    for (const qty of [0, -3, 100_001]) {
      expect(
        await sqlstate(MANAGER, "select app.office_receive_stock($1, $2, $3, $4)", [
          id(),
          WH,
          JSON.stringify([{ sku_id: SKU, qty }]),
          "sheet upload",
        ]),
      ).toBe("22023");
    }
  });
});
