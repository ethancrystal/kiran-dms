/**
 * Basic investor ledger (migration 20261105120000, completion slice 3, P1-20; CAP-01 to CAP-03, D-40).
 * Office only (owner or manager at AAL2): investors, append-only investments, profit decisions typed by
 * the office, payouts of profit or principal, and reversals with a reason. Every total is derived from
 * the rows, never stored; nothing is calculated, and nothing is posted to cash, receivables or sales.
 *
 * Isolation: almost every test runs in one rolled-back transaction. The two-session tests need rows
 * that both sessions can see, so beforeAll commits one investor with one investment and one decision,
 * and afterAll deletes exactly those rows again (the append-only triggers are switched off for that one
 * committed clean-up transaction only, and switched back on in it), so no committed ledger row is left
 * for later test files.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { errorOf, fx, run, sqlstate } from "./helpers/db";
import { asLogin, type Login, quote, tag, uuid } from "./helpers/invite";

const C = { commit: true };
const DENIED = "42501";
const BAD_INPUT = "22023";
const WRONG_STATE = "55000";
const DUPLICATE = "23505";
const OVER_LIMIT = "23514";

// Amounts in paisa (Rs 1 = 100 paisa).
const RS = 100;
const ONE_PAISA = 1;
const MAX_PAISA = 99_999_999_999; // the largest amount lib/money.ts toPaisa can produce
const PHONE = "+920000001234"; // synthetic (H-03)

// Days before today (Karachi); a negative number is in the future.
const TODAY_N = 0;
const YESTERDAY = 1;
const TOMORROW = -1;
const LONG_AGO = 10;
const EARLIER = 5;
const RECENT = 4;
const LATER = 3;
const TWO_DAYS = 2;
const BOTH = 2;
const TEN_IDS = 10;

// The hand-worked scenario (rupees as the page takes them; Rs 100,000 = 10,000,000 paisa).
// Investor X: two investments, a decision and two payouts on the first, two decisions on the second
// (one reversed) and a payout. Investor Y: one investment, a principal payout reversed, a second
// investment reversed.
const X1 = 10_000_000; // Rs 100,000
const X2 = 5_000_000; // Rs 50,000
const X1_PROFIT = 1_200_000; // Rs 12,000
const X1_PAID = 500_000; // Rs 5,000
const X1_RETURNED = 2_000_000; // Rs 20,000
const X2_PROFIT_WRONG = 300_000; // Rs 3,000
const X2_PROFIT = 250_000; // Rs 2,500
const Y1 = 2_000_000; // Rs 20,000
const Y1_RETURN_WRONG = 1_000_000; // Rs 10,000
const Y2_WRONG = 700_000; // Rs 7,000
const D_X1 = 30;
const D_X2 = 20;
const D_X1_PROFIT = 10;
const D_X1_PAID = 5;
const D_X1_RETURNED = 3;
const D_X2_PROFIT_WRONG = 2;
const D_X2_PROFIT = 1;
const D_Y1 = 15;
const D_Y1_RETURN = 14;
const D_Y2 = 12;
const X_INVESTED = X1 + X2;
const X_DECIDED = X1_PROFIT + X2_PROFIT;
const X_PAID = X1_PAID + X2_PROFIT;

// A small investment for the refusal tests.
const SMALL = 1_000_000; // Rs 10,000
const SMALL_DECIDED = 100_000; // Rs 1,000
const SMALL_PAID = 60_000; // Rs 600
const SMALL_OWED = SMALL_DECIDED - SMALL_PAID;
const TINY = 100_000; // Rs 1,000
const TINY_PROFIT = 10_000; // Rs 100

type K = "owner" | "manager" | "ownerAal1" | "managerAal1" | "repA" | "repB" | "repAWrongDevice" | "suspended";
const PERSONA: Record<K, { key: keyof typeof fx; aal: "aal1" | "aal2"; device?: string }> = {
  owner: { key: "owner", aal: "aal2" },
  manager: { key: "manager", aal: "aal2" },
  ownerAal1: { key: "owner", aal: "aal1" },
  managerAal1: { key: "manager", aal: "aal1" },
  repA: { key: "repA", aal: "aal1" },
  repB: { key: "repB", aal: "aal1" },
  repAWrongDevice: { key: "repA", aal: "aal1", device: "dev-not-approved-0000" },
  suspended: { key: "suspendedRep", aal: "aal1" },
};
const as = (k: K) => {
  const p = PERSONA[k];
  const claims = JSON.stringify({ sub: fx[p.key].id, role: "authenticated", aal: p.aal });
  const headers = JSON.stringify({ "x-kiran-device": p.device ?? fx[p.key].device });
  return `reset role;
  select set_config('request.jwt.claims', '${claims}', true), set_config('request.headers', '${headers}', true);
  set local role authenticated;`;
};
type Step = [K | "postgres", string];
type Rows = Array<Record<string, unknown>>;
type Multi = Array<{ rows: Rows }>;
const script = (steps: Step[]) => steps.map(([k, sql]) => `${k === "postgres" ? "reset role;" : as(k)}\n${sql};`).join("\n");
const results = async (steps: Step[]) => (await run("postgres", script(steps))) as unknown as Multi;
/** Runs the steps in one rolled-back transaction and returns the rows of the last statement. */
const last = async (steps: Step[]) => (await results(steps)).at(-1)?.rows ?? [];
const codeOf = (steps: Step[]) => sqlstate("postgres", script(steps));
const messageOf = (steps: Step[]) => errorOf("postgres", script(steps));
/** The result sets of a script that carry a given column, in order. */
const withColumn = async (steps: Step[], column: string) =>
  (await results(steps)).filter((r) => Array.isArray(r.rows) && r.rows.length > 0 && column in r.rows[0]).map((r) => r.rows);

const TODAY = "(now() at time zone 'Asia/Karachi')::date";
const ago = (n: number) => (n === TODAY_N ? TODAY : `(${TODAY} - ${n})`);
const investorOf = (c: string) => `(select x.id from public.investor x where x.client_id = '${c}')`;
const investmentOf = (c: string) => `(select x.id from public.investment x where x.client_id = '${c}')`;
const decisionOf = (c: string) => `(select x.id from public.investor_profit_decision x where x.client_id = '${c}')`;
const payoutOf = (c: string) => `(select x.id from public.investor_payout x where x.client_id = '${c}')`;

// Function calls (expressions); a step selects them.
const createCall = (c: string, name = "[Dummy] Investor", phone: string | null = null, note: string | null = null) =>
  `app.office_create_investor('${c}', ${quote(name)}, ${quote(phone)}, ${quote(note)})`;
