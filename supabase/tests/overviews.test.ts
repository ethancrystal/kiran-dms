/**
 * Overview reads that add up on their own (migration 20261105180000, completion slice 9, P1-26; doc 16;
 * RPT-01 thin; CAP-02; FLD-06; D-38, D-40; A-20).
 *
 * app.office_overview_counts and app.office_overview_rows (office home), app.office_investor_month
 * (investors' "This month" block), app.my_month_orders (the rep's own month) and app.office_rep_month
 * (every rep's month). Read functions only: they write nothing, not even an audit row.
 *
 * Two fresh reps (E and F) are made here, so their month figures are exact whatever other files
 * committed. The office-wide counts are checked as deltas inside one rolled-back transaction, and the
 * investors' totals row as the sum of the investor rows. Committed: those reps, their territory, two
 * salons, a catalogue, a warehouse with its opening stock and one salon login; everything else runs in
 * one rolled-back transaction per test; the territory is ended in afterAll.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fx, MANAGER, OWNER, run } from "./helpers/db";
import { asLogin, type Login, newLogin, quote } from "./helpers/invite";
import { signOrderSql } from "./helpers/submit-approve";

const C = { commit: true };
const DENIED = "42501";
const BAD_INPUT = "22023";
const OPENING_STOCK = 100;
// Hand-worked figures (paisa). SKU1 is Rs 123.45, SKU2 Rs 500.
const SKU1_PAISA = 12_345;
const SKU2_PAISA = 50_000;
const RATE_BP = 400; // 4%: an SKU2 invoice earns 2000, an SKU1 invoice floor(493.8) = 493
const EARN_SKU2 = 2000;
const INVESTED = 1_000_000; // Rs 10,000
const DECIDED_PREV = 10_000;
const DECIDED_THIS = 25_000;
const PAID_PROFIT_THIS = 5_000;
const PAID_PRINCIPAL_THIS = 2_000;
const TAG_LENGTH = 8;
const PHONE_SPACE = 10_000_000;
const PHONE_DIGITS = 7;
const PIN_LAT = 24.9;
const PIN_LNG = 67.1;
const WEEK_DAYS = 7;
const MONDAY = 1;
const TWO = 2;
const THREE = 3;
const FIVE = 5;
const COMMISSION_PAID = 500;
const LIST_CAP = 50;
const DELIVERED_CAP = 20;
const ZERO = BigInt(0);

const id = () => randomUUID();
const tag = () => randomUUID().slice(0, TAG_LENGTH);
/** Runs one async step per item, one after another (the shared database takes one test transaction at a time). */
const inSeries = <T, R>(items: readonly T[], f: (t: T) => Promise<R>) =>
  items.reduce<Promise<R[]>>(async (acc, t) => [...(await acc), await f(t)], Promise.resolve([]));

// Months as SQL, relative to Karachi today, so no date is ever in the future.
const TODAY = "(now() at time zone 'Asia/Karachi')::date";
const THIS_MONTH = `date_trunc('month', ${TODAY}::timestamp)::date`;
const PREV_MONTH = `(${THIS_MONTH} - interval '1 month')::date`;
const PREV_PREV_MONTH = `(${THIS_MONTH} - interval '2 months')::date`;
const PREV_MONTH_LAST_DAY = `(${THIS_MONTH} - 1)`;
/** The instant this Karachi month began (midnight in Karachi). */
const THIS_MONTH_MIDNIGHT = `(${THIS_MONTH}::timestamp at time zone 'Asia/Karachi')`;

const T = id(),
  AREA = id(),
  S1 = id(),
  S2 = id(),
  GROUP = id(),
  PRODUCT = id(),
  SKU1 = id(),
  SKU2 = id(),
  WH = id();
const repE = { id: id(), device: `dev-${id()}`, name: `[Test] Rep E overview ${tag()}` };
const repF = { id: id(), device: `dev-${id()}`, name: `[Test] Rep F overview ${tag()}` };
const S2_NAME = `[Test] Overview salon two ${tag()}`;
let salonLogin: Login;

type Persona =
  | "repE"
  | "repF"
  | "repEWrongDevice"
  | "manager"
  | "managerAal1"
  | "owner"
  | "ownerAal1"
  | "suspended"
  | "anon"
  | "salon";
const who = (k: Persona) => {
  if (k === "anon") return `reset role; select set_config('request.jwt.claims', '{"role":"anon"}', true); set local role anon;`;
  if (k === "salon") return asLogin(salonLogin);
  const [uid, aal, device] = {
    repE: [repE.id, "aal1", repE.device],
    repF: [repF.id, "aal1", repF.device],
    repEWrongDevice: [repE.id, "aal1", "dev-not-approved-0000"],
    manager: [fx.manager.id, "aal2", null],
    managerAal1: [fx.manager.id, "aal1", null],
    owner: [fx.owner.id, "aal2", null],
    ownerAal1: [fx.owner.id, "aal1", null],
    suspended: [fx.suspendedRep.id, "aal1", fx.suspendedRep.device],
  }[k] as [string, string, string | null];
  return `
  reset role;
  select set_config('request.jwt.claims', '${JSON.stringify({ sub: uid, role: "authenticated", aal })}', true),
         set_config('request.headers', '${JSON.stringify(device ? { "x-kiran-device": device } : {})}', true);
  set local role authenticated;`;
};

