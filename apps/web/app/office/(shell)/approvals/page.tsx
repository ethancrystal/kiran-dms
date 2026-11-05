"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ConfirmAction, ListState } from "@/components/confirm-action";
import type { Approval } from "@/lib/approvals";
import { rupees } from "@/lib/money";
import { rpc } from "@/lib/rpc";
import { label } from "@/lib/salons";

type Order = { status: string; hold_discount: string | null; hold_credit: string | null };

// app.decide_approval asks for a decision reason; the shared minimum is 3 characters.
const REASON_MIN = 3;
const when = (t: string) => new Date(t).toLocaleString("en-PK", { dateStyle: "medium", timeStyle: "short" });

// Approvals (owner or manager at AAL2; SEC-11, CTL-07, CTL-05). Pending discount requests (an order held
// below list price) and pending stock adjustments, read through app.office_pending_approvals. Approve or
// refuse is app.decide_approval: the database refuses the maker (H-12) and a manager on an owner-level
// request, and its words are shown. Approving a discount does not confirm the order by itself, so the
// page then rechecks the order (app.recheck_order) and shows the order's status as the database returns
// it. An approved adjustment is posted on the Stock page; missing goods are settled on Delivery approvals.
export default function Approvals() {
  const [items, setItems] = useState<Approval[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setItems((await rpc<Approval[]>("office_pending_approvals")) ?? []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const pending = items.filter((a) => a.status === "pending");

  const decide = async (a: Approval, approve: boolean, reason: string) => {
    setNotice(null);
    await rpc("decide_approval", { p_request_id: a.request_id, p_approve: approve, p_reason: reason });
    let message = `${approve ? "Approved" : "Refused"} the ${a.kind} request.`;
    if (a.kind === "discount" && a.subject_type === "sales_order") {
      // The decision is recorded; the order's holds are re-run so its status is the database's answer.
      try {
        const o = await rpc<Order>("recheck_order", { p_order_id: a.subject_id });
        message += ` The order is now ${label(o.status)}${o.hold_discount ? ` (discount ${label(o.hold_discount)})` : ""}${o.hold_credit ? ` (credit ${label(o.hold_credit)})` : ""}.`;
      } catch (e) {
        message += ` The order could not be rechecked: ${(e as Error).message}`;
      }
    }
    if (a.kind === "adjustment" && approve) message += " Post it on the Stock page.";
    setNotice(message);
    await load();
  };

  return (
    <>
      <h1>Approvals</h1>
      <p className="muted">
        Requests that need a second office user: discounts below list price and stock adjustments. Nobody decides their own
        request; some need the owner.
      </p>
      {notice && <output className="ok">{notice}</output>}
      <ListState loading={loading} error={error} empty={pending.length === 0} emptyText="Nothing is waiting for a decision." />
      {!loading && !error && pending.length > 0 && (
        <ul className="plain">
          {pending.map((a) => (
            <li key={a.request_id} data-testid="approval">
              <p>
                <span className="badge">{a.kind === "discount" ? "Discount" : "Stock adjustment"}</span>{" "}
                {a.kind === "discount" ? (
                  <>
                    <strong>{a.salon_name ?? "Unnamed salon"}</strong> · list {rupees(Number(a.subtotal_paisa))} · discount{" "}
                    {rupees(Number(a.discount_paisa))} · total {rupees(Number(a.total_paisa))} ·{" "}
                    <Link href={`/office/orders/${a.subject_id}`}>open the order</Link>
                  </>
                ) : (
                  <>
                    <strong>{a.location_name ?? "Unknown location"}</strong> · {a.sku_code ?? "unknown SKU"} ·{" "}
                    {Number(a.qty_delta) > 0 ? `+${a.qty_delta}` : a.qty_delta} units
                  </>
                )}
              </p>
              <p className="muted">
                {a.reason} · asked by {a.maker_name} · {when(a.created_at)} · needs{" "}
                {a.checker_role_required === "owner" ? "the owner" : "an owner or a manager"}
              </p>
              {a.made_by_me ? (
                <p className="muted">You asked for this; another office user decides it.</p>
              ) : (
                <div className="row">
                  <ConfirmAction
                    label="Approve"
                    confirmLabel="Approve request"
                    reasonLabel="Checked how"
                    reasonMinLength={REASON_MIN}
                    onConfirm={(reason) => decide(a, true, reason)}
                  />
                  <ConfirmAction
                    label="Refuse"
                    confirmLabel="Refuse request"
                    reasonLabel="Why it is refused"
                    reasonMinLength={REASON_MIN}
                    danger
                    onConfirm={(reason) => decide(a, false, reason)}
                  />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
