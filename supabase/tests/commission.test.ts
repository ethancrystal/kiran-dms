/**
 * Commission rates, stamps and payments (migration 20261105140000, completion slice 5, P1-22; CTL-13,
 * FLD-01, FLD-03, FLD-06; D-31, D-38, OQ-34 default).
 *
 * The rate on an invoice is stamped once, at delivery approval (app.finalise_delivery): the order's
 * assigned rep's rate on the salon's current assignment, else that rep's default, else 0. Earned is
 * derived from invoices, floored per invoice; payments and full reversals are append-only; owed is
 * earned minus paid; a payment never exceeds what is earned and unpaid.
 *
 * Two fresh reps (C and D) are made here, so their totals are exact whatever other files committed.
 * Committed: those reps, their territory, salons, catalogue, a warehouse with its opening stock, and
 * one salon login. Everything else (rates, assignments, orders, invoices, payments) runs in one
 * rolled-back transaction per test; the territory is ended in afterAll.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fx, MANAGER, OWNER, run, sqlstate } from "./helpers/db";
import { asLogin, type Login, newLogin, quote } from "./helpers/invite";

const C = { commit: true };
const DENIED = "42501";
const BAD_INPUT = "22023";
const WRONG_STATE = "55000";
const DUPLICATE = "23505";
const CHECK = "23514";
const OPENING_STOCK = 100;
const BAG_LOAD = 10;
const BAG_LIMIT_PAISA = 50_000_000;
// Hand-worked figures. SKU1 is Rs 123.45: at 2.5% one invoice earns floor(308.625) = 308 paisa, so two
// invoices earn 616, where flooring the sum would give 617. SKU2 is Rs 500: at 4% one invoice earns 2000.
const SKU1_PAISA = 12_345;
const SKU2_PAISA = 50_000;
const RATE_DEFAULT = 250;
const RATE_SALON = 400;
const RATE_OTHER = 700;
const RATE_LATER = 900;
const RATE_AT_APPROVAL = 600;
const EARN_SKU1_AT_250 = 308;
const EARN_SKU2_AT_400 = 2000;
const EARN_SKU1_AT_900 = 1111; // floor(12345 x 900 / 10000) = floor(1111.05)
const EARN_SKU1_AT_600 = 740; // floor(12345 x 600 / 10000) = floor(740.7)
const EARNED_TWO = EARN_SKU1_AT_250 + EARN_SKU1_AT_250; // 616
const EARNED_THREE = EARNED_TWO + EARN_SKU2_AT_400; // 2616, not 2617 as flooring the sum would give
const THREE_INVOICES = 3;
const PAY_FIRST = 500;
const OWED_AFTER_FIRST = EARNED_TWO - PAY_FIRST; // 116
const PAY_SMALL = 100;
const PAY_TINY = 8;
const PAY_WRONG_REVERSAL = 400;
const PAY_NEGATIVE = -5;
const NOTE_TOO_LONG = 301;
const REPLAYED_ROWS = 2;
const CAP_TEST_TIMEOUT_MS = 120_000;
const PHONE_SPACE = 10_000_000;
const PHONE_DIGITS = 7;
const TAG_LENGTH = 8;
const PIN_LAT = 24.9;
const PIN_LNG = 67.1;
const LINE_CAP = 50;

const id = () => randomUUID();
const tag = () => randomUUID().slice(0, TAG_LENGTH);
/** Runs one async step per item, one after another (the shared database takes one test transaction at a time). */
const inSeries = <T, R>(items: readonly T[], f: (t: T) => Promise<R>) =>
  items.reduce<Promise<R[]>>(async (acc, t) => [...(await acc), await f(t)], Promise.resolve([]));
const TODAY = "(now() at time zone 'Asia/Karachi')::date";
const YESTERDAY = `(${TODAY} - 1)`;

const T = id(),
  AREA = id(),
  S1 = id(),
  S2 = id(),
  GROUP = id(),
  PRODUCT = id(),
  SKU1 = id(),
  SKU2 = id(),
  WH = id();
const repC = { id: id(), device: `dev-${id()}` };
const repD = { id: id(), device: `dev-${id()}` };
let salonLogin: Login;

type Persona = "repC" | "repD" | "repCWrongDevice" | "manager" | "managerAal1" | "owner" | "suspended" | "anon" | "salon";
const who = (k: Persona) => {
  if (k === "anon") return `reset role; select set_config('request.jwt.claims', '{"role":"anon"}', true); set local role anon;`;
  if (k === "salon") return asLogin(salonLogin);
  const [uid, aal, device] = {
    repC: [repC.id, "aal1", repC.device],
    repD: [repD.id, "aal1", repD.device],
    repCWrongDevice: [repC.id, "aal1", "dev-not-approved-0000"],
    manager: [fx.manager.id, "aal2", null],
    managerAal1: [fx.manager.id, "aal1", null],
    owner: [fx.owner.id, "aal2", null],
    suspended: [fx.suspendedRep.id, "aal1", fx.suspendedRep.device],
  }[k] as [string, string, string | null];
  return `
  reset role;
  select set_config('request.jwt.claims', '${JSON.stringify({ sub: uid, role: "authenticated", aal })}', true),
         set_config('request.headers', '${JSON.stringify(device ? { "x-kiran-device": device } : {})}', true);
  set local role authenticated;`;
};

