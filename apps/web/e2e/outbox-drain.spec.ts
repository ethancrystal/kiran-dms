import { expect, test } from "@playwright/test";
import { backoffMs, drain } from "../lib/outbox/drain";
import { enqueue, MemoryStore } from "../lib/outbox/queue";
import type { OutboxFn, OutboxItem } from "../lib/outbox/types";

// P1-09, NFR-01: one pass over the queue, with a pretend server. These run in Node with no page.

const REP_A = "rep-a";
const REP_B = "rep-b";
const NOW = 1_000_000;
const FIRST_BACKOFF_MS = 5_000;
const SECOND_BACKOFF_MS = 10_000;
const LONGEST_BACKOFF_MS = 30_000;
const MANY_ATTEMPTS = 12;
const FORBIDDEN = 403;
const UNAUTHORIZED = 401;
const SUBMISSION_ID = "11111111-1111-4111-8111-111111111111";
const NOTHING_DONE = { sent: 0, rejected: 0, held: "none" };
const FIVE = 5;
const FOUR = 4;
const BOTH = 2;

const REFUSAL = { status: FORBIDDEN, code: "42501", message: "check in before logging visits (PIP-09)" };
const EXPIRED = { status: UNAUTHORIZED, code: "PGRST301", message: "JWT expired" };
const NO_SIGNAL = new TypeError("Failed to fetch");

type Call = { fn: OutboxFn; args: Record<string, unknown> };
type Answer = (call: Call) => unknown;

/** A pretend server: records every call and answers through `answer`, which may throw. */
const server = (answer: Answer = () => ({})) => {
  const calls: Call[] = [];
  const send = async (fn: OutboxFn, args: Record<string, unknown>) => {
    calls.push({ fn, args });
    await Promise.resolve();
    return answer({ fn, args });
  };
  return { calls, send };
};
const failing = (id: string, error: unknown): Answer => {
  return ({ args }) => {
    if (args.p_client_id === id) throw error;
    return {};
  };
};

/** One drain at a time, as the browser's lock gives it: a second caller is told "busy". */
const oneAtATime = () => {
  const held = { now: false };
  return async <T>(run: () => Promise<T>): Promise<T | "busy"> => {
    if (held.now) return "busy";
    held.now = true;
    try {
      return await run();
    } finally {
      held.now = false;
    }
  };
};

const visit = (store: MemoryStore, id: string, userId = REP_A) =>
  enqueue(store, {
    id,
    userId,
    fn: "log_visit",
    args: { p_client_id: id },
    label: "Visit",
    salonId: null,
    capturedAt: "2026-11-10T04:00:00.000Z",
    dependsOn: null,
  });
const fiveVisits = async (store: MemoryStore) => {
  await visit(store, "one");
  await visit(store, "two");
  await visit(store, "three");
  await visit(store, "four");
  await visit(store, "five");
};
const deliveryWithSignature = async (store: MemoryStore) => {
  const common = { userId: REP_A, salonId: null, capturedAt: "2026-11-10T04:00:00.000Z" };
  await enqueue(store, {
    ...common,
    id: "delivery",
    fn: "rep_submit_delivery",
    args: { p_client_id: "delivery" },
    label: "Delivery",
    dependsOn: null,
  });
  await enqueue(store, {
    ...common,
    id: "signature",
    fn: "rep_attach_signature",
    args: { p_client_id: "signature", p_signer_name: "[Dummy] Signer" },
    label: "Signature",
    dependsOn: { itemId: "delivery", argName: "p_submission_id" },
  });
};
const run = (store: MemoryStore, send: ReturnType<typeof server>["send"]) =>
  drain({ store, userId: REP_A, send, now: () => NOW, lock: oneAtATime() });
const byId = async (store: MemoryStore, id: string, userId = REP_A): Promise<OutboxItem | undefined> =>
  (await store.list(userId)).find((i) => i.id === id);
const sentIds = (calls: Call[]) => calls.map((c) => c.args.p_client_id);

