"use client";
import { useCallback, useEffect, useState } from "react";
import { rpc } from "@/lib/rpc";

type Line = { sku_id: string; code: string; variant: string; qty: number };
type Submission = {
  submission_id: string;
  order_id: string;
  salon_id: string;
  salon_name: string | null;
  lines: Line[] | null;
  received_by_name: string;
  submitted_at: string;
  status: "pending" | "approved" | "rejected";
  reason: string | null;
  invoice_id: string | null;
  invoice_number: string | null;
  unsettled: number;
};

const when = (t: string) => new Date(t).toLocaleString("en-PK", { dateStyle: "medium", timeStyle: "short" });
const STATUS_TEXT: Record<Submission["status"], string> = {
  pending: "Waiting for approval",
  approved: "Approved",
  rejected: "Rejected",
};

// The rep's own delivery submissions (D-32): app.my_submissions, the newest 50. Waiting ones have no
// invoice yet; an approved one shows its invoice number and links to the salon's account, where the
// amount owed now appears; a rejected one shows the office's reason, and its goods stay with the office
// (pending custody) until the office settles them.
export default function MyDeliveries() {
  const [list, setList] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setList((await rpc<Submission[]>("my_submissions")) ?? []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <main>
      <p>
        <a href="/app">← Today</a>
      </p>
      <h1>My deliveries</h1>
      <p className="muted">
        Each delivery you send waits for the office. The invoice comes with the approval; collect payment after it.
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
      {!loading && !error && list.length === 0 && <p className="muted">You have sent no deliveries yet.</p>}
      {!error && list.length > 0 && (
        <ul className="plain">
          {list.map((s) => (
            <li key={s.submission_id}>
              <span className="badge">{STATUS_TEXT[s.status]}</span> <strong>{s.salon_name ?? "Unnamed salon"}</strong> ·{" "}
              {(s.lines ?? []).map((l) => `${l.qty} × ${l.code}`).join(", ")}
              <br />
              <span className="muted">
                Received by {s.received_by_name} · {when(s.submitted_at)}
              </span>
              {s.status === "approved" && s.invoice_number && (
                <>
                  <br />
                  Invoice <span data-testid="invoice-number">{s.invoice_number}</span> ·{" "}
                  <a href={`/app/salons/${s.salon_id}`}>See the salon&apos;s account</a>
                </>
              )}
              {s.status === "rejected" && (
                <>
                  <br />
                  The office&apos;s reason: {s.reason}
                  {s.unsettled > 0 && (
                    <>
                      <br />
                      <span className="muted">Goods wait for the office ({s.unsettled}).</span>
                    </>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
