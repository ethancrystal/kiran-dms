/**
 * Delivery submission and office approval (migration 20261105130100, completion slice 4, P1-21; D-32,
 * MJ's requirement L-0385; plan docs/superpowers/plans/2026-11-04-delivery-submission-approval.md).
 *
 * A rep's delivery is a submission: the goods move from the bag to the rep's pending location and
 * nothing official changes. Only the owner's or manager's approval writes the delivery, the sale
 * movement (from pending), the invoice, the installments and the order status. A rejection keeps the
 * submission and leaves the goods in pending custody until the office settles them: back to the bag,
 * to a warehouse, or missing with an approved adjustment.
 *
 * Catalogue, territories, salons, a warehouse and its opening stock are committed with fresh ids, and
 * the territories are ended in afterAll. Everything else (rep days, bags, orders, submissions,
 * decisions, settlements, role changes) runs in one rolled-back transaction per test, so no rep is left
 * checked in and no stock, invoice number or role change is left behind for later files.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fx, MANAGER, OWNER, REP_A, run } from "./helpers/db";
import { legacyOrderSql } from "./helpers/legacy-order";

const C = { commit: true };
const DENIED = "42501";
const BAD_INPUT = "22023";
const WRONG_STATE = "55000";
const DUPLICATE = "23505";
const CHECK = "23514";
const BAG_LIMIT_PAISA = 50_000_000;
const BAG_LOAD = 20;
const OPENING_STOCK = 100;
const SKU1_PAISA = 120_000; // Rs 1,200
const SKU2_PAISA = 50_000; // Rs 500
const PIN_LAT = 24.9;
const PIN_LNG = 67.1;

const id = () => randomUUID();
const TAG_LENGTH = 8;
const tag = () => randomUUID().slice(0, TAG_LENGTH);
/** Runs one async step per item, one after another (the shared database takes one test transaction at a time). */
const inSeries = <T, R>(items: readonly T[], f: (t: T) => Promise<R>) =>
  items.reduce<Promise<R[]>>(async (acc, t) => [...(await acc), await f(t)], Promise.resolve([]));
const one = async (who: Parameters<typeof run>[0], sql: string, params: unknown[] = []) =>
  (await run(who, sql, params, C)).rows[0];
const TODAY = "(now() at time zone 'Asia/Karachi')::date";

const T_A = id(),
  AREA_A = id(),
  T_B = id(),
  AREA_B = id();
const SALON = id(),
  SALON_NOPIN = id(),
  SALON_B = id();
const GROUP = id(),
  PRODUCT = id(),
  SKU1 = id(),
  SKU2 = id(),
  SKU3 = id(); // priced, never ordered
const WH = id();

const bagOf = (k: "repA" | "repB") =>
  `(select l.id from public.stock_location l where l.kind = 'rep_bag' and l.owner_user_id = '${fx[k].id}')`;
const pendingOf = (k: "repA" | "repB") =>
  `(select l.id from public.stock_location l where l.kind = 'pending_delivery' and l.owner_user_id = '${fx[k].id}')`;
const BAG_A = bagOf("repA");
const PENDING_A = pendingOf("repA");

type Persona =
  | "repA"
  | "repB"
  | "manager"
  | "owner"
  | "repAWrongDevice"
  | "managerAal1"
  | "ownerAal1"
  | "suspended"
  | "anon";
const PERSONA: Record<Exclude<Persona, "anon">, { key: keyof typeof fx; aal: string; device: string | null }> = {
  repA: { key: "repA", aal: "aal1", device: null },
  repB: { key: "repB", aal: "aal1", device: null },
  manager: { key: "manager", aal: "aal2", device: null },
  owner: { key: "owner", aal: "aal2", device: null },
  repAWrongDevice: { key: "repA", aal: "aal1", device: "dev-not-approved-0000" },
  managerAal1: { key: "manager", aal: "aal1", device: null },
  ownerAal1: { key: "owner", aal: "aal1", device: null },
  suspended: { key: "suspendedRep", aal: "aal1", device: null },
};
const asUser = (k: Persona) => {
  if (k === "anon") {
    return `reset role; select set_config('request.jwt.claims', '{"role":"anon"}', true); set local role anon;`;
  }
  const p = PERSONA[k];
  const persona = fx[p.key];
  return `
  reset role;
  select set_config('request.jwt.claims', '${JSON.stringify({ sub: persona.id, role: "authenticated", aal: p.aal })}', true),
         set_config('request.headers', '${JSON.stringify({ "x-kiran-device": p.device ?? persona.device })}', true);
  set local role authenticated;`;
};

