import { expect, test } from "@playwright/test";
import { classifyFailure } from "../lib/outbox/classify";
import {
  type Asked,
  answerOf,
  checkAccount,
  decideGate,
  GATE_KEY,
  type GateMemory,
  type Held,
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

test("a token the server would not take (401) closes the page for now but is not an answer about the account", () => {
  // A phone whose clock is slow, or a token that ran out on the way: the queue holds and recovers
  // on this answer (classifyFailure "auth"), and the gate must not turn it into a remembered refusal.
  const { gate, remember } = outbox(failed(EXPIRED), REP_A, ALLOWED);
  expect(gate).toEqual({ kind: "error", message: "JWT expired" });
  expect(remember).toBeNull();
  // Signal drops next: the rep the server last allowed still opens Waiting to send.
  expect(outbox(failed(NO_SIGNAL), REP_A, ALLOWED).gate).toEqual({ kind: "ok" });
  // And it opens nothing for a login the server never allowed.
  expect(outbox(failed(EXPIRED), REP_A, null)).toEqual({ gate: { kind: "error", message: "JWT expired" }, remember: null });
});

test("any other refusal of the check itself closes the page and is remembered as not allowed", () => {
  const denied = { status: FORBIDDEN, code: "42501", message: "permission denied" };
  const { gate, remember } = outbox(failed(denied), REP_A, ALLOWED);
  expect(gate).toEqual({ kind: "error", message: "permission denied" });
  expect(remember).toEqual({ userId: REP_A, allowed: false, message: "permission denied" });
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

// A session that ran out with no signal: the phone still stores it but cannot renew it.
const storedOutbox = (asked: Asked, storedUserId: string | null, memory: GateMemory | null) =>
  decideGate({ opensWithoutSignal: true, asked, userId: null, storedUserId, memory });

test("no signal past the token's life opens the page for the stored session's login, if the server last allowed it", () => {
  expect(storedOutbox(failed(NO_SIGNAL), REP_A, ALLOWED)).toEqual({ gate: { kind: "ok" }, remember: null });
});

test("a stored session opens nothing for another login, a refused login or one never checked", () => {
  expect(storedOutbox(failed(NO_SIGNAL), REP_B, ALLOWED).gate).toEqual({ kind: "error", message: NEVER_CHECKED });
  expect(storedOutbox(failed(NO_SIGNAL), REP_A, null).gate).toEqual({ kind: "error", message: NEVER_CHECKED });
  const refused: GateMemory = { userId: REP_A, allowed: false, message: "Your account is not active." };
  expect(storedOutbox(failed(NO_SIGNAL), REP_A, refused).gate.kind).toBe("stop");
  expect(storedOutbox(failed(NO_SIGNAL), null, ALLOWED).gate).toEqual({ kind: "error", message: NO_SESSION_NO_SIGNAL });
  // Only Waiting to send: every other page still needs the server.
  const other = decideGate({
    opensWithoutSignal: false,
    asked: failed(NO_SIGNAL),
    userId: null,
    storedUserId: REP_A,
    memory: ALLOWED,
  });
  expect(other.gate.kind).toBe("error");
  // A busy server is an answer, stored session or not.
  expect(storedOutbox(failed(BUSY), REP_A, ALLOWED).gate.kind).toBe("error");
});

test("an answer is never remembered against a login that was only stored, not confirmed", () => {
  // The question went out without that login's token, so the answer says nothing about it.
  const denied = failed({ status: FORBIDDEN, code: "42501", message: "permission denied" });
  [answered(null), answered(ACTIVE), answered(SUSPENDED), denied].forEach((asked) => {
    expect(storedOutbox(asked, REP_A, ALLOWED).remember).toBeNull();
  });
});

const TOKEN_A = "token-of-rep-a";
const CONFIRMED: Held = { userId: REP_A, storedUserId: null, token: TOKEN_A };
const STORED_ONLY: Held = { userId: null, storedUserId: REP_A, token: null };
const NOBODY: Held = { userId: null, storedUserId: null, token: null };

/** The layout's two questions, scripted: who the phone holds (one answer per call) and what the server says. */
const scripted = (helds: Held[], answers: Asked[]) => {
  const calls: string[] = [];
  const next = <T>(list: T[], name: string): T => {
    const value = list.shift();
    if (value === undefined) throw new Error(`unexpected ${name}`);
    return value;
  };
  return {
    calls,
    held: () => {
      calls.push("held");
      return Promise.resolve(next(helds, "held"));
    },
    ask: (token: string | null) => {
      calls.push(`ask:${token ?? "no token"}`);
      return Promise.resolve(next(answers, "ask"));
    },
  };
};

test("the account is asked about with the token of the session the phone holds, read first", async () => {
  const io = scripted([CONFIRMED], [answered(ACTIVE)]);
  expect(await checkAccount({ ...io, opensWithoutSignal: true, memory: null })).toEqual({
    gate: { kind: "ok" },
    remember: ALLOWED,
  });
  expect(io.calls).toEqual(["held", `ask:${TOKEN_A}`]);
});

test("an answer that came while the session could not be confirmed is asked for again as that session before it counts", async () => {
  // Weak signal: the renewal failed, the question went out without the rep's token and the server
  // answered "no profile". The renewal then works: the question is asked again with the rep's token.
  const io = scripted([STORED_ONLY, CONFIRMED], [answered(null), answered(ACTIVE)]);
  expect(await checkAccount({ ...io, opensWithoutSignal: true, memory: ALLOWED })).toEqual({
    gate: { kind: "ok" },
    remember: ALLOWED,
  });
  expect(io.calls).toEqual(["held", "ask:no token", "held", `ask:${TOKEN_A}`]);
});

test("if the session still cannot be confirmed, the answer closes the page for now and nothing is remembered about the rep", async () => {
  const io = scripted([STORED_ONLY, STORED_ONLY], [answered(null)]);
  const { gate, remember } = await checkAccount({ ...io, opensWithoutSignal: true, memory: ALLOWED });
  expect(gate.kind).toBe("stop");
  expect(remember).toBeNull();
  expect(io.calls).toEqual(["held", "ask:no token", "held"]);
  // The signal drops for good: what the server last said to the rep's own token still stands.
  const later = scripted([STORED_ONLY], [failed(NO_SIGNAL)]);
  expect(await checkAccount({ ...later, opensWithoutSignal: true, memory: ALLOWED })).toEqual({
    gate: { kind: "ok" },
    remember: null,
  });
});

test("with no answer nothing is asked twice, and with nobody stored the page stays closed", async () => {
  const nobody = scripted([NOBODY], [failed(NO_SIGNAL)]);
  expect(await checkAccount({ ...nobody, opensWithoutSignal: true, memory: ALLOWED })).toEqual({
    gate: { kind: "error", message: NO_SESSION_NO_SIGNAL },
    remember: null,
  });
  expect(nobody.calls).toEqual(["held", "ask:no token"]);
  // Nobody signed in and the server answers: nothing is remembered.
  const anon = scripted([NOBODY, NOBODY], [answered(null)]);
  expect((await checkAccount({ ...anon, opensWithoutSignal: false, memory: null })).remember).toBeNull();
});
