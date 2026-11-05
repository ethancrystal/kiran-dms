import { expect, test } from "@playwright/test";
import { capNote } from "../lib/list-cap";

// AUTH-15, FLOW-19: a list that has reached the database's cap says so; a shorter one stays quiet.
// Runs in Node with no page: the wording is a plain function.

const CAP = 50;

test("a list below its cap has no note", () => {
  expect(capNote(0, CAP, "orders")).toBeNull();
  expect(capNote(CAP - 1, CAP, "orders")).toBeNull();
});

test("a list at its cap says it is the newest ones and older ones are not listed", () => {
  expect(capNote(CAP, CAP, "orders")).toBe("Showing the newest 50 orders. Older ones are not listed here.");
});