type Step = [Persona | "postgres", string];
type Row = Record<string, unknown>;
const script = (steps: Step[]) => steps.map(([k, sql]) => `${k === "postgres" ? "reset role;" : who(k)}\n${sql}`).join("\n");
type Multi = Array<{ rows: Row[] }>;
/** Runs the steps in one rolled-back transaction and returns every statement's rows. */
const txAll = async (steps: Step[]): Promise<Row[][]> => {
  const r = (await run("postgres", script(steps))) as unknown as Multi | { rows: Row[] };
  return Array.isArray(r) ? r.map((x) => x.rows ?? []) : [r.rows];
};
/** The last statement's rows. */
const tx = async (steps: Step[]) => (await txAll(steps)).at(-1) ?? [];
const txCode = async (steps: Step[]) => {
  try {
    await run("postgres", script(steps));
    return null;
  } catch (e) {
    return (e as { code?: string }).code ?? "unknown";
  }
};
/** Rows of the statements whose first column is named `mark`, in order. */
const marked = (all: Row[][], mark: string) => all.filter((rows) => rows.length > 0 && mark in rows[0]);

const lines = (l: Array<[string, number]>) => `'${JSON.stringify(l.map(([sku_id, qty]) => ({ sku_id, qty })))}'::jsonb`;
const oid = (cid: string) => `(select id from public.sales_order where client_id = '${cid}')`;
const order = (cid: string, salon: string, l: Array<[string, number]>, rep: string | null): Step => [
  "manager",
  `select app.office_create_order('${cid}', '${salon}', 'CASH', ${lines(l)}, ${rep ? `'${rep}'` : "null"});`,
];
const deliver = (dcid: string, ocid: string): Step => [
  "manager",
  `${signOrderSql(dcid, oid(ocid))} select app.office_deliver('${dcid}', ${oid(ocid)}, '${WH}', 'Ayesha at the counter');`,
];
const cancel = (ocid: string): Step => ["manager", `select app.cancel_order(${oid(ocid)}, 'salon changed its mind');`];
/** Moves an order's placing time, with the immutability trigger off for this rolled-back test only. */
const placedAt = (ocid: string, at: string): Step => [
  "postgres",
  `alter table public.sales_order disable trigger sales_order_guard;
   update public.sales_order set created_at = ${at} where client_id = '${ocid}';
   alter table public.sales_order enable trigger sales_order_guard;`,
];

const counts: Step = ["manager", "select 'counts' as mark, * from app.office_overview_counts();"];
const overviewRows: Step = ["manager", "select 'rows' as mark, * from app.office_overview_rows();"];
const n = (r: Row, k: string) => Number(r[k]);

const makeRep = async (rep: typeof repE, persona: "repE" | "repF") => {
  await run("postgres", "insert into auth.users (id, email) values ($1, $2)", [rep.id, `rep.${tag()}@example.test`], C);
  await run(
    OWNER,
    "select app.owner_create_user($1, $2, 'rep'::public.app_role, $3)",
    [rep.id, rep.name, `+92000${String(Math.floor(Math.random() * PHONE_SPACE)).padStart(PHONE_DIGITS, "0")}`],
    C,
  );
  const reg = (await run(
    "postgres",
    `${who(persona)} select (app.register_device('${rep.device}', 'android', 'test phone')).id as d`,
    [],
    C,
  )) as unknown as Multi;
  await run(MANAGER, "select app.approve_device($1, 'fixture')", [reg.at(-1)?.rows[0].d], C);
  await run(MANAGER, "select app.office_assign_territory($1, $2)", [rep.id, T], C);
};

beforeAll(async () => {
  await run(MANAGER, "select app.office_upsert_territory($1, $2)", [T, `[Test] Overview ${tag()}`], C);
  await run(MANAGER, "select app.office_upsert_area($1, $2, '[Test] Overview area')", [AREA, T], C);
  await makeRep(repE, "repE");
  await makeRep(repF, "repF");
  await inSeries(
    [
      [S1, `[Test] Overview salon one ${tag()}`],
      [S2, S2_NAME],
    ] as const,
    ([s, name]) =>
      run(
        MANAGER,
        "select app.create_salon($1, $2, 'ladies_parlor', $3, 'manual', null, $4, $5)",
        [s, name, AREA, PIN_LAT, PIN_LNG],
        C,
      ),
  );
  await run(MANAGER, "select app.office_upsert_product_group($1, $2, 21)", [GROUP, `[Test] Overview colour ${tag()}`], C);
  await run(MANAGER, "select app.office_upsert_product($1, $2, '[Dummy] Kiran', '[Dummy] Overview colour')", [PRODUCT, GROUP], C);
  await inSeries([SKU1, SKU2], (s) =>
    run(
      MANAGER,
      "select app.office_upsert_sku($1, $2, $3, '[Dummy] shade', 'ml', 100)",
      [s, PRODUCT, `T-OVW-${tag().toUpperCase()}`],
      C,
    ),
  );
  await run(OWNER, "select app.owner_set_sku_price($1, $2, 'dummy list price')", [SKU1, SKU1_PAISA], C);
  await run(OWNER, "select app.owner_set_sku_price($1, $2, 'dummy list price')", [SKU2, SKU2_PAISA], C);
  await run(MANAGER, "select app.office_create_location($1, 'warehouse', '[Test] Overview store')", [WH], C);
  await run(
    "postgres",
    `insert into public.stock_movement (client_id, sku_id, qty, to_location_id, kind, actor_id)
     values (gen_random_uuid(), $1, $4, $3, 'receipt', $5), (gen_random_uuid(), $2, $4, $3, 'receipt', $5)`,
    [SKU1, SKU2, WH, OPENING_STOCK, fx.manager.id],
    C,
  );
  const inv = (
    await run(
      MANAGER,
      `select app.office_invite('${id()}', 'salon', '[Test] Overview salon login', 'salon.${tag()}@example.test', '${S2}', null, null, null, null) as r`,
      [],
      C,
    )
  ).rows[0].r as { email: string; token: string };
  salonLogin = await newLogin({ email: inv.email });
  await run("postgres", `${asLogin(salonLogin)} select app.redeem_invitation(${quote(inv.token)})`, [], C);
});