type Step = [Persona | "postgres", string];
const script = (steps: Step[]) => steps.map(([k, sql]) => `${k === "postgres" ? "reset role;" : who(k)}\n${sql}`).join("\n");
type Multi = Array<{ rows: Array<Record<string, unknown>> }>;
/** Runs the steps in one rolled-back transaction and returns the last statement's rows. */
const tx = async (steps: Step[]) => {
  const r = (await run("postgres", script(steps))) as unknown as Multi | { rows: Array<Record<string, unknown>> };
  return Array.isArray(r) ? (r.at(-1)?.rows ?? []) : r.rows;
};
const txCode = async (steps: Step[]) => {
  try {
    await run("postgres", script(steps));
    return null;
  } catch (e) {
    return (e as { code?: string }).code ?? "unknown";
  }
};

const lines = (l: Array<[string, number]>) => `'${JSON.stringify(l.map(([sku_id, qty]) => ({ sku_id, qty })))}'::jsonb`;
const oid = (cid: string) => `(select id from public.sales_order where client_id = '${cid}')`;
const pid = (cid: string) => `(select id from public.commission_payment where client_id = '${cid}')`;
const order = (cid: string, salon: string, l: Array<[string, number]>, rep: string | null = repC.id): Step => [
  "manager",
  `select app.office_create_order('${cid}', '${salon}', 'CASH', ${lines(l)}, ${rep ? `'${rep}'` : "null"});`,
];
const deliver = (dcid: string, ocid: string): Step => [
  "manager",
  `select app.office_deliver('${dcid}', ${oid(ocid)}, '${WH}', 'Ayesha at the counter');`,
];
/** An order of one SKU for a salon, delivered by the office from the warehouse: one invoice. */
const sale = (salon: string, sku: string, rep: string | null = repC.id): Step[] => {
  const o = id();
  return [order(o, salon, [[sku, 1]], rep), deliver(o, o)];
};
const setRate = (rep: string, bp: number, cid = id(), by: Persona = "manager"): Step => [
  by,
  `select app.office_set_commission_rate('${cid}', '${rep}', ${bp}, 'agreed in the monthly review');`,
];
const assign = (salon: string, rep: string | null, bp: number | null): Step => [
  "manager",
  `select app.office_assign_salon_rep('${id()}', '${salon}', ${rep ? `'${rep}'` : "null"}, ${bp ?? "null"});`,
];
const pay = (cid: string, rep: string, amount: number, note: string | null = "cash in hand", by: Persona = "manager"): Step => [
  by,
  `select app.office_record_commission_payment('${cid}', '${rep}', ${amount}, ${quote(note)});`,
];
const reverse = (cid: string, paymentCid: string, reason = "paid twice by mistake", by: Persona = "manager"): Step => [
  by,
  `select app.office_reverse_commission_payment('${cid}', ${pid(paymentCid)}, ${quote(reason)});`,
];
/** The office's statement of a rep for today, as the last statement. */
const statement = (rep: string, from = TODAY, to = TODAY): Step => [
  "manager",
  `select app.office_commission('${rep}', ${from}, ${to}) as s;`,
];
type Statement = {
  default_rate_bp: number | null;
  earned_paisa: number;
  paid_paisa: number;
  earned_to_date_paisa: number;
  paid_to_date_paisa: number;
  owed_paisa: number;
  invoice_count: number;
  invoices: Array<{ invoice_id: string; rate_bp: number; commission_paisa: number; total_paisa: number }>;
  payments: Array<{ payment_id: string; kind: string; amount_paisa: number; reversed: boolean; reason: string | null }>;
  salon_rates: Array<{ salon_id: string; rate_bp: number | null }>;
  rate_history?: Array<{ rate_bp: number; reason: string }>;
};
const stmt = async (steps: Step[]) => (await tx(steps))[0].s as Statement;
/** The newest invoice of the transaction's last delivery: its stamps. */
const lastInvoice: Step = [
  "postgres",
  "select commission_rep_id, commission_rate_bp from public.invoice order by issued_at desc, number desc limit 1;",
];

const makeRep = async (rep: { id: string; device: string }, name: string) => {
  await run("postgres", "insert into auth.users (id, email) values ($1, $2)", [rep.id, `rep.${tag()}@example.test`], C);
  await run(
    OWNER,
    "select app.owner_create_user($1, $2, 'rep'::public.app_role, $3)",
    [rep.id, name, `+92000${String(Math.floor(Math.random() * PHONE_SPACE)).padStart(PHONE_DIGITS, "0")}`],
    C,
  );
  const reg = (await run(
    "postgres",
    `${who(rep === repC ? "repC" : "repD")} select (app.register_device('${rep.device}', 'android', 'test phone')).id as d`,
    [],
    C,
  )) as unknown as Multi;
  await run(MANAGER, "select app.approve_device($1, 'fixture')", [reg.at(-1)?.rows[0].d], C);
  await run(MANAGER, "select app.office_assign_territory($1, $2)", [rep.id, T], C);
};

