"use client";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { captureOwner, discardOwn, historyOwn, holder, type Live, listOwn, retryOwn, storedSessionUser } from "./access";
import { type DrainReport, drain } from "./drain";
import { enqueue } from "./queue";
import { CANNOT_END, ownOutbox, type SignOutOutcome, signOutOfPhone } from "./sign-out";
import { openIdbStore } from "./store-idb";
import type { Dependency, OutboxFn, OutboxItem, SyncAttempt } from "./types";

// The rep app's way to save an action (P1-09, NFR-01): `submit` writes it to the phone first and
// then tries to send it. With signal the rep gets the database's answer at once; without, the item
// waits and `startSync` sends it when the signal is back. Either way the database is reached only
// through the item's own app.* function, as the signed-in rep on the approved phone (H-08).

const USER_KEY = "kiran.outbox.user";
const DRAIN_LOCK = "kiran.outbox.drain";
const CHANNEL = "kiran.outbox";
const SYNC_INTERVAL_MS = 30_000;
// A request that hangs on a weak signal would hold the queue: give up and try again later.
const SEND_TIMEOUT_MS = 20_000;
// How long a form waits for the first answer before it says "saved on this phone".
const SUBMIT_WAIT_MS = 4_000;

export type SubmitInput = {
  /** The action's client_id (`p_id` for create_salon), made when the rep taps. */
  id: string;
  fn: OutboxFn;
  args: Record<string, unknown>;
  label: string;
  salonId: string | null;
  /** When the rep tapped, as an ISO string. */
  capturedAt: string;
  dependsOn?: Dependency;
};

/** What the status line shows. `held` "auth" means the rep must sign in again or have the phone approved. */
export type SyncState = { held: DrainReport["held"]; lastSyncAt: number | null; error: string | null };

/** A failed send, carrying what `classifyFailure` reads. */
class SendFailure extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const listeners = new Set<() => void>();
const local: { state: SyncState; draining: Promise<DrainReport> | null; channel: BroadcastChannel | null } = {
  state: { held: "none", lastSyncAt: null, error: null },
  draining: null,
  channel: null,
};

const tellListeners = () => {
  listeners.forEach((listener) => {
    listener();
  });
};

/** Other tabs of the app on this phone show the same waiting list. */
const channel = (): BroadcastChannel | null => {
  if (typeof BroadcastChannel === "undefined") return null;
  if (!local.channel) {
    local.channel = new BroadcastChannel(CHANNEL);
    local.channel.onmessage = tellListeners;
  }
  return local.channel;
};

const changed = (state: Partial<SyncState> = {}) => {
  local.state = { ...local.state, ...state };
  tellListeners();
  channel()?.postMessage("changed");
};

const offline = (): boolean => typeof navigator !== "undefined" && navigator.onLine === false;

/** The sign-in library's own store and the name it keeps the session under. Not in its public types. */
type SessionStore = { storage?: { getItem(key: string): unknown }; storageKey?: string };

/**
 * Whose session the sign-in library still stores, read from that stored session without asking it
 * to renew anything. Null when nothing is stored or it cannot be read: the caller then treats the
 * phone as holding nobody, the closed side.
 */
const storedUser = async (): Promise<string | null> => {
  try {
    const { storage, storageKey } = supabaseBrowser().auth as unknown as SessionStore;
    if (!storage || !storageKey) return null;
    const raw = await storage.getItem(storageKey);
    return storedSessionUser(typeof raw === "string" ? raw : null);
  } catch {
    return null;
  }
};

/**
 * The session kept on the phone; no request is made while it is valid. A session that has run out
 * is renewed over the network, and with no signal that fails: the phone then still stores it but
 * cannot confirm it (`unconfirmed`), and `storedUserId` says whose it is. After sign-out there is
 * neither an id nor an error. `token` is the confirmed session's access token.
 */
