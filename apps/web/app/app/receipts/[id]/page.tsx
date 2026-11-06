"use client";
import Link from "next/link";
import { use } from "react";
import { ReceiptSheet } from "@/components/receipt-sheet";
import { useRpcRead } from "@/components/use-rpc-read";
import { isUuid, type ReceiptDocument } from "@/lib/documents";

// A receipt for the rep who recorded the payment. app.receipt_document answers null both for an id that
// does not exist and for a caller it refuses, so the page has one message for both.
export default function RepReceiptView({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return isUuid(id) ? <Receipt id={id} /> : <NotFound />;
}

const NotFound = () => (
  <>
    <h1>Receipt</h1>
    <p className="error" role="alert">
      This receipt does not exist, or it is not one you recorded.
    </p>
    <Link href="/app/handovers">Back to your payments</Link>
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
  if (!read.data) return <NotFound />;
  return (
    <article>
      <p className="row no-print">
        <Link href="/app/handovers">Back to your payments</Link>
      </p>
      <ReceiptSheet doc={read.data} />
    </article>
  );
}
