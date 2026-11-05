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

