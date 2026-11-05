"use client";
import Link from "next/link";
import { useState } from "react";
import { MonthPicker } from "@/components/month-picker";
import { useRpcRead } from "@/components/use-rpc-read";
import { rupees } from "@/lib/money";
import { type InvestorMonthRow, monthName, thisMonth } from "@/lib/overview";

const NONE_DECIDED = "Nothing decided yet for this month.";
const DATE_HINT =
  "A profit decision counts in the month of the date typed on it. To decide for a month, type a date inside that month.";

/** The figures of one investor, or of all of them, for the month. Every amount is the database's. */
function Figures({ r, who }: { r: InvestorMonthRow; who: "one" | "total" }) {
  const t = (k: string) => `month-${who}-${k}`;
  return (
    <dl>
      <dt>Invested (all time)</dt>
      <dd data-testid={t("invested")}>{rupees(r.invested_paisa)}</dd>
      <dt>Profit decided for this month</dt>
      <dd data-testid={t("decided")}>
        {Number(r.decisions_month) === 0 && Number(r.profit_decided_month_paisa) === 0
          ? NONE_DECIDED
          : rupees(r.profit_decided_month_paisa)}
      </dd>
      <dt>Profit paid this month</dt>
      <dd data-testid={t("paid")}>{rupees(r.profit_paid_month_paisa)}</dd>
      <dt>Investment paid back this month</dt>
      <dd data-testid={t("returned")}>{rupees(r.principal_paid_month_paisa)}</dd>
      <dt>Profit still owed (all months, today)</dt>
      <dd data-testid={t("owed")}>{rupees(r.profit_owed_paisa)}</dd>
    </dl>
  );
}

/**
 * What to do when nothing is decided for the month. The decision form's date starts at today, so the
 * one-click link is offered only for the current month; for an earlier month the manager is told to
 * set a date inside that month, so a decision is never filed under the wrong month by mistake.
 */
function DecideHint({ canDecide, month }: { canDecide: boolean; month: string }) {
  if (!canDecide) return <span className="muted">To decide, the investor must be open and have an investment.</span>;
  if (month === thisMonth())
    return (
      <a className="btn inline" href="#decide-profit">
        Decide profit for {monthName(month)}
      </a>
    );
  return (
    <span>
      To decide for {monthName(month)}, use Decide profit below and set the date to a day in {monthName(month)}.
    </span>
  );
}

// The "This month" block on the investor pages (P1-26; D-40). It reads app.office_investor_month, which
// takes the typed amounts dated in the month; nothing is calculated, suggested or paid out here. With
// `investorId` it shows that investor and a link to the decision form; without it, the totals and one
// line per investor. `version` changes after every write on the page, so the block reloads with it.
export function InvestorMonth({
  investorId,
  version = 0,
  canDecide = false,
}: {
  investorId?: string;
  version?: number;
  /** The decision form is on the page (an active investor with an open investment). */
  canDecide?: boolean;
}) {
  const [month, setMonth] = useState(thisMonth);
  const read = useRpcRead<InvestorMonthRow[]>(
    "office_investor_month",
    { p_month: month, p_investor_id: investorId ?? null },
    `${month}|${investorId ?? ""}|${version}`,
  );
  const { loading, error } = read;
  const list = read.data ?? [];

  const isNow = month === thisMonth();
  const total = list.find((r) => r.is_total) ?? null;
  const people = list.filter((r) => !r.is_total);
  const one = investorId ? (people[0] ?? null) : null;

  return (
    <section className="card" aria-labelledby="month-h" data-testid="investor-month">
      <h2 id="month-h">This month</h2>
      <MonthPicker month={month} onChange={setMonth} />
      <p className="muted">{DATE_HINT}</p>
      {loading && (
        <p className="muted" aria-busy="true">
          Loading…
        </p>
      )}
      {!loading && error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!loading && !error && one && (
        <>
          <Figures r={one} who="one" />
          {Number(one.decisions_month) === 0 && (
            <p>
              {NONE_DECIDED} <DecideHint canDecide={canDecide} month={month} />
            </p>
          )}
        </>
      )}
      {!loading && !error && !investorId && total && (
        <>
          <h3>All investors together</h3>
          <Figures r={total} who="total" />
          {people.length === 0 ? (
            <p className="muted">No investors yet. Add one below.</p>
          ) : (
            <ul className="plain">
              {people.map((p) => (
                <li key={p.investor_id} data-testid="investor-month-line">
                  <strong>{p.full_name}</strong>:{" "}
                  {Number(p.decisions_month) === 0 ? (
                    <>
                      nothing decided yet for this month.{" "}
                      {isNow && <Link href={`/office/investors/${p.investor_id}#decide-profit`}>Decide now</Link>}
                    </>
                  ) : (
                    <>decided {rupees(p.profit_decided_month_paisa)}</>
                  )}
                  {" · "}paid {rupees(p.profit_paid_month_paisa)} this month · still owed {rupees(p.profit_owed_paisa)}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