// Both reps' day open, a bag for rep A (made here only when it has none; its pending twin comes with
// it), 20 of SKU1 and SKU2 loaded from the warehouse.
const prelude = `
  insert into public.rep_day (rep_id, day) values ('${fx.repA.id}', ${TODAY}), ('${fx.repB.id}', ${TODAY}) on conflict (rep_id, day) do nothing;
  ${asUser("owner")}
  select app.office_create_location('${id()}', 'rep_bag', '[Test] Approval bag A', '${fx.repA.id}', ${BAG_LIMIT_PAISA})
   where not exists (select 1 from public.stock_location l where l.kind = 'rep_bag' and l.owner_user_id = '${fx.repA.id}');
  reset role;
  insert into public.stock_movement (client_id, sku_id, qty, from_location_id, to_location_id, kind, actor_id)
  values (gen_random_uuid(), '${SKU1}', ${BAG_LOAD}, '${WH}', ${BAG_A}, 'issue_to_rep', '${fx.manager.id}'),
         (gen_random_uuid(), '${SKU2}', ${BAG_LOAD}, '${WH}', ${BAG_A}, 'issue_to_rep', '${fx.manager.id}');`;
type Step = [Persona | "postgres", string];
const script = (steps: Step[]) =>
  `${prelude}\n${steps.map(([k, sql]) => `${k === "postgres" ? "reset role;" : asUser(k)}\n${sql}`).join("\n")}`;
type Multi = Array<{ rows: Array<Record<string, unknown>> }>;
/** Runs the steps in one rolled-back transaction and returns the last statement's rows. */
const tx = async (steps: Step[]) => ((await run("postgres", script(steps))) as unknown as Multi).at(-1)?.rows ?? [];
/** The SQLSTATE and message of the first failing statement, or null when every step succeeded. */
const txFail = async (steps: Step[]) => {
  try {
    await run("postgres", script(steps));
    return null;
  } catch (e) {
    const err = e as { code?: string; message: string; constraint?: string };
    return { code: err.code ?? "unknown", message: err.message, constraint: err.constraint };
  }
};
const txCode = async (steps: Step[]) => (await txFail(steps))?.code ?? null;

const lines = (l: Array<[string, number]>) => `'${JSON.stringify(l.map(([sku_id, qty]) => ({ sku_id, qty })))}'::jsonb`;
const oid = (cid: string) => `(select id from public.sales_order where client_id = '${cid}')`;
const sid = (cid: string) => `(select id from public.delivery_submission where client_id = '${cid}')`;
/** The office makes the order and names rep A (or nobody) to deliver it (D-30, A-16). */
const order = (cid: string, l: Array<[string, number]>, salon = SALON, rep: string | null = fx.repA.id): Step => [
  "manager",
  `select app.office_create_order('${cid}', '${salon}', 'CASH', ${lines(l)}, ${rep ? `'${rep}'` : "null"});`,
];
const submit = (
  scid: string,
  ocid: string,
  l: Array<[string, number]> | null = null,
  who: Persona = "repA",
  extra = "",
): Step => [
  who,
  `select (app.rep_submit_delivery('${scid}', ${oid(ocid)}, 'Ayesha at the counter', ${PIN_LAT}, ${PIN_LNG}, ${l ? lines(l) : "null"}${extra})).*;`,
];
const approve = (scid: string, dcid: string, who: Persona = "manager"): Step => [
  who,
  `select (app.office_approve_delivery(${sid(scid)}, '${dcid}')).*;`,
];
const reject = (scid: string, dcid: string, reason = "wrong shade delivered", who: Persona = "manager"): Step => [
  who,
  `select (app.office_reject_delivery(${sid(scid)}, '${dcid}', '${reason}')).*;`,
];
const resolve = (
  rcid: string,
  scid: string,
  sku: string,
  qty: number,
  outcome: string,
  args: { warehouse?: string; approval?: string; note?: string; who?: Persona } = {},
): Step => [
  args.who ?? "manager",
  `select (app.office_resolve_pending('${rcid}', ${sid(scid)}, '${sku}', ${qty}, '${outcome}', '${args.note ?? "counted at the office"}', ${
    args.warehouse ? `'${args.warehouse}'` : "null"
  }, ${args.approval ? `'${args.approval}'` : "null"})).*;`,
];
const onHand = (loc: string, sku: string) => `app.on_hand(${loc}, '${sku}')::int`;

