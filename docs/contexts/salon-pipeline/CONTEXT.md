# Salon Pipeline — module document (context `salon-pipeline`)

This document is derived reference material written by the 2026-11-19 documentation audit. It never overrides the numbered planning documents, doc 16 or `docs/ACTIVITY.md` (ACTIVITY §1); doc 03 stays the index of requirement IDs and the source of every statement quoted here. Status is derived from the ACTIVITY §12 board and the evidence named, using the vocabulary in [docs/requirements/README.md](../../requirements/README.md#status-vocabulary).

## 1. Purpose and boundaries

The salon as a customer record and its life cycle: creating and proposing salons, approval, contacts, notes, pipeline stage, assignment and reachability, reorder cycle and due list, map prospecting, verification and the Excel import. It answers "which salons exist, who may reach them, and which are due". It does not own orders, money, stock or visits.

**Outside this module:** Visits, rep days and routes (field-operations); orders and requests (orders-delivery); credit limits and balances (money-credit, read here only through the credit profile); salon logins and memberships (control-governance).

## 2. Glossary

- **Salon:** Any business in Karachi offering hair care, treatment or beauty to end users (D-02). Not a user.
- **Pending salon:** A salon proposed by a rep and not yet approved; it may not have requests or orders (SAL-13).
- **Reachable salon:** A salon a rep may see: its direct assignment, else territory coverage, else none (D-36, SAL-14).
- **Stage:** Pipeline stage of doc 02, kept by the system, changed by the office only with a reason.
- **Due list:** Thin Phase 1 reorder list: last purchase per product group plus the group's default cycle (D-19).

## 3. Actors and permissions

Owner and manager: create approved salons, approve or reject proposals, assign reps, override stage, see all salons. Rep: reachable salons only, read-only, notes, proposals. Salon member: its own profile only (through SAL-12, owned by the portal reads). Matrix of record: doc 06 §2 rows "See salons" to "Change salon stage manually".

## 4. Owned entities and data

Tables owned (from the migrations on `main` at `d4b47ca`): `salon`, `salon_contact`, `salon_note`, `stage_event`, `cycle_estimate`, `salon_approval_decision`, `salon_rep_assignment`, `salon_signup_request`, `control.phone_reveal`. Ownership follows CONTEXT-MAP.md; no table is owned by two modules.

## 5. Functional requirements

33 requirements, in doc 03 order. Phase 1 requirements carry a full record; later-phase requirements carry their statement and status.

#### SAL-01

**Priority:** M · **Phase:** 1 · **Status:** PARTIALLY IMPLEMENTED

- **Statement (doc 03, verbatim):** Create a salon with: name, type (ladies' parlor / men's salon / unisex / bridal studio / barber / hair studio / spa or wellness centre offering hair services / home-based parlor / beauty academy or training institute / other), address, area, GPS pin, phone(s), owner/contact name, chairs (size), photo of frontage (stored once storage exists, ACTIVITY L-0146), notes, source (`map_pin` / `nearby_search` / `sweep` / `excel_import` / `referral` / `manual`). "Salon" means **any business anywhere in Karachi that offers hair care, hair treatment or hair beauty to end users**. External Maps listings/place IDs are optional; a salon can be created with a manually supplied address and pin/location data or added before its precise coordinates are available
- **Actor:** Office (create approved); rep (propose, SAL-13)
- **Preconditions:** Caller signed in; for a rep, the salon's area is in a covered territory or none
- **Expected behaviour:** A salon row is created with the listed fields and a source value; a rep's salon starts pending
- **Business rules:** Salon means any business offering hair care (D-02); source is one of the six listed values; photo stored only once storage exists (L-0146)
- **Permissions:** Office creates approved; rep proposes only (D-35)
- **Failure and exceptions:** Missing name or invalid source or type is refused with no row written; anon refused
- **Acceptance criteria:**
  - AC-SAL-01-1: An office call to `app.create_salon` with the required fields creates one salon visible in `/office/salons`
  - AC-SAL-01-2: A rep call creates a salon with status pending, not approved
  - AC-SAL-01-3: A call with an unknown type or source value is refused and writes nothing
  - AC-SAL-01-4: An anonymous call is refused before the function body
- **Tests:** citing this ID: `e2e-stack/office.spec.ts`, `b33-decisions.test.ts`, `reverify-slices-1-3.test.ts`, `salons.test.ts`; through its board task: `b33-decisions.test.ts`, `create-salon-blanks.test.ts`, `crm-attacks.test.ts`, `salons.test.ts`, `visits.test.ts`
- **Implementation evidence:** board: P1-02 (IN PROGRESS); `app.create_salon`; `apps/web/components/office-add-salon.tsx`; `/app/salons/new`

#### SAL-02

**Priority:** M · **Phase:** 1 · **Status:** PARTIALLY IMPLEMENTED

- **Statement (doc 03, verbatim):** Each salon belongs to exactly one territory; territory derives from area or is set manually by Mg. A salon with no area and no direct assignment has no rep (D-36)
- **Actor:** Manager (manual territory); system (derive from area)
- **Preconditions:** Areas and territories exist (PIP-01)
- **Expected behaviour:** Each salon resolves to exactly one territory, from its area or set by the manager
- **Business rules:** No area and no direct assignment means no rep (D-36)
- **Permissions:** Office sets; reps cannot
- **Failure and exceptions:** A salon may not be put in two territories; setting a territory that does not exist is refused
- **Acceptance criteria:**
  - AC-SAL-02-1: A salon with an area reports that area's territory
  - AC-SAL-02-2: A salon with no area and no assignment is reachable by no rep (rep list call returns no row for it)
  - AC-SAL-02-3: A rep cannot change a salon's territory
- **Tests:** citing this ID: `crm-attacks.test.ts`, `salons.test.ts`; through its board task: `b33-decisions.test.ts`, `create-salon-blanks.test.ts`, `crm-attacks.test.ts`, `salons.test.ts`, `visits.test.ts`
- **Implementation evidence:** board: P1-02 (IN PROGRESS)

#### SAL-03

**Priority:** M · **Phase:** 1 · **Status:** PARTIALLY IMPLEMENTED

- **Statement (doc 03, verbatim):** Salon has a pipeline stage (see doc 02) maintained by the system; Mg/O can override with a mandatory reason
- **Actor:** System; owner or manager (override)
- **Preconditions:** Salon exists
- **Expected behaviour:** The stage is maintained by the system; an office override records the new stage with a mandatory reason as an append-only stage event
- **Business rules:** Stage events are append-only (H-06)
- **Permissions:** Office only for overrides
- **Failure and exceptions:** An override with an empty reason is refused; a rep override is refused
- **Acceptance criteria:**
  - AC-SAL-03-1: An override without a reason is refused and the stage is unchanged
  - AC-SAL-03-2: An override with a reason writes one `stage_event` row naming the actor
  - AC-SAL-03-3: UPDATE or DELETE on `stage_event` fails for every application role
- **Tests:** citing this ID: `salons.test.ts`, `verify-slices-1-3.test.ts`; through its board task: `b33-decisions.test.ts`, `create-salon-blanks.test.ts`, `crm-attacks.test.ts`, `salons.test.ts`, `visits.test.ts`
- **Implementation evidence:** board: P1-02 (IN PROGRESS)

#### SAL-04

**Priority:** M · **Phase:** 1 · **Status:** PARTIALLY IMPLEMENTED

- **Statement (doc 03, verbatim):** Salon has a credit profile: plan eligibility (cash only / 2 / 4), credit limit (PKR), current exposure, overdue status
- **Actor:** Owner (credit set); owner or manager (raise limit, block, CTL-08)
- **Preconditions:** Salon exists
- **Expected behaviour:** Each salon carries plan eligibility, credit limit, current exposure and overdue status; exposure is derived
- **Business rules:** Balances are derived (H-10); money in paisa
- **Permissions:** `app.owner_set_credit` owner only; `app.office_raise_limit`, `app.office_set_blocked` office
- **Failure and exceptions:** A manager setting eligibility is refused; a negative limit is refused
- **Acceptance criteria:**
  - AC-SAL-04-1: The salon page shows eligibility, limit, exposure and overdue status from `app.salon_credit_status`
  - AC-SAL-04-2: Exposure equals the sum of unpaid installments for that salon
  - AC-SAL-04-3: A manager call to `app.owner_set_credit` is refused
- **Tests:** citing this ID: `crm-attacks.test.ts`, `orders.test.ts`; through its board task: `b33-decisions.test.ts`, `create-salon-blanks.test.ts`, `crm-attacks.test.ts`, `deliveries.test.ts`, `invoice-document.test.ts`, `orders.test.ts`, `salons.test.ts`, `visits.test.ts`
- **Implementation evidence:** board: P1-02 (IN PROGRESS); P1-06 (IN PROGRESS); `components/salon-credit.tsx`

#### SAL-05

**Priority:** M · **Phase:** 1 · **Status:** PARTIALLY IMPLEMENTED

- **Statement (doc 03, verbatim):** Salon timeline: every visit, order, delivery, payment, message, note and stage change in one chronological view. The office also sees who did what and when for a salon or an order, read from `control.audit_event` through scoped functions, with no second log (D-39)
- **Actor:** Office (full timeline); rep (reachable salons, read-only)
- **Preconditions:** Salon exists and is visible to the caller
- **Expected behaviour:** One chronological view of visits, orders, deliveries, payments, messages, notes and stage changes; office also sees who did what, read from `control.audit_event` through scoped functions
- **Business rules:** No second log (D-39); allow-listed fields only, never row images, ip, device or hash
- **Permissions:** Office at AAL2 for the who-did-what view
- **Failure and exceptions:** A caller who cannot see the salon gets no rows
- **Acceptance criteria:**
  - AC-SAL-05-1: `app.office_salon_timeline` returns events in time order with actor name and action label only
  - AC-SAL-05-2: A rep or salon member calling the office timeline is refused
  - AC-SAL-05-3: No timeline row contains a before or after row image
- **Tests:** citing this ID: none; through its board task: `b33-decisions.test.ts`, `create-salon-blanks.test.ts`, `crm-attacks.test.ts`, `rep-readonly-timelines.test.ts`, `salon-approval.test.ts`, `salons.test.ts`, `visits.test.ts`
- **Implementation evidence:** board: P1-02 (IN PROGRESS); P1-24 (IN PROGRESS); `components/timeline.tsx`; `supabase/tests/rep-readonly-timelines.test.ts`
- **Known gap:** Messages are not in the timeline because messaging is not built (MSG)

#### SAL-06

**Priority:** S · **Phase:** 2 · **Status:** DEFERRED — FUTURE PHASE

- **Statement (doc 03, verbatim):** Duplicate detection on create (phone number, name + area fuzzy match)
- **Record:** not standardised yet. The full record (actor, preconditions, behaviour, rules, permissions, failure behaviour, acceptance criteria) is written when its phase is planned (H-22). Until then the statement above is the requirement.
- **Tests:** citing this ID: none; through its board task: none
- **Implementation evidence:** board: none

#### SAL-07

**Priority:** S · **Phase:** 2 · **Status:** DEFERRED — FUTURE PHASE

- **Statement (doc 03, verbatim):** Multiple contacts per salon (owner, manager, head stylist) with roles
- **Record:** not standardised yet. The full record (actor, preconditions, behaviour, rules, permissions, failure behaviour, acceptance criteria) is written when its phase is planned (H-22). Until then the statement above is the requirement.
- **Tests:** citing this ID: none; through its board task: none
- **Implementation evidence:** board: none

#### SAL-08

**Priority:** C · **Phase:** 3 · **Status:** DEFERRED — FUTURE PHASE

- **Statement (doc 03, verbatim):** Salon tags (e.g., "uses competitor X", "bridal season peak")
- **Record:** not standardised yet. The full record (actor, preconditions, behaviour, rules, permissions, failure behaviour, acceptance criteria) is written when its phase is planned (H-22). Until then the statement above is the requirement.
- **Tests:** citing this ID: none; through its board task: none
- **Implementation evidence:** board: none

#### SAL-09

**Priority:** M · **Phase:** 1 · **Status:** IMPLEMENTED — NOT VERIFIED

- **Statement (doc 03, verbatim):** Rep sees only reachable salons (D-36: a direct assignment, else territory coverage), read-only; adds notes (MAP-03) and may propose a new salon (SAL-13); cannot edit an existing salon, delete or export. Reconciled with doc 16 by D-35, replacing "see and edit"
- **Actor:** Rep
- **Preconditions:** Rep signed in on its approved device
- **Expected behaviour:** The rep lists only reachable salons, read-only, adds notes and may propose a salon
- **Business rules:** Reachability per D-36 (SAL-14); no edit, delete or export
- **Permissions:** Rep
- **Failure and exceptions:** Edit of an existing salon by a rep is refused; list is capped at 50 rows (H-14)
- **Acceptance criteria:**
  - AC-SAL-09-1: `app.my_salons` returns only salons reachable under SAL-14
  - AC-SAL-09-2: `app.update_salon` called by a rep is refused
  - AC-SAL-09-3: No rep screen offers an export or download
  - AC-SAL-09-4: Phone numbers are masked in lists
- **Tests:** citing this ID: `salons.test.ts`; through its board task: `b33-decisions.test.ts`, `create-salon-blanks.test.ts`, `crm-attacks.test.ts`, `rep-readonly-timelines.test.ts`, `salon-approval.test.ts`, `salons.test.ts`, `visits.test.ts`
- **Implementation evidence:** board: P1-02 (IN PROGRESS); P1-24 (IN PROGRESS); `lib/salons.ts`; `supabase/tests/crm-attacks.test.ts`

#### SAL-10

**Priority:** M · **Phase:** 1 · **Status:** PARTIALLY IMPLEMENTED

- **Statement (doc 03, verbatim):** Bulk import from Excel with field mapping and dry-run preview
- **Actor:** Office (import); MJ (real file, human-only)
- **Preconditions:** An Excel or CSV file; mapping configured
- **Expected behaviour:** A dry-run preview maps and validates every row and reports errors without writing; an import writes salons
- **Business rules:** Real data only by MJ (ACTIVITY §10, B-02); synthetic data in development
- **Permissions:** Office
- **Failure and exceptions:** Rows with errors are reported, not silently dropped; the dry run writes nothing
- **Acceptance criteria:**
  - AC-SAL-10-1: `packages/import` dry run over a synthetic file reports per-row mapping and errors and writes nothing
  - AC-SAL-10-2: An import into the database creates one salon per valid row and none for invalid rows
- **Tests:** citing this ID: none; through its board task: `b33-decisions.test.ts`, `create-salon-blanks.test.ts`, `crm-attacks.test.ts`, `salons.test.ts`, `visits.test.ts`
- **Implementation evidence:** board: P0-02 (IN PROGRESS); P1-02 (IN PROGRESS); `packages/import`
- **Known gap:** The import into the database is not built (P1-02 part d); only the dry run exists
- **Open or related decisions:** B-02

#### SAL-11

**Priority:** M · **Phase:** 1 · **Status:** IMPLEMENTED — NOT VERIFIED

- **Statement (doc 03, verbatim):** Secure salon customer portal membership: invite/verify customer user (or approve the salon's own sign-up, D-51), link membership to the exact salon, support activation/suspension/revocation; contact records do not automatically become login identities. Phase moved by D-41
- **Actor:** Owner or manager (invite, approve sign-up, suspend, revoke); salon user (redeem, apply)
- **Preconditions:** Invitation link or approved sign-up
- **Expected behaviour:** A salon login is linked to exactly one salon through a membership that can be activated, suspended or revoked; a contact record never becomes a login by itself
- **Business rules:** One salon per login (L-0376); invitations per SEC-16
- **Permissions:** Office manages; the invite page is the only page that creates a login (D-39)
- **Failure and exceptions:** A revoked or suspended membership reads nothing; an expired or used token is refused
- **Acceptance criteria:**
  - AC-SAL-11-1: Redeeming a valid invitation creates one active membership for the invited salon
  - AC-SAL-11-2: After revocation the member's `app.salon_me` returns no salon
  - AC-SAL-11-3: A second redemption of the same token is refused
- **Tests:** citing this ID: none; through its board task: `e2e/salon-signup.spec.ts`, `invitations.test.ts`, `reverify-slices-1-3.test.ts`, `salon-approval.test.ts`, `salon-self-signup.test.ts`, `verify-slices-1-3.test.ts`
- **Implementation evidence:** board: P1-18 (IN PROGRESS); `/invite/[token]`; `/salon/signup`; `supabase/tests/invitations.test.ts`, `salon-self-signup.test.ts`

#### SAL-12

**Priority:** M · **Phase:** 1 · **Status:** PARTIALLY IMPLEMENTED

- **Statement (doc 03, verbatim):** Salon portal reads only its own profile, shared active catalogue with pictures, its own approved prices (ORD-07; otherwise list price), own requests, orders/status/history and authorized invoices/receipts/statements, payments and balance. Phase moved by D-41; safe aggregate stock stays Phase 2 (INV-12)
- **Actor:** Salon member
- **Preconditions:** Active membership
- **Expected behaviour:** The portal shows only the member's own profile, shared active catalogue with pictures, own prices or list price, own requests, orders, documents, payments and balance
- **Business rules:** Allow-list per SEC-15; stock stays Phase 2 (INV-12)
- **Permissions:** Salon member of that salon only
- **Failure and exceptions:** Any other salon's data is refused or absent
- **Acceptance criteria:**
  - AC-SAL-12-1: `app.salon_catalogue` returns the salon's own price where set, otherwise list price
  - AC-SAL-12-2: Changing a salon id in a request does not return another salon's data
  - AC-SAL-12-3: No portal response contains cost, supplier, rep GPS or internal notes
- **Tests:** citing this ID: none; through its board task: `e2e/salon-login.spec.ts`, `office-order-access.test.ts`, `office-orders.test.ts`, `order-cards.test.ts`, `requests-portal.test.ts`
- **Implementation evidence:** board: P1-23 (IN PROGRESS); `/salon`; `supabase/tests/requests-portal.test.ts`
- **Known gap:** Salon receipts and statements are not built (P1-23 note)

#### SAL-13

**Priority:** M · **Phase:** 1 · **Status:** PARTIALLY IMPLEMENTED

- **Statement (doc 03, verbatim):** A rep proposes a new salon (works offline, like PIP-07); it stays pending, and a pending salon cannot have requests or orders. The office approves it, with an optional rep and rate, or rejects it with a reason, in an append-only decision. The office may also add a salon directly, approved (D-35)
- **Actor:** Rep (propose); owner or manager (approve, reject, add directly)
- **Preconditions:** Rep signed in; salon not a duplicate
- **Expected behaviour:** A proposed salon stays pending until the office approves it, optionally with a rep and rate, or rejects it with a reason, in an append-only decision
- **Business rules:** A pending salon cannot have requests or orders
- **Permissions:** Office decides
- **Failure and exceptions:** Rejection without a reason is refused; a request or order for a pending salon is refused
- **Acceptance criteria:**
  - AC-SAL-13-1: A rep-created salon is pending and cannot receive an order request
  - AC-SAL-13-2: `app.office_decide_salon` approve writes one append-only decision row
  - AC-SAL-13-3: Rejecting with an empty reason is refused
- **Tests:** citing this ID: none; through its board task: `e2e/salon-signup.spec.ts`, `invitations.test.ts`, `rep-readonly-timelines.test.ts`, `reverify-slices-1-3.test.ts`, `salon-approval.test.ts`, `salon-self-signup.test.ts`, `verify-slices-1-3.test.ts`
- **Implementation evidence:** board: P1-18 (IN PROGRESS); P1-24 (IN PROGRESS); `/office/salons/approvals`; `supabase/tests/salon-approval.test.ts`
- **Known gap:** Offline proposal waits for P1-09 wiring

#### SAL-14

**Priority:** M · **Phase:** 1 · **Status:** IMPLEMENTED — NOT VERIFIED

- **Statement (doc 03, verbatim):** Assignment and reachability (D-36): a salon with a direct assignment is reachable only by that rep; with none, by reps covering its territory; with no area and no assignment, by no rep. Only the office assigns or changes a rep; the assignment history is append-only and never rewrites past attribution
- **Actor:** Owner or manager
- **Preconditions:** Salon and rep exist
- **Expected behaviour:** A direct assignment makes the salon reachable only by that rep; with none, by reps covering its territory; with no area and no assignment, by no rep
- **Business rules:** Assignment history is append-only and never rewrites past attribution
- **Permissions:** Office only
- **Failure and exceptions:** A rep assigning itself is refused
- **Acceptance criteria:**
  - AC-SAL-14-1: After `app.office_assign_salon_rep`, only the assigned rep's `app.my_salons` lists the salon
  - AC-SAL-14-2: Reassignment adds a history row and leaves past orders' attribution unchanged
  - AC-SAL-14-3: A rep call to assign is refused
- **Tests:** citing this ID: none; through its board task: `e2e/salon-signup.spec.ts`, `invitations.test.ts`, `reverify-slices-1-3.test.ts`, `salon-approval.test.ts`, `salon-self-signup.test.ts`, `verify-slices-1-3.test.ts`
- **Implementation evidence:** board: P1-18 (IN PROGRESS); `supabase/tests/salon-approval.test.ts`

#### PIP-05

**Priority:** M/S · **Phase:** 1 (thin: product-group default cycle + last purchase, D-19) / 2 (estimated from history) · **Status:** PARTIALLY IMPLEMENTED

- **Statement (doc 03, verbatim):** Cycle estimation per salon × product group from order history; default cycles per product group configurable
- **Actor:** System; office (default cycles)
- **Preconditions:** Product groups with default cycles (ADM-01)
- **Expected behaviour:** Phase 1 thin rule: due date = last purchase per product group + the group's default cycle (D-19)
- **Business rules:** History-based estimation is Phase 2
- **Permissions:** Office configures defaults (owner-only config, see DA-014)
- **Failure and exceptions:** A salon with no purchase and no opening baseline has no due date
- **Acceptance criteria:**
  - AC-PIP-05-1: For a salon whose last delivery in group G was on day X and G's cycle is N days, the due list shows due date X + N
  - AC-PIP-05-2: A salon with no purchase is absent from the due list unless an opening baseline is set (`app.office_set_last_purchase`)
- **Tests:** citing this ID: `routes.test.ts`; through its board task: `rep-blind-stock-issues.test.ts`, `routes.test.ts`
- **Implementation evidence:** board: P1-16 (DONE); P1-29 (IN PROGRESS); `app.due_list`
- **Known gap:** The opening-baseline function has no UI on main (PR 114 adds it)

#### PIP-06

**Priority:** M/S · **Phase:** 1 (thin due-list, D-19) / 2 · **Status:** IMPLEMENTED — NOT VERIFIED

- **Statement (doc 03, verbatim):** Due-for-reorder tasks generated at due − 3 days; at-risk transition at due + 50% cycle
- **Actor:** System
- **Preconditions:** PIP-05 due dates
- **Expected behaviour:** A salon appears as due from due − 3 days; at-risk is due + 50% of the cycle
- **Business rules:** Phase 1 thin list (D-19); automation Phase 2
- **Permissions:** Rep sees reachable salons only; office sees all
- **Failure and exceptions:** —
- **Acceptance criteria:**
  - AC-PIP-06-1: A salon due on day D appears in the due list on D − 3 and not on D − 4
  - AC-PIP-06-2: A salon past D + 50% of its cycle is shown as at risk
- **Tests:** citing this ID: `routes.test.ts`; through its board task: `rep-blind-stock-issues.test.ts`, `routes.test.ts`
- **Implementation evidence:** board: P1-16 (DONE); P1-29 (IN PROGRESS); `/app/route`, `/office/routes`; `supabase/tests/routes.test.ts`

#### PIP-07

**Priority:** M · **Phase:** 1 · **Status:** PARTIALLY IMPLEMENTED

- **Statement (doc 03, verbatim):** Prospect quick-add from the field (≤ 60 seconds, works offline); it is a proposal, pending until the office approves it (SAL-13)
- **Actor:** Rep
- **Preconditions:** Rep signed in; offline allowed
- **Expected behaviour:** A prospect is captured in 60 s or less and stays pending until the office approves (SAL-13)
- **Business rules:** Same rules as SAL-13
- **Permissions:** Rep
- **Failure and exceptions:** Captured offline, a rejection after sync is shown to the rep (NFR-01)
- **Acceptance criteria:**
  - AC-PIP-07-1: A rep creates a prospect with name optional at first and it is pending
  - AC-PIP-07-2: With the network off, the prospect is queued and appears on the server after reconnecting
- **Tests:** citing this ID: none; through its board task: `b33-decisions.test.ts`, `create-salon-blanks.test.ts`, `crm-attacks.test.ts`, `salons.test.ts`, `visits.test.ts`
- **Implementation evidence:** board: P1-02 (IN PROGRESS); `/app/salons/new`
- **Known gap:** Offline capture is not wired: no page calls the outbox `submit()` (P1-09)

#### PIP-08

**Priority:** S · **Phase:** 2 · **Status:** DEFERRED — FUTURE PHASE

- **Statement (doc 03, verbatim):** Territory mapping sweep mode: fast sequential prospect capture with photo and pin; map-based capture and online discovery are specified in the MAP module below
- **Record:** not standardised yet. The full record (actor, preconditions, behaviour, rules, permissions, failure behaviour, acceptance criteria) is written when its phase is planned (H-22). Until then the statement above is the requirement.
- **Tests:** citing this ID: none; through its board task: none
- **Implementation evidence:** board: none

#### MAP-01

**Priority:** M · **Phase:** 1 · **Status:** NOT STARTED

- **Statement (doc 03, verbatim):** Territory map view for the rep: all salons in assigned territories as pins, colour-coded by stage (prospect / trial / active / at-risk / dormant / blocked), with the rep's live position. Tapping a pin opens the salon card (stage, last order, balance due, next cycle)
- **Actor:** Rep
- **Preconditions:** Map provider approved (H-21) and P1-03 built
- **Expected behaviour:** The rep sees pins for salons in assigned territories coloured by stage, with live position; tapping opens the salon card
- **Business rules:** Masking per MAP-12
- **Permissions:** Rep
- **Failure and exceptions:** No GPS fix: the map still shows pins without the position
- **Acceptance criteria:**
  - AC-MAP-01-1: Pins appear only for reachable salons, coloured by stage
  - AC-MAP-01-2: Tapping a pin shows stage, last order, balance due and next cycle
- **Tests:** citing this ID: none; through its board task: none
- **Implementation evidence:** board: P1-03 (NOT STARTED)
- **Known gap:** Not built (P1-03); no map provider approved

#### MAP-02

**Priority:** M · **Phase:** 1 · **Status:** NOT STARTED

- **Statement (doc 03, verbatim):** **Drop a pin**: long-press anywhere on the map to create a prospect at that location in ≤ 60 s — name (optional at first), type, photo, phone (optional), and a free-text **note ("chit")**. Works offline; geocoded to an area on sync. The new salon is a proposal, pending until the office approves it (SAL-13)
- **Actor:** Rep
- **Preconditions:** Map view (MAP-01)
- **Expected behaviour:** Long-press creates a pending prospect at that point with optional fields and a note; works offline; geocoded on sync
- **Business rules:** Pending until office approval (SAL-13)
- **Permissions:** Rep
- **Failure and exceptions:** Rejected after sync is shown to the rep
- **Acceptance criteria:**
  - AC-MAP-02-1: A long-press creates a pending salon with the pin's coordinates
  - AC-MAP-02-2: Offline capture syncs within 60 s of reconnecting
- **Tests:** citing this ID: none; through its board task: none
- **Implementation evidence:** board: P1-03 (NOT STARTED)
- **Known gap:** Not built (P1-03); pin capture exists only as form fields

#### MAP-03

**Priority:** M · **Phase:** 1 · **Status:** NOT STARTED

- **Statement (doc 03, verbatim):** **Pin notes**: every pin carries a running list of dated notes (who was met, what they use, when to come back). Notes are append-only and appear on the salon timeline (SAL-05)
- **Actor:** Rep (reachable salons); office
- **Preconditions:** Salon visible to the caller
- **Expected behaviour:** Dated notes are appended to a salon and appear on its timeline
- **Business rules:** Notes append-only (H-06)
- **Permissions:** Rep for reachable salons; office all
- **Failure and exceptions:** Note on an unreachable salon is refused
- **Acceptance criteria:**
  - AC-MAP-03-1: `app.add_salon_note` appends a note with server time and author
  - AC-MAP-03-2: UPDATE or DELETE on `salon_note` fails for every role
  - AC-MAP-03-3: The note appears on the salon timeline
- **Tests:** citing this ID: `salons.test.ts`; through its board task: none
- **Implementation evidence:** board: P1-03 (NOT STARTED); `supabase/tests/salons.test.ts`

#### MAP-04

**Priority:** S · **Phase:** 2 · **Status:** DEFERRED — FUTURE PHASE

- **Statement (doc 03, verbatim):** **Nearby discovery — one tap**: a "Find salons near me" button queries an online places provider for businesses offering hair care, hair treatment or hair beauty within a configurable radius (default 3 km ≈ 2 miles, max 6 km ≈ 4 miles) of the rep's **current GPS fix**. Results appear as grey "discovered" pins with name, address, rating, phone (if listed), and distance
- **Record:** not standardised yet. The full record (actor, preconditions, behaviour, rules, permissions, failure behaviour, acceptance criteria) is written when its phase is planned (H-22). Until then the statement above is the requirement.
- **Tests:** citing this ID: none; through its board task: none
- **Implementation evidence:** board: none

#### MAP-05

**Priority:** S · **Phase:** 2 · **Status:** DEFERRED — FUTURE PHASE

- **Statement (doc 03, verbatim):** Discovery covers the full category set: ladies' beauty parlors, men's salons, unisex salons, barbers, hair studios, bridal studios, spas and wellness centres with hair services, home-based parlors listed online, beauty academies/training institutes — across all of Karachi, not just the rep's territory. Search terms and categories are configurable by O/Mg and include Urdu/Roman-Urdu variants ("parlour", "parlor", "salon", "saloon", "beauty", "hair", "mehndi/bridal")
- **Record:** not standardised yet. The full record (actor, preconditions, behaviour, rules, permissions, failure behaviour, acceptance criteria) is written when its phase is planned (H-22). Until then the statement above is the requirement.
- **Tests:** citing this ID: none; through its board task: none
- **Implementation evidence:** board: none

#### MAP-06

**Priority:** S · **Phase:** 2 · **Status:** DEFERRED — FUTURE PHASE

- **Statement (doc 03, verbatim):** **Convert discovered → prospect** with one tap. Deduplication against existing salons by provider place id, phone, and name+distance (< 75 m) before creating; duplicates link to the existing record instead
- **Record:** not standardised yet. The full record (actor, preconditions, behaviour, rules, permissions, failure behaviour, acceptance criteria) is written when its phase is planned (H-22). Until then the statement above is the requirement.
- **Tests:** citing this ID: none; through its board task: none
- **Implementation evidence:** board: none

#### MAP-07

**Priority:** S · **Phase:** 2 · **Status:** DEFERRED — FUTURE PHASE

- **Statement (doc 03, verbatim):** Discovered or dropped pins **outside the rep's territories** are saved and assigned to the territory they fall in (and that territory's rep); the discovering rep is recorded as `discovered_by` for the new-salon bonus (CTL-13). Manager notified
- **Record:** not standardised yet. The full record (actor, preconditions, behaviour, rules, permissions, failure behaviour, acceptance criteria) is written when its phase is planned (H-22). Until then the statement above is the requirement.
- **Tests:** citing this ID: none; through its board task: none
- **Implementation evidence:** board: none

#### MAP-08

**Priority:** S · **Phase:** 2 · **Status:** DEFERRED — FUTURE PHASE

- **Statement (doc 03, verbatim):** **Pins → route**: the rep selects pins on the map (or "all due today" / "all prospects in this block") and the app orders them into an efficient walking/bike route from the rep's position; the route becomes today's route stops (PIP-03). The sequence is editable; the reason per stop is preserved
- **Record:** not standardised yet. The full record (actor, preconditions, behaviour, rules, permissions, failure behaviour, acceptance criteria) is written when its phase is planned (H-22). Until then the statement above is the requirement.
- **Tests:** citing this ID: none; through its board task: none
- **Implementation evidence:** board: none

#### MAP-09

**Priority:** S · **Phase:** 2 · **Status:** DEFERRED — FUTURE PHASE

- **Statement (doc 03, verbatim):** **Pin timeline**: a per-rep chronological view of pins created, visited and converted — "what I covered this week" — and a territory heat view for O/Mg showing covered vs. uncovered blocks
- **Record:** not standardised yet. The full record (actor, preconditions, behaviour, rules, permissions, failure behaviour, acceptance criteria) is written when its phase is planned (H-22). Until then the statement above is the requirement.
- **Tests:** citing this ID: none; through its board task: none
- **Implementation evidence:** board: none

#### MAP-10

**Priority:** C · **Phase:** 3 · **Status:** DEFERRED — FUTURE PHASE

- **Statement (doc 03, verbatim):** Discovery results are cached per area for 30 days to limit provider cost; a nightly job re-runs discovery for territories with reps and surfaces *new* listings as tasks ("3 new salons listed near your route")
- **Record:** not standardised yet. The full record (actor, preconditions, behaviour, rules, permissions, failure behaviour, acceptance criteria) is written when its phase is planned (H-22). Until then the statement above is the requirement.
- **Tests:** citing this ID: none; through its board task: none
- **Implementation evidence:** board: none

#### MAP-11

**Priority:** S · **Phase:** 2 · **Status:** DEFERRED — FUTURE PHASE

- **Statement (doc 03, verbatim):** Discovery uses the rep's live GPS fix only — never a typed location — so a discovery call is also proof of presence; the fix, time and result count are logged on `rep_day`
- **Record:** not standardised yet. The full record (actor, preconditions, behaviour, rules, permissions, failure behaviour, acceptance criteria) is written when its phase is planned (H-22). Until then the statement above is the requirement.
- **Tests:** citing this ID: none; through its board task: none
- **Implementation evidence:** board: none

#### MAP-12

**Priority:** M · **Phase:** 1 · **Status:** NOT STARTED

- **Statement (doc 03, verbatim):** Map data (pins, phones) obeys the same RLS and masking rules as salon lists: reps see their territories' pins in full and other territories' pins as counts only; no export of pin sets
- **Actor:** Rep
- **Preconditions:** Map built (MAP-01)
- **Expected behaviour:** Pins and phones obey the salon-list RLS and masking: own territories in full, others as counts only; no export
- **Business rules:** H-14
- **Permissions:** Rep
- **Failure and exceptions:** Any attempt to list another territory's pins returns counts only
- **Acceptance criteria:**
  - AC-MAP-12-1: A rep receives no pin coordinates for another territory's salons
  - AC-MAP-12-2: No pin export exists for reps
- **Tests:** citing this ID: `crm-attacks.test.ts`; through its board task: none
- **Implementation evidence:** board: P1-03 (NOT STARTED)
- **Known gap:** Not built (P1-03)

#### MAP-13

**Priority:** S · **Phase:** 2 · **Status:** DEFERRED — FUTURE PHASE

- **Statement (doc 03, verbatim):** O/Mg map: all territories, all reps' live positions during a `rep_day`, today's visits as a trail, uncovered zones
- **Record:** not standardised yet. The full record (actor, preconditions, behaviour, rules, permissions, failure behaviour, acceptance criteria) is written when its phase is planned (H-22). Until then the statement above is the requirement.
- **Tests:** citing this ID: none; through its board task: none
- **Implementation evidence:** board: none

#### CTL-09

**Priority:** M · **Phase:** 1 · **Status:** NOT STARTED

- **Statement (doc 03, verbatim):** New salon verification: a salon is "verified" only after an OTP sent to the salon's phone is confirmed and a manager has spoken to the salon; unverified salons are cash-only and earn no new-salon bonus. Interim (MJ, ACTIVITY L-0163): until verification is built, the owner sets plan eligibility and limit by hand
- **Actor:** Owner or manager
- **Preconditions:** Salon exists; SMS provider for the OTP (B-08)
- **Expected behaviour:** A salon is verified only after an OTP to its phone is confirmed and a manager has spoken to it; unverified salons are cash-only and earn no new-salon bonus
- **Business rules:** Interim: owner sets eligibility by hand (L-0163)
- **Permissions:** Office
- **Failure and exceptions:** Without verification the salon stays cash-only
- **Acceptance criteria:**
  - AC-CTL-09-1: An unverified salon cannot be given an installment plan
  - AC-CTL-09-2: Verification records who confirmed and when
- **Tests:** citing this ID: `salons.test.ts`; through its board task: `b33-decisions.test.ts`, `create-salon-blanks.test.ts`, `crm-attacks.test.ts`, `salons.test.ts`, `visits.test.ts`
- **Implementation evidence:** board: P1-02 (IN PROGRESS)
- **Known gap:** Not built (P1-02 part c); SMS provider pending (B-08); see DA-017
- **Open or related decisions:** B-08

#### CTL-18

**Priority:** M · **Phase:** 1 · **Status:** PARTIALLY IMPLEMENTED

- **Statement (doc 03, verbatim):** Salon contact-phone changes require an OTP confirmed on the **new** number and send a notice to the **old** number ("reply NO if this wasn't you"); every change appears in the owner digest; the same phone on more than one salon is flagged
- **Actor:** Owner or manager; salon (confirms OTP)
- **Preconditions:** SMS provider (B-08)
- **Expected behaviour:** A contact-phone change needs an OTP on the new number, notifies the old number, appears in the owner digest; the same phone on two salons is flagged
- **Business rules:** —
- **Permissions:** Office
- **Failure and exceptions:** Without OTP the change is not applied
- **Acceptance criteria:**
  - AC-CTL-18-1: A phone change without the OTP confirmation is refused
  - AC-CTL-18-2: `app.duplicate_phones` lists phones used by more than one salon
- **Tests:** citing this ID: `salons.test.ts`; through its board task: `b33-decisions.test.ts`, `create-salon-blanks.test.ts`, `crm-attacks.test.ts`, `salons.test.ts`, `visits.test.ts`
- **Implementation evidence:** board: P1-02 (IN PROGRESS); `app.office_set_primary_contact`; `app.duplicate_phones`
- **Known gap:** OTP and old-number notice not built; duplicate-phone list has no UI on main (PR 114 adds it)
- **Open or related decisions:** B-08

## 6. Business rules

Rules cited by this module's requirements: D-02, D-19, D-35, D-36, D-39, D-41, D-51, H-06, H-10, H-14, H-21, H-22. Their text and single source are in [business-rules.md](../../requirements/business-rules.md); thresholds are doc 13 §9, permissions are doc 06 §2.

## 7. User journeys

- J-SP-1 Rep proposes a salon in the field (PIP-07, SAL-13): capture, pending, office decision, approved salon reachable under SAL-14.
- J-SP-2 Office adds a salon directly (SAL-01): approved at once, optionally assigned (SAL-14).
- J-SP-3 Salon signs itself up (D-51 of 2026-11-09, SAL-11): e-mail code, application, office approval, membership.
- J-SP-4 Due list (PIP-05, PIP-06): delivery sets last purchase, salon appears 3 days before due, at risk after 50% of the cycle.
- J-SP-5 Contact-phone change (CTL-18): incomplete, no OTP provider (DA-017).

Full journeys with steps: [journeys-and-workflows.md](../../requirements/journeys-and-workflows.md).

## 8. Cross-module interactions

Field-operations reads reachable salons for visits and routes. Orders-delivery refuses requests and orders for pending salons. Money-credit owns the credit profile values shown on the salon page. Control-governance owns logins and the audit log behind the salon timeline.

## 9. Security requirements

RLS on every table, rep reads through territory-scoped functions with masked phones and 50-row caps (H-14); phone reveal logged in `control.phone_reveal`; no export for reps (SEC-06); stage events and notes append-only (H-06); salon membership never inferred from a contact phone (doc 06 §2.1).

## 10. Failure scenarios

- Rep proposes a duplicate salon: no duplicate check in Phase 1 (SAL-06 is Phase 2); the office rejects it with a reason.
- Salon with no area and no assignment: reachable by no rep by design (D-36).
- Imported salon with no purchase history: absent from the due list until an opening baseline is set (A-09).
- Offline proposal rejected after sync: must be shown to the rep (NFR-01); not built while the outbox is unwired.

## 11. Acceptance criteria

53 criteria (IDs `AC-<requirement>-<n>`) are in the records above and in the [acceptance criteria matrix](../../audit/2026-11-19/05-acceptance-criteria-matrix.md).

## 12. Dependencies

Map provider for P1-03 (H-21 approval, none chosen); SMS provider for CTL-09 and CTL-18 (B-08); the real Excel file (B-02); pilot territory (B-09).

## 13. Implementation status and evidence

| Requirement | Phase | Status | Board tasks | Tests citing the ID |
|---|---|---|---|---|
| SAL-01 | 1 | PARTIALLY IMPLEMENTED | P1-02 | 4 |
| SAL-02 | 1 | PARTIALLY IMPLEMENTED | P1-02 | 2 |
| SAL-03 | 1 | PARTIALLY IMPLEMENTED | P1-02 | 2 |
| SAL-04 | 1 | PARTIALLY IMPLEMENTED | P1-02, P1-06 | 2 |
| SAL-05 | 1 | PARTIALLY IMPLEMENTED | P1-02, P1-24 | 0 |
| SAL-06 | 2 | DEFERRED — FUTURE PHASE | — | 0 |
| SAL-07 | 2 | DEFERRED — FUTURE PHASE | — | 0 |
| SAL-08 | 3 | DEFERRED — FUTURE PHASE | — | 0 |
| SAL-09 | 1 | IMPLEMENTED — NOT VERIFIED | P1-02, P1-24 | 1 |
| SAL-10 | 1 | PARTIALLY IMPLEMENTED | P0-02, P1-02 | 0 |
| SAL-11 | 1 | IMPLEMENTED — NOT VERIFIED | P1-18 | 0 |
| SAL-12 | 1 | PARTIALLY IMPLEMENTED | P1-23 | 0 |
| SAL-13 | 1 | PARTIALLY IMPLEMENTED | P1-18, P1-24 | 0 |
| SAL-14 | 1 | IMPLEMENTED — NOT VERIFIED | P1-18 | 0 |
| PIP-05 | 1 (thin: product-group default cycle + last purchase, D-19) / 2 (estimated from history) | PARTIALLY IMPLEMENTED | P1-16, P1-29 | 1 |
| PIP-06 | 1 (thin due-list, D-19) / 2 | IMPLEMENTED — NOT VERIFIED | P1-16, P1-29 | 1 |
| PIP-07 | 1 | PARTIALLY IMPLEMENTED | P1-02 | 0 |
| PIP-08 | 2 | DEFERRED — FUTURE PHASE | — | 0 |
| MAP-01 | 1 | NOT STARTED | P1-03 | 0 |
| MAP-02 | 1 | NOT STARTED | P1-03 | 0 |
| MAP-03 | 1 | NOT STARTED | P1-03 | 1 |
| MAP-04 | 2 | DEFERRED — FUTURE PHASE | — | 0 |
| MAP-05 | 2 | DEFERRED — FUTURE PHASE | — | 0 |
| MAP-06 | 2 | DEFERRED — FUTURE PHASE | — | 0 |
| MAP-07 | 2 | DEFERRED — FUTURE PHASE | — | 0 |
| MAP-08 | 2 | DEFERRED — FUTURE PHASE | — | 0 |
| MAP-09 | 2 | DEFERRED — FUTURE PHASE | — | 0 |
| MAP-10 | 3 | DEFERRED — FUTURE PHASE | — | 0 |
| MAP-11 | 2 | DEFERRED — FUTURE PHASE | — | 0 |
| MAP-12 | 1 | NOT STARTED | P1-03 | 1 |
| MAP-13 | 2 | DEFERRED — FUTURE PHASE | — | 0 |
| CTL-09 | 1 | NOT STARTED | P1-02 | 1 |
| CTL-18 | 1 | PARTIALLY IMPLEMENTED | P1-02 | 1 |
