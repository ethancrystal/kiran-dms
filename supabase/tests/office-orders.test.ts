/**
 * Office order creation (migration 20261104090000, PR A, D-30): the owner or a manager makes an
 * order with app.office_create_order. It goes through the builder the rep path used until D-30 closed
 * it (app.build_order: line validation, discount approval, insert, credit and discount checks), with
 * source_channel 'office', created_by the caller and no rep or rep day. An assigned rep must be an
 * active rep covering the salon's territory. Reps and an office user without MFA (aal1) are refused.
 *
 * Catalogue, territories and salons are committed with fresh ids. Every case runs in one rolled-back
 * transaction, so no order is left behind for other test files.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { errorOf, fx, MANAGER, OWNER, REP_A, REP_B, run, sqlstate, type Who } from "./helpers/db";

const C = { commit: true };
const id = () => randomUUID();
const TAG_LENGTH = 8;
const tag = () => randomUUID().slice(0, TAG_LENGTH);
const one = async (who: Who, sql: string, params: unknown[] = []) => (await run(who, sql, params, C)).rows[0];

const UNIT = 100000; // one unit lists at Rs 1,000
const DISCOUNTED = 90000; // Rs 900: below the list price, so a discount
const DEEP_DISCOUNT = 50000; // Rs 500: 50% off, above the owner threshold (approval.discount.owner_above, 10%)
const INST4_QTY = 4;
const CREDIT_LIMIT = 100000000;
const LOW_LIMIT = UNIT; // Rs 1,000: four units on INST4 go over it
const GROUP_CYCLE_DAYS = 21;
const SKU_SIZE = 100;
const DENIED = "42501";
const BAD_INPUT = "22023";
const DUPLICATE = "23505";
const CHECK_VIOLATION = "23514";
const REP_PATH_CLOSED = "reps no longer place orders: record an order card (D-30)";

const T_A = id(),
  AREA_A = id(),
  T_B = id(),
  AREA_B = id();
const SALON = id(),
  SALON_LOW = id();
const GROUP = id(),
  PRODUCT = id(),
  SKU = id();

type P = "repA" | "manager" | "managerAal1" | "owner";
const PERSON: Record<P, "repA" | "manager" | "owner"> = {
  repA: "repA",
  manager: "manager",
  managerAal1: "manager",
  owner: "owner",
};
const asUser = (k: P) => {
  const who = PERSON[k];
  const aal = k === "repA" || k === "managerAal1" ? "aal1" : "aal2";
  return `
  reset role;
  select set_config('request.jwt.claims', '${JSON.stringify({ sub: fx[who].id, role: "authenticated", aal })}', true),
         set_config('request.headers', '${JSON.stringify({ "x-kiran-device": fx[who].device })}', true);
  set local role authenticated;`;
};
type Step = [P | "postgres", string];
const script = (steps: Step[]) => steps.map(([k, sql]) => `${k === "postgres" ? "reset role;" : asUser(k)}\n${sql}`).join("\n");
type Multi = Array<{ rows: Array<Record<string, unknown>> }>;
const tx = async (steps: Step[]) => ((await run("postgres", script(steps))) as unknown as Multi).at(-1)?.rows ?? [];
const txCode = (steps: Step[]) => sqlstate("postgres", script(steps));
const txError = (steps: Step[]) => errorOf("postgres", script(steps));

const lines = (qty: number, unitPrice?: number) =>
  `'${JSON.stringify([{ sku_id: SKU, qty, ...(unitPrice === undefined ? {} : { unit_price_paisa: unitPrice }) }])}'::jsonb`;
const sqlId = (v: string | null) => (v === null ? "null" : `'${v}'`);
type OrderArgs = { salon?: string; plan?: string; qty?: number; unitPrice?: number; rep?: string | null; card?: string | null };
const create = (who: P, cid: string, a: OrderArgs = {}): Step => [
  who,
  `select (app.office_create_order('${cid}', '${a.salon ?? SALON}', '${a.plan ?? "CASH"}', ${lines(a.qty ?? 1, a.unitPrice)},
           ${sqlId(a.rep ?? null)}, ${sqlId(a.card ?? null)})).id;`,
];
const order = (cid: string): Step => [
  "postgres",
  `select o.id, o.status, o.source_channel, o.created_by, o.rep_id, o.rep_day_id, o.assigned_rep_id, o.delivery_mode,
          o.hold_credit, o.hold_discount, o.total_paisa, o.discount_paisa, o.discount_by_owner,
          a.kind as approval_kind, a.maker_id as approval_maker,
          (select count(*)::int from control.approval_request r where r.subject_type = 'sales_order' and r.subject_id = o.id) as approvals
   from public.sales_order o left join control.approval_request a on a.id = o.discount_approval_id
   where o.client_id = '${cid}';`,
];
const APPROVAL_OF = (cid: string) => `(select o.discount_approval_id from public.sales_order o where o.client_id = '${cid}')`;
const ORDER_OF = (cid: string) => `(select o.id from public.sales_order o where o.client_id = '${cid}')`;
const TODAY = "(now() at time zone 'Asia/Karachi')::date";
const OPEN_DAY: Step = [
  "postgres",
  `insert into public.rep_day (rep_id, day) values ('${fx.repA.id}', ${TODAY}) on conflict (rep_id, day) do nothing;`,
];

beforeAll(async () => {
  await one(MANAGER, "select app.office_upsert_territory($1, $2)", [T_A, `[Test] Office orders A ${tag()}`]);
  await one(MANAGER, "select app.office_upsert_area($1, $2, '[Test] Office orders area A')", [AREA_A, T_A]);
  await one(MANAGER, "select app.office_assign_territory($1, $2)", [fx.repA.id, T_A]);
  await one(MANAGER, "select app.office_upsert_territory($1, $2)", [T_B, `[Test] Office orders B ${tag()}`]);
  await one(MANAGER, "select app.office_upsert_area($1, $2, '[Test] Office orders area B')", [AREA_B, T_B]);
  await one(MANAGER, "select app.office_assign_territory($1, $2)", [fx.repB.id, T_B]);
  await one(REP_A, "select app.create_salon($1, $2, 'ladies_parlor', $3, 'map_pin', null, 24.9, 67.1)", [
    SALON,
    `[Test] Office orders salon ${tag()}`,
    AREA_A,
  ]);
  await one(REP_A, "select app.create_salon($1, $2, 'ladies_parlor', $3, 'map_pin', null, 24.9, 67.1)", [
    SALON_LOW,
    `[Test] Office orders low-limit salon ${tag()}`,
    AREA_A,
  ]);
  await one(OWNER, "select app.owner_set_credit($1, 'INST4', $2, 'office order tests, owner decision')", [SALON, CREDIT_LIMIT]);
  await one(OWNER, "select app.owner_set_credit($1, 'INST4', $2, 'office order tests, owner decision')", [SALON_LOW, LOW_LIMIT]);
  await one(MANAGER, "select app.office_upsert_product_group($1, $2, $3)", [
    GROUP,
    `[Test] Office orders colour ${tag()}`,
    GROUP_CYCLE_DAYS,
  ]);
  await one(MANAGER, "select app.office_upsert_product($1, $2, '[Dummy] Kiran', '[Dummy] Office orders colour')", [
    PRODUCT,
    GROUP,
  ]);
  await one(MANAGER, "select app.office_upsert_sku($1, $2, $3, '[Dummy] shade', 'ml', $4)", [
    SKU,
    PRODUCT,
    `T-OFO-${tag().toUpperCase()}`,
    SKU_SIZE,
  ]);
  await one(OWNER, "select app.owner_set_sku_price($1, $2, 'dummy list price')", [SKU, UNIT]);
});

afterAll(async () => {
  await one(MANAGER, "select app.office_end_territory($1, $2, 'office order tests finished')", [fx.repA.id, T_A]);
  await one(MANAGER, "select app.office_end_territory($1, $2, 'office order tests finished')", [fx.repB.id, T_B]);
});

describe("the office creates orders (D-30)", () => {
  it.each([
    ["manager", "CASH"],
    ["manager", "INST4"],
    ["owner", "CASH"],
    ["owner", "INST4"],
  ] as const)("%s creates a %s order: confirmed, channel office, created by the caller, no rep", async (who, plan) => {
    const cid = id();
    const [o] = await tx([create(who, cid, { plan, qty: INST4_QTY }), order(cid)]);
    expect(o).toMatchObject({
      status: "confirmed",
      source_channel: "office",
      created_by: fx[who].id,
      rep_id: null,
      rep_day_id: null,
      assigned_rep_id: null,
      delivery_mode: "warehouse",
      hold_credit: null,
      hold_discount: null,
    });
    expect(Number(o.total_paisa)).toBe(UNIT * INST4_QTY);
  });

  it("an assigned rep covering the salon's territory is accepted and the order is delivered from the bag", async () => {
    const cid = id();
    const [o] = await tx([create("manager", cid, { rep: fx.repA.id }), order(cid)]);
    expect(o).toMatchObject({ status: "confirmed", assigned_rep_id: fx.repA.id, rep_id: null, delivery_mode: "bag_now" });
  });

  it("a rep of another territory, or a manager, as the assigned rep is refused 22023", async () => {
    expect(await txCode([create("manager", id(), { rep: fx.repB.id })])).toBe(BAD_INPUT);
    expect(await txCode([create("manager", id(), { rep: fx.manager.id })])).toBe(BAD_INPUT);
    expect(await txCode([create("owner", id(), { rep: id() })])).toBe(BAD_INPUT);
  });

  it("a suspended rep, even in the salon's territory, as the assigned rep is refused 22023", async () => {
    const suspend: Step = ["owner", `select app.owner_set_status('${fx.repA.id}', 'suspended', '[Test] on leave');`];
    expect(await txError([suspend, create("manager", id(), { rep: fx.repA.id })])).toContain("active rep");
    expect(await txCode([suspend, create("manager", id(), { rep: fx.repA.id })])).toBe(BAD_INPUT);
  });

  it("a rep and a manager without MFA (aal1) are refused 42501", async () => {
    expect(await txCode([create("repA", id())])).toBe(DENIED);
    expect(await txCode([create("managerAal1", id())])).toBe(DENIED);
    expect(await sqlstate(REP_B, `select app.office_create_order('${id()}', '${SALON}', 'CASH', ${lines(1)})`)).toBe(DENIED);
    expect(await sqlstate("anon", `select app.office_create_order('${id()}', '${SALON}', 'CASH', ${lines(1)})`)).toBe(DENIED);
  });

  it("a discount line requests a discount approval made by the manager and holds the order as a draft", async () => {
    const cid = id();
    const [o] = await tx([create("manager", cid, { unitPrice: DISCOUNTED }), order(cid)]);
    expect(o).toMatchObject({
      status: "draft",
      hold_discount: "pending",
      approval_kind: "discount",
      approval_maker: fx.manager.id,
      created_by: fx.manager.id,
      discount_by_owner: false,
      approvals: 1,
    });
  });

  it("once the owner approves the manager's discount, a recheck confirms the order (maker = created_by)", async () => {
    const cid = id();
    const [o] = await tx([
      create("manager", cid, { unitPrice: DISCOUNTED }),
      ["owner", `select app.decide_approval(${APPROVAL_OF(cid)}, true, 'matches the competitor price');`],
      ["manager", `select (app.recheck_order(${ORDER_OF(cid)})).id;`],
      order(cid),
    ]);
    expect(o).toMatchObject({ status: "confirmed", hold_discount: null, approval_maker: fx.manager.id });
  });

  it("the owner's own discount needs no approval (MJ 2026-11-04): confirmed at once, discount_by_owner recorded", async () => {
    const cid = id();
    const [o] = await tx([create("owner", cid, { unitPrice: DISCOUNTED }), order(cid)]);
    expect(o).toMatchObject({
      status: "confirmed",
      hold_discount: null,
      discount_by_owner: true,
      approval_kind: null,
      approvals: 0,
      created_by: fx.owner.id,
    });
    expect(Number(o.discount_paisa)).toBe(UNIT - DISCOUNTED);
  });

  it("the owner's order without a discount does not carry discount_by_owner", async () => {
    const cid = id();
    const [o] = await tx([create("owner", cid), order(cid)]);
    expect(o).toMatchObject({ status: "confirmed", discount_by_owner: false });
  });

  it("a rep's discount never gets discount_by_owner: the rep path is closed (D-30), so it makes no order at all", async () => {
    // Before D-30 a rep's discounted order was a rep_visit draft waiting on an approval. Now the rep path
    // refuses first, on the rep's open day too; only the owner's own office discount skips the approval.
    const repDiscount: Step = [
      "repA",
      `select (app.create_order('${id()}', '${SALON}', 'CASH', 'bag_now', ${lines(1, DISCOUNTED)})).id;`,
    ];
    expect(await txCode([OPEN_DAY, repDiscount])).toBe(DENIED);
    expect(await txError([OPEN_DAY, repDiscount])).toContain(REP_PATH_CLOSED);
    const cid = id();
    const [o] = await tx([OPEN_DAY, create("manager", cid, { unitPrice: DISCOUNTED, rep: fx.repA.id }), order(cid)]);
    expect(o).toMatchObject({
      status: "draft",
      hold_discount: "pending",
      discount_by_owner: false,
      source_channel: "office",
      assigned_rep_id: fx.repA.id,
      approval_maker: fx.manager.id,
      approvals: 1,
    });
  });

  it("the database refuses discount_by_owner without a discount", async () => {
    const oid = id();
    expect(
      await txCode([
        [
          "postgres",
          `insert into public.sales_order (id, client_id, salon_id, source_channel, created_by, plan, delivery_mode,
                                           subtotal_paisa, total_paisa, discount_by_owner)
           values ('${oid}', '${oid}', '${SALON}', 'office', '${fx.owner.id}', 'CASH', 'warehouse', ${UNIT}, ${UNIT}, true);`,
        ],
      ]),
    ).toBe(CHECK_VIOLATION);
  });

  it("a replay returns the same order; a changed replay is refused 23505", async () => {
    const cid = id();
    const [first, again] = await tx([
      create("manager", cid),
      [
        "manager",
        `select (app.office_create_order('${cid}', '${SALON}', 'CASH', ${lines(1)})).id as id
         union all select o.id from public.sales_order o where o.client_id = '${cid}';`,
      ],
    ]);
    expect(first.id).toBe(again.id);
    expect(await txCode([create("manager", cid), create("manager", cid, { plan: "INST4" })])).toBe(DUPLICATE);
    expect(await txCode([create("manager", cid), create("owner", cid)])).toBe(DUPLICATE);
  });

  it("the credit gate still holds an INST4 order over the salon's limit", async () => {
    const cid = id();
    const [o] = await tx([create("manager", cid, { salon: SALON_LOW, plan: "INST4", qty: INST4_QTY }), order(cid)]);
    expect(o).toMatchObject({ status: "draft", hold_credit: "over_limit", source_channel: "office" });
  });

  it("bad lines and an unknown salon are refused 22023 with the order engine's messages", async () => {
    expect(await txError([create("manager", id(), { qty: 0 })])).toContain("every line needs an active, priced SKU");
    expect(await txCode([create("manager", id(), { salon: id() })])).toBe(BAD_INPUT);
  });

  it("an unknown order card is refused 22023 (conversion itself: order-cards.test.ts)", async () => {
    expect(await txCode([create("manager", id(), { card: id() })])).toBe(BAD_INPUT);
    expect(await txError([create("manager", id(), { card: id() })])).toContain("unknown order card");
  });

  it("the owner's discount above the owner threshold still needs no approval; the audit insert row records it", async () => {
    const cid = id();
    const [o, audit] = await tx([
      create("owner", cid, { unitPrice: DEEP_DISCOUNT }),
      [
        "postgres",
        `select o.status::text as status, o.discount_by_owner, o.discount_paisa,
                (select count(*)::int from control.approval_request r where r.subject_type = 'sales_order' and r.subject_id = o.id) as approvals,
                null::jsonb as after
         from public.sales_order o where o.client_id = '${cid}'
         union all
         select null, null, null, null, e.after
         from control.audit_event e
         where e.table_name = 'public.sales_order' and e.action = 'INSERT' and e.row_id = ${ORDER_OF(cid)}::text;`,
      ],
    ]);
    expect(o).toMatchObject({ status: "confirmed", discount_by_owner: true, approvals: 0 });
    expect(Number(o.discount_paisa)).toBe(UNIT - DEEP_DISCOUNT);
    expect(audit.after).toMatchObject({ discount_by_owner: true, created_by: fx.owner.id, source_channel: "office" });
    expect(Number((audit.after as { discount_paisa: number }).discount_paisa)).toBe(UNIT - DEEP_DISCOUNT);
  });

  it("app.build_order is not callable by any app role", async () => {
    const sql = `select app.build_order('${id()}', '${SALON}', 'CASH', 'warehouse', ${lines(1)}, 'office', null, null, null, null, null, null)`;
    expect(await sqlstate(MANAGER, sql)).toBe(DENIED);
    expect(await sqlstate(OWNER, sql)).toBe(DENIED);
  });
});
