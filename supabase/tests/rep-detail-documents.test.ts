/**
 * Rep detail and document lists (migration 20261105190000, completion slice 10, P1-28; frontend plan
 * sections 4, 6, F6; ORD-05, CTL-01, FLD-06). app.office_rep_detail, app.office_invoices and
 * app.office_receipts are read functions: they write nothing, not even an audit row. The tests also pin
 * who gets what from app.invoice_document and app.receipt_document, which the new pages read.
 *
 * Two fresh reps (E and F) are made here, so their figures are exact whatever other files committed.
 * Committed: those reps, their territory, two salons (S2 directly assigned to rep F), a catalogue, a
 * warehouse with its opening stock and one salon login; everything else runs in one rolled-back
 * transaction per test; the territory is ended in afterAll.
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
const BAG_LOAD = 7;
const BAG_LIMIT_PAISA = 500_000_000;
const SKU_PAISA = 50_000; // Rs 500
const CASH_PAISA = 30_000; // Rs 300
const TAG_LENGTH = 8;
const PHONE_SPACE = 10_000_000;
const PHONE_DIGITS = 7;
const PIN_LAT = 24.9;
const PIN_LNG = 67.1;
const TWO = 2;
const VISIT_CAP = 50;
const INVOICE_CAP = 100;
const MASK_HEAD = 4;
const MASK_TAIL = 2;
// An invoice and a receipt number. "INV-27-000001" and "R-27-000001" match; "INV-27-1" and "R-000001" do not.
// https://regex101.com/?regex=%5EINV-%5Cd%7B2%7D-%5Cd%7B6%7D%24&flavor=javascript
const INVOICE_NUMBER = /^INV-\d{2}-\d{6}$/;
const RECEIPT_NUMBER = /^R-\d{2}-\d{6}$/;

const id = () => randomUUID();
const tag = () => randomUUID().slice(0, TAG_LENGTH);
/** Runs one async step per item, one after another (the shared database takes one test transaction at a time). */
const inSeries = <T, R>(items: readonly T[], f: (t: T) => Promise<R>) =>
  items.reduce<Promise<R[]>>(async (acc, t) => [...(await acc), await f(t)], Promise.resolve([]));

const TODAY = "(now() at time zone 'Asia/Karachi')::date";
const T = id(),
  AREA = id(),
  S1 = id(),
  S2 = id(),
  GROUP = id(),
  PRODUCT = id(),
  SKU = id(),
  WH = id();
const phone = () => `+92000${String(Math.floor(Math.random() * PHONE_SPACE)).padStart(PHONE_DIGITS, "0")}`;
const repE = { id: id(), device: `dev-${id()}`, name: `[Test] Rep E detail ${tag()}`, phone: phone() };
const repF = { id: id(), device: `dev-${id()}`, name: `[Test] Rep F detail ${tag()}`, phone: phone() };
const S1_NAME = `[Test] Detail salon one ${tag()}`;
const S2_NAME = `[Test] Detail salon two ${tag()}`;
const SKU_CODE = `T-DTL-${tag().toUpperCase()}`;
const ROMAN_URDU_NOTE = "salon wali ne kaha agle hafte aana";
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
/** The rows of the statements whose first column is named `mark`, in order. */
const marked = (all: Row[][], mark: string) => all.filter((rows) => rows.length > 0 && mark in rows[0]);

