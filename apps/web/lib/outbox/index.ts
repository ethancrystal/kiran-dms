"use client";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { type DrainReport, drain } from "./drain";
import { enqueue, retry } from "./queue";
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

const NOT_SIGNED_IN = "Sign in again before saving. Nothing was saved.";
const SIGN_IN_TO_VIEW = "Sign in to see what this phone is holding.";

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

/** The signed-in user's id, read from the session kept on the phone; no request is made while it is valid. */
const sessionUserId = async (): Promise<string | null> => {
  const { data } = await supabaseBrowser().auth.getSession();
  const id = data.session?.user.id ?? null;
  if (id) window.localStorage.setItem(USER_KEY, id);
  return id;
};

/**
 * Whose queue a new item goes into. Out of signal for hours the session cannot be renewed, so the
 * id remembered from the last time it was valid is used. Sending always needs the real session.
 */
const captureUserId = async (whenUnknown = NOT_SIGNED_IN): Promise<string> => {
  const id = (await sessionUserId()) ?? window.localStorage.getItem(USER_KEY);
  if (!id) throw new Error(whenUnknown);
  return id;
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

/** The signed-in rep's waiting and refused items, oldest first. */
export async function listItems(): Promise<OutboxItem[]> {
  const store = await openIdbStore();
  return store.list(await captureUserId(SIGN_IN_TO_VIEW));
}

/**
 * The signed-in rep's last 50 send attempts, newest first, whether they worked or not. It shows
 * when the phone last reached the server and what the server or the network said when it did not.
 */
export async function syncHistory(): Promise<SyncAttempt[]> {
  const store = await openIdbStore();
  return store.history(await captureUserId(SIGN_IN_TO_VIEW));
}

/** Sends a refused or waiting item again, as the same request. */
export async function retryItem(id: string): Promise<void> {
  await retry(await openIdbStore(), id);
  changed();
  await quietSync();
}

/** Removes an item for good. The page asks the rep to confirm before calling this. */
export async function discardItem(id: string): Promise<void> {
  const store = await openIdbStore();
  await store.remove(id);
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

/** Removes everything the outbox keeps on this phone, for every user (sign-out and device revoke). */
export async function wipeLocalData(): Promise<void> {
  const store = await openIdbStore();
  await store.clear();
  window.localStorage.removeItem(USER_KEY);
  changed({ held: "none", lastSyncAt: null, error: null });
}
