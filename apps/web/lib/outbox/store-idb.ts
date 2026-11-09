"use client";
import { newKey, openJson, sealJson } from "./crypto";
import type { OutboxItem, OutboxPatch, OutboxStore } from "./types";

// The rep's queue in the browser's IndexedDB (P1-09, NFR-01). What an item says (its arguments,
// its label and the database's refusal) is sealed with the rep's own key; its id, order, owner and
// state are plain so the queue can be listed and ordered. See crypto.ts for what sealing does and
// does not protect against.

const DB_NAME = "kiran-outbox";
const DB_VERSION = 1;
const ITEMS = "items";
const KEYS = "keys";
const BY_ID = "id";
const BY_USER = "userId";
// Another tab changed the same item between this tab's read and its write; read again and reapply.
const UPDATE_TRIES = 5;

const NO_STORAGE = "This browser will not store data on the phone, so nothing can be saved for later.";
const STORAGE_FAILED = "The phone's storage refused the request.";
const UPDATE_LOST = "The waiting list changed while it was being updated. Try again.";

type Sealed = Pick<OutboxItem, "args" | "error" | "label">;
type StoredItem = Omit<OutboxItem, "args" | "error" | "label"> & { sealed: string };

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

const connection: { opening: Promise<IDBDatabase> | null } = { opening: null };
const keyCache = new Map<string, CryptoKey>();

const openDb = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error(NO_STORAGE));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      const items = db.createObjectStore(ITEMS, { keyPath: "seq", autoIncrement: true });
      items.createIndex(BY_ID, "id", { unique: true });
      items.createIndex(BY_USER, "userId");
      db.createObjectStore(KEYS);
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

/** The rep's own sealing key, made on first use. Two tabs asking at once end up with the same key. */
const keyFor = async (db: IDBDatabase, userId: string): Promise<CryptoKey> => {
  const cached = keyCache.get(userId);
  if (cached) return cached;
  const stored: CryptoKey | undefined = await settled(db.transaction(KEYS).objectStore(KEYS).get(userId));
  const fresh = stored ?? (await newKey());
  const tx = db.transaction(KEYS, "readwrite");
  const done = committed(tx);
  const keys = tx.objectStore(KEYS);
  const winner: CryptoKey | undefined = await settled(keys.get(userId));
  if (!winner) keys.put(fresh, userId);
  await done;
  const key = winner ?? fresh;
  keyCache.set(userId, key);
  return key;
};

const seal = async (db: IDBDatabase, item: Omit<OutboxItem, "seq">): Promise<Omit<StoredItem, "seq">> => {
  const { args, error, label, ...plain } = item;
  const content: Sealed = { args, error, label };
  return { ...plain, sealed: await sealJson(await keyFor(db, item.userId), content) };
};

const unseal = async (db: IDBDatabase, record: StoredItem): Promise<OutboxItem> => {
  const { sealed, ...plain } = record;
  const content = await openJson<Sealed>(await keyFor(db, record.userId), sealed);
  return { ...plain, ...content };
};

const add = async (item: Omit<OutboxItem, "seq">): Promise<OutboxItem> => {
  const db = await database();
  const record = await seal(db, item);
  const tx = db.transaction(ITEMS, "readwrite");
  const done = committed(tx);
  const items = tx.objectStore(ITEMS);
  // One readwrite transaction: of two tabs adding the same id, the second finds the first's item.
  const existing: StoredItem | undefined = await settled(items.index(BY_ID).get(item.id));
  if (existing) {
    await done;
    return unseal(db, existing);
  }
  const seq = await settled(items.add(record));
  await done;
  return { ...item, seq: Number(seq) };
};

const list = async (userId: string): Promise<OutboxItem[]> => {
  const db = await database();
  const records: StoredItem[] = await settled(db.transaction(ITEMS).objectStore(ITEMS).index(BY_USER).getAll(userId));
  const items = await Promise.all(records.map((record) => unseal(db, record)));
  return items.sort((a, b) => a.seq - b.seq);
};

const applyPatch = async (id: string, patch: OutboxPatch, triesLeft: number): Promise<void> => {
  if (triesLeft === 0) throw new Error(UPDATE_LOST);
  const db = await database();
  const before: StoredItem | undefined = await settled(db.transaction(ITEMS).objectStore(ITEMS).index(BY_ID).get(id));
  if (!before) return;
  const { seq, ...current } = await unseal(db, before);
  const record = { ...(await seal(db, { ...current, ...patch })), seq };
  const tx = db.transaction(ITEMS, "readwrite");
  const done = committed(tx);
  const items = tx.objectStore(ITEMS);
  const now: StoredItem | undefined = await settled(items.get(seq));
  // Gone means the item was sent or discarded meanwhile: a late update must not bring it back.
  const unchanged = now !== undefined && now.sealed === before.sealed && now.state === before.state;
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

const clear = async (): Promise<void> => {
  const db = await database();
  const tx = db.transaction([ITEMS, KEYS], "readwrite");
  const done = committed(tx);
  tx.objectStore(ITEMS).clear();
  tx.objectStore(KEYS).clear();
  keyCache.clear();
  await done;
};

/** Opens the phone's queue. Throws, in plain words, when the browser will not store data. */
export async function openIdbStore(): Promise<OutboxStore> {
  await database();
  return { add, list, update: (id, patch) => applyPatch(id, patch, UPDATE_TRIES), remove, clear };
}
