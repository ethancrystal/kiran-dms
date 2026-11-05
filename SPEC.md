# Kiran DMS — Spec (index)

**Authoritative business reference: [`docs/16-project-completion-goal.md`](docs/16-project-completion-goal.md)** (MJ's goal and master task, D-33). Where any document here or below disagrees with it, doc 16 wins.

This file is the **entry point**, not a second source of truth. The planning set in [`docs/`](docs/00-README.md) (docs 00–16) decides *what* is built, and [`docs/ACTIVITY.md`](docs/ACTIVITY.md) decides *how* it is built. If this file and a doc disagree, the doc wins and this file is wrong. Fix it in the same pull request (H-25). This file never adds a requirement; new ideas go to [doc 12](docs/12-decisions-and-open-questions.md) first.

Decisions D-15 to D-20 (independent agents, lost demand, due-list and bag load in Phase 1) are recorded in [ACTIVITY L-0128](docs/ACTIVITY.md). This spec includes them.

---

## 1. Objective

**Who it is for.** Kiran Company's **sales agents** in Karachi, plus the owner and manager who run them:

| User | What the system does for them | Doc |
|---|---|---|
| **Salaried rep** (door to door, Kiran's stock and cash) | Shows which salons to visit, what is due, and what to carry. Reads reachable salons read-only, records visits and notes, submits New Order Details cards (order requests) for the manager (D-30, D-34), proposes new salons, collects payments, records field activity/location and sees own commission; approved rep workflows work offline | [02](docs/02-growth-pipeline.md), [08](docs/08-field-sales-and-rep-controls.md) |
| **Salon customer** (direct business customer) | Joins by invitation and uses a secure salon account to view the shared catalogue, its own prices, orders, documents, payments and balance, and submits order requests that the office reviews (D-34) | [03](docs/03-requirements.md), [06](docs/06-security-plan.md), [15](docs/15-field-sales-distribution-engineering-plan.md) |
| **Independent agent** (buys stock outright, resells, reports nothing) | Buys cash-and-carry at an agent price and sees their own purchases and the agent catalogue | [08 §10](docs/08-field-sales-and-rep-controls.md), D-15 to D-17 |
| **Owner** | Sees everything from a phone. Holds the governance powers and the supplier secret | [06 §2](docs/06-security-plan.md), [07](docs/07-supplier-confidentiality.md) |
| **Manager** | Full day-to-day operations: stock, cash, territories, approvals below the owner's thresholds; invites and manages reps and salons, products and prices (D-39); commission and the investor ledger; never creates or promotes an owner or manager | [06 §2](docs/06-security-plan.md), [13 §9](docs/13-anti-fraud-controls.md) |

**The job.** Operate a controlled Karachi salon-distribution network through field representatives and a salon customer portal ([doc 15](docs/15-field-sales-distribution-engineering-plan.md)) by tracking four connected areas:

- **Customers and coverage:** salon records, locations, territories, assignments and visits.
- **Sales:** official orders created only by the office, directly or from rep and salon order requests, through one canonical order engine (D-30, D-34).
- **Supply:** shared products, salon-specific selling prices, stock custody, availability and fulfilment.
- **Money:** invoices, installments, collections, receivables, the daily handover and commission; a basic investor ledger stays separate (D-38, D-40).

**Success in 12 months** ([doc 01](docs/01-business-context.md)):
- 3× active salons;
- +50% order frequency;
- stock-outs under 2% of lines;
- over 90% of installments collected on time;
- Rs 0 unexplained handover variance;
- every new rep productive within 2 weeks;
- monthly sales through independent agents, in rupees (D-21; target to be set by the owner, OQ-21).

**Scope and order.** Phase 0 is foundations, and Phase 1 is the existing MVP: the khata, the bag and the controls. The salon portal, invitations, commission payments, the investor ledger, product pictures and per-salon prices moved into Phase 1 (D-41); they are specified in docs 03, 04, 06 and 15 and sequenced in doc 11, subject to the existing phase gates. Implementation status is only on the ACTIVITY §12 board; requirement IDs are in doc 03.

**Non-goals for now:** accounting, payroll, consumer e-commerce and multi-city features ([doc 01](docs/01-business-context.md)).

## 2. Where we are

Task status lives in one place, [the status board](docs/ACTIVITY.md) (ACTIVITY §12); this file does not repeat it. The order rework's plan is the [design spec](docs/superpowers/specs/2026-11-03-orders-delivery-commission-design.md); the [completion design](docs/superpowers/specs/2026-11-05-reps-salons-catalogue-investors-design.md) wins where they disagree and sets the slices (P1-18 to P1-24; P1-25 adds the office operations screens and the end-to-end journey).

Phase 1 started before Gate 0 by MJ's decision (D-20).

## 3. Sales-agent journeys and how we know they work

Each journey is accepted only when every line under it is shown by a test or, where marked, by the pilot. The IDs point to the requirement; the requirement is the authority.

**J1 — A salaried rep's day** ([doc 02](docs/02-growth-pipeline.md), [doc 08 §3](docs/08-field-sales-and-rep-controls.md))
1. Morning check-in confirms the bag count; no visit, order card or payment is possible without it (PIP-09, CTL-05).
2. The route lists the day's stops with a reason each: re-order due, collection due, at risk, prospect, delivery (PIP-03, PIP-06 thin, D-19).
3. At a salon the rep logs the visit, saves an order card or records a collection, or taps "asked for, could not sell" in **≤ 60 s each, with no signal** (PIP-02, ORD-14, DEM-01, NFR-01).
4. Everything captured offline syncs **within 60 s of reconnecting**; a replay never doubles an effect; a server rejection is shown to the rep (NFR-01, H-08).
5. The salon receives a numbered system receipt on its phone for every payment (CTL-01, D-09).
6. Evening: bag close and a two-party cash handover with the manager (the rep acknowledges the counted figure in their own app); variance is **Rs 0 and 0 units**, or a case is opened the same day (INV-05, PAY-05, CTL-03, doc 11 exit criterion 2).
7. The rep only ever sees reachable salons, read-only, phones masked, ≤ 50 per page, no export (SAL-09, SAL-14, SEC-06, H-14). Reps deliver and collect as approved: a delivery is a submission until the office approves it (D-32).
8. The rep sees its own commission earned, paid and owed, and its payment history, read-only (FLD-03, FLD-06).
9. The rep's home shows its own month without any sum done by hand: orders it brought (placed for it, by status: delivered, waiting, on hold, cancelled), commission earned and paid in the month and still owed, with a month picker; a rep never sees another rep's figures (P1-26, A-20).

**J2 — A rep adds a prospect** ([doc 02](docs/02-growth-pipeline.md))
1. Drop a pin or quick-add with type, photo, optional phone and a note in **≤ 60 s, offline** (MAP-02, PIP-07).
2. The salon starts as Prospect, pending: it is a proposal until the office approves it, with an optional rep and rate, or rejects it with a reason. A pending salon cannot have requests or orders (SAL-13). Every later stage change is a recorded event with a reason when manual (SAL-03).
3. A phone already on another salon is flagged to the office (CTL-18).

**J3 — An independent agent buys stock** ([doc 08 §10](docs/08-field-sales-and-rep-controls.md), D-15)
1. The agent sees the agent catalogue with agent prices and warehouse availability, quantities only; never salons, other agents, cost or supplier (AGT-04, H-01, H-05).
2. Stock leaves the warehouse **only after full payment** (cash counted or transfer matched); never on credit (AGT-03, A-07).
3. The agent gets a numbered invoice and receipt on their phone; the movement is `sale_to_agent` (AGT-03).
4. If they wanted more than is available, the shortfall is recorded as lost demand (DEM-02).
5. The only thing an agent may send back is an **optional pre-order request**; nothing else is asked of them (AGT-04, D-23).
6. Every agent purchase appears in the owner's morning digest, with a flag on unusually large ones (CTL-15, D-22).
7. Kiran pays nothing for recruiting other agents (AGT-06, A-06).

**J4 — The manager loads tomorrow's bags** ([doc 10 §7a](docs/10-inventory-and-restocking.md))
1. The system suggests each rep's load from tomorrow's route: open deliveries, due re-orders × last quantity, a prospect allowance, minus what is already in the bag (INV-11).
2. The suggestion never exceeds warehouse availability or the bag value limit; every shortfall is recorded as lost demand (INV-11, DEM-02, CTL-05).
3. Stock moves only when the rep confirms the same count; a different count moves nothing (CTL-05).

**J5 — The owner's morning** ([doc 01](docs/01-business-context.md), [doc 13](docs/13-anti-fraud-controls.md))
1. "How much are we owed, by whom, and who is collecting it?" is answered from the phone in **under 10 s** (doc 01 system goal 2, doc 11 exit criterion 4).
2. The daily digest lists every override, adjustment, variance, write-off, phone change, vault read, agent purchase, invitation, manager price change, commission rate change and payment, and investor payout (doc 00 fixed decision 8e, CTL-15, doc 13 §8, D-22).
3. Monthly sales through agents are reported in rupees (D-21).
4. Lost demand by SKU and reason shows what the supplier shortage cost (DEM-03, D-18).
5. A new rep can be invited by the owner or manager (SEC-16, SEC-17), onboarded and working the route (visits, order cards and collections; reps do not place orders, D-30, ORD-14, ACTIVITY L-0374) within **one working day**; offboarding takes under 10 minutes from one screen (doc 01 system goal 1 as amended by D-30, SEC-08).
6. The owner or manager opens Investors: each investor's invested, principal outstanding, profit decided, paid and owed, and the totals, all derived from amounts the office typed; nothing is calculated and nothing is posted to cash (CAP-01 to 03, D-40). A This-month block shows, per investor and in total, the profit decided for the month (the typed amounts dated in it), paid in the month and still owed, or says nothing is decided yet with a link to decide it (P1-26, A-20).
7. The office home answers at a glance who placed orders this week (salon request, rep or office), what waits to be delivered and for how long and by whom, what was delivered (invoice number and amount), and what needs attention (held orders, deliveries to approve, requests, new salons), each counted over every row and linked to the page that acts on it; Rep performance shows each rep's orders and commission for the month (P1-26).

**J6 — A salon sends a repeat order request** ([doc 15](docs/15-field-sales-distribution-engineering-plan.md))
1. The office invites the salon; the salon user signs in with the emailed code. The server resolves the salon from active membership, not a client-supplied ID (SAL-11, SEC-13/14, SEC-16).
2. The portal shows the shared active catalogue with pictures and that salon's own prices, otherwise list price; no stock in this work (SAL-12, ORD-07, INV-13).
3. The salon submits an order request, not an official order, with lines and no prices; idempotent, online only, never a false success (ORD-12, ORD-14).
4. It may edit or cancel the request until the office decides it; each edit is a new version (ORD-14).
5. The office converts or rejects it in the Requests queue; conversion runs the common server-side checks of price, stock and credit (ORD-11, ORD-15).
6. The salon sees only its own requests, order states, permitted documents, payments and balance (ORD-13, SAL-12). Salon A cannot reach salon B by changing an ID (SEC-14).
7. The order is not counted as a rep visit or a rep request (ORD-11).

**J7 — A rep's order request becomes an order** ([doc 15](docs/15-field-sales-distribution-engineering-plan.md))
1. At a reachable salon, during an open day, the rep saves a New Order Details card: a note, with optional product lines and never a price (ORD-14, SAL-14, PIP-09).
2. The rep may edit (a new version) or cancel it while it waits (ORD-14).
3. The card waits in the one Requests queue with salon requests (ORD-15).
4. A card with no lines opens the order form with salon and rep filled in; a card with lines converts in one click; the office picks the delivering rep (ORD-15, ORD-01).
5. Or the office rejects it with a reason, and the rep sees that reason (ORD-15).
6. The official order is the canonical `sales_order`, linked to the card; the rep reads it and cannot create, approve or modify it (ORD-01, ORD-11).
7. The rep submits the delivery; the office approves it; only then do the sale movement, invoice and installments exist and commission is earned (ORD-04, CTL-13).

## 4. Phase 1 feature map

The last column names the task whose status is on [the status board](docs/ACTIVITY.md) (ACTIVITY §12).

| Feature | Requirements | Proven by | Board task |
|---|---|---|---|
| Foundation: roles, MFA at the database, devices, audit chain, approvals | SEC-01 to 05, 07, 11, 12 | RLS matrix, verifier attack suites | P1-01 |
| Inventory, two-party bag custody, counts, adjustments, lost-demand tap | INV-01 to 06, CTL-05, DEM-01 | `inventory.test.ts`, RLS matrix | P1-04 |
| Territories, salons, masked phones, notes, stage events | SAL-01 to 03, 09, PIP-01, MAP-03 | `salons.test.ts`, RLS matrix | P1-02 part a |
| Visits and check-in gating | PIP-02, PIP-09 | `visits.test.ts`, RLS matrix (Playwright J1 not written yet) | P1-02 part b |
| Salon OTP verification, phone-change OTP | CTL-09, CTL-18 | DB tests (SMS adapter stubbed) | P1-02 part c |
| Excel import write path, timeline | SAL-10, SAL-05 | DB tests, import tests | P1-02 part d |
| Rep map | MAP-01, 02, 12 | Playwright | P1-03 |
| Vault: suppliers, POs, goods receipts, fill rate | VLT-01 to 06, D-18 | Vault leakage tests (doc 07 §5) | P1-05 |
| Orders (D-30): the office (owner or manager) creates orders, directly or by converting a rep's order card (New Order Details), with an optional assigned rep picked from the salon's territory reps (choosing none is allowed for a manager-direct order, A-16, L-0385); the owner's own discount on an office order needs no approval and is recorded on the order (L-0390); credit profile, credit gate, discount approvals, deliveries, gapless invoices; reps can no longer create orders | SAL-04 (eligibility, limit, block; overdue status waits for P1-07), ORD-01 to 04, ORD-14 (ORD-10 superseded by D-30; ORD-05 in the next row); CTL-07, CTL-08 (digest listing in P1-08) | `orders.test.ts`, `office-orders.test.ts`, `order-cards.test.ts`, `office-order-access.test.ts`, `deliveries.test.ts`, RLS matrix | P1-06 |
| Orders screens: the office Orders area (`/office/orders`: create an order, the open cards queue with convert and dismiss, the order list); the rep's My cards (`/app/cards`), Orders read-only (`/app/orders`) and the New Order Details card on the salon page | ORD-01, ORD-14 | `apps/web/e2e-stack/office.spec.ts` (card to order to the rep's read-only list; CI only) | P1-06 |
| Invoice document | ORD-05 | `invoice-document.test.ts` | P1-06 part c |
| Money: payments, allocations, receipts (gapless numbers and the receipt document's data), cash ledger, receivables ageing, two-party handover, office cash collection | PAY-01 to 05, 07, 10, 11; CTL-01 to 04, 17 | `payments.test.ts`, `receivables-ageing.test.ts`, `handovers.test.ts`, `office-cash.test.ts`, RLS matrix, office stack browser tests | P1-07 |
| Delivery approval (D-32): a rep's delivery becomes an immutable submission; only the owner's or manager's approval writes the delivery, the sale movement, the invoice, installments and the order status; submitted goods wait in pending-delivery stock custody; rejected goods stay there until the office settles them | D-32; ORD-04 (rewritten in slice 4) | built in slice 4 (migration 20261105130100): `supabase/tests/delivery-approval.test.ts`, the moved fixtures, and two real-stack browser journeys in `apps/web/e2e-stack/office.spec.ts` (CI only) | P1-21 |
| Commission (D-31, D-38): a rate per rep and salon with a rep default, set and changed by the owner or manager for future invoices only; earned on the delivered and invoiced value of orders with an assigned rep; payment records with reversals; owed is earned minus paid; date-range areas for the rep and the office | CTL-13, FLD-01 (default rate), FLD-03, FLD-06 | built in slice 5 (migration 20261105140000): `supabase/tests/commission.test.ts` and one real-stack browser journey in `apps/web/e2e-stack/office.spec.ts` (CI only) | P1-22 |
| Invitations, salon membership, salon approval, rep assignment and reachability; People and approvals screens (D-35, D-36, D-39) | SEC-13, 16, 17; SAL-11, 13, 14 | database role tests and browser journey (completion design §7) | P1-18 |
| Product pictures and descriptions, manager prices, per-salon prices (D-37, D-39) | INV-13, ORD-07 | database role tests and browser journey | P1-19 |
| Basic investor ledger, office only, no engine (D-40): investors, investments, typed profit decisions, payouts and reversals; Investors pages (`/office/investors`) | CAP-01 to 03 | `investors.test.ts`, RLS matrix, `apps/web/e2e-stack/office.spec.ts` (CI only) | P1-20 |
| Requests queue with lines; salon portal (D-34, D-41): rep cards and salon requests with lines (never prices), edits as versions, cancel before review; one-click convert on `/office/orders` (channel `salon_portal` for a salon's request); `/salon` with catalogue, basket, requests, orders, balance and payments | ORD-01, 11 to 15; SAL-12; SEC-14, 15 | `requests-portal.test.ts`, `order-cards.test.ts`, RLS matrix, `apps/web/e2e-stack/office.spec.ts` (CI only) | P1-23 |
| Rep read-only, salon proposals, timelines (D-35, D-39): `app.update_salon` refuses reps and the rep edit screen is gone; a rep's new salon is pending until the office approves it; `app.office_salon_timeline` and `app.office_order_timeline` on the office salon page and `/office/orders`. The end-to-end journey of completion design §7 waits for slices 4 to 6 to merge (`docs/superpowers/plans/2026-11-05-final-review-checklist.md`) | SAL-05, 09, 13 | `rep-readonly-timelines.test.ts`, `salon-approval.test.ts`, `salons.test.ts`, `apps/web/e2e-stack/office.spec.ts` (CI only) | P1-24 |
| Office operations and the end-to-end journey: `/office/orders/[id]` (deliver from a warehouse with `app.office_deliver`, the way a rep-less order is delivered, A-18; cancel; release a credit hold; recheck), `/office/approvals` (pending discount and adjustment requests through `app.office_pending_approvals`, migration 20261105170000; decide with `app.decide_approval`, then `app.recheck_order` for a discount), `/office/stock` (locations, rep bag by the owner, A-08; stock on hand; opening stock by an approved adjustment; stock issues proposed and cancelled), `/app/stock` (the rep confirms an issue with a blind count); the stack journey of completion design section 7 | ORD-02, 03, 04; CTL-05, 07; INV-02, 03; SEC-11 | `office-approvals.test.ts`, `verifier-attacks.test.ts`, `apps/web/e2e-stack/office.spec.ts` (CI only) | P1-25 |
| Overview pages that add up on their own (doc 16; MJ chat 2026-11-05): office home `/office` (orders placed this week, waiting to be delivered, delivered, needs your attention), Rep performance `/office/reps`, a This-month block on `/office/investors` and `/office/investors/[id]` (typed amounts only, D-40), and the rep's month on `/app`. Read functions only: `app.office_overview_counts`, `app.office_overview_rows`, `app.office_investor_month`, `app.my_month_orders`, `app.office_rep_month` (migration 20261105180000) | RPT-01 (thin), CAP-02, FLD-06 | `overviews.test.ts`, `verifier-attacks.test.ts`, `reverify3-attacks.test.ts`, `apps/web/e2e-stack/overviews.spec.ts` (CI only) | P1-26 |
| Invoice composer and customer acknowledgement: draft preview, display text, immutable issued invoice, the salon's signed acknowledgement plus approval as the condition of every delivery, salon invoices (P1-31, D-49) | ORD-04, ORD-05 | **Playwright** (real stack) + database tests | P1-31 |
| Office shell and documents: a grouped, collapsible office sidebar listing only working pages; Rep detail `/office/reps/[id]` (read-only: profile, phones, money this month, submissions waiting, orders, invoices, cards, territories, salons, days, visits, bag); Invoices and receipts `/office/invoices`, printable `/office/invoices/[id]` and `/office/receipts/[id]` in English, linked from the order page, the salon page and the office home; read functions `app.office_rep_detail`, `app.office_invoices`, `app.office_receipts` (migration 20261105190000) | ORD-05, CTL-01, FLD-06 | `supabase/tests/rep-detail-documents.test.ts`; `apps/web/e2e-stack/rep-detail-documents.spec.ts` (CI only) | P1-28 |
| Routes and the stock leftovers, no new database object: `/office/routes` (build a rep's day with `app.office_set_route`, due salons from `app.due_list`), `/app/route` (`app.my_route`, `app.rep_reorder_route`, `app.rep_add_stop`), `/office/stock/levels` (`app.warehouse_availability`, `app.low_stock`, `app.office_set_reorder_point`, office counts with `app.record_count` and their variance), a bag return on `/office/stock` confirmed on `/app/stock` (direction `to_warehouse`), the lost-demand tap on the rep's salon page (`app.record_demand`) | PIP-03, PIP-05/06 thin; INV-04, 05, 06; CTL-05; DEM-01 | `routes.test.ts`, `inventory.test.ts`, `apps/web/e2e-stack/office.spec.ts` (CI only) | P1-29 |
| Fixes from the wiring audit (D-45 to D-48; migration 20261105230000): the owner's own stock adjustment and discount at once (`app.owner_adjust_stock`, Stock and Delivery approvals), Withdraw (`app.cancel_approval`), the checker an adjustment needs (`app.office_adjustment_checker`), refused requests (`app.office_refused_approvals`), handover settlement and withdrawal on `/office/handovers` and `/app/handovers` (`app.owner_settle_handover`, `app.office_withdraw_handover`), the intraday cash cap in `app.rep_record_payment` with `app.office_cash_cap_reps` on the office home, payment reversal and the payments list on the office salon page (`app.office_reverse_payment`, `app.office_salon_payments`), credit exposure from what is owed and undelivered (`app.salon_exposure`), the CTL-08 cap on a stage unblock, invited reps acting only with an emailed-code session, `app.owner_create_user` refusing a salon login, delivered and still-to-deliver values and placed orders on the month and home reads, the salon's own rep by default on an order | CTL-03, 07, 08, 17; PAY-05, 10; INV-03; ORD-02; SEC-13, 16; RPT-01 thin | `audit-fixes.test.ts`, `rls-matrix.test.ts`, `verifier-attacks.test.ts` | P1-30 |
| Wiring audit, screens package (P1-30 part 2; reads at the end of migration 20261105230000): Credit, primary contact and payments on `/office/salons/[id]`; Add a salon on `/office/salons`; bag value limit on `/office/stock` (owner); `/office/settings` (owner, from Team); Rep days left open with Force close and the other queues under Needs your attention on `/office`; the rep sees a stuck day, why a pending phone or inactive account sees nothing (`/app` layout), why an order is held or cancelled, the office's reason for a rejected proposal, its own payments with receipt numbers (`app.my_collections`), and can sign out; the delivery page reads its order by id (`app.my_territory_order`); the salon portal words a held order and a suspended or closed account (`app.salon_login_status`); the office MFA page sends rep and salon logins to their own area | PIP-09; CTL-08; INV-03; SAL-01, 05; ADM-01, 02 (part); SEC-13; PAY-03 | `audit-fixes.test.ts` (part 2 describes), `apps/web/e2e-stack/p130-screens.spec.ts` (CI only; rep and salon screens have no browser test yet) | P1-30 |
| Control layer and owner digest | CTL-06, 11, 15, 16; SEC-06, 08 | DB tests | P1-08 |
| Offline PWA: outbox, idempotent sync, rejections | NFR-01 to 03 (ORD-10 superseded by D-30; offline order cards, ORD-14) | **Playwright** + field test | P1-09 |
| Dashboards, admin | RPT-01, 02; MSG-03; ADM-01, 02; FLD-01 | Playwright | P1-10, P1-11 |
| Independent agents | AGT-01 to 04, 06 | DB tests + Playwright J3 | P1-15 |
| Due-list and manual routes | PIP-03, PIP-05/06 thin | `routes.test.ts`, RLS matrix | P1-16 |
| Route-linked bag load, lost-demand report | INV-11, DEM-02, DEM-03 | DB tests + Playwright J4 | P1-17 |
| Security acceptance suite + restore drill | doc 06 §10, doc 07 §5, NFR-10 | launch security checklist below | P1-12 |

**Launch security checklist** ([doc 06 §10](docs/06-security-plan.md)), all required before the pilot:
1. RLS matrix passes for every table × role, including a rep in territory A failing to read territory B.
2. No application role can UPDATE or DELETE an append-only table.
3. No office login without TOTP; no rep action from an unapproved device.
4. Vault columns unreadable through the API with any user token; vault reads logged and in the digest.
5. Audit hash chain verifies; the mirror receives rows nightly.
6. Full offboarding from one screen in under 10 minutes (rehearsed).
7. Backup restore drill done and documented.
8. Dependency and secret scans clean; no service-role key in any client bundle.

## 5. Field constraints every screen must meet

| Constraint | Target | Source |
|---|---|---|
| Offline | Capture visits, order cards, payments, prospects and lost demand with no signal; sync ≤ 60 s after reconnecting | NFR-01 |
| Cheap phone | First load ≤ 3 s on 3G after install; interactions ≤ 200 ms; rep app shell ≤ 300 KB gzipped; 3–4 year old Android, 2–3 GB RAM | NFR-02, doc 01 |
| Language | English only: no Urdu labels, no i18n layer (D-42). Roman Urdu stays accepted in free-text fields | NFR-03 |
| Speed of a field action | ≤ 60 s for quick add, a visit, an order card or a tap | PIP-07, MAP-02 |
| Cost | ≤ USD 60 a month at launch scale (≤ 10 reps, ≤ 3,000 salons) | NFR-09 |
| Recovery | RPO ≤ 24 h, RTO ≤ 4 h | NFR-10 |

## 6. Commands

```bash
pnpm install --frozen-lockfile
pnpm typecheck                      # every package
pnpm db:test                        # all migrations on a throwaway Postgres + RLS/invariant suite
pnpm db:test -- -t "name"           # one test
pnpm -r --if-present test           # package unit tests (packages/import)
pnpm activity:check                 # the ACTIVITY.md and docs/log check CI runs
pnpm -C apps/web dev                # web app on :3000 (/app rep PWA, /office)
pnpm -C apps/web build              # production build (CI also scans the bundle, H-18)
pnpm lint                           # Biome lint + format check (CI job `lint`, §8)
pnpm format                         # write Biome fixes
pnpm -C apps/web test:e2e           # Playwright rep PWA tests; builds the app first (CI job `e2e`, §9)
```

- **Test database URL:** set `KIRAN_TEST_DATABASE_URL`, never the generic `DATABASE_URL`, to use a real database. For example, `supabase start` gives `postgresql://postgres:postgres@127.0.0.1:54322/postgres`.
- **Running as root:** embedded Postgres cannot start as root, so point the URL at a fresh local database and recreate it before every run.
- **Collation:** create that database with the en_US.UTF-8 collation, as Supabase does (`create database kiran_test template template0 locale 'en_US.UTF-8'`). The embedded Postgres uses the C locale, which hides ordering differences (ACTIVITY L-0150).
- **Test order:** test files share one database and run in file-name order (`supabase/tests/vitest.config.ts`); a file that commits territory assignments ends them in `afterAll`.
- **Staging:** nothing is applied to staging or production by hand (H-19). Migrations reach them through CI only.

## 7. Project structure

| Path | What |
|---|---|
| `docs/` | Planning set 00–16 (doc 16 is authoritative for business rules), `ACTIVITY.md` (protocol, status board, blockers), `log/` (one file per log entry; `log/archive.md` is frozen), `diagrams/`, `runbooks/` |
| `supabase/migrations/` | Forward-only SQL: schemas, tables, RLS, `app.*` functions, guards. One file per task, never edited after merge |
| `supabase/tests/` | Vitest + `pg`: the RLS matrix (every table × 10 personas), invariant and attack tests, schema hygiene |
| `apps/web/` | Next.js 16 + React 19. `app/app/` is the rep PWA, `app/office/` the owner/manager app, `lib/supabase/` the clients. `app/salon/` is the salon customer portal (slice 1 account page; catalogue, basket, requests, orders, balance and payments in slice 6, Phase 1 in doc 11 since D-41). `app/invite/` is the invitation page, the only one that creates a login (D-39) |
| `packages/import/` | Excel/CSV salon import dry-run (P0-02); writes to no database |
| `packages/shared/` | Planned: DB-generated types, validation schemas |
| `scripts/` | CI helpers: activity-log check, service-role scan, staging smoke |

The business specification is [doc 16](docs/16-project-completion-goal.md). The data model is in [doc 04](docs/04-domain-model.md), the architecture in [doc 05](docs/05-architecture.md), the cross-domain integration brief in [doc 14](docs/14-unified-business-domain-prompt.md), and the module-level field-sales/distribution directive in [doc 15](docs/15-field-sales-distribution-engineering-plan.md).

## 8. Code style

**Formatting and lint: Biome** (MJ, L-0136).
- One `biome.jsonc` at the root, `pnpm lint` and a CI `lint` job that fails the pull request.
- Run `biome check --write` before committing.
- *Status: in place* (`biome.jsonc`, Biome 2.3.15). Files that existed before Biome and do not yet pass it are listed as **legacy** in `biome.jsonc` and excused from formatting and import order until cleaned up; every other file, and every new one, must pass.

**TypeScript**
- `strict` on.
- No `any` without a comment saying why.
- No non-null `!` on data from the network or database.
- Name things with domain words from [doc 00's vocabulary](docs/00-README.md) (salon, khata, bag, handover).
- Money is integer **paisa** (`bigint` / `number` within the safe range), never floats. Format it only at the edge.

**React / Next.js**
- Server components by default; client components only where state or offline needs them.
- No secrets in client code or `NEXT_PUBLIC_*` (H-18).
- All writes go through `app.*` RPCs, never a direct table write.

**SQL** (the full rules are the database conventions in [`CLAUDE.md`](CLAUDE.md)):
- **RLS:** enabled and forced on every table, in the same migration that creates it.
- **Write functions:** writes go only through `security definer` functions with `set search_path = ''`, an idempotency `client_id`, and role and device checks.
- **Append-only tables:** guarded by triggers against every role.
- **Audit:** every table has an audit trigger.
- **Time:** server time is authoritative; client times are kept in `*_client` columns.
- **Data:** no free text that could hold supplier identity (H-27). Fixtures are `[Dummy]` / `[Test]` only, and phone numbers look like `+920000001234` (H-02 to H-04).

**UI copy:** the whole UI is in English only (D-42). They must work on a 3–4 year old Android phone with patchy data ([doc 01](docs/01-business-context.md)).

## 9. Testing strategy

| Layer | What it proves | Where | Status |
|---|---|---|---|
| **RLS matrix** | Each persona can read exactly the rows the matrix predicts in every table, and no app role can write directly | `supabase/tests/rls-matrix.test.ts` | Running in CI |
| **Invariant and attack tests** | Controls hold under attack: append-only, maker ≠ checker, no negative stock, single-use approvals, territory isolation, replays | `supabase/tests/*.test.ts` | Running in CI |
| **Schema hygiene** | Every table has RLS and an audit trigger; every SECURITY DEFINER function pins `search_path`; anon can execute nothing | `supabase/tests/schema-hygiene.test.ts` | Running in CI |
| **Package unit tests** | Import mapping and normalisers | `packages/import/tests/` | Running in CI |
| **Rep PWA browser tests** (Playwright, MJ L-0136) | The offline visit, order card, payment and lost-demand tap are queued in the outbox and synced idempotently; a server rejection after sync is shown to the rep (NFR-01); throttled network and a low-end mobile viewport | `apps/web/e2e/` | **Running in CI** (job `e2e`): sign-in on a 360 px Android screen, a refused request shown to the rep, ≤ 300 KB gzipped JavaScript (199.9 KB on 2026-10-28), security headers. Offline order-card, payment and lost-demand flows are added with P1-09 |
| **Field test** | Offline capture in a basement salon with no signal (Phase 1 exit criterion 6) | Pilot, [doc 11](docs/11-roadmap.md) | Phase 1 pilot |

**Rules for tests:**
- **No test is ever skipped or loosened** to get green (H-23).
- **Verifier-authored tests** change only with MJ's approval. Three kinds of change for a new module are pre-approved (MJ, 2026-10-28, ACTIVITY L-0144): adding its functions to the allowlist, adding `*_client` or planned-date parameters to the client-time list, and turning a "does not exist yet" check into a "rep sees 0 rows" check. Each is logged.
- **Each control gets a test that tries to break it**, not only one that uses it.
- **The Definition of Done** is in ACTIVITY §6.
- **The builder, another agent or MJ marks work VERIFIED** after an attempt to break the control with real evidence (commands, results, commit SHA); a builder verifying its own work says so on a `**Self-verification:**` line (ACTIVITY §7, MJ L-0401).

## 10. Boundaries

The full list is the hard rules H-01 to H-27 (ACTIVITY §5), "stop and ask MJ" (§9) and the human-only actions (§10). In short:

**Always**
- Read `docs/ACTIVITY.md` and the 20 newest entries in `docs/log/`, then keep one log entry for your task.
- Work on a feature branch.
- Record real evidence: commands, counts, SHAs (H-23, H-24).
- Enforce controls in the database, not only in the UI.
- Keep docs and code in step in the same pull request (H-25).

**Ask MJ first**
- Any change to a fixed decision, the permission matrix, custody chains or the doc 13 §9 thresholds (H-26).
- Anything touching production (H-19).
- A new third-party service or any spend (H-21).
- A control that cannot be built as specified, or two docs that conflict.
- Changing a verifier-authored test, beyond the three pre-approved kinds (§9).

**Never**
- Put supplier identity, cost or real personal data anywhere outside the vault: not in the repo, CI, logs or prompts (H-01 to H-05).
- Edit or delete history; corrections are reversing rows (H-06, H-07).
- Weaken, bypass or "temporarily skip" RLS, MFA, device binding, approvals or audit (H-16).
- Put a service-role key in client code (H-18).
- Mark work VERIFIED without real evidence, or verify your own work without saying so (§7, MJ L-0401).
- Pay agents for recruiting other agents (A-06; SECP, Companies Act 2017 s.301).

## 11. Decisions waiting on MJ

Work that needs them is blocked or runs on the stated default (ACTIVITY §14, doc 12).

| Item | Blocks | Default meanwhile |
|---|---|---|
| Staging: apply migrations 0014 to 0024 (H-19; staging has 13 of main's 24); PR A's migration `20261104090000`, unmerged, would be the 25th | Every screen built since 2026-11-01 on staging; Gate 0 | Local and CI only |
| OQ-33: is a per-salon price below list a discount needing approval (doc 04 invariant 5, CTL-07)? | P1-19 using a salon price on an order | The price gate stays as written |
| OQ-34: does a commission payment or investor payout need a second person or an owner threshold? | P1-20, P1-22 | As designed: no checker; listed in the digest once P1-08 exists |
| OQ-23, OQ-26, OQ-27, OQ-28: legal nature, distributable profit, losses, operator share (MJ and advisers) | Live investor agreements or settlements, not the basic ledger (D-40) | Office types each decision; no formula |
| Going live for the completion work (spec section 8): staging migrations, the owner account, email sign-up on for invitations, the storage bucket, real products | Real use of P1-18 to P1-24 | Local and CI only; email sign-up is on in the local `supabase/config.toml` for the invitation page (slice 1) and stays off on staging until MJ turns it on (gate-0 item 2) |
| B-31 (a) to (g), all still open: pin moves, phone-reveal cap, past midnight, invoice per delivery, delivery_mode, low_stock scope, agents ((d) and (e) were not settled by B-40 (a), L-0374) | The matching fixes; P1-15 | Code as built: one invoice per delivery; delivery_mode stored but not used (L-0374) |
| B-39: approval use-time rules (who may use, use-time check, expiry, offboarded checker, credit override, write-off) | P1-08 | D-25 registry may be built; the open rules keep today's behaviour |
| B-38: the service-role scan passes an empty `--bundle` directory, because source files are counted with the bundle files; approve requiring at least one scanned file per `--bundle` directory (H-18), with a test? | — | Leave as is |
| A-18: an order with no assigned rep (manager-direct, later the salon portal) is delivered from the warehouse by the office (`app.office_deliver`) and paid through the office cash or bank-transfer paths (L-0386) | Delivery and collection of rep-less orders; PR B | As built in PR A's database functions: the office delivers it and records its payments; no rep can deliver it (L-0391); no delivery screen exists yet |
| B-41 and the verifier's verdict (a CORRECTION entry that also corrects L-0355): findings of an independent check of P1-07 money and the B-34, B-35 fixes, held on the unpushed branch `claude/gifted-mestorf-be2a40` (L-0383, L-0392); its entries move to `docs/log/` files when that branch is brought forward. Asks: MJ's OK to push it and open its pull request; a task id for the B-34, B-35 fixes, so that a VERIFIED entry can name them | Any VERIFIED status for P1-07; B-34 item 3 re-verification | Leave as is until a builder fixes the findings |
| OQ-32: rep location policy | Location tracking (PIP-12/13) | Event GPS only |
| Owner account creation and MFA (human-only, ACTIVITY §10) | P0-05, Gate 0 | — |
| OQ-01: the real Excel file | P0-02 real run, opening balances | Synthetic data |
| OQ-13: pilot territory and pilot rep | P0-03, P1-13 pilot | — |
| OQ-16: real product catalogue | Real SKUs and prices | `[Dummy]` products |
| OQ-17: agent price (% below list, or per SKU) | First agent sale | No SKU sold to agents until priced |
| OQ-18: may agents sell to Kiran's direct salons? | Agent 2 | No rule in the system |
| OQ-19: who is served first when the supplier is short | Allocation (AGT-07) | Direct salons' orders first |
| OQ-20: agent identity data | Agent 1 | Name and phone only |
| OQ-21: monthly target for sales through agents (Rs) | Agent channel goal | No target; the figure is reported monthly |
| OQ-22: what counts as an unusually large agent purchase | Digest flag | No flag; every agent purchase is listed anyway |
| A-08: rep bag limits owner-only (may be relaxed to the manager) | — | Owner only |
| B-28: may reps park a salon (doc 02) against the doc 06 matrix (rep: no manual stage change) and D-35 (reps cannot edit an existing salon) | Matrix wording; P1-24 | Rep parking stays, as doc 02 says |
| A-09, A-10: opening last purchase; exposure as confirmed installment orders | P1-07 | As stated in ACTIVITY §15 |
| Pin required for a map-created salon? (ACTIVITY L-0182) | A database check | Not required (offline quick add may lack GPS) |
| Phone-reveal cap; automatic day close; geofence threshold (ACTIVITY L-0146, L-0152) | New thresholds (H-26) | No cap; office force-close only; distance recorded, not enforced |
