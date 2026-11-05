// The basic investor ledger (D-40, CAP-01 to CAP-03) on the office pages. Every figure comes from
// the database's app.office_investor* functions, which derive it from the ledger rows; the pages add
// nothing up themselves.

/** The six derived figures, in paisa, for an investor, an investment or the totals row. */
export type Figures = {
  invested_paisa: number;
  principal_returned_paisa: number;
  principal_outstanding_paisa: number;
  profit_decided_paisa: number;
  profit_paid_paisa: number;
  profit_owed_paisa: number;
};

export type InvestorRow = Figures & {
  investor_id: string | null;
  full_name: string | null;
  phone: string | null;
  status: "active" | "closed" | null;
  is_total: boolean;
};

export type InvestmentRow = Figures & {
  investment_id: string;
  invested_on: string;
  note: string | null;
  recorded_at: string;
  reversed: boolean;
};

export type EntryKind = "investment" | "profit_decision" | "payout";

export type StatementRow = {
  entry_kind: EntryKind;
  entry_id: string;
  investment_id: string;
  entry_on: string;
  payout_kind: "profit" | "principal" | null;
  method: "cash" | "bank" | "other" | null;
  reference: string | null;
  amount_paisa: number;
  note: string | null;
  reason: string | null;
  reverses_id: string | null;
  reversed: boolean;
  recorded_by_name: string | null;
  recorded_at: string;
  principal_outstanding_paisa: number;
  profit_owed_paisa: number;
};

/** The shortest reversal reason app.office_reverse_investor_entry accepts (5 to 300 characters). */
export const REVERSAL_REASON_MIN_LENGTH = 5;

/** The plain note shown on both investor pages (D-40). */
export const LEDGER_NOTE =
  "Amounts here are decided and typed by the owner or manager. Nothing is calculated: no formula, no split, no promised return. Nothing here is posted to cash, receivables, sales or commission.";

/** Today's date in Karachi as YYYY-MM-DD, the database's day for "not in the future". */
export const karachiToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Karachi" });