afterAll(async () => {
  await inSeries([repE, repF], (r) =>
    run(MANAGER, "select app.office_end_territory($1, $2, 'overview tests finished')", [r.id, T], C),
  );
});

// --------------------------------------------------------------------- helpers ----
describe("months: Karachi calendar months, checked", () => {
  it("a moment belongs to the month of its Karachi date: 18:59:59 UTC on Oct 31 is October, 19:00 UTC is November", async () => {
    const r = await tx([
      [
        "postgres",
        `select app.karachi_month('2026-10-31 18:59:59+00')::text a, app.karachi_month('2026-10-31 19:00:00+00')::text b,
                app.karachi_month('2026-02-28 19:00:00+00')::text c;`,
      ],
    ]);
    expect(r[0]).toEqual({ a: "2026-10-01", b: "2026-11-01", c: "2026-03-01" });
  });

  it("a month runs from its first to its last day, February in a leap year included", async () => {
    const r = await tx([["postgres", "select month_start::text, month_end::text from app.overview_month('2024-02-17');"]]);
    expect(r[0]).toEqual({ month_start: "2024-02-01", month_end: "2024-02-29" });
  });

  it("no month, a month not yet started, or one before 2020 is refused (22023)", async () => {
    const bad = ["null", `(${THIS_MONTH} + interval '1 month')::date`, "'2019-12-31'::date"];
    const codes = await inSeries(bad, (m) => txCode([["postgres", `select * from app.overview_month(${m});`]]));
    expect(codes).toEqual([BAD_INPUT, BAD_INPUT, BAD_INPUT]);
    // The current month is fine.
    expect(await txCode([["postgres", `select * from app.overview_month(${TODAY});`]])).toBeNull();
  });

  it("the helpers are not executable by any app role", async () => {
    const r = await tx([
      [
        "postgres",
        `select p.proname f, has_function_privilege('authenticated', p.oid, 'execute') auth,
                has_function_privilege('anon', p.oid, 'execute') anon
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'app' and p.proname in ('karachi_month', 'overview_month', 'order_placed_by', 'rep_month_orders')
         order by 1;`,
      ],
    ]);
    expect(r).toEqual(
      ["karachi_month", "order_placed_by", "overview_month", "rep_month_orders"].map((f) => ({ f, auth: false, anon: false })),
    );
  });
});

// ----------------------------------------------------------------------- access ----
const CALLS = {
  office_overview_counts: "select * from app.office_overview_counts();",
  office_overview_rows: "select * from app.office_overview_rows();",
  office_investor_month: `select * from app.office_investor_month(${TODAY});`,
  office_rep_month: `select * from app.office_rep_month(${TODAY});`,
  my_month_orders: `select * from app.my_month_orders(${TODAY});`,
};

