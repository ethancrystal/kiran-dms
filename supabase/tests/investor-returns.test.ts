/**
 * Investor recurring percentage return (migration 20261120060000; decision
 * 2026-11-20-mj-rep-scope-stock-investors, assumption A-24). An investment may carry a
 * promised return, a percentage per period (monthly or yearly). The system derives the
 * accrued return from the amount, the percentage and the whole periods elapsed; profit
 * owed = accrued + decided - paid, and a profit payout is capped at it. Investments with
 * no terms accrue nothing and behave exactly as the typed-decision ledger did.
 *
 * Every test runs in one rolled-back transaction (helpers/db), so no ledger row is left.
 */
import { describe, expect, it } from "vitest";
import { errorOf, fx, run, sqlstate } from "./helpers/db";
import { quote, uuid } from "./helpers/invite";

const DENIED = "42501";
const BAD_INPUT = "22023";
const WRONG_STATE = "55000";
const DUPLICATE = "23505";
const OVER_LIMIT = "23514";

const A = 10_000_000; // Rs 100,000 in paisa
const PCT = 10; // 10 percent
const PER_MONTH = 1_000_000; // floor(A * 10 / 100) = Rs 10,000

const TODAY = "(now() at time zone 'Asia/Karachi')::date";
const daysAgo = (n: number) => (n === 0 ? TODAY : `(${TODAY} - ${n})`);
const monthsAgo = (n: number) => `(${TODAY} - interval '${n} months')::date`;
const yearsAgo = (n: number) => `(${TODAY} - interval '${n} years')::date`;

type K = "owner" | "manager" | "repA" | "managerAal1";
const PERSONA: Record<K, { key: keyof typeof fx; aal: "aal1" | "aal2" }> = {
  owner: { key: "owner", aal: "aal2" },
  manager: { key: "manager", aal: "aal2" },
  repA: { key: "repA", aal: "aal1" },
  managerAal1: { key: "manager", aal: "aal1" },
};
const as = (k: K) => {
  const p = PERSONA[k];
  const claims = JSON.stringify({ sub: fx[p.key].id, role: "authenticated", aal: p.aal });
  const headers = JSON.stringify({ "x-kiran-device": fx[p.key].device });
  return `reset role;
  select set_config('request.jwt.claims', '${claims}', true), set_config('request.headers', '${headers}', true);
  set local role authenticated;`;
};
type Step = [K | "postgres", string];
type Multi = Array<{ rows: Array<Record<string, unknown>> }>;
const script = (steps: Step[]) => steps.map(([k, sql]) => `${k === "postgres" ? "reset role;" : as(k)}\n${sql};`).join("\n");
const results = async (steps: Step[]) => (await run("postgres", script(steps))) as unknown as Multi;
const last = async (steps: Step[]) => (await results(steps)).at(-1)?.rows ?? [];
const codeOf = (steps: Step[]) => sqlstate("postgres", script(steps));
const messageOf = (steps: Step[]) => errorOf("postgres", script(steps));

const investorOf = (c: string) => `(select x.id from public.investor x where x.client_id = '${c}')`;
const investmentOf = (c: string) => `(select x.id from public.investment x where x.client_id = '${c}')`;
const create = (c: string) => `select app.office_create_investor('${c}', '[Dummy] Return Investor', null, null)`;
const invest = (c: string, investor: string, paisa: number, dateExpr: string) =>
  `select app.office_add_investment('${c}', ${investor}, ${paisa}, ${dateExpr}, null)`;
const investTerms = (c: string, investor: string, paisa: number, dateExpr: string, pct: number | string, period: string | null) =>
  `select app.office_add_investment('${c}', ${investor}, ${paisa}, ${dateExpr}, null, ${pct}, ${quote(period)})`;
const pay = (c: string, investment: string, kind: string, paisa: number, dateExpr: string) =>
  `select app.office_record_payout('${c}', ${investment}, '${kind}', 'cash', ${paisa}, ${dateExpr}, null, null)`;
const decide = (c: string, investment: string, paisa: number, dateExpr: string) =>
  `select app.office_decide_profit('${c}', ${investment}, ${paisa}, ${dateExpr}, null)`;