export const heldSession = async (): Promise<Live & { storedUserId: string | null; token: string | null }> => {
  const { data, error } = await supabaseBrowser().auth.getSession();
  const userId = data.session?.user.id ?? null;
  if (userId) window.localStorage.setItem(USER_KEY, userId);
  const unconfirmed = !userId && Boolean(error);
  return {
    userId,
    unconfirmed,
    storedUserId: unconfirmed ? await storedUser() : null,
    token: data.session?.access_token ?? null,
  };
};

const liveSession: () => Promise<Live> = heldSession;

const sessionUserId = async (): Promise<string | null> => (await liveSession()).userId;

/**
 * Whose queue a new item goes into. Out of signal for hours the session cannot be renewed: the
 * stored session's own login is used, and only when even that cannot be read, the id remembered
 * from the last time it was valid. Only saving falls back to the remembered id: reading, Retry and
 * Discard need the session the phone holds (access.ts), and sending always needs it confirmed.
 */
const captureUserId = async (): Promise<string> => captureOwner(await liveSession(), window.localStorage.getItem(USER_KEY));

const forgetRep = (): void => {
  try {
    window.localStorage.removeItem(USER_KEY);
  } catch {
    // A browser that blocks this storage never remembered the rep either.
  }
};

const send = async (fn: OutboxFn, args: Record<string, unknown>): Promise<unknown> => {
  const call = supabaseBrowser().schema("app").rpc(fn, args);
  const { data, error, status } = await ("timeout" in AbortSignal
    ? call.abortSignal(AbortSignal.timeout(SEND_TIMEOUT_MS))
    : call);
  if (error) throw new SendFailure(error.message, error.code, status);
  return data;
};

/** One drain at a time across this phone's tabs. A browser without the lock still has the in-tab guard below. */
const withDrainLock = async <T>(run: () => Promise<T>): Promise<T | "busy"> => {
  if (!("locks" in navigator)) return run();
  return navigator.locks.request(DRAIN_LOCK, { ifAvailable: true }, (lock) => (lock ? run() : "busy"));
};

const runDrain = async (): Promise<DrainReport> => {
  const userId = await sessionUserId();
  if (!userId) return { sent: 0, rejected: 0, held: offline() ? "offline" : "auth" };
  const store = await openIdbStore();
  return drain({ store, userId, send, now: Date.now, newId: () => crypto.randomUUID(), lock: withDrainLock });
};

/** Sends what can be sent now. Calls that overlap in this tab share one pass. */
export async function sync(): Promise<DrainReport> {
  if (local.draining) return local.draining;
  local.draining = runDrain();
  try {
    const report = await local.draining;
    changed({ held: report.held, error: null, ...(report.held === "none" ? { lastSyncAt: Date.now() } : {}) });
    return report;
  } catch (error) {
    changed({ error: error instanceof Error ? error.message : "The waiting list could not be read." });
    throw error;
  } finally {
    local.draining = null;
  }
}

const quietSync = async (): Promise<void> => {
  try {
    await sync();
  } catch {
    // Already recorded in the sync state for the status line; a background pass has no one to tell.
  }
};

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Saves an action on the phone, then tries to send it.
 *   "sent":     the database accepted it.
 *   "queued":   it is saved on this phone and will be sent when the signal is back.
 *   "rejected": the database refused it; it is kept under "Needs attention" with the reason.
 * Throws when the phone could not store it, so a page never says "saved" for something that is not.
 */
export async function submit(input: SubmitInput): Promise<"sent" | "queued" | "rejected"> {
  const userId = await captureUserId();
  const store = await openIdbStore();
  await enqueue(store, { ...input, userId, dependsOn: input.dependsOn ?? null });
  changed();
  if (offline()) return "queued";
  await Promise.race([quietSync(), wait(SUBMIT_WAIT_MS)]);
  const mine = await store.list(userId);
  const item = mine.find((other) => other.id === input.id);
  if (!item) return "sent";
  return item.state === "rejected" ? "rejected" : "queued";
}

