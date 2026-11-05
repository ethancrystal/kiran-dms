"use client";
import { useCallback, useEffect, useState } from "react";
import { type CommissionStatement, karachiToday, monthStart, when } from "@/lib/commission";
import { percent, rupees } from "@/lib/money";
import { rpc } from "@/lib/rpc";

// The rep's own commission (FLD-03, FLD-06; D-38): app.my_commission for a date range. Read-only:
// the rate, payments and reversals are the office's. Earned and paid are for the chosen dates; owed is
// everything earned to date minus everything paid. The database decides who may read; a refusal is
// shown as it comes.
export default function MyCommission() {
  const today = karachiToday();
  const [from, setFrom] = useState(monthStart(today));
  const [to, setTo] = useState(today);
  const [data, setData] = useState<CommissionStatement | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      setData(await rpc<CommissionStatement>("my_commission", { p_from: from, p_to: to }));
    } catch (e) {
      setData(null);
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [from, to]);
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <main>
      <p>
        <a href="/app">← Today</a>
      </p>
      <h1>My commission</h1>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          void load();
        }}
      >
        <label>
          From
          <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} required />
        </label>
        <label>
          To
          <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} required />
        </label>
      </form>
      {loading && (
        <p className="muted" aria-busy="true">
          Loading…
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!loading && data && (
        <>
          <div className="card">
            <p>
              Earned in these dates: <strong data-testid="earned">{rupees(Number(data.earned_paisa))}</strong>
              <br />
              Paid in these dates: <strong data-testid="paid">{rupees(Number(data.paid_paisa))}</strong>
              <br />
              Owed to you now: <strong data-testid="owed">{rupees(Number(data.owed_paisa))}</strong>
            </p>
            <p className="muted">
              Your default rate: {data.default_rate_bp === null ? "not set" : percent(data.default_rate_bp)}. The rate on each
              invoice is fixed when the office approves the delivery.
            </p>
          </div>

          <h2>Invoices ({data.invoice_count})</h2>
          {data.invoices.length === 0 ? (
            <p className="muted">No invoice earned commission in these dates.</p>
          ) : (
            <ul className="plain">
              {data.invoices.map((i) => (
                <li key={i.invoice_id} data-testid="commission-invoice">
                  <strong>{i.number}</strong> · {i.salon_name ?? "Unnamed salon"} · {rupees(Number(i.total_paisa))} at{" "}
                  {percent(i.rate_bp)} = <strong>{rupees(Number(i.commission_paisa))}</strong>
                  <br />
                  <span className="muted">{when(i.issued_at)}</span>
                </li>
              ))}
            </ul>
          )}
          {data.invoice_count > data.invoices.length && (
            <p className="muted">Showing the newest {data.invoices.length}; the totals count them all.</p>
          )}

          <h2>Payments</h2>
          {data.payments.length === 0 ? (
            <p className="muted">No commission payment in these dates.</p>
          ) : (
            <ul className="plain">
              {data.payments.map((p) => (
                <li key={p.payment_id} data-testid="commission-payment">
                  <span className="badge">{p.kind === "payment" ? "Paid" : "Reversed"}</span>{" "}
                  <strong>{rupees(Number(p.amount_paisa))}</strong> · {when(p.recorded_at)}
                  {p.kind === "payment" && p.note && <> · {p.note}</>}
                  {p.kind === "reversal" && p.reason && <> · {p.reason}</>}
                  {p.reversed && <span className="muted"> (later reversed)</span>}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </main>
  );
}