const investCall = (c: string, investor: string, paisa: number, days = TODAY_N, note: string | null = null) =>
  `app.office_add_investment('${c}', ${investor}, ${paisa}, ${ago(days)}, ${quote(note)})`;
const decideCall = (c: string, investment: string, paisa: number, days = TODAY_N) =>
  `app.office_decide_profit('${c}', ${investment}, ${paisa}, ${ago(days)}, null)`;
const payCall = (
  c: string,
  investment: string,
  kind: string,
  paisa: number,
  days = TODAY_N,
  method = "cash",
  ref: string | null = null,
) => `app.office_record_payout('${c}', ${investment}, '${kind}', '${method}', ${paisa}, ${ago(days)}, ${quote(ref)}, null)`;
const reverseCall = (c: string, kind: string, entry: string, reason = "[Dummy] entered in error") =>
  `app.office_reverse_investor_entry('${c}', '${kind}', ${entry}, ${quote(reason)})`;
const updateCall = (investor: string, name: string, phone: string | null, note: string | null, status: string) =>
  `app.office_update_investor(${investor}, ${quote(name)}, ${quote(phone)}, ${quote(note)}, '${status}')`;
const sel = (call: string) => `select ${call}`;
const create = (...a: Parameters<typeof createCall>) => sel(createCall(...a));
const invest = (...a: Parameters<typeof investCall>) => sel(investCall(...a));
const decide = (...a: Parameters<typeof decideCall>) => sel(decideCall(...a));
const pay = (...a: Parameters<typeof payCall>) => sel(payCall(...a));
const reverse = (...a: Parameters<typeof reverseCall>) => sel(reverseCall(...a));
const update = (...a: Parameters<typeof updateCall>) => sel(updateCall(...a));

const FIGURES = `invested_paisa::text invested, principal_returned_paisa::text returned, principal_outstanding_paisa::text outstanding,
  profit_decided_paisa::text decided, profit_paid_paisa::text paid, profit_owed_paisa::text owed`;
const figures = (invested: number, returned: number, decided: number, paid: number) => ({
  invested: String(invested),
  returned: String(returned),
  outstanding: String(invested - returned),
  decided: String(decided),
  paid: String(paid),
  owed: String(decided - paid),
});
const investorRow = (c: string) =>
  `select ${FIGURES}, status::text from app.office_investors() where investor_id = ${investorOf(c)}`;

// One committed investor for the two-session tests (see the note at the top), and for the refusals,
// which need real ids that a refused persona cannot see.
const Z = { investor: uuid(), investment: uuid(), decision: uuid() };
const Z_INVESTED = 100_000_000; // Rs 1,000,000
const Z_DECIDED = 6_000_000; // Rs 60,000
const Z_HALF_PLUS = 4_000_000; // Rs 40,000: two payouts of this exceed what was decided, one does not
let zInvestor = "";
let zInvestment = "";
let zDecision = "";

beforeAll(async () => {
  const rows = (await run(
    "postgres",
    script([
      ["manager", create(Z.investor, `[Dummy] Investor Z ${tag()}`, PHONE)],
      ["manager", invest(Z.investment, investorOf(Z.investor), Z_INVESTED, LONG_AGO)],
      ["manager", decide(Z.decision, investmentOf(Z.investment), Z_DECIDED, EARLIER)],
      [
        "postgres",
        `select ${investorOf(Z.investor)}::text investor, ${investmentOf(Z.investment)}::text investment, ${decisionOf(Z.decision)}::text decision`,
      ],
    ]),
    [],
    C,
  )) as unknown as Multi;
  const ids = rows.at(-1)?.rows[0] as { investor: string; investment: string; decision: string };
  [zInvestor, zInvestment, zDecision] = [ids.investor, ids.investment, ids.decision];
});

afterAll(async () => {
  // One committed transaction: if any statement fails, the trigger switches roll back with it.
  const tables = ["public.investor_payout", "public.investor_profit_decision", "public.investment", "public.investor"];
  const ofZ = `(select id from public.investment where investor_id = '${zInvestor}')`;
  await run(
    "postgres",
    `${tables.map((t) => `alter table ${t} disable trigger user;`).join("\n")}
     delete from public.investor_payout where investment_id in ${ofZ};
     delete from public.investor_profit_decision where investment_id in ${ofZ};
     delete from public.investment where investor_id = '${zInvestor}' and reverses_id is not null;
     delete from public.investment where investor_id = '${zInvestor}';
     delete from public.investor where id = '${zInvestor}';
     ${tables.map((t) => `alter table ${t} enable trigger user;`).join("\n")}`,
    [],
    C,
  );
  const left = await run(
    "postgres",
    `select (select count(*) from public.investor where id = '${zInvestor}')::int investors,
            (select count(*) from public.investment where investor_id = '${zInvestor}')::int investments,
            (select count(*) from pg_trigger t where t.tgrelid = any (array[${tables.map((t) => `'${t}'::regclass`).join(", ")}])
               and not t.tgisinternal and t.tgenabled = 'D')::int disabled`,
  );
  expect(left.rows[0]).toEqual({ investors: 0, investments: 0, disabled: 0 });
});

