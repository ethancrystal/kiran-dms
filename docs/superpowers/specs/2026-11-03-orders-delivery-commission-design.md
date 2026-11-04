# Office orders, rep order cards, delivery approval and rep commission — design

Status: design approved section by section by MJ in chat on 2026-11-03, and the written spec approved by MJ ("Spec approved", ACTIVITY L-0388). Decisions behind it: ACTIVITY L-0363 (D-30), L-0374 to L-0382, L-0385; recorded in doc 12 as D-30, D-31 and D-32. Planning docs win on any disagreement (SPEC.md); this file is a design record, not a status board (ACTIVITY §12 is).

Progress (2026-11-04): PR A is built on branch `claude/orders-delivery-commission` (ACTIVITY L-0391, L-0393), IMPLEMENTED — NOT VERIFIED: not pushed, no pull request, the stack browser tests not yet run (CI only), no independent check yet. PR B and PR C are NOT STARTED; each gets its own plan first (L-0392). What changed or was decided while building PR A is in section 9.

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

State on 2026-11-04: PR A built, awaiting an independent check and MJ's push decision ([plan](../plans/2026-11-03-office-orders-and-cards.md)); PR B and PR C not started.

Out of scope here: the salon portal (separate design, reuses piece 1's order engine), the B-41 defect fixes (verifier branch), returns, credit notes, write-off clawback, payouts, the cash cap (CTL-17), bank deposits.

## 3. Decisions this design rests on

- Reps do not create orders; the office does, directly or from a rep's card (D-30, L-0363).
- Reps still deliver and collect as now (L-0374), but a rep's delivery is a submission the office approves (MJ's delivery-approval requirement, L-0385).
- An order converted from a card gets an assigned rep: the manager picks one of the reps currently assigned to the salon's territory, the card's rep pre-selected. For an order the manager creates directly, or a salon order, choosing no rep is allowed (A-16 as answered, L-0385; doc 03 ORD-01). Reconciled with section 6 (2026-11-04): the office form keeps the territory-rep select on a direct order with "No rep" as the default, reading MJ's answer as allowing a rep or none there (an interpretation recorded in L-0391); MJ may ask for the select to be removed. A rep-less order is delivered from the warehouse by the office and paid through the office paths (A-18, still an open assumption, L-0386).
- Commission: on delivered, invoiced value (amends D-10 and CTL-13); one percentage per rep; a change applies from the change onward; the area shows earned commission only, no payouts; the owner or manager sets and changes rates (amends D-08 for this power only); creating user accounts stays owner-only (L-0385). The exception lives in D-31 (doc 12) and the doc 06 section 2 matrix; the text of hard rule H-15 stays as on main until MJ explicitly accepts a change to it (ACTIVITY L-0394).
- The owner's own discount on an office order the owner creates needs no approval; the order records `discount_by_owner` and the audit trail keeps it. A manager's discount still needs approval (MJ, ACTIVITY L-0390).

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
- As built (migration `20261104090000_office_orders_cards.sql`, ACTIVITY L-0391, L-0393), in addition to the above:
  - `sales_order` also gains `discount_by_owner` (L-0390); `created_by` is set by the invoker trigger `control.sales_order_creator`; `invoice.rep_id` becomes nullable and the invoice takes the order's assigned rep, or else its rep. The channel check also keeps `assigned_rep_id` empty on `rep_visit` rows.
  - The shared internal builder is `app.build_order`; `app.office_orders` takes a status and a channel filter (at most 200 rows).
  - A rep reads and delivers an order when it is the order's rep or its assigned rep; recheck and cancel stay with the order's own rep, and a rep-less order is closed to every rep.
  - A card dismissal reason is 5 to 500 characters (`app.office_dismiss_card`); `app.rep_create_card` and `app.office_create_order` refuse a null client_id (22023).

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
- Docs in PR B: doc 03 ORD-04 is rewritten (today it says the delivery itself writes the stock movement and the invoice; under D-32 only the approval does, L-0392). A rep-less order keeps the office path of PR A (`app.office_deliver`, A-18) until MJ answers A-18.

### PR C
- `rep_commission_rate` (append-only): rep_id, rate_bp (0 to 10000; 250 means 2.50 percent), effective_from (server), set_by, reason.
- `invoice` gains `commission_rate_bp`, stamped at approval from the rate in force (0 when none). PR C ships before any production use, so no invoice exists without it; a migration-time backfill sets 0 on test data.
- Functions: `app.office_set_commission_rate(rep_id, rate_bp, reason)` (owner or manager at AAL2); `app.my_commission(from, to)` (rep, own); `app.office_commission(rep_id or null, from, to)` (owner or manager). Commission per invoice = floor(total_paisa × commission_rate_bp / 10000), dates by the invoice's Karachi date, lines plus totals, at most 500 lines.
- MJ's commission rules carried into PR C (D-31, L-0385): earned only, so no payout table or function; a rate change applies from the change onward (a new `rep_commission_rate` row, never an edit); the owner or manager sets rates; creating the rep's user account stays owner-only. Doc 13 R4 and R7 were flagged for re-review under D-31 (L-0392); that re-review is still open with MJ.

