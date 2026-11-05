"use client";
import { useCallback, useEffect, useState } from "react";
import { ConfirmAction, ListState } from "@/components/confirm-action";
import { type CommissionStatement, karachiToday, monthStart, when } from "@/lib/commission";
import { percent, rupees, toBasisPoints, toPaisa } from "@/lib/money";
import { rpc } from "@/lib/rpc";

type RepRow = {
  rep_id: string;
  full_name: string;
  status: "active" | "suspended" | "offboarded";
  default_rate_bp: number | null;
  earned_paisa: number;
  paid_paisa: number;
  owed_paisa: number;
};
type OfficeStatement = CommissionStatement & {
  rep_name: string;
  rep_status: string;
  rate_history: Array<{ seq: number; rate_bp: number; reason: string; set_at: string; set_by_name: string }>;
};

// The database's own minimums: app.office_set_commission_rate (reason 5 to 300) and
// app.office_reverse_commission_payment (reason 5 to 500).
const RATE_REASON_MIN = 5;
const REVERSE_REASON_MIN = 5;

/** One client id per form, kept until the write succeeds, so a retry replays the same write (H-08). */
function useClientId() {
  const [cid, setCid] = useState(() => crypto.randomUUID());
  return { cid, renew: () => setCid(crypto.randomUUID()) };
}

