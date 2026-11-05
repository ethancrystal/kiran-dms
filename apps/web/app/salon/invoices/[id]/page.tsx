"use client";
import Link from "next/link";
import { use, useEffect, useState } from "react";
import { InvoiceSheet } from "@/components/invoice-sheet";
import { type InvoiceDocument, isUuid } from "@/lib/documents";
import { rpc } from "@/lib/rpc";

// One of the salon's own invoices, printable (P1-31, D-49). app.salon_invoice_document answers null for an invoice that
// is not this salon's, so another salon's id shows the same message as an id that does not exist. The signature picture is
// never sent to a salon; the sheet shows who signed and when.
export default function SalonInvoice({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [doc, setDoc] = useState<InvoiceDocument | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const load = async () => {
      if (!isUuid(id)) {
        setDoc(null);
        return;
      }
      try {
        setDoc(await rpc<InvoiceDocument | null>("salon_invoice_document", { p_invoice_id: id }));
      } catch (e) {
        setError((e as Error).message);
      }
    };
    void load();
  }, [id]);
  return (
    <main>
      <p className="row no-print">
        <Link href="/salon">Back to your account</Link>
        {doc && (
          <button type="button" className="inline" onClick={() => window.print()}>
            Print or save as PDF
          </button>
        )}
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {doc === undefined && !error && (
        <p className="muted" aria-busy="true">
          Loading…
        </p>
      )}
      {doc === null && (
        <p className="error" role="alert">
          This invoice does not exist, or it is not yours.
        </p>
      )}
      {doc && <InvoiceSheet doc={doc} />}
    </main>
  );
}
