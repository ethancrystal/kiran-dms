"use client";
import Link from "next/link";
import { use } from "react";
import { useRpcRead } from "@/components/use-rpc-read";
import { fullDay, isUuid, METHOD_TEXT, ONLY_VALID_PROOF, type ReceiptDocument } from "@/lib/documents";
import { rupees } from "@/lib/money";
import { when } from "@/lib/overview";

// One receipt, printable (F6; CTL-01). Everything printed is app.receipt_document's, as of this receipt:
// the page adds nothing up. The function answers null both for an id that does not exist and for a
// caller it refuses, so the page has one message for both. English only (doc 08).
export default function ReceiptView({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return isUuid(id) ? <Receipt id={id} /> : <NotFound />;
}

const NotFound = () => (
  <>
    <h1>Receipt</h1>
    <p className="error" role="alert">
      This receipt does not exist, or you may not read it.
    </p>
    <Link href="/office/invoices">Back to invoices and receipts</Link>
  </>
);

function Receipt({ id }: { id: string }) {
  const read = useRpcRead<ReceiptDocument | null>("receipt_document", { p_receipt_id: id }, id);
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

  return (
    <article>
      <p className="row no-print">
        <Link href="/office/invoices">Back to invoices and receipts</Link>
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
          <h1>Receipt {d.number}</h1>
          <div className="muted">Issued {when(d.issued_at)}</div>
        </div>
      </div>

      <dl>
        <dt>Salon</dt>
        <dd data-testid="doc-salon">{d.salon.name ?? "Unnamed salon"}</dd>
        <dt>Amount paid</dt>
        <dd className="doc-total">
          <strong data-testid="doc-total">{rupees(d.payment.amount_paisa)}</strong>
        </dd>
        <dt>Paid as</dt>
        <dd>{METHOD_TEXT[d.payment.method] ?? d.payment.method}</dd>
        {d.payment.bank_name && (
          <>
            <dt>Bank</dt>
            <dd>
              {d.payment.bank_name}
              {d.payment.bank_reference && `, reference ${d.payment.bank_reference}`}
            </dd>
          </>
        )}
        <dt>Recorded</dt>
        <dd>{when(d.payment.recorded_at)}</dd>
      </dl>

      <h2>Paid towards</h2>
      {d.allocations.length === 0 ? (
        <p className="muted">This payment was not allocated to an invoice.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Invoice</th>
              <th>Installment</th>
              <th>Amount</th>
            </tr>
          </thead>
          <tbody>
            {d.allocations.map((a) => (
              <tr key={`${a.invoice_number}-${a.seq}`} data-testid="doc-allocation">
                <td>{a.invoice_number}</td>
                <td>
                  {a.seq} of {a.of}
                </td>
                <td>{rupees(a.amount_paisa)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2>Still due after this payment</h2>
      {d.remaining.length === 0 ? (
        <p className="muted">Nothing was left to pay after this receipt.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Invoice</th>
              <th>Installment</th>
              <th>Due</th>
              <th>Still due</th>
            </tr>
          </thead>
          <tbody>
            {d.remaining.map((r) => (
              <tr key={`${r.invoice_number}-${r.seq}`}>
                <td>{r.invoice_number}</td>
                <td>
                  {r.seq} of {r.of}
                </td>
                <td>{fullDay(r.due_on)}</td>
                <td>{rupees(r.remaining_paisa)}</td>
              </tr>
            ))}
          </tbody>
        </table>
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