test("items are sent in capture order, each with its own arguments, and leave the queue", async () => {
  const store = new MemoryStore();
  await fiveVisits(store);
  const { calls, send } = server();
  expect(await run(store, send)).toEqual({ sent: FIVE, rejected: 0, held: "none" });
  expect(sentIds(calls)).toEqual(["one", "two", "three", "four", "five"]);
  expect(await store.list(REP_A)).toEqual([]);
  // Nothing is left, so a second pass sends nothing.
  expect(await run(store, send)).toEqual(NOTHING_DONE);
  expect(calls).toHaveLength(FIVE);
});

test("a refused item keeps the database's words and does not stop the items behind it", async () => {
  const store = new MemoryStore();
  await fiveVisits(store);
  const { calls, send } = server(failing("three", REFUSAL));
  expect(await run(store, send)).toEqual({ sent: FOUR, rejected: 1, held: "none" });
  expect(sentIds(calls)).toEqual(["one", "two", "three", "four", "five"]);
  const left = await store.list(REP_A);
  expect(left).toHaveLength(1);
  expect(left[0]).toMatchObject({ id: "three", state: "rejected", error: REFUSAL.message });
});

test("a refused item is not sent again until the rep retries it", async () => {
  const store = new MemoryStore();
  await visit(store, "three");
  const { calls, send } = server(failing("three", REFUSAL));
  await run(store, send);
  expect(await run(store, send)).toEqual(NOTHING_DONE);
  expect(calls).toHaveLength(1);
});

test("no signal stops the pass: the item waits with a backoff and the items behind it are untouched", async () => {
  const store = new MemoryStore();
  await fiveVisits(store);
  const { calls, send } = server(failing("two", NO_SIGNAL));
  expect(await run(store, send)).toEqual({ sent: 1, rejected: 0, held: "offline" });
  expect(sentIds(calls)).toEqual(["one", "two"]);
  expect(await byId(store, "two")).toMatchObject({
    state: "pending",
    attempts: 1,
    nextAttemptAt: NOW + FIRST_BACKOFF_MS,
    error: null,
  });
  const behind = (await store.list(REP_A)).filter((i) => i.id !== "two");
  expect(behind.map((i) => [i.id, i.state, i.attempts, i.nextAttemptAt])).toEqual([
    ["three", "pending", 0, 0],
    ["four", "pending", 0, 0],
    ["five", "pending", 0, 0],
  ]);
});

test("an item still waiting out its backoff holds the items behind it, so the order is kept", async () => {
  const store = new MemoryStore();
  await visit(store, "one");
  await visit(store, "two");
  await store.update("one", { attempts: 1, nextAttemptAt: NOW + 1 });
  const { calls, send } = server();
  expect(await run(store, send)).toEqual({ sent: 0, rejected: 0, held: "offline" });
  expect(calls).toEqual([]);
});

test("the wait doubles after each failure and never passes 30 seconds", () => {
  expect(backoffMs(0)).toBe(FIRST_BACKOFF_MS);
  expect(backoffMs(1)).toBe(SECOND_BACKOFF_MS);
  expect(backoffMs(MANY_ATTEMPTS)).toBe(LONGEST_BACKOFF_MS);
});

test("an expired session stops the pass and leaves every unsent item as it was", async () => {
  const store = new MemoryStore();
  await fiveVisits(store);
  const { calls, send } = server(failing("two", EXPIRED));
  expect(await run(store, send)).toEqual({ sent: 1, rejected: 0, held: "auth" });
  expect(sentIds(calls)).toEqual(["one", "two"]);
  const left = await store.list(REP_A);
  expect(left.map((i) => [i.id, i.state, i.attempts, i.nextAttemptAt])).toEqual([
    ["two", "pending", 0, 0],
    ["three", "pending", 0, 0],
    ["four", "pending", 0, 0],
    ["five", "pending", 0, 0],
  ]);
});

