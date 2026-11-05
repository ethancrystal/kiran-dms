"use client";
import { useCallback, useEffect, useState } from "react";
import { ConfirmAction, ListState } from "@/components/confirm-action";
import { SubmissionSignature } from "@/components/submission-signature";
import { rupees } from "@/lib/money";
import { db, mySession, type Role, rows, rpc } from "@/lib/rpc";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { when } from "@/lib/time";

type Line = { sku_id: string; code: string; variant: string; qty: number; unit_price_paisa: number };
type Waiting = {
  submission_id: string;
  order_id: string;
  salon_id: string;
  salon_name: string | null;
  rep_id: string;
  rep_name: string;
  lines: Line[] | null;
  total_paisa: number;
  received_by_name: string;
  distance_from_pin_m: number | null;
  mock_location: boolean;
  flags: string[];
  submitted_at: string;
};
type Unsettled = {
  submission_id: string;
  rep_id: string;
  rep_name: string;
  salon_name: string | null;
  sku_id: string;
  sku_code: string;
  unsettled: number;
  pending_location_id: string;
  reason: string;
  decided_at: string;
  request_id: string | null;
  request_status: "pending" | "approved" | "rejected" | null;
  request_maker_id: string | null;
  request_checker_role: "manager" | "owner" | null;
  /** P1-30 (M8): the units the request is for, and the checker's reason when it was refused. */
  request_qty: number | null;
  request_decision_reason: string | null;
};
type Warehouse = { id: string; name: string };

// The database's own minimums: app.office_reject_delivery (reason 5 to 500), app.office_resolve_pending
// (count note 3 to 300), app.decide_approval (a decision reason of at least 3, approval_decision_shape).
const REJECT_REASON_MIN = 5;
const NOTE_MIN = 3;
// D-45: the owner's own missing-goods settlement is recorded with app.owner_post_adjustment, whose reason is 5 to 300.
const OWNER_NOTE_MIN = 5;
const FLAG_TEXT: Record<string, string> = { mock_location: "mock location", distance_unknown: "salon has no pin" };
const rowKey = (u: Unsettled) => `${u.submission_id}:${u.sku_id}`;

/** One client id per action, kept until it succeeds, so a retry replays the same write (H-08). */
function useClientIds() {
  const [ids, setIds] = useState<Record<string, string>>({});
  const idFor = (key: string) => {
    const known = ids[key];
    if (known) return known;
    const fresh = crypto.randomUUID();
    setIds((all) => ({ ...all, [key]: fresh }));
    return fresh;
  };
  const done = (key: string) => setIds((all) => Object.fromEntries(Object.entries(all).filter(([k]) => k !== key)));
  return { idFor, done };
}

