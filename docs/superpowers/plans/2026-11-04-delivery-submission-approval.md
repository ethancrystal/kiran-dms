# Delivery submission and approval with pending stock custody (PR B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A rep's delivery becomes an immutable submission that moves goods from the bag to a per-rep pending location; only an owner's or manager's approval writes the delivery, the sale movement, the invoice, the installments and the order status, and rejected goods stay in pending custody until the office settles them.

**Architecture:** One enum-only migration, then one main migration. `app.deliver` becomes internal `app.finalise_delivery`, which takes the deliverer as parameters and stamps `invoice.delivered_by` and `commission_rep_id`; `app.office_approve_delivery` and `app.office_deliver` are its only callers. `app.rep_submit_delivery` replaces `app.rep_deliver` (no grant, always refuses). Three append-only tables hold submission, decision and settlement. Screens are one office page and two rep pages; test fixtures move through a shared submit-then-approve helper with assertions unchanged.

**Tech Stack:** PostgreSQL (Supabase) migrations and SECURITY DEFINER functions; Vitest + `pg` DB tests (`supabase/tests`); Next.js 16 / React 19 pages (`apps/web`); Playwright stack tests (`apps/web/e2e-stack`, CI only).

**Spec:** `docs/superpowers/specs/2026-11-03-orders-delivery-commission-design.md` (section 4 "PR B", sections 5 to 7). Decisions: D-32, D-31, D-30 (doc 12); A-16, A-18 (ACTIVITY section 15); L-0374 (B-40 a), L-0385 (MJ's requirement and the three ways to settle), L-0163 (receiver's name, GPS, server time).

**Status:** NOT STARTED. This is completion slice 4 (P1-21) of `2026-11-05-project-completion.md`, built on slices 1 to 3. MJ accepted every recommended default below on 2026-11-04 (cash at the door: the rep collects after approval). `docs/16-project-completion-goal.md` wins where this plan differs. Changes since it was written:

- **Migration versions:** use `20261105130000` (enums) and `20261105130100` (main) instead of the versions named below, so they sort after slices 1 to 3.
- **Log format:** one `docs/log` TASK entry; ignore the claim (C-039) and L- numbering steps, which no longer exist.
- **Reach:** who may submit stays "the order's assigned rep or a legacy order's own rep". Slice 1's `app.rep_can_reach_salon` (D-36) applies wherever a salon read is needed.
- **Assigned rep:** Decision 6's stamp stays `commission_rep_id = assigned_rep_id`. Slice 5 adds `commission_rate_bp` beside it (D-38), so leave a clear single stamping point in `app.finalise_delivery`.
- **Docs:** doc 03, 04, 06, 11 and SPEC.md already carry the D-32 approval as approved, not built; change them only where this slice builds what they describe.

## Decision needed from MJ

The spec leaves these open. The plan is written to each recommended default; a different answer changes only the named task. Nothing here is decided until MJ answers; the controller records the answers.

| # | Question | Recommended default (what the plan builds) | Changes |
|---|---|---|---|
| 1 | **Cash at the door.** `app.record_payment` refuses a payment when the salon owes nothing, and nothing is owed until approval writes the invoice. L-0374 says reps collect "as now", but a rep can no longer collect at handover on a first order, including every CASH order. Accept this? | Yes: the rep collects after approval (next visit, or the same visit if the office has approved). No payment code changes; the rep's submission screen says so. The alternative (advances, PAY-02) is out of scope for this PR | Task 8 copy; or a new PR |
| 2 | **Spec section 7 "partial approval moves only approved quantities".** The spec signature has no lines parameter. Does the office approve a chosen part of a submission? | No: approval is all or nothing, and "partial" means a submission for part of the order (it moves only those quantities and the order becomes `partially_delivered`). A wrong quantity is rejected and resubmitted. The settlement arithmetic already reads submitted minus delivered, so adding lines later needs only the approve function | Task 4 |
| 3 | **Missing goods: which control?** The spec says `missing` with an adjustment request id; the brief for this plan says write-off with owner approval. Kind `write_off` is always owner-checked, so a write-off the owner raises can never be approved (the L-0390 trap). | Existing `adjustment` kind on the pending location (doc 06 section 2 row "Stock adjustment / write-off": manager below the threshold if not the maker, owner above), consumed inside `app.office_resolve_pending`. A value above the threshold must be raised by a manager so that the owner can check it | Task 5 |
| 4 | **Return to bag without the rep's count (CTL-05).** CTL-05 moves stock into a bag only after the rep confirms. Should a pending-to-bag return also need the rep's confirmation? | No: the office records it with a count note, and the rep's next daily close is the cross-check. The goods came from that bag and the rep is the one carrying them. Rep confirmation would need a new two-party flow; say so if wanted | Task 5, new rep RPC |
| 5 | **Dates.** Do `delivered_at`, invoice, installment due dates (`control.invoice_installments` reads `delivered_at`) and the cycle date follow the approval or the submission? | Approval (server time). The submission keeps `submitted_at` and `submitted_at_client` as evidence, and `delivery.delivered_at_client` carries the phone's time. Slow approvals therefore delay due dates | Task 2 |
| 6 | **Commission on legacy `rep_visit` orders.** May their rep submit them, and who earns? | Their own rep may submit (PR A Review Focus 5 stays true); `commission_rep_id` = `o.assigned_rep_id`, so null for these (D-31 pays on orders assigned to a rep) | Task 2 |
| 7 | **Two migration files.** Spec section 4 says one per pull request. Postgres cannot use a value from `alter type ... add value` in the transaction that added it, and each file runs as one transaction. | Two files: enums alone, then the main migration | Task 1 |
| 8 | **Existing invoices.** They are append-only (H-06). Backfill `delivered_by` by disabling the trigger? | No backfill. Both columns are nullable, with `check (delivered_by is not null) not valid`, which binds every new row and leaves old rows and H-06 alone. Only test data exists | Task 1 |
| 9 | **Rep suspended or moved between submission and approval.** Should approval re-check? | No. The goods were handed over when the rep was allowed to; approval proceeds and attribution stays the order's assigned rep (spec section 7, attribution survives reassignment) | Task 4 |
| 10 | **`app.office_deliver` on an order with an assigned rep (A-18 still open).** | Allowed as today on any confirmed order with no undecided submission; `commission_rep_id` stays the assigned rep. Restricting it to rep-less orders is one line if MJ prefers | Task 4 |
| 11 | **Submission flags.** | `mock_location` and `distance_unknown` only, with `distance_from_pin_m` shown to the approver. No geofence flag: `payment.geofence_m` is a payment threshold, and no delivery threshold is configured | Task 3 |
| 12 | **What a rep reads.** | Its own submissions, decisions and settlements (RLS and `app.my_submissions`). `stock_movement_select` is unchanged, so the rep sees `submitted_to_salon` and `pending_returned` (they touch its bag) and not the later sale or adjustment | Task 1 |
| 13 | **Bag value limit (CTL-05).** Does pending stock count? | No change: the limit reads the bag only. Goods in custody do not block new issues | none |

