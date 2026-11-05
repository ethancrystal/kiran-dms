"use client";
import { useCallback, useEffect, useState } from "react";
import { ConfirmAction } from "@/components/confirm-action";
import { LinePicker, newPick, type PickLine, picksPayload } from "@/components/request-lines";
import { rupees } from "@/lib/money";
import { SALON_WAITING_TEXT } from "@/lib/overview";
import { signedImageUrls } from "@/lib/product-images";
import { rpc } from "@/lib/rpc";
import { label } from "@/lib/salons";
import { supabaseBrowser } from "@/lib/supabase/browser";

type Me = { name: string | null; address: string | null; approval_status: string; membership_status: string };
type Item = {
  product_id: string;
  brand_label: string;
  product_name: string;
  description: string | null;
  image_path: string | null;
  group_name: string;
  sku_id: string;
  code: string;
  variant: string;
  unit: string;
  size_value: number | null;
  price_paisa: number;
  own_price: boolean;
};
type RequestLine = {
  line_no: number;
  sku_id: string;
  code: string;
  product_name: string;
  variant: string;
  qty: number;
  price_paisa: number;
};
type Request = {
  request_id: string;
  created_at: string;
  updated_at: string;
  version: number;
  note: string | null;
  lines: RequestLine[];
  status: "open" | "converted" | "dismissed" | "cancelled";
  order_id: string | null;
  reason: string | null;
};
type OrderLine = {
  line_no: number;
  code: string;
  product_name: string;
  variant: string;
  qty: number;
  unit_price_paisa: number;
  line_total_paisa: number;
};
type Order = {
  order_id: string;
  created_at: string;
  status: string;
  plan: string;
  subtotal_paisa: number;
  discount_paisa: number;
  total_paisa: number;
  from_request: boolean;
  lines: OrderLine[];
  /** AUTH-10 (P1-30): what an order on hold waits for, in one fixed word; null otherwise. */
  waiting_on: string | null;
};
type Account = {
  balance: {
    invoiced_paisa: number;
    paid_paisa: number;
    balance_paisa: number;
    overdue_paisa: number;
    next_due_on: string | null;
  };
  installments: Array<{
    invoice_number: string;
    seq: number;
    of_count: number;
    due_on: string;
    remaining_paisa: number;
    status: string;
  }>;
  payments: Array<{ receipt_number: string; paid_at: string; method: string; amount_paisa: number; reversed?: boolean }>;
};
type Portal = { me: Me; account: Account; catalogue: Item[]; requests: Request[]; orders: Order[] };
type State =
  | { kind: "loading" }
  | { kind: "none"; status: string | null }
  | { kind: "ready"; data: Portal }
  | { kind: "error"; message: string };
type BasketLine = { skuId: string; qty: string };

// Characters of an order id shown to the salon: enough to quote it to the office.
const SHORT_ID = 8;
// app.card_note: a note of at most 2000 characters; app.assert_card_lines: 1 to 50 lines, 1 to 10000 each.
const NOTE_MAX = 2000;
const NOTE_ROWS = 3;
const MAX_LINES = 50;
const QTY_MAX = 10_000;
const when = (t: string) => new Date(t).toLocaleString("en-PK", { dateStyle: "medium", timeStyle: "short" });
const day = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("en-PK", { dateStyle: "medium" });
const REQUEST_STATUS: Record<Request["status"], string> = {
  open: "Waiting for the office",
  converted: "Made into an order",
  dismissed: "Rejected",
  cancelled: "Cancelled",
};
// AUTH-09 (P1-30): the account's own status (app.salon_login_status); the office's reason is not shown.
const ACCOUNT_STATE: Record<string, string> = {
  suspended: "This salon account is suspended by the office. Contact the office to have it reactivated.",
  revoked: "This salon account is closed. If the office sends you a new invitation, open its link.",
};
const itemText = (i: Item) => `${i.code} · ${i.product_name} ${i.variant} · ${rupees(Number(i.price_paisa))}`;

