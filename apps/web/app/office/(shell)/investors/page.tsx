"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ListState } from "@/components/confirm-action";
import { type InvestorRow, LEDGER_NOTE } from "@/lib/investors";
import { rupees } from "@/lib/money";
import { rpc } from "@/lib/rpc";

// Investors (P1-20; CAP-01 to CAP-03, D-40). Owner and manager only: app.office_investors returns
// each investor's derived figures and one totals row, and refuses anyone else (42501). The page shows
// what the database says; it adds nothing up and calculates nothing.
export default function Investors() {
  const [list, setList] = useState<InvestorRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setList((await rpc<InvestorRow[]>("office_investors")) ?? []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const totals = list.find((r) => r.is_total) ?? null;
  const investors = list.filter((r) => !r.is_total);

  return (
    <>
      <h1>Investors</h1>
      <p className="muted" data-testid="ledger-note">
        {LEDGER_NOTE}
      </p>
      {notice && <output className="ok">{notice}</output>}
      {totals && (
        <section className="card" aria-labelledby="totals-h">
          <h2 id="totals-h">All investors</h2>
          <dl>
            <dt>Invested</dt>
            <dd data-testid="total-invested">{rupees(totals.invested_paisa)}</dd>
            <dt>Principal outstanding</dt>
            <dd data-testid="total-outstanding">{rupees(totals.principal_outstanding_paisa)}</dd>
            <dt>Profit decided</dt>
            <dd data-testid="total-decided">{rupees(totals.profit_decided_paisa)}</dd>
            <dt>Profit paid</dt>
            <dd data-testid="total-paid">{rupees(totals.profit_paid_paisa)}</dd>
            <dt>Profit owed</dt>
            <dd data-testid="total-owed">{rupees(totals.profit_owed_paisa)}</dd>
          </dl>
        </section>
      )}
      <h2>Investors</h2>
      <ListState loading={loading} error={error} empty={investors.length === 0} emptyText="No investors yet." />
      {!loading && !error && investors.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Investor</th>
              <th>Status</th>
              <th>Invested</th>
              <th>Principal returned</th>
              <th>Principal outstanding</th>
              <th>Profit decided</th>
              <th>Profit paid</th>
              <th>Profit owed</th>
            </tr>
          </thead>
          <tbody>
            {investors.map((r) => (
              <tr key={r.investor_id}>
                <td data-label="Investor">
                  <Link href={`/office/investors/${r.investor_id}`}>{r.full_name}</Link>
                </td>
                <td data-label="Status">
                  <span className="badge">{r.status}</span>
                </td>
                <td data-label="Invested">{rupees(r.invested_paisa)}</td>
                <td data-label="Principal returned">{rupees(r.principal_returned_paisa)}</td>
                <td data-label="Principal outstanding">{rupees(r.principal_outstanding_paisa)}</td>
                <td data-label="Profit decided">{rupees(r.profit_decided_paisa)}</td>
                <td data-label="Profit paid">{rupees(r.profit_paid_paisa)}</td>
                <td data-label="Profit owed">{rupees(r.profit_owed_paisa)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <AddInvestor
        onDone={async (m) => {
          setNotice(m);
          await load();
        }}
      />
    </>
  );
}

function AddInvestor({ onDone }: { onDone: (message: string) => Promise<void> }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One key per attempt: a retry after a lost answer returns the same investor (H-08).
  const [clientId, setClientId] = useState(() => crypto.randomUUID());

  return (
    <form
      className="card"
      aria-label="Add an investor"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          const x = await rpc<{ full_name: string }>("office_create_investor", {
            p_client_id: clientId,
            p_full_name: name,
            p_phone: phone.trim() || null,
            p_note: note.trim() || null,
          });
          setName("");
          setPhone("");
          setNote("");
          setClientId(crypto.randomUUID());
          await onDone(`Investor ${x.full_name} added.`);
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <h2>Add an investor</h2>
      <label htmlFor="inv-name">Name</label>
      <input id="inv-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required />
      <label htmlFor="inv-phone">Phone (optional)</label>
      <input
        id="inv-phone"
        inputMode="tel"
        autoComplete="off"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        maxLength={16}
      />
      <label htmlFor="inv-note">Note (optional)</label>
      <input id="inv-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" disabled={busy}>
        {busy ? "Saving…" : "Add investor"}
      </button>
    </form>
  );
}
