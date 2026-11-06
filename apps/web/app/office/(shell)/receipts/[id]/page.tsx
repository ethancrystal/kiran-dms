"use client";
import Link from "next/link";
import { use } from "react";
import { ReceiptSheet } from "@/components/receipt-sheet";
import { useRpcRead } from "@/components/use-rpc-read";
import { isUuid, type ReceiptDocument } from "@/lib/documents";

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
      <ReceiptSheet doc={d} showReversalReason />
    </article>
  );
}
