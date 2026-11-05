"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ConfirmAction, ListState } from "@/components/confirm-action";
import type { Approval, RefusedApproval } from "@/lib/approvals";
import { rupees } from "@/lib/money";
import { mySession, type Role, rpc } from "@/lib/rpc";
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
// P1-30: the maker withdraws its own pending request (app.cancel_approval); a manager sees no buttons on a
// request that needs the owner (the database refuses it anyway, audit M2); requests refused in the last
// 14 days are listed apart with the checker's reason (app.office_refused_approvals), so the maker sees the outcome.
/** What the viewer can do with a pending request: withdraw its own, wait for the owner, or decide it. */
function rowMode(a: Approval, role: Role | null): "mine" | "owner-only" | "decide" {
  if (a.made_by_me) return "mine";
  if (a.checker_role_required === "owner" && role !== "owner") return "owner-only";
  return "decide";
}

/** The maker's line. H1: nobody can decide the owner's own owner-level request; D-45 gives the owner a direct way. */
function MakerNote({ a, role }: { a: Approval; role: Role | null }) {
  if (role !== "owner" || a.checker_role_required !== "owner") {
    return <p className="muted">You asked for this; another office user decides it.</p>;
  }
  if (a.kind === "adjustment") {
    return (
      <p className="muted">
        Only another owner could decide this, so it would wait. Withdraw it; your own stock goes in at once on the{" "}
        <Link href="/office/stock">Stock page</Link> (D-45).
      </p>
    );
  }
  return (
    <p className="muted">
      Only another owner could decide this, so it would wait. Withdraw it; your own orders take their discount at once (D-45).
    </p>
  );
}

export default function Approvals() {
  const [items, setItems] = useState<Approval[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [refused, setRefused] = useState<RefusedApproval[]>([]);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [list, no, me] = await Promise.all([
        rpc<Approval[]>("office_pending_approvals"),
        rpc<RefusedApproval[]>("office_refused_approvals"),
        mySession(),
      ]);
      setItems(list ?? []);
      setRefused(no ?? []);
      setRole(me?.role ?? null);
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

  const withdraw = async (a: Approval, reason: string) => {
    setNotice(null);
    await rpc("cancel_approval", { p_request_id: a.request_id, p_reason: reason });
    setNotice(`Withdrew the ${a.kind} request.`);
    await load();
  };

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
    if (a.kind === "adjustment" && approve) {
      message +=
        a.location_kind === "pending_delivery" ? " Settle the goods on Delivery approvals." : " Post it on the Stock page.";
    }
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
              {rowMode(a, role) === "mine" && (
                <>
                  <MakerNote a={a} role={role} />
                  <div className="row">
                    <ConfirmAction
                      label="Withdraw"
                      confirmLabel="Withdraw request"
                      reasonLabel="Why it is withdrawn"
                      reasonMinLength={REASON_MIN}
                      danger
                      onConfirm={(reason) => withdraw(a, reason)}
                    />
                  </div>
                </>
              )}
              {rowMode(a, role) === "owner-only" && <p className="muted">Waiting for the owner.</p>}
              {rowMode(a, role) === "decide" && (
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
      {!loading && !error && refused.length > 0 && (
        <section aria-labelledby="refused-h">
          <h2 id="refused-h">Refused in the last 14 days</h2>
          <ul className="plain">
            {refused.map((a) => (
              <li key={a.request_id} data-testid="approval-refused">
                <span className="badge">Refused</span> {a.kind === "discount" ? "Discount" : "Stock adjustment"} ·{" "}
                {a.kind === "discount"
                  ? (a.salon_name ?? "Unnamed salon")
                  : `${a.location_name ?? "Unknown location"} · ${a.sku_code ?? "unknown SKU"} · ${a.qty_delta} units`}{" "}
                · asked by {a.maker_name}
                <br />
                <span className="muted">
                  Refused by {a.checker_name ?? "an office user"}
                  {a.decided_at ? ` on ${when(a.decided_at)}` : ""}: {a.decision_reason}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
