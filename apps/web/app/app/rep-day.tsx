"use client";
import { useCallback, useEffect, useState } from "react";
import { karachiToday, day as shortDay } from "@/lib/overview";
import { db, rows, rpc } from "@/lib/rpc";
import { clock } from "@/lib/time";

type Day = {
  id: string;
  day: string;
  status: "open" | "closed" | "force_closed";
  check_in_at: string;
  bag_variance_units: number;
  visits: number;
};
type BagLine = { sku_id: string; code: string; variant: string | null; on_hand: number };
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
  product_group_name: string;
  next_due_on: string | null;
  due_status: string;
};
type AreaRow = { territory_id: string; territory_name: string; area_id: string; area_name: string };

const pretty = (s: string) => s.replace(/_/g, " ");

/** Browser GPS when the phone allows it; the day still works without it (doc 08: GPS is evidence, not a gate at check-in). */
function position(): Promise<{ lat: number; lng: number } | null> {
  if (!("geolocation" in navigator)) return Promise.resolve(null);
  return new Promise((resolve) =>
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: Number(p.coords.latitude.toFixed(6)), lng: Number(p.coords.longitude.toFixed(6)) }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    ),
  );
}

// The rep's working day (execution map slice 2; J1 steps 4 to 6 and 15): check in with the
// morning bag count, today's route and due list, the evening count, check out. Every rule is the
// database's (PIP-09 one open day, INV-05 daily close before check-out, territory scoping); this
// page shows what it says.
export function RepDay() {
  const [day, setDay] = useState<Day | null>(null);
  const [bag, setBag] = useState<BagLine[]>([]);
  const [route, setRoute] = useState<Stop[]>([]);
  const [due, setDue] = useState<Due[]>([]);
  const [areas, setAreas] = useState<AreaRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // REP-01 (P1-30): an open day from an earlier Karachi date (no check-out, or past midnight) blocks
  // check-in, and only the office can close it (PIP-09). Read from the rep's own rep_day rows (RLS).
  const [stuck, setStuck] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [d, b, a, old] = await Promise.all([
        rpc<Day[]>("my_day"),
        rpc<BagLine[]>("my_bag"),
        rpc<AreaRow[]>("my_areas"),
        rows<{ day: string }>(
          db().from("rep_day").select("day").eq("status", "open").lt("day", karachiToday()).order("day").limit(1),
        ),
      ]);
      const today = (d ?? [])[0] ?? null;
      setDay(today);
      setStuck(old[0]?.day ?? null);
      setBag(b ?? []);
      setAreas(a ?? []);
      if (today?.status === "open") {
        const [r, u] = await Promise.all([
          rpc<Stop[]>("my_route", { p_day: null }),
          rpc<Due[]>("due_list", { p_on: null, p_territory_id: null }),
        ]);
        setRoute(r ?? []);
        setDue(u ?? []);
      } else {
        setRoute([]);
        setDue([]);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const run = async (f: () => Promise<unknown>, ok: string) => {
    setError(null);
    setNotice(null);
    try {
      await f();
      setNotice(ok);
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const territories = [...new Map(areas.map((a) => [a.territory_id, a.territory_name])).values()];

  if (loading)
    return (
      <p className="muted" aria-busy="true">
        Loading your day…
      </p>
    );

  return (
    <>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && <output className="ok">{notice}</output>}

      <section className="card" aria-labelledby="terr-h">
        <h2 id="terr-h">Your territory</h2>
        {territories.length === 0 ? (
          <p className="muted">No territory is assigned to you yet. Ask your manager.</p>
        ) : (
          <p>
            {territories.join(", ")} <span className="muted">({areas.length} areas)</span>
          </p>
        )}
      </section>

      {!day && stuck && (
        <div className="card" data-testid="day-stuck">
          <p className="error" role="alert">
            Your day of {shortDay(stuck)} is still open, so you cannot check in today.
          </p>
          <p>
            You can no longer close it from this phone. Ask your manager or the owner to close it on the office overview (under
            &quot;Rep days left open&quot;), then open this page again.
          </p>
        </div>
      )}

      {!day && !stuck && (
        <CountForm
          title="Check in"
          help="Count what is in your bag before you start. Enter what you see, not what you expect."
          bag={bag}
          button="Check in"
          onSubmit={async (counted) => {
            const gps = await position();
            await run(
              () =>
                rpc("rep_check_in", {
                  p_counted: counted,
                  p_lat: gps?.lat ?? null,
                  p_lng: gps?.lng ?? null,
                  p_at_client: new Date().toISOString(),
                }),
              "Checked in. Have a good day.",
            );
          }}
        />
      )}

      {day && day.status !== "open" && (
        <div className="card">
          <p className="ok">Today&apos;s day is closed.</p>
          <p className="muted">Visits recorded: {day.visits}.</p>
        </div>
      )}

      {day?.status === "open" && (
        <>
          <div className="card">
            <p>
              Checked in at {clock(day.check_in_at)}. Visits so far: {day.visits}.
            </p>
            {day.bag_variance_units > 0 && (
              <p className="error">
                Your morning count differed from the bag by {day.bag_variance_units} units. The office can see this.
              </p>
            )}
          </div>

          <section aria-labelledby="route-h">
            <h2 id="route-h">Today&apos;s route</h2>
            {route.length === 0 ? (
              <p className="muted">No stops yet. Add salons from the due list below.</p>
            ) : (
              <ol className="stops">
                {route.map((s, i) => (
                  <li key={s.stop_id} className={s.visited ? "done" : undefined}>
                    <div>
                      <a href={`/app/salons/${s.salon_id}`}>
                        <strong>{s.salon_name ?? "Unnamed salon"}</strong>
                      </a>{" "}
                      <span className="muted">{s.area_name}</span>
                      <br />
                      <span className="badge">{pretty(s.reason)}</span> <span className="badge">{pretty(s.stage)}</span>
                      {s.visited && (
                        <span className="badge active">visited{s.last_outcome ? `: ${pretty(s.last_outcome)}` : ""}</span>
                      )}
                    </div>
                    <div className="row">
                      <button
                        type="button"
                        className="inline link"
                        aria-label={`Move ${s.salon_name ?? "stop"} up`}
                        disabled={i === 0}
                        onClick={() => {
                          const ids = route.map((r) => r.stop_id);
                          [ids[i - 1], ids[i]] = [ids[i], ids[i - 1]];
                          void run(() => rpc("rep_reorder_route", { p_day: day.day, p_stop_ids: ids }), "Route reordered.");
                        }}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className="inline link"
                        aria-label={`Move ${s.salon_name ?? "stop"} down`}
                        disabled={i === route.length - 1}
                        onClick={() => {
                          const ids = route.map((r) => r.stop_id);
                          [ids[i + 1], ids[i]] = [ids[i], ids[i + 1]];
                          void run(() => rpc("rep_reorder_route", { p_day: day.day, p_stop_ids: ids }), "Route reordered.");
                        }}
                      >
                        ↓
                      </button>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>

          <section aria-labelledby="due-h">
            <h2 id="due-h">Due for a visit</h2>
            {due.length === 0 ? (
              <p className="muted">Nothing is due in your territory.</p>
            ) : (
              <ul className="plain">
                {due.map((d) => {
                  const onRoute = route.some((r) => r.salon_id === d.salon_id);
                  return (
                    <li key={`${d.salon_id}-${d.product_group_name}`}>
                      <strong>{d.salon_name ?? "Unnamed salon"}</strong> <span className="muted">{d.area_name}</span>
                      <br />
                      {d.product_group_name}:{" "}
                      <span className={`badge ${d.due_status === "overdue" ? "suspended" : ""}`}>{pretty(d.due_status)}</span>
                      {d.next_due_on && <span className="muted"> · due {d.next_due_on}</span>}{" "}
                      {!onRoute && (
                        <button
                          type="button"
                          className="inline"
                          onClick={() =>
                            void run(
                              () => rpc("rep_add_stop", { p_salon_id: d.salon_id }),
                              `Added ${d.salon_name ?? "the salon"} to today's route.`,
                            )
                          }
                        >
                          Add to route
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <CloseDay bag={bag} onDone={(m) => run(async () => {}, m)} />
        </>
      )}
    </>
  );
}

function CountForm({
  title,
  help,
  bag,
  button,
  onSubmit,
}: {
  title: string;
  help: string;
  bag: BagLine[];
  button: string;
  onSubmit: (counted: Array<{ sku_id: string; qty: number }>) => Promise<void>;
}) {
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const lines = bag.filter((b) => b.on_hand !== 0);
  return (
    <form
      className="card"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await onSubmit(
            Object.entries(counts)
              .filter(([, v]) => v.trim() !== "")
              .map(([sku_id, v]) => ({ sku_id, qty: Number.parseInt(v, 10) })),
          );
        } finally {
          setBusy(false);
        }
      }}
    >
      <h2>{title}</h2>
      <p className="muted">{help}</p>
      {lines.length === 0 ? (
        <p className="muted">Your bag is empty.</p>
      ) : (
        lines.map((b) => (
          <div key={b.sku_id}>
            <label htmlFor={`c-${b.sku_id}`}>
              {b.code} {b.variant ?? ""}
            </label>
            <input
              id={`c-${b.sku_id}`}
              inputMode="numeric"
              pattern="[0-9]*"
              value={counts[b.sku_id] ?? ""}
              onChange={(e) => setCounts((c) => ({ ...c, [b.sku_id]: e.target.value.replace(/\D/g, "") }))}
              required
            />
          </div>
        ))
      )}
      <button type="submit" disabled={busy}>
        {busy ? "Saving…" : button}
      </button>
    </form>
  );
}

function CloseDay({ bag, onDone }: { bag: BagLine[]; onDone: (message: string) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One client id per closing, so a retry after a refused check-out replays the same count
  // instead of recording a second daily close; once saved, the count is not sent again.
  const [closeId] = useState(() => crypto.randomUUID());
  const [counted, setCounted] = useState(false);
  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)}>
        Finish the day
      </button>
    );
  return (
    <>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {counted && <p className="muted">Your evening count is saved; only the check-out is left.</p>}
      <CountForm
        title="Evening bag count"
        help="Count your bag again before you check out (INV-05). The office compares it with your sales."
        bag={bag}
        button="Save count and check out"
        onSubmit={async (lines) => {
          setError(null);
          try {
            const bagId = await rpc<string | null>("my_bag_id");
            if (bagId && !counted) {
              await rpc("record_count", {
                p_client_id: closeId,
                p_location_id: bagId,
                p_kind: "daily_close",
                p_counted: lines,
                p_counted_at_client: new Date().toISOString(),
              });
              setCounted(true);
            }
            await rpc("rep_check_out", { p_at_client: new Date().toISOString() });
            setOpen(false);
            await onDone("Day closed. Thank you.");
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      />
    </>
  );
}
