# P1-09 Offline Rep App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** DRAFT FOR MJ REVIEW. Written 2026-11-08 against `origin/main` `4e0c690`; revised 2026-11-09 with MJ's answers (below). Nothing here has been run. Status of the task itself lives only on the board (`docs/ACTIVITY.md` section 12, row P1-09, NOT STARTED).

**Before building:** the executor follows the build protocol in `CLAUDE.md` (read `docs/ACTIVITY.md` and the 20 newest `docs/log/` entries, run `pnpm agent:preflight`, keep one log entry per PR, never work on `main`). Checked 2026-11-08: preflight passed, and hard rules H-08, H-18, H-19, H-25, H-27 and decisions D-42, D-49 say what this plan relies on them to say.

**Departure from the repository map:** `CLAUDE.md` lists `packages/shared` (generated database types, validation schemas) as "first needed by the offline PWA, P1-09". This plan does not build it: the outbox needs only the argument shapes of the RPCs below, which the pages already pass untyped. Generated types belong to the frontend foundation (F1, F2 in `2026-11-05-frontend-structure.md`). Changing that is a DEVIATION entry (H-25) and MJ's call.

**Goal:** A rep can run a whole day with no signal, from check-in to check-out, capturing visits, notes, prospects, order-intake cards, payments, lost demand and deliveries with the customer's signature. Every item reaches the database within 60 s of reconnecting on the day it was captured, or is shown to the rep with the database's own refusal.

**Architecture:** Write-ahead outbox. Every captured action is written to an encrypted IndexedDB queue first, then one serialised drain sends it through the existing `app.*` RPC with its original `client_id` (the server is already idempotent on that key, H-08). One server change is needed: the rep's day, and the bag figure expected at check-in, must come from the captured time, within a bounded window, instead of from the moment the server receives the call (Task 1). Pure logic is tested in Node behind an injected store and sender; the IndexedDB store and the service worker are proven by one real-stack browser journey.

**Tech Stack:** Next 16 app router, React 19, `@supabase/supabase-js`, native IndexedDB and WebCrypto (no new dependency), Postgres migration plus Vitest in `supabase/tests`, Playwright (`apps/web/e2e` for Node specs, `apps/web/e2e-stack` for the real-stack journey).

**Spec:** `docs/03-requirements.md` (NFR-01, NFR-02, NFR-04, SAL-13, PIP-07, PIP-09, MAP-02, DEM-01), `docs/16-project-completion-goal.md` ("offline Rep functionality preserved"), `docs/audit-2026-10-31/security-nfr-webapp.md` section 2.3, `docs/ACTIVITY.md` rows P1-09 and B-20.

## MJ's answers (chat, 2026-11-09)

| Question | Answer | Effect on this plan |
|---|---|---|
| Deliveries and the salon signature offline? | Yes, queue them | Tasks 3, 4, 9: a queue item can depend on an earlier item's result. |
| Check-in and check-out queueable? | Yes, queue them | Task 1: server derives the day from the captured time. Needs a DEVIATION (H-25). |
| Office view of rejections made on a phone? | Yes, after the pilot starts | Not in this plan; see non-goals. |
| Next plan to draft | P1-12 | Separate plan. |

## Global Constraints

- NFR-01: "Visits, rep order requests, payments, prospects can be captured with no connectivity and sync within 60 s of reconnecting; conflicts resolved server-side with the rep notified of any rejection".
- NFR-02: "bundle under 300 KB gzipped for the rep app shell"; "interactions ≤ 200 ms locally". `e2e/rep-login.spec.ts` already asserts the bundle size and must stay green.
- English only (D-42, NFR-03). No i18n layer.
- Writes go only through `app.*` RPCs (H-08); never a table write, never a service-role key in the client (H-18, NFR-07).
- One `client_id` per intent, kept until the database accepts it or the rep discards it.
- Capture time (`p_*_at_client`) is taken when the rep taps, never when the queue drains.
- Database convention "server time authoritative (`now()`); client timestamps in `*_client` columns" is bent only as Task 1 states, and recorded as a DEVIATION.
- Migrations are forward-only; MJ applies them to the Kiran project (H-19). The CI stack applies them to a throwaway database.
- One branch and one pull request per row of the PR split, each merged before the next; no stacked PRs.

