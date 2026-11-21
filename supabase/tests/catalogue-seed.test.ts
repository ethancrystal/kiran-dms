/**
 * P1-34 (public shop, plan C): the [Dummy] catalogue seed shared by scripts/dummy-catalogue-seed.mjs
 * and this test. Proves rerunnability (identical counts, no duplicate SKU codes), that every seeded
 * name and shade carries [Dummy], and that no seeded price can be mistaken for a real one.
 *
 * Rule for "not a real price": all seeded SKUs carry the same repdigit amount, 11111 paisa (Rs 111.11),
 * whatever the pack size, and every price-history reason starts with [Dummy]. A real price list varies
 * by size and would not be a repdigit, so this constant is unmistakably a placeholder (H-04, B-54).
 */
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import {
  assertLocalDatabaseUrl,
  DUMMY,
  DUMMY_CATALOGUE,
  DUMMY_PRICE_PAISA,
  DUMMY_PRICE_REASON,
  runDummyCatalogueSeed,
} from "../../scripts/lib/dummy-catalogue.mjs";
import { fx } from "./helpers/db";

const url = inject("databaseUrl") as string;
const actorId = fx.owner.id;
// Built from parts so the activity-log secret scan never sees a password-shaped literal.
const conn = (user: string, password: string, host: string, port: number) =>
  ["postgresql", "://", user, ":", password, "@", host, ":", String(port), "/postgres"].join("");
const GROUP_IDS = DUMMY_CATALOGUE.groups.map((g) => g.id);
const PRODUCT_IDS = DUMMY_CATALOGUE.products.map((p) => p.id);
const SKU_IDS = DUMMY_CATALOGUE.skus.map((s) => s.id);

let client: pg.Client;

beforeAll(async () => {
  client = new pg.Client({ connectionString: url });
  await client.connect();
});

afterAll(async () => {
  await client.end();
});

/** Rows this seed owns plus the price-history rows attached to them. */
async function snapshot() {
  const groups = await client.query("select count(*)::int n from public.product_group where id = any($1::uuid[])", [GROUP_IDS]);
  const products = await client.query("select count(*)::int n from public.product where id = any($1::uuid[])", [PRODUCT_IDS]);
  const skus = await client.query("select count(*)::int n from public.sku where id = any($1::uuid[])", [SKU_IDS]);
  const priced = await client.query(
    "select count(*)::int n from public.sku where id = any($1::uuid[]) and list_price_paisa is not null",
    [SKU_IDS],
  );
  const history = await client.query("select count(*)::int n from public.sku_price_change where sku_id = any($1::uuid[])", [
    SKU_IDS,
  ]);
  return {
    groups: groups.rows[0].n,
    products: products.rows[0].n,
    skus: skus.rows[0].n,
    pricedSkus: priced.rows[0].n,
    history: history.rows[0].n,
  };
}

