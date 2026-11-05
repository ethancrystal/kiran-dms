"use client";
import Link from "next/link";
import { use, useCallback, useEffect, useState } from "react";
import { ConfirmAction, ListState } from "@/components/confirm-action";
import { InvestorMonth } from "@/components/investor-month";
import {
  type InvestmentRow,
  type InvestorRow,
  karachiToday,
  LEDGER_NOTE,
  REVERSAL_REASON_MIN_LENGTH,
  type StatementRow,
} from "@/lib/investors";
import { rupees, toPaisa } from "@/lib/money";
import { db, rows, rpc } from "@/lib/rpc";

type Investor = { id: string; full_name: string; phone: string | null; note: string | null; status: "active" | "closed" };
type Done = (message: string) => Promise<void>;

const AMOUNT_HELP = "Enter the amount in rupees, for example 100000 or 1500.50.";
const ENTRY_TEXT: Record<string, string> = {
  investment: "Investment",
  profit_decision: "Profit decided",
  profit: "Profit paid",
  principal: "Principal returned",
};
const entryText = (e: StatementRow) => ENTRY_TEXT[e.payout_kind ?? e.entry_kind] ?? e.entry_kind;

// One investor (P1-20; CAP-01 to CAP-03, D-40): details, the investments with their derived figures,
// recording money, and the statement with reversals. Every write is an app.office_* function (owner or
// manager at AAL2); every figure is the database's. Nothing here is calculated or posted to cash.
export default function InvestorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [investor, setInvestor] = useState<Investor | null>(null);
  const [figures, setFigures] = useState<InvestorRow | null>(null);
  const [investments, setInvestments] = useState<InvestmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Bumped after every write, so the statement reloads with the rest.
  const [version, setVersion] = useState(0);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [x, all, inv] = await Promise.all([
        rows<Investor>(db().from("investor").select("id, full_name, phone, note, status").eq("id", id)),
        rpc<InvestorRow[]>("office_investors"),
        rpc<InvestmentRow[]>("office_investor_investments", { p_investor_id: id }),
      ]);
      setInvestor(x[0] ?? null);
      setFigures((all ?? []).find((r) => r.investor_id === id) ?? null);
      setInvestments(inv ?? []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
      setVersion((v) => v + 1);
    }
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);

  const done: Done = async (m) => {
    setNotice(m);
    await load();
  };

  if (loading)
    return (
      <p className="muted" aria-busy="true">
        Loading…
      </p>
    );
  if (!investor)
    return (
      <>
        <p className="error" role="alert">
          {error ?? "No such investor."}
        </p>
        <Link href="/office/investors">← Investors</Link>
      </>
    );

  const open = investments.filter((m) => !m.reversed);
  const active = investor.status === "active";

  return (
    <>
      <p>
        <Link href="/office/investors">← Investors</Link>
      </p>
      <h1>{investor.full_name}</h1>
      <p className="muted">
        <span className="badge" data-testid="investor-status">
          {investor.status}
        </span>
        {investor.phone && <> · {investor.phone}</>}
        {investor.note && <> · {investor.note}</>}
      </p>
      <p className="muted">{LEDGER_NOTE}</p>
      {notice && <output className="ok">{notice}</output>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {figures && (
        <section className="card" aria-labelledby="sum-h">
          <h2 id="sum-h">Figures</h2>
          <dl>
            <dt>Invested</dt>
            <dd data-testid="investor-invested">{rupees(figures.invested_paisa)}</dd>
            <dt>Principal returned</dt>
            <dd data-testid="investor-returned">{rupees(figures.principal_returned_paisa)}</dd>
            <dt>Principal outstanding</dt>
            <dd data-testid="investor-outstanding">{rupees(figures.principal_outstanding_paisa)}</dd>
            <dt>Profit decided</dt>
            <dd data-testid="investor-decided">{rupees(figures.profit_decided_paisa)}</dd>
            <dt>Profit paid</dt>
            <dd data-testid="investor-paid">{rupees(figures.profit_paid_paisa)}</dd>
            <dt>Profit owed</dt>
            <dd data-testid="investor-owed">{rupees(figures.profit_owed_paisa)}</dd>
          </dl>
        </section>
      )}

      <InvestorMonth investorId={id} version={version} canDecide={active && open.length > 0} />

      <section className="card" aria-labelledby="inv-h">
        <h2 id="inv-h">Investments</h2>
        {investments.length === 0 ? (
          <p className="muted">No investments yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Invested</th>
                <th>Principal outstanding</th>
                <th>Profit decided</th>
                <th>Profit paid</th>
                <th>Profit owed</th>
              </tr>
            </thead>
            <tbody>
              {investments.map((m) => (
                <tr key={m.investment_id} data-testid="investment-row">
                  <td data-label="Date">
                    {m.invested_on}
                    {m.reversed && <span className="badge"> reversed</span>}
                    {m.note && <span className="muted"> · {m.note}</span>}
                  </td>
                  <td data-label="Invested">{rupees(m.invested_paisa)}</td>
                  <td data-label="Principal outstanding">{rupees(m.principal_outstanding_paisa)}</td>
                  <td data-label="Profit decided">{rupees(m.profit_decided_paisa)}</td>
                  <td data-label="Profit paid">{rupees(m.profit_paid_paisa)}</td>
                  <td data-label="Profit owed">{rupees(m.profit_owed_paisa)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {active ? (
        <>
          <AddInvestment investorId={id} onDone={done} />
          {open.length > 0 && <DecideProfit investments={open} onDone={done} />}
          {open.length > 0 && <RecordPayout investments={open} onDone={done} />}
        </>
      ) : (
        <p className="muted">This investor is closed: nothing new is recorded until the investor is reopened.</p>
      )}

      <Statement investorId={id} version={version} canReverse={active} onDone={done} />
      <EditInvestor investor={investor} onDone={done} />
    </>
  );
}

/** Shared state of one money form: the amount, the date, a note, and one client_id per attempt (H-08). */
function useMoneyForm() {
  const [amount, setAmount] = useState("");
  const [on, setOn] = useState(karachiToday);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clientId, setClientId] = useState(() => crypto.randomUUID());
  const reset = () => {
    setAmount("");
    setNote("");
    setClientId(crypto.randomUUID());
  };
  const submit = (write: (paisa: number) => Promise<string>, onDone: Done) => async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const paisa = toPaisa(amount);
      if (paisa === null || paisa <= 0) throw new Error(AMOUNT_HELP);
      const message = await write(paisa);
      reset();
      await onDone(message);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return { amount, setAmount, on, setOn, note, setNote, busy, error, clientId, submit };
}

function AmountDateNote({ prefix, f }: { prefix: string; f: ReturnType<typeof useMoneyForm> }) {
  return (
    <>
      <label htmlFor={`${prefix}-amount`}>Amount (Rs)</label>
      <input
        id={`${prefix}-amount`}
        inputMode="decimal"
        autoComplete="off"
        value={f.amount}
        onChange={(e) => f.setAmount(e.target.value)}
        maxLength={12}
        required
      />
      <label htmlFor={`${prefix}-on`}>Date</label>
      <input
        id={`${prefix}-on`}
        type="date"
        value={f.on}
        max={karachiToday()}
        onChange={(e) => f.setOn(e.target.value)}
        required
      />
      <label htmlFor={`${prefix}-note`}>Note (optional)</label>
      <input id={`${prefix}-note`} value={f.note} onChange={(e) => f.setNote(e.target.value)} maxLength={500} />
      {f.error && (
        <p className="error" role="alert">
          {f.error}
        </p>
      )}
    </>
  );
}

function InvestmentPicker({
  prefix,
  investments,
  value,
  onChange,
}: {
  prefix: string;
  investments: InvestmentRow[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <>
      <label htmlFor={`${prefix}-investment`}>Investment</label>
      <select id={`${prefix}-investment`} value={value} onChange={(e) => onChange(e.target.value)} required>
        {investments.map((m) => (
          <option key={m.investment_id} value={m.investment_id}>
            {m.invested_on} · {rupees(m.invested_paisa)}
          </option>
        ))}
      </select>
    </>
  );
}

function AddInvestment({ investorId, onDone }: { investorId: string; onDone: Done }) {
  const f = useMoneyForm();
  return (
    <form
      className="card"
      aria-label="Add an investment"
      onSubmit={f.submit(async (paisa) => {
        await rpc("office_add_investment", {
          p_client_id: f.clientId,
          p_investor_id: investorId,
          p_amount_paisa: paisa,
          p_invested_on: f.on,
          p_note: f.note.trim() || null,
        });
        return `Investment of ${rupees(paisa)} recorded.`;
      }, onDone)}
    >
      <h2>Add an investment</h2>
      <AmountDateNote prefix="add" f={f} />
      <button type="submit" disabled={f.busy}>
        {f.busy ? "Saving…" : "Record investment"}
      </button>
    </form>
  );
}

function DecideProfit({ investments, onDone }: { investments: InvestmentRow[]; onDone: Done }) {
  const f = useMoneyForm();
  const [picked, setPicked] = useState("");
  const investmentId = investments.some((m) => m.investment_id === picked) ? picked : investments[0].investment_id;
  return (
    <form
      className="card"
      id="decide-profit"
      aria-label="Decide profit"
      onSubmit={f.submit(async (paisa) => {
        await rpc("office_decide_profit", {
          p_client_id: f.clientId,
          p_investment_id: investmentId,
          p_amount_paisa: paisa,
          p_decided_on: f.on,
          p_note: f.note.trim() || null,
        });
        return `Profit of ${rupees(paisa)} decided.`;
      }, onDone)}
    >
      <h2>Decide profit</h2>
      <p className="muted">Type the amount the owner or manager decided. Nothing is worked out for you.</p>
      <InvestmentPicker prefix="decide" investments={investments} value={investmentId} onChange={setPicked} />
      <AmountDateNote prefix="decide" f={f} />
      <button type="submit" disabled={f.busy}>
        {f.busy ? "Saving…" : "Record decision"}
      </button>
    </form>
  );
}

function RecordPayout({ investments, onDone }: { investments: InvestmentRow[]; onDone: Done }) {
  const f = useMoneyForm();
  const [picked, setPicked] = useState("");
  const [kind, setKind] = useState<"profit" | "principal">("profit");
  const [method, setMethod] = useState<"cash" | "bank" | "other">("cash");
  const [reference, setReference] = useState("");
  const investmentId = investments.some((m) => m.investment_id === picked) ? picked : investments[0].investment_id;
  return (
    <form
      className="card"
      aria-label="Record a payout"
      onSubmit={f.submit(async (paisa) => {
        await rpc("office_record_payout", {
          p_client_id: f.clientId,
          p_investment_id: investmentId,
          p_kind: kind,
          p_method: method,
          p_amount_paisa: paisa,
          p_paid_on: f.on,
          p_reference: reference.trim() || null,
          p_note: f.note.trim() || null,
        });
        setReference("");
        return `${kind === "profit" ? "Profit" : "Principal"} payout of ${rupees(paisa)} recorded.`;
      }, onDone)}
    >
      <h2>Record a payout</h2>
      <p className="muted">Recorded here only: a payout is not posted to the office cash.</p>
      <InvestmentPicker prefix="pay" investments={investments} value={investmentId} onChange={setPicked} />
      <label htmlFor="pay-kind">Paid as</label>
      <select id="pay-kind" value={kind} onChange={(e) => setKind(e.target.value as "profit" | "principal")}>
        <option value="profit">Profit</option>
        <option value="principal">Principal returned</option>
      </select>
      <label htmlFor="pay-method">Method</label>
      <select id="pay-method" value={method} onChange={(e) => setMethod(e.target.value as "cash" | "bank" | "other")}>
        <option value="cash">Cash</option>
        <option value="bank">Bank</option>
        <option value="other">Other</option>
      </select>
      <label htmlFor="pay-ref">Reference{method === "bank" ? "" : " (optional)"}</label>
      <input
        id="pay-ref"
        value={reference}
        onChange={(e) => setReference(e.target.value)}
        maxLength={120}
        required={method === "bank"}
      />
      <AmountDateNote prefix="pay" f={f} />
      <button type="submit" disabled={f.busy}>
        {f.busy ? "Saving…" : "Record payout"}
      </button>
    </form>
  );
}

function Statement({
  investorId,
  version,
  canReverse,
  onDone,
}: {
  investorId: string;
  version: number;
  canReverse: boolean;
  onDone: Done;
}) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [range, setRange] = useState<{ from: string | null; to: string | null }>({ from: null, to: null });
  const [list, setList] = useState<StatementRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // version: reread after every write on the page.
    void version;
    const read = async () => {
      setLoading(true);
      setError(null);
      try {
        setList(
          (await rpc<StatementRow[]>("office_investor_statement", {
            p_investor_id: investorId,
            p_from: range.from,
            p_to: range.to,
          })) ?? [],
        );
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    };
    void read();
  }, [investorId, range, version]);

  return (
    <section className="card" aria-labelledby="st-h">
      <h2 id="st-h">Statement</h2>
      <form
        className="inline-form"
        aria-label="Statement dates"
        onSubmit={(e) => {
          e.preventDefault();
          setRange({ from: from || null, to: to || null });
        }}
      >
        <label>
          From
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From" />
        </label>
        <label>
          To
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To" />
        </label>
        <button type="submit" className="inline">
          Show
        </button>
      </form>
      <p className="muted">Balances after each row are worked out from the whole history, also when a date range is shown.</p>
      <ListState loading={loading} error={error} empty={list.length === 0} emptyText="Nothing recorded in these dates." />
      {!loading && !error && list.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Entry</th>
              <th>Amount</th>
              <th>Principal outstanding</th>
              <th>Profit owed</th>
              <th>By</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {list.map((e) => (
              <tr key={e.entry_id}>
                <td data-label="Date">{e.entry_on}</td>
                <td data-label="Entry">
                  {e.reverses_id ? `Reversal: ${entryText(e).toLowerCase()}` : entryText(e)}
                  {e.method && <span className="muted"> · {e.method}</span>}
                  {e.reference && <span className="muted"> · {e.reference}</span>}
                  {e.note && <span className="muted"> · {e.note}</span>}
                  {e.reason && <span className="muted"> · {e.reason}</span>}
                  {e.reversed && <span className="badge"> reversed</span>}
                </td>
                <td data-label="Amount">{rupees(e.amount_paisa)}</td>
                <td data-label="Principal outstanding">{rupees(e.principal_outstanding_paisa)}</td>
                <td data-label="Profit owed">{rupees(e.profit_owed_paisa)}</td>
                <td data-label="By">{e.recorded_by_name}</td>
                <td>{canReverse && !e.reversed && !e.reverses_id && <ReverseEntry entry={e} onDone={onDone} />}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function ReverseEntry({ entry, onDone }: { entry: StatementRow; onDone: Done }) {
  // One key per reversal attempt; a retry after a lost answer is the same reversal (H-08).
  const [clientId, setClientId] = useState(() => crypto.randomUUID());
  return (
    <ConfirmAction
      label="Reverse"
      confirmLabel="Reverse entry"
      reasonLabel="Why reverse"
      reasonMinLength={REVERSAL_REASON_MIN_LENGTH}
      danger
      onConfirm={async (reason) => {
        await rpc("office_reverse_investor_entry", {
          p_client_id: clientId,
          p_entry_kind: entry.entry_kind,
          p_entry_id: entry.entry_id,
          p_reason: reason,
        });
        setClientId(crypto.randomUUID());
        await onDone(`${entryText(entry)} of ${rupees(entry.amount_paisa)} reversed.`);
      }}
    />
  );
}

function EditInvestor({ investor, onDone }: { investor: Investor; onDone: Done }) {
  const [name, setName] = useState(investor.full_name);
  const [phone, setPhone] = useState(investor.phone ?? "");
  const [note, setNote] = useState(investor.note ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (status: "active" | "closed", message: string) => {
    setBusy(true);
    setError(null);
    try {
      await rpc("office_update_investor", {
        p_investor_id: investor.id,
        p_full_name: name,
        p_phone: phone.trim() || null,
        p_note: note.trim() || null,
        p_status: status,
      });
      await onDone(message);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="card"
      aria-label="Investor details"
      onSubmit={async (e) => {
        e.preventDefault();
        await save(investor.status, "Details saved.");
      }}
    >
      <h2>Details</h2>
      <label htmlFor="ed-name">Name</label>
      <input id="ed-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required />
      <label htmlFor="ed-phone">Phone (optional)</label>
      <input id="ed-phone" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={16} />
      <label htmlFor="ed-note">Note (optional)</label>
      <input id="ed-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="row">
        <button type="submit" disabled={busy}>
          {busy ? "Saving…" : "Save details"}
        </button>
        {investor.status === "active" ? (
          <button type="button" className="inline danger" disabled={busy} onClick={() => save("closed", "Investor closed.")}>
            Close investor
          </button>
        ) : (
          <button type="button" className="inline" disabled={busy} onClick={() => save("active", "Investor reopened.")}>
            Reopen investor
          </button>
        )}
      </div>
      <p className="muted">Closing needs nothing outstanding: all principal returned and all decided profit paid.</p>
    </form>
  );
}