beforeAll(async () => {
  await one(MANAGER, "select app.office_upsert_territory($1, $2)", [T_A, `[Test] Approval A ${tag()}`]);
  await one(MANAGER, "select app.office_upsert_territory($1, $2)", [T_B, `[Test] Approval B ${tag()}`]);
  await one(MANAGER, "select app.office_upsert_area($1, $2, '[Test] Approval area A')", [AREA_A, T_A]);
  await one(MANAGER, "select app.office_upsert_area($1, $2, '[Test] Approval area B')", [AREA_B, T_B]);
  await one(MANAGER, "select app.office_assign_territory($1, $2)", [fx.repA.id, T_A]);
  await one(MANAGER, "select app.office_assign_territory($1, $2)", [fx.repB.id, T_B]);
  await one(REP_A, "select app.create_salon($1, $2, 'ladies_parlor', $3, 'map_pin', null, $4, $5)", [
    SALON,
    `[Test] Approval salon ${tag()}`,
    AREA_A,
    PIN_LAT,
    PIN_LNG,
  ]);
  await one(REP_A, "select app.create_salon($1, $2, 'ladies_parlor', $3, 'map_pin', null, null, null)", [
    SALON_NOPIN,
    `[Test] Approval salon without pin ${tag()}`,
    AREA_A,
  ]);
  await one({ as: "repB" }, "select app.create_salon($1, $2, 'ladies_parlor', $3, 'map_pin', null, $4, $5)", [
    SALON_B,
    `[Test] Approval salon B ${tag()}`,
    AREA_B,
    PIN_LAT,
    PIN_LNG,
  ]);
  await one(MANAGER, "select app.office_upsert_product_group($1, $2, 21)", [GROUP, `[Test] Approval colour ${tag()}`]);
  await one(MANAGER, "select app.office_upsert_product($1, $2, '[Dummy] Kiran', '[Dummy] Approval colour')", [
    PRODUCT,
    GROUP,
  ]);
  await inSeries([SKU1, SKU2, SKU3], (s) =>
    one(MANAGER, "select app.office_upsert_sku($1, $2, $3, '[Dummy] shade', 'ml', 100)", [
      s,
      PRODUCT,
      `T-APR-${tag().toUpperCase()}`,
    ]),
  );
  await one(OWNER, "select app.owner_set_sku_price($1, $2, 'dummy list price')", [SKU1, SKU1_PAISA]);
  await one(OWNER, "select app.owner_set_sku_price($1, $2, 'dummy list price')", [SKU2, SKU2_PAISA]);
  await one(OWNER, "select app.owner_set_sku_price($1, $2, 'dummy list price')", [SKU3, SKU2_PAISA]);
  await one(MANAGER, "select app.office_create_location($1, 'warehouse', '[Test] Approval store')", [WH]);
  // Opening stock (goods receipts arrive with the vault, P1-05), as a receipt row.
  await one(
    "postgres",
    `insert into public.stock_movement (client_id, sku_id, qty, to_location_id, kind, actor_id)
     values (gen_random_uuid(), $1, $4, $3, 'receipt', $5), (gen_random_uuid(), $2, $4, $3, 'receipt', $5)`,
    [SKU1, SKU2, WH, OPENING_STOCK, fx.manager.id],
  );
});

afterAll(async () => {
  await one(MANAGER, "select app.office_end_territory($1, $2, 'delivery approval tests finished')", [fx.repA.id, T_A]);
  await one(MANAGER, "select app.office_end_territory($1, $2, 'delivery approval tests finished')", [fx.repB.id, T_B]);
});

// ----------------------------------------------------------------- Task 1: schema ----
const APPEND_ONLY = "append-only";
const UNSETTLED = "more than is unsettled";
const NEW_TABLES = ["delivery_submission", "delivery_submission_decision", "pending_stock_resolution"] as const;
const MOVED_BY_TEST = 1;
const movementOf = (cid: string) => `(select id from public.stock_movement where client_id = '${cid}')`;