const LINE = `'${JSON.stringify([{ sku_id: SKU, qty: 1 }])}'::jsonb`;
const oid = (cid: string) => `(select id from public.sales_order where client_id = '${cid}')`;
const invoiceOf = (cid: string) => `(select i.id from public.invoice i where i.order_id = ${oid(cid)})`;
const order = (cid: string, salon: string, rep: string | null): Step => [
  "manager",
  `select app.office_create_order('${cid}', '${salon}', 'CASH', ${LINE}, ${rep ? `'${rep}'` : "null"});`,
];
const deliver = (dcid: string, ocid: string): Step => [
  "manager",
  `${signOrderSql(dcid, oid(ocid))} select app.office_deliver('${dcid}', ${oid(ocid)}, '${WH}', 'Ayesha at the counter');`,
];
const detail = (rep: string, mark = "d", as: Persona = "manager"): Step => [
  as,
  `select '${mark}' as mark, app.office_rep_detail('${rep}') as j;`,
];
type Detail = Record<string, never> & {
  profile: Row;
  month: { start: string; end: string };
  devices: Row[];
  territories: Row[];
  salons: Row[];
  days: Row[];
  visits: Row[];
  cards: Row[];
  orders: Row[];
  pending: Row[];
  invoices: Row[];
  bag: Row[];
  has_bag: boolean;
  salons_total: number;
  days_total: number;
  visits_total: number;
  cards_total: number;
  orders_total: number;
  pending_total: number;
  invoices_total: number;
};
const jOf = (rows: Row[]) => rows[0].j as Detail;