beforeAll(async () => {
  await run(MANAGER, "select app.office_upsert_territory($1, $2)", [T, `[Test] Commission ${tag()}`], C);
  await run(MANAGER, "select app.office_upsert_area($1, $2, '[Test] Commission area')", [AREA, T], C);
  await makeRep(repC, "[Test] Rep C commission");
  await makeRep(repD, "[Test] Rep D commission");
  await inSeries(
    [
      [S1, "one"],
      [S2, "two"],
    ] as const,
    ([s, n]) =>
      run(
        MANAGER,
        "select app.create_salon($1, $2, 'ladies_parlor', $3, 'manual', null, $4, $5)",
        [s, `[Test] Commission salon ${n} ${tag()}`, AREA, PIN_LAT, PIN_LNG],
        C,
      ),
  );
  await run(MANAGER, "select app.office_upsert_product_group($1, $2, 21)", [GROUP, `[Test] Commission colour ${tag()}`], C);
  await run(
    MANAGER,
    "select app.office_upsert_product($1, $2, '[Dummy] Kiran', '[Dummy] Commission colour')",
    [PRODUCT, GROUP],
    C,
  );
  await inSeries([SKU1, SKU2], (s) =>
    run(
      MANAGER,
      "select app.office_upsert_sku($1, $2, $3, '[Dummy] shade', 'ml', 100)",
      [s, PRODUCT, `T-COM-${tag().toUpperCase()}`],
      C,
    ),
  );
  await run(OWNER, "select app.owner_set_sku_price($1, $2, 'dummy list price')", [SKU1, SKU1_PAISA], C);
  await run(OWNER, "select app.owner_set_sku_price($1, $2, 'dummy list price')", [SKU2, SKU2_PAISA], C);
  await run(MANAGER, "select app.office_create_location($1, 'warehouse', '[Test] Commission store')", [WH], C);
  await run(
    "postgres",
    `insert into public.stock_movement (client_id, sku_id, qty, to_location_id, kind, actor_id)
     values (gen_random_uuid(), $1, $4, $3, 'receipt', $5), (gen_random_uuid(), $2, $4, $3, 'receipt', $5)`,
    [SKU1, SKU2, WH, OPENING_STOCK, fx.manager.id],
    C,
  );
  // A salon login for salon two (slice 1's invitation path), for the "salon denied" checks.
  const inv = (
    await run(
      MANAGER,
      `select app.office_invite('${id()}', 'salon', '[Test] Salon login', 'salon.${tag()}@example.test', '${S2}', null, null, null, null) as r`,
      [],
      C,
    )
  ).rows[0].r as { email: string; token: string };
  salonLogin = await newLogin({ email: inv.email });
  await run("postgres", `${asLogin(salonLogin)} select app.redeem_invitation(${quote(inv.token)})`, [], C);
});

afterAll(async () => {
  await inSeries([repC, repD], (r) =>
    run(MANAGER, "select app.office_end_territory($1, $2, 'commission tests finished')", [r.id, T], C),
  );
});

// ---------------------------------------------------------------------- schema ----
describe("schema: rep_commission_rate, commission_payment, invoice.commission_rate_bp", () => {
  it("both tables refuse UPDATE, DELETE and TRUNCATE, even for postgres", async () => {
    const p = id();
    const base: Step[] = [setRate(repC.id, RATE_DEFAULT), ...sale(S1, SKU1), pay(p, repC.id, PAY_SMALL)];
    const changes = [
      "update public.rep_commission_rate set rate_bp = 0",
      "delete from public.rep_commission_rate",
      "truncate public.rep_commission_rate cascade",
      "update public.commission_payment set amount_paisa = 1",
      "delete from public.commission_payment",
      "truncate public.commission_payment cascade",
    ];
    const codes = await inSeries(changes, (change) => txCode([...base, ["postgres", `${change};`]]));
    expect(codes.filter((c) => c === null)).toEqual([]);
    // The base itself succeeds, so each refusal above is the change's own.
    expect(await txCode(base)).toBeNull();
  });

  it("a new invoice must carry a rate: the NOT VALID check binds new rows", async () => {
    const rows = await tx([
      [
        "postgres",
        `select convalidated, pg_get_constraintdef(c.oid) def from pg_constraint c
         where conrelid = 'public.invoice'::regclass and conname = 'invoice_rate_stamped';`,
      ],
    ]);
    expect(rows[0]).toMatchObject({ convalidated: false });
    // The constraint's text as Postgres prints it: matches "CHECK ((commission_rate_bp IS NOT NULL)) NOT VALID",
    // rejects "CHECK ((delivered_by IS NOT NULL))".
    // https://regex101.com/?regex=commission_rate_bp%20IS%20NOT%20NULL&flavor=javascript
    expect(rows[0].def).toMatch(/commission_rate_bp IS NOT NULL/);
  });

  it("a direct invoice insert with delivered_by but no rate is refused by that check", async () => {
    const o = id(),
      d = id();
    const insert = `insert into public.delivery (client_id, order_id, salon_id, from_location_id, delivered_by, delivered_by_role, status, received_by_name)
       values ('${d}', ${oid(o)}, '${S1}', '${WH}', '${fx.manager.id}', 'manager', 'full', 'Bilal at the door');
       insert into public.invoice (number, delivery_id, order_id, salon_id, rep_id, plan, subtotal_paisa, discount_paisa, total_paisa, issued_by, delivered_by)
       select app.next_doc_number('INV'), x.id, x.order_id, x.salon_id, '${repC.id}', 'CASH', ${SKU1_PAISA}, 0, ${SKU1_PAISA}, '${fx.manager.id}', '${fx.manager.id}'
       from public.delivery x where x.client_id = '${d}';`;
    let failure: { code?: string; constraint?: string } = {};
    try {
      await run("postgres", script([order(o, S1, [[SKU1, 1]]), ["postgres", insert]]));
    } catch (e) {
      failure = e as { code?: string; constraint?: string };
    }
    expect([failure.code, failure.constraint]).toEqual([CHECK, "invoice_rate_stamped"]);
  });
});

