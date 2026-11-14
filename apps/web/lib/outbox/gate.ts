import type { Session } from "../rpc";
import { classifyFailure, failureMessage } from "./classify";

// The account check in front of the rep pages (REP-04, P1-30), and the one page that may open
// without it (P1-09: "Waiting to send" reads only this phone and has to open with no signal).
// The rule here is narrower than the queue's: the queue retries on a busy server (5xx, 408, 429),
// but a busy server is an answer, and only a request that got no answer at all may open a page
// unchecked. Even then it opens only when a session is held on this phone and the last answer this
// phone had for that same login was "allowed". Convenience only: every read and write is decided
// again by the database (app.self_ok, RLS).

export type Gate =
  | { kind: "checking" }
  | { kind: "ok" }
  | { kind: "stop"; message: string; salon?: boolean }
  | { kind: "error"; message: string };

/** What asking app.my_session gave: an answer (with whether the login is a salon's), or a failure. */
export type Asked = { kind: "answered"; session: Session | null; salon: boolean } | { kind: "failed"; error: unknown };

/** The last answer this phone had from the server about one login. Kept across reloads. */
export type GateMemory = { userId: string; allowed: boolean; message: string | null };

export const GATE_KEY = "kiran.rep.gate";

export const NO_SIGNAL = "No signal: this page needs the server to check your account. Try again when the signal is back.";
export const NO_SESSION_NO_SIGNAL =
  "No signal, and this phone holds no sign-in it can confirm, so this page stays closed. Nothing on the phone was removed.";
export const NEVER_CHECKED =
  "No signal, and this phone has not yet checked your account with the server, so this page stays closed. Open it once with signal.";
const BUSY_FALLBACK = "The server could not check your account just now. Try again.";

const HTTP_NO_RESPONSE = 0;

/**
 * How a failed request ended. "none": no answer at all (the fetch itself failed, which supabase-js
 * reports as status 0). "busy": the server answered but could not serve (5xx, 408, 429, a passing
 * database error). "refused": any other answer.
 */
export function answerOf(error: unknown): "none" | "busy" | "refused" {
  const status = typeof error === "object" && error !== null && "status" in error ? error.status : undefined;
  if (status === HTTP_NO_RESPONSE) return "none";
  if (status === undefined && error instanceof TypeError) return "none";
  if (status === undefined) return "refused";
  return classifyFailure(error) === "transient" ? "busy" : "refused";
}

/** What an answer from app.my_session means for a rep page. */
const verdict = (session: Session | null, salon: boolean): Gate => {
  if (!session) {
    return salon
      ? { kind: "stop", salon: true, message: "This is a salon's login, not a rep's. Your account is in the salon portal." }
      : { kind: "stop", message: "Your account is not set up yet. Open Today to see your sign-in code for the owner." };
  }
  if (session.role !== "rep") {
    return { kind: "stop", message: "These pages are for reps. Owners and managers work in the office." };
  }
  if (session.status !== "active") {
    return { kind: "stop", message: "Your account is not active, so these pages show nothing. Contact your manager." };
  }
  if (session.device_status !== "approved") {
    return {
      kind: "stop",
      message:
        session.device_status === "pending"
          ? "This phone is waiting for your manager's approval. Until then these pages show nothing."
          : "This phone is not approved. Open Today to register it, then ask your manager to approve it.",
    };
  }
  return { kind: "ok" };
};

/** With no answer: open only for the login this phone last saw allowed. */
const withoutAnswer = (userId: string | null, memory: GateMemory | null): Gate => {
  if (!userId) return { kind: "error", message: NO_SESSION_NO_SIGNAL };
  if (!memory || memory.userId !== userId) return { kind: "error", message: NEVER_CHECKED };
  if (memory.allowed) return { kind: "ok" };
  return {
    kind: "stop",
    message: `${memory.message ?? "Your account was not allowed."} (That was the server's last answer to this phone; there is no signal now.)`,
  };
};

export type GateInput = {
  /** True only for a page that reads nothing but this phone and has to open with no signal. */
  opensWithoutSignal: boolean;
  asked: Asked;
  /** The user id of the session held on this phone, or null when there is none. */
  userId: string | null;
  memory: GateMemory | null;
};

/** The gate to show, and what to remember (`null` leaves what is remembered unchanged). */
export function decideGate({ opensWithoutSignal, asked, userId, memory }: GateInput): {
  gate: Gate;
  remember: GateMemory | null;
} {
  if (asked.kind === "answered") {
    const gate = verdict(asked.session, asked.salon);
    const message = gate.kind === "stop" ? gate.message : null;
    return { gate, remember: userId ? { userId, allowed: gate.kind === "ok", message } : null };
  }
  const answer = answerOf(asked.error);
  if (answer === "refused") {
    const message = failureMessage(asked.error);
    return { gate: { kind: "error", message }, remember: userId ? { userId, allowed: false, message } : null };
  }
  if (answer === "busy") return { gate: { kind: "error", message: BUSY_FALLBACK }, remember: null };
  if (!opensWithoutSignal) return { gate: { kind: "error", message: NO_SIGNAL }, remember: null };
  return { gate: withoutAnswer(userId, memory), remember: null };
}

/** What the phone remembers, or null when nothing readable is stored. */
export function readGateMemory(storage: Pick<Storage, "getItem">): GateMemory | null {
  try {
    const stored: unknown = JSON.parse(storage.getItem(GATE_KEY) ?? "null");
    if (typeof stored !== "object" || stored === null) return null;
    const { userId, allowed, message } = stored as Record<string, unknown>;
    if (typeof userId !== "string" || typeof allowed !== "boolean") return null;
    return { userId, allowed, message: typeof message === "string" ? message : null };
  } catch {
    return null;
  }
}

/** Remembers the server's answer. A phone that will not store it simply never opens without signal. */
export function writeGateMemory(storage: Pick<Storage, "setItem">, memory: GateMemory): void {
  try {
    storage.setItem(GATE_KEY, JSON.stringify(memory));
  } catch {
    // Nothing remembered means "never checked", which keeps the page closed with no signal.
  }
}
