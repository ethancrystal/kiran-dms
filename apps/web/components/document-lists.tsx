"use client";
import Link from "next/link";
import { ListState } from "@/components/confirm-action";
import { useRpcRead } from "@/components/use-rpc-read";
import { type InvoiceRow, METHOD_TEXT, type ReceiptRow } from "@/lib/documents";
import { rupees } from "@/lib/money";
import { when } from "@/lib/overview";

/** "Newest 100 of 240" when the database's list stopped short of its total; nothing otherwise. */
function Capped({ shown, total }: { shown: number; total: number }) {
  if (total <= shown) return null;
  return (
    <p className="muted" data-testid="capped">
      Showing the newest {shown} of {total}.
    </p>
  );
}

// The invoices the database lists (app.office_invoices), all of them or one salon's.
export function InvoiceList({ salonId }: { salonId?: string }) {
  const read = useRpcRead<InvoiceRow[]>("office_invoices", salonId ? { p_salon_id: salonId } : {}, salonId ?? "all");
  const list = read.data ?? [];
  return (
    <>
      <ListState loading={read.loading} error={read.error} empty={list.length === 0} emptyText="No invoice yet." />
      {!read.loading && !read.error && list.length > 0 && (
        <>
          <Capped shown={list.length} total={Number(list[0].total_count)} />
          <table>
            <thead>
              <tr>
                <th>Invoice</th>
                {!salonId && <th>Salon</th>}
                <th>Amount</th>
                <th>Issued</th>
              </tr>
            </thead>
            <tbody>
              {list.map((i) => (
                <tr key={i.invoice_id} data-testid="invoice-row">
                  <td>
                    <Link href={`/office/invoices/${i.invoice_id}`}>{i.number}</Link>
                  </td>
                  {!salonId && (
                    <td>
                      <Link href={`/office/salons/${i.salon_id}`}>{i.salon_name ?? "Unnamed salon"}</Link>
                    </td>
                  )}
                  <td>{rupees(i.total_paisa)}</td>
                  <td>{when(i.issued_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </>
  );
}

// The receipts the database lists (app.office_receipts), all of them or one salon's.
export function ReceiptList({ salonId }: { salonId?: string }) {
  const read = useRpcRead<ReceiptRow[]>("office_receipts", salonId ? { p_salon_id: salonId } : {}, salonId ?? "all");
  const list = read.data ?? [];
  return (
    <>
      <ListState loading={read.loading} error={read.error} empty={list.length === 0} emptyText="No receipt yet." />
      {!read.loading && !read.error && list.length > 0 && (
        <>
          <Capped shown={list.length} total={Number(list[0].total_count)} />
          <table>
            <thead>
              <tr>
                <th>Receipt</th>
                {!salonId && <th>Salon</th>}
                <th>Amount</th>
                <th>Paid as</th>
                <th>Issued</th>
              </tr>
            </thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.receipt_id} data-testid="receipt-row">
                  <td>
                    <Link href={`/office/receipts/${r.receipt_id}`}>{r.number}</Link>
                  </td>
                  {!salonId && (
                    <td>
                      <Link href={`/office/salons/${r.salon_id}`}>{r.salon_name ?? "Unnamed salon"}</Link>
                    </td>
                  )}
                  <td>{rupees(r.amount_paisa)}</td>
                  <td>{METHOD_TEXT[r.method] ?? r.method}</td>
                  <td>{when(r.issued_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </>
  );
}
