"use client";
import { useCallback, useEffect, useState } from "react";
import { ConfirmAction, ListState } from "@/components/confirm-action";
import { rupees, toPaisa } from "@/lib/money";
import { db, mySession, type Role, rows, rpc } from "@/lib/rpc";
import { when } from "@/lib/time";

type Rep = { id: string; full_name: string };
type Cash = { in_paisa: number; out_paisa: number; balance_paisa: number };
// app.office_inactive_rep_cash (M7): reps who are suspended or offboarded and still hold cash.
type InactiveCash = { rep_id: string; full_name: string; status: "suspended" | "offboarded"; cash_paisa: number };
type Handover = {
  handover_id: string;
  rep_name: string;
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
  settled_by_name: string | null;
};

// app.owner_settle_handover and app.office_withdraw_handover take a reason of 5 to 300 characters.
const REASON_MIN = 5;

const STATUS_TEXT: Record<Handover["status"], string> = {
  pending: "Waiting for the rep",
  final: "Final",
  disputed: "Disputed: the owner settles it",
  settled: "Settled by the owner",
  withdrawn: "Withdrawn",
};
/**
 * Whose the difference is, in rupees, from the row's own figures. The dispute stores no amount of the rep's,
 * so "the rep's amount" is the expected figure the rep's ledger holds (ruling in the P1-30 TASK entry).
 */
function differenceText(h: Handover, whose: "rep" | "office") {
  const v = Number(h.variance_paisa);
  if (v === 0) return "no difference";
  const amount = rupees(Math.abs(v));
  if (whose === "rep") return v > 0 ? `the rep is short ${amount}` : `the rep is over ${amount}`;
  return v > 0 ? `the office absorbs ${amount}` : `the office records ${amount} extra`;
}
const SETTLEMENT_TEXT: Record<string, string> = {
  counted: "the counted amount stands; the difference stays recorded against the rep",
  rep: "the rep's amount was accepted; the difference is an office difference",
  withdrawn: "withdrawn before the rep answered; nothing moved",
};

// Evening cash handover (PAY-05, CTL-03, doc 09 §5). The owner or manager counts a rep's cash; the
// database computes what the rep should hold from the cash ledger, refuses a different figure without
// a reason, and moves the cash only when the rep acknowledges on their own phone (ACTIVITY A-15).
// D-46 (P1-30): only the owner settles a disputed count, with a reason, choosing the counted amount (the
// difference stays against the rep) or the rep's amount (an office difference); the cash then moves as on
// an acknowledgment. The owner, or a manager who did not make the count, may withdraw a count the rep has not
// answered (nothing moves), so a lost phone or a silent rep no longer blocks the next count. The buttons name
// the rupee figures from the row; the database refuses a manager withdrawing their own count, in its words.
export default function Handovers() {
  const [reps, setReps] = useState<Rep[]>([]);
  const [list, setList] = useState<Handover[]>([]);
  const [office, setOffice] = useState<Cash | null>(null);
  const [inactive, setInactive] = useState<InactiveCash[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [role, setRole] = useState<Role | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [r, h, c, me, idle] = await Promise.all([
        rows<Rep>(db().from("user_profile").select("id, full_name").eq("role", "rep").eq("status", "active").order("full_name")),
        rpc<Handover[]>("office_handovers"),
        rpc<Cash[]>("office_cash_position"),
        mySession(),
        rpc<InactiveCash[]>("office_inactive_rep_cash"),
      ]);
      setReps(r);
      setList(h ?? []);
      setOffice(c?.[0] ?? null);
      setInactive(idle ?? []);
      setRole(me?.role ?? null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  // One client id per row and action, kept until the database accepts it, so a retry replays (H-08).
  const [keys, setKeys] = useState<Record<string, string>>({});
  const keyFor = (k: string) => {
    const known = keys[k];
    if (known) return known;
    const fresh = crypto.randomUUID();
    setKeys((all) => ({ ...all, [k]: fresh }));
    return fresh;
  };
  const settle = async (h: Handover, outcome: "counted" | "rep", reason: string) => {
    setNotice(null);
    await rpc("owner_settle_handover", {
      p_client_id: keyFor(`settle:${h.handover_id}`),
      p_handover_id: h.handover_id,
      p_outcome: outcome,
      p_reason: reason,
    });
    setNotice(`Settled ${h.rep_name}'s handover. The rep can be counted again.`);
    await load();
  };
  const withdraw = async (h: Handover, reason: string) => {
    setNotice(null);
    await rpc("office_withdraw_handover", {
      p_client_id: keyFor(`withdraw:${h.handover_id}`),
      p_handover_id: h.handover_id,
      p_reason: reason,
    });
    setNotice(`Withdrew the count for ${h.rep_name}; nothing moved. Count again when the rep is here.`);
    await load();
  };

  return (
    <>
      <h1>Cash handover</h1>
      {office && (
        <p>
          Office cash: <strong data-testid="office-cash">{rupees(office.balance_paisa)}</strong>{" "}
          <span className="muted">
            (handed over and acknowledged or settled, and cash the office collected itself; bank deposits are not built yet)
          </span>
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
      {inactive.length > 0 && (
        <section className="card" aria-labelledby="inactive-cash-h">
          <h2 id="inactive-cash-h">Cash held by reps who are not active</h2>
          <p className="muted">
            These reps are suspended or have left, and the cash ledger still shows cash with them. They cannot answer a count on
            their phone, so they are not in the list above. To count one, make the rep active again on People first; the owner
            decides what to do when the rep will not come back.
          </p>
          <ul className="plain">
            {inactive.map((x) => (
              <li key={x.rep_id} data-testid="inactive-cash">
                {x.full_name} <span className="badge">{x.status === "suspended" ? "Suspended" : "Left"}</span>{" "}
                <strong>{rupees(x.cash_paisa)}</strong>
              </li>
            ))}
          </ul>
        </section>
      )}
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
                  {h.settlement && (
                    <span className="muted">
                      {" "}
                      · {SETTLEMENT_TEXT[h.settlement]} ({h.settled_by_name}: {h.settlement_reason})
                    </span>
                  )}
                  {h.status === "disputed" && role === "owner" && (
                    <div className="row">
                      <ConfirmAction
                        label={`Keep the counted ${rupees(h.counted_paisa)} (${differenceText(h, "rep")})`}
                        confirmLabel={`Settle at the counted ${rupees(h.counted_paisa)}`}
                        reasonLabel="Why (kept on the record)"
                        reasonMinLength={REASON_MIN}
                        onConfirm={(reason) => settle(h, "counted", reason)}
                      />
                      <ConfirmAction
                        label={`Accept the rep's ${rupees(h.expected_paisa)} (${differenceText(h, "office")})`}
                        confirmLabel={`Settle at the rep's ${rupees(h.expected_paisa)}`}
                        reasonLabel="Why (kept on the record)"
                        reasonMinLength={REASON_MIN}
                        onConfirm={(reason) => settle(h, "rep", reason)}
                      />
                    </div>
                  )}
                  {h.status === "disputed" && role !== "owner" && <p className="muted">Only the owner settles a dispute.</p>}
                  {h.status === "pending" && (
                    <div className="row">
                      <ConfirmAction
                        label="Withdraw this count"
                        confirmLabel="Withdraw the count"
                        reasonLabel="Why it is withdrawn"
                        reasonMinLength={REASON_MIN}
                        danger
                        onConfirm={(reason) => withdraw(h, reason)}
                      />
                    </div>
                  )}
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