Two deviations from the spec's wording that need no decision, listed so a reviewer is not surprised: `app.rep_submit_delivery` keeps `app.rep_deliver`'s parameter order rather than the spec's, so fixture moves stay mechanical; `app.office_reject_delivery` takes a `p_client_id` (H-08, as every other write). The approver-must-not-be-the-submitter check is kept although roles normally make it impossible, because `app.owner_set_role` can promote a rep with a submission in the queue. The spec's "salon users refused" case waits for the portal: no salon role exists (`public.app_role` is owner, manager, rep).

## Pre-flight conflict table

| Thing | Found | What the plan does |
|---|---|---|
| PR #50 (open): `docs/11-roadmap.md`, `docs/ACTIVITY.md`, `docs/audit-2026-10-31/execution-map.md` | No code overlap | Rebase before Task 10; renumber log entries if it lands first |
| B-41 fixes (verifier branch `claude/gifted-mestorf-*`, spec section 2 out of scope) | Not on the remote | If they land first, re-read `app.deliver` and `app.rep_deliver` before Task 2 |
| Claim C-039 (`docs/ACTIVITY.md`) | Covers this work; expires 2026-11-05 | Renew it first; the implementer logs, this plan does not |
| Stale PR A status: spec header and section 2, PR A plan status block, SPEC.md rows at lines 54, 121, 125 and 275 | Say "not pushed" or "planned" although #48 merged | Task 10 corrects them |
| `alter type add value` in one transaction (`supabase/tests/setup/global-setup.ts` line 71 sends a whole file as one query) | "unsafe use of new value" | Enums alone in the first migration (Decision 7). CI's `supabase start` must apply the pair too |
| `stock_location_bag_owner`: `(kind = 'rep_bag') = (owner_user_id is not null)` | Refuses a pending location with an owner | Widened in Task 1 |
| `delivery_rep_shape`, and `app.deliver` writing `auth.uid()` and `app.user_role()` | The approver as deliverer would break the check | `finalise_delivery` takes the deliverer as parameters (Task 2) |
| Lock-order note M1 in `app.deliver`: no audited write before the per-salon payment lock | An early decision row could deadlock with a payment | The decision row is written after `finalise_delivery` returns (Task 4) |
| `crm-attacks.test.ts` line 887 expects `stringContaining("delivery_lat_check")` | A default constraint name on the new table would not match | Name the new table's constraint `delivery_lat_check` (names are per table); assertion unchanged |
| `office-order-access.test.ts` line 386 calls `app.deliver` directly and expects 42501 | Function is dropped in Task 2 | Call `app.finalise_delivery` there instead (Task 2) |
| `verifier-attacks.test.ts` allowlist and `CALLS`; `reverify3-attacks.test.ts` timestamp list | Exact-list assertions | Tasks 3 to 5 add names as they appear; Task 7 removes `rep_deliver` |
| `app.office_post_adjustment` can post any approved adjustment | Could drain pending stock outside a settlement | Refuses a `pending_delivery` subject (Task 5) |
| Stack J1 journey checks out before the card test; `app.rep_check_in` refuses a second day | Later submit has no open day | Move check-out to a new last test (Task 9) |
| `e2e-stack` asserts no button on `/app/orders` | A Deliver button would fail it | Deliver is a link to its own page, so the assertion stands |
| Seed gives Rep One an empty bag and creates no warehouse; J1 comments "morning count is empty" | A submission needs stock | Seed loads the bag; J1 counts it (Task 9) |

## Global Constraints

- Read `AGENTS.md`, `CLAUDE.md`, `docs/AGENT-COMPLIANCE-PROTOCOL.md`, `docs/ACTIVITY.md` first; run `pnpm agent:preflight`; claim C-039 covers this work (renew it); log PROGRESS with real evidence; HANDOFF at the end. Builders never mark VERIFIED.
- Migrations, forward-only: `supabase/migrations/20261105090000_delivery_approval_enums.sql` (migration 0026, only the `add value` statements) and `supabase/migrations/20261105090100_delivery_approval.sql` (migration 0027, everything else; it grows task by task).
- Every new table: `enable` and `force row level security` in the same migration, `control.audit_row` audit trigger, `control.forbid_mutation` append-only and no-truncate triggers, no write grant to any role, a row in `supabase/tests/rls-matrix.test.ts`.
- Every new function: `security definer`, `set search_path = ''`, `revoke all ... from public, anon, authenticated, service_role`; `grant execute ... to authenticated` only for callable RPCs, added in sorted position to the allowlist in `supabase/tests/verifier-attacks.test.ts` with the comment "migration 0027 (D-32 PR B); MJ standing approval L-0144".
- Errors, as in PR A: 42501 denied (`app.raise_denied`), 22023 bad input, 23505 reused client_id with different content, 55000 state conflict, 23514 stock. Reuse the rep path's messages word for word: `reps deliver only their own orders`, `check in before delivering (PIP-09)`, `reps deliver only to salons in their own territories`, `this rep has no bag to deliver from`, `GPS is required for a delivery (MJ L-0163)`, `the name of the person who received the goods is required (MJ L-0163)`, `only a confirmed order is delivered (ORD-03)`, `every line must be a SKU of this order, at most what is left to deliver`, `nothing is left to deliver on this order`, `insufficient stock at the delivery location (part delivery is allowed)`.
- Office functions use `app.assert_office()`; rep functions use `app.assert_actor_ready()`. Rep comparisons are NULL-safe (`is distinct from`, `coalesce(... , false)`): `rep_id` and `assigned_rep_id` are nullable.
- Server time only; client time in `*_client`; money in integer paisa. Every write has a `client_id` (H-08) and a null one is 22023. Call `app.set_purpose` before audited writes.
- Run DB tests outside the sandbox, `DATABASE_URL` and `KIRAN_TEST_DATABASE_URL` unset, in parts (host memory): `pnpm exec vitest run --config supabase/tests/vitest.config.ts <file-name-fragments>`. "No test files found" means the database set-up failed: read the error, then rerun.
- Lint is Biome (`pnpm lint`); new TypeScript avoids magic numbers and raw loops. Screens: no fake success, no dead buttons, the database's message shown as returned, data survives a reload. `[Test]`/`[Dummy]` data only (H-01 to H-03).
- Scope is PR B only: no commission rate or commission screen (PR C), no returns, credit notes, payouts or advances.