// The salon portal (D-34, D-41; spec section 5). Every figure, price and list comes from an app.salon_*
// function that finds the salon from this login's active membership; nothing here sends a salon id.
// The salon sends a request (app.salon_submit_request); the office makes the order. Prices are the
// database's: the salon's own price, else the list price. A request may be edited or cancelled until
// the office acts on it; then the database refuses and the page says why.
export default function SalonHome() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [pictures, setPictures] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const me = await rpc<Me | null>("salon_me");
      if (!me) {
        // AUTH-09 (P1-30): a suspended or closed account is told so, not "no account".
        const own = await rpc<{ membership_status: string } | null>("salon_login_status");
        setState({ kind: "none", status: own?.membership_status ?? null });
        return;
      }
      const [account, catalogue, requests, orders] = await Promise.all([
        rpc<Account>("salon_my_account"),
        rpc<Item[]>("salon_catalogue"),
        rpc<Request[]>("salon_my_requests"),
        rpc<Order[]>("salon_my_orders"),
      ]);
      setState({
        kind: "ready",
        data: { me, account, catalogue: catalogue ?? [], requests: requests ?? [], orders: orders ?? [] },
      });
      // Pictures are a help, not a requirement: a storage failure shows no picture, not an error.
      setPictures(await signedImageUrls((catalogue ?? []).map((i) => i.image_path)));
    } catch (e) {
      setState({ kind: "error", message: (e as Error).message });
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const done = async (message: string) => {
    setNotice(message);
    await load();
  };

  return (
    <main>
      <h1>Your salon account</h1>
      {notice && <output className="ok">{notice}</output>}
      {state.kind === "loading" && (
        <p className="muted" aria-busy="true">
          Loading…
        </p>
      )}
      {state.kind === "error" && (
        <p className="error" role="alert">
          {state.message}
        </p>
      )}
      {state.kind === "none" && (
        <p className="error" role="alert" data-testid="salon-account-state">
          {ACCOUNT_STATE[state.status ?? ""] ??
            "This login has no active salon account. If the office sent you an invitation, open its link; otherwise ask the office."}
        </p>
      )}
      {state.kind === "ready" && (
        <>
          <section className="card" aria-labelledby="salon-h">
            <h2 id="salon-h">{state.data.me.name ?? "Your salon"}</h2>
            {state.data.me.address && <p>{state.data.me.address}</p>}
            <p>
              Account: <span className="badge">{label(state.data.me.membership_status)}</span>
            </p>
            {state.data.me.approval_status !== "approved" && (
              <p className="muted" data-testid="pending-notice">
                Your salon is {label(state.data.me.approval_status)}: the office has not approved it yet, so it cannot order.
              </p>
            )}
          </section>
          <Balance account={state.data.account} />
          <Shop
            catalogue={state.data.catalogue}
            pictures={pictures}
            canOrder={state.data.me.approval_status === "approved"}
            onSent={() => done("Request sent. The office will make the order from it.")}
          />
          <Requests requests={state.data.requests} catalogue={state.data.catalogue} onChanged={done} />
          <Orders orders={state.data.orders} />
          <Payments account={state.data.account} />
        </>
      )}
      <button
        type="button"
        className="inline link"
        onClick={async () => {
          await supabaseBrowser().auth.signOut();
          window.location.assign("/salon/login");
        }}
      >
        Sign out
      </button>
    </main>
  );
}

