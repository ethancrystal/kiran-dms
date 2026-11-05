"use client";
import { useCallback, useEffect, useState } from "react";
import { ConfirmAction, ListState } from "@/components/confirm-action";
import { type CreatedOrder, type OrderCard, OrderForm, orderSummary, requestFrom } from "@/components/order-form";
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

// The office Orders area (D-30, D-34; spec sections 3 and 5). Owner or manager at AAL2. The Requests
// queue (app.office_open_cards) holds the reps' order cards and the salons' requests, each at its
// current version with the database's price per line. A request with lines converts in one click
// (app.office_create_order with no lines: the database takes the request's lines and prices, CASH,
// for the version shown); any request opens in the order form to change lines, plan or rep; a request
// is rejected with a reason (app.office_dismiss_card). Create New Order makes an order directly. The
// list is app.office_orders, newest 200, filtered in the database. Every rule is the database's.
export default function Orders() {
  const [cards, setCards] = useState<OrderCard[]>([]);
  const [cardsLoading, setCardsLoading] = useState(true);
  const [cardsError, setCardsError] = useState<string | null>(null);
  // A refused one-click conversion, shown above the queue without hiding it.
  const [queueError, setQueueError] = useState<string | null>(null);
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

  // One click: the request's own lines at the database's prices, on CASH, for the version shown. A rep's
  // card keeps its rep as the delivering rep (the database checks the rep still covers the salon); a
  // salon's request has none, so the office delivers. One key per attempt (H-08).
  const convert = async (c: OrderCard) => {
    setNotice(null);
    setQueueError(null);
    try {
      const order = await rpc<CreatedOrder>("office_create_order", {
        p_client_id: crypto.randomUUID(),
        p_salon_id: c.salon_id,
        p_plan: "CASH",
        p_lines: null,
        p_assigned_rep_id: c.rep_id,
        p_intake_card_id: c.card_id,
        p_card_version: c.version,
      });
      if (form.kind === "card" && form.card.card_id === c.card_id) setForm({ kind: "closed" });
      setNotice(
        `Order created for ${c.salon_name ?? "Unnamed salon"} from the request of ${requestFrom(c)}: ${orderSummary(order)}.`,
      );
      await Promise.all([loadCards(), loadOrders()]);
    } catch (e) {
      setQueueError((e as Error).message);
    }
  };

  const salonText = (id: string) => salonNames.get(id) ?? "Unnamed salon";
  const repText = (o: Order) => {
    const rep = deliveringRep(o);
    return rep ? (repNames.get(rep) ?? "A rep") : "No rep";
  };

  return (
    <>
      <h1>Orders</h1>
      <p className="muted">
        Reps and salons do not place orders: they send requests, and the office makes the order (D-30, D-34).
      </p>
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
        <h2 id="cards-h">Requests: order cards waiting and salon requests ({cards.length})</h2>
        <p className="muted">
          Prices are the database&apos;s: the salon&apos;s own price, else the list price. Convert to order makes a cash order of
          the lines shown; for another plan, rep or lines, open the request in the order form.
        </p>
        {queueError && (
          <p className="error" role="alert">
            {queueError}
          </p>
        )}
        <ListState loading={cardsLoading} error={cardsError} empty={cards.length === 0} emptyText="No requests are waiting." />
        {!cardsLoading && !cardsError && cards.length > 0 && (
          <ul className="plain">
            {cards.map((c) => (
              <li key={c.card_id} data-testid="request">
                <p>
                  <span className="badge">{c.submitter_kind === "salon" ? "Salon request" : "Order card"}</span>{" "}
                  <strong>{c.salon_name ?? "Unnamed salon"}</strong>
                </p>
                {c.body && <p>{c.body}</p>}
                {c.lines.length > 0 && (
                  <table>
                    <thead>
                      <tr>
                        <th>Product</th>
                        <th>Quantity</th>
                        <th>Price each</th>
                      </tr>
                    </thead>
                    <tbody>
                      {c.lines.map((l) => (
                        <tr key={l.line_no}>
                          <td data-label="Product">
                            {l.code} · {l.product_name} {l.variant}
                          </td>
                          <td data-label="Quantity">{l.qty}</td>
                          <td data-label="Price each">{rupees(Number(l.price_paisa))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                <p className="muted">
                  From {requestFrom(c)} · {when(c.created_at)}
                  {c.version > 1 && ` · edited, version ${c.version}, ${when(c.updated_at)}`}
                  {c.estimate_paisa !== null && ` · ${rupees(Number(c.estimate_paisa))} at these prices`}
                </p>
                <div className="row">
                  {c.lines.length > 0 && (
                    <button type="button" className="inline" onClick={() => void convert(c)}>
                      Convert to order
                    </button>
                  )}
                  <button
                    type="button"
                    className="inline"
                    onClick={() => {
                      setNotice(null);
                      setForm({ kind: "card", card: c });
                    }}
                  >
                    {c.lines.length > 0 ? "Open in the order form" : "Create order from this card"}
                  </button>
                  <ConfirmAction
                    label={c.submitter_kind === "salon" ? "Reject" : "Dismiss"}
                    confirmLabel={c.submitter_kind === "salon" ? "Reject request" : "Dismiss card"}
                    reasonLabel={
                      c.submitter_kind === "salon" ? "Why reject this request (the salon sees this)" : "Why dismiss this card"
                    }
                    reasonMinLength={DISMISS_REASON_MIN_LENGTH}
                    danger
                    onConfirm={async (reason) => {
                      await rpc("office_dismiss_card", { p_card_id: c.card_id, p_reason: reason });
                      if (form.kind === "card" && form.card.card_id === c.card_id) setForm({ kind: "closed" });
                      setNotice(
                        c.submitter_kind === "salon"
                          ? `Request from ${c.salon_name ?? "the salon"} rejected.`
                          : `Card from ${c.rep_name ?? "a rep"} dismissed.`,
                      );
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
