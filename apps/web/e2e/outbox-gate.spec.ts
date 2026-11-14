import { expect, test } from "@playwright/test";
import { classifyFailure } from "../lib/outbox/classify";
import {
  type Asked,
  answerOf,
  decideGate,
  GATE_KEY,
  type GateMemory,
  NEVER_CHECKED,
  NO_SESSION_NO_SIGNAL,
  readGateMemory,
  writeGateMemory,
} from "../lib/outbox/gate";

// P1-09: the account check in front of the rep pages, and the one page (Waiting to send) that may
// open without it. It opens unchecked only when the request got no answer at all, a session is held
// on this phone, and the last answer this phone had for that same login was "allowed". Node only.

const REP_A = "rep-a";
const REP_B = "rep-b";

const NO_RESPONSE = 0;
const UNAUTHORIZED = 401;
const FORBIDDEN = 403;
const REQUEST_TIMEOUT = 408;
const TOO_MANY_REQUESTS = 429;
const SERVER_ERROR = 500;
const UNAVAILABLE = 503;

// What supabase-js returns when fetch itself fails, and what the servers answer.
const NO_SIGNAL = { status: NO_RESPONSE, code: "", message: "TypeError: Failed to fetch" };
const BUSY = { status: UNAVAILABLE, code: "", message: "Service Unavailable" };
const EXPIRED = { status: UNAUTHORIZED, code: "PGRST301", message: "JWT expired" };

const ACTIVE = { full_name: "[Dummy] Rep", role: "rep", status: "active", device_status: "approved" } as const;
const SUSPENDED = { ...ACTIVE, status: "suspended" } as const;
const PENDING_PHONE = { ...ACTIVE, device_status: "pending" } as const;
const REVOKED_PHONE = { ...ACTIVE, device_status: "revoked" } as const;
const MANAGER = { ...ACTIVE, role: "manager" } as const;

const answered = (session: Extract<Asked, { kind: "answered" }>["session"], salon = false): Asked => ({
  kind: "answered",
  session,
  salon,
});
const failed = (error: unknown): Asked => ({ kind: "failed", error });

const ALLOWED: GateMemory = { userId: REP_A, allowed: true, message: null };
const outbox = (asked: Asked, userId: string | null, memory: GateMemory | null) =>
  decideGate({ opensWithoutSignal: true, asked, userId, memory });
const otherPage = (asked: Asked, userId: string | null, memory: GateMemory | null) =>
  decideGate({ opensWithoutSignal: false, asked, userId, memory });

/** localStorage, as far as the gate uses it. */
const fakeStorage = () => {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
};

test("only a request that got no answer at all counts as no signal", () => {
  expect(answerOf(NO_SIGNAL)).toBe("none");
  expect(answerOf(new TypeError("Failed to fetch"))).toBe("none");
  expect(answerOf({ status: NO_RESPONSE, code: "", message: "AbortError: The operation timed out." })).toBe("none");
  expect(answerOf(BUSY)).toBe("busy");
  expect(answerOf({ status: SERVER_ERROR })).toBe("busy");
  expect(answerOf({ status: TOO_MANY_REQUESTS })).toBe("busy");
  expect(answerOf({ status: REQUEST_TIMEOUT })).toBe("busy");
  expect(answerOf({ status: SERVER_ERROR, code: "57014", message: "canceling statement due to statement timeout" })).toBe("busy");
  expect(answerOf(EXPIRED)).toBe("refused");
  expect(answerOf({ status: FORBIDDEN, code: "42501", message: "permission denied" })).toBe("refused");
  // An error that is not a failed fetch and carries no status is not proof of "no signal".
  expect(answerOf(new Error("something else"))).toBe("refused");
});

test("the queue still treats a busy server as passing: the gate's narrower rule does not change it", () => {
  [BUSY, { status: SERVER_ERROR }, { status: TOO_MANY_REQUESTS }, { status: REQUEST_TIMEOUT }, NO_SIGNAL].forEach((error) => {
    expect(classifyFailure(error)).toBe("transient");
  });
});

test("an active rep on an approved phone passes, and the phone remembers it for that login", () => {
  expect(outbox(answered(ACTIVE), REP_A, null)).toEqual({ gate: { kind: "ok" }, remember: ALLOWED });
  expect(otherPage(answered(ACTIVE), REP_A, null)).toEqual({ gate: { kind: "ok" }, remember: ALLOWED });
});

