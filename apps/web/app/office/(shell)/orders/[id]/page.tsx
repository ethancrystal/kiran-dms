"use client";
import Link from "next/link";
import { use, useCallback, useEffect, useState } from "react";
import { ConfirmAction, ListState } from "@/components/confirm-action";
import { Timeline } from "@/components/timeline";
import { rupees } from "@/lib/money";
import { db, rows, rpc } from "@/lib/rpc";
import { label } from "@/lib/salons";

type Order = {
  id: string;
  salon_id: string;
  status: string;
  plan: string;
  source_channel: string;
  subtotal_paisa: number;
  discount_paisa: number;
  total_paisa: number;
  hold_credit: string | null;
  hold_discount: string | null;
  credit_override_by: string | null;
  assigned_rep_id: string | null;
  rep_id: string | null;
  cancel_reason: string | null;
  created_at: string;
};
type Line = { line_no: number; sku_id: string; qty: number; unit_price_paisa: number; line_total_paisa: number };
type Remaining = { line_no: number; sku_id: string; ordered: number; delivered: number; remaining: number };
type Sku = { id: string; code: string; variant: string | null };
type Invoice = { id: string; number: string; total_paisa: number; issued_at: string };
type Warehouse = { id: string; name: string };
type Waiting = { order_id: string };

// The database's own minimums: app.cancel_order and app.office_release_credit_hold take a reason of at
// least 3 characters (app.assert_reason); the received-by name is 2 to 80 (app.finalise_delivery).
const REASON_MIN = 3;
const RECEIVER_MIN = 2;
const RECEIVER_MAX = 80;
const DELIVERABLE = ["confirmed", "partially_delivered"];
const CANCELLABLE = ["draft", "confirmed"];
const when = (t: string) => new Date(t).toLocaleString("en-PK", { dateStyle: "medium", timeStyle: "short" });

