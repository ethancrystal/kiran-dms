# Inventory — module document (context `inventory`)

This document is derived reference material written by the 2026-11-19 documentation audit. It never overrides the numbered planning documents, doc 16 or `docs/ACTIVITY.md` (ACTIVITY §1); doc 03 stays the index of requirement IDs and the source of every statement quoted here. Status is derived from the ACTIVITY §12 board and the evidence named, using the vocabulary in [docs/requirements/README.md](../../requirements/README.md#status-vocabulary).

## 1. Purpose and boundaries

Goods as quantities: catalogue (product groups, products, SKUs, pictures), stock locations including each rep's bag, append-only movements, issue and return between warehouse and bag, daily close and spot checks, reorder points, bag load suggestions and lost demand.

**Outside this module:** Cost, purchase orders and supplier data (supplier-vault); prices (orders-delivery); the storefront's published copy of the catalogue (storefront).

## 2. Glossary

- **Bag:** The virtual stock location of one rep (INV-02).
- **Movement:** An append-only stock row; stock on hand is the sum of movements (H-10).
- **Lost demand:** A request that could not be met, recorded by SKU or product group and reason (D-18).

## 3. Actors and permissions

Owner and manager: catalogue, issues and returns, adjustments (approval per DA-013), reorder points, spot checks. Rep: own bag and warehouse quantities, daily count, demand taps. Matrix: doc 06 §2 rows "Stock issue to rep / receive from rep", "Stock adjustment / write-off", "Products, pictures…".

## 4. Owned entities and data

Tables owned (from the migrations on `main` at `d4b47ca`): `product_group`, `product`, `sku`, `stock_location`, `stock_movement`, `stock_issue`, `stock_count`, `reorder_rule`, `demand_signal`, `owner_stock_adjustment`. Ownership follows CONTEXT-MAP.md; no table is owned by two modules.

## 5. Functional requirements

18 requirements, in doc 03 order. Phase 1 requirements carry a full record; later-phase requirements carry their statement and status.

#### INV-01

**Priority:** M · **Phase:** 1 · **Status:** IMPLEMENTED — NOT VERIFIED

- **Statement (doc 03, verbatim):** SKU master: product line, product, variant (size, shade), unit, barcode (optional), selling price, active flag. Cost price lives in the vault (VLT), not here
- **Actor:** Owner or manager
- **Preconditions:** —
- **Expected behaviour:** SKU master with product, variant, unit, optional barcode, selling price and active flag; cost lives only in the vault
- **Business rules:** Dummy data until B-10 (H-04)
- **Permissions:** Office manages (D-39)
- **Failure and exceptions:** —
- **Acceptance criteria:**
  - AC-INV-01-1: No `public` table has a cost column
- **Tests:** citing this ID: `inventory.test.ts`; through its board task: `inventory.test.ts`, `issue-sku-names.test.ts`
- **Implementation evidence:** board: P1-04 (DONE); P1-34 (NOT STARTED); `/office/products`; `supabase/tests/inventory.test.ts`
- **Open blocker B-10:** Real product catalogue (OQ-16). On main: PENDING (part answered); in PR 115 (not merged): interim: dummy data
- **Open blocker B-55:** Shade numbers and pack wording. On main: PENDING; in PR 115 (not merged): interim: dummy data
- **Open or related decisions:** B-10, B-55

#### INV-02

**Priority:** M · **Phase:** 1 · **Status:** IMPLEMENTED — NOT VERIFIED

- **Statement (doc 03, verbatim):** Stock locations: warehouse(s) and one virtual location per rep ("bag/van stock")
- **Actor:** Owner or manager
- **Preconditions:** —
- **Expected behaviour:** Stock locations: warehouses and one virtual bag per rep
- **Business rules:** —
- **Permissions:** Office
- **Failure and exceptions:** —
- **Acceptance criteria:**
  - AC-INV-02-1: Each rep has exactly one bag location
- **Tests:** citing this ID: `inventory.test.ts`; through its board task: `e2e-stack/office.spec.ts`, `inventory.test.ts`, `issue-sku-names.test.ts`, `office-approvals.test.ts`, `office-orders.test.ts`
- **Implementation evidence:** board: P1-04 (DONE); P1-25 (IN PROGRESS); `supabase/tests/inventory.test.ts`

#### INV-03

**Priority:** M · **Phase:** 1 · **Status:** PARTIALLY IMPLEMENTED

- **Statement (doc 03, verbatim):** Stock movements: receipt (from vault purchase), issue to rep, sale/delivery, return from salon, return to warehouse, damage/expiry write-off, adjustment (Mg/O, reason required). Movements are append-only
- **Actor:** Office (movements); manager or owner (adjustment)
- **Preconditions:** Locations exist
- **Expected behaviour:** Append-only movements of the listed kinds; adjustments need a reason
- **Business rules:** H-06; write-off authority see DA-013
- **Permissions:** Office
- **Failure and exceptions:** UPDATE or DELETE fails; adjustment without reason refused
- **Acceptance criteria:**
  - AC-INV-03-1: UPDATE or DELETE on `stock_movement` fails for every role
  - AC-INV-03-2: An adjustment without a reason is refused
- **Tests:** citing this ID: `crm-attacks.test.ts`, `inventory.test.ts`; through its board task: `audit-fixes.test.ts`, `b33-decisions.test.ts`, `e2e-stack/office.spec.ts`, `e2e-stack/p130-screens.spec.ts`, `e2e/list-cap-note.spec.ts`, `e2e/time.spec.ts`, `inventory.test.ts`, `issue-sku-names.test.ts`, `office-approvals.test.ts`, `office-orders.test.ts`
- **Implementation evidence:** board: P1-04 (DONE); P1-25 (IN PROGRESS); P1-30 (IN PROGRESS); `supabase/tests/inventory.test.ts`
- **Known gap:** Return workflow is Phase 2 (DA-028)

#### INV-04

**Priority:** M · **Phase:** 1 · **Status:** IMPLEMENTED — NOT VERIFIED

- **Statement (doc 03, verbatim):** Live stock by location and SKU; rep sees own bag stock and warehouse availability (quantities only)
- **Actor:** Office; rep (own bag, warehouse quantities)
- **Preconditions:** —
- **Expected behaviour:** Live stock by location and SKU, derived from movements
- **Business rules:** H-10
- **Permissions:** Rep own bag only
- **Failure and exceptions:** —
- **Acceptance criteria:**
  - AC-INV-04-1: Stock on hand equals the sum of movements
  - AC-INV-04-2: A rep sees no other rep's bag
- **Tests:** citing this ID: `crm-attacks.test.ts`, `inventory.test.ts`; through its board task: `inventory.test.ts`, `issue-sku-names.test.ts`, `rep-blind-stock-issues.test.ts`, `routes.test.ts`
- **Implementation evidence:** board: P1-04 (DONE); P1-29 (IN PROGRESS); `app.stock_on_hand`; `/office/stock`

#### INV-05

**Priority:** M · **Phase:** 1 · **Status:** IMPLEMENTED — NOT VERIFIED

- **Statement (doc 03, verbatim):** Daily stock close per rep (expected vs counted) with variance logging
- **Actor:** Rep (count); office
- **Preconditions:** Open day
- **Expected behaviour:** Daily close per rep: expected against counted with variance logged
- **Business rules:** —
- **Permissions:** Rep own
- **Failure and exceptions:** —
- **Acceptance criteria:**
  - AC-INV-05-1: A close with a variance records the variance
- **Tests:** citing this ID: `crm-attacks.test.ts`, `inventory.test.ts`, `verify-slices-1-3.test.ts`, `visits.test.ts`; through its board task: `inventory.test.ts`, `issue-sku-names.test.ts`, `rep-blind-stock-issues.test.ts`, `routes.test.ts`
- **Implementation evidence:** board: P1-04 (DONE); P1-29 (IN PROGRESS); `app.record_count`; `supabase/tests/inventory.test.ts`

#### INV-06

**Priority:** M · **Phase:** 1 / S|2 · **Status:** IMPLEMENTED — NOT VERIFIED

- **Statement (doc 03, verbatim):** Reorder point per SKU (manual in Phase 1; computed from demand × lead time + safety in Phase 2); low-stock alerts
- **Actor:** Owner or manager
- **Preconditions:** —
- **Expected behaviour:** Manual reorder point per SKU with low-stock alerts
- **Business rules:** Computed points Phase 2
- **Permissions:** Office
- **Failure and exceptions:** —
- **Acceptance criteria:**
  - AC-INV-06-1: A SKU below its reorder point appears in `app.low_stock`
- **Tests:** citing this ID: `crm-attacks.test.ts`, `inventory.test.ts`; through its board task: `inventory.test.ts`, `issue-sku-names.test.ts`, `rep-blind-stock-issues.test.ts`, `routes.test.ts`
- **Implementation evidence:** board: P1-04 (DONE); P1-29 (IN PROGRESS); `/office/stock/levels`
- **Open blocker B-31:** Audit questions (a) to (g): pin moves, phone reveals, midnight, invoices per delivery, delivery mode, low stock, agents. On main: PENDING; in PR 115 (not merged): decided in part ((c) 1-hour offline window; pin answer)
- **Open or related decisions:** B-31

#### INV-07

**Priority:** S · **Phase:** 2 · **Status:** DEFERRED — FUTURE PHASE

- **Statement (doc 03, verbatim):** Weekly restock suggestion: per SKU, suggested purchase qty with reasoning (sell-through, cover days, open orders)
- **Record:** not standardised yet. The full record (actor, preconditions, behaviour, rules, permissions, failure behaviour, acceptance criteria) is written when its phase is planned (H-22). Until then the statement above is the requirement.
- **Tests:** citing this ID: none; through its board task: none
- **Implementation evidence:** board: none

#### INV-08

**Priority:** S · **Phase:** 2 · **Status:** DEFERRED — FUTURE PHASE

- **Statement (doc 03, verbatim):** Batch and expiry tracking per receipt; FEFO suggestion on issue; expiry alerts
- **Record:** not standardised yet. The full record (actor, preconditions, behaviour, rules, permissions, failure behaviour, acceptance criteria) is written when its phase is planned (H-22). Until then the statement above is the requirement.
- **Tests:** citing this ID: none; through its board task: none
- **Implementation evidence:** board: none
- **Open blocker B-46:** Invoice: batch and expiry, logo, unsigned delivery. On main: Default, MJ may overrule; in PR 115 (not merged): decided in part (PDF and logo now, batch later; (e) still open)
- **Open or related decisions:** B-46

#### INV-09

**Priority:** S · **Phase:** 2 · **Status:** DEFERRED — FUTURE PHASE

- **Statement (doc 03, verbatim):** Cycle counts and stock-take mode
- **Record:** not standardised yet. The full record (actor, preconditions, behaviour, rules, permissions, failure behaviour, acceptance criteria) is written when its phase is planned (H-22). Until then the statement above is the requirement.
- **Tests:** citing this ID: none; through its board task: none
- **Implementation evidence:** board: none

#### INV-10

**Priority:** S · **Phase:** 2 · **Status:** DEFERRED — FUTURE PHASE

- **Statement (doc 03, verbatim):** Stock valuation report at cost (O/Mg only; cost from vault)
- **Record:** not standardised yet. The full record (actor, preconditions, behaviour, rules, permissions, failure behaviour, acceptance criteria) is written when its phase is planned (H-22). Until then the statement above is the requirement.
- **Tests:** citing this ID: none; through its board task: none
- **Implementation evidence:** board: none

#### INV-11

**Priority:** M · **Phase:** 1 · **Status:** NOT STARTED

- **Statement (doc 03, verbatim):** **Route-linked bag load** (D-19): for a rep's next route day, suggest the bag issue per SKU = expected demand of that day's stops (open orders to deliver from the bag, due reorders × last quantity, a small prospect allowance) − current bag stock, capped by warehouse availability and the bag value limit. Shortages are shown and recorded as demand (DEM-02). The manager issues the suggestion in one step through the two-party issue (CTL-05)
- **Actor:** Manager
- **Preconditions:** Route for next day
- **Expected behaviour:** Suggested bag load per SKU from that day's stops, capped by warehouse and bag limit; shortages recorded as demand
- **Business rules:** D-19
- **Permissions:** Office
- **Failure and exceptions:** —
- **Acceptance criteria:**
  - AC-INV-11-1: The suggestion never exceeds warehouse availability or the bag value limit
- **Tests:** citing this ID: none; through its board task: none
- **Implementation evidence:** board: P1-17 (NOT STARTED)
- **Known gap:** Not built (P1-17)

#### INV-12

**Priority:** M · **Phase:** 2 · **Status:** DEFERRED — FUTURE PHASE

- **Statement (doc 03, verbatim):** Authorized authenticated business users see safe aggregate on-hand and available-to-order quantities per active sellable SKU; salon/rep views never reveal internal locations, rep bag custody, supplier, cost, margin or restricted batch detail. Balances remain derived from append-only movements/reservations. Stays Phase 2: stock is not shown to salons in the current work (D-41)
- **Record:** not standardised yet. The full record (actor, preconditions, behaviour, rules, permissions, failure behaviour, acceptance criteria) is written when its phase is planned (H-22). Until then the statement above is the requirement.
- **Tests:** citing this ID: none; through its board task: none
- **Implementation evidence:** board: none

#### INV-13

**Priority:** M · **Phase:** 1 · **Status:** IMPLEMENTED — NOT VERIFIED

- **Statement (doc 03, verbatim):** Product pictures and descriptions on the catalogue: `product.image_path`, `product.description`; bucket `product-images`, office writes, read by signed-in staff and salon members (an unredeemed login reads nothing), image types only, 5 MB. Owner or manager adds and edits products (D-39, D-41)
- **Actor:** Owner or manager
- **Preconditions:** —
- **Expected behaviour:** Product pictures and descriptions in bucket `product-images`; image types only, 5 MB
- **Business rules:** Readable by staff and salon members only
- **Permissions:** Office writes
- **Failure and exceptions:** A non-image or > 5 MB file is refused
- **Acceptance criteria:**
  - AC-INV-13-1: An upload over 5 MB is refused
  - AC-INV-13-2: An unredeemed login reads no picture
- **Tests:** citing this ID: none; through its board task: `catalogue-prices.test.ts`, `reverify-slices-1-3.test.ts`, `storefront-catalogue.test.ts`, `verify-slices-1-3.test.ts`
- **Implementation evidence:** board: P1-19 (IN PROGRESS); P1-33 (IN PROGRESS; merged in PR 109 at d4b47ca (board stale, DA-023)); `supabase/tests/catalogue-prices.test.ts`
- **Open blocker B-10:** Real product catalogue (OQ-16). On main: PENDING (part answered); in PR 115 (not merged): interim: dummy data
- **Open blocker B-54:** Shop prices and reorder cycle days. On main: PENDING; in PR 115 (not merged): interim: dummy data
- **Open blocker B-55:** Shade numbers and pack wording. On main: PENDING; in PR 115 (not merged): interim: dummy data
- **Open or related decisions:** B-10, B-54, B-55

#### CTL-05

**Priority:** M · **Phase:** 1 · **Status:** IMPLEMENTED — NOT VERIFIED

- **Statement (doc 03, verbatim):** Stock issued to a rep is capped by a per-rep bag value limit; bag stock is counted daily (close) and spot-checked randomly by the manager at least weekly, with the count recorded in-app
- **Actor:** Manager
- **Preconditions:** Bag value limit set
- **Expected behaviour:** Issue to a rep is capped by the bag value limit; daily close; weekly random spot check recorded
- **Business rules:** —
- **Permissions:** Office
- **Failure and exceptions:** An issue over the cap is refused
- **Acceptance criteria:**
  - AC-CTL-05-1: An issue that would exceed the bag value limit is refused
- **Tests:** citing this ID: `e2e-stack/office.spec.ts`, `crm-attacks.test.ts`, `inventory.test.ts`, `rep-blind-stock-issues.test.ts`; through its board task: `e2e-stack/office.spec.ts`, `inventory.test.ts`, `issue-sku-names.test.ts`, `office-approvals.test.ts`, `office-orders.test.ts`, `rep-blind-stock-issues.test.ts`, `routes.test.ts`
- **Implementation evidence:** board: P1-04 (DONE); P1-25 (IN PROGRESS); P1-29 (IN PROGRESS); `supabase/tests/inventory.test.ts`

#### CTL-12

**Priority:** S · **Phase:** 2 · **Status:** DEFERRED — FUTURE PHASE

- **Statement (doc 03, verbatim):** Returns go to a quarantine location, require photo and manager acceptance at the warehouse, and only then re-enter sellable stock
- **Record:** not standardised yet. The full record (actor, preconditions, behaviour, rules, permissions, failure behaviour, acceptance criteria) is written when its phase is planned (H-22). Until then the statement above is the requirement.
- **Tests:** citing this ID: none; through its board task: none
- **Implementation evidence:** board: none

#### DEM-01

**Priority:** M · **Phase:** 1 · **Status:** PARTIALLY IMPLEMENTED

- **Statement (doc 03, verbatim):** Quick capture during a visit: "asked for, could not sell": SKU (or, for an item Kiran does not carry, its product group; no free text, so no brand names land in `public`, H-27), quantity, reason (`not_in_bag` / `out_of_stock` / `not_in_catalogue` / `price` / `supply_short` (office only) / `other`), salon. Works offline; append-only; idempotent
- **Actor:** Rep
- **Preconditions:** Visit
- **Expected behaviour:** Quick capture of unmet demand by SKU or product group, quantity, reason; offline, append-only, idempotent
- **Business rules:** No free text (H-27)
- **Permissions:** Rep
- **Failure and exceptions:** —
- **Acceptance criteria:**
  - AC-DEM-01-1: `app.record_demand` writes one row per client id
- **Tests:** citing this ID: `inventory.test.ts`; through its board task: `rep-blind-stock-issues.test.ts`, `routes.test.ts`
- **Implementation evidence:** board: P1-29 (IN PROGRESS); `components/lost-demand.tsx`
- **Known gap:** Online only until P1-09

#### DEM-02

**Priority:** M · **Phase:** 1 · **Status:** NOT STARTED

- **Statement (doc 03, verbatim):** Automatic capture: when an order line, a delivery, an agent purchase or a bag-load suggestion is cut short by available stock (bag or warehouse), the shortfall is recorded with its reason and source, and whether it became a backorder or was lost
- **Actor:** System
- **Preconditions:** Shortfall
- **Expected behaviour:** Shortfalls from orders, deliveries, agent purchases or bag suggestions are recorded automatically
- **Business rules:** D-18
- **Permissions:** —
- **Failure and exceptions:** —
- **Acceptance criteria:**
  - AC-DEM-02-1: A delivery cut short by stock writes a demand row with source and reason
- **Tests:** citing this ID: none; through its board task: none
- **Implementation evidence:** board: P1-17 (NOT STARTED)
- **Known gap:** Not built (P1-17)

#### DEM-03

**Priority:** M · **Phase:** 1 / S|2 · **Status:** NOT STARTED

- **Statement (doc 03, verbatim):** Lost-demand report by SKU, reason, territory and week; unconstrained demand (delivered + lost) feeds reorder points and restock suggestions (doc 10 §6); supplier fill rate shown in the vault
- **Actor:** Owner or manager
- **Preconditions:** Demand rows
- **Expected behaviour:** Lost-demand report by SKU, reason, territory and week
- **Business rules:** Supplier fill rate only in the vault
- **Permissions:** Office
- **Failure and exceptions:** —
- **Acceptance criteria:**
  - AC-DEM-03-1: Report totals equal the underlying demand rows
- **Tests:** citing this ID: none; through its board task: none
- **Implementation evidence:** board: P1-17 (NOT STARTED)
- **Known gap:** Not built (P1-17)

## 6. Business rules

Rules cited by this module's requirements: D-18, D-19, D-39, D-41, H-04, H-06, H-10, H-22, H-27. Their text and single source are in [business-rules.md](../../requirements/business-rules.md); thresholds are doc 13 §9, permissions are doc 06 §2.

## 7. User journeys

- J-IN-1 Issue to bag (CTL-05): office proposes, rep confirms, capped by bag value.
- J-IN-2 Daily close (INV-05): expected against counted.
- J-IN-3 Demand tap (DEM-01).
- J-IN-4 Bag load suggestion and lost-demand report (INV-11, DEM-02, DEM-03): not built.

Full journeys with steps: [journeys-and-workflows.md](../../requirements/journeys-and-workflows.md).

## 8. Cross-module interactions

Approved deliveries (orders-delivery) move stock out of the bag or pending location; goods receipts (supplier-vault) will move stock in without cost; the storefront reads the catalogue.

## 9. Security requirements

No cost column outside the vault (H-01, H-05); movements append-only; adjustments need a reason and approval; dummy catalogue only (H-04, B-10).

## 10. Failure scenarios

- Issue over the bag value limit: refused.
- Count variance: recorded with the close; repeated variance is an anomaly (doc 13).
- Expired or damaged goods: write-off path with photo (doc 10), approval per DA-013.

## 11. Acceptance criteria

15 criteria (IDs `AC-<requirement>-<n>`) are in the records above and in the [acceptance criteria matrix](../../audit/2026-11-19/05-acceptance-criteria-matrix.md).

## 12. Dependencies

Real catalogue (B-10); vault goods receipts (P1-05); offline demand capture (P1-09).

## 13. Implementation status and evidence

| Requirement | Phase | Status | Board tasks | Tests citing the ID |
|---|---|---|---|---|
| INV-01 | 1 | IMPLEMENTED — NOT VERIFIED | P1-04, P1-34 | 1 |
| INV-02 | 1 | IMPLEMENTED — NOT VERIFIED | P1-04, P1-25 | 1 |
| INV-03 | 1 | PARTIALLY IMPLEMENTED | P1-04, P1-25, P1-30 | 2 |
| INV-04 | 1 | IMPLEMENTED — NOT VERIFIED | P1-04, P1-29 | 2 |
| INV-05 | 1 | IMPLEMENTED — NOT VERIFIED | P1-04, P1-29 | 4 |
| INV-06 | 1 / S|2 | IMPLEMENTED — NOT VERIFIED | P1-04, P1-29 | 2 |
| INV-07 | 2 | DEFERRED — FUTURE PHASE | — | 0 |
| INV-08 | 2 | DEFERRED — FUTURE PHASE | — | 0 |
| INV-09 | 2 | DEFERRED — FUTURE PHASE | — | 0 |
| INV-10 | 2 | DEFERRED — FUTURE PHASE | — | 0 |
| INV-11 | 1 | NOT STARTED | P1-17 | 0 |
| INV-12 | 2 | DEFERRED — FUTURE PHASE | — | 0 |
| INV-13 | 1 | IMPLEMENTED — NOT VERIFIED | P1-19, P1-33 | 0 |
| CTL-05 | 1 | IMPLEMENTED — NOT VERIFIED | P1-04, P1-25, P1-29 | 4 |
| CTL-12 | 2 | DEFERRED — FUTURE PHASE | — | 0 |
| DEM-01 | 1 | PARTIALLY IMPLEMENTED | P1-29 | 1 |
| DEM-02 | 1 | NOT STARTED | P1-17 | 0 |
| DEM-03 | 1 / S|2 | NOT STARTED | P1-17 | 0 |