// -------------------------------------------------------------------- stamping ----
describe("the rate is stamped at approval (D-38)", () => {
  it("no default and no salon rate: 0", async () => {
    const r = await tx([...sale(S1, SKU1), lastInvoice]);
    expect(r[0]).toEqual({ commission_rep_id: repC.id, commission_rate_bp: 0 });
  });

  it("the rep's default when the salon has no rate for the rep", async () => {
    const r = await tx([setRate(repC.id, RATE_DEFAULT), ...sale(S1, SKU1), lastInvoice]);
    expect(r[0]).toEqual({ commission_rep_id: repC.id, commission_rate_bp: RATE_DEFAULT });
  });

  it("the salon assignment's rate for that rep wins over the default", async () => {
    const r = await tx([setRate(repC.id, RATE_DEFAULT), assign(S1, repC.id, RATE_SALON), ...sale(S1, SKU1), lastInvoice]);
    expect(r[0]).toEqual({ commission_rep_id: repC.id, commission_rate_bp: RATE_SALON });
  });

  it("an assignment to the rep with no rate falls back to the default", async () => {
    const r = await tx([setRate(repC.id, RATE_DEFAULT), assign(S1, repC.id, null), ...sale(S1, SKU1), lastInvoice]);
    expect(r[0]).toEqual({ commission_rep_id: repC.id, commission_rate_bp: RATE_DEFAULT });
  });

  it("the latest default counts, not an earlier one", async () => {
    const r = await tx([setRate(repC.id, RATE_LATER), setRate(repC.id, RATE_DEFAULT), ...sale(S1, SKU1), lastInvoice]);
    expect(r[0]).toEqual({ commission_rep_id: repC.id, commission_rate_bp: RATE_DEFAULT });
  });

  it("a salon reassigned to another rep after the order: the order's rep keeps the commission at its default", async () => {
    const o = id();
    const r = await tx([
      setRate(repC.id, RATE_DEFAULT),
      setRate(repD.id, RATE_LATER),
      order(o, S1, [[SKU1, 1]]),
      assign(S1, repD.id, RATE_OTHER),
      deliver(o, o),
      lastInvoice,
    ]);
    expect(r[0]).toEqual({ commission_rep_id: repC.id, commission_rate_bp: RATE_DEFAULT });
  });

  it("an order with no assigned rep: no commission rep, rate 0", async () => {
    const r = await tx([setRate(repC.id, RATE_DEFAULT), ...sale(S1, SKU1, null), lastInvoice]);
    expect(r[0]).toEqual({ commission_rep_id: null, commission_rate_bp: 0 });
  });

  it("a rate changed between the rep's submission and the approval: the rate at approval is stamped", async () => {
    const o = id(),
      s = id();
    const bag = `(select l.id from public.stock_location l where l.kind = 'rep_bag' and l.owner_user_id = '${repC.id}')`;
    const r = await tx([
      [
        "postgres",
        `insert into public.rep_day (rep_id, day) values ('${repC.id}', ${TODAY}) on conflict (rep_id, day) do nothing;`,
      ],
      [
        "owner",
        `select app.office_create_location('${id()}', 'rep_bag', '[Test] Commission bag C', '${repC.id}', ${BAG_LIMIT_PAISA});`,
      ],
      [
        "postgres",
        `insert into public.stock_movement (client_id, sku_id, qty, from_location_id, to_location_id, kind, actor_id)
         values (gen_random_uuid(), '${SKU1}', ${BAG_LOAD}, '${WH}', ${bag}, 'issue_to_rep', '${fx.manager.id}');`,
      ],
      setRate(repC.id, RATE_DEFAULT),
      order(o, S1, [[SKU1, 1]]),
      ["repC", `select app.rep_submit_delivery('${s}', ${oid(o)}, 'Ayesha at the counter', ${PIN_LAT}, ${PIN_LNG}, null);`],
      setRate(repC.id, RATE_AT_APPROVAL),
      [
        "manager",
        `select app.office_approve_delivery((select id from public.delivery_submission where client_id = '${s}'), '${s}');`,
      ],
      lastInvoice,
    ]);
    expect(r[0]).toEqual({ commission_rep_id: repC.id, commission_rate_bp: RATE_AT_APPROVAL });
  });

  it("the approved delivery earns at the stamped rate: floor(12345 x 600 / 10000) = 740", async () => {
    const s = await stmt([setRate(repC.id, RATE_AT_APPROVAL), ...sale(S1, SKU1), statement(repC.id)]);
    expect(s.invoices[0]).toMatchObject({
      rate_bp: RATE_AT_APPROVAL,
      commission_paisa: EARN_SKU1_AT_600,
      total_paisa: SKU1_PAISA,
    });
    expect(s.earned_paisa).toBe(EARN_SKU1_AT_600);
  });

  it("later rate changes and a reassignment leave stamped invoices alone; new invoices take the new rate", async () => {
    const s = await stmt([
      setRate(repC.id, RATE_DEFAULT),
      ...sale(S1, SKU1),
      setRate(repC.id, RATE_LATER),
      assign(S1, repD.id, RATE_OTHER),
      ...sale(S2, SKU1),
      statement(repC.id),
    ]);
    expect(s.invoices.map((i) => i.rate_bp).sort()).toEqual([RATE_DEFAULT, RATE_LATER]);
    expect(s.earned_paisa).toBe(EARN_SKU1_AT_250 + EARN_SKU1_AT_900);
  });
});

