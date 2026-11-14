"use client";
import { newKey, openJson, sealJson } from "./crypto";
import { type OutboxItem, type OutboxPatch, type OutboxStore, SYNC_HISTORY_LIMIT, type SyncAttempt } from "./types";

// The rep's queue in the browser's IndexedDB (P1-09, NFR-01). What an item says (its arguments,
// its label and the database's refusal) is sealed with the rep's own key; its id, order, owner and
// state are plain so the queue can be listed and ordered. See crypto.ts for what sealing does and
// does not protect against.

const DB_NAME = "kiran-outbox";
const DB_VERSION = 2;
const ITEMS = "items";
const KEYS = "keys";
const HISTORY = "history";
const BY_ID = "id";
const BY_USER = "userId";
// Beside each user's key the key store holds a random mark, under this prefix and the user's id,
// made with the key and removed with it. A write checks the mark in its own transaction: if the
// key was wiped (and perhaps made again) since the content was sealed, the write is not made with
// the old key, which nothing could open later. A key stored before the mark existed has none.
const KEY_MARK = "mark:";
// Another tab changed the same item between this tab's read and its write; read again and reapply.
const UPDATE_TRIES = 5;

const NO_STORAGE = "This browser will not store data on the phone, so nothing can be saved for later.";
const STORAGE_FAILED = "The phone's storage refused the request.";
const UPDATE_LOST = "The waiting list changed while it was being updated. Try again.";

type Sealed = Pick<OutboxItem, "args" | "error" | "label">;
type StoredItem = Omit<OutboxItem, "args" | "error" | "label"> & { sealed: string };
type SealedAttempt = Pick<SyncAttempt, "label" | "message">;
type StoredAttempt = Omit<SyncAttempt, "label" | "message"> & { seq?: number; sealed: string };

const settled = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("error", () => reject(request.error ?? new Error(STORAGE_FAILED)));
  });

const committed = (tx: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    tx.addEventListener("complete", () => resolve());
    tx.addEventListener("error", () => reject(tx.error ?? new Error(STORAGE_FAILED)));
    tx.addEventListener("abort", () => reject(tx.error ?? new Error(STORAGE_FAILED)));
  });

/** A user's sealing key as the key store held it when it was read, with its mark. */
type HeldKey = { key: CryptoKey; mark: string | undefined };

const connection: { opening: Promise<IDBDatabase> | null } = { opening: null };

const openDb = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error(NO_STORAGE));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = request.result;
      // Version 1 made the queue and the keys; version 2 adds the sync history beside them.
      if (event.oldVersion < 1) {
        const items = db.createObjectStore(ITEMS, { keyPath: "seq", autoIncrement: true });
        items.createIndex(BY_ID, "id", { unique: true });
        items.createIndex(BY_USER, "userId");
        db.createObjectStore(KEYS);
      }
      if (event.oldVersion < 2) {
        const history = db.createObjectStore(HISTORY, { keyPath: "seq", autoIncrement: true });
        history.createIndex(BY_USER, "userId");
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      // A newer version of the app wants to upgrade the database: let it, and reopen on the next call.
      db.onversionchange = () => {
        db.close();
        connection.opening = null;
      };
      resolve(db);
    };
    request.onerror = () => reject(request.error ?? new Error(NO_STORAGE));
    request.onblocked = () => reject(new Error(NO_STORAGE));
  });

const database = async (): Promise<IDBDatabase> => {
  connection.opening ??= openDb();
  try {
    return await connection.opening;
  } catch (error) {
    connection.opening = null;
    throw error;
  }
};

/**
 * The rep's own sealing key, made on first use. Two tabs asking at once end up with the same key.
 * It is read from the phone every time and never kept in this tab's memory: another tab's sign-out
 * may have removed it, and sealing with a key the phone no longer stores makes content nobody can open.
 */
