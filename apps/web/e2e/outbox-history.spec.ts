import { expect, test } from "@playwright/test";
import { drain } from "../lib/outbox/drain";
import { enqueue, MemoryStore } from "../lib/outbox/queue";
import { type OutboxFn, SYNC_HISTORY_LIMIT, type SyncAttempt } from "../lib/outbox/types";

// P1-09, NFR-01: the sync history, the last 50 sends with how each ended. Node only, no page.

const REP_A = "rep-a";
const REP_B = "rep-b";
const NOW = 2_000_000;
const FORBIDDEN = 403;
const UNAUTHORIZED = 401;
const FIVE = 5;
const EXTRA = 7;

const REFUSAL = { status: FORBIDDEN, code: "42501", message: "check in before logging visits (PIP-09)" };
const EXPIRED = { status: UNAUTHORIZED, code: "PGRST301", message: "JWT expired" };
const NO_SIGNAL = new TypeError("Failed to fetch");

const oneAtATime =
  () =>
  async <T>(run: () => Promise<T>): Promise<T | "busy"> =>
    run();

const visit = (store: MemoryStore, id: string, userId = REP_A) =>
  enqueue(store, {
    id,
    userId,
    fn: "log_visit",
    args: { p_client_id: id },
    label: "Visit to [Dummy] Salon",
    salonId: null,
    capturedAt: "2026-11-10T04:00:00.000Z",
    dependsOn: null,
  });

/** A server that throws `error` for the given ids and accepts everything else. */
const sendWith =
  (errors: Record<string, unknown> = {}) =>
  async (_fn: OutboxFn, args: Record<string, unknown>) => {
    await Promise.resolve();
    const error = errors[String(args.p_client_id)];
    if (error) throw error;
    return {};
  };

const run = (store: MemoryStore, send: ReturnType<typeof sendWith>, userId = REP_A, now = () => NOW) =>
  drain({ store, userId, send, now, lock: oneAtATime() });

const attempt = (n: number, userId = REP_A): SyncAttempt => ({
  id: `a${n}`,
  userId,
  at: n,
  fn: "log_visit",
  label: "Visit",
  result: "sent",
  message: null,
  durationMs: 1,
});

test("a send that works is noted as sent, with no message", async () => {
  const store = new MemoryStore();
  await visit(store, "one");
  await run(store, sendWith());
  const [only, ...rest] = await store.history(REP_A);
  expect(rest).toEqual([]);
  expect(only).toMatchObject({ userId: REP_A, fn: "log_visit", result: "sent", message: null, at: NOW });
});

test("each way a send can fail is noted with its own result and the failure's words", async () => {
  const store = new MemoryStore();
  await visit(store, "refused");
  await run(store, sendWith({ refused: REFUSAL }));
  await visit(store, "offline");
  await run(store, sendWith({ offline: NO_SIGNAL }));
  // The offline item is past its backoff a minute later, and fails again.
  await run(store, sendWith({ offline: NO_SIGNAL }), REP_A, () => NOW + 60_000);
  const results = (await store.history(REP_A)).map((a) => [a.result, a.message]);
  // Newest first.
  expect(results).toEqual([
    ["offline", "Failed to fetch"],
    ["offline", "Failed to fetch"],
    ["rejected", REFUSAL.message],
  ]);
});

test("a session that ended is noted as auth and holds the queue", async () => {
  const store = new MemoryStore();
  await visit(store, "expired");
  const report = await run(store, sendWith({ expired: EXPIRED }));
  expect(report.held).toBe("auth");
  expect(await store.history(REP_A)).toMatchObject([{ result: "auth", message: "JWT expired" }]);
});

test("a try that did not reach the network is not an attempt", async () => {
  const store = new MemoryStore();
  await visit(store, "offline");
  await run(store, sendWith({ offline: NO_SIGNAL }));
  // Still inside the backoff: the pass sends nothing, so it adds nothing.
  await run(store, sendWith({ offline: NO_SIGNAL }));
  expect(await store.history(REP_A)).toHaveLength(1);
});

test("the history keeps the newest 50 and drops the oldest", async () => {
  const store = new MemoryStore();
  for (let n = 1; n <= SYNC_HISTORY_LIMIT + EXTRA; n += 1) await store.record(attempt(n));
  const kept = await store.history(REP_A);
  expect(kept).toHaveLength(SYNC_HISTORY_LIMIT);
  expect(kept[0]?.id).toBe(`a${SYNC_HISTORY_LIMIT + EXTRA}`);
  expect(kept.at(-1)?.id).toBe(`a${EXTRA + 1}`);
});

test("one rep's history is never shown to, or trimmed by, another", async () => {
  const store = new MemoryStore();
  for (let n = 1; n <= FIVE; n += 1) await store.record(attempt(n, REP_B));
  for (let n = 1; n <= SYNC_HISTORY_LIMIT + 1; n += 1) await store.record(attempt(n, REP_A));
  expect(await store.history(REP_B)).toHaveLength(FIVE);
  expect((await store.history(REP_A)).every((a) => a.userId === REP_A)).toBe(true);
  expect(await store.history("rep-c")).toEqual([]);
});

test("a history that cannot be written does not stop the queue", async () => {
  const store = new MemoryStore();
  store.record = () => Promise.reject(new Error("storage full"));
  await visit(store, "one");
  await visit(store, "two");
  expect(await run(store, sendWith())).toEqual({ sent: 2, rejected: 0, held: "none" });
  expect(await store.list(REP_A)).toEqual([]);
});

test("clearing the outbox clears the history", async () => {
  const store = new MemoryStore();
  await store.record(attempt(1));
  await store.clear();
  expect(await store.history(REP_A)).toEqual([]);
});