describe("the office records investors and their money (CAP-01, CAP-02)", () => {
  it.each([
    ["manager"],
    ["owner"],
  ] as const)("%s adds an investor, an investment, a profit decision and payouts; the figures are derived from the rows", async (who) => {
    const [i, m, d, p1, p2] = [uuid(), uuid(), uuid(), uuid(), uuid()];
    const rows = await last([
      [who, create(i, "[Dummy] Investor One", PHONE, "[Dummy] met at the office")],
      [who, invest(m, investorOf(i), X1, D_X1, "[Dummy] first money")],
      [who, decide(d, investmentOf(m), X1_PROFIT, D_X1_PROFIT)],
      [who, pay(p1, investmentOf(m), "profit", X1_PAID, D_X1_PAID)],
      [who, pay(p2, investmentOf(m), "principal", X1_RETURNED, D_X1_RETURNED, "bank", "[Dummy] TRX-0001")],
      [who, investorRow(i)],
    ]);
    expect(rows[0]).toEqual({ ...figures(X1, X1_RETURNED, X1_PROFIT, X1_PAID), status: "active" });
    expect(rows[0].owed).toBe(String(X1_PROFIT - X1_PAID));
  });

  it("the investor row keeps the name, phone and note as typed, trimmed, and who created it", async () => {
    const i = uuid();
    const rows = await last([
      ["manager", create(i, "  [Dummy] Investor Trim  ", ` ${PHONE} `, "  [Dummy] note  ")],
      ["postgres", `select full_name, phone, note, status::text, created_by::text from public.investor where client_id = '${i}'`],
    ]);
    expect(rows[0]).toEqual({
      full_name: "[Dummy] Investor Trim",
      phone: PHONE,
      note: "[Dummy] note",
      status: "active",
      created_by: fx.manager.id,
    });
  });

  it("an investor with no money yet reads all zeros", async () => {
    const i = uuid();
    const rows = await last([
      ["manager", create(i)],
      ["manager", investorRow(i)],
    ]);
    expect(rows[0]).toEqual({ ...figures(0, 0, 0, 0), status: "active" });
  });

  it("hand-worked totals across several investments, two investors and reversals; the totals row moves by exactly their sum", async () => {
    const [x, y, x1, x2, y1, y2] = [uuid(), uuid(), uuid(), uuid(), uuid(), uuid()];
    const [dx1, dx2a, dx2b, rx2a, px1, rx1, px2, py1, ry1, ry2] = Array.from({ length: TEN_IDS }, () => uuid());
    const totals = `select ${FIGURES} from app.office_investors() where is_total`;
    const sets = await withColumn(
      [
        ["manager", totals],
        ["manager", create(x, "[Dummy] Investor X")],
        ["manager", create(y, "[Dummy] Investor Y")],
        ["manager", invest(x1, investorOf(x), X1, D_X1)],
        ["manager", invest(x2, investorOf(x), X2, D_X2)],
        ["manager", decide(dx1, investmentOf(x1), X1_PROFIT, D_X1_PROFIT)],
        ["manager", pay(px1, investmentOf(x1), "profit", X1_PAID, D_X1_PAID)],
        ["manager", pay(rx1, investmentOf(x1), "principal", X1_RETURNED, D_X1_RETURNED)],
        ["owner", decide(dx2a, investmentOf(x2), X2_PROFIT_WRONG, D_X2_PROFIT_WRONG)],
        ["owner", decide(dx2b, investmentOf(x2), X2_PROFIT, D_X2_PROFIT)],
        ["manager", reverse(rx2a, "profit_decision", decisionOf(dx2a))],
        ["manager", pay(px2, investmentOf(x2), "profit", X2_PROFIT, TODAY_N)],
        ["manager", invest(y1, investorOf(y), Y1, D_Y1)],
        ["manager", pay(py1, investmentOf(y1), "principal", Y1_RETURN_WRONG, D_Y1_RETURN)],
        ["manager", reverse(ry1, "payout", payoutOf(py1))],
        ["owner", invest(y2, investorOf(y), Y2_WRONG, D_Y2)],
        ["owner", reverse(ry2, "investment", investmentOf(y2))],
        ["manager", investorRow(x)],
        ["manager", investorRow(y)],
        ["manager", `select ${FIGURES}, reversed from app.office_investor_investments(${investorOf(x)}) order by invested_on`],
        ["manager", `select ${FIGURES}, reversed from app.office_investor_investments(${investorOf(y)}) order by invested_on`],
        ["manager", totals],
      ],
      "invested",
    );
    const [before, xRow, yRow, xInvestments, yInvestments, after] = sets;
    expect(xRow[0]).toEqual({ ...figures(X_INVESTED, X1_RETURNED, X_DECIDED, X_PAID), status: "active" });
    expect(yRow[0]).toEqual({ ...figures(Y1, 0, 0, 0), status: "active" });
    expect(xInvestments).toEqual([
      { ...figures(X1, X1_RETURNED, X1_PROFIT, X1_PAID), reversed: false },
      { ...figures(X2, 0, X2_PROFIT, X2_PROFIT), reversed: false },
    ]);
    expect(yInvestments).toEqual([
      { ...figures(Y1, 0, 0, 0), reversed: false },
      { ...figures(0, 0, 0, 0), reversed: true },
    ]);
    const delta = (k: string) => String(BigInt(after[0][k] as string) - BigInt(before[0][k] as string));
    expect(Object.fromEntries(Object.keys(after[0]).map((k) => [k, delta(k)]))).toEqual(
      figures(X_INVESTED + Y1, X1_RETURNED, X_DECIDED, X_PAID),
    );
  });

  it("the totals row is the one row marked total, and equals the sum of every investor row", async () => {
    const [i, m] = [uuid(), uuid()];
    const sums = `sum(invested_paisa)::bigint, sum(principal_returned_paisa)::bigint, sum(principal_outstanding_paisa)::bigint,
                  sum(profit_decided_paisa)::bigint, sum(profit_paid_paisa)::bigint, sum(profit_owed_paisa)::bigint`;
    const rows = await last([
      ["manager", create(i)],
      ["manager", invest(m, investorOf(i), SMALL, YESTERDAY)],
      [
        "manager",
        `select (select row(invested_paisa, principal_returned_paisa, principal_outstanding_paisa, profit_decided_paisa,
                            profit_paid_paisa, profit_owed_paisa) from app.office_investors() where is_total)
                = (select row(${sums}) from app.office_investors() where not is_total) same,
                (select count(*) from app.office_investors() where is_total)::int totals,
                (select bool_and(investor_id is null and full_name is null) from app.office_investors() where is_total) unnamed`,
      ],
    ]);
    expect(rows[0]).toEqual({ same: true, totals: 1, unnamed: true });
  });
});

