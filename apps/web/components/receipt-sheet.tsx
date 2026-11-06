import { fullDay, METHOD_TEXT, ONLY_VALID_PROOF, type ReceiptDocument } from "@/lib/documents";
import { rupees } from "@/lib/money";
import { when } from "@/lib/overview";

// One receipt's printable body (F6; CTL-01), shared by the office and rep pages. Everything printed is
// app.receipt_document's: nothing is added up here. The office sees why a payment was reversed; a rep sees
// only that it was, as app.my_collections tells it.
export function ReceiptSheet({ doc: d, showReversalReason = false }: { doc: ReceiptDocument; showReversalReason?: boolean }) {
  return (
    <>
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

      {d.reversed && (
        <p className="error" data-testid="doc-reversed">
          This payment was reversed on {when(d.reversed.reversed_at)} and no longer counts as paid.
          {showReversalReason && ` Reason: ${d.reversed.reason}`}
        </p>
      )}

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
    </>
  );
}
