"use client";
import { useCallback, useEffect, useState } from "react";
import { ConfirmAction, ListState } from "@/components/confirm-action";
import { type OrderCard, OrderForm, orderSummary } from "@/components/order-form";
import { rupees } from "@/lib/money";
import { db, rows, rpc } from "@/lib/rpc";
import { label } from "@/lib/salons";

type Order = {
  id: string;
  salon_id: string;
  status: string;
  plan: string;
  total_paisa: number;
  source_channel: string;
  rep_id: string | null;
  assigned_rep_id: string | null;
  created_at: string;
};
type Names = Map<string, string | null>;

// public.order_status and public.order_channel (migrations 0012 and 0025).
const STATUSES = ["draft", "confirmed", "partially_delivered", "delivered", "closed", "cancelled"];
const CHANNELS = ["office", "rep_visit", "salon_portal"];
// Ids per name lookup, so a page of 200 orders never builds one over-long request URL.
const NAME_CHUNK = 50;
// app.office_dismiss_card refuses a reason shorter than 5 characters (22023).
const DISMISS_REASON_MIN_LENGTH = 5;

const when = (t: string) => new Date(t).toLocaleString("en-PK", { dateStyle: "medium", timeStyle: "short" });

// The rep who delivers: the assigned rep of an office order, or the rep who took a rep_visit order.
const deliveringRep = (o: Order) => o.assigned_rep_id ?? o.rep_id;

const chunks = (ids: string[]) =>
  Array.from({ length: Math.ceil(ids.length / NAME_CHUNK) }, (_, n) => ids.slice(n * NAME_CHUNK, (n + 1) * NAME_CHUNK));

/** id → name for the ids given, read under RLS (office users read salons and profiles). */
async function namesOf(table: "salon" | "user_profile", column: "name" | "full_name", ids: string[]): Promise<Names> {
  const parts = await Promise.all(
    chunks([...new Set(ids)]).map((part) =>
      rows<{ id: string } & Record<string, string | null>>(db().from(table).select(`id, ${column}`).in("id", part)),
    ),
  );
  return new Map(parts.flat().map((r) => [r.id, r[column] ?? null]));
}

type FormState = { kind: "closed" } | { kind: "new" } | { kind: "card"; card: OrderCard };

