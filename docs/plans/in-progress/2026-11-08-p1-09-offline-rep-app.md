# P1-09 Offline Rep App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** DRAFT FOR MJ REVIEW, written 2026-11-08 against `origin/main` `4e0c690`. Nothing here has been run. Status of the task itself lives only on the board (`docs/ACTIVITY.md` section 12, row P1-09, NOT STARTED).

**Before building:** the executor follows the build protocol in `CLAUDE.md` (read `docs/ACTIVITY.md` and the 20 newest `docs/log/` entries, run `pnpm agent:preflight`, keep one log entry per PR, never work on `main`). This draft was checked on 2026-11-08: preflight passed, and hard rules H-08, H-18, H-19, H-25, H-27 and decisions D-42, D-49 say what this plan relies on them to say.

**Departure from the repository map:** `CLAUDE.md` lists `packages/shared` (generated database types, validation schemas) as "first needed by the offline PWA, P1-09". This plan does not build it. The outbox needs only the argument shapes of six RPCs, which the pages already pass untyped; generated types belong to the frontend foundation (F1, F2 in `2026-11-05-frontend-structure.md`). Changing that is a DEVIATION entry (H-25) and MJ's call.

**Goal:** A rep can capture visits, notes, prospects, order-intake cards, payments and lost-demand taps with no signal, and every one reaches the database within 60 s of reconnecting, or is shown to the rep with the database's own refusal.

**Architecture:** Write-ahead outbox. Every captured action is written to an encrypted IndexedDB queue first, then a single serialised drain sends it through the existing `app.*` RPC with its original `client_id`. The server is already idempotent on that key (H-08), so a replay is harmless. Pure logic (classification, queue rules, drain loop) sits behind an injected store and sender so it is tested in Node; the IndexedDB store and the service worker are proven by one real-stack browser journey.

**Tech Stack:** Next 16 app router, React 19, `@supabase/supabase-js`, native IndexedDB and WebCrypto (no new dependency), Playwright (`apps/web/e2e` for Node specs, `apps/web/e2e-stack` for the real-stack journey).

**Spec:** `docs/03-requirements.md` (NFR-01, NFR-02, NFR-04, SAL-13, PIP-07, MAP-02, DEM-01), `docs/16-project-completion-goal.md` ("offline Rep functionality preserved"), `docs/audit-2026-10-31/security-nfr-webapp.md` section 2.3 (nothing offline exists today), `docs/ACTIVITY.md` rows P1-09 and B-20.

## Global Constraints

- NFR-01: "Visits, rep order requests, payments, prospects can be captured with no connectivity and sync within 60 s of reconnecting; conflicts resolved server-side with the rep notified of any rejection".
- NFR-02: "bundle under 300 KB gzipped for the rep app shell"; "interactions ≤ 200 ms locally". `e2e/rep-login.spec.ts` already asserts the bundle size and must stay green.
- English only (D-42, NFR-03). No i18n layer.
- Writes go only through `app.*` RPCs (H-08); never a table write, never a service-role key in the client (H-18, NFR-07).
- One `client_id` per intent, kept until the database accepts it or the rep discards it.
- Capture time (`p_*_at_client`) is taken when the rep taps, not when the queue drains.
- Money is integer paisa. No new migration is needed; if one appears, it is forward-only and MJ applies it (H-19).
- One branch and one pull request per row of the PR split below, each merged before the next; no stacked PRs.

## Decisions this plan makes (change them before building if you disagree)

| # | Decision | Why |
|---|---|---|
| 1 | In scope: `log_visit`, `add_salon_note`, `create_salon`, `rep_create_card`, `rep_record_payment`, `record_demand`. | These are exactly the NFR-01 list plus lost demand, which the code already marks "online only until the rep outbox exists (P1-09)". |
| 2 | Out of scope, stay online-only: check-in, check-out and counts; delivery submission and signature; stock issue confirmation; handover responses; card edits. | Check-in/out and counts depend on the server's own Karachi day. Delivery needs a salon signature and the D-49 invoice rule. See open questions. |
| 3 | Write-ahead for every action (one code path), not "try online, queue on failure". | One path to test. The result the rep sees is the first drain attempt. |
| 4 | Queue and read cache are encrypted at rest with a non-extractable AES-GCM key held in IndexedDB, and wiped on sign-out and on device revoke. | docs/05 L68 asks for an encrypted cache. **Limit, stated plainly:** this stops casual export and stray backups, not someone using the unlocked browser profile. The real controls remain the approved device and the session. |
| 5 | A rejected item is never dropped. It stays under "Needs attention" with the database's words, and the rep can Retry (same `client_id`) or Discard (after confirming). | NFR-01 "notified of any rejection". |

