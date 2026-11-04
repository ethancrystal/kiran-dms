"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ConfirmAction, ListState } from "@/components/confirm-action";
import { percent, toBasisPoints } from "@/lib/money";
import { db, rows, rpc } from "@/lib/rpc";
import { label } from "@/lib/salons";

type Pending = {
  salon_id: string;
  name: string | null;
  type: string;
  address: string | null;
  area_name: string;
  territory_name: string;
  proposed_by_name: string;
  created_at: string;
};
type Rep = { id: string; full_name: string };

const REP_LIMIT = 500;
// app.office_decide_salon refuses a rejection reason shorter than 5 characters (22023).
const REJECT_REASON_MIN_LENGTH = 5;

const when = (t: string) => new Date(t).toLocaleString("en-PK", { dateStyle: "medium", timeStyle: "short" });

// Salon approvals (D-35, D-36; spec section 3): pending salons, oldest first (app.office_pending_salons).
// The owner or a manager approves one, optionally with a rep (who alone then reaches it, R4) and a
// commission rate, or rejects it with a reason. A salon is decided once. The database decides.
export default function SalonApprovals() {
  const [pending, setPending] = useState<Pending[]>([]);
  const [reps, setReps] = useState<Rep[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [p, r] = await Promise.all([
        rpc<Pending[]>("office_pending_salons"),
        rows<Rep>(
          db()
            .from("user_profile")
            .select("id, full_name")
            .eq("role", "rep")
            .eq("status", "active")
            .order("full_name")
            .limit(REP_LIMIT),
        ),
      ]);
      setPending(p ?? []);
      setReps(r);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const done = async (m: string) => {
    setNotice(m);
    await load();
  };

  return (
    <>
      <p>
        <Link href="/office/salons">← Salons</Link>
      </p>
      <h1>Salon approvals</h1>
      {notice && <output className="ok">{notice}</output>}
      <ListState loading={loading} error={error} empty={pending.length === 0} emptyText="No salons are waiting for a decision." />
      {!loading && !error && pending.map((p) => <Decision key={p.salon_id} salon={p} reps={reps} onDone={done} />)}
    </>
  );
}

function Decision({ salon, reps, onDone }: { salon: Pending; reps: Rep[]; onDone: (m: string) => Promise<void> }) {
  const [repId, setRepId] = useState("");
  const [rate, setRate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One key per attempt; a retry after a lost answer is the same decision (H-08).
  const [clientId, setClientId] = useState(() => crypto.randomUUID());
  const [rejectId, setRejectId] = useState(() => crypto.randomUUID());
  const name = salon.name ?? "Unnamed salon";
  const rateBp = rate.trim() === "" ? null : toBasisPoints(rate);

  return (
    <section className="card" aria-label={name}>
      <h2>{name}</h2>
      <p className="muted">
        {label(salon.type)} · {salon.territory_name} · {salon.area_name}
        {salon.address ? ` · ${salon.address}` : ""} · proposed by {salon.proposed_by_name} on {when(salon.created_at)}
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          if (repId && rate.trim() !== "" && rateBp === null)
            return setError("Enter the rate as a percentage from 0 to 100, for example 2.5.");
          setBusy(true);
          try {
            await rpc("office_decide_salon", {
              p_client_id: clientId,
              p_salon_id: salon.salon_id,
              p_approve: true,
              p_reason: null,
              p_rep_id: repId || null,
              p_rate_bp: repId ? rateBp : null,
            });
            const who = reps.find((r) => r.id === repId)?.full_name;
            setClientId(crypto.randomUUID());
            await onDone(
              `Approved ${name}${who ? `, assigned to ${who}${rateBp === null ? "" : ` at ${percent(rateBp)}`}` : ""}.`,
            );
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label htmlFor={`rep-${salon.salon_id}`}>Rep (optional)</label>
        <select id={`rep-${salon.salon_id}`} value={repId} onChange={(e) => setRepId(e.target.value)}>
          <option value="">No direct rep: the reps covering its territory</option>
          {reps.map((r) => (
            <option key={r.id} value={r.id}>
              {r.full_name}
            </option>
          ))}
        </select>
        <label htmlFor={`rate-${salon.salon_id}`}>Commission rate, % (optional, needs a rep)</label>
        <input
          id={`rate-${salon.salon_id}`}
          inputMode="decimal"
          value={rate}
          onChange={(e) => setRate(e.target.value)}
          disabled={!repId}
          placeholder="2.5"
        />
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="row">
          <button type="submit" className="inline" disabled={busy}>
            {busy ? "Approving…" : "Approve"}
          </button>
        </div>
      </form>
      <ConfirmAction
        label="Reject"
        confirmLabel="Reject salon"
        danger
        reasonMinLength={REJECT_REASON_MIN_LENGTH}
        onConfirm={async (reason) => {
          await rpc("office_decide_salon", {
            p_client_id: rejectId,
            p_salon_id: salon.salon_id,
            p_approve: false,
            p_reason: reason,
          });
          setRejectId(crypto.randomUUID());
          await onDone(`Rejected ${name}.`);
        }}
      />
    </section>
  );
}