## Review Focus

1. A rep taps Submit on two phones or twice with different client ids, for the same goods: the second is refused 22023 because undecided submissions reserve quantity (test in Task 3).
2. The rep checks out, or is suspended or moved to another territory, before the office decides: approval still works and attribution holds (Decision 9; tests in Task 4).
3. The office tries to cancel or deliver an order with an undecided submission: refused 55000, so goods cannot be stranded (test in Task 4).
4. A rejected submission, then an immediate resubmission while the goods are still in pending custody: refused 23514 until the office returns them to the bag, then accepted (test in Task 5).
5. A write-off approval reused for a second settlement, or an approved adjustment posted directly against the pending location: both refused (tests in Task 5).

---

### Task 1: Schema: enums, pending location, submission tables, invoice columns

**Files:**
- Create: `supabase/migrations/20261105090000_delivery_approval_enums.sql`, `supabase/migrations/20261105090100_delivery_approval.sql`
- Create: `supabase/tests/delivery-approval.test.ts` (copy the set-up pattern of `supabase/tests/deliveries.test.ts`)
- Modify: `supabase/tests/rls-matrix.test.ts`

**Interfaces:**
- Produces, enums: `public.stock_location_kind` + `pending_delivery`; `public.stock_movement_kind` + `submitted_to_salon`, `pending_returned`.
- Produces, `stock_location`: `stock_location_bag_owner` becomes `(kind in ('rep_bag', 'pending_delivery')) = (owner_user_id is not null)`; unique index `stock_location_one_pending_per_rep` on `(owner_user_id) where kind = 'pending_delivery'`; after-insert trigger `stock_location_pending_twin` (definer `control.stock_location_pending_twin()`) adds a `pending_delivery` row for each new `rep_bag` (same owner and `created_by`, name `'Pending: ' || left(new.name, 60)`); backfill for existing bags. `app.office_create_location` refuses `pending_delivery` with 22023 `pending locations are created with the rep's bag`.
- Produces, `stock_movement_kind_shape`: gains `submitted_to_salon` and `pending_returned` (both sides not null). Other kinds unchanged.
- Produces, `public.delivery_submission` (append-only): `id uuid pk default gen_random_uuid()`, `client_id uuid not null unique`, `order_id`, `salon_id`, `rep_id` and `rep_day_id` (all not null, FKs), `lines jsonb not null` (normalised `[{sku_id, qty}]` ordered by sku_id; check array and non-empty), `received_by_name text not null` (2 to 80 after btrim), `lat numeric(9,6) not null`, `lng numeric(9,6) not null` with constraints named `delivery_lat_check` and `delivery_lng_check`, `distance_from_pin_m integer check >= 0`, `device_fingerprint text not null`, `mock_location boolean not null default false`, `flags jsonb not null default '[]'`, `submitted_at timestamptz not null default now()`, `submitted_at_client timestamptz`. Indexes on `(order_id)` and `(rep_id, submitted_at desc)`.
- Produces, `public.delivery_submission_decision` (append-only): `id`, `client_id uuid not null unique`, `submission_id uuid not null unique` (FK), `outcome text check in ('approved','rejected')`, `delivery_id uuid` (FK), `reason text`, `decided_by` (FK), `decided_at default now()`. Check: approved has `delivery_id` and null reason; rejected has null `delivery_id` and `length(btrim(reason))` between 5 and 500.
- Produces, `public.pending_stock_resolution` (append-only): `id`, `client_id uuid not null unique`, `submission_id` (FK), `sku_id` (FK), `qty integer check > 0`, `outcome text check in ('returned_to_bag','returned_to_warehouse','missing')`, `note text` (3 to 300 after btrim, the count evidence), `movement_id uuid not null` (FK `stock_movement`), `approval_id uuid` (FK `control.approval_request`), `resolved_by`, `resolved_at default now()`. Check: `(outcome = 'missing') = (approval_id is not null)`. Index on `(submission_id, sku_id)`.
- Produces, `control.pending_resolution_guard()`: before insert on `pending_stock_resolution`, under a `for update` lock on the submission row; raises 23514 `more than is unsettled` when the row plus earlier settlements for that submission and SKU exceed submitted minus delivered (delivered = `delivery_line.qty` of the decision's delivery, 0 when rejected).
- Produces, `public.invoice`: `delivered_by uuid` and `commission_rep_id uuid`, both FK `user_profile`, nullable; `constraint invoice_delivered_by_set check (delivered_by is not null) not valid` (Decision 8).
- RLS: all three tables select to authenticated; `delivery_submission`: `(select app.is_office()) or (rep_id = (select auth.uid()) and (select app.is_rep()) and (select app.self_ok()))`; the other two: `(select app.is_office()) or exists (select 1 from public.delivery_submission s where s.id = submission_id and s.rep_id = (select auth.uid()) and (select app.is_rep()) and (select app.self_ok()))`. Grants: select to authenticated, service_role. `stock_location_select` and `stock_movement_select` unchanged (the owner test already shows a rep its own pending row).

- [ ] **Step 1: Write the failing tests**

In `delivery-approval.test.ts`:
- `"delivery_submission, its decision and pending_stock_resolution refuse UPDATE and DELETE, even for postgres"`: errors match `/append-only/`, for all three.
- `"a new rep bag gets one pending location with the same owner, and a second is refused"`: after `office_create_location(... 'rep_bag' ...)`, one row `kind = 'pending_delivery'` for that owner with `bag_value_limit_paisa` null; a direct second insert as postgres gives 23505.
- `"the office cannot make a pending location by hand"`: owner, `office_create_location(... 'pending_delivery' ...)`, 22023.
- `"new movement kinds need both sides"`: as postgres, `submitted_to_salon` with a null `to_location_id` gives 23514 naming `stock_movement_kind_shape`.
- `"pending_stock_resolution needs an approval exactly when goods are missing"`: direct inserts violating the shape give 23514.

In `rls-matrix.test.ts`, one row per table, `writeCol` `received_by_name`, `reason`, `note`: office `true`; repA and repB `rep_id = ${me(...)}` (submission) and `submission_id in (select s.id from public.delivery_submission s where s.rep_id = ${me(...)})` (the other two); repAWrongDevice, managerAal1, ownerAal1, suspended `false`; anon `denied`; service_role `true`.

- [ ] **Step 2: Run to verify failure**: `... delivery-approval rls-matrix` → FAIL (relation does not exist).
- [ ] **Step 3: Write both migrations' schema** (headers cite D-32, L-0385 and Decisions 7 and 8; `app.office_create_location` copied from migration 0008 with the one refusal added).
- [ ] **Step 4: Run** `... delivery-approval rls-matrix schema-hygiene verifier-attacks inventory` → PASS.
- [ ] **Step 5: Commit**: `git commit -m "Schema: delivery submissions, pending location, invoice attribution (D-32)"`

### Task 2: The internal finalising function

**Files:**
- Modify: the main migration
- Test: `supabase/tests/delivery-approval.test.ts`, `supabase/tests/office-order-access.test.ts` (line 386), `supabase/tests/verifier-attacks.test.ts` (`CALLS`)

**Interfaces:**
- Consumes: Task 1 invoice columns.
- Produces: internal, no grant: `app.finalise_delivery(p_client_id uuid, p_order_id uuid, p_from_location_id uuid, p_lines jsonb, p_received_by_name text, p_lat numeric, p_lng numeric, p_mock_location boolean, p_delivered_at_client timestamptz, p_rep_day_id uuid, p_delivered_by uuid, p_delivered_by_role public.app_role) returns public.invoice`. Body is PR A's `app.deliver` (migration `20261104090000` lines 716 to 816), every guard and the M1 lock comment kept. Exactly these actors change:

| Row | Column | Value |
|---|---|---|
| `delivery` | `delivered_by`, `delivered_by_role` | the parameters |
| `delivery` | `rep_day_id`, `lat`, `lng`, `mock_location`, `delivered_at_client` | the parameters |
| `delivery` | `delivered_at` | default `now()` (Decision 5) |
| `stock_movement` | `actor_id` | `auth.uid()` (the approver or office user) |
| `invoice` | `issued_by` | `auth.uid()` |
| `invoice` | `delivered_by` | `p_delivered_by` |
| `invoice` | `commission_rep_id` | `o.assigned_rep_id` (Decision 6) |
| `invoice` | `rep_id` | `coalesce(o.assigned_rep_id, o.rep_id)`, unchanged |
| `cycle_estimate` | `set_by` | `auth.uid()` |

- `app.office_deliver` and (for now) `app.rep_deliver` call it, passing `auth.uid()` and `app.user_role()`. `app.deliver` is dropped.

- [ ] **Step 1: Write the failing tests**
- `"a rep-less order delivered by the office stamps delivered_by and no commission rep"`: `office_deliver` by the manager: `delivered_by` = manager, `commission_rep_id` null, `rep_id` null, `issued_by` = manager.
- `"an assigned order delivered by the office keeps the assigned rep as commission rep"`: `commission_rep_id` = repA, `delivered_by` = manager.
- `"a new invoice without delivered_by is refused"`: postgres insert gives 23514 naming `invoice_delivered_by_set`.
- Add `select app.finalise_delivery(...)` to `CALLS` in `verifier-attacks` (42501 for every app role); change `office-order-access` line 386 to call it with the new signature (still `DENIED`).

- [ ] **Step 2: Run to verify failure**: `... delivery-approval verifier-attacks` → FAIL.
- [ ] **Step 3: Implement** (`drop function app.deliver(...)` after replacing both callers).
- [ ] **Step 4: Run** `... delivery-approval deliveries office-order-access payments verifier-attacks` → PASS, with existing assertions unchanged.
- [ ] **Step 5: Commit**: `git commit -m "Internal finalise_delivery takes the deliverer; invoice stamps attribution"`

### Task 3: Rep submission

**Files:**
- Modify: the main migration
- Test: `supabase/tests/delivery-approval.test.ts`, `supabase/tests/verifier-attacks.test.ts`, `supabase/tests/reverify3-attacks.test.ts`

**Interfaces:**
- Consumes: Task 1 tables and location.
- Produces, internal: `app.pending_location_of(p_rep_id uuid) returns uuid`; `app.order_lines_open(p_order_id uuid) returns table (order_line_id uuid, sku_id uuid, remaining integer, reserved integer, open integer)`, where `reserved` sums the order's undecided submissions by SKU and `open = remaining - reserved`.
- Produces, RPC: `app.rep_submit_delivery(p_client_id uuid, p_order_id uuid, p_received_by_name text, p_lat numeric, p_lng numeric, p_lines jsonb default null, p_mock_location boolean default false, p_submitted_at_client timestamptz default null) returns public.delivery_submission`.
- Order of checks, so fixture errors stay the same: `assert_actor_ready`; not a rep 42501 `reps deliver from their bag; the office uses office_deliver`; null client_id 22023; replay (same rep, order and name, and, when `p_lines` is given, the same normalised lines, returns the row; a null `p_lines` matches without comparing lines, as `crm-attacks` lines 836 to 838 need; otherwise 23505); order is the rep's (`o.rep_id` or `o.assigned_rep_id`, NULL-safe) else 42501; open day; `app.rep_can_reach_salon`; bag exists; GPS not null; `select ... for update` on the order, then the replay check again (a retry that waited on the lock, as PR A's card conversion does at migration `20261104090000` lines 397 to 406); status in (`confirmed`, `partially_delivered`); name; lines (null means every `open > 0`; given lines must be SKUs of the order, at most `open`; none left is `nothing is left ...`); bag `app.on_hand - app.pending_out >= qty` else 23514.
- Writes: the submission (`rep_day_id` = open day, `device_fingerprint` = `app.request_device_id()`, flags per Decision 11, distance via `app.distance_m`), and per line a `stock_movement` kind `submitted_to_salon`, bag to pending, `source_type 'delivery_submission'`, `source_id` the submission, `actor_id` the rep. A missing pending location raises 55000 rather than creating one. The order is not updated.
- Produces, RPC read: `app.my_submissions() returns table (submission_id uuid, order_id uuid, salon_id uuid, salon_name text, lines jsonb, received_by_name text, submitted_at timestamptz, status text, reason text, invoice_id uuid, invoice_number text, unsettled integer)`: reps only, newest 50; `status` is `pending`, `approved` or `rejected`; `lines` elements carry `sku_id`, `code`, `variant`, `qty`; salon name only while the rep reaches it, as `app.my_orders`.