const reverse = (c: string, kind: string, entry: string) =>
  `select app.office_reverse_investor_entry('${c}', '${kind}', ${entry}, '[Dummy] entered in error')`;
const fig = (investor: string, investment: string) =>
  `select profit_accrued_paisa::text accrued, profit_decided_paisa::text decided, profit_paid_paisa::text paid,
          profit_owed_paisa::text owed, return_pct::text pct, return_period period
   from app.office_investor_investments(${investor}) where investment_id = ${investment}`;

describe("the promised return accrues from the amount, the percentage and whole periods", () => {
  it("monthly: 10% on Rs 100,000 accrues Rs 10,000 each whole month; 3 months = Rs 30,000 owed", async () => {
    const [i, m] = [uuid(), uuid()];
    const rows = await last([
      ["manager", create(i)],
      ["manager", investTerms(m, investorOf(i), A, monthsAgo(3), PCT, "monthly")],
      ["manager", fig(investorOf(i), investmentOf(m))],
    ]);
    expect(rows[0]).toEqual({
      accrued: String(3 * PER_MONTH),
      decided: "0",
      paid: "0",
      owed: String(3 * PER_MONTH),
      pct: "10.0000",
      period: "monthly",
    });
  });

  it("yearly: 10% on Rs 100,000 accrues Rs 10,000 each whole year; 2 years = Rs 20,000", async () => {
    const [i, m] = [uuid(), uuid()];
    const rows = await last([
      ["manager", create(i)],
      ["manager", investTerms(m, investorOf(i), A, yearsAgo(2), PCT, "yearly")],
      ["manager", fig(investorOf(i), investmentOf(m))],
    ]);
    expect(rows[0]).toMatchObject({ accrued: String(2 * PER_MONTH), owed: String(2 * PER_MONTH), period: "yearly" });
  });

  it("a part period does not accrue: 15 days at 10% monthly is still zero", async () => {
    const [i, m] = [uuid(), uuid()];
    const rows = await last([
      ["manager", create(i)],
      ["manager", investTerms(m, investorOf(i), A, daysAgo(15), PCT, "monthly")],
      ["manager", fig(investorOf(i), investmentOf(m))],
    ]);
    expect(rows[0]).toMatchObject({ accrued: "0", owed: "0" });
  });

  it("the per-period amount is floored to whole paisa", async () => {
    const [i, m] = [uuid(), uuid()];
    // Rs 10 (1000 paisa) at 10% = 100 paisa a month; 2 months = 200 paisa.
    const rows = await last([
      ["manager", create(i)],
      ["manager", investTerms(m, investorOf(i), 1000, monthsAgo(2), PCT, "monthly")],
      ["manager", fig(investorOf(i), investmentOf(m))],
    ]);
    expect(rows[0]).toMatchObject({ accrued: "200", owed: "200" });
    // A fraction of a paisa per period floors to zero: 1 paisa at 10% = 0.1 -> 0.
    const [j, n] = [uuid(), uuid()];
    const tiny = await last([
      ["manager", create(j)],
      ["manager", investTerms(n, investorOf(j), 1, monthsAgo(5), PCT, "monthly")],
      ["manager", `select profit_accrued_paisa::text accrued from app.office_investor_investments(${investorOf(j)})`],
    ]);
    expect(tiny[0]).toEqual({ accrued: "0" });
  });

  it("an investment with no terms accrues nothing and keeps the typed-decision behaviour", async () => {
    const [i, m, d] = [uuid(), uuid(), uuid()];
    const rows = await last([
      ["manager", create(i)],
      ["manager", invest(m, investorOf(i), A, monthsAgo(6))],
      ["manager", decide(d, investmentOf(m), 500_000, daysAgo(1))],
      ["manager", fig(investorOf(i), investmentOf(m))],
    ]);
    expect(rows[0]).toEqual({ accrued: "0", decided: "500000", paid: "0", owed: "500000", pct: null, period: null });
  });

  it("accrued return and typed decisions add together in what is owed", async () => {
    const [i, m, d] = [uuid(), uuid(), uuid()];
    const rows = await last([
      ["manager", create(i)],
      ["manager", investTerms(m, investorOf(i), A, monthsAgo(2), PCT, "monthly")],
      ["manager", decide(d, investmentOf(m), 250_000, daysAgo(1))],
      ["manager", fig(investorOf(i), investmentOf(m))],
    ]);
    expect(rows[0]).toMatchObject({ accrued: String(2 * PER_MONTH), decided: "250000", owed: String(2 * PER_MONTH + 250_000) });
  });

  it("a reversed investment reads accrued zero", async () => {
    const [i, m] = [uuid(), uuid()];
    const rows = await last([
      ["manager", create(i)],
      ["manager", investTerms(m, investorOf(i), A, daysAgo(0), PCT, "monthly")],
      ["manager", reverse(uuid(), "investment", investmentOf(m))],
      ["manager", `select profit_accrued_paisa::text accrued, reversed from app.office_investor_investments(${investorOf(i)})`],
    ]);
    expect(rows[0]).toEqual({ accrued: "0", reversed: true });
  });
});

