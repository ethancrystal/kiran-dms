"use client";
import { use, useCallback, useEffect, useState } from "react";
import { rupees } from "@/lib/money";
import { db, rows, rpc } from "@/lib/rpc";
import { Acknowledgement, type AckLine, type AckResult } from "@/components/acknowledgement";
import { label, position } from "@/lib/salons";

type Order = { order_id: string; salon_id: string; salon_name: string | null; status: string; total_paisa: number };
type Remaining = { line_no: number; sku_id: string; ordered: number; delivered: number; remaining: number };
type Sku = { id: string; code: string; variant: string };
type Submission = { submission_id: string; order_id: string; status: string };

// app.rep_submit_delivery: the receiver's name is 2 to 80 characters (MJ L-0163).
const NAME_MIN = 2;
const NAME_MAX = 80;
const DELIVERABLE = ["confirmed", "partially_delivered"];
// Anything that is not a digit, removed as the rep types a quantity: "1a2" becomes "12", "7" stays "7".
// https://regex101.com/?regex=%5CD&flavor=javascript
const NOT_DIGIT = /\D/g;
// Pinned copy (plan Task 8, MJ's Decision 1: cash at the door is collected after approval).
const ACK_TEXT: Record<AckResult, string> = {
  signed: "The customer's acknowledgement is recorded.",
  refused: "Recorded: the customer refused to sign. The office will see your reason.",
  unable: "Recorded: no one could sign. The office will see your reason.",
  skipped: "No acknowledgement was recorded. The office will see that.",
};
const SENT = "Sent for approval. No invoice yet: the office approves first. Collect payment after approval.";

// The rep's delivery of one order assigned to it (D-32): what is left on the order (app.order_remaining)
// with a quantity per line, the receiver's name and the phone's GPS. Submitting moves the goods from the
// bag to the rep's pending location; nothing official changes until the office approves. One client id
// per open form, kept across retries, so a second tap or a retry after a network error replays the same
// submission instead of making another. Every refusal is the database's own words.
export default function DeliverOrder({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [order, setOrder] = useState<Order | null>(null);
  const [left, setLeft] = useState<Remaining[]>([]);
  const [skus, setSkus] = useState<Map<string, Sku>>(new Map());
  const [qty, setQty] = useState<Record<string, string>>({});
  const [waiting, setWaiting] = useState(false);
  const [name, setName] = useState("");
  const [clientId] = useState(() => crypto.randomUUID());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  // The submission just made and the goods in it, for the customer to acknowledge before the screen says "sent".
  const [ack, setAck] = useState<{ id: string; lines: AckLine[] } | null>(null);
  const [ackResult, setAckResult] = useState<AckResult | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [orders, remaining, mine] = await Promise.all([
        rpc<Order[]>("my_territory_orders"),
        rpc<Remaining[]>("order_remaining", { p_order_id: id }),
        rpc<Submission[]>("my_submissions"),
      ]);
      const o = (orders ?? []).find((x) => x.order_id === id) ?? null;
      const open = (remaining ?? []).filter((r) => r.remaining > 0);
      const found =
        open.length === 0
          ? []
          : await rows<Sku>(
              db()
                .from("sku")
                .select("id, code, variant")
                .in(
                  "id",
                  open.map((r) => r.sku_id),
                ),
            );
      setOrder(o);
      setLeft(open);
      setSkus(new Map(found.map((s) => [s.id, s])));
      setQty((q) => Object.fromEntries(open.map((r) => [r.sku_id, q[r.sku_id] ?? String(r.remaining)])));
      setWaiting((mine ?? []).some((s) => s.order_id === id && s.status === "pending"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const gps = await position();
      const lines = left
        .map((r) => ({ sku_id: r.sku_id, qty: Number.parseInt(qty[r.sku_id] ?? "", 10) }))
        .filter((l) => Number.isInteger(l.qty) && l.qty > 0);
      // Without a fix the call still goes out with no position, so the database's own GPS rule answers.
      const made = await rpc<{ id: string }>("rep_submit_delivery", {
        p_client_id: clientId,
        p_order_id: id,
        p_received_by_name: name.trim(),
        p_lat: gps?.lat ?? null,
        p_lng: gps?.lng ?? null,
        p_lines: lines,
        p_submitted_at_client: new Date().toISOString(),
      });
      setAck({
        id: made.id,
        lines: lines.map((l) => {
          const k = skus.get(l.sku_id);
          return { label: k ? `${k.code} ${k.variant}` : "Product", qty: l.qty };
        }),
      });
      setSent(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const deliverable = order && DELIVERABLE.includes(order.status) && !waiting && left.length > 0;
  return (
    <main>
      <p>
        <a href="/app/orders">← Orders</a>
      </p>
      <h1>Deliver</h1>
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
      {!loading && !order && !error && <p className="muted">This order is not in your territories.</p>}
      {order && (
        <p>
          <strong>{order.salon_name ?? "Unnamed salon"}</strong> · {rupees(Number(order.total_paisa))} ·{" "}
          <span className="badge">{label(order.status)}</span>
        </p>
      )}
      {sent && ack && ackResult === null && order && (
        <Acknowledgement
          salonName={order.salon_name ?? "the salon"}
          lines={ack.lines}
          onDone={setAckResult}
          record={async (a) => {
            await rpc("rep_attach_signature", {
              p_client_id: a.key,
              p_submission_id: ack.id,
              p_outcome: a.outcome,
              p_name: a.name,
              p_designation: a.designation,
              p_png_base64: a.png,
              p_note: a.note,
            });
          }}
        />
      )}
      {sent && ackResult !== null && (
        <p className="ok" data-testid="ack-result">
          {ACK_TEXT[ackResult]}
        </p>
      )}
      {sent && (ackResult !== null || !ack) && (
        <div className="card">
          <p className="ok" data-testid="delivery-sent">
            {SENT}
          </p>
          <p>
            <a href="/app/deliveries">See My deliveries</a>
          </p>
        </div>
      )}
      {!sent && order && waiting && <p className="muted">A delivery of this order is waiting for the office&apos;s approval.</p>}
      {!sent && order && !waiting && !DELIVERABLE.includes(order.status) && (
        <p className="muted">Only a confirmed order is delivered.</p>
      )}
      {!sent && deliverable && (
        <form
          className="card"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <p className="muted">
            Hand the goods over, then send this. The office approves it; the invoice comes only then. Collect payment after
            approval.
          </p>
          {left.map((r) => {
            const s = skus.get(r.sku_id);
            return (
              <div key={r.sku_id}>
                <label htmlFor={`dq-${r.sku_id}`}>
                  Handed over: {s ? `${s.code} ${s.variant}` : "Product"} (of {r.remaining} left)
                </label>
                <input
                  id={`dq-${r.sku_id}`}
                  inputMode="numeric"
                  value={qty[r.sku_id] ?? ""}
                  onChange={(e) => setQty((q) => ({ ...q, [r.sku_id]: e.target.value.replace(NOT_DIGIT, "") }))}
                />
              </div>
            );
          })}
          <label htmlFor="received-by">Received by (name)</label>
          <input
            id="received-by"
            value={name}
            onChange={(e) => setName(e.target.value)}
            minLength={NAME_MIN}
            maxLength={NAME_MAX}
            required
          />
          <button type="submit" disabled={busy}>
            {busy ? "Sending…" : "Send for approval"}
          </button>
        </form>
      )}
    </main>
  );
}
