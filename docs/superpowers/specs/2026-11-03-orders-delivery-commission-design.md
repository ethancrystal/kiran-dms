# Office orders, rep order cards, delivery approval and rep commission — design

Status: design approved section by section by MJ in chat on 2026-11-03; this written spec awaits MJ's review. Decisions behind it: ACTIVITY L-0363 (D-30), L-0374 to L-0382, L-0385. Planning docs win on any disagreement (SPEC.md); this file is a design record, not a status board.

## 1. Purpose and success

MJ's order model (D-30): only the office (owner or manager) and, later, the salon portal create official orders; reps record the salon's requirements as order cards. MJ then added two rules: reps earn commission on the orders assigned to them, and nothing a rep submits becomes an official delivery, invoice, stock sale or commission until the owner or manager approves it.

Success means, end to end on the real local stack and in CI:
- the database refuses a rep who tries to create an order, finalise a delivery, issue an invoice, post a sale movement or touch commission attribution;
- a rep writes a card, the manager converts it into an order with that rep assigned, the rep submits the delivery, the manager approves it, and the invoice, installments and the rep's commission appear for both;
- a rejected submission keeps its history and its goods stay in a pending-delivery location until the office settles where they are.

## 2. Scope and order of work

| # | Piece | Pull request | Depends on |
|---|---|---|---|
| 1 | Office orders, order cards, Orders area, assigned rep | PR A | — |
| 2 | Delivery submission and approval, pending stock custody | PR B | A |
| 3 | Commission rates and the commission area | PR C | B |

Out of scope here: the salon portal (separate design, reuses piece 1's order engine), the B-41 defect fixes (verifier branch), returns, credit notes, write-off clawback, payouts, the cash cap (CTL-17), bank deposits.

## 3. Decisions this design rests on

- Reps do not create orders; the office does, directly or from a rep's card (D-30, L-0363).
- Reps still deliver and collect as now (L-0374), but a rep's delivery is a submission the office approves (MJ's delivery-approval requirement, L-0385).
- An order converted from a card gets an assigned rep: the manager picks one of the reps currently assigned to the salon's territory, the card's rep pre-selected. An order the manager creates directly gets no rep (A-16 as answered, L-0385). A rep-less order is delivered from the warehouse by the office and paid through the office paths (A-18, assumption).
- Commission: on delivered, invoiced value (amends D-10 and CTL-13); one percentage per rep; a change applies from the change onward; the area shows earned commission only, no payouts; the owner or manager sets and changes rates (amends D-08 for this power only); creating user accounts stays owner-only (L-0385).

## 4. Data model (forward-only migrations, one per pull request)

