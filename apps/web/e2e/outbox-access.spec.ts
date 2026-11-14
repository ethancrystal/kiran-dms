import { expect, test } from "@playwright/test";
import {
  CANNOT_CONFIRM,
  captureOwner,
  discardOwn,
  historyOwn,
  type Live,
  listOwn,
  NOT_SIGNED_IN,
  NOT_YOURS,
  retryOwn,
  SIGN_IN_TO_VIEW,
} from "../lib/outbox/access";
import { enqueue, MemoryStore } from "../lib/outbox/queue";
import type { SyncAttempt } from "../lib/outbox/types";

// P1-09, NFR-01: whose queue the phone shows and changes. Reading, Retry and Discard need the
// session this phone really holds now; the id remembered from an earlier session is good only for
// saving a new action while out of signal. Node only, no page.

const REP_A = "rep-a";
const REP_B = "rep-b";

const signedIn = (userId: string): Live => ({ userId, unconfirmed: false });
const SIGNED_OUT: Live = { userId: null, unconfirmed: false };
// A session is stored but has run out and cannot be renewed without signal.
const OUT_OF_SIGNAL: Live = { userId: null, unconfirmed: true };

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

const attempt = (id: string, userId = REP_A): SyncAttempt => ({
  id,
  userId,
  at: 1,
  fn: "log_visit",
  label: "Visit to [Dummy] Salon",
  result: "sent",
  message: null,
  durationMs: 1,
});

test("a new action goes to the signed-in rep, or to the remembered rep when the session cannot be read", () => {
  expect(captureOwner(signedIn(REP_A), null)).toBe(REP_A);
  expect(captureOwner(signedIn(REP_B), REP_A)).toBe(REP_B);
  expect(captureOwner(OUT_OF_SIGNAL, REP_A)).toBe(REP_A);
  expect(() => captureOwner(SIGNED_OUT, null)).toThrow(NOT_SIGNED_IN);
});

test("after sign-out the previous rep's waiting items and sends are not shown, even with their id remembered", async () => {
  const store = new MemoryStore();
  await visit(store, "one");
  await store.record(attempt("a1"));
  // The reads take no remembered id at all: only the session decides.
  await expect(listOwn(store, SIGNED_OUT)).rejects.toThrow(SIGN_IN_TO_VIEW);
  await expect(historyOwn(store, SIGNED_OUT)).rejects.toThrow(SIGN_IN_TO_VIEW);
});

test("a session that cannot be confirmed shows nothing and says why, without claiming anything was removed", async () => {
  const store = new MemoryStore();
  await visit(store, "one");
  await expect(listOwn(store, OUT_OF_SIGNAL)).rejects.toThrow(CANNOT_CONFIRM);
  await expect(historyOwn(store, OUT_OF_SIGNAL)).rejects.toThrow(CANNOT_CONFIRM);
  expect(await store.list(REP_A)).toHaveLength(1);
});

test("the signed-in rep sees their own items and sends, never another rep's", async () => {
  const store = new MemoryStore();
  await visit(store, "mine", REP_A);
  await visit(store, "theirs", REP_B);
  await store.record(attempt("a1", REP_A));
  await store.record(attempt("b1", REP_B));
  expect((await listOwn(store, signedIn(REP_A))).map((item) => item.id)).toEqual(["mine"]);
  expect((await historyOwn(store, signedIn(REP_A))).map((a) => a.id)).toEqual(["a1"]);
});

test("Retry and Discard are refused with no session and leave the item as it was", async () => {
  const store = new MemoryStore();
  await visit(store, "one");
  await store.update("one", { state: "rejected", error: "refused" });
  await expect(retryOwn(store, SIGNED_OUT, "one")).rejects.toThrow(SIGN_IN_TO_VIEW);
  await expect(discardOwn(store, SIGNED_OUT, "one")).rejects.toThrow(SIGN_IN_TO_VIEW);
  await expect(discardOwn(store, OUT_OF_SIGNAL, "one")).rejects.toThrow(CANNOT_CONFIRM);
  expect(await store.list(REP_A)).toMatchObject([{ id: "one", state: "rejected", error: "refused" }]);
});

test("Retry and Discard are refused for another rep's item, by its id", async () => {
  const store = new MemoryStore();
  await visit(store, "theirs", REP_A);
  await store.update("theirs", { state: "rejected", error: "refused" });
  await expect(retryOwn(store, signedIn(REP_B), "theirs")).rejects.toThrow(NOT_YOURS);
  await expect(discardOwn(store, signedIn(REP_B), "theirs")).rejects.toThrow(NOT_YOURS);
  expect(await store.list(REP_A)).toMatchObject([{ id: "theirs", state: "rejected", error: "refused" }]);
});

test("the signed-in rep retries and discards their own items", async () => {
  const store = new MemoryStore();
  await visit(store, "again");
  await visit(store, "gone");
  await store.update("again", { state: "rejected", error: "refused" });
  await retryOwn(store, signedIn(REP_A), "again");
  await discardOwn(store, signedIn(REP_A), "gone");
  expect(await store.list(REP_A)).toMatchObject([{ id: "again", state: "pending", error: null }]);
});
