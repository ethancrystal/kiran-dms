"use client";
import { monthName, shiftMonth, thisMonth } from "@/lib/overview";

const PREVIOUS = -1;
const NEXT = 1;

// Previous and next month buttons around the month's name. The database refuses a month that has not
// started (22023), so "Next month" is off on the current month. One picker per page, so the button
// names stay unique.
export function MonthPicker({ month, onChange }: { month: string; onChange: (m: string) => void }) {
  const atNow = month >= thisMonth();
  return (
    <div className="row month-picker">
      <button type="button" className="inline" onClick={() => onChange(shiftMonth(month, PREVIOUS))}>
        ← Previous month
      </button>
      <strong data-testid="month-name">{monthName(month)}</strong>
      <button type="button" className="inline" disabled={atNow} onClick={() => onChange(shiftMonth(month, NEXT))}>
        Next month →
      </button>
    </div>
  );
}
