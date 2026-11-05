"use client";
import { useCallback, useEffect, useState } from "react";
import { db, rows, rpc } from "@/lib/rpc";
import { label } from "@/lib/salons";

type Sku = { id: string; code: string; variant: string | null };
type Group = { id: string; name: string };
type Signal = {
  id: string;
  sku_id: string | null;
  product_group_id: string | null;
  qty: number;
  reason: string;
  created_at: string;
};

// 'supply_short' is the office's own reason: app.record_demand refuses it from a rep (DEM-01).
const REP_REASONS = ["not_in_bag", "out_of_stock", "not_in_catalogue", "price", "other"];
const NOT_CARRIED = "not_in_catalogue";
const RECENT = 5;
const LIMIT = 200;
// The demand_signal check: 1 to 100000 units.
const MAX_QTY = 100_000;
const when = (t: string) => new Date(t).toLocaleString("en-PK", { dateStyle: "medium", timeStyle: "short" });

// Lost demand (DEM-01, the rep's tap during a visit): "asked for, could not sell". A SKU, or for an
// item Kiran does not carry its product group, with no free text (H-27); a quantity and a reason. One
// client id per intent, kept until the database accepts it. Append-only: a tap is not edited here. The list
// reads the rep's own rows (demand_signal RLS). Online only until the rep outbox exists (P1-09).
export function LostDemand({ salonId }: { salonId: string }) {
  const [skus, setSkus] = useState<Sku[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [recent, setRecent] = useState<Signal[]>([]);
  const [reason, setReason] = useState("out_of_stock");
  const [item, setItem] = useState("");
  const [qty, setQty] = useState("");
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadRecent = useCallback(
    async () =>
      setRecent(
        await rows<Signal>(
          db()
            .from("demand_signal")
            .select("id, sku_id, product_group_id, qty, reason, created_at")
            .eq("salon_id", salonId)
            .order("created_at", { ascending: false })
            .limit(RECENT),
        ),
      ),
    [salonId],
  );
  useEffect(() => {
    void (async () => {
      try {
        const [s, g] = await Promise.all([
          rows<Sku>(db().from("sku").select("id, code, variant").eq("active", true).order("code").limit(LIMIT)),
          rows<Group>(db().from("product_group").select("id, name").eq("active", true).order("name").limit(LIMIT)),
          loadRecent(),
        ]);
        setSkus(s);
        setGroups(g);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    })();
  }, [loadRecent]);

  const notCarried = reason === NOT_CARRIED;
  const itemText = (r: Signal) => {
    if (r.product_group_id) return groups.find((g) => g.id === r.product_group_id)?.name ?? "Product group";
    const s = skus.find((x) => x.id === r.sku_id);
    return s ? `${s.code}${s.variant ? ` ${s.variant}` : ""}` : "SKU";
  };

  return (
    <section aria-labelledby="lost-h">
      <h2 id="lost-h">Lost demand</h2>
      <p className="muted">The salon asked for something and you could not sell it.</p>
      {notice && <output className="ok">{notice}</output>}
      {loading ? (
        <p className="muted" aria-busy="true">
          Loading…
        </p>
      ) : (
        <form
          className="card"
          aria-label="Record lost demand"
          onSubmit={async (e) => {
            e.preventDefault();
            setError(null);
            setNotice(null);
            const units = Number(qty);
            if (!Number.isInteger(units) || units < 1 || units > MAX_QTY) {
              setError(`Enter a whole number of units from 1 to ${MAX_QTY}.`);
              return;
            }
            setBusy(true);
            try {
              await rpc("record_demand", {
                p_client_id: key,
                p_sku_id: notCarried ? null : item,
                p_product_group_id: notCarried ? item : null,
                p_qty: units,
                p_reason: reason,
                p_salon_id: salonId,
                p_captured_at_client: new Date().toISOString(),
              });
              setKey(crypto.randomUUID());
              setQty("");
              setItem("");
              setNotice("Lost demand recorded.");
              await loadRecent();
            } catch (err) {
              setError((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label htmlFor="lost-reason">Why it could not be sold</label>
          <select
            id="lost-reason"
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
              setItem("");
            }}
          >
            {REP_REASONS.map((r) => (
              <option key={r} value={r}>
                {label(r)}
              </option>
            ))}
          </select>
          <label htmlFor="lost-item">{notCarried ? "Product group asked for" : "Item asked for"}</label>
          <select id="lost-item" value={item} onChange={(e) => setItem(e.target.value)} required>
            <option value="">Choose</option>
            {notCarried
              ? groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))
              : skus.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.code}
                    {s.variant ? ` ${s.variant}` : ""}
                  </option>
                ))}
          </select>
          <label htmlFor="lost-qty">Units asked for</label>
          <input id="lost-qty" inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} required />
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button type="submit" disabled={busy}>
            {busy ? "Saving…" : "Record lost demand"}
          </button>
        </form>
      )}
      {recent.length > 0 && (
        <ul className="plain">
          {recent.map((r) => (
            <li key={r.id} data-testid="lost-demand">
              {r.qty} × {itemText(r)} · {label(r.reason)} <span className="muted">{when(r.created_at)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