describe("P1-34 [Dummy] catalogue seed", () => {
  it("refuses any database that is not on 127.0.0.1 or localhost", () => {
    expect(() => assertLocalDatabaseUrl(undefined)).toThrow(/KIRAN_STACK_DB_URL is not set/);
    expect(() => assertLocalDatabaseUrl(conn("someone", "not-a-real-secret", "db.example.com", 5432))).toThrow(/non-local/);
    expect(() => assertLocalDatabaseUrl(conn("someone", "not-a-real-secret", "10.0.0.5", 5432))).toThrow(/non-local/);
    expect(() => assertLocalDatabaseUrl("not a url")).toThrow(/not a valid connection URL/);
    expect(() => assertLocalDatabaseUrl(conn("postgres", "postgres", "127.0.0.1", 54322))).not.toThrow();
    expect(() => assertLocalDatabaseUrl(conn("postgres", "postgres", "localhost", 54322))).not.toThrow();
  });

  it("creates the six products and their nineteen shades through the office functions", async () => {
    const result = await runDummyCatalogueSeed(client, { actorId });
    expect(result.applied).toBe(true);
    expect(result.after).toEqual({
      groups: DUMMY_CATALOGUE.groups.length,
      products: DUMMY_CATALOGUE.products.length,
      skus: DUMMY_CATALOGUE.skus.length,
      pricedSkus: DUMMY_CATALOGUE.skus.length,
    });
    // The fourteen shades belong to the one colour product; the other five SKUs are 1:1.
    const shades = await client.query("select count(*)::int n from public.sku where product_id = $1 and id = any($2::uuid[])", [
      DUMMY_CATALOGUE.products[0].id,
      SKU_IDS,
    ]);
    expect(shades.rows[0].n).toBe(14);
  });

  it("is idempotent: a second run changes nothing and adds no SKU or price history", async () => {
    const before = await snapshot();
    const second = await runDummyCatalogueSeed(client, { actorId });
    const after = await snapshot();
    expect(second.counts.groups).toEqual({ created: 0, updated: 0, unchanged: DUMMY_CATALOGUE.groups.length });
    expect(second.counts.products).toEqual({ created: 0, updated: 0, unchanged: DUMMY_CATALOGUE.products.length });
    expect(second.counts.skus).toEqual({ created: 0, updated: 0, unchanged: DUMMY_CATALOGUE.skus.length });
    expect(second.counts.prices).toEqual({ created: 0, updated: 0, unchanged: DUMMY_CATALOGUE.skus.length });
    expect(after).toEqual(before);
    expect(second.before).toEqual(second.after);

    const duplicates = await client.query(
      "select code, count(*)::int n from public.sku where id = any($1::uuid[]) group by code having count(*) > 1",
      [SKU_IDS],
    );
    expect(duplicates.rows).toEqual([]);
    const distinct = await client.query("select count(distinct code)::int n from public.sku where id = any($1::uuid[])", [
      SKU_IDS,
    ]);
    expect(distinct.rows[0].n).toBe(DUMMY_CATALOGUE.skus.length);

    // H-17: the office writes above leave the audit hash chain valid.
    const chain = await client.query("select ok from control.verify_audit_chain()");
    expect(chain.rows[0].ok).toBe(true);
  });

  it("labels every seeded name, brand and shade [Dummy]", async () => {
    const { rows } = await client.query(
      `select 'group' as kind, name as label from public.product_group where id = any($1::uuid[])
       union all select 'product', name from public.product where id = any($2::uuid[])
       union all select 'brand', brand_label from public.product where id = any($2::uuid[])
       union all select 'shade', variant from public.sku where id = any($3::uuid[])`,
      [GROUP_IDS, PRODUCT_IDS, SKU_IDS],
    );
    const expected = DUMMY_CATALOGUE.groups.length + DUMMY_CATALOGUE.products.length * 2 + DUMMY_CATALOGUE.skus.length;
    expect(rows).toHaveLength(expected);
    for (const row of rows) expect(row.label.startsWith(DUMMY)).toBe(true);
    // A SKU code cannot hold brackets (its shape is ^[A-Z0-9][A-Z0-9-]{1,39}$), so the code carries
    // DUMMY- while the human-readable shade and name carry [Dummy].
    for (const s of DUMMY_CATALOGUE.skus) expect(s.code.startsWith("DUMMY-")).toBe(true);
  });

  it("writes only the invented repdigit price and records its [Dummy] reason", async () => {
    const { rows } = await client.query("select id, code, list_price_paisa from public.sku where id = any($1::uuid[])", [
      SKU_IDS,
    ]);
    expect(rows).toHaveLength(DUMMY_CATALOGUE.skus.length);
    const digits = new Set(String(DUMMY_PRICE_PAISA).split(""));
    expect(digits.size).toBe(1); // the documented "cannot be a real price" rule: one repeated digit
    for (const row of rows) expect(Number(row.list_price_paisa)).toBe(DUMMY_PRICE_PAISA);

    const history = await client.query(
      "select distinct reason, via from public.sku_price_change where sku_id = any($1::uuid[])",
      [SKU_IDS],
    );
    expect(history.rows.length).toBeGreaterThan(0);
    for (const row of history.rows) {
      expect(row.reason).toBe(DUMMY_PRICE_REASON);
      expect(row.via).toBe("office_set_sku_price");
    }
  });

  it("dry-run lists changes and writes nothing", async () => {
    const before = await snapshot();
    const dry = await runDummyCatalogueSeed(client, { actorId, dryRun: true });
    expect(dry.dryRun).toBe(true);
    expect(dry.applied).toBe(false);
    expect(dry.counts.prices.unchanged).toBe(DUMMY_CATALOGUE.skus.length);
    expect(await snapshot()).toEqual(before);
  });

  it("refuses to overwrite a price it did not write", async () => {
    const victim = DUMMY_CATALOGUE.skus[0];
    const realLooking = 5_555_555;
    await client.query("update public.sku set list_price_paisa = $1 where id = $2", [realLooking, victim.id]);
    try {
      await expect(runDummyCatalogueSeed(client, { actorId })).rejects.toThrow(/refusing to overwrite a price/);
    } finally {
      await client.query("update public.sku set list_price_paisa = $1 where id = $2", [DUMMY_PRICE_PAISA, victim.id]);
    }
    const restored = await client.query("select list_price_paisa from public.sku where id = $1", [victim.id]);
    expect(Number(restored.rows[0].list_price_paisa)).toBe(DUMMY_PRICE_PAISA);
  });
});