/** What the salon owes, derived by the database from its invoices and payments. */
function Balance({ account }: { account: Account }) {
  const b = account.balance;
  return (
    <section className="card" aria-labelledby="balance-h">
      <h2 id="balance-h">Balance</h2>
      <p>
        You owe <strong data-testid="salon-balance">{rupees(Number(b.balance_paisa))}</strong>
        {Number(b.overdue_paisa) > 0 && <>, of which {rupees(Number(b.overdue_paisa))} is overdue</>}.
      </p>
      <p className="muted">
        Invoiced {rupees(Number(b.invoiced_paisa))} · paid {rupees(Number(b.paid_paisa))}
        {b.next_due_on && ` · next payment due ${day(b.next_due_on)}`}
      </p>
      {account.installments.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Invoice</th>
              <th>Installment</th>
              <th>Due</th>
              <th>Still due</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {account.installments.map((x) => (
              <tr key={`${x.invoice_number}-${x.seq}`}>
                <td data-label="Invoice">{x.invoice_number}</td>
                <td data-label="Installment">
                  {x.seq} of {x.of_count}
                </td>
                <td data-label="Due">{day(x.due_on)}</td>
                <td data-label="Still due">{rupees(Number(x.remaining_paisa))}</td>
                <td data-label="Status">{label(x.status)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

/** The catalogue with pictures and the salon's prices, a basket and Send request. */
function Shop({
  catalogue,
  pictures,
  canOrder,
  onSent,
}: {
  catalogue: Item[];
  pictures: Record<string, string>;
  canOrder: boolean;
  onSent: () => Promise<void>;
}) {
  const [basket, setBasket] = useState<BasketLine[]>([]);
  const [adding, setAdding] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One key per attempt: a retry after a lost answer is the same request (H-08).
  const [clientId, setClientId] = useState(() => crypto.randomUUID());
  const item = (skuId: string) => catalogue.find((i) => i.sku_id === skuId);
  const estimate = basket.reduce((sum, b) => sum + Number(item(b.skuId)?.price_paisa ?? 0) * Number(b.qty || 0), 0);

  const add = (i: Item) => {
    const qty = adding[i.sku_id] ?? "1";
    setError(null);
    if (!Number.isInteger(Number(qty)) || Number(qty) < 1 || Number(qty) > QTY_MAX) {
      setError(`Enter a whole quantity from 1 to ${QTY_MAX}.`);
      return;
    }
    setBasket((all) =>
      all.some((b) => b.skuId === i.sku_id)
        ? all.map((b) => (b.skuId === i.sku_id ? { ...b, qty: String(Number(b.qty) + Number(qty)) } : b))
        : [...all, { skuId: i.sku_id, qty }],
    );
  };

  return (
    <>
      <section className="card" aria-labelledby="catalogue-h">
        <h2 id="catalogue-h">Products</h2>
        <p className="muted">Prices are your prices, set by the office. The office confirms every order.</p>
        {catalogue.length === 0 && <p className="muted">No products are listed yet.</p>}
        <ul className="plain">
          {catalogue.map((i) => (
            <li key={i.sku_id} data-testid="catalogue-item">
              {i.image_path && pictures[i.image_path] && (
                <img className="thumb small" src={pictures[i.image_path]} alt={i.product_name} />
              )}
              <strong>
                {i.brand_label} {i.product_name}
              </strong>{" "}
              {i.variant} <span className="muted">({i.code})</span>
              <br />
              <span data-testid={`price-${i.code}`}>{rupees(Number(i.price_paisa))}</span>
              {i.own_price && <span className="badge">Your price</span>}
              {i.description && <p className="muted">{i.description}</p>}
              {canOrder && basket.length < MAX_LINES && (
                <div className="inline-form">
                  <label htmlFor={`add-${i.sku_id}`}>Quantity of {i.code} to add</label>
                  <input
                    id={`add-${i.sku_id}`}
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={QTY_MAX}
                    step={1}
                    value={adding[i.sku_id] ?? "1"}
                    onChange={(e) => setAdding((all) => ({ ...all, [i.sku_id]: e.target.value }))}
                  />
                  <button type="button" className="inline" onClick={() => add(i)}>
                    Add {i.code} to the basket
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>

      <form
        className="card"
        aria-labelledby="basket-h"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            const lines = picksPayload(basket.map((b) => newPick(b.skuId, b.qty)));
            if (!lines) throw new Error("Add at least one product to the basket.");
            await rpc("salon_submit_request", { p_client_id: clientId, p_lines: lines, p_note: note.trim() || null });
            setBasket([]);
            setNote("");
            setClientId(crypto.randomUUID());
            await onSent();
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <h2 id="basket-h">Basket ({basket.length})</h2>
        {basket.length === 0 && <p className="muted">Your basket is empty.</p>}
        {basket.map((b) => {
          const i = item(b.skuId);
          const code = i?.code ?? "product";
          return (
            <div key={b.skuId} className="inline-form" data-testid="basket-line">
              <span>{i ? itemText(i) : "A product no longer listed"}</span>
              <label htmlFor={`basket-${b.skuId}`}>Basket quantity of {code}</label>
              <input
                id={`basket-${b.skuId}`}
                type="number"
                inputMode="numeric"
                min={1}
                max={QTY_MAX}
                step={1}
                value={b.qty}
                onChange={(e) => setBasket((all) => all.map((x) => (x.skuId === b.skuId ? { ...x, qty: e.target.value } : x)))}
              />
              <button
                type="button"
                className="inline link"
                onClick={() => setBasket((all) => all.filter((x) => x.skuId !== b.skuId))}
              >
                Remove {code}
              </button>
            </div>
          );
        })}
        {basket.length > 0 && (
          <p className="muted" data-testid="basket-estimate">
            About {rupees(estimate)} at your prices today; the office&apos;s order shows the final amount.
          </p>
        )}
        <label htmlFor="basket-note">A note for the office (optional)</label>
        <textarea id="basket-note" rows={NOTE_ROWS} value={note} onChange={(e) => setNote(e.target.value)} maxLength={NOTE_MAX} />
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" disabled={busy || !canOrder || basket.length === 0}>
          {busy ? "Sending…" : "Send request"}
        </button>
      </form>
    </>
  );
}

/** The salon's requests: open ones can be edited (a new version) or cancelled until the office acts. */
function Requests({
  requests,
  catalogue,
  onChanged,
}: {
  requests: Request[];
  catalogue: Item[];
  onChanged: (message: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  return (
    <section className="card" aria-labelledby="requests-h">
      <h2 id="requests-h">My requests</h2>
      {requests.length === 0 && <p className="muted">No requests yet.</p>}
      <ul className="plain">
        {requests.map((r) => (
          <li key={r.request_id} data-testid="salon-request">
            <span className="badge">{REQUEST_STATUS[r.status]}</span> {when(r.created_at)}
            {r.version > 1 && <span className="muted"> · edited {when(r.updated_at)}</span>}
            <ul>
              {r.lines.map((l) => (
                <li key={l.line_no}>
                  {l.qty} × {l.code} · {l.product_name} {l.variant} at {rupees(Number(l.price_paisa))}
                </li>
              ))}
            </ul>
            {r.note && <p>{r.note}</p>}
            {r.status === "converted" && r.order_id && (
              <p className="muted">Order {r.order_id.slice(0, SHORT_ID)} is listed under My orders.</p>
            )}
            {(r.status === "dismissed" || r.status === "cancelled") && r.reason && <p className="muted">{r.reason}</p>}
            {r.status === "open" && editing !== r.request_id && (
              <div className="row">
                <button type="button" className="inline" onClick={() => setEditing(r.request_id)}>
                  Edit request
                </button>
                <ConfirmAction
                  label="Cancel request"
                  confirmLabel="Cancel this request"
                  reasonLabel="Why cancel (optional)"
                  reasonRequired={false}
                  danger
                  onConfirm={async (reason) => {
                    await rpc("salon_cancel_request", { p_request_id: r.request_id, p_reason: reason || null });
                    await onChanged("Request cancelled.");
                  }}
                />
              </div>
            )}
            {r.status === "open" && editing === r.request_id && (
              <EditRequest
                request={r}
                catalogue={catalogue}
                onCancel={() => setEditing(null)}
                onDone={async () => {
                  setEditing(null);
                  await onChanged("Request changed. The office sees the new version.");
                }}
              />
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function EditRequest({
  request,
  catalogue,
  onDone,
  onCancel,
}: {
  request: Request;
  catalogue: Item[];
  onDone: () => Promise<void>;
  onCancel: () => void;
}) {
  const [picks, setPicks] = useState<PickLine[]>(() => request.lines.map((l) => newPick(l.sku_id, String(l.qty))));
  const [note, setNote] = useState(request.note ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clientId, setClientId] = useState(() => crypto.randomUUID());
  return (
    <form
      className="card"
      aria-label="Edit request"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          const lines = picksPayload(picks);
          if (!lines) throw new Error("Keep at least one product, or cancel the request instead.");
          await rpc("salon_edit_request", {
            p_client_id: clientId,
            p_request_id: request.request_id,
            p_lines: lines,
            p_note: note.trim() || null,
          });
          setClientId(crypto.randomUUID());
          await onDone();
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <LinePicker
        name="Request"
        options={catalogue.map((i) => ({ id: i.sku_id, label: itemText(i) }))}
        lines={picks}
        onChange={setPicks}
      />
      <label htmlFor={`edit-note-${request.request_id}`}>Note for the office (optional)</label>
      <textarea
        id={`edit-note-${request.request_id}`}
        rows={NOTE_ROWS}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        maxLength={NOTE_MAX}
      />
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="row">
        <button type="submit" className="inline" disabled={busy}>
          {busy ? "Saving…" : "Save request"}
        </button>
        <button type="button" className="inline link" onClick={onCancel} disabled={busy}>
          Keep as it was
        </button>
      </div>
    </form>
  );
}

/** The salon's official orders, whoever made them. */
function Orders({ orders }: { orders: Order[] }) {
  return (
    <section className="card" aria-labelledby="orders-h">
      <h2 id="orders-h">My orders</h2>
      {orders.length === 0 && <p className="muted">No orders yet.</p>}
      {orders.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Order</th>
              <th>Products</th>
              <th>Status</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.order_id} data-testid="salon-order">
                <td data-label="Date">{when(o.created_at)}</td>
                <td data-label="Order">
                  {o.order_id.slice(0, SHORT_ID)}
                  {o.from_request && <span className="muted"> · from your request</span>}
                </td>
                <td data-label="Products">{o.lines.map((l) => `${l.qty} × ${l.code}`).join(", ")}</td>
                <td data-label="Status">
                  <span className="badge">{o.status === "draft" ? "on hold" : label(o.status)}</span>
                  {o.status === "draft" && (
                    <span className="muted" data-testid="order-waiting">
                      {" "}
                      {SALON_WAITING_TEXT[o.waiting_on ?? ""] ?? SALON_WAITING_TEXT.office_check}
                    </span>
                  )}
                  {o.status === "cancelled" && <span className="muted"> Cancelled by the office. Ask the office why.</span>}
                </td>
                <td data-label="Total">{rupees(Number(o.total_paisa))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

/** Payments the office or a rep recorded, with the receipt number the system issued; a reversed one is marked (D-48). */
function Payments({ account }: { account: Account }) {
  return (
    <section className="card" aria-labelledby="payments-h">
      <h2 id="payments-h">Payments</h2>
      {account.payments.length === 0 && <p className="muted">No payments recorded yet.</p>}
      {account.payments.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Receipt</th>
              <th>Method</th>
              <th>Amount</th>
            </tr>
          </thead>
          <tbody>
            {account.payments.map((p) => (
              <tr key={p.receipt_number}>
                <td data-label="Date">{when(p.paid_at)}</td>
                <td data-label="Receipt">
                  {p.receipt_number}
                  {p.reversed && <span className="badge"> Reversed by the office</span>}
                </td>
                <td data-label="Method">{label(p.method)}</td>
                <td data-label="Amount">{rupees(Number(p.amount_paisa))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