describe("payouts are capped at the accrued return plus decisions minus paid", () => {
  it("a profit payout up to the accrued return passes; one paisa more is refused (23514)", async () => {
    const [i, m] = [uuid(), uuid()];
    const base: Step[] = [
      ["manager", create(i)],
      ["manager", investTerms(m, investorOf(i), A, monthsAgo(3), PCT, "monthly")],
    ];
    const owed = 3 * PER_MONTH;
    expect(await codeOf([...base, ["manager", pay(uuid(), investmentOf(m), "profit", owed, daysAgo(0))]])).toBeNull();
    expect(await codeOf([...base, ["manager", pay(uuid(), investmentOf(m), "profit", owed + 1, daysAgo(0))]])).toBe(OVER_LIMIT);
    expect(await messageOf([...base, ["manager", pay(uuid(), investmentOf(m), "profit", owed + 1, daysAgo(0))]])).toContain(
      "more than the profit owed",
    );
  });

  it("paying part of the accrued return leaves the rest owed", async () => {
    const [i, m] = [uuid(), uuid()];
    const rows = await last([
      ["manager", create(i)],
      ["manager", investTerms(m, investorOf(i), A, monthsAgo(3), PCT, "monthly")],
      ["manager", pay(uuid(), investmentOf(m), "profit", PER_MONTH, daysAgo(0))],
      ["manager", fig(investorOf(i), investmentOf(m))],
    ]);
    expect(rows[0]).toMatchObject({ accrued: String(3 * PER_MONTH), paid: String(PER_MONTH), owed: String(2 * PER_MONTH) });
  });
});

describe("the return terms are validated and replay safely", () => {
  it("a percentage without a period, a period without a percentage, a bad percentage or a bad period are refused (22023)", async () => {
    const i = uuid();
    const base: Step[] = [["manager", create(i)]];
    const cases: Array<[string, string, string]> = [
      ["pct only", investTerms(uuid(), investorOf(i), A, daysAgo(1), PCT, null), "both a percentage and a period"],
      ["period only", investTerms(uuid(), investorOf(i), A, daysAgo(1), "null", "monthly"), "both a percentage and a period"],
      ["zero pct", investTerms(uuid(), investorOf(i), A, daysAgo(1), 0, "monthly"), "above 0 and at most 1000"],
      ["pct over cap", investTerms(uuid(), investorOf(i), A, daysAgo(1), 1001, "monthly"), "above 0 and at most 1000"],
      ["bad period", investTerms(uuid(), investorOf(i), A, daysAgo(1), PCT, "weekly"), "monthly or yearly"],
    ];
    for (const [name, sql, words] of cases) {
      expect(await codeOf([...base, ["manager", sql]]), name).toBe(BAD_INPUT);
      expect(await messageOf([...base, ["manager", sql]]), name).toContain(words);
    }
  });

  it("replay: the same terms return the first row; a different percentage is 23505", async () => {
    const [i, m] = [uuid(), uuid()];
    const call = investTerms(m, investorOf(i), A, monthsAgo(2), PCT, "monthly");
    const rows = await last([
      ["manager", create(i)],
      ["manager", call],
      ["manager", call],
      ["postgres", `select count(*)::int n from public.investment where client_id = '${m}'`],
    ]);
    expect(rows[0]).toEqual({ n: 1 });
    expect(
      await codeOf([
        ["manager", create(i)],
        ["manager", call],
        ["manager", investTerms(m, investorOf(i), A, monthsAgo(2), 11, "monthly")],
      ]),
    ).toBe(DUPLICATE);
  });
});

