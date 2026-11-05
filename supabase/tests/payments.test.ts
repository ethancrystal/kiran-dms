/**
 * Money in (migration 0021, task P1-07 part a): PAY-01 (installment rows fixed at invoice issue),
 * PAY-02, PAY-03 (numbered receipt), PAY-04 (rep cash ledger), PAY-10 (append-only), PAY-11
 * (oldest-first allocation), CTL-01 (receipt issued), CTL-02 (flags); doc 09 sections 1, 3, 4, 5;
 * ACTIVITY B-37 (who may record what).
 *
 * Territories, a salon with an owner-set credit profile, a catalogue and a warehouse are committed
 * with fresh ids. Each test runs in one rolled-back transaction that opens the reps' day, loads
 * rep A's bag, places and delivers orders (which issues invoices and their installments), then
 * records payments. Nothing is left behind except the shared set-up. All amounts are paisa.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  approveSalon,
  errorOf,
  fx,
  MANAGER,
  MANAGER_AAL1,
  OWNER,
  REP_A,
  REP_A_WRONG_DEVICE,
  REP_B,
  run,
  sqlstate,
  type Who,
} from "./helpers/db";
import { submitApproveSql } from "./helpers/submit-approve";

const C = { commit: true };
const id = () => randomUUID();
const tag = () => randomUUID().slice(0, TAG_LENGTH);
const one = async (who: Who, sql: string, params: unknown[] = []) => (await run(who, sql, params, C)).rows[0];
// For a session that runs beside the test's other awaits (a lock holder, a cancelled sleep): it may reject before
// the test reaches it, which Node reports as an unhandled rejection and fails the run. This attaches a handler the
// moment the session starts. It returns the same promise, so awaiting or settling it later still sees the rejection.
const observed = <T>(session: Promise<T>): Promise<T> => {
  const drain = async () => {
    try {
      await session;
    } catch {
      // Seen by whoever awaits the returned promise.
    }
  };
  void drain();
  return session;
};
const TODAY = "(now() at time zone 'Asia/Karachi')::date";

// Amounts in paisa. One unit of the test SKU lists at UNIT; an INST4 order of four units has four
// installments of UNIT each (25% each), so every amount below is a plain multiple or half of UNIT.
const UNIT = 100000;
const HALF_UNIT = 50000;
const ONE_AND_HALF = 150000;
const ONE_AND_HALF_PLUS_ONE = 150001;
const TWO_UNITS = 200000;
const TWO_AND_HALF = 250000;
const THREE_UNITS = 300000;
const FOUR_UNITS = 400000;
const LUMP_SUM = 550000;
const ABOVE_OWED = 100001;
const INST4_QTY = 4;
const CASH_ORDER_QTY = 2;
const CASH_SMALL_QTY = 1;
const CASH_THREE_QTY = 3;
const DAY_10 = 10;
const DAY_20 = 20;
const DAY_30 = 30;
const DUE_DAYS = [0, DAY_10, DAY_20, DAY_30] as const; // plan.templates INST4, doc 09 section 1
const INST_COUNT = DUE_DAYS.length;
const [, SECOND, THIRD, FOURTH] = DUE_DAYS.map((_, n) => n + 1);
const TWO_ALLOCATIONS = 2; // 150000 spans installments 1 and 2
const PCT_QUARTER = 25;
const ODD_PRICE = 33333; // a unit price whose quarter is not a whole number of paisa
const ODD_QUARTER = 8333; // floor(33333 x 25 / 100)
const ODD_LAST = 8334; // the last installment takes the remainder (A-11)
const PART_PAY = 20000;
const PART_THIRD = 3334; // 20000 - 8333 - 8333
const INVOICES_ISSUED = 2;
const PRIVILEGE_CHECKS = 9; // 3 roles by 3 privileges
const TAG_LENGTH = 8;
const FLAG_DISTANCE_M = 300; // payment.geofence_m as seeded
const GPS_OFF_55M = "24.9005, 67.1"; // about 55 m from the salon pin
const GEOFENCE_WIDE = 100000;
const GEOFENCE_TIGHT = 10;
const MINUTES_WIDE = 240;
const MINUTES_TIGHT = 5;
const FAR_LAT = 25.2;
const FAR_LNG = 67.4;
const MINUTES_RECENT = "10 minutes";
const HOURS_LATE = "3 hours";

// Receipt number, e.g. "R-27-000001" matches; "R-27-1" and "INV-27-000001" do not.
// https://regex101.com/?regex=%5ER-%5B0-9%5D%7B2%7D-%5B0-9%5D%7B6%7D%24&flavor=javascript
const RECEIPT_NO = /^R-[0-9]{2}-[0-9]{6}$/;
// A phone number written in a document: "0300 1234567" and "+923001234567" match; "R-27-000001" does not.
// https://regex101.com/?regex=%2B92%7C03%5B0-9%5D%7B9%7D&flavor=javascript
const PHONE_LIKE = /\+92|03[0-9]{9}/;

const T_A = id(),
  AREA_A = id(),
  T_B = id(),
  AREA_B = id();
const SALON = id(), // territory A, pin at 24.9, 67.1, owner-set INST4 credit
  SALON_B = id(), // territory B
  SALON_X = id(); // territory A, never ordered: owes nothing
const GROUP = id(),
  PRODUCT = id(),
  SKU1 = id(),
  SKU2 = id();
const WH = id();
const BAG_A = `(select l.id from public.stock_location l where l.kind = 'rep_bag' and l.owner_user_id = '${fx.repA.id}')`;

type P = "repA" | "repAWrongDevice" | "repB" | "manager" | "managerAal1" | "owner";
// "managerAal1" is the manager's login without the MFA step; "repAWrongDevice" is rep A on a device nobody approved.
const WRONG_DEVICE = "dev-not-approved-0000";
const asUser = (k: P) => {
  const who = k === "managerAal1" ? "manager" : k === "repAWrongDevice" ? "repA" : k;
  const device = k === "repAWrongDevice" ? WRONG_DEVICE : fx[who].device;
  return `
  reset role;
  select set_config('request.jwt.claims', '${JSON.stringify({ sub: fx[who].id, role: "authenticated", aal: k.startsWith("rep") || k === "managerAal1" ? "aal1" : "aal2" })}', true),
         set_config('request.headers', '${JSON.stringify({ "x-kiran-device": device })}', true);
  set local role authenticated;`;
};
const prelude = (repBDay: boolean) => `
  insert into public.rep_day (rep_id, day) values ('${fx.repA.id}', ${TODAY}) ${repBDay ? `, ('${fx.repB.id}', ${TODAY})` : ""} on conflict (rep_id, day) do nothing;
  ${asUser("owner")}
  select app.office_create_location('${id()}', 'rep_bag', '[Test] Payment bag A', '${fx.repA.id}', 50000000)
   where not exists (select 1 from public.stock_location l where l.kind = 'rep_bag' and l.owner_user_id = '${fx.repA.id}');
  reset role;
  insert into public.stock_movement (client_id, sku_id, qty, from_location_id, to_location_id, kind, actor_id)
  values (gen_random_uuid(), '${SKU1}', 40, '${WH}', ${BAG_A}, 'issue_to_rep', '${fx.manager.id}'),
         (gen_random_uuid(), '${SKU2}', 40, '${WH}', ${BAG_A}, 'issue_to_rep', '${fx.manager.id}');`;
type Step = [P | "postgres", string];
const script = (steps: Step[], repBDay = true) =>
  `${prelude(repBDay)}\n${steps.map(([k, sql]) => `${k === "postgres" ? "reset role;" : asUser(k)}\n${sql}`).join("\n")}`;
type Multi = Array<{ rows: Array<Record<string, unknown>> }>;
const tx = async (steps: Step[], repBDay = true) =>
  ((await run("postgres", script(steps, repBDay))) as unknown as Multi).at(-1)?.rows ?? [];
const txError = (steps: Step[], repBDay = true) => errorOf("postgres", script(steps, repBDay));
const txCode = (steps: Step[]) => sqlstate("postgres", script(steps));

const lines = (qty: number) => `'${JSON.stringify([{ sku_id: SKU1, qty }])}'::jsonb`;
const oid = (cid: string) => `(select id from public.sales_order where client_id = '${cid}')`;
// An order the manager makes for SALON on a plan and names rep A to deliver, delivered in full by rep A: one invoice with its installments.
const delivered = (qty: number, plan = "INST4"): Step[] => {
  const [ocid, dcid] = [id(), id()];
  return [
    ["manager", `select app.office_create_order('${ocid}', '${SALON}', '${plan}', ${lines(qty)}, '${fx.repA.id}');`],
    // A rep's delivery (D-32): rep A submits it and the manager approves it.
    ["postgres", submitApproveSql(asUser, { clientId: dcid, orderExpr: oid(ocid), rep: "repA", approver: "manager" })],
  ];
};
const GPS_NEAR = "24.9, 67.1";
const repPay = (cid: string, amount: number, extra = "", gps = GPS_NEAR, salon = SALON, method = "cash"): Step => [
  "repA",
  `select (app.rep_record_payment('${cid}', '${salon}', '${method}', ${amount}, ${gps}${extra})).*;`,
];
const receiptNo = (cid: string) =>
  `(select r.number from public.receipt r join public.payment p on p.id = r.payment_id where p.client_id = '${cid}')`;
interface Doc {
  number: string;
  payment: { amount_paisa: number };
  allocations: Array<{ seq: number; amount_paisa: number; invoice_number: string }>;
  remaining: Array<{ seq: number; remaining_paisa: number; invoice_number: string }>;
  notices: Array<{ code: string }>;
}
const standard = (): Step[] => delivered(INST4_QTY);

beforeAll(async () => {
  await one(MANAGER, "select app.office_upsert_territory($1, $2)", [T_A, `[Test] Payments A ${tag()}`]);
  await one(MANAGER, "select app.office_upsert_territory($1, $2)", [T_B, `[Test] Payments B ${tag()}`]);
  await one(MANAGER, "select app.office_upsert_area($1, $2, '[Test] Payments area A')", [AREA_A, T_A]);
  await one(MANAGER, "select app.office_upsert_area($1, $2, '[Test] Payments area B')", [AREA_B, T_B]);
  await one(MANAGER, "select app.office_assign_territory($1, $2)", [fx.repA.id, T_A]);
  await one(MANAGER, "select app.office_assign_territory($1, $2)", [fx.repB.id, T_B]);
  await Promise.all(
    (
      [
        [SALON, AREA_A, "repA"],
        [SALON_X, AREA_A, "repA"],
        [SALON_B, AREA_B, "repB"],
      ] as const
    ).map(([s, area, rep]) =>
      one({ as: rep }, "select app.create_salon($1, $2, 'ladies_parlor', $3, 'map_pin', null, 24.9, 67.1)", [
        s,
        `[Test] Payment salon ${tag()}`,
        area,
      ]),
    ),
  );
  // D-35 (slice 7): a rep's salon is a proposal; the office approves both before any order.
  await approveSalon(SALON);
  await approveSalon(SALON_B);
  await one(OWNER, "select app.owner_set_credit($1, 'INST4', 100000000, 'payments tests, owner decision')", [SALON]);
  await one(MANAGER, "select app.office_upsert_product_group($1, $2, 21)", [GROUP, `[Test] Payment colour ${tag()}`]);
  await one(MANAGER, "select app.office_upsert_product($1, $2, '[Dummy] Kiran', '[Dummy] Payment colour')", [PRODUCT, GROUP]);
  await one(MANAGER, "select app.office_upsert_sku($1, $2, $3, '[Dummy] shade', 'ml', 100)", [
    SKU1,
    PRODUCT,
    `T-PAY-${tag().toUpperCase()}`,
  ]);
  await one(MANAGER, "select app.office_upsert_sku($1, $2, $3, '[Dummy] shade 2', 'ml', 100)", [
    SKU2,
    PRODUCT,
    `T-PAY2-${tag().toUpperCase()}`,
  ]);
  await one(OWNER, "select app.owner_set_sku_price($1, $2, 'dummy list price')", [SKU1, UNIT]);
  await one(OWNER, "select app.owner_set_sku_price($1, $2, 'dummy list price')", [SKU2, ODD_PRICE]);
  await one(MANAGER, "select app.office_create_location($1, 'warehouse', '[Test] Payment store')", [WH]);
  await one(
    "postgres",
    `insert into public.stock_movement (client_id, sku_id, qty, to_location_id, kind, actor_id)
     values (gen_random_uuid(), $1, 1000, $2, 'receipt', $3), (gen_random_uuid(), $4, 1000, $2, 'receipt', $3)`,
    [SKU1, WH, fx.manager.id, SKU2],
  );
});

afterAll(async () => {
  await one(MANAGER, "select app.office_end_territory($1, $2, 'payments tests finished')", [fx.repA.id, T_A]);
  await one(MANAGER, "select app.office_end_territory($1, $2, 'payments tests finished')", [fx.repB.id, T_B]);
});

describe("installments are fixed when the invoice is issued (PAY-01, A-11)", () => {
  it("an INST4 delivery gets four installments that add up to the invoice, due on the template's days", async () => {
    const rows = await tx([
      ...standard(),
      [
        "postgres",
        `select i.seq, i.of_count, i.due_on - ${TODAY} as day, i.amount_due_paisa, v.total_paisa
         from public.installment i join public.invoice v on v.id = i.invoice_id where i.salon_id = '${SALON}' order by i.seq`,
      ],
    ]);
    expect(rows.map((r) => [r.seq, r.of_count, r.day, Number(r.amount_due_paisa)])).toEqual(
      DUE_DAYS.map((day, n) => [n + 1, INST_COUNT, day, UNIT]),
    );
    expect(Number(rows[0].total_paisa)).toBe(FOUR_UNITS);
  });

  it("a CASH delivery has one installment for the whole invoice, due on delivery", async () => {
    const rows = await tx([
      ...delivered(CASH_THREE_QTY, "CASH"),
      [
        "postgres",
        `select seq, of_count, amount_due_paisa, due_on - ${TODAY} as day from public.installment where salon_id = '${SALON}'`,
      ],
    ]);
    expect(rows.map((r) => [r.seq, r.of_count, Number(r.amount_due_paisa), r.day])).toEqual([[1, 1, THREE_UNITS, 0]]);
  });

  it("a later change to the plan template does not move an issued invoice's schedule", async () => {
    const rows = await tx([
      ...standard(),
      [
        "postgres",
        `update public.app_config set value = jsonb_set(value, '{2,schedule}', '[{"pct": 100, "day_offset": 5}]'::jsonb) where key = 'plan.templates';
         select i.amount_due_paisa from public.installment i where i.salon_id = '${SALON}' order by i.seq`,
      ],
    ]);
    expect(rows.map((r) => Number(r.amount_due_paisa))).toEqual(DUE_DAYS.map(() => UNIT));
  });
});

describe("an uneven total (A-11)", () => {
  const oddOrder = (): Step[] => {
    const [ocid, dcid] = [id(), id()];
    return [
      [
        "manager",
        `select app.office_create_order('${ocid}', '${SALON}', 'INST4', '${JSON.stringify([{ sku_id: SKU2, qty: 1 }])}'::jsonb, '${fx.repA.id}');`,
      ],
      ["postgres", submitApproveSql(asUser, { clientId: dcid, orderExpr: oid(ocid), rep: "repA", approver: "manager" })],
    ];
  };

  it("the last installment takes the remainder, and a part payment fills the installments oldest first", async () => {
    const p = id();
    const [plain, paid] = await Promise.all([
      tx([
        ...oddOrder(),
        ["postgres", `select amount_due_paisa from public.installment where salon_id = '${SALON}' order by seq`],
      ]),
      tx([
        ...oddOrder(),
        repPay(p, PART_PAY),
        [
          "postgres",
          `select i.seq, a.amount_paisa from public.payment_allocation a join public.installment i on i.id = a.installment_id
            join public.payment q on q.id = a.payment_id where q.client_id = '${p}' order by i.seq`,
        ],
      ]),
    ]);
    expect(plain.map((r) => Number(r.amount_due_paisa))).toEqual([ODD_QUARTER, ODD_QUARTER, ODD_QUARTER, ODD_LAST]);
    expect(plain.reduce((sum, r) => sum + Number(r.amount_due_paisa), 0)).toBe(ODD_PRICE);
    expect(paid.map((r) => [r.seq, Number(r.amount_paisa)])).toEqual([
      [1, ODD_QUARTER],
      [SECOND, ODD_QUARTER],
      [THIRD, PART_THIRD],
    ]);
  });
});

describe("recording a payment (PAY-02, PAY-11, CTL-01)", () => {
  it("a rep's cash payment is allocated oldest due first, gets a numbered receipt and lands on the rep's cash ledger", async () => {
    const p = id();
    const rows = await tx([
      ...standard(),
      repPay(p, TWO_AND_HALF),
      [
        "postgres",
        `select i.seq, a.amount_paisa, ${receiptNo(p)} as no,
                (select count(*)::int from public.cash_ledger_entry where holder_id = '${fx.repA.id}' and direction = 'in' and amount_paisa = ${TWO_AND_HALF}) ledger
         from public.payment_allocation a join public.installment i on i.id = a.installment_id
         join public.payment q on q.id = a.payment_id where q.client_id = '${p}' order by i.seq`,
      ],
    ]);
    expect(rows.map((r) => [r.seq, Number(r.amount_paisa)])).toEqual([
      [1, UNIT],
      [SECOND, UNIT],
      [THIRD, HALF_UNIT],
    ]);
    expect(String(rows[0].no)).toMatch(RECEIPT_NO);
    expect(rows[0].ledger).toBe(1);
  });

  it("the next payment continues where the last stopped, and the balance is derived", async () => {
    const rows = await tx([
      ...standard(),
      repPay(id(), TWO_AND_HALF),
      repPay(id(), UNIT),
      ["repA", `select * from app.salon_installments('${SALON}')`],
    ]);
    expect(rows.map((r) => [r.seq, Number(r.paid_paisa), Number(r.remaining_paisa), r.status])).toEqual([
      [INST_COUNT, HALF_UNIT, HALF_UNIT, "partial"],
    ]);
    const bal = await tx([...standard(), repPay(id(), TWO_AND_HALF), ["repA", `select * from app.salon_balance('${SALON}')`]]);
    expect([Number(bal[0].invoiced_paisa), Number(bal[0].paid_paisa), Number(bal[0].balance_paisa)]).toEqual([
      FOUR_UNITS,
      TWO_AND_HALF,
      ONE_AND_HALF,
    ]);
  });

  it("a lump sum settles installments across several invoices, oldest due first, with one receipt", async () => {
    const p = id();
    const rows = await tx([
      ...standard(),
      ...delivered(CASH_ORDER_QTY, "CASH"),
      repPay(p, LUMP_SUM),
      [
        "postgres",
        `select a.amount_paisa, (select count(*)::int from public.receipt r where r.payment_id = q.id) receipts
         from public.payment_allocation a join public.installment i on i.id = a.installment_id
         join public.payment q on q.id = a.payment_id where q.client_id = '${p}' order by i.due_on, a.amount_paisa desc`,
      ],
    ]);
    // Day 0: the CASH invoice (200000) and installment 1 of the other (100000); then days 10, 20 in full and half of day 30.
    expect(rows.map((r) => Number(r.amount_paisa))).toEqual([TWO_UNITS, UNIT, UNIT, UNIT, HALF_UNIT]);
    expect(rows.every((r) => r.receipts === 1)).toBe(true);
  });

  it("a bank transfer carries the bank and reference, adds no cash to the ledger, and is allocated the same way", async () => {
    const p = id();
    const rows = await tx([
      ...standard(),
      repPay(p, UNIT, ", 'Dummy Bank', 'TRX-0001'", GPS_NEAR, SALON, "bank_transfer"),
      [
        "postgres",
        `select q.bank_name, q.bank_reference, q.method::text m, (select count(*)::int from public.cash_ledger_entry e where e.source_id = q.id) cash,
                (select count(*)::int from public.payment_allocation where payment_id = q.id) allocs
         from public.payment q where q.client_id = '${p}'`,
      ],
    ]);
    expect(rows[0]).toEqual({ bank_name: "Dummy Bank", bank_reference: "TRX-0001", m: "bank_transfer", cash: 0, allocs: 1 });
  });

  it("refuses a bank transfer without bank or reference, and a cash payment that carries them", async () => {
    const attempt = (method: string, extra: string) =>
      txError([...standard(), repPay(id(), UNIT, extra, GPS_NEAR, SALON, method)]);
    expect(await attempt("bank_transfer", "")).toContain("needs the bank name and the reference");
    expect(await attempt("bank_transfer", ", 'Dummy Bank'")).toContain("needs the bank name and the reference");
    expect(await attempt("cash", ", 'Dummy Bank', 'TRX-0002'")).toContain("no bank name or reference");
  });

  it("refuses a payment above what the salon owes, any payment from a salon that owes nothing, and a zero amount", async () => {
    expect(await txError([...delivered(CASH_SMALL_QTY, "CASH"), repPay(id(), ABOVE_OWED)])).toContain(
      `more than the salon owes (${UNIT} paisa)`,
    );
    expect(await txError([repPay(id(), HALF_UNIT, "", GPS_NEAR, SALON_X)])).toContain("owes nothing");
    expect(await txError([...delivered(CASH_SMALL_QTY, "CASH"), repPay(id(), 0)])).toContain("amount above zero");
  });

  it("is idempotent: the same call twice is one payment, one allocation set, one receipt and one cash row", async () => {
    const p = id();
    const rows = await tx([
      ...standard(),
      repPay(p, ONE_AND_HALF),
      repPay(p, ONE_AND_HALF),
      [
        "postgres",
        `select (select count(*)::int from public.payment where client_id = '${p}') payments,
                (select count(*)::int from public.payment_allocation a join public.payment q on q.id = a.payment_id where q.client_id = '${p}') allocs,
                (select count(*)::int from public.receipt r join public.payment q on q.id = r.payment_id where q.client_id = '${p}') receipts,
                (select count(*)::int from public.cash_ledger_entry e join public.payment q on q.id = e.source_id where q.client_id = '${p}') ledger`,
      ],
    ]);
    expect(rows[0]).toEqual({ payments: 1, allocs: TWO_ALLOCATIONS, receipts: 1, ledger: 1 });
  });

  it("refuses the same client_id with other content", async () => {
    const p = id();
    expect(await txError([...standard(), repPay(p, ONE_AND_HALF), repPay(p, ONE_AND_HALF_PLUS_ONE)])).toContain(
      "client_id already used with different content",
    );
  });

  it("a number allocated by a payment that is then rolled back is given out again: numbers stay gapless (H-11)", async () => {
    const [a, b] = [id(), id()];
    const rows = await tx([
      ...standard(),
      repPay(a, UNIT),
      [
        // A complete, valid payment (so a receipt number is allocated) inside a sub-transaction that fails afterwards.
        "repA",
        `do $$ begin
           begin
             perform app.rep_record_payment('${id()}', '${SALON}', 'cash', ${UNIT}, ${GPS_NEAR});
             raise exception 'forced failure after the receipt number was allocated';
           exception when others then null; end;
         end $$;`,
      ],
      repPay(b, UNIT),
      ["postgres", `select (substr(${receiptNo(b)}, 6)::int - substr(${receiptNo(a)}, 6)::int) as gap`],
    ]);
    expect(rows[0].gap).toBe(1);
  });
});

describe("who may record a payment, and the CTL-02 flags", () => {
  it("a rep cannot record for a salon outside its territories, nor without an open day, nor without GPS", async () => {
    expect(
      await txCode([
        ...standard(),
        ["repB", `select app.rep_record_payment('${id()}', '${SALON}', 'cash', ${UNIT}, 25.0, 67.0);`],
      ]),
    ).toBe("42501");
    // Rep B has no open day in this script: even its own territory's salon is refused.
    expect(
      await txError(
        [["repB", `select app.rep_record_payment('${id()}', '${SALON_B}', 'cash', ${HALF_UNIT}, 25.0, 67.0);`]],
        false,
      ),
    ).toContain("check in before recording a payment");
    expect(
      await txError([
        ...standard(),
        ["repA", `select app.rep_record_payment('${id()}', '${SALON}', 'cash', ${UNIT}, null, null);`],
      ]),
    ).toContain("GPS is required");
  });

  it("the readiness gates run first and say why: wrong device, suspended rep, AAL1 office, wrong role, anon", async () => {
    const rep = (cid: string) => `select app.rep_record_payment('${cid}', '${SALON}', 'cash', ${UNIT}, ${GPS_NEAR});`;
    const office = (cid: string) => `select app.office_record_payment('${cid}', '${SALON}', ${UNIT}, 'Dummy Bank', 'TRX-0005');`;
    const suspendRepA: Step = ["owner", `select app.owner_set_status('${fx.repA.id}', 'suspended', 'payments readiness test');`];
    // Everything else is valid in each case: an open day, a salon in the rep's territory, GPS at the pin,
    // an invoice that is owed. Only the caller's readiness differs.
    const messages = await Promise.all([
      txError([...standard(), ["repAWrongDevice", rep(id())]]),
      txError([...standard(), suspendRepA, ["repA", rep(id())]]),
      txError([...standard(), ["managerAal1", office(id())]]),
      txError([...standard(), ["repA", office(id())]]),
      txError([...standard(), ["manager", rep(id())]]),
      errorOf("anon", rep(id())),
    ]);
    expect(messages.map((m) => m ?? "")).toEqual([
      expect.stringContaining("this device is not approved for this rep"),
      expect.stringContaining("no active user profile for this session"),
      expect.stringContaining("office actions require an MFA-verified (AAL2) session"),
      expect.stringContaining("owner or manager only"),
      expect.stringContaining("reps record their own collections"),
      expect.stringContaining("permission denied"),
    ]);
  });

  it("readiness is checked before a replay is answered: the same call from a wrong device or a suspended rep is refused", async () => {
    const p = id();
    const same = `select app.rep_record_payment('${p}', '${SALON}', 'cash', ${UNIT}, ${GPS_NEAR});`;
    const [wrongDevice, suspended] = await Promise.all([
      txError([...standard(), repPay(p, UNIT), ["repAWrongDevice", same]]),
      txError([
        ...standard(),
        repPay(p, UNIT),
        ["owner", `select app.owner_set_status('${fx.repA.id}', 'suspended', 'payments readiness test');`],
        ["repA", same],
      ]),
    ]);
    expect(wrongDevice).toContain("this device is not approved for this rep");
    expect(suspended).toContain("no active user profile for this session");
  });

  // Until L-0362 the table refused any office cash row (B-37). MJ resolved B-37 on 2026-11-03: the office
  // may record cash (app.office_record_cash, office-cash.test.ts); the table still refuses a rep payment
  // with no rep day (and so no open day and no GPS).
  it("the office records a bank transfer on behalf, flagged on_behalf; a rep payment with no rep day is refused", async () => {
    const p = id();
    const rows = await tx([
      ...standard(),
      ["manager", `select (app.office_record_payment('${p}', '${SALON}', ${UNIT}, 'Dummy Bank', 'TRX-0003')).number;`],
      ["postgres", `select flags::text f, recorded_by_role::text r, rep_day_id from public.payment where client_id = '${p}'`],
    ]);
    expect(rows[0]).toEqual({ f: '["on_behalf"]', r: "manager", rep_day_id: null });
    const repWithoutDay = `insert into public.payment (client_id, salon_id, recorded_by, recorded_by_role, method, amount_paisa)
                        values (gen_random_uuid(), '${SALON}', '${fx.repA.id}', 'rep', 'cash', ${HALF_UNIT})`;
    expect(await sqlstate("postgres", repWithoutDay)).toBe("23514");
  });

  // Owner steps change the existing settings first; every step runs in one rolled-back transaction.
  const flagsOf = async (gps: string, visitAgo: string | null, settings: Array<[string, string]> = []) => {
    const p = id();
    const visit: Step[] = visitAgo
      ? [
          [
            "postgres",
            `insert into public.visit (client_id, rep_day_id, rep_id, salon_id, outcome, arrived_at, lat, lng)
             select gen_random_uuid(), d.id, d.rep_id, '${SALON}', 'collection', now() - interval '${visitAgo}', 24.9, 67.1
             from public.rep_day d where d.rep_id = '${fx.repA.id}' and d.day = ${TODAY};`,
          ],
        ]
      : [];
    const owner: Step[] = settings.map(([key, value]) => [
      "owner",
      `select app.owner_set_config('${key}', '${value}'::jsonb, 'payments test change');`,
    ]);
    const rows = await tx([
      ...standard(),
      ...owner,
      ...visit,
      repPay(p, UNIT, "", gps),
      ["postgres", `select flags::text f, distance_from_pin_m d from public.payment where client_id = '${p}'`],
    ]);
    return rows[0];
  };

  it("an office login without MFA (AAL1) sees none of the payment rows it recorded itself", async () => {
    const p = id();
    const rows = await tx([
      ...standard(),
      ["manager", `select (app.office_record_payment('${p}', '${SALON}', ${UNIT}, 'Dummy Bank', 'TRX-0010')).number;`],
      [
        "managerAal1",
        `select (select count(*)::int from public.payment) payments, (select count(*)::int from public.receipt) receipts,
                (select count(*)::int from public.cash_ledger_entry) ledger, (select count(*)::int from public.installment) installments`,
      ],
    ]);
    expect(rows[0]).toEqual({ payments: 0, receipts: 0, ledger: 0, installments: 0 });
  });

  it("flags a payment far from the salon, one with no visit, and one long after the visit; a clean one has none", async () => {
    const far = await flagsOf(`${FAR_LAT}, ${FAR_LNG}`, MINUTES_RECENT);
    const [clean, noVisit, late] = await Promise.all([
      flagsOf(GPS_NEAR, MINUTES_RECENT),
      flagsOf(GPS_NEAR, null),
      flagsOf(GPS_NEAR, HOURS_LATE),
    ]);
    expect([clean.f, noVisit.f, late.f, far.f]).toEqual(["[]", '["no_visit"]', '["late_after_arrival"]', '["far_from_salon"]']);
    expect(Number(far.d)).toBeGreaterThan(FLAG_DISTANCE_M);
  });

  it("an owner's change to payment.geofence_m changes the far flag of the next payment", async () => {
    const [control, widened, tightened] = await Promise.all([
      flagsOf(GPS_OFF_55M, MINUTES_RECENT),
      flagsOf(`${FAR_LAT}, ${FAR_LNG}`, MINUTES_RECENT, [["payment.geofence_m", String(GEOFENCE_WIDE)]]),
      flagsOf(GPS_OFF_55M, MINUTES_RECENT, [["payment.geofence_m", String(GEOFENCE_TIGHT)]]),
    ]);
    expect([control.f, widened.f, tightened.f]).toEqual(["[]", "[]", '["far_from_salon"]']);
  });

  it("an owner's change to payment.max_minutes_after_arrival changes the late flag of the next payment", async () => {
    const [control, widened, tightened] = await Promise.all([
      flagsOf(GPS_NEAR, MINUTES_RECENT),
      flagsOf(GPS_NEAR, HOURS_LATE, [["payment.max_minutes_after_arrival", String(MINUTES_WIDE)]]),
      flagsOf(GPS_NEAR, MINUTES_RECENT, [["payment.max_minutes_after_arrival", String(MINUTES_TIGHT)]]),
    ]);
    expect([control.f, widened.f, tightened.f]).toEqual(["[]", "[]", '["late_after_arrival"]']);
  });

  it("a threshold that is not a number refuses the payment (fail closed)", async () => {
    const message = await txError([
      ...standard(),
      ["owner", "select app.owner_set_config('payment.geofence_m', '\"far\"'::jsonb, 'payments test change');"],
      repPay(id(), UNIT),
    ]);
    expect(message).toContain("payment.geofence_m");
    expect(message).toContain("not configured");
  });

  it("an office bank transfer does not depend on the rep thresholds", async () => {
    const p = id();
    const rows = await tx([
      ...standard(),
      ["owner", "select app.owner_set_config('payment.geofence_m', '\"far\"'::jsonb, 'payments test change');"],
      ["manager", `select (app.office_record_payment('${p}', '${SALON}', ${UNIT}, 'Dummy Bank', 'TRX-0013')).number;`],
      ["postgres", `select flags::text f from public.payment where client_id = '${p}'`],
    ]);
    expect(rows[0]).toEqual({ f: '["on_behalf"]' });
  });
});

describe("append-only, integrity and audit (PAY-10, H-06, H-10, H-17)", () => {
  const WRITES: Record<string, string> = {
    installment: "amount_due_paisa = amount_due_paisa",
    payment: "amount_paisa = amount_paisa",
    payment_allocation: "amount_paisa = amount_paisa",
    receipt: "number = number",
    cash_ledger_entry: "amount_paisa = amount_paisa",
  };
  const TABLES = Object.keys(WRITES);

  it.each(TABLES)("%s refuses UPDATE, DELETE and TRUNCATE for every application role and for the table owner", async (t) => {
    const mutations = [`update public.${t} set ${WRITES[t]}`, `delete from public.${t}`, `truncate public.${t}`];
    const roles: Who[] = [OWNER, MANAGER, REP_A, "service_role", "anon"];
    const byRole = await Promise.all(roles.flatMap((who) => mutations.map((sql) => sqlstate(who, sql))));
    expect(byRole).toEqual(byRole.map(() => "42501"));
    // The table owner is stopped by the append-only trigger, with rows present. A plain TRUNCATE of a
    // table that another table references fails earlier (0A000) without reaching our trigger, so it is
    // not counted as proof; TRUNCATE ... CASCADE runs the statement triggers of every table it reaches.
    const ownerSql = [mutations[0], mutations[1], `truncate public.${t} cascade`];
    const attempts = await Promise.all(
      ownerSql.map((sql) =>
        Promise.all([
          txCode([...standard(), repPay(id(), UNIT), ["postgres", sql]]),
          txError([...standard(), repPay(id(), UNIT), ["postgres", sql]]),
        ]),
      ),
    );
    expect(attempts.map(([code]) => code)).toEqual(attempts.map(() => "42501"));
    expect(attempts.every(([, message]) => message?.includes("is not allowed: table is append-only"))).toBe(true);
  });

  it("direct INSERT is refused for every application role: payments are written only by the functions", async () => {
    const insert = `insert into public.payment (client_id, salon_id, recorded_by, recorded_by_role, method, amount_paisa)
                    values (gen_random_uuid(), '${SALON}', '${fx.manager.id}', 'manager', 'bank_transfer', ${HALF_UNIT})`;
    const roles: Who[] = [OWNER, MANAGER, REP_A, "service_role", "anon"];
    const codes = await Promise.all(roles.map((who) => sqlstate(who, insert)));
    expect(codes).toEqual(codes.map(() => "42501"));
  });

  it("the database refuses an allocation above the installment, above the payment, or across salons, each on its own", async () => {
    const p = id();
    // Installment 1 is paid in full by payment p, which is itself fully allocated.
    const base: Step[] = [...standard(), repPay(p, UNIT)];
    const inst = (n: number) =>
      `(select i.id from public.installment i where i.salon_id = '${SALON}' order by i.due_on, i.seq offset ${n} limit 1)`;
    const allocate = (installment: string, payment: string): Step => [
      "postgres",
      `insert into public.payment_allocation (payment_id, installment_id, amount_paisa) values (${payment}, ${installment}, 1)`,
    ];
    const spare = (salon: string, ref: string): Step => [
      "postgres",
      `insert into public.payment (client_id, salon_id, recorded_by, recorded_by_role, method, amount_paisa, bank_name, bank_reference)
       values ('${id()}', '${salon}', '${fx.manager.id}', 'manager', 'bank_transfer', ${FOUR_UNITS}, 'Dummy Bank', '${ref}');`,
    ];
    const spareOf = (salon: string) =>
      `(select id from public.payment where salon_id = '${salon}' and recorded_by_role = 'manager' limit 1)`;
    const mine = `(select id from public.payment where client_id = '${p}')`;
    const messages = await Promise.all([
      // Installment cap only: a payment with plenty unallocated tries to over-pay the paid installment.
      txError([...base, spare(SALON, "TRX-0004"), allocate(inst(0), spareOf(SALON))]),
      // Payment cap only: installment 2 is open, but payment p has nothing left to give.
      txError([...base, allocate(inst(1), mine)]),
      // Salon rule only: a payment of another salon, with capacity, against this salon's open installment.
      txError([...base, spare(SALON_X, "TRX-0006"), allocate(inst(1), spareOf(SALON_X))]),
    ]);
    expect(messages).toEqual([
      expect.stringContaining("an allocation would pay an installment more than it is owed"),
      expect.stringContaining("allocations would exceed the payment"),
      expect.stringContaining("a payment can settle only its own salon's installments"),
    ]);
  });

  it("writes audit rows for every new table and the hash chain still verifies", async () => {
    const rows = await tx([
      ...standard(),
      repPay(id(), UNIT),
      [
        "postgres",
        `select t.table_name, (select count(*)::int from control.audit_event e where e.table_name = 'public.' || t.table_name) n,
                (select ok from control.verify_audit_chain()) ok
         from (values ('installment'), ('payment'), ('payment_allocation'), ('receipt'), ('cash_ledger_entry')) t(table_name)`,
      ],
    ]);
    expect(rows).toHaveLength(TABLES.length);
    expect(rows.map((r) => [r.table_name, Number(r.n) > 0, r.ok])).toEqual(TABLES.map((t) => [t, true, true]));
  });
});

describe("reads and the receipt document (PAY-04, CTL-01, doc 09 section 4)", () => {
  it("a rep sees its own payments and cash position; another rep sees none of them", async () => {
    const p = id();
    const mine = await tx([
      ...standard(),
      repPay(p, ONE_AND_HALF),
      [
        "repA",
        `select (select count(*)::int from public.payment) payments, (select count(*)::int from public.receipt) receipts,
                (select balance_paisa from app.my_cash_position()) cash`,
      ],
    ]);
    expect([mine[0].payments, mine[0].receipts, Number(mine[0].cash)]).toEqual([1, 1, ONE_AND_HALF]);
    const other = await tx([
      ...standard(),
      repPay(p, ONE_AND_HALF),
      [
        "repB",
        `select (select count(*)::int from public.payment) payments, (select count(*)::int from public.cash_ledger_entry) ledger,
                (select balance_paisa from app.my_cash_position()) cash`,
      ],
    ]);
    expect({ ...other[0], cash: Number(other[0].cash) }).toEqual({ payments: 0, ledger: 0, cash: 0 });
  });

  it("a caller without access is refused with 42501, never answered with a zero that looks real", async () => {
    const [dues, balance, peekByRep, peekAal1, ownCashManager, ownCashWrongDevice, anon] = await Promise.all([
      sqlstate(REP_B, "select * from app.salon_installments($1)", [SALON]),
      sqlstate(REP_B, "select * from app.salon_balance($1)", [SALON]),
      sqlstate(REP_B, "select * from app.office_rep_cash_position($1)", [fx.repA.id]),
      sqlstate(MANAGER_AAL1, "select * from app.office_rep_cash_position($1)", [fx.repA.id]),
      sqlstate(MANAGER, "select * from app.my_cash_position()"),
      sqlstate(REP_A_WRONG_DEVICE, "select * from app.my_cash_position()"),
      sqlstate("anon", "select * from app.salon_balance($1)", [SALON]),
    ]);
    expect([dues, balance, peekByRep, peekAal1, ownCashManager, ownCashWrongDevice, anon]).toEqual(
      [dues, balance, peekByRep, peekAal1, ownCashManager, ownCashWrongDevice, anon].map(() => "42501"),
    );
    // The office asking about something that does not exist is told so (22023), and a genuine zero is still a zero.
    const unknown = await Promise.all([
      sqlstate(MANAGER, "select * from app.salon_balance($1)", [id()]),
      sqlstate(MANAGER, "select * from app.salon_installments($1)", [id()]),
      sqlstate(MANAGER, "select * from app.office_rep_cash_position($1)", [id()]),
    ]);
    expect(unknown).toEqual(unknown.map(() => "22023"));
    const zero = await run(REP_A, "select balance_paisa::text b, overdue_paisa::text o from app.salon_balance($1)", [SALON_X]);
    expect(zero.rows[0]).toEqual({ b: "0", o: "0" });
  });

  it("a rep on a wrong device or suspended is refused by salon_installments and salon_balance and gets nothing from receipt_document", async () => {
    const p = id();
    const base: Step[] = [
      ...standard(),
      repPay(p, UNIT),
      [
        "postgres",
        `select set_config('payments.test_receipt', (select r.id::text from public.receipt r join public.payment q on q.id = r.payment_id where q.client_id = '${p}'), true);`,
      ],
    ];
    const suspend: Step = ["owner", `select app.owner_set_status('${fx.repA.id}', 'suspended', 'payments denial test');`];
    const reads = (who: P): Step[] => [[who, `select * from app.salon_installments('${SALON}');`]];
    const balance = (who: P): Step[] => [[who, `select * from app.salon_balance('${SALON}');`]];
    const doc = (who: P): Step[] => [[who, "select app.receipt_document(current_setting('payments.test_receipt')::uuid) as doc"]];
    const messages = await Promise.all([
      txError([...base, ...reads("repAWrongDevice")]),
      txError([...base, ...balance("repAWrongDevice")]),
      txError([...base, suspend, ...reads("repA")]),
      txError([...base, suspend, ...balance("repA")]),
    ]);
    expect(messages.map((m) => m ?? "")).toEqual(
      messages.map(() => expect.stringContaining("no access to this salon's account")),
    );
    const [wrongDevice, suspended, control] = await Promise.all([
      tx([...base, ...doc("repAWrongDevice")]),
      tx([...base, suspend, ...doc("repA")]),
      tx([...base, ...doc("repA")]),
    ]);
    expect([wrongDevice[0]?.doc, suspended[0]?.doc]).toEqual([null, null]);
    expect((control[0]?.doc as Doc | null)?.number).toMatch(RECEIPT_NO);
  });

  it("the office reads any rep's cash position and any salon's dues", async () => {
    const rows = await tx([
      ...standard(),
      repPay(id(), ONE_AND_HALF),
      [
        "manager",
        `select (select balance_paisa from app.office_rep_cash_position('${fx.repA.id}')) cash,
                (select count(*)::int from app.salon_installments('${SALON}')) dues`,
      ],
    ]);
    expect([Number(rows[0].cash), rows[0].dues]).toEqual([ONE_AND_HALF, INST_COUNT - 1]);
  });

  const docAs = async (who: P, first: string): Promise<Doc | null> => {
    const second = id();
    const rows = await tx([
      ...standard(),
      repPay(first, ONE_AND_HALF),
      repPay(second, UNIT),
      [
        who,
        `select app.receipt_document((select r.id from public.receipt r join public.payment q on q.id = r.payment_id where q.client_id = '${first}')) as doc`,
      ],
    ]);
    return rows[0].doc as Doc | null;
  };

  it("the receipt document shows the number, the allocation and the schedule as of that payment, and no phone", async () => {
    const doc = await docAs("repA", id());
    expect(doc?.number).toMatch(RECEIPT_NO);
    expect(doc?.payment.amount_paisa).toBe(ONE_AND_HALF);
    expect(doc?.allocations.map((a) => [a.seq, a.amount_paisa])).toEqual([
      [1, UNIT],
      [SECOND, HALF_UNIT],
    ]);
    // As of the first payment: installment 2 has half left, 3 and 4 are untouched; the second payment is not counted.
    expect(doc?.remaining.map((r) => [r.seq, r.remaining_paisa])).toEqual([
      [SECOND, HALF_UNIT],
      [THIRD, UNIT],
      [FOURTH, UNIT],
    ]);
    expect(doc?.notices[0].code).toBe("only_valid_proof");
    expect(JSON.stringify(doc)).not.toMatch(PHONE_LIKE);
  });

  it("the remaining schedule leaves out an invoice issued after the receipt", async () => {
    const first = id();
    const rows = await tx([
      ...standard(),
      repPay(first, ONE_AND_HALF),
      // Invoice and receipt times are taken under the salon lock (clock_timestamp), so a second invoice
      // issued later in the same transaction is later than the receipt.
      ...standard(),
      [
        "manager",
        `select app.receipt_document((select r.id from public.receipt r join public.payment q on q.id = r.payment_id where q.client_id = '${first}')) as doc,
                (select count(*)::int from public.installment i where i.salon_id = '${SALON}') installments`,
      ],
    ]);
    const doc = rows[0].doc as Doc;
    expect(rows[0].installments).toBe(INST_COUNT * INVOICES_ISSUED);
    const firstInvoice = doc.allocations[0]?.invoice_number;
    expect(doc.remaining).toHaveLength(INST_COUNT - 1);
    expect(doc.remaining.every((r) => r.invoice_number === firstInvoice)).toBe(true);
  });

  it("the manager reads the receipt too; another rep gets nothing", async () => {
    expect((await docAs("manager", id()))?.number).toMatch(RECEIPT_NO);
    expect(await docAs("repB", id())).toBeNull();
  });
});

describe("replay, server time and concurrency of a payment's client_id (H-08, H-09)", () => {
  const CLIENT_TIME = "2020-01-01T00:00:00Z";
  const NULL_BANK = ", null, null"; // p_bank_name, p_bank_reference
  const withTime = `${NULL_BANK}, false, '${CLIENT_TIME}'`;
  const HOLD_SECONDS = 3;
  const MIN_WAIT_MS = 1000;
  const POLL_MS = 100;
  const POLL_TRIES = 100;
  const GATE_MAX_S = 60; // the paused-delivery test cancels the gate holder long before this
  const FIRST_HISTORIC_DAY = 30;
  const LAST_HISTORIC_DAY = 20000;
  const DELIVERY_DELAY_S = 1.5;
  const PAYMENT_START_MS = 500;
  const PAYMENT_HOLD_S = 2.5;
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const waitFor = async (check: () => Promise<boolean>, tries = POLL_TRIES): Promise<boolean> =>
    (await check()) ? true : tries === 0 ? false : sleep(POLL_MS).then(() => waitFor(check, tries - 1));

  it("an exact replay returns the same receipt, also when the bank text differs only in surrounding spaces", async () => {
    const p = id();
    const rows = await tx([
      ...standard(),
      repPay(p, UNIT, ", ' Dummy Bank ', ' TRX-0007 '", GPS_NEAR, SALON, "bank_transfer"),
      repPay(p, UNIT, ", 'Dummy Bank', 'TRX-0007'", GPS_NEAR, SALON, "bank_transfer"),
      repPay(p, UNIT, ", 'Dummy Bank', 'TRX-0007'", "24.9000001, 67.1", SALON, "bank_transfer"),
      [
        "postgres",
        `select (select count(*)::int from public.payment where client_id = '${p}') payments, (select count(*)::int from public.receipt r join public.payment q on q.id = r.payment_id where q.client_id = '${p}') receipts`,
      ],
    ]);
    expect(rows[0]).toEqual({ payments: 1, receipts: 1 });
  });

  it("an exact replay that carries the mock flag and the phone's time is accepted", async () => {
    const p = id();
    const extra = `${NULL_BANK}, true, '${CLIENT_TIME}'`;
    const rows = await tx([
      ...standard(),
      repPay(p, UNIT, extra),
      repPay(p, UNIT, extra),
      ["postgres", `select count(*)::int n from public.payment where client_id = '${p}'`],
    ]);
    expect(rows[0].n).toBe(1);
  });

  // One first call carries a value in every persisted field; each replay below changes exactly one of
  // them (method and the bank fields change together because the table ties them: cash has no bank).
  const FIRST = {
    salon: SALON,
    method: "bank_transfer",
    amount: UNIT,
    lat: "24.9",
    lng: "67.1",
    bank: "'Dummy Bank'",
    ref: "'TRX-0011'",
    mock: "false",
    time: `'${CLIENT_TIME}'`,
  };
  const callWith = (who: P, cid: string, over: Partial<typeof FIRST> = {}): Step => {
    const a = { ...FIRST, ...over };
    return [
      who,
      `select app.rep_record_payment('${cid}', '${a.salon}', '${a.method}', ${a.amount}, ${a.lat}, ${a.lng}, ${a.bank}, ${a.ref}, ${a.mock}, ${a.time});`,
    ];
  };

  it("an exact replay of a call with every field set returns the same receipt", async () => {
    const p = id();
    const rows = await tx([
      ...standard(),
      callWith("repA", p),
      callWith("repA", p),
      [
        "postgres",
        `select (select count(*)::int from public.payment where client_id = '${p}') payments, (select count(*)::int from public.receipt r join public.payment q on q.id = r.payment_id where q.client_id = '${p}') receipts`,
      ],
    ]);
    expect(rows[0]).toEqual({ payments: 1, receipts: 1 });
  });

  it.each([
    ["salon_id", { salon: SALON_X }, "repA"],
    ["method (with its bank fields)", { method: "cash", bank: "null", ref: "null" }, "repA"],
    ["bank name", { bank: "'Other Bank'" }, "repA"],
    ["bank reference", { ref: "'TRX-0012'" }, "repA"],
    ["amount", { amount: HALF_UNIT }, "repA"],
    ["lat", { lat: "24.9001" }, "repA"],
    ["lng", { lng: "67.1001" }, "repA"],
    ["mock-location flag", { mock: "true" }, "repA"],
    ["phone time", { time: "'2021-01-01T00:00:00Z'" }, "repA"],
    ["actor", {}, "repB"],
  ] as Array<[string, Partial<typeof FIRST>, P]>)("refuses a replay whose %s alone changed", async (_name, over, who) => {
    const p = id();
    const message = await txError([...standard(), callWith("repA", p), callWith(who, p, over)]);
    expect(message).toContain("client_id already used with different content");
  });

  const officeCall = (who: P, cid: string, over: { amount?: number; bank?: string; ref?: string } = {}): Step => [
    who,
    `select app.office_record_payment('${cid}', '${SALON}', ${over.amount ?? UNIT}, '${over.bank ?? "Dummy Bank"}', '${over.ref ?? "TRX-0014"}');`,
  ];

  it.each([
    ["amount", "manager", { amount: HALF_UNIT }],
    ["bank name", "manager", { bank: "Other Bank" }],
    ["bank reference", "manager", { ref: "TRX-0015" }],
    ["actor", "owner", {}],
  ] as Array<
    [string, P, { amount?: number; bank?: string; ref?: string }]
  >)("refuses an office replay whose %s alone changed", async (_name, who, over) => {
    const p = id();
    const message = await txError([...standard(), officeCall("manager", p), officeCall(who, p, over)]);
    expect(message).toContain("client_id already used with different content");
  });

  it("an exact office replay returns the same receipt", async () => {
    const p = id();
    const rows = await tx([
      ...standard(),
      officeCall("manager", p),
      officeCall("manager", p),
      ["postgres", `select count(*)::int n from public.payment where client_id = '${p}'`],
    ]);
    expect(rows[0]?.n).toBe(1);
  });

  it("refuses a replay by another rep, and a payment without a client_id", async () => {
    const p = id();
    const other = await txError([
      ...standard(),
      repPay(p, UNIT),
      ["repB", `select app.rep_record_payment('${p}', '${SALON}', 'cash', ${UNIT}, ${GPS_NEAR});`],
    ]);
    expect(other).toContain("client_id already used with different content");
    const nullKey = (who: P, call: string): Step => [who, `select ${call};`];
    expect(
      await txError([...standard(), nullKey("repA", `app.rep_record_payment(null, '${SALON}', 'cash', ${UNIT}, ${GPS_NEAR})`)]),
    ).toContain("needs a client_id");
    expect(
      await txError([
        ...standard(),
        nullKey("manager", `app.office_record_payment(null, '${SALON}', ${UNIT}, 'Dummy Bank', 'TRX-0009')`),
      ]),
    ).toContain("needs a client_id");
  });

  it("the phone's time is kept as evidence only: recorded_at is the database's time", async () => {
    const p = id();
    const rows = await tx([
      ...standard(),
      repPay(p, UNIT, withTime),
      [
        "postgres",
        `select recorded_at > now() - interval '1 minute' and recorded_at <= clock_timestamp() as server_time,
                recorded_at_client = timestamptz '${CLIENT_TIME}' as client_kept
         from public.payment where client_id = '${p}'`,
      ],
    ]);
    expect(rows[0]).toEqual({ server_time: true, client_kept: true });
  });

  // Advisory lock keys are 64-bit: classid is the high half, objid the low half.
  const advisoryHeld = async (key: string) =>
    Number(
      (
        await run(
          "postgres",
          `select count(*)::int n from pg_locks where locktype = 'advisory' and granted and objsubid = 1
             and classid = (((${key}) >> 32) & 4294967295)::oid and objid = ((${key}) & 4294967295)::oid`,
        )
      ).rows[0].n,
    ) > 0;
  const record = (cid: string, salon: string) =>
    `select app.record_payment('${cid}', '${salon}', 'cash', ${HALF_UNIT}, null, null, null, null, false, null, null)`;

  it("a second session with the same client_id waits for the first one before it looks anything up", async () => {
    const cid = id();
    const holder = observed(
      run("postgres", script([...standard(), repPay(cid, UNIT), ["postgres", `select pg_sleep(${HOLD_SECONDS})`]])),
    );
    try {
      expect(await waitFor(() => advisoryHeld(`hashtextextended('payment-client:${cid}', 0)`))).toBe(true);
      const started = Date.now();
      const message = await errorOf("postgres", record(cid, id()));
      const waited = Date.now() - started;
      expect(message).toContain("unknown salon");
      expect(waited).toBeGreaterThan(MIN_WAIT_MS);
    } finally {
      await holder.catch(() => undefined);
    }
  });

  it("a payment for a salon waits for the per-salon allocation lock, whatever its client_id (H-10)", async () => {
    const key = `hashtextextended('payment:${SALON}', 0)`;
    // The holder takes the salon's lock and keeps its transaction open for a few seconds.
    const holder = observed(run("postgres", `select pg_advisory_xact_lock(${key}); select pg_sleep(${HOLD_SECONDS});`));
    try {
      expect(await waitFor(() => advisoryHeld(key))).toBe(true);
      const started = Date.now();
      // Valid input for an existing salon with a fresh client_id: it passes every check up to the salon lock.
      const message = await errorOf("postgres", record(id(), SALON));
      const waited = Date.now() - started;
      expect(message).toContain("owes nothing");
      expect(waited).toBeGreaterThan(MIN_WAIT_MS);
    } finally {
      await holder.catch(() => undefined);
    }
  });

  // Committed set-up for a salon of its own: a closed historic rep day (a free Karachi day, so a rerun on the
  // same database finds one), a confirmed order and an office delivery. Two sessions cannot see each other's
  // uncommitted rows, so the concurrency tests cannot run inside a rolled-back transaction.
  const seedOrder = async (salon: string) => {
    const day = (
      await one(
        "postgres",
        `select (app.karachi_today() - n)::text d from generate_series(${FIRST_HISTORIC_DAY}, ${LAST_HISTORIC_DAY}) n
          where not exists (select 1 from public.rep_day r where r.rep_id = $1 and r.day = app.karachi_today() - n)
          order by n limit 1`,
        [fx.repA.id],
      )
    )?.d as string;
    const [rd, ord] = [id(), id()];
    await one(
      "postgres",
      "insert into public.rep_day (id, rep_id, day, status, check_out_at, closed_by) values ($1, $2, $3::date, 'closed', now(), $2)",
      [rd, fx.repA.id, day],
    );
    await one(
      "postgres",
      `insert into public.sales_order (id, client_id, salon_id, rep_id, rep_day_id, plan, delivery_mode, status, subtotal_paisa, total_paisa, confirmed_at)
       values ($1, gen_random_uuid(), $2, $3, $4, 'INST4', 'warehouse', 'confirmed', ${FOUR_UNITS}, ${FOUR_UNITS}, now())`,
      [ord, salon, fx.repA.id, rd],
    );
    await one(
      "postgres",
      `insert into public.sales_order_line (order_id, line_no, sku_id, qty, list_price_paisa, unit_price_paisa, line_total_paisa)
       values ($1, 1, $2, ${INST4_QTY}, ${UNIT}, ${UNIT}, ${FOUR_UNITS})`,
      [ord, SKU1],
    );
    return ord;
  };
  const newSalon = async () => {
    const salon = id();
    await one({ as: "repA" }, "select app.create_salon($1, $2, 'ladies_parlor', $3, 'map_pin', null, 24.9, 67.1)", [
      salon,
      `[Test] Payment salon C ${tag()}`,
      AREA_A,
    ]);
    await approveSalon(salon); // D-35 (slice 7): the office approves a rep's proposal before any order
    return salon;
  };
  const deliverOffice = (ord: string) =>
    one(MANAGER, "select (app.office_deliver($1, $2, $3, 'Ayesha at the counter')).number", [id(), ord, WH]);

  it("two concurrent payments with different client_ids cannot allocate more than the salon owes", async () => {
    const salonC = await newSalon();
    await deliverOffice(await seedOrder(salonC));
    const pay = (ref: string) =>
      run(
        MANAGER,
        "select (app.office_record_payment($1, $2, $3, 'Dummy Bank', $4)).number",
        [id(), salonC, THREE_UNITS, ref],
        C,
      );
    const results = await Promise.allSettled([pay("TRX-C1"), pay("TRX-C2")]);
    const refused = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(refused).toHaveLength(1);
    expect(String(refused[0]?.reason)).toContain("more than the salon owes");
    const after = await run(
      MANAGER,
      `select (select coalesce(sum(a.amount_paisa), 0)::text from public.payment_allocation a join public.installment i on i.id = a.installment_id where i.salon_id = $1) allocated,
              (select balance_paisa::text from app.salon_balance($1)) balance`,
      [salonC],
    );
    expect(after.rows[0]).toEqual({ allocated: String(THREE_UNITS), balance: String(UNIT) });
  });

  it("an invoice that waits for a payment's salon lock is issued after that payment's receipt, and the receipt's schedule is what the allocation saw", async () => {
    const salonD = await newSalon();
    await deliverOffice(await seedOrder(salonD)); // invoice 1, committed
    const second = await seedOrder(salonD);
    // This shows the order of the issue times (invoice after receipt). The lock order that keeps delivery and payment
    // from deadlocking is proved by the test with the paused delivery, not by this one.
    // Session B's transaction starts first and delivers the second order after a pause: its transaction start
    // is earlier than the payment's, which is what a now()-based issue time would compare.
    const deliverLater = observed(
      run(
        MANAGER,
        `select pg_sleep(${DELIVERY_DELAY_S}); select (app.office_deliver('${id()}', '${second}', '${WH}', 'Ayesha at the counter')).number;`,
        [],
        C,
      ),
    );
    await sleep(PAYMENT_START_MS);
    // Session A pays invoice 1 and keeps its transaction (and the salon lock) open for a while before it commits.
    const payment = observed(
      run(
        MANAGER,
        `select (app.office_record_payment('${id()}', '${salonD}', ${UNIT}, 'Dummy Bank', 'TRX-D1')).number as number; select pg_sleep(${PAYMENT_HOLD_S});`,
        [],
        C,
      ),
    );
    const [invoice2, paid] = await Promise.all([deliverLater, payment]);
    const receiptNumber = String((paid as unknown as Array<{ rows: Array<{ number: string }> }>)[0]?.rows[0]?.number);
    const invoice2Number = String((invoice2 as unknown as Array<{ rows: Array<{ number: string }> }>).at(-1)?.rows[0]?.number);
    const after = await run(
      MANAGER,
      `select app.receipt_document(r.id) doc,
              (select count(*)::int from public.installment i where i.salon_id = $1) installments,
              (select v.issued_at > r.issued_at from public.invoice v where v.number = $3) later
         from public.receipt r where r.number = $2`,
      [salonD, receiptNumber, invoice2Number],
    );
    const row = after.rows[0] as { doc: Doc; installments: number; later: boolean };
    expect(row.later).toBe(true);
    expect(row.installments).toBe(INST_COUNT * INVOICES_ISSUED);
    expect(row.doc.remaining).toHaveLength(INST_COUNT - 1);
    expect(row.doc.remaining.some((r) => r.invoice_number === invoice2Number)).toBe(false);
  });

  // The state of an advisory lock, as Postgres reports it: how many sessions hold it, how many wait for it.
  // Advisory lock keys are 64-bit; classid is the high half, objid the low half.
  const lockState = async (key: string) => {
    const r = (
      await run(
        "postgres",
        `select count(*) filter (where granted)::int held, count(*) filter (where not granted)::int waiting from pg_locks
          where locktype = 'advisory' and objsubid = 1
            and classid = (((${key}) >> 32) & 4294967295)::oid and objid = ((${key}) & 4294967295)::oid`,
      )
    ).rows[0] as { held: number; waiting: number };
    return { held: Number(r.held), waiting: Number(r.waiting) };
  };

  it("a delivery stopped just after its audited write does not deadlock with a payment for the same salon (lock order)", async () => {
    const salonE = await newSalon();
    await deliverOffice(await seedOrder(salonE)); // invoice 1, committed: the salon owes something
    const second = await seedOrder(salonE);
    const salonKey = `hashtextextended('payment:${salonE}', 0)`;
    const gateKey = `hashtextextended('kiran-test-gate:${second}', 0)`;
    // Test-only trigger: after the audit trigger has written (and so holds the audit chain head), the delivery of
    // the one order named in this session's setting stops on a gate lock that the test holds and then releases.
    await run(
      "postgres",
      `create function control.zz_test_pause_delivery() returns trigger language plpgsql set search_path = '' as $$
       begin
         if new.order_id::text = coalesce(current_setting('kiran.test_pause_order', true), '') then
           perform pg_advisory_xact_lock(hashtextextended('kiran-test-gate:' || new.order_id::text, 0));
         end if;
         return new;
       end $$;
       create trigger zz_test_pause_delivery after insert on public.delivery
         for each row execute function control.zz_test_pause_delivery();`,
      [],
      C,
    );
    const release = async () => {
      await run(
        "postgres",
        `select pg_cancel_backend(l.pid) from pg_locks l where l.locktype = 'advisory' and l.objsubid = 1 and l.granted
           and l.classid = (((${gateKey}) >> 32) & 4294967295)::oid and l.objid = ((${gateKey}) & 4294967295)::oid`,
      );
    };
    let controller: Promise<unknown> = Promise.resolve();
    let delivery: Promise<unknown> = Promise.resolve();
    let payment: Promise<unknown> = Promise.resolve();
    const seen = {
      triggerOrder: false,
      gateHeld: false,
      deliveryPaused: false,
      paymentWaitsForSalon: false,
      salonHeldByDelivery: 0,
    };
    try {
      const names = (
        await run(
          "postgres",
          "select tgname from pg_trigger where tgrelid = 'public.delivery'::regclass and not tgisinternal and (tgtype & 1) = 1 order by tgname",
        )
      ).rows.map((r) => String(r.tgname));
      seen.triggerOrder = names.indexOf("audit") >= 0 && names.indexOf("audit") < names.indexOf("zz_test_pause_delivery");
      // 1. The test holds the gate.
      controller = observed(run("postgres", `select pg_advisory_xact_lock(${gateKey}); select pg_sleep(${GATE_MAX_S});`));
      seen.gateHeld = await waitFor(async () => (await lockState(gateKey)).held === 1);
      // 2. The delivery runs until the pause trigger waits on the gate: it has written its audited row.
      delivery = observed(
        run(
          MANAGER,
          `select set_config('kiran.test_pause_order', '${second}', true); select (app.office_deliver('${id()}', '${second}', '${WH}', 'Ayesha at the counter')).number;`,
          [],
          C,
        ),
      );
      seen.deliveryPaused = await waitFor(async () => (await lockState(gateKey)).waiting === 1);
      // 3. A payment for the same salon starts. With the fixed lock order the delivery already holds the salon lock,
      //    so the payment waits for it before it writes anything audited.
      payment = observed(
        run(
          MANAGER,
          `select (app.office_record_payment('${id()}', '${salonE}', ${UNIT}, 'Dummy Bank', 'TRX-E1')).number;`,
          [],
          C,
        ),
      );
      seen.paymentWaitsForSalon = await waitFor(async () => (await lockState(salonKey)).waiting === 1);
      seen.salonHeldByDelivery = (await lockState(salonKey)).held;
    } finally {
      // 4. Release the gate whatever happened, then let both sessions finish or fail.
      await release();
      await controller.catch(() => undefined);
    }
    const [deliveryResult, paymentResult] = await Promise.allSettled([delivery, payment]);
    try {
      expect(seen).toEqual({
        triggerOrder: true,
        gateHeld: true,
        deliveryPaused: true,
        paymentWaitsForSalon: true,
        salonHeldByDelivery: 1,
      });
      expect(deliveryResult.status).toBe("fulfilled");
      expect(paymentResult.status).toBe("fulfilled");
      // The payment waited for the delivery, so its allocation saw invoice 2 and its receipt is later than that invoice.
      const after = await run(
        MANAGER,
        `select app.receipt_document(r.id) doc,
                (select v.issued_at < r.issued_at from public.invoice v join public.delivery d on d.id = v.delivery_id where d.order_id = $2) later
           from public.receipt r where r.salon_id = $1`,
        [salonE, second],
      );
      const row = after.rows[0] as { doc: Doc; later: boolean };
      expect(row.later).toBe(true);
      expect(row.doc.remaining).toHaveLength(INST_COUNT * INVOICES_ISSUED - 1);
    } finally {
      await run(
        "postgres",
        "drop trigger if exists zz_test_pause_delivery on public.delivery; drop function if exists control.zz_test_pause_delivery();",
        [],
        C,
      );
    }
  });

  it("recorded_at is the time of the insert, taken after the wait for the salon lock (H-09)", async () => {
    const salon = await newSalon();
    await deliverOffice(await seedOrder(salon));
    const key = `hashtextextended('payment:${salon}', 0)`;
    const holder = observed(run("postgres", `select pg_advisory_xact_lock(${key}); select pg_sleep(${HOLD_SECONDS});`));
    let before: Date | undefined;
    let recorded: Date | undefined;
    try {
      expect(await waitFor(async () => (await lockState(key)).held === 1)).toBe(true);
      before = (await run("postgres", "select clock_timestamp() as t")).rows[0]?.t as Date;
      const paid = await run(
        MANAGER,
        "select (app.office_record_payment($1, $2, $3, 'Dummy Bank', 'TRX-G1')).number as number",
        [id(), salon, UNIT],
        C,
      );
      const number = String(paid.rows[0]?.number);
      recorded = (
        await run(
          "postgres",
          "select p.recorded_at from public.payment p join public.receipt r on r.payment_id = p.id where r.number = $1",
          [number],
        )
      ).rows[0]?.recorded_at as Date;
    } finally {
      await holder.catch(() => undefined);
    }
    expect((recorded?.getTime() ?? 0) - (before?.getTime() ?? 0)).toBeGreaterThan(MIN_WAIT_MS);
  });

  it("two committed calls with the same client_id: the second waits, then returns the same receipt, and there is one payment", async () => {
    const salon = await newSalon();
    await deliverOffice(await seedOrder(salon));
    const cid = id();
    const call = `select (app.office_record_payment('${cid}', '${salon}', ${UNIT}, 'Dummy Bank', 'TRX-F1')).number as number;`;
    const first = observed(run(MANAGER, `${call} select pg_sleep(${HOLD_SECONDS});`, [], C));
    let secondNumber = "";
    let waited = 0;
    try {
      expect(await waitFor(async () => (await lockState(`hashtextextended('payment-client:${cid}', 0)`)).held === 1)).toBe(true);
      const started = Date.now();
      secondNumber = String((await run(MANAGER, call, [], C)).rows[0]?.number);
      waited = Date.now() - started;
    } finally {
      await first.catch(() => undefined);
    }
    const firstNumber = String(((await first) as unknown as Array<{ rows: Array<{ number: string }> }>)[0]?.rows[0]?.number);
    const payments = await run("postgres", "select count(*)::int n from public.payment where client_id = $1", [cid]);
    expect([secondNumber, payments.rows[0]?.n]).toEqual([firstNumber, 1]);
    expect(waited).toBeGreaterThan(MIN_WAIT_MS);
  });
});

describe("the invoice document reads the stored installments (PAY-01, ORD-05)", () => {
  interface Sched {
    no: number;
    of: number;
    due_on: string;
    pct: number;
    amount_paisa: number;
  }
  interface InvoiceDoc {
    schedule: Sched[];
    receipts: Array<{ number: string; amount_paisa: number }>;
  }
  const invoiceDoc = `app.invoice_document((select v.id from public.invoice v where v.salon_id = '${SALON}' order by v.issued_at desc limit 1))`;

  it("a later change to the plan template changes neither the printed schedule nor what the allocation uses", async () => {
    const rows = await tx([
      ...standard(),
      ["repA", `select set_config('payments.test_doc', ${invoiceDoc}::text, true);`],
      [
        "postgres",
        `update public.app_config set value = jsonb_set(value, '{2,schedule}', '[{"pct": 100, "day_offset": 5}]'::jsonb) where key = 'plan.templates';`,
      ],
      ["repA", `select current_setting('payments.test_doc')::jsonb as before_edit, ${invoiceDoc} as after_edit`],
    ]);
    // The printed schedule is unchanged by the edit and still shows the four stored installments of 25% each.
    const { before_edit: before, after_edit: after } = rows[0] as { before_edit: InvoiceDoc; after_edit: InvoiceDoc };
    expect(after.schedule).toEqual(before.schedule);
    expect(after.schedule.map((s) => [s.no, s.of, s.pct, s.amount_paisa])).toEqual(
      DUE_DAYS.map((_, n) => [n + 1, INST_COUNT, PCT_QUARTER, UNIT]),
    );
  });

  it("the stored schedule is what the document prints, and a paid invoice lists its receipts", async () => {
    const p = id();
    const rows = await tx([
      ...standard(),
      repPay(p, ONE_AND_HALF),
      [
        "repA",
        `select ${invoiceDoc} as doc, (select r.number from public.receipt r join public.payment q on q.id = r.payment_id where q.client_id = '${p}') number`,
      ],
    ]);
    const doc = rows[0].doc as InvoiceDoc;
    expect(doc.receipts).toHaveLength(1);
    expect([doc.receipts[0]?.number, doc.receipts[0]?.amount_paisa]).toEqual([rows[0].number, ONE_AND_HALF]);
    expect(doc.schedule).toHaveLength(INST_COUNT);
  });

  it("an invalid plan template stops the delivery that would issue the invoice (nothing is half issued)", async () => {
    const message = await txError([
      [
        "postgres",
        `update public.app_config set value = jsonb_set(value, '{2,schedule,0,pct}', '90') where key = 'plan.templates';`,
      ],
      ...standard(),
    ]);
    expect(message).toContain("do not add up to 100");
  });
});

describe("who sees the five new tables, with rows in every one of them (H-13)", () => {
  const COUNTS = `select
    (select count(*)::int from public.installment where salon_id = '${SALON}') installment,
    (select count(*)::int from public.payment_allocation a join public.installment i on i.id = a.installment_id where i.salon_id = '${SALON}') allocation,
    (select count(*)::int from public.payment where salon_id = '${SALON}') payment,
    (select count(*)::int from public.receipt where salon_id = '${SALON}') receipt,
    (select count(*)::int from public.cash_ledger_entry e join public.payment q on q.id = e.source_id where e.source_type = 'payment' and q.salon_id = '${SALON}') ledger`;
  const NONE = { installment: 0, allocation: 0, payment: 0, receipt: 0, ledger: 0 };
  const ALL = { installment: 1, allocation: 1, payment: 1, receipt: 1, ledger: 1 };
  const OWN = { installment: 0, allocation: 0, payment: 1, receipt: 1, ledger: 1 };
  const suspendRepA: Step = ["owner", `select app.owner_set_status('${fx.repA.id}', 'suspended', 'visibility test');`];
  // A CASH order of two units, paid in cash in one payment: one installment, one allocation, one payment,
  // one receipt, one cash ledger row.
  const seen = (reader: Step[]) => tx([...delivered(CASH_ORDER_QTY, "CASH"), repPay(id(), TWO_UNITS), ...reader]);
  const as = (who: P): Step[] => [[who, COUNTS]];

  it("the table owner sees one row in each (the set-up is real)", async () => {
    const rows = await tx([...delivered(CASH_ORDER_QTY, "CASH"), repPay(id(), TWO_UNITS), ["postgres", COUNTS]]);
    expect(rows[0]).toEqual(ALL);
  });

  it.each([
    ["repA on its approved device", [] as Step[], as("repA"), OWN],
    ["repA on a device that is not approved", [], as("repAWrongDevice"), NONE],
    ["repA while suspended", [suspendRepA], as("repA"), NONE],
    ["repB (another territory)", [], as("repB"), NONE],
    ["the manager without MFA (AAL1)", [], as("managerAal1"), NONE],
    ["the manager with MFA (AAL2)", [], as("manager"), ALL],
    ["the owner", [], as("owner"), ALL],
  ] as Array<[string, Step[], Step[], Record<string, number>]>)("%s sees %j", async (_name, before, read, expected) => {
    const rows = await seen([...before, ...read]);
    expect(rows[0]).toEqual(expected);
  });
});

describe("upgrade path and sequence (H-08, H-13)", () => {
  it("the backfill gives an invoice made without installments its schedule, and the postcondition notices the gap", async () => {
    const withoutTrigger = (...after: Step[]): Step[] => [
      // Test-only, inside a rolled-back transaction: an invoice as it would exist before this migration.
      ["postgres", "alter table public.invoice disable trigger invoice_installments;"],
      ...standard(),
      ["postgres", "alter table public.invoice enable trigger invoice_installments;"],
      ...after,
    ];
    expect(await txError(withoutTrigger(["postgres", "select control.check_installments();"]))).toContain("no installments");
    const rows = await tx(
      withoutTrigger(
        ["postgres", "select control.backfill_installments() as filled;"],
        [
          "postgres",
          `select control.check_installments();
         select control.backfill_installments() as again, (select count(*)::int from public.installment where salon_id = '${SALON}') installments,
                (select sum(amount_due_paisa)::text from public.installment where salon_id = '${SALON}') total`,
        ],
      ),
    );
    expect(rows[0]).toEqual({ again: 0, installments: INST_COUNT, total: String(FOUR_UNITS) });
  });

  it("the postcondition also notices installments that do not add up to the invoice", async () => {
    const message = await txError([
      ["postgres", "alter table public.invoice disable trigger invoice_installments;"],
      ...standard(),
      [
        "postgres",
        `insert into public.installment (invoice_id, salon_id, seq, of_count, pct_of_total, due_on, amount_due_paisa)
          select v.id, v.salon_id, 1, 1, 100, ${TODAY}, v.total_paisa - 1 from public.invoice v where v.salon_id = '${SALON}';`,
      ],
      ["postgres", "alter table public.invoice enable trigger invoice_installments;"],
      ["postgres", "select control.check_installments();"],
    ]);
    expect(message).toContain("do not add up");
  });

  it("the sequence behind payment.seq is closed to every application role, and the definer functions still insert", async () => {
    const privileges = await run(
      "postgres",
      `select r, p, has_sequence_privilege(r, s, p) h
         from (select pg_get_serial_sequence('public.payment', 'seq') s) q,
              unnest(array['anon', 'authenticated', 'service_role']) r, unnest(array['USAGE', 'SELECT', 'UPDATE']) p`,
    );
    expect(privileges.rows).toHaveLength(PRIVILEGE_CHECKS);
    expect(privileges.rows.every((r) => r.h === false)).toBe(true);
    const acl = String(
      (
        await run(
          "postgres",
          "select coalesce(c.relacl::text, '') acl from pg_class c where c.oid = pg_get_serial_sequence('public.payment', 'seq')::regclass",
        )
      ).rows[0]?.acl,
    );
    expect(
      acl
        .replace("{", "")
        .split(",")
        .some((entry) => entry.startsWith("=")),
    ).toBe(false);
    expect(await sqlstate(REP_A, "select nextval(pg_get_serial_sequence('public.payment', 'seq')::regclass)")).toBe("42501");
    // A payment recorded through the function still gets its seq.
    const rows = await tx([
      ...standard(),
      repPay(id(), UNIT),
      ["postgres", "select count(*)::int n from public.payment where seq is not null"],
    ]);
    expect(Number(rows[0]?.n)).toBeGreaterThan(0);
  });
});
