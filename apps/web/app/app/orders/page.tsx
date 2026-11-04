"use client";
import { useCallback, useEffect, useState } from "react";
import { rupees } from "@/lib/money";
import { rpc } from "@/lib/rpc";
import { label } from "@/lib/salons";
import { supabaseBrowser } from "@/lib/supabase/browser";

type Order = {
  order_id: string;
  salon_id: string;
  salon_name: string | null;
  status: string;
  plan: string;
  total_paisa: number;
  assigned_rep_id: string | null;
  created_at: string;
};

const when = (t: string) => new Date(t).toLocaleString("en-PK", { dateStyle: "medium", timeStyle: "short" });

// The orders of the salons in the rep's territories (D-30): app.my_territory_orders, newest 50,
// read-only. Reps do not create orders; there is no control for it here, and the database refuses the
// old rep path (app.create_order) for everyone. A rep reads only its own profile, so another rep's
// name is not shown.
export default function TerritoryOrders() {
  const [list, setList] = useState<Order[]>([]);
  const [me, setMe] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [o, u] = await Promise.all([rpc<Order[]>("my_territory_orders"), supabaseBrowser().auth.getUser()]);
      // Without the rep's own id the page cannot tell "Assigned to you" from another rep: show the error.
      if (u.error || !u.data.user) throw new Error("Could not read your sign-in. Reload the page or sign in again.");
      setList(o ?? []);
      setMe(u.data.user.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const deliverer = (o: Order) => {
    if (!o.assigned_rep_id) return "No rep: the office delivers";
    return o.assigned_rep_id === me ? "Assigned to you" : "Assigned to another rep";
  };

  return (
    <main>
      <p>
        <a href="/app">← Today</a>
      </p>
      <h1>
        Orders · <span lang="ur">آرڈرز</span>
      </h1>
      <p className="muted">
        Orders are made by the office, often from your order cards. To ask for one, save New Order Details on the salon&apos;s
        page.
      </p>
      {loading && (
        <p className="muted" aria-busy="true">
          Loading…
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!loading && !error && list.length === 0 && <p className="muted">No orders in your territories yet.</p>}
      {!error && list.length > 0 && (
        <ul className="plain">
          {list.map((o) => (
            <li key={o.order_id}>
              <span className="badge">{label(o.status)}</span> <strong>{o.salon_name ?? "Unnamed salon"}</strong> ·{" "}
              {rupees(Number(o.total_paisa))} · {o.plan}
              <br />
              <span className="muted">
                {deliverer(o)} · {when(o.created_at)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
