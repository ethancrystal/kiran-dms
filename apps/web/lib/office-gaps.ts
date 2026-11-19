// Small helpers for three office screens over database functions that had no page (gap audit of
// 2026-11-19): app.duplicate_phones, app.office_reminder_log and app.office_set_last_purchase. Every
// rule stays in the database (doc 06 section 2); these only shape what the page shows.

/**
 * A phone as the database's app.mask_phone shows it: the first 4 and last 2 characters, stars between.
 * The office may read full phones on a salon's own page; a list across salons shows them masked.
 */
export function maskPhone(phone: string): string {
  const KEEP_START = 4;
  const KEEP_END = 2;
  return phone.slice(0, KEEP_START) + "*".repeat(Math.max(phone.length - KEEP_START - KEEP_END, 0)) + phone.slice(-KEEP_END);
}

/** What waited, in the words the Settings page uses for the reminder switches (REMINDER_KINDS). */
export const REMINDER_KIND_TEXT: Record<string, string> = {
  discount: "Discount approval",
  adjustment: "Stock adjustment",
  delivery: "Delivery waiting for approval",
  stock: "Rejected goods still unsettled",
  salon: "Salon proposal",
};

/** The office page each kind of waiting item is handled on, the same paths the reminder bodies carry. */
export const REMINDER_KIND_PATH: Record<string, string> = {
  discount: "/office/approvals",
  adjustment: "/office/approvals",
  delivery: "/office/deliveries",
  stock: "/office/stock",
  salon: "/office/salons/approvals",
};

/** control.approval_reminder_log.result in plain words. No mail is sent until MJ names a service (B-61). */
export const REMINDER_RESULT_TEXT: Record<string, string> = {
  claimed: "Prepared",
  sent: "Sent",
  not_configured: "Not sent: no mail service is set up yet",
};

export const reminderKindText = (kind: string) => REMINDER_KIND_TEXT[kind] ?? kind;
export const reminderResultText = (result: string) => REMINDER_RESULT_TEXT[result] ?? result;

// A calendar date as an <input type="date"> gives it: YYYY-MM-DD.
// https://regex101.com/?regex=%5E%5Cd%7B4%7D-%5Cd%7B2%7D-%5Cd%7B2%7D%24&flavor=javascript
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Why an opening last-purchase date cannot be sent, or null. Mirrors app.office_set_last_purchase,
 * which refuses an empty or future date (Karachi calendar); the database stays the rule.
 * `today` is the Karachi date as YYYY-MM-DD.
 */
export function openingDateProblem(day: string, today: string): string | null {
  const d = day.trim();
  if (!d) return "Choose the date of the last purchase.";
  if (!ISO_DATE.test(d) || Number.isNaN(Date.parse(`${d}T00:00:00Z`))) return "Enter the date as a calendar date.";
  if (d > today) return "The last purchase date cannot be in the future.";
  return null;
}
