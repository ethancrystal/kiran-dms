"use client";
import Link from "next/link";
import { use, useCallback, useEffect, useState } from "react";
import { InvoiceSheet } from "@/components/invoice-sheet";
import { SubmissionSignature } from "@/components/submission-signature";
import { type InvoiceDocument, isUuid } from "@/lib/documents";
import { rpc } from "@/lib/rpc";

const NOTE_MAX = 500;
const DESCRIPTION_MAX = 120;

type OrderSignature = { covers_everything_left: boolean; signatory_name: string | null; signatory_designation: string | null };

// The invoice composer (P1-31, D-49): review the invoice as it would be issued, prepare its customer-facing text, and
// print the draft. It prepares DISPLAY text only: a description per product, notes and payment instructions. It changes
// no quantity, price, discount or SKU, posts nothing, and issues nothing. The invoice is issued only when the salon has
// signed for the goods and the office approves the delivery; quantity or price changes go through the flows that
// already own them (rejecting a delivery, the delivery form, pricing approvals), linked below. The preview is the
// database's (app.office_invoice_preview) and is marked as a draft. English only (D-42).
export default function Composer({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return isUuid(id) ? (
    <ComposerFor orderId={id} />
  ) : (
    <p className="error" role="alert">
      This order does not exist.
    </p>
  );
}

function ComposerFor({ orderId }: { orderId: string }) {
  const [submissionId, setSubmissionId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [doc, setDoc] = useState<InvoiceDocument | null>(null);
  const [text, setText] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState("");
  const [instructions, setInstructions] = useState("");
  const [orderSig, setOrderSig] = useState<OrderSignature | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  // The submission to preview comes from the link (?submission=…); read once in the browser.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("submission");
    setSubmissionId(q && isUuid(q) ? q : null);
    setReady(true);
  }, []);

  const load = useCallback(async () => {
    setError(null);
    try {
      const d = await rpc<InvoiceDocument>("office_invoice_preview", { p_order_id: orderId, p_submission_id: submissionId });
      setDoc(d);
      setNotes(d.notes ?? "");
      setInstructions(d.payment_instructions ?? "");
      setText(Object.fromEntries(d.lines.filter((l) => l.sku_id).map((l) => [l.sku_id as string, l.description ?? ""])));
      if (!submissionId) setOrderSig(await rpc<OrderSignature>("office_order_signature", { p_order_id: orderId }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [orderId, submissionId]);

  useEffect(() => {
    if (ready) void load();
  }, [ready, load]);

  const save = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await rpc("office_save_invoice_draft", {
        p_client_id: crypto.randomUUID(),
        p_order_id: orderId,
        p_notes: notes.trim() || null,
        p_payment_instructions: instructions.trim() || null,
        p_line_text: text,
      });
      setNotice("Saved. These words will be on the invoice when it is issued.");
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // What the sheet shows while typing: the typed words only. No figure is touched.
  const live: InvoiceDocument | null = doc
    ? {
        ...doc,
        notes: notes.trim() || null,
        payment_instructions: instructions.trim() || null,
        lines: doc.lines.map((l) => ({ ...l, description: (l.sku_id && text[l.sku_id]?.trim()) || l.description })),
      }
    : null;

  return (
    <>
      <p className="row no-print">
        <Link href={`/office/orders/${orderId}`}>Back to the order</Link>
        <Link href="/office/deliveries">Delivery approvals</Link>
      </p>
      <h1>Prepare the invoice</h1>
      <p className="muted no-print">
        This is a draft. It is not an invoice and has no number. You can change the words the customer reads. The quantities,
        prices and discounts come from the order and the approval and cannot be changed here.
      </p>
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
      {notice && <output className="ok">{notice}</output>}
      {doc && live && (
        <>
          <section className="card no-print" aria-labelledby="sign-h">
            <h2 id="sign-h">Customer signature</h2>
            {submissionId && <SubmissionSignature submissionId={submissionId} orderId={orderId} />}
            {!submissionId && orderSig?.covers_everything_left && (
              <p className="ok" data-testid="order-signature-ok">
                Signed by {orderSig.signatory_name} ({orderSig.signatory_designation}) for everything still to deliver.
              </p>
            )}
            {!submissionId && !orderSig?.covers_everything_left && (
              <p className="muted" data-testid="order-signature-missing">
                The salon has not signed yet. It signs when you deliver the goods from the order page, and a delivery is final
                only with that signature and the approval.
              </p>
            )}
          </section>

          <form
            className="card no-print"
            aria-label="Invoice text"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <h2>Words on the invoice</h2>
            {doc.lines.map((l) => (
              <div key={l.line_no}>
                <label htmlFor={`desc-${l.line_no}`}>
                  What the customer reads for {l.sku_code} ({l.qty} to deliver)
                </label>
                <input
                  id={`desc-${l.line_no}`}
                  value={l.sku_id ? (text[l.sku_id] ?? "") : ""}
                  maxLength={DESCRIPTION_MAX}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (l.sku_id) setText((all) => ({ ...all, [l.sku_id as string]: v }));
                  }}
                />
              </div>
            ))}
            <label htmlFor="inv-notes">A note for the customer (optional)</label>
            <textarea id="inv-notes" rows={2} value={notes} maxLength={NOTE_MAX} onChange={(e) => setNotes(e.target.value)} />
            <label htmlFor="inv-instructions">How to pay (optional)</label>
            <textarea
              id="inv-instructions"
              rows={2}
              value={instructions}
              maxLength={NOTE_MAX}
              onChange={(e) => setInstructions(e.target.value)}
            />
            <button type="submit" disabled={busy}>
              {busy ? "Saving…" : "Save these words"}
            </button>
          </form>

          <section className="card no-print" aria-labelledby="change-h">
            <h2 id="change-h">To change quantities, prices or discounts</h2>
            <ul>
              <li>
                Quantities: reject the delivery on <Link href="/office/deliveries">Delivery approvals</Link> so the rep can send
                it again, or deliver the right quantities from <Link href={`/office/orders/${orderId}`}>the order page</Link>.
              </li>
              <li>
                Prices and discounts: they follow the order and its approvals (<Link href="/office/approvals">Approvals</Link>).
                The invoice is never edited after it is issued.
              </li>
            </ul>
          </section>

          <p className="no-print">
            <button type="button" className="inline" onClick={() => window.print()}>
              Print the draft
            </button>
          </p>
          <InvoiceSheet doc={live} />
        </>
      )}
    </>
  );
}
