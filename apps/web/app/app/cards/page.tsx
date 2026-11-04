"use client";
import { useCallback, useEffect, useState } from "react";
import { rpc } from "@/lib/rpc";

type Card = {
  card_id: string;
  salon_id: string;
  salon_name: string | null;
  body: string;
  created_at: string;
  status: "open" | "converted" | "dismissed";
  order_id: string | null;
  reason: string | null;
};

// Characters of the order id shown to the rep: enough to quote it to the office.
const SHORT_ID = 8;
const when = (t: string) => new Date(t).toLocaleString("en-PK", { dateStyle: "medium", timeStyle: "short" });
const STATUS_TEXT: Record<Card["status"], string> = {
  open: "Open",
  converted: "Converted",
  dismissed: "Dismissed",
};

// The rep's order cards (ORD-14, D-30): app.my_cards, the newest 50, each open, converted into an order
// by the office, or dismissed with the office's reason. A salon the rep no longer covers shows no name.
export default function MyCards() {
  const [list, setList] = useState<Card[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setList((await rpc<Card[]>("my_cards")) ?? []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <main>
      <p>
        <a href="/app">← Today</a>
      </p>
      <h1>My cards</h1>
      <p className="muted">What salons asked for. Save New Order Details on a salon&apos;s page; the office makes the order.</p>
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
      {!loading && !error && list.length === 0 && <p className="muted">No order cards yet.</p>}
      {list.length > 0 && (
        <ul className="plain">
          {list.map((c) => (
            <li key={c.card_id}>
              <span className="badge">{STATUS_TEXT[c.status]}</span>{" "}
              {c.salon_name ? (
                <a href={`/app/salons/${c.salon_id}`}>{c.salon_name}</a>
              ) : (
                <span className="muted">A salon you no longer cover</span>
              )}
              <br />
              {c.body}
              <br />
              <span className="muted">
                {when(c.created_at)}
                {c.status === "converted" && c.order_id && ` · made into order ${c.order_id.slice(0, SHORT_ID)}`}
                {c.status === "dismissed" && c.reason && ` · ${c.reason}`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
