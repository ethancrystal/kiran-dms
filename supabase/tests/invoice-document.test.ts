/**
 * Invoice document (migration 0014, task P1-06 part c): ORD-05; doc 07 §3 (documents sent to
 * salons render from `public` only); doc 08 §3 rules 1 and 6 (bilingual notices); doc 09 §1
 * (plan schedules); assumption A-11 (rounding: floor each installment, the last takes the rest).
 *
 * The same committed fixtures pattern as deliveries.test.ts: territories, salons, catalogue and a
 * warehouse are committed with fresh ids; each test runs one rolled-back transaction that opens the
 * reps' day, gives rep A a bag when it has none, loads it, orders and delivers. Results from several
 * personas are carried to the last statement in transaction-local settings.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { approveSalon, errorOf, fx, MANAGER, OWNER, REP_A, run, sqlstate } from "./helpers/db";
import { submitApproveSql } from "./helpers/submit-approve";

const C = { commit: true };
const id = () => randomUUID();
const tag = () => randomUUID().slice(0, 8);
const TODAY = "(now() at time zone 'Asia/Karachi')::date";

const T_A = id(),
  AREA_A = id(),
  T_B = id(),
  AREA_B = id();
const SALON = id(),
  SALON_B = id();
const GROUP = id(),
  PRODUCT = id(),
  SKU1 = id(), // Rs 1,200
  SKU2 = id(), // Rs 500
  SKU3 = id(); // Rs 333.33: a total no plan divides evenly
const WH = id();
const BAG_A = `(select l.id from public.stock_location l where l.kind = 'rep_bag' and l.owner_user_id = '${fx.repA.id}')`;

type P = "repA" | "repB" | "manager" | "owner" | "suspendedRep";
const asUser = (k: P, aal?: "aal1" | "aal2", device: string = fx[k].device) => `
  reset role;
  select set_config('request.jwt.claims', '${JSON.stringify({
    sub: fx[k].id,
    role: "authenticated",
    aal: aal ?? (k === "manager" || k === "owner" ? "aal2" : "aal1"),
  })}', true),
         set_config('request.headers', '${JSON.stringify({ "x-kiran-device": device })}', true);
  set local role authenticated;`;
const prelude = `
  insert into public.rep_day (rep_id, day) values ('${fx.repA.id}', ${TODAY}) on conflict (rep_id, day) do nothing;
  ${asUser("owner")}
  select app.office_create_location('${id()}', 'rep_bag', '[Test] Invoice bag A', '${fx.repA.id}', 50000000)
   where not exists (select 1 from public.stock_location l where l.kind = 'rep_bag' and l.owner_user_id = '${fx.repA.id}');
  select app.owner_set_credit('${SALON}', 'INST4', 100000000, 'invoice document tests');
  reset role;
  insert into public.stock_movement (client_id, sku_id, qty, from_location_id, to_location_id, kind, actor_id)
  values (gen_random_uuid(), '${SKU1}', 20, '${WH}', ${BAG_A}, 'issue_to_rep', '${fx.manager.id}'),
         (gen_random_uuid(), '${SKU2}', 20, '${WH}', ${BAG_A}, 'issue_to_rep', '${fx.manager.id}'),
         (gen_random_uuid(), '${SKU3}', 20, '${WH}', ${BAG_A}, 'issue_to_rep', '${fx.manager.id}');`;

const lines = (l: Array<[string, number]>) => `'${JSON.stringify(l.map(([sku_id, qty]) => ({ sku_id, qty })))}'::jsonb`;
const oid = (cid: string) => `(select id from public.sales_order where client_id = '${cid}')`;
const invoiceOf = (cid: string) =>
  `(select i.id from public.invoice i join public.sales_order o on o.id = i.order_id where o.client_id = '${cid}')`;
/** The manager orders for rep A, rep A delivers everything; then each reader's document is stashed in a setting. */
const deliveredScript = (o: string, plan: string, l: Array<[string, number]>, readers: Array<[string, string]>) => `
  ${prelude}
  ${asUser("manager")}
  select app.office_create_order('${o}', '${SALON}', '${plan}', ${lines(l)}, '${fx.repA.id}');
  ${submitApproveSql(asUser, { clientId: id(), orderExpr: oid(o), rep: "repA", approver: "manager" })}
  reset role;
  select set_config('kiran_test.invoice_id', ${invoiceOf(o)}::text, true);
  ${readers
    .map(
      // The id is looked up as postgres above: a lookup under the reader's RLS would hide the
      // invoice from other readers and pass null, so the function's own check would go untested.
      ([name, persona]) => `${persona}
  select set_config('kiran_test.${name}', coalesce(app.invoice_document(current_setting('kiran_test.invoice_id')::uuid)::text, 'null'), true);`,
    )
    .join("\n")}
  reset role;
  select ${readers.map(([name]) => `current_setting('kiran_test.${name}')::jsonb "${name}"`).join(", ")},
         (select row_to_json(i)::jsonb from public.invoice i where i.id = ${invoiceOf(o)}) invoice;`;
