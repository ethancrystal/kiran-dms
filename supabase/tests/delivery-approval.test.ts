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

// -------------------------------------------------------------- Task 4: approval ----
const ALREADY_DECIDED = "already decided";
const WHO_SUBMITTED = "who submitted";
const WAITING = "waiting for approval";
const NUMBER_SUFFIX = 6;
const AUDITED_TABLES = 4; // submission, decision, delivery, invoice
const invoiceNo = (n: unknown) => Number(String(n).slice(-NUMBER_SUFFIX));
const record = (ocid: string, scid: string, approver: string): Step => [
  "postgres",
  `select dl.delivered_by = '${fx.repA.id}' rep_delivered, dl.delivered_by_role::text role,
          dl.rep_day_id = s.rep_day_id same_day, dl.lat = s.lat and dl.lng = s.lng same_gps,
          dl.from_location_id = ${PENDING_A} from_pending, dl.client_id = s.client_id same_client,
          (select count(*)::int from public.stock_movement m where m.kind = 'sale' and m.source_id = dl.id
             and m.from_location_id = ${PENDING_A} and m.actor_id = '${approver}') sales,
          ${deltas},
          i.issued_by = '${approver}' issued_by_approver, i.delivered_by = '${fx.repA.id}' delivered_by_rep,
          i.commission_rep_id = '${fx.repA.id}' commission_rep, i.rep_id = '${fx.repA.id}' invoice_rep,
          i.number ~ '^INV-[0-9]{2}-[0-9]{6}$' numbered, i.total_paisa::int total,
          (select sum(x.amount_due_paisa)::int from public.installment x where x.invoice_id = i.id) installments,
          o.status::text status, x.outcome, x.delivery_id = dl.id decision_delivery, x.decided_by = '${approver}' decided_by,
          (select count(distinct e.table_name)::int from control.audit_event e
            where (e.table_name, e.row_id) in (('public.delivery_submission', s.id::text), ('public.delivery_submission_decision', x.id::text),
                                               ('public.delivery', dl.id::text), ('public.invoice', i.id::text))) audited
   from public.delivery_submission s
   join public.delivery_submission_decision x on x.submission_id = s.id
   join public.delivery dl on dl.id = x.delivery_id
   join public.invoice i on i.delivery_id = dl.id
   join public.sales_order o on o.id = s.order_id
   where s.client_id = '${scid}' and o.client_id = '${ocid}';`,
];
const counts = (ocid: string): Step => [
  "postgres",
  `select (select count(*)::int from public.delivery d where d.order_id = ${oid(ocid)}) deliveries,
          (select count(*)::int from public.invoice i where i.order_id = ${oid(ocid)}) invoices,
          (select count(*)::int from public.installment x join public.invoice i on i.id = x.invoice_id where i.order_id = ${oid(ocid)}) installments,
          (select count(*)::int from public.delivery_submission_decision x join public.delivery_submission s on s.id = x.submission_id
            where s.order_id = ${oid(ocid)}) decisions;`,
];