describe("the statement: entries in date order with derived running balances", () => {
  const [x, x1, x2, dx1, px1, rx1, dx2a, dx2b, rev, px2] = Array.from({ length: TEN_IDS }, () => uuid());
  const steps: Step[] = [
    ["manager", create(x, "[Dummy] Investor Statement")],
    ["manager", invest(x1, investorOf(x), X1, D_X1)],
    ["manager", invest(x2, investorOf(x), X2, D_X2)],
    ["manager", decide(dx1, investmentOf(x1), X1_PROFIT, D_X1_PROFIT)],
    ["manager", pay(px1, investmentOf(x1), "profit", X1_PAID, D_X1_PAID)],
    ["manager", pay(rx1, investmentOf(x1), "principal", X1_RETURNED, D_X1_RETURNED)],
    ["manager", decide(dx2a, investmentOf(x2), X2_PROFIT_WRONG, D_X2_PROFIT_WRONG)],
    ["manager", decide(dx2b, investmentOf(x2), X2_PROFIT, D_X2_PROFIT)],
    ["manager", reverse(rev, "profit_decision", decisionOf(dx2a))],
    ["manager", pay(px2, investmentOf(x2), "profit", X2_PROFIT, TODAY_N)],
  ];
  const statement = (from: string, to: string) =>
    `select entry_kind, payout_kind::text, amount_paisa::text amount, (${TODAY} - entry_on) days_ago,
            principal_outstanding_paisa::text principal, profit_owed_paisa::text owed, reversed, reverses_id is not null is_reversal
     from app.office_investor_statement(${investorOf(x)}, ${from}, ${to})`;
  type Entry = [kind: string, payoutKind: string | null, amount: number, daysAgo: number, principal: number, owed: number];
  const e = ([kind, payoutKind, amount, daysAgo, principal, owed]: Entry, flags = {}) => ({
    entry_kind: kind,
    payout_kind: payoutKind,
    amount: String(amount),
    days_ago: daysAgo,
    principal: String(principal),
    owed: String(owed),
    reversed: false,
    is_reversal: false,
    ...flags,
  });
  // Running balances, worked by hand from the steps above.
  const AFTER_RETURN = X_INVESTED - X1_RETURNED;
  const OWED_1 = X1_PROFIT;
  const OWED_2 = OWED_1 - X1_PAID;
  const OWED_3 = OWED_2 + X2_PROFIT_WRONG;
  const OWED_4 = OWED_3 + X2_PROFIT;
  const OWED_5 = OWED_4 - X2_PROFIT_WRONG;
  const OWED_6 = OWED_5 - X2_PROFIT;
  const ROWS = {
    x1: e(["investment", null, X1, D_X1, X1, 0]),
    x2: e(["investment", null, X2, D_X2, X_INVESTED, 0]),
    dx1: e(["profit_decision", null, X1_PROFIT, D_X1_PROFIT, X_INVESTED, OWED_1]),
    px1: e(["payout", "profit", X1_PAID, D_X1_PAID, X_INVESTED, OWED_2]),
    rx1: e(["payout", "principal", X1_RETURNED, D_X1_RETURNED, AFTER_RETURN, OWED_2]),
    dx2a: e(["profit_decision", null, X2_PROFIT_WRONG, D_X2_PROFIT_WRONG, AFTER_RETURN, OWED_3], { reversed: true }),
    dx2b: e(["profit_decision", null, X2_PROFIT, D_X2_PROFIT, AFTER_RETURN, OWED_4]),
    rev: e(["profit_decision", null, -X2_PROFIT_WRONG, TODAY_N, AFTER_RETURN, OWED_5], { is_reversal: true }),
    px2: e(["payout", "profit", X2_PROFIT, TODAY_N, AFTER_RETURN, OWED_6]),
  };

  it("the whole history, oldest first; a reversal is its own row dated today and the reversed row is marked", async () => {
    const rows = await last([...steps, ["manager", statement("null", "null")]]);
    expect(rows).toEqual(Object.values(ROWS));
    expect(OWED_6).toBe(X_DECIDED - X_PAID);
  });

  it("a date range keeps the running balances of the whole history", async () => {
    const rows = await last([...steps, ["manager", statement(ago(D_X1_PAID), ago(D_X2_PROFIT_WRONG))]]);
    expect(rows).toEqual([ROWS.px1, ROWS.rx1, ROWS.dx2a]);
    const open = await last([...steps, ["manager", statement(ago(D_X1_PROFIT - 1), "null")]]);
    expect(open).toEqual([ROWS.px1, ROWS.rx1, ROWS.dx2a, ROWS.dx2b, ROWS.rev, ROWS.px2]);
    const upTo = await last([...steps, ["manager", statement("null", ago(D_X2))]]);
    expect(upTo).toEqual([ROWS.x1, ROWS.x2]);
  });

  it("a range that ends before it starts, and an unknown investor, are refused (22023)", async () => {
    expect(await codeOf([...steps, ["manager", statement(ago(YESTERDAY), ago(TWO_DAYS))]])).toBe(BAD_INPUT);
    expect(await codeOf([["manager", `select * from app.office_investor_statement('${uuid()}', null, null)`]])).toBe(BAD_INPUT);
    expect(await codeOf([["manager", `select * from app.office_investor_investments('${uuid()}')`]])).toBe(BAD_INPUT);
  });
});

