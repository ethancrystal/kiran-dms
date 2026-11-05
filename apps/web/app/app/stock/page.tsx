"use client";
import { useCallback, useEffect, useState } from "react";
import { db, rows, rpc } from "@/lib/rpc";

type Issue = {
  id: string;
  direction: "to_rep" | "to_warehouse";
  lines: Array<{ sku_id: string; qty: number }>;
  decision_note: string | null;
  created_at: string;
};
type Sku = { id: string; code: string; variant: string | null };
type BagLine = { sku_id: string; code: string; variant: string | null; on_hand: number };
type Confirmed = { status: string };
type Available = { sku_id: string; code: string; available: number };

const when = (t: string) => new Date(t).toLocaleString("en-PK", { dateStyle: "medium", timeStyle: "short" });

// My bag and incoming stock (rep, approved phone; INV-03, INV-04, CTL-05 two-party custody). The office proposes
// a stock issue to this rep's bag, or a return from it (direction to_warehouse), on /office/stock; the rep counts what it was handed and confirms with
// its own count (app.rep_confirm_stock_issue). The count is blind: the fields start empty and the page
// does not show the office's quantities, so the confirmation is a real second count, not a click
// (the rep still sees which SKUs to count; the issue row is readable under RLS). The same count posts the
// movements; any other count marks the issue disputed and moves nothing (the office cancels and proposes
// again). Pending issues are read under RLS (stock_issue: only this rep's own bag); the bag is
// app.my_bag. Every refusal is the database's words.
export default function MyStock() {
  const [issues, setIssues] = useState<Issue[]>([]);
  const [skus, setSkus] = useState<Map<string, Sku>>(new Map());
  const [bag, setBag] = useState<BagLine[]>([]);
  const [available, setAvailable] = useState<Available[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [i, b, a] = await Promise.all([
        rows<Issue>(
          db()
            .from("stock_issue")
            .select("id, direction, lines, decision_note, created_at")
            .eq("status", "pending")
            .order("created_at"),
        ),
        rpc<BagLine[]>("my_bag"),
        rpc<Available[]>("warehouse_availability"),
      ]);
      const ids = [...new Set(i.flatMap((x) => x.lines.map((l) => l.sku_id)))];
      const s = ids.length ? await rows<Sku>(db().from("sku").select("id, code, variant").in("id", ids)) : [];
      setIssues(i);
      setBag(b ?? []);
      setAvailable(a ?? []);
      setSkus(new Map(s.map((x) => [x.id, x])));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const incoming = issues.filter((i) => i.direction === "to_rep");
  const going = issues.filter((i) => i.direction === "to_warehouse");
  const finished = async (m: string) => {
    setNotice(m);
    await load();
  };
  const skuText = (id: string) => {
    const s = skus.get(id);
    return s ? `${s.code}${s.variant ? ` ${s.variant}` : ""}` : "Unknown SKU";
  };

  return (
    <main>
      <p>
        <a href="/app">← Today</a>
      </p>
      <h1>My bag and incoming stock</h1>
      {notice && <output className="ok">{notice}</output>}
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
      {!loading && !error && (
        <>
          <section aria-labelledby="incoming-h">
            <h2 id="incoming-h">Incoming stock ({incoming.length})</h2>
            {incoming.length === 0 ? (
              <p className="muted">No stock is waiting for you.</p>
            ) : (
              incoming.map((i) => <IncomingCard key={i.id} issue={i} skuText={skuText} onDone={finished} />)
            )}
          </section>
          {going.length > 0 && (
            <section aria-labelledby="going-h">
              <h2 id="going-h">Going back to the warehouse ({going.length})</h2>
              {going.map((i) => (
                <IncomingCard key={i.id} issue={i} skuText={skuText} onDone={finished} />
              ))}
            </section>
          )}
          <section aria-labelledby="bag-h">
            <h2 id="bag-h">In my bag</h2>
            {bag.length === 0 ? (
              <p className="muted">Your bag is empty.</p>
            ) : (
              <ul className="plain">
                {bag.map((b) => (
                  <li key={b.sku_id} data-testid="bag-line">
                    {b.code}
                    {b.variant ? ` ${b.variant}` : ""}: {b.on_hand}
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section aria-labelledby="available-h">
            <h2 id="available-h">In the warehouse</h2>
            {available.length === 0 ? (
              <p className="muted">No warehouse stock to show.</p>
            ) : (
              <ul className="plain">
                {available.map((a) => (
                  <li key={a.sku_id} data-testid="warehouse-line">
                    {a.code}: {a.available}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </main>
  );
}

function IncomingCard({
  issue,
  skuText,
  onDone,
}: {
  issue: Issue;
  skuText: (id: string) => string;
  onDone: (m: string) => Promise<void>;
}) {
  const [counted, setCounted] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const back = issue.direction === "to_warehouse";
  return (
    <form
      className="card"
      aria-label={`${back ? "Stock return" : "Stock issue"} of ${when(issue.created_at)}`}
      data-testid={back ? "outgoing-return" : "incoming-issue"}
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        const lines = issue.lines.map((l) => ({ sku_id: l.sku_id, qty: Number(counted[l.sku_id] ?? "") }));
        if (
          lines.some((l) => !Number.isInteger(l.qty) || l.qty < 0 || counted[l.sku_id] === undefined || counted[l.sku_id] === "")
        ) {
          setError("Type the whole number you counted for every line (0 if none).");
          return;
        }
        setBusy(true);
        try {
          const r = await rpc<Confirmed>("rep_confirm_stock_issue", { p_issue_id: issue.id, p_counted: lines });
          await onDone(
            r.status === "confirmed"
              ? back
                ? "Confirmed: the stock has gone back to the warehouse."
                : "Confirmed: the stock is in your bag."
              : "Your count differs from the office's, so the issue is disputed and nothing moved. The office will check it.",
          );
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <p>
        Sent {when(issue.created_at)}
        {issue.decision_note && <> · {issue.decision_note}</>}
      </p>
      <p className="muted">
        {back ? "Count what you are handing back and type it." : "Count what you were handed and type it."} If your count differs,
        nothing moves until the office checks.
      </p>
      {issue.lines.map((l) => (
        <div key={l.sku_id}>
          <label htmlFor={`count-${issue.id}-${l.sku_id}`}>
            {back ? "Counted going back" : "Counted of incoming"} {skuText(l.sku_id)}
          </label>
          <input
            id={`count-${issue.id}-${l.sku_id}`}
            inputMode="numeric"
            value={counted[l.sku_id] ?? ""}
            onChange={(e) => setCounted((all) => ({ ...all, [l.sku_id]: e.target.value }))}
          />
        </div>
      ))}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="inline" disabled={busy}>
        {busy ? "Saving…" : "Confirm my count"}
      </button>
    </form>
  );
}