type Multi = Array<{ rows: Array<Record<string, unknown>> }>;
const docs = async (o: string, plan: string, l: Array<[string, number]>, readers: Array<[string, string]>) =>
  ((await run("postgres", deliveredScript(o, plan, l, readers))) as unknown as Multi).at(-1)?.rows[0] ?? {};

type Doc = {
  version: number;
  number: string;
  financial_year: string;
  company: Record<string, unknown>;
  bank_accounts: Array<Record<string, unknown>>;
  salon: { name: string; address: string | null; area: string };
  delivery: { received_by_name: string; status: string };
  plan: { code: string; name: string };
  lines: Array<{ sku_code: string; qty: number; list_price_paisa: number; unit_price_paisa: number; line_total_paisa: number }>;
  totals: { subtotal_paisa: number; discount_paisa: number; total_paisa: number };
  schedule: Array<{ no: number; of: number; due_on: string; pct: number; amount_paisa: number }>;
  receipts: unknown[];
  notices: Array<{ code: string; en: string; ur: string }>;
};

beforeAll(async () => {
  const one = async (who: Parameters<typeof run>[0], sql: string, params: unknown[] = []) =>
    (await run(who, sql, params, C)).rows[0];
  await one(MANAGER, "select app.office_upsert_territory($1, $2)", [T_A, `[Test] Invoices A ${tag()}`]);
  await one(MANAGER, "select app.office_upsert_territory($1, $2)", [T_B, `[Test] Invoices B ${tag()}`]);
  await one(MANAGER, "select app.office_upsert_area($1, $2, '[Test] Invoices area A')", [AREA_A, T_A]);
  await one(MANAGER, "select app.office_upsert_area($1, $2, '[Test] Invoices area B')", [AREA_B, T_B]);
  await one(MANAGER, "select app.office_assign_territory($1, $2)", [fx.repA.id, T_A]);
  await one(MANAGER, "select app.office_assign_territory($1, $2)", [fx.repB.id, T_B]);
  await one(REP_A, "select app.create_salon($1, '[Test] Invoice salon', 'ladies_parlor', $2, 'map_pin', null, 24.9, 67.1)", [
    SALON,
    AREA_A,
  ]);
  await one(
    { as: "repB" },
    "select app.create_salon($1, '[Test] Invoice salon B', 'ladies_parlor', $2, 'map_pin', null, 24.9, 67.1)",
    [SALON_B, AREA_B],
  );
  // D-35 (slice 7): a rep's salon is a proposal; the office approves both before any order.
  await approveSalon(SALON);
  await approveSalon(SALON_B);
  await one(MANAGER, "select app.office_upsert_product_group($1, $2, 21)", [GROUP, `[Test] Invoice colour ${tag()}`]);
  await one(MANAGER, "select app.office_upsert_product($1, $2, '[Dummy] Kiran', '[Dummy] Invoice colour')", [PRODUCT, GROUP]);
  for (const s of [SKU1, SKU2, SKU3]) {
    await one(MANAGER, "select app.office_upsert_sku($1, $2, $3, '[Dummy] shade', 'ml', 100)", [
      s,
      PRODUCT,
      `T-INV-${tag().toUpperCase()}`,
    ]);
  }
  await one(OWNER, "select app.owner_set_sku_price($1, 120000, 'dummy list price')", [SKU1]);
  await one(OWNER, "select app.owner_set_sku_price($1, 50000, 'dummy list price')", [SKU2]);
  await one(OWNER, "select app.owner_set_sku_price($1, 33333, 'dummy list price')", [SKU3]);
  await one(MANAGER, "select app.office_create_location($1, 'warehouse', '[Test] Invoice store')", [WH]);
  await one(
    "postgres",
    `insert into public.stock_movement (client_id, sku_id, qty, to_location_id, kind, actor_id)
     values (gen_random_uuid(), $1, 100, $4, 'receipt', $5), (gen_random_uuid(), $2, 100, $4, 'receipt', $5),
            (gen_random_uuid(), $3, 100, $4, 'receipt', $5)`,
    [SKU1, SKU2, SKU3, WH, fx.manager.id],
  );
});

