import { classifyFailure, failureMessage } from "./classify";
import type { AttemptResult, OutboxFn, OutboxItem, OutboxStore } from "./types";

// One pass over a rep's queue (P1-09, NFR-01). Items are sent strictly in capture order, one at a
// time: a visit must not reach the database before the check-in captured ahead of it. So the
// oldest pending item is always the next one, and an item that has to wait makes the items behind
// it wait too. A refused item is the exception: it is set aside for the rep and the pass goes on.

export type DrainDeps = {
  store: OutboxStore;
  userId: string;
  /** Sends one item through its app.* function. Throws on any failure, with `code` and `status` when known. */
  send: (fn: OutboxFn, args: Record<string, unknown>) => Promise<unknown>;
  now: () => number;
  /** Makes the id of a history entry; the phone uses `crypto.randomUUID`. */
  newId?: () => string;
  /** Runs one drain at a time across tabs; answers "busy" when another drain holds the lock. */
  lock: <T>(run: () => Promise<T>) => Promise<T | "busy">;
};

/** `held` says why the pass stopped early: "offline" (try again later) or "auth" (the rep must act). */
export type DrainReport = { sent: number; rejected: number; held: "none" | "offline" | "auth" };

const NOTHING_DONE: DrainReport = { sent: 0, rejected: 0, held: "none" };

const BACKOFF_BASE_MS = 5_000;
const BACKOFF_FACTOR = 2;
const BACKOFF_CAP_MS = 30_000;
/** A reconnect is picked up well inside 60 s (NFR-01): 5 s, 10 s, 20 s, then every 30 s. */
export const backoffMs = (attempts: number): number => Math.min(BACKOFF_BASE_MS * BACKOFF_FACTOR ** attempts, BACKOFF_CAP_MS);

// A store that never changes an item would otherwise keep a pass going for ever.
const MAX_STEPS_PER_PASS = 500;

const PARENT_REFUSED = "its delivery was refused: ";
const PARENT_GONE = "the delivery it belongs to is no longer waiting on this phone";
const PARENT_ID_MISSING = "the server did not say which delivery this belongs to";

/** The `id` of what the function returned: the row's id, or the value itself when it returns a bare id. */
const idOf = (result: unknown): string | null => {
  if (typeof result === "string" && result) return result;
  const id = typeof result === "object" && result !== null ? (result as { id?: unknown }).id : null;
  return typeof id === "string" && id ? id : null;
};

/** Why an item that depends on another cannot be sent, or null when it can. */
const blockedReason = (item: OutboxItem, queue: OutboxItem[]): string | null => {
  if (!item.dependsOn) return null;
  const { itemId, argName } = item.dependsOn;
  const parent = queue.find((other) => other.id === itemId);
  if (parent?.state === "rejected") return `${PARENT_REFUSED}${parent.error ?? "no reason was given"}`;
  const filled = item.args[argName];
  return filled === undefined || filled === null ? PARENT_GONE : null;
};

/** Hands the sent item's id to the items that wait for it, before the sent item leaves the queue. */
const settleDependents = async (store: OutboxStore, sent: OutboxItem, queue: OutboxItem[], result: unknown) => {
  const id = idOf(result);
  const dependents = queue.filter((other) => other.dependsOn?.itemId === sent.id);
  await Promise.all(
    dependents.map((dependent) =>
      id === null
        ? store.update(dependent.id, { state: "rejected", error: PARENT_ID_MISSING })
        : store.update(dependent.id, { args: { ...dependent.args, [dependent.dependsOn?.argName ?? ""]: id } }),
    ),
  );
  return id === null ? dependents.filter((dependent) => dependent.state === "pending").length : 0;
};

/** Notes how a send went in the sync history. A history that cannot be written never stops the queue. */
const note = async (deps: DrainDeps, item: OutboxItem, started: number, result: AttemptResult, message: string | null) => {
  try {
    await deps.store.record({
      id: deps.newId ? deps.newId() : `${item.id}:${started}`,
      userId: deps.userId,
      at: started,
      fn: item.fn,
      label: item.label,
      result,
      message,
      durationMs: Math.max(0, deps.now() - started),
    });
  } catch {
    // The history is a diagnostic aid; losing one line of it must not hold up a rep's work.
  }
};

type Outcome = { report: DrainReport; goOn: boolean };

/** Sends the oldest pending item, or decides why it cannot be sent. */
const step = async (deps: DrainDeps, report: DrainReport): Promise<Outcome> => {
  const queue = await deps.store.list(deps.userId);
  const head = queue.find((item) => item.state === "pending");
  if (!head) return { report, goOn: false };
  if (head.nextAttemptAt > deps.now()) return { report: { ...report, held: "offline" }, goOn: false };

  const blocked = blockedReason(head, queue);
  if (blocked !== null) {
    await deps.store.update(head.id, { state: "rejected", error: blocked });
    return { report: { ...report, rejected: report.rejected + 1 }, goOn: true };
  }

  const started = deps.now();
  try {
    const result = await deps.send(head.fn, head.args);
    await note(deps, head, started, "sent", null);
    const refused = await settleDependents(deps.store, head, queue, result);
    await deps.store.remove(head.id);
    return { report: { ...report, sent: report.sent + 1, rejected: report.rejected + refused }, goOn: true };
  } catch (error) {
    const failure = classifyFailure(error);
    await note(deps, head, started, failure === "transient" ? "offline" : failure, failureMessage(error));
    if (failure === "auth") return { report: { ...report, held: "auth" }, goOn: false };
    if (failure === "transient") {
      const nextAttemptAt = deps.now() + backoffMs(head.attempts);
      await deps.store.update(head.id, { attempts: head.attempts + 1, nextAttemptAt });
      return { report: { ...report, held: "offline" }, goOn: false };
    }
    await deps.store.update(head.id, { state: "rejected", error: failureMessage(error) });
    return { report: { ...report, rejected: report.rejected + 1 }, goOn: true };
  }
};

const pass = async (deps: DrainDeps, report: DrainReport, stepsLeft: number): Promise<DrainReport> => {
  if (stepsLeft === 0) return report;
  const outcome = await step(deps, report);
  return outcome.goOn ? pass(deps, outcome.report, stepsLeft - 1) : outcome.report;
};

/** Sends what can be sent now. Safe to call as often as wanted: a second caller is told "busy" and does nothing. */
export async function drain(deps: DrainDeps): Promise<DrainReport> {
  const done = await deps.lock(() => pass(deps, NOTHING_DONE, MAX_STEPS_PER_PASS));
  return done === "busy" ? NOTHING_DONE : done;
}
