"use client";
import { useCallback, useEffect, useState } from "react";
import { ListState } from "@/components/confirm-action";
import { rupees, rupeesInput, toPaisa } from "@/lib/money";
import { when } from "@/lib/overview";
import { db, mySession, type Role, rows, rpc } from "@/lib/rpc";

type ConfigRow = { key: string; value: unknown; note: string | null; updated_at: string };
type Bank = Record<string, string>;
type Done = (message: string) => Promise<void>;

const REASON_MIN = 3; // app.owner_set_config: a reason of at least 3 characters
const PROFILE = "company.profile";
const BANKS = "company.bank_accounts";
// Kept read-only here: their shape is checked by the functions that read them (plan_schedule, the credit
// rules, the product groups), and a typing slip would stop invoices or orders. Changed in the database.
const READ_ONLY = ["plan.templates", "credit.rules", "catalogue.product_groups"];

const PROFILE_LABELS: Record<string, string> = {
  name_en: "Company name (printed on invoices and receipts)",
  name_ur: "Company name in Urdu script (printed as typed)",
  city: "Company city",
};
const BANK_FIELDS: Array<[string, string]> = [
  ["bank", "Bank"],
  ["account_title", "Account title"],
  ["account_no", "Account number"],
];
const KEY_LABELS: Record<string, string> = {
  "cash.intraday_cap_paisa": "Cash a rep may hold before a handover",
  "approval.discount.owner_above": "Discounts the owner must approve",
  "approval.stock_adjustment.owner_above": "Stock adjustments the owner must approve",
  "credit.manager_override.max_increase_pct": "Most a manager may raise a credit limit (%)",
  "credit.manager_override.max_per_salon_month": "Manager raises or unblocks per salon each month",
  "payment.geofence_m": "Distance from the salon pin before a payment is flagged (metres)",
  "payment.max_minutes_after_arrival": "Minutes after arriving before a payment is flagged",
};
// Review of P1-30: seeded keys that no database function reads yet (checked by searching the migrations).
// Shown read-only, so a saved figure never looks like a control that is in force. A payment reversal has
// no amount limit (D-48 names who may reverse; whether doc 13's threshold applies is a question for MJ).
const NOT_USED: Record<string, string> = {
  "approval.payment_reversal.owner_above_paisa": "Payment reversal amount",
  "approval.credit_note.owner_above_paisa": "Credit note amount",
  "approval.restructure.owner_above_paisa": "Restructure amount",
  "approval.purchase_order.owner_above_paisa": "Purchase order amount",
  "approval.petty_expense.owner_above_paisa": "Petty expense amount",
  "office_cash.max_age_working_days": "Working days office cash may wait before deposit",
  "transfer.match_within_working_days": "Working days to match a bank transfer",
};
// Parts of a threshold object: "paisa" is money, the others plain numbers.
const PART_LABELS: Record<string, string> = { paisa: "amount (Rs)", pct: "percent", units: "units" };
// A share as typed: "10", "2.5" and "0" match; "-1", "1,000" and "1.234" do not.
// https://regex101.com/?regex=%5E%5Cd%7B1%2C9%7D%28%5C.%5Cd%7B1%2C2%7D%29%3F%24&flavor=javascript
const DECIMAL = /^\d{1,9}(\.\d{1,2})?$/;
// A count as typed (units, days, minutes, metres, times): "10" and "0" match; "10.5", "-1" and "1,000" do not.
// https://regex101.com/?regex=%5E%5Cd%7B1%2C9%7D%24&flavor=javascript
const WHOLE = /^\d{1,9}$/;
const REMINDER_NUMBERS: Array<[string, string]> = [
  ["reminders.interval_minutes", "Interval minutes"],
  ["reminders.hours_start", "First hour"],
  ["reminders.hours_end", "Last hour (not included)"],
  ["reminders.owner_after_hours", "Tell the owner after (hours)"],
];
const REMINDER_KINDS: Array<[string, string]> = [
  ["reminders.on.discount", "Discount approvals"],
  ["reminders.on.adjustment", "Stock adjustments"],
  ["reminders.on.delivery", "Deliveries waiting for approval"],
  ["reminders.on.stock", "Rejected goods still unsettled"],
  ["reminders.on.salon", "Salon proposals"],
];
const reminderLabel = (key: string) =>
  REMINDER_NUMBERS.find(([k]) => k === key)?.[1] ?? REMINDER_KINDS.find(([k]) => k === key)?.[1] ?? key;