describe("schema: pending location, submission tables, invoice stamps (D-32)", () => {
  // Rows written directly as postgres: an order, a submission of 1 unit moved to pending and, when
  // decided, its rejection; `settle` adds a settlement back to the bag.
  const handedOver = (o: string, s: string, decided = true): Step[] => [
    order(o, [[SKU1, MOVED_BY_TEST]]),
    [
      "postgres",
      `insert into public.delivery_submission (client_id, order_id, salon_id, rep_id, rep_day_id, lines, received_by_name,
                                               lat, lng, device_fingerprint)
       select '${s}', ${oid(o)}, '${SALON}', '${fx.repA.id}', d.id, ${lines([[SKU1, MOVED_BY_TEST]])}, 'Ayesha', ${PIN_LAT}, ${PIN_LNG}, 'dev-x'
       from public.rep_day d where d.rep_id = '${fx.repA.id}' and d.day = ${TODAY};
       insert into public.stock_movement (client_id, sku_id, qty, from_location_id, to_location_id, kind, actor_id)
       values ('${s}', '${SKU1}', ${MOVED_BY_TEST}, ${BAG_A}, ${PENDING_A}, 'submitted_to_salon', '${fx.repA.id}');
       ${
         decided
           ? `insert into public.delivery_submission_decision (client_id, submission_id, outcome, reason, decided_by)
              values ('${s}', ${sid(s)}, 'rejected', 'wrong shade', '${fx.manager.id}');`
           : ""
       }
       insert into public.stock_movement (client_id, sku_id, qty, from_location_id, to_location_id, kind, actor_id)
       values ('${o}', '${SKU1}', ${MOVED_BY_TEST}, ${PENDING_A}, ${BAG_A}, 'pending_returned', '${fx.manager.id}');`,
    ],
  ];
  const settle = (o: string, s: string, outcome = "returned_to_bag", approval = "null"): Step => [
    "postgres",
    `insert into public.pending_stock_resolution (client_id, submission_id, sku_id, qty, outcome, note, movement_id, approval_id, resolved_by)
     values (gen_random_uuid(), ${sid(s)}, '${SKU1}', ${MOVED_BY_TEST}, '${outcome}', 'counted', ${movementOf(o)}, ${approval}, '${fx.manager.id}');`,
  ];

  it("delivery_submission, its decision and pending_stock_resolution refuse UPDATE and DELETE, even for postgres", async () => {
    const changes = [
      "update public.delivery_submission set received_by_name = 'Someone else'",
      "delete from public.delivery_submission",
      "update public.delivery_submission_decision set reason = 'another reason'",
      "delete from public.delivery_submission_decision",
      "update public.pending_stock_resolution set note = 'another note'",
      "delete from public.pending_stock_resolution",
    ];
    const failures = await inSeries(changes, (change) => {
      const o = id(),
        s = id();
      return txFail([...handedOver(o, s), settle(o, s), ["postgres", `${change};`]]);
    });
    expect(failures.map((f) => f?.message.includes(APPEND_ONLY))).toEqual(changes.map(() => true));
    const truncates = await inSeries(NEW_TABLES, (t) => txFail([["postgres", `truncate public.${t} cascade;`]]));
    expect(truncates.map((f) => f?.message.includes(APPEND_ONLY))).toEqual(NEW_TABLES.map(() => true));
  });

  it("a new rep bag gets one pending location with the same owner, and a second is refused", async () => {
    const r = await tx([
      [
        "postgres",
        `select count(*)::int n, bool_and(l.bag_value_limit_paisa is null) no_limit, bool_and(l.active) active,
                bool_and(l.name like 'Pending: %') named
         from public.stock_location l where l.kind = 'pending_delivery' and l.owner_user_id = '${fx.repA.id}';`,
      ],
    ]);
    expect(r).toEqual([{ n: 1, no_limit: true, active: true, named: true }]);
    expect(
      await txCode([
        [
          "postgres",
          `insert into public.stock_location (id, kind, name, owner_user_id, created_by)
           values (gen_random_uuid(), 'pending_delivery', 'Pending: second', '${fx.repA.id}', '${fx.owner.id}');`,
        ],
      ]),
    ).toBe(DUPLICATE);
    // A pending location without an owner breaks the bag-owner shape.
    expect(
      await txCode([
        [
          "postgres",
          `insert into public.stock_location (id, kind, name, created_by)
           values (gen_random_uuid(), 'pending_delivery', 'Pending: nobody', '${fx.owner.id}');`,
        ],
      ]),
    ).toBe(CHECK);
  });

  it("the office cannot make a pending location by hand", async () => {
    const failures = await inSeries(["owner", "manager"] as const, (who) =>
      txFail([
        [who, `select app.office_create_location('${id()}', 'pending_delivery', '[Test] Pending by hand', '${fx.repB.id}');`],
      ]),
    );
    expect(failures.map((f) => [f?.code, f?.message.includes("created with the rep's bag")])).toEqual([
      [BAD_INPUT, true],
      [BAD_INPUT, true],
    ]);
  });

  it("new movement kinds need both sides", async () => {
    const kinds = ["submitted_to_salon", "pending_returned"];
    const failures = await inSeries(kinds, (kind) =>
      txFail([
        [
          "postgres",
          `insert into public.stock_movement (client_id, sku_id, qty, from_location_id, kind, actor_id)
           values (gen_random_uuid(), '${SKU1}', 1, ${BAG_A}, '${kind}', '${fx.manager.id}');`,
        ],
      ]),
    );
    expect(failures.map((f) => [f?.code, f?.constraint])).toEqual(kinds.map(() => [CHECK, "stock_movement_kind_shape"]));
  });

  it("pending_stock_resolution needs an approval exactly when goods are missing", async () => {
    const o = id(),
      s = id(),
      a = id();
    const missingWithout = await txFail([...handedOver(o, s), settle(o, s, "missing")]);
    expect([missingWithout?.code, missingWithout?.constraint]).toEqual([CHECK, "pending_stock_resolution_approval"]);
    const returnedWith = await txFail([
      ...handedOver(o, s),
      ["manager", `select app.request_approval('${a}', 'adjustment', 'stock_location', ${PENDING_A}, '{}', 'shape test');`],
      settle(o, s, "returned_to_bag", `(select id from control.approval_request where client_id = '${a}')`),
    ]);
    expect([returnedWith?.code, returnedWith?.constraint]).toEqual([CHECK, "pending_stock_resolution_approval"]);
  });

  it("a settlement of an undecided submission, or of more than is unsettled, is refused by the guard", async () => {
    const o = id(),
      s = id();
    const f1 = await txFail([...handedOver(o, s, false), settle(o, s)]);
    expect([f1?.code, f1?.message.includes(UNSETTLED)]).toEqual([CHECK, true]);
    const f2 = await txFail([...handedOver(o, s), settle(o, s), settle(o, s)]);
    expect([f2?.code, f2?.message.includes(UNSETTLED)]).toEqual([CHECK, true]);
  });
});