describe("who may read", () => {
  const offices = ["office_overview_counts", "office_overview_rows", "office_investor_month", "office_rep_month"] as const;
  const refusedForOffice: Persona[] = ["anon", "repE", "repEWrongDevice", "suspended", "salon", "managerAal1", "ownerAal1"];

  it("office reads: the owner and a manager at AAL2 read; everyone else is refused (42501)", async () => {
    const ok = await inSeries(
      offices.flatMap((f) => (["manager", "owner"] as const).map((p) => [f, p] as const)),
      ([f, p]) => txCode([[p, CALLS[f]]]),
    );
    expect(ok.filter((c) => c !== null)).toEqual([]);
    const refused = await inSeries(
      offices.flatMap((f) => refusedForOffice.map((p) => [f, p] as const)),
      async ([f, p]) => [f, p, await txCode([[p, CALLS[f]]])] as const,
    );
    expect(refused.filter(([, , c]) => c !== DENIED)).toEqual([]);
  });

  it("the rep's month: a rep on its approved phone reads; a wrong phone, a suspended rep, the office, a salon and anon are refused", async () => {
    expect(await txCode([["repE", CALLS.my_month_orders]])).toBeNull();
    const refused = await inSeries(
      ["repEWrongDevice", "suspended", "manager", "owner", "salon", "anon"] as Persona[],
      async (p) => [p, await txCode([[p, CALLS.my_month_orders]])] as const,
    );
    expect(refused.filter(([, c]) => c !== DENIED)).toEqual([]);
  });

  it("a month that has not started is refused for every reader (22023)", async () => {
    const next = `(${THIS_MONTH} + interval '1 month')::date`;
    const codes = await inSeries(
      [
        ["manager", `select * from app.office_investor_month(${next});`],
        ["manager", `select * from app.office_rep_month(${next});`],
        ["repE", `select * from app.my_month_orders(${next});`],
      ] as Step[],
      (s) => txCode([s]),
    );
    expect(codes).toEqual([BAD_INPUT, BAD_INPUT, BAD_INPUT]);
  });

  it("only the five reads are executable, and none returns a cost, margin, supplier, credit, stock, phone or pin column", async () => {
    const r = await tx([
      [
        "postgres",
        `select p.proname f, array_to_string(p.proargnames, ',') cols
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'app' and p.proname in ('office_overview_counts', 'office_overview_rows', 'office_investor_month',
                                                   'my_month_orders', 'office_rep_month')
           and has_function_privilege('authenticated', p.oid, 'execute')
         order by 1;`,
      ],
    ]);
    expect(r.map((x) => x.f)).toEqual([
      "my_month_orders",
      "office_investor_month",
      "office_overview_counts",
      "office_overview_rows",
      "office_rep_month",
    ]);
    // Matches "unit_cost", "margin_paisa", "credit_snapshot", "stock_qty", "phone", "lat"; not "salon_name".
    // https://regex101.com/?regex=%28%5E%7C%2C%7C_%29%28cost%7Cmargin%7Csupplier%7Cvendor%7Ccredit%7Climit%7Csnapshot%7Cstock%7Cphone%7Clat%7Clng%7Cdevice%7Cip%29%28_%7C%2C%7C%24%29&flavor=javascript
    const forbidden = /(^|,|_)(cost|margin|supplier|vendor|credit|limit|snapshot|stock|phone|lat|lng|device|ip)(_|,|$)/;
    expect(r.filter((x) => forbidden.test(String(x.cols)))).toEqual([]);
  });

  it("reading writes nothing: no audit row, and the chain still verifies", async () => {
    const all = await txAll([
      ["postgres", "select 'before' as mark_a, count(*)::int n from control.audit_event;"],
      ["manager", CALLS.office_overview_counts],
      ["manager", CALLS.office_overview_rows],
      ["manager", CALLS.office_investor_month],
      ["manager", CALLS.office_rep_month],
      ["repE", CALLS.my_month_orders],
      [
        "postgres",
        "select 'after' as mark_b, count(*)::int n, (select ok from control.verify_audit_chain()) ok from control.audit_event;",
      ],
    ]);
    const before = marked(all, "mark_a")[0][0];
    const after = marked(all, "mark_b")[0][0];
    expect(after.n).toBe(before.n);
    expect(after.ok).toBe(true);
  });
});

