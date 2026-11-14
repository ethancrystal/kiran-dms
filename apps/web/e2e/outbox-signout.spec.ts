import { expect, test } from "@playwright/test";
import { enqueue, MemoryStore } from "../lib/outbox/queue";
import { CANNOT_END, ownOutbox, type SignOutDeps, signOutOfPhone, signOutQuestion } from "../lib/outbox/sign-out";

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

const SEND = {
  id: "s1",
  userId: REP_A,
  at: 1,
  fn: "log_visit",
  label: "Visit to [Dummy] Salon",
  result: "offline",
  message: "Failed to fetch",
  durationMs: 1,
} as const;

/**
 * A phone: the store, the id it remembers, whether a session is held, and what was called, in order.
 * The wipe leaves the remembered rep alone, as the real one does: only `forget` drops it.
 */
const phone = (store: MemoryStore, overrides: Partial<SignOutDeps> = {}) => {
  const state = { remembered: REP_A as string | null, session: true, calls: [] as string[] };
  const deps: SignOutDeps = {
    unsent: () => store.count(),
    blocked: () => Promise.resolve(null),
    wipe: async () => {
      state.calls.push("wipe");
      await store.clear();
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

/** The phone wired the way the app wires it: the count and the wipe are the signing-out login's own. */
const ownPhone = (store: MemoryStore, who: string | null) =>
  phone(
    store,
    ownOutbox(
      () => Promise.resolve(store),
      () => Promise.resolve(who),
    ),
  );

test("another login's unsent items on the same phone are neither counted nor removed", async () => {
  const store = new MemoryStore();
  await visit(store, "theirs-1", REP_B);
  await visit(store, "theirs-2", REP_B);
  await store.record({ ...SEND, id: "b1", userId: REP_B });
  // Rep A has nothing unsent: no question, and rep B's held work and sends are still there afterwards.
  const { state, deps } = ownPhone(store, REP_A);
  expect(await signOutOfPhone(deps, false)).toEqual({ kind: "signed-out", wipeError: null });
  expect(state).toMatchObject({ session: false, remembered: null });
  expect((await store.list(REP_B)).map((item) => item.id)).toEqual(["theirs-1", "theirs-2"]);
  expect(await store.history(REP_B)).toHaveLength(1);
});

test("the count in the question is the signing-out login's own, and confirming removes only that login's items and sends", async () => {
  const store = new MemoryStore();
  await visit(store, "mine", REP_A);
  await visit(store, "theirs", REP_B);
  await store.record({ ...SEND, id: "a1", userId: REP_A });
  await store.record({ ...SEND, id: "b1", userId: REP_B });
  const { deps } = ownPhone(store, REP_A);
  expect(await signOutOfPhone(deps, false)).toEqual({ kind: "confirm", unsent: 1, reason: null });
  expect(await signOutOfPhone(deps, true)).toEqual({ kind: "signed-out", wipeError: null });
  expect(await store.list(REP_A)).toEqual([]);
  expect(await store.history(REP_A)).toEqual([]);
  expect((await store.list(REP_B)).map((item) => item.id)).toEqual(["theirs"]);
  expect((await store.history(REP_B)).map((a) => a.id)).toEqual(["b1"]);
});

test("with no login to sign out, nothing on the phone is counted or removed", async () => {
  const store = new MemoryStore();
  await visit(store, "theirs", REP_B);
  const { deps } = ownPhone(store, null);
  expect(await signOutOfPhone(deps, false)).toEqual({ kind: "signed-out", wipeError: null });
  expect(await store.count()).toBe(1);
});

test("the store counts and clears one login's items, sends included, and leaves the rest", async () => {
  const store = new MemoryStore();
  await visit(store, "a1", REP_A);
  await visit(store, "a2", REP_A);
  await visit(store, "b1", REP_B);
  await store.update("a2", { state: "rejected", error: "refused" });
  await store.record({ ...SEND, id: "s-a", userId: REP_A });
  await store.record({ ...SEND, id: "s-b", userId: REP_B });
  expect(await store.countOf(REP_A)).toBe(TWO);
  expect(await store.countOf(REP_B)).toBe(1);
  await store.clearOf(REP_A);
  expect(await store.countOf(REP_A)).toBe(0);
  expect(await store.history(REP_A)).toEqual([]);
  expect(await store.countOf(REP_B)).toBe(1);
  expect(await store.history(REP_B)).toHaveLength(1);
});

test("when the session cannot be ended now, nothing is asked, removed or forgotten", async () => {
  // Out of signal past the token's life: the phone can neither renew nor end the session.
  const store = new MemoryStore();
  await visit(store, "one");
  await visit(store, "two");
  const { state, deps } = phone(store, { blocked: () => Promise.resolve(CANNOT_END) });
  const outcome = { kind: "failed", message: CANNOT_END, wiped: false };
  expect(await signOutOfPhone(deps, false)).toEqual(outcome);
  // Even a rep who had already agreed to discard keeps everything.
  expect(await signOutOfPhone(deps, true)).toEqual(outcome);
  expect(state.calls).toEqual([]);
  expect(state).toMatchObject({ session: true, remembered: REP_A });
  expect(await store.count()).toBe(TWO);
});

test("when the phone cannot tell whether the session can be ended, nothing is removed", async () => {
  const store = new MemoryStore();
  await visit(store, "one");
  const { state, deps } = phone(store, { blocked: () => Promise.reject(new Error("the session could not be read")) });
  expect(await signOutOfPhone(deps, true)).toEqual({ kind: "failed", message: "the session could not be read", wiped: false });
  expect(state.calls).toEqual([]);
  expect(await store.count()).toBe(1);
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
  expect(state).toMatchObject({ session: true, remembered: REP_A });
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
