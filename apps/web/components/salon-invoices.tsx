"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { fullDay } from "@/lib/documents";
import { rupees } from "@/lib/money";
import { rpc } from "@/lib/rpc";

type Row = {
  invoice_id: string;
  number: string;
  issued_at: string;
  total_paisa: number;
  paid_paisa: number;
  outstanding_paisa: number;
};

// The salon's own issued invoices (P1-31, D-49), from app.salon_my_invoices, which finds the salon from this login's
// active membership and takes no salon id. Each opens as the invoice that was issued, with its payments up to date.
export function SalonInvoices() {
  const [list, setList] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const load = async () => {
      try {
        setList((await rpc<Row[]>("salon_my_invoices")) ?? []);
      } catch (e) {
        setError((e as Error).message);
      }
    };
    void load();
  }, []);
  return (
    <section className="card" aria-labelledby="invoices-h">
      <h2 id="invoices-h">My invoices</h2>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!list && !error && (
        <p className="muted" aria-busy="true">
          Loading…
        </p>
      )}
      {list && list.length === 0 && <p className="muted">You have no invoices yet. One is issued when a delivery is approved.</p>}
      {list && list.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Invoice</th>
              <th>Date</th>
              <th>Amount</th>
              <th>Paid</th>
              <th>Still to pay</th>
            </tr>
          </thead>
          <tbody>
            {list.map((i) => (
              <tr key={i.invoice_id} data-testid="salon-invoice-row">
                <td>
                  <Link href={`/salon/invoices/${i.invoice_id}`}>{i.number}</Link>
                </td>
                <td>{fullDay(i.issued_at.slice(0, 10))}</td>
                <td>{rupees(i.total_paisa)}</td>
                <td>{rupees(i.paid_paisa)}</td>
                <td>{rupees(i.outstanding_paisa)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
