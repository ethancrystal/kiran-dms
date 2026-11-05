"use client";
import { monthName, shiftMonth, thisMonth } from "@/lib/overview";

const PREVIOUS = -1;
const NEXT = 1;

// Previous and next month buttons around the month's name. The database refuses a month that has not
// started (22023), so "Next month" is off on the current month. `what` makes the button names unique
// on a page with more than one picker.
export function MonthPicker({ month, onChange, what }: { month: string; onChange: (m: string) => void; what: string }) {
  const atNow = month >= thisMonth();
  return (
    <div className="row month-picker">
      <button
        type="button"
        className="inline"
        aria-label={`Previous month for ${what}`}
        onClick={() => onChange(shiftMonth(month, PREVIOUS))}
      >
        ← Previous month
      </button>
      <strong data-testid="month-name">{monthName(month)}</strong>
      <button
        type="button"
        className="inline"
        aria-label={`Next month for ${what}`}
        disabled={atNow}
        onClick={() => onChange(shiftMonth(month, NEXT))}
      >
        Next month →
      </button>
    </div>
  );
}
