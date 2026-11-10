import { type OutboxItem, type OutboxPatch, type OutboxStore, SYNC_HISTORY_LIMIT, type SyncAttempt } from "./types";

// Queue rules over any store (P1-09, NFR-01). The rules live here so they are the same for the
// in-memory store the specs use and the encrypted IndexedDB store a phone uses.

/** What a page hands over when the rep taps: everything but the bookkeeping the queue adds. */
export type EnqueueInput = Omit<OutboxItem, "seq" | "state" | "attempts" | "nextAttemptAt" | "error">;

const copy = (item: OutboxItem): OutboxItem => ({ ...item, args: { ...item.args } });

/** A queue kept in memory. Used by the Node specs; nothing here survives a reload. */
export class MemoryStore implements OutboxStore {
  private readonly items = new Map<string, OutboxItem>();
  private lastSeq = 0;
  private attempts: SyncAttempt[] = [];

  add(item: Omit<OutboxItem, "seq">): Promise<OutboxItem> {
    const existing = this.items.get(item.id);
    if (existing) return Promise.resolve(copy(existing));
    this.lastSeq += 1;
    const saved: OutboxItem = { ...item, seq: this.lastSeq };
    this.items.set(saved.id, saved);
    return Promise.resolve(copy(saved));
  }

  list(userId: string): Promise<OutboxItem[]> {
    const mine = [...this.items.values()].filter((item) => item.userId === userId);
    return Promise.resolve(mine.sort((a, b) => a.seq - b.seq).map(copy));
  }

  update(id: string, patch: OutboxPatch): Promise<void> {
    const item = this.items.get(id);
    if (item) this.items.set(id, { ...item, ...patch });
    return Promise.resolve();
  }

  remove(id: string): Promise<void> {
    this.items.delete(id);
    return Promise.resolve();
  }

  record(attempt: SyncAttempt): Promise<void> {
    this.attempts.push({ ...attempt });
    const mine = this.attempts.filter((other) => other.userId === attempt.userId);
    const surplus = mine.length - SYNC_HISTORY_LIMIT;
    if (surplus > 0) {
      const drop = new Set(mine.slice(0, surplus));
      this.attempts = this.attempts.filter((other) => !drop.has(other));
    }
    return Promise.resolve();
  }

  history(userId: string): Promise<SyncAttempt[]> {
    const mine = this.attempts.filter((attempt) => attempt.userId === userId);
    return Promise.resolve(mine.reverse().map((attempt) => ({ ...attempt })));
  }

  clear(): Promise<void> {
    this.items.clear();
    this.attempts = [];
    return Promise.resolve();
  }
}

/**
 * Puts a captured action in the queue. The same id twice keeps the first item: a double tap or a
 * second tab must not make two. An item that depends on another is refused unless that other item
 * is waiting in this rep's queue, because it could never be sent.
 */
export async function enqueue(store: OutboxStore, input: EnqueueInput): Promise<OutboxItem> {
  const parentId = input.dependsOn?.itemId;
  if (parentId !== undefined) {
    const mine = await store.list(input.userId);
    if (!mine.some((item) => item.id === parentId)) {
      throw new Error(`"${input.label}" depends on an item that is not waiting on this phone.`);
    }
  }
  return store.add({ ...input, state: "pending", attempts: 0, nextAttemptAt: 0, error: null });
}

/** The user's pending items whose time to be tried has come, oldest first. */
export async function dueItems(store: OutboxStore, userId: string, now: number): Promise<OutboxItem[]> {
  const mine = await store.list(userId);
  return mine.filter((item) => item.state === "pending" && item.nextAttemptAt <= now);
}

/** Makes an item due again, with the same id, so the database sees the same request (H-08). */
export async function retry(store: OutboxStore, id: string): Promise<void> {
  await store.update(id, { state: "pending", nextAttemptAt: 0, error: null });
}

/** How many of the user's items still wait to be sent. Rejected items are not counted. */
export async function pendingCount(store: OutboxStore, userId: string): Promise<number> {
  const mine = await store.list(userId);
  return mine.filter((item) => item.state === "pending").length;
}
