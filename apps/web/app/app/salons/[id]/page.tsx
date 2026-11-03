"use client";
import { use, useCallback, useEffect, useState } from "react";
import { ConfirmAction } from "@/components/confirm-action";
import { MoneySection } from "@/components/money-section";
import { rpc } from "@/lib/rpc";
import { findSalon, label, position, type SalonDetail, VISIT_OUTCOMES } from "@/lib/salons";

type Note = { id: string; author_id: string; body: string; created_at: string };
type Visit = {
  id: string;
  rep_id: string;
  outcome: string;
  arrived_at: string;
  distance_from_pin_m: number | null;
  notes: string | null;
};
type Stage = { from_stage: string | null; to_stage: string; trigger: string; reason: string | null; created_at: string };

// app.rep_create_card: an order card holds a note of 1 to 2000 characters.
const CARD_MAX = 2000;
const when = (t: string) => new Date(t).toLocaleString("en-PK", { dateStyle: "medium", timeStyle: "short" });

// One salon, the whole relationship the rep may see (execution map slice 3; SAL-05 in part,
// PIP-02 visits, MAP-03 notes, doc 06 §4 phone reveal, B-28 parking). Every list and action is
// an app.* function that checks the rep's territory again; a refusal is shown as the database
// words it.
export default function SalonPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [salon, setSalon] = useState<SalonDetail | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [visits, setVisits] = useState<Visit[]>([]);
  const [stages, setStages] = useState<Stage[]>([]);
  const [phone, setPhone] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const s = await findSalon(id);
      setSalon(s);
      if (s) {
        const [n, v, st] = await Promise.all([
          rpc<Note[]>("salon_notes", { p_salon_id: id }),
          rpc<Visit[]>("salon_visits", { p_salon_id: id }),
          rpc<Stage[]>("salon_stages", { p_salon_id: id }),
        ]);
        setNotes(n ?? []);
        setVisits(v ?? []);
        setStages(st ?? []);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);

  const done = async (m: string) => {
    setNotice(m);
    await load();
  };

  if (loading)
    return (
      <main>
        <p className="muted" aria-busy="true">
          Loading…
        </p>
      </main>
    );
  if (!salon)
    return (
      <main>
        <p className="error" role="alert">
          {error ?? "This salon is not in your territory."}
        </p>
        <a href="/app/salons">← Salons</a>
      </main>
    );

  return (
    <main>
      <p>
        <a href="/app/salons">← Salons</a>
      </p>
      <h1>{salon.name ?? "Unnamed salon"}</h1>
      <p className="muted">
        {salon.area_name} · {label(salon.type)} · <span className="badge">{label(salon.stage)}</span>
      </p>
      <p>
        {salon.address ?? <span className="muted">No address.</span>}
        {salon.chairs !== null && <span className="muted"> · {salon.chairs} chairs</span>}{" "}
        <a href={`/app/salons/${id}/edit`}>Edit</a>
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && <output className="ok">{notice}</output>}

      <section className="card" aria-labelledby="contact-h">
        <h2 id="contact-h">Contact</h2>
        <p>
          {phone ?? salon.phone_masked ?? "No phone recorded."}{" "}
          {salon.phone_masked && !phone && (
            <button
              type="button"
              className="inline"
              onClick={async () => {
                try {
                  setPhone((await rpc<string | null>("reveal_phone", { p_salon_id: id })) ?? "No phone recorded.");
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              Show number
            </button>
          )}
        </p>
        <p className="muted">Showing a number is recorded (doc 06 §4).</p>
      </section>

      <VisitForm
        salonId={id}
        onDone={async (o) => {
          await done(`Visit recorded: ${label(o)}.`);
        }}
      />

      <CardForm salonId={id} onDone={() => done("Order details saved. The office makes the order from them.")} />

      <MoneySection salonId={id} mode="rep" />

      <section aria-labelledby="notes-h">
        <h2 id="notes-h">
          Notes · <span lang="ur">نوٹس</span>
        </h2>
        <NoteForm salonId={id} onDone={() => done("Note added.")} />
        {notes.length === 0 ? (
          <p className="muted">No notes yet.</p>
        ) : (
          <ul className="plain">
            {notes.map((n) => (
              <li key={n.id}>
                {n.body}
                <br />
                <span className="muted">{when(n.created_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="visits-h">
        <h2 id="visits-h">Visits</h2>
        {visits.length === 0 ? (
          <p className="muted">No visits yet.</p>
        ) : (
          <ul className="plain">
            {visits.map((v) => (
              <li key={v.id}>
                <span className="badge">{label(v.outcome)}</span> {when(v.arrived_at)}
                {v.distance_from_pin_m !== null && <span className="muted"> · {v.distance_from_pin_m} m from the pin</span>}
                {v.notes && (
                  <>
                    <br />
                    {v.notes}
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="stages-h">
        <h2 id="stages-h">Stage history</h2>
        {stages.length === 0 && <p className="muted">No stage changes recorded.</p>}
        <ul className="plain">
          {stages.map((s) => (
            <li key={`${s.created_at}-${s.to_stage}`}>
              {s.from_stage ? `${label(s.from_stage)} → ` : ""}
              <strong>{label(s.to_stage)}</strong> <span className="muted">({label(s.trigger)})</span> {when(s.created_at)}
              {s.reason && <span className="muted"> · {s.reason}</span>}
            </li>
          ))}
        </ul>
      </section>

      {salon.stage !== "parked" && (
        <section aria-labelledby="park-h">
          <h2 id="park-h">Park this salon</h2>
          <p className="muted">For a salon that is not worth visiting for now. The office sees the reason.</p>
          <ConfirmAction
            label="Park"
            confirmLabel="Park salon"
            danger
            onConfirm={async (reason) => {
              await rpc("rep_park_salon", { p_salon_id: id, p_reason: reason });
              await done("Salon parked.");
            }}
          />
        </section>
      )}
    </main>
  );
}

function VisitForm({ salonId, onDone }: { salonId: string; onDone: (outcome: string) => Promise<void> }) {
  const [outcome, setOutcome] = useState<string>("intro");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clientId, setClientId] = useState(() => crypto.randomUUID());
  return (
    <form
      className="card"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          const gps = await position();
          if (!gps) throw new Error("A visit needs your location (PIP-02). Allow location for this site and try again.");
          await rpc("log_visit", {
            p_client_id: clientId,
            p_salon_id: salonId,
            p_outcome: outcome,
            p_lat: gps.lat,
            p_lng: gps.lng,
            p_arrived_at_client: new Date().toISOString(),
            p_notes: notes.trim() || null,
            p_mock_location: false,
          });
          setNotes("");
          setClientId(crypto.randomUUID());
          await onDone(outcome);
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <h2>
        Record a visit · <span lang="ur">دورہ درج کریں</span>
      </h2>
      <label htmlFor="outcome">Outcome</label>
      <select id="outcome" value={outcome} onChange={(e) => setOutcome(e.target.value)}>
        {VISIT_OUTCOMES.map((o) => (
          <option key={o} value={o}>
            {label(o)}
          </option>
        ))}
      </select>
      <label htmlFor="vnotes">Notes (optional)</label>
      <input id="vnotes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} />
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" disabled={busy}>
        {busy ? "Saving…" : "Record visit"}
      </button>
    </form>
  );
}

function NoteForm({ salonId, onDone }: { salonId: string; onDone: () => Promise<void> }) {
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clientId, setClientId] = useState(() => crypto.randomUUID());
  return (
    <form
      className="inline-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await rpc("add_salon_note", {
            p_client_id: clientId,
            p_salon_id: salonId,
            p_body: body.trim(),
            p_created_at_client: new Date().toISOString(),
          });
          setBody("");
          setClientId(crypto.randomUUID());
          await onDone();
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <label>
        New note
        <input value={body} onChange={(e) => setBody(e.target.value)} required maxLength={1000} />
      </label>
      <button type="submit" className="inline" disabled={busy}>
        {busy ? "Saving…" : "Add note"}
      </button>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

// New Order Details (ORD-14, D-30): reps no longer place orders; the rep writes down what the salon
// wants and the office makes the order from it. app.rep_create_card checks the rep, the approved phone,
// the open day and the territory, and its words are shown as they are. One key per attempt (H-08).
function CardForm({ salonId, onDone }: { salonId: string; onDone: () => Promise<void> }) {
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clientId, setClientId] = useState(() => crypto.randomUUID());
  return (
    <form
      className="card"
      aria-labelledby="card-h"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await rpc("rep_create_card", {
            p_client_id: clientId,
            p_salon_id: salonId,
            p_body: body.trim(),
            p_visit_id: null,
          });
          setBody("");
          setClientId(crypto.randomUUID());
          await onDone();
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <h2 id="card-h">New Order Details</h2>
      <p className="muted">Products, shades and quantities the salon wants. The office makes the order.</p>
      <label htmlFor="card-body">What the salon needs</label>
      <textarea id="card-body" rows={4} value={body} onChange={(e) => setBody(e.target.value)} required maxLength={CARD_MAX} />
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" disabled={busy}>
        {busy ? "Saving…" : "Save order details"}
      </button>
    </form>
  );
}
