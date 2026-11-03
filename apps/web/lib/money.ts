// Money on the page. The database keeps integer paisa (H-10); pages show rupees and turn what is
// typed back into paisa without floating point.

const PAISA_PER_RUPEE = 100;
const PAISA_DIGITS = 2;

/** Paisa from the database shown as rupees: 150000 → "Rs 1,500", 150050 → "Rs 1,500.5". */
export const rupees = (paisa: number) =>
  `Rs ${(Number(paisa) / PAISA_PER_RUPEE).toLocaleString("en-PK", { maximumFractionDigits: PAISA_DIGITS })}`;

// Rupees as typed, with at most two decimals: "1500" and "1500.5" match; "1,500", "1.234" and "-5" do not.
// https://regex101.com/?regex=%5E%28%5Cd%7B1%2C9%7D%29%28%3F%3A%5C.%28%5Cd%7B1%2C2%7D%29%29%3F%24&flavor=javascript
const AMOUNT = /^(\d{1,9})(?:\.(\d{1,2}))?$/;

/** "1500.5" → 150050 paisa; null when the text is not a plain amount. */
export function toPaisa(text: string): number | null {
  const m = AMOUNT.exec(text.trim());
  if (!m) return null;
  return Number(m[1]) * PAISA_PER_RUPEE + Number((m[2] ?? "").padEnd(PAISA_DIGITS, "0"));
}