// Delivery approvals (D-32, spec section 6; owner or manager at AAL2). A rep's delivery is a
// submission: the goods are in the rep's pending location and nothing official exists yet. Approve
// writes the delivery, the sale, the invoice and its installments (app.office_approve_delivery);
// Reject keeps the submission and leaves the goods in pending custody (app.office_reject_delivery).
// Goods of a rejected submission are settled here (app.office_resolve_pending): back to the rep's bag,
// to a warehouse, or as missing, which needs an approved adjustment request (app.request_approval and
// app.decide_approval, by someone other than its maker; above the owner threshold the owner must check
// it, Decision 3). Every rule is the database's; its refusals are shown as returned.
// P1-30: the request asks the checker the database names (app.office_adjustment_checker, audit H2); the
// row shows the request's own quantity and fills it in (M8); a refused request shows its reason and a new
// one can be made; the maker can withdraw a pending one (app.cancel_approval); the owner settles goods as
// missing at once, with a note on the record (D-45).
export default function DeliveryApprovals() {
  const [waiting, setWaiting] = useState<Waiting[]>([]);
  const [unsettled, setUnsettled] = useState<Unsettled[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [me, setMe] = useState<string | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [rowError, setRowError] = useState<Record<string, string>>({});
  // Which waiting deliveries have the salon's valid signed acknowledgement (D-49): only those can be approved.
  const [signed, setSigned] = useState<Record<string, boolean>>({});
  const markSigned = useCallback(
    (id: string, ok: boolean) => setSigned((all) => (all[id] === ok ? all : { ...all, [id]: ok })),
    [],
  );
  const [qty, setQty] = useState<Record<string, string>>({});
  const [warehouse, setWarehouse] = useState<Record<string, string>>({});
  const clientIds = useClientIds();

  const load = useCallback(async () => {
    setError(null);
    try {
      const [w, u, wh, user, session] = await Promise.all([
        rpc<Waiting[]>("office_pending_deliveries"),
        rpc<Unsettled[]>("office_pending_stock"),
        rows<Warehouse>(db().from("stock_location").select("id, name").eq("kind", "warehouse").eq("active", true).order("name")),
        supabaseBrowser().auth.getUser(),
        mySession(),
      ]);
      setWaiting(w ?? []);
      setUnsettled(u ?? []);
      setWarehouses(wh);
      setMe(user.data.user?.id ?? null);
      setRole(session?.role ?? null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  /** Runs one write; on success shows `message` and reloads. A refusal is thrown to the caller, which shows it. */
  const act = async (key: string, write: () => Promise<unknown>, message: string) => {
    setNotice(null);
    await write();
    clientIds.done(key);
    setNotice(message);
    await load();
  };
  // The approve button has no confirmation form of its own, so its refusal is shown on the row.
  const approve = async (w: Waiting) => {
    const key = `approve:${w.submission_id}`;
    setRowError((all) => ({ ...all, [key]: "" }));
    try {
      await act(
        key,
        () => rpc("office_approve_delivery", { p_submission_id: w.submission_id, p_client_id: clientIds.idFor(key) }),
        `Approved the delivery to ${w.salon_name ?? "the salon"}; the invoice is issued.`,
      );
    } catch (e) {
      setRowError((all) => ({ ...all, [key]: (e as Error).message }));
    }
  };
  // An approved request is usable for its own quantity, when that is still unsettled (app.office_resolve_pending).
  const usable = (u: Unsettled) =>
    u.request_status === "approved" && u.request_qty !== null && u.request_qty >= 1 && u.request_qty <= u.unsettled;
  const defaultQty = (u: Unsettled) => String(usable(u) ? u.request_qty : u.unsettled);
  const quantityOf = (u: Unsettled) => Number.parseInt(qty[rowKey(u)] ?? defaultQty(u), 10);

  return (
    <main>
      <h1>Delivery approvals</h1>
      <p className="muted">
        A rep&apos;s delivery becomes official only when you approve it: then the invoice and its installments appear for the
        office and the rep.
      </p>
      {notice && <output className="ok">{notice}</output>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <section aria-labelledby="waiting-h">
        <h2 id="waiting-h">Deliveries waiting for approval ({waiting.length})</h2>
        <ListState loading={loading} error={null} empty={waiting.length === 0} emptyText="No delivery is waiting." />
        {!loading && waiting.length > 0 && (
          <ul className="plain">
            {waiting.map((w) => {
              const key = `approve:${w.submission_id}`;
              const rejectKey = `reject:${w.submission_id}`;
              return (
                <li key={w.submission_id} data-testid="waiting-delivery">
                  <strong>{w.salon_name ?? "Unnamed salon"}</strong> · {w.rep_name} · {rupees(Number(w.total_paisa))}
                  <br />
                  {(w.lines ?? []).map((l) => `${l.qty} × ${l.code} ${l.variant}`).join(", ")}
                  <br />
                  <span className="muted">
                    Received by {w.received_by_name} ·{" "}
                    {w.distance_from_pin_m === null ? "distance unknown" : `${w.distance_from_pin_m} m from the pin`} ·{" "}
                    {when(w.submitted_at)}
                    {w.flags.length > 0 && <> · flags: {w.flags.map((f) => FLAG_TEXT[f] ?? f).join(", ")}</>}
                  </span>
                  <SubmissionSignature
                    submissionId={w.submission_id}
                    orderId={w.order_id}
                    onStatus={(ok) => markSigned(w.submission_id, ok)}
                  />
                  <div className="row">
                    <button
                      type="button"
                      className="inline"
                      disabled={signed[w.submission_id] !== true}
                      title={signed[w.submission_id] === true ? undefined : "Needs the salon's signed acknowledgement first"}
                      onClick={() => void approve(w)}
                    >
                      Approve delivery
                    </button>
                    <ConfirmAction
                      label="Reject delivery"
                      confirmLabel="Reject"
                      reasonLabel="Why it is rejected"
                      reasonMinLength={REJECT_REASON_MIN}
                      danger
                      onConfirm={(reason) =>
                        act(
                          rejectKey,
                          () =>
                            rpc("office_reject_delivery", {
                              p_submission_id: w.submission_id,
                              p_client_id: clientIds.idFor(rejectKey),
                              p_reason: reason,
                            }),
                          `Rejected the delivery to ${w.salon_name ?? "the salon"}; its goods wait to be settled.`,
                        )
                      }
                    />
                  </div>
                  {rowError[key] && (
                    <p className="error" role="alert">
                      {rowError[key]}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby="settle-h">
        <h2 id="settle-h">Goods waiting to be settled ({unsettled.length})</h2>
        <p className="muted">Goods of a rejected delivery stay in the rep&apos;s pending custody until you settle them here.</p>
        <ListState loading={loading} error={null} empty={unsettled.length === 0} emptyText="No goods are waiting." />
        {!loading && unsettled.length > 0 && (
          <ul className="plain">
            {unsettled.map((u) => {
              const key = rowKey(u);
              const settle = (outcome: string, note: string, extra: Record<string, unknown> = {}) =>
                rpc("office_resolve_pending", {
                  p_client_id: clientIds.idFor(`${outcome}:${key}`),
                  p_submission_id: u.submission_id,
                  p_sku_id: u.sku_id,
                  p_qty: quantityOf(u),
                  p_outcome: outcome,
                  p_note: note,
                  ...extra,
                });
              const ownerLevel = u.request_checker_role === "owner";
              const canCheck = u.request_status === "pending" && u.request_maker_id !== me && (!ownerLevel || role === "owner");
              const canAsk = !u.request_id || u.request_status === "rejected" || (u.request_status === "approved" && !usable(u));
              return (
                <li key={key} data-testid="unsettled-goods">
                  <strong>
                    {u.unsettled} × {u.sku_code}
                  </strong>{" "}
                  · {u.rep_name} · {u.salon_name ?? "Unnamed salon"}
                  <br />
                  <span className="muted">
                    Rejected {when(u.decided_at)}: {u.reason}
                  </span>
                  <div>
                    <label htmlFor={`sq-${key}`}>Quantity to settle</label>
                    <input
                      id={`sq-${key}`}
                      inputMode="numeric"
                      value={qty[key] ?? defaultQty(u)}
                      onChange={(e) => setQty((all) => ({ ...all, [key]: e.target.value }))}
                    />
                  </div>
                  <div className="row">
                    <ConfirmAction
                      label="Return to bag"
                      confirmLabel="Return to the rep's bag"
                      reasonLabel="Count note"
                      reasonMinLength={NOTE_MIN}
                      onConfirm={(note) =>
                        act(`returned_to_bag:${key}`, () => settle("returned_to_bag", note), `Returned to ${u.rep_name}'s bag.`)
                      }
                    />
                    <label htmlFor={`wh-${key}`}>Warehouse</label>
                    <select
                      id={`wh-${key}`}
                      value={warehouse[key] ?? ""}
                      onChange={(e) => setWarehouse((all) => ({ ...all, [key]: e.target.value }))}
                    >
                      <option value="">Choose a warehouse</option>
                      {warehouses.map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.name}
                        </option>
                      ))}
                    </select>
                    <ConfirmAction
                      label="Return to warehouse"
                      confirmLabel="Return to the warehouse"
                      reasonLabel="Count note"
                      reasonMinLength={NOTE_MIN}
                      onConfirm={(note) =>
                        act(
                          `returned_to_warehouse:${key}`,
                          () => settle("returned_to_warehouse", note, { p_warehouse_id: warehouse[key] || null }),
                          "Returned to the warehouse.",
                        )
                      }
                    />
                  </div>
                  {u.request_id && u.request_status !== "rejected" && (
                    <p className="muted" data-testid="missing-request">
                      Missing request for {u.request_qty ?? "?"} units ·{" "}
                      {u.request_status === "approved" ? "approved" : "waiting for a decision"} · needs{" "}
                      {ownerLevel ? "the owner" : "an owner or a manager"}
                      {u.request_status === "approved" &&
                        !usable(u) &&
                        " · only " + u.unsettled + " are still unsettled, so it cannot be used; ask again"}
                    </p>
                  )}
                  {u.request_status === "rejected" && (
                    <p className="muted" data-testid="missing-refused">
                      The missing request for {u.request_qty ?? "?"} units was refused: {u.request_decision_reason}
                    </p>
                  )}
                  <div className="row">
                    {role === "owner" && (
                      <ConfirmAction
                        label="Record as missing (owner)"
                        confirmLabel="Record these goods as missing"
                        reasonLabel="What happened to the goods (kept on the record)"
                        reasonMinLength={OWNER_NOTE_MIN}
                        danger
                        onConfirm={(note) =>
                          act(
                            // The same key as settle() uses, so a second settlement of this row gets a new client id.
                            `missing:${key}`,
                            () => settle("missing", note),
                            "Recorded as missing, with your note.",
                          )
                        }
                      />
                    )}
                    {role !== "owner" && canAsk && (
                      <ConfirmAction
                        label="Report missing"
                        confirmLabel="Ask for an approved adjustment"
                        reasonLabel="What happened to the goods"
                        reasonMinLength={NOTE_MIN}
                        onConfirm={(reason) =>
                          act(
                            `request:${key}`,
                            async () =>
                              rpc("request_approval", {
                                p_client_id: clientIds.idFor(`request:${key}`),
                                p_kind: "adjustment",
                                p_subject_type: "stock_location",
                                p_subject_id: u.pending_location_id,
                                p_payload: { sku_id: u.sku_id, qty_delta: -quantityOf(u), submission_id: u.submission_id },
                                p_reason: reason,
                                // Audit H2: the checker the database names for this SKU and quantity.
                                p_checker_role: await rpc<string>("office_adjustment_checker", {
                                  p_sku_id: u.sku_id,
                                  p_qty_delta: -quantityOf(u),
                                }),
                              }),
                            "Adjustment requested; another office user must check it.",
                          )
                        }
                      />
                    )}
                    {u.request_status === "pending" && !canCheck && (
                      <span className="muted">
                        {u.request_maker_id === me
                          ? ownerLevel
                            ? "You asked for this; the owner checks it."
                            : "You asked for this; another office user checks it."
                          : "Waiting for the owner to check it."}
                      </span>
                    )}
                    {u.request_status === "pending" && u.request_maker_id === me && u.request_id && (
                      <ConfirmAction
                        label="Withdraw request"
                        confirmLabel="Withdraw the adjustment request"
                        reasonLabel="Why it is withdrawn"
                        reasonMinLength={NOTE_MIN}
                        danger
                        onConfirm={(reason) =>
                          act(
                            `withdraw:${key}`,
                            () => rpc("cancel_approval", { p_request_id: u.request_id, p_reason: reason }),
                            "Request withdrawn.",
                          )
                        }
                      />
                    )}
                    {canCheck && u.request_id && (
                      <>
                        <ConfirmAction
                          label="Approve request"
                          confirmLabel="Approve the adjustment"
                          reasonLabel="Checked how"
                          reasonMinLength={NOTE_MIN}
                          onConfirm={(reason) =>
                            act(
                              `decide:${key}`,
                              () => rpc("decide_approval", { p_request_id: u.request_id, p_approve: true, p_reason: reason }),
                              "Adjustment approved.",
                            )
                          }
                        />
                        <ConfirmAction
                          label="Refuse request"
                          confirmLabel="Refuse the adjustment"
                          reasonLabel="Why it is refused"
                          reasonMinLength={NOTE_MIN}
                          danger
                          onConfirm={(reason) =>
                            act(
                              `decide:${key}`,
                              () => rpc("decide_approval", { p_request_id: u.request_id, p_approve: false, p_reason: reason }),
                              "Adjustment refused.",
                            )
                          }
                        />
                      </>
                    )}
                    {usable(u) && u.request_id && (
                      <ConfirmAction
                        label="Settle as missing"
                        confirmLabel="Settle as missing"
                        reasonLabel="Count note"
                        reasonMinLength={NOTE_MIN}
                        danger
                        onConfirm={(note) =>
                          act(
                            `missing:${key}`,
                            () => settle("missing", note, { p_approval_id: u.request_id }),
                            "Settled as missing with the approved adjustment.",
                          )
                        }
                      />
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}