test("every answer that the rep may not work stops the page and is remembered as not allowed", () => {
  const stops: Asked[] = [
    answered(SUSPENDED),
    answered(PENDING_PHONE),
    answered(REVOKED_PHONE),
    answered(MANAGER),
    answered(null),
    answered(null, true),
  ];
  stops.forEach((asked) => {
    const { gate, remember } = outbox(asked, REP_A, ALLOWED);
    expect(gate.kind).toBe("stop");
    expect(remember).toMatchObject({ userId: REP_A, allowed: false });
    expect(remember?.message).toBe(gate.kind === "stop" ? gate.message : "");
  });
  expect(outbox(answered(null, true), REP_A, null).gate).toMatchObject({ kind: "stop", salon: true });
});

test("a refusal from the server (an ended session) closes the page and is remembered as not allowed", () => {
  const { gate, remember } = outbox(failed(EXPIRED), REP_A, ALLOWED);
  expect(gate).toEqual({ kind: "error", message: "JWT expired" });
  expect(remember).toEqual({ userId: REP_A, allowed: false, message: "JWT expired" });
});

test("a busy server never opens the page, even for a rep allowed last time, and changes nothing remembered", () => {
  [BUSY, { status: SERVER_ERROR }, { status: TOO_MANY_REQUESTS }, { status: REQUEST_TIMEOUT }].forEach((error) => {
    const { gate, remember } = outbox(failed(error), REP_A, ALLOWED);
    expect(gate.kind).toBe("error");
    expect(remember).toBeNull();
  });
});

test("no signal opens the page only for the login this phone last saw allowed", () => {
  expect(outbox(failed(NO_SIGNAL), REP_A, ALLOWED)).toEqual({ gate: { kind: "ok" }, remember: null });
});

test("no signal with no session held on the phone stays closed, whatever is remembered", () => {
  expect(outbox(failed(NO_SIGNAL), null, ALLOWED)).toEqual({
    gate: { kind: "error", message: NO_SESSION_NO_SIGNAL },
    remember: null,
  });
});

test("no signal after a not-allowed answer stays closed and repeats that answer", () => {
  // A deactivated rep saw this online; switching the phone to offline must not get past it.
  const told = outbox(answered(SUSPENDED), REP_A, ALLOWED);
  const { gate, remember } = outbox(failed(NO_SIGNAL), REP_A, told.remember);
  expect(gate.kind).toBe("stop");
  expect(gate.kind === "stop" ? gate.message : "").toContain("Your account is not active");
  expect(gate.kind === "stop" ? gate.message : "").toContain("no signal now");
  expect(remember).toBeNull();
});

test("no signal for a login this phone never checked stays closed", () => {
  expect(outbox(failed(NO_SIGNAL), REP_A, null).gate).toEqual({ kind: "error", message: NEVER_CHECKED });
  // What was remembered belongs to another login.
  expect(outbox(failed(NO_SIGNAL), REP_B, ALLOWED).gate).toEqual({ kind: "error", message: NEVER_CHECKED });
});

test("the next successful check clears a remembered refusal", () => {
  const refused: GateMemory = { userId: REP_A, allowed: false, message: "Your account is not active." };
  const { remember } = outbox(answered(ACTIVE), REP_A, refused);
  expect(remember).toEqual(ALLOWED);
  expect(outbox(failed(NO_SIGNAL), REP_A, remember).gate).toEqual({ kind: "ok" });
});

test("every other rep page stays closed with no signal, even for a rep allowed last time", () => {
  const { gate, remember } = otherPage(failed(NO_SIGNAL), REP_A, ALLOWED);
  expect(gate.kind).toBe("error");
  expect(remember).toBeNull();
});

test("what the phone remembers survives a reload, and anything unreadable counts as never checked", () => {
  const storage = fakeStorage();
  expect(readGateMemory(storage)).toBeNull();
  writeGateMemory(storage, ALLOWED);
  expect(readGateMemory(storage)).toEqual(ALLOWED);
  storage.values.set(GATE_KEY, "not json");
  expect(readGateMemory(storage)).toBeNull();
  storage.values.set(GATE_KEY, JSON.stringify({ userId: REP_A, allowed: "yes" }));
  expect(readGateMemory(storage)).toBeNull();
  const blocked = {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
  };
  expect(readGateMemory(blocked)).toBeNull();
  expect(() => writeGateMemory(blocked, ALLOWED)).not.toThrow();
});
