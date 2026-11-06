"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ListState } from "@/components/confirm-action";
import { db, rows, rpc } from "@/lib/rpc";
import { label } from "@/lib/salons";
import { when } from "@/lib/time";

type Sku = { id: string; code: string; variant: string | null };
type Available = { sku_id: string; code: string; available: number };
type Low = { sku_id: string; code: string; on_hand: number; reorder_point: number };
type Rule = { sku_id: string; reorder_point: number };
type Location = { id: string; kind: string; name: string };
type OnHand = { location_id: string; sku_id: string; on_hand: number };
type CountLine = { sku_id: string; expected: number; counted: number };
type StockCount = {
  id: string;
  location_id: string;
  kind: string;
  counted_by: string;
  lines: CountLine[];
  variance_units: number;
  created_at: string;
};
type Person = { id: string; full_name: string };

const SKU_LIMIT = 200;
const COUNT_LIST = 50;
// app.parse_lines refuses a counted quantity above this.
const MAX_COUNT = 100_000;
const skuText = (s: Sku | undefined) => (s ? `${s.code}${s.variant ? ` ${s.variant}` : ""}` : "Unknown SKU");
const wholeInRange = (text: string, max: number) => {
  const t = text.trim();
  const n = Number(t);
  return t !== "" && Number.isInteger(n) && n >= 0 && n <= max ? n : null;
};