describe("refusals: what the database does not accept", () => {
  it("bad input is 22023 with the database's words", async () => {
    const [i, m] = [uuid(), uuid()];
    const base: Step[] = [
      ["manager", create(i)],
      ["manager", invest(m, investorOf(i), SMALL, LONG_AGO)],
    ];
    const before = LONG_AGO + 1;
    const cases: Array<[string, string, string]> = [
      ["no name", create(uuid(), " "), "a name of 2 to 120 characters"],
      ["a bad phone", create(uuid(), "[Dummy] Investor", "12-34"), "phone"],
      ["no client_id", sel("app.office_create_investor(null, '[Dummy] Investor', null, null)"), "client_id"],
      ["a zero amount", invest(uuid(), investorOf(i), 0, YESTERDAY), "amount"],
      ["a negative amount", invest(uuid(), investorOf(i), -RS, YESTERDAY), "amount"],
      ["an amount above the cap", invest(uuid(), investorOf(i), MAX_PAISA + 1, YESTERDAY), "amount"],
      ["a date in the future", invest(uuid(), investorOf(i), RS, TOMORROW), "future"],
      ["no date", sel(`app.office_add_investment('${uuid()}', ${investorOf(i)}, ${RS}, null, null)`), "date"],
      ["an unknown investor", invest(uuid(), `'${uuid()}'`, RS, YESTERDAY), "unknown investor"],
      ["an unknown investment", decide(uuid(), `'${uuid()}'`, RS, YESTERDAY), "unknown investment"],
      ["a decision before the investment", decide(uuid(), investmentOf(m), RS, before), "before the investment"],
      ["a payout before the investment", pay(uuid(), investmentOf(m), "principal", RS, before), "before the investment"],
      [
        "a payout kind that is not profit or principal",
        pay(uuid(), investmentOf(m), "bonus", RS, YESTERDAY),
        "profit or principal",
      ],
      [
        "a method that is not cash, bank or other",
        pay(uuid(), investmentOf(m), "principal", RS, YESTERDAY, "cheque"),
        "cash, bank or other",
      ],
      ["a bank payout with no reference", pay(uuid(), investmentOf(m), "principal", RS, YESTERDAY, "bank"), "reference"],
      ["an unknown entry kind", reverse(uuid(), "loan", investmentOf(m)), "investment, profit_decision or payout"],
      ["an unknown entry", reverse(uuid(), "payout", `'${uuid()}'`), "unknown"],
      ["a short reversal reason", reverse(uuid(), "investment", investmentOf(m), "oops"), "reason of 5 to 300 characters"],
      ["an unknown investor to update", update(`'${uuid()}'`, "[Dummy] X", null, null, "active"), "unknown investor"],
      ["a status that is not active or closed", update(investorOf(i), "[Dummy] X", null, null, "paused"), "active or closed"],
    ];
    await Promise.all(
      cases.map(async ([name, sql, words]) => {
        const steps: Step[] = [...base, ["manager", sql]];
        expect(await codeOf(steps), name).toBe(BAD_INPUT);
        expect(await messageOf(steps), name).toContain(words);
      }),
    );
  });

  it("a profit payout beyond decided minus paid, and a principal return beyond invested minus returned, are refused (23514)", async () => {
    const [i, m, d, p, other] = [uuid(), uuid(), uuid(), uuid(), uuid()];
    const base: Step[] = [
      ["manager", create(i)],
      ["manager", invest(m, investorOf(i), SMALL, LONG_AGO)],
      ["manager", decide(d, investmentOf(m), SMALL_DECIDED, EARLIER)],
      ["manager", pay(p, investmentOf(m), "profit", SMALL_PAID, RECENT)],
    ];
    const overProfit: Step[] = [...base, ["manager", pay(uuid(), investmentOf(m), "profit", SMALL_OWED + ONE_PAISA, YESTERDAY)]];
    const overPrincipal: Step[] = [...base, ["manager", pay(uuid(), investmentOf(m), "principal", SMALL + ONE_PAISA, YESTERDAY)]];
    expect(await codeOf(overProfit)).toBe(OVER_LIMIT);
    expect(await messageOf(overProfit)).toContain("more than the profit owed");
    expect(await codeOf([...base, ["manager", pay(uuid(), investmentOf(m), "profit", SMALL_OWED, YESTERDAY)]])).toBeNull();
    expect(await codeOf(overPrincipal)).toBe(OVER_LIMIT);
    expect(await messageOf(overPrincipal)).toContain("more than the principal outstanding");
    expect(await codeOf([...base, ["manager", pay(uuid(), investmentOf(m), "principal", SMALL, YESTERDAY)]])).toBeNull();
    // Profit is per investment: another investment's decision does not pay this one.
    expect(
      await codeOf([
        ...base,
        ["manager", invest(other, investorOf(i), SMALL, LATER)],
        ["manager", decide(uuid(), investmentOf(other), SMALL, TWO_DAYS)],
        ["manager", pay(uuid(), investmentOf(m), "profit", SMALL_OWED + ONE_PAISA, YESTERDAY)],
      ]),
    ).toBe(OVER_LIMIT);
  });

  it("a refused call writes nothing, not even an audit row (no partial writes)", async () => {
    const counts = `select (select count(*) from public.investor_payout)::int payouts,
                           (select count(*) from public.investor_profit_decision)::int decisions,
                           (select count(*) from public.investment)::int investments,
                           (select count(*) from control.audit_event)::int audit`;
    const before = (await run("postgres", counts)).rows[0];
    const attempts = [
      pay(uuid(), `'${zInvestment}'`, "profit", Z_DECIDED + ONE_PAISA, YESTERDAY),
      pay(uuid(), `'${zInvestment}'`, "principal", Z_INVESTED + ONE_PAISA, YESTERDAY),
      reverse(uuid(), "investment", `'${zInvestment}'`),
      decide(uuid(), `'${zInvestment}'`, RS, TOMORROW),
    ];
    await Promise.all(attempts.map((sql) => expect(run("postgres", script([["manager", sql]]), [], C)).rejects.toThrow()));
    expect((await run("postgres", counts)).rows[0]).toEqual(before);
  });
});

describe("replay (H-08): one client_id, one effect", () => {
  it("an investor: the same call returns the same row; other facts are 23505; another person's same key makes their own row", async () => {
    const i = uuid();
    const same = create(i, "[Dummy] Investor R", PHONE);
    const rows = await last([
      ["manager", same],
      ["manager", same],
      ["owner", same],
      [
        "postgres",
        `select count(*)::int n, count(distinct created_by)::int creators from public.investor where client_id = '${i}'`,
      ],
    ]);
    expect(rows[0]).toEqual({ n: BOTH, creators: BOTH });
    expect(
      await codeOf([
        ["manager", same],
        ["manager", create(i, "[Dummy] Investor S", PHONE)],
      ]),
    ).toBe(DUPLICATE);
    // The owner's replay of the same key returns the owner's own row, never the manager's.
    const own = await last([
      ["manager", same],
      ["owner", same],
      ["owner", `select (${createCall(i, "[Dummy] Investor R", PHONE)}).created_by::text who`],
    ]);
    expect(own[0]).toEqual({ who: fx.owner.id });
  });

  it("an investment, a decision, a payout and a reversal: replays return the first row, different facts are 23505", async () => {
    const [i, m, d, p, r] = [uuid(), uuid(), uuid(), uuid(), uuid()];
    const base: Step[] = [
      ["manager", create(i)],
      ["manager", invest(m, investorOf(i), SMALL, LONG_AGO)],
      ["manager", decide(d, investmentOf(m), SMALL_DECIDED, EARLIER)],
      ["manager", pay(p, investmentOf(m), "profit", SMALL_PAID, RECENT)],
      ["manager", reverse(r, "payout", payoutOf(p), "[Dummy] wrong amount")],
    ];
    const rows = await last([
      ...base,
      ...base.slice(1),
      [
        "postgres",
        `select (select count(*) from public.investment where investor_id = ${investorOf(i)})::int investments,
                (select count(*) from public.investor_profit_decision where investment_id = ${investmentOf(m)})::int decisions,
                (select count(*) from public.investor_payout where investment_id = ${investmentOf(m)})::int payouts`,
      ],
    ]);
    expect(rows[0]).toEqual({ investments: 1, decisions: 1, payouts: BOTH });
    const different: Array<[string, Step]> = [
      ["investment amount", ["manager", invest(m, investorOf(i), SMALL + ONE_PAISA, LONG_AGO)]],
      ["investment date", ["manager", invest(m, investorOf(i), SMALL, LONG_AGO - 1)]],
      ["decision amount", ["manager", decide(d, investmentOf(m), SMALL_DECIDED + ONE_PAISA, EARLIER)]],
      ["payout kind", ["manager", pay(p, investmentOf(m), "principal", SMALL_PAID, RECENT)]],
      ["payout method", ["manager", pay(p, investmentOf(m), "profit", SMALL_PAID, RECENT, "other")]],
      ["reversal reason", ["manager", reverse(r, "payout", payoutOf(p), "[Dummy] another reason")]],
      ["someone else's key", ["owner", decide(d, investmentOf(m), SMALL_DECIDED, EARLIER)]],
    ];
    await Promise.all(different.map(async ([name, step]) => expect(await codeOf([...base, step]), name).toBe(DUPLICATE)));
  });

  it("a replay is checked before the state: after the investor is settled and closed, a lost-answer retry still returns the first payout", async () => {
    const [i, m, d, p] = [uuid(), uuid(), uuid(), uuid()];
    const rows = await last([
      ["manager", create(i, "[Dummy] Investor C")],
      ["manager", invest(m, investorOf(i), TINY, LONG_AGO)],
      ["manager", decide(d, investmentOf(m), TINY_PROFIT, EARLIER)],
      ["manager", pay(p, investmentOf(m), "profit", TINY_PROFIT, RECENT)],
      ["manager", pay(uuid(), investmentOf(m), "principal", TINY, LATER)],
      ["manager", update(investorOf(i), "[Dummy] Investor C", null, null, "closed")],
      ["manager", `select (${payCall(p, investmentOf(m), "profit", TINY_PROFIT, RECENT)}).id = ${payoutOf(p)} same`],
    ]);
    expect(rows[0]).toEqual({ same: true });
  });
});

