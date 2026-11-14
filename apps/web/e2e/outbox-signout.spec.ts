import { expect, test } from "@playwright/test";
import { enqueue, MemoryStore } from "../lib/outbox/queue";
import { type SignOutDeps, signOutOfPhone, signOutQuestion } from "../lib/outbox/sign-out";

// P1-09, NFR-01, plan task 10: signing out clears what the outbox keeps on the phone, and never
// drops unsent work without the rep saying so first. Node only, no page.

const REP_A = "rep-a";
const REP_B = "rep-b";
const TWO = 2;

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

/** A phone: the store, the id it remembers, whether a session is held, and what was called, in order. */
const phone = (store: MemoryStore, overrides: Partial<SignOutDeps> = {}) => {
  const state = { remembered: REP_A as string | null, session: true, calls: [] as string[] };
  const deps: SignOutDeps = {
    unsent: () => store.count(),
    wipe: async () => {
      state.calls.push("wipe");
      await store.clear();
      state.remembered = null;
    },
    endSession: () => {
      state.calls.push("endSession");
      state.session = false;
      return Promise.resolve();
    },
    forget: () => {
      state.calls.push("forget");
      state.remembered = null;
    },
    ...overrides,
  };
  return { state, deps };
};

test("the store counts every unsent item on the phone, waiting or refused, for any login", async () => {
  const store = new MemoryStore();
  expect(await store.count()).toBe(0);
  await visit(store, "one", REP_A);
  await visit(store, "two", REP_B);
  await store.update("two", { state: "rejected", error: "refused" });
  expect(await store.count()).toBe(TWO);
});

test("with nothing unsent, sign-out wipes first, then ends the session, then forgets the rep", async () => {
  const store = new MemoryStore();
  const { state, deps } = phone(store);
  expect(await signOutOfPhone(deps, false)).toEqual({ kind: "signed-out", wipeError: null });
  expect(state.calls).toEqual(["wipe", "endSession", "forget"]);
  expect(state).toMatchObject({ session: false, remembered: null });
});

test("with unsent items, sign-out asks first with the count and changes nothing", async () => {
  const store = new MemoryStore();
  await visit(store, "waiting");
  await visit(store, "refused");
  await store.update("refused", { state: "rejected", error: "refused" });
  const { state, deps } = phone(store);
  expect(await signOutOfPhone(deps, false)).toEqual({ kind: "confirm", unsent: TWO, reason: null });
  // Cancelling is simply not asking again: the items, the session and the remembered rep are all kept.
  expect(state.calls).toEqual([]);
  expect(state).toMatchObject({ session: true, remembered: REP_A });
  expect(await store.count()).toBe(TWO);
});

test("another login's unsent items on the same phone are counted too, because the wipe removes them", async () => {
  const store = new MemoryStore();
  await visit(store, "theirs", REP_B);
  const { state, deps } = phone(store);
  expect(await signOutOfPhone(deps, false)).toEqual({ kind: "confirm", unsent: 1, reason: null });
  expect(state.calls).toEqual([]);
});

test("confirming wipes the queue and the history, ends the session and forgets the rep", async () => {
  const store = new MemoryStore();
  await visit(store, "waiting");
  await store.record({
    id: "a1",
    userId: REP_A,
    at: 1,
    fn: "log_visit",
    label: "Visit to [Dummy] Salon",
    result: "offline",
    message: "Failed to fetch",
    durationMs: 1,
  });
  const { state, deps } = phone(store);
  expect(await signOutOfPhone(deps, true)).toEqual({ kind: "signed-out", wipeError: null });
  expect(state.calls).toEqual(["wipe", "endSession", "forget"]);
  expect(await store.count()).toBe(0);
  expect(await store.history(REP_A)).toEqual([]);
  expect(state).toMatchObject({ session: false, remembered: null });
});

test("the rep is forgotten after the session ends, so a page that re-read the session meanwhile cannot leave the id behind", async () => {
  const store = new MemoryStore();
  const built = phone(store);
  const deps: SignOutDeps = {
    ...built.deps,
    endSession: async () => {
      // An open page reloads its list when the wipe is announced and remembers the still-valid session.
      built.state.remembered = REP_A;
      await built.deps.endSession();
    },
  };
  await signOutOfPhone(deps, false);
  expect(built.state.remembered).toBeNull();
});

test("when the phone cannot say whether anything is unsent, sign-out asks first and says why", async () => {
  const store = new MemoryStore();
  const { state, deps } = phone(store, { unsent: () => Promise.reject(new Error("The phone's storage refused the request.")) });
  expect(await signOutOfPhone(deps, false)).toEqual({
    kind: "confirm",
    unsent: null,
    reason: "The phone's storage refused the request.",
  });
  expect(state.calls).toEqual([]);
});

test("a wipe that fails does not keep the rep signed in, and the outcome says the phone was not cleared", async () => {
  const store = new MemoryStore();
  const { state, deps } = phone(store, { wipe: () => Promise.reject(new Error("The phone's storage refused the request.")) });
  expect(await signOutOfPhone(deps, true)).toEqual({
    kind: "signed-out",
    wipeError: "The phone's storage refused the request.",
  });
  expect(state).toMatchObject({ session: false, remembered: null });
});

test("a session that could not be ended is reported, and says truthfully whether the phone was cleared", async () => {
  const store = new MemoryStore();
  const { state, deps } = phone(store, { endSession: () => Promise.reject(new Error("no connection")) });
  expect(await signOutOfPhone(deps, false)).toEqual({ kind: "failed", message: "no connection", wiped: true });
  // Still signed in, so the rep is not forgotten: a later save out of signal must still find its owner.
  expect(state.calls).toEqual(["wipe"]);
});

test("the question names the count and says the items will never be sent", () => {
  expect(signOutQuestion({ kind: "confirm", unsent: 1, reason: null })).toBe(
    "This phone is holding 1 action that was not sent. Signing out removes it from this phone for good, and it will never be sent.",
  );
  expect(signOutQuestion({ kind: "confirm", unsent: TWO, reason: null })).toBe(
    "This phone is holding 2 actions that were not sent. Signing out removes them from this phone for good, and they will never be sent.",
  );
  expect(signOutQuestion({ kind: "confirm", unsent: null, reason: "The phone's storage refused the request." })).toBe(
    "This phone could not check for unsent work (The phone's storage refused the request.). If anything is waiting, signing out may remove it for good.",
  );
});
