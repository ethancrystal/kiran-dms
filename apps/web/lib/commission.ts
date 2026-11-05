// Commission statements (D-38, migration 20261105140000): the shape app.my_commission and
// app.office_commission return. Every figure is the database's; pages only show it.

export type CommissionInvoice = {
  invoice_id: string;
  number: string;
  issued_at: string;
  salon_name: string | null;
  total_paisa: number;
  rate_bp: number;
  commission_paisa: number;
};

export type CommissionPayment = {
  payment_id: string;
  kind: "payment" | "reversal";
  amount_paisa: number;
  note: string | null;
  reason: string | null;
  reverses_id: string | null;
  reversed: boolean;
  recorded_at: string;
  recorded_by_name: string;
};

export type CommissionStatement = {
  rep_id: string;
  from: string;
  to: string;
  default_rate_bp: number | null;
  earned_paisa: number;
  paid_paisa: number;
  earned_to_date_paisa: number;
  paid_to_date_paisa: number;
  owed_paisa: number;
  invoice_count: number;
  invoices: CommissionInvoice[];
  payments: CommissionPayment[];
  salon_rates: Array<{ salon_id: string; salon_name: string | null; rate_bp: number | null }>;
};

const KARACHI = "Asia/Karachi";
const FIRST_DAY = "01";

/** Today's date in Karachi as YYYY-MM-DD (the database's dates are Karachi dates). */
export const karachiToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: KARACHI }).format(new Date());

/** The first day of the Karachi month that holds `day` (YYYY-MM-DD). */
export const monthStart = (day: string) => `${day.slice(0, "YYYY-MM-".length)}${FIRST_DAY}`;

export const when = (t: string) =>
  new Date(t).toLocaleString("en-PK", { dateStyle: "medium", timeStyle: "short", timeZone: KARACHI });
