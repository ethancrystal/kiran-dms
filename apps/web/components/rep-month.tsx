"use client";
import { useEffect, useState } from "react";
import { MonthPicker } from "@/components/month-picker";
import type { CommissionStatement } from "@/lib/commission";
import { rupees } from "@/lib/money";
import { type MyMonthOrders, thisMonth } from "@/lib/overview";
import { rpc } from "@/lib/rpc";

type Month = { orders: MyMonthOrders; commission: CommissionStatement };
type State = { loading: boolean; error: string | null; data: Month | null };

// The rep's month on the home page (P1-26; doc 16: "how many orders did they bring and how much
// commission they earned"). Read-only. app.my_month_orders gives the rep's own orders placed in the
// month (no rep id is sent: the session decides) and the month's first and last day;
// app.my_commission (slice 5) gives the commission for those dates. Nothing is added up here.
export function RepMonth() {
  const [month, setMonth] = useState(thisMonth);
  const [state, setState] = useState<State>({ loading: true, error: null, data: null });

  useEffect(() => {
    let live = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    const go = async () => {
      try {
        const rows = await rpc<MyMonthOrders[]>("my_month_orders", { p_month: month });
        const orders = rows?.[0];
        if (!orders) throw new Error("Your month could not be loaded.");
        const commission = await rpc<CommissionStatement>("my_commission", {
          p_from: orders.month_start,
          p_to: orders.month_end,
        });
        if (live) setState({ loading: false, error: null, data: { orders, commission } });
      } catch (e) {
        if (live) setState({ loading: false, error: (e as Error).message, data: null });
      }
    };
    void go();
    return () => {
      live = false;
    };
  }, [month]);

  const o = state.data?.orders;
  const c = state.data?.commission;
  return (
    <section className="card rep-month" aria-labelledby="rep-month-h" data-testid="rep-month">
      <h2 id="rep-month-h">My month</h2>
      <MonthPicker month={month} onChange={setMonth} />
      {state.loading && (
        <p className="muted" aria-busy="true">
          Loading…
        </p>
      )}
      {!state.loading && state.error && (
        <p className="error" role="alert">
          {state.error}
        </p>
      )}
      {!state.loading && o && c && (
        <>
          <p className="big-line">
            Orders I brought: <strong data-testid="month-orders">{o.orders_count}</strong>
            {Number(o.orders_count) > 0 && <> worth {rupees(o.orders_value_paisa)}</>}
          </p>
          {Number(o.orders_count) === 0 && Number(o.cancelled_count) === 0 ? (
            <p className="muted">No orders yet this month. Send an order card from a salon page; the office makes the order.</p>
          ) : (
            <ul className="plain">
              <li>
                Delivered: <strong data-testid="month-delivered">{o.delivered_count}</strong> ({rupees(o.delivered_value_paisa)})
              </li>
              <li>
                Waiting to be delivered: <strong data-testid="month-waiting">{o.waiting_count}</strong> (
                {rupees(o.waiting_value_paisa)})
              </li>
              {Number(o.held_count) > 0 && (
                <li>
                  On hold at the office: <strong>{o.held_count}</strong>
                </li>
              )}
              {Number(o.cancelled_count) > 0 && (
                <li>
                  Cancelled: <strong>{o.cancelled_count}</strong>
                </li>
              )}
            </ul>
          )}
          <dl>
            <dt>Commission earned this month</dt>
            <dd data-testid="month-earned">{rupees(Number(c.earned_paisa))}</dd>
            <dt>Commission paid to me this month</dt>
            <dd data-testid="month-paid">{rupees(Number(c.paid_paisa))}</dd>
            <dt>Still owed to me (all months)</dt>
            <dd data-testid="month-owed">{rupees(Number(c.owed_paisa))}</dd>
          </dl>
          <p className="muted">
            An order counts in the month it was placed. Its commission counts in the month the office approves the delivery.
          </p>
        </>
      )}
    </section>
  );
}