### PR A
- `sales_order`: `rep_id` and `rep_day_id` become nullable (existing rep orders keep them). New columns: `source_channel` (`rep_visit` for existing rows only, `office`; `salon_portal` reserved), `created_by` (auth user), `assigned_rep_id` (nullable; must be a rep currently assigned to the salon's territory when set), `intake_card_id` (nullable). A check keeps `rep_visit` rows shaped as today and `office` rows with `rep_day_id` null.
- `order_intake_card` (append-only): id, client_id (unique), salon_id, rep_id, rep_day_id, visit_id (nullable), body (1 to 2000 characters, not blank), created_at (server).
- `order_intake_card_close` (append-only): card_id (unique), outcome (`converted` with order_id, or `dismissed` with a reason of at least 5 non-blank characters), closed_by, closed_at.
- Functions:
  - `app.office_create_order(client_id, salon_id, plan, lines, assigned_rep_id, intake_card_id)`: owner or manager at AAL2; reuses the existing pricing, credit gate, discount hold and confirmation logic of `app.create_order` by moving it into an internal function both call; converting a card closes it in the same transaction; idempotent on client_id.
  - `app.create_order` (the rep path) refuses every caller (42501) with a message pointing to cards.
  - `app.rep_create_card(client_id, salon_id, body, visit_id)`: rep, approved device, open day, own territory; idempotent.
  - `app.my_cards()`, `app.office_open_cards()`, `app.office_dismiss_card(card_id, reason)`.
  - `app.office_orders(filters)` and `app.my_territory_orders()` (read-only for reps, territory-scoped, at most 50 rows).

### PR B
- New stock location kind `pending_delivery`, one per rep, created with the rep's bag; new movement kinds `submitted_to_salon` (bag to pending), `pending_returned` (pending to bag), and the existing sale movement now leaving from pending for approved submissions. Same ledger, same negative-stock guards.
- `delivery_submission` (append-only): id, client_id (unique), order_id, salon_id, rep_id, rep_day_id, lines (SKU and quantity), recipient name, lat/lng, distance_from_pin_m, device id, mock flag, flags, submitted_at (server), submitted_at_client.
- `delivery_submission_decision` (append-only): submission_id (unique), outcome (`approved` with delivery_id, or `rejected` with a reason), decided_by, decided_at.
- `pending_stock_resolution` (append-only): submission_id, SKU, quantity, outcome (`returned_to_bag` with count evidence, `missing` with an adjustment request id), resolved_by, resolved_at. Quantities resolved can never exceed quantities rejected.
- Functions:
  - `app.rep_submit_delivery(client_id, order_id, lines, recipient, lat, lng, mock, at_client)`: rep only; the order must be confirmed and assigned to this rep; moves the quantities from bag to pending; does not change the order.
  - `app.rep_deliver` loses every grant; its finalising logic becomes internal `app.finalise_delivery`, callable only from the approval function and `app.office_deliver`.
  - `app.office_approve_delivery(submission_id, client_id)`: owner or manager at AAL2; approver must not be the submitter; in one transaction re-checks the order, remaining quantities and pending stock, writes delivery and lines, posts the sale movement from pending, issues the invoice and installments, advances the order, records the decision.
  - `app.office_reject_delivery(submission_id, reason)` and `app.office_resolve_pending(submission_id, sku, qty, outcome, evidence)`.
  - Reads: `app.office_pending_deliveries()`, `app.my_submissions()`.
- `invoice` gains `delivered_by` and `commission_rep_id` (the order's assigned rep at approval), both set by `app.finalise_delivery`.

### PR C
- `rep_commission_rate` (append-only): rep_id, rate_bp (0 to 10000; 250 means 2.50 percent), effective_from (server), set_by, reason.
- `invoice` gains `commission_rate_bp`, stamped at approval from the rate in force (0 when none). PR C ships before any production use, so no invoice exists without it; a migration-time backfill sets 0 on test data.
- Functions: `app.office_set_commission_rate(rep_id, rate_bp, reason)` (owner or manager at AAL2); `app.my_commission(from, to)` (rep, own); `app.office_commission(rep_id or null, from, to)` (owner or manager). Commission per invoice = floor(total_paisa × commission_rate_bp / 10000), dates by the invoice's Karachi date, lines plus totals, at most 500 lines.

Every new table: RLS enabled and forced in its migration, audit trigger, forbid-mutation and no-truncate triggers, no write grants, rows in the RLS matrix, the function allowlist updated.

## 5. Approval classification (delivered with PR B, in doc 06 section 2)

| Class | Operations |
|---|---|
| Rep submits, recorded and audited, no approval | visits, notes, salon sign-up, order cards, payments at the salon, delivery submissions, bag counts, handover answers |
| Office approval before the official state changes | delivery finalisation (invoice, stock sale, order status, commission input), card conversion into an order, discount below list, stock adjustment and write-off requests (P1-08) |
| Owner-only governance | users, price lists, bank details, write-offs above threshold, configuration, vault grants (D-08); commission rates are owner or manager (L-0385) |
| System-generated, immutable | invoices, receipt numbers, installments, audit events, stage events, cash ledger rows |

## 6. Screens

- Office: Orders area (list, filters, Create New Order with salon, lines, plan, delivering rep from the territory or none, open cards queue with convert and dismiss); Delivery approvals (pending submissions, approve, reject, settle pending stock); Team page rate field; Commission area (rep and date range).
- Rep: New Order Details on the salon page; My cards; Orders (read-only, Deliver on own assigned orders); Commission area (date range).

## 7. Tests

- Database: `office-orders`, `order-cards`, `delivery-approval`, `commission` test files covering every case in MJ's list (rep submission leaves the order unfinalised; rep cannot approve, change status, create invoices or sale movements; manager and owner approve; self-approval and other reps refused; salon users refused once the portal exists; duplicate approvals create nothing twice; partial approval moves only approved quantities; rejection keeps history and pending custody; commission excludes unapproved submissions; attribution and rates survive territory reassignment and later rate changes).
- Existing tests that create orders through the rep path (`orders`, `deliveries`, `payments`, `receivables-ageing`, `handovers`, `office-cash`, verifier files) move their set-up to the office order and submit-then-approve functions; behaviour they assert is unchanged.
- RLS matrix rows and function allowlist; one real-stack browser journey for card to approved delivery to commission, and a rejection path.

## 8. Risks

- The test set-up migration is broad; it is done in PR A and B with each file's assertions untouched.
- Moving the order and delivery logic into internal functions must keep every existing guard; the existing order and delivery test suites are the regression net.
- Rejected goods in pending custody need office follow-up; the office approvals page lists unresolved quantities.
