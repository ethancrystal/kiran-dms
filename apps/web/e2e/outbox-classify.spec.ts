import { expect, test } from "@playwright/test";
import { classifyFailure } from "../lib/outbox/classify";

// P1-09, NFR-01: what the outbox does with a failed send. These run in Node with no page.
// transient: keep and try again by itself. auth: hold everything and tell the rep.
// rejected: the database refused this item; show its words, the rep retries or discards.

// The two messages app.assert_actor_ready raises for a rep (20261024223304_foundation.sql).
const DEVICE_NOT_APPROVED = "this device is not approved for this rep";
const NO_ACTIVE_PROFILE = "no active user profile for this session";

// HTTP statuses as PostgREST and the network give them. NO_RESPONSE is what supabase-js reports
// when fetch itself failed.
const NO_RESPONSE = 0;
const BAD_REQUEST = 400;
const UNAUTHORIZED = 401;
const FORBIDDEN = 403;
const NOT_FOUND = 404;
const REQUEST_TIMEOUT = 408;
const TOO_MANY_REQUESTS = 429;
const SERVER_ERROR = 500;
const UNAVAILABLE = 503;

// serialization failure, deadlock, statement timeout, too many connections, connection failure
const PASSING_SQLSTATES = ["40001", "40P01", "57014", "53300", "08006"];
// invalid parameter, unique violation, check violation, wrong object state, raise exception
const REFUSAL_SQLSTATES = ["22023", "23505", "23514", "55000", "P0001"];

test("no connection is transient", () => {
  expect(classifyFailure(new TypeError("Failed to fetch"))).toBe("transient");
  // What supabase-js returns instead of throwing when fetch fails or is aborted.
  expect(classifyFailure({ status: NO_RESPONSE, code: "", message: "TypeError: Failed to fetch" })).toBe("transient");
  expect(classifyFailure({ status: NO_RESPONSE, code: "", message: "AbortError: The operation timed out." })).toBe("transient");
});

test("a busy or slow server is transient", () => {
  expect(classifyFailure({ status: UNAVAILABLE })).toBe("transient");
  expect(classifyFailure({ status: SERVER_ERROR })).toBe("transient");
  expect(classifyFailure({ status: TOO_MANY_REQUESTS })).toBe("transient");
  expect(classifyFailure({ status: REQUEST_TIMEOUT })).toBe("transient");
});

test("database errors that pass by themselves are transient, whatever the status", () => {
  const classes = PASSING_SQLSTATES.map((code) => classifyFailure({ status: BAD_REQUEST, code, message: "x" }));
  expect(classes).toEqual(PASSING_SQLSTATES.map(() => "transient"));
});

test("an expired session is auth", () => {
  expect(classifyFailure({ status: UNAUTHORIZED })).toBe("auth");
  expect(classifyFailure({ status: UNAUTHORIZED, code: "PGRST301", message: "JWT expired" })).toBe("auth");
  // PostgREST answers 401 for a permission error when the request carried no valid session.
  expect(classifyFailure({ status: UNAUTHORIZED, code: "42501", message: "permission denied for schema app" })).toBe("auth");
});

test("a phone that is not approved, or a profile that is not active, is auth", () => {
  expect(classifyFailure({ status: FORBIDDEN, code: "42501", message: DEVICE_NOT_APPROVED })).toBe("auth");
  expect(classifyFailure({ status: FORBIDDEN, code: "42501", message: NO_ACTIVE_PROFILE })).toBe("auth");
});

test("a business refusal is rejected", () => {
  expect(classifyFailure({ status: FORBIDDEN, code: "42501", message: "check in before logging visits (PIP-09)" })).toBe(
    "rejected",
  );
  const classes = REFUSAL_SQLSTATES.map((code) => classifyFailure({ status: BAD_REQUEST, code, message: "x" }));
  expect(classes).toEqual(REFUSAL_SQLSTATES.map(() => "rejected"));
});

test("a request the server answered and refused for another reason is rejected", () => {
  // For example a function the deployed database does not have yet.
  expect(classifyFailure({ status: NOT_FOUND, code: "PGRST202", message: "Could not find the function" })).toBe("rejected");
});

test("an unknown shape is transient: the item is kept, never discarded", () => {
  expect(classifyFailure(undefined)).toBe("transient");
  expect(classifyFailure(null)).toBe("transient");
  expect(classifyFailure("boom")).toBe("transient");
  expect(classifyFailure({})).toBe("transient");
  expect(classifyFailure(new Error("something else"))).toBe("transient");
});