describe("reversals: a reason, once, never of a reversal, never below zero", () => {
  const [i, m, d, p] = [uuid(), uuid(), uuid(), uuid()];
  const base: Step[] = [
    ["manager", create(i)],
    ["manager", invest(m, investorOf(i), SMALL, LONG_AGO)],
    ["manager", decide(d, investmentOf(m), SMALL_DECIDED, EARLIER)],
    ["manager", pay(p, investmentOf(m), "profit", SMALL_PAID, RECENT)],
  ];

  it("a reversal row: the exact negative, the same parent, the reason, dated by the server, recorded by the session", async () => {
    const r = uuid();
    const rows = await last([
      ...base,
      ["owner", reverse(r, "payout", payoutOf(p), "  [Dummy] paid twice  ")],
      [
        "postgres",
        `select amount_paisa::text amount, investment_id = ${investmentOf(m)} same_parent, kind::text, method::text, reason,
                paid_on = ${TODAY} today, reverses_id = ${payoutOf(p)} reverses, recorded_by::text
         from public.investor_payout where client_id = '${r}'`,
      ],
    ]);
    expect(rows[0]).toEqual({
      amount: String(-SMALL_PAID),
      same_parent: true,
      kind: "profit",
      method: "cash",
      reason: "[Dummy] paid twice",
      today: true,
      reverses: true,
      recorded_by: fx.owner.id,
    });
  });

  it("an entry is reversed once; a reversal is never reversed (55000)", async () => {
    const r = uuid();
    const once: Step[] = [...base, ["manager", reverse(r, "payout", payoutOf(p))]];
    const twice: Step[] = [...once, ["manager", reverse(uuid(), "payout", payoutOf(p))]];
    const ofReversal: Step[] = [...once, ["manager", reverse(uuid(), "payout", payoutOf(r))]];
    expect(await codeOf(twice)).toBe(WRONG_STATE);
    expect(await messageOf(twice)).toContain("already reversed");
    expect(await codeOf(ofReversal)).toBe(WRONG_STATE);
    expect(await messageOf(ofReversal)).toContain("a reversal cannot be reversed");
  });

  it("the kind must match the entry: a payout id named as a decision is unknown (22023)", async () => {
    expect(await codeOf([...base, ["manager", reverse(uuid(), "profit_decision", payoutOf(p))]])).toBe(BAD_INPUT);
  });

  it("a decision is not reversed below what was paid on it; an investment is not reversed while money moved on it (23514)", async () => {
    const decisionBack: Step[] = [...base, ["manager", reverse(uuid(), "profit_decision", decisionOf(d))]];
    expect(await codeOf(decisionBack)).toBe(OVER_LIMIT);
    expect(await messageOf(decisionBack)).toContain("below what was paid");
    expect(await codeOf([...base, ["manager", reverse(uuid(), "investment", investmentOf(m))]])).toBe(OVER_LIMIT);
    // Once the payout and the decision are reversed, the investment can be.
    expect(
      await codeOf([
        ...base,
        ["manager", reverse(uuid(), "payout", payoutOf(p))],
        ["manager", reverse(uuid(), "profit_decision", decisionOf(d))],
        ["manager", reverse(uuid(), "investment", investmentOf(m))],
      ]),
    ).toBeNull();
    // A principal return also holds the investment.
    const [q, n] = [uuid(), uuid()];
    expect(
      await codeOf([
        ["manager", create(q)],
        ["manager", invest(n, investorOf(q), TINY, TWO_DAYS)],
        ["manager", pay(uuid(), investmentOf(n), "principal", ONE_PAISA, YESTERDAY)],
        ["manager", reverse(uuid(), "investment", investmentOf(n))],
      ]),
    ).toBe(OVER_LIMIT);
  });

  it("nothing new on a reversed investment (55000)", async () => {
    const [q, n] = [uuid(), uuid()];
    const reversed: Step[] = [
      ["manager", create(q)],
      ["manager", invest(n, investorOf(q), TINY, TWO_DAYS)],
      ["manager", reverse(uuid(), "investment", investmentOf(n))],
    ];
    expect(await codeOf([...reversed, ["manager", decide(uuid(), investmentOf(n), ONE_PAISA, YESTERDAY)]])).toBe(WRONG_STATE);
    expect(await codeOf([...reversed, ["manager", pay(uuid(), investmentOf(n), "principal", ONE_PAISA, YESTERDAY)]])).toBe(
      WRONG_STATE,
    );
  });
});