- [ ] **Step 1: Write the failing tests**
- `"a submission moves goods to pending and changes nothing official"`: order of 2 for rep A; bag down 2, pending up 2; order still `confirmed`; 0 rows in `delivery`, `delivery_line`, `invoice`, `installment`; no `sale` movement; `app.order_remaining` unchanged; `submitted_at` is server time when the client sends a backdated time, and `submitted_at_client` keeps it.
- `"a replay returns the same submission and moves nothing twice"`: same id; one submission, one movement. Same client_id with another order or quantity: 23505. Null client_id: 22023.
- `"who may submit"`: rep B on rep A's order 42501 `own orders`; rep A on a rep-less office order 42501 `own orders`; manager and owner 42501; wrong device 42501; suspended 42501; no open day 42501 `check in`; other territory 42501.
- `"what a submission needs"`: blank and one-character name 22023; null lat or lng 22023; lat 999 gives 23514 naming `delivery_lat_check`; draft or cancelled order 22023 `only a confirmed order`; SKU not on the order 22023; more than the bag 23514 with the rep-path message, and nothing written.
- `"undecided submissions reserve quantity (Review Focus 1)"`: order of 3; submit 2; submit 2 with a new client_id gives 22023 `at most what is left`; submit 1 succeeds; submit null lines with nothing open gives 22023 `nothing is left`.
- `"the rep of a legacy rep_visit order may submit it"`: `helpers/legacy-order.ts`; submission row exists.
- `"flags record a mock location and an unknown distance"`: `p_mock_location` true gives `mock_location`; a salon without a pin gives `distance_unknown`.
- `"my_submissions shows a rep its own only"`: rep A sees `pending`; rep B none; manager 42501.
- Allowlist gains `my_submissions`, `rep_submit_delivery`. `reverify3` timestamp list gains `app.rep_submit_delivery` with the comment "Migration 0027 (D-32 PR B; L-0144): p_submitted_at_client stores the phone's time as evidence only".

