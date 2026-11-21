"use client";
import { useCallback, useEffect, useState } from "react";
import { ListState } from "@/components/confirm-action";
import { openingDateProblem } from "@/lib/office-gaps";
import { karachiToday } from "@/lib/overview";
import { db, rows, rpc } from "@/lib/rpc";
import { label } from "@/lib/salons";
import { when } from "@/lib/time";

type Group = { id: string; name: string };
type Cycle = { product_group_id: string; last_order_on: string; basis: "opening" | "orders"; set_at: string };

// A-09 (PIP-03, D-19): until a salon has a delivery in a product group, the due list counts the cycle
// from an opening last-purchase date the office keys in. Written with app.office_set_last_purchase
// (owner or manager; no future date; refused once deliveries keep the cycle). Read from
// public.cycle_estimate through office RLS. A wrong date only moves a reminder.
export function OpeningPurchase({ salonId, onDone }: { salonId: string; onDone: (message: string) => Promise<void> }) {
  const [groups, setGroups] = useState<Group[]>([]);
  const [cycles, setCycles] = useState<Cycle[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [groupId, setGroupId] = useState("");
  const [day, setDay] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const [g, c] = await Promise.all([
        rows<Group>(db().from("product_group").select("id, name").eq("active", true).order("name")),
        rows<Cycle>(db().from("cycle_estimate").select("product_group_id, last_order_on, basis, set_at").eq("salon_id", salonId)),
      ]);
      setGroups(g);
      setCycles(c);
    } catch (e) {
      setLoadError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [salonId]);
  useEffect(() => {
    void load();
  }, [load]);

  const byGroup = new Map(cycles.map((c) => [c.product_group_id, c]));
  const groupName = (id: string) => groups.find((g) => g.id === id)?.name ?? "A product group";
  // A group whose cycle deliveries keep is refused by the database; it is not offered.
  const open = groups.filter((g) => byGroup.get(g.id)?.basis !== "orders");
  const today = karachiToday();

  return (
    <section className="card" aria-labelledby="opening-purchase-h">
      <h2 id="opening-purchase-h">Last purchase before this system</h2>
      <p className="muted">
        The due list counts each product group's cycle from the salon's last purchase. Until a delivery is recorded here, enter
        the date of the last purchase made before.
      </p>
      <ListState loading={loading} error={loadError} empty={false} emptyText="" />
      {!loading && !loadError && cycles.length > 0 && (
        <ul className="plain">
          {cycles.map((c) => (
            <li key={c.product_group_id} data-testid="opening-purchase-row">
              {groupName(c.product_group_id)}: last purchase {c.last_order_on}{" "}
              <span className="muted">
                ({c.basis === "orders" ? "kept by deliveries" : `${label(c.basis)} date, set ${when(c.set_at)}`})
              </span>
            </li>
          ))}
        </ul>
      )}
      {!loading && !loadError && open.length === 0 && <p className="muted">No product group can take an opening date.</p>}
      {!loading && !loadError && open.length > 0 && (
        <form
          aria-label="Set the last purchase date"
          onSubmit={async (e) => {
            e.preventDefault();
            const problem = groupId ? openingDateProblem(day, today) : "Choose a product group.";
            if (problem) return setError(problem);
            setBusy(true);
            setError(null);
            try {
              await rpc("office_set_last_purchase", { p_salon_id: salonId, p_product_group_id: groupId, p_last_order_on: day });
              setDay("");
              await load();
              await onDone(`Last purchase of ${groupName(groupId)} set to ${day}.`);
            } catch (err) {
              setError((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label htmlFor="opening-group">Product group for the last purchase</label>
          <select id="opening-group" value={groupId} onChange={(e) => setGroupId(e.target.value)} required>
            <option value="">Choose a product group</option>
            {open.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
          <label htmlFor="opening-day">Date of the last purchase</label>
          <input id="opening-day" type="date" value={day} max={today} onChange={(e) => setDay(e.target.value)} required />
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button type="submit" disabled={busy}>
            {busy ? "Saving…" : "Save last purchase date"}
          </button>
        </form>
      )}
    </section>
  );
}