Every new table: RLS enabled and forced in its migration, audit trigger, forbid-mutation and no-truncate triggers, no write grants, rows in the RLS matrix, the function allowlist updated.

## 5. Approval classification (delivered with PR B, in doc 06 section 2)

| Class | Operations |
|---|---|
| Rep submits, recorded and audited, no approval | visits, notes, salon sign-up, order cards, payments at the salon, delivery submissions, bag counts, handover answers |
| Office approval before the official state changes | delivery finalisation (invoice, stock sale, order status, commission input), card conversion into an order, discount below list (except the owner's own discount on an office order the owner creates, recorded on the order, L-0390), stock adjustment and write-off requests (P1-08) |
| Owner-only governance | users, price lists, bank details, write-offs above threshold, configuration, vault grants (D-08); commission rates are owner or manager (L-0385) |
| System-generated, immutable | invoices, receipt numbers, installments, audit events, stage events, cash ledger rows |

## 6. Screens

- Office: Orders area (list, filters, Create New Order with salon, lines, plan, delivering rep from the territory or none, open cards queue with convert and dismiss); Delivery approvals (pending submissions, approve, reject, settle pending stock); Team page rate field (owner or manager; adding the user stays owner-only, L-0385); Commission area (rep and date range).
- As built in PR A (L-0391, task 8 of the plan): the Orders area is `/office/orders`; the salon picker loads at most 500 salons by name and says so when the list is full (a salon further down can still be ordered from a rep's card); the dismiss box asks for at least 5 characters, as the database does; the rep's My cards is `/app/cards` and its read-only Orders is `/app/orders`. The rep's Deliver button and the Delivery approvals, Team rate and Commission screens come with PR B and PR C.
- Rep: New Order Details on the salon page; My cards; Orders (read-only, Deliver on own assigned orders); Commission area (date range).

## 7. Tests

- Database: `office-orders`, `order-cards`, `delivery-approval`, `commission` test files covering every case in MJ's list (rep submission leaves the order unfinalised; rep cannot approve, change status, create invoices or sale movements; manager and owner approve; self-approval and other reps refused; salon users refused once the portal exists; duplicate approvals create nothing twice; partial approval moves only approved quantities; rejection keeps history and pending custody; commission excludes unapproved submissions; attribution and rates survive territory reassignment and later rate changes).
- Existing tests that create orders through the rep path (`orders`, `deliveries`, `payments`, `receivables-ageing`, `handovers`, `office-cash`, verifier files) move their set-up to the office order and submit-then-approve functions; behaviour they assert is unchanged.
- RLS matrix rows and function allowlist; one real-stack browser journey for card to approved delivery to commission, and a rejection path.

## 8. Risks

- The test set-up migration is broad; it is done in PR A and B with each file's assertions untouched.
- Moving the order and delivery logic into internal functions must keep every existing guard; the existing order and delivery test suites are the regression net.
- Rejected goods in pending custody need office follow-up; the office approvals page lists unresolved quantities.

## 9. Decisions and changes during PR A (added 2026-11-04)

- Owner's own discount (MJ in chat, 2026-11-04, ACTIVITY L-0390): with one owner account, an owner's discount above the approval threshold could never be approved (H-12), so the owner's own discount on an office order needs no approval; the order records `discount_by_owner` and its audit row carries it. Doc 06 section 2, doc 13 section 9 and CTL-07 carry a note.
- A-16 (confirmed with MJ's addition, L-0385): the delivering rep is chosen by the manager from the salon's territory reps; choosing none is allowed for manager-direct and salon orders. The form keeps the select on direct orders, default "No rep" (L-0391); section 3 now says so.
- A-18 (L-0386) is assumed, not confirmed: a rep-less order is delivered by the office (`app.office_deliver`) and paid through the office paths.
- Card dismissal: the reason is at least 5 characters (the table check and `app.office_dismiss_card`, which also caps it at 500), and the office page asks for 5 (L-0393).
- Salon picker: the office order form loads at most 500 salons and shows a note when the list is full (plan task 8 review).
- Hard rule H-15: plan task 1 added "commission rates: owner or manager" to the text of H-15 and of the ACTIVITY section 1 D-08 note (L-0389). A change to a hard rule needs MJ's explicit acceptance, so both are restored to main's wording (L-0394); the exception stays in D-31 and the doc 06 section 2 matrix.
- Review and fix rounds: plan tasks 1 to 5, 7 and 8 each had one fix round after review (task 6's review found nothing to fix), and the final whole-branch review had one more (commit dc3dfd4, L-0393: RLS matrix rows for assigned reps, docs 03, 04 and 06, the null client_id check). The plan's status block lists the commits.
- Left open for MJ (L-0392, L-0393): A-18; closing B-14 (moot under D-30); whether a rep may see the dismissal reason and order id of its own card; keeping the Delivering rep select on direct orders; the doc 13 R4 and R7 re-review; a replay of `app.office_create_order` with different lines returns the first order (the migration 0012 replay rule, deferred); the unused intermediate `app.create_order` body in the migration.