describe("the office approves a submission: the official record is written once (D-32)", () => {
  it("manager and owner approve: the whole official record appears once", async () => {
    const approvers = [
      ["manager", fx.manager.id],
      ["owner", fx.owner.id],
    ] as const;
    const got = await inSeries(approvers, async ([who, uid]) => {
      const o = id(),
        s = id();
      const [r] = await tx([order(o, [[SKU1, HANDED]]), baseline, submit(s, o), approve(s, id(), who), record(o, s, uid)]);
      return r;
    });
    const expected = {
      rep_delivered: true,
      role: "rep",
      same_day: true,
      same_gps: true,
      from_pending: true,
      same_client: true,
      sales: 1,
      bag1: -HANDED,
      pend1: 0,
      bag2: 0,
      pend2: 0,
      issued_by_approver: true,
      delivered_by_rep: true,
      commission_rep: true,
      invoice_rep: true,
      numbered: true,
      total: HANDED * SKU1_PAISA,
      installments: HANDED * SKU1_PAISA,
      status: "delivered",
      outcome: "approved",
      decision_delivery: true,
      decided_by: true,
      audited: AUDITED_TABLES,
    };
    expect(got).toEqual([expected, expected]);
  });

  it("a submission for part of the order moves only those quantities (spec section 7, Decision 2)", async () => {
    const o = id(),
      s1 = id(),
      s2 = id();
    const [r] = await tx([
      order(o, [[SKU1, ORDER_OF_THREE]]),
      submit(s1, o, [[SKU1, HANDED]]),
      approve(s1, id()),
      [
        "postgres",
        `create temp table mid on commit drop as
         select o.status::text status, (select sum(x.remaining)::int from app.order_lines_left(o.id) x) remaining,
                (select i.total_paisa::int from public.invoice i where i.order_id = o.id) total
         from public.sales_order o where o.client_id = '${o}';`,
      ],
      submit(s2, o),
      approve(s2, id()),
      [
        "postgres",
        `select (select row_to_json(mid) from mid) mid, o.status::text status,
                (select array_agg(i.total_paisa::int order by i.total_paisa desc) from public.invoice i where i.order_id = o.id) totals
         from public.sales_order o where o.client_id = '${o}';`,
      ],
    ]);
    expect(r).toEqual({
      mid: { status: "partially_delivered", remaining: ORDER_OF_THREE - HANDED, total: HANDED * SKU1_PAISA },
      status: "delivered",
      totals: [HANDED * SKU1_PAISA, (ORDER_OF_THREE - HANDED) * SKU1_PAISA],
    });
  });

  it("duplicate approvals create nothing twice", async () => {
    const o = id(),
      s = id(),
      d = id();
    const [r] = await tx([
      order(o, [[SKU1, HANDED]]),
      submit(s, o),
      approve(s, d),
      ["postgres", `create temp table first on commit drop as select id from public.invoice where order_id = ${oid(o)};`],
      approve(s, d),
      [
        "postgres",
        `select (select id from first) = (select x.id from public.invoice x where x.order_id = ${oid(o)}) same;`,
      ],
      counts(o),
    ]);
    expect(r).toEqual({ deliveries: 1, invoices: 1, installments: 1, decisions: 1 });
    const again = await inSeries(
      [
        [approve(s, id())],
        [approve(s, id(), "owner")],
      ] as Step[][],
      (steps) => failOf([order(o, [[SKU1, HANDED]]), submit(s, o), approve(s, d), ...steps]),
    );
    expect(again.map(([c, m]) => [c, m?.includes(ALREADY_DECIDED)])).toEqual([
      [WRONG_STATE, true],
      [WRONG_STATE, true],
    ]);
    const p = id(),
      s2 = id();
    expect(
      await txCode([order(o, [[SKU1, HANDED]]), order(p, [[SKU2, 1]]), submit(s, o), submit(s2, p), approve(s, d), approve(s2, d)]),
    ).toBe(DUPLICATE);
  });

  it("a replay that arrives after the decision returns the same invoice", async () => {
    const o = id(),
      s = id(),
      d = id();
    const [r] = await tx([
      order(o, [[SKU1, HANDED]]),
      submit(s, o),
      approve(s, d),
      ["postgres", "create temp table n on commit drop as select count(*)::int c from control.audit_event;"],
      ["manager", `select (app.office_approve_delivery(${sid(s)}, '${d}')).id = (select id from public.invoice where order_id = ${oid(o)}) same;`],
      ["postgres", "select (select count(*)::int from control.audit_event) - (select c from n) new_audit_rows;"],
    ]);
    expect(r).toEqual({ new_audit_rows: 0 });
  });

  it("who may approve", async () => {
    const o = id(),
      s = id();
    const base = [order(o, [[SKU1, HANDED]]), submit(s, o)];
    const callers = ["repA", "repB", "managerAal1", "ownerAal1", "suspended"] as const;
    const codes = await inSeries(callers, (who) => txCode([...base, approve(s, id(), who)]));
    expect(codes).toEqual(callers.map(() => DENIED));
    expect(await txCode([...base, approve(s, id(), "anon")])).toBe(DENIED);
    expect(await txCode([...base, ["manager", `select app.office_approve_delivery('${id()}', '${id()}');`]])).toBe(BAD_INPUT);
    expect(await txCode([...base, ["manager", `select app.office_approve_delivery(${sid(s)}, null);`]])).toBe(BAD_INPUT);
  });

  it("a rep promoted after submitting cannot approve its own submission", async () => {
    const o = id(),
      s = id();
    const promoted: Step[] = [
      order(o, [[SKU1, HANDED]]),
      submit(s, o),
      ["owner", `select app.owner_set_role('${fx.repA.id}', 'manager', 'test: promoted with a submission queued');`],
      [
        "postgres",
        `select set_config('request.jwt.claims', '${JSON.stringify({ sub: fx.repA.id, role: "authenticated", aal: "aal2" })}', true);
         set local role authenticated;
         select app.office_approve_delivery(${sid(s)}, '${id()}');`,
      ],
    ];
    const [code, msg] = await failOf(promoted);
    expect([code, msg?.includes(WHO_SUBMITTED)]).toEqual([DENIED, true]);
    const [r] = await tx([...promoted.slice(0, -1), approve(s, id(), "owner"), counts(o)]);
    expect(r).toEqual({ deliveries: 1, invoices: 1, installments: 1, decisions: 1 });
  });

  it("a rep cannot reach the official writes", async () => {
    const o = id();
    const base = [order(o, [[SKU1, 1]])];
    const writes = [
      `insert into public.delivery (client_id, order_id, salon_id, from_location_id, delivered_by, delivered_by_role, rep_day_id, status, received_by_name, lat, lng)
       values (gen_random_uuid(), ${oid(o)}, '${SALON}', ${BAG_A}, '${fx.repA.id}', 'rep', (select id from public.rep_day where rep_id = '${fx.repA.id}' and day = ${TODAY}), 'full', 'Ayesha', 1, 1);`,
      `insert into public.invoice (number, delivery_id, order_id, salon_id, plan, subtotal_paisa, discount_paisa, total_paisa, issued_by)
       values ('INV-99-000001', gen_random_uuid(), ${oid(o)}, '${SALON}', 'CASH', 1, 0, 1, '${fx.repA.id}');`,
      `insert into public.stock_movement (client_id, sku_id, qty, from_location_id, kind, actor_id)
       values (gen_random_uuid(), '${SKU1}', 1, ${BAG_A}, 'sale', '${fx.repA.id}');`,
      `update public.sales_order set status = 'delivered' where id = ${oid(o)};`,
      `select app.finalise_delivery('${id()}', ${oid(o)}, ${BAG_A}, null, 'Ayesha', 1, 1, false, null, null, '${fx.repA.id}', 'rep');`,
    ];
    const codes = await inSeries(writes, (sql) => txCode([...base, ["repA", sql]]));
    expect(codes).toEqual(writes.map(() => DENIED));
  });

  it("a refused approval writes nothing and takes no invoice number", async () => {
    const o = id(),
      s = id(),
      a = id(),
      b = id();
    const [r] = await tx([
      order(a, [[SKU2, 1]]),
      order(o, [[SKU1, HANDED]]),
      order(b, [[SKU2, 1]]),
      submit(s, o),
      officeDeliver(id(), a),
      // The goods leave the pending location behind the office's back, so the approval must fail.
      [
        "postgres",
        `insert into public.stock_movement (client_id, sku_id, qty, from_location_id, to_location_id, kind, actor_id)
         values (gen_random_uuid(), '${SKU1}', ${HANDED}, ${PENDING_A}, '${WH}', 'transfer', '${fx.manager.id}');`,
      ],
      [
        "manager",
        `do $t$ begin perform app.office_approve_delivery(${sid(s)}, '${id()}'); exception when check_violation then null; end $t$;`,
      ],
      officeDeliver(id(), b),
      [
        "postgres",
        `select (select count(*)::int from public.invoice where order_id = ${oid(o)}) invoices,
                (select count(*)::int from public.delivery_submission_decision where submission_id = ${sid(s)}) decisions,
                (select array_agg(number order by number) from public.invoice where order_id in (${oid(a)}, ${oid(b)})) numbers;`,
      ],
    ]);
    const numbers = r.numbers as string[];
    expect([r.invoices, r.decisions, invoiceNo(numbers[1]) - invoiceNo(numbers[0])]).toEqual([0, 0, 1]);
    const [code, msg] = await failOf([
      order(o, [[SKU1, HANDED]]),
      submit(s, o),
      [
        "postgres",
        `insert into public.stock_movement (client_id, sku_id, qty, from_location_id, to_location_id, kind, actor_id)
         values (gen_random_uuid(), '${SKU1}', ${HANDED}, ${PENDING_A}, '${WH}', 'transfer', '${fx.manager.id}');`,
      ],
      approve(s, id()),
    ]);
    expect([code, msg?.includes("insufficient stock at the delivery location")]).toEqual([CHECK, true]);
  });

  it("approval works after the rep has checked out (Review Focus 2)", async () => {
    const o = id(),
      s = id();
    const [r] = await tx([
      order(o, [[SKU1, HANDED]]),
      submit(s, o),
      ["repA", `select app.record_count('${id()}', ${BAG_A}, 'daily_close', '[]'::jsonb); select app.rep_check_out();`],
      approve(s, id()),
      [
        "postgres",
        `select d.rep_day_id = s.rep_day_id same_day, rd.status::text day_status
         from public.delivery d join public.delivery_submission s on s.client_id = d.client_id join public.rep_day rd on rd.id = d.rep_day_id
         where s.client_id = '${s}';`,
      ],
    ]);
    expect(r).toEqual({ same_day: true, day_status: "closed" });
  });

  it("approval survives suspension and reassignment (Review Focus 2)", async () => {
    const o = id(),
      s = id();
    const [r] = await tx([
      order(o, [[SKU1, HANDED]]),
      submit(s, o),
      ["manager", `select app.office_end_territory('${fx.repA.id}', '${T_A}', 'test: moved away');`],
      ["owner", `select app.owner_set_status('${fx.repA.id}', 'suspended', 'test: suspended with a submission queued');`],
      approve(s, id()),
      ["postgres", `select commission_rep_id = '${fx.repA.id}' commission_rep, delivered_by = '${fx.repA.id}' delivered_by_rep from public.invoice where order_id = ${oid(o)};`],
    ]);
    expect(r).toEqual({ commission_rep: true, delivered_by_rep: true });
  });

  it("an undecided submission blocks cancel and office delivery (Review Focus 3)", async () => {
    const o = id(),
      s = id();
    const waiting = [order(o, [[SKU1, HANDED]]), submit(s, o)];
    const blocked = await inSeries(
      [
        ["manager", `select app.cancel_order(${oid(o)}, 'test: cancel while waiting');`],
        officeDeliver(id(), o),
      ] as Step[],
      (step) => failOf([...waiting, step]),
    );
    expect(blocked.map(([c, m]) => [c, m?.includes(WAITING)])).toEqual([
      [WRONG_STATE, true],
      [WRONG_STATE, true],
    ]);
    // After a rejection both behave as today: the office may cancel the order, or deliver it.
    const [cancelled] = await tx([
      ...waiting,
      reject(s, id()),
      ["manager", `select (app.cancel_order(${oid(o)}, 'test: cancel after rejection')).status::text status;`],
    ]);
    expect(cancelled).toEqual({ status: "cancelled" });
    const [delivered] = await tx([...waiting, reject(s, id()), officeDeliver(id(), o), ["postgres", `select status::text status from public.sales_order where id = ${oid(o)};`]]);
    expect(delivered).toEqual({ status: "delivered" });
    // After approval the order is delivered: cancelling refuses as it does for any delivered order.
    expect(await txCode([...waiting, approve(s, id()), ["manager", `select app.cancel_order(${oid(o)}, 'test: too late');`]])).toBe(DENIED);
  });

  it("the approvals queue lists undecided submissions oldest first", async () => {
    const o = id(),
      p = id(),
      s1 = id(),
      s2 = id();
    // No outer order by: the rows come back in the function's own order, submitted_at then id. Both
    // rows are written in one rolled-back transaction, so their submitted_at (now()) ties and the id
    // decides; the test therefore checks the function's order against (submitted_at, id).
    const queue = (scids: string[]): Step => [
      "manager",
      `select submission_id::text sub, rep_name, total_paisa::int total, flags, received_by_name, mock_location
       from app.office_pending_deliveries() where submission_id in (${scids.map(sid).join(", ")});`,
    ];
    const both = await tx([
      order(o, [[SKU1, HANDED]]),
      order(p, [[SKU2, 1]], SALON_NOPIN),
      submit(s1, o),
      submit(s2, p),
      queue([s1, s2]),
    ]);
    expect(both.map((x) => x.sub)).toEqual(both.map((x) => String(x.sub)).sort());
    expect(both.map(({ sub: _sub, ...rest }) => rest).sort((x, y) => Number(x.total) - Number(y.total))).toEqual([
      { rep_name: "[Test] Rep A", total: SKU2_PAISA, flags: ["distance_unknown"], received_by_name: "Ayesha at the counter", mock_location: false },
      { rep_name: "[Test] Rep A", total: HANDED * SKU1_PAISA, flags: [], received_by_name: "Ayesha at the counter", mock_location: false },
    ]);
    const left = await tx([
      order(o, [[SKU1, HANDED]]),
      order(p, [[SKU2, 1]], SALON_NOPIN),
      submit(s1, o),
      submit(s2, p),
      approve(s1, id()),
      queue([s1, s2]),
    ]);
    expect(left.map((x) => x.total)).toEqual([SKU2_PAISA]);
    expect(await txCode([["repA", "select * from app.office_pending_deliveries();"]])).toBe(DENIED);
  });
});