## Decisions this plan makes (change them before building if you disagree)

| # | Decision | Why |
|---|---|---|
| 1 | In scope: `rep_check_in`, `rep_check_out` with `record_count` (daily close), `log_visit`, `add_salon_note`, `create_salon`, `rep_create_card`, `rep_record_payment`, `record_demand`, `rep_submit_delivery`, `rep_attach_signature`. Out of scope, online only: stock issue confirmation, handover responses, card edits. | NFR-01's list, plus MJ's two answers. |
| 2 | Write-ahead for every action (one code path), not "try online, queue on failure". | One path to test. The rep sees the result of the first drain attempt. |
| 3 | Queue and read cache are encrypted at rest with a non-extractable AES-GCM key in IndexedDB, wiped on sign-out and device revoke. **Limit, stated plainly:** this stops casual export and stray backups, not someone using the unlocked browser profile. The real controls are the approved device and the session. | docs/05 L68 asks for an encrypted cache. |
| 4 | A rejected item is never dropped. It stays under "Needs attention" with the database's words; the rep can Retry (same `client_id`) or Discard (after confirming). | NFR-01 "notified of any rejection". |
| 5 | The server may move a record earlier than receipt by at most **48 hours**, never later (a future time counts as now). The value is a proposal for MJ to approve. | Bounded trust in the phone's clock: enough for a day lost in a basement, too little to rewrite last week. |
| 6 | A queue item may depend on an earlier item's result (`dependsOn`). A signature waits for its delivery; if the delivery is refused, the signature is marked refused too and never sent alone. | `rep_attach_signature` needs the submission id the server creates. |
| 7 | An offline payment shows "Saved on this phone, receipt after it sends" (CTL-01). Default unless MJ says otherwise. | A receipt is a server record. |

## Review Focus

- Two tabs open on one phone: each item is sent once, not twice.
- Work captured before midnight Karachi that syncs after it lands on its captured day, not on the day of receipt.
- A phone clock a week slow is refused with the database's reason; a clock in the future cannot push a record later than receipt.
- Check-in counted offline, office posts stock to the bag before sync: no false variance (the expected figure is as of the captured time).
- A second rep signs in on the same phone: cannot see or send the first rep's queue.
- Storage blocked, full or unavailable: capture fails loudly instead of showing "Saved".
- Device revoked or session expired mid-queue: items are held and the rep is told; nothing is discarded.
- Delivery refused by the server: its queued signature is refused with it, never sent alone.

## File structure

| File | Responsibility |
|---|---|
| `supabase/migrations/20261109000000_offline_capture_day.sql` | Captured-time day and as-of bag figure (Task 1). |
| `supabase/tests/offline-capture.test.ts` | Role and attack tests for Task 1. |
| `apps/web/lib/outbox/types.ts` | Shared types and the `OutboxStore` interface. |
| `apps/web/lib/outbox/classify.ts` | Maps an RPC failure to `transient`, `auth` or `rejected`. |
| `apps/web/lib/outbox/queue.ts` | `MemoryStore` and queue rules over any store. |
| `apps/web/lib/outbox/drain.ts` | One serialised drain pass with backoff and dependencies. |
| `apps/web/lib/outbox/crypto.ts`, `store-idb.ts`, `index.ts` | Encryption, IndexedDB store, `submit()`, `startSync()`, `wipeLocalData()`. |
| `apps/web/lib/cache.ts` | `cachedRows()` read cache for offline lists. |
| `apps/web/components/outbox-status.tsx` | Waiting count, last sync, Needs attention list. |
| `apps/web/public/sw.js`, `apps/web/app/manifest.ts`, `apps/web/lib/register-sw.ts` | Service worker and PWA manifest. |
| `apps/web/e2e/outbox-*.spec.ts`, `apps/web/e2e-stack/offline.spec.ts` | Node specs and the real-stack journey. |

## PR split

