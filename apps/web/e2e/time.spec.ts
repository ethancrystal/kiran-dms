import { expect, test } from "@playwright/test";
import { clock, when, whenOrDash } from "../lib/time";

// REP-20, L2: every page shows database times in Karachi time, whatever zone the browser (or this
// test machine) is in. These run in Node with no page: the formatter has a fixed zone, so a
// machine in another zone must give the same answer. Pakistan has no daylight saving.

// 20:00 UTC on 5 November is 01:00 on 6 November in Karachi: a different calendar day.
const LATE_EVENING_UTC = "2026-11-05T20:00:00Z";
// Newer ICU versions put a narrow no-break space before "am"; compare with a plain space.
const NARROW_NO_BREAK_SPACE = " ";
const plain = (text: string) => text.replaceAll(NARROW_NO_BREAK_SPACE, " ");

test("a database time is shown as Karachi date and time, on Karachi's calendar day", () => {
  const shown = plain(when(LATE_EVENING_UTC));
  // The layout of the date ("06-Nov-2026" today) belongs to the platform's locale data; the day,
  // month, year and clock are what matter. The UTC day (the 5th) must not show.
  expect(shown).toContain("06");
  expect(shown).toContain("Nov");
  expect(shown).toContain("2026");
  expect(shown).not.toContain("05");
  expect(shown).toContain("1:00 am");
});

test("a clock time is shown in Karachi time", () => {
  expect(plain(clock(LATE_EVENING_UTC))).toBe("1:00 am");
});

test("a missing time is a dash, a present one is formatted", () => {
  expect(whenOrDash(null)).toBe("—");
  expect(whenOrDash(LATE_EVENING_UTC)).toBe(when(LATE_EVENING_UTC));
});