afterAll(async () => {
  await run(MANAGER, "select app.office_end_territory($1, $2, 'invoice tests finished')", [fx.repA.id, T_A], C);
  await run(MANAGER, "select app.office_end_territory($1, $2, 'invoice tests finished')", [fx.repB.id, T_B], C);
});

describe("the invoice document (ORD-05)", () => {
  it("carries the invoice's number, salon, lines, totals, a cash schedule and the bilingual notices", async () => {
    const r = await docs(
      id(),
      "CASH",
      [
        [SKU1, 6],
        [SKU2, 2],
      ],
      [["repA", asUser("repA")]],
    );
    const doc = r.repA as Doc;
    const inv = r.invoice as { number: string; total_paisa: number; subtotal_paisa: number; discount_paisa: number };
    expect(doc.version).toBe(1);
    expect(doc.number).toBe(inv.number);
    expect(doc.financial_year).toMatch(/^20[0-9]{2}-[0-9]{2}$/);
    expect(Number(doc.financial_year.slice(2, 4)) + 1).toBe(Number(doc.financial_year.slice(-2)));
    expect(doc.number.slice(4, 6)).toBe(doc.financial_year.slice(-2));
    expect(doc.company.name_en).toBe("[Dummy] Kiran Company");
    expect(doc.bank_accounts.length).toBeGreaterThan(0);
    expect(doc.bank_accounts.every((b) => String(b.bank).startsWith("[Dummy]"))).toBe(true);
    expect(doc.salon).toEqual({ name: "[Test] Invoice salon", address: null, area: "[Test] Invoices area A" });
    expect(doc.delivery.received_by_name).toBe("Ayesha at the counter");
    expect(doc.plan).toEqual({ code: "CASH", name: "Cash on delivery" });
    expect(doc.lines.map((l) => [l.qty, l.unit_price_paisa, l.line_total_paisa])).toEqual([
      [6, 120000, 720000],
      [2, 50000, 100000],
    ]);
    expect(doc.totals).toEqual({
      subtotal_paisa: inv.subtotal_paisa,
      discount_paisa: inv.discount_paisa,
      total_paisa: inv.total_paisa,
    });
    expect(doc.totals.total_paisa).toBe(820000);
    expect(doc.lines.reduce((s, l) => s + l.line_total_paisa, 0)).toBe(doc.totals.total_paisa);
    expect(doc.schedule).toHaveLength(1);
    expect(doc.schedule[0]).toMatchObject({ no: 1, of: 1, pct: 100, amount_paisa: 820000 });
    expect(doc.receipts).toEqual([]);
    expect(doc.notices.map((n) => n.code)).toEqual(["no_paper_receipts", "official_accounts_only"]);
    for (const n of doc.notices) {
      expect(n.en.length).toBeGreaterThan(20);
      expect(n.ur).toMatch(/[؀-ۿ]/); // Urdu script, not a transliteration
    }
  });

  it("splits an installment plan exactly: each installment floored, the last takes the remainder (A-11)", async () => {
    const r = await docs(id(), "INST4", [[SKU3, 1]], [["repA", asUser("repA")]]);
    const doc = r.repA as Doc;
    expect(doc.totals.total_paisa).toBe(33333);
    expect(doc.schedule.map((s) => [s.no, s.of, s.pct, s.amount_paisa])).toEqual([
      [1, 4, 25, 8333],
      [2, 4, 25, 8333],
      [3, 4, 25, 8333],
      [4, 4, 25, 8334],
    ]);
    const due = doc.schedule.map((s) => Date.parse(s.due_on));
    expect(due.map((d) => (d - due[0]) / 86_400_000)).toEqual([0, 10, 20, 30]);
  });

  it("the schedule always adds up to the total, for every plan and awkward totals", async () => {
    const totals = [1, 3, 7, 99, 33333, 100001, 999999999];
    const { rows } = await run(
      "postgres",
      `select p.plan::text plan, t.total::bigint total,
              (select sum(x.amount_paisa) from app.plan_schedule(p.plan, t.total, date '2026-11-03') x)::bigint sum,
              (select min(x.amount_paisa) from app.plan_schedule(p.plan, t.total, date '2026-11-03') x)::bigint low
       from unnest(array['CASH', 'INST2', 'INST4']::public.plan_code[]) p(plan), unnest($1::bigint[]) t(total)`,
      [totals],
    );
    expect(rows).toHaveLength(21);
    for (const r of rows) {
      expect(String(r.sum)).toBe(String(r.total));
      expect(Number(r.low)).toBeGreaterThanOrEqual(0);
    }
    expect(await errorOf("postgres", "select * from app.plan_schedule('CASH', 0, current_date)")).toMatch(/positive total/);
  });

  it("refuses a plan template whose percentages do not add up to 100", async () => {
    const msg = await errorOf(
      "postgres",
      `update public.app_config set value = jsonb_set(value, '{0,schedule,0,pct}', '90') where key = 'plan.templates';
       select * from app.plan_schedule('CASH', 1000, current_date);`,
    );
    expect(msg).toMatch(/do not add up to 100/);
  });

  // L-0204: every row of a template is checked before any arithmetic; each of these was accepted
  // (or silently cast) before, and each passes or dodges the total-of-100 check on its own.
  const withSchedule = (schedule: string) =>
    `update public.app_config set value = jsonb_set(value, '{0,schedule}', '${schedule}'::jsonb) where key = 'plan.templates';
     select * from app.plan_schedule('CASH', 100000, date '2026-11-03');`;
  it.each([
    ["a negative percentage in a total of 100", '[{"pct": -10, "day_offset": 0}, {"pct": 110, "day_offset": 15}]', /above 0/],
    ["a zero percentage", '[{"pct": 0, "day_offset": 0}, {"pct": 100, "day_offset": 15}]', /above 0/],
    [
      "a missing pct (it dropped out of the sum)",
      '[{"pct": 100, "day_offset": 0}, {"day_offset": 15}]',
      /numeric pct and day_offset/,
    ],
    ["a missing day_offset", '[{"pct": 100}]', /numeric pct and day_offset/],
    ["a JSON null", '[{"pct": 100, "day_offset": null}]', /numeric pct and day_offset/],
    ["a percentage given as a string", '[{"pct": "100", "day_offset": 0}]', /numeric pct and day_offset/],
    ["a row that is not an object", "[100]", /numeric pct and day_offset/],
    ["a negative day_offset", '[{"pct": 100, "day_offset": -1}]', /whole number of days/],
    [
      "a fractional day_offset (it was truncated)",
      '[{"pct": 50, "day_offset": 0}, {"pct": 50, "day_offset": 7.5}]',
      /whole number of days/,
    ],
    ["a day_offset past the integer range", '[{"pct": 100, "day_offset": 1e12}]', /whole number of days/],
    ["installments out of due order", '[{"pct": 50, "day_offset": 15}, {"pct": 50, "day_offset": 0}]', /due order/],
    ["percentages over 100", '[{"pct": 60, "day_offset": 0}, {"pct": 60, "day_offset": 15}]', /do not add up to 100/],
  ])("refuses a plan template with %s", async (_name, schedule, message) => {
    expect(await errorOf("postgres", withSchedule(schedule))).toMatch(message);
    expect(await sqlstate("postgres", withSchedule(schedule))).toBe("22023");
  });

  it("accepts a valid template the owner may write: 0% at delivery, fractional percentages, 7.0 as a day count", async () => {
    const results = (await run(
      "postgres",
      withSchedule('[{"pct": 33.5, "day_offset": 7}, {"pct": 33.5, "day_offset": 14.0}, {"pct": 33, "day_offset": 28}]'),
    )) as unknown as Multi;
    const rows = results.at(-1)?.rows ?? [];
    expect(rows.map((r) => [r.inst_no, r.inst_count, String(r.amount_paisa)])).toEqual([
      [1, 3, "33500"],
      [2, 3, "33500"],
      [3, 3, "33000"],
    ]);
    const due = rows.map((r) => new Date(r.due_on as string).getTime());
    expect(due.map((d) => d - due[0])).toEqual([0, 7 * 86_400_000, 21 * 86_400_000]);
  });
});