const isMoney = (key: string) => key.endsWith("_paisa") || key === "paisa";
const isPercent = (key: string) => key.endsWith("_pct") || key === "pct";
const show = (key: string, v: number) => (isMoney(key) ? rupees(v) : String(v));
const asInput = (key: string, v: number) => (isMoney(key) ? rupeesInput(v) : String(v));
/** The typed text as the JSON number the database expects (paisa for money), or null. */
function parse(key: string, text: string): number | null {
  if (isMoney(key)) return toPaisa(text);
  // Only a percentage may have decimals; every other number here counts something whole.
  const shape = isPercent(key) ? DECIMAL : WHOLE;
  return shape.test(text.trim()) ? Number(text.trim()) : null;
}
const isNumberObject = (v: unknown): v is Record<string, number> =>
  typeof v === "object" && v !== null && !Array.isArray(v) && Object.values(v).every((x) => typeof x === "number");

// FLOW-14 (P1-30): the owner's settings. Every value is read from public.app_config (office RLS) and
// written with app.owner_set_config, which refuses anyone but the owner at AAL2 and keeps the reason in
// the audit log. Only keys that already exist are offered, numbers are sent as JSON numbers (a text would
// make the database fail closed), and the company profile is merged so fields not shown here are kept.
export default function Settings() {
  const [role, setRole] = useState<Role | null>(null);
  const [config, setConfig] = useState<ConfigRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [s, c] = await Promise.all([
        mySession(),
        rows<ConfigRow>(db().from("app_config").select("key, value, note, updated_at").order("key")),
      ]);
      setRole(s?.role ?? null);
      setConfig(c);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const done: Done = async (m) => {
    setNotice(m);
    await load();
  };
  const row = (k: string) => config.find((c) => c.key === k);
  const profile = row(PROFILE);
  const banks = row(BANKS);
  const numeric = config.filter(
    (c) =>
      !c.key.startsWith("reminders.") &&
      !READ_ONLY.includes(c.key) &&
      !(c.key in NOT_USED) &&
      (typeof c.value === "number" || isNumberObject(c.value)),
  );
  const reminderNumbers = REMINDER_NUMBERS.flatMap(([key]) => {
    const found = row(key);
    return found && typeof found.value === "number" ? [found] : [];
  });
  const reminderKinds = REMINDER_KINDS.flatMap(([key]) => {
    const found = row(key);
    return found && typeof found.value === "boolean" ? [found] : [];
  });
  const showReminders = reminderNumbers.length === REMINDER_NUMBERS.length && reminderKinds.length === REMINDER_KINDS.length;
  const unused = config.filter((c) => c.key in NOT_USED);

  return (
    <>
      <h1>Settings</h1>
      <ListState loading={loading} error={error} empty={false} emptyText="" />
      {/* Only when the session was read: a failed load shows its error, not a refusal. */}
      {!loading && !error && role !== null && role !== "owner" && (
        <p className="error" role="alert">
          Only the owner changes settings.
        </p>
      )}
      {notice && <output className="ok">{notice}</output>}
      {!loading && role === "owner" && (
        <>
          <p className="muted">Each change needs a reason and is kept in the audit log.</p>
          {profile && <ProfileForm key={profile.updated_at} row={profile} onDone={done} />}
          {banks && <BankForm key={banks.updated_at} row={banks} onDone={done} />}
          {showReminders && (
            <RemindersForm
              key={reminderNumbers.map((c) => c.updated_at).join("|")}
              numbers={reminderNumbers}
              kinds={reminderKinds}
              onDone={done}
            />
          )}
          <section aria-labelledby="limits-h">
            <h2 id="limits-h">Limits and thresholds</h2>
            {numeric.map((c) => (
              <NumberSetting key={`${c.key}-${c.updated_at}`} row={c} onDone={done} />
            ))}
          </section>
          {unused.length > 0 && (
            <section aria-labelledby="unused-h">
              <h2 id="unused-h">Not used yet</h2>
              <p className="muted">
                These figures are stored, but nothing in the system checks them yet, so they cannot be changed here.
              </p>
              <ul className="plain">
                {unused.map((c) => (
                  <li key={c.key} data-testid={`unused-${c.key}`}>
                    {NOT_USED[c.key]}: {typeof c.value === "number" ? show(c.key, c.value) : "—"}
                  </li>
                ))}
              </ul>
            </section>
          )}
          <section aria-labelledby="fixed-h">
            <h2 id="fixed-h">Not changed here</h2>
            <p className="muted">
              Installment plans, credit rules and product groups are checked by the database when they are used, so they are not
              typed here.
            </p>
            <ul className="plain">
              {READ_ONLY.filter((k) => row(k)).map((k) => (
                <li key={k}>
                  <code>{k}</code>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </>
  );
}

function Reason({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  return (
    <>
      <label htmlFor={id}>Why change it</label>
      <input id={id} value={value} onChange={(e) => onChange(e.target.value)} minLength={REASON_MIN} maxLength={300} required />
    </>
  );
}

function Saved({ row }: { row: ConfigRow }) {
  return (
    // The note column holds seeding remarks for developers, so it is not shown; the reason is in the audit log.
    <p className="muted">Last changed {when(row.updated_at)}</p>
  );
}

function useSave(onDone: Done) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async (key: string, value: unknown, reason: string, message: string) => {
    setBusy(true);
    setError(null);
    try {
      await rpc("owner_set_config", { p_key: key, p_value: value, p_reason: reason.trim(), p_rep_visible: null });
      await onDone(message);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, setError, save };
}

function FormError({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p className="error" role="alert">
      {error}
    </p>
  );
}

function ProfileForm({ row, onDone }: { row: ConfigRow; onDone: Done }) {
  const base = (typeof row.value === "object" && row.value !== null ? row.value : {}) as Record<string, unknown>;
  const fields = Object.keys(base).filter((k) => typeof base[k] === "string");
  const [form, setForm] = useState<Record<string, string>>(() => Object.fromEntries(fields.map((k) => [k, String(base[k])])));
  const [reason, setReason] = useState("");
  const { busy, error, setError, save } = useSave(onDone);
  return (
    <form
      className="card"
      aria-labelledby="profile-h"
      onSubmit={(e) => {
        e.preventDefault();
        if (fields.some((k) => form[k].trim() === "")) return setError("Fill in every field.");
        const trimmed = Object.fromEntries(fields.map((k) => [k, form[k].trim()]));
        void save(PROFILE, { ...base, ...trimmed }, reason, "Company details saved.");
      }}
    >
      <h2 id="profile-h">Company details</h2>
      <Saved row={row} />
      {fields.map((k) => (
        <div key={k}>
          <label htmlFor={`profile-${k}`}>{PROFILE_LABELS[k] ?? k}</label>
          <input
            id={`profile-${k}`}
            value={form[k]}
            onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))}
            maxLength={200}
            required
          />
        </div>
      ))}
      <Reason id="profile-reason" value={reason} onChange={setReason} />
      <FormError error={error} />
      <button type="submit" disabled={busy}>
        {busy ? "Saving…" : "Save company details"}
      </button>
    </form>
  );
}

function BankForm({ row, onDone }: { row: ConfigRow; onDone: Done }) {
  const start = (Array.isArray(row.value) ? row.value : []) as Bank[];
  const blank = (): Bank => Object.fromEntries(BANK_FIELDS.map(([k]) => [k, ""]));
  const [accounts, setAccounts] = useState<Bank[]>(() =>
    start.map((a) => ({ ...blank(), ...Object.fromEntries(Object.entries(a).map(([k, v]) => [k, String(v)])) })),
  );
  const [reason, setReason] = useState("");
  const { busy, error, setError, save } = useSave(onDone);
  const set = (i: number, k: string, v: string) => setAccounts((list) => list.map((a, j) => (j === i ? { ...a, [k]: v } : a)));
  return (
    <form
      className="card"
      aria-labelledby="banks-h"
      onSubmit={(e) => {
        e.preventDefault();
        if (accounts.length === 0) return setError("Keep at least one account: invoices print it for payment.");
        if (accounts.some((a) => BANK_FIELDS.some(([k]) => (a[k] ?? "").trim() === "")))
          return setError("Fill in every field of every account, or remove the account.");
        const clean = accounts.map((a) => Object.fromEntries(Object.entries(a).map(([k, v]) => [k, v.trim()])));
        void save(BANKS, clean, reason, "Bank accounts saved.");
      }}
    >
      <h2 id="banks-h">Bank accounts printed on invoices</h2>
      <Saved row={row} />
      {accounts.map((a, i) => (
        <fieldset key={`account-${i + 1}`}>
          <legend>Account {i + 1}</legend>
          {BANK_FIELDS.map(([k, text]) => (
            <div key={k}>
              <label htmlFor={`bank-${i}-${k}`}>
                {text} of account {i + 1}
              </label>
              <input id={`bank-${i}-${k}`} value={a[k] ?? ""} onChange={(e) => set(i, k, e.target.value)} maxLength={120} />
            </div>
          ))}
          <button type="button" className="inline link" onClick={() => setAccounts((list) => list.filter((_, j) => j !== i))}>
            Remove account {i + 1}
          </button>
        </fieldset>
      ))}
      <button type="button" className="inline" onClick={() => setAccounts((list) => [...list, blank()])}>
        Add an account
      </button>
      <Reason id="banks-reason" value={reason} onChange={setReason} />
      <FormError error={error} />
      <button type="submit" disabled={busy}>
        {busy ? "Saving…" : "Save bank accounts"}
      </button>
    </form>
  );
}

function RemindersForm({ numbers, kinds, onDone }: { numbers: ConfigRow[]; kinds: ConfigRow[]; onDone: Done }) {
  const [form, setForm] = useState<Record<string, string>>(() =>
    Object.fromEntries(numbers.map((c) => [c.key, String(c.value)])),
  );
  const [flags, setFlags] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(kinds.map((c) => [c.key, c.value === true])),
  );
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="card"
      aria-labelledby="reminders-h"
      data-testid="reminders-form"
      onSubmit={(e) => {
        e.preventDefault();
        const parsed = numbers.map(
          (c) => [c.key, WHOLE.test(form[c.key]?.trim() ?? "") ? Number(form[c.key].trim()) : null] as const,
        );
        if (parsed.some(([, value]) => value === null)) return setError("Enter whole numbers for the reminder times.");
        if (reason.trim().length < REASON_MIN) return setError("A reason needs at least 3 characters.");
        const writes: Array<[string, number | boolean]> = [
          ...parsed.map(([key, value]) => [key, value as number] as [string, number]),
          ...kinds.map((c) => [c.key, flags[c.key] === true] as [string, boolean]),
        ];
        void (async () => {
          setBusy(true);
          setError(null);
          try {
            for (const [key, value] of writes) {
              await rpc("owner_set_config", { p_key: key, p_value: value, p_reason: reason.trim(), p_rep_visible: null });
            }
            await onDone("Reminders: saved.");
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        })();
      }}
    >
      <h2 id="reminders-h">Reminders</h2>
      <p className="muted">
        Reminders go out only when the first hour is before the last hour, on the Asia/Karachi clock. Nothing is e-mailed until a
        mail service is named.
      </p>
      {numbers.map((c) => (
        <div key={c.key}>
          <label htmlFor={`reminder-${c.key}`}>{reminderLabel(c.key)}</label>
          <input
            id={`reminder-${c.key}`}
            inputMode="numeric"
            value={form[c.key] ?? ""}
            onChange={(e) => setForm((current) => ({ ...current, [c.key]: e.target.value }))}
            required
          />
        </div>
      ))}
      <fieldset>
        <legend>What to remind about</legend>
        {kinds.map((c) => (
          <div key={c.key}>
            <label htmlFor={`reminder-${c.key}`}>
              <input
                id={`reminder-${c.key}`}
                type="checkbox"
                checked={flags[c.key] === true}
                onChange={(e) => setFlags((current) => ({ ...current, [c.key]: e.target.checked }))}
              />{" "}
              {reminderLabel(c.key)}
            </label>
          </div>
        ))}
      </fieldset>
      <Reason id="reminders-reason" value={reason} onChange={setReason} />
      <FormError error={error} />
      <button type="submit" disabled={busy}>
        {busy ? "Saving…" : "Save reminders"}
      </button>
    </form>
  );
}

function NumberSetting({ row, onDone }: { row: ConfigRow; onDone: Done }) {
  const parts: Array<[string, number]> =
    typeof row.value === "number" ? [[row.key, row.value]] : Object.entries(row.value as Record<string, number>);
  const [form, setForm] = useState<Record<string, string>>(() => Object.fromEntries(parts.map(([k, v]) => [k, asInput(k, v)])));
  const [reason, setReason] = useState("");
  const { busy, error, setError, save } = useSave(onDone);
  const title = KEY_LABELS[row.key] ?? row.key;
  return (
    <form
      className="card"
      aria-label={title}
      data-testid={`setting-${row.key}`}
      onSubmit={(e) => {
        e.preventDefault();
        const values = parts.map(([k]) => [k, parse(k, form[k])] as const);
        if (values.some(([, v]) => v === null))
          return setError("Enter plain numbers: rupees or a percentage may have two decimals; counts are whole numbers.");
        const value = typeof row.value === "number" ? values[0][1] : Object.fromEntries(values);
        void save(row.key, value, reason, `${title}: saved.`);
      }}
    >
      <h3>{title}</h3>
      <p className="muted">
        Now{" "}
        {parts.map(([k, v]) => (typeof row.value === "number" ? show(k, v) : `${PART_LABELS[k] ?? k} ${show(k, v)}`)).join(", ")}
      </p>
      <Saved row={row} />
      {parts.map(([k]) => (
        <div key={k}>
          <label htmlFor={`setting-${row.key}-${k}`}>
            {typeof row.value === "number" ? `New value for ${title}` : `New ${PART_LABELS[k] ?? k} for ${title}`}
            {isMoney(k) && typeof row.value === "number" ? " (Rs)" : ""}
          </label>
          <input
            id={`setting-${row.key}-${k}`}
            inputMode="decimal"
            value={form[k]}
            onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))}
            required
          />
        </div>
      ))}
      <Reason id={`setting-${row.key}-reason`} value={reason} onChange={setReason} />
      <FormError error={error} />
      <button type="submit" disabled={busy}>
        {busy ? "Saving…" : "Save"}
      </button>
    </form>
  );
}