const keyFor = async (db: IDBDatabase, userId: string): Promise<HeldKey> => {
  const read = db.transaction(KEYS).objectStore(KEYS);
  const stored: CryptoKey | undefined = await settled(read.get(userId));
  const storedMark: string | undefined = await settled(read.get(KEY_MARK + userId));
  if (stored) return { key: stored, mark: storedMark };
  const fresh: HeldKey = { key: await newKey(), mark: crypto.randomUUID() };
  const tx = db.transaction(KEYS, "readwrite");
  const done = committed(tx);
  const keys = tx.objectStore(KEYS);
  const winner: CryptoKey | undefined = await settled(keys.get(userId));
  const winnerMark: string | undefined = await settled(keys.get(KEY_MARK + userId));
  if (!winner) {
    keys.put(fresh.key, userId);
    keys.put(fresh.mark, KEY_MARK + userId);
  }
  await done;
  return winner ? { key: winner, mark: winnerMark } : fresh;
};

/** Inside a write's own transaction: is `held` still this user's key, with no wipe since it was read? */
const stillHeld = async (keys: IDBObjectStore, userId: string, held: HeldKey): Promise<boolean> => {
  const present = await settled(keys.getKey(userId));
  const mark: string | undefined = await settled(keys.get(KEY_MARK + userId));
  return present !== undefined && mark === held.mark;
};

const seal = async (key: CryptoKey, item: Omit<OutboxItem, "seq">): Promise<Omit<StoredItem, "seq">> => {
  const { args, error, label, ...plain } = item;
  const content: Sealed = { args, error, label };
  return { ...plain, sealed: await sealJson(key, content) };
};

const unseal = async (key: CryptoKey, record: StoredItem): Promise<OutboxItem> => {
  const { sealed, ...plain } = record;
  const content = await openJson<Sealed>(key, sealed);
  return { ...plain, ...content };
};

const addItem = async (item: Omit<OutboxItem, "seq">, triesLeft: number): Promise<OutboxItem> => {
  if (triesLeft === 0) throw new Error(UPDATE_LOST);
  const db = await database();
  const held = await keyFor(db, item.userId);
  const record = await seal(held.key, item);
  const tx = db.transaction([ITEMS, KEYS], "readwrite");
  const done = committed(tx);
  const items = tx.objectStore(ITEMS);
  // One readwrite transaction: of two tabs adding the same id, the second finds the first's item.
  const existing: StoredItem | undefined = await settled(items.index(BY_ID).get(item.id));
  if (existing) {
    await done;
    return unseal((await keyFor(db, existing.userId)).key, existing);
  }
  if (!(await stillHeld(tx.objectStore(KEYS), item.userId, held))) {
    // The key was wiped since the item was sealed: seal it again with the key the phone holds now.
    await done;
    return addItem(item, triesLeft - 1);
  }
  const seq = await settled(items.add(record));
  await done;
  return { ...item, seq: Number(seq) };
};

const list = async (userId: string): Promise<OutboxItem[]> => {
  const db = await database();
  const records: StoredItem[] = await settled(db.transaction(ITEMS).objectStore(ITEMS).index(BY_USER).getAll(userId));
  if (records.length === 0) return [];
  const { key } = await keyFor(db, userId);
  const items = await Promise.all(records.map((record) => unseal(key, record)));
  return items.sort((a, b) => a.seq - b.seq);
};

const applyPatch = async (id: string, patch: OutboxPatch, triesLeft: number): Promise<void> => {
  if (triesLeft === 0) throw new Error(UPDATE_LOST);
  const db = await database();
  const before: StoredItem | undefined = await settled(db.transaction(ITEMS).objectStore(ITEMS).index(BY_ID).get(id));
  if (!before) return;
  const held = await keyFor(db, before.userId);
  const { seq, ...current } = await unseal(held.key, before);
  const record = { ...(await seal(held.key, { ...current, ...patch })), seq };
  const tx = db.transaction([ITEMS, KEYS], "readwrite");
  const done = committed(tx);
  const items = tx.objectStore(ITEMS);
  const now: StoredItem | undefined = await settled(items.get(seq));
  // Gone means the item was sent, discarded or wiped meanwhile: a late update must not bring it back.
  const unchanged =
    now !== undefined &&
    now.sealed === before.sealed &&
    now.state === before.state &&
    (await stillHeld(tx.objectStore(KEYS), before.userId, held));
  if (unchanged) items.put(record);
  await done;
  if (now !== undefined && !unchanged) await applyPatch(id, patch, triesLeft - 1);
};

const remove = async (id: string): Promise<void> => {
  const db = await database();
  const tx = db.transaction(ITEMS, "readwrite");
  const done = committed(tx);
  const items = tx.objectStore(ITEMS);
  const key = await settled(items.index(BY_ID).getKey(id));
  if (key !== undefined) items.delete(key);
  await done;
};

