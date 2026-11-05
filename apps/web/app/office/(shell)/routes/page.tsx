"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ListState } from "@/components/confirm-action";
import { karachiToday } from "@/lib/commission";
import { db, rows, rpc } from "@/lib/rpc";
import { label } from "@/lib/salons";

type Rep = { id: string; full_name: string };
type Reachable = { id: string; name: string | null; area: { name: string } | null };
type StopRow = {
  id: string;
  sequence: number;
  salon_id: string;
  reason: string;
  salon: Reachable | null;
};
type Due = {
  salon_id: string;
  salon_name: string | null;
  area_name: string;
  product_group_id: string;
  product_group_name: string;
  next_due_on: string;
  due_status: string;
};
type Assignment = { salon_id: string; rep_id: string | null; seq: number };
/** One stop as edited on this page, before it is saved. */
type Draft = { salonId: string; name: string; area: string; reason: string; repAdded: boolean };

// The reasons app.office_set_route accepts ('pin_selected' is the rep's own and it refuses it).
const OFFICE_REASONS = ["reorder_due", "collection_due", "at_risk", "prospect", "delivery", "manual"];
const DEFAULT_REASON = "manual";
const SALON_LIMIT = 200;
const ASSIGNMENT_LIMIT = 2000;
// app.due_list returns at most 50 rows for one call.
const DUE_LIMIT = 50;
const nameOf = (name: string | null) => name ?? "Unnamed salon";