// ----------------------------------------------------------------- earned ----
describe("earned is derived from invoices, floored per invoice", () => {
  it("hand-worked: two Rs 123.45 invoices at 2.5% and one Rs 500 invoice at 4% earn 2616 paisa", async () => {
    const s = await stmt([
      setRate(repC.id, RATE_DEFAULT),
      assign(S2, repC.id, RATE_SALON),
      ...sale(S1, SKU1),
      ...sale(S1, SKU1),
      ...sale(S2, SKU2),
      statement(repC.id),
    ]);
    expect(s.invoices.map((i) => i.commission_paisa).sort((a, b) => a - b)).toEqual([
      EARN_SKU1_AT_250,
      EARN_SKU1_AT_250,
      EARN_SKU2_AT_400,
    ]);
    expect(s.earned_paisa).toBe(EARNED_THREE);
    expect(s).toMatchObject({
      invoice_count: THREE_INVOICES,
      paid_paisa: 0,
      owed_paisa: EARNED_THREE,
      earned_to_date_paisa: EARNED_THREE,
      default_rate_bp: RATE_DEFAULT,
    });
    expect(s.salon_rates).toEqual([expect.objectContaining({ salon_id: S2, rate_bp: RATE_SALON })]);
  });

  it("a zero rate earns nothing, and another rep's invoices never count", async () => {
    const s = await stmt([
      setRate(repC.id, 0),
      setRate(repD.id, RATE_DEFAULT),
      ...sale(S1, SKU1),
      ...sale(S1, SKU1, repD.id),
      statement(repC.id),
    ]);
    expect(s).toMatchObject({ earned_paisa: 0, owed_paisa: 0, invoice_count: 1 });
    expect(s.invoices[0]).toMatchObject({ rate_bp: 0, commission_paisa: 0 });
  });

  it("a range of yesterday shows nothing earned in it, while owed stays all-time", async () => {
    const s = await stmt([setRate(repC.id, RATE_DEFAULT), ...sale(S1, SKU1), statement(repC.id, YESTERDAY, YESTERDAY)]);
    expect(s).toMatchObject({ earned_paisa: 0, invoice_count: 0, invoices: [], owed_paisa: EARN_SKU1_AT_250 });
  });

  it("bad ranges are refused (22023)", async () => {
    const ranges = [
      [TODAY, YESTERDAY],
      ["null", TODAY],
      [TODAY, "null"],
      [`(${TODAY} - 367)`, TODAY],
    ] as const;
    const codes = await inSeries(ranges, async ([f, t]) => [
      await txCode([statement(repC.id, f, t)]),
      await txCode([["repC", `select app.my_commission(${f}, ${t});`]]),
    ]);
    expect(codes.flat()).toEqual(ranges.flatMap(() => [BAD_INPUT, BAD_INPUT]));
  });

  it(
    "the rep's lists are capped at 50 rows while the totals count every invoice",
    async () => {
      const sales = Array.from({ length: LINE_CAP + 1 }, () => sale(S1, SKU1)).flat();
      const s = (
        await tx([setRate(repC.id, RATE_DEFAULT), ...sales, ["repC", `select app.my_commission(${TODAY}, ${TODAY}) as s;`]])
      )[0].s as Statement;
      expect(s.invoices.length).toBe(LINE_CAP);
      expect(s.invoice_count).toBe(LINE_CAP + 1);
      expect(s.earned_paisa).toBe((LINE_CAP + 1) * EARN_SKU1_AT_250);
    },
    CAP_TEST_TIMEOUT_MS,
  );
});