test("two drains at once send each item once: the second is told the queue is busy", async () => {
  const store = new MemoryStore();
  await fiveVisits(store);
  const { calls, send } = server();
  const lock = oneAtATime();
  const deps = { store, userId: REP_A, send, now: () => NOW, lock };
  const [first, second] = await Promise.all([drain(deps), drain(deps)]);
  expect(first).toEqual({ sent: FIVE, rejected: 0, held: "none" });
  expect(second).toEqual(NOTHING_DONE);
  expect(sentIds(calls)).toEqual(["one", "two", "three", "four", "five"]);
});

test("another rep's items on the same phone are never sent", async () => {
  const store = new MemoryStore();
  await visit(store, "mine");
  await visit(store, "theirs", REP_B);
  const { calls, send } = server();
  expect(await run(store, send)).toEqual({ sent: 1, rejected: 0, held: "none" });
  expect(sentIds(calls)).toEqual(["mine"]);
  expect(await byId(store, "theirs", REP_B)).toMatchObject({ state: "pending", attempts: 0 });
});

test("a signature is sent after its delivery, carrying the id the server gave the delivery", async () => {
  const store = new MemoryStore();
  await deliveryWithSignature(store);
  const { calls, send } = server(({ fn }) => (fn === "rep_submit_delivery" ? { id: SUBMISSION_ID } : {}));
  expect(await run(store, send)).toEqual({ sent: BOTH, rejected: 0, held: "none" });
  expect(calls.map((c) => c.fn)).toEqual(["rep_submit_delivery", "rep_attach_signature"]);
  expect(calls[1]?.args).toEqual({
    p_client_id: "signature",
    p_signer_name: "[Dummy] Signer",
    p_submission_id: SUBMISSION_ID,
  });
});

test("the delivery's id is saved on the signature before the delivery leaves the queue", async () => {
  const store = new MemoryStore();
  await deliveryWithSignature(store);
  // The delivery goes through, then the signal drops before the signature is sent.
  const { send } = server(({ fn }) => {
    if (fn === "rep_attach_signature") throw NO_SIGNAL;
    return { id: SUBMISSION_ID };
  });
  expect(await run(store, send)).toEqual({ sent: 1, rejected: 0, held: "offline" });
  expect(await byId(store, "delivery")).toBeUndefined();
  expect((await byId(store, "signature"))?.args.p_submission_id).toBe(SUBMISSION_ID);
});

test("a signature whose delivery was refused is refused with it and never sent alone", async () => {
  const store = new MemoryStore();
  await deliveryWithSignature(store);
  const refusal = { status: FORBIDDEN, code: "42501", message: "this order is no longer deliverable" };
  const { calls, send } = server(failing("delivery", refusal));
  expect(await run(store, send)).toEqual({ sent: 0, rejected: BOTH, held: "none" });
  expect(calls.map((c) => c.fn)).toEqual(["rep_submit_delivery"]);
  expect(await byId(store, "signature")).toMatchObject({
    state: "rejected",
    error: `its delivery was refused: ${refusal.message}`,
  });
});

test("a signature whose delivery the rep discarded is refused and never sent alone", async () => {
  const store = new MemoryStore();
  await deliveryWithSignature(store);
  await store.remove("delivery");
  const { calls, send } = server();
  expect(await run(store, send)).toEqual({ sent: 0, rejected: 1, held: "none" });
  expect(calls).toEqual([]);
  expect((await byId(store, "signature"))?.state).toBe("rejected");
});

test("a signature is refused, not sent, when the server names no delivery in its answer", async () => {
  const store = new MemoryStore();
  await deliveryWithSignature(store);
  const { calls, send } = server(() => ({}));
  expect(await run(store, send)).toEqual({ sent: 1, rejected: 1, held: "none" });
  expect(calls.map((c) => c.fn)).toEqual(["rep_submit_delivery"]);
  expect((await byId(store, "signature"))?.state).toBe("rejected");
});
