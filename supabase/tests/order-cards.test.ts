/**
 * Order channel, creator, assigned rep and order cards (migration 20261104090000, PR A, D-30):
 * `sales_order` gains source_channel / created_by / assigned_rep_id / intake_card_id, its rep and rep
 * day become optional for office orders, `invoice.rep_id` becomes optional, and a rep's order card
 * (an append-only note of what a salon needs) has an append-only close record (converted or
 * dismissed). The RPCs (task 4, ORD-14): a rep saves a card at a salon it covers on its open day
 * (app.rep_create_card) and lists its own (app.my_cards); the office lists open cards
 * (app.office_open_cards), converts one with app.office_create_order(p_intake_card_id) or dismisses it
 * with a reason (app.office_dismiss_card). A card closes once (55000 after that).
 *
 * Catalogue, territory and salon are committed with fresh ids. Every case runs in one rolled-back
 * transaction as postgres, so nothing is left behind for other test files.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { errorOf, fx, MANAGER, OWNER, REP_A, run, sqlstate, type Who } from "./helpers/db";
import { legacyOrderSql } from "./helpers/legacy-order";

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
const ONE_UNIT = 1;
const CHANNEL_SHAPE = "sales_order_channel_shape";
const REP_PATH_CLOSED = "reps no longer place orders: record an order card (D-30)";

const T_A = id(),
  AREA_A = id(),
  SALON = id(),
  SALON_2 = id(),
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
  await one(REP_A, "select app.create_salon($1, $2, 'ladies_parlor', $3, 'map_pin', null, 24.9, 67.1)", [
    SALON_2,
    `[Test] Cards second salon ${tag()}`,
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
    // A legacy row as the closed rep path (D-30) wrote it in migration 0012: it names neither the channel
    // nor the creator, so the column default (rep_visit) and control.sales_order_creator fill them in.
    const cid = id();
    const rows = await tx(`
      ${legacyOrderSql({ clientId: cid, salonId: SALON, skuId: SKU, qty: ONE_UNIT, unitPaisa: SKU_PRICE, repId: fx.repA.id, plan: "CASH", namesChannelAndCreator: false })}
      select source_channel::text, created_by = rep_id as by_rep, rep_id = '${fx.repA.id}' as is_rep_a, rep_day_id is not null as has_day,
             assigned_rep_id is null as no_assignee, intake_card_id is null as no_card
      from public.sales_order where client_id = '${cid}';`);
    expect(rows).toEqual([
      { source_channel: "rep_visit", by_rep: true, is_rep_a: true, has_day: true, no_assignee: true, no_card: true },
    ]);
  });

  it("the rep path that made those orders is closed for its own rep too (D-30)", async () => {
    const lines = `'${JSON.stringify([{ sku_id: SKU, qty: ONE_UNIT }])}'::jsonb`;
    const call = `
      reset role;
      select set_config('request.jwt.claims', '${JSON.stringify({ sub: fx.repA.id, role: "authenticated", aal: "aal1" })}', true),
             set_config('request.headers', '${JSON.stringify({ "x-kiran-device": fx.repA.device })}', true);
      set local role authenticated;
      select app.create_order('${id()}', '${SALON}', 'CASH', 'bag_now', ${lines});`;
    expect(await txCode(call)).toBe(DENIED);
    expect(await txError(call)).toContain(REP_PATH_CLOSED);
  });

  it("the channel decides the shape: rep_visit has a rep and a rep day, office has neither", async () => {
    const oid = id();
    const rows = await tx(
      `${officeOrder(oid)} select source_channel::text, rep_id, rep_day_id from public.sales_order where id = '${oid}';`,
    );
    expect(rows).toEqual([{ source_channel: "office", rep_id: null, rep_day_id: null }]);
    const repVisitNoDay = `insert into public.sales_order (id, client_id, salon_id, source_channel, created_by, rep_id, plan, delivery_mode, subtotal_paisa, total_paisa)
      values ('${oid}', '${oid}', '${SALON}', 'rep_visit', '${fx.repA.id}', '${fx.repA.id}', 'CASH', 'warehouse', ${SKU_PRICE}, ${SKU_PRICE});`;
    const badShapes = [officeOrder(id(), `'${fx.repA.id}'`), officeOrder(id(), "null", REP_DAY), repVisitNoDay];
    const results = await Promise.all(badShapes.map(async (sql) => [await txCode(sql), await txError(sql)]));
    // Each fails on the channel shape check itself, not on some other constraint.
    expect(results).toEqual(badShapes.map(() => [CHECK_VIOLATION, expect.stringContaining(CHANNEL_SHAPE)]));
  });

  it("a rep_visit order is created by its own rep: created_by differing from rep_id fails", async () => {
    const oid = id();
    const otherCreator = `insert into public.sales_order (id, client_id, salon_id, source_channel, created_by, rep_id, rep_day_id, plan, delivery_mode, subtotal_paisa, total_paisa)
      values ('${oid}', '${oid}', '${SALON}', 'rep_visit', '${fx.manager.id}', '${fx.repA.id}', ${REP_DAY}, 'CASH', 'warehouse', ${SKU_PRICE}, ${SKU_PRICE});`;
    expect(await txCode(otherCreator)).toBe(CHECK_VIOLATION);
    expect(await txError(otherCreator)).toContain(CHANNEL_SHAPE);
  });

  it("a rep cannot deliver a rep-less office order: the null rep_id does not slip past the ownership check", async () => {
    const oid = id();
    const confirmed = `insert into public.sales_order (id, client_id, salon_id, source_channel, created_by, plan, delivery_mode, status, subtotal_paisa, total_paisa, confirmed_at)
      values ('${oid}', '${oid}', '${SALON}', 'office', '${fx.manager.id}', 'CASH', 'warehouse', 'confirmed', ${SKU_PRICE}, ${SKU_PRICE}, now());`;
    const asRepA = `reset role;
      select set_config('request.jwt.claims', '${JSON.stringify({ sub: fx.repA.id, role: "authenticated", aal: "aal1" })}', true),
             set_config('request.headers', '${JSON.stringify({ "x-kiran-device": fx.repA.device })}', true);
      set local role authenticated;`;
    const deliver = `select app.rep_submit_delivery('${id()}', '${oid}', 'Ayesha at the counter', 24.9, 67.1);`;
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

// ------------------------------------------------------------------ card RPCs (task 4, ORD-14) ----
const DENIED = "42501";
const BAD_INPUT = "22023";
const DUPLICATE = "23505";
const CLOSED = "55000";
const FOUR_CHARS = "shut";
const REASON_MAX = 500;
const BODY = "two tubes of shade 5, one developer";

type P = "repA" | "repB" | "repAWrongDevice" | "manager" | "managerAal1" | "owner";
type Persona = "repA" | "repB" | "manager" | "owner";
const PERSONA: Record<P, Persona> = {
  repA: "repA",
  repB: "repB",
  repAWrongDevice: "repA",
  manager: "manager",
  managerAal1: "manager",
  owner: "owner",
};
const asUser = (k: P) => {
  const who = PERSONA[k];
  const aal = (who === "manager" || who === "owner") && k !== "managerAal1" ? "aal2" : "aal1";
  const device = k === "repAWrongDevice" ? "dev-not-approved-0000" : fx[who].device;
  return `
  reset role;
  select set_config('request.jwt.claims', '${JSON.stringify({ sub: fx[who].id, role: "authenticated", aal })}', true),
         set_config('request.headers', '${JSON.stringify({ "x-kiran-device": device })}', true);
  set local role authenticated;`;
};
type Step = [P | "postgres", string];
const steps = (list: Step[]) => list.map(([k, sql]) => `${k === "postgres" ? "reset role;" : asUser(k)}\n${sql}`).join("\n");
const stx = async (list: Step[]) => ((await run("postgres", steps(list))) as unknown as Multi).at(-1)?.rows ?? [];
const stxCode = (list: Step[]) => sqlstate("postgres", steps(list));
const stxError = (list: Step[]) => errorOf("postgres", steps(list));
const sqlId = (v: string | null) => (v === null ? "null" : `'${v}'`);

const openDay = (rep: "repA" | "repB"): Step => [
  "postgres",
  `insert into public.rep_day (rep_id, day) values ('${fx[rep].id}', ${TODAY}) on conflict (rep_id, day) do nothing;`,
];
// Closes any open day of rep A today, inside the rolled-back transaction, so "no open day" holds.
const noDay: Step = [
  "postgres",
  `update public.rep_day set status = 'closed' where rep_id = '${fx.repA.id}' and day = ${TODAY} and status = 'open';`,
];
const newCard = (who: P, cid: string, body = BODY, salon = SALON, visit: string | null = null): Step => [
  who,
  `select (app.rep_create_card('${cid}', '${salon}', '${body}', ${sqlId(visit)})).id;`,
];
const CARD_OF = (cid: string) => `(select c.id from public.order_intake_card c where c.client_id = '${cid}')`;
const cardLines = `'${JSON.stringify([{ sku_id: SKU, qty: 1 }])}'::jsonb`;
const convert = (who: P, cardCid: string, orderCid: string, rep: string | null = fx.repA.id, salon = SALON): Step => [
  who,
  `select (app.office_create_order('${orderCid}', '${salon}', 'CASH', ${cardLines}, ${sqlId(rep)}, ${CARD_OF(cardCid)})).id;`,
];
const dismiss = (who: P, cardCid: string, reason = GOOD_REASON): Step => [
  who,
  `select (app.office_dismiss_card(${CARD_OF(cardCid)}, '${reason}')).outcome;`,
];
const myCards = (who: P, cardCid: string): Step => [
  who,
  `select status, order_id is not null as has_order, reason, salon_name is not null as named, body
   from app.my_cards() where card_id = ${CARD_OF(cardCid)};`,
];

describe("a rep saves an order card (ORD-14, D-30)", () => {
  it("rep A saves a card on its open day; a replay returns the same card; a changed replay is 23505", async () => {
    const cid = id();
    const [a, b] = await stx([
      openDay("repA"),
      newCard("repA", cid),
      ["repA", `select (app.rep_create_card('${cid}', '${SALON}', '${BODY}')).id union all select ${CARD_OF(cid)};`],
    ]);
    expect(a.id).toBe(b.id);
    expect(await stxCode([openDay("repA"), newCard("repA", cid), newCard("repA", cid, "a different note")])).toBe(DUPLICATE);
    const [row] = await stx([
      openDay("repA"),
      newCard("repA", cid),
      [
        "postgres",
        `select rep_id, salon_id, body,
                rep_day_id = (select d.id from public.rep_day d where d.rep_id = '${fx.repA.id}' and d.day = ${TODAY}) as today
         from public.order_intake_card where client_id = '${cid}';`,
      ],
    ]);
    expect(row).toEqual({ rep_id: fx.repA.id, salon_id: SALON, body: BODY, today: true });
  });

  it("a blank or over-long body, or a visit that is not the rep's visit here today, is refused 22023", async () => {
    expect(await stxCode([openDay("repA"), newCard("repA", id(), "   ")])).toBe(BAD_INPUT);
    expect(await stxCode([openDay("repA"), newCard("repA", id(), "x".repeat(BODY_MAX + 1))])).toBe(BAD_INPUT);
    expect(await stxCode([openDay("repA"), newCard("repA", id(), BODY, SALON, id())])).toBe(BAD_INPUT);
  });

  it("another territory's rep, no open day, a wrong device and the office are refused 42501", async () => {
    expect(await stxError([openDay("repB"), newCard("repB", id())])).toContain("territories");
    expect(await stxCode([openDay("repB"), newCard("repB", id())])).toBe(DENIED);
    expect(await stxError([noDay, newCard("repA", id())])).toContain("check in before");
    expect(await stxCode([noDay, newCard("repA", id())])).toBe(DENIED);
    expect(await stxCode([openDay("repA"), newCard("repAWrongDevice", id())])).toBe(DENIED);
    expect(await stxCode([newCard("manager", id())])).toBe(DENIED);
    expect(await stxCode([newCard("owner", id())])).toBe(DENIED);
    expect(await sqlstate("anon", `select app.rep_create_card('${id()}', '${SALON}', 'x')`)).toBe(DENIED);
  });

  it("my_cards shows the rep its own card as open; rep B does not see rep A's card", async () => {
    const cid = id();
    const [mine] = await stx([openDay("repA"), newCard("repA", cid), myCards("repA", cid)]);
    expect(mine).toEqual({ status: "open", has_order: false, reason: null, named: true, body: BODY });
    expect(await stx([openDay("repA"), newCard("repA", cid), myCards("repB", cid)])).toEqual([]);
    expect(
      await stx([openDay("repA"), newCard("repA", cid), ["repB", "select count(*)::int n from public.order_intake_card;"]]),
    ).toEqual([{ n: 0 }]);
    expect(await stxCode([openDay("repA"), newCard("repA", cid), ["manager", "select * from app.my_cards();"]])).toBe(DENIED);
  });
});

describe("the office converts or dismisses a card (ORD-14, D-30)", () => {
  it("the manager sees an open card in office_open_cards with its salon and rep; a rep is refused 42501", async () => {
    const cid = id();
    const [row] = await stx([
      openDay("repA"),
      newCard("repA", cid),
      [
        "manager",
        `select salon_id, rep_id, body, salon_name is not null as named, rep_name is not null as rep_named
         from app.office_open_cards() where card_id = ${CARD_OF(cid)};`,
      ],
    ]);
    expect(row).toEqual({ salon_id: SALON, rep_id: fx.repA.id, body: BODY, named: true, rep_named: true });
    expect(await stxCode([["repA", "select * from app.office_open_cards();"]])).toBe(DENIED);
  });

  it("converting with rep A assigned makes an office order from the card and closes it converted, in one go", async () => {
    const [cid, ocid] = [id(), id()];
    const made: Step[] = [openDay("repA"), newCard("repA", cid), convert("manager", cid, ocid)];
    const rows = await stx([
      ...made,
      [
        "postgres",
        `select o.source_channel::text, o.assigned_rep_id, o.created_by, o.status::text,
                o.intake_card_id = ${CARD_OF(cid)} as from_card,
                k.outcome, k.order_id = o.id as close_points_here, k.closed_by, k.reason
         from public.sales_order o join public.order_intake_card_close k on k.card_id = o.intake_card_id
         where o.client_id = '${ocid}';`,
      ],
    ]);
    expect(rows).toEqual([
      {
        source_channel: "office",
        assigned_rep_id: fx.repA.id,
        created_by: fx.manager.id,
        status: "confirmed",
        from_card: true,
        outcome: "converted",
        close_points_here: true,
        closed_by: fx.manager.id,
        reason: null,
      },
    ]);
    expect(
      await stx([...made, ["manager", `select count(*)::int n from app.office_open_cards() where card_id = ${CARD_OF(cid)};`]]),
    ).toEqual([{ n: 0 }]);
    const [mine] = await stx([...made, myCards("repA", cid)]);
    expect(mine).toMatchObject({ status: "converted", has_order: true, reason: null });
  });

  it("a replay of the conversion returns the same order; a second conversion of the card is 55000 (Review Focus 1)", async () => {
    const [cid, ocid] = [id(), id()];
    const made: Step[] = [openDay("repA"), newCard("repA", cid), convert("manager", cid, ocid)];
    const [first, again] = await stx([
      ...made,
      [
        "manager",
        `select (app.office_create_order('${ocid}', '${SALON}', 'CASH', ${cardLines}, '${fx.repA.id}', ${CARD_OF(cid)})).id
         union all select o.id from public.sales_order o where o.client_id = '${ocid}';`,
      ],
    ]);
    expect(first.id).toBe(again.id);
    const twice: Step[] = [...made, convert("owner", cid, id())];
    expect(await stxCode(twice)).toBe(CLOSED);
    expect(await stxError(twice)).toContain("already closed");
  });

  it("the owner may assign no rep; the card's rep is not forced by the database", async () => {
    const [cid, ocid] = [id(), id()];
    const [o] = await stx([
      openDay("repA"),
      newCard("repA", cid),
      convert("owner", cid, ocid, null),
      ["postgres", `select assigned_rep_id, delivery_mode::text from public.sales_order where client_id = '${ocid}';`],
    ]);
    expect(o).toEqual({ assigned_rep_id: null, delivery_mode: "warehouse" });
  });

  it("a card for another salon, or an unknown card, is refused 22023", async () => {
    const cid = id();
    expect(await stxCode([openDay("repA"), newCard("repA", cid), convert("manager", cid, id(), fx.repA.id, SALON_2)])).toBe(
      BAD_INPUT,
    );
    const unknown = `select app.office_create_order('${id()}', '${SALON}', 'CASH', ${cardLines}, null, '${id()}');`;
    expect(await stxCode([["manager", unknown]])).toBe(BAD_INPUT);
  });

  it("dismissing needs a reason of 5+ characters (22023); a dismissed card shows its reason to the rep", async () => {
    const cid = id();
    expect(await stxCode([openDay("repA"), newCard("repA", cid), dismiss("manager", cid, FOUR_CHARS)])).toBe(BAD_INPUT);
    const [mine] = await stx([openDay("repA"), newCard("repA", cid), dismiss("manager", cid), myCards("repA", cid)]);
    expect(mine).toMatchObject({ status: "dismissed", has_order: false, reason: GOOD_REASON });
    const [k] = await stx([
      openDay("repA"),
      newCard("repA", cid),
      dismiss("owner", cid),
      ["postgres", `select outcome, closed_by, order_id from public.order_intake_card_close where card_id = ${CARD_OF(cid)};`],
    ]);
    expect(k).toEqual({ outcome: "dismissed", closed_by: fx.owner.id, order_id: null });
  });

  it("dismissed then converted, converted then dismissed, and dismissed twice are 55000 (Review Focus 4)", async () => {
    const cid = id();
    const base: Step[] = [openDay("repA"), newCard("repA", cid)];
    expect(await stxCode([...base, dismiss("manager", cid), convert("manager", cid, id())])).toBe(CLOSED);
    expect(await stxCode([...base, convert("manager", cid, id()), dismiss("manager", cid)])).toBe(CLOSED);
    expect(await stxCode([...base, dismiss("manager", cid), dismiss("owner", cid)])).toBe(CLOSED);
  });

  it("a rep cannot dismiss or convert a card (42501); an unknown card cannot be dismissed (22023)", async () => {
    const cid = id();
    expect(await stxCode([openDay("repA"), newCard("repA", cid), dismiss("repA", cid)])).toBe(DENIED);
    expect(await stxCode([openDay("repA"), newCard("repA", cid), convert("repA", cid, id())])).toBe(DENIED);
    expect(await stxCode([["manager", `select app.office_dismiss_card('${id()}', '${GOOD_REASON}');`]])).toBe(BAD_INPUT);
  });

  it("on a converted card the replay test runs before the closed test: same call returns the order, changed is 23505, new client_id is 55000", async () => {
    const [cid, ocid] = [id(), id()];
    const made: Step[] = [openDay("repA"), newCard("repA", cid), convert("manager", cid, ocid)];
    const [first, again] = await stx([
      ...made,
      [
        "manager",
        `select o.id from public.sales_order o where o.client_id = '${ocid}'
         union all
         select (app.office_create_order('${ocid}', '${SALON}', 'CASH', ${cardLines}, '${fx.repA.id}', ${CARD_OF(cid)})).id;`,
      ],
    ]);
    expect(again.id).toBe(first.id);
    expect(await stxCode([...made, convert("owner", cid, ocid)])).toBe(DUPLICATE);
    expect(await stxCode([...made, convert("manager", cid, id())])).toBe(CLOSED);
  });

  it("a dismissal reason over 500 characters is refused 22023; exactly 500 is accepted", async () => {
    const cid = id();
    const base: Step[] = [openDay("repA"), newCard("repA", cid)];
    expect(await stxCode([...base, dismiss("manager", cid, "x".repeat(REASON_MAX + 1))])).toBe(BAD_INPUT);
    expect(await stxCode([...base, dismiss("manager", cid, "x".repeat(REASON_MAX))])).toBeNull();
  });

  it("a manager without MFA (aal1) is refused 42501 on the queue, dismissal and conversion", async () => {
    const cid = id();
    const base: Step[] = [openDay("repA"), newCard("repA", cid)];
    expect(await stxCode([...base, ["managerAal1", "select * from app.office_open_cards();"]])).toBe(DENIED);
    expect(await stxCode([...base, dismiss("managerAal1", cid)])).toBe(DENIED);
    expect(await stxCode([...base, convert("managerAal1", cid, id())])).toBe(DENIED);
  });

  it("anon is refused 42501 on every card RPC; a null client_id is refused 22023", async () => {
    expect(await sqlstate("anon", "select * from app.my_cards()")).toBe(DENIED);
    expect(await sqlstate("anon", "select * from app.office_open_cards()")).toBe(DENIED);
    expect(await sqlstate("anon", `select app.office_dismiss_card('${id()}', '${GOOD_REASON}')`)).toBe(DENIED);
    const nullClient: Step = ["repA", `select app.rep_create_card(null, '${SALON}', '${BODY}');`];
    expect(await stxCode([openDay("repA"), nullClient])).toBe(BAD_INPUT);
    expect(await stxError([openDay("repA"), nullClient])).toContain("client_id");
  });
});
