"use client";
import { useCallback, useEffect, useState } from "react";
import { Acknowledgement } from "@/components/acknowledgement";
import { ListCapNote } from "@/components/list-cap-note";
import { rpc } from "@/lib/rpc";
import { when } from "@/lib/time";

// app.my_submissions reads the newest 50 (migration 20261105130100).
const CAP = 50;

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

const STATUS_TEXT: Record<Submission["status"], string> = {
  pending: "Waiting for approval",
  approved: "Approved",
  rejected: "Rejected",
};

type Signature = {
  outcome: "signed" | "refused" | "unable";
  signatory_name: string | null;
  signed_at: string;
  valid: boolean;
} | null;
const ACK_TEXT = {
  signed: "The customer has signed for these goods.",
  refused: "The customer refused to sign. The office cannot approve this delivery.",
  unable: "No one could sign. The office cannot approve this delivery.",
} as const;

// One waiting delivery's acknowledgement (P1-31, D-49): a delivery is final only with the salon's signature and the
// office's approval, so a waiting delivery without a valid signed acknowledgement offers to take it now.
function WaitingSignature({ s, onChanged }: { s: Submission; onChanged: () => Promise<void> }) {
  const [sig, setSig] = useState<Signature | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      setSig(await rpc<Signature>("my_signature_status", { p_submission_id: s.submission_id }));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [s.submission_id]);
  useEffect(() => {
    void load();
  }, [load]);
  const signed = sig?.outcome === "signed" && sig.valid;
  return (
    <div data-testid="waiting-signature">
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {signed && <span className="ok">{ACK_TEXT.signed}</span>}
      {sig && sig.outcome !== "signed" && <span className="error">{ACK_TEXT[sig.outcome]}</span>}
      {sig === null && (
        <span className="error">The customer has not signed yet. The office cannot approve this delivery without it.</span>
      )}
      {sig !== undefined && !signed && !open && (
        <p>
          <button type="button" className="inline" onClick={() => setOpen(true)}>
            Get the customer&apos;s signature
          </button>
        </p>
      )}
      {open && (
        <Acknowledgement
          salonName={s.salon_name ?? "the salon"}
          lines={(s.lines ?? []).map((l) => ({ label: `${l.code} ${l.variant}`, qty: l.qty }))}
          onDone={async () => {
            setOpen(false);
            await load();
            await onChanged();
          }}
          record={async (a) => {
            await rpc("rep_attach_signature", {
              p_client_id: a.key,
              p_submission_id: s.submission_id,
              p_outcome: a.outcome,
              p_name: a.name,
              p_designation: a.designation,
              p_png_base64: a.png,
              p_note: a.note,
            });
          }}
        />
      )}
    </div>
  );
}

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
      <ListCapNote shown={list.length} cap={CAP} what="deliveries" />
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
              {s.status === "pending" && <WaitingSignature s={s} onChanged={load} />}
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
