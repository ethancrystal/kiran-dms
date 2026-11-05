"use client";
import { useCallback, useEffect, useState } from "react";
import { ConfirmAction } from "@/components/confirm-action";
import { rupees, rupeesInput, toPaisa } from "@/lib/money";
import { when } from "@/lib/overview";
import { db, mySession, type Role, rows, rpc } from "@/lib/rpc";

/** The plans of public.plan_code; the database orders them CASH < INST2 < INST4. */
export const PLAN_NAMES: Record<string, string> = {
  CASH: "Cash only",
  INST2: "Up to 2 installments",
  INST4: "Up to 4 installments",
};
const PLAN_CODES = Object.keys(PLAN_NAMES);
const REASON_MIN = 3; // app.assert_reason
const AMOUNT_MAX_CHARS = 12; // rupees as typed (lib/money.ts toPaisa)
const HISTORY = 10;

type Status = {
  plan_eligibility: string;
  credit_limit_paisa: number;
  exposure_paisa: number;
  available_paisa: number;
  blocked: boolean;
};
type CreditRow = { plan_eligibility: string; credit_limit_paisa: number; blocked: boolean };
type Event = {
  kind: string;
  new_plan: string | null;
  new_limit_paisa: number | null;
  new_blocked: boolean | null;
  reason: string;
  actor_role: string | null;
  created_at: string;
};
type Config = { key: string; value: unknown };

const EVENT_TEXT: Record<string, string> = {
  owner_set: "Set by the owner",
  manager_raise: "Limit raised by a manager",
  block: "Blocked",
  unblock: "Unblocked",
  order_override: "Order released",
};

const KEY_PCT = "credit.manager_override.max_increase_pct";
const KEY_TIMES = "credit.manager_override.max_per_salon_month";