// ------------------------------------------------------------------ rates ----
describe("app.office_set_commission_rate", () => {
  it("validates the rate, the reason and the rep", async () => {
    const bad = (bp: string, reason: string, rep = repC.id) =>
      txCode([["manager", `select app.office_set_commission_rate('${id()}', '${rep}', ${bp}, ${quote(reason)});`]]);
    expect(await bad("10001", "agreed in review")).toBe(BAD_INPUT);
    expect(await bad("-1", "agreed in review")).toBe(BAD_INPUT);
    expect(await bad("null", "agreed in review")).toBe(BAD_INPUT);
    expect(await bad("250", "ok")).toBe(BAD_INPUT);
    expect(await bad("250", "   ")).toBe(BAD_INPUT);
    expect(await bad("250", "agreed in review", fx.manager.id)).toBe(BAD_INPUT);
    expect(await bad("250", "agreed in review", id())).toBe(BAD_INPUT);
    expect(await bad("10000", "agreed in review")).toBeNull();
  });

  it("a replay returns the same row; the same client_id with other facts is refused", async () => {
    const k = id();
    const r = await tx([
      setRate(repC.id, RATE_DEFAULT, k),
      setRate(repC.id, RATE_DEFAULT, k),
      ["postgres", `select count(*)::int n from public.rep_commission_rate where client_id = '${k}';`],
    ]);
    expect(r[0].n).toBe(1);
    expect(await txCode([setRate(repC.id, RATE_DEFAULT, k), setRate(repC.id, RATE_LATER, k)])).toBe(DUPLICATE);
    expect(await txCode([setRate(repC.id, RATE_DEFAULT, k), setRate(repC.id, RATE_DEFAULT, k, "owner")])).toBe(DUPLICATE);
  });

  it("the office statement shows the rate history, newest first, with its reason", async () => {
    const s = await stmt([setRate(repC.id, RATE_DEFAULT), setRate(repC.id, RATE_LATER, id(), "owner"), statement(repC.id)]);
    expect(s.rate_history?.map((h) => h.rate_bp)).toEqual([RATE_LATER, RATE_DEFAULT]);
    expect(s.default_rate_bp).toBe(RATE_LATER);
  });
});

// --------------------------------------------------------------- payments ----
describe("payments and reversals (FLD-06)", () => {
  const earned616: Step[] = [setRate(repC.id, RATE_DEFAULT), ...sale(S1, SKU1), ...sale(S1, SKU1)];

  it("pay, refuse an overpayment, pay the rest, reverse: hand-worked balances", async () => {
    const p1 = id(),
      p2 = id(),
      r1 = id();
    const after1 = await stmt([...earned616, pay(p1, repC.id, PAY_FIRST), statement(repC.id)]);
    expect(after1).toMatchObject({ earned_paisa: EARNED_TWO, paid_paisa: PAY_FIRST, owed_paisa: OWED_AFTER_FIRST });
    expect(await txCode([...earned616, pay(p1, repC.id, PAY_FIRST), pay(id(), repC.id, OWED_AFTER_FIRST + 1)])).toBe(CHECK);
    const after2 = await stmt([
      ...earned616,
      pay(p1, repC.id, PAY_FIRST),
      pay(p2, repC.id, OWED_AFTER_FIRST),
      statement(repC.id),
    ]);
    expect(after2).toMatchObject({ paid_paisa: EARNED_TWO, owed_paisa: 0 });
    const after3 = await stmt([
      ...earned616,
      pay(p1, repC.id, PAY_FIRST),
      pay(p2, repC.id, OWED_AFTER_FIRST),
      reverse(r1, p1),
      statement(repC.id),
    ]);
    expect(after3).toMatchObject({ paid_paisa: OWED_AFTER_FIRST, owed_paisa: PAY_FIRST, paid_to_date_paisa: OWED_AFTER_FIRST });
    const first = after3.payments.find((p) => p.kind === "payment" && p.amount_paisa === PAY_FIRST);
    expect(first?.reversed).toBe(true);
    expect(after3.payments.find((p) => p.kind === "reversal")).toMatchObject({
      amount_paisa: PAY_FIRST,
      reason: "paid twice by mistake",
    });
    // After the reversal the first payment is owed again and can be paid.
    expect(await txCode([...earned616, pay(p1, repC.id, PAY_FIRST), reverse(r1, p1), pay(id(), repC.id, EARNED_TWO)])).toBeNull();
  });

  it("nothing earned: any payment is refused (23514)", async () => {
    expect(await txCode([pay(id(), repD.id, 1)])).toBe(CHECK);
  });

  it("bad input is refused (22023)", async () => {
    expect(await txCode([...earned616, pay(id(), repC.id, 0)])).toBe(BAD_INPUT);
    expect(await txCode([...earned616, pay(id(), repC.id, PAY_NEGATIVE)])).toBe(BAD_INPUT);
    expect(await txCode([...earned616, pay(id(), fx.manager.id, 1)])).toBe(BAD_INPUT);
    expect(await txCode([...earned616, pay(id(), repC.id, 1, "x".repeat(NOTE_TOO_LONG))])).toBe(BAD_INPUT);
    expect(await txCode([["manager", `select app.office_record_commission_payment(null, '${repC.id}', 1, null);`]])).toBe(
      BAD_INPUT,
    );
  });

  it("a reversal: once, never of a reversal, with a reason, of a known payment", async () => {
    const p1 = id(),
      r1 = id();
    const base: Step[] = [...earned616, pay(p1, repC.id, PAY_FIRST), reverse(r1, p1)];
    expect(await txCode([...base, reverse(id(), p1)])).toBe(WRONG_STATE);
    expect(await txCode([...base, reverse(id(), r1)])).toBe(WRONG_STATE);
    expect(await txCode([...earned616, pay(p1, repC.id, PAY_FIRST), reverse(id(), p1, "oops")])).toBe(BAD_INPUT);
    expect(
      await txCode([["manager", `select app.office_reverse_commission_payment('${id()}', '${id()}', 'paid twice by mistake');`]]),
    ).toBe(BAD_INPUT);
  });

  it("replays create nothing new; a client_id reused with other facts is refused", async () => {
    const p1 = id(),
      r1 = id();
    const r = await tx([
      ...earned616,
      pay(p1, repC.id, PAY_FIRST),
      pay(p1, repC.id, PAY_FIRST),
      reverse(r1, p1),
      reverse(r1, p1),
      ["postgres", `select count(*)::int n from public.commission_payment where rep_id = '${repC.id}';`],
    ]);
    expect(r[0].n).toBe(REPLAYED_ROWS);
    expect(await txCode([...earned616, pay(p1, repC.id, PAY_FIRST), pay(p1, repC.id, PAY_WRONG_REVERSAL)])).toBe(DUPLICATE);
    expect(await txCode([...earned616, pay(p1, repC.id, PAY_FIRST), pay(p1, repC.id, PAY_FIRST, "another note")])).toBe(
      DUPLICATE,
    );
    expect(await txCode([...earned616, pay(p1, repC.id, PAY_FIRST), pay(p1, repC.id, PAY_FIRST, "cash in hand", "owner")])).toBe(
      DUPLICATE,
    );
    expect(await txCode([...earned616, pay(p1, repC.id, PAY_FIRST), reverse(r1, p1), pay(r1, repC.id, 1)])).toBe(DUPLICATE);
  });

  it("the guard refuses a direct insert too: an overpayment or a reversal that mirrors no payment (23514)", async () => {
    const ins = (kind: string, amount: number, reverses = "null", reason = "null") =>
      `insert into public.commission_payment (client_id, rep_id, kind, amount_paisa, reverses_id, reason, recorded_by)
       values (gen_random_uuid(), '${repC.id}', '${kind}', ${amount}, ${reverses}, ${reason}, '${fx.manager.id}');`;
    const p1 = id();
    expect(await txCode([...earned616, ["postgres", ins("payment", EARNED_TWO + 1)]])).toBe(CHECK);
    expect(
      await txCode([
        ...earned616,
        pay(p1, repC.id, PAY_FIRST),
        ["postgres", ins("reversal", PAY_WRONG_REVERSAL, pid(p1), "'wrong amount'")],
      ]),
    ).toBe(CHECK);
    expect(await txCode([...earned616, ["postgres", ins("payment", EARNED_TWO)]])).toBeNull();
  });

  it("each write leaves an audit row whose actor is the session's user, and the chain verifies", async () => {
    const p1 = id();
    const r = await tx([
      ...earned616,
      pay(p1, repC.id, PAY_FIRST),
      [
        "postgres",
        `select (select count(*)::int from control.audit_event e where e.table_name = 'public.commission_payment'
                   and e.row_id = ${pid(p1)}::text and e.actor_id = '${fx.manager.id}' and e.action = 'INSERT') pay_rows,
                (select count(*)::int from control.audit_event e where e.table_name = 'public.rep_commission_rate'
                   and e.after ->> 'rep_id' = '${repC.id}' and e.actor_id = '${fx.manager.id}') rate_rows,
                (select ok from control.verify_audit_chain()) ok;`,
      ],
    ]);
    expect(r[0]).toEqual({ pay_rows: 1, rate_rows: 1, ok: true });
  });
});