describe("closing an investor", () => {
  const [i, m, d] = [uuid(), uuid(), uuid()];
  const NAME = "[Dummy] Investor Close";
  const open: Step[] = [
    ["manager", create(i, NAME, PHONE, "[Dummy] note")],
    ["manager", invest(m, investorOf(i), TINY, LONG_AGO)],
    ["manager", decide(d, investmentOf(m), TINY_PROFIT, EARLIER)],
  ];
  const settled: Step[] = [
    ...open,
    ["manager", pay(uuid(), investmentOf(m), "profit", TINY_PROFIT, RECENT)],
    ["manager", pay(uuid(), investmentOf(m), "principal", TINY, LATER)],
  ];
  const close: Step = ["manager", update(investorOf(i), NAME, PHONE, "[Dummy] note", "closed")];

  it("closing needs nothing outstanding: principal and profit owed both zero (55000)", async () => {
    expect(await codeOf([...open, close])).toBe(WRONG_STATE);
    expect(await messageOf([...open, close])).toContain("still has");
    expect(await codeOf([...open, ["manager", pay(uuid(), investmentOf(m), "profit", TINY_PROFIT, RECENT)], close])).toBe(
      WRONG_STATE,
    );
    const rows = await last([...settled, close, ["manager", investorRow(i)]]);
    expect(rows[0]).toEqual({ ...figures(TINY, TINY, TINY_PROFIT, TINY_PROFIT), status: "closed" });
  });

  it("a closed investor takes no new money, decision, payout or reversal (55000), and can be reopened", async () => {
    const closed: Step[] = [...settled, close];
    const refused = [
      invest(uuid(), investorOf(i), RS, YESTERDAY),
      decide(uuid(), investmentOf(m), RS, YESTERDAY),
      pay(uuid(), investmentOf(m), "profit", ONE_PAISA, YESTERDAY),
      reverse(uuid(), "profit_decision", decisionOf(d)),
    ];
    await Promise.all(
      refused.map(async (sql) => {
        expect(await codeOf([...closed, ["manager", sql]]), sql).toBe(WRONG_STATE);
        expect(await messageOf([...closed, ["manager", sql]]), sql).toContain("closed");
      }),
    );
    const reopened = await last([
      ...closed,
      ["owner", update(investorOf(i), NAME, PHONE, "[Dummy] note", "active")],
      ["owner", invest(uuid(), investorOf(i), TINY, TODAY_N)],
      ["owner", investorRow(i)],
    ]);
    expect(reopened[0]).toEqual({ ...figures(TINY + TINY, TINY, TINY_PROFIT, TINY_PROFIT), status: "active" });
  });

  it("the name, phone and note change; the same values again write nothing", async () => {
    const audits = `(select count(*) from control.audit_event where table_name = 'public.investor' and row_id = ${investorOf(i)}::text)::int`;
    const rows = await last([
      ...open,
      ["manager", update(investorOf(i), " [Dummy] Investor Renamed ", null, null, "active")],
      ["manager", update(investorOf(i), "[Dummy] Investor Renamed", null, null, "active")],
      [
        "postgres",
        `select full_name, phone, note, status::text, ${audits} audits from public.investor x where x.client_id = '${i}'`,
      ],
    ]);
    // One audit row for the insert and one for the rename; the repeat wrote none.
    expect(rows[0]).toEqual({ full_name: "[Dummy] Investor Renamed", phone: null, note: null, status: "active", audits: BOTH });
  });
});

describe("who may (D-40, doc 06 section 2): owner or manager at AAL2, nobody else", () => {
  const REFUSED: K[] = ["repA", "repB", "repAWrongDevice", "suspended", "managerAal1", "ownerAal1"];
  const calls = () => [
    create(uuid()),
    update(`'${zInvestor}'`, "[Dummy] Taken over", null, null, "active"),
    invest(uuid(), `'${zInvestor}'`, RS, YESTERDAY),
    decide(uuid(), `'${zInvestment}'`, RS, YESTERDAY),
    pay(uuid(), `'${zInvestment}'`, "profit", RS, YESTERDAY),
    reverse(uuid(), "profit_decision", `'${zDecision}'`),
    "select * from app.office_investors()",
    `select * from app.office_investor_investments('${zInvestor}')`,
    `select * from app.office_investor_statement('${zInvestor}', null, null)`,
  ];

  it.each(REFUSED)("%s is refused on every function (42501)", async (who) => {
    await Promise.all(calls().map(async (sql) => expect(await codeOf([[who, sql]]), sql).toBe(DENIED)));
  });

  it("anon and a signed-in login with nothing redeemed are refused on every function (42501)", async () => {
    // The login is made inside each rolled-back transaction, so no auth.users row is left behind.
    const login: Login = { id: uuid(), email: `investor.${tag()}@example.test`, session: uuid() };
    const signedUp = `insert into auth.users (id, email, email_confirmed_at) values ('${login.id}', '${login.email}', now());`;
    await Promise.all(
      calls().map(async (sql) => {
        expect(await sqlstate("anon", sql), sql).toBe(DENIED);
        expect(await sqlstate("postgres", `${signedUp} ${asLogin(login)} ${sql}`), sql).toBe(DENIED);
      }),
    );
  });

  it("reps, AAL1 office sessions and suspended reps read zero rows of the four tables; anon is refused; the office reads them", async () => {
    const tables = ["public.investor", "public.investment", "public.investor_profit_decision", "public.investor_payout"];
    const count = `select ${tables.map((t, n) => `(select count(*) from ${t})::int t${n}`).join(", ")}`;
    const nobody: K[] = ["repA", "repB", "repAWrongDevice", "managerAal1", "ownerAal1", "suspended"];
    await Promise.all(
      nobody.map(async (who) => expect((await last([[who, count]]))[0], who).toEqual({ t0: 0, t1: 0, t2: 0, t3: 0 })),
    );
    await Promise.all(tables.map(async (t) => expect(await sqlstate("anon", `select count(*) from ${t}`), t).toBe(DENIED)));
    // The committed investor Z has an investor, an investment and a decision.
    const office = (await last([["manager", count]]))[0] as Record<string, number>;
    expect([office.t0, office.t1, office.t2].every((n) => n > 0)).toBe(true);
  });

  it("direct INSERT, UPDATE and DELETE are refused for every application role (H-08)", async () => {
    const tables: Array<[string, string]> = [
      ["public.investor", "full_name"],
      ["public.investment", "note"],
      ["public.investor_profit_decision", "note"],
      ["public.investor_payout", "note"],
    ];
    const writes = tables.flatMap(([t, col]) => [
      `insert into ${t} default values`,
      `update ${t} set ${col} = ${col}`,
      `delete from ${t}`,
    ]);
    const people: K[] = ["manager", "owner", "repA"];
    await Promise.all(
      people.flatMap((who) => writes.map(async (sql) => expect(await codeOf([[who, sql]]), `${who}: ${sql}`).toBe(DENIED))),
    );
    await Promise.all(
      writes.flatMap((sql) => [
        (async () => expect(await sqlstate("anon", sql), sql).toBe(DENIED))(),
        (async () => expect(await sqlstate("service_role", sql), sql).toBe(DENIED))(),
      ]),
    );
  });
});

