"use client";
import { InvoiceList, ReceiptList } from "@/components/document-lists";

// Invoices and receipts (F6; ORD-05, CTL-01). Owner and manager: the database lists them, newest first,
// and refuses anyone else. Each number opens the printable document. An invoice is issued when a
// delivery is recorded and a receipt when a payment is: nothing is created or changed from here.
export default function Invoices() {
  return (
    <>
      <h1>Invoices and receipts</h1>
      <p className="muted">Open a number to read or print the document.</p>
      <h2>Invoices</h2>
      <InvoiceList />
      <h2>Receipts</h2>
      <ReceiptList />
    </>
  );
}
