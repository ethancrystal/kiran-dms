import { expect, test } from "@playwright/test";
import {
  maskPhone,
  openingDateProblem,
  REMINDER_KIND_PATH,
  REMINDER_KIND_TEXT,
  reminderKindText,
  reminderResultText,
} from "../lib/office-gaps";

// The helpers behind the shared-phones panel, the reminder history and the opening last-purchase form
// (gap audit 2026-11-19). These run in Node with no page. The database stays the rule for each of them.

test("a shared phone is masked the way app.mask_phone masks it", () => {
  // Synthetic numbers only (H-03).
  expect(maskPhone("03001234567")).toBe("0300*****67");
  expect(maskPhone("+923001234567")).toBe("+923*******67");
  // Shorter than the kept parts: nothing to hide, nothing repeated (the database's greatest(..., 0)).
  expect(maskPhone("123456")).toBe("123456");
});

test("every kind the reminder log allows has words and the office page that handles it", () => {
  // control.approval_reminder_log.item_kind check, migration 20261111020000.
  for (const kind of ["discount", "adjustment", "delivery", "stock", "salon"]) {
    expect(REMINDER_KIND_TEXT[kind]).toBeTruthy();
    expect(REMINDER_KIND_PATH[kind]).toMatch(/^\/office\//);
  }
  expect(REMINDER_KIND_PATH.salon).toBe("/office/salons/approvals");
  expect(REMINDER_KIND_PATH.delivery).toBe("/office/deliveries");
  // An unknown kind or result is shown as stored, never hidden.
  expect(reminderKindText("later_kind")).toBe("later_kind");
  expect(reminderResultText("not_configured")).toContain("Not sent");
  expect(reminderResultText("sent")).toBe("Sent");
  expect(reminderResultText("other")).toBe("other");
});

test("an opening last-purchase date must be a past or present Karachi calendar date", () => {
  const today = "2026-11-19";
  expect(openingDateProblem("2026-11-19", today)).toBeNull();
  expect(openingDateProblem("2026-01-31", today)).toBeNull();
  expect(openingDateProblem("2026-11-20", today)).toContain("future");
  expect(openingDateProblem("", today)).toContain("Choose");
  expect(openingDateProblem("   ", today)).toContain("Choose");
  expect(openingDateProblem("19-11-2026", today)).toContain("calendar date");
  expect(openingDateProblem("2026-13-45", today)).toContain("calendar date");
});
