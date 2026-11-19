# Orders and Delivery — module document (context `orders-delivery`)

This document is derived reference material written by the 2026-11-19 documentation audit. It never overrides the numbered planning documents, doc 16 or `docs/ACTIVITY.md` (ACTIVITY §1); doc 03 stays the index of requirement IDs and the source of every statement quoted here. Status is derived from the ACTIVITY §12 board and the evidence named, using the vocabulary in [docs/requirements/README.md](../../requirements/README.md#status-vocabulary).

## 1. Purpose and boundaries

From a salon's need to a delivered, invoiced order: order requests from reps and salons, the office requests queue, official orders, credit and price gates at order time, delivery submission and approval, the salon's signed acknowledgement, invoices and the agent (reseller) channel.

**Outside this module:** Payments, installments and receipts (money-credit); stock levels (inventory, which this module moves through approved deliveries); salon records (salon-pipeline).

## 2. Glossary

- **Order request:** What a rep or salon submits: a card with optional lines and never a price. The same thing is called "order-intake card" and "New Order Details card" (table `order_intake_card`). It is not an order (D-30, D-34).
- **Official order:** A `sales_order` created only by the office (ORD-01).
- **Delivery submission:** A rep's immutable record of handing over goods; final only after office approval (D-32).
- **Acknowledgement:** The salon's signature on exactly the delivered goods, required for every invoice (D-49).
- **Regular User order:** A storefront buyer's order (D-59), planned in P1-37.

## 3. Actors and permissions

Owner and manager: create, convert, approve, cancel, set prices. Rep: submit requests and deliveries for reachable salons. Salon member: submit and read its own requests and orders. Agent: planned (P1-15). Matrix: doc 06 §2 rows "Create official sales orders" to "Discount below list price" and doc 13 §9.

## 4. Owned entities and data

Tables owned (from the migrations on `main` at `d4b47ca`): `sales_order`, `sales_order_line`, `order_intake_card`, `order_intake_card_close`, `order_intake_card_line`, `order_intake_card_version`, `delivery`, `delivery_line`, `delivery_submission`, `delivery_submission_decision`, `delivery_signature`, `delivery_signature_access`, `delivery_signature_image`, `delivery_signature_use`, `pending_stock_resolution`, `invoice`, `invoice_draft_version`, `invoice_snapshot`, `sku_price_change`, `salon_sku_price`. Ownership follows CONTEXT-MAP.md; no table is owned by two modules.

## 5. Functional requirements

23 requirements, in doc 03 order. Phase 1 requirements carry a full record; later-phase requirements carry their statement and status.

#### ORD-01

**Priority:** M · **Phase:** 1 · **Status:** IMPLEMENTED — NOT VERIFIED

- **Statement (doc 03, verbatim):** Create an official order for a salon, by the office only (owner or manager), directly or by converting an order request (ORD-15); reps and salons submit requests and do not create official orders (D-30, D-34): lines (SKU, qty, unit price: the salon's office-set price when one exists, otherwise the SKU's current list price, copied onto the line; OQ-33 settles how a salon price below list meets the price gate; price lists with dates are ORD-07), discounts below list only with approval (CTL-07), payment plan (cash / 2 / 4), delivery mode (from bag now / warehouse dispatch), and an optional assigned rep, the rep who delivers it: the manager (or owner) picks the delivering rep from the reps who can reach the salon (D-36; the card's rep pre-selected when converting a rep's card), and may choose none for a manager-direct or salon order (A-16, MJ L-0385)
- **Actor:** Owner or manager
- **Preconditions:** Salon approved; SKUs active
- **Expected behaviour:** The office creates an official order directly or by converting a request; each line copies the salon's office-set price or the list price
- **Business rules:** Reps and salons never create official orders (D-30, D-34); OQ-33 open
- **Permissions:** Office only
- **Failure and exceptions:** A rep or salon call is refused; a pending salon is refused
- **Acceptance criteria:**
  - AC-ORD-01-1: `app.office_create_order` by a rep is refused
  - AC-ORD-01-2: Each line's unit price equals the salon price when set, else the current list price
  - AC-ORD-01-3: `app.create_order` refuses every caller (tombstone)
- **Tests:** citing this ID: `crm-attacks.test.ts`, `orders.test.ts`; through its board task: `crm-attacks.test.ts`, `deliveries.test.ts`, `e2e/salon-login.spec.ts`, `invoice-document.test.ts`, `office-order-access.test.ts`, `office-orders.test.ts`, `order-cards.test.ts`, `orders.test.ts`, `requests-portal.test.ts`
- **Implementation evidence:** board: P1-06 (IN PROGRESS); P1-23 (IN PROGRESS); `components/order-form.tsx`; `supabase/tests/office-orders.test.ts`
- **Open or related decisions:** OQ-33

#### ORD-02

**Priority:** M · **Phase:** 1 · **Status:** IMPLEMENTED — NOT VERIFIED

- **Statement (doc 03, verbatim):** Credit check at order time for installment plans: plan allowed for salon, exposure + order ≤ credit limit, salon not Blocked. A cash-on-delivery order needs no credit, so a Blocked salon may still buy cash (doc 09 §2; MJ, ACTIVITY L-0163). Hard stop for an order made from a salon's request; Mg/O can override with reason
- **Actor:** System; owner or manager (override)
- **Preconditions:** Order with an installment plan
- **Expected behaviour:** Credit check: plan allowed, exposure + order ≤ limit, salon not blocked; cash orders need no credit
- **Business rules:** Hard stop for an order from a request; override needs a reason (CTL-08)
- **Permissions:** Office overrides
- **Failure and exceptions:** Over-limit order is refused unless overridden with a reason
- **Acceptance criteria:**
  - AC-ORD-02-1: An installment order that would exceed the limit is refused
  - AC-ORD-02-2: A cash order for a blocked salon succeeds
  - AC-ORD-02-3: An override without a reason is refused
- **Tests:** citing this ID: `crm-attacks.test.ts`, `orders.test.ts`; through its board task: `audit-fixes.test.ts`, `b33-decisions.test.ts`, `crm-attacks.test.ts`, `deliveries.test.ts`, `e2e-stack/office.spec.ts`, `e2e-stack/p130-screens.spec.ts`, `e2e/list-cap-note.spec.ts`, `e2e/time.spec.ts`, `invoice-document.test.ts`, `office-approvals.test.ts`, `office-orders.test.ts`, `orders.test.ts`
- **Implementation evidence:** board: P1-06 (IN PROGRESS); P1-25 (IN PROGRESS); P1-30 (IN PROGRESS); `supabase/tests/orders.test.ts`

#### ORD-03

**Priority:** M · **Phase:** 1 · **Status:** IMPLEMENTED — NOT VERIFIED

- **Statement (doc 03, verbatim):** Order states: draft → confirmed → delivered (full/partial) → closed; cancelled only before delivery, by Mg/O with a reason (a rep or salon may edit or cancel its own order request until the office decides it, not after (ACTIVITY L-0378, D-34))
- **Actor:** Owner or manager; rep or salon (own request before decision)
- **Preconditions:** Order exists
- **Expected behaviour:** States draft → confirmed → delivered (full or partial) → closed; cancel only before delivery, by the office with a reason
- **Business rules:** Requests editable by the submitter only until the office decides
- **Permissions:** Office
- **Failure and exceptions:** Cancel after delivery is refused
- **Acceptance criteria:**
  - AC-ORD-03-1: Cancelling a delivered order is refused
  - AC-ORD-03-2: Cancelling without a reason is refused
- **Tests:** citing this ID: `crm-attacks.test.ts`, `deliveries.test.ts`, `orders.test.ts`; through its board task: `crm-attacks.test.ts`, `deliveries.test.ts`, `e2e-stack/office.spec.ts`, `invoice-document.test.ts`, `office-approvals.test.ts`, `office-orders.test.ts`, `orders.test.ts`
- **Implementation evidence:** board: P1-06 (IN PROGRESS); P1-25 (IN PROGRESS); `supabase/tests/office-orders.test.ts`

#### ORD-04

**Priority:** M · **Phase:** 1 · **Status:** IMPLEMENTED — NOT VERIFIED

- **Statement (doc 03, verbatim):** A rep's delivery is an immutable submission that moves goods to the rep's pending location; only the owner's or manager's approval writes the delivery, the sale movement from pending, the invoice and installments and advances the order (D-32). A rep-less order is delivered by the office (A-18). Built in slice 4 (P1-21, migration 20261105130100), not verified
- **Actor:** Rep (submit); owner or manager (approve)
- **Preconditions:** Order confirmed; rep has the goods
- **Expected behaviour:** A rep's delivery is an immutable submission to its pending location; only office approval writes the delivery, sale movement, invoice and installments; rep-less orders are delivered by the office
- **Business rules:** Signed salon acknowledgement required (D-49); approver never the submitter (D-32)
- **Permissions:** Office approves
- **Failure and exceptions:** Approval of one's own submission is refused; an invoice without acknowledgement is refused
- **Acceptance criteria:**
  - AC-ORD-04-1: After `app.rep_submit_delivery` no invoice exists until `app.office_approve_delivery`
  - AC-ORD-04-2: The approver cannot be the submitter
  - AC-ORD-04-3: An invoice insert without a signed acknowledgement is refused
- **Tests:** citing this ID: `crm-attacks.test.ts`, `deliveries.test.ts`, `order-steps-reminders.test.ts`; through its board task: `crm-attacks.test.ts`, `deliveries.test.ts`, `delivery-approval.test.ts`, `e2e-stack/office.spec.ts`, `invoice-composer-signature.test.ts`, `invoice-document.test.ts`, `office-approvals.test.ts`, `office-orders.test.ts`, `order-steps-reminders.test.ts`, `orders.test.ts`
- **Implementation evidence:** board: P1-06 (IN PROGRESS); P1-21 (IN PROGRESS); P1-25 (IN PROGRESS); P1-31 (IN PROGRESS); P1-38 (IN PROGRESS; merged in PR 110 at 7016fd9; no reminder runner); `/office/deliveries`; `supabase/tests/delivery-approval.test.ts`, `invoice-composer-signature.test.ts`

#### ORD-05

**Priority:** M · **Phase:** 1 · **Status:** PARTIALLY IMPLEMENTED

- **Statement (doc 03, verbatim):** Invoice/receipt PDF or image: Kiran branding, salon, lines, totals, payment plan schedule, receipt numbers. **Never** shows supplier or cost. Office views built in slice 10 (P1-28, not verified): printable pages in English over `app.invoice_document` and `app.receipt_document`; no PDF renderer, and no salon or rep view yet
- **Actor:** Owner or manager; salon member (own)
- **Preconditions:** Invoice or receipt issued
- **Expected behaviour:** A document with Kiran branding, salon, lines, totals, schedule and numbers; never supplier or cost
- **Business rules:** B-46 decided (PDF and logo now, batch later; PR 115)
- **Permissions:** Office; salon member own
- **Failure and exceptions:** —
- **Acceptance criteria:**
  - AC-ORD-05-1: `app.invoice_document` returns no cost or supplier field
  - AC-ORD-05-2: A salon member reads only its own invoice
- **Tests:** citing this ID: `invoice-document.test.ts`, `payments.test.ts`, `rep-detail-documents.test.ts`; through its board task: `crm-attacks.test.ts`, `deliveries.test.ts`, `e2e-stack/rep-detail-documents.spec.ts`, `invoice-composer-signature.test.ts`, `invoice-document.test.ts`, `orders.test.ts`, `rep-detail-documents.test.ts`
- **Implementation evidence:** board: P1-06 (IN PROGRESS); P1-28 (IN PROGRESS); P1-31 (IN PROGRESS); `/office/invoices`, `/salon/invoices/[id]`; `supabase/tests/invoice-document.test.ts`
- **Known gap:** No PDF renderer, no logo, no salon receipt view
- **Open or related decisions:** B-46

#### ORD-06

**Priority:** S · **Phase:** 2 · **Status:** DEFERRED — FUTURE PHASE

- **Statement (doc 03, verbatim):** Returns: full/partial return of delivered goods with reason; stock movement back to location; credit note
- **Record:** not standardised yet. The full record (actor, preconditions, behaviour, rules, permissions, failure behaviour, acceptance criteria) is written when its phase is planned (H-22). Until then the statement above is the requirement.
- **Tests:** citing this ID: none; through its board task: none
- **Implementation evidence:** board: none

#### ORD-07

**Priority:** M/S · **Phase:** 1 (SKU and per-salon prices, D-41) / 2 (dated price lists) · **Status:** IMPLEMENTED — NOT VERIFIED

- **Statement (doc 03, verbatim):** SKU list prices and a per-salon price per SKU, set by the owner or manager with a reason, append-only, future orders only (`app.office_set_sku_price`, `salon_sku_price`; D-37, D-39). Price lists with effective dates stay Phase 2 and owner-only under D-08
- **Actor:** Owner or manager
- **Preconditions:** SKU or salon exists
- **Expected behaviour:** SKU list prices and per-salon prices are set with a reason, append-only, for future orders only
- **Business rules:** Dated price lists Phase 2, owner-only
- **Permissions:** Office
- **Failure and exceptions:** A price change without a reason is refused
- **Acceptance criteria:**
  - AC-ORD-07-1: `app.office_set_sku_price` without a reason is refused
  - AC-ORD-07-2: A price change does not alter existing order lines
- **Tests:** citing this ID: none; through its board task: `catalogue-prices.test.ts`, `reverify-slices-1-3.test.ts`, `verify-slices-1-3.test.ts`
- **Implementation evidence:** board: P1-19 (IN PROGRESS); `/office/products`; `supabase/tests/catalogue-prices.test.ts`

#### ORD-08

**Priority:** C · **Phase:** 3 · **Status:** DEFERRED — FUTURE PHASE

- **Statement (doc 03, verbatim):** Promotions / bundles (e.g., starter kit for new salons, buy-10-get-1)
- **Record:** not standardised yet. The full record (actor, preconditions, behaviour, rules, permissions, failure behaviour, acceptance criteria) is written when its phase is planned (H-22). Until then the statement above is the requirement.
- **Tests:** citing this ID: none; through its board task: none
- **Implementation evidence:** board: none

#### ORD-09

**Priority:** S · **Phase:** 2 · **Status:** DEFERRED — FUTURE PHASE

- **Statement (doc 03, verbatim):** Order history and "frequently bought" suggestions per salon shown to the office when creating an order and to the salon when submitting a request
- **Record:** not standardised yet. The full record (actor, preconditions, behaviour, rules, permissions, failure behaviour, acceptance criteria) is written when its phase is planned (H-22). Until then the statement above is the requirement.
- **Tests:** citing this ID: none; through its board task: none
- **Implementation evidence:** board: none

#### ORD-10

**Priority:** — · **Phase:** — · **Status:** SUPERSEDED (D-30)

- **Statement (doc 03, verbatim):** Superseded by D-30: reps no longer create orders. The rep's offline work is visits, payments and order-intake cards (ORD-14, NFR-01)
- **Record:** not standardised yet. The full record (actor, preconditions, behaviour, rules, permissions, failure behaviour, acceptance criteria) is written when its phase is planned (H-22). Until then the statement above is the requirement.
- **Tests:** citing this ID: `orders.test.ts`; through its board task: `crm-attacks.test.ts`, `deliveries.test.ts`, `e2e/outbox-classify.spec.ts`, `e2e/outbox-crypto.spec.ts`, `e2e/outbox-drain.spec.ts`, `e2e/outbox-history.spec.ts`, `e2e/outbox-queue.spec.ts`, `invoice-document.test.ts`, `orders.test.ts`
- **Implementation evidence:** board: P1-06 (IN PROGRESS); P1-09 (IN PROGRESS; outbox core merged (PR 103) and history page (PR 107); no page calls submit())

#### ORD-14

**Priority:** M · **Phase:** 1 · **Status:** IMPLEMENTED — NOT VERIFIED

- **Statement (doc 03, verbatim):** A rep or a salon submits an order request: an order-intake ("New Order Details") card with a submitter kind and optional product lines, never a price. It is not an official order. The submitter may edit (a new version) or cancel it while it waits (D-30, D-34)
- **Actor:** Rep (reachable salon); salon member
- **Preconditions:** Rep with open day, or active membership
- **Expected behaviour:** An order request card with submitter kind and optional lines, never a price; editable or cancellable while waiting
- **Business rules:** Not an official order (D-30)
- **Permissions:** Submitter only
- **Failure and exceptions:** Edit after the office decides is refused
- **Acceptance criteria:**
  - AC-ORD-14-1: A request carries no price field
  - AC-ORD-14-2: An edit creates a new version; an edit after decision is refused
- **Tests:** citing this ID: `e2e-stack/office.spec.ts`, `order-cards.test.ts`, `requests-portal.test.ts`; through its board task: `e2e/salon-login.spec.ts`, `office-order-access.test.ts`, `office-orders.test.ts`, `order-cards.test.ts`, `requests-portal.test.ts`
- **Implementation evidence:** board: P1-23 (IN PROGRESS); `supabase/tests/order-cards.test.ts`

#### ORD-15

**Priority:** M · **Phase:** 1 · **Status:** IMPLEMENTED — NOT VERIFIED

- **Statement (doc 03, verbatim):** One Requests queue in the office Orders area holds rep and salon requests. With no lines, one click opens the order form with salon and rep filled in; with lines, one click converts through `app.office_create_order`. The card is closed and linked to the order. Rejecting closes it with a reason. Requested statuses keep their meaning without new `order_status` values; the request has its own state: waiting, converted, rejected, cancelled (D-34)
- **Actor:** Owner or manager
- **Preconditions:** Waiting request
- **Expected behaviour:** One requests queue; convert with one click, open the order form, or reject with a reason
- **Business rules:** Request state separate from order status
- **Permissions:** Office
- **Failure and exceptions:** Rejection without a reason is refused
- **Acceptance criteria:**
  - AC-ORD-15-1: Converting a request with lines creates one order and closes the card
  - AC-ORD-15-2: Rejecting without a reason is refused
- **Tests:** citing this ID: none; through its board task: `e2e/salon-login.spec.ts`, `office-order-access.test.ts`, `office-orders.test.ts`, `order-cards.test.ts`, `requests-portal.test.ts`
- **Implementation evidence:** board: P1-23 (IN PROGRESS); `/office/orders`; `supabase/tests/office-orders.test.ts`

#### ORD-11

**Priority:** M · **Phase:** 1 · **Status:** IMPLEMENTED — NOT VERIFIED

- **Statement (doc 03, verbatim):** One canonical order system (`sales_order`, `sales_order_line`), with explicit channels: `office` for direct orders and rep requests, `salon_portal` for salon requests, `rep_visit` for legacy rows only (D-30, D-34); stores the authenticated creator, the order-intake card it came from (nullable) and the delivering rep when one is assigned; preserves original acquisition rep and effective-dated current assignment separately. Phase moved by D-41
- **Actor:** System
- **Preconditions:** —
- **Expected behaviour:** One order system with explicit channels; stores creator, source card, delivering rep and acquisition rep separately
- **Business rules:** No second order ledger (doc 16)
- **Permissions:** —
- **Failure and exceptions:** —
- **Acceptance criteria:**
  - AC-ORD-11-1: Every order has a channel of office, salon_portal or rep_visit (legacy)
  - AC-ORD-11-2: An order converted from a request links to that request
- **Tests:** citing this ID: `requests-portal.test.ts`; through its board task: `e2e/salon-login.spec.ts`, `office-order-access.test.ts`, `office-orders.test.ts`, `order-cards.test.ts`, `requests-portal.test.ts`
- **Implementation evidence:** board: P1-23 (IN PROGRESS); `supabase/tests/orders.test.ts`

#### ORD-12

**Priority:** M · **Phase:** 1 · **Status:** IMPLEMENTED — NOT VERIFIED

- **Statement (doc 03, verbatim):** Authenticated salon user submits an order request (not an official order, D-34) only for the salon resolved from active server-side membership; idempotent submission; the office's conversion runs the same server-side catalogue, salon pricing, stock, credit and order-state checks as any office order. Phase moved by D-41
- **Actor:** Salon member
- **Preconditions:** Active membership
- **Expected behaviour:** The salon submits an order request for its own salon only, idempotently
- **Business rules:** Not an official order (D-34)
- **Permissions:** Salon member
- **Failure and exceptions:** A request for another salon is refused; a replay creates one request
- **Acceptance criteria:**
  - AC-ORD-12-1: `app.salon_submit_request` ignores any salon id other than the membership's
  - AC-ORD-12-2: A replayed submission creates one request
- **Tests:** citing this ID: `requests-portal.test.ts`; through its board task: `e2e/salon-login.spec.ts`, `office-order-access.test.ts`, `office-orders.test.ts`, `order-cards.test.ts`, `requests-portal.test.ts`
- **Implementation evidence:** board: P1-23 (IN PROGRESS); `supabase/tests/requests-portal.test.ts`

#### ORD-13

**Priority:** M · **Phase:** 1 · **Status:** IMPLEMENTED — NOT VERIFIED

- **Statement (doc 03, verbatim):** Salon user reads only its own requests and orders, current states, permitted history and customer documents; a salon's request waits for the manager's approval and nothing is reserved or delivered before confirmation (OQ-31 answered, D-30, D-34). Phase moved by D-41
- **Actor:** Salon member
- **Preconditions:** Active membership
- **Expected behaviour:** The salon reads its own requests, orders, states, history and documents; nothing is reserved before confirmation
- **Business rules:** —
- **Permissions:** Salon member
- **Failure and exceptions:** Another salon's orders are not returned
- **Acceptance criteria:**
  - AC-ORD-13-1: `app.salon_my_orders` returns only the member salon's orders
  - AC-ORD-13-2: A waiting request reserves no stock
- **Tests:** citing this ID: `requests-portal.test.ts`; through its board task: `e2e/salon-login.spec.ts`, `office-order-access.test.ts`, `office-orders.test.ts`, `order-cards.test.ts`, `requests-portal.test.ts`
- **Implementation evidence:** board: P1-23 (IN PROGRESS); `supabase/tests/requests-portal.test.ts`
- **Open or related decisions:** OQ-31

#### CTL-07

**Priority:** M · **Phase:** 1 · **Status:** IMPLEMENTED — NOT VERIFIED

- **Statement (doc 03, verbatim):** Reps and salons have no discount authority: a request carries no price (D-34). Any price below list on an office order requires in-app approval by a manager or owner other than its maker before the invoice is issued, except the owner's own discount on an office order the owner creates, which needs no approval and is recorded on the order and in its audit row (MJ, ACTIVITY L-0390); dated price-list changes are owner-only; SKU and per-salon prices are owner or manager with a reason, and a manager's change is listed in the owner's digest (D-37, D-39, OQ-33)
- **Actor:** Owner or manager
- **Preconditions:** Office order with a price below list
- **Expected behaviour:** Any price below list needs approval by an office user other than the maker before the invoice; the owner's own discount on the owner's office order needs none and is recorded
- **Business rules:** Reps and salons have no discount authority
- **Permissions:** Office
- **Failure and exceptions:** Self-approval is refused (H-12)
- **Acceptance criteria:**
  - AC-CTL-07-1: A discount approved by its maker is refused
  - AC-CTL-07-2: The owner's own discount is recorded on the order and its audit row
- **Tests:** citing this ID: `crm-attacks.test.ts`, `orders.test.ts`; through its board task: `audit-fixes.test.ts`, `b33-decisions.test.ts`, `crm-attacks.test.ts`, `deliveries.test.ts`, `e2e-stack/office.spec.ts`, `e2e-stack/p130-screens.spec.ts`, `e2e/list-cap-note.spec.ts`, `e2e/time.spec.ts`, `invoice-document.test.ts`, `office-approvals.test.ts`, `office-orders.test.ts`, `orders.test.ts`
- **Implementation evidence:** board: P1-06 (IN PROGRESS); P1-25 (IN PROGRESS); P1-30 (IN PROGRESS); `supabase/tests/office-approvals.test.ts`
- **Open or related decisions:** OQ-33

#### AGT-01

**Priority:** M · **Phase:** 1 · **Status:** NOT STARTED

- **Statement (doc 03, verbatim):** Agent role and onboarding: anyone may apply; the owner creates the account (governance, H-15) with minimum identity data (OQ-20); agents sign in like reps (email code, approved device)
- **Actor:** Owner (create); applicant
- **Preconditions:** OQ-20 answered
- **Expected behaviour:** Agent role and onboarding; owner creates the account; agents sign in like reps
- **Business rules:** Governance (H-15)
- **Permissions:** Owner only
- **Failure and exceptions:** A manager creating an agent is refused
- **Acceptance criteria:**
  - AC-AGT-01-1: Only the owner can create an agent account
- **Tests:** citing this ID: none; through its board task: none
- **Implementation evidence:** board: P1-15 (NOT STARTED)
- **Known gap:** Not built (P1-15); `app_role` has no agent value
- **Open or related decisions:** OQ-20

#### AGT-02

**Priority:** M · **Phase:** 1 · **Status:** NOT STARTED

- **Statement (doc 03, verbatim):** Agent price per SKU in its own table (`agent_price`, never readable by reps), set by the owner only; a SKU without an agent price is not sold to agents (OQ-17)
- **Actor:** Owner
- **Preconditions:** Agent role exists
- **Expected behaviour:** Agent price per SKU in its own table, never readable by reps
- **Business rules:** A SKU without an agent price is not sold to agents
- **Permissions:** Owner only
- **Failure and exceptions:** —
- **Acceptance criteria:**
  - AC-AGT-02-1: A rep reading `agent_price` gets nothing
- **Tests:** citing this ID: none; through its board task: none
- **Implementation evidence:** board: P1-15 (NOT STARTED)
- **Known gap:** Not built (P1-15)
- **Open or related decisions:** OQ-17

#### AGT-03

**Priority:** M · **Phase:** 1 · **Status:** NOT STARTED

- **Statement (doc 03, verbatim):** Agent purchase (cash and carry): paid in full by cash at the counter or a matched transfer **before** stock leaves the warehouse; numbered invoice and receipt; stock movement `sale_to_agent`; never on credit (A-07)
- **Actor:** Office (sell); agent
- **Preconditions:** Agent price set; payment received
- **Expected behaviour:** Cash-and-carry sale, paid in full before stock leaves; numbered invoice and receipt; movement `sale_to_agent`; never on credit
- **Business rules:** A-07
- **Permissions:** Office
- **Failure and exceptions:** Release before payment is refused
- **Acceptance criteria:**
  - AC-AGT-03-1: Stock cannot leave before full payment is recorded
- **Tests:** citing this ID: none; through its board task: none
- **Implementation evidence:** board: P1-15 (NOT STARTED)
- **Known gap:** Not built (P1-15)

#### AGT-04

**Priority:** S · **Phase:** 1 · **Status:** NOT STARTED

- **Statement (doc 03, verbatim):** Agent app: own purchases, the catalogue with agent prices and warehouse availability (quantities only), and an **optional pre-order request**, the only thing an agent ever sends back (D-23). No salon data, no other agents, no cost or supplier (H-01, H-05)
- **Actor:** Agent
- **Preconditions:** Agent account
- **Expected behaviour:** Agent app with own purchases, catalogue with agent prices and quantities, optional pre-order
- **Business rules:** No salon data, no cost (H-01, H-05)
- **Permissions:** Agent own
- **Failure and exceptions:** —
- **Acceptance criteria:**
  - AC-AGT-04-1: An agent sees no salon or other agent data
- **Tests:** citing this ID: none; through its board task: none
- **Implementation evidence:** board: P1-15 (NOT STARTED)
- **Known gap:** Not built (P1-15)

#### AGT-05

**Priority:** S · **Phase:** 2 · **Status:** DEFERRED — FUTURE PHASE

- **Statement (doc 03, verbatim):** Agent reorder reminder from the agent's own purchase cycle
- **Record:** not standardised yet. The full record (actor, preconditions, behaviour, rules, permissions, failure behaviour, acceptance criteria) is written when its phase is planned (H-22). Until then the statement above is the requirement.
- **Tests:** citing this ID: none; through its board task: none
- **Implementation evidence:** board: none

#### AGT-06

**Priority:** M · **Phase:** 1 · **Status:** NOT STARTED

- **Statement (doc 03, verbatim):** **No recruitment pay**: Kiran pays no commission, bonus or override for enrolling other agents; agent earnings come only from their own resale margin (A-06; SECP, Companies Act 2017 s.301)
- **Actor:** —
- **Preconditions:** —
- **Expected behaviour:** No commission, bonus or override for recruiting agents
- **Business rules:** A-06
- **Permissions:** —
- **Failure and exceptions:** —
- **Acceptance criteria:**
  - AC-AGT-06-1: No payment type exists for recruitment
- **Tests:** citing this ID: none; through its board task: none
- **Implementation evidence:** board: P1-15 (NOT STARTED)
- **Known gap:** Not built (P1-15)

#### AGT-07

**Priority:** S · **Phase:** 2 · **Status:** DEFERRED — FUTURE PHASE

- **Statement (doc 03, verbatim):** Allocation when the supplier is short: configurable priority between direct salons' open orders and agent purchases (OQ-19)
- **Record:** not standardised yet. The full record (actor, preconditions, behaviour, rules, permissions, failure behaviour, acceptance criteria) is written when its phase is planned (H-22). Until then the statement above is the requirement.
- **Tests:** citing this ID: none; through its board task: none
- **Implementation evidence:** board: none
- **Open or related decisions:** OQ-19

## 6. Business rules

Rules cited by this module's requirements: D-08, D-23, D-30, D-32, D-34, D-36, D-37, D-39, D-41, D-49, H-01, H-05, H-12, H-15, H-22. Their text and single source are in [business-rules.md](../../requirements/business-rules.md); thresholds are doc 13 §9, permissions are doc 06 §2.

## 7. User journeys

- J-OD-1 Rep request to order (ORD-14, ORD-15, ORD-01): card, queue, one-click conversion.
- J-OD-2 Salon portal request (ORD-12, ORD-13): submit, office decision, order states visible to the salon.
- J-OD-3 Delivery (ORD-04): rep submits with signature, office approves, invoice and installments written.
- J-OD-4 Office order with discount (CTL-07): approval by someone other than the maker, except the owner's own.
- J-OD-5 Agent cash-and-carry (AGT-03): not built.

Full journeys with steps: [journeys-and-workflows.md](../../requirements/journeys-and-workflows.md).

## 8. Cross-module interactions

Approved deliveries write stock movements (inventory) and installments (money-credit); commission is stamped at delivery approval (money-credit CTL-13); order steps and reminders (P1-38) read approvals in control-governance.

## 9. Security requirements

Only the office creates official orders, enforced in the database (`app.create_order` refuses every caller); prices come from the database only; a delivery approver is never its submitter (H-12); documents never show cost or supplier (H-05).

## 10. Failure scenarios

- Request for a pending or unreachable salon: refused.
- Credit limit exceeded on an installment order: hard stop, office override with reason (ORD-02).
- Partial delivery: remaining quantity stays on the order.
- Delivery without acknowledgement: invoice insert refused.
- Returns: no Phase 1 workflow (DA-028).

## 11. Acceptance criteria

32 criteria (IDs `AC-<requirement>-<n>`) are in the records above and in the [acceptance criteria matrix](../../audit/2026-11-19/05-acceptance-criteria-matrix.md).

## 12. Dependencies

SMS for an OTP acknowledgement (B-08); PDF renderer and logo (B-46 decided in PR 115); Shopify for Regular User orders (B-56, B-57, B-60); per-salon price policy (OQ-33).

## 13. Implementation status and evidence

| Requirement | Phase | Status | Board tasks | Tests citing the ID |
|---|---|---|---|---|
| ORD-01 | 1 | IMPLEMENTED — NOT VERIFIED | P1-06, P1-23 | 2 |
| ORD-02 | 1 | IMPLEMENTED — NOT VERIFIED | P1-06, P1-25, P1-30 | 2 |
| ORD-03 | 1 | IMPLEMENTED — NOT VERIFIED | P1-06, P1-25 | 3 |
| ORD-04 | 1 | IMPLEMENTED — NOT VERIFIED | P1-06, P1-21, P1-25, P1-31, P1-38 | 3 |
| ORD-05 | 1 | PARTIALLY IMPLEMENTED | P1-06, P1-28, P1-31 | 3 |
| ORD-06 | 2 | DEFERRED — FUTURE PHASE | — | 0 |
| ORD-07 | 1 (SKU and per-salon prices, D-41) / 2 (dated price lists) | IMPLEMENTED — NOT VERIFIED | P1-19 | 0 |
| ORD-08 | 3 | DEFERRED — FUTURE PHASE | — | 0 |
| ORD-09 | 2 | DEFERRED — FUTURE PHASE | — | 0 |
| ORD-10 | — | SUPERSEDED (D-30) | P1-06, P1-09 | 1 |
| ORD-14 | 1 | IMPLEMENTED — NOT VERIFIED | P1-23 | 3 |
| ORD-15 | 1 | IMPLEMENTED — NOT VERIFIED | P1-23 | 0 |
| ORD-11 | 1 | IMPLEMENTED — NOT VERIFIED | P1-23 | 1 |
| ORD-12 | 1 | IMPLEMENTED — NOT VERIFIED | P1-23 | 1 |
| ORD-13 | 1 | IMPLEMENTED — NOT VERIFIED | P1-23 | 1 |
| CTL-07 | 1 | IMPLEMENTED — NOT VERIFIED | P1-06, P1-25, P1-30 | 2 |
| AGT-01 | 1 | NOT STARTED | P1-15 | 0 |
| AGT-02 | 1 | NOT STARTED | P1-15 | 0 |
| AGT-03 | 1 | NOT STARTED | P1-15 | 0 |
| AGT-04 | 1 | NOT STARTED | P1-15 | 0 |
| AGT-05 | 2 | DEFERRED — FUTURE PHASE | — | 0 |
| AGT-06 | 1 | NOT STARTED | P1-15 | 0 |
| AGT-07 | 2 | DEFERRED — FUTURE PHASE | — | 0 |