| PR | Tasks | Visible to reps? | Needs from MJ |
|---|---|---|---|
| S | 1 | No (server only, old calls behave as before) | Approve the 48 h window; apply the migration to the Kiran project (H-19). |
| A | 2 to 5 (outbox core) | No | — |
| B | 6 (offline shell) | Installable app | Go/no-go if the spike fails. |
| C | 7 to 9 (cache, all actions, journey) | Yes | — |
| D | 10, 11 (device fixes, wipe, records) | Yes | — |

---

### Task 1: Server derives the day from the captured time

**Files:**
- Create: `supabase/migrations/20261109000000_offline_capture_day.sql` (version must sort after the newest file in `supabase/migrations`; check before naming), `supabase/tests/offline-capture.test.ts`
- Modify (by redefining in the new migration, never editing a merged file): `app.my_open_day_id`, `app.rep_check_in`, `app.rep_check_out`, `app.log_visit`, `app.rep_record_payment`, `app.rep_submit_delivery`, `app.record_demand`, `app.record_count`. Read each current definition first: the newest one wins (several were redefined in `20261105230000_audit_fixes.sql`).

**Interfaces:**
- Produces:
  - `app.capture_day(p_at timestamptz) returns date`: the Karachi calendar date of `least(coalesce(p_at, now()), now())`. Raises `22023` "the captured time is too old to sync (48 hours)" when `p_at < now() - interval '48 hours'`. A time in the future counts as now.
  - `app.my_open_day_id(p_at timestamptz default null) returns uuid`: the rep's open day whose `day = app.capture_day(p_at)`.
  - `app.on_hand_as_of(p_location uuid, p_sku uuid, p_at timestamptz) returns integer`: bag quantity counting only movements created at or before `p_at`.
- Each function above passes its existing `p_*_at_client` argument into these helpers; a null argument behaves exactly as today. `rep_check_in` inserts the day from `app.capture_day(p_at_client)` and its "an earlier day is still open" test compares against that date. `rep_check_in` and `record_count` compute the expected figure with `app.on_hand_as_of`. `rep_check_out` finds the day by `app.capture_day(p_at_client)`.