const makeRep = async (rep: typeof repE, persona: "repE" | "repF") => {
  await run("postgres", "insert into auth.users (id, email) values ($1, $2)", [rep.id, `rep.${tag()}@example.test`], C);
  await run(OWNER, "select app.owner_create_user($1, $2, 'rep'::public.app_role, $3)", [rep.id, rep.name, rep.phone], C);
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
  await run(MANAGER, "select app.office_upsert_territory($1, $2)", [T, `[Test] Detail ${tag()}`], C);
  await run(MANAGER, "select app.office_upsert_area($1, $2, '[Test] Detail area')", [AREA, T], C);
  await makeRep(repE, "repE");
  await makeRep(repF, "repF");
  await inSeries(
    [
      [S1, S1_NAME],
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
  await run(MANAGER, "select app.office_assign_salon_rep($1, $2, $3)", [id(), S2, repF.id], C);
  await run(MANAGER, "select app.office_upsert_product_group($1, $2, 21)", [GROUP, `[Test] Detail colour ${tag()}`], C);
  await run(MANAGER, "select app.office_upsert_product($1, $2, '[Dummy] Kiran', '[Dummy] Detail colour')", [PRODUCT, GROUP], C);
  await run(MANAGER, "select app.office_upsert_sku($1, $2, $3, '[Dummy] shade', 'ml', 100)", [SKU, PRODUCT, SKU_CODE], C);
  await run(OWNER, "select app.owner_set_sku_price($1, $2, 'dummy list price')", [SKU, SKU_PAISA], C);
  await run(MANAGER, "select app.office_create_location($1, 'warehouse', '[Test] Detail store')", [WH], C);
  await run(
    "postgres",
    `insert into public.stock_movement (client_id, sku_id, qty, to_location_id, kind, actor_id)
     values (gen_random_uuid(), $1, $3, $2, 'receipt', $4)`,
    [SKU, WH, OPENING_STOCK, fx.manager.id],
    C,
  );
  const inv = (
    await run(
      MANAGER,
      `select app.office_invite('${id()}', 'salon', '[Test] Detail salon login', 'salon.${tag()}@example.test', '${S2}', null, null, null, null) as r`,
      [],
      C,
    )
  ).rows[0].r as { email: string; token: string };
  salonLogin = await newLogin({ email: inv.email });
  await run("postgres", `${asLogin(salonLogin)} select app.redeem_invitation(${quote(inv.token)})`, [], C);
});

afterAll(async () => {
  await inSeries([repE, repF], (r) =>
    run(MANAGER, "select app.office_end_territory($1, $2, 'detail tests finished')", [r.id, T], C),
  );
});

// ----------------------------------------------------------------------- access ----
const CALLS = {
  office_rep_detail: `select app.office_rep_detail('${repE.id}');`,
  office_invoices: "select * from app.office_invoices();",
  office_receipts: "select * from app.office_receipts();",
};
const FUNCTIONS = ["office_invoices", "office_receipts", "office_rep_detail"] as const;

describe("who may read", () => {
  it("the owner and a manager at AAL2 read; everyone else is refused (42501)", async () => {
    const ok = await inSeries(
      FUNCTIONS.flatMap((f) => (["manager", "owner"] as const).map((p) => [f, p] as const)),
      ([f, p]) => txCode([[p, CALLS[f]]]),
    );
    expect(ok).toEqual(ok.map(() => null));
    const refused: Persona[] = ["anon", "repE", "repF", "repEWrongDevice", "suspended", "salon", "managerAal1", "ownerAal1"];
    const codes = await inSeries(
      FUNCTIONS.flatMap((f) => refused.map((p) => [f, p] as const)),
      async ([f, p]) => [f, p, await txCode([[p, CALLS[f]]])] as const,
    );
    expect(codes.filter(([, , c]) => c !== DENIED)).toEqual([]);
  });

  it("a rep cannot read another rep's page, or its own, by any id", async () => {
    expect(await txCode([detail(repF.id, "d", "repE")])).toBe(DENIED);
    expect(await txCode([detail(repE.id, "d", "repE")])).toBe(DENIED);
  });

  it("wrong ids: no id, an unknown id, and an id that is not a rep's are refused (22023)", async () => {
    const bad = [
      "select app.office_rep_detail(null);",
      `select app.office_rep_detail('${id()}');`,
      `select app.office_rep_detail('${fx.manager.id}');`,
      `select app.office_rep_detail('${fx.owner.id}');`,
      `select * from app.office_invoices('${id()}');`,
      `select * from app.office_receipts('${id()}');`,
      `select * from app.office_receipts(null, '${id()}');`,
    ];
    const codes = await inSeries(bad, (sql) => txCode([["manager", sql]]));
    expect(codes).toEqual(bad.map(() => BAD_INPUT));
  });

  it("only the three reads are executable; the signatures take no rep or actor beyond the id asked for", async () => {
    const r = await tx([
      [
        "postgres",
        `select p.proname f, pg_get_function_identity_arguments(p.oid) a, p.prosecdef d,
                p.proconfig::text cfg, has_function_privilege('authenticated', p.oid, 'execute') auth,
                has_function_privilege('anon', p.oid, 'execute') anon, has_function_privilege('service_role', p.oid, 'execute') sr
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'app' and p.proname in ('office_rep_detail', 'office_invoices', 'office_receipts')
         order by 1;`,
      ],
    ]);
    expect(r.map((x) => [x.f, x.a, x.d, x.auth, x.anon, x.sr])).toEqual([
      ["office_invoices", "p_salon_id uuid", true, true, false, false],
      ["office_receipts", "p_salon_id uuid, p_invoice_id uuid", true, true, false, false],
      ["office_rep_detail", "p_rep_id uuid", true, true, false, false],
    ]);
    expect(r.every((x) => String(x.cfg).includes("search_path="))).toBe(true);
  });
});

// ------------------------------------------------------------------ rep detail ----
/** Every key at any depth of a JSON value. */
const keysOf = (v: unknown): string[] => {
  if (Array.isArray(v)) return v.flatMap(keysOf);
  if (v && typeof v === "object") return Object.entries(v).flatMap(([k, x]) => [k, ...keysOf(x)]);
  return [];
};

/** A full day for rep E: check-in, a visit, a card turned into an order, an order delivered, a submission. */
const repDay = () => {
  const card = id(),
    fromCard = id(),
    delivered = id(),
    dcid = id(),
    submitted = id(),
    sub = id(),
    other = id();
  const steps: Step[] = [
    ["repE", "select app.rep_check_in('[]'::jsonb);"],
    ["repE", `select app.log_visit('${id()}', '${S1}', 'intro', ${PIN_LAT}, ${PIN_LNG}, null, '${ROMAN_URDU_NOTE}', false);`],
    ["repE", `select app.rep_create_card('${card}', '${S1}', '[Dummy] two of the colour, Friday');`],
    [
      "manager",
      `select app.office_create_order('${fromCard}', '${S1}', 'CASH', ${LINE}, '${repE.id}',
         (select id from public.order_intake_card where client_id = '${card}'));`,
    ],
    order(delivered, S1, repE.id),
    deliver(dcid, delivered),
    order(submitted, S1, repE.id),
    // A submission written directly (the rep's bag is not part of this step): what the rep would send.
    [
      "postgres",
      `insert into public.delivery_submission (client_id, order_id, salon_id, rep_id, rep_day_id, lines, received_by_name, lat, lng, device_fingerprint)
       select '${sub}', o.id, o.salon_id, '${repE.id}', d.id, '[{"sku_id":"${SKU}","qty":1}]'::jsonb, 'Ayesha at the counter', ${PIN_LAT}, ${PIN_LNG}, 'fixture-fingerprint-0001'
       from public.sales_order o, public.rep_day d where o.client_id = '${submitted}' and d.rep_id = '${repE.id}' and d.status = 'open';`,
    ],
    // An order of rep F, and one with no rep: neither may show on rep E's page.
    order(other, S1, repF.id),
    order(id(), S1, null),
  ];
  return { steps, ids: { card, fromCard, delivered, submitted, sub, other } };
};

describe("office_rep_detail: one rep's page", () => {
  it("a new rep: profile with a masked phone, an approved phone, its territory, its salons, nothing else yet", async () => {
    const j = jOf(await tx([detail(repE.id)]));
    expect(j.profile).toMatchObject({ rep_id: repE.id, full_name: repE.name, status: "active" });
    expect(j.profile.phone_masked).toBe(
      `${repE.phone.slice(0, MASK_HEAD)}${"*".repeat(repE.phone.length - MASK_HEAD - MASK_TAIL)}${repE.phone.slice(-MASK_TAIL)}`,
    );
    expect(j.devices).toHaveLength(1);
    expect(j.devices[0]).toMatchObject({ platform: "android", label: "test phone", status: "approved" });
    expect(j.territories).toHaveLength(1);
    expect(j.territories[0]).toMatchObject({ current: true, to_date: null });
    // Rep E holds S1 through the territory; S2 is directly rep F's, so it is not rep E's (R4).
    expect(j.salons.map((s) => s.salon_id)).toContain(S1);
    expect(j.salons.map((s) => s.salon_id)).not.toContain(S2);
    expect(j.salons.find((s) => s.salon_id === S1)).toMatchObject({ name: S1_NAME, direct: false, approval_status: "approved" });
    expect(j.salons_total).toBe(j.salons.length);
    expect([j.days, j.visits, j.cards, j.orders, j.pending, j.invoices, j.bag]).toEqual([[], [], [], [], [], [], []]);
    expect([j.days_total, j.visits_total, j.cards_total, j.orders_total, j.pending_total, j.invoices_total]).toEqual([
      0, 0, 0, 0, 0, 0,
    ]);
    expect(j.has_bag).toBe(false);
  });

  it("a directly assigned salon is marked direct on that rep's page", async () => {
    const j = jOf(await tx([detail(repF.id)]));
    expect(j.salons.find((s) => s.salon_id === S2)).toMatchObject({ name: S2_NAME, direct: true });
  });

  it("the month is the Karachi month holding today, for the commission call", async () => {
    const all = await txAll([
      detail(repE.id),
      [
        "postgres",
        `select 'm' as mark2, date_trunc('month', ${TODAY}::timestamp)::date::text s,
                (date_trunc('month', ${TODAY}::timestamp) + interval '1 month - 1 day')::date::text e;`,
      ],
    ]);
    const m = marked(all, "mark2")[0][0];
    expect(jOf(marked(all, "mark")[0]).month).toEqual({ start: m.s, end: m.e });
  });

  it("a working day shows on rep E's page, with only rep E's rows, and the database's amounts", async () => {
    const { steps, ids } = repDay();
    const all = await txAll([
      ...steps,
      detail(repE.id, "e"),
      detail(repF.id, "f"),
      ["postgres", `select 'ids' as mark3, (select id from public.sales_order where client_id = '${ids.other}') as other;`],
    ]);
    const e = jOf(marked(all, "mark").filter((r) => r[0].mark === "e")[0]);
    const f = jOf(marked(all, "mark").filter((r) => r[0].mark === "f")[0]);
    const other = marked(all, "mark3")[0][0].other;

    expect(e.days).toHaveLength(1);
    expect(e.days[0]).toMatchObject({ status: "open", check_out_at: null, visits: 1 });
    expect(e.days_total).toBe(1);
    expect(e.visits).toHaveLength(1);
    // Roman Urdu free text is stored and returned as entered (D-42).
    expect(e.visits[0]).toMatchObject({ salon_id: S1, salon_name: S1_NAME, outcome: "intro", notes: ROMAN_URDU_NOTE });
    expect(e.cards).toHaveLength(1);
    expect(e.cards[0]).toMatchObject({ salon_name: S1_NAME, body: "[Dummy] two of the colour, Friday", state: "converted" });
    expect(e.orders_total).toBe(TWO + 1);
    expect(e.orders.map((o) => o.order_id)).not.toContain(other);
    expect(e.orders.every((o) => o.total_paisa === SKU_PAISA)).toBe(true);
    expect(new Set(e.orders.map((o) => o.status))).toEqual(new Set(["confirmed", "delivered"]));
    expect(e.pending).toHaveLength(1);
    expect(e.pending_total).toBe(1);
    expect(e.pending[0]).toMatchObject({ salon_name: S1_NAME, total_paisa: SKU_PAISA });
    expect(e.invoices).toHaveLength(1);
    expect(e.invoices_total).toBe(1);
    expect(e.invoices[0]).toMatchObject({ salon_name: S1_NAME, total_paisa: SKU_PAISA });
    expect(String(e.invoices[0].number)).toMatch(INVOICE_NUMBER);

    // Rep F has one order and nothing of rep E's.
    expect(f.orders.map((o) => o.order_id)).toEqual([other]);
    expect([f.days, f.visits, f.cards, f.pending, f.invoices]).toEqual([[], [], [], [], []]);
  });

  it("the pending row matches app.office_pending_deliveries, and goes once the submission is decided", async () => {
    const { steps, ids } = repDay();
    const all = await txAll([
      ...steps,
      [
        "manager",
        `select 'queue' as mark4, submission_id, total_paisa from app.office_pending_deliveries()
         where submission_id = (select id from public.delivery_submission where client_id = '${ids.sub}');`,
      ],
      detail(repE.id, "before"),
      [
        "postgres",
        `insert into public.delivery_submission_decision (submission_id, client_id, outcome, reason, decided_by)
         select id, gen_random_uuid(), 'rejected', 'fixture: goods were wrong', '${fx.manager.id}'
         from public.delivery_submission where client_id = '${ids.sub}';`,
      ],
      detail(repE.id, "after"),
    ]);
    const q = marked(all, "mark4")[0][0];
    const before = jOf(marked(all, "mark").filter((r) => r[0].mark === "before")[0]);
    const after = jOf(marked(all, "mark").filter((r) => r[0].mark === "after")[0]);
    expect(before.pending[0].submission_id).toBe(q.submission_id);
    expect(String(before.pending[0].total_paisa)).toBe(String(q.total_paisa));
    expect(after.pending).toEqual([]);
    expect(after.pending_total).toBe(0);
  });

  it("the bag is the rep's stock movements: quantities only, zero lines left out", async () => {
    const bag = id();
    const all = await txAll([
      ["owner", `select app.office_create_location('${bag}', 'rep_bag', '[Test] Detail bag', '${repE.id}', ${BAG_LIMIT_PAISA});`],
      [
        "postgres",
        `insert into public.stock_movement (client_id, sku_id, qty, from_location_id, to_location_id, kind, actor_id)
         values (gen_random_uuid(), '${SKU}', ${BAG_LOAD}, '${WH}', '${bag}', 'issue_to_rep', '${fx.manager.id}');`,
      ],
      detail(repE.id, "e"),
      detail(repF.id, "f"),
    ]);
    const e = jOf(marked(all, "mark").filter((r) => r[0].mark === "e")[0]);
    const f = jOf(marked(all, "mark").filter((r) => r[0].mark === "f")[0]);
    expect(e.has_bag).toBe(true);
    expect(e.bag).toEqual([{ code: SKU_CODE, variant: "[Dummy] shade", on_hand: BAG_LOAD }]);
    expect([f.has_bag, f.bag]).toEqual([false, []]);
  });

  it("a capped list says how many there are: 51 visits return the newest 50 and a total of 51", async () => {
    const all = await txAll([
      ["repE", "select app.rep_check_in('[]'::jsonb);"],
      [
        "postgres",
        `insert into public.visit (client_id, rep_day_id, rep_id, salon_id, outcome, lat, lng)
         select gen_random_uuid(), d.id, d.rep_id, '${S1}', 'intro', ${PIN_LAT}, ${PIN_LNG}
         from public.rep_day d, generate_series(1, ${VISIT_CAP + 1}) where d.rep_id = '${repE.id}';`,
      ],
      detail(repE.id),
    ]);
    const j = jOf(marked(all, "mark")[0]);
    expect(j.visits).toHaveLength(VISIT_CAP);
    expect(j.visits_total).toBe(VISIT_CAP + 1);
  });

  it("no cost, margin, supplier, credit, fingerprint or GPS key at any depth, and no unmasked phone anywhere", async () => {
    const { steps } = repDay();
    const all = await txAll([...steps, detail(repE.id)]);
    const j = jOf(marked(all, "mark")[0]);
    const keys = keysOf(j);
    // Key words that may not appear. "unit_cost", "margin_paisa", "device_fingerprint", "lat", "bag_value_limit_paisa"
    // and "bag_lines" match; "salon_name" and "phone_masked" (phones are checked by name below) do not.
    // https://regex101.com/?regex=%28%5E%7C_%29%28cost%7Cmargin%29%28_%7C%24%29&flavor=javascript
    const forbidden =
      /(^|_)(cost|margin|supplier|vendor|lot|po|credit|limit|snapshot|fingerprint|lat|lng|ip|vault|lines|hash|email|cnic)(_|$)/;
    expect(keys.filter((k) => forbidden.test(k))).toEqual([]);
    expect(keys.filter((k) => k.includes("phone"))).toEqual(["phone_masked"]);
    const text = JSON.stringify(j);
    expect(text).not.toContain(repE.phone);
    expect(text).not.toContain(repE.device);
    expect(text).not.toContain("fixture-fingerprint-0001");
  });
});

// --------------------------------------------------------------- document lists ----
describe("office_invoices and office_receipts", () => {
  /** An order of S1 delivered by the office, Rs 300 of cash on S1, and an order of S2 delivered. */
  const docs = () => {
    const o1 = id(),
      o2 = id(),
      cash = id();
    const steps: Step[] = [
      order(o1, S1, null),
      deliver(id(), o1),
      ["manager", `select (app.office_record_cash('${cash}', '${S1}', ${CASH_PAISA})).number;`],
      order(o2, S2, null),
      deliver(id(), o2),
    ];
    return { steps, o1, o2, cash };
  };

  it("invoices by salon: the invoice's own number, amount, order and salon, with the total over every row", async () => {
    const { steps, o1 } = docs();
    const all = await txAll([
      ...steps,
      ["manager", `select 'one' as mark, * from app.office_invoices('${S1}');`],
      ["manager", "select 'all' as mark, * from app.office_invoices();"],
      ["postgres", `select 'real' as mark5, id, number, order_id from public.invoice where order_id = ${oid(o1)};`],
    ]);
    const one = marked(all, "mark").filter((r) => r[0].mark === "one")[0];
    const every = marked(all, "mark").filter((r) => r[0].mark === "all")[0];
    const real = marked(all, "mark5")[0][0];
    expect(one).toHaveLength(1);
    expect(one[0]).toMatchObject({
      invoice_id: real.id,
      number: real.number,
      order_id: real.order_id,
      salon_id: S1,
      salon_name: S1_NAME,
      total_paisa: String(SKU_PAISA),
      total_count: "1",
    });
    expect(every.map((r) => r.salon_id)).toEqual(expect.arrayContaining([S1, S2]));
    expect(every.length).toBeLessThanOrEqual(INVOICE_CAP);
    // Newest first.
    const times = every.map((r) => new Date(r.issued_at as string).getTime());
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });

  it("a salon with no invoice is an empty list, not an error", async () => {
    expect(await tx([["manager", `select * from app.office_invoices('${S2}');`]])).toEqual([]);
  });

  it("receipts by salon and by invoice: the payment's amount, then what it allocated to that invoice", async () => {
    const { steps, o1, o2, cash } = docs();
    const all = await txAll([
      ...steps,
      ["manager", `select 'salon' as mark, * from app.office_receipts('${S1}');`],
      ["manager", `select 'inv1' as mark, * from app.office_receipts(null, ${invoiceOf(o1)});`],
      // The other salon's invoice has no payment against it.
      ["manager", `select 'inv2' as mark0, count(*)::int n from app.office_receipts(null, ${invoiceOf(o2)});`],
      [
        "postgres",
        `select 'real' as mark6, r.id, r.number from public.receipt r join public.payment p on p.id = r.payment_id where p.client_id = '${cash}';`,
      ],
    ]);
    const real = marked(all, "mark6")[0][0];
    const salon = marked(all, "mark").filter((r) => r[0].mark === "salon")[0];
    const inv1 = marked(all, "mark").filter((r) => r[0].mark === "inv1")[0];
    expect(salon).toHaveLength(1);
    expect(salon[0]).toMatchObject({
      receipt_id: real.id,
      number: real.number,
      salon_name: S1_NAME,
      method: "cash",
      amount_paisa: String(CASH_PAISA),
      total_count: "1",
    });
    expect(inv1).toHaveLength(1);
    expect(inv1[0]).toMatchObject({ receipt_id: real.id, amount_paisa: String(CASH_PAISA) });
    expect(marked(all, "mark0")[0][0].n).toBe(0);
  });

  it("result columns hold no cost, margin, supplier, credit, phone, GPS or bank field", async () => {
    const r = await tx([
      [
        "postgres",
        `select p.proname f, array_to_string(p.proargnames, ',') cols
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'app' and p.proname in ('office_invoices', 'office_receipts');`,
      ],
    ]);
    // Column words that may not appear in a comma-joined list. "unit_cost,x" and "bank_name" match; "salon_name" does not.
    // https://regex101.com/?regex=%28%5E%7C%2C%7C_%29%28cost%7Cbank%29%28_%7C%2C%7C%24%29&flavor=javascript
    const forbidden = /(^|,|_)(cost|margin|supplier|vendor|credit|limit|snapshot|phone|lat|lng|device|ip|bank|rep)(_|,|$)/;
    expect(r).toHaveLength(TWO);
    expect(r.filter((x) => forbidden.test(String(x.cols)))).toEqual([]);
  });

  it("reading writes nothing: no audit row, and the chain still verifies", async () => {
    const all = await txAll([
      ["postgres", "select 'before' as mark_a, count(*)::int n from control.audit_event;"],
      detail(repE.id),
      ["manager", CALLS.office_invoices],
      ["manager", CALLS.office_receipts],
      [
        "postgres",
        "select 'after' as mark_b, count(*)::int n, (select ok from control.verify_audit_chain()) ok from control.audit_event;",
      ],
    ]);
    expect(marked(all, "mark_b")[0][0].n).toBe(marked(all, "mark_a")[0][0].n);
    expect(marked(all, "mark_b")[0][0].ok).toBe(true);
  });
});

// ---------------------------------------------------------- the documents' access ----
describe("the documents the new pages read", () => {
  const withDocs = () => {
    const o = id(),
      cash = id();
    const steps: Step[] = [
      order(o, S1, repE.id),
      deliver(id(), o),
      ["manager", `select (app.office_record_cash('${cash}', '${S1}', ${CASH_PAISA})).number;`],
    ];
    const receiptOf = `(select r.id from public.receipt r join public.payment p on p.id = r.payment_id where p.client_id = '${cash}')`;
    return { steps, invoice: invoiceOf(o), receipt: receiptOf };
  };

  it("the office reads both; AAL1 office, another rep and a salon login get null; a stranger's id gets null; anon is refused", async () => {
    const { steps, invoice, receipt } = withDocs();
    // The ids are read as postgres first and kept in settings, because a refused persona cannot read the tables.
    const all = await txAll([
      ...steps,
      ["postgres", `select set_config('t.inv', ${invoice}::text, true), set_config('t.rec', ${receipt}::text, true);`],
      ...(["manager", "owner", "managerAal1", "ownerAal1", "repF", "salon"] as Persona[]).map(
        (p): Step => [
          p,
          `select '${p}' as who, app.invoice_document(current_setting('t.inv')::uuid) as doc,
                  app.receipt_document(current_setting('t.rec')::uuid) as rec;`,
        ],
      ),
      ["manager", `select 'unknown' as who, app.invoice_document('${id()}') as doc, app.receipt_document('${id()}') as rec;`],
    ]);
    const got = Object.fromEntries(marked(all, "who").map((r) => [r[0].who as string, r[0]]));
    const numbers = ["manager", "owner"].map((p) => [
      (got[p].doc as { number: string }).number,
      (got[p].rec as { number: string }).number,
    ]);
    expect(numbers.every(([d, r]) => INVOICE_NUMBER.test(d) && RECEIPT_NUMBER.test(r))).toBe(true);
    const shut = ["managerAal1", "ownerAal1", "repF", "salon", "unknown"];
    expect(shut.map((p) => [p, got[p].doc, got[p].rec])).toEqual(shut.map((p) => [p, null, null]));
    expect(await txCode([["anon", `select app.invoice_document('${id()}');`]])).toBe(DENIED);
    expect(await txCode([["anon", `select app.receipt_document('${id()}');`]])).toBe(DENIED);
  });

  it("each document carries the English sentence the page prints, and renders no cost, supplier or phone key", async () => {
    const { steps, invoice, receipt } = withDocs();
    const all = await txAll([
      ...steps,
      ["manager", `select 'docs' as mark, app.invoice_document(${invoice}) as doc, app.receipt_document(${receipt}) as rec;`],
    ]);
    const { doc, rec } = marked(all, "mark")[0][0] as {
      doc: { notices: Array<{ en: string }> };
      rec: { notices: Array<{ en: string }> };
    };
    expect(rec.notices.map((n) => n.en).join(" ")).toContain("only valid proof of payment");
    expect(doc.notices.map((n) => n.en).join(" ")).toContain("Only the numbered receipt");
    const keys = [...keysOf(doc), ...keysOf(rec)];
    // Key words a document may not carry. "unit_cost" and "phone" match; "list_price_paisa" does not.
    // https://regex101.com/?regex=%28%5E%7C_%29%28cost%7Cphone%29%28_%7C%24%29&flavor=javascript
    const forbidden = /(^|_)(cost|margin|supplier|vendor|lot|phone|cnic|lat|lng|fingerprint)(_|$)/;
    expect(keys.filter((k) => forbidden.test(k))).toEqual([]);
  });
});
