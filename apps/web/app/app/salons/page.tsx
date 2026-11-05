"use client";
import { useCallback, useEffect, useState } from "react";
import { label, type Salon, salonPage } from "@/lib/salons";

// The rep's salons (execution map slice 3; SAL-01, SAL-02, MAP-12): own territories only, 50 at a
// time, phones masked. The database decides what is in the list; the filter box only narrows
// what is already loaded.
export default function Salons() {
  const [salons, setSalons] = useState<Salon[]>([]);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  const load = useCallback(async (after?: Salon) => {
    setError(null);
    setLoading(true);
    try {
      const page = await salonPage(after);
      setSalons((s) => (after ? [...s, ...page] : page));
      setMore(page.length === 50);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const f = filter.trim().toLowerCase();
  const shown = f ? salons.filter((s) => `${s.name ?? ""} ${s.area_name}`.toLowerCase().includes(f)) : salons;

  return (
    <main>
      <h1>Salons</h1>
      <p className="row spread">
        <a href="/app">← Home</a>
        <a className="btn inline" href="/app/salons/new">
          Add a salon
        </a>
      </p>
      <label htmlFor="filter">Find in this list</label>
      <input id="filter" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Name or area" />
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!error && !loading && salons.length === 0 && <p className="muted">No salons in your territory yet. Add the first one.</p>}
      <ul className="plain">
        {shown.map((s) => (
          <li key={s.id}>
            <a href={`/app/salons/${s.id}`}>
              <strong>{s.name ?? "Unnamed salon"}</strong>
            </a>{" "}
            <span className="muted">{s.area_name}</span>
            <br />
            <span className="badge">{label(s.stage)}</span> <span className="badge">{label(s.type)}</span>
            {s.phone_masked && <span className="muted"> · {s.phone_masked}</span>}
          </li>
        ))}
      </ul>
      {loading && (
        <p className="muted" aria-busy="true">
          Loading…
        </p>
      )}
      {more && !loading && (
        <button type="button" className="inline" onClick={() => void load(salons[salons.length - 1])}>
          Show more
        </button>
      )}
    </main>
  );
}