// ---------------------------------------------------------------- access ----
describe("who may call what (doc 06 section 2)", () => {
  const office = [
    `select app.office_set_commission_rate('${id()}', '${repC.id}', 1, 'agreed in review')`,
    `select app.office_record_commission_payment('${id()}', '${repC.id}', 1, null)`,
    `select app.office_reverse_commission_payment('${id()}', '${id()}', 'paid twice by mistake')`,
    `select app.office_commission('${repC.id}', ${TODAY}, ${TODAY})`,
    `select * from app.office_commission_reps(${TODAY}, ${TODAY})`,
  ];
  const mine = `select app.my_commission(${TODAY}, ${TODAY})`;

  it("anonymous, a salon login, a suspended rep and an AAL1 manager are refused everything (42501)", async () => {
    const calls = (["anon", "salon", "suspended", "managerAal1"] as const).flatMap((p) =>
      [...office, mine].map((sql) => [p, sql] as const),
    );
    const codes = await inSeries(calls, async ([p, sql]) => `${p}: ${sql} → ${await txCode([[p, `${sql};`]])}`);
    expect(codes).toEqual(calls.map(([p, sql]) => `${p}: ${sql} → ${DENIED}`));
  });

  it("a rep is refused every office function, and reads its own only on its approved phone", async () => {
    const codes = await inSeries(office, (sql) => txCode([["repC", `${sql};`]]));
    expect(codes).toEqual(office.map(() => DENIED));
    expect(await txCode([["repCWrongDevice", `${mine};`]])).toBe(DENIED);
    expect(await txCode([["manager", `${mine};`]])).toBe(DENIED);
  });

  it("a rep reads only its own invoices and payments, never another rep's", async () => {
    const pd = id();
    const s = (
      await tx([
        setRate(repC.id, RATE_DEFAULT),
        setRate(repD.id, RATE_SALON),
        ...sale(S1, SKU1),
        ...sale(S2, SKU2, repD.id),
        pay(pd, repD.id, PAY_SMALL),
        ["repC", `${mine} as s;`],
      ])
    )[0].s as Statement;
    expect(s).toMatchObject({ earned_paisa: EARN_SKU1_AT_250, paid_paisa: 0, invoice_count: 1, payments: [] });
    expect(s.invoices.every((i) => i.total_paisa === SKU1_PAISA)).toBe(true);
    const d = (
      await tx([setRate(repD.id, RATE_SALON), ...sale(S2, SKU2, repD.id), pay(pd, repD.id, PAY_SMALL), ["repD", `${mine} as s;`]])
    )[0].s as Statement;
    expect(d).toMatchObject({ earned_paisa: EARN_SKU2_AT_400, paid_paisa: PAY_SMALL, owed_paisa: EARN_SKU2_AT_400 - PAY_SMALL });
  });

  it("the rep's statement holds allow-listed fields only: no cost, margin, stock or supplier data", async () => {
    const s = (
      await tx([setRate(repC.id, RATE_DEFAULT), ...sale(S1, SKU1), pay(id(), repC.id, PAY_SMALL), ["repC", `${mine} as s;`]])
    )[0].s as Record<string, unknown> & Statement;
    expect(Object.keys(s).sort()).toEqual(
      [
        "default_rate_bp",
        "earned_paisa",
        "earned_to_date_paisa",
        "from",
        "invoice_count",
        "invoices",
        "owed_paisa",
        "paid_paisa",
        "paid_to_date_paisa",
        "payments",
        "rep_id",
        "salon_rates",
        "to",
      ].sort(),
    );
    expect(Object.keys(s.invoices[0]).sort()).toEqual(
      ["commission_paisa", "invoice_id", "issued_at", "number", "rate_bp", "salon_name", "total_paisa"].sort(),
    );
    expect(Object.keys(s.payments[0]).sort()).toEqual(
      [
        "amount_paisa",
        "kind",
        "note",
        "payment_id",
        "reason",
        "recorded_at",
        "recorded_by_name",
        "reversed",
        "reverses_id",
      ].sort(),
    );
    // Any word that would mean cost, margin, stock or supplier data, any case: matches "unit_cost_paisa" or
    // "Supplier", rejects "commission_paisa".
    // https://regex101.com/?regex=cost%7Cmargin%7Csupplier%7Cvault%7Clocation&flags=i&flavor=javascript
    expect(JSON.stringify(s)).not.toMatch(/cost|margin|supplier|vault|location/i);
  });

  it("owner and manager both set rates, pay and read; the summary lists the rep with its figures", async () => {
    const r = await tx([
      setRate(repC.id, RATE_DEFAULT, id(), "owner"),
      ...sale(S1, SKU1),
      pay(id(), repC.id, PAY_TINY, "first part", "owner"),
      pay(id(), repC.id, PAY_SMALL, "second part", "manager"),
      ["owner", `select * from app.office_commission_reps(${TODAY}, ${TODAY}) where rep_id = '${repC.id}';`],
    ]);
    expect(r[0]).toMatchObject({
      default_rate_bp: RATE_DEFAULT,
      earned_paisa: String(EARN_SKU1_AT_250),
      paid_paisa: String(PAY_TINY + PAY_SMALL),
      owed_paisa: String(EARN_SKU1_AT_250 - PAY_TINY - PAY_SMALL),
    });
  });

  it("the commission tables show the office everything and a rep or a salon login nothing", async () => {
    const base: Step[] = [setRate(repC.id, RATE_DEFAULT), ...sale(S1, SKU1), pay(id(), repC.id, PAY_SMALL)];
    const count = `select (select count(*)::int from public.rep_commission_rate where rep_id = '${repC.id}') r,
                          (select count(*)::int from public.commission_payment where rep_id = '${repC.id}') p;`;
    expect((await tx([...base, ["manager", count]]))[0]).toEqual({ r: 1, p: 1 });
    expect((await tx([...base, ["repC", count]]))[0]).toEqual({ r: 0, p: 0 });
    expect((await tx([...base, ["salon", count]]))[0]).toEqual({ r: 0, p: 0 });
  });

  it("the customer's invoice document carries no commission field (H-05)", async () => {
    const r = await tx([
      setRate(repC.id, RATE_DEFAULT),
      ...sale(S1, SKU1),
      [
        "manager",
        "select app.invoice_document((select id from public.invoice order by issued_at desc, number desc limit 1))::text d;",
      ],
    ]);
    // A JSON key naming commission or a rate (the test's product name holds the word, so values are
    // not checked): matches '"commission_rate_bp":' or '"rate_bp":', rejects '"Commission colour"'.
    // https://regex101.com/?regex=%22%5Ba-z_%5D*%28commission%7Crate_bp%29%5Ba-z_%5D*%22%3A&flavor=javascript
    expect(String(r[0].d)).not.toMatch(/"[a-z_]*(commission|rate_bp)[a-z_]*":/);
  });

  it("internal helpers have no grant (42501)", async () => {
    const calls = [
      `select app.commission_rate_for('${repC.id}', '${S1}')`,
      `select app.commission_statement('${repC.id}', current_date, current_date)`,
      `select app.commission_earned_paisa('${repC.id}', null, null)`,
      `select app.commission_paid_paisa('${repC.id}', null, null)`,
      "select app.assert_commission_range(current_date, current_date)",
    ];
    const codes = await inSeries(calls, (sql) => sqlstate(MANAGER, sql));
    expect(codes).toEqual(calls.map(() => DENIED));
  });
});
