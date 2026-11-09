import { expect, test } from "@playwright/test";
import { dueItems, enqueue, MemoryStore, pendingCount, retry } from "../lib/outbox/queue";

// P1-09, NFR-01: the queue rules, over a store kept in memory. These run in Node with no page.

const REP_A = "rep-a";
const REP_B = "rep-b";

// Clock readings in epoch milliseconds for the due-time rules.
const EARLY = 1_000;
const LATER = 5_000;
const MUCH_LATER = 9_000;
const SOME_ATTEMPTS = 3;
const MISSING_PARENT = "depends on";

type Input = Parameters<typeof enqueue>[1];
const input = (id: string, over: Partial<Input> = {}): Input => ({
  id,
  userId: REP_A,
  fn: "log_visit",
  args: { p_client_id: id },
  label: "Visit",
  salonId: null,
  capturedAt: "2026-11-10T04:00:00.000Z",
  dependsOn: null,
  ...over,
});
const ids = (items: { id: string }[]) => items.map((i) => i.id);

test("enqueue numbers items in capture order and list returns the oldest first", async () => {
  const store = new MemoryStore();
  const first = await enqueue(store, input("a"));
  const second = await enqueue(store, input("b"));
  const third = await enqueue(store, input("c"));
  expect(second.seq).toBeGreaterThan(first.seq);
  expect(third.seq).toBeGreaterThan(second.seq);
  expect(ids(await store.list(REP_A))).toEqual(["a", "b", "c"]);
});

test("a new item is pending, untried and due at once", async () => {
  const store = new MemoryStore();
  const item = await enqueue(store, input("a"));
  expect(item).toMatchObject({ state: "pending", attempts: 0, nextAttemptAt: 0, error: null });
});

test("enqueueing the same id twice keeps one item and returns the first", async () => {
  const store = new MemoryStore();
  const first = await enqueue(store, input("a", { label: "Visit" }));
  const again = await enqueue(store, input("a", { label: "Another label", args: { changed: true } }));
  expect(again).toEqual(first);
  expect(await store.list(REP_A)).toHaveLength(1);
});

test("dueItems returns only pending items whose time has come, for that user only", async () => {
  const store = new MemoryStore();
  await enqueue(store, input("due"));
  await enqueue(store, input("later"));
  await enqueue(store, input("refused"));
  await enqueue(store, input("other-rep", { userId: REP_B }));
  await store.update("later", { nextAttemptAt: LATER });
  await store.update("refused", { state: "rejected", error: "no" });

  expect(ids(await dueItems(store, REP_A, EARLY))).toEqual(["due"]);
  expect(ids(await dueItems(store, REP_A, LATER))).toEqual(["due", "later"]);
  expect(ids(await dueItems(store, REP_B, EARLY))).toEqual(["other-rep"]);
});

test("retry turns a rejected item back to pending and due, keeping its id", async () => {
  const store = new MemoryStore();
  await enqueue(store, input("a"));
  await store.update("a", { state: "rejected", error: "refused", nextAttemptAt: MUCH_LATER });
  await retry(store, "a");
  const [item] = await store.list(REP_A);
  expect(item).toMatchObject({ id: "a", state: "pending", nextAttemptAt: 0, error: null });
});

test("capturedAt is stored exactly as given and never rewritten", async () => {
  const store = new MemoryStore();
  const captured = "2026-11-09T18:59:59.123Z";
  await enqueue(store, input("a", { capturedAt: captured }));
  await store.update("a", { attempts: SOME_ATTEMPTS, nextAttemptAt: EARLY });
  await retry(store, "a");
  const [item] = await store.list(REP_A);
  expect(item?.capturedAt).toBe(captured);
});

test("an item that depends on another is refused unless that item is in the store", async () => {
  const store = new MemoryStore();
  const dependsOn = { itemId: "delivery", argName: "p_submission_id" };
  await expect(enqueue(store, input("signature", { fn: "rep_attach_signature", dependsOn }))).rejects.toThrow(MISSING_PARENT);
  // Another rep's item does not count as the parent.
  await enqueue(store, input("delivery", { userId: REP_B, fn: "rep_submit_delivery" }));
  await expect(enqueue(store, input("signature", { fn: "rep_attach_signature", dependsOn }))).rejects.toThrow(MISSING_PARENT);
  expect(await store.list(REP_A)).toHaveLength(0);
});

test("an item may depend on an earlier item of the same rep", async () => {
  const store = new MemoryStore();
  await enqueue(store, input("delivery", { fn: "rep_submit_delivery" }));
  const signature = await enqueue(
    store,
    input("signature", {
      fn: "rep_attach_signature",
      dependsOn: { itemId: "delivery", argName: "p_submission_id" },
    }),
  );
  expect(signature.dependsOn).toEqual({ itemId: "delivery", argName: "p_submission_id" });
});

test("pendingCount counts what still waits to be sent, for that user only", async () => {
  const store = new MemoryStore();
  await enqueue(store, input("a"));
  await enqueue(store, input("b"));
  await enqueue(store, input("c"));
  await enqueue(store, input("z", { userId: REP_B }));
  await store.update("c", { state: "rejected", error: "no" });
  expect(ids(await dueItems(store, REP_A, EARLY))).toEqual(["a", "b"]);
  expect(await pendingCount(store, REP_A)).toBe(ids(await dueItems(store, REP_A, EARLY)).length);
  expect(await pendingCount(store, REP_B)).toBe(1);
});

test("clear removes every user's items", async () => {
  const store = new MemoryStore();
  await enqueue(store, input("a"));
  await enqueue(store, input("z", { userId: REP_B }));
  await store.clear();
  expect(await store.list(REP_A)).toEqual([]);
  expect(await store.list(REP_B)).toEqual([]);
});
