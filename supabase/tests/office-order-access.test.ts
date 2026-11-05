/**
 * Assigned rep reads and delivers office orders (migration 20261104090000, PR A, D-30; MJ L-0374:
 * reps still deliver and collect as now). An office order may name an assigned rep: that rep reads
 * the order (my_orders, RLS on the order, its lines and deliveries, order_remaining, the invoice
 * document) and delivers it from the bag with app.rep_deliver. The invoice carries the assigned rep
 * (coalesce(assigned_rep_id, rep_id)); a rep-less office order delivered by the office has none.
 * Another rep reads and delivers nothing of it, and the assigned rep still cannot cancel it.
 * app.my_territory_orders lists the orders of salons the rep reaches; app.office_orders is the
 * office's list, filtered by status and channel.
 *
 * Catalogue, territories, salons and the warehouse are committed with fresh ids. Every case runs in
 * one rolled-back transaction (rep A's bag and its stock included), so nothing is left behind.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { errorOf, fx, MANAGER, OWNER, REP_A, REP_B, run, sqlstate, type Who } from "./helpers/db";
import { legacyOrderSql } from "./helpers/legacy-order";

const C = { commit: true };
const id = () => randomUUID();
const TAG_LENGTH = 8;
const tag = () => randomUUID().slice(0, TAG_LENGTH);
const one = async (who: Who, sql: string, params: unknown[] = []) => (await run(who, sql, params, C)).rows[0];
const TODAY = "(now() at time zone 'Asia/Karachi')::date";

const UNIT = 100000; // one unit lists at Rs 1,000
const DISCOUNTED = 90000; // Rs 900: a discount, so a manager's order waits as a draft
const INST4_QTY = 4;
const STOCK_QTY = 1000;
const BAG_QTY = 40;
const BAG_LIMIT = 50000000;
const CREDIT_LIMIT = 100000000;
const GROUP_CYCLE_DAYS = 21;
const SKU_SIZE = 100;
const DENIED = "42501";
const CHECK_VIOLATION = "23514";

const T_A = id(),
  AREA_A = id(),
  T_B = id(),
  AREA_B = id();
const SALON = id(),
  SALON_B = id();
const GROUP = id(),
  PRODUCT = id(),
  SKU = id(),
  WH = id();
const BAG_A = `(select l.id from public.stock_location l where l.kind = 'rep_bag' and l.owner_user_id = '${fx.repA.id}')`;

type P = "repA" | "repAWrongDevice" | "suspendedRep" | "repB" | "manager" | "managerAal1" | "owner";
const WRONG_DEVICE = "dev-not-approved-0000";
// The fixture person behind each test persona.
const PERSON: Record<P, "repA" | "suspendedRep" | "repB" | "manager" | "owner"> = {
  repA: "repA",
  repAWrongDevice: "repA",
  suspendedRep: "suspendedRep",
  repB: "repB",
  manager: "manager",
  managerAal1: "manager",
  owner: "owner",
};
const asUser = (k: P) => {
  const who = PERSON[k];
  const device = k === "repAWrongDevice" ? WRONG_DEVICE : fx[who].device;
  const aal = k.startsWith("rep") || k === "suspendedRep" || k === "managerAal1" ? "aal1" : "aal2";
  return `
  reset role;
  select set_config('request.jwt.claims', '${JSON.stringify({ sub: fx[who].id, role: "authenticated", aal })}', true),
         set_config('request.headers', '${JSON.stringify({ "x-kiran-device": device })}', true);
  set local role authenticated;`;
};
type Step = [P | "postgres", string];
// Rep A has an open day and a bag holding BAG_QTY units, inside the test's own transaction.
const prelude = `
  insert into public.rep_day (rep_id, day) values ('${fx.repA.id}', ${TODAY}) on conflict (rep_id, day) do nothing;
  ${asUser("owner")}
  select app.office_create_location('${id()}', 'rep_bag', '[Test] Office access bag A', '${fx.repA.id}', ${BAG_LIMIT})
   where not exists (select 1 from public.stock_location l where l.kind = 'rep_bag' and l.owner_user_id = '${fx.repA.id}');
  reset role;
  insert into public.stock_movement (client_id, sku_id, qty, from_location_id, to_location_id, kind, actor_id)
  values (gen_random_uuid(), '${SKU}', ${BAG_QTY}, '${WH}', ${BAG_A}, 'issue_to_rep', '${fx.manager.id}');`;
const script = (steps: Step[]) =>
  `${prelude}\n${steps.map(([k, sql]) => `${k === "postgres" ? "reset role;" : asUser(k)}\n${sql}`).join("\n")}`;
type Multi = Array<{ rows: Array<Record<string, unknown>> }>;
const tx = async (steps: Step[]) => ((await run("postgres", script(steps))) as unknown as Multi).at(-1)?.rows ?? [];
const txCode = (steps: Step[]) => sqlstate("postgres", script(steps));
const txError = (steps: Step[]) => errorOf("postgres", script(steps));

const lines = (qty: number, unitPrice?: number) =>
  `'${JSON.stringify([{ sku_id: SKU, qty, ...(unitPrice === undefined ? {} : { unit_price_paisa: unitPrice }) }])}'::jsonb`;
const sqlId = (v: string | null) => (v === null ? "null" : `'${v}'`);
// A rep's RLS may hide the order, so its id is pinned as postgres in a transaction setting and read back
// from there: a rep is then refused (or shown nothing) for the order itself, never for a null id.
const pin = (ocid: string, dcid?: string): Step => [
  "postgres",
  `select set_config('kiran_test.order', (select o.id::text from public.sales_order o where o.client_id = '${ocid}'), true),
          set_config('kiran_test.invoice', coalesce((select i.id::text from public.invoice i join public.delivery d
            on d.id = i.delivery_id where d.client_id = '${dcid ?? ocid}'), ''), true);`,
];
const OID = "current_setting('kiran_test.order')::uuid";
const IID = "nullif(current_setting('kiran_test.invoice'), '')::uuid";
type OrderArgs = { salon?: string; plan?: string; qty?: number; unitPrice?: number; rep?: string | null };
const officeOrder = (cid: string, a: OrderArgs = {}, who: P = "manager"): Step => [
  who,
  `select (app.office_create_order('${cid}', '${a.salon ?? SALON}', '${a.plan ?? "INST4"}', ${lines(a.qty ?? INST4_QTY, a.unitPrice)},
           ${sqlId(a.rep ?? null)})).id;`,
];
// A legacy rep_visit order (the shape the retired rep path left): rep A's own confirmed order, built directly.
const repOrder = (cid: string): Step => [
  "postgres",
  legacyOrderSql({
    clientId: cid,
    salonId: SALON,
    skuId: SKU,
    qty: INST4_QTY,
    unitPaisa: UNIT,
    repId: fx.repA.id,
    plan: "INST4",
  }),
];
// Pins the order first, then delivers it as the given person.
const repDeliver = (dcid: string, ocid: string, who: P = "repA"): Step[] => [
  pin(ocid),
  [who, `select (app.rep_deliver('${dcid}', ${OID}, 'Ayesha at the counter', 24.9, 67.1)).id;`],
];
const officeDeliver = (dcid: string, ocid: string): Step[] => [
  pin(ocid),
  ["manager", `select (app.office_deliver('${dcid}', ${OID}, '${WH}', 'Ayesha at the counter')).id;`],
];
// The invoice of a delivery, its installments and the order's status, read as postgres.
const invoiceOf = (dcid: string): Step => [
  "postgres",
  `select i.rep_id, i.total_paisa, o.status::text as order_status, d.delivered_by_role::text as role,
          (select count(*)::int from public.installment x where x.invoice_id = i.id) as installments,
          (select coalesce(sum(x.amount_due_paisa), 0)::bigint from public.installment x where x.invoice_id = i.id) as due
   from public.delivery d join public.invoice i on i.delivery_id = d.id join public.sales_order o on o.id = d.order_id
   where d.client_id = '${dcid}';`,
];

beforeAll(async () => {
  await one(MANAGER, "select app.office_upsert_territory($1, $2)", [T_A, `[Test] Office access A ${tag()}`]);
  await one(MANAGER, "select app.office_upsert_area($1, $2, '[Test] Office access area A')", [AREA_A, T_A]);
  await one(MANAGER, "select app.office_assign_territory($1, $2)", [fx.repA.id, T_A]);
  await one(MANAGER, "select app.office_upsert_territory($1, $2)", [T_B, `[Test] Office access B ${tag()}`]);
  await one(MANAGER, "select app.office_upsert_area($1, $2, '[Test] Office access area B')", [AREA_B, T_B]);
  await one(MANAGER, "select app.office_assign_territory($1, $2)", [fx.repB.id, T_B]);
  await one(REP_A, "select app.create_salon($1, $2, 'ladies_parlor', $3, 'map_pin', null, 24.9, 67.1)", [
    SALON,
    `[Test] Office access salon A ${tag()}`,
    AREA_A,
  ]);
  await one(REP_B, "select app.create_salon($1, $2, 'ladies_parlor', $3, 'map_pin', null, 24.9, 67.1)", [
    SALON_B,
    `[Test] Office access salon B ${tag()}`,
    AREA_B,
  ]);
  await one(OWNER, "select app.owner_set_credit($1, 'INST4', $2, 'office access tests, owner decision')", [SALON, CREDIT_LIMIT]);
  await one(OWNER, "select app.owner_set_credit($1, 'INST4', $2, 'office access tests, owner decision')", [
    SALON_B,
    CREDIT_LIMIT,
  ]);
  await one(MANAGER, "select app.office_upsert_product_group($1, $2, $3)", [
    GROUP,
    `[Test] Office access colour ${tag()}`,
    GROUP_CYCLE_DAYS,
  ]);
  await one(MANAGER, "select app.office_upsert_product($1, $2, '[Dummy] Kiran', '[Dummy] Office access colour')", [
    PRODUCT,
    GROUP,
  ]);
  await one(MANAGER, "select app.office_upsert_sku($1, $2, $3, '[Dummy] shade', 'ml', $4)", [
    SKU,
    PRODUCT,
    `T-OFA-${tag().toUpperCase()}`,
    SKU_SIZE,
  ]);
  await one(OWNER, "select app.owner_set_sku_price($1, $2, 'dummy list price')", [SKU, UNIT]);
  await one(MANAGER, "select app.office_create_location($1, 'warehouse', '[Test] Office access store')", [WH]);
  await one(
    "postgres",
    `insert into public.stock_movement (client_id, sku_id, qty, to_location_id, kind, actor_id)
     values (gen_random_uuid(), $1, $2, $3, 'receipt', $4)`,
    [SKU, STOCK_QTY, WH, fx.manager.id],
  );
});

afterAll(async () => {
  await one(MANAGER, "select app.office_end_territory($1, $2, 'office access tests finished')", [fx.repA.id, T_A]);
  await one(MANAGER, "select app.office_end_territory($1, $2, 'office access tests finished')", [fx.repB.id, T_B]);
});

describe("the assigned rep delivers an office order (D-30, L-0374)", () => {
  it("rep A delivers an office order assigned to rep A: invoice and installments as today, invoice rep is A", async () => {
    const [ocid, dcid] = [id(), id()];
    const [inv] = await tx([officeOrder(ocid, { rep: fx.repA.id }), ...repDeliver(dcid, ocid), invoiceOf(dcid)]);
    expect(inv).toMatchObject({ rep_id: fx.repA.id, order_status: "delivered", role: "rep" });
    expect(Number(inv.total_paisa)).toBe(UNIT * INST4_QTY);
    expect(inv.installments).toBeGreaterThan(0);
    expect(Number(inv.due)).toBe(UNIT * INST4_QTY);
  });

  it("rep B cannot deliver rep A's assigned order (42501, 'own orders')", async () => {
    const ocid = id();
    const steps = [officeOrder(ocid, { rep: fx.repA.id }), ...repDeliver(id(), ocid, "repB")];
    expect(await txCode(steps)).toBe(DENIED);
    expect(await txError(steps)).toContain("own orders");
  });

  it("a rep-less office order is delivered by the office and its invoice has no rep", async () => {
    const [ocid, dcid] = [id(), id()];
    const [inv] = await tx([officeOrder(ocid), ...officeDeliver(dcid, ocid), invoiceOf(dcid)]);
    expect(inv).toMatchObject({ rep_id: null, order_status: "delivered", role: "manager" });
  });

  it("an assigned office order delivered by the office still carries the assigned rep on its invoice", async () => {
    const [ocid, dcid] = [id(), id()];
    const [inv] = await tx([officeOrder(ocid, { rep: fx.repA.id }), ...officeDeliver(dcid, ocid), invoiceOf(dcid)]);
    expect(inv).toMatchObject({ rep_id: fx.repA.id, order_status: "delivered", role: "manager" });
  });

  it("a legacy rep_visit order still delivers for its rep", async () => {
    const [ocid, dcid] = [id(), id()];
    const [inv] = await tx([repOrder(ocid), ...repDeliver(dcid, ocid), invoiceOf(dcid)]);
    expect(inv).toMatchObject({ rep_id: fx.repA.id, order_status: "delivered", role: "rep" });
  });

  it("the assigned rep cannot cancel the office order, even a draft (42501)", async () => {
    const ocid = id();
    const cancel: Step = ["repA", `select (app.cancel_order(${OID}, 'salon changed its mind')).id;`];
    const [draft] = await tx([
      officeOrder(ocid, { rep: fx.repA.id, unitPrice: DISCOUNTED }),
      ["postgres", `select status::text from public.sales_order where client_id = '${ocid}';`],
    ]);
    expect(draft.status).toBe("draft");
    const steps = [officeOrder(ocid, { rep: fx.repA.id, unitPrice: DISCOUNTED }), pin(ocid), cancel];
    expect(await txCode(steps)).toBe(DENIED);
    expect(await txError(steps)).toContain("a rep cancels only its own draft");
  });

  it("no rep cancels a rep-less office draft: the null rep_id does not slip past the cancel check", async () => {
    const ocid = id();
    const steps = (who: P): Step[] => [
      officeOrder(ocid, { unitPrice: DISCOUNTED }),
      pin(ocid),
      [who, `select (app.cancel_order(${OID}, 'salon changed its mind')).id;`],
    ];
    expect(await txCode(steps("repA"))).toBe(DENIED);
    expect(await txCode(steps("repB"))).toBe(DENIED);
  });

  it("no rep rechecks a rep-less office order: the null rep_id does not slip past the recheck check", async () => {
    const ocid = id();
    expect(await txCode([officeOrder(ocid), pin(ocid), ["repA", `select app.recheck_order(${OID});`]])).toBe(DENIED);
  });

  it("no rep reads the invoice document of a rep-less office order (the invoice has no rep)", async () => {
    const [ocid, dcid] = [id(), id()];
    const [r] = await tx([
      officeOrder(ocid),
      ...officeDeliver(dcid, ocid),
      pin(ocid, dcid),
      ["repA", `select app.invoice_document(${IID}) is null as hidden, ${IID} is not null as pinned;`],
    ]);
    expect(r).toEqual({ hidden: true, pinned: true });
  });

  it("the assigned rep may not recheck the office order (a recheck can confirm a draft, a write); nor may rep B", async () => {
    const ocid = id();
    const as = (who: P): Step[] => [
      officeOrder(ocid, { rep: fx.repA.id, unitPrice: DISCOUNTED }),
      pin(ocid),
      [who, `select app.recheck_order(${OID});`],
    ];
    expect(await txCode(as("repA"))).toBe(DENIED);
    expect(await txError(as("repA"))).toContain("only the order's rep or the office");
    expect(await txCode(as("repB"))).toBe(DENIED);
  });

  it("a legacy rep_visit order's own rep still rechecks it", async () => {
    const ocid = id();
    const [o] = await tx([repOrder(ocid), pin(ocid), ["repA", `select (app.recheck_order(${OID})).status::text as status;`]]);
    expect(o.status).toBe("confirmed");
  });

  it("a rep_visit order cannot carry an assigned rep (sales_order_channel_shape, 23514)", async () => {
    const oid = id();
    const insert: Step = [
      "postgres",
      `insert into public.sales_order (id, client_id, salon_id, source_channel, created_by, rep_id, rep_day_id, assigned_rep_id,
                                       plan, delivery_mode, subtotal_paisa, total_paisa)
       values ('${oid}', '${oid}', '${SALON}', 'rep_visit', '${fx.repA.id}', '${fx.repA.id}',
               (select d.id from public.rep_day d where d.rep_id = '${fx.repA.id}' and d.day = ${TODAY}), '${fx.repA.id}',
               'CASH', 'bag_now', ${UNIT}, ${UNIT});`,
    ];
    expect(await txCode([insert])).toBe(CHECK_VIOLATION);
  });

  it("rep A on an unapproved phone cannot deliver its assigned order (42501, device check)", async () => {
    const ocid = id();
    const steps = [officeOrder(ocid, { rep: fx.repA.id }), ...repDeliver(id(), ocid, "repAWrongDevice")];
    expect(await txCode(steps)).toBe(DENIED);
    expect(await txError(steps)).toContain("device");
  });
});

describe("the assigned rep reads the office order; another rep does not", () => {
  // What a rep sees of one office order and its delivery, through every read path.
  const sees = (who: P, ocid: string, dcid: string): Step => [
    who,
    `select
       (select count(*)::int from app.my_orders() m where m.id = ${OID}) as my_orders,
       (select count(*)::int from app.my_territory_orders() t where t.order_id = ${OID}) as territory,
       (select count(*)::int from public.sales_order o where o.client_id = '${ocid}') as order_rows,
       (select count(*)::int from public.sales_order_line l join public.sales_order o on o.id = l.order_id
         where o.client_id = '${ocid}') as line_rows,
       (select count(*)::int from public.delivery d where d.client_id = '${dcid}') as delivery_rows,
       (select count(*)::int from public.delivery_line dl join public.delivery d on d.id = dl.delivery_id
         where d.client_id = '${dcid}') as delivery_line_rows,
       (select count(*)::int from public.invoice i join public.delivery d on d.id = i.delivery_id
         where d.client_id = '${dcid}') as invoice_rows,
       (select count(*)::int from app.order_remaining(${OID})) as remaining_rows,
       app.invoice_document(${IID}) is not null as document;`,
  ];
  // The office order is partly delivered by the office, so it has a delivery, an invoice and lines left.
  const partly = (ocid: string, dcid: string): Step[] => [
    officeOrder(ocid, { rep: fx.repA.id }),
    pin(ocid),
    [
      "manager",
      `select (app.office_deliver('${dcid}', ${OID}, '${WH}', 'Ayesha at the counter',
                  '${JSON.stringify([{ sku_id: SKU, qty: 1 }])}'::jsonb)).id;`,
    ],
    pin(ocid, dcid),
  ];

  it("rep A, the assigned rep, sees the order, its lines, delivery, invoice and what is left", async () => {
    const [ocid, dcid] = [id(), id()];
    const [r] = await tx([...partly(ocid, dcid), sees("repA", ocid, dcid)]);
    expect(r).toEqual({
      my_orders: 1,
      territory: 1,
      order_rows: 1,
      line_rows: 1,
      delivery_rows: 1,
      delivery_line_rows: 1,
      invoice_rows: 1,
      remaining_rows: 1,
      document: true,
    });
  });

  it("a rep-less office order in rep A's own territory is listed in my_territory_orders and hidden everywhere else", async () => {
    const [ocid, dcid] = [id(), id()];
    const repLess: Step[] = [
      officeOrder(ocid),
      pin(ocid),
      [
        "manager",
        `select (app.office_deliver('${dcid}', ${OID}, '${WH}', 'Ayesha at the counter',
                    '${JSON.stringify([{ sku_id: SKU, qty: 1 }])}'::jsonb)).id;`,
      ],
      pin(ocid, dcid),
    ];
    const [shape] = await tx([
      ...repLess,
      ["postgres", `select source_channel::text, rep_id, assigned_rep_id from public.sales_order where client_id = '${ocid}';`],
    ]);
    expect(shape).toEqual({ source_channel: "office", rep_id: null, assigned_rep_id: null });
    const [r] = await tx([...repLess, sees("repA", ocid, dcid)]);
    expect(r).toEqual({
      my_orders: 0,
      territory: 1,
      order_rows: 0,
      line_rows: 0,
      delivery_rows: 0,
      delivery_line_rows: 0,
      invoice_rows: 0,
      remaining_rows: 0,
      document: false,
    });
    const deliver = [...repLess, ...repDeliver(id(), ocid)];
    expect(await txCode(deliver)).toBe(DENIED);
    expect(await txError(deliver)).toContain("own orders");
    const internal: Step = [
      "repA",
      `select app.finalise_delivery('${id()}', ${OID}, ${BAG_A}, null, 'Ayesha at the counter', 24.9, 67.1, false, null, null, '${fx.repA.id}', 'rep');`,
    ];
    expect(await txCode([...repLess, internal])).toBe(DENIED);
  });

  it("rep B sees none of it", async () => {
    const [ocid, dcid] = [id(), id()];
    const [r] = await tx([...partly(ocid, dcid), sees("repB", ocid, dcid)]);
    expect(r).toEqual({
      my_orders: 0,
      territory: 0,
      order_rows: 0,
      line_rows: 0,
      delivery_rows: 0,
      delivery_line_rows: 0,
      invoice_rows: 0,
      remaining_rows: 0,
      document: false,
    });
  });
});

describe("app.my_territory_orders", () => {
  // The rep's RLS hides orders it is not on, so the client_id -> order id map is pinned as postgres.
  const listed = (who: P, cids: string[]): Step[] => [
    [
      "postgres",
      `select set_config('kiran_test.ids', (select jsonb_object_agg(o.client_id::text, o.id::text)::text
         from public.sales_order o where o.client_id in (${cids.map((c) => `'${c}'`).join(", ")})), true);`,
    ],
    [
      who,
      `select m.key as cid, t.salon_name, t.status::text as status, t.plan::text as plan, t.total_paisa, t.assigned_rep_id
       from app.my_territory_orders() t
       join jsonb_each_text(current_setting('kiran_test.ids')::jsonb) m on m.value::uuid = t.order_id
       order by m.key;`,
    ],
  ];

  it("lists the orders of salons in the rep's territories, whoever made them, and nothing of territory B", async () => {
    const [mine, unassigned, other] = [id(), id(), id()];
    const make: Step[] = [
      officeOrder(mine, { rep: fx.repA.id }),
      officeOrder(unassigned),
      officeOrder(other, { salon: SALON_B }),
    ];
    const forA = await tx([...make, ...listed("repA", [mine, unassigned, other])]);
    expect(forA.map((r) => r.cid).sort()).toEqual([mine, unassigned].sort());
    expect(forA.every((r) => typeof r.salon_name === "string" && r.status === "confirmed" && r.plan === "INST4")).toBe(true);
    expect(forA.find((r) => r.cid === mine)?.assigned_rep_id).toBe(fx.repA.id);
    expect(forA.find((r) => r.cid === unassigned)?.assigned_rep_id).toBeNull();
    const forB = await tx([...make, ...listed("repB", [mine, unassigned, other])]);
    expect(forB.map((r) => r.cid)).toEqual([other]);
  });

  it("is for reps on their approved phone: a wrong device, a suspended rep, the office and anon are refused 42501", async () => {
    expect(await txCode([["repAWrongDevice", "select * from app.my_territory_orders();"]])).toBe(DENIED);
    expect(await txCode([["suspendedRep", "select * from app.my_territory_orders();"]])).toBe(DENIED);
    expect(await sqlstate(MANAGER, "select * from app.my_territory_orders()")).toBe(DENIED);
    expect(await sqlstate(OWNER, "select * from app.my_territory_orders()")).toBe(DENIED);
    expect(await sqlstate("anon", "select * from app.my_territory_orders()")).toBe(DENIED);
  });
});

describe("app.office_orders", () => {
  const listed = (status: string | null, channel: string | null, cids: string[]): Step => [
    "manager",
    `select o.client_id::text as cid from app.office_orders(${status === null ? "null" : `'${status}'`},
                                                     ${channel === null ? "null" : `'${channel}'`}) o
     where o.client_id in (${cids.map((c) => `'${c}'`).join(", ")}) order by o.client_id;`,
  ];

  it("filters by status and channel", async () => {
    const [office, draft, rep] = [id(), id(), id()];
    const make: Step[] = [officeOrder(office), officeOrder(draft, { unitPrice: DISCOUNTED }), repOrder(rep)];
    const all = [office, draft, rep];
    const cids = async (status: string | null, channel: string | null) =>
      (await tx([...make, listed(status, channel, all)])).map((r) => r.cid);
    expect(await cids(null, null)).toEqual([...all].sort());
    expect(await cids("confirmed", "office")).toEqual([office]);
    expect(await cids("draft", null)).toEqual([draft]);
    expect(await cids(null, "rep_visit")).toEqual([rep]);
    expect(await cids(null, "office")).toEqual([office, draft].sort());
  });

  it("refuses reps and a manager without MFA (42501)", async () => {
    expect(await sqlstate(REP_A, "select * from app.office_orders()")).toBe(DENIED);
    expect(await txCode([["managerAal1", "select * from app.office_orders();"]])).toBe(DENIED);
    expect(await sqlstate("anon", "select * from app.office_orders()")).toBe(DENIED);
  });
});