// ------------------------------------------------------- Task 2: finalise_delivery ----
const officeDeliver = (dcid: string, ocid: string, who: Persona = "manager"): Step => [
  who,
  `select (app.office_deliver('${dcid}', ${oid(ocid)}, '${WH}', 'Bilal at the door')).*;`,
];
const stamps = (ocid: string): Step => [
  "postgres",
  `select i.delivered_by, i.commission_rep_id, i.rep_id, i.issued_by, d.delivered_by_role::text role
   from public.invoice i join public.delivery d on d.id = i.delivery_id where i.order_id = ${oid(ocid)};`,
];

describe("the internal finalising function stamps who delivered and who earns (D-32, D-31)", () => {
  it("a rep-less order delivered by the office stamps delivered_by and no commission rep", async () => {
    const o = id();
    const r = await tx([order(o, [[SKU1, 1]], SALON, null), officeDeliver(id(), o), stamps(o)]);
    expect(r).toEqual([
      { delivered_by: fx.manager.id, commission_rep_id: null, rep_id: null, issued_by: fx.manager.id, role: "manager" },
    ]);
  });

  it("an assigned order delivered by the office keeps the assigned rep as commission rep", async () => {
    const o = id();
    const r = await tx([order(o, [[SKU1, 1]]), officeDeliver(id(), o, "owner"), stamps(o)]);
    expect(r).toEqual([
      { delivered_by: fx.owner.id, commission_rep_id: fx.repA.id, rep_id: fx.repA.id, issued_by: fx.owner.id, role: "owner" },
    ]);
  });

  it("a new invoice without delivered_by is refused", async () => {
    const o = id(),
      d = id();
    const f = await txFail([
      order(o, [[SKU1, 1]]),
      [
        "postgres",
        `insert into public.delivery (client_id, order_id, salon_id, from_location_id, delivered_by, delivered_by_role, status, received_by_name)
         values ('${d}', ${oid(o)}, '${SALON}', '${WH}', '${fx.manager.id}', 'manager', 'full', 'Bilal at the door');
         insert into public.invoice (number, delivery_id, order_id, salon_id, plan, subtotal_paisa, discount_paisa, total_paisa, issued_by)
         select app.next_doc_number('INV'), d.id, d.order_id, d.salon_id, 'CASH', ${SKU1_PAISA}, 0, ${SKU1_PAISA}, '${fx.manager.id}'
         from public.delivery d where d.client_id = '${d}';`,
      ],
    ]);
    expect([f?.code, f?.constraint]).toEqual([CHECK, "invoice_delivered_by_set"]);
  });

  it("no app role can call the internal function, and app.deliver is gone", async () => {
    const o = id();
    const call = `select app.finalise_delivery('${id()}', ${oid(o)}, '${WH}', null, 'Ayesha at the counter', ${PIN_LAT}, ${PIN_LNG}, false, null, null, '${fx.repA.id}', 'rep');`;
    const codes = await inSeries(["repA", "manager", "owner"] as const, (who) => txCode([order(o, [[SKU1, 1]]), [who, call]]));
    expect(codes).toEqual([DENIED, DENIED, DENIED]);
    const gone = await tx([["postgres", "select to_regproc('app.deliver') is null gone;"]]);
    expect(gone).toEqual([{ gone: true }]);
  });
});