// Stock levels (owner or manager at AAL2; INV-04, INV-06, CTL-05, INV-05 variance). Every figure is the
// database's: app.warehouse_availability (on hand less pending issues, all warehouses), app.low_stock (at or
// below the reorder point, warehouses and rep bags together, B-31 f), app.office_set_reorder_point,
// app.record_count and the stock_count rows it writes (expected, counted and variance_units are set by the
// function). A count never changes stock (doc 10 section 4). The rep's daily close appears here too.
export default function StockLevels() {
  const [skus, setSkus] = useState<Sku[]>([]);
  const [names, setNames] = useState<Map<string, Sku>>(new Map());
  const [available, setAvailable] = useState<Available[]>([]);
  const [low, setLow] = useState<Low[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [counts, setCounts] = useState<StockCount[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [s, a, l, r, loc, c, p] = await Promise.all([
        rows<Sku>(db().from("sku").select("id, code, variant").eq("active", true).order("code").limit(SKU_LIMIT)),
        rpc<Available[]>("warehouse_availability"),
        rpc<Low[]>("low_stock"),
        rows<Rule>(db().from("reorder_rule").select("sku_id, reorder_point")),
        rows<Location>(
          db()
            .from("stock_location")
            .select("id, kind, name")
            .eq("active", true)
            .in("kind", ["warehouse", "rep_bag"])
            .order("kind")
            .order("name"),
        ),
        rows<StockCount>(
          db()
            .from("stock_count")
            .select("id, location_id, kind, counted_by, lines, variance_units, created_at")
            .order("created_at", { ascending: false })
            .limit(COUNT_LIST),
        ),
        rows<Person>(db().from("user_profile").select("id, full_name")),
      ]);
      // A count line can name a SKU that is no longer active: look those names up by id, so the history
      // never says "Unknown SKU" for a product the office deactivated (REP-14, L1).
      const known = new Set(s.map((x) => x.id));
      const missing = [...new Set(c.flatMap((x) => x.lines.map((l) => l.sku_id)))].filter((id) => !known.has(id));
      const extra = missing.length ? await rows<Sku>(db().from("sku").select("id, code, variant").in("id", missing)) : [];
      setSkus(s);
      setNames(new Map([...s, ...extra].map((x) => [x.id, x])));
      setAvailable(a ?? []);
      setLow(l ?? []);
      setRules(r);
      setLocations(loc);
      setCounts(c);
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

  const done = async (m: string) => {
    setNotice(m);
    await load();
  };
  const skuById = (id: string) => names.get(id);
  const locName = (id: string) => locations.find((l) => l.id === id)?.name ?? "Unknown location";
  const personName = (id: string) => people.find((p) => p.id === id)?.full_name ?? "Unknown";

  return (
    <>
      <h1>Stock levels</h1>
      <p className="muted">
        <Link href="/office/stock">Locations, opening stock, issues and returns are on Stock.</Link>
      </p>
      {notice && <output className="ok">{notice}</output>}
      <ListState loading={loading} error={error} empty={false} emptyText="" />
      {!loading && !error && (
        <>
          <section aria-labelledby="low-h">
            <h2 id="low-h">Low stock ({low.length})</h2>
            <p className="muted">At or below the reorder point, counting warehouses and rep bags together.</p>
            {low.length === 0 ? (
              <p className="muted">Nothing is at or below its reorder point.</p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>SKU</th>
                    <th>On hand</th>
                    <th>Reorder point</th>
                  </tr>
                </thead>
                <tbody>
                  {low.map((l) => (
                    <tr key={l.sku_id} data-testid="low-stock">
                      <td data-label="SKU">{l.code}</td>
                      <td data-label="On hand" data-testid="low-on-hand">
                        {l.on_hand}
                      </td>
                      <td data-label="Reorder point" data-testid="low-point">
                        {l.reorder_point}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section aria-labelledby="levels-h">
            <h2 id="levels-h">Availability and reorder points</h2>
            <p className="muted">Available is what the warehouses hold less what pending issues have promised.</p>
            {skus.length === 0 ? (
              <p className="muted">No active SKU yet.</p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>SKU</th>
                    <th>Available in warehouses</th>
                    <th>Reorder point</th>
                  </tr>
                </thead>
                <tbody>
                  {skus.map((s) => {
                    const a = available.find((x) => x.sku_id === s.id);
                    return (
                      <tr key={s.id} data-testid="sku-level">
                        <td data-label="SKU">{skuText(s)}</td>
                        <td data-label="Available" data-testid="sku-available">
                          {a ? a.available : "no warehouse"}
                        </td>
                        <td data-label="Reorder point">
                          <ReorderPoint
                            sku={s}
                            current={rules.find((r) => r.sku_id === s.id)?.reorder_point ?? null}
                            onDone={done}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            {skus.length === SKU_LIMIT && <p className="muted">Showing the first {SKU_LIMIT} SKUs by code.</p>}
          </section>

          <section aria-labelledby="count-h">
            <h2 id="count-h">Record a stock count</h2>
            <p className="muted">Enter what you see. A count never changes stock; the database records the difference.</p>
            <CountForm locations={locations} skus={skus} onDone={done} />
          </section>

          <section aria-labelledby="counts-h">
            <h2 id="counts-h">Counts and variance (newest {COUNT_LIST})</h2>
            {counts.length === 0 ? (
              <p className="muted">No count recorded yet.</p>
            ) : (
              <ul className="plain">
                {counts.map((c) => (
                  <li key={c.id} data-testid="stock-count">
                    <span className="badge">{label(c.kind)}</span> {locName(c.location_id)} · {personName(c.counted_by)} ·{" "}
                    <strong>variance {c.variance_units} units</strong>
                    <br />
                    <span className="muted">
                      {when(c.created_at)}
                      {c.lines.map((l) => ` · ${skuText(skuById(l.sku_id))}: expected ${l.expected}, counted ${l.counted}`)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </>
  );
}

function ReorderPoint({ sku, current, onDone }: { sku: Sku; current: number | null; onDone: (m: string) => Promise<void> }) {
  const [value, setValue] = useState(current === null ? "" : String(current));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      aria-label={`Reorder point of ${sku.code}`}
      className="inline-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        const point = wholeInRange(value, Number.MAX_SAFE_INTEGER);
        if (point === null) {
          setError("Enter a whole number from 0.");
          return;
        }
        setBusy(true);
        try {
          await rpc("office_set_reorder_point", { p_sku_id: sku.id, p_reorder_point: point });
          await onDone(`Reorder point of ${sku.code} set to ${point}.`);
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <label>
        Reorder point for {sku.code}
        <input inputMode="numeric" value={value} onChange={(e) => setValue(e.target.value)} required />
      </label>
      <button type="submit" className="inline" disabled={busy} aria-label={`Save the reorder point for ${sku.code}`}>
        Save
      </button>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

function CountForm({ locations, skus, onDone }: { locations: Location[]; skus: Sku[]; onDone: (m: string) => Promise<void> }) {
  const [location, setLocation] = useState("");
  const [kind, setKind] = useState("stock_take");
  const [lineIds, setLineIds] = useState<string[]>([]);
  const [counted, setCounted] = useState<Record<string, string>>({});
  const [extra, setExtra] = useState("");
  const [loadingLines, setLoadingLines] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One client id per count, kept until the database accepts it, so a retry replays it (H-08).
  const [key, setKey] = useState(() => crypto.randomUUID());
  const latest = useRef(0);
  const chosen = locations.find((l) => l.id === location);
  // app.record_count: a spot check is for a rep bag; the daily close is the rep's own.
  const kinds = chosen?.kind === "rep_bag" ? ["spot_check", "cycle_count", "stock_take"] : ["cycle_count", "stock_take"];

  const choose = async (id: string) => {
    const mine = ++latest.current;
    setLocation(id);
    setCounted({});
    setLineIds([]);
    setError(null);
    setKind(locations.find((l) => l.id === id)?.kind === "rep_bag" ? "spot_check" : "stock_take");
    if (!id) return;
    setLoadingLines(true);
    try {
      const held = await rpc<OnHand[]>("stock_on_hand", { p_location_id: id });
      if (mine === latest.current) setLineIds((held ?? []).map((h) => h.sku_id));
    } catch (err) {
      if (mine === latest.current) setError((err as Error).message);
    } finally {
      if (mine === latest.current) setLoadingLines(false);
    }
  };

  return (
    <form
      aria-label="Record a stock count"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        const lines = lineIds.map((id) => ({ sku_id: id, qty: wholeInRange(counted[id] ?? "", MAX_COUNT) }));
        if (lines.some((l) => l.qty === null)) {
          setError(`Type the whole number you counted for every line, from 0 to ${MAX_COUNT}.`);
          return;
        }
        setBusy(true);
        try {
          const r = await rpc<{ variance_units: number }>("record_count", {
            p_client_id: key,
            p_location_id: location,
            p_kind: kind,
            p_counted: lines,
            p_counted_at_client: new Date().toISOString(),
          });
          setKey(crypto.randomUUID());
          await choose("");
          await onDone(`Count saved: variance ${r.variance_units} units.`);
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <label htmlFor="count-location">Location counted</label>
      <select id="count-location" value={location} onChange={(e) => void choose(e.target.value)} required>
        <option value="">Choose a location</option>
        {locations.map((l) => (
          <option key={l.id} value={l.id}>
            {label(l.kind)} · {l.name}
          </option>
        ))}
      </select>
      <label htmlFor="count-kind">Kind of count</label>
      <select id="count-kind" value={kind} onChange={(e) => setKind(e.target.value)}>
        {kinds.map((k) => (
          <option key={k} value={k}>
            {label(k)}
          </option>
        ))}
      </select>
      {loadingLines && (
        <p className="muted" aria-busy="true">
          Loading the SKUs held here…
        </p>
      )}
      {location && !loadingLines && lineIds.length === 0 && <p className="muted">The database shows nothing held here.</p>}
      {lineIds.map((id) => {
        const s = skus.find((x) => x.id === id);
        return (
          <div key={id}>
            <label htmlFor={`count-${id}`}>Counted of {skuText(s)}</label>
            <input
              id={`count-${id}`}
              inputMode="numeric"
              value={counted[id] ?? ""}
              onChange={(e) => setCounted((all) => ({ ...all, [id]: e.target.value }))}
            />
          </div>
        );
      })}
      {location && (
        <div className="inline-form">
          <label htmlFor="count-extra">Also found here</label>
          <select id="count-extra" value={extra} onChange={(e) => setExtra(e.target.value)}>
            <option value="">Choose a SKU</option>
            {skus
              .filter((s) => !lineIds.includes(s.id))
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {skuText(s)}
                </option>
              ))}
          </select>
          <button
            type="button"
            className="inline link"
            disabled={!extra}
            onClick={() => {
              setLineIds((all) => [...all, extra]);
              setExtra("");
            }}
          >
            Add the SKU
          </button>
        </div>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="inline" disabled={busy || loadingLines}>
        {busy ? "Saving…" : "Save the count"}
      </button>
    </form>
  );
}