describe("who may read it", () => {
  it("its rep and the office at AAL2 read it; another rep, AAL1 office, a suspended user and an unapproved device get null", async () => {
    const r = await docs(
      id(),
      "CASH",
      [[SKU2, 1]],
      [
        ["repA", asUser("repA")],
        ["repB", asUser("repB")],
        ["manager", asUser("manager")],
        ["owner", asUser("owner")],
        ["manager_aal1", asUser("manager", "aal1")],
        ["owner_aal1", asUser("owner", "aal1")],
        ["suspended", asUser("suspendedRep")],
        ["repA_wrong_device", asUser("repA", "aal1", "dev-not-approved-0000")],
      ],
    );
    const number = (r.invoice as { number: string }).number;
    expect((r.repA as Doc).number).toBe(number);
    expect((r.manager as Doc).number).toBe(number);
    expect((r.owner as Doc).number).toBe(number);
    expect([r.repB, r.manager_aal1, r.owner_aal1, r.suspended, r.repA_wrong_device]).toEqual([null, null, null, null, null]);
  });

  it("an unknown id gives null, the same answer as someone else's invoice", async () => {
    const { rows } = await run(REP_A, `select app.invoice_document('${id()}') doc`);
    expect(rows[0].doc).toBeNull();
  });

  it("anon and service_role cannot call it; the schedule helper is internal", async () => {
    expect(await sqlstate("anon", `select app.invoice_document('${id()}')`)).toBe("42501");
    expect(await sqlstate("service_role", `select app.invoice_document('${id()}')`)).toBe("42501");
    for (const who of [REP_A, MANAGER, OWNER]) {
      expect(await sqlstate(who, "select * from app.plan_schedule('CASH', 1000, current_date)")).toBe("42501");
    }
  });
});

