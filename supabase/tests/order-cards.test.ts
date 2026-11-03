/**
 * Order channel, creator, assigned rep and order cards (migration 20261104090000, PR A, D-30):
 * `sales_order` gains source_channel / created_by / assigned_rep_id / intake_card_id, its rep and rep
 * day become optional for office orders, `invoice.rep_id` becomes optional, and a rep's order card
 * (an append-only note of what a salon needs) has an append-only close record (converted or
 * dismissed). Schema cases only; the RPCs that create and close cards come in later tasks.
 *
 * Catalogue, territory and salon are committed with fresh ids. Every case runs in one rolled-back
 * transaction as postgres, so nothing is left behind for other test files.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { errorOf, fx, MANAGER, OWNER, REP_A, run, sqlstate, type Who } from "./helpers/db";

const C = { commit: true };
const id = () => randomUUID();
const TAG_LENGTH = 8;
const tag = () => randomUUID().slice(0, TAG_LENGTH);
const one = async (who: Who, sql: string, params: unknown[] = []) => (await run(who, sql, params, C)).rows[0];
const TODAY = "(now() at time zone 'Asia/Karachi')::date";

const GROUP_CYCLE_DAYS = 21;
const SKU_SIZE = 100;
const SKU_PRICE = 120000; // Rs 1,200
const BODY_MAX = 2000;
const CHECK_VIOLATION = "23514";
const UNIQUE_VIOLATION = "23505";
const SHORT_REASON = "no";
const GOOD_REASON = "salon closed down";

const T_A = id(),
  AREA_A = id(),
  SALON = id(),
  GROUP = id(),
  PRODUCT = id(),
  SKU = id();

type Multi = Array<{ rows: Array<Record<string, unknown>> }>;
const script = (
  sql: string,
) => `insert into public.rep_day (rep_id, day) values ('${fx.repA.id}', ${TODAY}) on conflict (rep_id, day) do nothing;
${sql}`;
const tx = async (sql: string) => ((await run("postgres", script(sql))) as unknown as Multi).at(-1)?.rows ?? [];
const txCode = (sql: string) => sqlstate("postgres", script(sql));
const txError = (sql: string) => errorOf("postgres", script(sql));

const REP_DAY = `(select d.id from public.rep_day d where d.rep_id = '${fx.repA.id}' and d.day = ${TODAY})`;
const card = (cid: string, body = "needs two tubes of shade 5") =>
  `insert into public.order_intake_card (id, client_id, salon_id, rep_id, rep_day_id, body)
   values ('${cid}', '${cid}', '${SALON}', '${fx.repA.id}', ${REP_DAY}, '${body}');`;
const close = (cid: string, outcome: string, orderId: string | null, reason: string | null) =>
  `insert into public.order_intake_card_close (card_id, outcome, order_id, reason, closed_by)
   values ('${cid}', '${outcome}', ${orderId === null ? "null" : `'${orderId}'`}, ${reason === null ? "null" : `'${reason}'`}, '${fx.manager.id}');`;
// An order the office created itself: by default no rep and no rep day.
const officeOrder = (oid: string, repId = "null", repDayId = "null") =>
  `insert into public.sales_order (id, client_id, salon_id, source_channel, created_by, rep_id, rep_day_id, plan, delivery_mode, subtotal_paisa, total_paisa)
   values ('${oid}', '${oid}', '${SALON}', 'office', '${fx.manager.id}', ${repId}, ${repDayId}, 'CASH', 'warehouse', ${SKU_PRICE}, ${SKU_PRICE});`;

beforeAll(async () => {
  await one(MANAGER, "select app.office_upsert_territory($1, $2)", [T_A, `[Test] Cards A ${tag()}`]);
  await one(MANAGER, "select app.office_upsert_area($1, $2, '[Test] Cards area A')", [AREA_A, T_A]);
  await one(MANAGER, "select app.office_assign_territory($1, $2)", [fx.repA.id, T_A]);
  await one(REP_A, "select app.create_salon($1, $2, 'ladies_parlor', $3, 'map_pin', null, 24.9, 67.1)", [
    SALON,
    `[Test] Cards salon ${tag()}`,
    AREA_A,
  ]);
  await one(MANAGER, "select app.office_upsert_product_group($1, $2, $3)", [
    GROUP,
    `[Test] Cards colour ${tag()}`,
    GROUP_CYCLE_DAYS,
  ]);
  await one(MANAGER, "select app.office_upsert_product($1, $2, '[Dummy] Kiran', '[Dummy] Cards colour')", [PRODUCT, GROUP]);
  await one(MANAGER, "select app.office_upsert_sku($1, $2, $3, '[Dummy] shade', 'ml', $4)", [
    SKU,
    PRODUCT,
    `T-CRD-${tag().toUpperCase()}`,
    SKU_SIZE,
  ]);
  await one(OWNER, "select app.owner_set_sku_price($1, $2, 'dummy list price')", [SKU, SKU_PRICE]);
});

afterAll(async () => {
  await one(MANAGER, "select app.office_end_territory($1, $2, 'order card tests finished')", [fx.repA.id, T_A]);
});

describe("order cards and their closes are append-only", () => {
  it("order_intake_card and its close table refuse UPDATE and DELETE, even for postgres", async () => {
    const cid = id();
    const base = `${card(cid)} ${close(cid, "dismissed", null, GOOD_REASON)}`;
    expect(await txError(`${base} update public.order_intake_card set body = 'changed' where id = '${cid}';`)).toContain(
      "append-only",
    );
    expect(await txError(`${base} delete from public.order_intake_card where id = '${cid}';`)).toContain("append-only");
    expect(
      await txError(`${base} update public.order_intake_card_close set reason = 'changed again' where card_id = '${cid}';`),
    ).toContain("append-only");
    expect(await txError(`${base} delete from public.order_intake_card_close where card_id = '${cid}';`)).toContain(
      "append-only",
    );
    expect(await txError(`${base} truncate public.order_intake_card_close;`)).toContain("append-only");
  });
});

describe("order card shape", () => {
  it("a card needs a body of 1 to 2000 non-blank characters, and one client_id only once", async () => {
    expect(await txCode(card(id(), "  "))).toBe(CHECK_VIOLATION);
    expect(await txCode(card(id(), "x".repeat(BODY_MAX + 1)))).toBe(CHECK_VIOLATION);
    expect(await txCode(card(id(), "x".repeat(BODY_MAX)))).toBeNull();
    const cid = id();
    expect(await txCode(`${card(cid)} ${card(cid)}`)).toBe(UNIQUE_VIOLATION);
  });

  it("a card closes once: converted points at an order and has no reason, dismissed has a reason of 5+ characters and no order", async () => {
    const [cid, oid] = [id(), id()];
    expect(await txCode(`${card(cid)} ${close(cid, "converted", null, null)}`)).toBe(CHECK_VIOLATION);
    expect(await txCode(`${card(cid)} ${officeOrder(oid)} ${close(cid, "converted", oid, GOOD_REASON)}`)).toBe(CHECK_VIOLATION);
    expect(await txCode(`${card(cid)} ${officeOrder(oid)} ${close(cid, "converted", oid, null)}`)).toBeNull();
    expect(await txCode(`${card(cid)} ${close(cid, "dismissed", null, SHORT_REASON)}`)).toBe(CHECK_VIOLATION);
    expect(await txCode(`${card(cid)} ${close(cid, "dismissed", null, "      ")}`)).toBe(CHECK_VIOLATION);
    expect(await txCode(`${card(cid)} ${officeOrder(oid)} ${close(cid, "dismissed", oid, GOOD_REASON)}`)).toBe(CHECK_VIOLATION);
    expect(await txCode(`${card(cid)} ${close(cid, "dismissed", null, GOOD_REASON)}`)).toBeNull();
    const other = id();
    expect(
      await txCode(
        `${card(cid)} ${card(other)} ${officeOrder(oid)} ${close(cid, "converted", oid, null)} ${close(other, "converted", oid, null)}`,
      ),
    ).toBe(UNIQUE_VIOLATION);
    expect(
      await txCode(`${card(cid)} ${close(cid, "dismissed", null, GOOD_REASON)} ${close(cid, "dismissed", null, GOOD_REASON)}`),
    ).toBe(UNIQUE_VIOLATION);
  });
});

describe("order channel, creator, assigned rep (D-30)", () => {
  it("an existing rep order keeps source_channel rep_visit and created_by = rep_id", async () => {
    const cid = id();
    const lines = `'${JSON.stringify([{ sku_id: SKU, qty: 1 }])}'::jsonb`;
    const rows = await tx(`
      reset role;
      select set_config('request.jwt.claims', '${JSON.stringify({ sub: fx.repA.id, role: "authenticated", aal: "aal1" })}', true),
             set_config('request.headers', '${JSON.stringify({ "x-kiran-device": fx.repA.device })}', true);
      set local role authenticated;
      select app.create_order('${cid}', '${SALON}', 'CASH', 'bag_now', ${lines});
      reset role;
      select source_channel::text, created_by = rep_id as by_rep, rep_id = '${fx.repA.id}' as is_rep_a, rep_day_id is not null as has_day,
             assigned_rep_id is null as no_assignee, intake_card_id is null as no_card
      from public.sales_order where client_id = '${cid}';`);
    expect(rows).toEqual([
      { source_channel: "rep_visit", by_rep: true, is_rep_a: true, has_day: true, no_assignee: true, no_card: true },
    ]);
  });

  it("the channel decides the shape: rep_visit has a rep and a rep day, office has neither", async () => {
    const oid = id();
    const rows = await tx(
      `${officeOrder(oid)} select source_channel::text, rep_id, rep_day_id from public.sales_order where id = '${oid}';`,
    );
    expect(rows).toEqual([{ source_channel: "office", rep_id: null, rep_day_id: null }]);
    expect(await txCode(officeOrder(id(), `'${fx.repA.id}'`))).toBe(CHECK_VIOLATION);
    expect(await txCode(officeOrder(id(), "null", REP_DAY))).toBe(CHECK_VIOLATION);
    const repVisitNoDay = `insert into public.sales_order (id, client_id, salon_id, source_channel, created_by, rep_id, plan, delivery_mode, subtotal_paisa, total_paisa)
      values ('${oid}', '${oid}', '${SALON}', 'rep_visit', '${fx.repA.id}', '${fx.repA.id}', 'CASH', 'warehouse', ${SKU_PRICE}, ${SKU_PRICE});`;
    expect(await txCode(repVisitNoDay)).toBe(CHECK_VIOLATION);
  });

  it("a rep_visit order is created by its own rep: created_by differing from rep_id fails", async () => {
    const oid = id();
    const otherCreator = `insert into public.sales_order (id, client_id, salon_id, source_channel, created_by, rep_id, rep_day_id, plan, delivery_mode, subtotal_paisa, total_paisa)
      values ('${oid}', '${oid}', '${SALON}', 'rep_visit', '${fx.manager.id}', '${fx.repA.id}', ${REP_DAY}, 'CASH', 'warehouse', ${SKU_PRICE}, ${SKU_PRICE});`;
    expect(await txCode(otherCreator)).toBe(CHECK_VIOLATION);
  });

  it("a rep cannot deliver a rep-less office order: the null rep_id does not slip past the ownership check", async () => {
    const oid = id();
    const confirmed = `insert into public.sales_order (id, client_id, salon_id, source_channel, created_by, plan, delivery_mode, status, subtotal_paisa, total_paisa, confirmed_at)
      values ('${oid}', '${oid}', '${SALON}', 'office', '${fx.manager.id}', 'CASH', 'warehouse', 'confirmed', ${SKU_PRICE}, ${SKU_PRICE}, now());`;
    const asRepA = `reset role;
      select set_config('request.jwt.claims', '${JSON.stringify({ sub: fx.repA.id, role: "authenticated", aal: "aal1" })}', true),
             set_config('request.headers', '${JSON.stringify({ "x-kiran-device": fx.repA.device })}', true);
      set local role authenticated;`;
    const deliver = `select app.rep_deliver('${id()}', '${oid}', 'Ayesha at the counter', 24.9, 67.1);`;
    expect(await txCode(`${confirmed} ${asRepA} ${deliver}`)).toBe("42501");
    expect(await txError(`${confirmed} ${asRepA} ${deliver}`)).toContain("own orders");
  });

  it("an order always records who created it", async () => {
    const oid = id();
    const noCreator = `insert into public.sales_order (id, client_id, salon_id, source_channel, plan, delivery_mode, subtotal_paisa, total_paisa)
      values ('${oid}', '${oid}', '${SALON}', 'office', 'CASH', 'warehouse', ${SKU_PRICE}, ${SKU_PRICE});`;
    expect(await txCode(noCreator)).toBe("23502");
  });

  it("channel, creator, assigned rep and source card never change after creation, for postgres too", async () => {
    const oid = id();
    const changes = [
      `source_channel = 'salon_portal'`,
      `created_by = '${fx.owner.id}'`,
      `assigned_rep_id = '${fx.repA.id}'`,
      `intake_card_id = '${id()}'`,
    ];
    const results = await Promise.all(
      changes.map((set) => txError(`${officeOrder(oid)} update public.sales_order set ${set} where id = '${oid}';`)),
    );
    expect(results.map((e) => e?.includes("immutable"))).toEqual(changes.map(() => true));
  });

  it("a rep-less order can be invoiced: invoice.rep_id is optional", async () => {
    const rows = await tx(`select is_nullable from information_schema.columns
      where table_schema = 'public' and table_name = 'invoice' and column_name = 'rep_id';`);
    expect(rows).toEqual([{ is_nullable: "YES" }]);
  });
});
