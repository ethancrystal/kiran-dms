"use client";
import { useEffect, useRef, useState } from "react";
import { rpc } from "@/lib/rpc";
import { SignaturePad, type SignaturePadHandle } from "./signature-pad";

// The customer's acknowledgement of receipt, on the rep's phone, after the delivery is submitted (P1-31, D-49).
// The screen shows only what the customer needs: the salon's name, the goods and quantities being received, and the
// statement. It shows nothing of the company's internal records. The result is an electronic proof of receipt, not a
// legally qualified electronic signature, and it never blocks the delivery: the rep can skip it and the office sees
// that nothing was recorded. A refusal is recorded honestly with a reason.
export type AckLine = { label: string; qty: number };
export type AckResult = "signed" | "refused" | "unable" | "skipped";
/** What the person recording the acknowledgement sends: the rep's call or the office's, each with its own key and target. */
export type AckRecord = {
  outcome: "signed" | "refused" | "unable";
  name: string | null;
  designation: string | null;
  png: string | null;
  note: string | null;
  /** A key made once for this intent, so a second tap replays instead of recording twice. */
  key: string;
};

type Statement = { version: number; text: string };

const NAME_MIN = 2;
const NAME_MAX = 80;
const NOTE_MIN = 5;
const NOTE_MAX = 300;

export function Acknowledgement({
  salonName,
  lines,
  record,
  onDone,
  canSkip = true,
}: {
  salonName: string;
  lines: AckLine[];
  /** Records the acknowledgement: a rep for its submission (rep_attach_signature), or the office for a delivery it makes. */
  record: (a: AckRecord) => Promise<void>;
  onDone: (result: AckResult) => void;
  /** A rep may leave without recording (the delivery then cannot be approved); the office cannot deliver without one. */
  canSkip?: boolean;
}) {
  const pad = useRef<SignaturePadHandle>(null);
  const [statement, setStatement] = useState<Statement | null>(null);
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [ink, setInk] = useState(false);
  const [mode, setMode] = useState<"sign" | "no">("sign");
  const [why, setWhy] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One key per intent, kept across retries, so a second tap replays instead of recording twice.
  const [signKey] = useState(() => crypto.randomUUID());
  const [noKey] = useState(() => crypto.randomUUID());

  useEffect(() => {
    const load = async () => {
      try {
        setStatement(await rpc<Statement>("delivery_ack_text"));
      } catch (e) {
        setError((e as Error).message);
      }
    };
    void load();
  }, []);

  const sign = async () => {
    setBusy(true);
    setError(null);
    try {
      const png = pad.current?.toPng();
      if (!png) throw new Error("Please sign in the box first.");
      await record({ outcome: "signed", name: name.trim(), designation: role.trim(), png, note: null, key: signKey });
      onDone("signed");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const note = async (outcome: "refused" | "unable") => {
    setBusy(true);
    setError(null);
    try {
      await record({ outcome, name: null, designation: null, png: null, note: why.trim(), key: noKey });
      onDone(outcome);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const canSign =
    !busy && agreed && ink && name.trim().length >= NAME_MIN && role.trim().length >= NAME_MIN && statement !== null;
  const canNo = !busy && why.trim().length >= NOTE_MIN;

  return (
    <section className="card" aria-labelledby="ack-title" data-testid="acknowledgement">
      <h2 id="ack-title">Customer acknowledgement</h2>
      <p>
        <strong>{salonName}</strong> is receiving:
      </p>
      <ul className="plain" data-testid="ack-lines">
        {lines.map((l) => (
          <li key={l.label}>
            {l.qty} × {l.label}
          </li>
        ))}
      </ul>
      {statement && <p data-testid="ack-statement">{statement.text}</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {mode === "sign" ? (
        <>
          <label htmlFor="ack-name">Name of the person signing</label>
          <input id="ack-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={NAME_MAX} autoComplete="off" />
          <label htmlFor="ack-role">Their role at the salon (for example owner, manager, receptionist)</label>
          <input id="ack-role" value={role} onChange={(e) => setRole(e.target.value)} maxLength={NAME_MAX} autoComplete="off" />
          <p className="muted">Sign with a finger in the box.</p>
          <SignaturePad ref={pad} onInk={setInk} />
          <p>
            <button type="button" className="inline" onClick={() => pad.current?.clear()}>
              Clear the signature
            </button>
          </p>
          <label>
            <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} /> I have read the statement above
          </label>
          <p>
            <button type="button" disabled={!canSign} onClick={() => void sign()}>
              {busy ? "Saving…" : "Confirm and sign"}
            </button>
          </p>
          <p>
            <button type="button" className="inline" onClick={() => setMode("no")}>
              The customer cannot or will not sign
            </button>{" "}
            {canSkip && (
              <button type="button" className="inline" onClick={() => onDone("skipped")}>
                Skip for now
              </button>
            )}
          </p>
        </>
      ) : (
        <>
          <label htmlFor="ack-why">Why was it not signed? (the office will read this)</label>
          <textarea id="ack-why" value={why} onChange={(e) => setWhy(e.target.value)} maxLength={NOTE_MAX} rows={3} />
          <p>
            <button type="button" disabled={!canNo} onClick={() => void note("refused")}>
              {busy ? "Saving…" : "The customer refused"}
            </button>{" "}
            <button type="button" disabled={!canNo} onClick={() => void note("unable")}>
              No one could sign
            </button>
          </p>
          <p>
            <button type="button" className="inline" onClick={() => setMode("sign")}>
              Back to signing
            </button>
          </p>
        </>
      )}
    </section>
  );
}
