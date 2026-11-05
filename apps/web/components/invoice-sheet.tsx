import { fullDay, type InvoiceDocument, ONLY_VALID_PROOF } from "@/lib/documents";
import { rupees } from "@/lib/money";
import { when } from "@/lib/overview";

// The A4 invoice (P1-31, D-49), for the issued invoice, the draft preview and the salon's copy. It prints what the
// database returned and adds nothing up: every figure is app.invoice_document's, app.office_invoice_preview's or
// app.salon_invoice_document's, in integer paisa shown as rupees. A draft is marked on the page and in the watermark and
// has no number. Company details show only where the owner has set them; nothing is invented. English only (D-42).
// Columns of the items table: quantity, description, unit, [expiry], rate, discount, net. The totals rows span the
// columns before the amount, so their spans follow whether the expiry column is shown.
const BASE_LABEL_SPAN = 2;
const EXPIRY_EXTRA = 1;
const COLUMNS_BEFORE_AMOUNT = 5;

export function InvoiceSheet({ doc, signatureImage }: { doc: InvoiceDocument; signatureImage?: string | null }) {
  const draft = doc.status === "draft";
  const c = doc.company;
  const cust = doc.customer ?? {
    reference: null,
    name: doc.salon?.name ?? null,
    contact_person: null,
    telephone: null,
    billing_address: doc.salon?.address ?? null,
    area: doc.salon?.area ?? null,
  };
  const showExpiry = doc.lines.some((l) => l.expiry);
  const ack = doc.acknowledgement;
  const hasPaid = typeof doc.paid_paisa === "number";
  const labelSpan = BASE_LABEL_SPAN + (showExpiry ? EXPIRY_EXTRA : 0);
  const beforeAmount = COLUMNS_BEFORE_AMOUNT + (showExpiry ? EXPIRY_EXTRA : 0);
  const dateText = draft ? "On issue" : doc.issue_date ? fullDay(doc.issue_date) : when(doc.issued_at ?? "");
  return (
    <article className={`invoice-sheet${draft ? " is-draft" : ""}`} data-testid="invoice-sheet">
      {draft && (
        <output className="draft-banner" data-testid="draft-banner">
          {doc.banner ?? "DRAFT — NOT AN OFFICIAL INVOICE"}
        </output>
      )}
      <header className="inv-head">
        <div className="inv-company">
          <strong className="inv-company-name">{c.name_en ?? "Company name not set"}</strong>
          {c.address && <div>{c.address}</div>}
          {c.city && !c.address && <div>{c.city}</div>}
          {(c.phone || c.email) && (
            <div>
              {c.phone}
              {c.phone && c.email ? " · " : ""}
              {c.email}
            </div>
          )}
          {c.website && <div>{c.website}</div>}
          {c.tax_registration && <div>Tax registration: {c.tax_registration}</div>}
        </div>
        <div className="inv-title">
          <h1>{draft ? "Invoice (draft)" : `Invoice ${doc.number}`}</h1>
          <div data-testid="doc-number">{draft ? "No number until it is issued" : doc.number}</div>
        </div>
      </header>

      <section className="inv-meta" aria-label="Invoice details">
        <dl>
          <dt>Invoice date</dt>
          <dd>{dateText}</dd>
          {doc.order_reference && (
            <>
              <dt>Order reference</dt>
              <dd>{doc.order_reference}</dd>
            </>
          )}
          {doc.sales_officer && (
            <>
              <dt>Sales officer</dt>
              <dd data-testid="doc-officer">{doc.sales_officer}</dd>
            </>
          )}
          {doc.delivery_person && (
            <>
              <dt>Delivered by</dt>
              <dd data-testid="doc-deliverer">{doc.delivery_person}</dd>
            </>
          )}
          <dt>Payment terms</dt>
          <dd>{doc.plan?.name ?? doc.plan?.code ?? ""}</dd>
        </dl>
        <dl>
          <dt>Customer</dt>
          <dd data-testid="doc-salon">{cust.name ?? "Unnamed salon"}</dd>
          {cust.reference && (
            <>
              <dt>Customer ID</dt>
              <dd>{cust.reference}</dd>
            </>
          )}
          {cust.contact_person && (
            <>
              <dt>Contact</dt>
              <dd>{cust.contact_person}</dd>
            </>
          )}
          {cust.telephone && (
            <>
              <dt>Telephone</dt>
              <dd>{cust.telephone}</dd>
            </>
          )}
          {(cust.billing_address || cust.area) && (
            <>
              <dt>Billing address</dt>
              <dd>{[cust.billing_address, cust.area].filter(Boolean).join(", ")}</dd>
            </>
          )}
        </dl>
      </section>

      <table className="inv-items">
        <thead>
          <tr>
            <th>Qty</th>
            <th>Description</th>
            <th>UOM</th>
            {showExpiry && <th>Expiry</th>}
            <th className="num">Rate</th>
            <th className="num">Discount</th>
            <th className="num">Net amount</th>
          </tr>
        </thead>
        <tbody>
          {doc.lines.map((l) => (
            <tr key={l.line_no} data-testid="doc-line">
              <td>{l.qty}</td>
              <td>
                {l.description ?? `${l.product}${l.variant ? ` ${l.variant}` : ""}`}
                <div className="muted inv-sku">{l.sku_code}</div>
              </td>
              <td>{l.uom ?? ""}</td>
              {showExpiry && <td>{l.expiry ?? ""}</td>}
              <td className="num">{rupees(l.unit_price_paisa)}</td>
              <td className="num">{rupees(l.discount_paisa ?? 0)}</td>
              <td className="num">{rupees(l.line_total_paisa)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td>{doc.total_qty ?? ""}</td>
            <td colSpan={labelSpan}>Total quantity</td>
            <td className="num" colSpan={2}>
              Gross
            </td>
            <td className="num">{rupees(doc.totals.subtotal_paisa)}</td>
          </tr>
          <tr>
            <td colSpan={beforeAmount} className="num">
              Total discount
            </td>
            <td className="num">{rupees(doc.totals.discount_paisa)}</td>
          </tr>
          <tr className="inv-net">
            <td colSpan={beforeAmount} className="num">
              <strong>Net amount due</strong>
            </td>
            <td className="num">
              <strong data-testid="doc-total">{rupees(doc.totals.total_paisa)}</strong>
            </td>
          </tr>
          {hasPaid && (
            <>
              <tr>
                <td colSpan={beforeAmount} className="num">
                  Paid so far
                </td>
                <td className="num" data-testid="doc-paid">
                  {rupees(doc.paid_paisa ?? 0)}
                </td>
              </tr>
              <tr>
                <td colSpan={beforeAmount} className="num">
                  Still to pay
                </td>
                <td className="num" data-testid="doc-outstanding">
                  {rupees(doc.outstanding_paisa ?? 0)}
                </td>
              </tr>
            </>
          )}
        </tfoot>
      </table>

      {doc.schedule.length > 0 && (
        <section className="inv-block" aria-label="When it is due">
          <h2>When it is due</h2>
          <table>
            <thead>
              <tr>
                <th>Installment</th>
                <th>Due</th>
                <th>Share</th>
                <th className="num">Amount</th>
              </tr>
            </thead>
            <tbody>
              {doc.schedule.map((s) => (
                <tr key={s.no}>
                  <td>
                    {s.no} of {s.of}
                  </td>
                  <td>{fullDay(s.due_on)}</td>
                  <td>{s.pct}%</td>
                  <td className="num">{rupees(s.amount_paisa)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {doc.notes && (
        <section className="inv-block">
          <h2>Notes</h2>
          <p data-testid="doc-notes">{doc.notes}</p>
        </section>
      )}
      {doc.payment_instructions && (
        <section className="inv-block">
          <h2>Payment instructions</h2>
          <p data-testid="doc-instructions">{doc.payment_instructions}</p>
        </section>
      )}
      {doc.bank_accounts.length > 0 && (
        <section className="inv-block">
          <h2>Pay into</h2>
          <ul className="plain">
            {doc.bank_accounts.map((b) => (
              <li key={b.account_no}>
                {b.bank} · {b.account_title} · {b.account_no}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="inv-sign" aria-label="Signatures">
        <div className="inv-sign-box">
          <div className="inv-sign-line" />
          <div>Authorized company representative</div>
          {c.signatory_name && (
            <div className="muted">
              {c.signatory_name}
              {c.signatory_title ? `, ${c.signatory_title}` : ""}
            </div>
          )}
        </div>
        <div className="inv-sign-box" data-testid="doc-ack">
          {signatureImage ? (
            // The customer's signature as a data URL from the database; only the office ever receives it.
            // biome-ignore lint/performance/noImgElement: a data URL is not an optimisable remote image.
            <img src={signatureImage} alt="The customer's signature" className="inv-sign-img" />
          ) : (
            <div className="inv-sign-line" />
          )}
          <div>Receiving salon representative</div>
          {ack && ack.outcome === "signed" && (
            <div className="muted">
              {ack.signatory_name}, {ack.signatory_designation} · signed {when(ack.signed_at)}
            </div>
          )}
          {!draft && !ack && <div className="muted">Acknowledgement not on record (issued before signatures were kept).</div>}
        </div>
      </section>

      <footer className="inv-foot">
        <p className="doc-notice" data-testid="doc-proof">
          {ONLY_VALID_PROOF}
        </p>
        {doc.notices.map((n) => (
          <p key={n.code} className="doc-notice">
            {n.en}
          </p>
        ))}
        {ack && (
          <p className="muted">
            The salon&apos;s signature is an electronic record of receipt, not a legally qualified electronic signature.
          </p>
        )}
      </footer>
    </article>
  );
}