- [ ] **Step 2: Run to verify failure**: `... delivery-approval` → FAIL (function does not exist).
- [ ] **Step 3: Implement** the helpers, `app.rep_submit_delivery`, `app.my_submissions` and grants.
- [ ] **Step 4: Run** `... delivery-approval verifier-attacks reverify3-attacks` → PASS.
- [ ] **Step 5: Commit**: `git commit -m "Rep delivery submission: goods to pending, nothing official changes (D-32)"`

### Task 4: Office approval

**Files:**
- Modify: the main migration
- Test: `supabase/tests/delivery-approval.test.ts`, `supabase/tests/verifier-attacks.test.ts`

**Interfaces:**
- Consumes: Task 2 `app.finalise_delivery`, Task 3 submission, `app.pending_location_of`.
- Produces: `app.office_approve_delivery(p_submission_id uuid, p_client_id uuid) returns public.invoice`:
  1. `assert_office`; null client_id 22023.
  2. Decision with this client_id: same submission, `decided_by` the caller and `approved` returns its invoice; otherwise 23505.
  3. Submission `for update`; unknown 22023; then step 2 again, so a retry that waited on the lock gets its own invoice rather than 55000 (`app.office_reject_delivery` and `app.office_resolve_pending` do the same).
  4. `s.rep_id = auth.uid()` 42501 `the approver cannot be the rep who submitted (SEC-11)`.
  5. Decision exists 55000 `this delivery submission is already decided`.
  6. `app.finalise_delivery(s.client_id, s.order_id, app.pending_location_of(s.rep_id), s.lines, s.received_by_name, s.lat, s.lng, s.mock_location, s.submitted_at_client, s.rep_day_id, s.rep_id, 'rep')`. `delivery.client_id` is the submission's client_id, so fixtures that read `delivery where client_id = <dcid>` keep working.
  7. Only then, after `finalise_delivery` has taken the salon lock (M1), insert the `approved` decision.
- Produces: `app.office_pending_deliveries() returns table (submission_id uuid, order_id uuid, salon_id uuid, salon_name text, rep_id uuid, rep_name text, lines jsonb, total_paisa bigint, received_by_name text, distance_from_pin_m integer, mock_location boolean, flags jsonb, submitted_at timestamptz)`: undecided, oldest first, limit 200, office only; `lines` carry `sku_id`, `code`, `variant`, `qty`, `unit_price_paisa`; `total_paisa` at the order's prices.
- Modifies: `app.office_deliver` and `app.cancel_order` refuse with 55000 `this order has a delivery waiting for approval` when the order has an undecided submission. `app.cancel_order` is copied from migration `20261104090000` with that one check, placed after the row lock and before the rep test.

- [ ] **Step 1: Write the failing tests**
- `"manager and owner approve: the whole official record appears once"`: run for each. Delivery `delivered_by` rep A, role `rep`, `rep_day_id` and GPS from the submission, `from_location_id` the pending location; one `sale` movement from pending, `actor_id` the approver; pending back to 0, bag unchanged; invoice `issued_by` approver, `delivered_by` rep A, `commission_rep_id` rep A, `rep_id` rep A, a gapless number; installments sum to the total; order `delivered`; decision `approved` with `delivery_id`; audit rows exist for the submission, decision, delivery and invoice.
- `"a submission for part of the order moves only those quantities (spec section 7, Decision 2)"`: order of 3; submit and approve 2: `partially_delivered`, invoice for 2, `order_remaining` 1; submit and approve 1: `delivered`, a second invoice.
- `"duplicate approvals create nothing twice"`: same client_id returns the same invoice id, with one delivery, one invoice and the installments unchanged; a new client_id, or another manager, gives 55000; the same client_id on another submission gives 23505.
- `"a replay that arrives after the decision returns the same invoice"`: approve, then repeat the call with the same client_id; same invoice id, and nothing new written. The post-lock branch itself needs two sessions and is not covered, as in PR A.
- `"who may approve"`: repA and repB 42501; managerAal1 and ownerAal1 42501; suspended 42501; anon refused; unknown submission 22023; null client_id 22023.
- `"a rep promoted after submitting cannot approve its own submission"`: in a rolled-back transaction, `owner_set_role` makes rep A a manager; at AAL2 its approval gives 42501 `who submitted`; the owner's approval then works.
- `"a rep cannot reach the official writes"`: for rep A, direct insert into `delivery`, `invoice` and `stock_movement`, an update of `sales_order.status`, and `select app.finalise_delivery(...)` all give 42501.
- `"a refused approval writes nothing and takes no invoice number"`: move the pending stock out as postgres (a `transfer` to the warehouse) so the approval raises 23514, called inside a `do` block that swallows the error; the same transaction then has no invoice for the order and no decision, and the next invoice issued takes the expected next number.
- `"approval works after the rep has checked out (Review Focus 2)"`: `rep_check_out` first; approval succeeds; `delivery.rep_day_id` is the closed day.
- `"approval survives suspension and reassignment (Review Focus 2)"`: end rep A's territory and suspend it before approval; approval succeeds; `commission_rep_id` still rep A.
- `"an undecided submission blocks cancel and office delivery (Review Focus 3)"`: `cancel_order` and `office_deliver` give 55000; after approval or rejection they behave as today.
- `"the approvals queue lists undecided submissions oldest first"`: two submissions in order; the decided one disappears; total and flags correct; rep A 42501.
- Allowlist gains `office_approve_delivery`, `office_pending_deliveries`.