describe("nothing from the vault reaches the document (doc 07 §3, H-01, H-05)", () => {
  it("no key anywhere in the document names a cost, supplier, margin, lot or purchase order", async () => {
    const r = await docs(
      id(),
      "INST2",
      [
        [SKU1, 1],
        [SKU3, 2],
      ],
      [["owner", asUser("owner")]],
    );
    const keys: string[] = [];
    const walk = (v: unknown) => {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object")
        for (const [k, x] of Object.entries(v)) {
          keys.push(k);
          walk(x);
        }
    };
    walk(r.owner);
    expect(keys.length).toBeGreaterThan(30);
    expect(keys.filter((k) => /cost|supplier|vendor|margin|lot|purchase|^po_|_po$|batch/i.test(k))).toEqual([]);
  });

  it("neither function's source refers to the vault schemas or the vault API", async () => {
    const { rows } = await run(
      "postgres",
      `select p.proname, p.prosrc ~* '(supplier_vault|vault_api|has_vault_grant)' vault, p.provolatile v
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'app' and p.proname in ('invoice_document', 'plan_schedule') order by 1`,
    );
    expect(rows).toEqual([
      { proname: "invoice_document", vault: false, v: "s" },
      { proname: "plan_schedule", vault: false, v: "s" },
    ]);
  });

  it("the company keys are not visible to reps (B-14), and reading a document writes nothing", async () => {
    const before = (await run("postgres", "select count(*)::int n from control.audit_event")).rows[0].n;
    const { rows } = await run(REP_A, "select key from public.app_config where key like 'company.%'");
    expect(rows).toEqual([]);
    await run(REP_A, `select app.invoice_document('${id()}')`, [], C);
    const after = (await run("postgres", "select count(*)::int n from control.audit_event")).rows[0].n;
    expect(after).toBe(before);
  });
});
