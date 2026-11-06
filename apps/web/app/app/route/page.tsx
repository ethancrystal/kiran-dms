"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { karachiToday } from "@/lib/commission";
import { mySession, rpc } from "@/lib/rpc";
import { label, type Salon, salonPage } from "@/lib/salons";

type Stop = {
  stop_id: string;
  sequence: number;
  salon_id: string;
  salon_name: string | null;
  area_name: string;
  stage: string;
  reason: string;
  next_due_on: string | null;
  visited: boolean;
  last_outcome: string | null;
};
type Due = {
  salon_id: string;
  salon_name: string | null;
  area_name: string;
  product_group_id: string;
  product_group_name: string;
  next_due_on: string | null;
  due_status: string;
};
type Mine = { id: string; name: string | null; area_name: string };

// app.my_salons returns at most 50 rows a page.
const SALON_PAGE = 50;
const nameOf = (name: string | null) => name ?? "Unnamed salon";

// My route (rep, approved phone; PIP-03, doc 08 section 2; 360 px first). The rep's stops for a day in
// order (app.my_route: own route and salons the rep holds under R4, nothing else), a new order
// (app.rep_reorder_route, today or later) and an extra stop (app.rep_add_stop: today only, at the end,
// from the due list or the rep's own salons). No open day is needed. A device that is not approved reads no
// rows from the database, so the page says so instead of showing an empty route.
export default function MyRoute() {
  const [day, setDay] = useState(() => karachiToday());
  const [route, setRoute] = useState<Stop[]>([]);
  const [due, setDue] = useState<Due[]>([]);
  const [salons, setSalons] = useState<Mine[]>([]);
  const [more, setMore] = useState(false);
  const [pick, setPick] = useState("");
  const [denied, setDenied] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const latest = useRef(0);
  const isToday = day === karachiToday();

  const load = useCallback(async (onDay: string) => {
    const mine = ++latest.current;
    setError(null);
    try {
      const session = await mySession();
      if (!session || session.role !== "rep") {
        setDenied("This page is for reps.");
        return;
      }
      if (session.device_status !== "approved") {
        setDenied("This phone is waiting for your manager's approval, so your route cannot be shown yet.");
        return;
      }
      const [r, u, s] = await Promise.all([
        rpc<Stop[]>("my_route", { p_day: onDay }),
        rpc<Due[]>("due_list", { p_on: onDay, p_territory_id: null }),
        salonPage(),
      ]);
      if (mine !== latest.current) return;
      setDenied(null);
      setRoute(r ?? []);
      setDue(u ?? []);
      setSalons((s ?? []) as Mine[]);
      setMore((s ?? []).length === SALON_PAGE);
    } catch (e) {
      if (mine === latest.current) setError((e as Error).message);
    } finally {
      if (mine === latest.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    setNotice(null);
    void load(day);
  }, [load, day]);

  const act = async (work: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await work();
      setNotice(ok);
      await load(day);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const swap = (from: number, to: number) => {
    const ids = route.map((r) => r.stop_id);
    [ids[from], ids[to]] = [ids[to], ids[from]];
    void act(() => rpc("rep_reorder_route", { p_day: day, p_stop_ids: ids }), "Route reordered.");
  };
  const add = (salonId: string, name: string) =>
    act(() => rpc("rep_add_stop", { p_salon_id: salonId }), `Added ${name} to today's route.`);
  const showMore = async () => {
    try {
      const next = await salonPage(salons[salons.length - 1] as Salon);
      setSalons((s) => [...s, ...(next as Mine[])]);
      setMore(next.length === SALON_PAGE);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const onRoute = (salonId: string) => route.some((r) => r.salon_id === salonId);

  return (
    <main>
      <p>
        <a href="/app">← Today</a>
      </p>
      <h1>My route</h1>
      <label htmlFor="my-route-day">Day of the route</label>
      <input
        id="my-route-day"
        type="date"
        min={karachiToday()}
        value={day}
        onChange={(e) => e.target.value && setDay(e.target.value)}
      />
      {notice && <output className="ok">{notice}</output>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {loading && (
        <p className="muted" aria-busy="true">
          Loading your route…
        </p>
      )}
      {!loading && denied && (
        <p className="error" role="alert" data-testid="route-denied">
          {denied}
        </p>
      )}
      {!loading && !denied && (
        <>
          <section aria-labelledby="my-stops-h">
            <h2 id="my-stops-h">Stops ({route.length})</h2>
            {route.length === 0 ? (
              <p className="muted">No stops on this day.</p>
            ) : (
              <ol className="stops route-tap">
                {route.map((s, i) => (
                  <li key={s.stop_id} className={s.visited ? "done" : undefined} data-testid="my-route-stop">
                    <div>
                      <a href={`/app/salons/${s.salon_id}`}>
                        <strong>{nameOf(s.salon_name)}</strong>
                      </a>
                      <br />
                      <span className="muted">{s.area_name}</span>
                      <br />
                      <span className="badge">{label(s.reason)}</span>
                      {s.next_due_on && <span className="muted"> due {s.next_due_on}</span>}
                      {s.visited && (
                        <span className="badge active">visited{s.last_outcome ? `: ${label(s.last_outcome)}` : ""}</span>
                      )}
                    </div>
                    <div className="row">
                      <button
                        type="button"
                        className="inline"
                        aria-label={`Move ${nameOf(s.salon_name)} up`}
                        disabled={busy || i === 0}
                        onClick={() => swap(i, i - 1)}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className="inline"
                        aria-label={`Move ${nameOf(s.salon_name)} down`}
                        disabled={busy || i === route.length - 1}
                        onClick={() => swap(i, i + 1)}
                      >
                        ↓
                      </button>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>

          <section aria-labelledby="my-due-h">
            <h2 id="my-due-h">Due for a visit</h2>
            {due.length === 0 ? (
              <p className="muted">Nothing is due in your territory on this day.</p>
            ) : (
              <ul className="plain route-tap">
                {due.map((d) => (
                  <li key={`${d.salon_id}:${d.product_group_id}`} data-testid="my-route-due">
                    <strong>{nameOf(d.salon_name)}</strong> <span className="muted">{d.area_name}</span>
                    <br />
                    {d.product_group_name}: <span className="badge">{label(d.due_status)}</span>
                    {d.next_due_on && <span className="muted"> due {d.next_due_on}</span>}
                    {isToday && !onRoute(d.salon_id) && (
                      <button
                        type="button"
                        disabled={busy}
                        aria-label={`Add ${nameOf(d.salon_name)} from the due list, ${d.product_group_name}`}
                        onClick={() => void add(d.salon_id, nameOf(d.salon_name))}
                      >
                        Add to route
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {isToday ? (
            <form
              className="card route-tap"
              aria-label="Add a stop from my salons"
              onSubmit={(e) => {
                e.preventDefault();
                const s = salons.find((x) => x.id === pick);
                if (!s) return;
                void add(s.id, nameOf(s.name));
                setPick("");
              }}
            >
              <label htmlFor="my-route-salon">Add one of my salons</label>
              <select id="my-route-salon" value={pick} onChange={(e) => setPick(e.target.value)} required>
                <option value="">Choose a salon</option>
                {salons
                  .filter((s) => !onRoute(s.id))
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {nameOf(s.name)} · {s.area_name}
                    </option>
                  ))}
              </select>
              {more && (
                <button type="button" onClick={() => void showMore()}>
                  Show more salons
                </button>
              )}
              <button type="submit" disabled={busy}>
                Add stop
              </button>
            </form>
          ) : (
            <p className="muted">Stops can be added only to today&apos;s route.</p>
          )}
        </>
      )}
    </main>
  );
}