// ------------------------------------------------- Task 5: rejection and settlement ----
const REASON = "wrong shade delivered";
const ABOVE_OWNER_THRESHOLD = 9; // 9 x Rs 1,200 is above Rs 10,000 (doc 13 section 9 default)
const SUBMISSIONS_AFTER_RESUBMIT = 2; // the rejected one and the new one
const UNSETTLED_LIMIT = "at most the unsettled quantity";
// The goods of a rejected submission of HANDED units of SKU1.
const rejectedGoods = (o: string, s: string, qty = HANDED): Step[] => [
  order(o, [[SKU1, qty]]),
  submit(s, o),
  reject(s, id(), REASON),
];
/** An adjustment request for missing goods: made by `maker`, decided by `checker` unless left pending. */
const missingRequest = (
  a: string,
  s: string,
  qty: number,
  args: { maker?: Persona; checker?: Persona | null; sku?: string; submission?: string } = {},
): Step[] => {
  const steps: Step[] = [
    [
      args.maker ?? "owner",
      `select app.request_approval('${a}', 'adjustment', 'stock_location', ${PENDING_A},
         jsonb_build_object('sku_id', '${args.sku ?? SKU1}', 'qty_delta', -${qty}, 'submission_id', ${args.submission ?? sid(s)}), 'goods missing after rejection');`,
    ],
  ];
  const checker = args.checker === undefined ? "manager" : args.checker;
  return checker
    ? [
        ...steps,
        [checker, `select app.decide_approval((select id from control.approval_request where client_id = '${a}'), true, 'checked the count');`],
      ]
    : steps;
};
const approvalId = (a: string) => `(select id from control.approval_request where client_id = '${a}')::text`;