- [ ] **Step 1: Write the failing tests** in `offline-capture.test.ts`, reusing the existing harness helpers (see `supabase/tests/visits.test.ts` and `deliveries.test.ts` for rep and day fixtures), each as a real signed-in rep:
  - A visit captured on the previous Karachi day, received after midnight while that day is still open, lands on the previous day (`visit.rep_day_id` equals that day's id).
  - A captured time 49 hours old is refused with `22023`; 47 hours is accepted.
  - A captured time one day in the future lands on today.
  - Calls with `p_arrived_at_client` null or equal to now behave as before (existing suites stay green: `pnpm db:test`).
  - A visit captured against a day that was closed is refused with the existing "check in before logging visits" message.
  - A queued check-in for yesterday does not take today's slot; today's check-in is then refused by the existing "earlier day still open" rule until yesterday's check-out is applied, and succeeds after.
  - Expected bag figure: counted at 08:00, an office stock issue posted at 12:00, check-in received at 14:00 with `p_at_client` 08:00 records `bag_variance_units = 0`.
  - Replay: the same `client_id` twice returns the same row for visit, payment, delivery and count.
  - Anonymous, an office user and another rep calling any of these are refused as today.
- [ ] **Step 2: Run** `pnpm db:test supabase/tests/offline-capture.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** the migration. For `app.on_hand_as_of`, filter `stock_movement` by `created_at <= p_at` the same way `app.on_hand` sums movements.
- [ ] **Step 4: Run** the new test and then the whole suite with `pnpm db:test` — Expected: PASS, no existing test changed.
- [ ] **Step 5: Records in the same PR:** a DEVIATION entry (the convention "server time authoritative" is bent, bounded to 48 h, earlier only), the doc line in `docs/06-security-plan.md` or `docs/04-domain-model.md` that states the convention, and a log entry with the test counts. Do not apply the migration to any hosted project (H-19).
- [ ] **Step 6: Commit** `rep day follows the captured time within 48 hours (P1-09 server half)`. Open PR S.

### Task 2: Failure classification

**Files:**
- Create: `apps/web/lib/outbox/types.ts`, `apps/web/lib/outbox/classify.ts`
- Test: `apps/web/e2e/outbox-classify.spec.ts`

**Interfaces:**
- Produces: `type Failure = "transient" | "auth" | "rejected"`; `classifyFailure(error: unknown): Failure`.

- [ ] **Step 1: Read the exact strings.** Open `app.assert_actor_ready` and `app.raise_denied` in `supabase/migrations/20261024232225_device_hardening.sql` and `20261024223304_foundation.sql`; copy the device-not-approved and device-revoked messages into the test.
- [ ] **Step 2: Write the failing spec**, one assertion per case:
  - `new TypeError("Failed to fetch")` is `transient`.
  - `{ status: 503 }`, `{ status: 429 }`, `{ status: 408 }` are `transient`.
  - `{ status: 401 }` and the device-not-approved message with `code: "42501"` are `auth`.
  - `{ code: "42501", message: "check in before logging visits (PIP-09)" }` is `rejected`.
  - `{ code: "22023" }`, `{ code: "23505" }`, `{ code: "23514" }`, `{ code: "55000" }` are `rejected`.
  - An unknown shape is `transient` (fail safe: keep the item, never discard).
- [ ] **Step 3: Run** `pnpm -C apps/web test:e2e e2e/outbox-classify.spec.ts` — Expected: FAIL (module missing).
- [ ] **Step 4: Implement** `classifyFailure`; supabase-js puts the SQLSTATE in `error.code` and the HTTP status in `status`.
- [ ] **Step 5: Run again** — Expected: PASS.
- [ ] **Step 6: Commit** `outbox: classify RPC failures`.

### Task 3: Queue rules and the store contract

**Files:**
- Create: `apps/web/lib/outbox/queue.ts` (types go in `types.ts`)
- Test: `apps/web/e2e/outbox-queue.spec.ts`

**Interfaces:**
- Produces, in `types.ts`:
  - `type OutboxFn = "rep_check_in" | "record_count" | "rep_check_out" | "log_visit" | "add_salon_note" | "create_salon" | "rep_create_card" | "rep_record_payment" | "record_demand" | "rep_submit_delivery" | "rep_attach_signature"`
  - `type OutboxItem = { id: string; seq: number; userId: string; fn: OutboxFn; args: Record<string, unknown>; label: string; salonId: string | null; capturedAt: string; dependsOn: { itemId: string; argName: string } | null; state: "pending" | "rejected"; attempts: number; nextAttemptAt: number; error: string | null }` where `id` is the item's `client_id` (`p_id` for `create_salon`).
  - `interface OutboxStore { add(item: Omit<OutboxItem, "seq">): Promise<OutboxItem>; list(userId: string): Promise<OutboxItem[]>; update(id: string, patch: Partial<Pick<OutboxItem, "args" | "state" | "attempts" | "nextAttemptAt" | "error">>): Promise<void>; remove(id: string): Promise<void>; clear(): Promise<void> }`
- Produces, in `queue.ts`: `class MemoryStore implements OutboxStore`; `enqueue(store, input: Omit<OutboxItem, "seq" | "state" | "attempts" | "nextAttemptAt" | "error">): Promise<OutboxItem>`; `dueItems(store, userId: string, now: number): Promise<OutboxItem[]>`; `retry(store, id: string): Promise<void>`; `pendingCount(store, userId: string): Promise<number>`.

- [ ] **Step 1: Write the failing spec**, one test per rule:
  - `enqueue` assigns increasing `seq`; `list` returns oldest first.
  - Enqueueing the same `id` twice keeps one item (the second call returns the first).
  - `dueItems` returns only `pending` items whose `nextAttemptAt <= now`, for that `userId` only.
  - `retry` turns a `rejected` item back to `pending` with `nextAttemptAt = 0`, keeping its `id`.
  - `capturedAt` is stored exactly as given and never rewritten.
  - An item with `dependsOn` is rejected by `enqueue` if the named parent is not in the store.
- [ ] **Step 2: Run** `pnpm -C apps/web test:e2e e2e/outbox-queue.spec.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** the functions above. `list` sorts by `seq`.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `outbox: queue rules over an injected store`.

### Task 4: The drain loop

**Files:**
- Create: `apps/web/lib/outbox/drain.ts`
- Test: `apps/web/e2e/outbox-drain.spec.ts`

**Interfaces:**
- Consumes: Task 2 `classifyFailure`; Task 3 `OutboxStore`, `dueItems`.
- Produces: `type DrainDeps = { store: OutboxStore; userId: string; send: (fn: OutboxFn, args: Record<string, unknown>) => Promise<unknown>; now: () => number; lock: <T>(run: () => Promise<T>) => Promise<T | "busy"> }`; `type DrainReport = { sent: number; rejected: number; held: "none" | "offline" | "auth" }`; `drain(deps: DrainDeps): Promise<DrainReport>`.
- Backoff after a transient failure: `nextAttemptAt = now + min(5_000 * 2 ** attempts, 30_000)`, so a reconnect is picked up well inside 60 s.
- Dependencies: when an item with dependents is sent, each dependent's `args[argName]` is set to the `id` field of the RPC result and saved before the dependent is sent. A dependent whose parent is `rejected` becomes `rejected` with the error "its delivery was refused: " followed by the parent's error.

- [ ] **Step 1: Write the failing spec** with a fake `send` and a counter lock:
  - Five items, the third refused with `{ code: "42501" }`: `sent 4, rejected 1`; the third is `rejected` with the error message stored; later items still sent.
  - A transient failure on item two stops the pass: `held: "offline"`, item two `attempts` is 1 with the backoff above, items three to five untouched.
  - An `auth` failure stops the pass with `held: "auth"` and leaves every unsent item `pending`.
  - A successful send removes the item; draining again sends nothing.
  - Two overlapping `drain` calls through the same lock: the second returns `{ sent: 0, rejected: 0, held: "none" }` and `send` ran once per item.
  - Items are sent in `seq` order.
  - Delivery then signature: the signature is sent with `p_submission_id` equal to the delivery's returned `id`; if the delivery is refused the signature ends `rejected` and `send` was never called for it.
- [ ] **Step 2: Run** `pnpm -C apps/web test:e2e e2e/outbox-drain.spec.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** `drain`. The production lock is `navigator.locks.request("kiran.outbox.drain", { ifAvailable: true }, ...)`, wired in Task 5.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `outbox: serialised drain with backoff and dependencies`.

### Task 5: Encrypted IndexedDB store and the public entry points

**Files:**
- Create: `apps/web/lib/outbox/crypto.ts`, `store-idb.ts`, `index.ts`
- Test: `apps/web/e2e/outbox-crypto.spec.ts` (Node has WebCrypto); the IndexedDB store is proven in Task 9's journey.

**Interfaces:**
- Consumes: `OutboxStore` (Task 3), `drain` (Task 4), `rpc` from `apps/web/lib/rpc.ts`, `mySession` for the user id.
- Produces:
  - `crypto.ts`: `sealJson(key: CryptoKey, value: unknown): Promise<string>`, `openJson<T>(key: CryptoKey, sealed: string): Promise<T>`, `newKey(): Promise<CryptoKey>` (AES-GCM 256, `extractable: false`).
  - `store-idb.ts`: `openIdbStore(): Promise<OutboxStore>`; database `kiran-outbox`, stores `items` and `keys`; fields `args` and `error` are sealed, ids and state are plain.
  - `index.ts`: `submit(input: { id: string; fn: OutboxFn; args: Record<string, unknown>; label: string; salonId: string | null; capturedAt: string; dependsOn?: { itemId: string; argName: string } }): Promise<"sent" | "queued" | "rejected">`; `startSync(): () => void` (drain on `online`, on `visibilitychange` to visible, after each `submit`, and every 30 s while there is work); `subscribe(listener: () => void): () => void`; `wipeLocalData(): Promise<void>`.

- [ ] **Step 1: Write the failing spec:** `sealJson` then `openJson` returns the original object; opening with a different key throws; two seals of the same value differ (random IV); `key.extractable === false`.
- [ ] **Step 2: Run** `pnpm -C apps/web test:e2e e2e/outbox-crypto.spec.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** the three files. `submit` writes first; if the write throws (storage blocked or full) it throws to the caller so the page shows an error and never "Saved". `submit` returns `rejected` when the first drain pass refused it.
- [ ] **Step 4: Run** — Expected: PASS. Then `pnpm typecheck` and `pnpm lint`.
- [ ] **Step 5: Commit** `outbox: encrypted IndexedDB store and entry points`. Open PR A.

### Task 6: Installable shell that opens offline

**Files:**
- Create: `apps/web/public/sw.js`, `apps/web/app/manifest.ts`, `apps/web/lib/register-sw.ts`
- Modify: `apps/web/app/app/layout.tsx` (register the worker once, rep routes only)
- Test: `apps/web/e2e/offline-shell.spec.ts`

**Interfaces:**
- Produces: `registerServiceWorker(): void`; `manifest.ts` default export returns `{ name, short_name, start_url: "/app", display: "standalone", icons }`.

- [ ] **Step 1: Spike first, with a go/no-go.** Prove that a hand-written worker reopens a signed-in `/app` page offline under Next 16 (app-router navigations fetch RSC payloads). Go: `/app` and `/app/salons` open offline after one online visit, and the bundle assertion in `rep-login.spec.ts` still passes. No-go: stop, write the finding in the log, and ask MJ whether to accept an installed shell with a static offline page that shows the outbox. Do not continue on a no-go.
- [ ] **Step 2: Write the failing spec** (production build, Chromium): visit `/app/login` online, `context.setOffline(true)`, reload `/app`, assert the shell renders and shows no browser offline error page.
- [ ] **Step 3: Implement** the worker. Cache hashed `/_next/static/*` cache-first; navigations under `/app` network-first with the last good copy as fallback; never cache `/office`, `/salon`, any `rpc` or `/auth` request, or any response with `Set-Cookie`. Version the cache name so a deploy evicts the old one.
- [ ] **Step 4: Run** `pnpm -C apps/web test:e2e e2e/offline-shell.spec.ts e2e/rep-login.spec.ts` — Expected: PASS.
- [ ] **Step 5: Commit** `rep app: manifest and offline shell`. Open PR B.

### Task 7: Offline read cache

**Files:**
- Create: `apps/web/lib/cache.ts`
- Modify: the read sites the actions need. Read each file before editing: `apps/web/app/app/salons/page.tsx`, `apps/web/app/app/salons/new/page.tsx` (`my_areas`), `apps/web/components/lost-demand.tsx` (SKUs, groups), the card product picks in `apps/web/app/app/salons/[id]/page.tsx`, `apps/web/app/app/rep-day.tsx` (`my_day`, `my_bag`, `my_route`, `due_list`), `apps/web/app/app/orders/page.tsx` and `apps/web/app/app/orders/[id]/deliver/page.tsx` (`my_territory_orders`, `order_remaining`).
- Test: `apps/web/e2e/cache.spec.ts`

**Interfaces:**
- Consumes: `sealJson`/`openJson` (Task 5).
- Produces: `cachedRows<T>(key: string, load: () => Promise<T[]>): Promise<{ rows: T[]; fromCache: boolean; savedAt: string | null }>` — network first; on a transient failure returns the sealed copy; keys are prefixed with the user id.

- [ ] **Step 1: Write the failing spec** with an injected store: a successful load saves and returns `fromCache: false`; a failed load returns the saved rows with `fromCache: true` and `savedAt`; a failed load with nothing saved throws; user B never reads user A's key.
- [ ] **Step 2: Run** `pnpm -C apps/web test:e2e e2e/cache.spec.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** `cachedRows`; convert the listed read sites; show "Offline copy from {when}" using `when()` from `apps/web/lib/time.ts`.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `rep app: encrypted offline read cache`.

### Task 8: Status UI and the six field actions through the outbox

**Files:**
- Create: `apps/web/components/outbox-status.tsx`
- Modify: `apps/web/app/app/layout.tsx` (mount status and `startSync`), `apps/web/app/app/salons/[id]/page.tsx` (`log_visit`, `add_salon_note`, `rep_create_card`), `apps/web/app/app/salons/new/page.tsx` (`create_salon`), `apps/web/components/money-section.tsx` (`rep_record_payment`, rep mode only), `apps/web/components/lost-demand.tsx` (`record_demand`)

**Interfaces:**
- Consumes: `submit`, `subscribe`, `startSync`, `retry`, `remove` (Tasks 3, 5).
- Produces: `<OutboxStatus />`: waiting count, last sync time, and a "Needs attention" list with the stored database message, Retry and Discard (Discard asks to confirm).

- [ ] **Step 1: Write the failing journey** `apps/web/e2e-stack/offline.spec.ts` (part 1), reusing the seeded rep helpers the other stack specs use: rep signs in and checks in online; `context.setOffline(true)`; log a visit, add a note, add a prospect, create an order-intake card, record a cash payment, tap one lost demand; assert `Waiting to send (6)` and that each form said it was saved on the phone; `context.setOffline(false)`; within 60 s assert the count is 0 and each of the six rows exists (read through the rep's own RLS reads); sending the same item twice leaves one row; reload while offline and the queue survives (proves the IndexedDB store).
- [ ] **Step 2: Run** `pnpm -C apps/web exec playwright test -c playwright.stack.config.ts e2e-stack/offline.spec.ts` — Expected: FAIL.
- [ ] **Step 3: Implement.** Replace each `rpc(...)` call at the sites above with `submit({...})`, moving the `new Date().toISOString()` for the `p_*_at_client` argument to the tap. After a queued `create_salon`, go to the salon list with a "Waiting to send" row; the detail page of an unsent salon is out of scope. A queued payment shows decision 7's wording instead of the receipt.
- [ ] **Step 4: Run** the journey plus `pnpm -C apps/web test:e2e` — Expected: PASS. Update the "Online only until the rep outbox exists (P1-09)" comment in `lost-demand.tsx`.
- [ ] **Step 5: Commit** `rep app: field actions through the outbox`.

### Task 9: Check-in, check-out, count, delivery and signature offline

**Files:**
- Modify: `apps/web/app/app/rep-day.tsx` (`rep_check_in` at the check-in form, `record_count` and `rep_check_out` in the close dialog), `apps/web/app/app/orders/[id]/deliver/page.tsx` (`rep_submit_delivery`, `rep_attach_signature`), `apps/web/app/app/deliveries/page.tsx` (`rep_attach_signature` for a submission that already exists on the server)
- Test: `apps/web/e2e-stack/offline.spec.ts` (part 2)

**Interfaces:**
- Consumes: `submit` with `dependsOn` (Tasks 3 to 5); server Task 1 must already be in the CI stack (PR S merged).
- Produces: nothing new. The delivery page queues the delivery as one item (id = its `clientId`) and the signature as a second item whose `dependsOn` is `{ itemId: <delivery id>, argName: "p_submission_id" }`. The signature item id is the acknowledgement component's existing `a.key`.

- [ ] **Step 1: Write the failing journey (part 2):**
  - Offline: check in with a bag count, log two visits, submit a delivery with a signature, record the daily close and check out; assert six items waiting in that order; go online; within 60 s all are applied, the day shows closed, the delivery appears in the office approval queue with its signature, and `bag_variance_units` matches the counted figure.
  - Across midnight: seed the clock so the queued items were captured before midnight Karachi and sync after; assert they land on the captured day and today's day is untouched.
  - A phone clock set 49 hours back: the first queued item ends under Needs attention with the "too old to sync" reason, and Retry after fixing nothing leaves it there.
  - Delivery refused (order no longer deliverable): the signature item ends refused with "its delivery was refused: …" and was never sent.
  - Office posts a stock issue to the bag between capture and sync: variance is 0.
- [ ] **Step 2: Run** the stack spec — Expected: FAIL.
- [ ] **Step 3: Implement.** Check-out stays blocked locally until the daily close item exists in the queue or on the server, mirroring the server rule "record the evening bag count before checking out". The deliveries page still reads the server's `my_submissions`; a queued delivery shows as "Waiting to send".
- [ ] **Step 4: Run** the stack spec and `pnpm -C apps/web test:e2e` — Expected: PASS.
- [ ] **Step 5: Commit** `rep app: a whole day, delivery and signature included, works offline`. Open PR C.

### Task 10: Sign-out wipe and the B-20 device fixes

**Files:**
- Modify: `apps/web/lib/supabase/browser.ts`, the sign-out action in `apps/web/app/app/account/page.tsx`
- Test: `apps/web/e2e/device-lock.spec.ts`, plus a case in `apps/web/e2e-stack/offline.spec.ts`

**Interfaces:**
- Consumes: `wipeLocalData` (Task 5).

- [ ] **Step 1: Write the failing tests.**
  - Sign-out with unsent items asks first and lists the count; confirming wipes queue and cache; cancelling keeps them.
  - A revoked device wipes local data after rotating the id.
  - B-20 O1: two tabs registering at once call `register_device` once, guarded by `navigator.locks.request("kiran.device", ...)` instead of the rotate-then-claim race.
  - B-20 O2: a crash after the claim no longer blocks re-registration for 30 s (the lock releases with the tab, so `CLAIM_KEY` goes away).
  - B-20 O3: blocked `localStorage` shows an explicit message instead of "Loading…".
- [ ] **Step 2: Run** `pnpm -C apps/web test:e2e e2e/device-lock.spec.ts` — Expected: FAIL.
- [ ] **Step 3: Implement.** This reopens P1-01, which is VERIFIED: the board row carries the allowed reopen note `was VERIFIED <log file stem>`, and the change is a DEVIATION entry (H-25).
- [ ] **Step 4: Run** the new specs, `pnpm typecheck`, `pnpm lint` — Expected: PASS.
- [ ] **Step 5: Commit** `rep app: wipe on sign-out; device registration under a lock (B-20)`.

### Task 11: Records

**Files:**
- Modify: `docs/ACTIVITY.md` (board row P1-09, blocker B-20), new entry under `docs/log/`, `docs/plans/README.md`, `SPEC.md` if it names P1-09
- Move: this file to `docs/plans/implemented/` only when the last PR has merged

- [ ] **Step 1:** Log entry in the repo's format (ASCII signature, `**Task:**`, `**Evidence:**` with real command output, security checklist).
- [ ] **Step 2:** Set the P1-09 row to IMPLEMENTED, NOT VERIFIED; a builder may mark VERIFIED only with an attempt to break the control and the `**Self-verification:**` line.
- [ ] **Step 3:** Run `pnpm activity:check origin/main HEAD`, `pnpm lint`, `pnpm typecheck`, `pnpm service-role:scan`. Expected: all pass. Open PR D.

## Non-goals

An unsent prospect has no detail page until it syncs. No card edits offline. No office view of device-side rejections: MJ wants it after the pilot starts; it needs a table and an RPC for the phone to report rejections and is a separate plan. No background sync API (Safari lacks it; the drain runs while the app is open). No stock issue confirmation or handover response offline.

## Self-review (2026-11-09)

- Spec coverage: NFR-01 (Tasks 4, 8, 9), NFR-02 (bundle assertion kept in Task 6, no new dependency), NFR-04 (Task 6), SAL-13, PIP-07, MAP-02 (`create_salon`, Task 8), DEM-01 (`record_demand`, Task 8), PIP-09 (Tasks 1, 9), encrypted cache (Tasks 5, 7), B-20 (Task 10), MJ's three answers (Tasks 1, 4, 9).
- Not verified when writing: the current definitions of `record_demand`, `rep_record_payment` and `record_count` as redefined by later migrations (Task 1 step 1 tells the executor to read them), the exact device error strings (Task 2), and whether Next 16 allows the offline navigation fallback (Task 6 is a spike with a no-go exit).
- Types: `OutboxFn`, `OutboxItem`, `OutboxStore`, `Failure`, `DrainDeps`, `DrainReport` are defined once and reused unchanged. `dependsOn` is added in Task 3 and consumed in Tasks 4, 5 and 9.
- Proportion: the plan is mostly decisions, signatures and test names; the only prose-heavy part is Task 1, which carries a security-relevant server change.