// One order for the office (owner or manager at AAL2; D-30, D-32, A-18, ORD-02, ORD-03). Its lines,
// what is left to deliver and its invoices, as the database holds them. Actions, each the existing
// function, each refusal shown as the database words it: deliver from a warehouse (app.office_deliver,
// which finalises through app.finalise_delivery: delivery, sale movement, invoice and installments in one
// transaction; the way a rep-less order is delivered, A-18), cancel with a reason (app.cancel_order),
// release a credit hold (app.office_release_credit_hold; a manager only within the doc 09 limits), and
// recheck the holds (app.recheck_order, after a discount is decided on Approvals). The timeline is
// app.office_order_timeline.
export default function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [order, setOrder] = useState<Order | null>(null);
  const [salonName, setSalonName] = useState<string | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [left, setLeft] = useState<Remaining[]>([]);
  const [skus, setSkus] = useState<Map<string, Sku>>(new Map());
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [waiting, setWaiting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [o, l, r, inv, wh, pending] = await Promise.all([
        rows<Order>(db().from("sales_order").select("*").eq("id", id)),
        rows<Line>(
          db()
            .from("sales_order_line")
            .select("line_no, sku_id, qty, unit_price_paisa, line_total_paisa")
            .eq("order_id", id)
            .order("line_no"),
        ),
        rpc<Remaining[]>("order_remaining", { p_order_id: id }),
        rows<Invoice>(db().from("invoice").select("id, number, total_paisa, issued_at").eq("order_id", id).order("issued_at")),
        rows<Warehouse>(db().from("stock_location").select("id, name").eq("kind", "warehouse").eq("active", true).order("name")),
        rpc<Waiting[]>("office_pending_deliveries"),
      ]);
      const found = o[0] ?? null;
      setOrder(found);
      setLines(l);
      setLeft(r ?? []);
      setInvoices(inv);
      setWarehouses(wh);
      setWaiting((pending ?? []).some((w) => w.order_id === id));
      const ids = [...new Set(l.map((x) => x.sku_id))];
      const [s, salon] = await Promise.all([
        ids.length ? rows<Sku>(db().from("sku").select("id, code, variant").in("id", ids)) : Promise.resolve([]),
        found ? rows<{ name: string | null }>(db().from("salon").select("name").eq("id", found.salon_id)) : Promise.resolve([]),
      ]);
      setSkus(new Map(s.map((x) => [x.id, x])));
      setSalonName(salon[0]?.name ?? null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
      setReload((n) => n + 1);
    }
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);

  const done = async (message: string) => {
    setNotice(message);
    await load();
  };
  const skuText = (skuId: string) => {
    const s = skus.get(skuId);
    return s ? `${s.code}${s.variant ? ` ${s.variant}` : ""}` : "Unknown SKU";
  };

  if (loading) return <ListState loading error={null} empty={false} emptyText="" />;
  if (error && !order) return <ListState loading={false} error={error} empty={false} emptyText="" />;
  if (!order) return <p className="muted">This order was not found.</p>;

  const salon = salonName ?? "Unnamed salon";
  const holds = [
    order.hold_credit && `credit: ${label(order.hold_credit)}`,
    order.hold_discount && `discount: ${label(order.hold_discount)}`,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <>
      <p>
        <Link href="/office/orders">Back to orders</Link>
      </p>
      <h1>Order for {salon}</h1>
      {notice && <output className="ok">{notice}</output>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <dl className="facts">
        <dt>Status</dt>
        <dd data-testid="order-status">{label(order.status)}</dd>
        {holds && (
          <>
            <dt>Held</dt>
            <dd data-testid="order-holds">
              {holds}
              {order.credit_override_by && " (credit hold released)"}
            </dd>
          </>
        )}
        <dt>Salon</dt>
        <dd>
          <Link href={`/office/salons/${order.salon_id}`}>{salon}</Link>
        </dd>
        <dt>Plan</dt>
        <dd>{order.plan}</dd>
        <dt>Channel</dt>
        <dd>{label(order.source_channel)}</dd>
        <dt>Total</dt>
        <dd data-testid="order-total">{rupees(Number(order.total_paisa))}</dd>
        {Number(order.discount_paisa) > 0 && (
          <>
            <dt>Discount</dt>
            <dd>{rupees(Number(order.discount_paisa))}</dd>
          </>
        )}
        <dt>Delivering rep</dt>
        <dd>{(order.assigned_rep_id ?? order.rep_id) ? "A rep delivers it" : "No rep: the office delivers it"}</dd>
        <dt>Created</dt>
        <dd>{when(order.created_at)}</dd>
        {order.cancel_reason && (
          <>
            <dt>Cancelled because</dt>
            <dd>{order.cancel_reason}</dd>
          </>
        )}
      </dl>

      <section aria-labelledby="lines-h">
        <h2 id="lines-h">Lines</h2>
        <table>
          <thead>
            <tr>
              <th>Product</th>
              <th>Ordered</th>
              <th>Delivered</th>
              <th>Left</th>
              <th>Price each</th>
              <th>Line total</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => {
              const r = left.find((x) => x.line_no === l.line_no);
              return (
                <tr key={l.line_no} data-testid="order-line">
                  <td data-label="Product">{skuText(l.sku_id)}</td>
                  <td data-label="Ordered">{l.qty}</td>
                  <td data-label="Delivered">{r?.delivered ?? 0}</td>
                  <td data-label="Left">{r?.remaining ?? 0}</td>
                  <td data-label="Price each">{rupees(Number(l.unit_price_paisa))}</td>
                  <td data-label="Line total">{rupees(Number(l.line_total_paisa))}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section aria-labelledby="invoices-h">
        <h2 id="invoices-h">Invoices ({invoices.length})</h2>
        {invoices.length === 0 ? (
          <p className="muted">No invoice yet: an invoice is issued only when a delivery is recorded.</p>
        ) : (
          <ul className="plain">
            {invoices.map((i) => (
              <li key={i.id} data-testid="order-invoice">
                <Link href={`/office/invoices/${i.id}`}>{i.number}</Link> · {rupees(Number(i.total_paisa))} · {when(i.issued_at)}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="actions-h">
        <h2 id="actions-h">Actions</h2>
        {waiting && (
          <p className="muted" data-testid="waiting-note">
            A rep&apos;s delivery of this order waits on Delivery approvals; the office cannot deliver or cancel it meanwhile.
          </p>
        )}
        {DELIVERABLE.includes(order.status) && (
          <DeliverForm
            orderId={order.id}
            salon={salon}
            left={left.filter((r) => r.remaining > 0)}
            skuText={skuText}
            warehouses={warehouses}
            onDone={done}
          />
        )}
        <div className="row">
          {order.status === "draft" && <RecheckButton orderId={order.id} onDone={done} />}
          {order.status === "draft" && order.hold_credit && !order.credit_override_by && (
            <ConfirmAction
              label="Release credit hold"
              confirmLabel="Release the credit hold"
              reasonLabel="Why the credit hold is released"
              reasonMinLength={REASON_MIN}
              onConfirm={async (reason) => {
                const o = await rpc<Order>("office_release_credit_hold", { p_order_id: order.id, p_reason: reason });
                await done(`Credit hold released; the order is ${label(o.status)}.`);
              }}
            />
          )}
          {CANCELLABLE.includes(order.status) && (
            <ConfirmAction
              label="Cancel order"
              confirmLabel="Cancel this order"
              reasonLabel="Why the order is cancelled"
              reasonMinLength={REASON_MIN}
              danger
              onConfirm={async (reason) => {
                const o = await rpc<Order>("cancel_order", { p_order_id: order.id, p_reason: reason });
                await done(`The order is ${label(o.status)}.`);
              }}
            />
          )}
        </div>
        {!DELIVERABLE.includes(order.status) && !CANCELLABLE.includes(order.status) && (
          <p className="muted">No action: the order is {label(order.status)}.</p>
        )}
      </section>

      <section aria-labelledby="timeline-h">
        <h2 id="timeline-h">Timeline</h2>
        <Timeline kind="order" id={order.id} reloadKey={reload} />
      </section>
    </>
  );
}

function RecheckButton({ orderId, onDone }: { orderId: string; onDone: (m: string) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <button
        type="button"
        className="inline"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            const o = await rpc<Order>("recheck_order", { p_order_id: orderId });
            await onDone(`Rechecked: the order is ${label(o.status)}.`);
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Checking…" : "Recheck holds"}
      </button>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}

// Deliver from a warehouse (app.office_deliver). One client id per open form, kept until the database
// answers with an invoice, so a retry after a lost answer replays rather than delivering twice (H-08).
function DeliverForm({
  orderId,
  salon,
  left,
  skuText,
  warehouses,
  onDone,
}: {
  orderId: string;
  salon: string;
  left: Remaining[];
  skuText: (skuId: string) => string;
  warehouses: Warehouse[];
  onDone: (m: string) => Promise<void>;
}) {
  const [warehouse, setWarehouse] = useState(warehouses.length === 1 ? warehouses[0].id : "");
  const [qty, setQty] = useState<Record<string, string>>({});
  const [receiver, setReceiver] = useState("");
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      aria-label="Deliver from a warehouse"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          const lines = left
            .map((r) => ({ sku_id: r.sku_id, qty: Number.parseInt(qty[r.sku_id] ?? String(r.remaining), 10) }))
            .filter((l) => l.qty > 0);
          const inv = await rpc<Invoice>("office_deliver", {
            p_client_id: key,
            p_order_id: orderId,
            p_warehouse_id: warehouse || null,
            p_received_by_name: receiver,
            p_lines: lines,
          });
          setKey(crypto.randomUUID());
          setQty({});
          setReceiver("");
          await onDone(`Delivered to ${salon} from the warehouse: invoice ${inv.number}, ${rupees(Number(inv.total_paisa))}.`);
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <h3>Deliver from a warehouse</h3>
      <p className="muted">
        The office delivers an order that has no rep (A-18). The delivery, the stock movement and the invoice are written
        together.
      </p>
      <label htmlFor="deliver-warehouse">Warehouse</label>
      <select id="deliver-warehouse" value={warehouse} onChange={(e) => setWarehouse(e.target.value)}>
        <option value="">Choose a warehouse</option>
        {warehouses.map((w) => (
          <option key={w.id} value={w.id}>
            {w.name}
          </option>
        ))}
      </select>
      {left.map((r) => (
        <div key={r.sku_id}>
          <label htmlFor={`deliver-qty-${r.sku_id}`}>Quantity to deliver of {skuText(r.sku_id)}</label>
          <input
            id={`deliver-qty-${r.sku_id}`}
            inputMode="numeric"
            value={qty[r.sku_id] ?? String(r.remaining)}
            onChange={(e) => setQty((all) => ({ ...all, [r.sku_id]: e.target.value }))}
          />
          <span className="muted"> {r.remaining} left</span>
        </div>
      ))}
      <label htmlFor="deliver-receiver">Received by (name)</label>
      <input
        id="deliver-receiver"
        value={receiver}
        onChange={(e) => setReceiver(e.target.value)}
        required
        minLength={RECEIVER_MIN}
        maxLength={RECEIVER_MAX}
      />
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="inline" disabled={busy}>
        {busy ? "Delivering…" : "Deliver and issue the invoice"}
      </button>
    </form>
  );
}
