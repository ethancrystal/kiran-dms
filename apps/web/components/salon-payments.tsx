"use client";
import { useCallback, useEffect, useState } from "react";
import { ConfirmAction, ListState } from "@/components/confirm-action";
import { rupees } from "@/lib/money";
import { rpc } from "@/lib/rpc";
import { label } from "@/lib/salons";
import { when } from "@/lib/time";

/** One row of app.office_salon_payments (migration 20261105230000, P1-30). */
type Payment = {
  payment_id: string;
  receipt_id: string;
  receipt_number: string;
  recorded_at: string;
  method: "cash" | "bank_transfer";
  amount_paisa: number;
  bank_name: string | null;
  bank_reference: string | null;
  recorded_by_name: string;
  recorded_by_role: "rep" | "manager" | "owner";
  flags: string[];
  distance_from_pin_m: number | null;
  reversed_at: string | null;
  reversal_reason: string | null;
  reversed_by_name: string | null;
  may_reverse: boolean;
};

// app.office_reverse_payment asks for a reason of 5 to 300 characters.
const REASON_MIN = 5;
// The CTL-02 flags record_payment keeps for the office's review, in plain words.
const FLAG_TEXT: Record<string, string> = {
  far_from_salon: "recorded far from the salon",
  distance_unknown: "salon has no pin, distance unknown",
  no_visit: "no visit logged that day",
  late_after_arrival: "recorded long after arriving",
  mock_location: "mock location",
  office_collected: "cash collected by the office",
  on_behalf: "recorded by the office",
};

/**
 * Payment history of one salon for the office (FLOW-13) with reversal (D-48): receipt number, method, who
 * recorded it, the CTL-02 flags, and a reversed payment marked with when, who and why. Reverse calls
 * app.office_reverse_payment with a reason; the database refuses a manager reversing their own payment
 * and a second reversal, in its own words. Balances, ageing and the rep's cash follow in the database.
 */
export function SalonPayments({
  salonId,
  version,
  onReversed,
}: {
  salonId: string;
  /** Bumped by the page when a payment is recorded, so the list reloads. */
  version: number;
  onReversed: (message: string) => void;
}) {
  const [list, setList] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // One client id per payment, kept until the database accepts the reversal, so a retry replays it (H-08).
  const [keys, setKeys] = useState<Record<string, string>>({});
  const keyFor = (id: string) => {
    const known = keys[id];
    if (known) return known;
    const fresh = crypto.randomUUID();
    setKeys((all) => ({ ...all, [id]: fresh }));
    return fresh;
  };

  const load = useCallback(async () => {
    setError(null);
    try {
      setList((await rpc<Payment[]>("office_salon_payments", { p_salon_id: salonId })) ?? []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [salonId]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: version is the page's reload signal.
  useEffect(() => {
    void load();
  }, [load, version]);

  return (
    <section className="card" aria-labelledby="payments-h">
      <h2 id="payments-h">Payments</h2>
      <ListState loading={loading} error={error} empty={list.length === 0} emptyText="No payments recorded for this salon." />
      {!loading && !error && list.length > 0 && (
        <ul className="plain">
          {list.map((p) => (
            <li key={p.payment_id} data-testid="salon-payment">
              <strong>{rupees(Number(p.amount_paisa))}</strong> · receipt {p.receipt_number} ·{" "}
              {p.method === "cash" ? "cash" : `bank transfer (${p.bank_name ?? ""} ${p.bank_reference ?? ""})`} ·{" "}
              {when(p.recorded_at)} · {label(p.recorded_by_role)} {p.recorded_by_name}
              {p.reversed_at && <span className="badge"> Reversed</span>}
              {(p.flags ?? []).length > 0 && (
                <>
                  <br />
                  <span className="muted">
                    Flags: {(p.flags ?? []).map((f) => FLAG_TEXT[f] ?? f).join(", ")}
                    {p.distance_from_pin_m !== null && ` (${p.distance_from_pin_m} m from the pin)`}
                  </span>
                </>
              )}
              {p.reversed_at && (
                <>
                  <br />
                  <span className="muted">
                    Reversed {when(p.reversed_at)} by {p.reversed_by_name}: {p.reversal_reason}. The receipt stays on record.
                  </span>
                </>
              )}
              {!p.reversed_at && p.may_reverse && (
                <div className="row">
                  <ConfirmAction
                    label="Reverse"
                    confirmLabel={`Reverse receipt ${p.receipt_number}`}
                    reasonLabel="Why it is reversed"
                    reasonMinLength={REASON_MIN}
                    danger
                    onConfirm={async (reason) => {
                      await rpc("office_reverse_payment", {
                        p_client_id: keyFor(p.payment_id),
                        p_payment_id: p.payment_id,
                        p_reason: reason,
                      });
                      await load();
                      onReversed(`Receipt ${p.receipt_number} reversed. The salon owes ${rupees(Number(p.amount_paisa))} again.`);
                    }}
                  />
                </div>
              )}
              {!p.reversed_at && !p.may_reverse && (
                <span className="muted"> · you recorded this payment; the owner can reverse it</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