// ------------------------------------------------------------ Task 3: submission ----
const HANDED = 2; // units handed over in most tests
const ORDER_OF_THREE = 3;
const BACKDATED = "2026-01-01T09:00:00+05:00";
const OWN_ORDERS = "own orders";
const LEFT = "at most what is left";
const NOTHING_LEFT = "nothing is left";
// Stock on hand of rep A's bag and pending location before the steps that follow (temp table b).
const baseline: Step = [
  "postgres",
  `create temp table b on commit drop as
   select ${onHand(BAG_A, SKU1)} bag1, ${onHand(PENDING_A, SKU1)} pend1, ${onHand(BAG_A, SKU2)} bag2, ${onHand(PENDING_A, SKU2)} pend2;`,
];
const deltas = `(select ${onHand(BAG_A, SKU1)} - b.bag1 from b) bag1, (select ${onHand(PENDING_A, SKU1)} - b.pend1 from b) pend1,
                (select ${onHand(BAG_A, SKU2)} - b.bag2 from b) bag2, (select ${onHand(PENDING_A, SKU2)} - b.pend2 from b) pend2`;
const failOf = async (steps: Step[]) => {
  const f = await txFail(steps);
  return [f?.code ?? null, f?.message ?? null] as const;
};
const closeDay: Step = [
  "manager",
  `select app.office_force_close_rep_day((select id from public.rep_day where rep_id = '${fx.repA.id}' and day = ${TODAY}), 'test: day closed');`,
];