// Routes (owner or manager at AAL2; PIP-03, PIP-05 and PIP-06 thin). Pick a rep and a day, build the
// ordered stops, save them with app.office_set_route, which replaces the whole day (the rep's own stops
// included) and refuses a past day, a salon the rep does not hold (R4) or more than 50 stops. The salon
// list and the due list are a convenience: the database decides. Due salons come from app.due_list, one
// call per territory the rep covers because each call is capped; a saved route is read from route and
// route_stop under RLS and is never computed here.
export default function OfficeRoutes() {
  const [reps, setReps] = useState<Rep[]>([]);
  const [rep, setRep] = useState("");
  const [day, setDay] = useState(() => karachiToday());
  const [stops, setStops] = useState<Draft[]>([]);
  const [salons, setSalons] = useState<Reachable[]>([]);
  const [due, setDue] = useState<Due[]>([]);
  const [dueCapped, setDueCapped] = useState(false);
  const [salonsCapped, setSalonsCapped] = useState(false);
  const [coverage, setCoverage] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [loadingReps, setLoadingReps] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [pick, setPick] = useState("");
  const [pickReason, setPickReason] = useState(DEFAULT_REASON);
  // A later choice of rep or day wins over a slower answer to the earlier one.
  const latest = useRef(0);

  useEffect(() => {
    void (async () => {
      try {
        setReps(
          await rows<Rep>(
            db().from("user_profile").select("id, full_name").eq("role", "rep").eq("status", "active").order("full_name"),
          ),
        );
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoadingReps(false);
      }
    })();
  }, []);

  const load = useCallback(async (repId: string, onDay: string) => {
    const mine = ++latest.current;
    setError(null);
    setDirty(false);
    if (!repId) {
      setStops([]);
      setSalons([]);
      setDue([]);
      setCoverage(0);
      return;
    }
    setLoading(true);
    try {
      const [routes, territories, assignments] = await Promise.all([
        rows<{ id: string }>(db().from("route").select("id").eq("rep_id", repId).eq("day", onDay)),
        rows<{ territory_id: string }>(db().from("rep_territory").select("territory_id").eq("rep_id", repId).is("to_date", null)),
        rows<Assignment>(
          db()
            .from("salon_rep_assignment")
            .select("salon_id, rep_id, seq")
            .order("seq", { ascending: false })
            .limit(ASSIGNMENT_LIMIT),
        ),
      ]);
      const saved = routes[0]
        ? await rows<StopRow>(
            db()
              .from("route_stop")
              .select("id, sequence, salon_id, reason, salon:salon_id(id, name, area:area_id(name))")
              .eq("route_id", routes[0].id)
              .order("sequence"),
          )
        : [];
      // R4, as a convenience for the pickers only: the newest row of a salon names its rep, or null for
      // territory coverage. app.office_set_route checks it again with app.rep_holds_salon.
      // Rows arrive newest first, so reversed into a Map the newest row of each salon is written last.
      const latestRep = new Map([...assignments].reverse().map((a) => [a.salon_id, a.rep_id] as const));
      const direct = [...latestRep].filter(([, r]) => r === repId).map(([s]) => s);
      const elsewhere = (salonId: string) => {
        const r = latestRep.get(salonId);
        return Boolean(r) && r !== repId;
      };
      const ids = territories.map((t) => t.territory_id);
      const select = "id, name, area:area_id!inner(name, territory_id)";
      const [byTerritory, byAssignment, dueLists] = await Promise.all([
        ids.length
          ? rows<Reachable>(
              db()
                .from("salon")
                .select(select)
                .eq("approval_status", "approved")
                .neq("stage", "parked")
                .in("area.territory_id", ids)
                .order("name", { nullsFirst: false })
                .limit(SALON_LIMIT),
            )
          : Promise.resolve([]),
        direct.length
          ? rows<Reachable>(
              db()
                .from("salon")
                .select(select)
                .eq("approval_status", "approved")
                .neq("stage", "parked")
                .in("id", direct)
                .order("name", { nullsFirst: false })
                .limit(SALON_LIMIT),
            )
          : Promise.resolve([]),
        Promise.all(ids.map((t) => rpc<Due[]>("due_list", { p_on: onDay, p_territory_id: t }))),
      ]);
      if (mine !== latest.current) return;
      const reachable = new Map([...byAssignment, ...byTerritory].filter((s) => !elsewhere(s.id)).map((s) => [s.id, s] as const));
      setSalons([...reachable.values()]);
      setSalonsCapped(byTerritory.length === SALON_LIMIT || byAssignment.length === SALON_LIMIT);
      setDue(dueLists.flat().filter((d) => !elsewhere(d.salon_id)));
      setDueCapped(dueLists.some((d) => (d ?? []).length === DUE_LIMIT));
      setCoverage(ids.length + direct.length);
      setStops(
        saved.map((s) => ({
          salonId: s.salon_id,
          name: nameOf(s.salon?.name ?? null),
          area: s.salon?.area?.name ?? "",
          // The database refuses pin_selected from the office: a stop the rep added is sent back as manual
          // unless the office picks another reason (ruling in this slice's TASK entry).
          reason: s.reason === "pin_selected" ? DEFAULT_REASON : s.reason,
          repAdded: s.reason === "pin_selected",
        })),
      );
    } catch (e) {
      if (mine === latest.current) setError((e as Error).message);
    } finally {
      if (mine === latest.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    setNotice(null);
    void load(rep, day);
  }, [load, rep, day]);

  const past = day < karachiToday();
  const edit = (change: (all: Draft[]) => Draft[]) => {
    setStops(change);
    setDirty(true);
    setNotice(null);
  };
  const addStop = (salonId: string, name: string, area: string, reason: string) =>
    edit((all) => (all.some((s) => s.salonId === salonId) ? all : [...all, { salonId, name, area, reason, repAdded: false }]));
  const move = (from: number, to: number) =>
    edit((all) => {
      const next = [...all];
      [next[from], next[to]] = [next[to], next[from]];
      return next;
    });
  const onRoute = (salonId: string) => stops.some((s) => s.salonId === salonId);
  const repName = reps.find((r) => r.id === rep)?.full_name ?? "";

  const save = async () => {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await rpc("office_set_route", {
        p_rep_id: rep,
        p_day: day,
        p_stops: stops.map((s) => ({ salon_id: s.salonId, reason: s.reason })),
      });
      await load(rep, day);
      setNotice(`Route saved for ${repName} on ${day}: ${stops.length} stops.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <h1>Routes</h1>
      <p className="muted">
        Plan a rep&apos;s day: ordered salon stops, each with a reason. Saving replaces the whole day, including stops the rep
        added.
      </p>
      <div className="inline-form">
        <label htmlFor="route-rep">Rep for the route</label>
        <select id="route-rep" value={rep} onChange={(e) => setRep(e.target.value)} disabled={loadingReps}>
          <option value="">{loadingReps ? "Loading reps…" : "Choose a rep"}</option>
          {reps.map((r) => (
            <option key={r.id} value={r.id}>
              {r.full_name}
            </option>
          ))}
        </select>
        <label htmlFor="route-day">Route day</label>
        <input id="route-day" type="date" value={day} onChange={(e) => setDay(e.target.value)} />
      </div>
      {notice && <output className="ok">{notice}</output>}
      <ListState
        loading={loading || loadingReps}
        error={error}
        empty={!loadingReps && reps.length === 0}
        emptyText="No active reps yet. Invite one on People."
      />
      {!loading && !loadingReps && rep && (
        <>
          {past && (
            <p className="badge" data-testid="route-past">
              A past route is final: it is shown here and cannot be changed.
            </p>
          )}
          {coverage === 0 && (
            <p className="muted" data-testid="route-no-coverage">
              This rep covers no territory and holds no salon yet. Assign a territory first.
            </p>
          )}
          <section aria-labelledby="route-stops-h">
            <h2 id="route-stops-h">
              Stops ({stops.length}){dirty && " · not saved yet"}
            </h2>
            {stops.length === 0 ? (
              <p className="muted">No stops for this rep on this day.</p>
            ) : (
              <ol className="stops">
                {stops.map((s, i) => (
                  <li key={s.salonId} data-testid="route-stop">
                    <div>
                      <Link href={`/office/salons/${s.salonId}`}>
                        <strong>{s.name}</strong>
                      </Link>{" "}
                      <span className="muted">
                        {s.area}
                        {s.repAdded && " · added by the rep"}
                      </span>
                    </div>
                    {!past && (
                      <div className="row">
                        <select
                          aria-label={`Reason for ${s.name}`}
                          value={s.reason}
                          onChange={(e) => edit((all) => all.map((x, n) => (n === i ? { ...x, reason: e.target.value } : x)))}
                        >
                          {OFFICE_REASONS.map((r) => (
                            <option key={r} value={r}>
                              {label(r)}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          className="inline link"
                          aria-label={`Move ${s.name} up`}
                          disabled={i === 0}
                          onClick={() => move(i, i - 1)}
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          className="inline link"
                          aria-label={`Move ${s.name} down`}
                          disabled={i === stops.length - 1}
                          onClick={() => move(i, i + 1)}
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          className="inline link danger"
                          aria-label={`Remove ${s.name}`}
                          onClick={() => edit((all) => all.filter((_, n) => n !== i))}
                        >
                          Remove
                        </button>
                      </div>
                    )}
                    {past && <span className="badge">{label(s.reason)}</span>}
                  </li>
                ))}
              </ol>
            )}
            {!past && (
              <button type="button" className="inline" disabled={saving || !dirty} onClick={() => void save()}>
                {saving ? "Saving…" : "Save route"}
              </button>
            )}
          </section>

          {!past && (
            <>
              <section aria-labelledby="route-add-h">
                <h2 id="route-add-h">Add a salon</h2>
                <form
                  aria-label="Add a salon to the route"
                  className="inline-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const s = salons.find((x) => x.id === pick);
                    if (!s) return;
                    addStop(s.id, nameOf(s.name), s.area?.name ?? "", pickReason);
                    setPick("");
                  }}
                >
                  <label htmlFor="route-salon">Salon for the new stop</label>
                  <select id="route-salon" value={pick} onChange={(e) => setPick(e.target.value)} required>
                    <option value="">Choose a salon this rep holds</option>
                    {salons
                      .filter((s) => !onRoute(s.id))
                      .map((s) => (
                        <option key={s.id} value={s.id}>
                          {nameOf(s.name)} · {s.area?.name ?? ""}
                        </option>
                      ))}
                  </select>
                  <label htmlFor="route-reason">Reason for the new stop</label>
                  <select id="route-reason" value={pickReason} onChange={(e) => setPickReason(e.target.value)}>
                    {OFFICE_REASONS.map((r) => (
                      <option key={r} value={r}>
                        {label(r)}
                      </option>
                    ))}
                  </select>
                  <button type="submit" className="inline">
                    Add stop
                  </button>
                </form>
                {salonsCapped && <p className="muted">Showing the first {SALON_LIMIT} salons by name.</p>}
              </section>

              <section aria-labelledby="route-due-h">
                <h2 id="route-due-h">Due for a visit on {day}</h2>
                {due.length === 0 ? (
                  <p className="muted">Nothing is due in this rep&apos;s territories on this day.</p>
                ) : (
                  <ul className="plain">
                    {due.map((d) => (
                      <li key={`${d.salon_id}:${d.product_group_id}`} data-testid="route-due">
                        <strong>{nameOf(d.salon_name)}</strong> <span className="muted">{d.area_name}</span> ·{" "}
                        {d.product_group_name}: <span className="badge">{label(d.due_status)}</span>{" "}
                        <span className="muted">due {d.next_due_on}</span>{" "}
                        {!onRoute(d.salon_id) && (
                          <button
                            type="button"
                            className="inline"
                            aria-label={`Add ${nameOf(d.salon_name)} from the due list, ${d.product_group_name}`}
                            onClick={() =>
                              addStop(
                                d.salon_id,
                                nameOf(d.salon_name),
                                d.area_name,
                                d.due_status === "at_risk" ? "at_risk" : "reorder_due",
                              )
                            }
                          >
                            Add to route
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                {dueCapped && <p className="muted">The most urgent {DUE_LIMIT} per territory are shown.</p>}
              </section>
            </>
          )}
        </>
      )}
    </>
  );
}