describe("closing and reversing respect the accrued return", () => {
  it("an investor with accrued return cannot close until it is paid (55000)", async () => {
    const [i, m] = [uuid(), uuid()];
    const open: Step[] = [
      ["manager", create(i)],
      ["manager", investTerms(m, investorOf(i), A, monthsAgo(2), PCT, "monthly")],
    ];
    const close = `select app.office_update_investor(${investorOf(i)}, '[Dummy] Return Investor', null, null, 'closed')`;
    expect(await codeOf([...open, ["manager", close]])).toBe(WRONG_STATE);
    // Pay the accrued return and return the principal, then closing passes.
    expect(
      await codeOf([
        ...open,
        ["manager", pay(uuid(), investmentOf(m), "profit", 2 * PER_MONTH, daysAgo(0))],
        ["manager", pay(uuid(), investmentOf(m), "principal", A, daysAgo(0))],
        ["manager", close],
      ]),
    ).toBeNull();
  });

  it("an investment with accrued return cannot be reversed (23514)", async () => {
    const [i, m] = [uuid(), uuid()];
    expect(
      await codeOf([
        ["manager", create(i)],
        ["manager", investTerms(m, investorOf(i), A, monthsAgo(2), PCT, "monthly")],
        ["manager", reverse(uuid(), "investment", investmentOf(m))],
      ]),
    ).toBe(OVER_LIMIT);
  });
});

describe("the statement carries the accrued return as of each row's date", () => {
  it("the running profit owed includes the return accrued up to that row", async () => {
    const [i, m] = [uuid(), uuid()];
    const rows = await last([
      ["manager", create(i)],
      ["manager", investTerms(m, investorOf(i), A, monthsAgo(3), PCT, "monthly")],
      ["manager", pay(uuid(), investmentOf(m), "profit", PER_MONTH, daysAgo(0))],
      [
        "manager",
        `select entry_kind, profit_owed_paisa::text owed from app.office_investor_statement(${investorOf(i)}, null, null) order by entry_on`,
      ],
    ]);
    // The investment row is dated 3 months ago: nothing had accrued then (0 whole months
    // at its own date). The payout row is today: 3 months accrued minus the payout.
    expect(rows).toEqual([
      { entry_kind: "investment", owed: "0" },
      { entry_kind: "payout", owed: String(3 * PER_MONTH - PER_MONTH) },
    ]);
  });
});

describe("who may: office at AAL2 only; the new columns leak nothing to anyone else", () => {
  it("a rep and an AAL1 manager are refused on the investor reads (42501)", async () => {
    const reads = [
      "select * from app.office_investors()",
      `select * from app.office_investor_investments('${uuid()}')`,
      `select * from app.office_investor_statement('${uuid()}', null, null)`,
    ];
    for (const who of ["repA", "managerAal1"] as K[]) {
      for (const sql of reads) {
        expect(await codeOf([[who, sql]]), `${who}: ${sql}`).toBe(DENIED);
      }
    }
    expect(await sqlstate("anon", "select * from app.office_investors()")).toBe(DENIED);
  });

  it("the office reads the return terms; a rep reads zero rows of the investment table", async () => {
    const [i, m] = [uuid(), uuid()];
    const rows = await last([
      ["manager", create(i)],
      ["manager", investTerms(m, investorOf(i), A, monthsAgo(1), PCT, "monthly")],
      ["manager", `select return_pct::text pct, return_period period from app.office_investor_investments(${investorOf(i)})`],
    ]);
    expect(rows[0]).toEqual({ pct: "10.0000", period: "monthly" });
    const repCount = await last([["repA", "select count(*)::int n from public.investment"]]);
    expect(repCount[0]).toEqual({ n: 0 });
  });
});
