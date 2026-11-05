"use client";
import Link from "next/link";
import { use } from "react";
import { useRpcRead } from "@/components/use-rpc-read";
import type { CommissionStatement } from "@/lib/commission";
import { fullDay, isUuid } from "@/lib/documents";
import { rupees } from "@/lib/money";
import { monthName, when } from "@/lib/overview";

type Listed<T> = T[];
type RepDetail = {
  profile: {
    rep_id: string;
    full_name: string;
    status: string;
    phone_masked: string | null;
    start_date: string | null;
    created_at: string;
  };
  month: { start: string; end: string };
  devices: Listed<{
    label: string | null;
    platform: string | null;
    status: string;
    created_at: string;
    approved_at: string | null;
    revoked_at: string | null;
    last_seen_at: string | null;
  }>;
  territories: Listed<{ name: string; from_date: string; to_date: string | null; current: boolean }>;
  salons_total: number;
  salons: Listed<{ salon_id: string; name: string | null; stage: string; approval_status: string; direct: boolean }>;
  days_total: number;
  days: Listed<{
    day: string;
    status: string;
    check_in_at: string;
    check_out_at: string | null;
    bag_variance_units: number;
    close_reason: string | null;
    visits: number;
  }>;
  visits_total: number;
  visits: Listed<{
    visit_id: string;
    salon_id: string;
    salon_name: string | null;
    outcome: string;
    arrived_at: string;
    distance_from_pin_m: number | null;
    mock_location: boolean;
    notes: string | null;
  }>;
  cards_total: number;
  cards: Listed<{
    card_id: string;
    salon_id: string;
    salon_name: string | null;
    body: string;
    created_at: string;
    state: "open" | "converted" | "dismissed";
    order_id: string | null;
  }>;
  orders_total: number;
  orders: Listed<{
    order_id: string;
    salon_id: string;
    salon_name: string | null;
    status: string;
    total_paisa: number;
    created_at: string;
  }>;
  pending_total: number;
  pending: Listed<{
    submission_id: string;
    order_id: string;
    salon_id: string;
    salon_name: string | null;
    submitted_at: string;
    total_paisa: number;
  }>;
  invoices_total: number;
  invoices: Listed<{
    invoice_id: string;
    number: string;
    issued_at: string;
    salon_id: string;
    salon_name: string | null;
    total_paisa: number;
  }>;
  has_bag: boolean;
  bag: Listed<{ code: string; variant: string | null; on_hand: number }>;
};
type Cash = { balance_paisa: number };

const plain = (code: string) => code.replaceAll("_", " ");
const UNNAMED = "Unnamed salon";
const DAY_TEXT: Record<string, string> = { open: "Checked in", closed: "Checked out", force_closed: "Closed by the office" };

/** "Newest 50 of 240" when the database's list stopped short of its total. */
const Capped = ({ shown, total }: { shown: number; total: number }) =>
  total > shown ? (
    <p className="muted" data-testid="capped">
      Showing {shown} of {total}.
    </p>
  ) : null;

// One rep, for the owner and the manager (frontend plan section 6; FLD-06): read-only oversight.
// Nothing is approved, edited or paid here; each section links to the page that owns the action.
// app.office_rep_detail decides who may read and returns allow-listed fields (masked phone, no GPS);
// cash and commission are app.office_rep_cash_position's and app.office_commission's own figures.
export default function RepDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  if (!isUuid(id)) {
    return (
      <>
        <h1>Rep</h1>
        <p className="error" role="alert">
          unknown rep
        </p>
        <Link href="/office/reps">Back to rep performance</Link>
      </>
    );
  }
  return <RepView id={id} />;
}

function RepView({ id }: { id: string }) {
  const read = useRpcRead<RepDetail>("office_rep_detail", { p_rep_id: id }, id);
  if (read.loading)
    return (
      <p className="muted" aria-busy="true">
        Loading…
      </p>
    );
  if (read.error || !read.data) {
    return (
      <>
        <h1>Rep</h1>
        <p className="error" role="alert">
          {read.error ?? "This rep could not be loaded."}
        </p>
        <Link href="/office/reps">Back to rep performance</Link>
      </>
    );
  }
  return <Detail repId={id} d={read.data} />;
}

