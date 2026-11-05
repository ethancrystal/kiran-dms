"use client";
import Link from "next/link";
import { use, useEffect, useState } from "react";
import { InvoiceSheet } from "@/components/invoice-sheet";
import { useRpcRead } from "@/components/use-rpc-read";
import { type InvoiceDocument, isUuid, type ReceiptRow } from "@/lib/documents";
import { rupees } from "@/lib/money";
import { when } from "@/lib/overview";
import { db, rows, rpc } from "@/lib/rpc";

type Refs = { order_id: string; salon_id: string };

// One issued invoice, printable (F6; ORD-05; P1-31, D-49). Everything printed is app.invoice_document's: the issue-time
// snapshot with the payments that moved since. A reprint reads the same snapshot and never creates another invoice. The
// office reads any invoice; the function answers null both for an id that does not exist and for a caller it refuses,
// so the page has one message for both. The customer's signature picture is fetched only when asked for (the database
// logs each opening). English only (doc 08, D-42).
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
  const [picture, setPicture] = useState<string | null>(null);
  const [pictureError, setPictureError] = useState<string | null>(null);
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
  const sigId = d.acknowledgement?.signature_id;

  const showSignature = async () => {
    if (!sigId) return;
    setPictureError(null);
    try {
      const b64 = await rpc<string>("office_signature_image", { p_signature_id: sigId, p_purpose: "printing the invoice" });
      setPicture(`data:image/png;base64,${b64}`);
    } catch (e) {
      setPictureError((e as Error).message);
    }
  };

  return (
    <article>
      <p className="row no-print">
        <Link href="/office/invoices">Back to invoices</Link>
        {refs && <Link href={`/office/orders/${refs.order_id}`}>Open the order</Link>}
        {refs && <Link href={`/office/salons/${refs.salon_id}`}>Open the salon</Link>}
        {sigId && !picture && (
          <button type="button" className="inline" onClick={() => void showSignature()}>
            Show the customer&apos;s signature on this copy
          </button>
        )}
        <button type="button" className="inline" onClick={() => window.print()}>
          Print or save as PDF
        </button>
      </p>
      {pictureError && (
        <p className="error no-print" role="alert">
          {pictureError}
        </p>
      )}
      <InvoiceSheet doc={d} signatureImage={picture} />

      <section className="no-print" aria-label="Receipts on this invoice">
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
      </section>
    </article>
  );
}