## Open questions for MJ (the plan does not decide these)

1. Should deliveries and the salon signature work offline? (NFR-01 does not list them; the basement-salon pilot test may.)
2. Should check-in and check-out be queueable, given the server stamps the day?
3. The office cannot see items rejected on a rep's phone (NFR-11 "sync failure dashboard"). Wanted for the pilot?
4. An offline payment has no receipt until sync (CTL-01). What does the rep tell the salon?

## Review Focus

- Two tabs open on one phone: each item is sent once, not twice.
- Phone offline across midnight Karachi, or after check-out: the queued visit is refused with the database's reason, and stays visible.
- A second rep signs in on the same phone: cannot see or send the first rep's queue.
- Storage blocked, full or unavailable: capture fails loudly instead of showing "Saved".
- Device revoked or session expired mid-queue: items are held and the rep is told to reconnect or sign in; nothing is discarded.

## File structure

| File | Responsibility |
|---|---|
| `apps/web/lib/outbox/types.ts` | Shared types and the `OutboxStore` interface. |
| `apps/web/lib/outbox/classify.ts` | Maps an RPC failure to `transient`, `auth` or `rejected`. |
| `apps/web/lib/outbox/queue.ts` | `MemoryStore`, and queue rules over any store. |
| `apps/web/lib/outbox/drain.ts` | One serialised drain pass with backoff. |
| `apps/web/lib/outbox/crypto.ts` | AES-GCM seal and open; key lifecycle. |
| `apps/web/lib/outbox/store-idb.ts` | IndexedDB implementation of `OutboxStore`. |
| `apps/web/lib/outbox/index.ts` | `submit()`, `startSync()`, `wipeLocalData()` for the pages. |
| `apps/web/lib/cache.ts` | `cachedRows()` read cache for offline lists. |
| `apps/web/components/outbox-status.tsx` | Waiting count, last sync, Needs attention list. |
| `apps/web/public/sw.js`, `apps/web/app/manifest.ts` | Service worker and PWA manifest. |
| `apps/web/e2e/outbox-*.spec.ts` | Node specs for the pure modules. |
| `apps/web/e2e-stack/offline.spec.ts` | Real-stack offline journey. |

## PR split

| PR | Tasks | Visible to reps? |
|---|---|---|
| A | 1 to 4 (outbox core, no UI change) | No |
| B | 5 (offline shell spike, then service worker) | Installable app |
| C | 6, 7 (read cache, convert the six call sites, status UI, journey) | Yes |
| D | 8 (B-20 device fixes, sign-out wipe) and 9 (records) | Yes |

---

### Task 1: Failure classification

**Files:**
- Create: `apps/web/lib/outbox/types.ts`, `apps/web/lib/outbox/classify.ts`
- Test: `apps/web/e2e/outbox-classify.spec.ts`

**Interfaces:**
- Produces: `type Failure = "transient" | "auth" | "rejected"`; `classifyFailure(error: unknown): Failure`.

- [ ] **Step 1: Read the exact strings.** Open `app.assert_actor_ready` and `app.raise_denied` in `supabase/migrations/20261024232225_device_hardening.sql` and `20261024223304_foundation.sql`; copy the device-not-approved and device-revoked messages into the test.
- [ ] **Step 2: Write the failing spec** `classifyFailure` cases, each one assertion:
  - `new TypeError("Failed to fetch")` is `transient`.
  - `{ status: 503 }`, `{ status: 429 }`, `{ status: 408 }` are `transient`.
  - `{ status: 401 }` and the device-not-approved message with `code: "42501"` are `auth`.
  - `{ code: "42501", message: "check in before logging visits (PIP-09)" }` is `rejected`.
  - `{ code: "22023" }`, `{ code: "23505" }`, `{ code: "23514" }`, `{ code: "55000" }` are `rejected`.
  - An unknown shape is `transient` (fail safe: keep the item, never discard).