// The office Orders area (D-30; spec section 6). Owner or manager at AAL2. The open order cards reps
// saved (app.office_open_cards) are converted into orders or dismissed with a reason
// (app.office_dismiss_card); Create New Order makes an order directly (app.office_create_order). The
// list is app.office_orders, newest 200, filtered in the database. Every rule is the database's.
export default function Orders() {
  const [cards, setCards] = useState<OrderCard[]>([]);
  const [cardsLoading, setCardsLoading] = useState(true);
  const [cardsError, setCardsError] = useState<string | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [salonNames, setSalonNames] = useState<Names>(new Map());
  const [repNames, setRepNames] = useState<Names>(new Map());
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [ordersError, setOrdersError] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [channel, setChannel] = useState("");
  const [form, setForm] = useState<FormState>({ kind: "closed" });
  const [notice, setNotice] = useState<string | null>(null);

  const loadCards = useCallback(async () => {
    setCardsLoading(true);
    setCardsError(null);
    try {
      setCards((await rpc<OrderCard[]>("office_open_cards")) ?? []);
    } catch (e) {
      setCardsError((e as Error).message);
    } finally {
      setCardsLoading(false);
    }
  }, []);

  const loadOrders = useCallback(async () => {
    setOrdersLoading(true);
    setOrdersError(null);
    try {
      const list = (await rpc<Order[]>("office_orders", { p_status: status || null, p_channel: channel || null })) ?? [];
      const [s, r] = await Promise.all([
        namesOf(
          "salon",
          "name",
          list.map((o) => o.salon_id),
        ),
        namesOf(
          "user_profile",
          "full_name",
          list.flatMap((o) => {
            const rep = deliveringRep(o);
            return rep ? [rep] : [];
          }),
        ),
      ]);
      setOrders(list);
      setSalonNames(s);
      setRepNames(r);
    } catch (e) {
      setOrdersError((e as Error).message);
    } finally {
      setOrdersLoading(false);
    }
  }, [status, channel]);

  useEffect(() => {
    void loadCards();
  }, [loadCards]);
  useEffect(() => {
    void loadOrders();
  }, [loadOrders]);

  const salonText = (id: string) => salonNames.get(id) ?? "Unnamed salon";
  const repText = (o: Order) => {
    const rep = deliveringRep(o);
    return rep ? (repNames.get(rep) ?? "A rep") : "No rep";
  };

  return (
    <>
      <h1>Orders</h1>
      <p className="muted">Reps do not place orders: they save order cards, and the office makes the order (D-30).</p>
      {notice && <output className="ok">{notice}</output>}

      {form.kind === "closed" ? (
        <button
          type="button"
          className="inline"
          onClick={() => {
            setNotice(null);
            setForm({ kind: "new" });
          }}
        >
          Create New Order
        </button>
      ) : (
        <OrderForm
          key={form.kind === "card" ? form.card.card_id : "new"}
          card={form.kind === "card" ? form.card : null}
          onCancel={() => setForm({ kind: "closed" })}
          onDone={async (order, salonName) => {
            setForm({ kind: "closed" });
            setNotice(`Order created for ${salonName}: ${orderSummary(order)}.`);
            await Promise.all([loadCards(), loadOrders()]);
          }}
        />
      )}

      <section aria-labelledby="cards-h">
        <h2 id="cards-h">Order cards waiting ({cards.length})</h2>
        <ListState loading={cardsLoading} error={cardsError} empty={cards.length === 0} emptyText="No order cards are waiting." />
        {!cardsLoading && !cardsError && cards.length > 0 && (
          <ul className="plain">
            {cards.map((c) => (
              <li key={c.card_id}>
                <p>{c.body}</p>
                <p className="muted">
                  {c.salon_name ?? "Unnamed salon"} · from {c.rep_name} · {when(c.created_at)}
                </p>
                <div className="row">
                  <button
                    type="button"
                    className="inline"
                    onClick={() => {
                      setNotice(null);
                      setForm({ kind: "card", card: c });
                    }}
                  >
                    Create order from this card
                  </button>
                  <ConfirmAction
                    label="Dismiss"
                    confirmLabel="Dismiss card"
                    reasonLabel="Why dismiss this card"
                    reasonMinLength={DISMISS_REASON_MIN_LENGTH}
                    danger
                    onConfirm={async (reason) => {
                      await rpc("office_dismiss_card", { p_card_id: c.card_id, p_reason: reason });
                      if (form.kind === "card" && form.card.card_id === c.card_id) setForm({ kind: "closed" });
                      setNotice(`Card from ${c.rep_name} dismissed.`);
                      await loadCards();
                    }}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="orders-h">
        <h2 id="orders-h">Order list</h2>
        <div className="inline-form">
          <label>
            Status
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {label(s)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Channel
            <select value={channel} onChange={(e) => setChannel(e.target.value)}>
              <option value="">All</option>
              {CHANNELS.map((c) => (
                <option key={c} value={c}>
                  {label(c)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <ListState loading={ordersLoading} error={ordersError} empty={orders.length === 0} emptyText="No orders match." />
        {!ordersLoading && !ordersError && orders.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>Created</th>
                <th>Salon</th>
                <th>Status</th>
                <th>Plan</th>
                <th>Total</th>
                <th>Delivering rep</th>
                <th>Channel</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id}>
                  <td data-label="Created">{when(o.created_at)}</td>
                  <td data-label="Salon">
                    <a href={`/office/salons/${o.salon_id}`}>{salonText(o.salon_id)}</a>
                  </td>
                  <td data-label="Status">
                    <span className="badge">{label(o.status)}</span>
                  </td>
                  <td data-label="Plan">{o.plan}</td>
                  <td data-label="Total">{rupees(Number(o.total_paisa))}</td>
                  <td data-label="Delivering rep">{repText(o)}</td>
                  <td data-label="Channel">{label(o.source_channel)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