// ------------------------------------------------------------------- office home ----
describe("office home: placed, waiting to be delivered, delivered", () => {
  it("the week starts on a Monday in Karachi", async () => {
    const c = (await tx([["manager", "select week_start::text w from app.office_overview_counts();"]]))[0];
    const dow = (
      await tx([["postgres", `select extract(isodow from '${c.w}'::date)::int d, ${TODAY} - '${c.w}'::date gap;`]])
    )[0];
    expect(dow.d).toBe(MONDAY);
    expect(n(dow, "gap")).toBeGreaterThanOrEqual(0);
    expect(n(dow, "gap")).toBeLessThan(WEEK_DAYS);
  });

  it("an office order for rep E: placed by the office, waiting with rep E to deliver; once delivered, it is an invoice in Delivered", async () => {
    const o = id(),
      d = id();
    const all = await txAll([
      ["postgres", `select full_name as manager_name from public.user_profile where id = '${fx.manager.id}';`],
      counts,
      order(o, S1, [[SKU2, TWO]], repE.id),
      counts,
      overviewRows,
      deliver(d, o),
      counts,
      overviewRows,
    ]);
    const [c0, c1, c2] = marked(all, "mark")
      .filter((rows) => rows[0].mark === "counts")
      .map((rows) => rows[0]);
    const [r1, r2] = marked(all, "mark").filter((rows) => rows[0].mark === "rows");
    const orderId = (r1.find((x) => x.section === "placed" && x.total_paisa !== undefined && x.salon_id === S1) as Row).order_id;

    expect(n(c1, "placed_this_week") - n(c0, "placed_this_week")).toBe(1);
    expect(n(c1, "to_deliver") - n(c0, "to_deliver")).toBe(1);
    expect(n(c2, "to_deliver") - n(c0, "to_deliver")).toBe(0);
    expect(n(c2, "delivered_this_week") - n(c0, "delivered_this_week")).toBe(1);

    const placed = r1.find((x) => x.section === "placed" && x.order_id === orderId) as Row;
    expect(placed).toMatchObject({
      placed_by_kind: "office",
      placed_by_name: marked(all, "manager_name")[0][0].manager_name,
      status: "confirmed",
      total_paisa: String(TWO * SKU2_PAISA),
      deliverer_kind: "rep",
      deliverer_name: repE.name,
    });
    const waiting = r1.find((x) => x.section === "waiting" && x.order_id === orderId) as Row;
    expect(waiting).toMatchObject({ waiting_days: 0, deliverer_kind: "rep", deliverer_name: repE.name, waiting_approval: false });
    expect(r2.find((x) => x.section === "waiting" && x.order_id === orderId)).toBeUndefined();
    const delivered = r2.find((x) => x.section === "delivered" && x.order_id === orderId) as Row;
    expect(delivered).toMatchObject({
      invoice_total_paisa: String(TWO * SKU2_PAISA),
      deliverer_kind: "office",
      status: "delivered",
    });
    // An invoice number, as INV-26-000123: matches "INV-26-000001", rejects "INV-2026-1".
    // https://regex101.com/?regex=%5EINV-%5B0-9%5D%7B2%7D-%5B0-9%5D%7B6%7D%24&flavor=javascript
    expect(String(delivered.invoice_number)).toMatch(/^INV-[0-9]{2}-[0-9]{6}$/);
    // Newest invoice first.
    expect(r2.filter((x) => x.section === "delivered")[0].order_id).toBe(orderId);
  });

  it("an order with no rep waits for the office to deliver it", async () => {
    const o = id();
    const r = await tx([order(o, S1, [[SKU1, 1]], null), overviewRows]);
    const w = r.find((x) => x.section === "waiting" && x.salon_id === S1 && x.deliverer_kind === "office");
    expect(w).toMatchObject({ deliverer_name: null, total_paisa: String(SKU1_PAISA) });
  });

  it("a blocked salon's order is held, with the reason, and counted as held", async () => {
    const o = id();
    const all = await txAll([
      counts,
      ["manager", `select app.office_set_blocked('${S1}', true, 'installment 31 days overdue on paper');`],
      // A cash order is never held for credit; an installment order at a blocked salon is.
      ["manager", `select app.office_create_order('${o}', '${S1}', 'INST2', ${lines([[SKU1, 1]])}, '${repE.id}');`],
      counts,
      overviewRows,
    ]);
    const [c0, c1] = marked(all, "mark")
      .filter((rows) => rows[0].mark === "counts")
      .map((rows) => rows[0]);
    const rows = marked(all, "mark").filter((x) => x[0].mark === "rows")[0];
    expect(n(c1, "held_orders") - n(c0, "held_orders")).toBe(1);
    expect(n(c1, "to_deliver") - n(c0, "to_deliver")).toBe(0);
    const held = rows.filter((x) => x.section === "held" && x.salon_id === S1);
    expect(held.map((x) => [x.status, x.hold_reason])).toEqual([["draft", "blocked"]]);
  });

  it("a salon's request: counted as waiting for the office, then placed by the salon once converted", async () => {
    const req = id(),
      o = id();
    const card = `(select id from public.order_intake_card where client_id = '${req}')`;
    const all = await txAll([
      counts,
      ["salon", `select app.salon_submit_request('${req}', ${lines([[SKU1, TWO]])}, 'for Friday');`],
      counts,
      ["manager", `select app.office_create_order('${o}', '${S2}', 'CASH', null, null, ${card});`],
      counts,
      overviewRows,
    ]);
    const [c0, c1, c2] = marked(all, "mark")
      .filter((rows) => rows[0].mark === "counts")
      .map((rows) => rows[0]);
    const rows = marked(all, "mark").filter((x) => x[0].mark === "rows")[0];
    expect(n(c1, "pending_requests") - n(c0, "pending_requests")).toBe(1);
    expect(n(c2, "pending_requests") - n(c0, "pending_requests")).toBe(0);
    const placed = rows.find((x) => x.section === "placed" && x.salon_id === S2) as Row;
    expect(placed).toMatchObject({ placed_by_kind: "salon", placed_by_name: S2_NAME, total_paisa: String(TWO * SKU1_PAISA) });
  });

  it("a rep's card converted by the office is placed by that rep; a delivery the rep submitted waits for approval", async () => {
    const card = id(),
      o = id(),
      sub = id();
    const all = await txAll([
      counts,
      ["repE", "select app.rep_check_in('[]'::jsonb);"],
      ["repE", `select app.rep_create_card('${card}', '${S1}', '[Dummy] two of the colour, Friday');`],
      [
        "manager",
        `select app.office_create_order('${o}', '${S1}', 'CASH', ${lines([[SKU2, 1]])}, '${repE.id}',
           (select id from public.order_intake_card where client_id = '${card}'));`,
      ],
      // A submission written directly (the rep's bag is not part of this test): what the rep would send.
      [
        "postgres",
        `insert into public.delivery_submission (client_id, order_id, salon_id, rep_id, rep_day_id, lines, received_by_name, lat, lng, device_fingerprint)
         select '${sub}', o.id, o.salon_id, '${repE.id}', d.id, '[{"sku_id":"${SKU2}","qty":1}]'::jsonb, 'Ayesha at the counter', ${PIN_LAT}, ${PIN_LNG}, 'fixture'
         from public.sales_order o, public.rep_day d where o.client_id = '${o}' and d.rep_id = '${repE.id}' and d.status = 'open';`,
      ],
      counts,
      overviewRows,
    ]);
    const [c0, c1] = marked(all, "mark")
      .filter((rows) => rows[0].mark === "counts")
      .map((rows) => rows[0]);
    const rows = marked(all, "mark").filter((x) => x[0].mark === "rows")[0];
    expect(n(c1, "waiting_approval") - n(c0, "waiting_approval")).toBe(1);
    const placed = rows.find((x) => x.section === "placed" && x.salon_id === S1 && x.placed_by_kind === "rep") as Row;
    expect(placed).toMatchObject({ placed_by_name: repE.name });
    const waiting = rows.find((x) => x.section === "waiting" && x.order_id === placed.order_id) as Row;
    expect(waiting.waiting_approval).toBe(true);
  });

  it("a salon a rep proposes is counted as waiting for approval", async () => {
    const s = id();
    const all = await txAll([
      counts,
      [
        "repE",
        `select app.create_salon('${s}', '[Test] Proposed ${tag()}', 'ladies_parlor', '${AREA}', 'map_pin', null, ${PIN_LAT}, ${PIN_LNG});`,
      ],
      counts,
    ]);
    const [c0, c1] = marked(all, "mark")
      .filter((rows) => rows[0].mark === "counts")
      .map((rows) => rows[0]);
    expect(n(c1, "pending_salons") - n(c0, "pending_salons")).toBe(1);
  });

  it("each list is capped (50, 50, 50 and 20 rows) while the counts cover every row", async () => {
    const r = await tx([overviewRows]);
    const per = (s: string) => r.filter((x) => x.section === s).length;
    expect(per("placed")).toBeLessThanOrEqual(LIST_CAP);
    expect(per("waiting")).toBeLessThanOrEqual(LIST_CAP);
    expect(per("held")).toBeLessThanOrEqual(LIST_CAP);
    expect(per("delivered")).toBeLessThanOrEqual(DELIVERED_CAP);
    // Sections come in a fixed order.
    const order_ = ["placed", "waiting", "held", "delivered"];
    const seen = r.map((x) => order_.indexOf(String(x.section)));
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
  });
});