/** Saves one attempt, then drops the user's oldest beyond the limit, in the same transaction. */
const recordAttempt = async (attempt: SyncAttempt, triesLeft: number): Promise<void> => {
  if (triesLeft === 0) throw new Error(UPDATE_LOST);
  const db = await database();
  const { label, message, ...plain } = attempt;
  const content: SealedAttempt = { label, message };
  const held = await keyFor(db, attempt.userId);
  const stored: StoredAttempt = { ...plain, sealed: await sealJson(held.key, content) };
  const tx = db.transaction([HISTORY, KEYS], "readwrite");
  const done = committed(tx);
  if (!(await stillHeld(tx.objectStore(KEYS), attempt.userId, held))) {
    // The key was wiped since the attempt was sealed (a sign-out in another tab while this send ran).
    await done;
    await recordAttempt(attempt, triesLeft - 1);
    return;
  }
  const history = tx.objectStore(HISTORY);
  history.add(stored);
  const keys: IDBValidKey[] = await settled(history.index(BY_USER).getAllKeys(attempt.userId));
  // Keys come back in insertion order, oldest first.
  keys.slice(0, Math.max(0, keys.length - SYNC_HISTORY_LIMIT)).forEach((key) => {
    history.delete(key);
  });
  await done;
};

const history = async (userId: string): Promise<SyncAttempt[]> => {
  const db = await database();
  const records: StoredAttempt[] = await settled(db.transaction(HISTORY).objectStore(HISTORY).index(BY_USER).getAll(userId));
  if (records.length === 0) return [];
  const { key } = await keyFor(db, userId);
  const attempts = await Promise.all(
    records.map(async ({ seq, sealed, ...plain }) => ({
      seq: seq ?? 0,
      attempt: { ...plain, ...(await openJson<SealedAttempt>(key, sealed)) } as SyncAttempt,
    })),
  );
  return attempts.sort((a, b) => b.seq - a.seq).map((entry) => entry.attempt);
};

/** Every stored item, whoever saved it. Nothing is opened: the count needs no key. */
const count = async (): Promise<number> => {
  const db = await database();
  return settled(db.transaction(ITEMS).objectStore(ITEMS).count());
};

/** One user's stored items. Nothing is opened: the count needs no key. */
const countOf = async (userId: string): Promise<number> => {
  const db = await database();
  return settled(db.transaction(ITEMS).objectStore(ITEMS).index(BY_USER).count(userId));
};

const clear = async (): Promise<void> => {
  const db = await database();
  const tx = db.transaction([ITEMS, KEYS, HISTORY], "readwrite");
  const done = committed(tx);
  tx.objectStore(ITEMS).clear();
  tx.objectStore(HISTORY).clear();
  tx.objectStore(KEYS).clear();
  await done;
};

/** One user's items, attempts, key and mark, in one transaction. Other users' rows are not touched. */
const clearOf = async (userId: string): Promise<void> => {
  const db = await database();
  const tx = db.transaction([ITEMS, KEYS, HISTORY], "readwrite");
  const done = committed(tx);
  const items = tx.objectStore(ITEMS);
  const attempts = tx.objectStore(HISTORY);
  const keys = tx.objectStore(KEYS);
  const itemKeys: IDBValidKey[] = await settled(items.index(BY_USER).getAllKeys(userId));
  itemKeys.forEach((key) => {
    items.delete(key);
  });
  const attemptKeys: IDBValidKey[] = await settled(attempts.index(BY_USER).getAllKeys(userId));
  attemptKeys.forEach((key) => {
    attempts.delete(key);
  });
  keys.delete(userId);
  keys.delete(KEY_MARK + userId);
  await done;
};

/** Opens the phone's queue. Throws, in plain words, when the browser will not store data. */
export async function openIdbStore(): Promise<OutboxStore> {
  await database();
  return {
    add: (item) => addItem(item, UPDATE_TRIES),
    list,
    update: (id, patch) => applyPatch(id, patch, UPDATE_TRIES),
    remove,
    record: (attempt) => recordAttempt(attempt, UPDATE_TRIES),
    history,
    count,
    countOf,
    clear,
    clearOf,
  };
}
