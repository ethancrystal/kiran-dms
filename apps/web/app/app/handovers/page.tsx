"use client";
import { useCallback, useEffect, useState } from "react";
import { MyCollections } from "@/components/my-collections";
import { rupees } from "@/lib/money";
import { rpc } from "@/lib/rpc";

type Handover = {
  handover_id: string;
  counted_at: string;
  expected_paisa: number;
  counted_paisa: number;
  variance_paisa: number;
  variance_reason: string | null;
  counted_by_name: string;
  status: "pending" | "final" | "disputed" | "settled" | "withdrawn";
  response_note: string | null;
  settlement: "counted" | "rep" | "withdrawn" | null;
  settlement_reason: string | null;
  settled_at: string | null;
};
type Cash = { balance_paisa: number };

const when = (t: string) => new Date(t).toLocaleString("en-PK", { dateStyle: "medium", timeStyle: "short" });
const STATUS_TEXT: Record<Handover["status"], string> = {
  pending: "Waiting for you",
  final: "Final",
  disputed: "Disputed: waiting for the owner's decision",
  settled: "Settled by the owner",
  withdrawn: "Withdrawn by the office",
};
// D-46: what the owner decided, in the rep's words.
const SETTLEMENT_TEXT: Record<string, string> = {
  counted: "The owner kept the counted amount. The difference stays recorded against you.",
  rep: "The owner accepted your amount. The difference is recorded as the office's.",
  withdrawn: "The office withdrew this count. Nothing moved; you will be counted again.",
};

// The rep's side of the handover (CTL-03, doc 08: "the rep acknowledges the counted figure in their
// own app"). The count is final only when the rep acknowledges it here; a dispute needs a reason and
// moves nothing. The database checks it is this rep, on the approved phone, answering once. The owner
// settles a dispute (D-46) and the office may withdraw a count not yet answered; the rep sees which and why.
export default function MyHandovers() {
  const [list, setList] = useState<Handover[]>([]);
  const [cash, setCash] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [h, c] = await Promise.all([rpc<Handover[]>("my_handovers"), rpc<Cash[]>("my_cash_position")]);
      setList(h ?? []);
      setCash(Number(c?.[0]?.balance_paisa ?? 0));
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
      <h1>Cash handover</h1>
      {cash !== null && (
        <p>
          Cash you should have: <strong data-testid="my-cash">{rupees(cash)}</strong>
        </p>
      )}
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
      {!loading && !error && list.length === 0 && <p className="muted">No handovers yet.</p>}
      {list.map((h) => (
        <section className="card" key={h.handover_id} aria-label={`Handover counted ${when(h.counted_at)}`}>
          <p>
            Counted {when(h.counted_at)} by {h.counted_by_name}: <strong>{rupees(h.counted_paisa)}</strong>{" "}
            <span className="muted">(you should have had {rupees(h.expected_paisa)})</span>
          </p>
          {Number(h.variance_paisa) !== 0 && (
            <p className="error">
              Difference {rupees(h.variance_paisa)}
              {h.variance_reason && <> · {h.variance_reason}</>}
            </p>
          )}
          <p>
            <span className="badge">{STATUS_TEXT[h.status]}</span>
            {h.response_note && <span className="muted"> · {h.response_note}</span>}
          </p>
          {h.settlement && (
            <p data-testid="handover-settlement">
              {SETTLEMENT_TEXT[h.settlement]} <span className="muted">Reason: {h.settlement_reason}</span>
            </p>
          )}
          {h.status === "pending" && (
            <Answer
              handoverId={h.handover_id}
              onDone={async (m) => {
                setNotice(m);
                await load();
              }}
            />
          )}
        </section>
      ))}
      <MyCollections />
    </main>
  );
}

function Answer({ handoverId, onDone }: { handoverId: string; onDone: (message: string) => Promise<void> }) {
  const [disputing, setDisputing] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One key per answer: a retry after a lost answer is the same answer (H-08).
  const [clientId] = useState(() => crypto.randomUUID());

  const send = async (accept: boolean) => {
    setBusy(true);
    setError(null);
    try {
      await rpc("rep_respond_handover", {
        p_client_id: clientId,
        p_handover_id: handoverId,
        p_accept: accept,
        p_note: accept ? null : note.trim() || null,
      });
      await onDone(
        accept ? "Acknowledged. The handover is final." : "Disputed. The owner decides it, and you will see the decision here.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      {!disputing ? (
        <div className="row">
          <button type="button" disabled={busy} onClick={() => send(true)}>
            The count is right
          </button>
          <button type="button" className="inline danger" disabled={busy} onClick={() => setDisputing(true)}>
            I disagree
          </button>
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send(false);
          }}
        >
          <label htmlFor={`note-${handoverId}`}>What is wrong with the count?</label>
          <input id={`note-${handoverId}`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
          <button type="submit" disabled={busy}>
            Send dispute
          </button>
        </form>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
