"use client";
import { useState } from "react";
import { ConfirmAction } from "@/components/confirm-action";
import { percent, toBasisPoints } from "@/lib/money";
import { rpc } from "@/lib/rpc";
import { label } from "@/lib/salons";
import { when } from "@/lib/time";

export type Signup = {
  request_id: string;
  salon_name: string;
  contact_name: string;
  email: string;
  type: string;
  address: string;
  created_at: string;
  similar_salons: Array<{ id: string; name: string; area_name: string }>;
};
export type Area = { id: string; name: string; territory: { name: string } | null };
export type Rep = { id: string; full_name: string };

// app.office_decide_signup refuses a rejection reason shorter than 5 characters (22023).
const REJECT_REASON_MIN_LENGTH = 5;

// Salons that signed up on their own (MJ 2026-11-09; app.office_pending_signups). The owner or a manager
// either makes the salon in an area, or attaches the login to an imported salon of the same name that has
// no account yet, optionally with a rep and a commission rate; or rejects the application with a reason.
// A request is decided once. The database decides and its words are shown.
export function SignupRequests({
  signups,
  areas,
  reps,
  onDone,
}: {
  signups: Signup[];
  areas: Area[];
  reps: Rep[];
  onDone: (message: string) => Promise<void>;
}) {
  if (signups.length === 0) return <p className="muted">No salons are waiting to be let in.</p>;
  return (
    <>
      {signups.map((s) => (
        <SignupDecision key={s.request_id} signup={s} areas={areas} reps={reps} onDone={onDone} />
      ))}
    </>
  );
}

function SignupDecision({
  signup,
  areas,
  reps,
  onDone,
}: {
  signup: Signup;
  areas: Area[];
  reps: Rep[];
  onDone: (message: string) => Promise<void>;
}) {
  const id = signup.request_id;
  // "" means a new salon in the chosen area; otherwise the id of the imported salon to attach to.
  const [attachTo, setAttachTo] = useState("");
  const [areaId, setAreaId] = useState("");
  const [repId, setRepId] = useState("");
  const [rate, setRate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One key per attempt; a retry after a lost answer is the same decision (H-08).
  const [clientId, setClientId] = useState(() => crypto.randomUUID());
  const [rejectId, setRejectId] = useState(() => crypto.randomUUID());
  const rateBp = rate.trim() === "" ? null : toBasisPoints(rate);

  return (
    <section className="card" aria-label={signup.salon_name}>
      <h3>{signup.salon_name}</h3>
      <p className="muted">
        {label(signup.type)} · {signup.address} · {signup.contact_name} ({signup.email}) · signed up on {when(signup.created_at)}
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          if (repId && rate.trim() !== "" && rateBp === null)
            return setError("Enter the rate as a percentage from 0 to 100, for example 2.5.");
          setBusy(true);
          try {
            await rpc("office_decide_signup", {
              p_client_id: clientId,
              p_request_id: id,
              p_approve: true,
              p_reason: null,
              p_area_id: attachTo ? null : areaId || null,
              p_existing_salon_id: attachTo || null,
              p_rep_id: repId || null,
              p_rate_bp: repId ? rateBp : null,
            });
            const who = reps.find((r) => r.id === repId)?.full_name;
            setClientId(crypto.randomUUID());
            await onDone(
              `Approved ${signup.salon_name}${who ? `, assigned to ${who}${rateBp === null ? "" : ` at ${percent(rateBp)}`}` : ""}.`,
            );
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {signup.similar_salons.length > 0 && (
          <>
            <label htmlFor={`attach-${id}`}>This salon may already be in the system</label>
            <select id={`attach-${id}`} value={attachTo} onChange={(e) => setAttachTo(e.target.value)}>
              <option value="">No: make a new salon</option>
              {signup.similar_salons.map((m) => (
                <option key={m.id} value={m.id}>
                  Attach to {m.name} ({m.area_name})
                </option>
              ))}
            </select>
          </>
        )}
        {!attachTo && (
          <>
            <label htmlFor={`area-${id}`}>Area for the new salon</label>
            <select id={`area-${id}`} required value={areaId} onChange={(e) => setAreaId(e.target.value)}>
              <option value="">Choose an area</option>
              {areas.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.territory ? `${a.territory.name} · ` : ""}
                  {a.name}
                </option>
              ))}
            </select>
          </>
        )}
        <label htmlFor={`signup-rep-${id}`}>Rep (optional)</label>
        <select id={`signup-rep-${id}`} value={repId} onChange={(e) => setRepId(e.target.value)}>
          <option value="">No direct rep: the reps covering its territory</option>
          {reps.map((r) => (
            <option key={r.id} value={r.id}>
              {r.full_name}
            </option>
          ))}
        </select>
        <label htmlFor={`signup-rate-${id}`}>Commission rate, % (optional, needs a rep)</label>
        <input
          id={`signup-rate-${id}`}
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
        confirmLabel="Reject application"
        danger
        reasonMinLength={REJECT_REASON_MIN_LENGTH}
        onConfirm={async (reason) => {
          await rpc("office_decide_signup", {
            p_client_id: rejectId,
            p_request_id: id,
            p_approve: false,
            p_reason: reason,
          });
          setRejectId(crypto.randomUUID());
          await onDone(`Rejected ${signup.salon_name}.`);
        }}
      />
    </section>
  );
}