// --------------------------------------------------------------------- investors ----
describe("investors: This month, typed amounts only (D-40)", () => {
  const inv = id(),
    investment = id(),
    decPrev = id(),
    decThis = id(),
    payProfit = id(),
    payPrincipal = id();
  const investmentRef = `(select id from public.investment where client_id = '${investment}')`;
  const investorRef = `(select id from public.investor where client_id = '${inv}')`;
  /** One investor: invested on the first of last month; decided last day of last month and first of this month; paid this month. */
  const ledger: Step[] = [
    ["manager", `select app.office_create_investor('${inv}', '[Dummy] Investor month', null, null);`],
    ["manager", `select app.office_add_investment('${investment}', ${investorRef}, ${INVESTED}, ${PREV_MONTH}, null);`],
    [
      "manager",
      `select app.office_decide_profit('${decPrev}', ${investmentRef}, ${DECIDED_PREV}, ${PREV_MONTH_LAST_DAY}, null);`,
    ],
    ["manager", `select app.office_decide_profit('${decThis}', ${investmentRef}, ${DECIDED_THIS}, ${THIS_MONTH}, null);`],
    [
      "manager",
      `select app.office_record_payout('${payProfit}', ${investmentRef}, 'profit', 'cash', ${PAID_PROFIT_THIS}, ${THIS_MONTH}, null, null);`,
    ],
    [
      "manager",
      `select app.office_record_payout('${payPrincipal}', ${investmentRef}, 'principal', 'cash', ${PAID_PRINCIPAL_THIS}, ${THIS_MONTH}, null, null);`,
    ],
  ];
  const month = (m: string, mark: string): Step => [
    "manager",
    `select '${mark}' as mark, * from app.office_investor_month(${m}, ${investorRef});`,
  ];
  const pick = (all: Row[][], mark: string) => marked(all, "mark").filter((rows) => rows[0].mark === mark)[0];

  it("each month shows its own decisions and payouts; invested and still owed are over all time", async () => {
    const all = await txAll([...ledger, month(PREV_MONTH, "prev"), month(TODAY, "this"), month(PREV_PREV_MONTH, "older")]);
    const [prev] = pick(all, "prev");
    const [cur] = pick(all, "this");
    const [older] = pick(all, "older");
    const owed = DECIDED_PREV + DECIDED_THIS - PAID_PROFIT_THIS;
    expect(prev).toMatchObject({
      is_total: false,
      invested_paisa: String(INVESTED),
      profit_decided_month_paisa: String(DECIDED_PREV),
      decisions_month: "1",
      profit_paid_month_paisa: "0",
      principal_paid_month_paisa: "0",
      profit_owed_paisa: String(owed),
    });
    expect(cur).toMatchObject({
      invested_paisa: String(INVESTED),
      principal_outstanding_paisa: String(INVESTED - PAID_PRINCIPAL_THIS),
      profit_decided_month_paisa: String(DECIDED_THIS),
      decisions_month: "1",
      profit_paid_month_paisa: String(PAID_PROFIT_THIS),
      principal_paid_month_paisa: String(PAID_PRINCIPAL_THIS),
      profit_owed_paisa: String(owed),
    });
    // A month with nothing decided says so: 0 decisions, 0 decided.
    expect(older).toMatchObject({ profit_decided_month_paisa: "0", decisions_month: "0", profit_paid_month_paisa: "0" });
  });

  it("a reversal made today counts in the month of the entry it reverses, never as a negative this month", async () => {
    const r1 = id(),
      r2 = id();
    const decPrevRef = `(select id from public.investor_profit_decision where client_id = '${decPrev}')`;
    const payRef = `(select id from public.investor_payout where client_id = '${payProfit}')`;
    const all = await txAll([
      ...ledger,
      [
        "manager",
        `select app.office_reverse_investor_entry('${r1}', 'profit_decision', ${decPrevRef}, 'typed for the wrong month');`,
      ],
      ["manager", `select app.office_reverse_investor_entry('${r2}', 'payout', ${payRef}, 'paid twice by mistake');`],
      month(PREV_MONTH, "prev"),
      month(TODAY, "this"),
    ]);
    const [prev] = pick(all, "prev");
    const [cur] = pick(all, "this");
    expect(prev).toMatchObject({ profit_decided_month_paisa: "0", decisions_month: "0" });
    expect(cur).toMatchObject({
      profit_decided_month_paisa: String(DECIDED_THIS),
      decisions_month: "1",
      profit_paid_month_paisa: "0",
      principal_paid_month_paisa: String(PAID_PRINCIPAL_THIS),
      profit_owed_paisa: String(DECIDED_THIS),
    });
  });

  it("nothing is worked out: a new investment adds to invested and changes no decided or owed figure", async () => {
    const more = id();
    const all = await txAll([
      ...ledger,
      ["manager", `select app.office_add_investment('${more}', ${investorRef}, ${INVESTED}, ${TODAY}, null);`],
      month(TODAY, "this"),
    ]);
    const [cur] = pick(all, "this");
    expect(cur).toMatchObject({
      invested_paisa: String(TWO * INVESTED),
      profit_decided_month_paisa: String(DECIDED_THIS),
      profit_owed_paisa: String(DECIDED_PREV + DECIDED_THIS - PAID_PROFIT_THIS),
    });
  });

  it("all investors: one row each and one totals row that is their sum", async () => {
    const all = await txAll([...ledger, ["manager", `select 'all' as mark, * from app.office_investor_month(${TODAY});`]]);
    const rows = pick(all, "all");
    const totals = rows.filter((x) => x.is_total);
    const people = rows.filter((x) => !x.is_total);
    expect(totals).toHaveLength(1);
    expect(rows.at(-1)?.is_total).toBe(true);
    expect(people.some((x) => x.full_name === "[Dummy] Investor month")).toBe(true);
    const sum = (k: string) => people.reduce((a, x) => a + BigInt(String(x[k])), ZERO).toString();
    const keys = [
      "invested_paisa",
      "principal_outstanding_paisa",
      "profit_decided_month_paisa",
      "decisions_month",
      "profit_paid_month_paisa",
      "principal_paid_month_paisa",
      "profit_owed_paisa",
    ];
    expect(keys.map((k) => [k, String(totals[0][k])])).toEqual(keys.map((k) => [k, sum(k)]));
  });

  it("one investor: no totals row; an unknown investor is refused (22023)", async () => {
    const all = await txAll([...ledger, month(TODAY, "one")]);
    expect(pick(all, "one").map((x) => x.is_total)).toEqual([false]);
    expect(await txCode([["manager", `select * from app.office_investor_month(${TODAY}, '${id()}');`]])).toBe(BAD_INPUT);
  });
});