describe("rejection keeps history; the office settles pending goods three ways (D-32, L-0385)", () => {
  it("rejection keeps history and leaves the goods in pending", async () => {
    const o = id(),
      s = id();
    const [r] = await tx([
      order(o, [[SKU1, HANDED]]),
      baseline,
      submit(s, o),
      reject(s, id(), REASON),
      [
        "postgres",
        `select x.outcome, x.reason, x.decided_by = '${fx.manager.id}' by_manager, ${deltas}, o.status::text status,
                (select count(*)::int from public.delivery d where d.order_id = o.id) deliveries,
                (select count(*)::int from public.invoice i where i.order_id = o.id) invoices,
                (select count(*)::int from public.delivery_submission where client_id = '${s}') kept
         from public.delivery_submission_decision x join public.delivery_submission s on s.id = x.submission_id
         join public.sales_order o on o.id = s.order_id where s.client_id = '${s}';`,
      ],
    ]);
    expect(r).toEqual({
      outcome: "rejected",
      reason: REASON,
      by_manager: true,
      bag1: -HANDED,
      pend1: HANDED,
      bag2: 0,
      pend2: 0,
      status: "confirmed",
      deliveries: 0,
      invoices: 0,
      kept: 1,
    });
    const mine = await tx([
      ...rejectedGoods(o, s),
      ["repA", `select status, reason, unsettled, invoice_id from app.my_submissions() where submission_id = ${sid(s)};`],
    ]);
    expect(mine).toEqual([{ status: "rejected", reason: REASON, unsettled: HANDED, invoice_id: null }]);
  });

  it("rejection refusals", async () => {
    const o = id(),
      s = id(),
      d = id();
    const waiting = [order(o, [[SKU1, HANDED]]), submit(s, o)];
    const cases: Array<[Step[], string]> = [
      [[...waiting, reject(s, id(), "shad")], BAD_INPUT],
      [[...waiting, reject(s, d), reject(s, id())], WRONG_STATE],
      [[...waiting, reject(s, d), approve(s, id())], WRONG_STATE],
      [[...waiting, approve(s, id()), reject(s, id())], WRONG_STATE],
      [[...waiting, reject(s, id(), REASON, "repA")], DENIED],
      [[...waiting, reject(s, id(), REASON, "managerAal1")], DENIED],
      [[...waiting, ["manager", `select app.office_reject_delivery(${sid(s)}, null, '${REASON}');`]], BAD_INPUT],
      [
        [
          ...waiting,
          ["owner", `select app.owner_set_role('${fx.repA.id}', 'manager', 'test: promoted with a submission queued');`],
          [
            "postgres",
            `select set_config('request.jwt.claims', '${JSON.stringify({ sub: fx.repA.id, role: "authenticated", aal: "aal2" })}', true);
             set local role authenticated;
             select app.office_reject_delivery(${sid(s)}, '${id()}', '${REASON}');`,
          ],
        ],
        DENIED,
      ],
    ];
    const codes = await inSeries(cases, ([steps]) => txCode(steps));
    expect(codes).toEqual(cases.map(([, code]) => code));
    const [r] = await tx([
      ...waiting,
      reject(s, d),
      ["manager", `select (app.office_reject_delivery(${sid(s)}, '${d}', '${REASON}')).id = (select id from public.delivery_submission_decision where client_id = '${d}') same;`],
    ]);
    expect(r).toEqual({ same: true });
  });

  it("goods return to the bag", async () => {
    const o = id(),
      s = id(),
      rc = id();
    const [r] = await tx([
      ...rejectedGoods(o, s),
      baseline,
      resolve(rc, s, SKU1, HANDED, "returned_to_bag"),
      [
        "postgres",
        `select ${deltas}, m.kind::text kind, m.from_location_id = ${PENDING_A} from_pending, m.to_location_id = ${BAG_A} to_bag,
                m.source_type, m.source_id = r.id names_settlement, r.outcome, r.note, r.approval_id
         from public.pending_stock_resolution r join public.stock_movement m on m.id = r.movement_id where r.client_id = '${rc}';`,
      ],
    ]);
    expect(r).toEqual({
      bag1: HANDED,
      pend1: -HANDED,
      bag2: 0,
      pend2: 0,
      kind: "pending_returned",
      from_pending: true,
      to_bag: true,
      source_type: "pending_stock_resolution",
      names_settlement: true,
      outcome: "returned_to_bag",
      note: "counted at the office",
      approval_id: null,
    });
  });

  it("goods return to the warehouse", async () => {
    const o = id(),
      s = id();
    const [r] = await tx([
      ...rejectedGoods(o, s),
      baseline,
      ["postgres", `create temp table w on commit drop as select app.on_hand('${WH}', '${SKU1}')::int wh;`],
      resolve(id(), s, SKU1, HANDED, "returned_to_warehouse", { warehouse: WH }),
      ["postgres", `select ${deltas}, app.on_hand('${WH}', '${SKU1}')::int - (select wh from w) wh;`],
    ]);
    expect(r).toEqual({ bag1: 0, pend1: -HANDED, bag2: 0, pend2: 0, wh: HANDED });
    const wrong = await inSeries([id(), "BAG"], (w) =>
      txFail([
        ...rejectedGoods(o, s),
        w === "BAG"
          ? [
              "manager",
              `select app.office_resolve_pending('${id()}', ${sid(s)}, '${SKU1}', 1, 'returned_to_warehouse', 'counted', ${BAG_A}, null);`,
            ]
          : resolve(id(), s, SKU1, 1, "returned_to_warehouse", { warehouse: w }),
      ]),
    );
    expect(wrong.map((f) => [f?.code, f?.message.includes("active warehouse")])).toEqual([
      [BAD_INPUT, true],
      [BAD_INPUT, true],
    ]);
  });

  it("goods reported missing need an approved adjustment", async () => {
    const o = id(),
      s = id(),
      a = id();
    const noApproval = await txFail([...rejectedGoods(o, s), resolve(id(), s, SKU1, HANDED, "missing")]);
    expect(noApproval?.code).toBe(DENIED);
    const pending = await txFail([
      ...rejectedGoods(o, s),
      ...missingRequest(a, s, HANDED, { checker: null }),
      ["manager", `select app.office_resolve_pending('${id()}', ${sid(s)}, '${SKU1}', ${HANDED}, 'missing', 'counted', null, ${approvalId(a)}::uuid);`],
    ]);
    expect([pending?.code, pending?.message.includes("not approved")]).toEqual([DENIED, true]);
    const [r] = await tx([
      ...rejectedGoods(o, s),
      baseline,
      ...missingRequest(a, s, HANDED),
      ["manager", `select app.office_resolve_pending('${id()}', ${sid(s)}, '${SKU1}', ${HANDED}, 'missing', 'counted', null, ${approvalId(a)}::uuid);`],
      [
        "postgres",
        `select ${deltas}, m.kind::text kind, m.from_location_id = ${PENDING_A} from_pending, m.to_location_id to_loc,
                m.approval_id::text = ${approvalId(a)} approval, r.approval_id::text = ${approvalId(a)} settled_with
         from public.pending_stock_resolution r join public.stock_movement m on m.id = r.movement_id where r.submission_id = ${sid(s)};`,
      ],
    ]);
    expect(r).toEqual({ bag1: 0, pend1: -HANDED, bag2: 0, pend2: 0, kind: "adjustment", from_pending: true, to_loc: null, approval: true, settled_with: true });
    // Above the owner threshold a manager's check is not enough (Decision 3: the manager raises it, the owner checks).
    const big = id(),
      bs = id(),
      ba = id();
    const above = await txFail([
      ...rejectedGoods(big, bs, ABOVE_OWNER_THRESHOLD),
      ...missingRequest(ba, bs, ABOVE_OWNER_THRESHOLD),
      [
        "manager",
        `select app.office_resolve_pending('${id()}', ${sid(bs)}, '${SKU1}', ${ABOVE_OWNER_THRESHOLD}, 'missing', 'counted', null, ${approvalId(ba)}::uuid);`,
      ],
    ]);
    expect([above?.code, above?.message.includes("owner's approval")]).toEqual([DENIED, true]);
    const [ok] = await tx([
      ...rejectedGoods(big, bs, ABOVE_OWNER_THRESHOLD),
      ...missingRequest(ba, bs, ABOVE_OWNER_THRESHOLD, { maker: "manager", checker: "owner" }),
      [
        "manager",
        `select (app.office_resolve_pending('${id()}', ${sid(bs)}, '${SKU1}', ${ABOVE_OWNER_THRESHOLD}, 'missing', 'counted', null, ${approvalId(ba)}::uuid)).outcome;`,
      ],
    ]);
    expect(ok).toEqual({ outcome: "missing" });
  });

  it("an approval is used once, and only for its own quantity (Review Focus 5)", async () => {
    const o = id(),
      s = id(),
      a = id();
    const settleMissing = (qty: number) =>
      ["manager", `select app.office_resolve_pending('${id()}', ${sid(s)}, '${SKU1}', ${qty}, 'missing', 'counted', null, ${approvalId(a)}::uuid);`] as Step;
    const reused = await txFail([...rejectedGoods(o, s, ORDER_OF_THREE), ...missingRequest(a, s, 1), settleMissing(1), settleMissing(1)]);
    expect(reused?.code).toBe(DENIED);
    const p = id(),
      ps = id();
    const mismatches: Step[][] = [
      missingRequest(a, s, 1, { sku: SKU2 }),
      missingRequest(a, s, HANDED),
      [order(p, [[SKU1, 1]]), submit(ps, p), reject(ps, id(), REASON), ...missingRequest(a, s, 1, { submission: sid(ps) })],
    ];
    const codes = await inSeries(mismatches, (steps) => txCode([...rejectedGoods(o, s, ORDER_OF_THREE), ...steps, settleMissing(1)]));
    expect(codes).toEqual(mismatches.map(() => DENIED));
  });

  it("pending stock cannot be adjusted outside a settlement (Review Focus 5)", async () => {
    const o = id(),
      s = id(),
      a = id(),
      w = id();
    const direct = await txFail([
      ...rejectedGoods(o, s),
      ...missingRequest(a, s, 1),
      ["manager", `select app.office_post_adjustment('${id()}', ${approvalId(a)}::uuid);`],
    ]);
    expect([direct?.code, direct?.message.includes("settled through its delivery submission")]).toEqual([BAD_INPUT, true]);
    const [r] = await tx([
      [
        "owner",
        `select app.request_approval('${w}', 'adjustment', 'stock_location', '${WH}', jsonb_build_object('sku_id', '${SKU1}', 'qty_delta', 1), 'found one more');`,
      ],
      ["manager", `select app.decide_approval((select id from control.approval_request where client_id = '${w}'), true, 'checked the count');`],
      ["manager", `select (app.office_post_adjustment('${id()}', ${approvalId(w)}::uuid)).kind::text kind;`],
    ]);
    expect(r).toEqual({ kind: "adjustment" });
  });

  it("settlement cannot exceed what was rejected", async () => {
    const o = id(),
      s = id(),
      rc = id();
    const split = await tx([
      ...rejectedGoods(o, s),
      resolve(rc, s, SKU1, 1, "returned_to_bag"),
      resolve(id(), s, SKU1, 1, "returned_to_bag"),
      ["postgres", `select count(*)::int n from public.pending_stock_resolution where submission_id = ${sid(s)};`],
    ]);
    expect(split).toEqual([{ n: HANDED }]);
    const third = await failOf([
      ...rejectedGoods(o, s),
      resolve(id(), s, SKU1, 1, "returned_to_bag"),
      resolve(id(), s, SKU1, 1, "returned_to_bag"),
      resolve(id(), s, SKU1, 1, "returned_to_bag"),
    ]);
    expect([third[0], third[1]?.includes(UNSETTLED_LIMIT)]).toEqual([BAD_INPUT, true]);
    const over = await txFail([
      ...rejectedGoods(o, s),
      [
        "postgres",
        `insert into public.stock_movement (client_id, sku_id, qty, from_location_id, to_location_id, kind, actor_id)
         values ('${rc}', '${SKU1}', 1, ${PENDING_A}, ${BAG_A}, 'pending_returned', '${fx.manager.id}');
         insert into public.pending_stock_resolution (client_id, submission_id, sku_id, qty, outcome, note, movement_id, resolved_by)
         values (gen_random_uuid(), ${sid(s)}, '${SKU1}', ${ORDER_OF_THREE}, 'returned_to_bag', 'counted', ${movementOf(rc)}, '${fx.manager.id}');`,
      ],
    ]);
    expect([over?.code, over?.message.includes(UNSETTLED)]).toEqual([CHECK, true]);
    const waiting = await txCode([order(o, [[SKU1, HANDED]]), submit(s, o), resolve(id(), s, SKU1, 1, "returned_to_bag")]);
    expect(waiting).toBe(WRONG_STATE);
    const approved = await txCode([order(o, [[SKU1, HANDED]]), submit(s, o), approve(s, id()), resolve(id(), s, SKU1, 1, "returned_to_bag")]);
    expect(approved).toBe(BAD_INPUT);
    const [replay] = await tx([
      ...rejectedGoods(o, s),
      resolve(rc, s, SKU1, 1, "returned_to_bag"),
      resolve(rc, s, SKU1, 1, "returned_to_bag"),
      [
        "postgres",
        `select (select count(*)::int from public.pending_stock_resolution where submission_id = ${sid(s)}) settlements,
                (select count(*)::int from public.stock_movement where kind = 'pending_returned' and source_type = 'pending_stock_resolution'
                   and source_id in (select id from public.pending_stock_resolution where submission_id = ${sid(s)})) moves;`,
      ],
    ]);
    expect(replay).toEqual({ settlements: 1, moves: 1 });
    expect(await txCode([...rejectedGoods(o, s), resolve(rc, s, SKU1, 1, "returned_to_bag"), resolve(rc, s, SKU1, HANDED, "returned_to_bag")])).toBe(
      DUPLICATE,
    );
  });

  it("who may settle", async () => {
    const o = id(),
      s = id();
    const callers = ["repA", "managerAal1", "suspended"] as const;
    const codes = await inSeries(callers, (who) => txCode([...rejectedGoods(o, s), resolve(id(), s, SKU1, 1, "returned_to_bag", { who })]));
    expect(codes).toEqual(callers.map(() => DENIED));
  });

  it("the rep resubmits after the goods are back in the bag (Review Focus 4)", async () => {
    const o = id(),
      s = id();
    // Rep A's bag holds only what the prelude loaded (and whatever earlier files committed); an order for
    // all of it is rejected, so the bag holds none of SKU1 until the office returns it.
    const full: Step[] = [
      ["postgres", `create temp table q on commit drop as select ${onHand(BAG_A, SKU1)} n; grant select on q to authenticated;`],
      [
        "manager",
        `select app.office_create_order('${o}', '${SALON}', 'CASH', jsonb_build_array(jsonb_build_object('sku_id', '${SKU1}', 'qty', (select n from q))), '${fx.repA.id}');`,
      ],
      submit(s, o),
      reject(s, id(), REASON),
    ];
    const early = await failOf([...full, submit(id(), o)]);
    expect([early[0], early[1]?.includes("insufficient stock at the delivery location")]).toEqual([CHECK, true]);
    const [r] = await tx([
      ...full,
      ["manager", `select app.office_resolve_pending('${id()}', ${sid(s)}, '${SKU1}', (select n from q), 'returned_to_bag', 'counted at the office');`],
      submit(id(), o),
      [
        "postgres",
        `select count(*)::int subs, (select sum(reserved)::int from app.order_lines_open(${oid(o)})) reserved,
                (select n from q) = (select sum(reserved)::int from app.order_lines_open(${oid(o)})) all_reserved
         from public.delivery_submission where order_id = ${oid(o)};`,
      ],
    ]);
    expect([r.subs, r.all_reserved]).toEqual([SUBMISSIONS_AFTER_RESUBMIT, true]);
  });

  it("the settle list shows what is unsettled", async () => {
    const o = id(),
      s = id(),
      a = id();
    const list = (): Step => [
      "manager",
      `select unsettled, sku_id::text = '${SKU1}' sku, rep_name, reason, request_status::text request_status,
              request_maker_id = '${fx.manager.id}' made_by_manager
       from app.office_pending_stock() where submission_id = ${sid(s)};`,
    ];
    const before = await tx([...rejectedGoods(o, s), list()]);
    expect(before).toEqual([
      { unsettled: HANDED, sku: true, rep_name: "[Test] Rep A", reason: REASON, request_status: null, made_by_manager: null },
    ]);
    const after = await tx([
      ...rejectedGoods(o, s),
      resolve(id(), s, SKU1, 1, "returned_to_bag"),
      ...missingRequest(a, s, 1, { maker: "manager", checker: null }),
      list(),
    ]);
    expect(after).toEqual([
      { unsettled: 1, sku: true, rep_name: "[Test] Rep A", reason: REASON, request_status: "pending", made_by_manager: true },
    ]);
    const gone = await tx([...rejectedGoods(o, s), resolve(id(), s, SKU1, HANDED, "returned_to_bag"), list()]);
    expect(gone).toEqual([]);
    expect(await txCode([["repA", "select * from app.office_pending_stock();"]])).toBe(DENIED);
  });
});