// Commission (D-31, D-38; FLD-03, FLD-06; owner or manager at AAL2). Per rep: the default rate (the
// salon rate is set with the salon's rep, on the salon page), earned and paid in the chosen dates,
// owed to date, the invoices behind it, payments and reversals. A payment is at most what is owed; a
// reversal undoes one payment in full, with a reason. Every rule is the database's; its refusals are
// shown as returned.
export default function CommissionPage() {
  const today = karachiToday();
  const [from, setFrom] = useState(monthStart(today));
  const [to, setTo] = useState(today);
  const [reps, setReps] = useState<RepRow[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<OfficeStatement | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [formError, setFormError] = useState<Record<string, string>>({});
  const [rate, setRate] = useState("");
  const [rateReason, setRateReason] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const rateId = useClientId();
  const payId = useClientId();
  const [reverseIds, setReverseIds] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setError(null);
    try {
      const list = (await rpc<RepRow[]>("office_commission_reps", { p_from: from, p_to: to })) ?? [];
      setReps(list);
      setDetail(
        selected ? await rpc<OfficeStatement>("office_commission", { p_rep_id: selected, p_from: from, p_to: to }) : null,
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [from, to, selected]);
  useEffect(() => {
    void load();
  }, [load]);

  const submit = async (key: string, write: () => Promise<unknown>, message: string, done: () => void) => {
    setNotice(null);
    setFormError((all) => ({ ...all, [key]: "" }));
    setBusy(true);
    try {
      await write();
      done();
      setNotice(message);
      await load();
    } catch (e) {
      setFormError((all) => ({ ...all, [key]: (e as Error).message }));
    } finally {
      setBusy(false);
    }
  };

  const setDefaultRate = (repId: string) => {
    const bp = toBasisPoints(rate);
    if (bp === null) {
      setFormError((all) => ({ ...all, rate: "Type a percentage from 0 to 100, with at most two decimals." }));
      return;
    }
    void submit(
      "rate",
      () => rpc("office_set_commission_rate", { p_client_id: rateId.cid, p_rep_id: repId, p_rate_bp: bp, p_reason: rateReason }),
      `Default rate set to ${percent(bp)} for invoices from now on.`,
      () => {
        rateId.renew();
        setRate("");
        setRateReason("");
      },
    );
  };

  const recordPayment = (repId: string) => {
    const paisa = toPaisa(amount);
    if (paisa === null || paisa <= 0) {
      setFormError((all) => ({ ...all, pay: "Type an amount in rupees, with at most two decimals." }));
      return;
    }
    void submit(
      "pay",
      () =>
        rpc("office_record_commission_payment", {
          p_client_id: payId.cid,
          p_rep_id: repId,
          p_amount_paisa: paisa,
          p_note: note.trim() || null,
        }),
      `Recorded a commission payment of ${rupees(paisa)}.`,
      () => {
        payId.renew();
        setAmount("");
        setNote("");
      },
    );
  };

  const reverseIdFor = (paymentId: string) => {
    const known = reverseIds[paymentId];
    if (known) return known;
    const fresh = crypto.randomUUID();
    setReverseIds((all) => ({ ...all, [paymentId]: fresh }));
    return fresh;
  };

  return (
    <main>
      <h1>Commission</h1>
      <p className="muted">
        Earned is worked out from approved deliveries&apos; invoices at the rate fixed on each invoice. Owed is everything earned
        to date minus everything paid.
      </p>
      <div className="row">
        <label>
          From
          <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} required />
        </label>
        <label>
          To
          <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} required />
        </label>
      </div>
      {notice && <output className="ok">{notice}</output>}

      <section aria-labelledby="reps-h">
        <h2 id="reps-h">Reps</h2>
        <ListState loading={loading} error={error} empty={reps.length === 0} emptyText="There are no reps yet." />
        {!loading && !error && reps.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>Rep</th>
                <th>Default rate</th>
                <th>Earned</th>
                <th>Paid</th>
                <th>Owed now</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {reps.map((r) => (
                <tr key={r.rep_id} data-testid="commission-rep">
                  <td>
                    {r.full_name}
                    {r.status !== "active" && <span className="muted"> ({r.status})</span>}
                  </td>
                  <td>{r.default_rate_bp === null ? "not set" : percent(r.default_rate_bp)}</td>
                  <td>{rupees(Number(r.earned_paisa))}</td>
                  <td>{rupees(Number(r.paid_paisa))}</td>
                  <td>{rupees(Number(r.owed_paisa))}</td>
                  <td>
                    <button type="button" className="inline" onClick={() => setSelected(r.rep_id)}>
                      {selected === r.rep_id ? "Showing" : "Open"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {detail && (
        <section aria-labelledby="rep-h">
          <h2 id="rep-h">{detail.rep_name}</h2>
          <div className="card">
            <p>
              Earned in these dates: <strong data-testid="rep-earned">{rupees(Number(detail.earned_paisa))}</strong> · Paid in
              these dates: <strong>{rupees(Number(detail.paid_paisa))}</strong> · Owed now:{" "}
              <strong data-testid="rep-owed">{rupees(Number(detail.owed_paisa))}</strong>
            </p>
          </div>

          <h3>Default rate</h3>
          <p>
            Now:{" "}
            {detail.default_rate_bp === null
              ? "not set (invoices earn 0% unless the salon has a rate)"
              : percent(detail.default_rate_bp)}
            . A change applies to deliveries approved from now on; the salon rate is set on the salon page.
          </p>
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault();
              setDefaultRate(detail.rep_id);
            }}
          >
            <label>
              Rate (%)
              <input
                value={rate}
                onChange={(e) => setRate(e.target.value)}
                inputMode="decimal"
                required
                aria-label="Rate in percent"
              />
            </label>
            <label>
              Reason
              <input
                value={rateReason}
                onChange={(e) => setRateReason(e.target.value)}
                required
                minLength={RATE_REASON_MIN}
                maxLength={300}
                aria-label="Reason for the rate"
              />
            </label>
            <button type="submit" className="inline" disabled={busy}>
              Set default rate
            </button>
          </form>
          {formError.rate && (
            <p className="error" role="alert">
              {formError.rate}
            </p>
          )}
          {detail.rate_history.length > 0 && (
            <ul className="plain muted">
              {detail.rate_history.map((h) => (
                <li key={h.seq}>
                  {percent(h.rate_bp)} · {h.reason} · {h.set_by_name} · {when(h.set_at)}
                </li>
              ))}
            </ul>
          )}
          {detail.salon_rates.length > 0 && (
            <>
              <h3>Salons assigned to this rep</h3>
              <ul className="plain">
                {detail.salon_rates.map((s) => (
                  <li key={s.salon_id}>
                    <a href={`/office/salons/${s.salon_id}`}>{s.salon_name ?? "Unnamed salon"}</a> ·{" "}
                    {s.rate_bp === null ? "default rate" : percent(s.rate_bp)}
                  </li>
                ))}
              </ul>
            </>
          )}

          <h3>Record a payment</h3>
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault();
              recordPayment(detail.rep_id);
            }}
          >
            <label>
              Amount (Rs)
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                inputMode="decimal"
                required
                aria-label="Amount in rupees"
              />
            </label>
            <label>
              Note
              <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} aria-label="Payment note" />
            </label>
            <button type="submit" className="inline" disabled={busy}>
              Record payment
            </button>
          </form>
          {formError.pay && (
            <p className="error" role="alert">
              {formError.pay}
            </p>
          )}

          <h3>Payments in these dates</h3>
          {detail.payments.length === 0 ? (
            <p className="muted">No commission payment in these dates.</p>
          ) : (
            <ul className="plain">
              {detail.payments.map((p) => (
                <li key={p.payment_id} data-testid="office-commission-payment">
                  <span className="badge">{p.kind === "payment" ? "Paid" : "Reversal"}</span>{" "}
                  <strong>{rupees(Number(p.amount_paisa))}</strong> · {p.recorded_by_name} · {when(p.recorded_at)}
                  {p.note && <> · {p.note}</>}
                  {p.reason && <> · {p.reason}</>}
                  {p.reversed && <span className="muted"> (reversed)</span>}
                  {p.kind === "payment" && !p.reversed && (
                    <ConfirmAction
                      label="Reverse"
                      confirmLabel="Reverse payment"
                      reasonLabel="Why it is reversed"
                      reasonMinLength={REVERSE_REASON_MIN}
                      danger
                      onConfirm={async (reason) => {
                        setNotice(null);
                        await rpc("office_reverse_commission_payment", {
                          p_client_id: reverseIdFor(p.payment_id),
                          p_payment_id: p.payment_id,
                          p_reason: reason,
                        });
                        setNotice(`Reversed the payment of ${rupees(Number(p.amount_paisa))}.`);
                        await load();
                      }}
                    />
                  )}
                </li>
              ))}
            </ul>
          )}

          <h3>Invoices in these dates ({detail.invoice_count})</h3>
          {detail.invoices.length === 0 ? (
            <p className="muted">No invoice earned commission in these dates.</p>
          ) : (
            <ul className="plain">
              {detail.invoices.map((i) => (
                <li key={i.invoice_id}>
                  <strong>{i.number}</strong> · {i.salon_name ?? "Unnamed salon"} · {rupees(Number(i.total_paisa))} at{" "}
                  {percent(i.rate_bp)} = {rupees(Number(i.commission_paisa))} · <span className="muted">{when(i.issued_at)}</span>
                </li>
              ))}
            </ul>
          )}
          {detail.invoice_count > detail.invoices.length && (
            <p className="muted">Showing the newest {detail.invoices.length}; the totals count them all.</p>
          )}
        </section>
      )}
    </main>
  );
}