// ------------------------------------------------------------------------- reps ----
describe("reps: orders brought and commission, own figures only", () => {
  const mine = (m: string, k: Persona = "repE"): Step => [k, `select 'mine' as mark, * from app.my_month_orders(${m});`];
  const office = (m: string): Step => ["manager", `select 'office' as mark, * from app.office_rep_month(${m});`];
  const pickAll = (all: Row[][], mark: string) => marked(all, "mark").filter((rows) => rows[0].mark === mark);

  it("rep E: two orders this month (one delivered, one waiting), one cancelled apart; rep F sees only its own", async () => {
    const a = id(),
      b = id(),
      c = id(),
      f = id();
    const all = await txAll([
      order(a, S1, [[SKU2, 1]], repE.id),
      deliver(id(), a),
      order(b, S1, [[SKU1, 1]], repE.id),
      order(c, S1, [[SKU1, 1]], repE.id),
      cancel(c),
      order(f, S2, [[SKU2, THREE]], repF.id),
      mine(TODAY, "repE"),
      mine(TODAY, "repF"),
    ]);
    const [e, fRows] = pickAll(all, "mine");
    expect(e[0]).toMatchObject({
      orders_count: "2",
      orders_value_paisa: String(SKU2_PAISA + SKU1_PAISA),
      delivered_count: "1",
      delivered_value_paisa: String(SKU2_PAISA),
      waiting_count: "1",
      waiting_value_paisa: String(SKU1_PAISA),
      held_count: "0",
      cancelled_count: "1",
    });
    expect(fRows[0]).toMatchObject({ orders_count: "1", orders_value_paisa: String(THREE * SKU2_PAISA), waiting_count: "1" });
  });

  it("Karachi midnight: an order placed one second before this month began is last month's", async () => {
    const early = id(),
      onTime = id();
    const all = await txAll([
      order(early, S1, [[SKU1, 1]], repE.id),
      order(onTime, S1, [[SKU2, 1]], repE.id),
      placedAt(early, `${THIS_MONTH_MIDNIGHT} - interval '1 second'`),
      placedAt(onTime, THIS_MONTH_MIDNIGHT),
      mine(PREV_MONTH),
      mine(TODAY),
    ]);
    const [prev, cur] = pickAll(all, "mine");
    expect(prev[0]).toMatchObject({ orders_count: "1", orders_value_paisa: String(SKU1_PAISA) });
    expect(cur[0]).toMatchObject({ orders_count: "1", orders_value_paisa: String(SKU2_PAISA) });
  });

  it("an order placed last month and delivered this month: counted as brought last month, its commission earned this month", async () => {
    const o = id();
    const all = await txAll([
      ["manager", `select app.office_set_commission_rate('${id()}', '${repE.id}', ${RATE_BP}, 'agreed in the monthly review');`],
      order(o, S1, [[SKU2, 1]], repE.id),
      placedAt(o, `${THIS_MONTH_MIDNIGHT} - interval '1 hour'`),
      deliver(id(), o),
      mine(PREV_MONTH),
      ["repE", `select 'cprev' as mark, app.my_commission(${PREV_MONTH}, ${PREV_MONTH_LAST_DAY}) s;`],
      ["repE", `select 'cthis' as mark, app.my_commission(${THIS_MONTH}, ${TODAY}) s;`],
    ]);
    const [prev] = pickAll(all, "mine");
    expect(prev[0]).toMatchObject({ orders_count: "1", delivered_count: "1", waiting_count: "0" });
    const cPrev = pickAll(all, "cprev")[0][0].s as { earned_paisa: number };
    const cThis = pickAll(all, "cthis")[0][0].s as { earned_paisa: number };
    expect([cPrev.earned_paisa, cThis.earned_paisa]).toEqual([0, EARN_SKU2]);
  });

  it("the office sees every rep's month, matching the rep's own figures and app.office_commission", async () => {
    const a = id(),
      p = id();
    const all = await txAll([
      ["manager", `select app.office_set_commission_rate('${id()}', '${repE.id}', ${RATE_BP}, 'agreed in the monthly review');`],
      order(a, S1, [[SKU2, 1]], repE.id),
      deliver(id(), a),
      order(id(), S1, [[SKU1, 1]], repE.id),
      ["manager", `select app.office_record_commission_payment('${p}', '${repE.id}', ${COMMISSION_PAID}, 'cash in hand');`],
      mine(TODAY),
      office(TODAY),
      ["manager", `select 'stmt' as mark, app.office_commission('${repE.id}', ${THIS_MONTH}, ${TODAY}) s;`],
    ]);
    const [own] = pickAll(all, "mine");
    const rows = pickAll(all, "office")[0];
    const e = rows.find((x) => x.rep_id === repE.id) as Row;
    const f = rows.find((x) => x.rep_id === repF.id) as Row;
    const s = pickAll(all, "stmt")[0][0].s as { earned_paisa: number; paid_paisa: number; owed_paisa: number };
    expect(e).toMatchObject({
      full_name: repE.name,
      orders_count: own[0].orders_count,
      orders_value_paisa: own[0].orders_value_paisa,
      delivered_count: own[0].delivered_count,
      waiting_count: own[0].waiting_count,
      earned_month_paisa: String(s.earned_paisa),
      paid_month_paisa: String(s.paid_paisa),
      owed_paisa: String(s.owed_paisa),
    });
    expect([s.earned_paisa, s.paid_paisa, s.owed_paisa]).toEqual([EARN_SKU2, COMMISSION_PAID, EARN_SKU2 - COMMISSION_PAID]);
    expect(f).toMatchObject({ orders_count: "0", earned_month_paisa: "0" });
    // Only reps are listed.
    expect(rows.some((x) => x.rep_id === fx.manager.id || x.rep_id === fx.owner.id)).toBe(false);
  });

  it("a rep cannot read another rep's month: there is no rep argument, and the office read is refused", async () => {
    const r = await tx([["postgres", `select pg_get_function_identity_arguments('app.my_month_orders(date)'::regprocedure) a;`]]);
    expect(r[0].a).toBe("p_month date");
    expect(await txCode([["repE", `select * from app.office_rep_month(${TODAY});`]])).toBe(DENIED);
    // Rep F's orders never show in rep E's figures.
    const all = await txAll([order(id(), S2, [[SKU2, FIVE]], repF.id), mine(TODAY, "repE"), mine(TODAY, "repF")]);
    const [e, f] = pickAll(all, "mine");
    expect(Number(f[0].orders_value_paisa) - Number(e[0].orders_value_paisa)).toBeGreaterThan(0);
    expect(e[0].orders_count).toBe("0");
  });
});
