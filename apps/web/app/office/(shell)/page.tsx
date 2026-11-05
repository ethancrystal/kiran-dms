import Link from "next/link";
import { OpenRepDays } from "@/components/open-rep-days";
import { rupees } from "@/lib/money";
import {
  type CashCapRep,
  day,
  daysWaiting,
  HOLD_TEXT,
  karachiToday,
  type OverviewCounts,
  type OverviewRow,
  placedBy,
  STATUS_TEXT,
  when,
} from "@/lib/overview";
import { supabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const LOAD_FAILED = "Some figures could not be loaded (shown as —). Reload the page; if it persists, sign in again.";

/** "1 order" or "3 orders". */
const count = (n: number, one: string, many: string) => `${n} ${Number(n) === 1 ? one : many}`;

/** The one next step for an order waiting to be delivered. */
function NextStep({ r }: { r: OverviewRow }) {
  if (r.waiting_approval) return <Link href="/office/deliveries">Rep delivered it: approve</Link>;
  if (r.deliverer_kind === "office") return <Link href={`/office/orders/${r.order_id}`}>Office delivers: open the order</Link>;
  return <span className="muted">The rep delivers it</span>;
}

// The office home (P1-26; doc 16: "see who placed orders, who needs delivery and who is delivered").
// Every count and list comes from the database at the moment the page opens: app.office_overview_counts
// counts every row, app.office_overview_rows gives the lists (owner or manager at AAL2; the shell layout
// has already required TOTP). Nothing is added up here. The phone and people counts below are read
// through RLS, as before. Each row links to the page where the next step is taken.
export default async function OfficeHome() {
  const sb = await supabaseServer();
  const head = { count: "exact" as const, head: true };
  const n = (r: { count: number | null; error: unknown }) => (r.error ? null : (r.count ?? 0));
  const [sessionRes, countsRes, rowsRes, capRes, approvalsRes, goodsRes, disputedRes, daysRes, ...setup] = await Promise.all([
    // Review of P1-30: the caller's role, so a manager is not sent to work only the owner can do.
    sb.schema("app").rpc("my_session"),
    sb.schema("app").rpc("office_overview_counts"),
    sb.schema("app").rpc("office_overview_rows"),
    sb.schema("app").rpc("office_cash_cap_reps"),
    // M5, FLOW-15 (P1-30): the other queues, so the page never says nothing is waiting while one is.
    sb.schema("app").rpc("office_pending_approvals"),
    sb.schema("app").rpc("office_pending_stock"),
    sb.from("stock_issue").select("id", head).eq("status", "disputed"),
    sb.from("rep_day").select("id", head).eq("status", "open").lt("day", karachiToday()),
    sb.from("device").select("id", head).eq("status", "pending"),
    sb.from("user_profile").select("id", head).eq("status", "active"),
    sb.from("territory").select("id", head).eq("active", true),
    sb.from("salon").select("id", head),
  ]);
  const [pending, people, territories, salons] = setup.map(n);
  const isOwner = (sessionRes.data as { role?: string } | null)?.role === "owner";
  type Queued = { status: string; made_by_me: boolean; checker_role_required: string };
  const approvals = (approvalsRes.data as Queued[] | null) ?? [];
  const waitingRequests = approvals.filter((a) => a.status === "pending");
  // What this person can decide: not their own request, and not an owner-level one unless they are the owner.
  const toDecide = waitingRequests.filter((a) => !a.made_by_me && (isOwner || a.checker_role_required !== "owner")).length;
  const forOthers = waitingRequests.length - toDecide;
  const toPost = approvals.filter((a) => a.status === "approved").length;
  const goods = ((goodsRes.data as unknown[] | null) ?? []).length;
  const disputed = n(disputedRes);
  const openDays = n(daysRes);
  const extra = [toDecide, forOthers, toPost, goods, disputed ?? 0, openDays ?? 0, pending ?? 0];
  if (countsRes.error) console.error("office home: counts read failed", countsRes.error);
  if (rowsRes.error) console.error("office home: lists read failed", rowsRes.error);
  const c = ((countsRes.data as OverviewCounts[] | null) ?? [])[0] ?? null;
  const rows = (rowsRes.data as OverviewRow[] | null) ?? [];
  if (capRes.error) console.error("office home: cash cap read failed", capRes.error);
  const atCap = (capRes.data as CashCapRep[] | null) ?? [];
  if (approvalsRes.error) console.error("office home: approvals read failed", approvalsRes.error);
  if (goodsRes.error) console.error("office home: pending stock read failed", goodsRes.error);
  const failed =
    !c ||
    [rowsRes, capRes, approvalsRes, goodsRes].some((r) => Boolean(r.error)) ||
    [pending, people, territories, salons, disputed, openDays].some((x) => x === null);
  const show = (x: number | null | undefined) => (x === null || x === undefined ? "—" : String(x));
  const of = (s: OverviewRow["section"]) => rows.filter((r) => r.section === s);
  const placed = of("placed");
  const waiting = of("waiting");
  const held = of("held");
  const delivered = of("delivered");

  return (
    <>
      <h1>Overview</h1>
      {failed && (
        <p className="error" role="alert">
          {LOAD_FAILED}
        </p>
      )}

      {c && (
        <ul className="summary" data-testid="home-summary">
          <li>
            <Link href="/office/orders">
              <strong data-testid="count-to-deliver">{c.to_deliver}</strong>{" "}
              {Number(c.to_deliver) === 1 ? "order to deliver" : "orders to deliver"}
            </Link>
          </li>
          <li>
            <Link href="/office/deliveries">
              <strong data-testid="count-waiting-approval">{c.waiting_approval}</strong> waiting for your approval
            </Link>
          </li>
          <li>
            <Link href="/office/orders">
              <strong data-testid="count-placed">{c.placed_this_week}</strong> placed this week
            </Link>
          </li>
          <li>
            <strong data-testid="count-delivered">{c.delivered_this_week}</strong> delivered this week
          </li>
        </ul>
      )}

      <section aria-labelledby="attention-h" className="card">
        <h2 id="attention-h">Needs your attention</h2>
        {c &&
        Number(c.held_orders) +
          Number(c.pending_salons) +
          Number(c.waiting_approval) +
          Number(c.pending_requests) +
          Number(c.reps_at_cash_cap) +
          Number(c.handovers_unanswered) +
          Number(c.handovers_disputed) +
          extra.reduce((a, b) => a + b, 0) ===
          0 ? (
          <p className="ok">Nothing is waiting for you. Well done.</p>
        ) : (
          <ul className="plain">
            {c && Number(c.reps_at_cash_cap) > 0 && (
              <li data-testid="cash-cap">
                {count(c.reps_at_cash_cap, "rep is", "reps are")} at the cash limit and cannot collect more cash until a handover:
                <ul className="plain">
                  {atCap.map((r) => (
                    <li key={r.rep_id} data-testid="cash-cap-rep">
                      {r.full_name} holds {rupees(Number(r.cash_paisa))} (limit {rupees(Number(r.cap_paisa))})
                    </li>
                  ))}
                </ul>
                <Link href="/office/handovers">Count their cash</Link>
              </li>
            )}
            {c && Number(c.handovers_disputed) > 0 && (
              <li>
                {count(c.handovers_disputed, "cash handover is", "cash handovers are")} disputed and waiting for the owner.{" "}
                <Link href="/office/handovers">{isOwner ? "Settle them" : "See them (the owner settles them)"}</Link>
              </li>
            )}
            {c && Number(c.handovers_unanswered) > 0 && (
              <li>
                {count(c.handovers_unanswered, "cash count is", "cash counts are")} waiting for the rep&apos;s answer.{" "}
                <Link href="/office/handovers">See them</Link>
              </li>
            )}
            {openDays !== null && openDays > 0 && (
              <li>
                {count(openDays, "rep day from an earlier date is", "rep days from earlier dates are")} still open, so those reps
                cannot check in. <a href="#open-days-h">Close them below</a>
              </li>
            )}
            {toDecide > 0 && (
              <li>
                {count(toDecide, "request waits", "requests wait")} for a decision (discounts or stock adjustments).{" "}
                <Link href="/office/approvals">Decide them</Link>
              </li>
            )}
            {forOthers > 0 && (
              <li>
                {count(forOthers, "request waits", "requests wait")} for someone else to decide (your own requests, or ones only
                the owner decides). <Link href="/office/approvals">See them</Link>
              </li>
            )}
            {toPost > 0 && (
              <li>
                {count(toPost, "approved stock adjustment is", "approved stock adjustments are")} not posted yet.{" "}
                <Link href="/office/stock">Post them</Link>
              </li>
            )}
            {goods > 0 && (
              <li>
                {count(goods, "line of goods from a refused delivery is", "lines of goods from refused deliveries are")} not
                settled. <Link href="/office/deliveries">Settle them</Link>
              </li>
            )}
            {disputed !== null && disputed > 0 && (
              <li>
                {count(disputed, "stock issue is", "stock issues are")} disputed by the rep.{" "}
                <Link href="/office/stock">Check them</Link>
              </li>
            )}
            {pending !== null && pending > 0 && (
              <li>
                {count(pending, "phone waits", "phones wait")} for approval. <Link href="/office/devices">Approve or refuse</Link>
              </li>
            )}
            {c && Number(c.waiting_approval) > 0 && (
              <li>
                {count(c.waiting_approval, "delivery is", "deliveries are")} waiting for your approval.{" "}
                <Link href="/office/deliveries">Check and approve them</Link>
              </li>
            )}
            {c && Number(c.pending_requests) > 0 && (
              <li>
                {count(c.pending_requests, "order request is", "order requests are")} waiting.{" "}
                <Link href="/office/orders">Turn them into orders</Link>
              </li>
            )}
            {c && Number(c.pending_salons) > 0 && (
              <li>
                {count(c.pending_salons, "new salon waits", "new salons wait")} for approval.{" "}
                <Link href="/office/salons/approvals">Approve or reject them</Link>
              </li>
            )}
            {c && Number(c.held_orders) > 0 && (
              <li>
                {count(c.held_orders, "order is", "orders are")} on hold:
                <ul className="plain">
                  {held.map((h) => (
                    <li key={h.order_id} data-testid="held-order">
                      <Link href={`/office/salons/${h.salon_id}`}>{h.salon_name}</Link> · {rupees(Number(h.total_paisa))} ·{" "}
                      {HOLD_TEXT[h.hold_reason ?? ""] ?? "On hold."}{" "}
                      <Link href={`/office/orders/${h.order_id}`}>Open the order</Link>
                    </li>
                  ))}
                </ul>
              </li>
            )}
          </ul>
        )}
      </section>

      <section aria-labelledby="placed-h">
        <h2 id="placed-h">Orders placed this week{c && <span className="muted"> (since Monday {day(c.week_start)})</span>}</h2>
        {placed.length === 0 ? (
          <p className="muted">
            No orders this week yet. Orders made on the Orders page, and requests you turn into orders, show here.
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Salon</th>
                <th>Placed by</th>
                <th>Amount</th>
                <th>Now</th>
              </tr>
            </thead>
            <tbody>
              {placed.map((r) => (
                <tr key={r.order_id} data-testid="placed-row">
                  <td>{when(r.placed_at)}</td>
                  <td>
                    <Link href={`/office/salons/${r.salon_id}`}>{r.salon_name}</Link>
                  </td>
                  <td>{placedBy(r)}</td>
                  <td>{rupees(Number(r.total_paisa))}</td>
                  <td>{STATUS_TEXT[r.status] ?? r.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {Number(c?.placed_this_week ?? 0) > placed.length && (
          <p className="muted">Showing the newest {placed.length}. All of them are on the Orders page.</p>
        )}
      </section>

      <section aria-labelledby="waiting-h">
        <h2 id="waiting-h">Waiting to be delivered</h2>
        {waiting.length === 0 ? (
          <p className="muted">Nothing is waiting to be delivered.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Salon</th>
                <th>Still to deliver</th>
                <th>Waiting</th>
                <th>Who delivers</th>
                <th>Next step</th>
              </tr>
            </thead>
            <tbody>
              {waiting.map((r) => (
                <tr key={r.order_id} data-testid="waiting-row">
                  <td>
                    <Link href={`/office/salons/${r.salon_id}`}>{r.salon_name}</Link>
                    {r.status === "partially_delivered" && <span className="muted"> (part delivered)</span>}
                  </td>
                  <td>
                    {rupees(Number(r.undelivered_paisa ?? r.total_paisa))}
                    {r.status === "partially_delivered" && <span className="muted"> of {rupees(Number(r.total_paisa))}</span>}
                  </td>
                  <td>{daysWaiting(r.waiting_days)}</td>
                  <td>{r.deliverer_kind === "rep" ? `Rep ${r.deliverer_name ?? ""}` : "Office"}</td>
                  <td>
                    <NextStep r={r} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {Number(c?.to_deliver ?? 0) > waiting.length && (
          <p className="muted">Showing the {waiting.length} waiting longest. All of them are on the Orders page.</p>
        )}
      </section>

      <section aria-labelledby="delivered-h">
        <h2 id="delivered-h">Delivered</h2>
        {delivered.length === 0 ? (
          <p className="muted">Nothing delivered yet. Each delivery gets an invoice and shows here.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Invoice</th>
                <th>Salon</th>
                <th>Amount</th>
                <th>When</th>
                <th>Delivered by</th>
              </tr>
            </thead>
            <tbody>
              {delivered.map((r) => (
                <tr key={r.invoice_id ?? r.order_id} data-testid="delivered-row">
                  <td>{r.invoice_number}</td>
                  <td>
                    <Link href={`/office/salons/${r.salon_id}`}>{r.salon_name}</Link>
                  </td>
                  <td>{rupees(Number(r.invoice_total_paisa ?? 0))}</td>
                  <td>{r.delivered_at ? when(r.delivered_at) : ""}</td>
                  <td>
                    {r.deliverer_kind === "rep" ? "Rep" : "Office"} {r.delivered_by_name ?? ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="muted">
          Money still to collect is on the <Link href="/office/receivables">receivables page</Link>. Each rep&apos;s orders and
          commission are on <Link href="/office/reps">rep performance</Link>.
        </p>
      </section>

      <OpenRepDays />

      <h2>Phones and people</h2>
      <div className="tiles">
        <Link className="tile" href="/office/devices">
          <span className="big">{show(pending)}</span>
          <span>phones waiting for approval</span>
        </Link>
        <Link className="tile" href="/office/team">
          <span className="big">{show(people)}</span>
          <span>active people</span>
        </Link>
        <Link className="tile" href="/office/territories">
          <span className="big">{show(territories)}</span>
          <span>active territories</span>
        </Link>
        <Link className="tile" href="/office/salons">
          <span className="big">{show(salons)}</span>
          <span>salons</span>
        </Link>
      </div>
    </>
  );
}