- [ ] **Step 2: Run to verify failure**: `... delivery-approval` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `... delivery-approval deliveries orders verifier-attacks` → PASS.
- [ ] **Step 5: Commit**: `git commit -m "Office approves a delivery submission: the official record is written once (D-32)"`

### Task 5: Rejection and settling pending stock

**Files:**
- Modify: the main migration
- Test: `supabase/tests/delivery-approval.test.ts`, `supabase/tests/verifier-attacks.test.ts` (`inventory.test.ts` is the regression net for the adjustment refactor)

**Interfaces:**
- Consumes: Task 1 tables and guard; `app.request_approval`, `app.decide_approval`.
- Produces: `app.office_reject_delivery(p_submission_id uuid, p_client_id uuid, p_reason text) returns public.delivery_submission_decision`: same guards and replay rule as approval; reason 5 to 500 after btrim else 22023; no stock moves; never restores stock.
- Produces, internal: `app.post_adjustment(p_client_id uuid, p_approval_id uuid) returns public.stock_movement`, the body of `app.office_post_adjustment` (migration 0008), threshold check included. `app.office_post_adjustment` becomes `assert_office`, a 22023 refusal `pending stock is settled through its delivery submission` when the subject location is `pending_delivery`, then the internal call; its signature and grant are unchanged.
- Produces: `app.office_resolve_pending(p_client_id uuid, p_submission_id uuid, p_sku_id uuid, p_qty integer, p_outcome text, p_note text, p_warehouse_id uuid default null, p_approval_id uuid default null) returns public.pending_stock_resolution`. Checks: `assert_office`; null client_id 22023; replay (same caller, submission, SKU, qty and outcome returns the row; otherwise 23505); submission `for update`, unknown 22023; undecided 55000 `decide the submission before settling its goods`; outcome known, note 3 to 300, qty from 1 to unsettled else 22023 `at most the unsettled quantity`. By outcome:

| Outcome | Requires | Movement |
|---|---|---|
| `returned_to_bag` | the rep's bag exists, else 22023 | kind `pending_returned`, pending to bag, `source_type 'pending_stock_resolution'`, `actor_id` the caller |
| `returned_to_warehouse` | `p_warehouse_id` an active warehouse, else 22023 | kind `return_to_warehouse`, pending to warehouse |
| `missing` | `p_approval_id` of kind `adjustment`, `subject_type 'stock_location'`, subject this rep's pending location, payload `sku_id` = SKU, `qty_delta` = -qty, `submission_id` = this submission; else 42501 `an approved adjustment for this quantity is required` | `app.post_adjustment(gen_random_uuid(), p_approval_id)`; status, single use and owner threshold are enforced there |

- Produces: `app.office_pending_stock() returns table (submission_id uuid, rep_id uuid, rep_name text, salon_name text, sku_id uuid, sku_code text, unsettled integer, pending_location_id uuid, reason text, decided_at timestamptz, request_id uuid, request_status public.approval_status, request_maker_id uuid, request_checker_role public.app_role)`: office only, `unsettled > 0`, oldest first, limit 500; `request_*` is the newest not-yet-used `adjustment` request whose payload names this submission and SKU.

- [ ] **Step 1: Write the failing tests**
- `"rejection keeps history and leaves the goods in pending"`: decision `rejected` with the reason; submission still there; pending still holds the goods; no delivery or invoice; order status unchanged; `my_submissions` shows `rejected`, the reason and `unsettled`.
- `"rejection refusals"`: reason of 4 characters 22023; second decision 55000; approve after reject 55000; reject after approve 55000; replay returns the row; rep A 42501; self-rejection after promotion 42501.
- `"goods return to the bag"`: bag up, pending down; movement `pending_returned`; the settlement row names it.
- `"goods return to the warehouse"`: warehouse up, bag unchanged; inactive or unknown warehouse 22023.
- `"goods reported missing need an approved adjustment"`: no approval or a pending one 42501; approved by another office user: the settlement posts one `adjustment` movement out of pending with `approval_id`; above the threshold with a manager as checker 42501 `the owner's approval`.
- `"an approval is used once, and only for its own quantity (Review Focus 5)"`: the same approval on a second settlement is refused; an approval for another SKU, qty or submission 42501.
- `"pending stock cannot be adjusted outside a settlement (Review Focus 5)"`: `office_post_adjustment` on the pending location with a valid approved request gives 22023; on a warehouse behaves as before.
- `"settlement cannot exceed what was rejected"`: split 1 + 1 of 2 succeeds and a third is 22023; a direct insert as postgres over the limit gives 23514 `more than is unsettled`; an undecided submission 55000; an approved submission (nothing unsettled) 22023; replay returns the row and moves nothing.
- `"who may settle"`: rep A, managerAal1, suspended 42501.
- `"the rep resubmits after the goods are back in the bag (Review Focus 4)"`: bag holding only the rejected goods; resubmission while in pending gives 23514; after `returned_to_bag` it succeeds, and the rejected submission no longer reserves quantity.
- `"the settle list shows what is unsettled"`: quantity falls with each settlement and the row disappears at 0; a pending adjustment request appears with its maker; rep A 42501.
- Allowlist gains `office_pending_stock`, `office_reject_delivery`, `office_resolve_pending`.

- [ ] **Step 2: Run to verify failure**: `... delivery-approval` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `... delivery-approval inventory crm-attacks verifier-attacks` → PASS.
- [ ] **Step 5: Commit**: `git commit -m "Reject a submission; the office settles pending goods three ways (D-32, L-0385)"`

### Task 6: Move test fixtures to submit-then-approve

Depends on Tasks 3 and 4. `grep rep_deliver supabase/tests` gives 26 lines in 11 files: 21 code call sites in 9 fixture files (below), 3 comments and 2 list entries. No page or script in `apps/web` or `scripts` calls `rep_deliver`.

**Files:**
- Create: `supabase/tests/helpers/submit-approve.ts`
- Modify: the 9 files below

**Interfaces:**
- Produces: `submitApproveSql<K extends string>(asUser: (who: K) => string, a: { clientId: string; orderExpr: string; rep: K; approver: K; name?: string; lines?: string; extra?: string }): string`: SQL that switches to `rep`, calls `app.rep_submit_delivery(clientId, orderExpr, name, 24.9, 67.1, lines | null<extra>)`, switches to `approver` and ends with `select (app.office_approve_delivery((select id from public.delivery_submission where client_id = '<clientId>'), '<clientId>')).*;`. The same uuid is the submission's and the decision's client_id, so a repeated call replays both. The last statement returns the invoice row. A fixture runs it as one `["postgres", sql]` step, so helper call sites and `tx(...).at(-1)` stay as they are.

