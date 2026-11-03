"use client";
import { useCallback, useEffect, useState } from "react";
import { ConfirmAction, ListState } from "@/components/confirm-action";
import { db, rows, rpc } from "@/lib/rpc";

type Territory = { id: string; name: string; active: boolean };
type Area = { id: string; territory_id: string; name: string; active: boolean };
type Assignment = { id: string; rep_id: string; territory_id: string; from_date: string; to_date: string | null };
type Person = { id: string; full_name: string; role: string; status: string };

// PIP-01: territories, their areas, and which rep covers which territory. Owner or manager at
// AAL2 (app.office_* functions). A rep sees only salons in territories assigned to them, and an
// assignment ends with a reason (the rep loses those salons at once; H-14). Areas and territories
// are never deleted, only made inactive (H-07).
export default function Territories() {
  const [territories, setTerritories] = useState<Territory[]>([]);
  const [areas, setAreas] = useState<Area[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // A refused action is shown above the list; `error` is only for a list that could not load,
  // so a refusal never hides the territories (B-35).
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [t, a, r, p] = await Promise.all([
        rows<Territory>(db().from("territory").select("id, name, active").order("name").limit(500)),
        rows<Area>(db().from("area").select("id, territory_id, name, active").order("name").limit(2000)),
        rows<Assignment>(
          db().from("rep_territory").select("id, rep_id, territory_id, from_date, to_date").is("to_date", null).limit(2000),
        ),
        rows<Person>(db().from("user_profile").select("id, full_name, role, status").limit(500)),
      ]);
      setTerritories(t);
      setAreas(a);
      setAssignments(r);
      setPeople(p);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const done = async (message: string) => {
    setActionError(null);
    setNotice(message);
    await load();
  };
  const personName = (id: string) => people.find((p) => p.id === id)?.full_name ?? "Unknown rep";
  const reps = people.filter((p) => p.role === "rep" && p.status === "active");

  return (
    <>
      <h1>Territories</h1>
      {notice && <output className="ok">{notice}</output>}
      {actionError && (
        <p className="error" role="alert">
          {actionError}
        </p>
      )}
      <NameForm
        label="New territory"
        button="Add territory"
        onSubmit={async (name) => {
          await rpc("office_upsert_territory", { p_id: crypto.randomUUID(), p_name: name, p_active: true });
          await done(`Added territory ${name}.`);
        }}
      />
      <ListState
        loading={loading}
        error={error}
        empty={territories.length === 0}
        emptyText="No territories yet. Add the first one above."
      />
      {!loading &&
        !error &&
        territories.map((t) => {
          const tAreas = areas.filter((a) => a.territory_id === t.id);
          const tReps = assignments.filter((a) => a.territory_id === t.id);
          return (
            <section key={t.id} className="card" aria-labelledby={`t-${t.id}`}>
              <div className="row spread">
                <h2 id={`t-${t.id}`}>
                  {t.name} {!t.active && <span className="badge suspended">inactive</span>}
                </h2>
                {t.active && tReps.length > 0 && (
                  <span className="muted">End its rep assignments first to make it inactive.</span>
                )}
                <button
                  type="button"
                  className="inline link"
                  disabled={t.active && tReps.length > 0}
                  onClick={async () => {
                    try {
                      await rpc("office_upsert_territory", { p_id: t.id, p_name: t.name, p_active: !t.active });
                      await done(`${t.name} is now ${t.active ? "inactive" : "active"}.`);
                    } catch (e) {
                      setNotice(null);
                      setActionError((e as Error).message);
                    }
                  }}
                >
                  {t.active ? "Make inactive" : "Make active"}
                </button>
              </div>

              <h3>Areas</h3>
              {tAreas.length === 0 ? (
                <p className="muted">No areas yet.</p>
              ) : (
                <ul className="plain">
                  {tAreas.map((a) => (
                    <li key={a.id}>
                      {a.name} {!a.active && <span className="badge suspended">inactive</span>}{" "}
                      <button
                        type="button"
                        className="inline link"
                        onClick={async () => {
                          try {
                            await rpc("office_upsert_area", {
                              p_id: a.id,
                              p_territory_id: t.id,
                              p_name: a.name,
                              p_active: !a.active,
                            });
                            await done(`${a.name} is now ${a.active ? "inactive" : "active"}.`);
                          } catch (e) {
                            setNotice(null);
                            setActionError((e as Error).message);
                          }
                        }}
                      >
                        {a.active ? "Make inactive" : "Make active"}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <NameForm
                label={`New area in ${t.name}`}
                button="Add area"
                onSubmit={async (name) => {
                  await rpc("office_upsert_area", {
                    p_id: crypto.randomUUID(),
                    p_territory_id: t.id,
                    p_name: name,
                    p_active: true,
                  });
                  await done(`Added area ${name} to ${t.name}.`);
                }}
              />

              <h3>Reps covering it</h3>
              {tReps.length === 0 ? (
                <p className="muted">No rep is assigned.</p>
              ) : (
                <ul className="plain">
                  {tReps.map((a) => (
                    <li key={a.id}>
                      {personName(a.rep_id)} <span className="muted">since {a.from_date}</span>{" "}
                      <ConfirmAction
                        label="End"
                        confirmLabel="End assignment"
                        danger
                        onConfirm={async (reason) => {
                          await rpc("office_end_territory", { p_rep_id: a.rep_id, p_territory_id: t.id, p_reason: reason });
                          await done(`${personName(a.rep_id)} no longer covers ${t.name}.`);
                        }}
                      />
                    </li>
                  ))}
                </ul>
              )}
              {t.active && (
                <AssignRep
                  reps={reps.filter((r) => !tReps.some((a) => a.rep_id === r.id))}
                  onAssign={async (repId) => {
                    await rpc("office_assign_territory", { p_rep_id: repId, p_territory_id: t.id });
                    await done(`${personName(repId)} now covers ${t.name}.`);
                  }}
                />
              )}
            </section>
          );
        })}
    </>
  );
}

function NameForm({ label, button, onSubmit }: { label: string; button: string; onSubmit: (name: string) => Promise<void> }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="inline-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await onSubmit(name.trim());
          setName("");
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <label>
        {label}
        <input value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={80} />
      </label>
      <button type="submit" className="inline" disabled={busy}>
        {busy ? "Saving…" : button}
      </button>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

function AssignRep({ reps, onAssign }: { reps: Person[]; onAssign: (repId: string) => Promise<void> }) {
  const [repId, setRepId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (reps.length === 0) return <p className="muted">No other active rep to assign.</p>;
  return (
    <form
      className="inline-form"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!repId) return;
        setBusy(true);
        setError(null);
        try {
          await onAssign(repId);
          setRepId("");
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <label>
        Assign a rep
        <select value={repId} onChange={(e) => setRepId(e.target.value)} required>
          <option value="">Choose a rep</option>
          {reps.map((r) => (
            <option key={r.id} value={r.id}>
              {r.full_name}
            </option>
          ))}
        </select>
      </label>
      <button type="submit" className="inline" disabled={busy || !repId}>
        {busy ? "Saving…" : "Assign"}
      </button>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