describe("append-only and the guards, even for the table owner (H-06, H-07)", () => {
  it("UPDATE, DELETE and TRUNCATE of investments, decisions and payouts fail as postgres", async () => {
    const attempts = [
      `update public.investment set amount_paisa = amount_paisa + 1 where id = '${zInvestment}'`,
      `delete from public.investment where id = '${zInvestment}'`,
      `update public.investor_profit_decision set amount_paisa = 1 where id = '${zDecision}'`,
      `delete from public.investor_profit_decision where id = '${zDecision}'`,
      "truncate public.investment cascade",
      "truncate public.investor_profit_decision",
      "truncate public.investor_payout",
    ];
    await Promise.all(attempts.map(async (sql) => expect(await sqlstate("postgres", sql), sql).toBe(DENIED)));
    // A payout row of its own, in the same rolled-back transaction, cannot be changed or removed either.
    const p = uuid();
    const own = (sql: string) => `${pay(p, `'${zInvestment}'`, "profit", ONE_PAISA, YESTERDAY)}; reset role; ${sql}`;
    await Promise.all(
      [
        `update public.investor_payout set note = 'x' where client_id = '${p}'`,
        `delete from public.investor_payout where client_id = '${p}'`,
      ].map(async (sql) => expect(await sqlstate("postgres", `${as("manager")} ${own(sql)}`), sql).toBe(DENIED)),
    );
  });

  it("an investor is never deleted and its identity never changes, even as postgres", async () => {
    const attempts = [
      `delete from public.investor where id = '${zInvestor}'`,
      `update public.investor set created_by = '${fx.owner.id}' where id = '${zInvestor}'`,
      `update public.investor set client_id = gen_random_uuid() where id = '${zInvestor}'`,
      `update public.investor set created_at = now() - interval '1 day' where id = '${zInvestor}'`,
      "truncate public.investor cascade",
    ];
    await Promise.all(attempts.map(async (sql) => expect(await sqlstate("postgres", sql), sql).toBe(DENIED)));
  });

  it("a forged reversal row is refused even as postgres: wrong amount, another parent, no reason, or a negative amount with nothing reversed", async () => {
    const other = uuid();
    const row = (investment: string, amount: number, reverses: string | null, reason: string | null) =>
      `insert into public.investor_profit_decision (client_id, investment_id, amount_paisa, decided_on, reverses_id, reason, recorded_by)
       values (gen_random_uuid(), '${investment}', ${amount}, ${TODAY}, ${quote(reverses)}, ${quote(reason)}, '${fx.manager.id}')`;
    const forged = [
      row(zInvestment, -ONE_PAISA, zDecision, "[Dummy] forged"),
      row(zInvestment, -Z_DECIDED, zDecision, null),
      `insert into public.investment (id, client_id, investor_id, amount_paisa, invested_on, recorded_by)
       values ('${other}', gen_random_uuid(), '${zInvestor}', ${RS}, ${TODAY}, '${fx.manager.id}');
       ${row(other, -Z_DECIDED, zDecision, "[Dummy] forged")}`,
      row(zInvestment, -RS, null, null),
    ];
    await Promise.all(forged.map(async (sql) => expect(await sqlstate("postgres", sql), sql).not.toBeNull()));
  });
});

describe("audit and separation (H-17, CAP-03)", () => {
  it("each write is audited with the session's actor, and the chain verifies", async () => {
    const [i, m] = [uuid(), uuid()];
    const actor = (table: string, id: string) =>
      `(select actor_id::text from control.audit_event where table_name = '${table}' and row_id = ${id}::text and action = 'INSERT')`;
    const rows = await last([
      ["manager", create(i)],
      ["owner", invest(m, investorOf(i), RS, YESTERDAY)],
      [
        "postgres",
        `select ${actor("public.investor", investorOf(i))} investor_actor, ${actor("public.investment", investmentOf(m))} investment_actor,
                (select ok from control.verify_audit_chain()) chain`,
      ],
    ]);
    expect(rows[0]).toEqual({ investor_actor: fx.manager.id, investment_actor: fx.owner.id, chain: true });
  });

  it("nothing is posted to cash, payments, receipts, invoices or orders", async () => {
    const [i, m] = [uuid(), uuid()];
    const counts = `select (select count(*) from public.cash_ledger_entry)::int cash, (select count(*) from public.payment)::int payments,
                           (select count(*) from public.receipt)::int receipts, (select count(*) from public.invoice)::int invoices,
                           (select count(*) from public.sales_order)::int orders`;
    const [before, after] = await withColumn(
      [
        ["postgres", counts],
        ["manager", create(i)],
        ["manager", invest(m, investorOf(i), SMALL, EARLIER)],
        ["manager", decide(uuid(), investmentOf(m), SMALL_DECIDED, RECENT)],
        ["manager", pay(uuid(), investmentOf(m), "profit", SMALL_DECIDED, LATER)],
        ["manager", pay(uuid(), investmentOf(m), "principal", SMALL_PAID, TWO_DAYS)],
        ["postgres", counts],
      ],
      "cash",
    );
    expect(after).toEqual(before);
  });
});

describe("two sessions at once (concurrency)", () => {
  const HOLD_SECONDS = 3;
  const MIN_WAIT_MS = 1000;
  const POLL_MS = 100;
  const POLL_TRIES = 100;
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const waitFor = async (check: () => Promise<boolean>, tries = POLL_TRIES): Promise<boolean> => {
    if (await check()) return true;
    if (tries === 0) return false;
    await sleep(POLL_MS);
    return waitFor(check, tries - 1);
  };
  // A session that runs beside the test's other awaits gets its rejection handler the moment it starts
  // (the pattern of payments.test.ts), so an early failure is not an unhandled rejection.
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
  const payZ = (paisa: number) =>
    run("postgres", script([["manager", pay(uuid(), `'${zInvestment}'`, "profit", paisa, YESTERDAY)]]), [], C);

  it("a payout waits for the investor's lock held by another session", async () => {
    const key = `hashtextextended('investor:${zInvestor}', 0)`;
    const holder = observed(run("postgres", `select pg_advisory_xact_lock(${key}); select pg_sleep(${HOLD_SECONDS});`));
    try {
      expect(await waitFor(() => advisoryHeld(key))).toBe(true);
      const started = Date.now();
      // Over the limit, so it is refused after the lock and leaves nothing behind.
      const message = await errorOf(
        "postgres",
        script([["manager", pay(uuid(), `'${zInvestment}'`, "profit", Z_DECIDED + ONE_PAISA, YESTERDAY)]]),
      );
      expect(message).toContain("more than the profit owed");
      expect(Date.now() - started).toBeGreaterThan(MIN_WAIT_MS);
    } finally {
      await holder.catch(() => undefined);
    }
  });

  it("two concurrent profit payouts cannot pay more than was decided: one passes, one is refused", async () => {
    const settled = await Promise.allSettled([observed(payZ(Z_HALF_PLUS)), observed(payZ(Z_HALF_PLUS))]);
    const refused = settled.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(settled.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(refused).toHaveLength(1);
    expect(String(refused[0]?.reason)).toContain("more than the profit owed");
    const after = await run(
      "postgres",
      `select coalesce(sum(amount_paisa), 0)::text paid from public.investor_payout where investment_id = '${zInvestment}' and kind = 'profit'`,
    );
    expect(after.rows[0]).toEqual({ paid: String(Z_HALF_PLUS) });
  });
});
