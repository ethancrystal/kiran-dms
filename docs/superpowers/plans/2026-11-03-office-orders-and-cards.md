# Office orders and rep order cards (PR A) Implementation Plan

## Status (2026-11-04)

- **Tasks 1 to 8: complete.** Task 9: steps 1 and 2 complete; step 3 open (MJ decides on pushing the branch and opening the pull request, ACTIVITY L-0392).
- **State:** IMPLEMENTED — NOT VERIFIED (ACTIVITY L-0391, L-0393). Branch `claude/orders-delivery-commission`, not pushed, no pull request, no independent check. Not run: the Playwright stack tests (no Docker on the build host; CI only), the reverify5, 8, 9, 10 and 11 suites, CI.
- **Commits** (oldest first, after main 486888b): spec a903fcd; plan 2949d89; Task 1 1aedb2e, ba0b106; Task 2 0feee6e, 203d03d; Task 3 ec62a6a, 692b444; Task 4 33ba45a, ad644c1; Task 5 c7a3b02, eca0f83; Task 6 8882d9f; Task 7 8b60088, 7ce5d84, 8780b91; Task 8 f0cab9b, 3f47040, aedd39e; Task 9 3c63986 (log L-0390 to L-0392); final whole-branch review fix round dc3dfd4 (L-0393); this status block, SPEC.md refresh and H-15 restored in the commit that adds L-0394.
- **Decided or changed while building** (details in the design spec, section 9): the owner's own discount needs no approval (`discount_by_owner`, MJ L-0390); the Delivering rep select stays on direct orders with "No rep" as default (A-16, L-0385, L-0391); A-18 is assumed (L-0386); a card dismissal reason is 5 to 500 characters; the salon picker shows at most 500 salons and says so; Task 1's edit of the H-15 text was reverted to main's wording (L-0394), then re-applied in narrower words after MJ accepted it in chat (L-0396).
- **Open for MJ** (L-0392, L-0393): A-18; close B-14 (moot under D-30); may a rep see the dismissal reason and order id of its own card; keep or remove the Delivering rep select on direct orders; the doc 13 R4 and R7 re-review under D-31. Deferred: a replay of `app.office_create_order` with different lines or a different assigned rep returns the first order (migration 0012's replay rule); the unused intermediate `app.create_order` body in the migration.
- **Not done in PR A, by design:** doc 03 ORD-04 still says the delivery itself writes the stock movement and invoice (rewritten in PR B); doc 13 section 9 still names the rep as maker of a discount, which D-30 ended (L-0392).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The office (owner or manager) creates official orders, directly or by converting a rep's order card, optionally assigning a delivering rep from the salon's territory; reps can no longer create orders.

**Architecture:** Extend the existing order engine in one forward-only migration: `sales_order` gains channel, creator, assigned rep and card link; the body of `app.create_order` moves into an internal `app.build_order` that a new `app.office_create_order` calls; the rep path is closed last, after every test fixture has moved. Cards are two append-only tables with RLS. PR B (delivery approval) and PR C (commission) are outlined at the end and get their own plans.

**Tech Stack:** PostgreSQL (Supabase) migrations and SECURITY DEFINER functions; Vitest + `pg` DB tests (`supabase/tests`); Next.js 16 / React 19 pages (`apps/web`); Playwright stack tests (`apps/web/e2e-stack`, CI only).

**Spec:** `docs/superpowers/specs/2026-11-03-orders-delivery-commission-design.md`

## Global Constraints

- Read `AGENTS.md`, `CLAUDE.md`, `docs/ACTIVITY.md` first; claim C-039 is this work's claim (L-0384); log with real evidence.
- One forward-only migration for PR A: `supabase/migrations/20261104090000_office_orders_cards.sql` (sorts after `20261103210000_office_cash.sql`).
- Every new table: `enable` and `force row level security` in the same migration, `control.audit_row` audit trigger, `control.forbid_mutation` append-only and no-truncate triggers, no write grant to any role, a row in `supabase/tests/rls-matrix.test.ts`.
- Every new function: `security definer`, `set search_path = ''`, `revoke execute ... from public, anon, authenticated, service_role`, explicit `grant execute ... to authenticated` only for callable RPCs; add callable names to the allowlist in `supabase/tests/verifier-attacks.test.ts` with the comment "migration 0025 (D-30 PR A); MJ standing approval L-0144".
- Office functions use `app.assert_office()` (owner or manager, AAL2); rep functions use `app.assert_actor_ready()` and refuse non-reps with `app.raise_denied` (SQLSTATE 42501). Bad input is 22023; a reused client_id with different content is 23505; a state conflict is 55000.
- Server time only (`now()`); money in integer paisa; Karachi date via `app.karachi_today()`.
- Run DB tests outside the Claude Code sandbox (embedded Postgres binds 127.0.0.1) with `DATABASE_URL` and `KIRAN_TEST_DATABASE_URL` unset: `pnpm exec vitest run --config supabase/tests/vitest.config.ts <file-name-fragments>`. If it prints "No test files found", the database set-up failed: rerun.
- Lint is Biome (`pnpm lint`); new TypeScript avoids magic numbers and raw loops (the repository's ts-patterns hook).

## Review Focus

1. A card converted twice (double submit, two office tabs): the second conversion is refused with 55000 and no second order exists.
2. An assigned rep who is not currently assigned to the salon's territory (or not a rep, or inactive): refused with 22023.
3. A rep calling `app.office_create_order`, or an office user at AAL1: refused with 42501.
4. Converting a dismissed card, or dismissing a converted card: refused with 55000.
5. Old rep-created orders (`source_channel = 'rep_visit'`) still read and deliver for their original rep after the migration.

---

### Task 1: Record the decisions in the planning docs

**Done:** 1aedb2e, ba0b106 (L-0389). Its fix round also wrote "commission rates: owner or manager" into the text of H-15 and the ACTIVITY section 1 D-08 note; that rule-text edit was reverted to main's wording (L-0394) and, after MJ accepted it in chat on 2026-11-04, re-applied as "commission rates per rep: owner or manager, D-31, MJ L-0385 and L-0396" (L-0396).

**Files:**
- Modify: `docs/12-decisions-and-open-questions.md` (D-08, D-10 rows; new D-31 and D-32 after D-30)
- Modify: `docs/03-requirements.md` (CTL-13; ORD-01 note on assigned rep)
- Modify: `docs/06-security-plan.md` (§2 matrix row "Commission plans / payout approval")
- Modify: `docs/ACTIVITY.md` (PROGRESS entry citing L-0385)

**Interfaces:** none (documentation).

- [x] **Step 1: Edit the docs**

D-31 (commission): "Commission is a percentage per rep, set and changed by the owner or manager (amends D-08 for commission rates only; creating users stays owner-only), earned on delivered and invoiced value of orders assigned to the rep (amends D-10 and CTL-13); a rate change applies from the change onward; the app shows earned commission only (no payouts) for a chosen date range | MJ in chat, ACTIVITY L-0385 | Confirmed; not built". D-32 (delivery approval): "A rep's delivery is an immutable submission; only the owner's or manager's approval writes the delivery, sale movement, invoice, installments and order status; rejected goods stay in pending custody until the office settles them | MJ's requirement, ACTIVITY L-0385 | Confirmed; not built". Mark D-10 "Superseded by D-31". CTL-13 text: "Commission is calculated on delivered and invoiced value of orders assigned to the rep (D-31)". Doc 06 row: "Commission rates | — | Set and change (D-31) | Set and change; payout approval owner-only".

- [x] **Step 2: Append an ACTIVITY PROGRESS entry and run the log check**

Run: `node scripts/activity-log-check.mjs origin/main`
Expected: `activity-log-check OK`

- [x] **Step 3: Commit** — `git commit -m "Docs: D-31 commission, D-32 delivery approval (L-0385)"`

### Task 2: Schema — order channel, creator, assigned rep, cards

**Done:** 0feee6e, 203d03d. As built: the channel check also keeps `assigned_rep_id` empty on `rep_visit` rows; `control.sales_order_creator` is a security invoker row trigger (it only sets NEW), not a definer function; the fix round closed a `rep_deliver` bypass on a null `rep_id` and made one order per card unique. The "existing rep order keeps rep_visit" test no longer goes through `app.create_order` (closed in Task 7): it builds the legacy row as postgres (`supabase/tests/helpers/legacy-order.ts`).

**Files:**
- Create: `supabase/migrations/20261104090000_office_orders_cards.sql`
- Test: `supabase/tests/order-cards.test.ts` (schema cases), `supabase/tests/rls-matrix.test.ts`

**Interfaces:**
- Produces: `public.sales_order` columns `source_channel public.order_channel not null` (enum `rep_visit`, `office`, `salon_portal`; existing rows `rep_visit`), `created_by uuid not null` (backfilled from `rep_id`), `assigned_rep_id uuid null`, `intake_card_id uuid null`; `rep_id` and `rep_day_id` nullable. Check `sales_order_channel_shape`: `rep_visit` rows have `rep_id` and `rep_day_id`; `office` rows have both null. Tables `public.order_intake_card(id uuid pk, client_id uuid unique, salon_id, rep_id, rep_day_id, visit_id null, body text check length(btrim(body)) between 1 and 2000, created_at)` and `public.order_intake_card_close(card_id uuid unique references order_intake_card, outcome text check in ('converted','dismissed'), order_id uuid null, reason text null, closed_by, closed_at)` with check: converted ⇒ order_id not null and reason null; dismissed ⇒ order_id null and length(btrim(reason)) >= 5.
- `public.invoice.rep_id` becomes nullable (office-delivered rep-less orders).
- The sales_order immutability trigger (`orders.sql` lines 148-153) gains the four new columns.

- [x] **Step 1: Write the failing tests**

In `order-cards.test.ts` (copy the set-up pattern of `supabase/tests/handovers.test.ts`): `"order_intake_card and its close table refuse UPDATE and DELETE, even for postgres"` expects errors matching `/append-only/`; `"an existing rep order keeps source_channel rep_visit and created_by = rep_id"` inserts through today's `app.create_order` as rep A and selects the row as postgres. In `rls-matrix.test.ts` add rows for both tables: office `true`; repA `rep_id = ${me("repA")}` (cards) and `card_id in (select c.id from public.order_intake_card c where c.rep_id = ${me("repA")})` (closes); repAWrongDevice, managerAal1, ownerAal1, suspended `false`; anon `denied`; service_role `true`.

- [x] **Step 2: Run to verify failure** — `... vitest run ... order-cards rls-matrix` → FAIL (relation does not exist).

- [x] **Step 3: Write the migration's schema part** (enum, columns, backfill `update public.sales_order set created_by = rep_id, source_channel = 'rep_visit'` under `session_replication_role = replica` because the immutability trigger forbids it, then `not null`; constraints; tables; RLS policies matching Step 1; triggers; grants `select` to authenticated, service_role).

- [x] **Step 4: Run to verify pass** — same command → PASS; also `schema-hygiene verifier-attacks` → PASS.

- [x] **Step 5: Commit** — `git commit -m "Schema: order channel, creator, assigned rep; order cards (D-30)"`

### Task 3: Office order creation

**Done:** ec62a6a, 692b444. Added in the fix round on MJ's answer (L-0390): the owner's own discount on an office order needs no approval request and sets `discount_by_owner`, which the discount constraint and `app.evaluate_order` accept; a manager's discount still requests approval. A null client_id is refused with 22023 (dc3dfd4).

**Files:**
- Modify: `supabase/migrations/20261104090000_office_orders_cards.sql`
- Test: `supabase/tests/office-orders.test.ts`

**Interfaces:**
- Consumes: Task 2 columns.
- Produces: internal `app.build_order(p_client_id uuid, p_salon_id uuid, p_plan public.plan_code, p_delivery_mode public.delivery_mode, p_lines jsonb, p_channel public.order_channel, p_rep_id uuid, p_rep_day_id uuid, p_visit_id uuid, p_assigned_rep_id uuid, p_intake_card_id uuid, p_created_at_client timestamptz) returns public.sales_order` (no grant), holding today's line validation, discount approval and insert, with `created_by = auth.uid()`. `app.create_order` keeps its signature and calls it with channel `rep_visit`. `app.office_create_order(p_client_id uuid, p_salon_id uuid, p_plan public.plan_code, p_lines jsonb, p_assigned_rep_id uuid default null, p_intake_card_id uuid default null) returns public.sales_order`: `assert_office`; delivery_mode `bag_now` when an assigned rep is given, else `warehouse`; assigned rep must satisfy `exists (rep_territory rt join area a ... where rt.rep_id = p_assigned_rep_id and rt.to_date is null and a.id = salon.area_id)` and be an active rep, else 22023; idempotent on client_id (same creator, salon, plan, card → return the row; else 23505).
- `app.evaluate_order`: the discount-approval match uses `a.maker_id = o.created_by` instead of `o.rep_id`.

- [x] **Step 1: Write the failing tests** — `office-orders.test.ts`: manager and owner each create a CASH and an INST4 order (status `confirmed` for an eligible salon, `source_channel` `office`, `created_by` the caller, `rep_id` null); assigned rep in the territory accepted, rep B (other territory) refused 22023, a manager id as assigned rep refused 22023; repA and managerAal1 refused 42501 (Review Focus 3); a discount line creates a `discount` approval whose maker is the manager and leaves the order draft with `hold_discount = 'pending'`; a replay returns the same order; a changed replay 23505; the credit gate still holds an INST4 order over the limit (`hold_credit = 'over_limit'`).

- [x] **Step 2: Run to verify failure** — `... vitest run ... office-orders` → FAIL (function does not exist).

- [x] **Step 3: Implement** `app.build_order`, the new `app.create_order` body, `app.office_create_order`, the `evaluate_order` change (as `create or replace`, copying the 0012 bodies and changing only those lines).

- [x] **Step 4: Run** `... office-orders orders deliveries` → PASS (existing order and delivery suites unchanged).

- [x] **Step 5: Commit** — `git commit -m "Office order creation through a shared order builder"`

### Task 4: Order cards and conversion

**Done:** 33ba45a, ad644c1. The fix round capped the dismissal reason at 500 characters (at least 5 as planned), refused a null client_id on `app.rep_create_card` (22023), re-checked a replay after the card lock and added AAL1 and anonymous refusals. Not tested: a concurrent replay of a card conversion from two sessions (the post-lock branch).

**Files:**
- Modify: the PR A migration
- Test: `supabase/tests/order-cards.test.ts`

**Interfaces:**
- Produces: `app.rep_create_card(p_client_id uuid, p_salon_id uuid, p_body text, p_visit_id uuid default null) returns public.order_intake_card` (rep, approved device, open day via `app.my_open_day_id()`, `app.rep_can_reach_salon`); `app.my_cards() returns table(card_id uuid, salon_id uuid, salon_name text, body text, created_at timestamptz, status text, order_id uuid, reason text)` limit 50; `app.office_open_cards() returns table(card_id, salon_id, salon_name, rep_id, rep_name, body, created_at)` (no close row), limit 200; `app.office_dismiss_card(p_card_id uuid, p_reason text) returns public.order_intake_card_close`. `app.office_create_order` with `p_intake_card_id`: card must exist, be for the same salon and open (else 55000); writes the `converted` close row in the same transaction; a converted card pre-selects nothing in SQL (the page pre-selects the card's rep).

- [x] **Step 1: Write the failing tests** — rep A creates a card (idempotent replay; blank body 22023; other territory 42501; no open day 42501; office 42501); `my_cards` shows it `open`; manager sees it in `office_open_cards`; converting it with rep A assigned closes it `converted` with the order id; a second conversion 55000 (Review Focus 1); dismissing with a 4-character reason 22023; dismissing then converting 55000 and converting then dismissing 55000 (Review Focus 4); rep B cannot see rep A's card.

- [x] **Step 2: Run to verify failure** — `... order-cards` → FAIL.

- [x] **Step 3: Implement** the four functions and the card branch of `app.office_create_order` (lock the card row `for update` before checking it is open).

- [x] **Step 4: Run** `... order-cards office-orders rls-matrix verifier-attacks` → PASS.

- [x] **Step 5: Commit** — `git commit -m "Rep order cards; office converts or dismisses (ORD-14)"`

### Task 5: Assigned rep reads and delivers

**Done:** c7a3b02, eca0f83. The assigned rep reads and delivers; `app.recheck_order` and `app.cancel_order` stay with the order's own rep (`rep_id`), so the assigned rep gains no other write path; `app.cancel_order`, `app.recheck_order` and `app.invoice_document` were made safe for rep-less orders, which are closed to every rep.

**Files:**
- Modify: the PR A migration (replace `app.rep_deliver` from `20261103154528_payments.sql`'s `app.deliver` path only where it checks the rep; RLS policies `sales_order_select`, `sales_order_line_select`, delivery policies from `20261028100000_deliveries.sql` lines 277-295; `app.my_orders`)
- Test: `supabase/tests/office-orders.test.ts`

**Interfaces:**
- Produces: a rep may read and deliver an order when `o.rep_id = auth.uid() or o.assigned_rep_id = auth.uid()`; `app.my_territory_orders() returns table(order_id uuid, salon_id uuid, salon_name text, status public.order_status, total_paisa bigint, plan public.plan_code, assigned_rep_id uuid, created_at timestamptz)` for salons the rep can reach, limit 50, read-only; `app.office_orders(p_status public.order_status default null, p_channel public.order_channel default null) returns setof public.sales_order` limit 200 newest first. The invoice written by `app.deliver` sets `rep_id` to `coalesce(o.assigned_rep_id, o.rep_id)` (null for rep-less office orders).

- [x] **Step 1: Write the failing tests** — rep A delivers an office order assigned to rep A (invoice and installments issued as today); rep B cannot deliver it (42501); a rep-less office order is delivered by `app.office_deliver` and its invoice has `rep_id` null; a legacy rep_visit order still delivers for its rep (Review Focus 5); `my_territory_orders` lists territory orders for rep A and nothing of territory B.

- [x] **Step 2: Run to verify failure.** **Step 3: Implement.** **Step 4: Run** `... office-orders deliveries payments` → PASS.

- [x] **Step 5: Commit** — `git commit -m "Assigned rep reads and delivers office orders"`

### Task 6: Move test fixtures to the office path

**Done:** 8882d9f. Set-up moved to the office path in seven files; legacy `rep_visit` orders for tests come from `supabase/tests/helpers/legacy-order.ts`.

**Files:**
- Modify: every test that calls `app.create_order` as a rep for set-up: `supabase/tests/{orders,deliveries,payments,receivables-ageing,handovers,office-cash,invoice-document,crm-attacks,verify-slices-1-3}.test.ts` and any other file found by `grep -l "app.create_order" supabase/tests`

**Interfaces:**
- Consumes: `app.office_create_order(..., p_assigned_rep_id => <rep>)`.

- [x] **Step 1:** Replace each set-up call `["repA", "select app.create_order('<cid>', '<salon>', '<plan>', 'bag_now', <lines>)"]` with `["manager", "select app.office_create_order('<cid>', '<salon>', '<plan>', <lines>, '<repA id>')"]`; keep every assertion. Tests whose subject is the rep order path itself (in `orders.test.ts`) stay and are rewritten in Task 7.

- [x] **Step 2: Run** the whole module set in two parts (host memory): `... orders deliveries payments receivables-ageing handovers office-cash invoice-document` then `... crm-attacks verify-slices-1-3 verifier-attacks reverify3-attacks rls-matrix schema-hygiene` → PASS.

- [x] **Step 3: Commit** — `git commit -m "Tests: create orders through the office path"`

### Task 7: Close the rep order path

**Done:** 8b60088, 7ce5d84, 8780b91. The rep-path tests in `orders.test.ts` and `crm-attacks.test.ts` were ported to the office path, not deleted; only the rep-as-creator assertions became the single refusal test.

**Files:**
- Modify: the PR A migration (`app.create_order` refuses everyone)
- Modify: `supabase/tests/orders.test.ts` (rep-path tests become refusal tests), `supabase/tests/verifier-attacks.test.ts` (keep `create_order` in the allowlist: still executable, always refuses)

**Interfaces:**
- Produces: `app.create_order(...)` raises 42501 "reps no longer place orders: record an order card (D-30)" for every role.

- [x] **Step 1: Write the failing test** — `"a rep cannot create an order (D-30)"`: rep A → 42501 with that message; the office → 42501 too (it uses `office_create_order`).
- [x] **Step 2: Run to verify failure.** **Step 3: Implement.** **Step 4: Run** the two-part suite from Task 6 → PASS.
- [x] **Step 5: Commit** — `git commit -m "Close the rep order path (D-30)"`

### Task 8: Screens

**Done:** f0cab9b, 3f47040, aedd39e; dismiss box minimum 5 characters in dc3dfd4. The stack test is written but has not run anywhere yet (no Docker on the build host; CI has not run because the branch is not pushed); the rep PWA browser tests passed locally (4). As built: the Delivering rep select is also offered on direct orders, default "No rep" (L-0391); the salon picker loads at most 500 salons and shows a note when the list is full.

**Files:**
- Create: `apps/web/app/office/(shell)/orders/page.tsx` (list via `office_orders`, open cards via `office_open_cards`, Create New Order form, Dismiss with reason)
- Create: `apps/web/components/order-form.tsx` (salon picker, SKU lines with quantity, plan, delivering rep select loaded from the salon's territory reps or "No rep"; pre-filled from a card)
- Create: `apps/web/app/app/cards/page.tsx` (my cards), `apps/web/app/app/orders/page.tsx` (my territory orders, read-only)
- Modify: `apps/web/app/app/salons/[id]/page.tsx` (New Order Details card form), `apps/web/app/office/(shell)/layout.tsx` (nav "Orders"), `apps/web/app/app/page.tsx` (links)
- Test: `apps/web/e2e-stack/office.spec.ts`

**Interfaces:**
- Consumes: Tasks 3 to 5 RPCs; `apps/web/lib/rpc.ts` `rpc()`; `apps/web/lib/money.ts` `rupees()`.

- [x] **Step 1: Write the stack test** — in the rep journey, after the salon is created: rep writes a card "[Test] 2 bottles shade 5"; "My cards" shows it Open. New test after it: manager opens Orders, sees the card, Create order from it with rep pre-selected, needs a priced SKU: seed one in `scripts/e2e-stack-seed.mjs` (`[Dummy]` product, owner-set price) and the salon's credit (CASH plan needs none); after saving, the card disappears from the queue and the order is listed `confirmed`; the rep's Orders page lists it.
- [x] **Step 2:** Build the pages (loading, empty, error states; database messages shown as returned).
- [x] **Step 3: Run** `pnpm typecheck`, `pnpm lint`, `pnpm -C apps/web build` (placeholder public env), `pnpm -C apps/web exec playwright test` → all pass; the stack test runs in CI.
- [x] **Step 4: Commit** — `git commit -m "Orders area, order cards and rep orders screens"`

### Task 9: Verify, log, publish

**Steps 1 and 2 done:** 3c63986 (L-0390 to L-0392). The DB tests ran in parts on the build host: 32 of 37 files, 2,448 tests, no failures (L-0391); reverify5, 8, 9, 10 and 11 were not run on this branch. **Step 3 open:** nothing is pushed.

- [x] **Step 1:** Run the full targeted DB set (Task 6 Step 2), `pnpm typecheck`, `pnpm lint`, `pnpm agent:preflight`, `node scripts/activity-log-check.mjs origin/main`; record real counts.
- [x] **Step 2:** Append PROGRESS (evidence), HANDOFF; keep C-039 active (PR B continues).
- [ ] **Step 3:** Ask MJ before pushing and opening the PR (execution map gate G3); merge only on MJ's OK for that PR, with every required check green on its exact head.

---

## PR B outline: delivery submission and approval (own plan later)

Migration `..._delivery_approval.sql`: `pending_delivery` location kind per rep; movement kinds `submitted_to_salon`, `pending_returned`; tables `delivery_submission`, `delivery_submission_decision`, `pending_stock_resolution`; `app.rep_submit_delivery`; `app.rep_deliver` loses grants and its logic becomes internal `app.finalise_delivery`; `app.office_approve_delivery`, `app.office_reject_delivery`, `app.office_resolve_pending`, reads; invoice gains `delivered_by`, `commission_rep_id`. Tests: every case in spec section 7; fixtures move from `rep_deliver` to submit-then-approve. Screens: office Delivery approvals; rep Deliver on assigned orders. Doc 06 section 2 classification table. Also (added 2026-11-04): rewrite doc 03 ORD-04 for D-32 (L-0392); a rep-less order keeps PR A's office path (`app.office_deliver`, A-18, still an open assumption). Status: NOT STARTED; its own plan comes first.

## PR C outline: commission (own plan later)

Migration `..._commission.sql`: `rep_commission_rate` (append-only); invoice `commission_rate_bp` stamped at approval; `app.office_set_commission_rate`, `app.my_commission(from, to)`, `app.office_commission(rep, from, to)` with floor(total × bp / 10000). Screens: Team page rate field; rep and office Commission areas with a date range. Tests: rate history, forward-only changes, reassignment does not move commission, unapproved submissions excluded. MJ's rules to keep (D-31, L-0385): earned only, so no payout table or function; a rate change applies from the change onward; the owner or manager sets rates (the Team page rate field shows for both); creating the rep's user account stays owner-only. Status: NOT STARTED; its own plan comes after PR B.
