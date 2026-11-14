import { retry } from "./queue";
import type { OutboxItem, OutboxStore, SyncAttempt } from "./types";

// Whose queue the phone shows and changes (P1-09, NFR-01). Saving a new action may fall back to
// the rep remembered from the last valid session, because a rep out of signal for hours must still
// be able to save. Reading the queue or the history, Retry and Discard never use that remembered
// id: they need the session this phone holds now, so nothing is shown after sign-out and nothing
// is shown to, or changed by, another login.

/** The session as the phone can read it now. */
export type Live = {
  /** The signed-in user's id, or null when no valid session can be read. */
  userId: string | null;
  /** True when a session is stored but has run out and could not be renewed (no signal). */
  unconfirmed: boolean;
};

export const NOT_SIGNED_IN = "Sign in again before saving. Nothing was saved.";
export const SIGN_IN_TO_VIEW = "Sign in to see what this phone is holding.";
export const CANNOT_CONFIRM =
  "This phone cannot confirm who is signed in right now, so the list is not shown. Nothing was removed. It shows again when the signal is back.";
export const NOT_YOURS = "That item is not in your list on this phone.";

/** Whose queue a new action goes into: the signed-in rep, else the rep remembered on this phone. */
export const captureOwner = (live: Live, remembered: string | null): string => {
  const id = live.userId ?? remembered;
  if (!id) throw new Error(NOT_SIGNED_IN);
  return id;
};

/** Who may read and change the queue: only the rep whose session the phone holds now. */
const viewer = (live: Live): string => {
  if (live.userId) return live.userId;
  throw new Error(live.unconfirmed ? CANNOT_CONFIRM : SIGN_IN_TO_VIEW);
};

/** The signed-in rep's waiting and refused items, oldest first. */
export async function listOwn(store: OutboxStore, live: Live): Promise<OutboxItem[]> {
  return store.list(viewer(live));
}

/** The signed-in rep's last sends, newest first. */
export async function historyOwn(store: OutboxStore, live: Live): Promise<SyncAttempt[]> {
  return store.history(viewer(live));
}

const own = async (store: OutboxStore, live: Live, id: string): Promise<void> => {
  const mine = await store.list(viewer(live));
  if (!mine.some((item) => item.id === id)) throw new Error(NOT_YOURS);
};

/** Makes the signed-in rep's own item due again. Another login's item is refused, whatever its id. */
export async function retryOwn(store: OutboxStore, live: Live, id: string): Promise<void> {
  await own(store, live, id);
  await retry(store, id);
}

/** Removes the signed-in rep's own item for good. Another login's item is refused, whatever its id. */
export async function discardOwn(store: OutboxStore, live: Live, id: string): Promise<void> {
  await own(store, live, id);
  await store.remove(id);
}
