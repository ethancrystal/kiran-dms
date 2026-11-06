// AUTH-15, FLOW-19: some lists are read newest-first with a fixed cap in the database (50 for the
// rep's cards, deliveries and orders; 200 for the office order list). A list that is exactly at its
// cap may hold older rows that are not shown, and nothing said so. The reads return no total, so the
// note says what is true: this is the newest N, and older ones are not listed.

/** The note for a list that has reached the database's cap; null below it. */
export function capNote(shown: number, cap: number, what: string): string | null {
  if (shown < cap) return null;
  return `Showing the newest ${cap} ${what}. Older ones are not listed here.`;
}
