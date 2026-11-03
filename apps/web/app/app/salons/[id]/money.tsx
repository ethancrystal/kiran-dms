"use client";
import { useCallback, useEffect, useState } from "react";
import { rupees, toPaisa } from "@/lib/money";
import { rpc } from "@/lib/rpc";
import { position } from "@/lib/salons";

type Balance = {
  invoiced_paisa: number;
  paid_paisa: number;
  balance_paisa: number;
  overdue_paisa: number;
  next_due_on: string | null;
};
type Installment = {
  installment_id: string;
  invoice_number: string;
  seq: number;
  of_count: number;
  due_on: string;
  remaining_paisa: number;
  status: string;
};
type Receipt = { number: string };
type Method = "cash" | "bank_transfer";

// The salon's account for the rep at the salon (PAY-02, PAY-04, PAY-11; doc 09 §3): what is owed,
// installment by installment, and recording a payment. The database checks the open day, the device,
// the territory and GPS, allocates oldest due first and issues the receipt number; this page shows
// what it says. Sending the receipt to the salon is not built (B-08).
export function MoneySection({ salonId }: { salonId: string }) {
  const [balance, setBalance] = useState<Balance | null>(null);
  const [due, setDue] = useState<Installment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [b, i] = await Promise.all([
        rpc<Balance[]>("salon_balance", { p_salon_id: salonId }),
        rpc<Installment[]>("salon_installments", { p_salon_id: salonId }),
      ]);
      setBalance(b?.[0] ?? null);
      setDue(i ?? []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [salonId]);
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="card" aria-labelledby="money-h">
      <h2 id="money-h">
        Account · <span lang="ur">حساب</span>
      </h2>
      {loading && (
        <p className="muted" aria-busy="true">
          Loading…
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {receipt && <output className="ok">Payment recorded. Receipt {receipt}.</output>}
      {!loading && !error && balance && (
        <>
          <p>
            Owed <strong data-testid="balance">{rupees(balance.balance_paisa)}</strong>
            {Number(balance.overdue_paisa) > 0 && <span className="error"> · overdue {rupees(balance.overdue_paisa)}</span>}
            {balance.next_due_on && <span className="muted"> · next due {balance.next_due_on}</span>}
          </p>
          {due.length === 0 ? (
            <p className="muted">Nothing is owed.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Invoice</th>
                  <th>Due</th>
                  <th>Still owed</th>
                </tr>
              </thead>
              <tbody>
                {due.map((d) => (
                  <tr key={d.installment_id}>
                    <td data-label="Invoice">
                      {d.invoice_number} · {d.seq} of {d.of_count}
                    </td>
                    <td data-label="Due">
                      {d.due_on} {d.status === "overdue" && <span className="badge">overdue</span>}
                    </td>
                    <td data-label="Still owed">{rupees(d.remaining_paisa)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {Number(balance.balance_paisa) > 0 && (
            <PaymentForm
              salonId={salonId}
              onDone={async (number) => {
                setReceipt(number);
                await load();
              }}
            />
          )}
        </>
      )}
    </section>
  );
}

function PaymentForm({ salonId, onDone }: { salonId: string; onDone: (receipt: string) => Promise<void> }) {
  const [method, setMethod] = useState<Method>("cash");
  const [amount, setAmount] = useState("");
  const [bankName, setBankName] = useState("");
  const [bankRef, setBankRef] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One key per payment attempt: a retry after a lost answer is the same payment, never a second one (H-08).
  const [clientId, setClientId] = useState(() => crypto.randomUUID());

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          const paisa = toPaisa(amount);
          if (paisa === null || paisa <= 0) throw new Error("Enter the amount in rupees, for example 1500 or 1500.50.");
          if (method === "bank_transfer" && (!bankName.trim() || !bankRef.trim())) {
            throw new Error("A bank transfer needs the bank name and the transfer reference.");
          }
          const gps = await position();
          if (!gps) throw new Error("A payment needs your location (CTL-02). Allow location for this site and try again.");
          const r = await rpc<Receipt>("rep_record_payment", {
            p_client_id: clientId,
            p_salon_id: salonId,
            p_method: method,
            p_amount_paisa: paisa,
            p_lat: gps.lat,
            p_lng: gps.lng,
            p_bank_name: method === "bank_transfer" ? bankName.trim() : null,
            p_bank_reference: method === "bank_transfer" ? bankRef.trim() : null,
            p_mock_location: false,
            p_recorded_at_client: new Date().toISOString(),
          });
          setAmount("");
          setBankName("");
          setBankRef("");
          setClientId(crypto.randomUUID());
          await onDone(r.number);
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <h3>
        Record a payment · <span lang="ur">ادائیگی درج کریں</span>
      </h3>
      <fieldset className="inline-form">
        <legend>Method</legend>
        <label>
          <input type="radio" name="method" checked={method === "cash"} onChange={() => setMethod("cash")} />
          Cash
        </label>
        <label>
          <input type="radio" name="method" checked={method === "bank_transfer"} onChange={() => setMethod("bank_transfer")} />
          Bank transfer
        </label>
      </fieldset>
      <label htmlFor="pay-amount">Amount (Rs)</label>
      <input
        id="pay-amount"
        inputMode="decimal"
        autoComplete="off"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        maxLength={12}
        required
      />
      {method === "bank_transfer" && (
        <>
          <label htmlFor="pay-bank">Bank name</label>
          <input id="pay-bank" value={bankName} onChange={(e) => setBankName(e.target.value)} maxLength={60} />
          <label htmlFor="pay-ref">Transfer reference</label>
          <input id="pay-ref" value={bankRef} onChange={(e) => setBankRef(e.target.value)} maxLength={60} />
        </>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" disabled={busy}>
        {busy ? "Saving…" : "Record payment"}
      </button>
      <p className="muted">The salon is owed a numbered receipt; a paper receipt is not valid.</p>
    </form>
  );
}