- [ ] **Step 3: Run:** `pnpm -C apps/web test:e2e e2e/outbox-classify.spec.ts` — Expected: FAIL (module missing).
- [ ] **Step 4: Implement** `classifyFailure` in `classify.ts`; supabase-js puts the SQLSTATE in `error.code` and the HTTP status in `status`.
- [ ] **Step 5: Run again** — Expected: PASS.
- [ ] **Step 6: Commit** `outbox: classify RPC failures`.

### Task 2: Queue rules and the store contract

**Files:**
- Create: `apps/web/lib/outbox/queue.ts` (types go in `types.ts`)
- Test: `apps/web/e2e/outbox-queue.spec.ts`

**Interfaces:**
- Produces, in `types.ts`:
  - `type OutboxFn = "log_visit" | "add_salon_note" | "create_salon" | "rep_create_card" | "rep_record_payment" | "record_demand"`
  - `type OutboxItem = { id: string; seq: number; userId: string; fn: OutboxFn; args: Record<string, unknown>; label: string; salonId: string | null; capturedAt: string; state: "pending" | "rejected"; attempts: number; nextAttemptAt: number; error: string | null }` where `id` is the item's `client_id` (`p_id` for `create_salon`).
  - `interface OutboxStore { add(item: Omit<OutboxItem, "seq">): Promise<OutboxItem>; list(userId: string): Promise<OutboxItem[]>; update(id: string, patch: Partial<Pick<OutboxItem, "state" | "attempts" | "nextAttemptAt" | "error">>): Promise<void>; remove(id: string): Promise<void>; clear(): Promise<void> }`
- Produces, in `queue.ts`: `class MemoryStore implements OutboxStore`; `enqueue(store, input: Omit<OutboxItem, "seq" | "state" | "attempts" | "nextAttemptAt" | "error">): Promise<OutboxItem>`; `dueItems(store, userId: string, now: number): Promise<OutboxItem[]>`; `retry(store, id: string): Promise<void>`; `pendingCount(store, userId: string): Promise<number>`.

