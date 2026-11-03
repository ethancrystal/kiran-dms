"use client";
import { useCallback, useEffect, useState } from "react";
import { ListState } from "@/components/confirm-action";
import { rupees, toPaisa } from "@/lib/money";
import { db, rows, rpc } from "@/lib/rpc";

type Rep = { id: string; full_name: string };
type Cash = { in_paisa: number; out_paisa: number; balance_paisa: number };
type Handover = {
  handover_id: string;
  rep_name: string;
  counted_at: string;
  expected_paisa: number;
  counted_paisa: number;
  variance_paisa: number;
  variance_reason: string | null;
  counted_by_name: string;
  status: "pending" | "final" | "disputed";
  response_note: string | null;
};

const when = (t: string) => new Date(t).toLocaleString("en-PK", { dateStyle: "medium", timeStyle: "short" });
const STATUS_TEXT: Record<Handover["status"], string> = {
  pending: "Waiting for the rep",
  final: "Final",
  disputed: "Disputed: for the owner",
};

// Evening cash handover (PAY-05, CTL-03, doc 09 §5). The owner or manager counts a rep's cash; the
// database computes what the rep should hold from the cash ledger, refuses a different figure without
// a reason, and moves the cash only when the rep acknowledges on their own phone (ACTIVITY A-15).
export default function Handovers() {
  const [reps, setReps] = useState<Rep[]>([]);
  const [list, setList] = useState<Handover[]>([]);
  const [office, setOffice] = useState<Cash | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [r, h, c] = await Promise.all([
        rows<Rep>(db().from("user_profile").select("id, full_name").eq("role", "rep").eq("status", "active").order("full_name")),
        rpc<Handover[]>("office_handovers"),
        rpc<Cash[]>("office_cash_position"),
      ]);
      setReps(r);
      setList(h ?? []);
      setOffice(c?.[0] ?? null);
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
    <>
      <h1>Cash handover</h1>
      {office && (
        <p>
          Office cash: <strong data-testid="office-cash">{rupees(office.balance_paisa)}</strong>{" "}
          <span className="muted">(handed over and acknowledged; bank deposits are not built yet)</span>
        </p>
      )}
      {notice && <output className="ok">{notice}</output>}
      <CountForm
        reps={reps}
        onDone={async (m) => {
          setNotice(m);
          await load();
        }}
      />
      <h2>Handovers</h2>
      <ListState loading={loading} error={error} empty={list.length === 0} emptyText="No handovers yet." />
      {!loading && !error && list.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Rep</th>
              <th>Counted</th>
              <th>Expected</th>
              <th>Counted cash</th>
              <th>Short (+) / over (−)</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {list.map((h) => (
              <tr key={h.handover_id}>
                <td data-label="Rep">{h.rep_name}</td>
                <td data-label="Counted">
                  {when(h.counted_at)} <span className="muted">by {h.counted_by_name}</span>
                </td>
                <td data-label="Expected">{rupees(h.expected_paisa)}</td>
                <td data-label="Counted cash">{rupees(h.counted_paisa)}</td>
                <td data-label="Short (+) / over (−)">
                  {Number(h.variance_paisa) === 0 ? "—" : rupees(h.variance_paisa)}
                  {h.variance_reason && <span className="muted"> · {h.variance_reason}</span>}
                </td>
                <td data-label="Status">
                  <span className="badge">{STATUS_TEXT[h.status]}</span>
                  {h.response_note && <span className="muted"> · {h.response_note}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

function CountForm({ reps, onDone }: { reps: Rep[]; onDone: (message: string) => Promise<void> }) {
  const [repId, setRepId] = useState("");
  const [expected, setExpected] = useState<number | null>(null);
  const [counted, setCounted] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One key per count: a retry after a lost answer is the same handover (H-08).
  const [clientId, setClientId] = useState(() => crypto.randomUUID());

  useEffect(() => {
    setExpected(null);
    if (!repId) return;
    // What the database says this rep holds now; the count is checked against the database's own figure.
    const read = async () => {
      try {
        const c = await rpc<Cash[]>("office_rep_cash_position", { p_rep_id: repId });
        setExpected(Number(c?.[0]?.balance_paisa ?? 0));
      } catch (e) {
        setError((e as Error).message);
      }
    };
    void read();
  }, [repId]);

  const paisa = toPaisa(counted);
  const differs = expected !== null && paisa !== null && paisa !== expected;

  return (
    <form
      className="card"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          if (!repId) throw new Error("Choose the rep whose cash you counted.");
          if (paisa === null) throw new Error("Enter the counted cash in rupees, for example 1500 or 1500.50.");
          await rpc("office_count_handover", {
            p_client_id: clientId,
            p_rep_id: repId,
            p_counted_paisa: paisa,
            p_variance_reason: reason.trim() || null,
          });
          const name = reps.find((r) => r.id === repId)?.full_name ?? "the rep";
          setCounted("");
          setReason("");
          setRepId("");
          setClientId(crypto.randomUUID());
          await onDone(`Count recorded for ${name}. It is final when ${name} acknowledges it on their phone.`);
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <h2>Count a rep&apos;s cash</h2>
      <label htmlFor="ho-rep">Rep</label>
      <select id="ho-rep" value={repId} onChange={(e) => setRepId(e.target.value)}>
        <option value="">Choose a rep</option>
        {reps.map((r) => (
          <option key={r.id} value={r.id}>
            {r.full_name}
          </option>
        ))}
      </select>
      {expected !== null && (
        <p>
          Should hold: <strong data-testid="expected">{rupees(expected)}</strong>
        </p>
      )}
      <label htmlFor="ho-counted">Cash counted (Rs)</label>
      <input
        id="ho-counted"
        inputMode="decimal"
        autoComplete="off"
        value={counted}
        onChange={(e) => setCounted(e.target.value)}
        maxLength={12}
      />
      {differs && (
        <>
          <label htmlFor="ho-reason">Why the count differs</label>
          <input id="ho-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />
        </>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" disabled={busy}>
        {busy ? "Saving…" : "Record count"}
      </button>
    </form>
  );
}
