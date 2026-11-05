"use client";
import { ListState } from "@/components/confirm-action";
import { useRpcRead } from "@/components/use-rpc-read";
import { rupees } from "@/lib/money";
import { when } from "@/lib/overview";

type Collection = {
  payment_id: string;
  salon_id: string;
  salon_name: string | null;
  method: string;
  amount_paisa: number;
  recorded_at: string;
  receipt_number: string | null;
  reversed: boolean;
  reversed_at: string | null;
};

const METHOD_TEXT: Record<string, string> = { cash: "Cash", bank_transfer: "Bank transfer" };

// REP-09 (P1-30): the rep's own payments, newest 50, with their receipt numbers, so a receipt can be
// quoted again after the page is closed (app.my_collections; a rep on its approved phone, own rows only).
// With a salon id, only that salon's; without, every salon's with its name. A payment the office reversed
// says so (D-48).
export function MyCollections({ salonId, reloadKey = "" }: { salonId?: string; reloadKey?: string }) {
  const read = useRpcRead<Collection[]>("my_collections", { p_salon_id: salonId ?? null }, `${salonId ?? "all"}:${reloadKey}`);
  const list = read.data ?? [];
  return (
    <section className="card" aria-labelledby="collections-h">
      <h2 id="collections-h">{salonId ? "Payments you recorded here" : "Payments you recorded"}</h2>
      <ListState
        loading={read.loading}
        error={read.error}
        empty={list.length === 0}
        emptyText={salonId ? "You have not recorded a payment for this salon yet." : "You have not recorded any payments yet."}
      />
      {list.length > 0 && (
        <ul className="plain">
          {list.map((c) => (
            <li key={c.payment_id} data-testid="my-collection">
              <strong>{c.receipt_number ?? "No receipt"}</strong> · {rupees(Number(c.amount_paisa))} ·{" "}
              {METHOD_TEXT[c.method] ?? c.method}
              {!salonId && <> · {c.salon_name ?? "a salon you no longer cover"}</>}
              <br />
              <span className="muted">{when(c.recorded_at)}</span>
              {c.reversed && (
                <span className="error">
                  {" "}
                  · Reversed by the office{c.reversed_at ? ` on ${when(c.reversed_at)}` : ""}: it no longer counts as paid.
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {list.length > 0 && <p className="muted">Showing up to the newest 50.</p>}
    </section>
  );
}