- [ ] **Step 1: Write the failing spec**, one test per rule:
  - `enqueue` assigns increasing `seq`; `list` returns oldest first.
  - Enqueueing the same `id` twice keeps one item (the second call returns the first).
  - `dueItems` returns only `pending` items whose `nextAttemptAt <= now`, for that `userId` only (a second user's items never appear).
  - `retry` turns a `rejected` item back to `pending` with `nextAttemptAt = 0`, keeping its `id`.
  - `capturedAt` is stored exactly as given and never rewritten.
- [ ] **Step 2: Run** `pnpm -C apps/web test:e2e e2e/outbox-queue.spec.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** the functions above. `list` sorts by `seq`.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `outbox: queue rules over an injected store`.

### Task 3: The drain loop

**Files:**
- Create: `apps/web/lib/outbox/drain.ts`
- Test: `apps/web/e2e/outbox-drain.spec.ts`

**Interfaces:**
- Consumes: Task 1 `classifyFailure`; Task 2 `OutboxStore`, `dueItems`.
- Produces: `type DrainDeps = { store: OutboxStore; userId: string; send: (fn: OutboxFn, args: Record<string, unknown>) => Promise<unknown>; now: () => number; lock: <T>(run: () => Promise<T>) => Promise<T | "busy"> }`; `type DrainReport = { sent: number; rejected: number; held: "none" | "offline" | "auth" }`; `drain(deps: DrainDeps): Promise<DrainReport>`.
- Backoff: after a transient failure set `nextAttemptAt = now + min(5_000 * 2 ** attempts, 30_000)` so a reconnect is picked up well inside 60 s.

- [ ] **Step 1: Write the failing spec** with a fake `send` and a counter lock:
  - Five items, the third refused with `{ code: "42501" }`: report is `sent 4, rejected 1`; the third is `rejected` with the error message stored; later items were still sent (a refusal does not stop the line).
  - A transient failure on item two stops the pass: `held: "offline"`, item two `attempts` is 1 with the backoff above, items three to five untouched.
  - An `auth` failure stops the pass with `held: "auth"` and leaves every unsent item `pending`.
  - A successful send removes the item. Draining a second time with the same store sends nothing.
  - Two overlapping `drain` calls through the same lock: the second returns `{ sent: 0, rejected: 0, held: "none" }` and `send` ran once per item.
  - Items are sent in `seq` order.
- [ ] **Step 2: Run** `pnpm -C apps/web test:e2e e2e/outbox-drain.spec.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** `drain`. The production lock is `navigator.locks.request("kiran.outbox.drain", { ifAvailable: true }, ...)`, wired in Task 4's `index.ts`.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `outbox: serialised drain with backoff`.

### Task 4: Encrypted IndexedDB store and the public entry points

**Files:**
- Create: `apps/web/lib/outbox/crypto.ts`, `store-idb.ts`, `index.ts`
- Test: `apps/web/e2e/outbox-crypto.spec.ts` (Node has WebCrypto); the IndexedDB store is proven in Task 7's journey.

**Interfaces:**
- Consumes: `OutboxStore` (Task 2), `drain` (Task 3), `rpc` from `apps/web/lib/rpc.ts`, `mySession` for the user id.
- Produces:
  - `crypto.ts`: `sealJson(key: CryptoKey, value: unknown): Promise<string>`, `openJson<T>(key: CryptoKey, sealed: string): Promise<T>`, `newKey(): Promise<CryptoKey>` (AES-GCM 256, `extractable: false`).
  - `store-idb.ts`: `openIdbStore(): Promise<OutboxStore>`; database `kiran-outbox`, stores `items` and `keys`; payload fields `args` and `error` are sealed, ids and state are plain.
  - `index.ts`: `submit(input: { id: string; fn: OutboxFn; args: Record<string, unknown>; label: string; salonId: string | null; capturedAt: string }): Promise<"sent" | "queued" | "rejected">`; `startSync(): () => void` (drain on `online`, on `visibilitychange` to visible, after each `submit`, and every 30 s while there is work); `subscribe(listener: () => void): () => void`; `wipeLocalData(): Promise<void>`.

- [ ] **Step 1: Write the failing spec:** `sealJson` then `openJson` returns the original object; opening with a different key throws; two seals of the same value differ (random IV); the key is created non-extractable (`key.extractable === false`).
- [ ] **Step 2: Run** `pnpm -C apps/web test:e2e e2e/outbox-crypto.spec.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** `crypto.ts`, `store-idb.ts` and `index.ts`. `submit` writes first; if the write throws (storage blocked or full) it throws to the caller so the page shows an error and never "Saved". `submit` returns `rejected` when the first drain pass refused it.
- [ ] **Step 4: Run** — Expected: PASS. Run `pnpm typecheck` and `pnpm lint`.
- [ ] **Step 5: Commit** `outbox: encrypted IndexedDB store and entry points`. Open PR A.

### Task 5: Installable shell that opens offline

**Files:**
- Create: `apps/web/public/sw.js`, `apps/web/app/manifest.ts`, `apps/web/lib/register-sw.ts`
- Modify: `apps/web/app/app/layout.tsx` (register the worker once, rep routes only)
- Test: `apps/web/e2e/offline-shell.spec.ts`

**Interfaces:**
- Produces: `registerServiceWorker(): void`; `manifest.ts` default export returns `{ name, short_name, start_url: "/app", display: "standalone", icons }`.

- [ ] **Step 1: Spike first, with a go/no-go.** Prove that a hand-written worker can reopen a signed-in `/app` page offline under Next 16 (app-router navigations fetch RSC payloads). Go: `/app` and `/app/salons` open offline after one online visit, and `rep-login.spec.ts` bundle assertion still passes. No-go: stop, write the finding in the log, and ask MJ whether to accept an "installed shell with a static offline page that shows the outbox" instead. Do not continue to Step 2 on a no-go.
- [ ] **Step 2: Write the failing spec** (production build, Chromium): visit `/app/login` online, `context.setOffline(true)`, reload `/app`, assert the shell renders and shows no browser offline error page.
- [ ] **Step 3: Implement** the worker. Cache hashed `/_next/static/*` cache-first; navigations under `/app` network-first with the last good copy as fallback; never cache `/office`, `/salon`, any `rpc` or `/auth` request, or any response with `Set-Cookie`. Version the cache name so a deploy evicts the old one.
- [ ] **Step 4: Run** `pnpm -C apps/web test:e2e e2e/offline-shell.spec.ts e2e/rep-login.spec.ts` — Expected: PASS.
- [ ] **Step 5: Commit** `rep app: manifest and offline shell`. Open PR B.

### Task 6: Offline read cache

**Files:**
- Create: `apps/web/lib/cache.ts`
- Modify: the read sites the six actions need — `apps/web/app/app/salons/page.tsx`, `apps/web/app/app/salons/new/page.tsx` (`my_areas`), `apps/web/components/lost-demand.tsx` (SKUs and groups), the card product picks in `apps/web/app/app/salons/[id]/page.tsx`. Read each file before editing.
- Test: `apps/web/e2e/cache.spec.ts`

**Interfaces:**
- Consumes: `sealJson`/`openJson` (Task 4).
- Produces: `cachedRows<T>(key: string, load: () => Promise<T[]>): Promise<{ rows: T[]; fromCache: boolean; savedAt: string | null }>` — network first; on a transient failure returns the sealed copy; cache keys are prefixed with the user id.

- [ ] **Step 1: Write the failing spec** with an injected store: a successful load saves and returns `fromCache: false`; a failed load returns the saved rows with `fromCache: true` and `savedAt`; a failed load with nothing saved throws; user B never reads user A's key.
- [ ] **Step 2: Run** `pnpm -C apps/web test:e2e e2e/cache.spec.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** `cachedRows`; convert the listed read sites; show "Offline copy from {when}" using `when()` from `apps/web/lib/time.ts`.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `rep app: encrypted offline read cache`.

### Task 7: Convert the six actions, status UI, and the real-stack journey

**Files:**
- Create: `apps/web/components/outbox-status.tsx`, `apps/web/e2e-stack/offline.spec.ts`
- Modify: `apps/web/app/app/layout.tsx` (mount status and `startSync`), `apps/web/app/app/salons/[id]/page.tsx` (`log_visit`, `add_salon_note`, `rep_create_card`), `apps/web/app/app/salons/new/page.tsx` (`create_salon`), `apps/web/components/money-section.tsx` (`rep_record_payment`, rep mode only), `apps/web/components/lost-demand.tsx` (`record_demand`)

**Interfaces:**
- Consumes: `submit`, `subscribe`, `startSync`, `retry`/`remove` (Tasks 2, 4).
- Produces: `<OutboxStatus />` showing the waiting count, the last sync time, and a "Needs attention" list with the stored database message, Retry and Discard (Discard asks to confirm).

- [ ] **Step 1: Write the failing journey** in `e2e-stack/offline.spec.ts`, reusing the seeded rep helpers the existing stack specs use:
  - Rep signs in and checks in online.
  - `context.setOffline(true)`; log a visit, add a note, add a prospect, create an order-intake card, record a cash payment, tap one lost demand. Assert `Waiting to send (6)` and that every form said it was saved on the phone.
  - `context.setOffline(false)`; within 60 s assert the waiting count is 0 and each of the six rows exists in the database (read through the rep's own RLS reads).
  - Replay safety: sending the same queued item twice leaves one row.
  - Rejection: queue a visit offline, check out online-side, reconnect; assert the item sits under Needs attention with the database's words ("check in before logging visits (PIP-09)") and is not lost; Retry after checking in again succeeds.
  - Reload while offline: the queue and the page survive (proves the IndexedDB store).
- [ ] **Step 2: Run** `pnpm -C apps/web exec playwright test -c playwright.stack.config.ts e2e-stack/offline.spec.ts` — Expected: FAIL.
- [ ] **Step 3: Implement.** Replace each `rpc(...)` call at the sites above with `submit({...})`, moving the `new Date().toISOString()` for the `p_*_at_client` argument to the tap. For `create_salon`, after queueing go to the salon list with a "Waiting to send" row; the salon detail page for an unsent salon is out of scope (see non-goals). A queued payment shows "Saved on this phone, no receipt until it sends" instead of the receipt.
- [ ] **Step 4: Run** the journey plus `pnpm -C apps/web test:e2e` — Expected: PASS. Update the "Online only until the rep outbox exists (P1-09)" comment in `lost-demand.tsx`.
- [ ] **Step 5: Commit** `rep app: capture through the outbox`. Open PR C.

### Task 8: Sign-out wipe and the B-20 device fixes

**Files:**
- Modify: `apps/web/lib/supabase/browser.ts`, the sign-out action in `apps/web/app/app/account/page.tsx`
- Test: `apps/web/e2e/device-lock.spec.ts`, plus a case in `e2e-stack/offline.spec.ts`

**Interfaces:**
- Consumes: `wipeLocalData` (Task 4).

- [ ] **Step 1: Write the failing tests.**
  - Sign-out with unsent items asks first and lists the count; confirming wipes the queue and the cache; cancelling keeps them.
  - A revoked device (status `revoked`) wipes local data after rotating the id.
  - B-20 O1: two tabs registering at once call `register_device` once (guard with `navigator.locks.request("kiran.device", ...)` instead of the rotate-then-claim race).
  - B-20 O2: a crash after the claim no longer blocks re-registration for 30 s (the lock releases with the tab, so `CLAIM_KEY` goes away).
  - B-20 O3: blocked `localStorage` shows an explicit message instead of "Loading…".
- [ ] **Step 2: Run** `pnpm -C apps/web test:e2e e2e/device-lock.spec.ts` — Expected: FAIL.
- [ ] **Step 3: Implement.** This reopens P1-01, which is VERIFIED: the board row must carry the allowed reopen note `was VERIFIED <log file stem>`, and the change is a DEVIATION entry under H-25.
- [ ] **Step 4: Run** the new specs, `pnpm typecheck`, `pnpm lint` — Expected: PASS.
- [ ] **Step 5: Commit** `rep app: wipe on sign-out; device registration under a lock (B-20)`.

### Task 9: Records

**Files:**
- Modify: `docs/ACTIVITY.md` (board row P1-09, blocker B-20), new entry under `docs/log/`, `docs/plans/README.md`, `SPEC.md` if it names P1-09
- Move: this file to `docs/plans/implemented/` only when the last PR has merged

- [ ] **Step 1:** Add the log entry in the repo's format (ASCII signature, `**Task:**`, `**Evidence:**` with the real command output, security checklist).
- [ ] **Step 2:** Set the P1-09 row to IMPLEMENTED, NOT VERIFIED; a separate session verifies (the builder never marks VERIFIED unless it declares the self-verification line).
- [ ] **Step 3:** Run `pnpm activity:check origin/main HEAD`, `pnpm lint`, `pnpm typecheck`, `pnpm service-role:scan`. Expected: all pass. Open PR D.

## Non-goals

An unsent prospect has no detail page until it syncs; no card edits offline; no office view of device-side rejections; no background sync API (Safari lacks it; the drain runs while the app is open); no delivery or signature offline pending the open questions.

## Self-review (2026-11-08)

- Spec coverage: NFR-01 (Tasks 3, 7), NFR-02 (bundle assertion kept in Task 5, no new dependency), NFR-04 (Task 5), SAL-13/PIP-07/MAP-02 (`create_salon`, Task 7), DEM-01 (`record_demand`, Task 7), encrypted cache (Tasks 4, 6), B-20 (Task 8). Gap, deliberate: delivery and check-in offline, listed as open questions.
- Not verified when writing: the exact device-error strings (Task 1 step 1 reads them), and whether Next 16 allows the offline navigation fallback (Task 5 step 1 is a spike with a no-go exit).
- Types: `OutboxFn`, `OutboxItem`, `OutboxStore`, `Failure`, `DrainDeps`, `DrainReport` are defined once and reused unchanged.