// ------------------------------------------------------- Task 7: old rep path closed ----
describe("the rep's direct delivery is closed (D-32)", () => {
  it("no one can finalise a delivery through the old rep path", async () => {
    const o = id();
    const call = `select app.rep_deliver('${id()}', ${oid(o)}, 'Ayesha at the counter', ${PIN_LAT}, ${PIN_LNG});`;
    const callers = ["repA", "manager", "owner"] as const;
    const codes = await inSeries(callers, (who) => txCode([order(o, [[SKU1, 1]]), [who, call]]));
    expect(codes).toEqual(callers.map(() => DENIED));
    const asService: Step = [
      "postgres",
      `select set_config('request.jwt.claims', '{"role":"service_role"}', true); set local role service_role; ${call}`,
    ];
    expect(await txCode([order(o, [[SKU1, 1]]), asService])).toBe(DENIED);
    // As the table owner the body itself refuses, so nothing is ever written.
    const owner = await failOf([order(o, [[SKU1, 1]]), ["postgres", call]]);
    expect([owner[0], owner[1]?.includes("use app.rep_submit_delivery")]).toEqual([DENIED, true]);
    const [r] = await tx([
      order(o, [[SKU1, 1]]),
      ["repA", `do $t$ begin perform app.rep_deliver('${id()}', ${oid(o)}, 'Ayesha', 1, 1); exception when insufficient_privilege then null; end $t$;`],
      counts(o),
    ]);
    expect(r).toEqual({ deliveries: 0, invoices: 0, installments: 0, decisions: 0 });
  });
});

