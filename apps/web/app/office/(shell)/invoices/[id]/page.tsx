"use client";
import Link from "next/link";
import { use, useEffect, useState } from "react";
import { useRpcRead } from "@/components/use-rpc-read";
import { type InvoiceDocument, isUuid, ONLY_VALID_PROOF, type ReceiptRow } from "@/lib/documents";
import { rupees } from "@/lib/money";
import { day, when } from "@/lib/overview";
import { db, rows } from "@/lib/rpc";

type Refs = { order_id: string; salon_id: string };

// One invoice, printable (F6; ORD-05). Everything printed is app.invoice_document's: the page adds
// nothing up. The office reads any invoice; the function answers null both for an id that does not
// exist and for a caller it refuses, so the page has one message for both. English only (doc 08).
export default function InvoiceView({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return isUuid(id) ? <Invoice id={id} /> : <NotFound />;
}

const NotFound = () => (
  <>
    <h1>Invoice</h1>
    <p className="error" role="alert">
      This invoice does not exist, or you may not read it.
    </p>
    <Link href="/office/invoices">Back to invoices</Link>
  </>
);

function Invoice({ id }: { id: string }) {
  const read = useRpcRead<InvoiceDocument | null>("invoice_document", { p_invoice_id: id }, id);
  const receipts = useRpcRead<ReceiptRow[]>("office_receipts", { p_invoice_id: id }, id);
  const [refs, setRefs] = useState<Refs | null>(null);
  useEffect(() => {
    const load = async () => {
      try {
        const r = await rows<Refs>(db().from("invoice").select("order_id, salon_id").eq("id", id));
        setRefs(r[0] ?? null);
      } catch {
        // The links are a convenience; the document below reports its own errors.
        setRefs(null);
      }
    };
    void load();
  }, [id]);

  if (read.loading)
    return (
      <p className="muted" aria-busy="true">
        Loading…
      </p>
    );
  if (read.error)
    return (
      <p className="error" role="alert">
        {read.error}
      </p>
    );
  const d = read.data;
  if (!d) return <NotFound />;
  const receiptId = (number: string) => (receipts.data ?? []).find((r) => r.number === number)?.receipt_id;

  return (
    <article>
      <p className="row no-print">
        <Link href="/office/invoices">Back to invoices</Link>
        {refs && <Link href={`/office/orders/${refs.order_id}`}>Open the order</Link>}
        {refs && <Link href={`/office/salons/${refs.salon_id}`}>Open the salon</Link>}
        <button type="button" className="inline" onClick={() => window.print()}>
          Print
        </button>
      </p>
      <div className="doc-head">
        <div>
          <strong>{d.company.name_en}</strong>
          {d.company.city && <div className="muted">{d.company.city}</div>}
        </div>
        <div>
          <h1>Invoice {d.number}</h1>
          <div className="muted">
            Financial year {d.financial_year} · Issued {when(d.issued_at)}
          </div>
        </div>
      </div>

      <dl>
        <dt>Salon</dt>
        <dd data-testid="doc-salon">{d.salon.name ?? "Unnamed salon"}</dd>
        {d.salon.area && (
          <>
            <dt>Area</dt>
            <dd>{d.salon.area}</dd>
          </>
        )}
        {d.salon.address && (
          <>
            <dt>Address</dt>
            <dd>{d.salon.address}</dd>
          </>
        )}
        <dt>Delivered</dt>
        <dd>
          {when(d.delivery.delivered_at)}
          {d.delivery.received_by_name && `, received by ${d.delivery.received_by_name}`}
        </dd>
        <dt>Payment plan</dt>
        <dd>{d.plan.name ?? d.plan.code}</dd>
      </dl>

      <h2>Items</h2>
      <table>
        <thead>
          <tr>
            <th>SKU</th>
            <th>Product</th>
            <th>Quantity</th>
            <th>Unit price</th>
            <th>Amount</th>
          </tr>
        </thead>
        <tbody>
          {d.lines.map((l) => (
            <tr key={l.line_no} data-testid="doc-line">
              <td>{l.sku_code}</td>
              <td>
                {l.product}
                {l.variant && <span className="muted"> {l.variant}</span>}
              </td>
              <td>{l.qty}</td>
              <td>{rupees(l.unit_price_paisa)}</td>
              <td>{rupees(l.line_total_paisa)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <dl>
        <dt>Subtotal</dt>
        <dd>{rupees(d.totals.subtotal_paisa)}</dd>
        <dt>Discount</dt>
        <dd>{rupees(d.totals.discount_paisa)}</dd>
        <dt>Total</dt>
        <dd className="doc-total">
          <strong data-testid="doc-total">{rupees(d.totals.total_paisa)}</strong>
        </dd>
      </dl>

      <h2>When it is due</h2>
      <table>
        <thead>
          <tr>
            <th>Installment</th>
            <th>Due</th>
            <th>Share</th>
            <th>Amount</th>
          </tr>
        </thead>
        <tbody>
          {d.schedule.map((s) => (
            <tr key={s.no}>
              <td>
                {s.no} of {s.of}
              </td>
              <td>{day(s.due_on)}</td>
              <td>{s.pct}%</td>
              <td>{rupees(s.amount_paisa)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Receipts on this invoice</h2>
      {d.receipts.length === 0 ? (
        <p className="muted">No payment is recorded against this invoice yet.</p>
      ) : (
        <ul className="plain">
          {d.receipts.map((r) => {
            const rid = receiptId(r.number);
            return (
              <li key={r.number} data-testid="doc-receipt">
                {rid ? <Link href={`/office/receipts/${rid}`}>{r.number}</Link> : r.number} · {rupees(r.amount_paisa)} ·{" "}
                {when(r.issued_at)}
              </li>
            );
          })}
        </ul>
      )}

      {d.bank_accounts.length > 0 && (
        <>
          <h2>Pay into</h2>
          <ul className="plain">
            {d.bank_accounts.map((b) => (
              <li key={b.account_no}>
                {b.bank} · {b.account_title} · {b.account_no}
              </li>
            ))}
          </ul>
        </>
      )}

      <p className="doc-notice" data-testid="doc-proof">
        {ONLY_VALID_PROOF}
      </p>
      {d.notices.map((n) => (
        <p key={n.code} className="doc-notice">
          {n.en}
        </p>
      ))}
    </article>
  );
}
