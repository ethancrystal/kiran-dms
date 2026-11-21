/**
 * INV-12 salon catalogue availability (migration 20261121130000; MJ ruling 3, 2026-11-20,
 * docs/log/2026-11-20-mj-rep-scope-stock-investors.md): the salon portal sees availability only,
 * "In stock" or "Not available" at zero, never a unit count; the office keeps the real numbers.
 *
 * Availability is derived on every read from the append-only stock movements (H-10: nothing is
 * stored), from active warehouse-kind locations only. A goods receipt (app.office_receive_stock)
 * makes a SKU available; stock sitting anywhere else does not.
 *
 * One persona per transaction, fresh ids, and each case tries to break a control: the row shape,
 * the source of the flag, and the refusals for a rep and an anonymous caller. The setup (a [Test]
 * salon with an invited login, a [Dummy] catalogue and a warehouse) is committed, as the other
 * module tests do; every case runs in one rolled-back transaction.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fx, MANAGER, REP_A, run, sqlstate } from "./helpers/db";
import { asLoginRows, type Login, newLogin, quote, tag, uuid } from "./helpers/invite";

const C = { commit: true };
const id = () => randomUUID();
const code = () => `T-${randomUUID().slice(0, 8).toUpperCase()}`;

const TERRITORY = id(),
  AREA = id(),
  SALON = id(),
  GROUP = id(),
  PRODUCT = id(),
  SKU_EMPTY = id(), // in the catalogue, never received
  SKU_STOCKED = id(), // received into the warehouse in its own case
  WAREHOUSE = id(),
  QUARANTINE = id();
const PRICE = 120_000; // Rs 1,200, the same list price for both SKUs
const SIZE_ML = 100;
const RECEIVED = 9;
const QUARANTINED = 4;

// The catalogue row as the salon may read it: every column of migration 20261105150000, in order,
// plus in_stock last. No quantity, location or movement key exists.
const ROW_KEYS = [
  "product_id",
  "brand_label",
  "product_name",
  "description",
  "image_path",
  "group_name",
  "sku_id",
  "code",
  "variant",
  "unit",
  "size_value",
  "price_paisa",
  "own_price",
  "in_stock",
];

let login: Login;
let member = "";

const onHand = async (loc: string, sku: string) =>
  Number((await run("postgres", "select app.on_hand($1, $2) n", [loc, sku])).rows[0].n);
const catalogue = async () => await asLoginRows(login, "select * from app.salon_catalogue()");
const rowFor = (rows: Array<Record<string, unknown>>, sku: string) =>
  rows.find((r) => r.sku_id === sku) as Record<string, unknown> | undefined;

const inviteSalon = async () => {
  const email = `salon.${tag()}@example.test`;
  const r = await run(
    MANAGER,
    "select app.office_invite($1, 'salon', '[Test] Availability contact', $2, $3) as r",
    [uuid(), email, SALON],
    C,
  );
  const token = (r.rows[0].r as { token: string }).token;
  const l = await newLogin({ email });
  await run(
    "postgres",
    `reset role; select set_config('request.jwt.claims', '${JSON.stringify({
      sub: l.id,
      role: "authenticated",
      aal: "aal1",
      session_id: l.session,
      email: l.email,
      amr: [{ method: "otp", timestamp: 1 }],
    })}', true), set_config('request.headers', '{}', true); set local role authenticated;
     select app.redeem_invitation(${quote(token)});`,
    [],
    C,
  );
  const m = (await run("postgres", "select id from public.salon_membership where user_id = $1", [l.id])).rows[0];
  return { l, member: m.id as string };
};

beforeAll(async () => {
  await run(MANAGER, "select app.office_upsert_territory($1, $2)", [TERRITORY, `[Test] Availability ${tag()}`], C);
  await run(MANAGER, "select app.office_upsert_area($1, $2, '[Test] Availability area')", [AREA, TERRITORY], C);
  await run(
    MANAGER,
    "select app.create_salon($1, $2, 'ladies_parlor', $3, 'manual')",
    [SALON, `[Test] Availability salon ${tag()}`, AREA],
    C,
  );
  await run(MANAGER, "select app.office_upsert_product_group($1, $2, 30)", [GROUP, `[Test] Availability group ${tag()}`], C);
  await run(
    MANAGER,
    "select app.office_upsert_product($1, $2, '[Dummy] Kiran', '[Dummy] Availability shade')",
    [PRODUCT, GROUP],
    C,
  );
  for (const s of [SKU_EMPTY, SKU_STOCKED]) {
    await run(MANAGER, "select app.office_upsert_sku($1, $2, $3, '[Dummy] 100 ml', 'ml', $4)", [s, PRODUCT, code(), SIZE_ML], C);
    await run(MANAGER, "select app.office_set_sku_price($1, $2, $3, '[Test] availability list price')", [uuid(), s, PRICE], C);
  }
  await run(MANAGER, "select app.office_create_location($1, 'warehouse', '[Test] Availability store')", [WAREHOUSE], C);
  await run(MANAGER, "select app.office_create_location($1, 'quarantine', '[Test] Availability quarantine')", [QUARANTINE], C);
  const invited = await inviteSalon();
  login = invited.l;
  member = invited.member;
});

afterAll(async () => {
  if (member)
    await run(MANAGER, "select app.office_set_member_status('salon', $1, 'revoked', 'availability tests finished')", [member], C);
});

describe("salon catalogue availability (INV-12)", () => {
  it("the row carries a boolean and no unit count: availability is derived, never stored", async () => {
    const rows = await catalogue();
    const empty = rowFor(rows, SKU_EMPTY);
    expect(empty).toBeDefined();
    expect(Object.keys(empty as object)).toEqual(ROW_KEYS);
    expect(empty?.in_stock).toBe(false);
    // The declared OUT parameters: in_stock is the only stock-shaped column, and it is a boolean.
    const { rows: params } = await run(
      "postgres",
      `select parameter_name, data_type from information_schema.parameters
       where specific_schema = 'app' and specific_name like 'salon_catalogue%' and parameter_mode = 'OUT'
       order by ordinal_position`,
    );
    expect(params.map((p) => String(p.parameter_name))).toEqual(ROW_KEYS);
    expect(params.find((p) => p.parameter_name === "in_stock")?.data_type).toBe("boolean");
    expect(params.filter((p) => /qty|quantity|on_hand|units|available/i.test(String(p.parameter_name)))).toEqual([]);
    // H-10: no table stores a stock figure for the salon to read.
    const { rows: stored } = await run(
      "postgres",
      `select column_name from information_schema.columns
       where table_schema = 'public' and column_name in ('in_stock', 'available', 'on_hand', 'stock_qty', 'quantity')`,
    );
    expect(stored).toEqual([]);
  });

  it("a goods receipt makes the SKU available; zero stock reads Not available; the office keeps the number", async () => {
    expect(await onHand(WAREHOUSE, SKU_STOCKED)).toBe(0);
    expect(rowFor(await catalogue(), SKU_STOCKED)?.in_stock).toBe(false);

    const receipt = (
      await run(
        MANAGER,
        "select app.office_receive_stock($1, $2, $3, $4) r",
        [id(), WAREHOUSE, JSON.stringify([{ sku_id: SKU_STOCKED, qty: RECEIVED }]), "[Test] availability goods received"],
        C,
      )
    ).rows[0].r;
    expect(receipt).toEqual({ replay: false, lines: 1, units: RECEIVED });
    expect(await onHand(WAREHOUSE, SKU_STOCKED)).toBe(RECEIVED);

    const rows = await catalogue();
    expect(rowFor(rows, SKU_STOCKED)?.in_stock).toBe(true);
    expect(rowFor(rows, SKU_EMPTY)?.in_stock).toBe(false);
    // The same stock reads as a real count to the office (and only to the office).
    const office = (await run(MANAGER, "select available from app.warehouse_availability() where sku_id = $1", [SKU_STOCKED]))
      .rows[0];
    expect(Number(office.available)).toBe(RECEIVED);
  });

  it("stock held outside an active warehouse does not make a SKU available", async () => {
    // Written as postgres, the way the database tests seed movement history: a receipt may only go
    // through the office path into a warehouse, so quarantine stock cannot be created by a salon.
    await run(
      "postgres",
      `insert into public.stock_movement (client_id, sku_id, qty, to_location_id, kind, actor_id)
       values ($1, $2, $3, $4, 'receipt', $5)`,
      [id(), SKU_EMPTY, QUARANTINED, QUARANTINE, fx.manager.id],
      C,
    );
    expect(await onHand(QUARANTINE, SKU_EMPTY)).toBe(QUARANTINED);
    expect(rowFor(await catalogue(), SKU_EMPTY)?.in_stock).toBe(false);
  });

  it("an outward movement empties availability again", async () => {
    // The receipt case above left SKU_STOCKED in the warehouse. An outward movement (the row a
    // delivered order writes, as the restock tests seed the same history) takes it to zero.
    const left = await onHand(WAREHOUSE, SKU_STOCKED);
    expect(left).toBeGreaterThan(0);
    await run(
      "postgres",
      `insert into public.stock_movement (client_id, sku_id, qty, from_location_id, kind, actor_id)
       values ($1, $2, $3, $4, 'sale', $5)`,
      [id(), SKU_STOCKED, left, WAREHOUSE, fx.manager.id],
      C,
    );
    expect(await onHand(WAREHOUSE, SKU_STOCKED)).toBe(0);
    expect(rowFor(await catalogue(), SKU_STOCKED)?.in_stock).toBe(false);
  });

  it("reps and anonymous callers are still refused", async () => {
    expect(await sqlstate(REP_A, "select * from app.salon_catalogue()")).toBe("42501");
    expect(await sqlstate("anon", "select * from app.salon_catalogue()")).toBe("42501");
  });
});
