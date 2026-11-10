// The rep's offline outbox (P1-09, NFR-01). Every captured action is written to a queue on the
// phone first and sent through its existing app.* function afterwards, with the client_id it was
// captured with: the database is already idempotent on that key (H-08), so a repeat is harmless.

/** How a failed send is treated. Nothing is ever dropped: see `classifyFailure`. */
export type Failure = "transient" | "auth" | "rejected";

/** The app.* functions the outbox may queue (plan decision 1). Anything else stays online only. */
export type OutboxFn =
  | "rep_check_in"
  | "record_count"
  | "rep_check_out"
  | "log_visit"
  | "add_salon_note"
  | "create_salon"
  | "rep_create_card"
  | "rep_record_payment"
  | "record_demand"
  | "rep_submit_delivery"
  | "rep_attach_signature";

/** An item that needs an earlier item's result: `args[argName]` is filled from the parent's returned `id`. */
export type Dependency = { itemId: string; argName: string };

export type OutboxItem = {
  /** The action's client_id (`p_id` for create_salon). The same value goes to the database on every attempt. */
  id: string;
  /** Capture order on this phone. Items are sent in this order. */
  seq: number;
  /** The signed-in rep who captured it. A queue is never listed or sent for another user. */
  userId: string;
  fn: OutboxFn;
  args: Record<string, unknown>;
  /** What the rep sees in the waiting list, for example "Visit". */
  label: string;
  salonId: string | null;
  /** When the rep tapped, as an ISO string. Never rewritten. */
  capturedAt: string;
  dependsOn: Dependency | null;
  /** `pending` waits to be sent; `rejected` was refused by the database and waits for the rep. */
  state: "pending" | "rejected";
  /** Sends that failed for a passing reason (no signal, server busy). */
  attempts: number;
  /** Epoch milliseconds before which the item is not tried again. */
  nextAttemptAt: number;
  /** The database's own words for a rejected item. */
  error: string | null;
};

export type OutboxPatch = Partial<Pick<OutboxItem, "args" | "state" | "attempts" | "nextAttemptAt" | "error">>;

/**
 * Where the queue is kept. `MemoryStore` (queue.ts) is used by the Node specs; the encrypted
 * IndexedDB store (store-idb.ts) is the one a phone uses.
 */
export interface OutboxStore {
  /** Saves a new item and gives it the next `seq`. If the id is already stored, returns that item unchanged. */
  add(item: Omit<OutboxItem, "seq">): Promise<OutboxItem>;
  /** One user's items, oldest first. */
  list(userId: string): Promise<OutboxItem[]>;
  update(id: string, patch: OutboxPatch): Promise<void>;
  remove(id: string): Promise<void>;
  /** Removes everything, for every user (sign-out and device revoke). */
  clear(): Promise<void>;
}