// H3, FLOW-02, FLOW-17 (P1-30): a salon's credit, for the office. The figures come from
// app.salon_credit_status (plan, limit, what the salon owes or has on order, what is left) and the
// salon_credit row itself (office RLS), which tells "never set" apart from "limit 0". The owner sets
// the plan and limit (app.owner_set_credit); the owner or a manager raises an existing limit
// (app.office_raise_limit) and blocks or unblocks credit (app.office_set_blocked). A manager's raise and
// unblock are held to the owner's limits in app_config (CTL-08); the database refuses past them.
export function SalonCredit({ salonId, stageBlocked }: { salonId: string; stageBlocked: boolean }) {
  const [role, setRole] = useState<Role | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [row, setRow] = useState<CreditRow | null>(null);
  const [events, setEvents] = useState<Event[]>([]);
  const [rules, setRules] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [s, st, r, e, c] = await Promise.all([
        mySession(),
        rpc<Status[]>("salon_credit_status", { p_salon_id: salonId }),
        rows<CreditRow>(
          db().from("salon_credit").select("plan_eligibility, credit_limit_paisa, blocked").eq("salon_id", salonId),
        ),
        rows<Event>(
          db()
            .from("credit_event")
            .select("kind, new_plan, new_limit_paisa, new_blocked, reason, actor_role, created_at")
            .eq("salon_id", salonId)
            .order("created_at", { ascending: false })
            .limit(HISTORY),
        ),
        rows<Config>(db().from("app_config").select("key, value").in("key", [KEY_PCT, KEY_TIMES])),
      ]);
      setRole(s?.role ?? null);
      setStatus(st?.[0] ?? null);
      setRow(r[0] ?? null);
      setEvents(e);
      setRules(Object.fromEntries(c.map((x) => [x.key, x.value])));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [salonId]);
  useEffect(() => {
    void load();
  }, [load]);

  const done = async (m: string) => {
    setNotice(m);
    await load();
  };

  const pct = rules[KEY_PCT];
  const times = rules[KEY_TIMES];

  return (
    <section className="card" aria-labelledby="credit-h">
      <h2 id="credit-h">Credit</h2>
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
      {notice && <output className="ok">{notice}</output>}
      {status && (
        <dl className="facts" data-testid="credit-status">
          <dt>Plan allowed</dt>
          <dd data-testid="credit-plan">{PLAN_NAMES[status.plan_eligibility] ?? status.plan_eligibility}</dd>
          <dt>Credit limit</dt>
          <dd data-testid="credit-limit">{row ? rupees(Number(status.credit_limit_paisa)) : "Not set yet"}</dd>
          <dt>Owed and on order</dt>
          <dd>{rupees(Number(status.exposure_paisa))}</dd>
          <dt>Still available</dt>
          <dd>{rupees(Number(status.available_paisa))}</dd>
          <dt>Credit block</dt>
          <dd data-testid="credit-block">{row?.blocked ? "Blocked" : "Not blocked"}</dd>
        </dl>
      )}
      {stageBlocked && (
        <p className="error">
          This salon&apos;s stage is Blocked, which also blocks its credit. Change the stage below to lift that block.
        </p>
      )}
      <p className="muted">
        Installment orders are checked against the plan and the limit; cash orders are not. An order that does not fit waits on
        hold.
      </p>

      {role === "owner" && <OwnerSet key={JSON.stringify(row)} salonId={salonId} row={row} onDone={done} />}

      {role && row && (
        <RaiseLimit salonId={salonId} current={Number(row.credit_limit_paisa)} manager={role === "manager"} onDone={done} />
      )}
      {role === "manager" && !row && <p className="muted">The owner sets this salon&apos;s first plan and limit.</p>}
      {role === "manager" && (
        <p className="muted" data-testid="credit-manager-rules">
          As a manager you may raise a limit by at most {typeof pct === "number" ? `${pct}%` : "the owner's set share"} and raise
          or unblock at most {typeof times === "number" ? `${times} times` : "the owner's set number of times"} per salon each
          month. The database refuses beyond that; the owner can always do it.
        </p>
      )}

      {role && (
        <div className="row">
          {row?.blocked ? (
            <ConfirmAction
              label="Unblock credit"
              confirmLabel="Unblock now"
              reasonLabel="Why unblock credit"
              reasonMinLength={REASON_MIN}
              onConfirm={async (reason) => {
                await rpc("office_set_blocked", { p_salon_id: salonId, p_blocked: false, p_reason: reason });
                await done("Credit unblocked.");
              }}
            />
          ) : (
            <ConfirmAction
              label="Block credit"
              confirmLabel="Block now"
              reasonLabel="Why block credit"
              reasonMinLength={REASON_MIN}
              danger
              onConfirm={async (reason) => {
                await rpc("office_set_blocked", { p_salon_id: salonId, p_blocked: true, p_reason: reason });
                await done("Credit blocked: new installment orders wait on hold.");
              }}
            />
          )}
        </div>
      )}

      <h3>Credit history</h3>
      {events.length === 0 ? (
        <p className="muted">No credit changes recorded.</p>
      ) : (
        <ul className="plain" data-testid="credit-history">
          {events.map((e) => (
            <li key={`${e.created_at}-${e.kind}`}>
              <strong>{EVENT_TEXT[e.kind] ?? e.kind}</strong> {when(e.created_at)}
              {e.new_plan && <> · {PLAN_NAMES[e.new_plan] ?? e.new_plan}</>}
              {e.new_limit_paisa !== null && <> · limit {rupees(Number(e.new_limit_paisa))}</>}
              {e.actor_role && <span className="muted"> · {e.actor_role}</span>}
              <span className="muted"> · {e.reason}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function OwnerSet({ salonId, row, onDone }: { salonId: string; row: CreditRow | null; onDone: (m: string) => Promise<void> }) {
  const [plan, setPlan] = useState(row?.plan_eligibility ?? "CASH");
  const [limit, setLimit] = useState(row ? rupeesInput(row.credit_limit_paisa) : "");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        const paisa = toPaisa(limit);
        if (paisa === null) return setError("Enter the limit in rupees, for example 50000 or 0.");
        setBusy(true);
        try {
          await rpc("owner_set_credit", { p_salon_id: salonId, p_plan: plan, p_limit_paisa: paisa, p_reason: reason.trim() });
          setReason("");
          await onDone(`Credit set: ${PLAN_NAMES[plan]}, limit ${rupees(paisa)}.`);
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <h3>Set plan and limit (owner)</h3>
      <label htmlFor="credit-set-plan">Plan the salon may use</label>
      <select id="credit-set-plan" value={plan} onChange={(e) => setPlan(e.target.value)}>
        {PLAN_CODES.map((p) => (
          <option key={p} value={p}>
            {PLAN_NAMES[p]}
          </option>
        ))}
      </select>
      <label htmlFor="credit-set-limit">Credit limit to set (Rs)</label>
      <input
        id="credit-set-limit"
        inputMode="decimal"
        value={limit}
        onChange={(e) => setLimit(e.target.value)}
        maxLength={AMOUNT_MAX_CHARS}
        required
      />
      <label htmlFor="credit-set-reason">Why this plan and limit</label>
      <input
        id="credit-set-reason"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        minLength={REASON_MIN}
        maxLength={300}
        required
      />
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" disabled={busy}>
        {busy ? "Saving…" : "Save plan and limit"}
      </button>
    </form>
  );
}

function RaiseLimit({
  salonId,
  current,
  manager,
  onDone,
}: {
  salonId: string;
  current: number;
  manager: boolean;
  onDone: (m: string) => Promise<void>;
}) {
  const [limit, setLimit] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        const paisa = toPaisa(limit);
        if (paisa === null) return setError("Enter the new limit in rupees, for example 75000.");
        setBusy(true);
        try {
          await rpc("office_raise_limit", { p_salon_id: salonId, p_new_limit_paisa: paisa, p_reason: reason.trim() });
          setLimit("");
          setReason("");
          await onDone(`Limit raised to ${rupees(paisa)}.`);
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <h3>Raise the limit{manager ? "" : " (any amount)"}</h3>
      <p className="muted">Now {rupees(current)}. Lowering a limit is the owner&apos;s, with Set plan and limit.</p>
      <label htmlFor="credit-raise-limit">Raised limit (Rs)</label>
      <input
        id="credit-raise-limit"
        inputMode="decimal"
        value={limit}
        onChange={(e) => setLimit(e.target.value)}
        maxLength={AMOUNT_MAX_CHARS}
        required
      />
      <label htmlFor="credit-raise-reason">Why raise the limit</label>
      <input
        id="credit-raise-reason"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        minLength={REASON_MIN}
        maxLength={300}
        required
      />
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" disabled={busy}>
        {busy ? "Saving…" : "Raise limit"}
      </button>
    </form>
  );
}