| File | Line | Today | Move |
|---|---|---|---|
| `crm-attacks.test.ts` | 162 | helper `deliver` | body becomes `submitApproveSql`; call sites unchanged, including the replay test at 836 to 847 (submit replay, then approve replay; `deliver(d, o2)` still 23505, now from the submission) |
| `crm-attacks.test.ts` | 167 | helper `deliverAt` | same, `orderExpr` = the pinned expression (`.*` includes `id`) |
| `crm-attacks.test.ts` | 880-884 | direct, bad input | `app.rep_submit_delivery`, same arguments; expected errors unchanged (`delivery_lat_check` is the new table's named constraint) |
| `crm-attacks.test.ts` | 898 | direct, backdated | helper with `extra`; asserts on `delivery.delivered_at` and `delivered_at_client` unchanged |
| `crm-attacks.test.ts` | 947 | direct, swallowed failure | `app.rep_submit_delivery` in the same `do` block (fails on the bag check); no number consumed |
| `deliveries.test.ts` | 65 | helper `deliver` | as crm line 162 |
| `deliveries.test.ts` | 204, 207 | direct, bad input | `app.rep_submit_delivery` |
| `deliveries.test.ts` | 248 | direct, swallowed failure | `app.rep_submit_delivery` |
| `handovers.test.ts` | 98 | set-up | helper |
| `invoice-document.test.ts` | 66 | set-up | helper |
| `office-cash.test.ts` | 80 | set-up | helper |
| `office-order-access.test.ts` | 124 | helper `repDeliver` | helper (`.*` includes `id`); update the header comment at line 5 |
| `order-cards.test.ts` | 205 | refusal (rep-less order) | `app.rep_submit_delivery`; still 42501 `own orders` |
| `payments.test.ts` | 135, 253 | set-up | helper |
| `receivables-ageing.test.ts` | 95 | set-up | helper |

Grepped on c8fb928: no fixture file asserts `from_location_id`, the `sale` movement's `actor_id` or `cycle_estimate.set_by` of a delivery, and the movement counts that exist filter on `source_type = 'delivery'` (`crm-attacks` line 842, `deliveries` line 127), so the new `submitted_to_salon` row (`source_type 'delivery_submission'`) does not touch them. The bag's on-hand figures end the same after approval. So no assertion in these files should need to change: any failure is a bug in the code under test; stop and investigate.

- [ ] **Step 1: Write the helper and move each call site in the table.**
- [ ] **Step 2: Run in two parts**: `... deliveries handovers invoice-document office-cash payments receivables-ageing` then `... crm-attacks office-order-access order-cards orders` → PASS.
- [ ] **Step 3: Commit**: `git commit -m "Tests: deliver through submit-then-approve; assertions unchanged"`

### Task 7: Close the rep's direct delivery

Depends on Task 6.

**Files:**
- Modify: the main migration
- Test: `supabase/tests/delivery-approval.test.ts`, `supabase/tests/verifier-attacks.test.ts`, `supabase/tests/reverify3-attacks.test.ts`

**Interfaces:**
- Produces: `app.rep_deliver` keeps its signature; its body refuses as its first statement with 42501 `a rep's delivery is a submission the office approves: use app.rep_submit_delivery (D-32)`; `revoke execute ... from public, anon, authenticated, service_role`.

- [ ] **Step 1: Write the failing test**: `"no one can finalise a delivery through the old rep path"`: rep A, manager, owner and service_role all get 42501, and no delivery, invoice or movement exists. In `verifier-attacks`, remove `rep_deliver` from the allowlist and add `select app.rep_deliver(gen_random_uuid(), gen_random_uuid(), 'x y', 1, 1)` to `CALLS`. In `reverify3`, remove `app.rep_deliver` from the list and note the removal in the comment.
- [ ] **Step 2: Run to verify failure**: `... delivery-approval verifier-attacks reverify3-attacks` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the two-part set from Task 6, then `... delivery-approval verifier-attacks reverify3-attacks rls-matrix schema-hygiene` → PASS. `grep -rn "rep_deliver" supabase/tests` shows only intended refusals and comments.
- [ ] **Step 5: Commit**: `git commit -m "Close the rep's direct delivery (D-32)"`

### Task 8: Rep screens: Deliver and its status

**Files:**
- Create: `apps/web/app/app/orders/[id]/deliver/page.tsx` (form: remaining lines from `order_remaining` with SKU labels from the `sku` table, quantity per line defaulting to what is left, receiver's name, GPS via the helper in `apps/web/lib/salons.ts`; one `crypto.randomUUID()` per open form, kept across retries)
- Create: `apps/web/app/app/deliveries/page.tsx` (`my_submissions`: status Waiting, Approved with the invoice number and link, Rejected with the reason and "Goods wait for the office")
- Modify: `apps/web/app/app/orders/page.tsx` (a **link** "Deliver" on orders assigned to me in `confirmed` or `partially_delivered`, none while its submission is waiting; "Waiting for approval" instead), `apps/web/app/app/page.tsx` (link to Deliveries)
- Test: `apps/web/e2e-stack/office.spec.ts` (Task 9)

**Interfaces:**
- Consumes: `rep_submit_delivery`, `my_submissions`, `my_territory_orders`, `order_remaining`; `apps/web/lib/rpc.ts`, `apps/web/lib/money.ts`.
- Copy pinned: after submit, the page says `Sent for approval. No invoice yet: the office approves first. Collect payment after approval.` (Decision 1). A refused GPS reading blocks the submit with the database's GPS message, as for payments.

- [ ] **Step 1: Build the pages** (loading, empty and error states, database messages as returned, English only, D-42).
- [ ] **Step 2: Run** `pnpm typecheck`, `pnpm lint`, `pnpm -C apps/web build` (placeholder public env), `pnpm -C apps/web test:e2e` → all pass.
- [ ] **Step 3: Commit**: `git commit -m "Rep Deliver form and delivery status"`

### Task 9: Office Delivery approvals screen and stack journey

**Files:**
- Create: `apps/web/app/office/(shell)/deliveries/page.tsx`
- Modify: `apps/web/app/office/(shell)/layout.tsx` (`NAV`: `{ href: "/office/deliveries", label: "Delivery approvals" }`), `scripts/e2e-stack-seed.mjs`, `apps/web/e2e-stack/office.spec.ts`

**Interfaces:**
- Consumes: Tasks 3 to 5 RPCs; `app.request_approval`, `app.decide_approval` (no approvals screen exists today, so this page must offer them or `missing` is a dead end); `apps/web/components/confirm-action.tsx`.
- Page section "Waiting for approval" (`office_pending_deliveries`): salon, rep, lines, total, receiver, distance, flags, buttons Approve and Reject (reason of at least 5 characters). Section "Goods waiting to be settled" (`office_pending_stock`): quantity and note per row; Return to bag; Return to warehouse (select of active warehouses from `stock_location`); Report missing, which calls `request_approval(client_id, 'adjustment', 'stock_location', pending_location_id, {sku_id, qty_delta: -n, submission_id}, reason)`; then, for an office user who is not the maker, Approve request or Refuse (`decide_approval`); once approved, Settle as missing (`office_resolve_pending`). The page shows the database's refusal when the owner's approval is needed (Decision 3).
- Seed: a `[Test] Warehouse` via `office_create_location`; as postgres, `receipt` then `issue_to_rep` movements of `BAG_QTY = 6` of the seeded SKU into Rep One's bag (no office stock screen exists); `.seed.json` gains `warehouse` and `bagQty`.

- [ ] **Step 1: Write the stack tests**
- Journey J1: the comment "empty bag" changes; the morning count fills `seed.bagQty` for the seeded SKU. The "Save count and check out" block moves out of J1, unchanged, into the last test below.
- `"the rep submits its assigned order and the manager approves it; the invoice appears for both (D-32)"`, after the PR A card test: the rep's Orders row has a Deliver link; the form submits; the row reads Waiting for approval and no invoice is listed; the manager's Delivery approvals shows it with rep and total; Approve; the row leaves the queue; Orders shows `delivered`; reload keeps it; the rep's Deliveries shows Approved with an `INV-` number; the salon's account shows the amount owed, so the rep can now record a payment.
- `"a rejected submission keeps its history and its goods wait until the office returns them (D-32)"`: the manager makes a direct order with Delivering rep = Rep One; the rep submits 2; Reject with a reason; the rep sees Rejected and the reason; the order stays `confirmed`; Goods waiting shows 2; Return to bag with a note; the row disappears; the rep's bag shows the quantity back, and the rep can submit again.
- `"the rep sends the evening count and checks out (J1 step 15, B-35)"`: the moved block, with the bag quantity as it now stands.
- `"Delivery approvals without a session sends the visitor to the sign-in page"`: `/office/deliveries` with no session lands on the office sign-in; the refusals themselves are database tests in Tasks 4 and 5.

- [ ] **Step 2: Build the page and the seed.**
- [ ] **Step 3: Run** `pnpm typecheck`, `pnpm lint`, `pnpm -C apps/web build`, `pnpm -C apps/web test:e2e` → pass. The stack tests need Docker: run them where it exists, otherwise record "not run, CI only" (a blocker to VERIFIED, not a pass).
- [ ] **Step 4: Commit**: `git commit -m "Office Delivery approvals: approve, reject, settle; stack journey"`

### Task 10: Docs, verify, log

**Files:**
- Modify: `docs/06-security-plan.md` (section 2: add spec section 5's classification table verbatim, citing D-32 and L-0390), `docs/03-requirements.md` (ORD-04 rewritten: "A rep's delivery is an immutable submission that moves goods to the rep's pending location; only the owner's or manager's approval writes the delivery, the sale movement from pending, the invoice and installments and advances the order (D-32). A rep-less order is delivered by the office (A-18)"; ORD-03 cross-reference), `docs/04-domain-model.md` (rows for the three tables; `stock_location` and `stock_movement` kinds; `delivery` and `invoice` rows; ERD lines 28 to 40), `docs/09-payments-credit-installments.md` (collection follows approval, per Decision 1's answer), `docs/12-decisions-and-open-questions.md` (D-32 status "PR B built, not verified"), `SPEC.md` (rows at lines 54, 55, 121, 125, 275), the spec (header, section 2 state, new "as built" under section 4 PR B, section 9 additions), `docs/superpowers/plans/2026-11-03-office-orders-and-cards.md` (status block), `docs/ACTIVITY.md` (PROGRESS, HANDOFF, board row, claim)

**Interfaces:** none (documentation and evidence).

- [ ] **Step 1: Edit the docs** with what was built, including MJ's answers to the decision table above; any default still unanswered stays listed as an open assumption with its A-number.
- [ ] **Step 2: Run** every DB suite in parts (reverify5, 8, 9, 10 and 11 included: PR A did not run them), `pnpm typecheck`, `pnpm lint`, `pnpm agent:preflight`, `node scripts/activity-log-check.mjs origin/main`, and record real counts and what was not run.
- [ ] **Step 3: Commit**: `git commit -m "Docs: delivery approval built (D-32), ORD-04, classification table"`
- [ ] **Step 4: Ask MJ** before pushing and opening the pull request; merge only on MJ's OK for that pull request with every required check green on its exact head. State stays IMPLEMENTED — NOT VERIFIED until the checks have really run.

---

## Task order

1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10. Tasks 3, 4 and 5 keep `app.rep_deliver` working so existing suites stay green until Task 6 moves them; Task 7 closes it only then. Task 8 before 9 because the stack journey needs both screens.

## Spec coverage

| Spec item | Task |
|---|---|
| Section 4 location and movement kinds | 1 |
| `delivery_submission`, decision, `pending_stock_resolution` | 1 |
| `app.rep_submit_delivery`, reads | 3, 4, 5 |
| `app.finalise_delivery`; `rep_deliver` loses every grant | 2, 7 |
| `app.office_approve_delivery`, `office_reject_delivery`, `office_resolve_pending` | 4, 5 |
| `invoice.delivered_by`, `commission_rep_id` | 1, 2 |
| ORD-04 rewrite; A-18 office path stays | 10, 2 |
| Section 5 classification table | 10 |
| Section 6 rep and office screens (commission and Team rate are PR C) | 8, 9 |
| Section 7: submission leaves the order unfinalised | 3 |
| Section 7: rep cannot approve, change status, write invoices or sale movements | 4 |
| Section 7: manager and owner approve; self-approval and other reps refused | 4 |
| Section 7: duplicate approvals; partial; rejection keeps history and custody | 4, 5 |
| Section 7: salon users refused | Deferred: no salon role until the portal |
| Section 7: commission excludes unapproved submissions; attribution survives reassignment | PR C reads the stamp; the stamp is tested in 4 |
| Section 7: fixture move, RLS matrix, allowlist, stack journey | 6, 1, 3 to 5, 7, 9 |
