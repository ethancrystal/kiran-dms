// The overview pages of slice 9 (P1-26, migration 20261105180000): the office home, the investors'
// "This month" block, the rep's month and the office's rep performance. Every figure comes from the
// database's app.* reads; this file only names the rows and turns codes into plain words.

const KARACHI = "Asia/Karachi";
const FIRST_DAY = "-01";
const MONTH_PART = "YYYY-MM".length;
const MONTHS_IN_YEAR = 12;
const MONTH_DIGITS = 2;

/** Today's date in Karachi as YYYY-MM-DD (the database's dates are Karachi dates). */
export const karachiToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: KARACHI }).format(new Date());

/** The first day of the month that holds `day` (YYYY-MM-DD → YYYY-MM-01). */
export const monthOf = (day: string) => `${day.slice(0, MONTH_PART)}${FIRST_DAY}`;

/** The current Karachi month, as YYYY-MM-01. */
export const thisMonth = () => monthOf(karachiToday());

/** A month moved by `by` months (YYYY-MM-01). Calendar arithmetic only; no figure is worked out here. */
export function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split("-").map(Number);
  const index = y * MONTHS_IN_YEAR + (m - 1) + by;
  const year = Math.floor(index / MONTHS_IN_YEAR);
  const mm = String((index % MONTHS_IN_YEAR) + 1).padStart(MONTH_DIGITS, "0");
  return `${year}-${mm}${FIRST_DAY}`;
}

/** "2026-11-01" → "November 2026". */
export const monthName = (month: string) =>
  new Date(`${month}T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

/** A database time as a short Karachi date and time. */
export const when = (t: string) =>
  new Date(t).toLocaleString("en-PK", { dateStyle: "medium", timeStyle: "short", timeZone: KARACHI });

/** A database date (YYYY-MM-DD) as a short date. */
export const day = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

// ------------------------------------------------------------------ office home ----
export type OverviewCounts = {
  week_start: string;
  placed_this_week: number;
  to_deliver: number;
  waiting_approval: number;
  held_orders: number;
  pending_salons: number;
  pending_requests: number;
  delivered_this_week: number;
  /** P1-30: reps whose cash in hand is at or over the cap (D-47), and handovers waiting (D-46). */
  reps_at_cash_cap: number;
  handovers_unanswered: number;
  handovers_disputed: number;
};

/** One row of app.office_cash_cap_reps (D-47). */
export type CashCapRep = { rep_id: string; full_name: string; cash_paisa: number; cap_paisa: number };

export type OverviewSection = "placed" | "waiting" | "held" | "delivered";

export type OverviewRow = {
  section: OverviewSection;
  order_id: string;
  salon_id: string;
  salon_name: string;
  placed_by_kind: "salon" | "rep" | "office";
  placed_by_name: string | null;
  status: string;
  total_paisa: number;
  placed_at: string;
  confirmed_at: string | null;
  waiting_days: number | null;
  deliverer_kind: "rep" | "office";
  deliverer_name: string | null;
  waiting_approval: boolean;
  hold_reason: string | null;
  invoice_id: string | null;
  invoice_number: string | null;
  invoice_total_paisa: number | null;
  delivered_at: string | null;
  delivered_by_name: string | null;
  /** P1-30 (FLOW-09): what of the order is still to deliver, at its own prices; null on invoice rows. */
  undelivered_paisa: number | null;
};

/** Who placed an order, in a few plain words. */
export function placedBy(r: Pick<OverviewRow, "placed_by_kind" | "placed_by_name">): string {
  if (r.placed_by_kind === "salon") return "Salon request";
  if (r.placed_by_kind === "rep") return `Rep ${r.placed_by_name ?? ""}`.trim();
  return `Office ${r.placed_by_name ?? ""}`.trim();
}

/** Why an order is held, in plain words, and what to do. */
export const HOLD_TEXT: Record<string, string> = {
  blocked: "The salon is blocked for credit. Unblock it or cancel the order.",
  plan_not_allowed: "This payment plan is not allowed for the salon. Release it or cancel the order.",
  over_limit: "The salon has reached its credit limit. Release it or cancel the order.",
  discount_waiting: "A discount is waiting for approval.",
  discount_refused: "The discount was refused. Cancel the order and make a new one.",
  not_checked: "Not checked yet. Open the order to check it again.",
};

/** An order's status in plain words. */
export const STATUS_TEXT: Record<string, string> = {
  draft: "On hold",
  confirmed: "Waiting to be delivered",
  partially_delivered: "Part delivered",
  delivered: "Delivered",
  closed: "Delivered",
  cancelled: "Cancelled",
};

/** A payment plan in plain words. */
export const PLAN_TEXT: Record<string, string> = { CASH: "Cash", INST2: "2 installments", INST4: "4 installments" };

/** Why an order is on hold, for the rep (P1-30, FLOW-18, REP-17): the order's own hold codes in plain words. */
export const REP_HOLD_TEXT: Record<string, string> = {
  blocked: "The salon's credit is blocked.",
  plan_not_allowed: "This payment plan is not allowed for the salon yet.",
  over_limit: "The salon has reached its credit limit.",
  pending: "A discount is waiting for approval.",
  rejected: "The discount was refused.",
};

/** What a salon's held order waits for (app.salon_my_orders waiting_on; AUTH-10): no figure, no office text. */
export const SALON_WAITING_TEXT: Record<string, string> = {
  price_approval: "Waiting for the office to approve the price.",
  credit_check: "Waiting for the office to check the payment terms.",
  office_check: "Waiting for the office to check it.",
};

const DAYS_TEXT: Record<number, string> = { 0: "since today", 1: "1 day" };

/** "since today", "1 day", "3 days". */
export function daysWaiting(d: number | null): string {
  if (d === null) return "";
  return DAYS_TEXT[d] ?? `${d} days`;
}

// -------------------------------------------------------------------- investors ----
export type InvestorMonthRow = {
  investor_id: string | null;
  full_name: string | null;
  status: "active" | "closed" | null;
  is_total: boolean;
  month_start: string;
  month_end: string;
  invested_paisa: number;
  principal_outstanding_paisa: number;
  profit_decided_month_paisa: number;
  decisions_month: number;
  profit_paid_month_paisa: number;
  principal_paid_month_paisa: number;
  profit_owed_paisa: number;
};

// ------------------------------------------------------------------------- reps ----
export type MyMonthOrders = {
  month_start: string;
  month_end: string;
  orders_count: number;
  orders_value_paisa: number;
  delivered_count: number;
  delivered_value_paisa: number;
  waiting_count: number;
  waiting_value_paisa: number;
  held_count: number;
  cancelled_count: number;
  /** P1-30 (FLOW-10): orders from the rep's own cards, whoever delivers them (as the office home's "placed by"). */
  placed_count: number;
  placed_value_paisa: number;
};

export type RepMonthRow = {
  rep_id: string;
  full_name: string;
  status: "active" | "suspended" | "offboarded";
  month_start: string;
  month_end: string;
  orders_count: number;
  orders_value_paisa: number;
  delivered_count: number;
  waiting_count: number;
  held_count: number;
  cancelled_count: number;
  earned_month_paisa: number;
  paid_month_paisa: number;
  owed_paisa: number;
  placed_count: number;
  placed_value_paisa: number;
};
