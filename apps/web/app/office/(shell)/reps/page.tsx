"use client";
import Link from "next/link";
import { useState } from "react";
import { MonthPicker } from "@/components/month-picker";
import { useRpcRead } from "@/components/use-rpc-read";
import { rupees } from "@/lib/money";
import { type RepMonthRow, thisMonth } from "@/lib/overview";

// Rep performance (P1-26; doc 16, D-38). Owner and manager only: app.office_rep_month lists every rep
// with the orders they brought in the month (orders whose rep they are, by the month the order was
// placed) and their commission: earned and paid in the month, still owed over all months. Every figure
// is the database's; the page adds nothing up. Payments are recorded on the Commission page.
export default function RepPerformance() {
  const [month, setMonth] = useState(thisMonth);
  const read = useRpcRead<RepMonthRow[]>("office_rep_month", { p_month: month }, month);
  const reps = read.data ?? [];

  return (
    <>
      <h1>Rep performance</h1>
      <p className="muted">
        For each rep: the orders they brought this month, how many are delivered or still waiting, and their commission.
        Commission counts in the month the delivery is approved. To pay a rep, use the{" "}
        <Link href="/office/commission">commission page</Link>.
      </p>
      <MonthPicker month={month} onChange={setMonth} />
      {read.loading && (
        <p className="muted" aria-busy="true">
          Loading…
        </p>
      )}
      {!read.loading && read.error && (
        <p className="error" role="alert">
          {read.error}
        </p>
      )}
      {!read.loading && !read.error && reps.length === 0 && <p className="muted">No reps yet. Invite one on the People page.</p>}
      {!read.loading && !read.error && reps.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Rep</th>
              <th>Orders brought</th>
              <th>Delivered</th>
              <th>Waiting to be delivered</th>
              <th>Commission earned</th>
              <th>Commission paid</th>
              <th>Still owed (all months)</th>
            </tr>
          </thead>
          <tbody>
            {reps.map((r) => (
              <tr key={r.rep_id} data-testid="rep-month-row">
                <td>
                  <Link href={`/office/reps/${r.rep_id}`}>{r.full_name}</Link>
                  {r.status !== "active" && <span className="badge suspended"> {r.status}</span>}
                </td>
                <td>
                  {r.orders_count}
                  {Number(r.orders_count) > 0 && <span className="muted"> ({rupees(r.orders_value_paisa)})</span>}
                </td>
                <td>{r.delivered_count}</td>
                <td>{r.waiting_count}</td>
                <td>{rupees(r.earned_month_paisa)}</td>
                <td>{rupees(r.paid_month_paisa)}</td>
                <td>
                  <strong>{rupees(r.owed_paisa)}</strong>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
