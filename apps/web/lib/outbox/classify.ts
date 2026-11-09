import type { Failure } from "./types";

// What the outbox does with a failed send (P1-09, NFR-01).
//   transient: no signal or a busy server. The item stays and is tried again by itself.
//   auth:      the session ended, the phone is not approved, or the profile is not active. Every
//              item is held and the rep is told; nothing is sent until that is put right.
//   rejected:  the database answered and refused this item. It stays under "Needs attention"
//              with the database's words until the rep retries or discards it.
// Nothing is ever dropped here. A failure this code does not recognise is transient, the safe side.

// The two refusals app.assert_actor_ready raises for a rep (20261024223304_foundation.sql). They
// concern the session and the phone, not the item, so the item is held instead of refused.
const ACTOR_NOT_READY = ["this device is not approved for this rep", "no active user profile for this session"];

const PERMISSION_DENIED = "42501";
const SQLSTATE_LENGTH = 5;
const SQLSTATE_CLASS_LENGTH = 2;
// Classes that pass by themselves: 08 connection, 40 serialization failure and deadlock,
// 53 out of resources, 57 cancelled or shutting down, 58 system error.
const PASSING_CLASSES = ["08", "40", "53", "57", "58"];

const HTTP_CLIENT_ERRORS_FROM = 400;
const HTTP_UNAUTHORIZED = 401;
const HTTP_REQUEST_TIMEOUT = 408;
const HTTP_TOO_MANY_REQUESTS = 429;
const HTTP_SERVER_ERRORS_FROM = 500;

type Shape = { status: number | null; code: string; message: string };

/** supabase-js gives the SQLSTATE in `code` and the HTTP status in `status`; a thrown fetch error has neither. */
const shapeOf = (error: unknown): Shape => {
  const e: Record<string, unknown> = typeof error === "object" && error !== null ? { ...error } : {};
  const message = error instanceof Error ? error.message : e.message;
  return {
    status: typeof e.status === "number" ? e.status : null,
    code: typeof e.code === "string" ? e.code : "",
    message: typeof message === "string" ? message : "",
  };
};

/** PostgREST's own codes ("PGRST301") are longer than a five-character SQLSTATE. */
const sqlstateOf = (code: string): string => (code.length === SQLSTATE_LENGTH ? code : "");

const answeredAndRefused = (status: number | null): boolean =>
  status !== null &&
  status >= HTTP_CLIENT_ERRORS_FROM &&
  status < HTTP_SERVER_ERRORS_FROM &&
  status !== HTTP_REQUEST_TIMEOUT &&
  status !== HTTP_TOO_MANY_REQUESTS;

export function classifyFailure(error: unknown): Failure {
  const { status, code, message } = shapeOf(error);
  const sqlstate = sqlstateOf(code);
  if (PASSING_CLASSES.includes(sqlstate.slice(0, SQLSTATE_CLASS_LENGTH))) return "transient";
  if (status === HTTP_UNAUTHORIZED) return "auth";
  if (sqlstate === PERMISSION_DENIED && ACTOR_NOT_READY.includes(message)) return "auth";
  if (sqlstate) return "rejected";
  return answeredAndRefused(status) ? "rejected" : "transient";
}

/** The database's own words for a refusal, or a plain fallback. */
export const failureMessage = (error: unknown): string => shapeOf(error).message.trim() || "The request was refused.";