function Detail({ repId, d }: { repId: string; d: RepDetail }) {
  const p = d.profile;
  return (
    <>
      <p>
        <Link href="/office/reps">Back to rep performance</Link>
      </p>
      <h1>{p.full_name}</h1>
      <dl data-testid="rep-profile">
        <dt>Account</dt>
        <dd data-testid="rep-status">{p.status}</dd>
        <dt>Phone</dt>
        <dd data-testid="rep-phone">{p.phone_masked ?? "None recorded"}</dd>
        {p.start_date && (
          <>
            <dt>Started</dt>
            <dd>{fullDay(p.start_date)}</dd>
          </>
        )}
      </dl>
      <p className="muted">
        To change this account use <Link href="/office/people">People</Link> or <Link href="/office/team">Team</Link>; phones are
        approved on <Link href="/office/devices">Devices</Link>.
      </p>

      <h2>Phones</h2>
      {d.devices.length === 0 ? (
        <p className="muted">No phone registered yet.</p>
      ) : (
        <ul className="plain">
          {d.devices.map((v) => (
            <li key={v.created_at} data-testid="rep-device">
              {v.label ?? "Phone"} {v.platform && `(${v.platform})`} · {v.status}
              {v.last_seen_at && ` · last seen ${when(v.last_seen_at)}`}
            </li>
          ))}
        </ul>
      )}

      <h2>Money this month</h2>
      <Money repId={repId} month={d.month} />

      <h2>Delivery submissions awaiting approval</h2>
      <Capped shown={d.pending.length} total={d.pending_total} />
      {d.pending.length === 0 ? (
        <p className="muted">Nothing is waiting.</p>
      ) : (
        <>
          <ul className="plain">
            {d.pending.map((s) => (
              <li key={s.submission_id} data-testid="rep-pending">
                <Link href={`/office/orders/${s.order_id}`}>{s.salon_name ?? UNNAMED}</Link> · {rupees(s.total_paisa)} · submitted{" "}
                {when(s.submitted_at)}
              </li>
            ))}
          </ul>
          <p>
            <Link href="/office/deliveries">Check and decide them on Delivery approvals</Link>
          </p>
        </>
      )}

      <h2>Orders ({d.orders_total})</h2>
      <Capped shown={d.orders.length} total={d.orders_total} />
      {d.orders.length === 0 ? (
        <p className="muted">No order has this rep yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Placed</th>
              <th>Salon</th>
              <th>Status</th>
              <th>Amount</th>
            </tr>
          </thead>
          <tbody>
            {d.orders.map((o) => (
              <tr key={o.order_id} data-testid="rep-order">
                <td>
                  <Link href={`/office/orders/${o.order_id}`}>{when(o.created_at)}</Link>
                </td>
                <td>
                  <Link href={`/office/salons/${o.salon_id}`}>{o.salon_name ?? UNNAMED}</Link>
                </td>
                <td>{plain(o.status)}</td>
                <td>{rupees(o.total_paisa)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2>Invoices from this rep ({d.invoices_total})</h2>
      <Capped shown={d.invoices.length} total={d.invoices_total} />
      {d.invoices.length === 0 ? (
        <p className="muted">No approved delivery yet.</p>
      ) : (
        <ul className="plain">
          {d.invoices.map((i) => (
            <li key={i.invoice_id} data-testid="rep-invoice">
              <Link href={`/office/invoices/${i.invoice_id}`}>{i.number}</Link> · {i.salon_name ?? UNNAMED} ·{" "}
              {rupees(i.total_paisa)} · {when(i.issued_at)}
            </li>
          ))}
        </ul>
      )}

      <h2>New Order Details cards ({d.cards_total})</h2>
      <Capped shown={d.cards.length} total={d.cards_total} />
      {d.cards.length === 0 ? (
        <p className="muted">No card submitted yet.</p>
      ) : (
        <ul className="plain">
          {d.cards.map((c) => (
            <li key={c.card_id} data-testid="rep-card">
              <Link href={`/office/salons/${c.salon_id}`}>{c.salon_name ?? UNNAMED}</Link> · {when(c.created_at)} · {c.state}
              {c.order_id && (
                <>
                  {" "}
                  · <Link href={`/office/orders/${c.order_id}`}>order</Link>
                </>
              )}
              <div>{c.body}</div>
            </li>
          ))}
        </ul>
      )}

      <h2>Territories</h2>
      {d.territories.length === 0 ? (
        <p className="muted">
          No territory yet. Assign one on <Link href="/office/territories">Territories</Link>.
        </p>
      ) : (
        <ul className="plain">
          {d.territories.map((t) => (
            <li key={`${t.name}-${t.from_date}`} data-testid="rep-territory">
              {t.name} · from {fullDay(t.from_date)}
              {t.to_date ? ` to ${fullDay(t.to_date)}` : " (current)"}
            </li>
          ))}
        </ul>
      )}

      <h2>Salons held ({d.salons_total})</h2>
      <Capped shown={d.salons.length} total={d.salons_total} />
      {d.salons.length === 0 ? (
        <p className="muted">No salon yet.</p>
      ) : (
        <ul className="plain">
          {d.salons.map((s) => (
            <li key={s.salon_id} data-testid="rep-salon">
              <Link href={`/office/salons/${s.salon_id}`}>{s.name ?? UNNAMED}</Link> · {plain(s.stage)} ·{" "}
              {s.direct ? "assigned directly" : "through the territory"}
              {s.approval_status !== "approved" && ` · ${s.approval_status}`}
            </li>
          ))}
        </ul>
      )}

      <h2>Check-in and check-out ({d.days_total})</h2>
      <Capped shown={d.days.length} total={d.days_total} />
      {d.days.length === 0 ? (
        <p className="muted">No day recorded yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Day</th>
              <th>Status</th>
              <th>In</th>
              <th>Out</th>
              <th>Visits</th>
              <th>Bag difference (units)</th>
            </tr>
          </thead>
          <tbody>
            {d.days.map((x) => (
              <tr key={x.day} data-testid="rep-day">
                <td>{fullDay(x.day)}</td>
                <td>
                  {DAY_TEXT[x.status] ?? x.status}
                  {x.close_reason && <div className="muted">{x.close_reason}</div>}
                </td>
                <td>{when(x.check_in_at)}</td>
                <td>{x.check_out_at ? when(x.check_out_at) : "Not yet"}</td>
                <td>{x.visits}</td>
                <td>{x.bag_variance_units}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2>Visits ({d.visits_total})</h2>
      <Capped shown={d.visits.length} total={d.visits_total} />
      {d.visits.length === 0 ? (
        <p className="muted">No visit yet.</p>
      ) : (
        <ul className="plain">
          {d.visits.map((v) => (
            <li key={v.visit_id} data-testid="rep-visit">
              <Link href={`/office/salons/${v.salon_id}`}>{v.salon_name ?? UNNAMED}</Link> · {when(v.arrived_at)} ·{" "}
              {plain(v.outcome)}
              {v.distance_from_pin_m !== null && ` · ${v.distance_from_pin_m} m from the pin`}
              {v.mock_location && " · the phone reported a mock location"}
              {v.notes && <div>{v.notes}</div>}
            </li>
          ))}
        </ul>
      )}

      <h2>Stock bag</h2>
      {!d.has_bag && <p className="muted">This rep has no bag yet.</p>}
      {d.has_bag && d.bag.length === 0 && <p className="muted">The bag is empty.</p>}
      {d.bag.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>SKU</th>
              <th>Variant</th>
              <th>Units</th>
            </tr>
          </thead>
          <tbody>
            {d.bag.map((b) => (
              <tr key={b.code} data-testid="rep-bag">
                <td>{b.code}</td>
                <td>{b.variant}</td>
                <td>{b.on_hand}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

// The database's figures only: no commission formula lives in the browser, and the basis is not
// described here. Payments are recorded on the Commission page.
function Money({ repId, month }: { repId: string; month: RepDetail["month"] }) {
  const key = `${repId}-${month.start}`;
  const commission = useRpcRead<CommissionStatement>(
    "office_commission",
    { p_rep_id: repId, p_from: month.start, p_to: month.end },
    key,
  );
  const cash = useRpcRead<Cash[]>("office_rep_cash_position", { p_rep_id: repId }, repId);
  const c = commission.data;
  const inHand = cash.data?.[0];
  return (
    <>
      {(commission.loading || cash.loading) && (
        <p className="muted" aria-busy="true">
          Loading…
        </p>
      )}
      {(commission.error || cash.error) && (
        <p className="error" role="alert">
          {commission.error ?? cash.error}
        </p>
      )}
      <dl>
        {inHand && (
          <>
            <dt>Cash in hand now</dt>
            <dd data-testid="rep-cash">{rupees(inHand.balance_paisa)}</dd>
          </>
        )}
        {c && (
          <>
            <dt>Commission earned in {monthName(month.start)}</dt>
            <dd data-testid="rep-earned">{rupees(c.earned_paisa)}</dd>
            <dt>Commission paid in {monthName(month.start)}</dt>
            <dd data-testid="rep-paid">{rupees(c.paid_paisa)}</dd>
            <dt>Commission still owed (all months)</dt>
            <dd data-testid="rep-owed">{rupees(c.owed_paisa)}</dd>
          </>
        )}
      </dl>
      <p className="muted">
        Commission figures are for oversight here and are not approved for payout use from this page. See{" "}
        <Link href="/office/commission">Commission</Link> and <Link href="/office/handovers">Cash handover</Link>.
      </p>
    </>
  );
}