/** The signed-in rep's waiting and refused items, oldest first. Shows nothing without the session itself. */
export async function listItems(): Promise<OutboxItem[]> {
  const live = await liveSession();
  return listOwn(await openIdbStore(), live);
}

/**
 * The signed-in rep's last 50 send attempts, newest first, whether they worked or not. It shows
 * when the phone last reached the server and what the server or the network said when it did not.
 */
export async function syncHistory(): Promise<SyncAttempt[]> {
  const live = await liveSession();
  return historyOwn(await openIdbStore(), live);
}

/** Sends the signed-in rep's own refused or waiting item again, as the same request. */
export async function retryItem(id: string): Promise<void> {
  const live = await liveSession();
  await retryOwn(await openIdbStore(), live, id);
  changed();
  await quietSync();
}

/** Removes the signed-in rep's own item for good. The page asks the rep to confirm before calling this. */
export async function discardItem(id: string): Promise<void> {
  const live = await liveSession();
  await discardOwn(await openIdbStore(), live, id);
  changed();
}

export const syncState = (): SyncState => local.state;

/** Calls `listener` whenever the waiting list or the sync state changes, in this tab or another. */
export function subscribe(listener: () => void): () => void {
  channel();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Keeps the queue moving while the app is open: when the signal comes back, when the app comes to
 * the front, and every 30 seconds. Returns the function that stops it.
 */
export function startSync(): () => void {
  const kick = () => {
    void quietSync();
  };
  const onVisible = () => {
    if (document.visibilityState === "visible") kick();
  };
  window.addEventListener("online", kick);
  document.addEventListener("visibilitychange", onVisible);
  const timer = window.setInterval(kick, SYNC_INTERVAL_MS);
  // Ask the browser not to clear this site's storage when the phone runs short of space.
  void navigator.storage?.persist?.();
  kick();
  return () => {
    window.removeEventListener("online", kick);
    document.removeEventListener("visibilitychange", onVisible);
    window.clearInterval(timer);
  };
}

/** The login whose session the phone holds: the one that is signing out. */
const signingOut = async (): Promise<string | null> => holder(await liveSession());

/**
 * Removes what the outbox keeps on this phone for the login that is signing out, and nothing of
 * any other login's. Called by sign-out only (`signOutRep`), which asks the rep first when anything
 * of theirs is unsent. The remembered rep is dropped by sign-out itself, once the session has ended.
 */
async function wipeOwnData(): Promise<void> {
  await ownOutbox(openIdbStore, signingOut).wipe();
  changed({ held: "none", lastSyncAt: null, error: null });
}

/**
 * Why the session cannot be ended now, or null. A session that ran out with no signal can be
 * neither renewed nor ended: the sign-in library keeps it and returns the same error from sign-out.
 */
const cannotEnd = async (): Promise<string | null> => ((await liveSession()).unconfirmed ? CANNOT_END : null);

/** Ends the session on this phone. Throws when a session is still held afterwards. */
const endSession = async (): Promise<void> => {
  const auth = supabaseBrowser().auth;
  const { error } = await auth.signOut();
  if (!error) return;
  // With no signal the server cannot be told, but the phone's own copy is normally removed anyway.
  const after = await auth.getSession();
  if (after.data.session || after.error) throw new Error(error.message);
};

/**
 * Signs the rep out of this phone: wipes what the outbox keeps for that rep, then ends the session.
 * With unsent items of their own (or when the phone cannot count them) the first call only returns
 * "confirm"; call again with `discardUnsent` true once the rep has agreed to lose them. When the
 * session cannot be ended now, nothing is removed and the outcome says why.
 */
export function signOutRep(discardUnsent: boolean): Promise<SignOutOutcome> {
  return signOutOfPhone(
    {
      unsent: ownOutbox(openIdbStore, signingOut).unsent,
      blocked: cannotEnd,
      wipe: wipeOwnData,
      endSession,
      forget: forgetRep,
    },
    discardUnsent,
  );
}