describe("a rep's delivery is a submission: goods to pending, nothing official changes (D-32)", () => {
  it("a submission moves goods to pending and changes nothing official", async () => {
    const o = id(),
      s = id();
    const [r] = await tx([
      order(o, [[SKU1, HANDED]]),
      baseline,
      submit(s, o, null, "repA", `, false, '${BACKDATED}'`),
      [
        "postgres",
        `select ${deltas}, o.status::text status,
                (select count(*)::int from public.delivery d where d.order_id = o.id) deliveries,
                (select count(*)::int from public.delivery_line dl join public.delivery d on d.id = dl.delivery_id where d.order_id = o.id) delivery_lines,
                (select count(*)::int from public.invoice i where i.order_id = o.id) invoices,
                (select count(*)::int from public.installment x join public.invoice i on i.id = x.invoice_id where i.order_id = o.id) installments,
                (select count(*)::int from public.stock_movement m where m.kind = 'sale' and m.source_id = s.id) sales,
                (select count(*)::int from public.stock_movement m where m.kind = 'submitted_to_salon' and m.source_type = 'delivery_submission' and m.source_id = s.id and m.actor_id = '${fx.repA.id}') moved,
                (select sum(x.remaining)::int from app.order_lines_left(o.id) x) remaining,
                s.submitted_at > now() - interval '1 minute' server_time, s.submitted_at_client = '${BACKDATED}'::timestamptz client_kept,
                s.lines = ${lines([[SKU1, HANDED]])} lines, s.rep_day_id = (select id from public.rep_day where rep_id = '${fx.repA.id}' and day = ${TODAY}) on_day,
                s.device_fingerprint = '${fx.repA.device}' device, s.distance_from_pin_m dist, s.flags
         from public.sales_order o join public.delivery_submission s on s.order_id = o.id where o.client_id = '${o}';`,
      ],
    ]);
    expect(r).toEqual({
      bag1: -HANDED,
      pend1: HANDED,
      bag2: 0,
      pend2: 0,
      status: "confirmed",
      deliveries: 0,
      delivery_lines: 0,
      invoices: 0,
      installments: 0,
      sales: 0,
      moved: 1,
      remaining: HANDED,
      server_time: true,
      client_kept: true,
      lines: true,
      on_day: true,
      device: true,
      dist: 0,
      flags: [],
    });
  });

  it("a replay returns the same submission and moves nothing twice", async () => {
    const o = id(),
      o2 = id(),
      s = id();
    const [r] = await tx([
      order(o, [[SKU1, HANDED]]),
      submit(s, o, [[SKU1, HANDED]]),
      ["postgres", `create temp table first on commit drop as select id from public.delivery_submission where client_id = '${s}';`],
      submit(s, o, [[SKU1, HANDED]]),
      submit(s, o),
      [
        "postgres",
        `select (select count(*)::int from public.delivery_submission where client_id = '${s}') subs,
                (select id from first) = ${sid(s)} same,
                (select count(*)::int from public.stock_movement m where m.source_id = ${sid(s)}) moves;`,
      ],
    ]);
    expect(r).toEqual({ subs: 1, same: true, moves: 1 });
    const other = await inSeries(
      [
        [order(o2, [[SKU1, 1]]), submit(s, o, [[SKU1, HANDED]]), submit(s, o2)],
        [submit(s, o, [[SKU1, HANDED]]), submit(s, o, [[SKU1, 1]])],
      ] as Step[][],
      (steps) => txCode([order(o, [[SKU1, HANDED]]), ...steps]),
    );
    expect(other).toEqual([DUPLICATE, DUPLICATE]);
    expect(
      await txCode([
        order(o, [[SKU1, HANDED]]),
        ["repA", `select app.rep_submit_delivery(null, ${oid(o)}, 'Ayesha at the counter', ${PIN_LAT}, ${PIN_LNG});`],
      ]),
    ).toBe(BAD_INPUT);
  });

  it("who may submit", async () => {
    const o = id();
    const mine = order(o, [[SKU1, 1]]);
    const cases: Array<[Step[], string, string | null]> = [
      [[mine, submit(id(), o, null, "repB")], DENIED, OWN_ORDERS],
      [[order(o, [[SKU1, 1]], SALON, null), submit(id(), o)], DENIED, OWN_ORDERS],
      [[mine, submit(id(), o, null, "manager")], DENIED, null],
      [[mine, submit(id(), o, null, "owner")], DENIED, null],
      [[mine, submit(id(), o, null, "repAWrongDevice")], DENIED, null],
      [[mine, submit(id(), o, null, "suspended")], DENIED, null],
      [[mine, closeDay, submit(id(), o)], DENIED, "check in"],
      [
        [mine, ["manager", `select app.office_end_territory('${fx.repA.id}', '${T_A}', 'test: moved away');`], submit(id(), o)],
        DENIED,
        "own territories",
      ],
    ];
    const got = await inSeries(cases, ([steps]) => failOf(steps));
    expect(got.map(([code, msg], i) => [code, cases[i][2] === null || Boolean(msg?.includes(cases[i][2] ?? ""))])).toEqual(
      cases.map(([, code]) => [code, true]),
    );
  });

  it("what a submission needs", async () => {
    const o = id();
    const mine = order(o, [[SKU1, 1]]);
    const raw = (name: string, lat: string, lng: string, l = "null"): Step => [
      "repA",
      `select app.rep_submit_delivery('${id()}', ${oid(o)}, ${name}, ${lat}, ${lng}, ${l});`,
    ];
    const legacyDraft = legacyOrderSql({
      clientId: o,
      salonId: SALON,
      skuId: SKU1,
      qty: 1,
      unitPaisa: SKU1_PAISA,
      repId: fx.repA.id,
      plan: "CASH",
      status: "draft",
    });
    const cases: Array<[Step[], string, string]> = [
      [[mine, raw("''", `${PIN_LAT}`, `${PIN_LNG}`)], BAD_INPUT, "name of the person"],
      [[mine, raw("'A'", `${PIN_LAT}`, `${PIN_LNG}`)], BAD_INPUT, "name of the person"],
      [[mine, raw("'Ayesha'", "null", `${PIN_LNG}`)], BAD_INPUT, "GPS is required"],
      [[mine, raw("'Ayesha'", `${PIN_LAT}`, "null")], BAD_INPUT, "GPS is required"],
      [[mine, raw("'Ayesha'", "999", `${PIN_LNG}`)], CHECK, "delivery_lat_check"],
      [[["postgres", legacyDraft], submit(id(), o)], BAD_INPUT, "only a confirmed order"],
      [[mine, ["manager", `select app.cancel_order(${oid(o)}, 'test: cancelled');`], submit(id(), o)], BAD_INPUT, "only a confirmed order"],
      [[mine, submit(id(), o, [[SKU3, 1]])], BAD_INPUT, LEFT],
    ];
    const got = await inSeries(cases, ([steps]) => failOf(steps));
    expect(got.map(([code, msg], i) => [code, Boolean(msg?.includes(cases[i][2]))])).toEqual(cases.map(([, code]) => [code, true]));
    // More than the bag holds: refused with the rep path's words, and nothing is written.
    const big = id();
    const BEYOND_BAG = 90;
    const [code, msg] = await failOf([order(big, [[SKU1, BEYOND_BAG]]), submit(id(), big)]);
    expect([code, msg?.includes("insufficient stock at the delivery location")]).toEqual([CHECK, true]);
    const [n] = await tx([
      order(big, [[SKU1, BEYOND_BAG]]),
      [
        "repA",
        `do $t$ begin perform app.rep_submit_delivery('${id()}', ${oid(big)}, 'Ayesha at the counter', ${PIN_LAT}, ${PIN_LNG});
         exception when check_violation then null; end $t$;`,
      ],
      ["postgres", `select count(*)::int subs from public.delivery_submission where order_id = ${oid(big)};`],
    ]);
    expect(n).toEqual({ subs: 0 });
  });

  it("undecided submissions reserve quantity (Review Focus 1)", async () => {
    const o = id();
    const three = order(o, [[SKU1, ORDER_OF_THREE]]);
    const first = submit(id(), o, [[SKU1, HANDED]]);
    expect(await failOf([three, first, submit(id(), o, [[SKU1, HANDED]])]).then(([c, m]) => [c, m?.includes(LEFT)])).toEqual([
      BAD_INPUT,
      true,
    ]);
    const [r] = await tx([
      three,
      first,
      submit(id(), o, [[SKU1, 1]]),
      ["postgres", `select count(*)::int subs from public.delivery_submission where order_id = ${oid(o)};`],
    ]);
    expect(r).toEqual({ subs: HANDED });
    expect(
      await failOf([three, first, submit(id(), o, [[SKU1, 1]]), submit(id(), o)]).then(([c, m]) => [c, m?.includes(NOTHING_LEFT)]),
    ).toEqual([BAD_INPUT, true]);
  });

  it("the rep of a legacy rep_visit order may submit it", async () => {
    const o = id();
    const legacy = legacyOrderSql({
      clientId: o,
      salonId: SALON,
      skuId: SKU1,
      qty: 1,
      unitPaisa: SKU1_PAISA,
      repId: fx.repA.id,
      plan: "CASH",
    });
    const [r] = await tx([
      ["postgres", legacy],
      submit(id(), o),
      ["postgres", `select count(*)::int subs, bool_and(rep_id = '${fx.repA.id}') mine from public.delivery_submission where order_id = ${oid(o)};`],
    ]);
    expect(r).toEqual({ subs: 1, mine: true });
  });

  it("flags record a mock location and an unknown distance", async () => {
    const o = id(),
      p = id(),
      s1 = id(),
      s2 = id();
    const r = await tx([
      order(o, [[SKU1, 1]]),
      order(p, [[SKU2, 1]], SALON_NOPIN),
      submit(s1, o, null, "repA", ", true"),
      submit(s2, p),
      [
        "postgres",
        `select s.client_id = '${s1}' mocked, s.mock_location, s.flags, s.distance_from_pin_m dist
         from public.delivery_submission s where s.client_id in ('${s1}', '${s2}') order by s.client_id = '${s1}' desc;`,
      ],
    ]);
    expect(r).toEqual([
      { mocked: true, mock_location: true, flags: ["mock_location"], dist: 0 },
      { mocked: false, mock_location: false, flags: ["distance_unknown"], dist: null },
    ]);
  });

  it("my_submissions shows a rep its own only", async () => {
    const o = id(),
      s = id();
    const mineRows = await tx([
      order(o, [[SKU1, HANDED]]),
      submit(s, o),
      ["repA", `select status, salon_name is not null named, lines, unsettled, invoice_id from app.my_submissions() where submission_id = ${sid(s)};`],
    ]);
    expect(mineRows).toEqual([
      {
        status: "pending",
        named: true,
        lines: [{ sku_id: SKU1, code: expect.any(String), variant: "[Dummy] shade", qty: HANDED }],
        unsettled: 0,
        invoice_id: null,
      },
    ]);
    const theirs = await tx([order(o, [[SKU1, HANDED]]), submit(s, o), ["repB", `select count(*)::int n from app.my_submissions() where submission_id = ${sid(s)};`]]);
    expect(theirs).toEqual([{ n: 0 }]);
    expect(await txCode([["manager", "select * from app.my_submissions();"]])).toBe(DENIED);
  });
});

